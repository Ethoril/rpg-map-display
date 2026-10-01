// @ts-check

import { gridFor } from '../grid/index.js';
import { terrainCostRecordToMap } from '../core/schema.js';
import { computeBlockedEdges } from '../import/blockedEdges.js';
import { MOUNTED_SPEED_MULTIPLIER } from '../core/constants.js';

/** @typedef {import('../core/types.js').Token} Token */
/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */

/** @type {string|null} */
let selectedTokenId = null;

/** @type {Map<string, number>} */
let reachableCells = new Map();

/**
 * Règles de déplacement d'un pion sur un étage : budget, masque d'arêtes et coût du terrain.
 *
 * ⛔ **Source unique de la zone atteignable ET du chemin animé de la tablette**
 * (`js/ui/player/bootstrap.js`). Si les deux lisaient des règles différentes, un pion monté
 * (chantier C-9) aurait une zone qui contourne une porte ouverte, mais un chemin le plus court
 * qui la traverse pendant l'animation — et le brouillard derrière serait révélé.
 *
 * @param {Token} token
 * @param {Level} level
 * @returns {{ grid: GridAdapter, budget: number, blockedEdges: Set<string>, terrainCost: Map<string, number> }}
 */
export function movementRulesFor(token, level) {
  const grid = gridFor(level);
  const mounted = token.mounted === true;
  return {
    grid,
    // Monté, le budget double (chantier C-9).
    budget: token.speedCells * (mounted ? MOUNTED_SPEED_MULTIPLIER : 1),
    // Masque d'arêtes bloquées obtenu par la fonction dédiée. Recréer un `new Set()` ici rendrait
    // les murs sans effet sur les déplacements, et le symptôme apparaîtrait très loin de sa cause.
    // Monté, tout portail bloque, quel que soit son état : un cheval ne passe pas les portes.
    blockedEdges: computeBlockedEdges(level, grid, { portals: mounted ? 'all' : 'closed' }),
    terrainCost: terrainCostRecordToMap(level.terrainCost),
  };
}

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

  const { grid, budget, blockedEdges, terrainCost } = movementRulesFor(token, level);

  selectedTokenId = token.id;
  reachableCells = grid.cellsInRange(
    token.cell,
    budget,
    blockedEdges,
    terrainCost
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
