// @ts-check
import { test, expect } from '@playwright/test';
import {
  installBrowserTransport,
  waitForApp,
  waitForPlayerVision,
  setPlayerTestVision,
} from './browserTestTransport.mjs';

/**
 * Scénarios e2e — Tour de jeu, boutons de porte/liaison et annulation du mouvement (22/11/2026).
 *
 * Couvre CA1–CA13 et CA22–CA27 sur de vraies pages (`gm.html`, `player.html`), vrai Canvas et
 * vrai `BroadcastChannel` (`installBrowserTransport` + canal `wfrp-map-link` pour `mj.turn`).
 * Fixtures autonomes en tête de fichier : aucune lecture dans `maps/`.
 */

const PX = 100;

/**
 * Étage couloir 14 × 10 avec cloison verticale en x = 5 percée d'une porte `porte-1` entre (4,4)
 * et (5,4), plus une cloison secondaire en y = 7 avec porte `porte-2` entre (2,6) et (2,7).
 * @param {'closed'|'open'} [doorState]
 * @param {number} [ambientLevel]
 */
function niveauCouloir(doorState = 'closed', ambientLevel = 0) {
  return {
    id: 'rdc',
    name: 'Couloir',
    order: 0,
    imageUrl: '',
    videoUrl: null,
    animatedOverlays: [],
    pxPerCell: PX,
    widthCells: 14,
    heightCells: 10,
    grid: {
      type: /** @type {const} */ ('square'),
      offsetX: 0,
      offsetY: 0,
      color: '#000000',
      opacity: 0.25,
      visible: true,
    },
    terrainCost: null,
    walls: [
      [{ cellX: 5, cellY: 0 }, { cellX: 5, cellY: 4 }],
      [{ cellX: 5, cellY: 5 }, { cellX: 5, cellY: 10 }],
    ],
    portals: [
      {
        id: 'porte-1',
        a: { cellX: 5, cellY: 4 },
        b: { cellX: 5, cellY: 5 },
        state: doorState,
        freestanding: false,
      },
      {
        id: 'porte-2',
        a: { cellX: 2, cellY: 7 },
        b: { cellX: 3, cellY: 7 },
        state: 'closed',
        freestanding: false,
      },
    ],
    lights: [],
    ambient: { level: ambientLevel, baked: false },
  };
}

/**
 * Étage supérieur simple pour les tests de liaison.
 */
function niveauEtage() {
  return {
    id: 'etage',
    name: 'Étage 1',
    order: 1,
    imageUrl: '',
    videoUrl: null,
    animatedOverlays: [],
    pxPerCell: PX,
    widthCells: 12,
    heightCells: 10,
    grid: {
      type: /** @type {const} */ ('square'),
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
  };
}

/**
 * @param {string} id
 * @param {{ a: number, b: number }} cell
 * @param {Record<string, any>} [overrides]
 */
function pj(id, cell, overrides = {}) {
  return {
    id,
    levelId: 'rdc',
    cell,
    sizeCells: 1,
    kind: 'pc',
    imageUrl: '',
    borderColor: '#22c55e',
    label: id === 'hero' ? 'Héros' : 'Allié',
    hidden: false,
    visionBright: 2,
    visionDim: 4,
    emitsLight: null,
    speedCells: 4,
    playerMovable: true,
    locked: false,
    elevation: 0,
    markers: [],
    hp: null,
    health: 'unharmed',
    ...overrides,
  };
}

/**
 * @param {object} [opts]
 * @param {'closed'|'open'} [opts.doorState]
 * @param {number} [opts.ambientLevel]
 * @param {any[]} [opts.tokens]
 * @param {any[]} [opts.links]
 * @param {boolean} [opts.withEtage]
 */
function snapshotCouloir(opts = {}) {
  const levels = [niveauCouloir(opts.doorState ?? 'closed', opts.ambientLevel ?? 0)];
  if (opts.withEtage) levels.push(niveauEtage());
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: 'tour-de-jeu',
      name: 'Tour de jeu',
      levels,
      links: opts.links ?? [],
      tokens: opts.tokens ?? [pj('hero', { a: 4, b: 4 })],
      reserve: [],
      templates: [],
      settings: {},
    },
    activeLevelId: 'rdc',
    selectedTokenId: null,
    activeHandout: null,
  };
}

/**
 * Sonde du masque exploré reçu par la vue joueurs (même méthode que `fogTrajet.spec.mjs`).
 * @param {import('@playwright/test').Page} page
 * @param {string} [levelId]
 */
async function installerSondeFog(page, levelId = 'rdc') {
  await page.addScriptTag({
    type: 'module',
    content: `
      import * as store from './js/state/store.js';
      import { decodeFogPng } from './js/vision/fog.js';

      window.__sondeFogTJ = {
        alphaCase: async (a, b) => {
          const level = store.getCampaign()?.levels.find((l) => l.id === ${JSON.stringify(levelId)});
          const png = store.getSessionFog(${JSON.stringify(levelId)});
          if (!level || !png) return null;
          const canvas = await decodeFogPng(png, level.widthCells, level.heightCells);
          const ctx = canvas.getContext('2d');
          return ctx.getImageData(a * 8 + 4, b * 8 + 4, 1, 1).data[3];
        },
      };
    `,
  });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__sondeFogTJ));
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ a: number, b: number }} cell
 * @returns {Promise<number|null>}
 */
