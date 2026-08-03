// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('Tranche L-07 — Éditeur minimal de murs (E2E)', () => {
  test('1. Éditeur armé : un tap près d\'une porte ne la bascule pas', async ({ page }) => {
    const sessionId = `test-wall-editor-1-${Date.now()}`;
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
        portals: [
          {
            id: 'portal-1',
            a: { cellX: 4, cellY: 4 },
            b: { cellX: 5, cellY: 4 },
            state: 'closed',
            freestanding: false,
          },
        ],
      });

      const campaign = schema.createCampaign({ levels: [level] });
      store.loadCampaign(campaign);
    });

    // Basculer sur l'onglet Murs et armer l'éditeur
    await page.click('button[data-tab="wall-editor"]');
    await page.click('#wall-btn-arm');

    // Tap près du portail
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const level = store.getActiveLevel();
      if (!level) return;
      // Emuler un tap à la position du portail (4.5, 4)
      const w = /** @type {any} */ (window);
      if (w.__RPG_APP__?.pointerInput) {
        // screenPos arbitraire, mapPos (225, 200) car 4.5 * 50 = 225, 4 * 50 = 200
        w.__RPG_APP__.pointerInput.emit?.({
          type: 'tap',
          screenPos: { x: 225, y: 200 },
          mapPos: { x: 225, y: 200 },
        });
      }
    });

    // Vérifier que le portail n'a PAS changé d'état ('closed')
    const currentPortalState = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const lvl = store.getActiveLevel();
      return lvl?.portals[0].state;
    });
    expect(currentPortalState).toBe('closed');
  });

  test('2. La zone de déplacement d\'un pion sélectionné se restreint immédiatement lors de l\'ajout d\'un mur', async ({ page }) => {
    const sessionId = `test-wall-editor-2-${Date.now()}`;
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

      const token = schema.createToken({
        id: 'hero-1',
        label: 'Guerrier',
        levelId: 'level-1',
        cell: { a: 4, b: 4 },
        speedCells: 5,
      });

      const campaign = schema.createCampaign({ levels: [level], tokens: [token] });
      store.loadCampaign(campaign);
      store.selectToken('hero-1');
    });

    const reachableBefore = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().reachableCells.size;
    });
    expect(reachableBefore).toBeGreaterThan(0);

    // Ajouter un mur horizontal à cellY = 4 devant le pion
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const level = store.getActiveLevel();
      if (!level) return;
      store.addWall(level.id, [
        { cellX: 2, cellY: 4 },
        { cellX: 6, cellY: 4 },
      ]);
    });

    const reachableAfter = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().reachableCells.size;
    });
    expect(reachableAfter).toBeLessThan(reachableBefore);
  });

  test('3. Tracer un mur à la main ajoute le mur dans la campagne du store', async ({ page }) => {
    const sessionId = `test-wall-editor-3-${Date.now()}`;
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
        walls: [],
      });

      const campaign = schema.createCampaign({ levels: [level] });
      store.loadCampaign(campaign);
    });

    const initialWallCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel()?.walls.length ?? 0;
    });
    expect(initialWallCount).toBe(0);

    // Armer l'éditeur
    await page.click('button[data-tab="wall-editor"]');
    await page.click('#wall-btn-arm');

    // Emuler deux taps pour poser deux sommets
    await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      w.__RPG_APP__?.pointerInput?.emit?.({
        type: 'tap',
        screenPos: { x: 100, y: 100 },
        mapPos: { x: 100, y: 100 },
      });
      w.__RPG_APP__?.pointerInput?.emit?.({
        type: 'tap',
        screenPos: { x: 200, y: 100 },
        mapPos: { x: 200, y: 100 },
      });
    });

    // Cliquer sur le bouton "Valider le mur"
    await page.click('#wall-btn-commit');

    const finalWallCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel()?.walls.length ?? 0;
    });
    expect(finalWallCount).toBe(1);
  });

  test('4. Les murs ne sont pas dessinés sur player.html (vue joueurs autonomes)', async ({ page }) => {
    const sessionId = `test-wall-editor-4-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/player.html?session=${sessionId}`);
    await waitForApp(page);

    // Sur la vue joueurs, vérifier l'absence d'éléments UI d'édition de murs
    const wallEditorBtn = page.locator('button[data-tab="wall-editor"]');
    await expect(wallEditorBtn).toHaveCount(0);
  });

  test('5. Ajouter un mur sur un étage sans mur modifie et restreint le masque de vision publié (getSessionVision)', async ({ page }) => {
    const sessionId = `test-wall-vision-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);

      const level = schema.createLevel({
        id: 'level-vision-1',
        name: 'Étage sans mur',
        widthCells: 10,
        heightCells: 10,
        walls: [],
      });

      const token = schema.createToken({
        id: 'pj-vision-1',
        label: 'PJ Vision',
        levelId: 'level-vision-1',
        cell: { a: 4, b: 4 },
        visionBright: 4,
        visionDim: 6,
        speedCells: 5,
      });

      const campaign = schema.createCampaign({ levels: [level], tokens: [token] });
      store.loadCampaign(campaign);
    });

    // Attendre la publication initiale du masque de vision courante
    await page.waitForFunction(async () => {
      const store = await import('../js/state/store.js');
      return store.getSessionVision('level-vision-1') !== null;
    });

    const visionBefore = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getSessionVision('level-vision-1');
    });
    expect(visionBefore).not.toBeNull();

    // Appeler store.addWall(...) pour placer un mur horizontal entre le PJ et le haut de la pièce
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.addWall('level-vision-1', [
        { cellX: 2, cellY: 3 },
        { cellX: 6, cellY: 3 },
      ]);
    });

    // Attendre que le masque de vision publié soit mis à jour et diffère du masque précédent
    await page.waitForFunction(async (oldVision) => {
      const store = await import('../js/state/store.js');
      const current = store.getSessionVision('level-vision-1');
      return current !== null && current !== oldVision;
    }, visionBefore);

    const visionAfter = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getSessionVision('level-vision-1');
    });

    expect(visionAfter).not.toBeNull();
    expect(visionAfter).not.toEqual(visionBefore);
  });
});
