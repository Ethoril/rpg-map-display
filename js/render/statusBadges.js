// @ts-check

import {
  STATUS_MARKER_IDS,
  STATUS_MARKER_CATEGORY,
  STATUS_MARKER_CATEGORY_COLORS,
  BADGE_DIAMETER_RATIO,
  BADGE_DOT_DIAMETER_RATIO,
  BADGE_ICON_MIN_PX,
  BADGE_DOT_MIN_TOKEN_PX,
  BADGE_DOT_MIN_PX,
  BADGE_ROW_SLOTS,
  BADGE_RASTER_STEP_PX,
  STATUS_ICON_CACHE_LIMIT,
  HEALTH_STATE_COLOR,
  TOKEN_HP_PJ_RING_COLOR,
  TOKEN_HP_RING_THICKNESS_PX,
  TOKEN_HP_BADGE_FONT_SIZE_PX,
  TOKEN_HP_BADGE_PADDING_X_PX,
  TOKEN_HP_BADGE_HEIGHT_PX,
} from '../core/constants.js';

/**
 * @typedef {import('../core/constants.js').StatusMarker} StatusMarker
 * @typedef {import('../core/types.js').Token} Token
 * @typedef {import('../core/types.js').MapPoint} MapPoint
 * @typedef {'damage'|'control'|'senses'|'mind'} StatusCategory
 * @typedef {'icons'|'category-dots'|'single-dot'} BadgeTier
 */

/** @type {Set<string>} Set d'identifiants d'icônes ayant déjà émis une erreur de chargement pour journaliser une seule fois. */
const loggedErrors = new Set();

/**
 * Ordre canonique des catégories d'état.
 * @type {StatusCategory[]}
 */
const CATEGORY_ORDER = ['damage', 'control', 'senses', 'mind'];

/**
 * Map de rang canonique des identifiants de marqueurs (index dans STATUS_MARKER_IDS).
 * @type {Map<string, number>}
 */
const MARKER_RANK_MAP = new Map(STATUS_MARKER_IDS.map((id, index) => [id, index]));

/**
 * Calcule le palier d'affichage des marqueurs selon le diamètre écran du pion D (en px).
 *
 * @param {number} tokenDiameterPx Diamètre du pion à l'écran (D = diametreCarte * zoom)
 * @returns {BadgeTier}
 */
export function getBadgeTier(tokenDiameterPx) {
  if (tokenDiameterPx * BADGE_DIAMETER_RATIO >= BADGE_ICON_MIN_PX) {
    return 'icons';
  }
  if (tokenDiameterPx >= BADGE_DOT_MIN_TOKEN_PX) {
    return 'category-dots';
  }
  return 'single-dot';
}

/**
 * Trie les marqueurs selon l'ordre canonique et applique la règle des 3 emplacements (BADGE_ROW_SLOTS = 3).
 *
 * - 1 à 3 marqueurs : 1 à 3 icônes, overflowCount = 0.
 * - 4+ marqueurs : 2 icônes + un compte '+N' (overflowCount = total - 2).
 *
 * @param {StatusMarker[]} markers
 * @returns {{ visibleMarkers: StatusMarker[], overflowCount: number }}
 */
export function filterAndSortMarkers(markers) {
  if (!Array.isArray(markers) || markers.length === 0) {
    return { visibleMarkers: [], overflowCount: 0 };
  }

  // Tri selon l'ordre canonique
  const sorted = [...markers].sort((a, b) => {
    const rankA = MARKER_RANK_MAP.get(a) ?? 999;
    const rankB = MARKER_RANK_MAP.get(b) ?? 999;
    return rankA - rankB;
  });

  if (sorted.length <= BADGE_ROW_SLOTS) {
    return { visibleMarkers: sorted, overflowCount: 0 };
  }

  // Plus de BADGE_ROW_SLOTS marqueurs : les 2 premiers emplacements sont des icônes, le 3ème est +N
  const visibleCount = BADGE_ROW_SLOTS - 1;
  return {
    visibleMarkers: sorted.slice(0, visibleCount),
    overflowCount: sorted.length - visibleCount,
  };
}