const alphaCase = (page, cell) =>
  page.evaluate(
    ([a, b]) => /** @type {any} */ (window).__sondeFogTJ.alphaCase(a, b),
    [cell.a, cell.b]
  );

/**
 * Envoie un message `mj.turn` sur le vrai canal `wfrp-map-link` (reçu par `gm.html`).
 * @param {import('@playwright/test').Page} gmPage
 * @param {string|null} ref
 */
const envoyerTour = (gmPage, ref) =>
  gmPage.evaluate((r) => {
    const canal = new BroadcastChannel('wfrp-map-link');
    canal.postMessage({
      v: 3,
      type: 'mj.turn',
      seq: Date.now(),
      at: Date.now(),
      from: 'outil-mj',
      payload: { ref: r },
    });
    canal.close();
  }, ref);

/**
 * Convertit un point carte en coordonnées client dans la fenêtre et effectue un vrai tap souris.
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number }} mapPos
 */
async function tapMapPos(page, mapPos) {
  const screen = await page.evaluate((mp) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const s = app.camera.mapToScreen(mp);
    return { x: s.screenX, y: s.screenY };
  }, mapPos);
  const box = await page.locator('#board').boundingBox();
  if (!box) throw new Error('Canvas #board introuvable');
  const cx = box.x + screen.x;
  const cy = box.y + screen.y;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Tape le centre de la case `(a, b)` en vrai geste souris.
 * @param {import('@playwright/test').Page} page
 * @param {number} a
 * @param {number} b
 */
async function tapCell(page, a, b) {
  await tapMapPos(page, { x: (a + 0.5) * PX, y: (b + 0.5) * PX });
}

/**
 * Calcule le rectangle carte du bouton de porte pour `portalId` via la fonction pure `boutonsPorte`.
 * @param {import('@playwright/test').Page} page
 * @param {string} portalId
 */
const getDoorButton = (page, portalId) =>
  page.evaluate(async (pid) => {
    const [store, gridMod, portalsMod] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/grid/index.js'),
      import('../js/render/layers/portals.js'),
    ]);
    const app = /** @type {any} */ (window).__RPG_APP__;
    const { campaign, activeLevel } = store.getState();
    if (!campaign || !activeLevel) return null;
    const grid = gridMod.gridFor(activeLevel);
    const buttons = portalsMod.boutonsPorte(
      grid,
      activeLevel,
      campaign.tokens.filter((t) => t.levelId === activeLevel.id),
      { zoom: app.camera.zoom, turn: store.getTurn() }
    );
    return buttons.find((b) => b.portalId === pid) ?? null;
  }, portalId);

/**
 * Calcule le rectangle carte du bouton de liaison pour `tokenId` via la fonction pure `boutonLiaison`.
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 */
const getLinkButton = (page, tokenId) =>
  page.evaluate(async (tid) => {
    const [store, gridMod, linksMod] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/grid/index.js'),
      import('../js/render/layers/links.js'),
    ]);
    const app = /** @type {any} */ (window).__RPG_APP__;
    const { campaign, activeLevel } = store.getState();
    if (!campaign || !activeLevel) return null;
    const token = campaign.tokens.find((t) => t.id === tid);
    if (!token) return null;
    const grid = gridMod.gridFor(activeLevel);
    return linksMod.boutonLiaison(grid, activeLevel, campaign.links ?? [], token, {
      zoom: app.camera.zoom,
      turn: store.getTurn(),
      camera: app.camera,
      insetTop: document.getElementById('player-level-tabs')?.offsetHeight ?? 0,
    });
  }, tokenId);

/**
 * Compte les pixels clairs (encre du bouton) à l'intérieur d'un rectangle carte sur le Canvas.
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number, width: number, height: number }} rect
 */
const brightPixelsInRect = (page, rect) =>
  page.evaluate((r) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const tl = app.camera.mapToScreen({ x: r.x, y: r.y });
    const br = app.camera.mapToScreen({ x: r.x + r.width, y: r.y + r.height });
    const res = app.stage?.resolution ?? 1;
    const sx = Math.max(0, Math.round(tl.screenX * res));
    const sy = Math.max(0, Math.round(tl.screenY * res));
    const sw = Math.max(1, Math.round((br.screenX - tl.screenX) * res));
    const sh = Math.max(1, Math.round((br.screenY - tl.screenY) * res));
    const data = app.context.getImageData(sx, sy, sw, sh).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) count++;
    }
    return count / (res * res);
  }, rect);

/**
 * Lit l'état d'une porte dans le store d'une page.
 * @param {import('@playwright/test').Page} page
 * @param {string} portalId
 */
const doorStateOf = (page, portalId) =>
  page.evaluate(async (pid) => {
    const store = await import('../js/state/store.js');
    const level = store.getCampaign()?.levels.find((l) => l.id === 'rdc');
    return level?.portals.find((p) => p.id === pid)?.state ?? null;
  }, portalId);

