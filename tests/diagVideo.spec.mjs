// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Sections 7 et 7bis de `diag.html` — le fond animé.
 *
 * Ces boutons existent pour fermer la dernière porte ouverte du CdC §12 : « la tablette
 * décode-t-elle en matériel ? ». Le test ne peut pas répondre à leur place — le verdict
 * dépend de l'appareil — mais il peut garantir qu'ils **répondent quelque chose de vrai**
 * plutôt que d'échouer en silence sur la machine où personne ne regarde.
 *
 * ⚠ Le seuil et la résolution sont vérifiés ici parce que ce sont eux qui font le verdict.
 * Un bouton qui compare la carte au mauvais plafond rendrait un avis faux avec aplomb.
 */

test('7. la capacité de décodage rend un verdict, avec le bon plafond VP9', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('/diag.html');

  await page.click('#btn-video-capacite');
  await expect.poll(() => page.textContent('#sortie'), { timeout: 20000 }).toContain('VERDICT');

  const texte = /** @type {string} */ (await page.textContent('#sortie'));
  // ⚠ `toLocaleString('fr-FR')` sépare les milliers par une espace **insécable étroite**
  // (U+202F), pas par une espace ordinaire. Comparer à « 8 912 896 » tapé au clavier ne
  // matche jamais. `\s` couvre les deux.
  expect(texte).toMatch(/8\s912\s896/);   // plafond VP9 niveau 5.2
  expect(texte).toMatch(/11\s970\s000/);  // luminance de la carte publiée
  expect(texte).toMatch(/décodage (MATÉRIEL|LOGICIEL)/);
  expect(texte).toContain('économe en énergie');
  expect(erreurs).toEqual([]);
});

test('7bis. la lecture réelle mesure la cadence par le critère du produit', async ({ page }) => {
  test.setTimeout(120000);
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  // 8 s au lieu des 60 s du protocole : on vérifie ici que le bouton mesure et conclut,
  // pas la tenue du décodeur — celle-là ne se mesure que sur la tablette.
  await page.goto('/diag.html?duree=8');

  await page.click('#btn-video-lecture');
  await expect.poll(() => page.textContent('#sortie'), { timeout: 90000 }).toContain('VERDICT');

  const texte = /** @type {string} */ (await page.textContent('#sortie'));
  // La résolution décodée doit être celle de la carte : si la vidéo n'a pas été lue,
  // le test doit rougir plutôt que d'afficher un verdict sur du vide.
  expect(texte).toContain('4200×2850');
  expect(texte).toContain('Cadence relative');
  expect(texte).toContain('seuil produit : 50 %');
  expect(erreurs).toEqual([]);
});

test('10. le coût des lumières est rendu comme un écart, avec le verdict de budget', async ({ page }) => {
  test.setTimeout(120000);
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('/diag.html');

  await page.click('#btn-lumieres');
  await expect.poll(() => page.textContent('#sortie'), { timeout: 90000 }).toContain('budget de 300 ms');

  const texte = /** @type {string} */ (await page.textContent('#sortie'));
  // Ce que le critère demande, c'est l'ÉCART : le coût imputable aux lumières. Un tableau
  // de temps absolus ne répondrait pas à R3-05.
  expect(texte).toContain('Écart, donc coût des lumières');
  expect(texte).toContain('Pire avec lumières');
  expect(texte).toContain('Pire sans lumière');
  // La carte du village porte des lumières, le manoir n'en a aucune : les deux côtés de
  // la comparaison doivent exister, sinon l'écart ne veut rien dire.
  expect(texte).toMatch(/test_village_complet/);
  expect(texte).toMatch(/manoir-rdc/);
  expect(erreurs).toEqual([]);
});

test('11. les motifs se dessinent et le verdict rejoint le journal', async ({ page }) => {
  await page.goto('/diag.html');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });

  await page.click('#btn-endurance-start');
  await page.fill('#motif-px-case', '33');
  await page.click('#btn-motifs');
  await expect.poll(() => page.textContent('#sortie')).toContain('Motifs affichés à 33 px');

  // Le canvas doit réellement porter des pixels colorés : un motif à juger qui ne
  // s'affiche pas serait un verdict rendu sur du vide.
  const peint = await page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
    const d = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).getImageData(0, 0, c.width, c.height).data;
    let distincts = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) distincts.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return distincts.size;
  });
  expect(peint).toBeGreaterThan(3);

  await page.click('#btn-motif-lisible');
  expect(await page.textContent('#sortie')).toContain('verdict motifs : lisible');
});

test('13. le banc de visée rejoue les mêmes gestes contre les trois capsules', async ({ page }) => {
  await page.goto('/diag.html');
  await page.click('#btn-visee');
  await expect.poll(() => page.textContent('#sortie')).toContain('Banc de visée armé');

  // Vingt taps au centre du canvas : peu importe la précision, on vérifie que le banc
  // conclut et qu'il compare bien les trois valeurs sur un seul jeu de gestes.
  //
  // ⚠ `locator.click` plutôt que `mouse.click` à des coordonnées calculées : le canvas est
  // en bas de page, sous plusieurs `<details>`, donc hors écran. Des coordonnées absolues
  // tombaient à côté et le banc n'enregistrait rien — sans le moindre message.
  const board = page.locator('#board');
  for (let i = 0; i < 20; i++) {
    await board.click({ position: { x: 200, y: 150 } });
  }
  await expect.poll(() => page.textContent('#sortie'), { timeout: 15000 }).toContain('Taux de réussite simulé');

  const texte = /** @type {string} */ (await page.textContent('#sortie'));
  expect(texte).toContain('capsule 0,25 case');
  expect(texte).toContain('capsule 0,40 case');
  expect(texte).toContain('DRAG_HOLD_MS = 150');
});

test('le journal d’endurance survit à un rechargement d’onglet', async ({ page }) => {
  await page.goto('/diag.html');
  // Les commandes d'endurance vivent dans un `<details>` replié : sans l'ouvrir, le bouton
  // existe dans le DOM mais n'est pas cliquable.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
  });
  await page.click('#btn-endurance-start');
  await page.fill('#endurance-notes', 'repere-de-controle');
  await page.click('#btn-endurance-note');
  await expect.poll(() => page.textContent('#sortie')).toContain('repere-de-controle');

  // ⭐ Le mode de défaillance réel d'une séance de 4 h : Chrome Android recharge l'onglet.
  // Avant la persistance, tout le journal disparaissait à cet instant précis.
  await page.reload();
  await expect
    .poll(() => page.textContent('#sortie'), { timeout: 10000 })
    .toContain('repere-de-controle');

  // Et la page consigne d'elle-même la reprise : `pageshow` arrive juste après le
  // rechargement et réécrit la sortie — c'est d'ailleurs pour ça que l'en-tête « repris »
  // ne survit pas à l'affichage, alors que le journal, lui, survit.
  const texte = /** @type {string} */ (await page.textContent('#sortie'));
  expect(texte).toContain('Constaté par la page');
  expect(texte).toMatch(/pageshow/);
});