/**
 * Extrait les catégories uniques présentes parmi les marqueurs, dans l'ordre canonique.
 *
 * @param {StatusMarker[]} markers
 * @returns {StatusCategory[]}
 */
export function getCategoryDots(markers) {
  if (!Array.isArray(markers) || markers.length === 0) {
    return [];
  }

  const presentCategories = new Set(
    markers.map((id) => STATUS_MARKER_CATEGORY[id]).filter(Boolean)
  );

  return CATEGORY_ORDER.filter((cat) => presentCategories.has(cat));
}

/**
 * Calcule la disposition géographique de la rangée de badges au bas du pion en espace carte.
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte
 * @param {number} zoom Zoom actuel de la caméra
 * @param {number} count Nombre de badges à afficher dans la rangée
 * @param {number} [diameterRatio=BADGE_DIAMETER_RATIO] Ratio du diamètre d'un badge par rapport au pion
 * @returns {{ badgeRadiusMap: number, centers: { x: number, y: number }[] }}
 */
/**
 * Calcule la disposition (centres et rayon) d'une rangée de badges en espace carte.
 * Note : le paramètre zoom n'intervient pas ici car les badges sont strictement
 * proportionnels au pion (ratio constant du diamètre du pion sur la carte).
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte
 * @param {number} count Nombre de badges à afficher dans la rangée
 * @param {number} [diameterRatio=BADGE_DIAMETER_RATIO] Ratio du diamètre d'un badge par rapport au pion
 * @returns {{ badgeRadiusMap: number, centers: { x: number, y: number }[] }}
 */
export function computeBadgeRowLayout(tokenWidthMap, count, diameterRatio = BADGE_DIAMETER_RATIO) {
  if (count <= 0) {
    return { badgeRadiusMap: 0, centers: [] };
  }

  const badgeDiameterMap = tokenWidthMap * diameterRatio;
  const badgeRadiusMap = badgeDiameterMap / 2;
  const spacingMap = badgeDiameterMap * 1.1;
  const totalRowWidthMap = badgeDiameterMap + (count - 1) * spacingMap;

  const startX = (tokenWidthMap - totalRowWidthMap) / 2 + badgeRadiusMap;
  const y = tokenWidthMap - badgeRadiusMap;

  const centers = [];
  for (let i = 0; i < count; i++) {
    centers.push({
      x: startX + i * spacingMap,
      y,
    });
  }

  return { badgeRadiusMap, centers };
}

/**
 * Calcule la géométrie du badge d'élévation en espace carte pour maintenir sa taille constante à l'écran.
 * Formula: sizeMap = sizeScreen / zoom.
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte
 * @param {number} zoom Zoom de la caméra
 * @returns {{ badgeX: number, badgeY: number, badgeRadiusMap: number, badgeRadiusScreen: number, visible: boolean }}
 */
export function computeElevationBadgeLayout(tokenWidthMap, zoom) {
  const safeZoom = zoom > 0 ? zoom : 1;
  const tokenDiameterScreen = tokenWidthMap * safeZoom;
  const badgeRadiusScreen = Math.max(8, Math.min(14, tokenDiameterScreen * 0.12));
  const badgeRadiusMap = badgeRadiusScreen / safeZoom;

  const badgeX = tokenWidthMap - badgeRadiusMap;
  const badgeY = badgeRadiusMap;
  const visible = tokenDiameterScreen >= 40;

  return { badgeX, badgeY, badgeRadiusMap, badgeRadiusScreen, visible };
}

/**
 * Calcule la géométrie de l'anneau proportionnel d'un PJ (Chantier Q §5.2).
 * La longueur varie selon hp.current/hp.max, la couleur est fixe.
 *
 * ⚠ Ne s'applique qu'aux PJ. current === 0 produit un arc de longueur nulle (visible: false).
 * ⚠ Arcs partants de midi (-Math.PI / 2), sens horaire. Épaisseur constante à l'écran (divisée par zoom).
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte
 * @param {number} zoom Zoom de la caméra
 * @param {{ current: number, max: number }|null} hp
 * @returns {{ visible: boolean, radiusMap: number, startAngle: number, endAngle: number, color: string, lineWidthMap: number }}
 */
