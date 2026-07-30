// @ts-check

/**
 * @typedef {import('./types.js').Campaign} Campaign
 * @typedef {import('./types.js').Level} Level
 * @typedef {import('./types.js').Token} Token
 */

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Valide si une valeur est une couleur CSS au format `#RRGGBB`.
 * @param {unknown} val
 * @returns {boolean}
 */
export function isValidHexColor(val) {
  return typeof val === 'string' && HEX_COLOR_REGEX.test(val);
}

/**
 * Normalise une chaîne de couleur héritée (ex. ARGB "ffffffff", "ffF7EAE4", "F7EAE4") vers "#RRGGBB".
 *
 * @param {unknown} rawColor
 * @returns {{ color: string, warning?: string, changed: boolean }}
 */
export function normalizeColor(rawColor) {
  if (typeof rawColor === 'string') {
    const trimmed = rawColor.trim();
    if (HEX_COLOR_REGEX.test(trimmed)) {
      return { color: trimmed, changed: false };
    }
    if (/^[0-9a-fA-F]{8}$/.test(trimmed)) {
      const alpha = trimmed.slice(0, 2);
      const rgb = trimmed.slice(2);
      const color = `#${rgb}`;
      let warning;
      if (alpha.toLowerCase() !== 'ff') {
        warning = `Conversion de la couleur ARGB "${trimmed}" en "${color}" (alpha "${alpha}" ignoré)`;
      } else {
        warning = `Normalisation de la couleur ARGB "${trimmed}" au format "#RRGGBB" ("${color}")`;
      }
      return { color, warning, changed: true };
    }
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
      const color = `#${trimmed}`;
      return {
        color,
        warning: `Normalisation de la couleur "${trimmed}" au format "#RRGGBB" ("${color}")`,
        changed: true,
      };
    }
  }

  const displayVal = typeof rawColor === 'string' ? `"${rawColor}"` : String(rawColor);
  return {
    color: '#ffffff',
    warning: `Couleur invalide ${displayVal}, normalisée vers "#ffffff"`,
    changed: true,
  };
}

/**
 * Normalise l'ensemble des couleurs d'un document de campagne sur les 8 chemins définis par le schéma.
 * Convertit les formats hérités (ARGB, hex sans #) vers "#RRGGBB" et signale les conversions via console.warn.
 *
 * **Fonction pure : l'entrée n'est jamais mutée.** Elle travaille sur une copie
 * et la retourne. Muter l'argument échouait sur un document gelé — et
 * `getCampaign()` en renvoie un — avec un `Cannot assign to read only property`
 * maquillé en « document invalide », soit précisément le diagnostic trompeur que
 * ce contrôle de couleurs est censé supprimer.
 *
 * @param {any} campaign
 * @returns {any} copie normalisée (ou l'entrée telle quelle si ce n'est pas un objet)
 */
