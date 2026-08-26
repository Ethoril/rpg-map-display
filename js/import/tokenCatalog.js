// @ts-check
import { createToken, identifiantAleatoire, isPersistableAssetUrl, isValidHexColor, isStatusMarker } from '../core/schema.js';

/**
 * @typedef {import('../core/types.js').TokenLibraryEntry} TokenLibraryEntry
 * @typedef {import('../core/types.js').Token} Token
 * @typedef {import('../core/types.js').Cell} Cell
 * @typedef {import('../core/constants.js').StatusMarker} StatusMarker
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

    if (entry.maxHp !== undefined && entry.maxHp !== null) {
      if (!Number.isInteger(entry.maxHp) || entry.maxHp < 1) {
        errors.push(`${prefix} : maxHp doit être null ou un entier >= 1`);
      }
    }
  }

  return errors;
}

/**
 * Insère ou remplace une entrée, et **valide le catalogue résultant**.
 *
 * Pure : rend un nouveau catalogue, ne touche pas à l'entrée reçue. L'écriture sur disque
 * appartient à l'appelant (`scripts/prepare-server.mjs`), la forme au présent module.
 *
 * Valider **après** fusion et non l'entrée seule est délibéré : c'est le seul moyen
 * d'attraper une collision d'identifiant, qui n'existe que par rapport aux autres. Même
 * raisonnement que `validateCampaign`, qui juge la campagne et non la mutation.
 *
 * @param {TokenCatalog} catalog
 * @param {TokenLibraryEntry} entry
 * @returns {{ catalog: TokenCatalog, errors: string[], replaced: boolean }}
 */
export function upsertTokenEntry(catalog, entry) {
  const tokens = Array.isArray(catalog?.tokens) ? [...catalog.tokens] : [];
  const at = tokens.findIndex((t) => t && t.id === entry?.id);
  const replaced = at !== -1;

  if (replaced) {
    tokens[at] = { ...entry };
  } else {
    tokens.push({ ...entry });
  }

  const next = { version: 1, tokens };
  return { catalog: next, errors: validateTokenCatalog(next), replaced };
}

/**
 * Retire une entrée par identifiant.
 *
 * L'image reste sur le disque, et ce n'est pas un oubli : une campagne enregistrée côté
 * navigateur ou un instantané de session peuvent encore référencer `maps/tokens/<x>.webp`.
 * Même règle que `findOrphanArtifacts` pour les cartes — signaler, jamais supprimer.
 *
 * @param {TokenCatalog} catalog
 * @param {string} id
 * @returns {{ catalog: TokenCatalog, errors: string[], removed: TokenLibraryEntry | null }}
 */
export function removeTokenEntry(catalog, id) {
  const tokens = Array.isArray(catalog?.tokens) ? [...catalog.tokens] : [];
  const at = tokens.findIndex((t) => t && t.id === id);
  if (at === -1) {
    return { catalog: { version: 1, tokens }, errors: [], removed: null };
  }

  const [removed] = tokens.splice(at, 1);
  const next = { version: 1, tokens };
  return { catalog: next, errors: validateTokenCatalog(next), removed };
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
 * @property {StatusMarker[]} [markers] - Marqueurs d'état ([] par défaut)
 */

/**
 * Projette une entrée de bibliothèque TokenLibraryEntry vers une instance de Token.
 * Mappe name -> label et recopie fidèlement les 10 métadonnées.
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
  const id = options.id ?? identifiantAleatoire();
  const maxHp = typeof entry.maxHp === 'number' && Number.isInteger(entry.maxHp) && entry.maxHp >= 1 ? entry.maxHp : null;

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
    hp: maxHp !== null ? { current: maxHp, max: maxHp } : null,
    health: 'unharmed',
  });
}
