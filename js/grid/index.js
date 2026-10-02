// @ts-check
import { SquareGrid } from './SquareGrid.js';
import { HexGrid } from './HexGrid.js';

/**
 * Retourne l'adaptateur de grille pour l'étage fourni.
 *
 * @param {import('../core/types.js').Level} level
 * @returns {import('./GridAdapter.js').GridAdapter}
 */
export function gridFor(level) {
  if (!level || !level.grid) {
    throw new Error('Level invalide ou configuration de grille manquante');
  }
  if (level.grid.type === 'square') {
    return new SquareGrid(level);
  }
  if (level.grid.type === 'hex') {
    return new HexGrid(level);
  }
  throw new Error(`Type de grille inconnu : "${level.grid.type}"`);
}

/**
 * Dimensions en cases d'un étage repavé en `type`, l'image restant ce qu'elle est (C-16).
 *
 * ⭐ **L'image est la vérité.** La largeur `offsetX + widthCells × pxPerCell` ne dépend pas du
 * pavage : `widthCells` ne change jamais. Seule la hauteur se recalcule, au pas de rangée de la
 * grille cible, **arrondie au-dessus** pour que la grille couvre toute l'image et que le
 * « contain » du fond rende une échelle de 1 exactement.
 *
 * ⚠ La hauteur visée se lit dans la **proportion de l'image** quand elle est connue, et non dans
 * l'étendue courante : un étage déjà faux (50 × 50 hexagones sur une image carrée, l'état laissé
 * par l'ancien sélecteur) se répare au lieu de propager son erreur. Sans image, l'étendue courante
 * est le seul repère.
 *
 * @param {import('../core/types.js').Level} level
 * @param {import('../core/types.js').GridType} type Pavage cible
 * @param {{width: number, height: number}|null} [imageSize] Dimensions naturelles de l'image
 * @returns {{widthCells: number, heightCells: number}}
 */
export function cellDimensionsForGridType(level, type, imageSize = null) {
  const etendue = gridFor(level).mapExtent();
  const largeur = etendue.width;
  const hauteur =
    imageSize && imageSize.width > 0 && imageSize.height > 0
      ? (largeur * imageSize.height) / imageSize.width
      : etendue.height;
  const pasRangee = gridFor({ ...level, grid: { ...level.grid, type } }).cellPitch().y;
  const offsetY = level.grid?.offsetY ?? 0;
  // Le `- 1e-6` absorbe l'erreur d'arrondi d'une hauteur qui tombe juste sur un multiple du pas :
  // 7000 / 140 ne doit pas devenir 51 rangées pour un epsilon.
  const heightCells = Math.max(1, Math.ceil((hauteur - offsetY) / pasRangee - 1e-6));
  return { widthCells: level.widthCells, heightCells };
}
