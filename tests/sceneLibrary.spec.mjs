// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Catalogue de test servi à la place de maps/catalog.json.
 * Les URLs restent RELATIVES, comme dans un vrai catalogue généré.
 */
const FAKE_CATALOG = {
  version: 1,
  maps: [
    {
      id: 'minimal',
      name: 'Carte minimale',
      sourceUrl: 'maps/minimal.uvtt',
      sceneUrl: 'maps/generated/minimal.scene.json',
      imageUrl: 'maps/minimal.webp',
      sourceHash: 'sha256-test',
      levelCount: 1,
      features: { walls: 3, portals: 2, lights: 1, bakedLighting: false },
    },
  ],
};

/** Scène cohérente avec FAKE_CATALOG : imageUrl identique, relative. */
const FAKE_SCENE = {
  schemaVersion: 2,
  campaignId: 'campaign-minimal',
  name: 'Carte minimale',
  levels: [
    {
      id: 'minimal-level',
      name: 'Carte minimale',
      order: 0,
      imageUrl: 'maps/minimal.webp',
      videoUrl: null,
      animatedOverlays: [],
      pxPerCell: 140,
      widthCells: 10,
      heightCells: 8,
      grid: {
        type: 'square',
        offsetX: 0,
        offsetY: 0,
        color: '#000000',
        opacity: 0.25,
        visible: true,
      },
      terrainCost: null,
      walls: [],
      portals: [],
      lights: [],
      ambient: { color: '#ffffff', level: 1, baked: false },
    },
  ],
  links: [],
  tokens: [],
  templates: [],
  settings: {},
};

/**
 * Monte la vue MJ en interceptant le catalogue et la scène.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{catalog?: any, scene?: any, catalogStatus?: number, sceneStatus?: number}} [fixtures]
 * @returns {Promise<string[]>} erreurs de page collectées
 */
async function setupWithCatalog(page, fixtures = {}) {
  const {
    catalog = FAKE_CATALOG,
    scene = FAKE_SCENE,
    catalogStatus = 200,
    sceneStatus = 200,
  } = fixtures;

  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.route('**/maps/catalog.json', (route) =>
    route.fulfill({
      status: catalogStatus,
      contentType: 'application/json',
      body: JSON.stringify(catalog),
    })
  );

  await page.route('**/maps/generated/minimal.scene.json', (route) =>
    route.fulfill({
      status: sceneStatus,
      contentType: 'application/json',
      body: JSON.stringify(scene),
    })
  );

  await page.goto('/gm.html');
  await page.click('#gm-mode-prep');
  await page.waitForSelector('.gm-tab-btn[data-tab="scene-library"]');
  await page.click('.gm-tab-btn[data-tab="scene-library"]');

  return errors;
}

test.describe('U-04 — Bibliothèque de cartes MJ', () => {
  test('affiche les cartes du catalogue avec leurs compteurs, sans champ URL', async ({ page }) => {
    await setupWithCatalog(page);

    await expect(page.locator('.scene-card')).toHaveCount(1);
    await expect(page.locator('.scene-card-name')).toHaveText('Carte minimale');

    const counters = await page.locator('.scene-card-counters').textContent();
    expect(counters).toContain('3'); // murs
    expect(counters).toContain('2'); // portes
    expect(counters).toContain('1'); // lumières

    // Plan §7 : aucun champ URL, aucun sélecteur de fichier dans ce parcours
    const pane = page.locator('#tab-content-scene-library');
    await expect(pane.locator('input[type="text"]')).toHaveCount(0);
    await expect(pane.locator('input[type="file"]')).toHaveCount(0);
  });

  test('« Charger » charge la scène dans le store sans erreur de page', async ({ page }) => {
    const errors = await setupWithCatalog(page);

    await page.click('.scene-card-load');

    // Le statut confirme le chargement dans l'interface
    await expect(page.locator('.scene-library-status')).toContainText('chargée');

    // Le store contient l'étage préparé, avec son imageUrl RELATIVE
    const level = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const activeLevel = store.getActiveLevel();
      return activeLevel
        ? { id: activeLevel.id, imageUrl: activeLevel.imageUrl, pxPerCell: activeLevel.pxPerCell }
        : null;
    });

    expect(level).not.toBeNull();
    expect(level?.id).toBe('minimal-level');
    expect(level?.imageUrl).toBe('maps/minimal.webp');
    expect(level?.pxPerCell).toBe(140);

    // Aucune exception non rattrapée (la régression loadBtn hors portée)
    expect(errors).toEqual([]);
  });

  test('une scène incohérente avec le catalogue est refusée sans muter le store', async ({
    page,
  }) => {
    const driftedScene = structuredClone(FAKE_SCENE);
    driftedScene.levels[0].imageUrl = 'maps/generated/autre-image.webp';

    await setupWithCatalog(page, { scene: driftedScene });
    await page.click('.scene-card-load');

    await expect(page.locator('.scene-library-status')).toContainText('incohérence');

    const hasLevel = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel() !== null;
    });
    expect(hasLevel).toBe(false);
  });

  test('un catalogue corrompu laisse la bibliothèque indisponible et visible en erreur', async ({
    page,
  }) => {
    await setupWithCatalog(page, { catalog: { version: 99, maps: 'pas-un-tableau' } });

    await expect(page.locator('.scene-library-status')).toContainText('indisponible');
    await expect(page.locator('.scene-card')).toHaveCount(0);
  });
});
