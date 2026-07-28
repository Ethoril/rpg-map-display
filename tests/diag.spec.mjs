// @ts-check
import { test, expect } from '@playwright/test';

// `diag.html` est l'outil qui répond aux décisions exigeant le matériel réel. S'il casse en
// silence — un renommage dans le store, une API Pixi qui bouge — on ne s'en aperçoit qu'une
// tablette en main, au mauvais moment. Ces deux vérifications coûtent deux secondes.
//
// Les mesures 3, 4 et 5 ne sont pas testées ici : 20 s, 5 min, et un projet Firebase.

test('diag.html : environnement et limites GPU se mesurent', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/diag.html');
  await page.getByRole('button', { name: /Environnement/ }).click();

  const sortie = page.locator('#sortie');
  await expect(sortie).toContainText('MAX_TEXTURE_SIZE');
  await expect(sortie).toContainText('devicePixelRatio');
  // Le plafond de résolution du cahier des charges doit apparaître, calculé et non recopié.
  await expect(sortie).toContainText('Plafond appliqué');
  expect(erreurs).toEqual([]);
});

test('diag.html : le coût de lecture du store se mesure', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/diag.html');
  await page.getByRole('button', { name: /Coût de lecture/ }).click();

  const sortie = page.locator('#sortie');
  await expect(sortie).toContainText('getState()');
  await expect(sortie).toContainText('ms par appel');
  // La conclusion doit être tranchée dans un sens ou dans l'autre, jamais absente.
  await expect(sortie).toContainText(/décision n°12/);
  expect(erreurs).toEqual([]);
});
