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
      ambient: { level: 1, baked: false },
    },
  ],
  links: [],
  tokens: [],
  templates: [],
  settings: {},
};

const MESSAGE_ECHEC = 'canal indisponible (transport de test)';

/**
 * Injecte un transport dont chaque publication réussit — ou échoue de bout en bout, comme le
 * ferait Firebase sur un refus de règles : `{ok:false}` rendu à l'appelant ET signalé aux
 * handlers `onError`, exactement les deux canaux du vrai transport.
 *
 * @param {import('@playwright/test').Page} page
 * @param {boolean} echoue
 */
async function installerTransport(page, echoue) {
  await page.addInitScript((doitEchouer) => {
    class TransportDeTest {
      constructor() {
        /** @type {Set<(err: unknown) => void>} */
        this.handlers = new Set();
        /** @type {any[]} */
        this.publies = [];
      }
      async connect() {}
      /** @param {any} event */
      async publish(event) {
        this.publies.push(event);
        if (!doitEchouer) return { ok: true };
        const error = new Error('canal indisponible (transport de test)');
        for (const handler of this.handlers) handler(error);
        return { ok: false, error };
      }
      subscribe() {
        return () => {};
      }
      async snapshot() {
        return {};
      }
      async saveSnapshot() {}
      /** @param {(err: unknown) => void} handler */
      onError(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
      }
      isOwnEvent() {
        return false;
      }
      disconnect() {}
    }
    /** @type {any} */ (window).__RPG_APP_OPTIONS__ = { transport: new TransportDeTest() };
  }, echoue);
}

/**
 * Monte la vue MJ en interceptant le catalogue et la scène.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{catalog?: any, scene?: any, catalogStatus?: number, sceneStatus?: number,
 *   transport?: 'aucun'|'ok'|'echec'}} [fixtures]
 * @returns {Promise<string[]>} erreurs de page collectées
 */
async function setupWithCatalog(page, fixtures = {}) {
  const {
    catalog = FAKE_CATALOG,
    scene = FAKE_SCENE,
    catalogStatus = 200,
    sceneStatus = 200,
    transport = 'aucun',
  } = fixtures;

  if (transport !== 'aucun') {
    await installerTransport(page, transport === 'echec');
  }

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

  test('E-9 — une publication qui échoue interdit l’annonce « ✓ chargée »', async ({ page }) => {
    await setupWithCatalog(page, { transport: 'echec' });

    await page.click('.scene-card-load');

    const statut = page.locator('.scene-library-status');
    await expect(statut).toContainText('NON transmise à la table');
    await expect(statut).toContainText(MESSAGE_ECHEC);
    // Le faux succès est précisément ce qui a laissé passer le défaut de canal.
    await expect(statut).not.toContainText('✓');

    // Le store, lui, a bien été chargé côté MJ : le message dit la vérité des deux côtés.
    const chargee = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel()?.id ?? null;
    });
    expect(chargee).toBe('minimal-level');
  });

  test('E-9 — une publication qui réussit annonce toujours « ✓ chargée »', async ({ page }) => {
    await setupWithCatalog(page, { transport: 'ok' });

    await page.click('.scene-card-load');

    await expect(page.locator('.scene-library-status')).toContainText('✓');
    await expect(page.locator('.scene-library-status')).toContainText('chargée');
  });

  test('E-9 — un échec de publication se voit sur le badge réseau du MJ', async ({ page }) => {
    await setupWithCatalog(page, { transport: 'echec' });

    // Avant la publication, le badge annonce une session saine.
    await expect(page.locator('#network-status-gm')).not.toContainText('Erreur réseau');

    await page.click('.scene-card-load');

    // L'effet observable est le message réellement affiché à la table, pas un drapeau interne.
    await expect(page.locator('#network-status-gm')).toContainText(
      `Erreur réseau — ${MESSAGE_ECHEC}`
    );
  });

  test('un catalogue corrompu laisse la bibliothèque indisponible et visible en erreur', async ({
    page,
  }) => {
    await setupWithCatalog(page, { catalog: { version: 99, maps: 'pas-un-tableau' } });

    await expect(page.locator('.scene-library-status')).toContainText('indisponible');
    await expect(page.locator('.scene-card')).toHaveCount(0);
  });
});
