// @ts-check
//
// C-1 — la bibliothèque de cartes de l'outil de préparation.
//
// Les pions avaient leur CRUD et leur test bout-en-bout (`prepareTokenLibrary.spec.mjs`) ; les
// cartes n'avaient ni l'un ni l'autre. Ce fichier tient le même rôle pour elles, avec une
// exigence de plus : **la suppression est sans annulation**, et emporte la source que le
// mainteneur a lui-même déposée. Ce qui doit être prouvé ici n'est donc pas qu'un bouton
// appelle une route, mais que :
//
//   1. l'inventaire est demandé, et affiché, AVANT toute demande de confirmation ;
//   2. un refus de confirmation n'appelle **pas** la suppression ;
//   3. la question posée dit ce qui va être perdu, fichier par fichier.
//
// ⛔ Hermétique comme ses voisins : toutes les routes sont interceptées, rien n'est écrit dans
// `maps/`. Ce que la suppression fait réellement sur le disque est prouvé côté Node, dans
// `tests/prepare-maps.test.mjs` — un test de navigateur ne peut que prouver le geste.

import { test, expect } from '@playwright/test';

/** Réponse minimale de `/api/sources` : elle ne sert qu'à faire apparaître l'outil. */
const SOURCES = {
  defaults: { targetPxPerCell: 140, maxTexturePx: 8192, quality: 90 },
  sources: [
    {
      file: 'manoir.dd2vtt',
      name: 'Manoir',
      bytes: 100,
      cellsX: 10,
      cellsY: 8,
      densiteSource: 64,
      sourceWidth: 640,
      sourceHeight: 512,
      walls: 0,
      portals: 0,
      lights: 0,
      declares: { walls: 0, portals: 0, lights: 0 },
      bakedLighting: false,
      warnings: [],
    },
  ],
  illisibles: [],
};

const CARTES = {
  maps: [
    {
      id: 'manoir',
      name: 'Manoir hanté',
      levelCount: 2,
      sources: ['manoir_00.dd2vtt', 'manoir_01.dd2vtt'],
      publiee: true,
      thumbUrl: 'maps/generated/manoir_00.thumb.webp',
    },
  ],
};

const PLAN = {
  id: 'manoir',
  name: 'Manoir hanté',
  files: [
    { path: 'generated/manoir_00.webp', bytes: 4_194_304 },
    { path: 'generated/manoir_00.thumb.webp', bytes: 12_288 },
    { path: 'generated/manoir.scene.json', bytes: 2_048 },
    { path: 'manoir_00.dd2vtt', bytes: 6_291_456 },
  ],
  totalBytes: 10_500_096,
  dansCatalogue: true,
  dansRecettes: true,
  dansManifeste: true,
};

/**
 * Pose les routes communes et ouvre la page. Rend le compteur d'appels des routes d'écriture,
 * qui sont le sujet des assertions.
 *
 * @param {import('@playwright/test').Page} page
 */
async function ouvrirOutil(page) {
  const appels = { plan: 0, suppressions: /** @type {any[]} */ ([]), renommages: /** @type {any[]} */ ([]) };

  await page.route('**/api/sources', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SOURCES) })
  );
  await page.route('**/api/tokens', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tokens: [], errors: [] }),
    })
  );
  await page.route('**/api/maps', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(CARTES) })
  );
  // La vignette n'existe pas sur le serveur des tests : une route vide évite une image cassée
  // sans rien changer au geste éprouvé.
  await page.route('**/maps/generated/*.thumb.webp*', (route) => route.fulfill({ status: 404 }));
  await page.route('**/api/maps/deletion-plan*', (route) => {
    appels.plan++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(PLAN) });
  });
  await page.route('**/api/maps/delete', (route) => {
    appels.suppressions.push(route.request().postDataJSON());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...PLAN, maps: [] }),
    });
  });
  await page.route('**/api/scenes/rename', (route) => {
    const charge = route.request().postDataJSON();
    appels.renommages.push(charge);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: charge.id,
        name: charge.name,
        creee: true,
        maps: [{ ...CARTES.maps[0], name: charge.name }],
      }),
    });
  });

  await page.goto('/prepare.html');
  await expect(page.locator('#outil')).not.toHaveClass(/cache/);
  return appels;
}

