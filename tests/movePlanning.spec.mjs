// @ts-check
import { test, expect } from '@playwright/test';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/** @typedef {import('@playwright/test').Browser} Browser */
/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('../js/core/types.js').Cell} Cell */

const START = { a: 2, b: 2 };
const LEVEL_ID = 'rdc';
const TOKEN_ID = 'hero-preview';

/** @param {{door?:boolean,npcOutsideFog?:boolean}} [options] */
function makeSnapshot({ door = false, npcOutsideFog = false } = {}) {
  const level = createLevel({
    id: LEVEL_ID,
    name: 'RDC',
    imageUrl: 'maps/minimal.webp',
    widthCells: 10,
    heightCells: 8,
    pxPerCell: 140,
    ambient: { level: 0, baked: false },
    portals: door ? [{
      id: 'door-preview',
      a: { cellX: 3, cellY: 2 },
      b: { cellX: 3, cellY: 3 },
      state: 'open',
      freestanding: true,
    }] : [],
  });
  const token = createToken({
    id: TOKEN_ID,
    levelId: LEVEL_ID,
    cell: START,
    kind: 'pc',
    imageUrl: 'maps/minimal.webp',
    speedCells: 3,
    visionDim: 2,
    playerMovable: true,
  });
  const tokens = [token];
  if (npcOutsideFog) {
    tokens.push(createToken({
      id: 'npc-outside-fog',
      levelId: LEVEL_ID,
      cell: { a: 8, b: 6 },
      kind: 'npc',
      imageUrl: 'maps/minimal.webp',
      speedCells: 3,
      visionDim: 1,
    }));
  }
  return {
    campaign: createCampaign({ campaignId: 'move-preview-e2e', name: 'Aperçus', levels: [level], tokens }),
    activeLevelId: LEVEL_ID,
    selectedTokenId: null,
  };
}