export function normalizeCampaignColors(campaign) {
  if (!campaign || typeof campaign !== 'object') return campaign;

  campaign = structuredClone(campaign);

  if (Array.isArray(campaign.levels)) {
    for (const level of campaign.levels) {
      if (!level || typeof level !== 'object') continue;
      const levelId = level.id || 'inconnu';

      // 1. GridConfig.color
      if (level.grid && typeof level.grid.color === 'string' && !isValidHexColor(level.grid.color)) {
        const res = normalizeColor(level.grid.color);
        level.grid.color = res.color;
        if (res.warning) {
          console.warn(`[schema] Étage "${levelId}" grid.color : ${res.warning}`);
        }
      }

      // 2. Light.color
      if (Array.isArray(level.lights)) {
        for (const light of level.lights) {
          if (light && typeof light.color === 'string' && !isValidHexColor(light.color)) {
            const res = normalizeColor(light.color);
            light.color = res.color;
            if (res.warning) {
              console.warn(`[schema] Étage "${levelId}" lumière "${light.id || 'inconnue'}" color : ${res.warning}`);
            }
          }
        }
      }

      // 3. AmbientLight.color
      if (level.ambient && typeof level.ambient.color === 'string' && !isValidHexColor(level.ambient.color)) {
        const res = normalizeColor(level.ambient.color);
        level.ambient.color = res.color;
        if (res.warning) {
          console.warn(`[schema] Étage "${levelId}" ambient.color : ${res.warning}`);
        }
      }
    }
  }

  // 4. Token.borderColor et 5. Token.emitsLight.color
  if (Array.isArray(campaign.tokens)) {
    for (const token of campaign.tokens) {
      if (!token || typeof token !== 'object') continue;
      const tokenId = token.id || 'inconnu';

      if (typeof token.borderColor === 'string' && !isValidHexColor(token.borderColor)) {
        const res = normalizeColor(token.borderColor);
        token.borderColor = res.color;
        if (res.warning) {
          console.warn(`[schema] Pion "${tokenId}" borderColor : ${res.warning}`);
        }
      }

      if (token.emitsLight && typeof token.emitsLight.color === 'string' && !isValidHexColor(token.emitsLight.color)) {
        const res = normalizeColor(token.emitsLight.color);
        token.emitsLight.color = res.color;
        if (res.warning) {
          console.warn(`[schema] Pion "${tokenId}" emitsLight.color : ${res.warning}`);
        }
      }
    }
  }

  // 6. Template.color
  if (Array.isArray(campaign.templates)) {
    for (const template of campaign.templates) {
      if (!template || typeof template !== 'object') continue;
      const templateId = template.id || 'inconnu';
      if (typeof template.color === 'string' && !isValidHexColor(template.color)) {
        const res = normalizeColor(template.color);
        template.color = res.color;
        if (res.warning) {
          console.warn(`[schema] Gabarit "${templateId}" color : ${res.warning}`);
        }
      }
    }
  }

  // 7. TokenLibraryEntry.emitsLight.color et 8. TokenLibraryEntry.borderColor
  if (Array.isArray(campaign.tokenLibrary)) {
    for (const entry of campaign.tokenLibrary) {
      if (!entry || typeof entry !== 'object') continue;
      const entryId = entry.id || 'inconnu';

      if (typeof entry.borderColor === 'string' && !isValidHexColor(entry.borderColor)) {
        const res = normalizeColor(entry.borderColor);
        entry.borderColor = res.color;
        if (res.warning) {
          console.warn(`[schema] TokenLibrary "${entryId}" borderColor : ${res.warning}`);
        }
      }

      if (entry.emitsLight && typeof entry.emitsLight.color === 'string' && !isValidHexColor(entry.emitsLight.color)) {
        const res = normalizeColor(entry.emitsLight.color);
        entry.emitsLight.color = res.color;
        if (res.warning) {
          console.warn(`[schema] TokenLibrary "${entryId}" emitsLight.color : ${res.warning}`);
        }
      }
    }
  }

  return campaign;
}

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
 * Plafond en octets d'une image de pion embarquée sous forme d'URL `data:`.
 *
 * 24 KiB de chaîne base64 valent environ 18 Ko de WebP, largement au-delà de ce
 * qu'un pion de 200 à 420 px demande : `maps/tokens/goblin.webp` pèse 2982 octets.
 * Le générateur ré-encode jusqu'à tenir sous ce plafond (`ui/gm/tokenMaker.js`),
 * il ne refuse pas l'image du MJ.
 */
export const TOKEN_IMAGE_MAX_BYTES = 24 * 1024;

/**
 * Plafond cumulé des images de pions embarquées dans une même campagne.
 *
 * C'est le plafond qui protège la contrainte réelle : `saveSnapshot` écrit la
 * campagne entière dans **un seul** document Firestore (`transport/FirebaseTransport.js`),
 * limité à 1 MiB par Firestore. Un plafond par pion ne protège pas ce document —
 * vingt-quatre pions au maximum individuel le rempliraient à moitié sans qu'aucune
 * garde ne se déclenche, et le défaut n'apparaîtrait qu'en séance.
 */
export const TOKEN_IMAGE_TOTAL_MAX_BYTES = 512 * 1024;

const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Indique si une chaîne est une image embarquée autonome et bornée.
 *
 * Contrairement à `blob:`, une URL `data:` **survit** au rechargement et voyage
 * vers un autre navigateur : elle porte ses octets avec elle. Le risque n'est donc
 * pas sa nature transitoire, c'est sa taille — la cause historique de la perte de
 * campagne était un fond de carte de plusieurs mégaoctets encodé en `data:`, puis
 * supprimé en silence à la sauvegarde (`docs/ETAT.md`). Une image bornée n'a pas
 * ce défaut.
 *
 * Volontairement `boolean` et non un prédicat `value is string` : la garde du transport
 * l'applique par la négative sur une valeur déjà connue comme `string`, et un prédicat
 * y réduirait la variable à `never` dans la branche d'erreur.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isBoundedImageDataUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length > TOKEN_IMAGE_MAX_BYTES) return false;
  return IMAGE_DATA_URL.test(value);
}

