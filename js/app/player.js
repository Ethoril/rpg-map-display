// @ts-check

import { initStage, renderLayerStack } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { FogLayer } from '../render/layers/fogLayer.js';
import { PortalsLayer } from '../render/layers/portals.js';
import { TemplatesLayer } from '../render/layers/templates.js';
import { decodeFogPng } from '../vision/fog.js';
import { gridFor } from '../grid/index.js';
import { bootstrapPlayerView } from '../ui/player/bootstrap.js';
import { mountPlayerVersionBadge } from '../ui/versionBadge.js';
import { mountHandoutOverlay } from '../ui/player/handoutOverlay.js';
import { VISION_REQUEST_EVENT } from '../core/constants.js';
import { createNetworkStatus, connectSession, normalizeSessionId } from './session.js';
import { applyNetworkEvent, createSnapshotPayload } from './networkEvents.js';
import * as store from '../state/store.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

// Icônes du bouton plein écran : quatre coins qui s'écartent (entrer) ou se rejoignent
// (sortir). Dessinées en SVG plutôt qu'en caractère Unicode — les glyphes « plein écran »
// ne sont pas dans toutes les fontes système, et un carré tofu au-dessus de la carte est
// pire que pas de bouton.
const ICON_FULLSCREEN_ENTER =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_FULLSCREEN_EXIT =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3"/></svg>';

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

  // Bouton de bascule plein écran, en haut à droite.
  //
  // Deuxième dérogation tapable au zéro-UI de la vue joueurs (cf. CONVENTIONS.md §8,
  // interdiction 2), demandée le 30 juillet 2026. Le plein écran n'était tenté qu'au tout
  // premier geste : un refus du navigateur, ou une sortie par le geste système de la
  // tablette, laissait la carte en fenêtré sans aucun moyen d'y revenir hors rechargement.
  const documentElement = document.documentElement;
  const requestFullscreen =
    documentElement.requestFullscreen ||
    /** @type {any} */ (documentElement).webkitRequestFullscreen;
  const exitFullscreen =
    document.exitFullscreen || /** @type {any} */ (document).webkitExitFullscreen;
  // Sur un navigateur sans API plein écran (Safari iOS), le bouton ne pourrait rien faire :
  // on n'en met pas. Le zéro-UI reste alors intact.
  const fullscreenSupported =
    typeof requestFullscreen === 'function' &&
    typeof exitFullscreen === 'function' &&
    document.fullscreenEnabled !== false;

  const isFullscreen = () =>
    Boolean(document.fullscreenElement || /** @type {any} */ (document).webkitFullscreenElement);

  /** @type {HTMLButtonElement|null} */
  let fullscreenButton = null;

  if (fullscreenSupported) {
    fullscreenButton = document.createElement('button');
    fullscreenButton.id = 'player-fullscreen-btn';
    fullscreenButton.type = 'button';
    fullscreenButton.style.position = 'fixed';
    fullscreenButton.style.top = '12px';
    fullscreenButton.style.right = '12px';
    // Au-dessus du handout (9000), sous l'avertissement de version (9999) : une image
    // révélée ne doit pas piéger la tablette en fenêtré, mais rien ne masque une alerte.
    fullscreenButton.style.zIndex = '9500';
    fullscreenButton.style.width = '44px';
    fullscreenButton.style.height = '44px';
    fullscreenButton.style.display = 'flex';
    fullscreenButton.style.alignItems = 'center';
    fullscreenButton.style.justifyContent = 'center';
    fullscreenButton.style.padding = '0';
    fullscreenButton.style.border = '0';
    fullscreenButton.style.borderRadius = '8px';
    fullscreenButton.style.background = 'rgba(0, 0, 0, 0.45)';
    fullscreenButton.style.color = '#ffffff';
    // Discret par défaut : présent pour la main qui le cherche, oublié par les yeux.
    fullscreenButton.style.opacity = '0.4';
    fullscreenButton.style.transition = 'opacity 0.2s ease';
    fullscreenButton.style.cursor = 'pointer';
    fullscreenButton.style.touchAction = 'manipulation';
    fullscreenButton.style.setProperty('-webkit-tap-highlight-color', 'transparent');
    document.body.appendChild(fullscreenButton);
  }

  function renderFullscreenButton() {
    if (!fullscreenButton) return;
    const actif = isFullscreen();
    fullscreenButton.innerHTML = actif ? ICON_FULLSCREEN_EXIT : ICON_FULLSCREEN_ENTER;
    const libelle = actif ? 'Quitter le plein écran' : 'Plein écran';
    fullscreenButton.title = libelle;
    fullscreenButton.setAttribute('aria-label', libelle);
  }

  const onToggleFullscreen = async () => {
    if (!fullscreenButton) return;
    fullscreenButton.style.opacity = '1';
    try {
      if (isFullscreen()) {
        await exitFullscreen.call(document);
      } else {
        await requestFullscreen.call(documentElement);
        // Le plein écran est le moment où l'orientation et la veille comptent le plus.
        await lockOrientation();
        await acquireWakeLock();
      }
    } catch (err) {
      // Le navigateur peut refuser (hors geste utilisateur, mode PiP…). On le dit, et la
      // carte continue de fonctionner en fenêtré.
      console.warn('Bascule plein écran refusée par le navigateur :', err);
    }
    renderFullscreenButton();
    fullscreenButton.style.opacity = '0.4';
  };

  const onFullscreenChange = () => renderFullscreenButton();

  const onVisibilityChange = () => {
    if (!document.hidden) void acquireWakeLock();
  };
  let firstGestureDone = false;
  /** @param {Event} event */
  const onFirstGesture = (event) => {
    // Le bouton est maître de sa propre bascule : le laisser déclencher aussi l'activation
    // « au premier geste » ferait entrer puis ressortir du plein écran sur le même tap,
    // `pointerdown` précédant `click`.
    if (
      fullscreenButton &&
      event.target instanceof Node &&
      fullscreenButton.contains(event.target)
    ) {
      return;
    }
    if (firstGestureDone) return;
    firstGestureDone = true;
    document.removeEventListener('pointerdown', onFirstGesture);
    void activateFromGesture();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('pointerdown', onFirstGesture);
  if (fullscreenButton) {
    fullscreenButton.addEventListener('click', () => void onToggleFullscreen());
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    renderFullscreenButton();
  }
  await lockOrientation();
  await acquireWakeLock();

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('pointerdown', onFirstGesture);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    fullscreenButton?.remove();
    fullscreenButton = null;
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
  const portalsLayer = new PortalsLayer();
  const moveZoneLayer = new MoveZoneLayer();
  const templatesLayer = new TemplatesLayer();
  const tokensLayer = new TokensLayer({ invalidate: requestRender });
  const fogLayer = new FogLayer();

  /** @type {Map<string, { png: string, canvas: any }>} */
  const playerExploredCanvasMap = new Map();

  /**
   * @param {import('../core/types.js').Level|null} level
   */
  function getPlayerExploredCanvas(level) {
    if (!level) return null;
    const png = store.getSessionFog(level.id);
    if (!png) return null;

    const existing = playerExploredCanvasMap.get(level.id);
    if (existing && existing.png === png) {
      return existing.canvas;
    }

    void decodeFogPng(png, level.widthCells, level.heightCells).then((canvas) => {
      playerExploredCanvasMap.set(level.id, { png, canvas });
      requestRender();
    });

    return existing ? existing.canvas : null;
  }

  /** @type {Map<string, { png: string, canvas: any }>} */
  const playerVisibleCanvasMap = new Map();

  /**
   * @param {import('../core/types.js').Level|null} level
   */
  function getPlayerVisibleCanvas(level) {
    if (!level) return null;
    const png = store.getSessionVision(level.id);
    if (!png) return null;

    const existing = playerVisibleCanvasMap.get(level.id);
    if (existing && existing.png === png) {
      return existing.canvas;
    }

    void decodeFogPng(png, level.widthCells, level.heightCells).then((canvas) => {
      playerVisibleCanvasMap.set(level.id, { png, canvas });
      requestRender();
    });

    return existing ? existing.canvas : null;
  }

  const urlParams = new URLSearchParams(window.location.search);

  // Même normalisation que côté MJ : le code est recopié à la main sur la tablette, la
  // casse ne doit pas décider silencieusement d'une autre session.
  const sessionId =
    options.sessionId || normalizeSessionId(urlParams.get('session')) || 'local-player';
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
      // Pas de battement côté joueurs : verrouiller est réservé au MJ (CdC §12 Q3), donc un
      // tap joueurs sur une porte verrouillée n'a rien à signaler qu'il puisse changer.
      portals: () => portalsLayer.render(stage.context, grid, activeLevel, { zoom: camera.zoom }),
      moveZone: () =>
        moveZoneLayer.render(stage.context, grid, {
          selectedToken: state.selectedToken,
          reachableCells: state.reachableCells,
        }),
      templates: () =>
        templatesLayer.render(stage.context, grid, activeLevel, state.campaign?.templates ?? [], true),
      tokens: () => {
        const visibleCanvas = getPlayerVisibleCanvas(activeLevel);
        const result = tokensLayer.render(
          stage.context,
          grid,
          state.campaign?.tokens ?? [],
          state.selectedTokenId,
          {
            role: 'players',
            activeLevelId: activeLevel.id,
            activeLevelWidthCells: activeLevel.widthCells,
            activeLevelHeightCells: activeLevel.heightCells,
            visibleCanvas,
            // ⛔ Aucun masque de vision publié pour cet étage ⇒ aucun pion dessiné.
            //
            // La couche ne peut pas déduire cette règle de l'absence de masque : un appelant qui
            // n'en passe pas volontairement — rendu hors fog, contrôle par rôle — doit garder
            // l'ancien comportement. Seule la vue joueurs sait qu'un masque était **attendu**.
            //
            // Le cas devient courant avec le sélecteur d'étage joueurs : sur un étage sans PJ, le
            // MJ ne calcule aucune vision, et sans ce drapeau la table y verrait tous les PNJ.
            visionPublished: store.getSessionVision(activeLevel.id) !== null,
            now: Date.now(),
            zoom: camera.zoom,
            resolution: stage.resolution,
          }
        );
        // `||=` et non `=`, par symétrie avec la vue MJ : les pions ne sont plus la seule
        // couche susceptible de s'animer, et une affectation effacerait le drapeau d'une couche
        // dessinée avant eux. Rien ne s'anime avant eux ici aujourd'hui — c'est justement pour
        // que ce ne soit pas un piège demain.
        animationActive ||= result.animationActive;
      },
      fog: () =>
        fogLayer.render(
          stage.context,
          grid,
          activeLevel,
          state.campaign?.tokens ?? [],
          {
            role: 'players',
            exploredCanvas: getPlayerExploredCanvas(activeLevel),
            visibleCanvas: getPlayerVisibleCanvas(activeLevel),
          }
        ),
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

  /**
   * Réclame au MJ la rediffusion du masque de vision courante.
   *
   * Le masque exploré remonte de `localStorage`, la vision non — et le canal ne rejoue rien.
   * Sans cette demande, la tablette affiche le voile « exploré mais non visible » là où les PJ
   * voient, jusqu'à ce qu'un déplacement change la signature côté MJ et le décide à publier.
   * C'est le défaut de séance du 6 août 2026.
   *
   * Appelée à deux moments, qui ne se recouvrent pas :
   *  - au démarrage, y compris après un F5 ou un contexte d'onglet abandonné par le système ;
   *  - au retour au premier plan, car les événements publiés pendant que la tablette dormait
   *    ne sont pas rejoués — l'écoute reprend strictement après la dernière clé connue.
   */
  function requestVisionResend() {
    if (!transport) return;
    transport.publish({
      type: VISION_REQUEST_EVENT,
      payload: { levelId: store.getActiveLevel()?.id ?? null },
      at: Date.now(),
      by: 'players',
    });
  }

  const onVisibilityRestored = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    requestVisionResend();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityRestored);
  }
  requestVisionResend();

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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityRestored);
    }
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
    getPlayerVisibleCanvas,
    getPlayerExploredCanvas,
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
