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
