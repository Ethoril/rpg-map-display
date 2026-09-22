// @ts-check
import { test } from '@playwright/test';
import { waitForApp, installBrowserTransport } from '../browserTestTransport.mjs';

/**
 * MESURE — coût de rendu des pions côté joueurs, sur le poste de développement.
 *
 * ⛔ Sorti de la porte le 22/09/2026 (audit, D9) : ce test n'a AUCUNE assertion et rendait
 * `{avgMs: 0}` si l'application manquait — il ne pouvait pas échouer. Une mesure dépend de la
 * machine, elle n'entre pas dans `verify` : `pnpm run test:mesures`.
 */
test.describe('MESURE — rendu des pions, vue joueurs', () => {
  test('2. Mesure du temps de rendu par image sur la vue joueurs (Bench Desktop)', async ({ page }) => {
    const sessionId = `test-player-mask-perf-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/player.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../../js/state/store.js'),
        import('../../js/core/schema.js'),
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
      const store = await import('../../js/state/store.js');
      const grid = await import('../../js/grid/index.js');
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
