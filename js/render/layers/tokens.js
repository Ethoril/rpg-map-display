// @ts-check
import { Container, Graphics, Text } from 'pixi.js';

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
 * Couche de rendu des pions (sprites/placeholders), anneau de sélection,
 * badges d'élévation et marqueurs.
 */
export class TokensLayer {
  /**
   * @param {Container} container Conteneur PixiJS parent dédié aux pions.
   */
  constructor(container) {
    /** @type {Container} */
    this.container = container;
  }

  /**
   * Rend la liste des pions sur la grille.
   *
   * @param {GridAdapter} grid Adaptateur de grille (SquareGrid, etc.)
   * @param {Token[]} tokens Liste des pions à afficher
   * @param {SelectionOption|string|null} [selection] Objet de sélection ({ tokenId?: string|null }) ou id string
   * @param {RenderOptions} [options] Options d'affichage ({ role?: 'gm'|'players', isGM?: boolean })
   */
  render(grid, tokens = [], selection = null, options = {}) {
    this.container.removeChildren();

    if (!Array.isArray(tokens) || tokens.length === 0) return;

    // Normaliser l'ID du pion sélectionné
    const selectedTokenId =
      typeof selection === 'string'
        ? selection
        : selection && typeof selection === 'object'
        ? selection.tokenId ?? selection.selectedTokenId ?? null
        : null;

    // Filtrage pour la vue joueurs si la couche reçoit la liste non filtrée
    const isPlayerView = options?.role === 'players' || options?.isGM === false;
    const tokensToRender = isPlayerView
      ? tokens.filter((t) => !t?.hidden)
      : tokens;

    for (const token of tokensToRender) {
      if (!token || !token.cell) continue;

      const sizeCells = Math.max(1, token.sizeCells ?? 1);

      // Distances et limites en pixels via l'adaptateur de grille
      const p0 = grid.mapFromCellPoint({
        cellX: token.cell.a,
        cellY: token.cell.b,
      });
      const p1 = grid.mapFromCellPoint({
        cellX: token.cell.a + sizeCells,
        cellY: token.cell.b + sizeCells,
      });

      const width = p1.x - p0.x;
      const height = p1.y - p0.y;
      const centerX = p0.x + width / 2;
      const centerY = p0.y + height / 2;
      const radiusX = width / 2;
      const radiusY = height / 2;

      const tokenGroup = new Container();

      // PNJ hidden en vue MJ -> semi-transparent (alpha 0.5)
      if (token.hidden) {
        tokenGroup.alpha = 0.5;
      }

      const g = new Graphics();
      const isSelected = selectedTokenId !== null && selectedTokenId === token.id;

      // 1. Anneau de sélection (gris/blanc, rayon légèrement > sprite) — visible ssi selection.tokenId === token.id
      if (isSelected) {
        g.ellipse(centerX, centerY, radiusX + 3, radiusY + 3);
        g.stroke({ color: '#ffffff', width: 3 });
      }

      // 2. Sprite du pion (ellipse colorée avec bordure pour T-17)
      const color = token.borderColor || '#ff0000';
      g.ellipse(centerX, centerY, radiusX, radiusY);
      g.fill(color);
      g.stroke({ color, width: 2 });

      // 3. Badge d'élévation (texte blanc, petit) — affiché ssi elevation !== 0
      if (typeof token.elevation === 'number' && token.elevation !== 0) {
        const badgeRadius = Math.max(8, Math.min(14, width * 0.12));
        const badgeX = p0.x + width - badgeRadius - 2;
        const badgeY = p0.y + badgeRadius + 2;

        g.ellipse(badgeX, badgeY, badgeRadius, badgeRadius);
        g.fill({ color: '#000000', alpha: 0.8 });
        g.stroke({ color: '#ffffff', width: 1 });

        const textStr = token.elevation > 0 ? `+${token.elevation}` : `${token.elevation}`;
        const elevText = new Text({
          text: textStr,
          style: {
            fontFamily: 'sans-serif',
            fontSize: Math.max(9, Math.round(badgeRadius * 1.1)),
            fill: '#ffffff',
            fontWeight: 'bold',
            align: 'center',
          },
        });
        elevText.anchor.set(0.5, 0.5);
        elevText.x = badgeX;
        elevText.y = badgeY;

        tokenGroup.addChild(elevText);
      }

      // 4. Marqueurs (emplacements prévus mais vides — stub pour T-21)
      const markersContainer = new Container();
      tokenGroup.addChild(markersContainer);

      tokenGroup.addChildAt(g, 0);
      this.container.addChild(tokenGroup);
    }
  }
}
