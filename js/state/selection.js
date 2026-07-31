// @ts-check

import { gridFor } from '../grid/index.js';
import { terrainCostRecordToMap } from '../core/schema.js';
import { computeBlockedEdges } from '../import/blockedEdges.js';

/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Level} Level */

/** @type {string|null} */
let selectedTokenId = null;

/** @type {Map<string, number>} */
let reachableCells = new Map();

/**
 * Met à jour la sélection courante et calcule les cases atteignables via gridFor(level).
 * Ne recalcule rien par lui-même : conserve le résultat de grid.cellsInRange(...).
 * Aucune distance codée en dur, aucune supposition sur le nombre de voisins.
 *
 * Sélectionner sans étage actif est une incohérence d'état, pas un cas limite : on lève
 * plutôt que de vider silencieusement la sélection (`CONVENTIONS.md` §6).
 *
 * @param {Token|null} token Pion à sélectionner, ou `null` pour désélectionner
 * @param {Level|null} level Étage actif — obligatoire dès que `token` est fourni
 * @returns {void}
 */
export function setSelectionState(token, level) {
  if (!token) {
    clearSelectionState();
    return;
  }

  if (!level) {
    throw new Error(
      `Impossible de sélectionner le pion "${token.id}" : aucun étage actif dans le store.`
    );
  }

  const grid = gridFor(level);
  const terrainCostMap = terrainCostRecordToMap(level.terrainCost);

  // Masque d'arêtes bloquées obtenu par la fonction dédiée. Le branchement
  // existe DÈS MAINTENANT : c'est la raison d'être du stub de T-08. Recréer un `new Set()`
  // ici rendrait l'implémentation du lot 2 sans effet sur les déplacements, et le symptôme
  // apparaîtrait très loin de sa cause.
  const blockedEdges = computeBlockedEdges(level, grid);

  selectedTokenId = token.id;
  reachableCells = grid.cellsInRange(
    token.cell,
    token.speedCells,
    blockedEdges,
    terrainCostMap
  );
}

/**
 * Réinitialise la sélection.
 * @returns {void}
 */
export function clearSelectionState() {
  selectedTokenId = null;
  reachableCells = new Map();
}

/**
 * Retourne l'identifiant du pion sélectionné.
 * @returns {string|null}
 */
export function getSelectedTokenId() {
  return selectedTokenId;
}

/**
 * Retourne une copie des cases atteignables courantes (cellKey -> coût).
 * @returns {Map<string, number>}
 */
export function getReachableCells() {
  return new Map(reachableCells);
}
