// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { FogLayer } from '../render/layers/fogLayer.js';

import { PointerInput } from '../input/pointer.js';
import { gridFor } from '../grid/index.js';
import { extractBlockedSegments } from '../import/blockedEdges.js';
import { GM_SESSION_STORAGE_KEY, VISION_MAX_RANGE_CELLS } from '../core/constants.js';

import { createGMPanel } from '../ui/gm/panel.js';
import { ExploredFog } from '../vision/fog.js';

import {
  createNetworkStatus,
  connectSession,
  createSessionCode,
  normalizeSessionId,
} from './session.js';
import { applyNetworkEvent, createSnapshotPayload } from './networkEvents.js';
import * as store from '../state/store.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */

/**
 * @param {import('../core/types.js').Campaign|null} campaign
 * @param {import('../core/types.js').Level|null} activeLevel
 * @param {import('../core/types.js').Cell|null} cell
 */
function tokenAtCell(campaign, activeLevel, cell) {
  if (!campaign || !activeLevel || !cell) return null;
  return (
    campaign.tokens.find((token) => {
      if (token.levelId !== activeLevel.id) return false;
      const size = Math.max(1, token.sizeCells || 1);
      return (
        cell.a >= token.cell.a &&
        cell.a < token.cell.a + size &&
        cell.b >= token.cell.b &&
        cell.b < token.cell.b + size
      );
    }) ?? null
  );
}

function defaultGmSessionId() {
  const existing = sessionStorage.getItem(GM_SESSION_STORAGE_KEY);
  if (existing) return existing;
  // Un UUID était illisible et intypable : le MJ doit dicter ce code, ou le recopier à la
  // main sur la tablette, en n'ayant aucun moyen de le copier-coller d'un appareil à
  // l'autre. Cf. createSessionCode dans app/session.js.
  const created = createSessionCode();
  sessionStorage.setItem(GM_SESSION_STORAGE_KEY, created);
  return created;
}

/**
 * Initialise l'application MJ.
 *
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {HTMLElement} [options.panelContainer]
 * @param {Transport} [options.transport]
 * @param {Record<string, any>} [options.firebaseConfig]
 * @param {string} [options.sessionId]
 */
