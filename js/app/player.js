// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { gridFor } from '../grid/index.js';
import { bootstrapPlayerView } from '../ui/player/bootstrap.js';
import { mountPlayerVersionBadge } from '../ui/versionBadge.js';
import { mountHandoutOverlay } from '../ui/player/handoutOverlay.js';
import { createNetworkStatus, connectSession } from './session.js';
import { applyNetworkEvent, createSnapshotPayload } from './networkEvents.js';
import * as store from '../state/store.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

/**
 * @returns {Promise<() => void>}
 */
async function setupMobileLocks() {
  if (typeof window === 'undefined') return () => {};
  /** @type {any|null} */
  let wakeLock = null;

  async function lockOrientation() {
    const orientation = /** @type {any} */ (screen.orientation);
    if (!orientation || typeof orientation.lock !== 'function') return;
    try {
      await orientation.lock('landscape');
    } catch {
      // Une nouvelle tentative a lieu au premier geste.
    }
  }

  async function acquireWakeLock() {
    if (!('wakeLock' in navigator) || !window.isSecureContext || document.hidden) return;
    try {
      wakeLock = await /** @type {any} */ (navigator).wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }

  async function activateFromGesture() {
    await lockOrientation();
    await acquireWakeLock();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // La PWA peut être déjà plein écran ou le navigateur peut refuser.
      }
    }
  }

  const onVisibilityChange = () => {
    if (!document.hidden) void acquireWakeLock();
  };
  const onFirstGesture = () => {
    void activateFromGesture();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('pointerdown', onFirstGesture, { once: true });
  await lockOrientation();
  await acquireWakeLock();

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('pointerdown', onFirstGesture);
    try {
      wakeLock?.release?.();
    } catch {
      // Déjà libéré.
    }
    wakeLock = null;
  };
}

/**
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {Transport} [options.transport]
 * @param {Record<string, any>} [options.firebaseConfig]
 * @param {string} [options.sessionId]
 */
export async function bootstrapPlayerApp(options = {}) {
  const cleanupMobileLocks = await setupMobileLocks();
  const canvas =
    options.canvas ||
    /** @type {HTMLCanvasElement|null} */ (document.querySelector('#board')) ||
    document.createElement('canvas');
  const stage = await initStage(canvas);
  const camera = new Camera(stage.width, stage.height);
  /** @type {FrameLoop} */
  let frameLoop;
  const requestRender = () => frameLoop?.requestFrame();

  const backgroundLayer = new BackgroundLayer({ invalidate: requestRender });
  const gridLayer = new GridLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const tokensLayer = new TokensLayer({ invalidate: requestRender });

  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = options.sessionId || urlParams.get('session') || 'local-player';
  const cameraFollow = urlParams.get('camera') === 'follow';
  store.setSessionId(sessionId);

  let restoredCamera = false;
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

  /** @type {string|null} */
  let lastActiveLevelId = null;
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
        backgroundLayer.render(stage.context, bottomRight.x, bottomRight.y, {
          role: 'players',
        }),
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
            role: 'players',
            activeLevelId: activeLevel.id,
            now: Date.now(),
          }
        );
        animationActive = result.animationActive;
      },
    });
    stage.context.restore();
    if (animationActive) requestRender();
  }
  frameLoop = new FrameLoop(renderAll);

  const networkStatus = createNetworkStatus('players', sessionId);
  /** @type {Transport|null} */
  let transport = null;
  try {
    transport = await connectSession({
      injectedTransport: options.transport || null,
      firebaseConfig: options.firebaseConfig || null,
      sessionId,
      role: 'players',
      loginHost: document.body,
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
      if (cameraFollow && event.type === 'view.change') {
        const payload = /** @type {any} */ (event.payload);
        if (payload?.camera) {
          camera.setPan(payload.camera.x, payload.camera.y);
          camera.setZoom(payload.camera.zoom);
          requestRender();
        }
        return;
      }
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

  const playerControls = bootstrapPlayerView({
    element: canvas,
    camera,
    transport: transport || undefined,
  });
  const versionBadge = mountPlayerVersionBadge({
    transport: transport || undefined,
    role: 'players',
  });
  const handoutOverlay = mountHandoutOverlay();

  function persistCamera() {
    try {
      localStorage.setItem(
        `rpg_camera_${sessionId}`,
        JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom })
      );
    } catch {
      // Le rendu continue ; la caméra sera simplement réinitialisée au prochain chargement.
    }
  }

  const originalEmit = playerControls.pointerInput.emit.bind(playerControls.pointerInput);
  playerControls.pointerInput.emit = (intention) => {
    if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
      persistCamera();
      requestRender();
    } else if (intention.type === 'pinchZoom') {
      const before = camera.screenToMap(intention.center);
      camera.setZoom(camera.zoom * intention.scaleFactor);
      const after = camera.screenToMap(intention.center);
      camera.setPan(camera.x + before.x - after.x, camera.y + before.y - after.y);
      persistCamera();
      requestRender();
    }
    originalEmit(intention);
  };

  const onResize = () => {
    stage.resize();
    camera.setViewport(stage.width, stage.height);
    lastActiveLevelId = null;
    requestRender();
  };
  window.addEventListener('resize', onResize);
  requestRender();

  const destroy = () => {
    playerControls.detach();
    versionBadge.detach();
    handoutOverlay.detach();
    cleanupMobileLocks();
    unsubscribeStore();
    unsubscribeEvents?.();
    if (snapshotTimer !== null) clearTimeout(snapshotTimer);
    window.removeEventListener('resize', onResize);
    frameLoop.stop();
    transport?.disconnect();
    networkStatus.remove();
  };

  return {
    canvas: stage.canvas,
    context: stage.context,
    camera,
    frameLoop,
    pointerInput: playerControls.pointerInput,
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
  const promise = bootstrapPlayerApp(globalOptions).then((app) => {
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
