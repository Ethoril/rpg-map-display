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
  return {
    id: overrides.id ?? 'token-1',
    levelId: overrides.levelId ?? 'rdc',
    cell: overrides.cell ?? { a: 0, b: 0 },
    sizeCells: overrides.sizeCells ?? 1,
    kind: overrides.kind ?? 'pc',
    imageUrl: overrides.imageUrl ?? '',
    borderColor: overrides.borderColor ?? '#00ff00',
    label: overrides.label ?? 'Héro',
    hidden: overrides.hidden ?? false,
    visionBright: overrides.visionBright ?? 6,
    visionDim: overrides.visionDim ?? 12,
    emitsLight: overrides.emitsLight ?? null,
    speedCells: overrides.speedCells ?? 6,
    playerMovable: overrides.playerMovable ?? true,
    locked: overrides.locked ?? false,
    elevation: overrides.elevation ?? 0,
    markers: overrides.markers ?? [],
    ...overrides,
  };
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

  const knownLevelIds = new Set(
    Array.isArray(campaign.levels)
      ? campaign.levels.map((/** @type {any} */ l) => l?.id).filter(Boolean)
      : []
  );

  if (Array.isArray(campaign.tokens)) {
    for (const token of campaign.tokens) {
      if (!token || typeof token !== 'object') {
        errors.push('Objet token invalide dans tokens');
        continue;
      }

      const tokenId = token.id || token.label || 'inconnu';

      // 1. Validation du levelId
      if (!token.levelId || !knownLevelIds.has(token.levelId)) {
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
      if (typeof token.sizeCells !== 'number' || token.sizeCells < 1) {
        errors.push(`Pion "${tokenId}" : sizeCells doit être >= 1 (reçu ${token.sizeCells})`);
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
