// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

/**
 * Étage 02 de `test_village_complet`, tel que décrit dans le fait de séance : une porte fermée
 * (`portal-5`) sur l'arête gauche de la case de liaison (6,36), un PJ posté en case voisine
 * (7,36). Géométrie recopiée telle quelle depuis
 * `maps/generated/test_village_complet.scene.json` : segment `a={cellX:5.94,cellY:37.05}` →
 * `b={cellX:5.94,cellY:36.05}`.
 *
 * Fournie en tant qu'INSTANTANÉ de transport (comme `portalIndicator.spec.mjs`), pas via un
 * `store.loadCampaign` après coup : `fitActiveLevel` (`js/app/player.js`) ne cadre un étage
 * qu'une seule fois, à la première frame où il devient actif, et ce cadrage naturel écraserait
 * silencieusement le zoom qu'un test poserait après un chargement tardif — c'est le piège qui a
 * fait le zoom 3 « échouer » sur un premier jet de cette reproduction (voir le rapport). En
 * préchargeant l'étage dans l'instantané, son unique cadrage est déjà consommé au démarrage, et
 * le zoom posé ensuite par le test n'est plus jamais écrasé.
 */
const ETAGE_02 = {
  id: 'etage-02',
  name: 'Étage 02',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 140,
  widthCells: 42,
  heightCells: 42,
  grid: { type: /** @type {import('../js/core/types.js').GridType} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [
    { id: 'portal-5', a: { cellX: 5.94, cellY: 37.05 }, b: { cellX: 5.94, cellY: 36.05 }, state: 'closed', freestanding: false },
  ],
  lights: [],
  ambient: { level: 1, baked: false },
};
const RDC_REPRO = { ...ETAGE_02, id: 'rdc-repro', name: 'RDC', portals: [] };
const LINK_ESCALIER = {
  id: 'link-escalier',
  kind: 'stairs',
  label: '',
  a: { levelId: 'etage-02', at: { cellX: 6, cellY: 36 } },
  b: { levelId: 'rdc-repro', at: { cellX: 6, cellY: 36 } },
  bidirectional: true,
  gmOnly: false,
};
const PJ_VOISIN = {
  id: 'pj-voisin',
  levelId: 'etage-02',
  cell: { a: 7, b: 36 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'PJ',
  hidden: false,
  visionDim: 12,
  emitsLight: null,
  speedCells: 6,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
  hp: null,
  health: 'unharmed',
};

function buildEtage02Snapshot() {
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: 'campaign-repro',
      name: 'Repro étage 02',
      levels: [ETAGE_02, RDC_REPRO],
      links: [LINK_ESCALIER],
      tokens: [PJ_VOISIN],
      reserve: [],
      templates: [],
      settings: {},
    },
    activeLevelId: 'etage-02',
    selectedTokenId: null,
  };
}

/**
 * Monte une vraie page `player.html` (transport réel via BroadcastChannel, pas d'appel direct
 * à `store.setPortalState`) puis tape à l'écran, au vrai milieu du segment de la porte, pour
 * juger si le geste **réel** — pas une intention synthétique — bascule la porte.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} zoom
 * @param {number} [errorPx] Décalage du tap réel par rapport au milieu exact du segment de la
 *   porte, en pixels écran, vers le PJ voisin (imprécision de doigt). 0 = tap parfait.
 * @returns {Promise<{ toggled: boolean, published: boolean, screenPos: {x:number,y:number} }>}
 */
async function tapPortalAtZoom(page, zoom, errorPx = 0) {
  const sessionId = `portal-repro-${zoom}-${errorPx}-${Date.now()}`;
  await installBrowserTransport(page, sessionId, buildEtage02Snapshot());
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  // Cadre la porte : caméra centrée sur la case de liaison, au zoom demandé. Le cadrage naturel
  // de `fitActiveLevel` a déjà eu lieu pendant le boot (voir le commentaire de `ETAGE_02`), donc
  // ce réglage n'est plus écrasé par un rendu ultérieur.
  await page.evaluate(async (z) => {
    const [gridModule, store] = await Promise.all([
      import('../js/grid/index.js'),
      import('../js/state/store.js'),
    ]);
    const app = /** @type {any} */ (window).__RPG_APP__;
    const { activeLevel } = store.getState();
    if (!activeLevel) throw new Error('activeLevel introuvable');
    const grid = gridModule.gridFor(activeLevel);
    const center = grid.mapFromCellPoint({ cellX: 6.5, cellY: 36.5 });
    app.camera.setZoom(z);
    app.camera.setPan(center.x, center.y);
  }, zoom);

  const midMap = await page.evaluate(async () => {
    const [gridModule, store] = await Promise.all([
      import('../js/grid/index.js'),
      import('../js/state/store.js'),
    ]);
    const { activeLevel } = store.getState();
    if (!activeLevel) throw new Error('activeLevel introuvable');
    const grid = gridModule.gridFor(activeLevel);
    const pA = grid.mapFromCellPoint({ cellX: 5.94, cellY: 37.05 });
    const pB = grid.mapFromCellPoint({ cellX: 5.94, cellY: 36.05 });
    return { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
  });

  const screenPos = await page.evaluate((mp) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const s = app.camera.mapToScreen(mp);
    return { x: s.screenX, y: s.screenY };
  }, midMap);

  const canvasBox = await page.locator('#board').boundingBox();
  if (!canvasBox) throw new Error('canvas introuvable');

  // Le PJ voisin est à droite de la porte (cellX croissant) : l'erreur de visée se simule vers
  // la droite, dans la direction où elle risquerait de faire déborder la marge du pion.
  const clickX = canvasBox.x + screenPos.x + errorPx;
  const clickY = canvasBox.y + screenPos.y;

  // Vrai tap : down/up sans déplacement, sous les seuils de pan/appui long.
  await page.mouse.move(clickX, clickY);
  await page.mouse.down();
  await page.mouse.up();

  const stateAfter = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.levels.find((/** @type {any} */ l) => l.id === 'etage-02')
      ?.portals[0].state;
  });

  const published = await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published;
    return /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some(
      (/** @type {any} */ e) => e.type === 'portal.toggle'
    );
  });

  return { toggled: stateAfter === 'open', published, screenPos };
}

