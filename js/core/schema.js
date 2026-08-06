// @ts-check

/**
 * @typedef {import('./types.js').Campaign} Campaign
 * @typedef {import('./types.js').Level} Level
 * @typedef {import('./types.js').Token} Token
 */

import { STATUS_MARKER_IDS, HEALTH_STATE_IDS } from './constants.js';

/** @typedef {import('./constants.js').StatusMarker} StatusMarker */

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const STATUS_MARKER_SET = new Set(STATUS_MARKER_IDS);
const HEALTH_STATE_SET = new Set(HEALTH_STATE_IDS);

/**
 * Garde de type vérifiant si une valeur est un identifiant de marqueur d'état valide.
 * @type {(v: unknown) => v is StatusMarker}
 */
export function isStatusMarker(val) {
  return typeof val === 'string' && STATUS_MARKER_SET.has(/** @type {StatusMarker} */ (val));
}

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

  // 6. Template.color et normalisation L-10 (origin: Cell -> MapPoint au centre de case, directionDeg, suppression de cells)
  if (Array.isArray(campaign.templates)) {
    const levelsMap = new Map();
    if (Array.isArray(campaign.levels)) {
      for (const l of campaign.levels) {
        if (l && l.id) levelsMap.set(l.id, l);
      }
    }
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

      // Normalisation L-10 : origin {a, b} -> {x, y} au centre de la case sans aucun import de grid/*
      if (template.origin && typeof template.origin === 'object') {
        const orig = /** @type {any} */ (template.origin);
        if (typeof orig.x !== 'number' && typeof orig.a === 'number' && typeof orig.b === 'number') {
          const level = levelsMap.get(template.levelId);
          const pxPerCell = level && typeof level.pxPerCell === 'number' && level.pxPerCell > 0 ? level.pxPerCell : 140;
          template.origin = {
            x: (orig.a + 0.5) * pxPerCell,
            y: (orig.b + 0.5) * pxPerCell,
          };
        }
      }

      if (typeof template.directionDeg !== 'number' || !Number.isFinite(template.directionDeg)) {
        template.directionDeg = 0;
      }

      if ('cells' in template) {
        delete template.cells;
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
 * Normalise la structure d'un étage (portails en particulier).
 * Mute l'étage en place et le retourne.
 *
 * @param {any} level
 * @returns {any}
 */
export function normalizeLevel(level) {
  if (!level || typeof level !== 'object') return level;

  if (Array.isArray(level.portals)) {
    const levelId = level.id || 'inconnu';
    for (const portal of level.portals) {
      if (!portal || typeof portal !== 'object') continue;
      if (
        portal.state === 'open' ||
        portal.state === 'closed' ||
        portal.state === 'locked'
      ) {
        continue;
      }

      if (portal.closed === true) {
        portal.state = 'closed';
      } else if (portal.closed === false) {
        portal.state = 'open';
      } else {
        portal.state = 'closed';
        console.warn(
          `[schema] Étage "${levelId}" portail "${portal.id || 'inconnu'}" : ` +
            `state invalide ou manquant (${portal.state}), 'closed' appliqué par défaut.`
        );
      }
    }
  }

  return level;
}

/**
 * Normalise un pion hérité (CdC §6 & Chantier Q §1.1 / §3).
 * S'assure que markers est un tableau, et que hp et health ont des valeurs par défaut.
 *
 * @param {any} token
 * @returns {any}
 */
export function normalizeToken(token) {
  if (!token || typeof token !== 'object') return token;
  if (!Array.isArray(token.markers)) {
    token.markers = [];
  }
  if (token.hp === undefined) {
    token.hp = null;
  }
  if (token.health === undefined) {
    token.health = 'unharmed';
  }
  return token;
}

/**
 * Normalise la campagne entière (couleurs, portails, pions).
 * Rend une copie normalisée du document.
 *
 * @param {any} campaign
 * @returns {any}
 */
export function normalizeCampaign(campaign) {
  if (!campaign || typeof campaign !== 'object') return campaign;

  const res = normalizeCampaignColors(campaign);
  if (Array.isArray(res.levels)) {
    for (const level of res.levels) {
      normalizeLevel(level);
    }
  }
  if (Array.isArray(res.tokens)) {
    for (const token of res.tokens) {
      normalizeToken(token);
    }
  }
  return res;
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
    hp: overrides.hp !== undefined ? overrides.hp : null,
    health: overrides.health ?? 'unharmed',
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

// ── Google Drive : le lien de partage n'est pas une image ────────────────────────────────
//
// Coller « https://drive.google.com/file/d/<ID>/view?usp=drive_link » dans un champ image
// donne une page HTML de 75 Ko, pas un fichier : la balise `<img>` affiche une icône cassée,
// et sur la vue joueurs cela se traduit par un cadre noir en pleine scène. C'est le lien que
// Drive propose par défaut au partage — l'erreur est donc la norme, pas l'exception, et la
// refuser sans la corriger reviendrait à refuser le geste naturel du MJ.
//
// Deux points d'accès servent réellement les octets d'un fichier « tous ceux qui ont le
// lien », mesurés sur un scan PNG le 30 juillet 2026 :
//   - `/uc?export=view&id=<ID>`     → l'original, redirigé vers drive.usercontent — 9,8 Mo
//   - `/thumbnail?id=<ID>&sz=w<N>`  → une version redimensionnée servie par le CDN — 4,0 Mo
//
// On retient le second : la liaison d'une tablette n'a rien à gagner à transporter un
// original que sa dalle ne peut pas afficher. Aucun des deux ne figure dans une API publiée ;
// si Google les change, c'est ici, et ici seulement, que ça se corrige.
const GOOGLE_DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
]);
// Volontairement sans l'alternative `/d/` seule : `lh3.googleusercontent.com/d/<ID>` est déjà
// une URL directe (elle n'est pas dans les hôtes ci-dessus), et l'ajouter ferait passer un
// lien de dossier `/drive/folders/<ID>` pour un fichier.
const GOOGLE_DRIVE_FILE_ID = /(?:\/file\/d\/|[?&](?:id|docid)=)([\w-]{10,})/;

/** Largeur demandée au CDN Drive. Au-delà, on transporte des pixels qu'aucune tablette n'affiche. */
export const GOOGLE_DRIVE_IMAGE_WIDTH = 2000;

/**
 * Convertit un lien de partage Google Drive en URL d'image directement affichable.
 *
 * Toute autre URL — relative au dépôt, HTTPS quelconque, `data:` — est rendue inchangée :
 * cette fonction corrige un piège nommé, elle ne réécrit pas les adresses en général.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeImageUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    // URL absolue mais illisible : ce n'est pas ici qu'on tranche. `isPersistableAssetUrl`
    // la refusera juste après, avec son message.
    return trimmed;
  }
  if (!GOOGLE_DRIVE_HOSTS.has(parsed.hostname)) return trimmed;

  const found = GOOGLE_DRIVE_FILE_ID.exec(`${parsed.pathname}${parsed.search}`);
  if (!found) return trimmed;
  return `https://drive.google.com/thumbnail?id=${found[1]}&sz=w${GOOGLE_DRIVE_IMAGE_WIDTH}`;
}

/**
 * Indique qu'une URL pointe vers Google Drive **sans** désigner un fichier identifiable —
 * un dossier partagé, typiquement. Aucune conversion n'est alors possible, et il vaut mieux
 * le dire au MJ que révéler un cadre vide aux joueurs.
 *
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isUnusableGoogleDriveUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (!GOOGLE_DRIVE_HOSTS.has(parsed.hostname)) return false;
    return !GOOGLE_DRIVE_FILE_ID.test(`${parsed.pathname}${parsed.search}`);
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
        // Validation des polylignes de murs
        for (let wIdx = 0; wIdx < level.walls.length; wIdx++) {
          const wall = level.walls[wIdx];
          if (!Array.isArray(wall) || wall.length < 2) {
            errors.push(`Étage "${levelId || 'inconnu'}" : mur à l'index ${wIdx} doit être une polyligne d'au moins 2 sommets`);
          } else {
            for (let pIdx = 0; pIdx < wall.length; pIdx++) {
              const pt = wall[pIdx];
              if (
                !pt ||
                typeof pt !== 'object' ||
                typeof pt.cellX !== 'number' ||
                !Number.isFinite(pt.cellX) ||
                typeof pt.cellY !== 'number' ||
                !Number.isFinite(pt.cellY)
              ) {
                errors.push(`Étage "${levelId || 'inconnu'}" : mur à l'index ${wIdx} a un sommet invalide à l'index ${pIdx}`);
              }
            }
          }
        }

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
        // Validation des portails de l'étage
        for (const portal of level.portals) {
          const portalId = portal?.id || 'inconnu';
          if (
            !portal ||
            typeof portal !== 'object' ||
            typeof portal.id !== 'string' ||
            portal.id.trim() === '' ||
            !portal.a ||
            !Number.isFinite(portal.a.cellX) ||
            !Number.isFinite(portal.a.cellY) ||
            !portal.b ||
            !Number.isFinite(portal.b.cellX) ||
            !Number.isFinite(portal.b.cellY) ||
            (portal.state !== 'open' && portal.state !== 'closed' && portal.state !== 'locked') ||
            typeof portal.freestanding !== 'boolean'
          ) {
            errors.push(`Étage "${levelId || 'inconnu'}" : portail "${portalId}" invalide`);
          }
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
      } else {
        const seenMarkers = new Set();
        for (const marker of token.markers) {
          if (!isStatusMarker(marker)) {
            errors.push(`Pion "${tokenId}" : marqueur d'état inconnu "${marker}"`);
          } else if (seenMarkers.has(marker)) {
            errors.push(`Pion "${tokenId}" : marqueur d'état en doublon "${marker}"`);
          } else {
            seenMarkers.add(marker);
          }
        }
      }

      if (token.hp !== null && token.hp !== undefined) {
        if (
          typeof token.hp !== 'object' ||
          !Number.isInteger(token.hp.current) ||
          !Number.isInteger(token.hp.max) ||
          token.hp.max < 1 ||
          token.hp.current < 0 ||
          token.hp.current > token.hp.max
        ) {
          errors.push(`Pion "${tokenId}" : hp doit être null ou un objet { current, max } avec max >= 1 et 0 <= current <= max`);
        }
      }

      if (token.health !== undefined && !HEALTH_STATE_SET.has(token.health)) {
        errors.push(`Pion "${tokenId}" : health invalide "${token.health}"`);
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
      if (!template || typeof template !== 'object') {
        errors.push('Gabarit invalide');
        continue;
      }
      const tId = template.id || 'inconnu';
      if (typeof template.id !== 'string' || template.id.trim() === '') {
        errors.push(`Gabarit "${tId}" : id invalide`);
      }
      if (typeof template.levelId !== 'string' || !levelsById.has(template.levelId)) {
        errors.push(`Gabarit "${tId}" : levelId invalide "${template.levelId}"`);
      }
      if (template.shape !== 'circle' && template.shape !== 'cone' && template.shape !== 'line') {
        errors.push(`Gabarit "${tId}" : shape invalide "${template.shape}"`);
      }
      if (
        !template.origin ||
        typeof template.origin !== 'object' ||
        typeof template.origin.x !== 'number' ||
        !Number.isFinite(template.origin.x) ||
        typeof template.origin.y !== 'number' ||
        !Number.isFinite(template.origin.y)
      ) {
        errors.push(`Gabarit "${tId}" : origin invalide (MapPoint {x, y} attendu)`);
      }
      if (typeof template.directionDeg !== 'number' || !Number.isFinite(template.directionDeg)) {
        errors.push(`Gabarit "${tId}" : directionDeg invalide`);
      }
      if (
        typeof template.radiusCells !== 'number' ||
        !Number.isFinite(template.radiusCells) ||
        template.radiusCells <= 0
      ) {
        errors.push(`Gabarit "${tId}" : radiusCells invalide "${template.radiusCells}"`);
      }
      if (typeof template.visibleToPlayers !== 'boolean') {
        errors.push(`Gabarit "${tId}" : visibleToPlayers invalide "${template.visibleToPlayers}"`);
      }
      if (!isValidHexColor(template.color)) {
        errors.push(`Gabarit "${tId}" : color invalide "${template.color}" (format #RRGGBB attendu)`);
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
