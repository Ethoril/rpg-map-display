// @ts-check

/**
 * Couche sans état qui délègue le tracé au seul adaptateur de grille.
 */
export class GridLayer {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {import('../../grid/GridAdapter.js').GridAdapter} grid
   */
  render(ctx, grid) {
    if (ctx && grid && typeof grid.renderGrid === 'function') {
      grid.renderGrid(ctx);
    }
  }
}
