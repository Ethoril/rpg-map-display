// @ts-check
import { initStage } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { gridFor } from '../grid/index.js';
import { FirebaseTransport } from '../transport/FirebaseTransport.js';
import { bootstrapPlayerView } from '../ui/player/bootstrap.js';
import { mountPlayerVersionBadge } from '../ui/versionBadge.js';
import * as store from '../state/store.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

/**
 * Verrouille l'orientation (portrait mobile), le Wake Lock et tente le plein écran.
 */
async function setupMobileLocks() {
  if (typeof window === 'undefined') return;

  // 1. Verrouillage orientation (portrait mobile)
  const orientation = /** @type {any} */ (screen.orientation);
  if (orientation && typeof orientation.lock === 'function') {
    try {
      await orientation.lock('portrait');
    } catch {
      // Ignoré si non supporté ou refusé par le navigateur
    }
  }

  // 2. Wake Lock en contexte sécurisé
  if ('wakeLock' in navigator && window.isSecureContext) {
    try {
      await navigator.wakeLock.request('screen');
    } catch {
      // Ignoré si non supporté ou refusé par le navigateur
    }
  }

  // 3. Plein écran
  if (document.documentElement.requestFullscreen) {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Ignoré si non supporté ou refusé sans geste utilisateur
    }
  }
}

/**
 * Initialise l'application Joueurs (Point d'entrée).
 *
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {Transport} [options.transport]
 * @param {Record<string, any>} [options.firebaseConfig]
 */
