// @ts-check

import { cellKey, edgeKey } from '../core/cellKey.js';

/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */

/**
 * Emprise d'un grand pion (audit du 08/11, A12). Absente pour un pion d'une case : la règle est
 * alors celle de la seule case d'ancrage, inchangée.
 * @typedef {Object} Footprint
 * @property {(anchor: Cell) => Cell[]} cellsOf cases couvertes depuis cet ancrage (rosette rognée
 *   en hexagone, D-8). Les bornes viennent d'elles-mêmes : `grid.neighbors` ne rend jamais une case
 *   hors carte, donc une case d'emprise qui en sortirait n'est jamais atteinte.
 */

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
 * @param {Footprint} [footprint] grand pion : chaque pas est aussi vérifié pour toute l'emprise
 * @returns {ReachableResult}
 */
export function computeReachable(grid, from, budget, blockedEdges, terrainCost, footprint) {
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
      // 2. Grand pion : l'emprise entière doit pouvoir faire ce pas (A12)
      if (footprint && !footprintStepIsOpen(grid, current.cell, nextCell, blockedEdges, footprint)) {
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
 * @param {Footprint} [footprint]
 * @returns {boolean}
 */
export function canTraverseStep(grid, from, to, blockedEdges, footprint) {
  if (!grid.neighbors(from).some((cell) => cell.a === to.a && cell.b === to.b)) return false;
  if (!stepEdgesAreOpen(grid, from, to, blockedEdges)) return false;
  return !footprint || footprintStepIsOpen(grid, from, to, blockedEdges, footprint);
}

/**
 * Un grand pion peut-il faire ce pas d'ancrage ? ⛔ Audit du 08/11, A12 : seule la case d'ancrage
 * était vérifiée — un pion 2×2 franchissait un mur avec la moitié de son corps, et la portée
 * proposait des arrivées hors carte que le schéma refusait ensuite.
 *
 * Règle : l'ancrage d'arrivée est posable, et chaque case NOUVELLEMENT couverte s'atteint, par
 * un pas ouvert (arête et coins), depuis une case de l'emprise de départ. Écrite avec les seuls
 * voisins de la grille, elle vaut en carré comme en hexagone (rosette rognée, D-8). ⚠ Les autres
 * pions n'entrent pas ici : les traverser reste permis, rien n'est inventé (retour de session).
 *
 * @param {GridAdapter} grid @param {Cell} from @param {Cell} to @param {Set<string>} blockedEdges
 * @param {Footprint} footprint
 * @returns {boolean}
 */
function footprintStepIsOpen(grid, from, to, blockedEdges, footprint) {
  const depart = footprint.cellsOf(from);
  const couvertes = new Set(depart.map(cellKey));
  for (const cible of footprint.cellsOf(to)) {
    if (couvertes.has(cellKey(cible))) continue;
    const atteinte = depart.some((source) =>
      grid.neighbors(source).some((n) => n.a === cible.a && n.b === cible.b) &&
      stepEdgesAreOpen(grid, source, cible, blockedEdges));
    if (!atteinte) return false;
  }
  return true;
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
