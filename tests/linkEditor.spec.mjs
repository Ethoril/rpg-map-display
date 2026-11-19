// @ts-check
import { test, expect } from '@playwright/test';

/** Charge une campagne à deux étages et ouvre l'éditeur de liaisons du panneau MJ. */
async function ouvrirEditeur(/** @type {import('@playwright/test').Page} */ page) {
  await page.goto('/gm.html');
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const schema = await import('../js/core/schema.js');
    store.loadCampaign(schema.createCampaign({ levels: [schema.createLevel({ id: 'rdc', name: 'RDC' }), schema.createLevel({ id: 'et1', name: 'Étage 1' })] }));
  });
  await page.click('#gm-mode-prep');
  await page.click('#gm-rail-link-editor');
}

/**
 * Pose l'extrémité attendue, par le point d'entrée que la carte elle-même appelle : `gm.js` ne
 * fournit rien d'autre que l'étage **affiché** et la case tapée.
 */
async function taperLaCase(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ levelId, /** @type {{a: number, b: number}} */ cell) {
  await page.evaluate(
    ([id, c]) => /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor.setEndpoint(id, c),
    /** @type {[string, {a: number, b: number}]} */ ([levelId, cell])
  );
}

test('les deux extrémités se désignent à la tape, et l’affichage ne peut pas être en retard', async ({ page }) => {
  await ouvrirEditeur(page);

  // ⛔ Plus un seul champ de saisie de coordonnées, ni de menu « Étage B ». C'étaient EUX, la
  // deuxième source de vérité : on tapait une case sur l'étage affiché pendant que le menu, lui,
  // partait dans le fichier. Le 9 août 2026, un escalier a ainsi relié le mauvais niveau.
  await expect(page.locator('#link-cell-x')).toHaveCount(0);
  await expect(page.locator('#link-cell-y')).toHaveCount(0);
  await expect(page.locator('#link-level-b')).toHaveCount(0);

  await expect(page.locator('#link-a-state')).toHaveText('à désigner');
  await expect(page.locator('#link-b-state')).toHaveText('à désigner');
  await expect(page.locator('#link-create')).toBeDisabled();

  // Départ : on arme, on tape.
  await page.click('#link-pick-a');
  await taperLaCase(page, 'rdc', { a: 2, b: 3 });
  await expect(page.locator('#link-a-state')).toHaveText('RDC — case 2, 3');

  // ⭐ L'enchaînement est automatique : le départ posé, c'est l'arrivée qui est attendue. Rien à
  // deviner — l'ancienne version demandait un clic NON armé pour remplir l'autre bout.
  await expect(page.locator('#link-pick-b')).toHaveText('Annuler');
  await expect(page.locator('#link-hint')).toContainText('étage d’arrivée');

  // Seuls les étages possibles sont proposés : celui du départ n'en est pas.
  await expect(page.locator('#link-level-choices button')).toHaveCount(1);
  await expect(page.locator('#link-level-choices button')).toHaveText('Étage 1');

  // Taper sur l'étage du départ refuse, le dit, et n'enregistre rien.
  await taperLaCase(page, 'rdc', { a: 9, b: 9 });
  await expect(page.locator('#link-error')).toContainText('autre étage');
  await expect(page.locator('#link-b-state')).toHaveText('à désigner');
  await expect(page.locator('#link-create')).toBeDisabled();

  // Arrivée sur l'autre étage : l'encart l'annonce immédiatement, étage ET case.
  await taperLaCase(page, 'et1', { a: 4, b: 5 });
  await expect(page.locator('#link-b-state')).toHaveText('Étage 1 — case 4, 5');
  await expect(page.locator('#link-create')).toBeEnabled();

  await page.check('#link-one-way');
  await page.check('#link-gm-only');
  await page.click('#link-create');

  const link = await page.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.links[0]);
  if (!link) throw new Error('La liaison créée doit être présente dans le store');
  expect(link).toMatchObject({ a: { levelId: 'rdc', at: { cellX: 2, cellY: 3 } }, b: { levelId: 'et1', at: { cellX: 4, cellY: 5 } }, bidirectional: false, gmOnly: true });

  // La liste relit les étages par leur NOM, pas par leur identifiant de fichier.
  await expect(page.locator('#link-list')).toContainText('RDC — case 2, 3');
  await expect(page.locator('#link-list')).toContainText('Étage 1 — case 4, 5');

  // Et l'éditeur est revenu à vide : rien ne reste armé après une création.
  await expect(page.locator('#link-a-state')).toHaveText('à désigner');
  await expect(page.locator('#link-b-state')).toHaveText('à désigner');
  await expect(page.locator('#link-create')).toBeDisabled();

  await page.click('#link-list button:text("Voir")');
  expect(await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor.getSelectedLinkId())).toBe(link.id);
  await page.click('#link-list button:text("Supprimer")');
  await expect(page.locator('#link-list')).toHaveText('');
});

