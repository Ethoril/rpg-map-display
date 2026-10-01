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

    // ⛔ `visionBright` n'est plus validé, et son absence comme sa présence sont toutes deux
    // acceptées — chantier Z, 26/08/2026. Les catalogues déjà sur disque en portent un ; le
    // refuser casserait la bibliothèque de pions du mainteneur pour un champ que le moteur
    // n'a jamais lu.

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

    // Absent = sans dossier. Présent, il est déjà normalisé : une chaîne vide ou entourée
    // d'espaces ferait deux dossiers qui s'affichent pareil.
    if (entry.folder !== undefined && normalizeFolder(entry.folder) !== entry.folder) {
      errors.push(
        `${prefix} : folder doit être un nom non vide d'au plus ${FOLDER_MAX_LENGTH} caractères, sans espace en tête ni en fin`
      );
    }
  }

  return errors;
}

/** Longueur maximale d'un nom de dossier de pions. */
export const FOLDER_MAX_LENGTH = 60;

/**
 * Normalise un nom de dossier saisi : espaces resserrés, `undefined` pour « sans dossier ».
 *
 * @param {unknown} raw
 * @returns {string|undefined}
 */
export function normalizeFolder(raw) {
  if (typeof raw !== 'string') return undefined;
  const nom = raw.replace(/\s+/g, ' ').trim();
  if (nom === '' || nom.length > FOLDER_MAX_LENGTH) return undefined;
  return nom;
}

/**
 * Range des entrées par dossier, pour l'affichage — la vue MJ et l'outil de préparation
 * partagent ce rangement, et ne doivent pas le refaire chacun à sa façon.
 *
 * Les pions sans dossier viennent en tête (`folder: null`), puis les dossiers par ordre
 * alphabétique ; dans chaque groupe, les pions par nom. Pure : les entrées ne sont pas mutées.
 *
 * @template {{ name: string, folder?: string }} E
 * @param {E[]} entries
 * @returns {{ folder: string|null, entries: E[] }[]}
 */
export function groupByFolder(entries) {
  /** @param {string} x @param {string} y */
  const ordre = (x, y) => x.localeCompare(y, 'fr', { sensitivity: 'base', numeric: true });
  /** @type {Map<string|null, E[]>} */
  const groupes = new Map();
  for (const entry of entries) {
    const cle = normalizeFolder(entry.folder) ?? null;
    const groupe = groupes.get(cle);
    if (groupe) groupe.push(entry);
    else groupes.set(cle, [entry]);
  }
  return [...groupes.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : ordre(a, b)))
    .map(([folder, liste]) => ({ folder, entries: [...liste].sort((x, y) => ordre(x.name, y.name)) }));
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
    visionDim: entry.visionDim,
    emitsLight: entry.emitsLight ? { ...entry.emitsLight } : null,
    speedCells: entry.speedCells,
    playerMovable: options.playerMovable ?? (kind === 'pc'),
    locked: options.locked ?? false,
    elevation: options.elevation ?? 0,
    markers: options.markers ? [...options.markers] : [],
    hp: maxHp !== null ? { current: maxHp, max: maxHp } : null,
    health: 'unharmed',
    // La provenance, pour numéroter les exemplaires (C-15). Le numéro, lui, se décide à la pose.
    libraryId: entry.id,
  });
}

/**
 * Numérote un exemplaire de bibliothèque qu'on va poser — chantier C-15, 01/10/2026.
 *
 * Arbitrages du mainteneur :
 * - **à partir du deuxième** : un exemplaire seul ne porte pas de numéro ; quand on en pose un
 *   deuxième, le premier devient 1 et le nouveau 2 ;
 * - **jamais réattribué** : le suivant prend le dernier numéro donné + 1, même si l'exemplaire qui
 *   le portait a été retiré. D'où le compteur de campagne, `settings.copyCounters`.
 *
 * Les exemplaires comptés sont ceux du plateau ET de la réserve : un pion rangé reste vivant.
 * Le nom ne prend le numéro que s'il est encore celui de la bibliothèque — un pion renommé par le
 * MJ garde son nom, et seule sa pastille porte le numéro.
 *
 * Pure : la campagne et le pion reçus ne sont pas mutés.
 *
 * @param {{ tokens: Token[], reserve?: Token[], settings?: { copyCounters?: Record<string, number> } }} campaign
 * @param {Token} token pion à poser, `label` = nom de l'entrée de bibliothèque
 * @returns {{ token: Token, patches: { tokenId: string, patch: { copyNumber: number, label?: string } }[], counter: number|null }}
 *   `counter` est le nouveau dernier numéro donné, ou `null` si rien n'a été numéroté
 */
export function numberLibraryCopy(campaign, token) {
  const libraryId = token.libraryId;
  if (!libraryId) return { token: { ...token }, patches: [], counter: null };

  const freres = [...(campaign.tokens ?? []), ...(campaign.reserve ?? [])].filter(
    (t) => t.libraryId === libraryId && t.id !== token.id
  );
  if (freres.length === 0) return { token: { ...token }, patches: [], counter: null };

  let dernier = Math.max(
    campaign.settings?.copyCounters?.[libraryId] ?? 0,
    ...freres.map((t) => (typeof t.copyNumber === 'number' ? t.copyNumber : 0))
  );
  const base = token.label;

  /** @type {{ tokenId: string, patch: { copyNumber: number, label?: string } }[]} */
  const patches = [];
  // L'exemplaire resté seul jusque-là — un seul en principe ; dans l'ordre d'identifiant s'il y en
  // avait plusieurs, pour que deux MJ rejouant la même pose aboutissent aux mêmes numéros.
  for (const frere of freres.filter((t) => typeof t.copyNumber !== 'number').sort((a, b) => (a.id < b.id ? -1 : 1))) {
    dernier += 1;
    patches.push({
      tokenId: frere.id,
      patch: frere.label === base ? { copyNumber: dernier, label: `${base} ${dernier}` } : { copyNumber: dernier },
    });
  }

  dernier += 1;
  return {
    token: { ...token, copyNumber: dernier, label: `${base} ${dernier}` },
    patches,
    counter: dernier,
  };
}