test('C-1 — la carte, sa vignette et ses étages apparaissent dans la bibliothèque', async ({
  page,
}) => {
  await ouvrirOutil(page);

  await expect(page.locator('#cartes-liste')).toContainText('Manoir hanté');
  await expect(page.locator('#cartes-liste')).toContainText('2 étage(s)');
  await expect(page.locator('#cartes-liste img')).toHaveAttribute(
    'src',
    /maps\/generated\/manoir_00\.thumb\.webp/
  );
});

test('C-1 — suppression refusée : l’inventaire est affiché, et RIEN n’est supprimé', async ({
  page,
}) => {
  const appels = await ouvrirOutil(page);

  /** @type {string} */
  let question = '';
  page.on('dialog', (dialog) => {
    question = dialog.message();
    return dialog.dismiss();
  });

  await page.locator('#cartes-liste button', { hasText: 'Supprimer' }).click();

  // ⭐ Le cœur du test : la question posée dit ce qui va être perdu — chaque chemin, la taille
  // totale, et le fait que la source part aussi. Une confirmation qui dirait seulement
  // « Êtes-vous sûr ? » passerait un test d'appel de route, et resterait un piège à table.
  await expect.poll(() => question).not.toBe('');
  expect(question).toContain('maps/generated/manoir_00.webp');
  expect(question).toContain('maps/manoir_00.dd2vtt');
  expect(question).toContain('maps/generated/manoir_00.thumb.webp');
  expect(question).toContain('10.01 Mio');
  expect(question).toMatch(/sources? part/i);
  expect(question).toContain('irréversible');

  // L'inventaire est aussi écrit dans la page, pas seulement dans une boîte qui disparaît.
  await expect(page.locator('#cartes-liste .inventaire')).toContainText('manoir_00.dd2vtt');
  await expect(page.locator('#journal')).toContainText('Suppression annulée');

  expect(appels.plan).toBe(1);
  expect(appels.suppressions).toHaveLength(0);
});

test('C-1 — suppression confirmée : la route est appelée avec l’identifiant, et le message dit ce que git garde', async ({
  page,
}) => {
  const appels = await ouvrirOutil(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.locator('#cartes-liste button', { hasText: 'Supprimer' }).click();

  await expect.poll(() => appels.suppressions.length).toBe(1);
  expect(appels.suppressions[0]).toEqual({ id: 'manoir' });
  // L'inventaire est demandé avant la suppression, jamais l'inverse.
  expect(appels.plan).toBe(1);

  await expect(page.locator('#journal')).toContainText('historique git');
  await expect(page.locator('#cartes-liste')).toContainText('Aucune carte dans maps/');
});

test('C-1 — renommage : le nom saisi part avec l’identifiant, et le message dit que rien n’est republié', async ({
  page,
}) => {
  const appels = await ouvrirOutil(page);
  page.on('dialog', (dialog) => dialog.accept('Manoir des sept clés'));

  await page.locator('#cartes-liste button', { hasText: 'Renommer' }).click();

  await expect.poll(() => appels.renommages.length).toBe(1);
  expect(appels.renommages[0]).toEqual({ id: 'manoir', name: 'Manoir des sept clés' });

  // ⚠ Le renommage ne republie pas, et le mainteneur doit le savoir au moment où il le fait :
  // sans ce message, il croirait la carte renommée partout et découvrirait l'ancien nom sur la
  // tablette, en séance.
  await expect(page.locator('#journal')).toContainText('scenes.json');
  await expect(page.locator('#journal')).toContainText('Publier le catalogue');
  await expect(page.locator('#cartes-liste')).toContainText('Manoir des sept clés');
});
