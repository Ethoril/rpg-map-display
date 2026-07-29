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

  // 1. Initialisation de l'application PixiJS v8 et de ses couches
  const { app, layers } = await initStage(canvas);

  // 2. Caméra & Boucle de rendu à la demande
  const width = canvas.clientWidth || 800;
  const height = canvas.clientHeight || 600;
  const camera = new Camera(width, height);
  const frameLoop = new FrameLoop(app);

  // Instanciation des couches de rendu
  const bgLayer = new BackgroundLayer(layers.background);
  const gridLayer = new GridLayer(layers.gridLayer);
  const moveZoneLayer = new MoveZoneLayer(layers.moveZone);
  const tokensLayer = new TokensLayer(layers.tokens);

  // Fonction de redessin global
  function renderAll() {
    console.log('[DEBUG] renderAll() exécutée');
    camera.applyToContainer(app.stage);

    const state = store.getState();
    const { campaign, activeLevel, selectedToken, selectedTokenId, reachableCells } = state;
    console.log('[DEBUG] renderAll state:', { hasActiveLevel: !!activeLevel, campaignLevels: campaign?.levels?.length });

    if (activeLevel) {
      console.log('[DEBUG] activeLevel.imageUrl :', activeLevel.imageUrl ? 'EXISTS' : 'UNDEFINED');
      if (activeLevel.imageUrl) {
        bgLayer.load(activeLevel.imageUrl);
      } else {
        console.log('[DEBUG] Pas d\'imageUrl, fond gris par défaut');
        app.stage.background = { r: 0.5, g: 0.5, b: 0.5 };
      }

      const gridAdapter = gridFor(activeLevel);
      try {
        console.log('[DEBUG] gridLayer.render() appelée');
        gridLayer.render(gridAdapter);
        console.log('[DEBUG] gridLayer.render() réussi');
      } catch (e) {
        console.error('[DEBUG] Erreur gridLayer.render():', e);
      }

      const tokens = campaign ? campaign.tokens : [];
      tokensLayer.render(gridAdapter, tokens, selectedTokenId, { role: 'gm' });

      if (selectedToken && reachableCells && reachableCells.size > 0) {
        moveZoneLayer.render(gridAdapter, selectedTokenId, reachableCells, selectedToken);
      } else {
        moveZoneLayer.clear();
      }
    }

    frameLoop.requestFrame();
  }

  // S'abonner aux mutations du store
  store.subscribe(renderAll);

  // 3. Gestion du transport de synchronisation réseau
  let transport = options.transport || null;
  const urlParams = new URLSearchParams(window.location.search);

  // Générer une sessionId par défaut si absent de l'URL (mode local/test)
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

  // Restauration du snapshot avant tout delta (T-24)
  if (sessionId) {
    store.setSessionId(sessionId);
  }
  console.log('[DEBUG] Avant restauration snapshot :', { sessionId, hasTransport: !!transport });
  if (transport && sessionId) {
    try {
      console.log('[DEBUG] Restauration snapshot...', { sessionId, hasTransport: !!transport });
      const snapshotData = /** @type {any} */ (await transport.snapshot());
      console.log('[DEBUG] Snapshot reçu :', snapshotData);
      console.log('[DEBUG] snapshot() retourne :', {
        hasCampaign: !!(snapshotData && snapshotData.campaign),
        campaignLevels: snapshotData?.campaign?.levels?.length ?? snapshotData?.levels?.length,
        keys: snapshotData ? Object.keys(snapshotData) : [],
      });
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

  // Réinitialiser la caméra après restauration snapshot et redessiner
  camera.setZoom(1);
  camera.setPan(0, 0);
  // renderAll sera appelée après, mais force un rendu maintenant
  frameLoop.requestFrame();

  // 4. Montage du panneau MJ
  if (panelContainer) {
    createGMPanel(panelContainer, { transport: transport || undefined });
  }

  // 5. Gestion des événements d'entrée (Pointer & Gestures)
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

  // Ajustement de la taille au redimensionnement
  window.addEventListener('resize', () => {
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 600;
    camera.setViewport(w, h);
    app.renderer.resize(w, h);
    renderAll();
  });

  // Premier rendu
  renderAll();

  return {
    app,
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
