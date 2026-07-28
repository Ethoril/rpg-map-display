// @ts-check

import { cellKey, parseCellKey } from '../core/cellKey.js';
import { computeReachable } from './reachable.js';

/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */

/**
 * Reconstruit un chemin de cases depuis une chaîne de prédécesseurs.
 *
 * @param {Map<string, string>} predecessors - Map cellKey -> parent cellKey
 * @param {Cell} from
 * @param {Cell} to
 * @returns {Cell[]} Le chemin sous forme de liste de cellules [from, ..., to], ou [] si inatteignable.
 */
export function reconstructPath(predecessors, from, to) {
  const fromKey = cellKey(from);
  const toKey = cellKey(to);

  if (fromKey === toKey) {
    return [{ a: from.a, b: from.b }];
  }

  if (!predecessors.has(toKey)) {
    return [];
  }

  /** @type {Cell[]} */
  const path = [];
  /** @type {Set<string>} */
  const visited = new Set();
  let currentKey = toKey;

  while (currentKey) {
    if (visited.has(currentKey)) {
      return [];
    }
    visited.add(currentKey);

    path.unshift(parseCellKey(currentKey));

    if (currentKey === fromKey) {
      break;
    }

    const parentKey = predecessors.get(currentKey);
    if (!parentKey) {
      return [];
    }
    currentKey = parentKey;
  }

  if (path.length > 0 && cellKey(path[0]) === fromKey) {
    return path;
  }

  return [];
}

/**
 * Calcule directement le chemin le plus court entre deux cases.
 *
 * @param {GridAdapter} grid
 * @param {Cell} from
 * @param {Cell} to
 * @param {Set<string>} blockedEdges
 * @param {Map<string, number>} [terrainCost]
 * @returns {Cell[]}
 */
export function findPath(grid, from, to, blockedEdges, terrainCost) {
  const distanceEstimate = grid.distance(from, to);
  const budget = Math.max(100, distanceEstimate * 4);
  const { predecessors } = computeReachable(grid, from, budget, blockedEdges, terrainCost);
  return reconstructPath(predecessors, from, to);
}

/**
 * Alias de findPath pour la rétrocompatibilité des spécifications.
 * @type {typeof findPath}
 */
export const shortestPath = findPath;