/**
 * Indique si une valeur est acceptable comme image de pion.
 *
 * Un pion accepte, **en plus** d'une URL publiée, une image embarquée bornée : il
 * doit pouvoir naître en pleine séance sans passer par un dépôt de fichier et un
 * commit. Cette tolérance est délibérément limitée aux pions — un fond d'étage
 * reste soumis à `isPersistableAssetUrl`, parce que sa taille est sans commune
 * mesure (`maps/generated/manoir-rdc.webp` pèse 4,9 Mo).
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isTokenImageUrl(value) {
  return isPersistableAssetUrl(value) || isBoundedImageDataUrl(value);
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
      } else if (level.grid.color !== undefined && !isValidHexColor(level.grid.color)) {
        errors.push(`Étage "${levelId || 'inconnu'}" : couleur de grille invalide "${level.grid.color}" (format #RRGGBB attendu)`);
      }
      if (
        !Array.isArray(level.walls) ||
        !Array.isArray(level.portals) ||
        !Array.isArray(level.lights) ||
        !level.ambient ||
        typeof level.ambient !== 'object'
      ) {
        errors.push(`Étage "${levelId || 'inconnu'}" : structure d'étage incomplète`);
      } else {
        // Validation des couleurs de lumière
        for (const light of level.lights) {
          if (!light || !isValidHexColor(light.color)) {
            const lightColor = light?.color;
            errors.push(`Étage "${levelId || 'inconnu'}" : lumière "${light?.id || 'inconnue'}" a une couleur invalide "${lightColor}" (format #RRGGBB attendu)`);
          }
        }
        // Validation de la couleur d'ambiance
        if (!isValidHexColor(level.ambient.color)) {
          errors.push(`Étage "${levelId || 'inconnu'}" : éclairage ambiant a une couleur invalide "${level.ambient.color}" (format #RRGGBB attendu)`);
        }
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

      if (!isTokenImageUrl(token.imageUrl)) {
        const embarquee = typeof token.imageUrl === 'string' && token.imageUrl.startsWith('data:');
        errors.push(
          embarquee
            ? `Pion "${tokenId}" : image embarquée refusée (${token.imageUrl.length} octets ` +
              `pour un plafond de ${TOKEN_IMAGE_MAX_BYTES}, ou format hors png/jpeg/webp/gif)`
            : `Pion "${tokenId}" : imageUrl non persistable (URL relative, URL HTTPS ` +
              'ou image embarquée bornée attendue ; blob: interdit)'
        );
      }

      if (token.kind !== 'pc' && token.kind !== 'npc') {
        errors.push(`Pion "${tokenId}" : kind doit valoir "pc" ou "npc"`);
      }

      if (!isValidHexColor(token.borderColor)) {
        errors.push(`Pion "${tokenId}" : borderColor invalide "${token.borderColor}" (format #RRGGBB attendu)`);
      }

      if (token.emitsLight && !isValidHexColor(token.emitsLight.color)) {
        errors.push(`Pion "${tokenId}" : emitsLight.color invalide "${token.emitsLight.color}" (format #RRGGBB attendu)`);
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

    // Le plafond cumulé se vérifie sur la campagne, pas sur le pion : c'est le
    // document Firestore de 1 MiB qui est en jeu, et il n'a pas de propriétaire
    // parmi les pions.
    let octetsEmbarques = 0;
    let pionsEmbarques = 0;
    for (const token of campaign.tokens) {
      if (typeof token?.imageUrl === 'string' && token.imageUrl.startsWith('data:')) {
        octetsEmbarques += token.imageUrl.length;
        pionsEmbarques += 1;
      }
    }
    if (octetsEmbarques > TOKEN_IMAGE_TOTAL_MAX_BYTES) {
      errors.push(
        `Images de pions embarquées : ${octetsEmbarques} octets sur ${pionsEmbarques} pions, ` +
          `pour un plafond cumulé de ${TOKEN_IMAGE_TOTAL_MAX_BYTES}. Publier les images les plus ` +
          'lourdes sous maps/tokens/ et référencer leur URL.'
      );
    }
  }

  if (Array.isArray(campaign.templates)) {
    for (const template of campaign.templates) {
      if (template && !isValidHexColor(template.color)) {
        errors.push(`Gabarit "${template.id || 'inconnu'}" : color invalide "${template.color}" (format #RRGGBB attendu)`);
      }
    }
  }

  if (Array.isArray(campaign.tokenLibrary)) {
    for (const entry of campaign.tokenLibrary) {
      if (entry && !isValidHexColor(entry.borderColor)) {
        errors.push(`TokenLibrary "${entry.id || 'inconnu'}" : borderColor invalide "${entry.borderColor}" (format #RRGGBB attendu)`);
      }
      if (entry?.emitsLight && !isValidHexColor(entry.emitsLight.color)) {
        errors.push(`TokenLibrary "${entry.id || 'inconnu'}" : emitsLight.color invalide "${entry.emitsLight.color}" (format #RRGGBB attendu)`);
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
