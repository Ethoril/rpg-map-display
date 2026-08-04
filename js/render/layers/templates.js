// @ts-check

import { cellKey, parseCellKey } from '../../core/cellKey.js';
import { sweep } from '../../vision/sweep.js';
import { getSessionTemplateCells } from '../../state/store.js';

/**
 * Test point dans un polygone simple (rayon-casting / règle parité).
 *
 * @param {import('../../core/types.js').MapPoint} point
 * @param {import('../../core/types.js').MapPoint[]} polygon
 * @returns {boolean}
 */
export function isPointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  const eps = 1e-6;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      (yi > point.y) !== (yj > point.y) &&
      point.x <= ((xj - xi) * (point.y - yi)) / (yj - yi) + xi + eps;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calcule les clés de cases affectées par un gabarit (au sweep et à l'énumération par adaptateur).
 * Exécuté au placement (MJ/émetteur) une seule fois — jamais dans la boucle de rendu.
 *
 * @param {import('../../core/types.js').Template} template
 * @param {import('../../grid/GridAdapter.js').GridAdapter} grid
 * @param {import('../../core/types.js').Level} level
 * @param {import('../../core/types.js').Segment[]} [segments]
 * @returns {string[]} Tableau de cellKey ("a,b")
 */
export function computeTemplateCells(template, grid, level, segments) {
  if (!template || !grid || !level) return [];
  if (template.shape !== 'circle') {
    return [];
  }

  const origin = template.origin;
  const radiusCells = template.radiusCells;
  if (!origin || typeof origin.a !== 'number' || typeof origin.b !== 'number') return [];
  if (typeof radiusCells !== 'number' || radiusCells <= 0) return [];

  const actualSegments = Array.isArray(segments) ? segments : [];
  const minA = Math.max(0, Math.floor(origin.a - radiusCells));
  const maxA = Math.min(level.widthCells - 1, Math.ceil(origin.a + radiusCells));
  const minB = Math.max(0, Math.floor(origin.b - radiusCells));
  const maxB = Math.min(level.heightCells - 1, Math.ceil(origin.b + radiusCells));

  /** @type {string[]} */
  const affected = [];

  if (actualSegments.length === 0) {
    for (let a = minA; a <= maxA; a++) {
      for (let b = minB; b <= maxB; b++) {
        const candidateCell = { a, b };
        if (grid.distance(origin, candidateCell) <= radiusCells) {
          affected.push(cellKey(candidateCell));
        }
      }
    }
    return affected;
  }

  const originPoint = grid.pointFromCell(origin);
  const p0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const p1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const cellPx = Math.abs(p1.x - p0.x);
  const maxRangePx = radiusCells * cellPx;

  const sweepPolygon = sweep(originPoint, actualSegments, maxRangePx);
  if (!sweepPolygon || sweepPolygon.length < 3) return [];

  for (let a = minA; a <= maxA; a++) {
    for (let b = minB; b <= maxB; b++) {
      const candidateCell = { a, b };
      if (grid.distance(origin, candidateCell) <= radiusCells) {
        const cellCenter = grid.pointFromCell(candidateCell);
        if (isPointInPolygon(cellCenter, sweepPolygon)) {
          affected.push(cellKey(candidateCell));
        }
      }
    }
  }

  return affected;
}

/**
 * Couche d'affichage des gabarits de zone d'effet (L-08).
 * Ne réalise aucun calcul de visibilité/sweep dans render().
 */
export class TemplatesLayer {
  /**
   * Rendu des gabarits.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte Canvas 2D
   * @param {import('../../grid/GridAdapter.js').GridAdapter} grid Adaptateur de grille
   * @param {import('../../core/types.js').Level} level Étage courant
   * @param {import('../../core/types.js').Template[]} templates Liste des gabarits de campagne
   * @param {boolean} [isPlayerView=false] true si rendu côté vue joueurs
   * @returns {number} Nombre de gabarits rendus
   */
  render(ctx, grid, level, templates, isPlayerView = false) {
    if (!ctx || !grid || !level || !Array.isArray(templates) || templates.length === 0) {
      return 0;
    }

    const levelTemplates = templates.filter((t) => t && t.levelId === level.id);
    if (levelTemplates.length === 0) return 0;

    const visibleTemplates = isPlayerView
      ? levelTemplates.filter((t) => t.visibleToPlayers === true)
      : levelTemplates;

    if (visibleTemplates.length === 0) return 0;

    ctx.save();
    let renderedCount = 0;

    for (const template of visibleTemplates) {
      const cellKeys = getSessionTemplateCells(template.id);
      if (!cellKeys || cellKeys.length === 0) continue;

      ctx.save();
      ctx.fillStyle = template.color || '#ef4444';
      ctx.globalAlpha = 0.35;

      for (const key of cellKeys) {
        const cell = parseCellKey(key);
        const p0 = grid.mapFromCellPoint({ cellX: cell.a, cellY: cell.b });
        const p1 = grid.mapFromCellPoint({ cellX: cell.a + 1, cellY: cell.b + 1 });
        ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      }

      ctx.restore();
      renderedCount++;
    }

    ctx.restore();
    return renderedCount;
  }
}
