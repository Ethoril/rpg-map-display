// @ts-check
import { Container, Graphics } from 'pixi.js';
import { parseCellKey } from '../../core/cellKey.js';

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 *
 * @typedef {Object} SelectionState
 * @property {string|null} [selectedTokenId]
 * @property {string|null} [tokenId]
 * @property {Map<string, number>} [cellsReachable]
 * @property {Map<string, number>} [reachableCells]
 * @property {Token|null} [selectedToken]
 * @property {string} [borderColor]
 */

/**
 * Couche 100% visuelle affichant la zone de déplacement (cases atteignables).
 * Aucune interactivité (hit-test désactivé via eventMode = 'none').
 */
export class MoveZoneLayer {
  /**
   * @param {Container} container Conteneur PixiJS parent dédié à la zone de déplacement.
   */
  constructor(container) {
    /** @type {Container} */
    this.container = container;
    this.container.eventMode = 'none';

    /** @type {Graphics} */
    this.graphics = new Graphics();
    this.graphics.eventMode = 'none';
    this.container.addChild(this.graphics);
  }

  /**
   * Efface le surlignage.
   */
  clear() {
    this.graphics.clear();
  }

  /**
   * Affiche le surlignage semi-transparent des cases atteignables.
   *
   * @param {GridAdapter} grid Adaptateur de grille
   * @param {SelectionState|string|null} selection Objet de sélection ou ID du pion sélectionné
   * @param {Map<string, number>|Token[]|Token|null} [cellsReachableOrTokens] Map des cases atteignables OU liste de pions
   * @param {Token[]|Token|string|null} [tokensOrColor] Liste de pions, pion sélectionné ou couleur fallback
   */
  render(grid, selection = null, cellsReachableOrTokens = null, tokensOrColor = null) {
    this.graphics.clear();
    if (!grid) return;

    /** @type {string|null} */
    let selectedTokenId = null;
    /** @type {Map<string, number>|null} */
    let cellsReachable = null;
    /** @type {Token[]|Token|null} */
    let tokens = null;
    /** @type {string|null} */
    let fallbackColor = null;

    if (typeof selection === 'string') {
      selectedTokenId = selection;
      if (cellsReachableOrTokens instanceof Map) {
        cellsReachable = cellsReachableOrTokens;
      }
      if (Array.isArray(tokensOrColor) || (tokensOrColor && typeof tokensOrColor === 'object')) {
        tokens = /** @type {Token[]|Token} */ (tokensOrColor);
      } else if (typeof tokensOrColor === 'string') {
        fallbackColor = tokensOrColor;
      }
    } else if (selection && typeof selection === 'object') {
      selectedTokenId = selection.selectedTokenId ?? selection.tokenId ?? null;
      cellsReachable = selection.cellsReachable ?? selection.reachableCells ?? null;

      if (cellsReachableOrTokens instanceof Map) {
        cellsReachable = cellsReachableOrTokens;
      } else if (Array.isArray(cellsReachableOrTokens) || (cellsReachableOrTokens && typeof cellsReachableOrTokens === 'object')) {
        tokens = /** @type {Token[]|Token} */ (cellsReachableOrTokens);
      }

      if (selection.selectedToken) {
        tokens = selection.selectedToken;
      }
      if (selection.borderColor) {
        fallbackColor = selection.borderColor;
      }
    }

    if (!selectedTokenId || !cellsReachable || cellsReachable.size === 0) {
      return;
    }

    // Récupération de la couleur du pion (token.borderColor)
    let color = fallbackColor || '#3b82f6';
    if (tokens) {
      if (Array.isArray(tokens)) {
        const selToken = tokens.find((t) => t && t.id === selectedTokenId);
        if (selToken?.borderColor) {
          color = selToken.borderColor;
        }
      } else if (typeof tokens === 'object' && tokens.id === selectedTokenId && tokens.borderColor) {
        color = tokens.borderColor;
      } else if (typeof tokens === 'object' && tokens.borderColor) {
        color = tokens.borderColor;
      }
    }

    for (const key of cellsReachable.keys()) {
      const cell = parseCellKey(key);
      const p0 = grid.mapFromCellPoint({ cellX: cell.a, cellY: cell.b });
      const p1 = grid.mapFromCellPoint({ cellX: cell.a + 1, cellY: cell.b + 1 });
      const width = p1.x - p0.x;
      const height = p1.y - p0.y;

      this.graphics.rect(p0.x, p0.y, width, height);
    }

    this.graphics.fill({ color, alpha: 0.3 });
  }
}
