// @ts-check

/**
 * @typedef {import('./types.js').Campaign} Campaign
 * @typedef {import('./types.js').Level} Level
 * @typedef {import('./types.js').Token} Token
 */

/**
 * Fabrique d'une instance de campagne avec valeurs par défaut (CdC §6).
 *
 * @param {Partial<Campaign>} [overrides]
 * @returns {Campaign}
 */
export function createCampaign(overrides = {}) {
  const defaultLevel = createLevel();
  const levels = overrides.levels ?? [defaultLevel];
  return {
    schemaVersion: 2,
    campaignId: overrides.campaignId ?? 'campaign-1',
    name: overrides.name ?? 'Nouvelle campagne',
    levels,
    links: overrides.links ?? [],
    tokens: overrides.tokens ?? [],
    templates: overrides.templates ?? [],
    settings: {
      ambientLevel: 1.0,
      ...(overrides.settings ?? {}),
    },
    ...overrides,
  };
}

/**
 * Fabrique d'une instance d'étage (Level) avec valeurs par défaut (CdC §6).
 *
 * @param {Partial<Level & { grid?: Partial<import('./types.js').GridConfig> }>} [overrides]
 * @returns {Level}
 */
export function createLevel(overrides = {}) {
  return {
    id: overrides.id ?? 'rdc',
    name: overrides.name ?? 'Rez-de-chaussée',
    order: overrides.order ?? 0,
    imageUrl: overrides.imageUrl ?? '',
    videoUrl: overrides.videoUrl ?? null,
    animatedOverlays: overrides.animatedOverlays ?? [],
    pxPerCell: overrides.pxPerCell ?? 140,
    widthCells: overrides.widthCells ?? 40,
    heightCells: overrides.heightCells ?? 30,
    grid: {
      type: 'square',
      offsetX: 0,
      offsetY: 0,
      color: '#000000',
      opacity: 0.25,
      visible: true,
      ...(overrides.grid ?? {}),
    },
    terrainCost: overrides.terrainCost ?? null,
    walls: overrides.walls ?? [],
    portals: overrides.portals ?? [],
    lights: overrides.lights ?? [],
    ambient: {
      color: '#ffffff',
      level: 1.0,
      baked: false,
      ...(overrides.ambient ?? {}),
    },
    ...overrides,
  };
}

/**
 * Fabrique d'une instance de jeton/pion (Token) avec valeurs par défaut (CdC §6).
 *
 * @param {Partial<Token>} [overrides]
 * @returns {Token}
 */
export function createToken(overrides = {}) {
  const kind = overrides.kind ?? 'pc';
  return {
    id: overrides.id ?? 'token-1',
    levelId: overrides.levelId ?? 'rdc',
    cell: overrides.cell ?? { a: 0, b: 0 },
    sizeCells: overrides.sizeCells ?? 1,
    kind,
    imageUrl: overrides.imageUrl ?? '',
    borderColor: overrides.borderColor ?? '#00ff00',
    label: overrides.label ?? 'Héro',
    hidden: overrides.hidden ?? false,
    visionBright: overrides.visionBright ?? 6,
    visionDim: overrides.visionDim ?? 12,
    emitsLight: overrides.emitsLight ?? null,
    speedCells: overrides.speedCells ?? 6,
    playerMovable: overrides.playerMovable ?? kind === 'pc',
    locked: overrides.locked ?? false,
    elevation: overrides.elevation ?? 0,
    markers: overrides.markers ?? [],
    ...overrides,
  };
}

/**
 * Indique si une URL d'asset peut être conservée dans une campagne partagée.
 *
 * Une chaîne vide représente volontairement un asset non renseigné. Dès qu'une
 * URL est présente, seules une URL HTTPS absolue ou une URL relative sont
 * acceptées. Les URL temporaires (`data:`, `blob:`), les URL réseau sans schéma
 * et les autres protocoles sont refusés.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isPersistableAssetUrl(value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('//') || value.includes('\\')) return false;

  if (/^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && Boolean(url.hostname);
    } catch {
      return false;
    }
  }

  // Toute chaîne ressemblant à un protocole est absolue et donc interdite
  // ici (http:, data:, blob:, javascript:, file:, etc.).
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return false;

  try {
    const base = new URL('https://rpg-map.invalid/');
    const resolved = new URL(value, base);
    return resolved.origin === base.origin;
  } catch {
    return false;
  }
}

/**
 * Refuse explicitement une URL d'asset non persistable.
 *
 * @param {unknown} value
 * @param {string} [fieldName]
 * @returns {asserts value is string}
 */
