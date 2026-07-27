// @ts-check

/**
 * @typedef {import('./types.js').Cell} Cell
 */

/**
 * Convertit un couple de coordonnées de cellule en sa clé canonique.
 * Ex. {a: 4, b: 7} -> "4,7"
 *
 * @param {Cell} cell
 * @returns {string}
 */
export function cellKey(cell) {
  return `${cell.a},${cell.b}`;
}

/**
 * Parse une clé canonique de cellule en couple de coordonnées.
 * Ex. "4,7" -> {a: 4, b: 7}
 *
 * @param {string} key
 * @returns {Cell}
 */
export function parseCellKey(key) {
  const commaIndex = key.indexOf(',');
  if (commaIndex === -1) {
    throw new Error(`Format de cellKey invalide: "${key}"`);
  }
  const aStr = key.slice(0, commaIndex);
  const bStr = key.slice(commaIndex + 1);
  const a = Number(aStr);
  const b = Number(bStr);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error(`Coordonnées non numériques dans cellKey: "${key}"`);
  }
  return { a, b };
}

/**
 * Clé d'arête entre deux cellules, indépendante du sens de parcours.
 * Les deux clés de cellule sont triées lexicographiquement puis jointes par '|'.
 *
 * @param {Cell | string} cellA
 * @param {Cell | string} cellB
 * @returns {string}
 */
export function edgeKey(cellA, cellB) {
  const keyA = typeof cellA === 'string' ? cellA : cellKey(cellA);
  const keyB = typeof cellB === 'string' ? cellB : cellKey(cellB);
  return keyA <= keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}