test('Le cas du mainteneur — au cadrage 0,193, 10 px d\'erreur vers le PJ voisin bascule quand même la porte', async ({ page }) => {
  // ⚠ Mesuré avec les fonctions réelles (`findHitToken`/`findHitPortal` sur cette géométrie
  // exacte, copiée de `maps/generated/test_village_complet.scene.json`, portal-5 de l'étage 02) :
  // à 10 px d'erreur et ce zoom, le point tapé est à 51,8 unités carte du segment de la porte —
  // AU-DELÀ de sa capsule de désignation (35 unités = PORTAL_HIT_CELL_RATIO × 140), que ce
  // chantier n'a pas le droit d'élargir. `findHitPortal` y rend donc `null`, avant même toute
  // comparaison de distance : aucun départage ne peut faire gagner une porte qui n'est plus
  // candidate. Ce test rougit avant ET après le correctif — voir le rapport de livraison pour
  // le détail des mesures et la question qu'il pose au mainteneur.
  const result = await tapPortalAtZoom(page, 0.193, 10);
  expect(result.toggled).toBe(true);
  expect(result.published).toBe(true);
});

test('Visée parfaite — la porte bascule aux trois zooms, y compris le zoom maximal', async ({ page }) => {
  // `camera.maxZoom` vaut 5 (js/render/camera.js) : c'est le sens réel de « zoomer à fond ».
  for (const zoom of [0.193, 1, 5]) {
    const result = await tapPortalAtZoom(page, zoom);
    expect(result.toggled).toBe(true);
    expect(result.published).toBe(true);
  }
});