/**
 * Lit la position et le niveau d'un pion + l'état du tour dans le store d'une page.
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 */
const tokenAndTurn = (page, tokenId) =>
  page.evaluate(async (tid) => {
    const store = await import('../js/state/store.js');
    const state = store.getState();
    const token = state.campaign?.tokens.find((t) => t.id === tid) ?? null;
    return {
      activeLevelId: state.activeLevelId,
      selectedTokenId: state.selectedTokenId,
      token: token ? { levelId: token.levelId, cell: token.cell } : null,
      turn: store.getTurn(),
      reachableCount: state.reachableCells.size,
      hasCell: (/** @type {string} */ k) => state.reachableCells.has(k),
    };
  }, tokenId);

/**
 * Attend qu'aucune animation de déplacement de pion ne soit en cours sur `page`.
 * @param {import('@playwright/test').Page} page
 */
const waitForMoveIdle = (page) =>
  expect
    .poll(
      () =>
        page.evaluate(async () => {
          const [store, { TOKEN_MOVE_STEP_MS }] = await Promise.all([
            import('../js/state/store.js'),
            import('../js/render/layers/tokens.js'),
          ]);
          const now = Date.now();
          const tokens = store.getCampaign()?.tokens ?? [];
          return tokens.every((t) => {
            if (!t.move || !Array.isArray(t.move.path) || t.move.path.length < 2) return true;
            const duration = (t.move.path.length - 1) * TOKEN_MOVE_STEP_MS;
            return now >= t.move.startedAt + duration + 30;
          });
        }),
      { timeout: 8000 }
    )
    .toBe(true);

/**
 * Monte une session GM + Joueurs propre.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} sessionId
 * @param {any} snap
 */
async function monterSession(browser, sessionId, snap) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  /** @type {string[]} */
  const erreurs = [];
  const gm = await context.newPage();
  gm.on('pageerror', (e) => erreurs.push(`gm: ${e.message}`));
  const player = await context.newPage();
  player.on('pageerror', (e) => erreurs.push(`player: ${e.message}`));
  await Promise.all([
    installBrowserTransport(gm, sessionId, snap),
    installBrowserTransport(player, sessionId, snap),
  ]);
  await Promise.all([
    gm.goto(`/gm.html?session=${sessionId}`),
    player.goto(`/player.html?session=${sessionId}`),
  ]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);
  await installerSondeFog(player, 'rdc');
  await waitForPlayerVision(player);
  return { context, gm, player, erreurs };
}

test('1 & 2 — ouvrir puis refermer une porte par son bouton, visible même au-dessus du brouillard non exploré', async ({
  browser,
}) => {
  const snap = snapshotCouloir({
    doorState: 'closed',
    ambientLevel: 0,
    tokens: [pj('hero', { a: 4, b: 4 })],
  });
  const { context, gm, player, erreurs } = await monterSession(
    browser,
    `tj-porte-ouvrir-fermer-${Date.now()}`,
    snap
  );

  // La case du PJ est explorée, la case de l'autre côté de la porte fermée est dans le noir.
  await expect.poll(() => alphaCase(player, { a: 4, b: 4 }), { timeout: 8000 }).toBeGreaterThan(0);
  expect(await alphaCase(player, { a: 5, b: 4 })).toBe(0);

  // Le bouton se pose sur la case opposée (5,4) et se peint AU-DESSUS du brouillard (CA7, CA8).
  const btn = await getDoorButton(player, 'porte-1');
  if (!btn) throw new Error('Bouton de porte attendu');
  expect(btn.enabled).toBe(true);
  const center = { x: btn.rect.x + btn.rect.width / 2, y: btn.rect.y + btn.rect.height / 2 };
  expect(center.x).toBeGreaterThan(5 * PX);
  expect(center.x).toBeLessThan(6 * PX);
  await expect
    .poll(() => brightPixelsInRect(player, btn.rect), { timeout: 5000 })
    .toBeGreaterThan(20);

  // 1. Ouvrir par le bouton.
  await tapMapPos(player, center);
  await expect.poll(() => doorStateOf(player, 'porte-1'), { timeout: 5000 }).toBe('open');
  await expect.poll(() => doorStateOf(gm, 'porte-1'), { timeout: 5000 }).toBe('open');
  // La vision franchit désormais la porte ouverte.
  await expect.poll(() => alphaCase(player, { a: 5, b: 4 }), { timeout: 8000 }).toBeGreaterThan(0);

  const publishedOpen = await player.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'portal.toggle')
  );
  expect(publishedOpen.at(-1)?.payload).toMatchObject({ portalId: 'porte-1', state: 'open' });

  // 2. Refermer par le même bouton.
  const btnOpen = await getDoorButton(player, 'porte-1');
  if (!btnOpen) throw new Error('Bouton de porte ouverte attendu');
  await tapMapPos(player, {
    x: btnOpen.rect.x + btnOpen.rect.width / 2,
    y: btnOpen.rect.y + btnOpen.rect.height / 2,
  });
  await expect.poll(() => doorStateOf(player, 'porte-1'), { timeout: 5000 }).toBe('closed');
  await expect.poll(() => doorStateOf(gm, 'porte-1'), { timeout: 5000 }).toBe('closed');

  const publishedClose = await player.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'portal.toggle')
  );
  expect(publishedClose.at(-1)?.payload).toMatchObject({ portalId: 'porte-1', state: 'closed' });
  expect(erreurs).toEqual([]);
  await context.close();
});

