// @ts-check
import { test, expect } from '@playwright/test';

// `diag.html` est l'outil qui répond aux décisions exigeant le matériel réel. S'il casse en
// silence — un renommage dans le store, une API Canvas qui bouge — on ne s'en aperçoit qu'une
// tablette en main, au mauvais moment. Ces vérifications restent courtes.
//
// Les mesures 3, 4 et 5 ne sont pas testées ici : 20 s, 5 min, et un projet Firebase. Le test R2
// vérifie seulement l'armement et la saisie ; il ne remplace pas les 120 s, 45 min ou 4 h réels.

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

test('diag.html : le protocole R2 s’arme sans minuterie et accepte un relevé manuel', async ({
  page,
}) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/diag.html');
  await page.getByText(/R2 — Décodage froid/).click();
  await page.locator('#cold-image-url').fill('maps/minimal.webp');
  await page.getByRole('button', { name: /Armer le décodage froid/ }).click();
  await expect(page.locator('#sortie')).toContainText('Décodage froid armé');

  // La page refuse une mesure immédiate au lieu de simuler les 120 s physiques.
  await page.getByRole('button', { name: /Mesurer après inactivité/ }).click();
  await expect(page.locator('#sortie')).toContainText('Inactivité insuffisante');

  await page.getByRole('button', { name: /Démarrer le journal endurance/ }).click();
  await page.locator('#endurance-fps').fill('30');
  await page.locator('#endurance-temperature').fill('dos tiède');
  await page.locator('#endurance-cast').selectOption('observed');
  await page.getByRole('button', { name: /Ajouter le relevé manuel/ }).click();
  await expect(page.locator('#sortie')).toContainText('fps 30');
  await expect(page.locator('#sortie')).toContainText('température dos tiède');
  await expect(page.locator('#sortie')).toContainText('cast observed');
  expect(erreurs).toEqual([]);
});