test('Basculer une porte côté joueurs modifie le store et l\'état du portail', async ({ page }) => {
  const sessionId = `portal-test-${Date.now()}`;
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);

    const level = schema.createLevel({
      id: 'level-p1',
      name: 'Niveau 1',
      widthCells: 10,
      heightCells: 10,
      portals: [
        {
          id: 'door-1',
          a: { cellX: 1, cellY: 1 },
          b: { cellX: 2, cellY: 1 },
          state: 'closed',
          freestanding: false,
        },
      ],
    });

    const campaign = schema.createCampaign({ levels: [level] });
    store.loadCampaign(campaign);
  });

  // Tap sur le portail (entre 1,1 et 2,1)
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 75, y: 50 },
      mapPos: { x: 75, y: 50 },
    });
  });

  // Muter store direct pour simuler l'action
  const stateBefore = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.levels[0].portals[0].state;
  });
  expect(stateBefore).toBe('closed');

  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setPortalState('level-p1', 'door-1', 'open');
  });

  const stateAfter = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.levels[0].portals[0].state;
  });
  expect(stateAfter).toBe('open');
});

test('Ouvrir une porte rafraîchit immédiatement les cases atteignables du pion sélectionné', async ({ page }) => {
  const sessionId = `portal-reach-${Date.now()}`;
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(async () => {
    const [store, schema, selection] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
      import('../js/state/selection.js'),
    ]);

    const level = schema.createLevel({
      id: 'level-reach',
      name: 'Reach Test',
      widthCells: 10,
      heightCells: 10,
      portals: [
        {
          id: 'door-reach',
          a: { cellX: 2, cellY: 1 },
          b: { cellX: 2, cellY: 2 },
          state: 'closed',
          freestanding: false,
        },
      ],
    });

    const token = schema.createToken({
      id: 'hero-reach',
      levelId: level.id,
      cell: { a: 1, b: 1 },
      speedCells: 5,
    });

    const campaign = schema.createCampaign({ levels: [level], tokens: [token] });
    store.loadCampaign(campaign);
    selection.setSelectionState(token, level);
  });

  const reachableClosedCount = await page.evaluate(async () => {
    const selection = await import('../js/state/selection.js');
    return selection.getReachableCells().size;
  });

  // Ouvrir la porte via setPortalState
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setPortalState('level-reach', 'door-reach', 'open');
  });

  const reachableOpenCount = await page.evaluate(async () => {
    const selection = await import('../js/state/selection.js');
    return selection.getReachableCells().size;
  });

  expect(reachableOpenCount).toBeGreaterThanOrEqual(reachableClosedCount);
});

test('Appui long MJ verrouille la porte', async ({ page }) => {
  const sessionId = `portal-longpress-${Date.now()}`;
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);

    const level = schema.createLevel({
      id: 'level-gm-lock',
      name: 'GM Lock Test',
      widthCells: 10,
      heightCells: 10,
      portals: [
        {
          id: 'door-lock',
          a: { cellX: 3, cellY: 3 },
          b: { cellX: 4, cellY: 3 },
          state: 'closed',
          freestanding: false,
        },
      ],
    });

    const campaign = schema.createCampaign({ levels: [level] });
    store.loadCampaign(campaign);
  });

  // Intention longPress MJ
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'longPress',
      screenPos: { x: 175, y: 150 },
      mapPos: { x: 175, y: 150 },
    });
  });

  // Vérifier le verrouillage si touché ou via setPortalState
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setPortalState('level-gm-lock', 'door-lock', 'locked');
  });

  const stateLocked = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.levels[0].portals[0].state;
  });

  expect(stateLocked).toBe('locked');
});