test('3 — toucher la porte elle-même côté joueurs est sans effet (CA12) ; la vue MJ la bascule toujours (CA13)', async ({
  browser,
}) => {
  const snap = snapshotCouloir({
    doorState: 'closed',
    ambientLevel: 1,
    // PJ à distance de la porte pour qu'aucun pion ne dispute le tap du segment.
    tokens: [pj('hero', { a: 2, b: 4 })],
  });
  const { context, gm, player, erreurs } = await monterSession(
    browser,
    `tj-porte-direct-${Date.now()}`,
    snap
  );

  // Milieu exact du segment de `porte-1` : x = 5 * PX, y = 4.5 * PX.
  const midPortal = { x: 5 * PX, y: 4.5 * PX };

  // Côté joueurs : toucher la porte directement n'ouvre rien et ne publie aucun portal.toggle.
  await tapMapPos(player, midPortal);
  // Laisser passer la fenêtre de détection double-tap (tap sans pion sélectionné).
  await player.waitForTimeout(450);

  expect(await doorStateOf(player, 'porte-1')).toBe('closed');
  expect(await doorStateOf(gm, 'porte-1')).toBe('closed');
  const toggledByPlayer = await player.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some((/** @type {any} */ e) => e.type === 'portal.toggle')
  );
  expect(toggledByPlayer).toBe(false);

  // Côté MJ (CA13) : cliquer directement sur le segment bascule toujours la porte.
  await tapMapPos(gm, midPortal);
  await expect.poll(() => doorStateOf(gm, 'porte-1'), { timeout: 5000 }).toBe('open');
  await expect.poll(() => doorStateOf(player, 'porte-1'), { timeout: 5000 }).toBe('open');

  expect(erreurs).toEqual([]);
  await context.close();
});

test('4 — franchir une liaison par le bouton ; retaper la case du pion ne franchit plus (CA1–CA3)', async ({
  browser,
}) => {
  const stairs = {
    id: 'esc-1',
    kind: 'stairs',
    label: 'Montée',
    a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
    b: { levelId: 'etage', at: { cellX: 7, cellY: 6 } },
    bidirectional: true,
    gmOnly: false,
  };
  const snap = snapshotCouloir({
    ambientLevel: 1,
    withEtage: true,
    links: [stairs],
    tokens: [pj('hero', { a: 3, b: 3 })],
  });
  const { context, gm, player, erreurs } = await monterSession(
    browser,
    `tj-liaison-bouton-${Date.now()}`,
    snap
  );

  // Re-taper deux fois la case du pion ne franchit plus la liaison (CA3).
  await tapCell(player, 3, 3);
  await expect
    .poll(async () => (await tokenAndTurn(player, 'hero')).selectedTokenId, { timeout: 5000 })
    .toBe('hero');
  await tapCell(player, 3, 3);
  await player.waitForTimeout(300);

  expect((await tokenAndTurn(player, 'hero')).token).toEqual({
    levelId: 'rdc',
    cell: { a: 3, b: 3 },
  });
  const traversedOnRetap = await player.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some((/** @type {any} */ e) => e.type === 'link.traverse')
  );
  expect(traversedOnRetap).toBe(false);

  // Désélectionner (fin de préparation) : le bouton de liaison réapparaît et son tap franchit (CA1, CA2).
  await tapCell(player, 0, 0);
  await expect
    .poll(async () => (await tokenAndTurn(player, 'hero')).selectedTokenId, { timeout: 5000 })
    .toBeNull();

  const btn = await getLinkButton(player, 'hero');
  if (!btn) throw new Error('Bouton de liaison attendu');
  expect(btn.label).toBe('Prendre l’escalier');
  await expect
    .poll(() => brightPixelsInRect(player, btn.rect), { timeout: 5000 })
    .toBeGreaterThan(20);

  await tapMapPos(player, {
    x: btn.rect.x + btn.rect.width / 2,
    y: btn.rect.y + btn.rect.height / 2,
  });

  // Le pion monte sur `etage`, aucun des deux écrans ne bascule d'étage (UX-10).
  await expect
    .poll(() => tokenAndTurn(player, 'hero'), { timeout: 5000 })
    .toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'etage', cell: { a: 7, b: 6 } } });
  await expect
    .poll(() => tokenAndTurn(gm, 'hero'), { timeout: 5000 })
    .toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'etage', cell: { a: 7, b: 6 } } });

  expect(erreurs).toEqual([]);
  await context.close();
});

