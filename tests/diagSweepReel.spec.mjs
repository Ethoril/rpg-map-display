// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Le banc « cartes publiées » lit le vrai catalogue et la vraie géométrie.
 *
 * Ce test ne mesure aucune performance et n'en coche aucune (interdiction n°14) : il
 * vérifie que la section s'exécute, qu'elle lit une carte réelle, et qu'elle affiche
 * ce qu'elle ne mesure pas. Une section de diagnostic qui plante en séance ne sert à
 * rien, et c'est la seule chose qu'un test navigateur puisse établir ici.
 */
test('6bis — le banc mesure sur la géométrie publiée et annonce ses limites', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/diag.html');
  await page.click('#btn-sweep-reel');

  const sortie = page.locator('#sortie');

  // Attente de condition, jamais de durée : le banc parcourt plusieurs cartes.
  await expect(sortie).toContainText('cartes RÉELLEMENT publiées', { timeout: 30000 });
  await expect(sortie).toContainText('VERDICT PERFORMANCE', { timeout: 60000 });

  const texte = await sortie.textContent();

  // Une carte du catalogue réel a bien été lue, avec sa géométrie.
  expect(texte).toMatch(/\d+×\d+ cases, \d+ segments/);
  // Les quatre portées sont couvertes.
  for (const portee of [5, 10, 15, 20]) {
    expect(texte).toContain(`${portee} cases`);
  }
  // Et la section dit ce qu'elle ne mesure pas — sinon elle inviterait à conclure.
  expect(texte).toContain('CE QUE CE BANC NE MESURE PAS');

  expect(erreurs).toEqual([]);
});
