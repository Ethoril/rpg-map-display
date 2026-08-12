// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Catalogue de pions de test.
 */
const FAKE_TOKEN_CATALOG = {
  version: 1,
  tokens: [
    {
      id: 'goblin-scout',
      name: 'Éclaireur Goblinoïde',
      imageUrl: 'maps/tokens/goblin.webp',
      kind: 'npc',
      sizeCells: 1,
      speedCells: 3,
      visionBright: 5,
      visionDim: 10,
      emitsLight: { range: 3, intensity: 0.5, color: '#ffaa00' },
      borderColor: '#e74c3c',
    },
  ],
};

const FAKE_LEVEL = {
  id: 'rdc-level',
  name: 'Rez-de-chaussée',
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 140,
  widthCells: 10,
  heightCells: 8,
  grid: { type: /** @type {import('../js/core/types.js').GridType} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { color: '#ffffff', level: 1, baked: false },
};

test.describe('Chantier I — Bibliothèque de pions (tokenLibrary)', () => {
  test.beforeEach(async ({ page }) => {
    // Intercepter catalog.json de pions
    await page.route('**/maps/tokens/catalog.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FAKE_TOKEN_CATALOG),
      })
    );
  });

  test('1. Affiche le pion dans la bibliothèque et instancie un pion pré-réglé sur l’étage actif', async ({ page }) => {
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/gm.html');

    // S'assurer qu'un étage est actif dans le store
    await page.evaluate(async (lvl) => {
      const store = await import('../js/state/store.js');
      store.addLevel(lvl);
    }, FAKE_LEVEL);

    await page.waitForSelector('.gm-tab-btn[data-tab="token-maker"]');
    await page.click('.gm-tab-btn[data-tab="token-maker"]');

    // Vérifier la présence du pion dans la bibliothèque
    await expect(page.locator('.token-card')).toHaveCount(1);
    await expect(page.locator('.token-card-name')).toHaveText('Éclaireur Goblinoïde');

    // Instanciation initiale sur l'étage actif
    await page.click('.token-card-instantiate');

    // Statut visuel confirmation
    await expect(page.locator('.token-library-status')).toContainText('instancié');

    // Vérifier les valeurs exactes dans le store
    const addedToken = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const tokens = store.getCampaign()?.tokens ?? [];
      return tokens.find((t) => t.label === 'Éclaireur Goblinoïde') || null;
    });

    expect(addedToken).not.toBeNull();
    expect(addedToken?.label).toBe('Éclaireur Goblinoïde');
    expect(addedToken?.imageUrl).toBe('maps/tokens/goblin.webp');
    expect(addedToken?.kind).toBe('npc');
    expect(addedToken?.sizeCells).toBe(1);
    expect(addedToken?.speedCells).toBe(3);
    expect(addedToken?.visionBright).toBe(5);
    expect(addedToken?.visionDim).toBe(10);
    expect(addedToken?.emitsLight).toEqual({ range: 3, intensity: 0.5, color: '#ffaa00' });
    expect(addedToken?.borderColor).toBe('#e74c3c');

    expect(pageErrors).toEqual([]);
  });

  test('2. Instanciation sans étage actif : refusée bruyamment sans muter le store', async ({ page }) => {
    await page.goto('/gm.html');

    // Vider la campagne / étages dans le store
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.loadCampaign({
        schemaVersion: 2,
        campaignId: 'empty-campaign',
        name: 'Campagne sans étage',
        levels: [],
        links: [],
        tokens: [],
        templates: [],
        settings: {},
      });
    });

    await page.waitForSelector('.gm-tab-btn[data-tab="token-maker"]');
    await page.click('.gm-tab-btn[data-tab="token-maker"]');

    await page.click('.token-card-instantiate');

    // Refus visible
    await expect(page.locator('.token-library-status')).toContainText('aucun étage actif');

    // Store inchangé
    const tokenCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getCampaign()?.tokens?.length ?? 0;
    });

    expect(tokenCount).toBe(0);
  });

  test('3. Catalogue corrompu : bibliothèque indisponible et erreur visible', async ({ page }) => {
    await page.route('**/maps/tokens/catalog.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 99, tokens: 'invalide' }),
      })
    );

    await page.goto('/gm.html');
    await page.waitForSelector('.gm-tab-btn[data-tab="token-maker"]');
    await page.click('.gm-tab-btn[data-tab="token-maker"]');

    await expect(page.locator('.token-library-status')).toContainText('indisponible');
    await expect(page.locator('.token-card')).toHaveCount(0);
  });

  test('4. Image de démonstration se décode réellement (naturalWidth > 0)', async ({ page }) => {
    await page.goto('/gm.html');
    await page.waitForSelector('.gm-tab-btn[data-tab="token-maker"]');
    await page.click('.gm-tab-btn[data-tab="token-maker"]');

    await page.waitForSelector('.token-card-image');

    const imageLoaded = await page.evaluate(async () => {
      const img = /** @type {HTMLImageElement} */ (document.querySelector('.token-card-image'));
      if (!img) return false;
      if (img.complete) return img.naturalWidth > 0;
      return new Promise((resolve) => {
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
      });
    });

    expect(imageLoaded).toBe(true);
  });

  test('5. Le pion instancié arrive chez un second client via token.add', async ({ context }) => {
    const sessionId = `test-token-library-sync-${Date.now()}`;

    // Les deux pages démarrent sur la même campagne : sans étage actif,
    // l'instanciation serait refusée (cf. test 2) et l'on testerait le refus.
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'sync-campaign',
        name: 'Campagne de synchronisation',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: null,
    };

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    // Le `beforeEach` ne route que la page par défaut : ces deux pages-ci sont
    // créées à la main, il faut les router explicitement.
    for (const p of [pageGM, pagePlayer]) {
      await p.route('**/maps/tokens/catalog.json', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(FAKE_TOKEN_CATALOG),
        })
      );
      await installBrowserTransport(p, sessionId, snapshot);
    }

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');
    await expect(pageGM.locator('.token-card')).toHaveCount(1);
    await pageGM.click('.token-card-instantiate');

    // Le seul chemin entre les deux pages est le canal du navigateur : aucun
    // relais par le test. Attente de condition et non de durée.
    await expect
      .poll(() =>
        pagePlayer.evaluate(async () => {
          const store = await import('../js/state/store.js');
          const tokens = store.getCampaign()?.tokens ?? [];
          const token = tokens.find((t) => t.label === 'Éclaireur Goblinoïde');
          return token
            ? {
                sizeCells: token.sizeCells,
                speedCells: token.speedCells,
                visionBright: token.visionBright,
                visionDim: token.visionDim,
                borderColor: token.borderColor,
                imageUrl: token.imageUrl,
                levelId: token.levelId,
              }
            : null;
        })
      )
      .toEqual({
        sizeCells: 1,
        speedCells: 3,
        visionBright: 5,
        visionDim: 10,
        borderColor: '#e74c3c',
        imageUrl: 'maps/tokens/goblin.webp',
        levelId: FAKE_LEVEL.id,
      });

    // Et vérifier que c'est bien `token.add` qui a transité, sans image embarquée.
    const published = await pageGM.evaluate(
      () => /** @type {any} */ (window).__RPG_TEST_WIRE__.published
    );
    const addEvents = published.filter((/** @type {any} */ e) => e.type === 'token.add');
    expect(addEvents).toHaveLength(1);
    expect(JSON.stringify(addEvents[0])).not.toContain('data:');
    expect(JSON.stringify(addEvents[0])).not.toContain('base64');

    await pageGM.close();
    await pagePlayer.close();
  });
});