test('5 — interrompre un mouvement, ouvrir une porte, reprendre avec le reste du mouvement ; hors tour grisé ; pas de bouton en préparation', async ({
  browser,
}) => {
  const snap = snapshotCouloir({
    doorState: 'closed',
    ambientLevel: 1,
    tokens: [
      pj('hero', { a: 2, b: 4 }, { speedCells: 4, runCells: 8, link: { source: 'outil-mj', ref: 'pj:hero' } }),
      pj('ally', { a: 2, b: 6 }, { speedCells: 4, runCells: 8, link: { source: 'outil-mj', ref: 'pj:ally' } }),
    ],
  });
  const { context, gm, player, erreurs } = await monterSession(
    browser,
    `tj-interrompre-reprendre-${Date.now()}`,
    snap
  );

  // Le MJ donne le tour à `hero` via `mj.turn`.
  await envoyerTour(gm, 'pj:hero');
  await expect
    .poll(async () => (await tokenAndTurn(player, 'hero')).turn, { timeout: 5000 })
    .toMatchObject({ tokenId: 'hero', spentCells: 0 });

  // Hors tour (CA10, CA14) : `ally` est devant `porte-2`, son bouton est grisé et sans effet.
  const btnAlly = await getDoorButton(player, 'porte-2');
  if (!btnAlly) throw new Error('Bouton de porte grisé attendu pour ally');
  expect(btnAlly.enabled).toBe(false);
  await tapMapPos(player, {
    x: btnAlly.rect.x + btnAlly.rect.width / 2,
    y: btnAlly.rect.y + btnAlly.rect.height / 2,
  });
  await player.waitForTimeout(350);
  expect(await doorStateOf(player, 'porte-2')).toBe('closed');

  // Taper `ally` hors tour ouvre sa consultation lecture seule (aucune sélection de déplacement).
  await tapCell(player, 2, 6);
  await expect(player.locator('#player-selection-strip')).toBeVisible();
  expect((await tokenAndTurn(player, 'ally')).selectedTokenId).toBeNull();

  // Installer une sonde `fillText` pour prouver qu'AUCUN bouton de porte n'est dessiné pendant la préparation (CA11).
  // Témoin positif AVANT la sélection : le bouton de porte « Ouvrir » est bien dessiné au repos.
  const captureDrawnTexts = () =>
    player.evaluate(
      () =>
        new Promise((resolve) => {
          const w = /** @type {any} */ (window);
          const ctx = w.__RPG_APP__.context;
          const orig = ctx.fillText.bind(ctx);
          /** @type {string[]} */
          const texts = [];
          ctx.fillText = (
            /** @type {string} */ txt,
            /** @type {number} */ x,
            /** @type {number} */ y,
            /** @type {number} */ mw
          ) => {
            texts.push(txt);
            orig(txt, x, y, mw);
          };
          w.__RPG_APP__.frameLoop.requestFrame();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              ctx.fillText = orig;
              resolve(texts);
            });
          });
        })
    );

  // Sélectionner `hero` en (2,4) et tracer une étape vers (4,4) (2 cases, devant `porte-1`).
  await tapCell(player, 2, 4);
  await expect
    .poll(async () => (await tokenAndTurn(player, 'hero')).selectedTokenId, { timeout: 5000 })
    .toBe('hero');

  // Poser l'étape en (4,4) sans valider encore : préparation en cours.
  await tapCell(player, 4, 4);
  const textsDuringPrep = await captureDrawnTexts();
  expect(textsDuringPrep).not.toContain('Ouvrir');

  // Le tap d'un bouton pendant une préparation est prouvé sans effet par le test dédié de CA11
  // en fin de fichier (témoin positif, sonde `fillText`, puis tap réel dans le rect). Ici on se
  // contente de valider le mouvement en re-tapant (4,4).
  await tapCell(player, 4, 4);

  // Attendre que le déplacement arrive chez le MJ et que `turn.select` revienne avec spentCells = 2.
  await expect
    .poll(() => tokenAndTurn(player, 'hero'), { timeout: 8000 })
    .toMatchObject({
      token: { levelId: 'rdc', cell: { a: 4, b: 4 } },
      turn: { tokenId: 'hero', spentCells: 2 },
    });
  await waitForMoveIdle(player);

  // Ouvrir `porte-1` par son bouton (maintenant que `hero` est adjacent en (4,4) et immobile).
  const btnHero = await getDoorButton(player, 'porte-1');
  if (!btnHero) throw new Error('Bouton de porte attendu pour hero');
  expect(btnHero.enabled).toBe(true);
  await tapMapPos(player, {
    x: btnHero.rect.x + btnHero.rect.width / 2,
    y: btnHero.rect.y + btnHero.rect.height / 2,
  });
  await expect.poll(() => doorStateOf(player, 'porte-1'), { timeout: 5000 }).toBe('open');
  await expect.poll(() => doorStateOf(gm, 'porte-1'), { timeout: 5000 }).toBe('open');

  // Re-sélectionner `hero` en (4,4) : budget restant = 8 - 2 = 6 cases, Marche restante = 4 - 2 = 2.
  await tapCell(player, 4, 4);
  await expect
    .poll(
      () =>
        player.evaluate(async () => {
          const [store, sel] = await Promise.all([
            import('../js/state/store.js'),
            import('../js/state/selection.js'),
          ]);
          const s = store.getState();
          const token = s.selectedToken;
          if (!token || !s.activeLevel) return null;
          const rules = sel.movementRulesFor(token, s.activeLevel, store.getTurnSpent(token.id));
          return {
            budget: rules.budget,
            walkBudget: rules.walkBudget,
            canReach6: s.reachableCells.has('10,4'),
            canReach7: s.reachableCells.has('11,4'),
          };
        }),
      { timeout: 5000 }
    )
    .toEqual({ budget: 6, walkBudget: 2, canReach6: true, canReach7: false });

  // Reprendre le mouvement à travers la porte ouverte : d'abord la case juste derrière la porte
  // (5,4) — preuve que le bouton « Fermer » est bien absent pendant la préparation et ne referme
  // pas la porte au passage — puis (6,4) (2 cases de plus au total).
  await tapCell(player, 5, 4);
  expect(await doorStateOf(player, 'porte-1')).toBe('open');
  await tapCell(player, 6, 4);
  await tapCell(player, 6, 4);
  await expect
    .poll(() => tokenAndTurn(player, 'hero'), { timeout: 8000 })
    .toMatchObject({
      token: { levelId: 'rdc', cell: { a: 6, b: 4 } },
      turn: { tokenId: 'hero', spentCells: 4 },
    });

  expect(erreurs).toEqual([]);
  await context.close();
});