export function computeProportionalRing(tokenWidthMap, zoom, hp) {
  const safeZoom = zoom > 0 ? zoom : 1;
  if (!hp || typeof hp.current !== 'number' || typeof hp.max !== 'number' || hp.max < 1 || hp.current <= 0) {
    return { visible: false, radiusMap: 0, startAngle: 0, endAngle: 0, color: TOKEN_HP_PJ_RING_COLOR, lineWidthMap: 0 };
  }

  const ratio = Math.max(0, Math.min(1, hp.current / hp.max));
  if (ratio <= 0) {
    return { visible: false, radiusMap: 0, startAngle: 0, endAngle: 0, color: TOKEN_HP_PJ_RING_COLOR, lineWidthMap: 0 };
  }

  const radiusMap = tokenWidthMap / 2 + 1.5 / safeZoom;
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + ratio * Math.PI * 2;
  const lineWidthMap = TOKEN_HP_RING_THICKNESS_PX / safeZoom;

  return {
    visible: true,
    radiusMap,
    startAngle,
    endAngle,
    color: TOKEN_HP_PJ_RING_COLOR,
    lineWidthMap,
  };
}

/**
 * Calcule la géométrie de l'anneau d'état de santé d'un PNJ (Chantier Q §5.3).
 * Tour complet (360°), couleur et épaisseur variables selon health.
 *
 * ⚠ Ne s'applique qu'aux PNJ. 'unharmed' ne trace rien (visible: false).
 * ⚠ 'critical' double l'épaisseur écran (6px vs 3px).
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte
 * @param {number} zoom Zoom de la caméra
 * @param {'unharmed'|'wounded'|'critical'} health
 * @returns {{ visible: boolean, radiusMap: number, startAngle: number, endAngle: number, color: string, lineWidthMap: number }}
 */
export function computeStateRing(tokenWidthMap, zoom, health) {
  const safeZoom = zoom > 0 ? zoom : 1;
  if (!health || health === 'unharmed' || !HEALTH_STATE_COLOR[health]) {
    return { visible: false, radiusMap: 0, startAngle: 0, endAngle: 0, color: '', lineWidthMap: 0 };
  }

  const radiusMap = tokenWidthMap / 2 + 1.5 / safeZoom;
  const startAngle = 0;
  const endAngle = Math.PI * 2;
  const thicknessPx = health === 'critical' ? TOKEN_HP_RING_THICKNESS_PX * 2 : TOKEN_HP_RING_THICKNESS_PX;
  const lineWidthMap = thicknessPx / safeZoom;

  return {
    visible: true,
    radiusMap,
    startAngle,
    endAngle,
    color: HEALTH_STATE_COLOR[health],
    lineWidthMap,
  };
}

/**
 * Calcule la géométrie du compteur numérique (pastille courant/max) au coin haut-gauche (Chantier Q §5.5).
 * **Taille constante à l'écran, sans aucun seuil de disparition.**
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte
 * @param {number} zoom Zoom de la caméra
 * @param {number} current PV actuels
 * @param {number} max PV maximum
 * @returns {{ visible: boolean, badgeX: number, badgeY: number, fontSizeMap: number, heightMap: number, paddingXMap: number, text: string }}
 */
export function computeHpBadgeLayout(tokenWidthMap, zoom, current, max) {
  const safeZoom = zoom > 0 ? zoom : 1;
  const text = `${current}/${max}`;
  const fontSizeMap = TOKEN_HP_BADGE_FONT_SIZE_PX / safeZoom;
  const heightMap = TOKEN_HP_BADGE_HEIGHT_PX / safeZoom;
  const paddingXMap = TOKEN_HP_BADGE_PADDING_X_PX / safeZoom;

  // Ancrage au coin haut-gauche du pion : le coin bas-droit de la pastille touche (-padding, -padding).
  // La pastille croît ainsi vers le haut et la gauche (-X, -Y) pour ne pas recouvrir le portrait.
  const badgeX = -paddingXMap;
  const badgeY = -paddingXMap;

  return {
    visible: true,
    badgeX,
    badgeY,
    fontSizeMap,
    heightMap,
    paddingXMap,
    text,
  };
}

