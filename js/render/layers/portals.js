// @ts-check

import {
  PORTAL_OPEN_LINE_SCREEN_PX,
  PORTAL_OPEN_DASH_SCREEN_PX,
  PORTAL_LOCKED_LINE_SCREEN_PX,
  PORTAL_LOCK_DOT_RADIUS_SCREEN_PX,
  PORTAL_LOCK_DOT_MAX_SEGMENT_RATIO,
  PORTAL_LOCK_DOT_BORDER_SCREEN_PX,
  PORTAL_LOCKED_FLASH_MS,
} from '../../core/constants.js';

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * Couche d'affichage de l'indicateur d'état des trois états de portail.
 * Plaisante et discrète entre la grille et la zone de mouvement.
 *
 * **Toutes ses grandeurs sont écrites en pixels écran puis divisées par le zoom.** Le contexte
 * reçu est déjà mis à l'échelle par `camera.applyToContext` : une épaisseur écrite crûment y
 * serait une épaisseur *carte*, donc juste à zoom 1 et fausse partout ailleurs. Voir les
 * constantes `PORTAL_*_SCREEN_PX`.
 */
export class PortalsLayer {
  /**
   * Rendu des portails d'un étage.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {{ zoom?: number, flash?: { portalId: string, at: number }|null, now?: number }} [options]
   * @returns {{ renderedCount: number, animationActive: boolean }}
   */
  render(ctx, grid, level, options = {}) {
    const result = { renderedCount: 0, animationActive: false };
    if (!ctx || !grid || !level || !Array.isArray(level.portals) || level.portals.length === 0) {
      return result;
    }

    const zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
    /**
     * Pixels écran → pixels carte, l'unique conversion de cette couche.
     * @param {number} screenPx
     * @returns {number}
     */
    const px = (screenPx) => screenPx / zoom;
    const flash = options.flash ?? null;
    const now = options.now ?? 0;

    ctx.save();

    for (const portal of level.portals) {
      const state = portal.state;
      const pA = grid.mapFromCellPoint({ cellX: portal.a.cellX, cellY: portal.a.cellY });
      const pB = grid.mapFromCellPoint({ cellX: portal.b.cellX, cellY: portal.b.cellY });

      // Le battement d'une porte verrouillée qu'on vient de taper. Calculé avant la sortie
      // anticipée du cas `closed` : il ne concerne que `locked`, mais le lire ici évite de le
      // dupliquer plus bas.
      let flashProgress = 0;
      if (flash && flash.portalId === portal.id) {
        const age = now - flash.at;
        if (age >= 0 && age < PORTAL_LOCKED_FLASH_MS) {
          flashProgress = 1 - age / PORTAL_LOCKED_FLASH_MS;
          result.animationActive = true;
        }
      }

      // Closed: l'image de fond contient la porte fermée -> rien à dessiner
      if (!state || state === 'closed') {
        continue;
      }

      ctx.save();

      if (state === 'open') {
        // Porte ouverte : trait discret vert discontinu le long du segment
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = px(PORTAL_OPEN_LINE_SCREEN_PX);
        ctx.setLineDash([px(PORTAL_OPEN_DASH_SCREEN_PX), px(PORTAL_OPEN_DASH_SCREEN_PX)]);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      } else if (state === 'locked') {
        // Porte verrouillée : ligne rouge avec cadenas central
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = px(PORTAL_LOCKED_LINE_SCREEN_PX);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();

        // Marqueur central (disque rouge avec bordure blanche), borné par la longueur de la
        // porte pour ne jamais la recouvrir entièrement.
        const segmentScreenLength = Math.hypot(pB.x - pA.x, pB.y - pA.y) * zoom;
        const dotRadiusScreen = Math.min(
          PORTAL_LOCK_DOT_RADIUS_SCREEN_PX,
          (segmentScreenLength * PORTAL_LOCK_DOT_MAX_SEGMENT_RATIO) / 2
        );
        const midX = (pA.x + pB.x) / 2;
        const midY = (pA.y + pB.y) / 2;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(midX, midY, px(dotRadiusScreen), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = px(PORTAL_LOCK_DOT_BORDER_SCREEN_PX);
        ctx.stroke();

        // Le battement : un halo qui se resserre sur le cadenas. Il ne déplace ni ne masque
        // l'indicateur, il l'entoure — l'information reste lisible pendant le signal.
        if (flashProgress > 0) {
          ctx.globalAlpha = 0.9 * flashProgress;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = px(2);
          ctx.beginPath();
          ctx.arc(
            midX,
            midY,
            px(dotRadiusScreen + 4 + 14 * (1 - flashProgress)),
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
      }

      ctx.restore();
      result.renderedCount++;
    }

    ctx.restore();
    return result;
  }
}
