// @ts-check

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../core/types.js').CellPoint} CellPoint
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * Couche de rendu des murs de l'étage (vue MJ seule).
 * Affiche la géométrie de murs de l'étage ainsi que la polyligne en cours de tracé.
 *
 * ⚠ Ne dépend d'aucun module UI/Input (Règle d'architecture A2). La polyligne en cours
 * de tracé (`draft`) est transmise en argument de `render()`.
 */
export class WallsLayer {
  /**
   * Rendu des murs d'un étage.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Level} level
   * @param {CellPoint[]|null} [draft=null] Polyligne en cours de tracé (optionnelle)
   * @returns {number} Nombre de segments de murs dessinés
   */
  render(ctx, grid, level, draft = null) {
    if (!ctx || !grid || !level) {
      return 0;
    }

    ctx.save();
    let renderedSegments = 0;

    const walls = Array.isArray(level.walls) ? level.walls : [];

    // 1. Rendu des murs confirmés de l'étage
    if (walls.length > 0) {
      ctx.strokeStyle = '#f97316'; // Orange lumineux
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.85;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const wall of walls) {
        if (!Array.isArray(wall) || wall.length < 2) continue;

        ctx.beginPath();
        const p0 = grid.mapFromCellPoint({ cellX: wall[0].cellX, cellY: wall[0].cellY });
        ctx.moveTo(p0.x, p0.y);

        for (let i = 1; i < wall.length; i++) {
          const pt = grid.mapFromCellPoint({ cellX: wall[i].cellX, cellY: wall[i].cellY });
          ctx.lineTo(pt.x, pt.y);
          renderedSegments++;
        }
        ctx.stroke();
      }
    }

    // 2. Rendu du tracé en cours (draft)
    if (Array.isArray(draft) && draft.length > 0) {
      ctx.save();

      // Traits discontinus bleu cyan pour le tracé en cours
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.9;
      ctx.lineCap = 'round';

      ctx.beginPath();
      const firstPt = grid.mapFromCellPoint({ cellX: draft[0].cellX, cellY: draft[0].cellY });
      ctx.moveTo(firstPt.x, firstPt.y);

      for (let i = 1; i < draft.length; i++) {
        const pt = grid.mapFromCellPoint({ cellX: draft[i].cellX, cellY: draft[i].cellY });
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();

      // Sommets posés : petits disques pleins
      ctx.fillStyle = '#38bdf8';
      ctx.setLineDash([]);
      for (const node of draft) {
        const pt = grid.mapFromCellPoint({ cellX: node.cellX, cellY: node.cellY });
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    ctx.restore();
    return renderedSegments;
  }
}
