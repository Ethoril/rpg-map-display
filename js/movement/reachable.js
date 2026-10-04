// @ts-check

import { cellKey, edgeKey } from '../core/cellKey.js';

/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */

/**
 * Résultat du calcul Dijkstra.
 * @typedef {Object} ReachableResult
 * @property {Map<string, number>} distances - cellKey -> coût cumulé
 * @property {Map<string, string>} predecessors - cellKey -> parent cellKey
 */

/**
 * Calcul Dijkstra pondéré pour trouver les cases atteignables et l'arbre des chemins.
 *
 * @param {GridAdapter} grid
 * @param {Cell} from
 * @param {number} budget
 * @param {Set<string>} blockedEdges
 * @param {Map<string, number>} [terrainCost]
 * @returns {ReachableResult}
 */
export function computeReachable(grid, from, budget, blockedEdges, terrainCost) {
  /** @type {Map<string, number>} */
  const distances = new Map();
  /** @type {Map<string, string>} */
  const predecessors = new Map();

  const startKey = cellKey(from);
  distances.set(startKey, 0);

  /** @type {Array<{ cost: number, cell: Cell, key: string }>} */
  const queue = [{ cost: 0, cell: from, key: startKey }];

  while (queue.length > 0) {
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[minIdx].cost) {
        minIdx = i;
      }
    }
    const current = queue[minIdx];
    queue[minIdx] = queue[queue.length - 1];
    queue.pop();

    const currentBestCost = distances.get(current.key);
    if (currentBestCost !== undefined && current.cost > currentBestCost) {
      continue;
    }

    const neighbors = grid.neighbors(current.cell);
    for (const nextCell of neighbors) {
      const nextKey = cellKey(nextCell);
      // 1. Arête directe bloquée
      if (!stepEdgesAreOpen(grid, current.cell, nextCell, blockedEdges)) {
        continue;
      }
      const stepCost = movementStepCost(grid, current.cell, nextCell, terrainCost);
      const newCost = current.cost + stepCost;

      if (newCost > budget) {
        continue;
      }

      const prevCost = distances.get(nextKey);
      if (prevCost === undefined || newCost < prevCost) {
        distances.set(nextKey, newCost);
        predecessors.set(nextKey, current.key);

        queue.push({ cost: newCost, cell: nextCell, key: nextKey });
      }
    }
  }

  return { distances, predecessors };
}

/** Même validation d'arête et de coin que Dijkstra, réutilisable lors d'une revalidation.
 * @param {GridAdapter} grid @param {Cell} from @param {Cell} to @param {Set<string>} blockedEdges
 * @returns {boolean}
 */
export function canTraverseStep(grid, from, to, blockedEdges) {
  if (!grid.neighbors(from).some((cell) => cell.a === to.a && cell.b === to.b)) return false;
  return stepEdgesAreOpen(grid, from, to, blockedEdges);
}

/** @param {GridAdapter} grid @param {Cell} from @param {Cell} to @param {Set<string>} blockedEdges @returns {boolean} */
function stepEdgesAreOpen(grid, from, to, blockedEdges) {
  if (blockedEdges.has(edgeKey(from, to))) return false;
  const da = to.a - from.a;
  const db = to.b - from.b;
  if (grid.type !== 'square' || da === 0 || db === 0) return true;
  const o1 = { a: from.a + da, b: from.b };
  const o2 = { a: from.a, b: from.b + db };
  return ![
    edgeKey(from, o1), edgeKey(from, o2), edgeKey(to, o1), edgeKey(to, o2),
  ].some((edge) => blockedEdges.has(edge));
}

/** Coût identique au pas utilisé par `computeReachable`.
 * @param {GridAdapter} grid @param {Cell} from @param {Cell} to @param {Map<string,number>} [terrainCost]
 * @returns {number}
 */
export function movementStepCost(grid, from, to, terrainCost) {
  const multiplier = terrainCost?.get(cellKey(to)) ?? 1;
  return grid.distance(from, to) * (multiplier > 0 ? multiplier : 1);
}

/**
 * Cases atteignables (conforme à GridAdapter.cellsInRange).
 *
 * @param {GridAdapter} grid
 * @param {Cell} from
 * @param {number} budget
 * @param {Set<string>} blockedEdges
 * @param {Map<string, number>} [terrainCost]
 * @returns {Map<string, number>}
 */
export function reachableCells(grid, from, budget, blockedEdges, terrainCost) {
  const { distances } = computeReachable(grid, from, budget, blockedEdges, terrainCost);
  distances.delete(cellKey(from));
  return distances;
}
