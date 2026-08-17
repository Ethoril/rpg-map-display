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
      ambient: { color: '#ffffff', level: 1, baked: false },
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