/** @param {Browser} browser @param {{door?:boolean,npcOutsideFog?:boolean}} [options] */
async function openPair(browser, { door = false, npcOutsideFog = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const gm = await context.newPage();
  const player = await context.newPage();
  const sessionId = `move-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const snapshot = makeSnapshot({ door, npcOutsideFog });
  await Promise.all([
    installBrowserTransport(gm, sessionId, snapshot),
    installBrowserTransport(player, sessionId, snapshot),
  ]);
  await Promise.all([
    gm.goto(`/gm.html?session=${sessionId}`),
    player.goto(`/player.html?session=${sessionId}`),
  ]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);
  await Promise.all([instrumentMovePlanLayer(gm), instrumentMovePlanLayer(player)]);
  return { context, gm, player, sessionId };
}

/** @param {Page} page */
async function instrumentMovePlanLayer(page) {
  await page.evaluate(async () => {
    const { MovePlanLayer } = await import('../js/render/layers/movePlan.js');
    const original = MovePlanLayer.prototype.render;
    /** @type {any} */ (window).__movePlanRenderCounts = [];
    /** @this {InstanceType<typeof MovePlanLayer>} @param {Parameters<typeof original>} args @returns {ReturnType<typeof original>} */
    const wrappedRender = function (...args) {
      const count = original.apply(this, args);
      /** @type {any} */ (window).__movePlanRenderCounts.push(count);
      return count;
    };
    MovePlanLayer.prototype.render = wrappedRender;
  });
}

/** @param {Page} page @param {Cell} cell */
async function screenPoint(page, cell) {
  return page.evaluate(/** @param {Cell} target */ async (target) => {
    const [{ gridFor }, store] = await Promise.all([
      import('../js/grid/index.js'),
      import('../js/state/store.js'),
    ]);
    const level = store.getActiveLevel();
    if (!level) throw new Error('Étage actif absent');
    const app = /** @type {any} */ (window).__RPG_APP__;
    const point = app.camera.mapToScreen(gridFor(level).pointFromCell(target));
    const rect = app.canvas.getBoundingClientRect();
    return { screenX: point.screenX + rect.left, screenY: point.screenY + rect.top };
  }, cell);
}

/** @param {Page} page @param {Cell} cell */
async function tapCell(page, cell) {
  const point = await screenPoint(page, cell);
  await page.mouse.click(point.screenX, point.screenY);
}

/** @param {Page} player @param {string} gmClientId */
async function addGmPresenceToPlayer(player, gmClientId) {
  await player.evaluate(/** @param {string} clientId */ async (clientId) => {
    const { updatePresence } = await import('../js/state/presence.js');
    updatePresence(clientId, { role: 'gm', at: Date.now(), build: 1, label: 'MJ' });
  }, gmClientId);
}

/** @param {Page} page @param {string} sessionId */
async function readSharedPreviews(page, sessionId) {
  return page.evaluate(/** @param {string} sid */ async (sid) =>
    /** @type {any} */ (window).__rpgTestMovePreviews('get', sid, 'test-reader', null), sessionId);
}

/** @param {Page} page @param {'visible'|'explored'} kind */
async function canvasPixelSignature(page, kind) {
  return page.evaluate(/** @param {'visible'|'explored'} which */ async (which) => {
    const store = await import('../js/state/store.js');
    const app = /** @type {any} */ (window).__RPG_APP__;
    const level = store.getActiveLevel();
    const canvas = which === 'visible'
      ? app.getPlayerVisibleCanvas(level)
      : app.getPlayerExploredCanvas(level);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (const value of pixels) {
      first = Math.imul(first ^ value, 16777619) >>> 0;
      second = (Math.imul(second ^ value, 2246822519) + 3266489917) >>> 0;
    }
    return `${width}x${height}:${first.toString(16)}:${second.toString(16)}`;
  }, kind);
}

/** @param {Page} page @param {'visible'|'explored'} kind */
async function currentMaskObservation(page, kind) {
  return page.evaluate(/** @param {'visible'|'explored'} which */ async (which) => {
    const store = await import('../js/state/store.js');
    const { decodeFogPng } = await import('../js/vision/fog.js');
    const app = /** @type {any} */ (window).__RPG_APP__;
    const level = store.getActiveLevel();
    if (!level) return null;
    const png = which === 'visible'
      ? store.getSessionVision(level.id)
      : store.getSessionFog(level.id);
    const canvas = which === 'visible'
      ? app.getPlayerVisibleCanvas(level)
      : app.getPlayerExploredCanvas(level);
    if (!png || !canvas) return null;
    const expected = await decodeFogPng(png, level.widthCells, level.heightCells);
    if (!expected) return null;
    /** @param {any} source */
    const signature = (source) => {
      const ctx = source.getContext('2d');
      if (!ctx) return null;
      const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
      let first = 2166136261;
      let second = 0x9e3779b9;
      for (const value of pixels) {
        first = Math.imul(first ^ value, 16777619) >>> 0;
        second = (Math.imul(second ^ value, 2246822519) + 3266489917) >>> 0;
      }
      return `${source.width}x${source.height}:${first.toString(16)}:${second.toString(16)}`;
    };
    return { actual: signature(canvas), decodedCurrentPng: signature(expected) };
  }, kind);
}

/** @param {Page} player */
async function waitForActualVisionCanvases(player) {
  await player.evaluate(async () => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    await app.transport.publish({ type: 'vision.request', payload: {}, at: Date.now(), by: 'players' });
  });
  // Le fog initial est publié avec un délai trailing d'une seconde et son décodage est asynchrone.
  // L'accesseur de canvas peut alors rendre son ancien cache tout en décodant le PNG courant.
  // Attendre le décodage exact du PNG stocké, puis 1,2 s sans changement, garantit que le
  // baseline pris ensuite représente les masques finaux de la session, pas un canvas provisoire.
  /** @type {string|null} */
  let signatureStable = null;
  let stableSince = 0;
  await expect.poll(async () => {
    const observations = await Promise.all([
      currentMaskObservation(player, 'visible'),
      currentMaskObservation(player, 'explored'),
    ]);
    if (observations.some((observation) =>
      !observation || !observation.actual || observation.actual !== observation.decodedCurrentPng
    )) {
      signatureStable = null;
      stableSince = Date.now();
      return false;
    }
    const current = observations.map((observation) => observation?.actual).join('|');
    if (current !== signatureStable) {
      signatureStable = current;
      stableSince = Date.now();
      return false;
    }
    return Date.now() - stableSince >= 1200;
  }, { timeout: 15000, intervals: [100, 200] }).toBe(true);
}

test('le MJ prépare et valide un trajet rendu sur les deux vues sans toucher à la vision avant validation', async ({ browser }) => {
  const { context, gm, player, sessionId } = await openPair(browser);
  try {
    await waitForActualVisionCanvases(player);
    const gmClientId = await gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.transport.getClientId());
    await addGmPresenceToPlayer(player, gmClientId);

    await tapCell(gm, START);
    await expect.poll(() => gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBe(TOKEN_ID);
    await expect.poll(() => gm.evaluate(() => Boolean(/** @type {any} */ (window).__RPG_TEST_WIRE__.savedSnapshot))).toBe(true);
    const persistedBeforePreview = await gm.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.savedSnapshot);
    const signaturesBeforePreview = await Promise.all([
      canvasPixelSignature(player, 'visible'),
      canvasPixelSignature(player, 'explored'),
    ]);
    await tapCell(gm, { a: 3, b: 2 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(gm, sessionId)).length).toBe(1);
    expect(await Promise.all([
      canvasPixelSignature(player, 'visible'),
      canvasPixelSignature(player, 'explored'),
    ])).toEqual(signaturesBeforePreview);
    await tapCell(gm, { a: 3, b: 3 });
    await expect.poll(async () => {
      const previews = await readSharedPreviews(gm, sessionId);
      return Object.values(previews)[0]?.revision;
    }).toBe(2);

    const gmPreview = Object.values(await readSharedPreviews(gm, sessionId))[0];
    expect(gmPreview).toMatchObject({
      levelId: LEVEL_ID,
      tokenId: TOKEN_ID,
      start: START,
      path: [START, { a: 3, b: 2 }, { a: 3, b: 3 }],
      destination: { a: 3, b: 3 },
      remaining: 1,
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__movePlanRenderCounts.some((/** @type {number} */ count) => count > 0))).toBe(true);
    await expect.poll(() => player.evaluate(() => /** @type {any} */ (window).__movePlanRenderCounts.some((/** @type {number} */ count) => count > 0))).toBe(true);
    expect(await Promise.all([
      canvasPixelSignature(player, 'visible'),
      canvasPixelSignature(player, 'explored'),
    ])).toEqual(signaturesBeforePreview);

    const beforeCommit = await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
      return {
        cell: store.getCampaign()?.tokens.find((token) => token.id === 'hero-preview')?.cell,
        snapshot: wire.savedSnapshot,
      };
    });
    expect(beforeCommit.cell).toEqual(START);
    expect(beforeCommit.snapshot).toBeTruthy();
    expect(beforeCommit.snapshot).toBe(persistedBeforePreview);
    const parsedSnapshot = JSON.parse(beforeCommit.snapshot);
    expect(parsedSnapshot.movePreviews).toBeUndefined();
    expect(JSON.stringify(parsedSnapshot)).not.toContain(gmPreview.planId);

    // Confirmer l'arrivée valide le plan ; le contrôleur publie alors un unique token.move.
    await tapCell(gm, { a: 3, b: 3 });
    const committed = await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
      return {
        token: store.getCampaign()?.tokens.find((item) => item.id === 'hero-preview'),
        selected: store.getState().selectedTokenId,
        moves: wire.published.filter((/** @type {any} */ event) => event.type === 'token.move'),
      };
    });
    expect(committed.token?.cell).toEqual({ a: 3, b: 3 });
    expect(committed.selected).toBeNull();
    expect(committed.moves).toHaveLength(1);
    expect(committed.moves[0].payload.path).toEqual([START, { a: 3, b: 2 }, { a: 3, b: 3 }]);
    await expect.poll(async () => Object.keys(await readSharedPreviews(player, sessionId))).toHaveLength(0);
    await expect.poll(() => player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getCampaign()?.tokens.find((item) => item.id === 'hero-preview')?.cell;
    })).toEqual({ a: 3, b: 3 });
    await expect.poll(async () => {
      const after = await Promise.all([
        canvasPixelSignature(player, 'visible'),
        canvasPixelSignature(player, 'explored'),
      ]);
      return after.some((signature, index) => signature !== signaturesBeforePreview[index]);
    }, { timeout: 7000 }).toBe(true);
  } finally {
    await context.close();
  }
});

test('le joueur annule un tap hors zone, conserve sa sélection puis désélectionne sur le second tap', async ({ browser }) => {
  const { context, player, sessionId } = await openPair(browser);
  try {
    await tapCell(player, START);
    await expect.poll(() => player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBe(TOKEN_ID);
    await tapCell(player, { a: 1, b: 2 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(player, sessionId)).length).toBe(1);

    // (5,2) est à trois cases du départ mais à quatre de l'arrivée (1,2) : il est hors de
    // la capacité cumulative courante et doit annuler sans perdre la sélection.
    await tapCell(player, { a: 5, b: 2 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(player, sessionId))).toHaveLength(0);
    const selectedAfterCancel = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    });
    expect(selectedAfterCancel).toBe(TOKEN_ID);

    // La même case redevient atteignable depuis le départ restauré. Le second tap sert à
    // confirmer la désélection, pas à lancer un nouveau trajet.
    await tapCell(player, { a: 5, b: 2 });
    await expect.poll(() => player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBeNull();
    const events = await player.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published);
    expect(events.filter((/** @type {any} */ event) => event.type === 'token.move')).toHaveLength(0);
    expect(await readSharedPreviews(player, sessionId)).toEqual({});
  } finally {
    await context.close();
  }
});

test('masquer le personnage pendant sa préparation annule et désélectionne avant une ancienne destination', async ({ browser }) => {
  const { context, gm, player, sessionId } = await openPair(browser);
  try {
    await waitForActualVisionCanvases(player);
    const startIsVisible = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const { gridFor } = await import('../js/grid/index.js');
      const { getOrExtractMaskAlpha, isCellVisibleInMask } = await import('../js/vision/fog.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      const level = store.getActiveLevel();
      if (!level) return false;
      const mask = getOrExtractMaskAlpha(app.getPlayerVisibleCanvas(level), level.widthCells, level.heightCells);
      return isCellVisibleInMask({ a: 2, b: 2 }, mask, level.widthCells, level.heightCells, level.grid.type, gridFor(level).maskLatticeShift());
    });
    expect(startIsVisible).toBe(true);

    await tapCell(player, START);
    await expect.poll(() => player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBe(TOKEN_ID);
    await tapCell(player, { a: 3, b: 2 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(player, sessionId)).length).toBe(1);

    await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      store.updateToken('hero-preview', { hidden: true });
      await app.transport.publish({
        type: 'token.update',
        payload: { tokenId: 'hero-preview', patch: { hidden: true } },
        at: Date.now(),
        by: 'gm',
      });
    });
    await expect.poll(() => player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBeNull();
    await expect.poll(async () => Object.keys(await readSharedPreviews(player, sessionId))).toHaveLength(0);

    await tapCell(player, { a: 3, b: 2 });
    const afterOldDestinationTap = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
      return {
        token: store.getCampaign()?.tokens.find((item) => item.id === 'hero-preview'),
        selected: store.getState().selectedTokenId,
        moves: wire.published.filter((/** @type {any} */ event) => event.type === 'token.move'),
      };
    });
    expect(afterOldDestinationTap.token?.cell).toEqual(START);
    expect(afterOldDestinationTap.token?.hidden).toBe(true);
    expect(afterOldDestinationTap.selected).toBeNull();
    expect(afterOldDestinationTap.moves).toHaveLength(0);
  } finally {
    await context.close();
  }
});

test('un aperçu de PNJ dont la case est hors du masque publié reste invisible sur la vue joueurs', async ({ browser }) => {
  const { context, gm, player, sessionId } = await openPair(browser, { npcOutsideFog: true });
  try {
    await waitForActualVisionCanvases(player);
    const gmClientId = await gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.transport.getClientId());
    await addGmPresenceToPlayer(player, gmClientId);
    const ownerIsVisible = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const { gridFor } = await import('../js/grid/index.js');
      const { getOrExtractMaskAlpha, isCellVisibleInMask } = await import('../js/vision/fog.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      const level = store.getActiveLevel();
      if (!level) return null;
      const mask = getOrExtractMaskAlpha(
        app.getPlayerVisibleCanvas(level), level.widthCells, level.heightCells
      );
      return isCellVisibleInMask(
        { a: 8, b: 6 }, mask, level.widthCells, level.heightCells,
        level.grid.type, gridFor(level).maskLatticeShift()
      );
    });
    expect(ownerIsVisible).toBe(false);
    await player.evaluate(() => { /** @type {any} */ (window).__movePlanRenderCounts = []; });

    await tapCell(gm, { a: 8, b: 6 });
    await expect.poll(() => gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBe('npc-outside-fog');
    await tapCell(gm, { a: 9, b: 6 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(gm, sessionId)).length).toBe(1);
    await expect.poll(() => player.evaluate(() => /** @type {any} */ (window).__movePlanRenderCounts.length)).toBeGreaterThan(0);
    const renderedCounts = await player.evaluate(() => /** @type {any} */ (window).__movePlanRenderCounts);
    expect(renderedCounts.every((/** @type {number} */ count) => count === 0)).toBe(true);
  } finally {
    await context.close();
  }
});

test('une porte refermée ou une position changée invalide la préparation et retire son aperçu', async ({ browser }) => {
  const { context, gm, sessionId } = await openPair(browser, { door: true });
  try {
    await tapCell(gm, START);
    await expect.poll(() => gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getState().selectedTokenId;
    })).toBe(TOKEN_ID);

    await tapCell(gm, { a: 3, b: 2 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(gm, sessionId)).length).toBe(1);
    await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.setPortalState('rdc', 'door-preview', 'closed');
    });
    await expect.poll(async () => Object.keys(await readSharedPreviews(gm, sessionId))).toHaveLength(0);

    await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.setPortalState('rdc', 'door-preview', 'open');
    });
    await tapCell(gm, { a: 3, b: 2 });
    await expect.poll(async () => Object.keys(await readSharedPreviews(gm, sessionId)).length).toBe(1);
    await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.moveTokenToCell('hero-preview', { a: 2, b: 3 });
    });
    await expect.poll(async () => Object.keys(await readSharedPreviews(gm, sessionId))).toHaveLength(0);
    const afterPositionChange = await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return {
        cell: store.getCampaign()?.tokens.find((token) => token.id === 'hero-preview')?.cell,
        selected: store.getState().selectedTokenId,
      };
    });
    expect(afterPositionChange.cell).toEqual({ a: 2, b: 3 });
    expect(afterPositionChange.selected).toBe(TOKEN_ID);
  } finally {
    await context.close();
  }
});