/**
 * Cache LRU pour les icônes SVG préchargées et leurs rendus hors écran.
 * Conçu pour être importable sous Node sans toucher document/Image à la construction.
 */
export class StatusIconCache {
  /**
   * @param {number} [limit=STATUS_ICON_CACHE_LIMIT]
   */
  constructor(limit = STATUS_ICON_CACHE_LIMIT) {
    this.limit = limit;
    /** @type {Map<string, HTMLImageElement>} */
    this.imageElements = new Map();
    /** @type {Map<string, HTMLCanvasElement>} */
    this.rasterCache = new Map();
  }

  /**
   * Précharge l'image SVG d'une icône.
   * @param {string} id
   * @param {(() => void)} [invalidate] Rappel facultatif d'invalidation du rendu
   * @returns {HTMLImageElement|null}
   */
  getImage(id, invalidate) {
    if (typeof Image === 'undefined') return null;
    let img = this.imageElements.get(id);
    if (!img) {
      img = new Image();
      img.src = `assets/icons/status/${id}.svg?v=${Date.now()}`;
      img.onerror = () => {
        if (!loggedErrors.has(id)) {
          loggedErrors.add(id);
          console.error(`[statusBadges] Impossible de charger l'icône d'état "${id}" (assets/icons/status/${id}.svg)`);
        }
      };
      this.imageElements.set(id, img);
    }

    if (invalidate && !img.complete) {
      img.addEventListener('load', () => invalidate(), { once: true });
      img.addEventListener('error', () => invalidate(), { once: true });
    }

    return img;
  }

  /**
   * Obtient ou crée un canvas hors écran pour une icône à une taille physique donnée.
   *
   * @param {string} id
   * @param {number} rasterPx Taille physique en pixels (arrondie au pas de 2px)
   * @param {(() => void)} [invalidate] Rappel facultatif d'invalidation du rendu
   * @returns {HTMLCanvasElement|null}
   */
  getRasterCanvas(id, rasterPx, invalidate) {
    if (typeof document === 'undefined') return null;

    const key = `${id}:${rasterPx}`;
    if (this.rasterCache.has(key)) {
      const existing = /** @type {HTMLCanvasElement} */ (this.rasterCache.get(key));
      // Refresh LRU position
      this.rasterCache.delete(key);
      this.rasterCache.set(key, existing);
      return existing;
    }

    const img = this.getImage(id, invalidate);
    if (!img || !img.complete || img.naturalWidth === 0) {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = rasterPx;
    canvas.height = rasterPx;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, rasterPx, rasterPx);
    }

    // Gestion LRU
    this.rasterCache.set(key, canvas);
    while (this.rasterCache.size > this.limit) {
      const oldest = this.rasterCache.keys().next().value;
      if (oldest !== undefined) this.rasterCache.delete(oldest);
    }

    return canvas;
  }
}

/** @type {StatusIconCache|null} Instance partagée du cache d'icônes (instanciée paresseusement au rendu). */
let sharedCache = null;

/**
 * Obtient le cache partagé d'icônes.
 * @returns {StatusIconCache}
 */
export function getSharedStatusIconCache() {
  if (!sharedCache) {
    sharedCache = new StatusIconCache();
  }
  return sharedCache;
}

/**
 * Rendu des marqueurs d'état au bas du pion en espace carte.
 *
 * @param {CanvasRenderingContext2D} ctx Contexte canvas 2D
 * @param {Token} token Pion à restituer
 * @param {MapPoint} p0 Coin supérieur gauche du pion en espace carte
 * @param {Object} options Options de rendu nommées
 * @param {number} [options.widthMap=140] Largeur du pion en espace carte
 * @param {number} [options.zoom=1] Zoom de la caméra
 * @param {number} [options.resolution=1] Résolution d'affichage (devicePixelRatio cap)
 * @param {(() => void)} [options.invalidate] Rappel facultatif d'invalidation du rendu
 * @param {StatusIconCache} [options.iconCache] Cache d'icônes optionnel
 */
