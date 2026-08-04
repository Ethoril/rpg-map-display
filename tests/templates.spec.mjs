// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('Tranche L-08 — Gabarits de zone d\'effet (E2E)', () => {
  test('1. Panneau MJ : Onglet "📐 Gabarits" présent et armement interactif', async ({ page }) => {
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
    await page.click('button[data-tab="wall-editor"]');
    await page.click('#wall-btn-arm');

    let wallArmed = await page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.wallEditor?.isArmed() ?? false;
    });
    expect(wallArmed).toBe(true);

    // Basculer sur Gabarits et armer les gabarits
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

  test('3. Placement et effacement de gabarit par le MJ', async ({ page }) => {
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
      });

      const campaign = schema.createCampaign({ levels: [level] });
      store.loadCampaign(campaign);
    });

    await page.click('button[data-tab="template-tools"]');
    await page.click('#tpl-toggle-arm');

    // Emuler un placement via l'intention tap à la case {a: 5, b: 5}
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const level = store.getActiveLevel();
      if (!level) return;
      const w = /** @type {any} */ (window);
      if (w.__RPG_APP__?.pointerInput) {
        w.__RPG_APP__.pointerInput.onIntention({
          type: 'tap',
          mapPos: { x: 250, y: 250 },
          screenPos: { x: 250, y: 250 },
        });
      }
    });

    // Vérifier la présence du gabarit dans le store
    const templatesCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().campaign?.templates.length ?? 0;
    });
    expect(templatesCount).toBe(1);

    // Effacement des gabarits de l'étage
    await page.click('#tpl-clear-level');

    const templatesAfterClear = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().campaign?.templates.length ?? 0;
    });
    expect(templatesAfterClear).toBe(0);
  });
});
