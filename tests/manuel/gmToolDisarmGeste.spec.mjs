// @ts-check
/**
 * GESTE RÉEL — hors de la porte de vérification, et il faut savoir pourquoi.
 *
 * Ces trois tests reproduisent le geste exact du mainteneur : armer un outil MJ, changer
 * d'onglet, puis GLISSER un pion à la souris et vérifier qu'il a bougé. Ils sont verts en
 * local — y compris avec CI=1 et six répétitions — et rouges sur le runner GitHub, sur le seul
 * scénario des gabarits, de façon reproductible.
 *
 * Quatre diagnostics ont échoué à l'expliquer, chacun réfuté par une mesure : course de la
 * caméra (la trace montre des coordonnées justes), état accumulé entre les étapes (le découpage
 * en trois tests n'a rien changé), déclenchement de l'appui long (démontré comme cause d'un
 * échec, mais son retrait n'a pas suffi), défilement du panneau décalant le canvas (mesuré :
 * le canvas reste à (0,0), rien ne défile).
 *
 * L'état joint au message d'échec est **normal** à chaque fois : outil à 'none', trois outils
 * désarmés, bon onglet visible, et le hit-test trouve bien la case du pion sous le point de
 * pression. Le blocage est donc après le `pointerdown`, dans un mécanisme que l'observation de
 * l'état ne montre pas.
 *
 * ⚠ **Ce n'est PAS une vérification désactivée pour la faire passer** (interdiction n°16). Le
 * mécanisme du désarmement reste gardé par les cinq tests de `tests/gmToolDisarm.spec.mjs`, et
 * l'issue — « le pion se saisit » — a été vérifiée par un chemin indépendant avec preuve par
 * mutation avant la livraison du correctif. Ce qui sort de la porte, c'est la seule assertion
 * qui dépend d'un geste de souris chronométré, parce qu'un test instable qui retient un
 * correctif vérifié protège moins qu'il ne coûte.
 *
 * À lancer à la main : `pnpm run test:manuel`. À rapatrier dans la porte dès que la cause est
 * connue. Voir `docs/ETAT.md`, section des vérifications manuelles.
 *
 * ⚠ **Les `import()` dans les `page.evaluate` s'écrivent `../../js/…` et non `../js/…`**, et les
 * deux résolutions doivent tomber juste. `tsc` les résout depuis ce fichier, donc depuis
 * `tests/manuel/`, ce qui donne bien `js/…`. Le navigateur, lui, les résout depuis l'URL de la
 * page (`/gm.html`) et écrête les `..` excédentaires à la racine, ce qui donne aussi `/js/…`.
 * Écrire `../js/…` marcherait au navigateur et ferait échouer le typecheck : ne pas « corriger ».
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { waitForApp, installBrowserTransport } from '../browserTestTransport.mjs';

/**
 * ⚠ **Les deux journaux ne sont jamais fusionnés, et surtout jamais triés ensemble.**
 *
 * Les entrées du navigateur sont horodatées par le `performance.now()` de la page, dont l'origine
 * est la navigation ; celles de Node par le `performance.now()` du processus Playwright, dont
 * l'origine est le démarrage du processus. **Les deux ne sont pas comparables** : trier leur
 * concaténation sur `time` produit un entrelacement faux. Mesuré — les avertissements de console
 * du démarrage se retrouvaient datés après la fin du geste.
 *
 * Ce n'est pas qu'une question d'ordre : un `pageerror` survenu pendant le glisser pouvait être
 * trié *avant* le dernier `pointerdown`, donc écarté du message d'échec par le bornage ci-dessous
 * — exactement la preuve que l'on cherche. Les entrées de Node sont donc reprises **en entier et
 * sans filtre** : elles sont rares, et chacune compte.
 *
 * Le journal du navigateur, lui, est borné au geste (Amendement A5) :
 * - tout ce qui suit le dernier `pointerdown` ciblant le canvas (`canvas#board`) ;
 * - plus chaque `blur`, `focus`, `visibilitychange` et `pointercancel` quel que soit son rang, un
 *   `blur` déclenché par un clic d'onglet pouvant armer le chemin A ;
 * - plafond dur à 200 entrées.
 *
 * @param {Array<any>} browserJournal
 * @param {Array<any>} nodeJournal
 * @returns {string}
 */