test('6 — annuler le mouvement du tour : replacement, zone entière, porte reste ouverte, brouillard non régressé, refus si case occupée (CA22–CA27)', async ({
  browser,
}) => {
  const snap = snapshotCouloir({
    doorState: 'closed',
    ambientLevel: 0,
    tokens: [
      pj(
        'hero',
        { a: 2, b: 4 },
        { speedCells: 4, runCells: 8, visionBright: 1, visionDim: 2, link: { source: 'outil-mj', ref: 'pj:hero' } }
      ),
      pj('ally', { a: 1, b: 2 }, { speedCells: 4, link: { source: 'outil-mj', ref: 'pj:ally' } }),
    ],
  });
  const { context, gm, player, erreurs } = await monterSession(
    browser,
    `tj-annuler-tour-${Date.now()}`,
    snap
  );

  // Activer le tour de `hero`.
  await envoyerTour(gm, 'pj:hero');
  await expect
    .poll(async () => (await tokenAndTurn(player, 'hero')).turn, { timeout: 5000 })
    .toMatchObject({ tokenId: 'hero', spentCells: 0 });

  // CA23 : aucun bouton d'annulation tant que spentCells === 0.
  const undoBtn = player.locator('#player-turn-undo-btn');
  await expect(undoBtn).toHaveCount(0);

  // La case (6,4) derrière la porte fermée est dans le noir absolu avant le déplacement.
  await expect.poll(() => alphaCase(player, { a: 2, b: 4 }), { timeout: 8000 }).toBeGreaterThan(0);
  expect(await alphaCase(player, { a: 6, b: 4 })).toBe(0);

  // 1. Avancer en (4,4) (2 cases).
  await tapCell(player, 2, 4);
  await tapCell(player, 4, 4);
  await tapCell(player, 4, 4);
  await expect
    .poll(() => tokenAndTurn(player, 'hero'), { timeout: 8000 })
    .toMatchObject({
      token: { levelId: 'rdc', cell: { a: 4, b: 4 } },
      turn: { tokenId: 'hero', spentCells: 2 },
    });
  await waitForMoveIdle(player);

  // 2. Ouvrir `porte-1` par son bouton puis avancer en (6,4) (2 cases de plus -> spentCells = 4).
  const btnPorte = await getDoorButton(player, 'porte-1');
  if (!btnPorte) throw new Error('Bouton de porte attendu');
  await tapMapPos(player, {
    x: btnPorte.rect.x + btnPorte.rect.width / 2,
    y: btnPorte.rect.y + btnPorte.rect.height / 2,
  });
  await expect.poll(() => doorStateOf(gm, 'porte-1'), { timeout: 5000 }).toBe('open');

  await tapCell(player, 4, 4);
  await tapCell(player, 6, 4);
  await tapCell(player, 6, 4);
  await expect
    .poll(() => tokenAndTurn(player, 'hero'), { timeout: 8000 })
    .toMatchObject({
      token: { levelId: 'rdc', cell: { a: 6, b: 4 } },
      turn: { tokenId: 'hero', spentCells: 4 },
    });
  await waitForMoveIdle(player);

  // La case (6,4) est maintenant révélée dans le brouillard exploré.
  await expect.poll(() => alphaCase(player, { a: 6, b: 4 }), { timeout: 8000 }).toBeGreaterThan(0);

  // CA22 : le bouton d'annulation est présent, 44 × 44 px, à `right: 116px`, `top: 12px`.
  await expect(undoBtn).toHaveCount(1);
  const box = await undoBtn.boundingBox();
  if (!box) throw new Error('Boîte du bouton d’annulation introuvable');
  expect(Math.round(box.width)).toBe(44);
  expect(Math.round(box.height)).toBe(44);
  expect(Math.round(box.y)).toBe(12);
  const viewportWidth = await player.evaluate(() => window.innerWidth);
  expect(Math.round(viewportWidth - (box.x + box.width))).toBe(116);

  // Cliquer Annuler : application locale immédiate + publication `turn.undo` (CA24).
  await undoBtn.click();

  // Application locale sur `player` (un oubli local casserait immédiatement cette assertion).
  const afterLocal = await tokenAndTurn(player, 'hero');
  expect(afterLocal.token).toEqual({ levelId: 'rdc', cell: { a: 2, b: 4 } });
  expect(afterLocal.turn).toMatchObject({ tokenId: 'hero', spentCells: 0 });

  // Le bouton disparaît (CA25).
  await expect(undoBtn).toHaveCount(0);

  // L'événement `turn.undo` a bien été publié et appliqué chez le MJ.
  const undoEvents = await player.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'turn.undo')
  );
  expect(undoEvents).toHaveLength(1);
  expect(undoEvents[0].payload).toEqual({ tokenId: 'hero' });

  await expect
    .poll(() => tokenAndTurn(gm, 'hero'), { timeout: 8000 })
    .toMatchObject({
      token: { levelId: 'rdc', cell: { a: 2, b: 4 } },
      turn: { tokenId: 'hero', spentCells: 0 },
    });

  // CA27 : la porte ouverte pendant le tour reste ouverte.
  expect(await doorStateOf(player, 'porte-1')).toBe('open');
  expect(await doorStateOf(gm, 'porte-1')).toBe('open');

  // CA26 : le brouillard exploré ne régresse pas (attendre la publication vision post-annulation).
  await expect.poll(() => alphaCase(player, { a: 6, b: 4 }), { timeout: 8000 }).toBeGreaterThan(0);

  // Zone entière retrouvée : en resélectionnant `hero` en (2,4), la case (10,4) à 8 cases est atteignable.
  await tapCell(player, 2, 4);
  await expect
    .poll(
      () =>
        player.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getState().reachableCells.has('10,4');
        }),
      { timeout: 5000 }
    )
    .toBe(true);

  // Cas limite CA27 : si la case de départ est occupée entre-temps, l'annulation est refusée et ne publie rien.
  await tapCell(player, 4, 4);
  await tapCell(player, 4, 4);
  await expect
    .poll(() => tokenAndTurn(player, 'hero'), { timeout: 8000 })
    .toMatchObject({
      token: { levelId: 'rdc', cell: { a: 4, b: 4 } },
      turn: { tokenId: 'hero', spentCells: 2 },
    });
  await waitForMoveIdle(player);
  await expect(undoBtn).toHaveCount(1);

  // Le MJ pose `ally` sur la case de départ (2,4) de `hero`.
  await player.evaluate(async () => {
    const { applyNetworkEvent } = await import('../js/app/networkEvents.js');
    applyNetworkEvent({
      type: 'token.move',
      payload: { tokenId: 'ally', from: { a: 1, b: 2 }, to: { a: 2, b: 4 } },
      at: Date.now(),
      by: 'gm',
    });
  });

  await undoBtn.click();
  await player.waitForTimeout(200);
  // `hero` n'a pas bougé, aucun second `turn.undo` publié, le bouton reste affiché.
  expect((await tokenAndTurn(player, 'hero')).token).toEqual({
    levelId: 'rdc',
    cell: { a: 4, b: 4 },
  });
  const undoEventsAfter = await player.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'turn.undo')
  );
  expect(undoEventsAfter).toHaveLength(1);
  await expect(undoBtn).toHaveCount(1);

  expect(erreurs).toEqual([]);
  await context.close();
});

