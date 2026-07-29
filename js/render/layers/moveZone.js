// @ts-check
import { parseCellKey } from '../../core/cellKey.js';

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {{
 *   selectedToken: Token|null,
 *   reachableCells: Map<string, number>|null
 * }} MoveZoneState
 */

/**
 * Couche visuelle sans état et sans surface interactive propre.
 */
export class MoveZoneLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {MoveZoneState} state
   * @returns {number} nombre de cases dessinées
   */
  render(ctx, grid, state) {
    const token = state?.selectedToken;
    const reachableCells = state?.reachableCells;
    if (!ctx || !grid || !token || !(reachableCells instanceof Map) || reachableCells.size === 0) {
      return 0;
    }

    ctx.save();
    ctx.fillStyle = token.borderColor || '#3b82f6';
    ctx.globalAlpha = 0.3;
    let renderedCells = 0;

    for (const key of reachableCells.keys()) {
      const cell = parseCellKey(key);
      const p0 = grid.mapFromCellPoint({ cellX: cell.a, cellY: cell.b });
      const p1 = grid.mapFromCellPoint({ cellX: cell.a + 1, cellY: cell.b + 1 });
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      renderedCells++;
    }

    ctx.restore();
    return renderedCells;
  }
}
