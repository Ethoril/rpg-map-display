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
  ambient: { level: 1, baked: false },
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

  test('1. « Instancier » ARME la pose (UX-08) — aucun pion tant que le MJ n’a pas tapé la case', async ({ page }) => {
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const sessionId = `test-tokenlib-arm-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

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

    await page.click('.token-card-instantiate');

    // Statut visuel : prêt à poser, pas « instancié » — ce serait faux tant que rien n'est posé.
    await expect(page.locator('.token-library-status')).toContainText('prêt');

    // ⭐ « Instancier » ARME, il n'ajoute rien à lui seul : c'est la moitié du critère, et un
    // code qui ajouterait ET armerait passerait au vert sans elle.
    const outilActif = () =>
      page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.getActiveToolName());
    const pions = () =>
      page.evaluate(async () => {
        const store = await import('../js/state/store.js');
        return (store.getCampaign()?.tokens ?? []).map((t) => ({ label: t.label, cell: t.cell }));
      });

    expect(await outilActif(), 'instancier doit armer la pose').toBe('token-place');
    expect(await pions(), 'instancier ne doit ajouter aucun pion à lui seul').toEqual([]);

    // Tap au centre d'une case précise : (3, 6) sur une grille à 140 px/case.
    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 3.5 * 140, y: 6.5 * 140 },
        screenPos: { x: 300, y: 300 },
      });
    });

    // ⭐ La case visée, précisément — pas seulement « différente de (0,0) », qui passerait au
    // vert sur un pion posé n'importe où ailleurs que l'angle.
    const poses = await pions();
    expect(poses.length, 'le tap doit avoir posé le pion').toBe(1);
    expect(poses[0].cell, 'le pion se pose sur la case tapée, exactement').toEqual({ a: 3, b: 6 });
    expect(await outilActif(), 'l’outil se désarme seul après la pose').toBe('none');

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
    expect(addedToken?.visionDim).toBe(10);
    expect(addedToken?.emitsLight).toEqual({ range: 3, intensity: 0.5, color: '#ffaa00' });
    expect(addedToken?.borderColor).toBe('#e74c3c');

    expect(pageErrors).toEqual([]);
  });

  test('1b. Armer depuis la bibliothèque désarme un outil précédemment armé (exclusivité mutuelle)', async ({ page }) => {
    const sessionId = `test-tokenlib-exclusivite-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async (lvl) => {
      const store = await import('../js/state/store.js');
      store.addLevel(lvl);
    }, FAKE_LEVEL);

    // Armer un autre outil d'abord (motif de tests/gmToolDisarm.spec.mjs).
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    let tool = await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('fog-reveal');

    await page.click('.gm-tab-btn[data-tab="token-maker"]');
    await page.click('.token-card-instantiate');

    tool = await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool, 'armer depuis la bibliothèque doit prendre la main').toBe('token-place');
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.fogTools?.getActiveTool()),
      'le pinceau de fog doit avoir été désarmé'
    ).toBe('none');
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

    // « Instancier » arme la pose : il faut taper la carte pour que le pion existe et se publie.
    await pageGM.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 3.5 * 140, y: 6.5 * 140 },
        screenPos: { x: 300, y: 300 },
      });
    });

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
        // ⛔ Plus de `visionBright` ici : retiré du modèle le 26/08/2026 (chantier Z).
        // ⭐ Le catalogue simulé en haut de fichier en porte toujours un : c'est voulu, et
        // c'est ce qui fait de ce scénario la preuve que le résidu sur disque est TOLÉRÉ
        // sans jamais ressusciter dans le pion projeté.
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