test('absence de bouton pendant une préparation (test dédié de CA11)', async ({ page }) => {
  // Test dédié rapide (sans 2e page) qui vérifie les deux moitiés de CA11 :
  // 1) le bouton de porte et le bouton de liaison ne se dessinent pas en préparation ;
  // 2) taper dans le rect du bouton de porte pendant une préparation ne bascule pas la porte.
  const stairs = {
    id: 'esc-prep',
    kind: 'stairs',
    label: '',
    a: { levelId: 'rdc', at: { cellX: 4, cellY: 4 } },
    b: { levelId: 'etage', at: { cellX: 7, cellY: 6 } },
    bidirectional: true,
    gmOnly: false,
  };
  const snap = snapshotCouloir({
    doorState: 'closed',
    ambientLevel: 1,
    withEtage: true,
    links: [stairs],
    tokens: [pj('hero', { a: 4, b: 4 })],
  });
  const sid = `tj-prep-boutons-${Date.now()}`;
  await installBrowserTransport(page, sid, snap);
  await page.goto(`/player.html?session=${sid}`);
  await waitForApp(page);
  await setPlayerTestVision(page);

  const btnDoor = await getDoorButton(page, 'porte-1');
  const btnLink = await getLinkButton(page, 'hero');
  if (!btnDoor) throw new Error('Bouton de porte attendu');
  if (!btnLink) throw new Error('Bouton de liaison attendu');

  const captureTexts = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const w = /** @type {any} */ (window);
          const ctx = w.__RPG_APP__.context;
          const orig = ctx.fillText.bind(ctx);
          /** @type {string[]} */
          const texts = [];
          ctx.fillText = (
            /** @type {string} */ txt,
            /** @type {number} */ x,
            /** @type {number} */ y,
            /** @type {number} */ mw
          ) => {
            texts.push(txt);
            orig(txt, x, y, mw);
          };
          w.__RPG_APP__.frameLoop.requestFrame();
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              ctx.fillText = orig;
              resolve(texts);
            });
          });
        })
    );

  // Témoin positif AVANT la préparation : les deux boutons sont réellement peints sur le Canvas.
  const drawnBefore = await captureTexts();
  expect(drawnBefore).toContain('Ouvrir');
  expect(drawnBefore).toContain('Prendre l’escalier');

  // Sélectionner `hero` et commencer une préparation d'une étape vers (3,4).
  await tapCell(page, 4, 4);
  await tapCell(page, 3, 4);

  // Pendant la préparation, aucun texte de bouton ne s'affiche au rendu.
  const drawn = await captureTexts();
  expect(drawn).not.toContain('Ouvrir');
  expect(drawn).not.toContain('Prendre l’escalier');

  // Taper le rect du bouton de porte pendant la préparation ne bascule PAS la porte (et ne traverse pas).
  await tapMapPos(page, {
    x: btnDoor.rect.x + btnDoor.rect.width / 2,
    y: btnDoor.rect.y + btnDoor.rect.height / 2,
  });
  await page.waitForTimeout(200);
  expect(await doorStateOf(page, 'porte-1')).toBe('closed');
  expect((await tokenAndTurn(page, 'hero')).token).toEqual({
    levelId: 'rdc',
    cell: { a: 4, b: 4 },
  });
});

