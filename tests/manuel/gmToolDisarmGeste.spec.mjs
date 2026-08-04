// @ts-check
/**
 * GESTE RÉEL — le geste du mainteneur, et la cause de six runs rouges.
 *
 * Ces trois tests reproduisent le geste exact du mainteneur : armer un outil MJ, changer
 * d'onglet, puis GLISSER un pion à la souris et vérifier qu'il a bougé.
 *
 * ## La cause, mesurée le 4 août 2026
 *
 * Verts en local, rouges sur le runner GitHub sur le seul scénario des gabarits, de façon
 * reproductible des runs 69 à 76. **C'était un défaut du test, et lui seul :**
 * `camera.mapToScreen` rend des coordonnées relatives au canvas, `page.mouse` en attend du
 * viewport. Les deux ne coïncident que si `#board` commence en `(0, 0)`.
 *
 * Le panneau des gabarits déborde horizontalement sur le runner — pas sur Windows, les métriques
 * de police diffèrent. Cliquer `#tpl-toggle-arm` le fait défiler dans la vue, le document part de
 * 66 px, et `#board` se retrouve à `left: -66`. Le test pressait donc 66 px à côté : `screenToMap`
 * rendait `x = 886,67` au lieu de `630`, la case visée n'avait pas de pion, `canStartTokenDrag`
 * rendait `null`, et le glisser devenait un **pan** — cinq `panBy`, aucun `dragToken`, pion
 * immobile, et un état par ailleurs parfaitement normal.
 *
 * L'application est innocente : `getScreenPoint` fait `clientX - rect.left`, juste quel que soit
 * le défilement.
 *
 * ## Ce que quatre diagnostics avaient manqué, et pourquoi
 *
 * Course de la caméra, état accumulé, appui long, défilement du panneau : les quatre ont été
 * réfutés par une mesure, et les quatre étaient hors sujet. Le dernier passait à côté d'un cheveu
 * — il avait mesuré `scrollY` et le défilement **vertical**, quand le décalage était horizontal.
 *
 * Ce qui a fermé la question à tort, c'est un champ de diagnostic mal lu : `caseSousLePoint`
 * faisait un aller-retour depuis la case du pion, jamais depuis le point réellement pressé. Il
 * rendait donc toujours la bonne case, ce qui a fait conclure que le hit-test tombait juste et
 * qu'il fallait chercher **après** le `pointerdown`. Une sonde qui ne mesure pas ce que son nom
 * annonce coûte plus cher que pas de sonde du tout.
 *
 * Ce qui a fini par trancher : instrumenter le mécanisme et non l'état — les événements reçus, les
 * intentions émises, puis les prédicats injectés par la vue MJ — et faire remonter le condensé par
 * annotation GitHub Actions, seul canal lisible sans authentification.
 *
 * ⚠ **Ce n'est PAS une vérification désactivée pour la faire passer** (interdiction n°16). Le
 * mécanisme du désarmement reste gardé par les cinq tests de `tests/gmToolDisarm.spec.mjs`, et
 * l'issue — « le pion se saisit » — a été vérifiée par un chemin indépendant avec preuve par
 * mutation avant la livraison du correctif.
 *
 * À lancer à la main : `pnpm run test:manuel`. **La cause étant désormais connue, le rapatriement
 * dans la porte de vérification est ouvert** — c'est une décision du mainteneur, pas un effet de
 * bord de ce correctif. Voir `docs/DIAGNOSTIC-GESTE-GABARITS.md` et `docs/ETAT.md`.
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

/**
 * Publie l'essentiel du journal sous forme d'annotation GitHub Actions.
 *
 * ⚠ **C'est le seul canal de diagnostic lisible sans authentification.** Les journaux de la CI
 * répondent 403 et les artefacts 401 à un lecteur anonyme, alors que
 * `GET /repos/{o}/{r}/check-runs/{id}/annotations` répond 200 et rend le texte — vérifié sur le
 * run 75. Une commande de workflow `::notice title=…::` écrite sur la sortie standard devient une
 * annotation : le diagnostic remonte donc sans qu'un humain ait à télécharger quoi que ce soit.
 *
 * Ne remplace pas l'artefact, qui garde le journal entier. Ce condensé ne porte que les champs qui
 * départagent les chemins du §2 de `docs/DIAGNOSTIC-GESTE-GABARITS.md`.
 *
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {Array<any>} browserJournal
 */