export async function bootstrapGMApp(options = {}) {
  const canvas =
    options.canvas ||
    /** @type {HTMLCanvasElement|null} */ (document.querySelector('#board')) ||
    document.createElement('canvas');
  const panelContainer =
    options.panelContainer ||
    /** @type {HTMLElement|null} */ (document.querySelector('#gm-panel'));

  const stage = await initStage(canvas);
  const camera = new Camera(stage.width, stage.height);
  /** @type {FrameLoop} */
  let frameLoop;
  const requestRender = () => frameLoop?.requestFrame();

  const backgroundLayer = new BackgroundLayer({ invalidate: requestRender });
  const gridLayer = new GridLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const tokensLayer = new TokensLayer({ invalidate: requestRender });
  const fogLayer = new FogLayer();

  /** @type {Map<string, ExploredFog>} */
  const exploredFogMap = new Map();
  /** @type {Map<string, number>} */
  const lastFogPublishTime = new Map();
  /** @type {Map<string, any>} */
  const fogPublishTrailing = new Map();

  /**
   * Masque exploré de l'étage, créé à la demande et restauré depuis la session.
   *
   * Domicile unique de cette création : le rendu **et** la révélation le long d'un
   * déplacement en ont besoin, et deux fabriques divergeraient — chacune tiendrait son
   * propre masque, et l'une des deux publierait un fog amputé.
   *
   * @param {import('../core/types.js').Level|null} level
   * @returns {ExploredFog|null}
   */
  function getExploredFog(level) {
    if (!level) return null;
    let fog = exploredFogMap.get(level.id);
    if (!fog || fog.widthCells !== level.widthCells || fog.heightCells !== level.heightCells) {
      fog = new ExploredFog(level.widthCells, level.heightCells);
      exploredFogMap.set(level.id, fog);
      const savedFog = store.getSessionFog(level.id);
      if (savedFog) void fog.importPng(savedFog);
    }
    return fog;
  }

  /**
   * Publication du masque exploré au réseau, throttlée à 1 Hz (CdC §7).
   *
   * ⚠ Le throttle porte une **traîne**. Sans elle, la dernière révélation d'une rafale
   * resterait indéfiniment non publiée : le rendu ne rappelle cette fonction que sur
   * changement, donc si plus rien ne bouge après un déplacement throttlé, les tablettes
   * gardent un fog en retard d'un mouvement — sans que rien ne le signale.
   *
   * @param {string} levelId
   * @param {ExploredFog} exploredFog
   */
  function scheduleFogPublish(levelId, exploredFog) {
    const now = Date.now();
    const lastTime = lastFogPublishTime.get(levelId) || 0;
    const reste = 1000 - (now - lastTime);

    if (reste > 0) {
      if (!fogPublishTrailing.has(levelId)) {
        fogPublishTrailing.set(
          levelId,
          setTimeout(() => {
            fogPublishTrailing.delete(levelId);
            scheduleFogPublish(levelId, exploredFog);
          }, reste)
        );
      }
      return;
    }

    lastFogPublishTime.set(levelId, now);
    void exploredFog.exportPng().then((png) => {
      if (!png) return;
      store.setSessionFog(levelId, png);
      transport?.publish({
        type: 'fog.update',
        payload: { levelId, png },
        at: Date.now(),
        by: 'gm',
      });
    });
  }

  /** @type {Map<string, ExploredFog>} */
  const visibleFogMap = new Map();
  /** @type {Map<string, string>} */
  const lastVisibleSignatureMap = new Map();

  /**
   * Publication en temps réel du masque de vision courante (visible).
   *
   * ⚠ La comparaison se fait sur la **signature**, donc AVANT l'encodage. Une première
   * version appelait `exportPng()` à chaque image puis comparait la chaîne obtenue :
   * `getImageData` et deflate — environ 6 ms sur la grande carte — tournaient à chaque
   * image pendant l'animation d'un déplacement, pour presque toujours conclure « rien
   * n'a changé ». C'est aussi un `getImageData` sur le chemin de déplacement, que le
   * critère 8 interdit. `scheduleFogPublish`, juste au-dessus, avait déjà le bon
   * réflexe : filtrer avant de payer.
   *
   * Contrairement au masque exploré, `visible` n'est **pas** throttlé : le critère 10
   * exige qu'ouvrir une porte étende la vision en moins de 300 ms.
   *
   * @param {string} levelId
   * @param {ExploredFog} visibleFog
   * @param {string} signature Signature de la vision courante
   */
  function publishVisibleVision(levelId, visibleFog, signature) {
    if (lastVisibleSignatureMap.get(levelId) === signature) return;
    lastVisibleSignatureMap.set(levelId, signature);

    void visibleFog.exportPng().then((png) => {
      store.setSessionVision(levelId, png);
      transport?.publish({
        type: 'vision.update',
        payload: { levelId, png },
        at: Date.now(),
        by: 'gm',
      });
    });
  }

  /**
   * Cases traversées par un déplacement, extrémités comprises.
   *
   * Le MJ franchit les murs — privilège assumé et documenté (`PLAN-LOT2.md`) — donc le
   * trajet est la droite entre les deux cases, pas un chemin calculé. C'est aussi ce que
   * `token.move` publie déjà.
   *
   * @param {import('../core/types.js').Cell} from
   * @param {import('../core/types.js').Cell} to
   * @returns {import('../core/types.js').Cell[]}
   */
  function cellsAlongPath(from, to) {
    const da = to.a - from.a;
    const db = to.b - from.b;
    const pas = Math.max(Math.abs(da), Math.abs(db));
    if (pas === 0) return [{ a: from.a, b: from.b }];

    /** @type {import('../core/types.js').Cell[]} */
    const cases = [];
    for (let i = 0; i <= pas; i++) {
      cases.push({
        a: from.a + Math.round((da * i) / pas),
        b: from.b + Math.round((db * i) / pas),
      });
    }
    return cases;
  }

  /**
   * Révèle le fog exploré sur **toute** la trajectoire d'un pion porteur de vision.
   *
   * Critère 7 : sans cette passe, traverser un couloir ne révélerait que le départ et
   * l'arrivée, et le milieu resterait noir. Le rendu, lui, ne connaît que la position
   * courante — il ne peut pas rattraper les cases déjà quittées.
   *
   * @param {import('../core/types.js').Level} level
   * @param {import('../core/types.js').Token} token
   * @param {import('../core/types.js').Cell} from
   * @param {import('../core/types.js').Cell} to
   * @returns {number} Nombre de cases balayées, 0 si le pion ne porte pas de vision
   */
  function revealAlongMove(level, token, from, to) {
    if (!level || !token || token.kind !== 'pc') return 0;
    const rangeCells = Math.min(token.visionDim ?? 0, VISION_MAX_RANGE_CELLS);
    if (rangeCells <= 0) return 0;

    const grid = gridFor(level);
    const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const gridScale = Math.abs(origin1.x - origin0.x);
    const originR = grid.mapFromCellPoint({ cellX: rangeCells, cellY: 0 });
    const rangePx = Math.hypot(originR.x - origin0.x, originR.y - origin0.y);

    const size = Math.max(1, token.sizeCells || 1);
    const origins = cellsAlongPath(from, to).map((cell) =>
      grid.mapFromCellPoint({ cellX: cell.a + size / 2, cellY: cell.b + size / 2 })
    );

    const exploredFog = getExploredFog(level);
    if (!exploredFog) return 0;

    const balayees = exploredFog.revealPath(
      origins,
      extractBlockedSegments(level, grid),
      rangePx,
      origin0,
      gridScale
    );
    scheduleFogPublish(level.id, exploredFog);
    return balayees;
  }

  /** @type {{tokenId: string, mapPos: MapPoint}|null} */
  let dragPreview = null;
  /** @type {string|null} */
  let lastActiveLevelId = null;
  let restoredCamera = false;


  function fitActiveLevel() {
    const activeLevel = store.getActiveLevel();
    if (!activeLevel || activeLevel.id === lastActiveLevelId) return;
    lastActiveLevelId = activeLevel.id;
    if (restoredCamera) {
      restoredCamera = false;
      return;
    }
    const grid = gridFor(activeLevel);
    const bottomRight = grid.mapFromCellPoint({
      cellX: activeLevel.widthCells,
      cellY: activeLevel.heightCells,
    });
    camera.setPan(bottomRight.x / 2, bottomRight.y / 2);
    camera.setZoom(
      Math.min(stage.width / Math.max(1, bottomRight.x), stage.height / Math.max(1, bottomRight.y))
    );
  }

  function renderAll() {
    stage.context.save();
    stage.context.setTransform(1, 0, 0, 1, 0, 0);
    stage.context.clearRect(0, 0, stage.canvas.width, stage.canvas.height);
    stage.context.restore();

    fitActiveLevel();
    const state = store.getState();
    const activeLevel = state.activeLevel;
    if (!activeLevel) return;

    const grid = gridFor(activeLevel);
    const bottomRight = grid.mapFromCellPoint({
      cellX: activeLevel.widthCells,
      cellY: activeLevel.heightCells,
    });
    void backgroundLayer.load(activeLevel.imageUrl);

    stage.context.save();
    stage.context.scale(stage.resolution, stage.resolution);
    camera.applyToContext(stage.context);

    let animationActive = false;
    renderLayerStack({
      background: () =>
        backgroundLayer.render(stage.context, bottomRight.x, bottomRight.y, { role: 'gm' }),
      grid: () => gridLayer.render(stage.context, grid),
      moveZone: () =>
        moveZoneLayer.render(stage.context, grid, {
          selectedToken: state.selectedToken,
          reachableCells: state.reachableCells,
        }),
      tokens: () => {
        const result = tokensLayer.render(
          stage.context,
          grid,
          state.campaign?.tokens ?? [],
          state.selectedTokenId,
          {
            role: 'gm',
            activeLevelId: activeLevel.id,
            now: Date.now(),
            dragPreview,
          }
        );
        animationActive = result.animationActive;
      },
      fog: () => {
        const exploredFog = getExploredFog(activeLevel);
        if (!exploredFog) return;

        fogLayer.render(
          stage.context,
          grid,
          activeLevel,
          state.campaign?.tokens ?? [],
          {
            role: 'gm',
            extractSegments: extractBlockedSegments,
            exploredCanvas: exploredFog.canvas,
          }
        );

        const polygons = fogLayer.getVisiblePolygons();
        const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
        const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
        const gridScale = Math.abs(origin1.x - origin0.x);

        if (polygons.length > 0) {
          exploredFog.reveal(polygons, origin0, gridScale);
          scheduleFogPublish(activeLevel.id, exploredFog);
        }

        // La vision courante ne se recompose et ne se republie que si elle a CHANGÉ.
        // Sans ce filtre, l'animation d'un déplacement encodait un PNG par image.
        const signature = fogLayer.getVisionSignature();
        if (lastVisibleSignatureMap.get(activeLevel.id) !== signature) {
          let visibleFog = visibleFogMap.get(activeLevel.id);
          if (
            !visibleFog ||
            visibleFog.widthCells !== activeLevel.widthCells ||
            visibleFog.heightCells !== activeLevel.heightCells
          ) {
            visibleFog = new ExploredFog(activeLevel.widthCells, activeLevel.heightCells);
            visibleFogMap.set(activeLevel.id, visibleFog);
          }
          visibleFog.clear();
          if (polygons.length > 0) {
            visibleFog.reveal(polygons, origin0, gridScale);
          }
          publishVisibleVision(activeLevel.id, visibleFog, signature);
        }
      },
    });


    stage.context.restore();
    if (animationActive) requestRender();
  }

  frameLoop = new FrameLoop(renderAll);

  const urlParams = new URLSearchParams(window.location.search);
  const sessionId =
    options.sessionId || normalizeSessionId(urlParams.get('session')) || defaultGmSessionId();
  store.setSessionId(sessionId);
  try {
    const saved = localStorage.getItem(`rpg_camera_${sessionId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed.x === 'number' &&
        typeof parsed.y === 'number' &&
        typeof parsed.zoom === 'number'
      ) {
        camera.setPan(parsed.x, parsed.y);
        camera.setZoom(parsed.zoom);
        restoredCamera = true;
      }
    }
  } catch {
    restoredCamera = false;
  }

  function persistCamera() {
    try {
      localStorage.setItem(
        `rpg_camera_${sessionId}`,
        JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom })
      );
    } catch {
      // Le rendu continue avec la caméra en mémoire.
    }
  }

  const networkStatus = createNetworkStatus('gm', sessionId);
  /** @type {Transport|null} */
  let transport = null;
  try {
    transport = await connectSession({
      injectedTransport: options.transport || null,
      firebaseConfig: options.firebaseConfig || null,
      sessionId,
      role: 'gm',
      loginHost: panelContainer,
      onStatus: networkStatus.update,
    });
  } catch {
    transport = null;
  }

  const transportExtended = /** @type {any} */ (transport);
  let applyingRemote = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let snapshotTimer = null;

  function scheduleSnapshot() {
    if (!transportExtended?.saveSnapshot || applyingRemote) return;
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      Promise.resolve(transportExtended.saveSnapshot(createSnapshotPayload())).catch((error) =>
        networkStatus.update('error', error)
      );
    }, 250);
  }

  const unsubscribeStore = store.subscribe(() => {
    requestRender();
    scheduleSnapshot();
  });

  /** @type {(() => void)|null} */
  let unsubscribeEvents = null;
  if (transport) {
    unsubscribeEvents = transport.subscribe((event) => {
      if (transportExtended.isOwnEvent?.(event)) return;
      applyingRemote = true;
      try {
        applyNetworkEvent(event);
      } finally {
        applyingRemote = false;
      }
    });
    try {
      const snapshot = /** @type {any} */ (await transport.snapshot());
      applyingRemote = true;
      try {
        if (snapshot && (snapshot.campaign || snapshot.levels)) {
          store.restoreFromSnapshot(snapshot, { sessionId });
        } else {
          store.loadFromLocalStorage(sessionId);
          const persistenceError = store.getLastPersistenceError();
          if (persistenceError) networkStatus.update('error', persistenceError);
        }
      } finally {
        applyingRemote = false;
      }
    } catch (error) {
      networkStatus.update('error', error);
      store.loadFromLocalStorage(sessionId);
    }
  } else {
    store.loadFromLocalStorage(sessionId);
    const persistenceError = store.getLastPersistenceError();
    if (persistenceError) networkStatus.update('error', persistenceError);
  }

  const gmPanel = panelContainer
    ? createGMPanel(panelContainer, { transport: transport || undefined, sessionId })
    : null;

  /**
   * @param {import('../input/gestures.js').InputIntention} intention
   */
  function handleIntention(intention) {
    if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
      persistCamera();
      requestRender();
      transport?.publish({
        type: 'view.change',
        payload: { camera: { x: camera.x, y: camera.y, zoom: camera.zoom } },
        at: Date.now(),
        by: 'gm',
      });
      return;
    }

    if (intention.type === 'pinchZoom') {
      const before = camera.screenToMap(intention.center);
      camera.setZoom(camera.zoom * intention.scaleFactor);
      const after = camera.screenToMap(intention.center);
      camera.setPan(camera.x + before.x - after.x, camera.y + before.y - after.y);
      persistCamera();
      requestRender();
      transport?.publish({
        type: 'view.change',
        payload: { camera: { x: camera.x, y: camera.y, zoom: camera.zoom } },
        at: Date.now(),
        by: 'gm',
      });
      return;
    }

    if (intention.type === 'tap') {
      const state = store.getState();
      if (!state.activeLevel) return;
      const grid = gridFor(state.activeLevel);
      const cell = grid.cellFromPoint(intention.mapPos);
      const token = tokenAtCell(state.campaign, state.activeLevel, cell);
      store.selectToken(token?.id ?? null);
      return;
    }

    if (intention.type === 'dragToken') {
      if (intention.phase !== 'end') {
        dragPreview = { tokenId: intention.tokenId, mapPos: intention.mapPos };
        requestRender();
        return;
      }

      dragPreview = null;
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) {
        requestRender();
        return;
      }
      const grid = gridFor(state.activeLevel);
      const targetCell = grid.cellFromPoint(intention.mapPos);
      const token = state.campaign.tokens.find((item) => item.id === intention.tokenId);
      if (!targetCell || !token || token.levelId !== state.activeLevel.id) {
        requestRender();
        return;
      }

      const from = { a: token.cell.a, b: token.cell.b };
      const startedAt = Date.now();
      store.moveTokenToCell(token.id, targetCell, {
        from,
        to: targetCell,
        path: [from, targetCell],
        startedAt,
      });

      // Critère 7 : le fog se révèle sur TOUTE la trajectoire, pas seulement à l'arrivée.
      // Le rendu ne connaît que la position courante et ne peut pas rattraper les cases
      // déjà quittées — c'est donc ici, au moment du déplacement, que ça se joue.
      revealAlongMove(state.activeLevel, token, from, targetCell);

      transport?.publish({
        type: 'token.move',
        payload: { tokenId: token.id, from, to: targetCell, path: [from, targetCell], startedAt },
        at: startedAt,
        by: 'gm',
      });
    }
  }

  const pointerInput = new PointerInput(canvas, camera, {
    role: 'gm',
    onIntention: handleIntention,
    canStartTokenDrag: (_screenPos, mapPos) => {
      const state = store.getState();
      if (!state.activeLevel) return null;
      const cell = gridFor(state.activeLevel).cellFromPoint(mapPos);
      return tokenAtCell(state.campaign, state.activeLevel, cell)?.id ?? null;
    },
  });

  const onResize = () => {
    stage.resize();
    camera.setViewport(stage.width, stage.height);
    lastActiveLevelId = null;
    requestRender();
  };
  window.addEventListener('resize', onResize);
  requestRender();

  const destroy = () => {
    pointerInput.detach();
    unsubscribeStore();
    unsubscribeEvents?.();
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    window.removeEventListener('resize', onResize);
    frameLoop.stop();
    persistCamera();
    gmPanel?.destroy();
    transport?.disconnect();
    networkStatus.remove();
  };

  return {
    canvas: stage.canvas,
    context: stage.context,
    camera,
    frameLoop,
    pointerInput,
    backgroundLayer,
    tokensLayer,
    transport,
    sessionId,
    destroy,
  };
}

function autoStart() {
  const globalOptions =
    typeof window !== 'undefined'
      ? /** @type {any} */ (window).__RPG_APP_OPTIONS__ || {}
      : {};
  const promise = bootstrapGMApp(globalOptions).then((app) => {
    /** @type {any} */ (window).__RPG_APP__ = app;
    return app;
  });
  /** @type {any} */ (window).__RPG_APP_PROMISE__ = promise;
}

if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  autoStart();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', autoStart, { once: true });
}