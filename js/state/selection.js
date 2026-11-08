// @ts-check

import { gridFor } from '../grid/index.js';
import { terrainCostRecordToMap, isLinkedToken } from '../core/schema.js';
import { computeBlockedEdges } from '../import/blockedEdges.js';
import { MOUNTED_SPEED_MULTIPLIER } from '../core/constants.js';
import { computeReachable } from '../movement/reachable.js';

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
 * @returns {{ grid: GridAdapter, budget: number, walkBudget: number, blockedEdges: Set<string>, terrainCost: Map<string, number>, footprint?: import('../movement/reachable.js').Footprint }}
 */
export function movementRulesFor(token, level) {
  const grid = gridFor(level);
  const mounted = token.mounted === true;
  // Pion lié : l'outil MJ envoie déjà la portée de la monture (contrat §4), pas de ×2.
  const multiplier = mounted && !isLinkedToken(token) ? MOUNTED_SPEED_MULTIPLIER : 1;
  const walkBudget = token.speedCells * multiplier;
  // Pion lié : le déplacement peut aller jusqu'à la Course (contrat §4, second palier §11.6) ; au-delà
  // de `walkBudget` (la Marche), le MJ paie l'Action du Tour. Un pion non lié ou sans `runCells`
  // n'a qu'un palier.
  const runBudget = isLinkedToken(token) && Number.isFinite(token.runCells) ? token.runCells ?? 0 : 0;
  return {
    grid,
    // Monté, le budget double (chantier C-9).
    budget: Math.max(walkBudget, runBudget),
    walkBudget,
    // Masque d'arêtes bloquées obtenu par la fonction dédiée. Recréer un `new Set()` ici rendrait
    // les murs sans effet sur les déplacements, et le symptôme apparaîtrait très loin de sa cause.
    // Monté, tout portail bloque, quel que soit son état : un cheval ne passe pas les portes.
    blockedEdges: computeBlockedEdges(level, grid, { portals: mounted ? 'all' : 'closed' }),
    terrainCost: terrainCostRecordToMap(level.terrainCost),
    footprint: footprintFor(token, grid),
  };
}

/**
 * Emprise d'un grand pion pour la portée (audit du 08/11, A12) ; `undefined` pour une case.
 * Les bornes suivent la règle de `validateCampaign` sans être réécrites ici : en carré, une case
 * d'emprise hors carte n'est jamais voisine de rien ; en hexagone, la rosette est rognée et seul
 * l'ancrage compte (D-8).
 *
 * @param {Token} token @param {GridAdapter} grid
 * @returns {import('../movement/reachable.js').Footprint|undefined}
 */
function footprintFor(token, grid) {
  const size = Math.max(1, Math.floor(token.sizeCells || 1));
  if (size === 1) return undefined;
  return { cellsOf: (anchor) => grid.cellsOccupied(anchor, size) };
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

  const { grid, budget, blockedEdges, terrainCost, footprint } = movementRulesFor(token, level);

  selectedTokenId = token.id;
  // Grand pion : la zone suit toute l'emprise (A12) — d'où Dijkstra direct, `cellsInRange` ne
  // connaissant que la case d'ancrage.
  reachableCells = footprint
    ? computeReachable(grid, token.cell, budget, blockedEdges, terrainCost, footprint).distances
    : grid.cellsInRange(token.cell, budget, blockedEdges, terrainCost);
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

/**
 * Réserve telle que le MJ la voit : sans les montures rangées par une fusion (contrat §8.1). Une
 * monture dont le cavalier est monté — sur le plateau ou lui-même en réserve — n'est pas un pion à
 * poser : elle revient d'elle-même à la séparation. Le store, lui, la garde.
 *
 * @param {Token[]} board
 * @param {Token[]} rangees Pions hors plateau
 * @returns {Token[]}
 */
export function visibleReserve(board, rangees) {
  const mountRefs = new Set(
    [...board, ...rangees].filter((t) => t.mounted === true && t.rider?.ref).map((t) => /** @type {string} */ (t.rider?.ref))
  );
  return rangees.filter((t) => !(t.link?.ref && mountRefs.has(t.link.ref)));
}

/**
 * Combattants d'un pion : le cavalier (le pion lui-même) puis, s'il est monté, sa monture. Chacun
 * porte son nom, ses PV, sa santé et ses marqueurs.
 *
 * @param {Token} token
 * @returns {{ role: 'cavalier'|'monture', label: string, hp: {current: number, max: number}|null, health: 'unharmed'|'wounded'|'critical', markers: string[], markerLevels: Record<string, number> }[]}
 */
export function combatantsOf(token) {
  /** @type {ReturnType<typeof combatantsOf>} */
  const sections = [
    { role: /** @type {const} */ ('cavalier'), label: token.label, hp: token.hp ?? null, health: token.health, markers: [...(token.markers ?? [])], markerLevels: { ...(token.markerLevels ?? {}) } },
  ];
  if (token.rider) {
    sections.push({ role: /** @type {const} */ ('monture'), label: token.rider.label, hp: token.rider.hp, health: token.rider.health, markers: [...token.rider.markers], markerLevels: { ...token.rider.markerLevels } });
  }
  return sections;
}
