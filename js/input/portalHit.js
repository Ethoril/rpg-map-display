// @ts-check

import {
  PORTAL_HIT_CELL_RATIO,
  PORTAL_HIT_SCREEN_FLOOR_PX,
  PORTAL_HIT_MAX_CELL_RATIO,
} from '../core/constants.js';

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
 * Résultat de `findHitPortal` : la porte trouvée et sa distance, en unités CARTE — même
 * repère que `dist` de `findHitToken`, pour que les deux soient comparables par un appelant qui
 * arbitre entre un pion et une porte.
 *
 * @typedef {Object} PortalHitResult
 * @property {import('../core/types.js').Portal} portal
 * @property {number} dist Distance du point au segment de la porte, en unités carte.
 */

/**
 * Recherche la porte la plus proche du tap, dans une capsule autour de son segment.
 *
 * La capsule est `PORTAL_HIT_CELL_RATIO` case, plancherée à `PORTAL_HIT_SCREEN_FLOOR_PX` en
 * pixels écran (décision du mainteneur du 10/09/2026 — voir `constants.js`) et plafonnée à
 * `PORTAL_HIT_MAX_CELL_RATIO` case pour ne jamais déborder au dézoom.
 *
 * @param {import('../grid/GridAdapter.js').GridAdapter} grid
 * @param {import('../core/types.js').Level} activeLevel
 * @param {{x: number, y: number}} mapPos
 * @param {number} [zoom] Zoom courant de la caméra. Absent = 1 (comportement d'avant ce
 *   chantier), pour ne pas casser un appelant qui n'a pas encore été mis à jour.
 * @returns {PortalHitResult|null}
 */
export function findHitPortal(grid, activeLevel, mapPos, zoom = 1) {
  if (!activeLevel || !activeLevel.portals || activeLevel.portals.length === 0) return null;

  const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const gridScale = Math.abs(origin1.x - origin0.x);
  const safeZoom = zoom > 0 ? zoom : 1;
  const maxDist = Math.min(
    Math.max(PORTAL_HIT_CELL_RATIO * gridScale, PORTAL_HIT_SCREEN_FLOOR_PX / safeZoom),
    PORTAL_HIT_MAX_CELL_RATIO * gridScale
  );

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

  return best ? { portal: best.portal, dist: best.dist } : null;
}