export function drawStatusBadges(ctx, token, p0, options = {}) {
  if (!ctx || !token || !token.markers || token.markers.length === 0) return;

  const { widthMap = 140, zoom = 1, resolution = 1, invalidate } = options;
  const safeZoom = zoom > 0 ? zoom : 1;
  const tokenDiameterPx = widthMap * safeZoom;
  const tier = getBadgeTier(tokenDiameterPx);
  const iconCache = options.iconCache ?? getSharedStatusIconCache();

  ctx.save();

  if (tier === 'icons') {
    const { visibleMarkers, overflowCount } = filterAndSortMarkers(token.markers);
    const totalCount = visibleMarkers.length + (overflowCount > 0 ? 1 : 0);
    const layout = computeBadgeRowLayout(widthMap, totalCount, BADGE_DIAMETER_RATIO);
    const badgeDiameterScreen = tokenDiameterPx * BADGE_DIAMETER_RATIO;
    const rawRasterPx = badgeDiameterScreen * resolution;
    const rasterPx = Math.max(12, Math.round(rawRasterPx / BADGE_RASTER_STEP_PX) * BADGE_RASTER_STEP_PX);

    for (let i = 0; i < visibleMarkers.length; i++) {
      const markerId = visibleMarkers[i];
      const center = layout.centers[i];
      const cx = p0.x + center.x;
      const cy = p0.y + center.y;
      const r = layout.badgeRadiusMap;

      // Disque de fond sombre du badge
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / safeZoom;
      ctx.stroke();

      // Dessin de l'icône SVG
      const rasterCanvas = iconCache.getRasterCanvas(markerId, rasterPx, invalidate);
      if (rasterCanvas) {
        ctx.drawImage(rasterCanvas, cx - r, cy - r, r * 2, r * 2);
      } else {
        // En cas d'échec de l'icône, fallback vers le point de catégorie
        const cat = STATUS_MARKER_CATEGORY[markerId] || 'control';
        const color = STATUS_MARKER_CATEGORY_COLORS[cat] || '#facc15';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    // Pastillon d'overflow '+N' sur le dernier emplacement
    if (overflowCount > 0) {
      const center = layout.centers[visibleMarkers.length];
      const cx = p0.x + center.x;
      const cy = p0.y + center.y;
      const r = layout.badgeRadiusMap;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / safeZoom;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(9, Math.round(r * 1.1 * safeZoom)) / safeZoom}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${overflowCount}`, cx, cy);
    }
  } else if (tier === 'category-dots') {
    const categories = getCategoryDots(token.markers);
    const layout = computeBadgeRowLayout(widthMap, categories.length, BADGE_DOT_DIAMETER_RATIO);

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const center = layout.centers[i];
      const cx = p0.x + center.x;
      const cy = p0.y + center.y;
      const r = layout.badgeRadiusMap;
      const color = STATUS_MARKER_CATEGORY_COLORS[cat] || '#facc15';

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1 / safeZoom;
      ctx.stroke();
    }
  } else {
    // Palier 'single-dot'
    const dotDiameterScreen = Math.max(BADGE_DOT_MIN_PX, tokenDiameterPx * BADGE_DOT_DIAMETER_RATIO);
    const dotRadiusMap = (dotDiameterScreen / 2) / safeZoom;
    const cx = p0.x + widthMap / 2;
    const cy = p0.y + widthMap - dotRadiusMap;

    ctx.beginPath();
    ctx.arc(cx, cy, dotRadiusMap, 0, Math.PI * 2);
    ctx.fillStyle = '#94a3b8'; // Point neutre
    ctx.fill();
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1 / safeZoom;
    ctx.stroke();
  }

  ctx.restore();
}
