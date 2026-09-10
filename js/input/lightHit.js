// @ts-check

import {
  LIGHT_HIT_CELL_RATIO,
  LIGHT_HIT_SCREEN_FLOOR_PX,
  LIGHT_HIT_MAX_CELL_RATIO,
} from '../core/constants.js';

/**
 * Désignation d'une lampe sous un tap — MJ seul (chantier C-2, tranche 2). Sur le modèle
 * **exact** de `portalHit.js`, mais pour un POINT plutôt qu'un segment : le candidat comparé est
 * le centre de la case de la lampe, jamais son origine.
 */

/**
 * Résultat de `findHitLight` : la lampe trouvée et sa distance, en unités CARTE — même repère
 * que `dist` de `findHitToken` et `findHitPortal`, pour que les trois soient comparables par un
 * appelant qui arbitre entre un pion, une porte et une lampe (`js/app/gm.js`).
 *
 * @typedef {Object} LightHitResult
 * @property {import('../core/types.js').Light} light
 * @property {number} dist Distance du tap au centre de la case de la lampe, en unités carte.
 */

/**
 * Recherche la lampe la plus proche du tap, dans un disque autour du centre de sa case.
 *
 * La tolérance est `LIGHT_HIT_CELL_RATIO` case, plancherée à `LIGHT_HIT_SCREEN_FLOOR_PX` en
 * pixels écran et plafonnée à `LIGHT_HIT_MAX_CELL_RATIO` case — voir `constants.js` pour le
 * fait mesuré qui motive le plancher.
 *
 * @param {import('../grid/GridAdapter.js').GridAdapter} grid
 * @param {import('../core/types.js').Level} activeLevel
 * @param {{x: number, y: number}} mapPos
 * @param {number} [zoom] Zoom courant de la caméra. Absent = 1.
 * @returns {LightHitResult|null}
 */
export function findHitLight(grid, activeLevel, mapPos, zoom = 1) {
  if (!activeLevel || !activeLevel.lights || activeLevel.lights.length === 0) return null;

  const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const gridScale = Math.abs(origin1.x - origin0.x);
  const safeZoom = zoom > 0 ? zoom : 1;
  const maxDist = Math.min(
    Math.max(LIGHT_HIT_CELL_RATIO * gridScale, LIGHT_HIT_SCREEN_FLOOR_PX / safeZoom),
    LIGHT_HIT_MAX_CELL_RATIO * gridScale
  );

  /** @type {{light: import('../core/types.js').Light, dist: number}|null} */
  let best = null;

  for (const light of activeLevel.lights) {
    if (!light || !light.at) continue;
    // ⛔ `mapFromCellPoint` rend l'ORIGINE de la case (un coin), pas son centre — leçon C-5.
    // `cellCenter` prend un `Cell {a,b}` et rend toujours un centre, dans les deux pavages ;
    // `light.at` est un `CellPoint {cellX,cellY}`, d'où la conversion. C'est la MÊME conversion
    // que celle qui DESSINE la lampe (`js/render/layers/lightMarkers.js`) : viser ce qu'on voit.
    const point = grid.cellCenter({ a: light.at.cellX, b: light.at.cellY });
    const dist = Math.hypot(mapPos.x - point.x, mapPos.y - point.y);
    if (dist < maxDist) {
      // Départage stable par identifiant : deux lampes à égalité de distance ne doivent pas
      // dépendre de l'ordre du tableau.
      if (
        !best ||
        dist < best.dist - 1e-6 ||
        (Math.abs(dist - best.dist) <= 1e-6 && light.id < best.light.id)
      ) {
        best = { light, dist };
      }
    }
  }

  return best ? { light: best.light, dist: best.dist } : null;
}