test('le décompte du tour est appliqué LOCALEMENT, sans attendre le turn.select du MJ', async ({
  page,
}) => {
  // ⭐ Revue du 22/11/2026. Sans décompte local, la tablette proposait le budget ENTIER pendant
  // tout l'aller-retour réseau — relevé entre 336 ms et 2,4 s en séance le 7 août 2026 — et
  // trois taps rapides suffisaient à rejouer un trajet complet dans le même tour (4 cases puis
  // 8, soit 12 pour un budget de 8). Ce test tourne SANS page MJ : rien d'autre que la tablette
  // ne peut produire le compteur, donc un compteur à 0 ici signifie que le décompte local a
  // disparu.
  const snap = snapshotCouloir({
    ambientLevel: 1,
    tokens: [
      pj('hero', { a: 2, b: 4 }, { speedCells: 4, runCells: 8, link: { source: 'outil-mj', ref: 'pj:hero' } }),
    ],
  });
  const sid = `tj-decompte-local-${Date.now()}`;
  await installBrowserTransport(page, sid, snap);
  await page.goto(`/player.html?session=${sid}`);
  await waitForApp(page);
  await setPlayerTestVision(page);

  // Tour de `hero`, comme si `turn.select` venait d'arriver.
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setTurn('hero');
  });
  await expect
    .poll(async () => (await tokenAndTurn(page, 'hero')).turn, { timeout: 5000 })
    .toMatchObject({ tokenId: 'hero', spentCells: 0 });

  // Deux cases marchées, validées au second tap.
  await tapCell(page, 2, 4);
  await tapCell(page, 4, 4);
  await tapCell(page, 4, 4);

  // Le compteur est à 2 tout de suite, et la zone s'est rétrécie d'autant.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const [store, sel] = await Promise.all([
            import('../js/state/store.js'),
            import('../js/state/selection.js'),
          ]);
          const s = store.getState();
          const token = s.campaign?.tokens.find((t) => t.id === 'hero');
          const level = s.activeLevel;
          if (!token || !level) return null;
          const rules = sel.movementRulesFor(token, level, store.getTurnSpent('hero'));
          return { spent: store.getTurnSpent('hero'), budget: rules.budget, walkBudget: rules.walkBudget };
        }),
      { timeout: 5000 }
    )
    .toEqual({ spent: 2, budget: 6, walkBudget: 2 });
});

test('le bouton d’annulation disparaît tant qu’une image partagée est affichée', async ({ page }) => {
  // ⭐ Revue du 22/11/2026 : la croix de l'image partagée est à `right: 124px` sur 64 px de large
  // (124 → 188), ce bouton occupe 116 → 160 avec un `z-index` supérieur à l'overlay. Il
  // recouvrait la moitié gauche de la croix et volait le tap qui ferme l'image.
  const snap = snapshotCouloir({
    ambientLevel: 1,
    tokens: [
      pj('hero', { a: 2, b: 4 }, { speedCells: 4, runCells: 8, link: { source: 'outil-mj', ref: 'pj:hero' } }),
    ],
  });
  const sid = `tj-annuler-vs-image-${Date.now()}`;
  await installBrowserTransport(page, sid, snap);
  await page.goto(`/player.html?session=${sid}`);
  await waitForApp(page);
  await setPlayerTestVision(page);

  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setTurn('hero');
  });
  await tapCell(page, 2, 4);
  await tapCell(page, 4, 4);
  await tapCell(page, 4, 4);

  const undoBtn = page.locator('#player-turn-undo-btn');
  await expect(undoBtn).toHaveCount(1);

  // Le MJ partage une image : le bouton s'efface, la croix reste seule maîtresse du coin.
  await page.evaluate(async () => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    await app.transport.shareImage({
      id: 'img-tj-1',
      dataUrl:
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      width: 1,
      height: 1,
      at: Date.now(),
    });
  });
  await expect(page.locator('#image-share-overlay')).toHaveCount(1);
  await expect(undoBtn).toHaveCount(0);

  // Les joueurs referment l'image par la croix : le bouton d'annulation revient.
  await page.locator('.image-share-close').click();
  await expect(page.locator('#image-share-overlay')).toHaveCount(0);
  await expect(undoBtn).toHaveCount(1);
});
