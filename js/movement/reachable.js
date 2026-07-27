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
      const edge = edgeKey(current.cell, nextCell);

      // 1. Arête directe bloquée
      if (blockedEdges.has(edge)) {
        continue;
      }

      // 2. Anti-corner-cutting pour les diagonales en grille carrée
      const da = nextCell.a - current.cell.a;
      const db = nextCell.b - current.cell.b;
      const isDiagonal = da !== 0 && db !== 0;

      if (isDiagonal && grid.type === 'square') {
        const o1 = { a: current.cell.a + da, b: current.cell.b };
        const o2 = { a: current.cell.a, b: current.cell.b + db };

        const e1 = edgeKey(current.cell, o1);
        const e2 = edgeKey(current.cell, o2);
        const e3 = edgeKey(nextCell, o1);
        const e4 = edgeKey(nextCell, o2);

        if (
          blockedEdges.has(e1) ||
          blockedEdges.has(e2) ||
          blockedEdges.has(e3) ||
          blockedEdges.has(e4)
        ) {
          continue;
        }
      }

      // 3. Coût du déplacement (octile via grid.distance)
      const baseDistance = grid.distance(current.cell, nextCell);
      const terrainMult = terrainCost?.get(nextKey) ?? 1;
      const stepCost = baseDistance * (terrainMult > 0 ? terrainMult : 1);
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
