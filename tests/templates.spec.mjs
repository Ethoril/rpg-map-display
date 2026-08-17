// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('Tranche L-10 — Gabarits libres (E2E)', () => {
  test('1. Panneau MJ : Onglet "📐 Gabarits" présent, cône disponible et armement interactif', async ({ page }) => {
    const sessionId = `test-template-e2e-1-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    // Clic sur l'onglet Gabarits
    const tabButton = page.locator('button[data-tab="template-tools"]');
    await expect(tabButton).toBeVisible();
    await tabButton.click();

    const pane = page.locator('#tab-content-template-tools');
    await expect(pane).toBeVisible();

    // Vérifier l'option cône
    const selectShape = page.locator('#tpl-shape');
    await expect(selectShape).toBeVisible();
    await selectShape.selectOption('cone');

    const armBtn = page.locator('#tpl-toggle-arm');
    await expect(armBtn).toBeVisible();
    await expect(armBtn).toHaveText(/Poser un gabarit/i);

    // Activer l'outil
    await armBtn.click();
    await expect(armBtn).toHaveText(/ARMÉ/i);

    const isArmed = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.templateTools?.isArmed() ?? false;
    });
    expect(isArmed).toBe(true);
  });

  test('2. Exclusivité mutuelle : Armer les gabarits désarme le fog et l\'éditeur de murs', async ({ page }) => {
    const sessionId = `test-template-e2e-2-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);

      const level = schema.createLevel({
        id: 'level-1',
        name: 'Étage Test',
        widthCells: 10,
        heightCells: 10,
      });

      const campaign = schema.createCampaign({ levels: [level] });
      store.loadCampaign(campaign);
    });

    // Armer l'éditeur de murs
    await page.click('#gm-mode-prep');
    await page.click('button[data-tab="wall-editor"]');
    await page.click('#wall-btn-arm');

    let wallArmed = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.wallEditor?.isArmed() ?? false;
    });
    expect(wallArmed).toBe(true);

    // Basculer sur le mode Jouer, puis sur Gabarits et armer les gabarits
    await page.click('#gm-mode-play');
    await page.click('button[data-tab="template-tools"]');
    await page.click('#tpl-toggle-arm');

    const templateArmed = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.templateTools?.isArmed() ?? false;
    });
    expect(templateArmed).toBe(true);

    // Vérifier que l'éditeur de murs a été désarmé
    wallArmed = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.wallEditor?.isArmed() ?? false;
    });
    expect(wallArmed).toBe(false);
  });

  test('3. Pose, déplacement et pivot de cône (origin MapPoint et pointe-ancre)', async ({ page }) => {
    const sessionId = `test-template-e2e-3-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);

      const level = schema.createLevel({
        id: 'level-1',
        name: 'Étage Test',
        widthCells: 10,
        heightCells: 10,
        pxPerCell: 140,
      });

      const campaign = schema.createCampaign({ levels: [level] });
      store.loadCampaign(campaign);
    });

    await page.click('button[data-tab="template-tools"]');
    await page.selectOption('#tpl-shape', 'cone');
    await page.click('#tpl-toggle-arm');

    // Pose par tap à la position {x: 250, y: 250}
    await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      if (w.__RPG_APP__?.pointerInput) {
        w.__RPG_APP__.pointerInput.onIntention({
          type: 'tap',
          mapPos: { x: 250, y: 250 },
          screenPos: { x: 250, y: 250 },
        });
      }
    });

    // Vérifier la présence du gabarit et son origine MapPoint
    const tplState = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const templates = store.getState().campaign?.templates || [];
      if (templates.length === 0) return null;
      return { origin: templates[0].origin, directionDeg: templates[0].directionDeg, shape: templates[0].shape };
    });
    expect(tplState).not.toBeNull();
    expect(tplState?.shape).toBe('cone');
    expect(tplState?.origin).toEqual({ x: 250, y: 250 });

    // Pivot du cône autour de sa pointe (origin ne doit pas bouger)
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const t = store.getState().campaign?.templates[0];
      if (t) store.moveTemplate(t.id, t.origin, 90);
    });

    const tplAfterRotate = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const t = store.getState().campaign?.templates[0];
      return { origin: t?.origin, directionDeg: t?.directionDeg };
    });
    expect(tplAfterRotate.origin).toEqual({ x: 250, y: 250 });
    expect(tplAfterRotate.directionDeg).toBe(90);

    // Effacement des gabarits de l'étage
    await page.click('#tpl-clear-level');

    const templatesAfterClear = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().campaign?.templates.length ?? 0;
    });
    expect(templatesAfterClear).toBe(0);
  });

  /**
   * Réglages du panneau des gabarits — la moitié du composant que rien ne touchait.
   *
   * `#tpl-shape`, `#tpl-toggle-arm` et `#tpl-clear-level` sont couverts par les scénarios 1 à 3,
   * et le geste réel d'armement par `tests/manuel/gmToolDisarmGeste.spec.mjs`. Mais **aucun test
   * ne touchait `#tpl-radius`, `.tpl-rad-preset`, `#tpl-color` ni `#tpl-visible`** : le rayon, la
   * couleur et la visibilité joueurs pouvaient cesser d'atteindre le gabarit posé sans qu'une
   * seule assertion bouge.
   *
   * ⭐ Le dernier est un risque de fuite, pas un confort : la vue joueurs filtre bien sur
   * `visibleToPlayers` (couvert par `templates.test.mjs` et `templateHit.test.mjs`), mais ce qui
   * n'était pas couvert est que **décocher la case produise réellement `false`**. Un filtre
   * correct alimenté par un drapeau toujours vrai montre tout aux joueurs.
   */
  test('5. Rayon, couleur et visibilité joueurs atteignent le gabarit posé', async ({ page }) => {
    const sessionId = `test-template-e2e-5-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);
      const level = schema.createLevel({
        id: 'level-1', name: 'Étage Test', widthCells: 10, heightCells: 10, pxPerCell: 140,
      });
      store.loadCampaign(schema.createCampaign({ levels: [level] }));
    });

    await page.click('button[data-tab="template-tools"]');

    // Les trois réglages jamais éprouvés, chacun par son vrai contrôle.
    await page.fill('#tpl-radius', '7');
    await page.click('.tpl-color-preset[data-color="#10b981"]');
    await page.uncheck('#tpl-visible');

    await page.click('#tpl-toggle-arm');
    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 250, y: 250 },
        screenPos: { x: 250, y: 250 },
      });
    });

    const pose = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const t = store.getState().campaign?.templates?.[0];
      return t ? { radiusCells: t.radiusCells, color: t.color, visibleToPlayers: t.visibleToPlayers } : null;
    });

    expect(pose, 'aucun gabarit posé : le reste du test ne prouverait rien').not.toBeNull();
    expect(pose?.radiusCells, 'le rayon saisi n’atteint pas le gabarit').toBe(7);
    expect(pose?.color, 'la pastille de couleur n’atteint pas le gabarit').toBe('#10b981');
    expect(
      pose?.visibleToPlayers,
      'la case décochée n’atteint pas le gabarit : il serait montré aux joueurs'
    ).toBe(false);
  });

  test('6. Pastilles de rayon et bornage de la saisie', async ({ page }) => {
    const sessionId = `test-template-e2e-6-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await page.click('button[data-tab="template-tools"]');

    const config = () =>
      page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.templateTools.getConfig());

    // Une pastille doit écraser la saisie ET réécrire le champ, sinon l'affichage mentirait
    // sur ce qui sera posé.
    await page.fill('#tpl-radius', '3');
    await page.click('.tpl-rad-preset[data-rad="6"]');
    expect((await config()).radiusCells).toBe(6);
    expect(await page.inputValue('#tpl-radius')).toBe('6');

    // Saisie invalide : le composant retombe sur 1 plutôt que de propager NaN, qui ferait
    // échouer la validation du schéma à l'enregistrement de la campagne.
    //
    // ⛔ Pas de cas « abc » ici, et ce n'est pas un oubli : un `input[type=number]` ne peut pas
    // porter de texte non numérique — le navigateur l'assainit en chaîne vide, que Playwright
    // refuse d'ailleurs d'écrire. Le cas réellement atteignable est donc la chaîne vide, et
    // c'est elle que le `|| 1` du composant rattrape.
    for (const brut of ['0', '-4', '']) {
      await page.fill('#tpl-radius', brut);
      await page.dispatchEvent('#tpl-radius', 'change');
      expect((await config()).radiusCells, `saisie « ${brut} »`).toBe(1);
    }

    // Le champ déclare max="20" et le composant borne la saisie à 20 (G-02c).
    expect(await page.getAttribute('#tpl-radius', 'max')).toBe('20');
    await page.fill('#tpl-radius', '20');
    await page.dispatchEvent('#tpl-radius', 'change');
    expect((await config()).radiusCells).toBe(20);
    await page.fill('#tpl-radius', '999');
    await page.dispatchEvent('#tpl-radius', 'change');
    expect((await config()).radiusCells).toBe(20);
  });

  /**
   * UX-05 — le retrait d'un gabarit, par le doigt et par la liste.
   *
   * Le seul retrait possible était « Effacer les gabarits de l'étage » : retirer le cône d'un
   * sort résolu effaçait aussi la zone de ténèbres posée deux tours plus tôt.
   *
   * ⚠ **Deux gabarits dans chaque scénario, jamais un seul.** Un test à un gabarit ne peut pas
   * distinguer « retire le désigné » de « retire le premier du tableau », et c'est précisément la
   * faute que le brief demande de rendre impossible.
   */
  const NIVEAU_UX05 = {
    id: 'lvl-ux05',
    name: 'Étage UX-05',
    order: 0,
    imageUrl: 'maps/minimal.webp',
    videoUrl: null,
    animatedOverlays: [],
    pxPerCell: 140,
    widthCells: 12,
    heightCells: 8,
    grid: { type: /** @type {const} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: false },
    terrainCost: null,
    walls: [],
    portals: [],
    lights: [],
    ambient: { level: 1, baked: false },
  };

  /**
   * @param {string} id
   * @param {{x: number, y: number}} origin
   * @param {string} color
   */
  const gabaritUX05 = (id, origin, color) => ({
    id,
    levelId: 'lvl-ux05',
    shape: /** @type {const} */ ('circle'),
    origin,
    radiusCells: 1, // 140 px : les deux gabarits ne se recouvrent pas
    directionDeg: 0,
    widthCells: 1,
    color,
    visibleToPlayers: true,
  });

  /** @param {any[]} templates @param {any[]} [portals] */
  const snapshotUX05 = (templates, portals = []) => ({
    campaign: {
      schemaVersion: 2,
      campaignId: 'cmp-ux05',
      name: 'Campagne UX-05',
      levels: [{ ...NIVEAU_UX05, portals }],
      links: [],
      tokens: [],
      templates,
      settings: {},
    },
    activeLevelId: 'lvl-ux05',
    selectedTokenId: null,
  });

  /** @param {import('@playwright/test').Page} page */
  const idsDesGabarits = (page) =>
    page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return (store.getState().campaign?.templates ?? []).map((t) => t.id);
    });

  test('7. Critères 1 et 3 : l\'appui long retire le gabarit désigné, lui seul, et le retrait atteint les joueurs', async ({ context }) => {
    const sessionId = `test-template-ux05-longpress-${Date.now()}`;
    const snapshot = snapshotUX05([
      gabaritUX05('tpl-garde', { x: 210, y: 350 }, '#3b82f6'),
      gabaritUX05('tpl-cible', { x: 1050, y: 350 }, '#ef4444'),
    ]);

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    const pagePlayer = await context.newPage();
    await installBrowserTransport(pagePlayer, sessionId, snapshot);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pagePlayer);

    expect(await idsDesGabarits(pagePlayer)).toEqual(['tpl-garde', 'tpl-cible']);

    // Appui long sur l'origine de `tpl-cible`, qui n'est PAS le premier du tableau.
    await pageGM.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'longPress',
        mapPos: { x: 1050, y: 350 },
        screenPos: { x: 400, y: 300 },
      });
    });

    expect(
      await idsDesGabarits(pageGM),
      'le MJ doit avoir perdu le gabarit désigné, et lui seul'
    ).toEqual(['tpl-garde']);

    // ⭐ Le critère 3 se lit chez les joueurs, pas sur l'écran du MJ : un retrait local qui ne
    // publierait rien laisserait la table avec un cône fantôme sous les yeux.
    await expect.poll(() => idsDesGabarits(pagePlayer)).toEqual(['tpl-garde']);

    const publies = await pageGM.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published
        .filter((/** @type {any} */ e) => e.type === 'template.remove')
        .map((/** @type {any} */ e) => e.payload)
    );
    expect(publies, 'un seul retrait publié, portant l\'identifiant désigné').toEqual([
      { templateId: 'tpl-cible' },
    ]);

    // Rejeu du même événement chez les joueurs : sans effet, et sans emporter le réducteur.
    const rejeu = await pagePlayer.evaluate(async () => {
      const net = await import('../js/app/networkEvents.js');
      const store = await import('../js/state/store.js');
      const mute = net.applyNetworkEvent({
        type: 'template.remove',
        payload: { templateId: 'tpl-cible' },
        at: Date.now(),
        by: 'gm',
      });
      return { mute, ids: (store.getState().campaign?.templates ?? []).map((t) => t.id) };
    });
    expect(rejeu.mute, 'un rejeu ne doit pas se déclarer mutant').toBe(false);
    expect(rejeu.ids).toEqual(['tpl-garde']);
  });

  test('8. Critère 2 : le bouton de la liste retire le même gabarit, et la liste suit le store', async ({ page }) => {
    const sessionId = `test-template-ux05-liste-${Date.now()}`;
    await installBrowserTransport(
      page,
      sessionId,
      snapshotUX05([
        gabaritUX05('tpl-garde', { x: 210, y: 350 }, '#3b82f6'),
        gabaritUX05('tpl-cible', { x: 1050, y: 350 }, '#ef4444'),
      ])
    );
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.click('button[data-tab="template-tools"]');
    await expect(page.locator('#tpl-list .tpl-row')).toHaveCount(2);

    await page.click('.tpl-remove[data-template-id="tpl-cible"]');

    expect(await idsDesGabarits(page)).toEqual(['tpl-garde']);
    // La liste se rafraîchit sur la mutation du store, sans qu'on rouvre l'onglet.
    await expect(page.locator('#tpl-list .tpl-row')).toHaveCount(1);
    await expect(page.locator('#tpl-list .tpl-row')).toHaveAttribute('data-template-id', 'tpl-garde');

    const publies = await page.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published
        .filter((/** @type {any} */ e) => e.type === 'template.remove')
        .map((/** @type {any} */ e) => e.payload)
    );
    expect(publies).toEqual([{ templateId: 'tpl-cible' }]);
  });

  test('9. Critère 4 : un gabarit posé sur une porte — l\'appui long verrouille la porte, pas le gabarit', async ({ page }) => {
    const sessionId = `test-template-ux05-porte-${Date.now()}`;
    // La porte occupe l'arête verticale de la case (3, 2) à (3, 3) : son milieu carte est
    // {x: 420, y: 350}. Le gabarit y est posé par-dessus, exactement là où le doigt tombera.
    const porte = {
      id: 'porte-ux05',
      a: { cellX: 3, cellY: 2 },
      b: { cellX: 3, cellY: 3 },
      state: /** @type {const} */ ('closed'),
      freestanding: false,
    };
    await installBrowserTransport(
      page,
      sessionId,
      snapshotUX05([gabaritUX05('tpl-sur-la-porte', { x: 420, y: 350 }, '#ef4444')], [porte])
    );
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'longPress',
        mapPos: { x: 420, y: 350 },
        screenPos: { x: 400, y: 300 },
      });
    });

    const etat = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const campaign = store.getState().campaign;
      return {
        porte: campaign?.levels[0].portals[0].state,
        gabarits: (campaign?.templates ?? []).map((t) => t.id),
      };
    });

    expect(etat.porte, 'la porte doit gagner l\'arbitrage de l\'appui long').toBe('locked');
    expect(etat.gabarits, 'le gabarit sous la porte ne doit pas avoir été retiré').toEqual([
      'tpl-sur-la-porte',
    ]);
  });

  /**
   * UX-06 — la forme « ligne ».
   *
   * ⭐ La seule fonctionnalité neuve du lot, et la seule qui touche au schéma : `widthCells`
   * traverse `core/schema.js`, `core/types.js`, l'événement `template.place` et la persistance.
   */
  const NIVEAU_LIGNE = {
    ...NIVEAU_UX05,
    id: 'lvl-ligne',
    name: 'Étage Ligne',
    // Mur vertical entre les colonnes 3 et 4, de y = 0 à y = 6 cases — le mur du scénario 4.
    walls: [[{ cellX: 3, cellY: 0 }, { cellX: 3, cellY: 6 }]],
  };

  /** @param {any[]} templates @param {any[]} [tokens] @param {any[]} [walls] */
  const snapshotLigne = (templates, tokens = [], walls = NIVEAU_LIGNE.walls) => ({
    campaign: {
      schemaVersion: 2,
      campaignId: 'cmp-ligne',
      name: 'Campagne Ligne',
      levels: [{ ...NIVEAU_LIGNE, walls }],
      links: [],
      tokens,
      templates,
      settings: {},
    },
    activeLevelId: 'lvl-ligne',
    selectedTokenId: null,
  });

  /**
   * Lève le brouillard, fixe la caméra, et rend une frame. Protocole du scénario 4, extrait
   * pour que les sondes de la ligne le partagent mot pour mot.
   *
   * @param {import('@playwright/test').Page} page
   */
  async function preparerSonde(page) {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.click('.gm-tab-btn[data-tab="fog-tools"]');
    await page.click('#fog-btn-reveal-all');
    await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \((?!0\))\d+\)/);
    await page.evaluate(async () => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      await new Promise((resolve) => {
        const premier = () => {
          app.frameLoop.removeListener(premier);
          app.camera.setPan(3 * 140, 3 * 140);
          app.camera.setZoom(1);
          const second = () => {
            app.frameLoop.removeListener(second);
            resolve(null);
          };
          app.frameLoop.addListener(second);
          app.frameLoop.requestFrame();
        };
        app.frameLoop.addListener(premier);
        app.frameLoop.requestFrame();
      });
    });
  }

  /**
   * Dominance rouge (R − (G+B)/2) moyennée sur 10 × 10 px écran autour de chaque MapPoint,
   * après une frame fraîche. Rend aussi la vérification que les points sont bien dans le canvas :
   * une sonde hors cadre mesurerait du vide et se tairait.
   *
   * @param {import('@playwright/test').Page} page
   * @param {{x: number, y: number}[]} points
   * @returns {Promise<{dansLeCanvas: boolean, dominances: number[]}>}
   */
  function mesurerRouge(page, points) {
    return page.evaluate(async (pts) => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      await new Promise((resolve) => {
        const l = () => {
          app.frameLoop.removeListener(l);
          resolve(null);
        };
        app.frameLoop.addListener(l);
        app.frameLoop.requestFrame();
      });

      const res = app.stage?.resolution ?? 1;
      const marge = 30;
      /** @param {{x: number, y: number}} pt */
      const dansLeCanvas = (pt) => {
        const p = app.camera.mapToScreen(pt);
        return (
          p.screenX > marge &&
          p.screenY > marge &&
          p.screenX < app.canvas.width / res - marge &&
          p.screenY < app.canvas.height / res - marge
        );
      };
      /** @param {{x: number, y: number}} pt */
      const dominance = (pt) => {
        const p = app.camera.mapToScreen(pt);
        const d = app.context.getImageData(
          Math.round((p.screenX - 5) * res),
          Math.round((p.screenY - 5) * res),
          Math.round(10 * res),
          Math.round(10 * res)
        ).data;
        let somme = 0;
        for (let i = 0; i < d.length; i += 4) somme += d[i] - (d[i + 1] + d[i + 2]) / 2;
        return somme / (d.length / 4);
      };

      return {
        dansLeCanvas: pts.every(dansLeCanvas),
        dominances: pts.map(dominance),
      };
    }, points);
  }

  test('10. Critères 1 et 3 : la ligne n\'est plus grisée, se pose avec sa largeur, se déplace et pivote', async ({ page }) => {
    const sessionId = `test-template-ux06-pose-${Date.now()}`;
    await installBrowserTransport(page, sessionId, snapshotLigne([], [], []));
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await page.click('button[data-tab="template-tools"]');

    // L'option était grisée depuis le lot 2 : « Ligne (bientôt) ».
    await expect(page.locator('#tpl-shape option[value="line"]')).not.toBeDisabled();

    // La largeur ne concerne que la ligne, et ne s'affiche que pour elle.
    await expect(page.locator('#tpl-width-row')).toBeHidden();
    await page.selectOption('#tpl-shape', 'line');
    await expect(page.locator('#tpl-width-row')).toBeVisible();

    await page.fill('#tpl-radius', '4');
    await page.dispatchEvent('#tpl-radius', 'change');
    await page.click('.tpl-width-preset[data-width="3"]');
    await page.click('.tpl-color-preset[data-color="#f59e0b"]');
    await page.uncheck('#tpl-visible');

    await page.click('#tpl-toggle-arm');
    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 350, y: 420 },
        screenPos: { x: 300, y: 300 },
      });
    });

    const pose = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const t = store.getState().campaign?.templates?.[0];
      return t
        ? {
            shape: t.shape,
            origin: t.origin,
            radiusCells: t.radiusCells,
            widthCells: t.widthCells,
            color: t.color,
            visibleToPlayers: t.visibleToPlayers,
            directionDeg: t.directionDeg,
          }
        : null;
    });
    expect(pose, 'aucune ligne posée : le reste ne prouverait rien').not.toBeNull();
    expect(pose?.shape).toBe('line');
    expect(pose?.origin).toEqual({ x: 350, y: 420 });
    expect(pose?.radiusCells).toBe(4);
    expect(pose?.widthCells, 'la largeur saisie n\'atteint pas le gabarit').toBe(3);
    expect(pose?.color).toBe('#f59e0b');
    expect(pose?.visibleToPlayers).toBe(false);

    // ⭐ Le champ voyage bien dans `template.place`, et pas seulement dans le store local.
    const publie = await page.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published
        .filter((/** @type {any} */ e) => e.type === 'template.place')
        .map((/** @type {any} */ e) => ({
          shape: e.payload.template.shape,
          widthCells: e.payload.template.widthCells,
        }))
    );
    expect(publie).toEqual([{ shape: 'line', widthCells: 3 }]);

    // Déplacement et pivot, comme le cône.
    const apres = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const t = store.getState().campaign?.templates[0];
      if (!t) throw new Error('aucun gabarit à déplacer');
      store.moveTemplate(t.id, { x: 700, y: 700 }, 90);
      const apresMove = store.getState().campaign?.templates[0];
      return { origin: apresMove?.origin, directionDeg: apresMove?.directionDeg, widthCells: apresMove?.widthCells };
    });
    expect(apres.origin).toEqual({ x: 700, y: 700 });
    expect(apres.directionDeg).toBe(90);
    expect(apres.widthCells, 'template.move ne doit pas toucher à la largeur').toBe(3);
  });

  test('11. Critère 2 : la ligne est découpée par les murs (sonde de pixels, comme le cône)', async ({ page }) => {
    const sessionId = `test-template-ux06-occlusion-${Date.now()}`;
    // Ligne partant de {x: 350, y: 420}, vers l'Est, 3 cases de long (420 px, donc jusqu'à
    // x = 770 sans mur) et 1 case de large. Le mur est à x = 3 × 140 = 420.
    const ligne = {
      id: 'tpl-ligne-clip',
      levelId: 'lvl-ligne',
      shape: /** @type {const} */ ('line'),
      origin: { x: 2.5 * 140, y: 3 * 140 },
      radiusCells: 3,
      directionDeg: 0,
      widthCells: 1,
      color: '#ef4444',
      visibleToPlayers: true,
    };
    await installBrowserTransport(page, sessionId, snapshotLigne([ligne]));
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await preparerSonde(page);

    // Contrôle : sur l'axe, entre l'origine et le mur. Assertion : 14 px après le mur, à
    // l'abscisse 3,1 case dont le scénario 4 a établi que le fond y est clair — plus loin, le
    // fond verdit et la dominance rouge n'y distingue plus rien.
    const { dansLeCanvas, dominances } = await mesurerRouge(page, [
      { x: 2.7 * 140, y: 3 * 140 },
      { x: 3.1 * 140, y: 3 * 140 },
    ]);
    const [avantLeMur, derriereLeMur] = dominances;
    const contexte = `avant ${avantLeMur.toFixed(2)}, derrière ${derriereLeMur.toFixed(2)}`;

    expect(dansLeCanvas, `${contexte} : les échantillons sont hors du canvas`).toBe(true);
    expect(avantLeMur, `${contexte} : la ligne n'est pas peinte devant le mur`).toBeGreaterThan(40);
    expect(
      derriereLeMur,
      `${contexte} : la ligne a débordé derrière le mur (défaut de ctx.clip)`
    ).toBeLessThan(20);
  });

  test('12. Critère 3 : la largeur s\'applique au rendu, et pas seulement au schéma', async ({ page }) => {
    const sessionId = `test-template-ux06-largeur-${Date.now()}`;
    const ligne = {
      id: 'tpl-ligne-largeur',
      levelId: 'lvl-ligne',
      shape: /** @type {const} */ ('line'),
      origin: { x: 2.5 * 140, y: 3 * 140 },
      radiusCells: 3,
      directionDeg: 0,
      widthCells: 1,
      color: '#ef4444',
      visibleToPlayers: true,
    };
    // Sans mur : ce scénario mesure la largeur, pas l'occlusion.
    await installBrowserTransport(page, sessionId, snapshotLigne([ligne], [], []));
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await preparerSonde(page);

    // Sur l'axe : peint dans les deux cas — c'est le témoin que la sonde regarde bien un rendu
    // vivant. À une case sous l'axe : hors de la bande à largeur 1 (± 70 px), dedans à
    // largeur 3 (± 210 px).
    const surLAxe = { x: 2.7 * 140, y: 3 * 140 };
    const uneCaseSousLAxe = { x: 2.7 * 140, y: 4 * 140 };

    const etroite = await mesurerRouge(page, [surLAxe, uneCaseSousLAxe]);
    expect(etroite.dansLeCanvas).toBe(true);

    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const t = store.getState().campaign?.templates[0];
      if (!t) throw new Error('aucune ligne à élargir');
      store.placeTemplate({ ...t, widthCells: 3 });
    });

    const large = await mesurerRouge(page, [surLAxe, uneCaseSousLAxe]);

    const contexte =
      `axe ${etroite.dominances[0].toFixed(2)} → ${large.dominances[0].toFixed(2)}, ` +
      `hors axe ${etroite.dominances[1].toFixed(2)} → ${large.dominances[1].toFixed(2)}`;

    // ⭐ La comparaison porte sur le MÊME point avant et après l'élargissement : elle ne dépend
    // donc d'aucune hypothèse sur la couleur du fond à cet endroit, et un rendu qui ignorerait
    // `widthCells` rendrait les deux mesures identiques.
    expect(etroite.dominances[0], `${contexte} : la ligne étroite n'est pas peinte sur son axe`).toBeGreaterThan(40);
    expect(large.dominances[0], `${contexte} : la ligne large n'est plus peinte sur son axe`).toBeGreaterThan(40);
    expect(
      large.dominances[1] - etroite.dominances[1],
      `${contexte} : élargir la ligne n'a rien peint à une case de l'axe`
    ).toBeGreaterThan(25);
  });

  test('13. Critère 4 : la ligne part du centre du pion touché, et du doigt sur une case vide', async ({ page }) => {
    const sessionId = `test-template-ux06-ancrage-${Date.now()}`;
    // Pion 2 × 2 sur les cases (2,2) à (3,3) : son rectangle carte va de (280, 280) à
    // (560, 560), donc son centre est en (420, 420).
    const pion = {
      id: 'pj-ancrage',
      levelId: 'lvl-ligne',
      cell: { a: 2, b: 2 },
      sizeCells: 2,
      kind: /** @type {const} */ ('pc'),
      imageUrl: '',
      borderColor: '#000000',
      label: 'Souffleur',
      hidden: false,
      visionBright: 10,
      visionDim: 10,
      emitsLight: null,
      speedCells: 6,
      playerMovable: true,
      locked: false,
      elevation: 0,
      markers: [],
      hp: { current: 10, max: 10 },
      health: /** @type {const} */ ('unharmed'),
    };
    await installBrowserTransport(page, sessionId, snapshotLigne([], [pion], []));
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await page.click('button[data-tab="template-tools"]');
    await page.selectOption('#tpl-shape', 'line');

    /** @param {{x: number, y: number}} mapPos */
    const poserEn = async (mapPos) => {
      await page.click('#tpl-toggle-arm');
      await page.evaluate((pos) => {
        /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
          type: 'tap',
          mapPos: pos,
          screenPos: { x: 300, y: 300 },
        });
      }, mapPos);
    };

    // Tap dans le pion, mais franchement décentré : l'origine doit s'accrocher au centre.
    await poserEn({ x: 300, y: 310 });
    // Tap sur une case vide, loin du pion : l'origine reste sous le doigt.
    await poserEn({ x: 1120, y: 210 });

    const origines = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return (store.getState().campaign?.templates ?? []).map((t) => t.origin);
    });

    expect(origines.length, 'les deux poses doivent avoir produit deux gabarits').toBe(2);
    expect(origines[0], 'posée sur un pion, l\'origine doit être le centre du pion').toEqual({
      x: 420,
      y: 420,
    });
    expect(origines[1], 'posée sur une case vide, l\'origine reste sous le doigt').toEqual({
      x: 1120,
      y: 210,
    });
  });

  test('4. Rendu visuel & occlusion : découpe stricte par les murs (ctx.clip)', async ({ page }) => {
    const sessionId = `test-template-e2e-4-${Date.now()}`;
    const levelWithWall = {
      id: 'lvl-clip',
      name: 'Étage Mur',
      order: 0,
      imageUrl: 'maps/minimal.webp',
      videoUrl: null,
      animatedOverlays: [],
      pxPerCell: 140,
      widthCells: 10,
      heightCells: 8,
      grid: { type: /** @type {const} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: false },
      terrainCost: null,
      walls: [
        // Mur vertical entre la colonne 3 et 4 (de y=0 à y=6*140)
        [ { cellX: 3, cellY: 0 }, { cellX: 3, cellY: 6 } ]
      ],
      portals: [],
      lights: [],
      ambient: { level: 1, baked: false },
    };

    const templateRed = {
      id: 'tpl-red-clip',
      levelId: 'lvl-clip',
      shape: /** @type {const} */ ('circle'),
      origin: { x: 2.5 * 140, y: 3 * 140 }, // { x: 350, y: 420 }
      radiusCells: 3, // Rayon 420 px -> atteindrait x = 770 px sans mur
      directionDeg: 0,
      widthCells: 1,
      color: '#ef4444', // Rouge très marqué
      visibleToPlayers: true,
    };

    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'cmp-clip',
        name: 'Campagne Clip',
        levels: [levelWithWall],
        links: [],
        tokens: [],
        templates: [templateRed],
        settings: {},
      },
      activeLevelId: 'lvl-clip',
      selectedTokenId: null,
    };

    await installBrowserTransport(page, sessionId, snapshot);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await page.setViewportSize({ width: 900, height: 900 });

    // 1. Révéler le fog pour lever la brume (protocole portalIndicator.spec.mjs)
    await page.click('.gm-tab-btn[data-tab="fog-tools"]');
    await page.click('#fog-btn-reveal-all');
    await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \((?!0\))\d+\)/);

    // 2. Mesure d'échantillons sur le canvas avec préconditions (protocole portalIndicator.spec.mjs)
    const mesure = await page.evaluate(async () => {
      const app = /** @type {any} */ (window).__RPG_APP__;

      // Attendre que fitActiveLevel s'exécute une première fois, puis fixer la caméra pour la frame suivante
      await new Promise((resolve) => {
        const listener = () => {
          app.frameLoop.removeListener(listener);
          app.camera.setPan(3 * 140, 3 * 140);
          app.camera.setZoom(1);
          const listener2 = () => {
            app.frameLoop.removeListener(listener2);
            resolve(null);
          };
          app.frameLoop.addListener(listener2);
          app.frameLoop.requestFrame();
        };
        app.frameLoop.addListener(listener);
        app.frameLoop.requestFrame();
      });

      const res = app.stage?.resolution ?? 1;

      const marge = 30;
      /** @param {number} mapX @param {number} mapY */
      const dansLeCanvas = (mapX, mapY) => {
        const p = app.camera.mapToScreen({ x: mapX, y: mapY });
        return (
          p.screenX > marge &&
          p.screenY > marge &&
          p.screenX < app.canvas.width / res - marge &&
          p.screenY < app.canvas.height / res - marge
        );
      };

      // Contrôle de clarté du fond (le fog est levé)
      const pFond = app.camera.mapToScreen({ x: 2.5 * 140, y: 3 * 140 });
      const dFond = app.context.getImageData(
        Math.round(pFond.screenX * res),
        Math.round(pFond.screenY * res),
        Math.round(6 * res),
        Math.round(6 * res)
      ).data;
      let sommeFond = 0;
      for (let i = 0; i < dFond.length; i += 4) sommeFond += (dFond[i] + dFond[i + 1] + dFond[i + 2]) / 3;
      const clarteDuFond = sommeFond / (dFond.length / 4);

      // Mesure de la teinte rouge (R - (G+B)/2) sur une zone de 10x10 px autour d'un MapPoint
      /** @param {number} mapX @param {number} mapY */
      const mesureDominanceRouge = (mapX, mapY) => {
        const p = app.camera.mapToScreen({ x: mapX, y: mapY });
        const d = app.context.getImageData(
          Math.round((p.screenX - 5) * res),
          Math.round((p.screenY - 5) * res),
          Math.round(10 * res),
          Math.round(10 * res)
        ).data;
        let sumRedDom = 0;
        const count = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          sumRedDom += r - (g + b) / 2;
        }
        return sumRedDom / count;
      };

      /** @param {number} mapX @param {number} mapY */
      const sampleRGB = (mapX, mapY) => {
        const p = app.camera.mapToScreen({ x: mapX, y: mapY });
        const d = app.context.getImageData(
          Math.round(p.screenX * res),
          Math.round(p.screenY * res),
          1,
          1
        ).data;
        return [d[0], d[1], d[2]];
      };

      // Échantillon 1 (Contrôle) : du côté de l'origine {x: 2.1 * 140, y: 3 * 140} (dans le gabarit, sans mur)
      const pControl = { x: 2.1 * 140, y: 3 * 140 };
      // Échantillon 2 (Assertion) : derrière le mur {x: 3.1 * 140, y: 3 * 140} (14 px après le mur x = 3*140)
      // ⚠ 3,1 case et pas plus loin : à cette abscisse le fond de `minimal.webp` est CLAIR, ce qui
      // laisse la dominance rouge monter franchement. Plus loin sur cette ligne le fond devient
      // verdâtre, et une dominance `r − max(g, b)` n'y distingue plus « pas de rouge peint » de
      // « rouge peint sur du vert » — mesuré le 05/08 : 12 dans les deux cas. Déplacer cet
      // échantillon désarmerait donc le test en silence, sans rien faire rougir.
      const pBehind = { x: 3.1 * 140, y: 3 * 140 };

      return {
        zoomEffectif: app.camera.zoom,
        canvas: `${app.canvas.width}x${app.canvas.height}@${res}`,
        samplesDansLeCanvas: dansLeCanvas(pControl.x, pControl.y) && dansLeCanvas(pBehind.x, pBehind.y),
        clarteDuFond,
        redDomControl: mesureDominanceRouge(pControl.x, pControl.y),
        redDomBehind: mesureDominanceRouge(pBehind.x, pBehind.y),
      };
    });

    const contexte = `zoom ${mesure.zoomEffectif}, canvas ${mesure.canvas}, ctrl ${mesure.redDomControl.toFixed(2)}, behind ${mesure.redDomBehind.toFixed(2)}`;
    expect(mesure.samplesDansLeCanvas, `${contexte} : les échantillons sont hors du canvas`).toBe(true);
    expect(mesure.clarteDuFond, `${contexte} : le canvas est sombre, le fog n'est pas levé`).toBeGreaterThan(8);

    // Échantillon 1 (contrôle) : teinté en rouge par le gabarit (> 40)
    expect(mesure.redDomControl, `${contexte} : l'échantillon de contrôle n'est pas teinté par le gabarit`).toBeGreaterThan(40);

    // Échantillon 2 (assertion) : derrière le mur, découpé par ctx.clip() (< 20, carte seule ~12)
    expect(mesure.redDomBehind, `${contexte} : le gabarit a débordé derrière le mur (défaut de ctx.clip)`).toBeLessThan(20);
  });
});
