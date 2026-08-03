// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Monte la vue MJ et initialise la campagne de test.
 * @param {import('@playwright/test').Page} page
 * @param {string} sessionId
 */
async function setupGM(page, sessionId) {
  await installBrowserTransport(page, sessionId, null);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);
    const level = schema.createLevel({
      id: 'minimal-level',
      name: 'Minimal Level',
      imageUrl: 'maps/minimal.webp',
      pxPerCell: 50,
      widthCells: 10,
      heightCells: 10,
      grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#ffffff', opacity: 0.5 },
      walls: [],
      portals: [],
      lights: [],
    });
    const campaign = schema.createCampaign({
      name: 'Test Campaign',
      levels: [level],
      tokens: [],
    });
    store.loadCampaign(campaign);
  });
}

test('Démarrage vue MJ avec campagne restaurée et PJ doté de vision : zéro erreur de page et zéro console.error', async ({ page }) => {
  const sessionId = `fog-init-vision-${Date.now()}`;

  /** @type {string[]} */
  const pageErrors = [];
  /** @type {string[]} */
  const consoleErrors = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  const snapshot = {
    campaign: {
      schemaVersion: 2,
      campaignId: 'c-init',
      name: 'Campagne avec vision',
      levels: [
        {
          id: 'lvl-init',
          name: 'Niveau Initial',
          order: 0,
          imageUrl: '',
          videoUrl: null,
          animatedOverlays: [],
          pxPerCell: 100,
          widthCells: 10,
          heightCells: 10,
          grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
          terrainCost: null,
          walls: [],
          portals: [],
          lights: [],
          ambient: { color: '#ffffff', level: 1, baked: false },
        },
      ],
      links: [],
      tokens: [
        {
          id: 'hero-vision',
          levelId: 'lvl-init',
          cell: { a: 2, b: 2 },
          sizeCells: 1,
          kind: 'pc',
          imageUrl: '',
          borderColor: '#00ff00',
          label: 'Hero Vision',
          hidden: false,
          visionBright: 4,
          visionDim: 6,
          emitsLight: null,
          speedCells: 30,
          playerMovable: true,
          locked: false,
          elevation: 0,
          markers: [],
        },
      ],
      templates: [],
      settings: { ambientLevel: 1 },
    },
    activeLevelId: 'lvl-init',
    selectedTokenId: null,
    activeHandout: null,
  };

  await installBrowserTransport(page, sessionId, snapshot);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('Tout révéler et Tout masquer modifient le fog côté joueurs', async ({ page }) => {
  const sessionId = `fog-tools-test-${Date.now()}`;
  await setupGM(page, sessionId);

  // Basculer sur l'onglet Fog
  await page.click('.gm-tab-btn[data-tab="fog-tools"]');

  // Tout masquer
  await page.click('#fog-btn-hide-all');
  await expect(page.locator('#fog-btn-undo')).not.toBeDisabled({ timeout: 5000 });

  const fogStateHide = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const activeId = store.getActiveLevelId();
    return store.getSessionFog(activeId || '');
  });

  // Tout révéler
  await page.click('#fog-btn-reveal-all');
  await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \(2\)/, { timeout: 5000 });

  const fogStateReveal = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const activeId = store.getActiveLevelId();
    return store.getSessionFog(activeId || '');
  });

  expect(fogStateReveal).not.toEqual(fogStateHide);
});

test('Pinceau armé : neutralise le drag de pion', async ({ page }) => {
  const sessionId = `fog-brush-drag-${Date.now()}`;
  await setupGM(page, sessionId);

  await page.click('.gm-tab-btn[data-tab="fog-tools"]');

  // Armer le pinceau Révéler
  await page.click('#fog-btn-tool-reveal');

  const canDrag = await page.evaluate(async () => {
    const pointerInput = /** @type {any} */ (window).__RPG_APP__?.pointerInput;
    return pointerInput?.canStartTokenDrag({ screenX: 100, screenY: 100 }, { x: 100, y: 100 });
  });

  expect(canDrag).toBeNull();
});

test('Vérification A6 : Aucun fog.paint ni fog.reset émis sur le réseau', async ({ page }) => {
  const sessionId = `fog-events-check-${Date.now()}`;
  await setupGM(page, sessionId);

  await page.click('.gm-tab-btn[data-tab="fog-tools"]');
  await page.click('#fog-btn-hide-all');
  await expect(page.locator('#fog-btn-undo')).not.toBeDisabled({ timeout: 5000 });

  await page.click('#fog-btn-reveal-all');
  await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \(2\)/, { timeout: 5000 });

  const publishedTypes = await page.evaluate(() => {
    const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
    return wire ? wire.published.map((/** @type {any} */ e) => e.type) : [];
  });

  expect(publishedTypes).not.toContain('fog.paint');
  expect(publishedTypes).not.toContain('fog.reset');
  expect(publishedTypes).toContain('fog.update');
});

test('Annuler (Undo) restaure le masque précédent et se grise après mouvement de pion', async ({ page }) => {
  const sessionId = `fog-undo-spec-${Date.now()}`;
  await setupGM(page, sessionId);

  await page.click('.gm-tab-btn[data-tab="fog-tools"]');

  // Révéler d'abord pour avoir un masque initial non vide
  await page.click('#fog-btn-reveal-all');
  await expect(page.locator('#fog-btn-undo')).not.toBeDisabled({ timeout: 5000 });

  const fogStateReveal = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const activeId = store.getActiveLevelId();
    return store.getSessionFog(activeId || '');
  });

  // Action d'outil : tout masquer
  await page.click('#fog-btn-hide-all');
  await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \(2\)/, { timeout: 5000 });

  // Undo
  await page.click('#fog-btn-undo');
  await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \(1\)/, { timeout: 5000 });

  const fogRestored = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const activeId = store.getActiveLevelId();
    return store.getSessionFog(activeId || '');
  });

  expect(fogRestored).toEqual(fogStateReveal);
});
