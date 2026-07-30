// @ts-check
import { createToken, isPersistableAssetUrl, isValidHexColor } from '../core/schema.js';

/**
 * @typedef {import('../core/types.js').TokenLibraryEntry} TokenLibraryEntry
 * @typedef {import('../core/types.js').Token} Token
 * @typedef {import('../core/types.js').Cell} Cell
 */

/**
 * @typedef {Object} TokenCatalog
 * @property {number} version
 * @property {TokenLibraryEntry[]} tokens
 */

/**
 * Valide un objet de catalogue de pions.
 * Retourne un tableau d'erreurs (vide = valide).
 *
 * @param {unknown} obj
 * @returns {string[]}
 */
export function validateTokenCatalog(obj) {
  /** @type {string[]} */
  const errors = [];

  if (!obj || typeof obj !== 'object') {
    errors.push('Catalogue : un objet est attendu');
    return errors;
  }

  /** @type {any} */
  const cat = obj;

  if (!('version' in cat)) {
    errors.push('Catalogue : version manquante');
  } else if (typeof cat.version !== 'number' || cat.version !== 1) {
    errors.push('Catalogue : version invalide (1 attendu)');
  }

  if (!Array.isArray(cat.tokens)) {
    errors.push('Catalogue : tokens doit être un tableau');
    return errors;
  }

  const ids = new Set();
  for (let i = 0; i < cat.tokens.length; i++) {
    const entry = cat.tokens[i];
    const prefix = `Catalogue[tokens[${i}]]`;

    if (!entry || typeof entry !== 'object') {
      errors.push(`${prefix} : objet attendu`);
      continue;
    }

    const id = entry.id;
    if (!id || typeof id !== 'string') {
      errors.push(`${prefix} : id manquant ou invalide`);
    } else if (ids.has(id)) {
      errors.push(`${prefix} : id dupliqué "${id}"`);
    } else {
      ids.add(id);
    }

    if (!entry.name || typeof entry.name !== 'string') {
      errors.push(`${prefix} : name manquant`);
    }

    if (!entry.imageUrl || typeof entry.imageUrl !== 'string') {
      errors.push(`${prefix} : imageUrl manquant`);
    } else if (entry.imageUrl.startsWith('data:')) {
      errors.push(`${prefix} : imageUrl ne doit pas être une data: URL`);
    } else if (entry.imageUrl.startsWith('blob:')) {
      errors.push(`${prefix} : imageUrl ne doit pas être une blob: URL`);
    } else if (!isPersistableAssetUrl(entry.imageUrl)) {
      errors.push(`${prefix} : imageUrl non persistable`);
    }

    if (entry.kind !== 'pc' && entry.kind !== 'npc') {
      errors.push(`${prefix} : kind doit être "pc" ou "npc"`);
    }

    if (!Number.isInteger(entry.sizeCells) || entry.sizeCells < 1) {
      errors.push(`${prefix} : sizeCells doit être un entier >= 1`);
    }

    if (typeof entry.speedCells !== 'number' || entry.speedCells < 1) {
      errors.push(`${prefix} : speedCells doit être un nombre >= 1`);
    }

    if (typeof entry.visionBright !== 'number' || entry.visionBright < 0) {
      errors.push(`${prefix} : visionBright doit être un nombre >= 0`);
    }

    if (typeof entry.visionDim !== 'number' || entry.visionDim < 0) {
      errors.push(`${prefix} : visionDim doit être un nombre >= 0`);
    }

    if (entry.emitsLight !== null) {
      if (typeof entry.emitsLight !== 'object') {
        errors.push(`${prefix} : emitsLight doit être null ou un objet`);
      } else {
        const { range, intensity, color } = entry.emitsLight;
        if (typeof range !== 'number' || range < 0) {
          errors.push(`${prefix}.emitsLight : range doit être un nombre >= 0`);
        }
        if (typeof intensity !== 'number' || intensity < 0) {
          errors.push(`${prefix}.emitsLight : intensity doit être un nombre >= 0`);
        }
        if (!isValidHexColor(color)) {
          errors.push(`${prefix}.emitsLight : color doit être au format #RRGGBB`);
        }
      }
    }

    if (!isValidHexColor(entry.borderColor)) {
      errors.push(`${prefix} : borderColor doit être au format #RRGGBB`);
    }
  }

  return errors;
}

/**
 * Options pour la projection d'une entrée de bibliothèque vers un Token.
 * @typedef {Object} TokenProjectionOptions
 * @property {string} levelId - Identifiant de l'étage actif
 * @property {string} [id] - Identifiant unique du pion généré
 * @property {Cell} [cell] - Position sur la grille (0,0 par défaut)
 * @property {boolean} [hidden] - Masqué aux joueurs (false par défaut)
 * @property {boolean} [playerMovable] - Déplaçable par les joueurs (défini selon kind par défaut)
 * @property {boolean} [locked] - Pion verrouillé (false par défaut)
 * @property {number} [elevation] - Élévation (0 par défaut)
 * @property {string[]} [markers] - Marqueurs d'état ([] par défaut)
 */

/**
 * Projette une entrée de bibliothèque TokenLibraryEntry vers une instance de Token.
 * Mappe name -> label et recopie fidèlement les 9 métadonnées.
 *
 * @param {TokenLibraryEntry} entry
 * @param {TokenProjectionOptions} options
 * @returns {Token}
 */
export function createTokenFromLibraryEntry(entry, options) {
  if (!options || !options.levelId) {
    throw new Error('createTokenFromLibraryEntry : levelId est obligatoire');
  }

  const kind = entry.kind === 'pc' ? 'pc' : 'npc';
  const id = options.id ?? crypto.randomUUID();

  return createToken({
    id,
    levelId: options.levelId,
    cell: options.cell ?? { a: 0, b: 0 },
    sizeCells: entry.sizeCells,
    kind,
    imageUrl: entry.imageUrl,
    borderColor: entry.borderColor,
    label: entry.name,
    hidden: options.hidden ?? false,
    visionBright: entry.visionBright,
    visionDim: entry.visionDim,
    emitsLight: entry.emitsLight ? { ...entry.emitsLight } : null,
    speedCells: entry.speedCells,
    playerMovable: options.playerMovable ?? (kind === 'pc'),
    locked: options.locked ?? false,
    elevation: options.elevation ?? 0,
    markers: options.markers ? [...options.markers] : [],
  });
}
