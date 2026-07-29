// @ts-check

/**
 * Couche de tracé de la grille. Délègue intégralement le rendu à GridAdapter.renderGrid().
 */
export class GridLayer {
  /**
   * @param {any} [container] Conteneur de couche (compatibilité).
   */
  constructor(container = null) {
    this.container = container;
  }

  /**
   * Délègue le tracé du quadrillage sur le contexte 2D à l'adaptateur de grille.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte Canvas 2D
   * @param {import('../../grid/GridAdapter.js').GridAdapter} grid Adaptateur de grille
   * @param {object} [viewport]
   */
  render(ctx, grid, viewport = {}) {
    if (grid && typeof grid.renderGrid === 'function' && ctx) {
      grid.renderGrid(ctx, viewport);
    }
  }
}
