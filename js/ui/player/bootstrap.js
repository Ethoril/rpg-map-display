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
    if (intention.type !== 'tapToken' && intention.type !== 'tapCell') {
      return;
    }

    const state = store.getState();
    const { campaign, activeLevel, selectedToken, reachableCells } = state;

    if (!campaign || !activeLevel) {
      return;
    }

    const grid = gridFor(activeLevel);

    if (intention.type === 'tapToken') {
      const mapPos = camera.screenToMap(intention.at);
      const targetCell = grid.cellFromPoint(mapPos);
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

      if (tappedToken) {
        store.selectToken(tappedToken.id);
      } else if (!selectedToken) {
        store.selectToken(null);
      }
      return;
    }

    if (intention.type === 'tapCell') {
      const mapPos = intention.at;
      const targetCell = grid.cellFromPoint(mapPos);

      if (!targetCell) {
        store.selectToken(null);
        return;
      }

      if (!selectedToken) {
        // Aucun pion sélectionné : vérifier si un pion visible est présent sur la case
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

        if (tappedToken) {
          store.selectToken(tappedToken.id);
        } else {
          store.selectToken(null);
        }
        return;
      }

      // Un pion est déjà sélectionné
      if (targetCell.a === selectedToken.cell.a && targetCell.b === selectedToken.cell.b) {
        // Tap sur la case même du pion sélectionné -> conserver sélection
        return;
      }

      // Vérification des flags de sécurité
      if (selectedToken.locked || selectedToken.playerMovable === false) {
        // Déplacement refusé par les flags de sécurité (pion reste sur place)
        return;
      }

      // Vérification de la portée (cases atteignables)
      const targetKey = cellKey(targetCell);
      if (!reachableCells.has(targetKey)) {
        // Case hors portée -> désélection (pion reste sur place)
        store.selectToken(null);
        return;
      }

      // Case atteignable et autorisée : calcul du chemin Dijkstra et horodatage
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

      // Mutation unique du store local
      store.moveTokenToCell(selectedToken.id, targetCell, moveData);

      // Publication réseau unique (aucune position intermédiaire)
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
  }

  const pointerInput = new PointerInput(element, camera, {
    role: 'players',
    onIntention: handleIntention,
  });

  /** @type {(() => void) | null} */
  let unsubscribeTransport = null;

  if (transport) {
    unsubscribeTransport = transport.subscribe((event) => {
      if (event.type === 'token.move' && event.payload) {
        const payload = /** @type {any} */ (event.payload);
        const { tokenId, from, to, path, startedAt } = payload;
        if (tokenId && to && typeof to.a === 'number' && typeof to.b === 'number') {
          store.moveTokenToCell(tokenId, to, {
            from,
            to,
            path,
            startedAt: startedAt ?? event.at,
          });
        }
      }
    });
  }

  return {
    detach: () => {
      pointerInput.detach();
      if (unsubscribeTransport) {
        unsubscribeTransport();
      }
    },
    pointerInput,
  };
}
