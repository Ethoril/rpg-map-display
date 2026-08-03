// @ts-check

import { PointerInput } from '../../input/pointer.js';
import { gridFor } from '../../grid/index.js';
import { cellKey } from '../../core/cellKey.js';
import { findPath } from '../../movement/path.js';
import { computeBlockedEdges } from '../../import/blockedEdges.js';
import { terrainCostRecordToMap } from '../../core/schema.js';
import * as store from '../../state/store.js';

/** @typedef {import('../../core/types.js').Cell} Cell */
/** @typedef {import('../../core/types.js').Token} Token */
/** @typedef {import('../../input/gestures.js').InputIntention} InputIntention */
/** @typedef {import('../../transport/Transport.js').Transport} Transport */
/** @typedef {import('../../input/pointer.js').InputCamera} InputCamera */

/**
 * Options d'initialisation de la vue joueurs.
 * @typedef {Object} PlayerBootstrapOptions
 * @property {HTMLElement} element Élément HTML à écouter (canvas)
 * @property {InputCamera} camera Instance de la caméra pour conversions d'écran vers carte
 * @property {Transport} [transport] Transport réseau optionnel pour la synchronisation
 */

/**
 * Monte la vue joueurs : attache les écouteurs d'input et synchronise le store et le réseau.
 *
 * @param {PlayerBootstrapOptions} options
 * @returns {{ detach: () => void, pointerInput: PointerInput }}
 */
export function bootstrapPlayerView(options) {
  const { element, camera, transport } = options;

  /**
   * Traite les intentions d'input spécifiques à la vue joueurs.
   * @param {InputIntention} intention
   */
  function handleIntention(intention) {
    if (intention.type !== 'tap') {
      return;
    }

    const state = store.getState();
    const { campaign, activeLevel, selectedToken, reachableCells } = state;

    if (!campaign || !activeLevel) {
      return;
    }

    const grid = gridFor(activeLevel);
    const targetCell = grid.cellFromPoint(intention.mapPos);
    if (!targetCell) {
      store.selectToken(null);
      return;
    }

    const tappedToken = campaign.tokens.find((t) => {
      if (t.levelId !== activeLevel.id || t.hidden) return false;
      const size = t.sizeCells || 1;
      return (
        targetCell.a >= t.cell.a &&
        targetCell.a < t.cell.a + size &&
        targetCell.b >= t.cell.b &&
        targetCell.b < t.cell.b + size
      );
    });

    // Les PNJ sont toujours réservés au MJ, même si une donnée incohérente les marque
    // playerMovable. Les trois conditions sont défensives et cumulatives.
    const tappedMovablePc =
      tappedToken &&
      tappedToken.kind === 'pc' &&
      tappedToken.playerMovable !== false &&
      !tappedToken.locked
        ? tappedToken
        : null;

    if (!tappedToken) {
      const hitPortal = findHitPortal(grid, activeLevel, intention.mapPos);
      if (hitPortal) {
        /** @type {'open'|'closed'|null} */
        let targetState = null;
        if (hitPortal.state === 'closed') {
          targetState = 'open';
        } else if (hitPortal.state === 'open') {
          targetState = 'closed';
        }
        if (targetState) {
          store.setPortalState(activeLevel.id, hitPortal.id, targetState);
          if (transport) {
            transport.publish({
              type: 'portal.toggle',
              payload: {
                levelId: activeLevel.id,
                portalId: hitPortal.id,
                state: targetState,
              },
              at: Date.now(),
              by: 'players',
            });
          }
        }
        return;
      }
    }

    if (!selectedToken) {
      store.selectToken(tappedMovablePc ? tappedMovablePc.id : null);
      return;
    }

    if (tappedMovablePc && tappedMovablePc.id !== selectedToken.id) {
      store.selectToken(tappedMovablePc.id);
      return;
    }

    if (tappedToken && tappedToken.id !== selectedToken.id) {
      // Un PNJ ou un pion interdit n'est jamais une destination de mouvement implicite.
      store.selectToken(null);
      return;
    }

    if (targetCell.a === selectedToken.cell.a && targetCell.b === selectedToken.cell.b) {
      return;
    }

    if (
      selectedToken.kind !== 'pc' ||
      selectedToken.locked ||
      selectedToken.playerMovable === false
    ) {
      store.selectToken(null);
      return;
    }

    const targetKey = cellKey(targetCell);
    if (!reachableCells.has(targetKey)) {
      store.selectToken(null);
      return;
    }

    const blockedEdges = computeBlockedEdges(activeLevel, grid);
    const terrainCostMap = terrainCostRecordToMap(activeLevel.terrainCost);
    const path = findPath(grid, selectedToken.cell, targetCell, blockedEdges, terrainCostMap);
    const startedAt = Date.now();

    const moveData = {
      from: { a: selectedToken.cell.a, b: selectedToken.cell.b },
      to: { a: targetCell.a, b: targetCell.b },
      path,
      startedAt,
    };

    store.moveTokenToCell(selectedToken.id, targetCell, moveData);

    if (transport) {
      transport.publish({
        type: 'token.move',
        payload: {
          tokenId: selectedToken.id,
          from: moveData.from,
          to: moveData.to,
          path: moveData.path,
          startedAt: moveData.startedAt,
        },
        at: startedAt,
        by: 'players',
      });
    }
  }

  const pointerInput = new PointerInput(element, camera, {
    role: 'players',
    onIntention: handleIntention,
  });

  return {
    detach: () => {
      pointerInput.detach();
    },
    pointerInput,
  };
}

/**
 * Calcule la distance euclidienne entre un point et un segment en pixels carte.
 * @param {{x: number, y: number}} pt
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
function distancePointToSegment(pt, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(pt.x - a.x, pt.y - a.y);
  }
  let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(pt.x - projX, pt.y - projY);
}

/**
 * Recherche le portail le plus proche sous le tap dans la capsule de 0.5 case.
 *
 * @param {import('../../grid/GridAdapter.js').GridAdapter} grid
 * @param {import('../../core/types.js').Level} activeLevel
 * @param {{x: number, y: number}} mapPos
 * @returns {import('../../core/types.js').Portal|null}
 */
function findHitPortal(grid, activeLevel, mapPos) {
  if (!activeLevel.portals || activeLevel.portals.length === 0) return null;

  const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const gridScale = Math.abs(origin1.x - origin0.x);
  const maxDist = 0.5 * gridScale;

  /** @type {{portal: import('../../core/types.js').Portal, dist: number}|null} */
  let best = null;

  for (const portal of activeLevel.portals) {
    const pA = grid.mapFromCellPoint({ cellX: portal.a.cellX, cellY: portal.a.cellY });
    const pB = grid.mapFromCellPoint({ cellX: portal.b.cellX, cellY: portal.b.cellY });
    const dist = distancePointToSegment(mapPos, pA, pB);
    if (dist < maxDist) {
      if (
        !best ||
        dist < best.dist - 1e-6 ||
        (Math.abs(dist - best.dist) <= 1e-6 && portal.id < best.portal.id)
      ) {
        best = { portal, dist };
      }
    }
  }

  return best ? best.portal : null;
}
