// @ts-check
import { SquareGrid } from './SquareGrid.js';

/**
 * Retourne l'adaptateur de grille pour l'étage fourni.
 * Lève une erreur si le type est 'hex' (supporté au lot 4) ou inconnu.
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
    throw new Error('Grille hexagonale non supportée');
  }
  throw new Error(`Type de grille inconnu : "${level.grid.type}"`);
}
