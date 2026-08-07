// @ts-check
import { test, expect } from '@playwright/test';

test('MJ crée, oriente puis supprime une liaison sans éditer le JSON', async ({ page }) => {
  await page.goto('/gm.html');
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const schema = await import('../js/core/schema.js');
    store.loadCampaign(schema.createCampaign({ levels: [schema.createLevel({ id: 'rdc', name: 'RDC' }), schema.createLevel({ id: 'et1', name: 'Étage 1' })] }));
  });
  await page.click('#gm-tab-link-editor');
  await page.click('#link-arm');
  await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor.setEndpointA('rdc', { a: 2, b: 3 }));
  await page.selectOption('#link-level-b', 'et1');
  await page.locator('#link-cell-x').fill('4');
  await page.locator('#link-cell-y').fill('5');
  await page.check('#link-one-way');
  await page.check('#link-gm-only');
  await page.click('#link-create');
  const link = await page.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.links[0]);
  if (!link) throw new Error('La liaison créée doit être présente dans le store');
  expect(link).toMatchObject({ a: { levelId: 'rdc', at: { cellX: 2, cellY: 3 } }, b: { levelId: 'et1', at: { cellX: 4, cellY: 5 } }, bidirectional: false, gmOnly: true });
  await page.click('#link-list button:text("Voir")');
  expect(await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor.getSelectedLinkId())).toBe(link.id);
  await page.click('#link-list button:text("Supprimer")');
  await expect(page.locator('#link-list')).toHaveText('');
});
