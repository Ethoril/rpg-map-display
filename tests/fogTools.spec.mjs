// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';
import { createCampaign, createLevel } from '../js/core/schema.js';

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
          ambient: { level: 1, baked: false },
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
      settings: {},
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
  await page.click('#gm-rail-fog-tools');

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

  await page.click('#gm-rail-fog-tools');

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

  await page.click('#gm-rail-fog-tools');
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

  await page.click('#gm-rail-fog-tools');

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

// ── Audit du 08/11/2026 : courses entre gestes, chargement et publication du brouillard ───────

// A10 — un geste fait pendant le décodage du masque enregistré est rejoué par-dessus, pas effacé.
test('A10 : une révélation manuelle survit au chargement tardif du brouillard', async ({ browser }) => {
  const sid = `audit-fog-race-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level] }), activeLevelId: 'a' };
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('/');
    const originalPng = await page.evaluate(async sessionId => {
      const { ExploredFog } = await import('../js/vision/fog.js');
      const fog = new ExploredFog(10, 8);
      const png = await fog.exportPng();
      localStorage.setItem(`rpg_fog_${sessionId}_a`, png);
      return png;
    }, sid);
    await page.addInitScript(() => {
      const Original = window.DecompressionStream;
      /** @type {any} */ (window).__auditNativeDecompression = Original;
      /** @type {any} */ (window).__auditFogGate = {};
      const gate = new Promise(resolve => { /** @type {any} */ (window).__auditFogGate.release = resolve; });
      /** @type {any} */ (window).DecompressionStream = class {
        /** @param {CompressionFormat} format */
        constructor(format) {
          const actual = new Original(format);
          this.writable = actual.writable;
          this.readable = actual.readable.pipeThrough(new TransformStream({
            async transform(chunk, controller) {
              /** @type {any} */ (window).__auditFogGate.waiting = true;
              await gate;
              controller.enqueue(chunk);
            },
          }));
        }
      };
    });
    await installBrowserTransport(page, sid, snapshot);
    await page.goto(`/gm.html?session=${sid}`);
    await waitForApp(page);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__auditFogGate.waiting)).toBe(true);
    const fogPublies = () => page.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'fog.update').length);
    const publiesAvant = await fogPublies();
    await page.click('#gm-rail-fog-tools');
    await page.click('#fog-btn-reveal-all');
    // A2 : tant que le masque enregistré n'est pas posé, rien ne part — pas même ce geste, dont
    // l'export livrerait un masque où l'exploré enregistré manque.
    await page.waitForTimeout(1500);
    expect(await fogPublies(), 'rien publié pendant le chargement du masque').toBe(publiesAvant);
    expect(await page.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('a')), 'le masque enregistré reste en place').toBe(originalPng);
    await page.evaluate(() => /** @type {any} */ (window).__auditFogGate.release());
    await page.waitForTimeout(1500);
    const alpha = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const { decodeFogPng } = await import('../js/vision/fog.js');
      const png = store.getSessionFog('a');
      const canvas = await decodeFogPng(png || '', 10, 8);
      return canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBe(255);
    expect(await fogPublies(), 'publié à l’arrivée du masque, geste rejoué').toBeGreaterThan(publiesAvant);
  } finally {
    await context.close();
  }
});

// A10, suite — un import dépassé (un « Annuler » pendant le chargement) ne réécrit rien à son
// arrivée : le masque le plus récemment importé l'emporte.
test('A10 : un import plus ancien, arrivé après un plus récent, ne l’écrase pas', async ({ page }) => {
  await page.goto('/');
  const alpha = await page.evaluate(async () => {
    const { ExploredFog } = await import('../js/vision/fog.js');
    const fog = new ExploredFog(4, 4);
    const vide = await fog.exportPng();
    fog.revealAll();
    const plein = await fog.exportPng();
    fog.clear();
    // Seule la PREMIÈRE décompression est retenue : l'import de « plein » finira après celui de « vide ».
    const Native = window.DecompressionStream;
    /** @type {() => void} */
    let relacher = () => {};
    const verrou = new Promise((ok) => { relacher = () => ok(undefined); });
    let n = 0;
    /** @type {any} */ (window).DecompressionStream = class {
      /** @param {CompressionFormat} format */
      constructor(format) {
        const actual = new Native(format);
        this.writable = actual.writable;
        this.readable = ++n === 1
          ? actual.readable.pipeThrough(new TransformStream({ async transform(c, ctl) { await verrou; ctl.enqueue(c); } }))
          : actual.readable;
      }
    };
    const ancien = fog.importPng(plein);
    await fog.importPng(vide);
    relacher();
    await ancien;
    window.DecompressionStream = Native;
    return fog.canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3];
  });
  expect(alpha, 'le masque vide, importé en dernier, reste').toBe(0);
});

// A11 — deux publications successives : seule la plus récente capture sort, même si l'ancienne
// finit son encodage après.
test('A11 : une publication tardive ne rétablit pas un brouillard remplacé', async ({ browser }) => {
  const sid = `audit-fog-export-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level] }), activeLevelId: 'a' };
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await installBrowserTransport(page, sid, snapshot);
    await page.goto(`/gm.html?session=${sid}`);
    await waitForApp(page);
    await expect.poll(() => page.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('a'))).toBeTruthy();
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const Native = window.CompressionStream;
      const w = /** @type {any} */ (window);
      w.__auditCompression = { count: 0, waiting: false, release: null };
      const gate = new Promise(resolve => { w.__auditCompression.release = resolve; });
      /** @type {any} */ (window).CompressionStream = class {
        /** @param {CompressionFormat} format */
        constructor(format) {
          const actual = new Native(format);
          this.writable = actual.writable;
          const number = ++w.__auditCompression.count;
          this.readable = number === 2 ? actual.readable.pipeThrough(new TransformStream({
            async transform(chunk, controller) {
              w.__auditCompression.waiting = true;
              await gate;
              controller.enqueue(chunk);
            },
          })) : actual.readable;
        }
      };
      w.__auditFogPublications = w.__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'fog.update').length;
    });
    await page.click('#gm-rail-fog-tools');
    await page.click('#fog-btn-reveal-all');
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__auditCompression.waiting)).toBe(true);
    await page.click('#fog-btn-hide-all');
    await expect.poll(() => page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w.__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'fog.update').length;
    })).toBeGreaterThan(await page.evaluate(() => /** @type {any} */ (window).__auditFogPublications));
    await page.evaluate(() => /** @type {any} */ (window).__auditCompression.release());
    await page.waitForTimeout(500);
    const alpha = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const { decodeFogPng } = await import('../js/vision/fog.js');
      const canvas = await decodeFogPng(store.getSessionFog('a') || '', 10, 8);
      return canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBe(0);
  } finally {
    await context.close();
  }
});
