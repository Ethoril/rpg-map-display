// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('CORRECTIF — Masquage des pions côté joueurs (E2E & Perfs)', () => {
  test('1. Vue Joueurs : pion en zone explorée non vue masqué, pion en vision affiché', async ({ page }) => {
    page.on('console', (msg) => console.log('[BROWSER LOG]', msg.text()));
    const sessionId = `test-player-mask-e2e-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/player.html?session=${sessionId}`);
    await waitForApp(page);

    // Initialiser une campagne avec un pion en (1, 1) et un pion en (5, 5)
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

      const token1 = schema.createToken({
        id: 'token-visible',
        levelId: 'level-1',
        cell: { a: 1, b: 1 },
        label: 'PJ Visible',
      });

      const token2 = schema.createToken({
        id: 'token-hidden-fog',
        levelId: 'level-1',
        cell: { a: 5, b: 5 },
        label: 'PNJ Masqué',
      });

      const campaign = schema.createCampaign({
        levels: [level],
        tokens: [token1, token2],
      });

      store.loadCampaign(campaign);
    });

    // Simuler l'arrivée d'un masque de vision réseau (case 1,1 vue, case 5,5 non vue)
    await page.evaluate(async () => {
      const [store, fog] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/vision/fog.js'),
      ]);

      const visCanvas = document.createElement('canvas');
      visCanvas.width = 80;
      visCanvas.height = 80;
      const ctx = visCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        ctx.fillRect(8, 8, 8, 8); // Case (1, 1) en vision
      }
      const pngB64 = await fog.encodeFogPng(visCanvas);
      store.setSessionVision('level-1', pngB64);
    });

    // Laisser le masque se décoder
    await page.waitForFunction(async () => {
      const w = /** @type {any} */ (window);
      const app = w.__RPG_APP__;
      const store = await import('../js/state/store.js');
      const level = store.getActiveLevel();
      if (!app || !app.getPlayerVisibleCanvas || !level) return false;
      return app.getPlayerVisibleCanvas(level) !== null;
    });

    const renderedIds = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      const app = w.__RPG_APP__;
      if (!app || !app.tokensLayer) return [];
      const store = await import('../js/state/store.js');
      const grid = await import('../js/grid/index.js');
      const level = store.getActiveLevel();
      const state = store.getState();
      if (!level || !state.campaign) return [];
      const g = grid.gridFor(level);

      const targetCanvas = document.createElement('canvas');
      targetCanvas.width = 500;
      targetCanvas.height = 500;
      const ctx = targetCanvas.getContext('2d');

      const visCanvas = app.getPlayerVisibleCanvas ? app.getPlayerVisibleCanvas(level) : null;

      const res = app.tokensLayer.render(ctx, g, state.campaign.tokens, null, {
        role: 'players',
        isPlayerView: true,
        activeLevelId: level.id,
        activeLevelWidthCells: level.widthCells,
        activeLevelHeightCells: level.heightCells,
        visibleCanvas: visCanvas,
      });

      return res.renderedTokenIds;
    });

    expect(renderedIds).toContain('token-visible');
    expect(renderedIds).not.toContain('token-hidden-fog');
  });

  test('2. Mesure du temps de rendu par image sur la vue joueurs (Bench Desktop)', async ({ page }) => {
    const sessionId = `test-player-mask-perf-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/player.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);

      const level = schema.createLevel({
        id: 'level-big',
        name: 'Grand Étage',
        widthCells: 50,
        heightCells: 50,
      });

      const tokens = [];
      for (let i = 0; i < 20; i++) {
        tokens.push(
          schema.createToken({
            id: `t-${i}`,
            levelId: 'level-big',
            cell: { a: i % 10, b: Math.floor(i / 10) },
          })
        );
      }

      const campaign = schema.createCampaign({
        levels: [level],
        tokens,
      });

      store.loadCampaign(campaign);
    });

    // Mesurer le temps d'exécution de 30 frames consécutives de rendu de pions
    const renderTiming = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      const app = w.__RPG_APP__;
      const store = await import('../js/state/store.js');
      const grid = await import('../js/grid/index.js');
      const level = store.getActiveLevel();
      const state = store.getState();
      if (!app || !level || !state.campaign) return { avgMs: 0, totalMs: 0 };

      const g = grid.gridFor(level);
      const targetCanvas = document.createElement('canvas');
      targetCanvas.width = 1440;
      targetCanvas.height = 900;
      const ctx = targetCanvas.getContext('2d');

      const iterations = 30;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        app.tokensLayer.render(ctx, g, state.campaign.tokens, null, {
          role: 'players',
          isPlayerView: true,
          activeLevelId: level.id,
          activeLevelWidthCells: level.widthCells,
          activeLevelHeightCells: level.heightCells,
        });
      }

      const totalMs = performance.now() - start;
      return {
        totalMs,
        avgMs: totalMs / iterations,
      };
    });

    console.log(`[PERF BENCH DESKTOP] Temps moyen de rendu des pions (30 frames) : ${renderTiming.avgMs.toFixed(3)} ms/frame`);
    console.log(`[PERF BENCH DESKTOP] (La validation finale des performances reste soumise aux tests sur tablette cible)`);
  });
});
