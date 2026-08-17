// @ts-check

import { CONE_ANGLE_DEG } from '../../core/constants.js';
import { sweep } from '../../vision/sweep.js';
import { getTemplateHandleRadiusMap } from '../../input/templateHit.js';

/**
 * Extrait les segments d'obstacles (murs et portails fermés/verrouillés) en pixels carte.
 *
 * @param {import('../../core/types.js').Level} level
 * @param {import('../../grid/GridAdapter.js').GridAdapter} grid
 * @returns {import('../../core/types.js').Segment[]}
 */
function getLevelObstacleSegments(level, grid) {
  if (!level || !grid) return [];
  /** @type {import('../../core/types.js').Segment[]} */
  const segments = [];

  /** @param {any} pt */
  const toCellPoint = (pt) => ({
    cellX: typeof pt.cellX === 'number' ? pt.cellX : (pt.a ?? 0),
    cellY: typeof pt.cellY === 'number' ? pt.cellY : (pt.b ?? 0),
  });

  if (Array.isArray(level.walls)) {
    for (const poly of level.walls) {
      if (!Array.isArray(poly) || poly.length < 2) continue;
      for (let i = 0; i < poly.length - 1; i++) {
        const p1 = poly[i];
        const p2 = poly[i + 1];
        if (p1 && p2) {
          segments.push({
            p1: grid.mapFromCellPoint(toCellPoint(p1)),
            p2: grid.mapFromCellPoint(toCellPoint(p2)),
          });
        }
      }
    }
  }

  if (Array.isArray(level.portals)) {
    for (const portal of level.portals) {
      if (portal) {
        const isOpen = typeof portal.state === 'string' ? portal.state === 'open' : portal.closed === false;
        if (!isOpen) {
          segments.push({
            p1: grid.mapFromCellPoint(toCellPoint(portal.a)),
            p2: grid.mapFromCellPoint(toCellPoint(portal.b)),
          });
        }
      }
    }
  }

  return segments;
}

/**
 * Couche d'affichage des gabarits de zone d'effet (L-10).
 * Rendu continu de la forme réelle (cercle, cône) découpée par les murs via sweep.
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

    const transform = ctx.getTransform ? ctx.getTransform() : null;
    const zoom = transform ? Math.hypot(transform.a, transform.b) || 1 : 1;
    const segments = getLevelObstacleSegments(level, grid);
    const p0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
    const p1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
    const cellPx = Math.abs(p1.x - p0.x);

    ctx.save();
    let renderedCount = 0;

    for (const template of visibleTemplates) {
      if (!template.origin || typeof template.origin.x !== 'number' || typeof template.origin.y !== 'number') {
        continue;
      }

      const origin = template.origin;
      const radiusPx = (template.radiusCells || 1) * cellPx;
      const color = template.color || '#ef4444';
      const shape = template.shape || 'circle';
      // Absence de `widthCells` = 1 : les gabarits d'avant UX-06 ne le portent pas.
      const halfWidthPx = (Math.max(1, template.widthCells ?? 1) * cellPx) / 2;

      ctx.save();

      // 1. Découpe par le polygone de sweep s'il y a des murs/obstacles
      //
      // ⚠ Le sweep est un disque autour de l'origine, donc son rayon doit couvrir le point le
      // plus ÉLOIGNÉ que la forme peut atteindre — sinon il rogne la forme là où aucun mur ne
      // l'arrête. Pour une ligne, ce point est un coin du rectangle, à `hypot(longueur, demi-
      // largeur)` : une ligne de 4 cases sur 3 de large perdrait ses deux coins avant. Élargir
      // le disque ne fait rien fuir, c'est la forme tracée ensuite qui borne la peinture.
      const sweepRadiusPx = shape === 'line' ? Math.hypot(radiusPx, halfWidthPx) : radiusPx;
      const sweepPoly = sweep(origin, segments, sweepRadiusPx);
      if (sweepPoly && sweepPoly.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(sweepPoly[0].x, sweepPoly[0].y);
        for (let i = 1; i < sweepPoly.length; i++) {
          ctx.lineTo(sweepPoly[i].x, sweepPoly[i].y);
        }
        ctx.closePath();
        ctx.clip();
      }

      // 2. Tracé de la forme réelle exacte dans la zone découpée
      ctx.beginPath();
      if (shape === 'circle') {
        ctx.arc(origin.x, origin.y, radiusPx, 0, 2 * Math.PI);
      } else if (shape === 'cone') {
        const dirRad = ((template.directionDeg || 0) * Math.PI) / 180;
        const halfRad = ((CONE_ANGLE_DEG / 2) * Math.PI) / 180;
        ctx.moveTo(origin.x, origin.y);
        ctx.arc(origin.x, origin.y, radiusPx, dirRad - halfRad, dirRad + halfRad);
        ctx.closePath();
      } else if (shape === 'line') {
        // Rectangle partant de l'origine, de `radiusCells` cases de long dans la direction, et
        // de `widthCells` cases de large **centrées sur l'axe** : un mur de feu tracé depuis un
        // pion doit s'étendre autant de part et d'autre de la ligne de tir, sinon la forme
        // dépend du sens dans lequel on l'a fait pivoter.
        const dirRad = ((template.directionDeg || 0) * Math.PI) / 180;
        const ux = Math.cos(dirRad);
        const uy = Math.sin(dirRad);
        // Normale à l'axe, dans le même repère carte (y vers le bas).
        const nx = -uy;
        const ny = ux;
        const ax = origin.x + nx * halfWidthPx;
        const ay = origin.y + ny * halfWidthPx;
        const bx = origin.x - nx * halfWidthPx;
        const by = origin.y - ny * halfWidthPx;
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + ux * radiusPx, ay + uy * radiusPx);
        ctx.lineTo(bx + ux * radiusPx, by + uy * radiusPx);
        ctx.lineTo(bx, by);
        ctx.closePath();
      }

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fill();

      ctx.lineWidth = 2 / zoom;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.stroke();

      ctx.restore();

      // 3. Poignée de pointe (cône) ou de centre (cercle) en pixels écran divisés par le zoom
      const handleRadiusMap = getTemplateHandleRadiusMap(radiusPx, zoom);
      ctx.save();
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, handleRadiusMap, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.restore();

      renderedCount++;
    }

    ctx.restore();
    return renderedCount;
  }
}