export async function bootstrapPlayerApp(options = {}) {
  await setupMobileLocks();

  const canvas =
    options.canvas ||
    /** @type {HTMLCanvasElement} */ (document.querySelector('#board')) ||
    document.createElement('canvas');

  // 1. Initialisation du canvas 2D natif et des couches de rendu
  const { canvas: canvasElem, context: ctx, layers, resolution } = await initStage(canvas);

  // 2. Caméra & Boucle de rendu à la demande
  const width = canvasElem.width / resolution;
  const height = canvasElem.height / resolution;
  const camera = new Camera(width, height);
  const frameLoop = new FrameLoop(() => renderAll());

  const bgLayer = new BackgroundLayer(layers.background);
  const gridLayer = new GridLayer(layers.gridLayer);
  const moveZoneLayer = new MoveZoneLayer(layers.moveZone);
  const tokensLayer = new TokensLayer(layers.tokens);

  // Fonction de redessin global
  function renderAll() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasElem.width, canvasElem.height);
    ctx.restore();

    ctx.save();
    ctx.scale(resolution, resolution);
    camera.applyToContext(ctx);

    const state = store.getState();
    const { campaign, activeLevel, selectedToken, selectedTokenId, reachableCells } = state;

    if (activeLevel) {
      if (activeLevel.imageUrl) {
        bgLayer.load(activeLevel.imageUrl).then(() => {
          frameLoop.requestFrame();
        });
        bgLayer.render(ctx);
      }

      const gridAdapter = gridFor(activeLevel);
      gridLayer.render(ctx, gridAdapter);

      const tokens = campaign ? campaign.tokens : [];
      tokensLayer.render(ctx, gridAdapter, tokens, selectedTokenId, { role: 'players' });

      if (selectedToken && reachableCells && reachableCells.size > 0) {
        moveZoneLayer.render(ctx, gridAdapter, selectedTokenId, reachableCells, selectedToken);
      } else {
        moveZoneLayer.clear();
      }
    }

    ctx.restore();
    frameLoop.requestFrame();
  }

  // S'abonner aux changements d'état du store
  store.subscribe(renderAll);

  // 3. Transport Firebase & URL Autonome (?session=<id>&camera=follow)
  let transport = options.transport || null;
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  const cameraFollow = urlParams.get('camera') === 'follow';
  const fbConfig = options.firebaseConfig || null;

  if (sessionId) {
    store.setSessionId(sessionId);

    try {
      if (typeof localStorage !== 'undefined') {
        const savedCam = localStorage.getItem(`rpg_camera_${sessionId}`);
        if (savedCam) {
          const camData = JSON.parse(savedCam);
          if (typeof camData.x === 'number' && typeof camData.y === 'number') {
            camera.setPan(camData.x, camData.y);
          }
          if (typeof camData.zoom === 'number') {
            camera.setZoom(camData.zoom);
          }
        }
      }
    } catch {
      // Ignoré
    }
  }

  if (!transport && sessionId && fbConfig) {
    try {
      const fb = new FirebaseTransport(fbConfig);
      await fb.connect(sessionId, 'players');
      transport = fb;
    } catch (e) {
      console.warn('Transport Firebase non disponible en vue joueurs :', e);
    }
  }

  // Restauration du snapshot avant tout delta (T-24)
  if (sessionId) {
    store.setSessionId(sessionId);
  }
  if (transport && sessionId) {
    try {
      const snapshotData = /** @type {any} */ (await transport.snapshot());
      if (snapshotData && (snapshotData.levels || snapshotData.campaign)) {
        store.restoreFromSnapshot(snapshotData, { sessionId });
      } else {
        store.loadFromLocalStorage(sessionId);
      }
    } catch (e) {
      console.warn('Erreur restauration snapshot :', e);
      store.loadFromLocalStorage(sessionId);
    }
  } else if (sessionId) {
    store.loadFromLocalStorage(sessionId);
  }

  // 4. Montage du bootstrap de la vue joueurs (gestion des taps et synchro transport)
  const playerControls = bootstrapPlayerView({
    element: canvas,
    camera,
    transport: transport || undefined,
  });

  // Montage de l'overlay de version Joueurs
  const versionBadge = mountPlayerVersionBadge({
    transport: transport || undefined,
    role: 'players',
  });

  const persistCamera = () => {
    if (sessionId && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          `rpg_camera_${sessionId}`,
          JSON.stringify({ x: camera.x, y: camera.y, zoom: camera.zoom })
        );
      } catch {
        // Ignoré
      }
    }
  };

  // Interception des gestes de pan / pinch sur la vue joueurs
  const originalEmit = playerControls.pointerInput.emit.bind(playerControls.pointerInput);
  playerControls.pointerInput.emit = (intention) => {
    if (intention.type === 'panBy') {
      camera.setPan(camera.x - intention.deltaX / camera.zoom, camera.y - intention.deltaY / camera.zoom);
      persistCamera();
      renderAll();
    } else if (intention.type === 'pinchZoom') {
      camera.setZoom(camera.zoom * intention.scaleFactor);
      persistCamera();
      renderAll();
    }
    originalEmit(intention);
  };

  // Si camera=follow et qu'un événement camera/view est reçu du réseau
  if (cameraFollow && transport) {
    transport.subscribe((event) => {
      if (event.type === 'view.change' && event.payload) {
        const payload = /** @type {any} */ (event.payload);
        if (payload.camera) {
          if (typeof payload.camera.x === 'number' && typeof payload.camera.y === 'number') {
            camera.setPan(payload.camera.x, payload.camera.y);
          }
          if (typeof payload.camera.zoom === 'number') {
            camera.setZoom(payload.camera.zoom);
          }
          renderAll();
        }
      }
    });
  }

  // Redimensionnement de la fenêtre
  window.addEventListener('resize', () => {
    const parent = canvasElem.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight;
    canvasElem.width = Math.floor(w * resolution);
    canvasElem.height = Math.floor(h * resolution);
    canvasElem.style.width = `${w}px`;
    canvasElem.style.height = `${h}px`;
    camera.setViewport(w, h);
    renderAll();
  });

  renderAll();

  return {
    canvas: canvasElem,
    context: ctx,
    camera,
    frameLoop,
    pointerInput: playerControls.pointerInput,
    transport,
    detach: playerControls.detach,
  };
}

// Démarrage automatique dans le DOM
if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  bootstrapPlayerApp();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => bootstrapPlayerApp());
}
