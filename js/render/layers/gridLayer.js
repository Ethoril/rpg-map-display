// @ts-check
import { Container, Graphics } from 'pixi.js';

/**
 * Couche de tracé de la grille. Délègue intégralement le rendu à GridAdapter.renderGrid().
 */
export class GridLayer {
  /**
   * @param {Container} container Conteneur PixiJS parent dédié à la couche gridLayer.
   */
  constructor(container) {
    /** @type {Container} */
    this.container = container;
    /** @type {Graphics} */
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
  }

  /**
   * Délègue le tracé du quadrillage à l'adaptateur de grille.
   *
   * @param {import('../../grid/GridAdapter.js').GridAdapter} grid
   * @param {object} [viewport]
   */
  render(grid, viewport = {}) {
    grid.renderGrid(this.graphics, viewport);
  }
}