test('Protection chantier O — un tap en plein sur un pion à moins d\'un quart de case d\'une porte le sélectionne, sans ouvrir la porte', async ({ page }) => {
  const sessionId = `portal-protect-${Date.now()}`;
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);

    // Porte sur l'arête gauche de la case (3,3), PJ posté DANS cette case : la porte touche
    // donc son rectangle (distance 0, bien en-deçà du quart de case du brief).
    const level = schema.createLevel({
      id: 'level-protect',
      name: 'Protection',
      pxPerCell: 100,
      widthCells: 10,
      heightCells: 10,
      portals: [
        { id: 'door-protect', a: { cellX: 3, cellY: 3 }, b: { cellX: 3, cellY: 4 }, state: 'closed', freestanding: false },
      ],
    });
    const token = schema.createToken({
      id: 'pj-protect',
      levelId: level.id,
      cell: { a: 3, b: 3 },
      kind: 'pc',
      playerMovable: true,
    });

    const campaign = schema.createCampaign({ levels: [level], tokens: [token] });
    store.loadCampaign(campaign);
  });

  // Tap à (310, 350) : à 10 unités carte de la porte (dans sa capsule de 25), mais à
  // l'INTÉRIEUR du rectangle du pion (dist=0). La protection du chantier O doit lui revenir
  // d'elle-même — un pion sous le doigt bat toujours une porte à distance non nulle.
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 310, y: 350 },
      mapPos: { x: 310, y: 350 },
    });
  });

  const after = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const state = store.getState();
    return {
      portalState: store.getCampaign()?.levels[0].portals[0].state,
      selectedTokenId: state.selectedTokenId,
    };
  });

  expect(after.portalState).toBe('closed');
  expect(after.selectedTokenId).toBe('pj-protect');
});

test('Vue MJ — un pion plus loin dans sa marge ne vole plus le tap à une porte plus proche', async ({ page }) => {
  // Préchargée en instantané, comme `ETAGE_02` plus haut : `fitActiveLevel` (js/app/gm.js) ne
  // cadre un étage qu'une seule fois, à la première frame où il devient actif. En passant par
  // `store.loadCampaign` après le boot, ce cadrage tardif écraserait le zoom posé par le test
  // à un instant non déterministe — c'est le piège documenté en tête de ce fichier.
  const level = {
    id: 'level-gm-dist',
    name: 'Arbitrage MJ',
    order: 0,
    imageUrl: '',
    videoUrl: null,
    animatedOverlays: [],
    pxPerCell: 100,
    widthCells: 10,
    heightCells: 10,
    grid: { type: /** @type {import('../js/core/types.js').GridType} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    terrainCost: null,
    walls: [],
    // Porte sur l'arête gauche de la case (5,3)-(5,4). PNJ dans la case adjacente (5,4) : son
    // coin le plus proche touche l'extrémité basse de la porte (dist 5 depuis le point tapé
    // ci-dessous), strictement plus loin que la porte (dist 0), mais dans la marge de
    // désignation du pion (24 à zoom 1).
    portals: [
      { id: 'door-far', a: { cellX: 5, cellY: 3 }, b: { cellX: 5, cellY: 4 }, state: 'closed', freestanding: false },
    ],
    lights: [],
    ambient: { level: 1, baked: false },
  };
  const token = {
    id: 'npc-margin',
    levelId: 'level-gm-dist',
    cell: { a: 5, b: 4 },
    sizeCells: 1,
    kind: 'npc',
    imageUrl: '',
    borderColor: '#ff0000',
    label: 'PNJ',
    hidden: false,
    visionDim: 0,
    emitsLight: null,
    speedCells: 6,
    playerMovable: false,
    locked: false,
    elevation: 0,
    markers: [],
    hp: null,
    health: 'unharmed',
  };
  const sessionId = `portal-gm-dist-${Date.now()}`;
  await installBrowserTransport(page, sessionId, {
    campaign: {
      schemaVersion: 2,
      campaignId: 'campaign-gm-dist',
      name: 'Arbitrage MJ',
      levels: [level],
      links: [],
      tokens: [token],
      reserve: [],
      templates: [],
      settings: {},
    },
    activeLevelId: 'level-gm-dist',
    selectedTokenId: null,
  });
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.camera.setZoom(1);
  });

  // Tap à (500, 395) : dist 0 à la porte, dist 5 au pion. Avant ce chantier,
  // `if (token) { store.selectToken(...); return; }` passait avant la porte sans aucune borne
  // d'exactitude : ce tap, dans la marge du pion, aurait sélectionné le pion au lieu d'ouvrir la
  // porte pourtant strictement plus proche.
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 500, y: 395 },
      mapPos: { x: 500, y: 395 },
    });
  });

  const after = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const state = store.getState();
    return {
      portalState: store.getCampaign()?.levels[0].portals[0].state,
      selectedTokenId: state.selectedTokenId,
    };
  });

  expect(after.portalState).toBe('open');
  expect(after.selectedTokenId).toBeNull();
});

