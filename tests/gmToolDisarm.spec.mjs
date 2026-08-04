// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('CORRECTIF — Désarmement des outils MJ & Indicateur d\'outil actif', () => {
  test.beforeEach(async ({ page }) => {
    const sessionId = `test-disarm-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
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
  });

  /**
   * Le scénario du mainteneur, un test par outil.
   *
   * ⚠ **Trois tests et non un seul à trois étapes, et c'est le CI qui l'a imposé.** La première
   * version enchaînait les trois outils dans un même test, en déplaçant le pion de deux cases à
   * chaque fois. Verte en local, y compris six fois de suite et avec `CI=1` ; rouge en CI, run 69
   * du 04/08, **sur la troisième étape seulement**. La trace le dit sans ambiguïté : avant le
   * troisième glisser `getActiveToolName()` valait bien `'none'`, les coordonnées calculées
   * tombaient bien sur le pion, aucune erreur n'était journalisée — et le pion ne bougeait pas,
   * alors que les deux glissers précédents avaient réussi dans les mêmes conditions.
   *
   * La seule variable qui distinguait la troisième étape des deux premières était **l'état
   * accumulé** par les glissers antérieurs, et aucune machine ici n'a pu la reproduire. Un test
   * par outil, chacun sur une page neuve avec le pion à sa case de départ, supprime cette
   * variable au lieu de la contourner par une attente devinée.
   *
   * Bénéfice secondaire, qui aurait suffi à le justifier : un échec nomme désormais l'outil
   * fautif au lieu d'une étape anonyme.
   *
   * @param {import('@playwright/test').Page} page
   */
  const getTokenCell = async (page) => {
    return await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const token = store.getState().campaign?.tokens[0];
      if (!token) throw new Error('Aucun pion trouvé dans la campagne');
      return { a: token.cell.a, b: token.cell.b };
    });
  };

  /**
     * Attend que la caméra soit réellement ajustée à l'étage chargé par `beforeEach`.
     *
     * Sans cela le test est une course, et elle a fait rougir le CI le 04/08 (run 69) alors
     * qu'il passait six fois de suite en local : `fitActiveLevel` vit dans la boucle de rendu,
     * qui est **à la demande** (CdC §9). Tant que la frame n'a pas eu lieu, la caméra est restée
     * sur son état par défaut, `mapToScreen` rend un point hors du canvas, le `mouse.down`
     * manque le pion, le glisser devient un pan — et le pion ne bouge pas.
     *
     * La précondition est donc **exprimée** et non temporisée : aucune attente fixe ne garantit
     * une frame sur une machine plus lente que celle qui écrit le test.
     *
     * @param {import('@playwright/test').Page} page
     * @param {{ a: number, b: number }} cell case dont le centre doit être cliquable
     */
  const waitForCameraOn = async (page, cell) => {
      await page.waitForFunction(
        async (/** @type {{a: number, b: number}} */ c) => {
          const { gridFor } = await import('../js/grid/index.js');
          const store = await import('../js/state/store.js');
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
      const coords = await page.evaluate(async ({ from, to }) => {
        const { gridFor } = await import('../js/grid/index.js');
        const store = await import('../js/state/store.js');
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
      }, { from: fromCell, to: toCell });

      await page.mouse.move(coords.start.screenX, coords.start.screenY);
      await page.mouse.down();
      // ⚠ AUCUNE attente entre le `down` et le `move`, et c'est délibéré.
      //
      // La version d'origine attendait 220 ms « parce que DRAG_HOLD_MS vaut 150 ». C'était une
      // méprise sur le seuil : `isDragThresholdExceeded` rend
      // `dist >= distanceThreshold || duration >= dragHoldMs` — un **OU**. Un déplacement de
      // 72 px franchit déjà le seuil de 5 px, la durée n'a rien à démontrer.
      //
      // Et l'attente était nuisible : `pointer.js` arme un minuteur d'appui long à 500 ms au
      // `pointerdown`. En CI, `down()`, l'attente et `move()` sont trois allers-retours CDP
      // distincts ; sur un runner chargé leur total franchit les 500 ms, le minuteur bascule
      // `mode` sur `'longPress'`, et `handlePointerMove` sort alors immédiatement — le glisser
      // est abandonné **en silence**, sans erreur, pion immobile. C'est le défaut qui a fait
      // rougir le CI aux runs 69 à 72, avec un état par ailleurs parfaitement normal.
      //
      // Sans attente, le premier pas intermédiaire (~14 px) annule le minuteur bien avant.
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

      // Le mécanisme : l'outil est bien désarmé. Conservé à côté de l'issue parce qu'il dit
      // POURQUOI quand l'issue échoue.
      const outilApres = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.__RPG_APP__?.gmPanel?.getActiveToolName();
      });
      expect(outilApres).toBe('none');

      // L'issue, et c'est elle que le mainteneur a signalée : le pion se saisit.
      //
      // L'état complet est capturé AVANT le glisser et joint au message d'assertion. Ce n'est
      // pas du zèle : le CI a rougi deux fois ici sans que rien dise pourquoi, et deux tours
      // de diagnostic ont été perdus faute d'avoir cette information dans le rapport. Un
      // message d'échec qui porte l'état est une fonctionnalité, pas une sonde jetable.
      const etatAvant = await page.evaluate(async (cible) => {
        const w = /** @type {any} */ (window);
        const store = await import('../js/state/store.js');
        const { gridFor } = await import('../js/grid/index.js');
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
          // La case que le hit-test trouvera sous le point de pression.
          caseSousLePoint: centre && grid ? grid.cellFromPoint(centre) : null,
          cible,
        };
      }, { a: depart.a + 2, b: depart.b + 2 });

      await dragToken(page, depart, { a: depart.a + 2, b: depart.b + 2 });

      const arrivee = await getTokenCell(page);
      expect(
        arrivee,
        `le pion devait se saisir apres avoir arme « ${outil.nom} ». ` +
          `Etat juste avant le glisser : ${JSON.stringify(etatAvant)}`
      ).not.toEqual(depart);
    });
  }

  test('2. Touche Échap (Escape) désarme l\'outil actif et rend la saisie de pion', async ({ page }) => {
    // Armer le pinceau de fog
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');

    const activeBeforeEsc = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.getActiveToolName();
    });
    expect(activeBeforeEsc).toBe('fog-reveal');

    // Presser la touche Échap
    await page.keyboard.press('Escape');

    const activeAfterEsc = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.getActiveToolName();
    });
    expect(activeAfterEsc).toBe('none');
  });

  test('3. Exclusion mutuelle des 3 paires d\'outils', async ({ page }) => {
    // Armer Fog
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    let tool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('fog-reveal');

    // Armer Murs via programmatic call (ou via onglet)
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__RPG_APP__?.gmPanel?.setActiveTool('wall-draw');
    });
    tool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('wall-draw');

    // Armer Gabarits
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__RPG_APP__?.gmPanel?.setActiveTool('template-place');
    });
    tool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('template-place');
  });

  test('4. La marque .gm-tab-active-tool apparaît sur l\'onglet de l\'outil armé et disparaît au désarmement', async ({ page }) => {
    // Armer Fog
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');

    const hasMarkArmed = await page.evaluate(() => {
      const btn = document.querySelector('button[data-tab="fog-tools"]');
      return btn ? btn.classList.contains('gm-tab-active-tool') : false;
    });
    expect(hasMarkArmed).toBe(true);

    // Changer d'onglet vers Pions (ce qui désarme l'outil)
    await page.click('button[data-tab="token-maker"]');

    const hasMarkDisarmed = await page.evaluate(() => {
      const btn = document.querySelector('button[data-tab="fog-tools"]');
      return btn ? btn.classList.contains('gm-tab-active-tool') : false;
    });
    expect(hasMarkDisarmed).toBe(false);
  });

  test('5. Abandon du tracé de mur au changement d\'onglet', async ({ page }) => {
    // Initialiser le nombre de murs
    const initialWallCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const lvl = store.getActiveLevel();
      return lvl?.walls?.length ?? 0;
    });

    // Aller sur l'onglet Murs et armer
    await page.click('button[data-tab="wall-editor"]');
    await page.click('#wall-btn-arm');

    // Cliquer sur le canvas pour ajouter un premier sommet
    const board = page.locator('#board');
    const box = await board.boundingBox();
    if (!box) throw new Error('canvas boundingBox est null');
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);

    // Changer d'onglet vers Handouts
    await page.click('button[data-tab="handouts"]');

    // Vérifier qu'aucun mur n'a été créé
    const finalWallCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const lvl = store.getActiveLevel();
      return lvl?.walls?.length ?? 0;
    });

    expect(finalWallCount).toBe(initialWallCount);
  });

  test('6. Recliquer le bouton d\'outil actif le désarme (Critère 7 & Amendement A4)', async ({ page }) => {
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');

    let activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('fog-reveal');

    // Recliquer Révéler
    await page.click('#fog-btn-tool-reveal');

    activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('none');
  });
});
