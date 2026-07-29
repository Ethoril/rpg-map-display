// @ts-check
import { initStage } from '../render/stage.js';
import { Camera } from '../render/camera.js';
import { FrameLoop } from '../render/frame.js';
import { BackgroundLayer } from '../render/layers/background.js';
import { GridLayer } from '../render/layers/gridLayer.js';
import { MoveZoneLayer } from '../render/layers/moveZone.js';
import { TokensLayer } from '../render/layers/tokens.js';
import { PointerInput } from '../input/pointer.js';
import { gridFor } from '../grid/index.js';
import { createGMPanel } from '../ui/gm/panel.js';
import { FirebaseTransport } from '../transport/FirebaseTransport.js';
import { computeBlockedEdges } from '../import/blockedEdges.js';
import { terrainCostRecordToMap } from '../core/schema.js';
import { findPath } from '../movement/path.js';
import { cellKey } from '../core/cellKey.js';
import * as store from '../state/store.js';

/** @typedef {import('../transport/Transport.js').Transport} Transport */

/**
 * Initialise l'application MJ (Point d'entrée).
 *
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas]
 * @param {HTMLElement} [options.panelContainer]
 * @param {Transport} [options.transport]
 * @param {Record<string, any>} [options.firebaseConfig]
 */
export async function bootstrapGMApp(options = {}) {
  const canvas =
    options.canvas ||
    /** @type {HTMLCanvasElement} */ (document.querySelector('#board')) ||
    document.createElement('canvas');

  const panelContainer =
    options.panelContainer ||
    /** @type {HTMLElement} */ (document.querySelector('#gm-panel'));

  // 1. Initialisation Canvas 2D natif et des couches
  const { canvas: canvasElem, context: ctx, layers, resolution } = await initStage(canvas);

  // 2. Caméra & Boucle de rendu à la demande
  const width = canvasElem.width / resolution;
  const height = canvasElem.height / resolution;
  const camera = new Camera(width, height);
  const frameLoop = new FrameLoop(() => renderAll());

  // Instanciation des couches de rendu
  const bgLayer = new BackgroundLayer(layers.background);
  const gridLayer = new GridLayer(layers.gridLayer);
  const moveZoneLayer = new MoveZoneLayer(layers.moveZone);
  const tokensLayer = new TokensLayer(layers.tokens);

  // Flag auto-zoom une seule fois au changement de niveau
  /** @type {string|null} */
  let lastActiveLevelId = null;

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
      const gridAdapter = gridFor(activeLevel);
      const bounds = gridAdapter.mapFromCellPoint({ cellX: activeLevel.widthCells, cellY: activeLevel.heightCells });

      // Auto-center et zoom une seule fois par niveau
      if (activeLevel.id !== lastActiveLevelId) {
        lastActiveLevelId = activeLevel.id;
        const centerX = bounds.x / 2;
        const centerY = bounds.y / 2;
        const zoomX = width / bounds.x;
        const zoomY = height / bounds.y;
        const fitZoom = Math.min(zoomX, zoomY);

        camera.setPan(centerX, centerY);
        camera.setZoom(fitZoom);
      }

      if (activeLevel.imageUrl) {
        bgLayer.load(activeLevel.imageUrl);
        bgLayer.render(ctx);
      } else {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, bounds.x, bounds.y);
      }

      try {
        gridLayer.render(ctx, gridAdapter);
      } catch (e) {
        console.error('[DEBUG] Erreur gridLayer.render():', e);
      }

      const tokens = campaign ? campaign.tokens : [];
      tokensLayer.render(ctx, gridAdapter, tokens, selectedTokenId, { role: 'gm' });

      if (selectedToken && reachableCells && reachableCells.size > 0) {
        moveZoneLayer.render(ctx, gridAdapter, selectedTokenId, reachableCells, selectedToken);
      } else {
        moveZoneLayer.clear();
      }
    }

    ctx.restore();
    frameLoop.requestFrame();
  }

  // S'abonner aux mutations du store
  store.subscribe(renderAll);

  // 3. Gestion du transport de synchronisation réseau
  let transport = options.transport || null;
  const urlParams = new URLSearchParams(window.location.search);

  const DEFAULT_SESSION_ID = 'local_' + (sessionStorage.getItem('sessionId') || 'default');
  if (!sessionStorage.getItem('sessionId')) {
    sessionStorage.setItem('sessionId', DEFAULT_SESSION_ID.replace('local_', ''));
  }
  const sessionId = urlParams.get('session') || DEFAULT_SESSION_ID;
  const fbConfig = options.firebaseConfig || null;

  if (!transport && sessionId && fbConfig) {
    try {
      const fb = new FirebaseTransport(fbConfig);
      await fb.connect(sessionId, 'gm');
      transport = fb;
    } catch (e) {
      console.warn('Transport Firebase non disponible :', e);
    }
  }

  // Restauration du snapshot
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

  // Réinitialiser caméra après restauration
  camera.setZoom(1);
  camera.setPan(0, 0);
  frameLoop.requestFrame();

  // 4. Montage du panneau MJ
  if (panelContainer) {
    createGMPanel(panelContainer, { transport: transport || undefined });
  }

  // 5. Gestion des événements d'entrée
  /**
   * @param {import('../input/gestures.js').InputIntention} intention
   */
  function handleIntention(intention) {
    if (intention.type === 'panBy') {
      camera.setPan(camera.x - intention.deltaX / camera.zoom, camera.y - intention.deltaY / camera.zoom);
      renderAll();
    } else if (intention.type === 'pinchZoom') {
      const oldZoom = camera.zoom;
      camera.setZoom(oldZoom * intention.scaleFactor);
      renderAll();
    } else if (intention.type === 'tapToken' || intention.type === 'tapCell') {
      const state = store.getState();
      const { campaign, activeLevel, selectedToken, reachableCells } = state;
      if (!campaign || !activeLevel) return;

      const grid = gridFor(activeLevel);
      let mapPos;
      if (intention.type === 'tapCell') {
        mapPos = intention.at;
      } else {
        mapPos = camera.screenToMap(intention.at);
      }

      const targetCell = grid.cellFromPoint(mapPos);

      if (!targetCell) {
        store.selectToken(null);
        return;
      }

      const tappedToken = campaign.tokens.find((t) => {
        if (t.levelId !== activeLevel.id) return false;
        const size = t.sizeCells || 1;
        return (
          targetCell.a >= t.cell.a &&
          targetCell.a < t.cell.a + size &&
          targetCell.b >= t.cell.b &&
          targetCell.b < t.cell.b + size
        );
      });

      if (tappedToken) {
        store.selectToken(tappedToken.id);
      } else if (selectedToken) {
        const targetKey = cellKey(targetCell);
        if (reachableCells.has(targetKey)) {
          const blockedEdges = computeBlockedEdges(activeLevel, grid);
          const terrainCostMap = terrainCostRecordToMap(activeLevel.terrainCost);
          const path = findPath(grid, selectedToken.cell, targetCell, blockedEdges, terrainCostMap);
          const startedAt = Date.now();

          store.moveTokenToCell(selectedToken.id, targetCell, {
            from: { a: selectedToken.cell.a, b: selectedToken.cell.b },
            to: { a: targetCell.a, b: targetCell.b },
            path,
            startedAt,
          });

          if (transport) {
            transport.publish({
              type: 'token.move',
              payload: {
                tokenId: selectedToken.id,
                from: { a: selectedToken.cell.a, b: selectedToken.cell.b },
                to: { a: targetCell.a, b: targetCell.b },
                path,
                startedAt,
              },
              at: startedAt,
              by: 'gm',
            });
          }
        } else {
          store.selectToken(null);
        }
      }
    }
  }

  const pointerInput = new PointerInput(canvas, camera, {
    role: 'gm',
    onIntention: handleIntention,
  });

  // Redimensionnement
  window.addEventListener('resize', () => {
    const w = canvasElem.width / resolution;
    const h = canvasElem.height / resolution;
    camera.setViewport(w, h);
    renderAll();
  });

  // Premier rendu
  renderAll();

  return {
    canvasElem,
    ctx,
    camera,
    frameLoop,
    pointerInput,
    transport,
  };
}

// Démarrage automatique dans le DOM si script principal
if (typeof document !== 'undefined' && document.readyState !== 'loading') {
  bootstrapGMApp();
} else if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => bootstrapGMApp());
}
