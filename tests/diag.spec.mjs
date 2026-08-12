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

  // Fast-forward l'armement pour simuler les 120 s physiques et mesurer
  await page.evaluate(() => {
    const trial = /** @type {any} */ (window).__coldDecodeTrial;
    if (trial) trial.armedAt = trial.now() - 130000;
  });
  await page.getByRole('button', { name: /Mesurer après inactivité/ }).click();
  const texteMesure = /** @type {string} */ (await page.locator('#sortie').textContent());
  expect(texteMesure).toContain('Décodage post-inactivité terminé');
  expect(texteMesure).toContain('Coût brut');
  expect(texteMesure).toContain('Coût relecture (1×1)');
  expect(texteMesure).toContain('Coût net du premier tracé');
  expect(texteMesure).toContain('Image.decode() a été retiré');

  // ⭐ **Le câblage, pas seulement les étiquettes.** Avant le 12/08/2026 ce test ne vérifiait que
  // la présence des trois libellés : remplacer `net` par `brut` dans `diag.js` le laissait vert,
  // et le verdict R2-03 se prononçait alors sur une durée qui inclut la relecture.
  //
  // ⛔ Les nombres sont lus **non arrondis** sur `window.__coldDecodeDernier`, jamais reparsés
  // depuis l'affichage. L'affichage quantifie à 0,1 ms, et la différence de deux arrondis contre
  // l'arrondi d'une différence s'écarte jusqu'à 0,15 ms : une assertion sur le texte serait fausse
  // environ une fois sur quatre **sur du code juste**. C'est exactement la fausse rougeur que R-08
  // vient de chasser de la porte ; ne pas la réintroduire par la petite porte du parsing.
  //
  // ⚠ La garde **déterministe** de la soustraction reste le test unitaire de `resumeDecodageFroid`
  // dans `tests/endurance.test.mjs`, celui qui prouve qu'elle fait basculer le verdict.
  const releve = await page.evaluate(() => /** @type {any} */ (window).__coldDecodeDernier);
  console.log(`  R2-03 relevé : brut ${releve.brut} ms, relecture ${releve.relecture} ms, net ${releve.net} ms`);

  expect(releve.relecture, 'une relecture nulle rendrait la soustraction invisible').toBeGreaterThan(0);
  expect(releve.net).toBe(Math.max(0, releve.brut - releve.relecture));

  // Et le verdict affiché doit suivre le **net**, pas le brut. Sans cette assertion, faire juger
  // `resumeDecodageFroid(brut, 0)` pour la seule phrase laissait tout vert.
  expect(texteMesure).toMatch(/critère R2-03 tenu|n'est PAS tenu/);
  expect(texteMesure).toContain(
    releve.net < 5 ? 'OUI — critère R2-03 tenu' : "le seuil R2-03 n'est PAS tenu"
  );

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