function publierAnnotation(testInfo, browserJournal) {
  if (!process.env.CI) return;

  const journal = Array.isArray(browserJournal) ? browserJournal : [];
  const down = journal.find((e) => e.source === 'board-bubble' && e.type === 'pointerdown');
  const predicats = journal
    .filter((e) => e.source === 'predicat' && e.type === 'canStartTokenDrag')
    .map((e) => ({
      resultat: e.resultat,
      outilActif: e.outilActif,
      gabaritArme: e.gabaritArme,
      mapPos: e.mapPos,
      camera: e.camera,
      rectCanvas: e.rectCanvas,
    }));

  /** @type {Record<string, number>} */
  const intentions = {};
  for (const e of journal.filter((x) => x.source === 'intention')) {
    intentions[e.type] = (intentions[e.type] ?? 0) + 1;
  }

  const condense = {
    statut: testInfo.status,
    down: down ? { x: Math.round(down.clientX), y: Math.round(down.clientY) } : null,
    dragTokenId: down?.stateAfter?.dragTokenId ?? '(absent)',
    predicats,
    intentions,
    speciaux: journal
      .filter((e) => ['blur', 'focus', 'visibilitychange', 'pointercancel'].includes(e.type))
      .map((e) => e.type),
  };

  // Un titre court et stable par scénario : c'est lui qui nomme la ligne dans l'API.
  const outil = /gabarits/.test(testInfo.title)
    ? 'gabarits'
    : /murs/.test(testInfo.title)
      ? 'murs'
      : 'fog';
  const niveau = testInfo.status === 'passed' ? 'notice' : 'error';

  // Les commandes de workflow s'échappent, et le message doit tenir sur une seule ligne.
  const message = JSON.stringify(condense)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');

  process.stdout.write(`::${niveau} title=geste-${outil}::${message}\n`);
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

      // 5. Enveloppement des deux predicats injectes par la vue MJ.
      //
      // C'est le niveau que le premier journal a rendu necessaire : au run 75, le `pointerdown`
      // du scenario des gabarits arrivait bien sur le canvas mais `dragTokenId` valait `null`,
      // aux memes coordonnees (262,162) ou les scenarios du fog et des murs rendaient bien
      // l'identifiant du pion. `canStartTokenDrag` a donc pris une branche de sortie, et le
      // journal doit dire laquelle : outil encore arme, etage absent, ou case sans pion.
      const origCanDrag = pi.canStartTokenDrag;
      pi.canStartTokenDrag = (/** @type {any} */ screenPos, /** @type {any} */ mapPos) => {
        const resultat = origCanDrag(screenPos, mapPos);
        const app = w.__RPG_APP__;
        record({
          source: 'predicat',
          type: 'canStartTokenDrag',
          screenPos,
          mapPos,
          resultat,
          outilActif: app?.gmPanel?.getActiveToolName?.() ?? '(absent)',
          gabaritArme: app?.gmPanel?.templateTools?.isArmed?.() ?? '(absent)',
          camera: app?.camera
            ? { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom }
            : null,
          rectCanvas: (() => {
            const r = board.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
          })(),
        });
        return resultat;
      };

      const origCanBrush = pi.canStartBrush;
      pi.canStartBrush = (/** @type {any} */ screenPos, /** @type {any} */ mapPos) => {
        const resultat = origCanBrush(screenPos, mapPos);
        record({ source: 'predicat', type: 'canStartBrush', resultat });
        return resultat;
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

    publierAnnotation(testInfo, browserJournal);
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
   * ⚠ **`camera.mapToScreen` rend des coordonnées relatives au canvas ; `page.mouse` en attend du
   * viewport.** Les deux ne coïncident que si le canvas commence en `(0, 0)`, et c'est ce qui a
   * fait rougir la CI des runs 69 à 75.
   *
   * Le panneau des gabarits déborde horizontalement sur le runner — pas sur Windows, les métriques
   * de police diffèrent. Cliquer `#tpl-toggle-arm` le fait alors défiler dans la vue, le document
   * part de 66 px vers la droite, et `#board` se retrouve à `left: -66`. Mesuré par annotation sur
   * le run du commit 3189387 : `rectCanvas.left` valait `-66` pour les gabarits et `0` pour les
   * deux autres scénarios, à caméra et point de pression identiques.
   *
   * Le test pressait donc 66 px à côté : `screenToMap` rendait `x = 886,67` au lieu de `630`, la
   * case visée n'avait pas de pion, `canStartTokenDrag` rendait `null`, et `handlePointerMove`
   * partait en pan — cinq `panBy`, aucun `dragToken`, pion immobile, état par ailleurs normal.
   *
   * **L'application n'y est pour rien** : `getScreenPoint` fait `clientX - rect.left`, ce qui reste
   * juste quel que soit le défilement. C'était un défaut du test, et lui seul.
   *
   * On convertit donc explicitement, et on **vérifie la conversion** juste avant de presser : sans
   * cette garde, un point qui tombe à côté redevient un échec muet, et c'est ce silence qui a coûté
   * quatre tours de diagnostic.
   *
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
        const board = document.querySelector('#board');
        if (!board) throw new Error('Canvas #board absent');
        const grid = gridFor(activeLevel);
        const rect = board.getBoundingClientRect();

        /** Case que l'application trouvera sous un point de viewport, par son propre calcul. */
        const cellUnderViewport = (/** @type {{x: number, y: number}} */ pt) =>
          grid.cellFromPoint(
            app.camera.screenToMap({ screenX: pt.x - rect.left, screenY: pt.y - rect.top })
          );

        /** Coordonnées de viewport du centre d'une case. */
        const viewportOf = (/** @type {{a: number, b: number}} */ c) => {
          const p = app.camera.mapToScreen(grid.pointFromCell(c));
          return { x: rect.left + p.screenX, y: rect.top + p.screenY };
        };

        const start = viewportOf(from);
        const end = viewportOf(to);
        return {
          start,
          end,
          rectLeft: rect.left,
          rectTop: rect.top,
          // Le contrôle de la conversion, fait par le calcul même de l'application.
          caseSousLeDepart: cellUnderViewport(start),
        };
      },
      { from: fromCell, to: toCell }
    );

    // La précondition est exprimée, pas supposée : si le point de pression ne tombe pas sur la case
    // de départ, l'échec nomme le décalage au lieu de se déguiser en « le pion n'a pas bougé ».
    expect(
      coords.caseSousLeDepart,
      `le point de pression ne tombe pas sur la case de depart. ` +
        `Canvas a (${coords.rectLeft}, ${coords.rectTop}), point de viewport ` +
        `(${Math.round(coords.start.x)}, ${Math.round(coords.start.y)}).`
    ).toEqual(fromCell);

    await page.mouse.move(coords.start.x, coords.start.y);
    await page.mouse.down();
    // Depuis le correctif applicatif de l'appui long (docs/CORRECTIF-APPUI-LONG.md),
    // l'appui long est un geste achevé émis au `pointerup` et annulé par tout mouvement.
    // Une attente entre `down` et `move` n'abandonne donc plus le glisser : le déplacement
    // annule la candidature d'appui long et la saisie de pion s'exécute normalement.
    //
    // Pour refaire la preuve par mutation (§4.5 de docs/CORRECTIF-APPUI-LONG.md) : insérer ici,
    // **en local et sans le commiter**, `await page.waitForTimeout(700);` — le pion doit se
    // déplacer et le journal ne doit contenir AUCUNE intention `longPress`. Le geste nominal, lui,
    // reste sans attente : elle n'apporte rien et rallonge trois tests.
    await page.mouse.move(coords.end.x, coords.end.y, { steps: 5 });
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
            // ⚠ Aller-retour depuis la case du pion, et **rien de plus**. Ce champ ne dit pas que
            // le point réellement pressé tombe sur le pion : il n'a jamais vu ce point. Lu comme
            // une preuve du contraire, il a orienté quatre diagnostics vers l'après-`pointerdown`
            // alors que le défaut était le décalage du canvas. La vraie garde est l'assertion de
            // `dragToken`, qui part du point de viewport.
            caseAllerRetour: centre && grid ? grid.cellFromPoint(centre) : null,
            // Le champ qui manquait : c'est lui qui portait la cause.
            rectCanvas: (() => {
              const r = document.querySelector('#board')?.getBoundingClientRect();
              return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
            })(),
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