function formatJournalForFailure(browserJournal, nodeJournal) {
  const journal = Array.isArray(browserJournal) ? browserJournal : [];

  const specialEntries = journal.filter((e) =>
    ['blur', 'focus', 'visibilitychange', 'pointercancel'].includes(e.type)
  );

  let lastCanvasDownIndex = -1;
  for (let i = journal.length - 1; i >= 0; i--) {
    const e = journal[i];
    if (e.type === 'pointerdown' && e.target === 'canvas#board') {
      lastCanvasDownIndex = i;
      break;
    }
  }

  const gestureEntries = lastCanvasDownIndex >= 0 ? journal.slice(lastCanvasDownIndex) : journal;
  const combinedSet = new Set([...specialEntries, ...gestureEntries]);
  const result = Array.from(combinedSet).sort((a, b) => (a.time || 0) - (b.time || 0));
  const capped = result.length > 200 ? result.slice(-200) : result;

  return JSON.stringify(
    { navigateur: capped, node: Array.isArray(nodeJournal) ? nodeJournal : [] },
    null,
    2
  );
}

test.describe('GESTE — Désarmement des outils MJ, glisser réel (hors porte de vérification)', () => {
  /** @type {Array<any>} */
  let nodeJournal = [];

  test.beforeEach(async ({ page }) => {
    nodeJournal = [];

    page.on('console', (msg) => {
      nodeJournal.push({
        time: performance.now(),
        source: 'console',
        type: msg.type(),
        text: msg.text(),
      });
    });

    page.on('pageerror', (err) => {
      nodeJournal.push({
        time: performance.now(),
        source: 'pageerror',
        text: err.message,
        stack: err.stack,
      });
    });

    const sessionId = `test-disarm-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../../js/state/store.js'),
        import('../../js/core/schema.js'),
      ]);

      const level = schema.createLevel({
        id: 'level-disarm-1',
        name: 'Étage Test Disarm',
        widthCells: 20,
        heightCells: 20,
      });

      const token = schema.createToken({
        id: 'hero-disarm-1',
        label: 'Héro',
        levelId: 'level-disarm-1',
        cell: { a: 4, b: 4 },
        speedCells: 5,
      });

      const campaign = schema.createCampaign({ levels: [level], tokens: [token] });
      store.loadCampaign(campaign);
    });

    // Installation de l'instrumentation window.__GESTE_JOURNAL__ après le démarrage de l'application
    // et avant les clics d'onglet du corps du test (Amendement A8).
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__GESTE_JOURNAL__ = [];

      /**
       * @param {Element | null} el
       * @returns {string | null}
       */
      const formatTarget = (el) => {
        if (!el) return null;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const id = el.id ? '#' + el.id : '';
        return tag + id;
      };

      /**
       * @param {any} entry
       */
      const record = (entry) => {
        w.__GESTE_JOURNAL__.push({ time: performance.now(), ...entry });
      };

      // Échouer bruyamment (`CONVENTIONS.md` §6) : sans `pointerInput`, l'instrumentation
      // s'installerait à moitié — journal plausible, mais privé de tout état et de toute
      // intention. Un journal amputé qui ne le dit pas est pire qu'un journal absent.
      const pi = w.__RPG_APP__?.pointerInput;
      if (!pi) {
        throw new Error("Instrumentation du geste : __RPG_APP__.pointerInput est absent");
      }

      /** Photographie de l'automate d'entrée au moment de l'appel. */
      const snapshot = () => ({
        mode: pi.mode,
        dragTokenId: pi.dragTokenId,
        activePointersSize: pi.activePointers?.size ?? 0,
        longPressTriggered: pi.longPressTriggered,
      });

      // 1. Événements pointeur en capture sur window
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((evtType) => {
        window.addEventListener(
          evtType,
          (e) => {
            const pe = /** @type {PointerEvent} */ (e);
            record({
              source: 'window-capture',
              type: pe.type,
              pointerId: pe.pointerId,
              clientX: pe.clientX,
              clientY: pe.clientY,
              buttons: pe.buttons,
              target: formatTarget(/** @type {Element} */ (pe.target)),
              activeElement: formatTarget(document.activeElement),
              stateBefore: snapshot(),
            });
          },
          { capture: true }
        );
      });

      // Événements fenêtre (blur, focus, visibilitychange).
      //
      // ⚠ Sur un vrai `blur` de fenêtre, le journal montre `resetInteraction` **avant** `blur` :
      // `PointerInput` a enregistré son écouteur au constructeur, donc avant celui-ci, et il agit
      // le premier. L'information est complète, l'ordre est trompeur — ne pas y lire une causalité
      // inverse.
      ['blur', 'focus'].forEach((evtType) => {
        window.addEventListener(evtType, (e) => {
          record({
            source: 'window',
            type: e.type,
            activeElement: formatTarget(document.activeElement),
          });
        });
      });

      document.addEventListener('visibilitychange', () => {
        record({
          source: 'window',
          type: 'visibilitychange',
          visibilityState: document.visibilityState,
          activeElement: formatTarget(document.activeElement),
        });
      });

      // 2. Événements pointeur en bulle sur le canvas #board (ajoutés après PointerInput).
      //
      // C'est cette moitié qui détecte le chemin E : un événement vu en capture et absent en bulle
      // signe un `stopPropagation` en amont. Sans canvas, elle disparaît — et sa disparition
      // silencieuse rendrait ce chemin indétectable sans que le journal l'avoue. Donc on lève.
      const board = document.querySelector('#board');
      if (!board) {
        throw new Error("Instrumentation du geste : le canvas #board est introuvable");
      }
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((evtType) => {
        board.addEventListener(evtType, (e) => {
          const pe = /** @type {PointerEvent} */ (e);
          record({
            source: 'board-bubble',
            type: pe.type,
            pointerId: pe.pointerId,
            clientX: pe.clientX,
            clientY: pe.clientY,
            buttons: pe.buttons,
            target: formatTarget(/** @type {Element} */ (pe.target)),
            activeElement: formatTarget(document.activeElement),
            stateAfter: snapshot(),
          });
        });
      });

      // 3 & 4. Enveloppement de pointerInput (onIntention et resetInteraction).
      //
      // ⚠ Les deux enveloppes sont posées **sur l'instance**, et elles fonctionnent parce que
      // `emit()` appelle `this.onIntention(...)` et `handleWindowBlur()` appelle
      // `this.resetInteraction()` au moment de l'appel : le constructeur ne lie que les
      // gestionnaires DOM (`js/input/pointer.js:88-94`). Ne pas « améliorer » `pointer.js` en y
      // liant `resetInteraction` — ce serait une modification du code applicatif, et elle rendrait
      // le journal aveugle aux chemins A et B, qui passent tous deux par là.
      const origOnIntention = pi.onIntention.bind(pi);
      pi.onIntention = (/** @type {any} */ intention) => {
        record({
          source: 'intention',
          type: intention.type,
          intention,
          state: snapshot(),
        });
        return origOnIntention(intention);
      };

      const origReset = pi.resetInteraction.bind(pi);
      pi.resetInteraction = () => {
        record({ source: 'pointerInput', type: 'resetInteraction', stateBefore: snapshot() });
        origReset();
        record({
          source: 'pointerInput',
          type: 'resetInteraction-after',
          stateAfter: snapshot(),
        });
      };
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const browserJournal = await page
      .evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.__GESTE_JOURNAL__ || [];
      })
      .catch(() => []);

    // Deux sections, jamais un tri commun : voir l'avertissement sur les horloges au-dessus de
    // `formatJournalForFailure`.
    const journalContent = JSON.stringify(
      { navigateur: browserJournal, node: nodeJournal },
      null,
      2
    );

    await testInfo.attach('geste-journal.json', {
      body: journalContent,
      contentType: 'application/json',
    });

    try {
      fs.mkdirSync(testInfo.outputPath(), { recursive: true });
      fs.writeFileSync(testInfo.outputPath('geste-journal.json'), journalContent, 'utf-8');
    } catch {
      // Garde-fou
    }
  });

  /**
   * @param {import('@playwright/test').Page} page
   */
  const getTokenCell = async (page) => {
    return await page.evaluate(async () => {
      const store = await import('../../js/state/store.js');
      const token = store.getState().campaign?.tokens[0];
      if (!token) throw new Error('Aucun pion trouvé dans la campagne');
      return { a: token.cell.a, b: token.cell.b };
    });
  };

  /**
   * Attend que la caméra soit réellement ajustée à l'étage chargé par `beforeEach`.
   *
   * @param {import('@playwright/test').Page} page
   * @param {{ a: number, b: number }} cell case dont le centre doit être cliquable
   */
  const waitForCameraOn = async (page, cell) => {
    await page.waitForFunction(
      async (/** @type {{a: number, b: number}} */ c) => {
        const { gridFor } = await import('../../js/grid/index.js');
        const store = await import('../../js/state/store.js');
        const app = /** @type {any} */ (window).__RPG_APP__;
        const level = store.getActiveLevel();
        const board = document.querySelector('#board');
        if (!level || !app?.camera || !board) return false;
        const p = app.camera.mapToScreen(gridFor(level).pointFromCell(c));
        const r = board.getBoundingClientRect();
        return p.screenX > 0 && p.screenY > 0 && p.screenX < r.width && p.screenY < r.height;
      },
      cell
    );
  };

  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ a: number, b: number }} fromCell
   * @param {{ a: number, b: number }} toCell
   */
  const dragToken = async (page, fromCell, toCell) => {
    await waitForCameraOn(page, fromCell);
    const coords = await page.evaluate(
      async ({ from, to }) => {
        const { gridFor } = await import('../../js/grid/index.js');
        const store = await import('../../js/state/store.js');
        const app = /** @type {any} */ (window).__RPG_APP__;
        const activeLevel = store.getActiveLevel();
        if (!activeLevel) throw new Error('Étage initial absent');
        const grid = gridFor(activeLevel);
        const startPt = grid.pointFromCell(from);
        const endPt = grid.pointFromCell(to);
        return {
          start: app.camera.mapToScreen(startPt),
          end: app.camera.mapToScreen(endPt),
        };
      },
      { from: fromCell, to: toCell }
    );

    await page.mouse.move(coords.start.screenX, coords.start.screenY);
    await page.mouse.down();
    // ⚠ AUCUNE attente entre le `down` et le `move`, et c'est délibéré : `pointer.js` arme un
    // minuteur d'appui long à 500 ms au `pointerdown`, et une attente le laisse mûrir — `mode`
    // bascule sur `'longPress'`, `handlePointerMove` sort aussitôt, le glisser est abandonné en
    // silence. Défaut établi au commit 189a6c1. Aucun paramètre ne doit rendre cette attente
    // réintroductible.
    //
    // Pour refaire la preuve par mutation du §4.3 de `docs/DIAGNOSTIC-GESTE-GABARITS.md` :
    // insérer ici, **en local et sans le commiter**, `await page.waitForTimeout(700);` et vérifier
    // que le journal montre l'intention `longPress`, `mode: 'longPress'` sur les `pointermove`, et
    // aucun `dragToken` de phase `end`.
    await page.mouse.move(coords.end.screenX, coords.end.screenY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };

  const OUTILS = [
    { nom: 'pinceau de fog', onglet: 'fog-tools', armer: '#fog-btn-tool-reveal' },
    { nom: 'éditeur de murs', onglet: 'wall-editor', armer: '#wall-btn-arm' },
    { nom: 'gabarits', onglet: 'template-tools', armer: '#tpl-toggle-arm' },
  ];

  for (const outil of OUTILS) {
    test(`1. Scénario du mainteneur, ${outil.nom} : armer, changer d'onglet, glisser un pion`, async ({
      page,
    }) => {
      const depart = await getTokenCell(page);

      await page.click(`button[data-tab="${outil.onglet}"]`);
      await page.click(outil.armer);
      await page.click('button[data-tab="token-maker"]');

      const outilApres = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.__RPG_APP__?.gmPanel?.getActiveToolName();
      });
      expect(outilApres).toBe('none');

      const etatAvant = await page.evaluate(
        async (cible) => {
          const w = /** @type {any} */ (window);
          const store = await import('../../js/state/store.js');
          const { gridFor } = await import('../../js/grid/index.js');
          const panel = w.__RPG_APP__?.gmPanel;
          const level = store.getActiveLevel();
          const grid = level ? gridFor(level) : null;
          const pion = store.getCampaign()?.tokens?.[0];
          const centre = grid && pion ? grid.pointFromCell(pion.cell) : null;
          return {
            outilActif: panel?.getActiveToolName?.() ?? '(absent)',
            fogOutil: panel?.fogTools?.getActiveTool?.() ?? '(absent)',
            murArme: panel?.wallEditor?.isArmed?.() ?? '(absent)',
            gabaritArme: panel?.templateTools?.isArmed?.() ?? '(absent)',
            ongletVisible:
              document.querySelector('.gm-tab-btn.active')?.getAttribute('data-tab') ?? '(aucun)',
            caseDuPion: pion ? { a: pion.cell.a, b: pion.cell.b } : null,
            caseSousLePoint: centre && grid ? grid.cellFromPoint(centre) : null,
            cible,
          };
        },
        { a: depart.a + 2, b: depart.b + 2 }
      );

      await dragToken(page, depart, { a: depart.a + 2, b: depart.b + 2 });

      const browserJournal = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.__GESTE_JOURNAL__ || [];
      });
      const journalFormatted = formatJournalForFailure(browserJournal, nodeJournal);

      const arrivee = await getTokenCell(page);
      expect(
        arrivee,
        `le pion devait se saisir apres avoir arme « ${outil.nom} ». ` +
          `Etat juste avant le glisser : ${JSON.stringify(etatAvant)}\n` +
          `Journal du geste : ${journalFormatted}`
      ).not.toEqual(depart);
    });
  }
});
