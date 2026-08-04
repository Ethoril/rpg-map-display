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
