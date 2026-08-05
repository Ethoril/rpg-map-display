// @ts-check

import { PORTAL_HIT_CELL_RATIO } from '../core/constants.js';

/**
 * Désignation d'une porte sous un tap. Partagé par la vue MJ et la vue joueurs : les deux
 * ouvraient les portes par une copie mot pour mot de ce fichier, y compris la constante de
 * tolérance, ce qui promettait deux valeurs à régler pour un seul réglage.
 */

/**
 * Distance euclidienne d'un point à un segment, en pixels carte.
 *
 * @param {{x: number, y: number}} pt
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function distancePointToSegment(pt, a, b) {
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
 * Recherche la porte la plus proche du tap, dans une capsule de
 * `PORTAL_HIT_CELL_RATIO` case autour de son segment.
 *
 * @param {import('../grid/GridAdapter.js').GridAdapter} grid
 * @param {import('../core/types.js').Level} activeLevel
 * @param {{x: number, y: number}} mapPos
 * @returns {import('../core/types.js').Portal|null}
 */
export function findHitPortal(grid, activeLevel, mapPos) {
  if (!activeLevel || !activeLevel.portals || activeLevel.portals.length === 0) return null;

  const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const gridScale = Math.abs(origin1.x - origin0.x);
  const maxDist = PORTAL_HIT_CELL_RATIO * gridScale;

  /** @type {{portal: import('../core/types.js').Portal, dist: number}|null} */
  let best = null;

  for (const portal of activeLevel.portals) {
    const pA = grid.mapFromCellPoint({ cellX: portal.a.cellX, cellY: portal.a.cellY });
    const pB = grid.mapFromCellPoint({ cellX: portal.b.cellX, cellY: portal.b.cellY });
    const dist = distancePointToSegment(mapPos, pA, pB);
    if (dist < maxDist) {
      // Départage stable par identifiant : deux portes à égalité de distance ne doivent pas
      // dépendre de l'ordre du tableau.
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
