// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * Couche d'affichage de l'indicateur d'état des trois états de portail.
 * Plaisante et discrète entre la grille et la zone de mouvement.
 */
export class PortalsLayer {
  /**
   * Rendu des portails d'un étage.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @returns {number} Nombre de portails dessinés
   */
  render(ctx, grid, level) {
    if (!ctx || !grid || !level || !Array.isArray(level.portals) || level.portals.length === 0) {
      return 0;
    }

    ctx.save();
    let renderedCount = 0;

    for (const portal of level.portals) {
      const state = portal.state;
      // Closed: l'image de fond contient la porte fermée -> rien à dessiner
      if (!state || state === 'closed') {
        continue;
      }

      const pA = grid.mapFromCellPoint({ cellX: portal.a.cellX, cellY: portal.a.cellY });
      const pB = grid.mapFromCellPoint({ cellX: portal.b.cellX, cellY: portal.b.cellY });

      ctx.save();

      if (state === 'open') {
        // Porte ouverte : trait discret vert discontinu le long du segment
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      } else if (state === 'locked') {
        // Porte verrouillée : ligne rouge avec cadenas central
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();

        // Marqueur central (disque rouge avec bordure blanche)
        const midX = (pA.x + pB.x) / 2;
        const midY = (pA.y + pB.y) / 2;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(midX, midY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();
      renderedCount++;
    }

    ctx.restore();
    return renderedCount;
  }
}
