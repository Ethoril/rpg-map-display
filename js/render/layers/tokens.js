// @ts-check

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 *
 * @typedef {Object} SelectionOption
 * @property {string|null} [tokenId]
 * @property {string|null} [selectedTokenId]
 *
 * @typedef {Object} RenderOptions
 * @property {'gm'|'players'} [role]
 * @property {boolean} [isGM]
 */

/**
 * Couche de rendu des pions via Canvas 2D natif.
 */
export class TokensLayer {
  /**
   * @param {any} [container] Conteneur factice (compatibilité).
   */
  constructor(container = null) {
    this.container = container;
  }

  /**
   * Rend la liste des pions sur la grille en Canvas 2D.
   *
   * @param {CanvasRenderingContext2D|GridAdapter} ctxOrGrid Contexte Canvas 2D ou adaptateur de grille
   * @param {any} [gridOrTokens] Adaptateur de grille ou liste de pions
   * @param {any} [tokensOrSelection] Liste des pions ou sélection
   * @param {any} [selectionOrOptions] Sélection ou options
   * @param {RenderOptions} [options] Options d'affichage
   */
  render(ctxOrGrid, gridOrTokens, tokensOrSelection, selectionOrOptions, options = {}) {
    /** @type {CanvasRenderingContext2D|null} */
    let ctx = null;
    /** @type {GridAdapter|null} */
    let grid = null;
    /** @type {Token[]} */
    let tokens = [];
    /** @type {SelectionOption|string|null} */
    let selection = null;
    /** @type {RenderOptions} */
    let opts = options;

    if (ctxOrGrid && typeof /** @type {any} */ (ctxOrGrid).fillRect === 'function') {
      ctx = /** @type {CanvasRenderingContext2D} */ (ctxOrGrid);
      grid = /** @type {GridAdapter} */ (gridOrTokens);
      tokens = Array.isArray(tokensOrSelection) ? tokensOrSelection : [];
      selection = /** @type {SelectionOption|string|null} */ (selectionOrOptions);
      opts = options || {};
    } else {
      grid = /** @type {GridAdapter} */ (ctxOrGrid);
      tokens = Array.isArray(gridOrTokens) ? gridOrTokens : [];
      selection = /** @type {SelectionOption|string|null} */ (tokensOrSelection);
      opts = /** @type {RenderOptions} */ (selectionOrOptions || {});
    }

    if (!grid || !ctx || !Array.isArray(tokens) || tokens.length === 0) return;

    // Normaliser l'ID du pion sélectionné
    const selectedTokenId =
      typeof selection === 'string'
        ? selection
        : selection && typeof selection === 'object'
        ? selection.tokenId ?? selection.selectedTokenId ?? null
        : null;

    // Filtrage pour la vue joueurs
    const isPlayerView = opts?.role === 'players' || opts?.isGM === false;
    const tokensToRender = isPlayerView
      ? tokens.filter((t) => !t?.hidden)
      : tokens;

    ctx.save();

    // 1. Dessiner les disques pions
    for (const token of tokensToRender) {
      if (!token || !token.cell) continue;

      const sizeCells = Math.max(1, token.sizeCells ?? 1);
      const p0 = grid.mapFromCellPoint({ cellX: token.cell.a, cellY: token.cell.b });
      const p1 = grid.mapFromCellPoint({ cellX: token.cell.a + sizeCells, cellY: token.cell.b + sizeCells });

      const width = p1.x - p0.x;
      const height = p1.y - p0.y;
      const centerX = p0.x + width / 2;
      const centerY = p0.y + height / 2;
      const radiusX = width / 2;
      const radiusY = height / 2;

      ctx.save();
      if (token.hidden) {
        ctx.globalAlpha = 0.5;
      }

      const color = token.borderColor || '#ff0000';
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    }

    // 2. Dessiner les anneaux de sélection
    for (const token of tokensToRender) {
      if (!token || !token.cell) continue;
      if (selectedTokenId !== null && selectedTokenId === token.id) {
        const sizeCells = Math.max(1, token.sizeCells ?? 1);
        const p0 = grid.mapFromCellPoint({ cellX: token.cell.a, cellY: token.cell.b });
        const p1 = grid.mapFromCellPoint({ cellX: token.cell.a + sizeCells, cellY: token.cell.b + sizeCells });

        const width = p1.x - p0.x;
        const height = p1.y - p0.y;
        const centerX = p0.x + width / 2;
        const centerY = p0.y + height / 2;
        const radiusX = width / 2;
        const radiusY = height / 2;

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX + 3, radiusY + 3, 0, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }

    // 3. Dessiner les badges d'élévation
    for (const token of tokensToRender) {
      if (!token || !token.cell) continue;
      if (typeof token.elevation === 'number' && token.elevation !== 0) {
        const sizeCells = Math.max(1, token.sizeCells ?? 1);
        const p0 = grid.mapFromCellPoint({ cellX: token.cell.a, cellY: token.cell.b });
        const p1 = grid.mapFromCellPoint({ cellX: token.cell.a + sizeCells, cellY: token.cell.b + sizeCells });
        const width = p1.x - p0.x;

        const badgeRadius = Math.max(8, Math.min(14, width * 0.12));
        const badgeX = p0.x + width - badgeRadius - 2;
        const badgeY = p0.y + badgeRadius + 2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        const textStr = token.elevation > 0 ? `+${token.elevation}` : `${token.elevation}`;
        ctx.font = `bold ${Math.max(9, Math.round(badgeRadius * 1.1))}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(textStr, badgeX, badgeY);
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