test('le bouton d’étage de l’arrivée emmène la vue du MJ, et la table ne suit pas', async ({ page }) => {
  await ouvrirEditeur(page);
  await page.click('#link-pick-a');
  await taperLaCase(page, 'rdc', { a: 1, b: 1 });

  expect(await page.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId())).toBe('rdc');

  // ⭐ C'est ce bouton qui rend « allez sur l'étage d'arrivée » faisable au lieu d'être à lire.
  await page.click('#link-level-choices button:text("Étage 1")');
  expect(await page.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId())).toBe('et1');

  // La case tapée appartient alors à l'étage affiché, sans qu'aucun autre contrôle n'en décide.
  await taperLaCase(page, 'et1', { a: 7, b: 8 });
  await expect(page.locator('#link-b-state')).toHaveText('Étage 1 — case 7, 8');
});

test('la marque de l’étage affiché suit un changement d’étage venu d’ailleurs que de l’éditeur', async ({ page }) => {
  await ouvrirEditeur(page);
  await page.click('#link-pick-a');
  await taperLaCase(page, 'rdc', { a: 1, b: 1 });

  const choixEtage1 = page.locator('#link-level-choices button[data-level-id="et1"]');
  await expect(choixEtage1).not.toHaveClass(/gm-btn-active/);

  // ⭐ Changement d'étage par la barre du haut, pas par l'éditeur : il passe par le store, donc
  // par l'abonnement du panneau. Sans l'étage actif dans la signature de rafraîchissement, la
  // marque resterait sur l'étage précédent — l'écart entre ce qu'on voit et ce que l'outil croit.
  await page.evaluate(async () => (await import('../js/state/store.js')).selectLevel('et1'));
  await expect(choixEtage1).toHaveClass(/gm-btn-active/);
});

test('la liaison en cours se dessine sur la carte avant d’exister', async ({ page }) => {
  await ouvrirEditeur(page);

  // Rien de posé : aucun brouillon à dessiner.
  expect(await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor.getDraft().a)).toBeNull();

  await page.click('#link-pick-a');
  await taperLaCase(page, 'rdc', { a: 2, b: 3 });

  // ⭐ Poser une extrémité ne dessinait rien : on tapait, la carte restait identique. Le brouillon
  // porte l'étage, pour que la couche ne dessine A que sur l'étage de A.
  expect(await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor.getDraft())).toMatchObject({
    a: { levelId: 'rdc', at: { cellX: 2, cellY: 3 } },
    b: null,
    attente: 'b',
  });

  // ⚠ Le même objet d'une image à l'autre tant que rien ne bouge : il est lu à chaque image de la
  // boucle de rendu, et en refabriquer un ferait du déchet à 60 par seconde.
  expect(await page.evaluate(() => {
    const editeur = /** @type {any} */ (window).__RPG_APP__.gmPanel.linkEditor;
    return editeur.getDraft() === editeur.getDraft();
  })).toBe(true);
});
