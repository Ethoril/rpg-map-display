// @ts-check
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
 */
export class MoveZoneLayer {
  /**
   * @param {any} [container] Conteneur de couche (compatibilité).
   */
  constructor(container = null) {
    this.container = container;
  }

  /**
   * Efface le surlignage.
   */
  clear() {}

  /**
   * Affiche le surlignage semi-transparent des cases atteignables sur Canvas 2D.
   *
   * @param {CanvasRenderingContext2D|GridAdapter} ctxOrGrid Contexte Canvas 2D ou adaptateur de grille
   * @param {GridAdapter|SelectionState|string|null} [gridOrSelection] Adaptateur de grille ou objet de sélection
   * @param {SelectionState|Map<string, number>|string|null} [selectionOrCells] Sélection ou map de cases
   * @param {Map<string, number>|Token[]|Token|null} [cellsOrTokens] Map des cases atteignables ou pions
   * @param {Token[]|Token|string|null} [tokensOrColor] Liste de pions, pion sélectionné ou couleur fallback
   */
  render(ctxOrGrid, gridOrSelection = null, selectionOrCells = null, cellsOrTokens = null, tokensOrColor = null) {
    /** @type {CanvasRenderingContext2D|null} */
    let ctx = null;
    /** @type {GridAdapter|null} */
    let grid = null;
    /** @type {SelectionState|string|null} */
    let selection = null;
    /** @type {Map<string, number>|Token[]|Token|null} */
    let cellsReachableOrTokens = null;
    /** @type {Token[]|Token|string|null} */
    let finalTokensOrColor = null;

    if (ctxOrGrid && typeof /** @type {any} */ (ctxOrGrid).fillRect === 'function') {
      ctx = /** @type {CanvasRenderingContext2D} */ (ctxOrGrid);
      grid = /** @type {GridAdapter} */ (gridOrSelection);
      selection = /** @type {SelectionState|string|null} */ (selectionOrCells);
      cellsReachableOrTokens = cellsOrTokens;
      finalTokensOrColor = tokensOrColor;
    } else {
      grid = /** @type {GridAdapter} */ (ctxOrGrid);
      selection = /** @type {SelectionState|string|null} */ (gridOrSelection);
      cellsReachableOrTokens = /** @type {Map<string, number>|Token[]|Token|null} */ (selectionOrCells);
      finalTokensOrColor = /** @type {any} */ (cellsOrTokens);
    }

    if (!grid || !ctx) return;

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
      if (Array.isArray(finalTokensOrColor) || (finalTokensOrColor && typeof finalTokensOrColor === 'object')) {
        tokens = /** @type {Token[]|Token} */ (finalTokensOrColor);
      } else if (typeof finalTokensOrColor === 'string') {
        fallbackColor = finalTokensOrColor;
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

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;

    for (const key of cellsReachable.keys()) {
      const cell = parseCellKey(key);
      const p0 = grid.mapFromCellPoint({ cellX: cell.a, cellY: cell.b });
      const p1 = grid.mapFromCellPoint({ cellX: cell.a + 1, cellY: cell.b + 1 });
      const width = p1.x - p0.x;
      const height = p1.y - p0.y;

      ctx.fillRect(p0.x, p0.y, width, height);
    }

    ctx.restore();
  }
}