export function assertPersistableAssetUrl(value, fieldName = 'imageUrl') {
  if (!isPersistableAssetUrl(value)) {
    throw new Error(
      `${fieldName} doit être vide, une URL relative ou une URL HTTPS persistante (data: et blob: interdits)`
    );
  }
}

/**
 * Valide la structure et la conformité d'un document de campagne.
 * Retourne un tableau contenant la liste des erreurs explicites (tableau vide si valide).
 *
 * Validation exigée :
 * - schemaVersion === 2
 * - Coordonnées de pion entières
 * - levelId de pion connu dans la liste des niveaux
 * - sizeCells >= 1
 *
 * @param {any} campaign
 * @returns {string[]} Liste des messages d'erreur explicites
 */
export function validateCampaign(campaign) {
  /** @type {string[]} */
  const errors = [];

  if (!campaign || typeof campaign !== 'object') {
    return ['Document de campagne invalide : objet attendu'];
  }

  if (campaign.schemaVersion !== 2) {
    errors.push(`schemaVersion doit valoir 2 (reçu ${campaign.schemaVersion})`);
  }

  if (!Array.isArray(campaign.levels)) {
    errors.push('levels doit être un tableau');
  }

  /** @type {Map<string, any>} */
  const levelsById = new Map();
  if (Array.isArray(campaign.levels)) {
    for (const level of campaign.levels) {
      if (!level || typeof level !== 'object') {
        errors.push('Objet étage invalide dans levels');
        continue;
      }
      const levelId = typeof level.id === 'string' ? level.id : '';
      if (!levelId) {
        errors.push('Étage sans identifiant valide');
      } else if (levelsById.has(levelId)) {
        errors.push(`Identifiant d'étage dupliqué "${levelId}"`);
      } else {
        levelsById.set(levelId, level);
      }
      if (!isPersistableAssetUrl(level.imageUrl)) {
        errors.push(
          `Étage "${levelId || 'inconnu'}" : imageUrl non persistable (URL relative ou HTTPS attendue ; data: et blob: interdits)`
        );
      }
      if (level.videoUrl !== null && !isPersistableAssetUrl(level.videoUrl)) {
        errors.push(
          `Étage "${levelId || 'inconnu'}" : videoUrl non persistable (URL relative ou HTTPS attendue)`
        );
      }
      if (!Number.isFinite(level.pxPerCell) || level.pxPerCell <= 0) {
        errors.push(`Étage "${levelId || 'inconnu'}" : pxPerCell doit être > 0`);
      }
      if (!Number.isInteger(level.widthCells) || level.widthCells < 1) {
        errors.push(`Étage "${levelId || 'inconnu'}" : widthCells doit être un entier >= 1`);
      }
      if (!Number.isInteger(level.heightCells) || level.heightCells < 1) {
        errors.push(`Étage "${levelId || 'inconnu'}" : heightCells doit être un entier >= 1`);
      }
      if (typeof level.name !== 'string' || !Number.isFinite(level.order)) {
        errors.push(`Étage "${levelId || 'inconnu'}" : name et order invalides`);
      }
      if (
        !level.grid ||
        typeof level.grid !== 'object' ||
        (level.grid.type !== 'square' && level.grid.type !== 'hex') ||
        !Number.isFinite(level.grid.offsetX) ||
        !Number.isFinite(level.grid.offsetY)
      ) {
        errors.push(`Étage "${levelId || 'inconnu'}" : configuration de grille invalide`);
      }
      if (
        !Array.isArray(level.walls) ||
        !Array.isArray(level.portals) ||
        !Array.isArray(level.lights) ||
        !level.ambient ||
        typeof level.ambient !== 'object'
      ) {
        errors.push(`Étage "${levelId || 'inconnu'}" : structure d'étage incomplète`);
      }
      if (!Array.isArray(level.animatedOverlays)) {
        errors.push(`Étage "${levelId || 'inconnu'}" : animatedOverlays doit être un tableau`);
      } else {
        level.animatedOverlays.forEach((/** @type {any} */ overlay, /** @type {number} */ index) => {
          if (!overlay || !isPersistableAssetUrl(overlay.url) || overlay.url === '') {
            errors.push(
              `Étage "${levelId || 'inconnu'}" : animatedOverlays[${index}].url non persistable`
            );
          }
        });
      }
    }
  }

  if (!Array.isArray(campaign.tokens)) {
    errors.push('tokens doit être un tableau');
  } else {
    const knownTokenIds = new Set();
    for (const token of campaign.tokens) {
      if (!token || typeof token !== 'object') {
        errors.push('Objet token invalide dans tokens');
        continue;
      }

      const tokenId = token.id || token.label || 'inconnu';

      if (typeof token.id !== 'string' || token.id.length === 0) {
        errors.push('Pion sans identifiant valide');
      } else if (knownTokenIds.has(token.id)) {
        errors.push(`Identifiant de pion dupliqué "${token.id}"`);
      } else {
        knownTokenIds.add(token.id);
      }

      // 1. Validation du levelId
      if (!token.levelId || !levelsById.has(token.levelId)) {
        errors.push(`Pion "${tokenId}" : levelId inconnu "${token.levelId}"`);
      }

      // 2. Validation des coordonnées (Cell {a, b} entières)
      const cell = token.cell;
      if (!cell || typeof cell !== 'object' || !Number.isInteger(cell.a) || !Number.isInteger(cell.b)) {
        const aVal = cell?.a;
        const bVal = cell?.b;
        errors.push(`Pion "${tokenId}" : coordonnées de pion non entières (a=${aVal}, b=${bVal})`);
      }

      // 3. Validation de sizeCells < 1
      if (!Number.isInteger(token.sizeCells) || token.sizeCells < 1) {
        errors.push(`Pion "${tokenId}" : sizeCells doit être >= 1 (reçu ${token.sizeCells})`);
      }

      if (!isPersistableAssetUrl(token.imageUrl)) {
        errors.push(
          `Pion "${tokenId}" : imageUrl non persistable (URL relative ou HTTPS attendue ; data: et blob: interdits)`
        );
      }

      if (token.kind !== 'pc' && token.kind !== 'npc') {
        errors.push(`Pion "${tokenId}" : kind doit valoir "pc" ou "npc"`);
      }
      if (
        typeof token.borderColor !== 'string' ||
        typeof token.label !== 'string' ||
        typeof token.hidden !== 'boolean' ||
        !Number.isFinite(token.visionBright) ||
        !Number.isFinite(token.visionDim) ||
        !Number.isFinite(token.speedCells) ||
        typeof token.playerMovable !== 'boolean' ||
        typeof token.locked !== 'boolean' ||
        !Number.isFinite(token.elevation) ||
        !Array.isArray(token.markers)
      ) {
        errors.push(`Pion "${tokenId}" : objet non conforme au schéma Token`);
      }

      const level = levelsById.get(token.levelId);
      if (
        level &&
        cell &&
        Number.isInteger(cell.a) &&
        Number.isInteger(cell.b) &&
        Number.isInteger(token.sizeCells) &&
        token.sizeCells >= 1 &&
        (cell.a < 0 ||
          cell.b < 0 ||
          cell.a + token.sizeCells > level.widthCells ||
          cell.b + token.sizeCells > level.heightCells)
      ) {
        errors.push(
          `Pion "${tokenId}" : position hors limites de l'étage "${token.levelId}"`
        );
      }
    }
  }

  return errors;
}

/**
 * Convertit un Record<cellKey, number> du document de campagne en Map<string, number> pour l'exécution.
 * @param {Record<string, number>|null|undefined} record
 * @returns {Map<string, number>}
 */
export function terrainCostRecordToMap(record) {
  const map = new Map();
  if (!record) return map;
  for (const [key, cost] of Object.entries(record)) {
    map.set(key, cost);
  }
  return map;
}

/**
 * Convertit un Map<string, number> de l'exécution en Record<cellKey, number> pour la persistance.
 * @param {Map<string, number>|null|undefined} map
 * @returns {Record<string, number>|null}
 */
export function terrainCostMapToRecord(map) {
  if (!map || map.size === 0) return null;
  /** @type {Record<string, number>} */
  const record = {};
  for (const [key, cost] of map.entries()) {
    record[key] = cost;
  }
  return record;
}
