// @ts-check

import {
  CONE_ANGLE_DEG,
  TEMPLATE_VERTEX_HANDLE_PX,
  TEMPLATE_VERTEX_HANDLE_MAX_RATIO,
} from '../core/constants.js';

/**
 * @typedef {import('../core/types.js').Template} Template
 * @typedef {import('../core/types.js').MapPoint} MapPoint
 * @typedef {import('../core/types.js').Level} Level
 */

/**
 * Calcule le rayon en pixels carte de la poignée de pointe / centre.
 * Poignée en pixels écran bornée par un ratio maximal du rayon du gabarit à l'écran.
 *
 * @param {number} radiusPx Rayon du gabarit en pixels carte
 * @param {number} zoom Zoom courant de la caméra
 * @returns {number} Rayon de la poignée en pixels carte
 */
export function getTemplateHandleRadiusMap(radiusPx, zoom) {
  const effectiveZoom = Math.max(zoom, 1e-4);
  const radiusPxScreen = radiusPx * effectiveZoom;
  const maxHandleRadiusScreen = radiusPxScreen * TEMPLATE_VERTEX_HANDLE_MAX_RATIO;
  const defaultHandleRadiusScreen = TEMPLATE_VERTEX_HANDLE_PX / 2;
  const handleRadiusScreen = Math.min(defaultHandleRadiusScreen, maxHandleRadiusScreen);
  return handleRadiusScreen / effectiveZoom;
}

/**
 * Normalise un angle en degrés dans [-180, 180].
 *
 * @param {number} deg
 * @returns {number}
 */
export function normalizeAngleDeg(deg) {
  let a = (deg + 180) % 360;
  if (a < 0) a += 360;
  return a - 180;
}

/**
 * Indique si un point carte `mapPos` tombe dans le secteur du cône.
 *
 * @param {MapPoint} origin Pointe du cône
 * @param {number} directionDeg Angle central du cône (0 = Est, sens horaire)
 * @param {number} radiusPx Rayon en pixels carte
 * @param {MapPoint} mapPos Position testée
 * @returns {boolean}
 */
export function isPointInCone(origin, directionDeg, radiusPx, mapPos) {
  const dx = mapPos.x - origin.x;
  const dy = mapPos.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radiusPx) return false;

  const angleRad = Math.atan2(dy, dx);
  const angleDeg = (angleRad * 180) / Math.PI;
  const diff = normalizeAngleDeg(angleDeg - directionDeg);
  return Math.abs(diff) <= CONE_ANGLE_DEG / 2;
}

/**
 * Indique si un point carte tombe dans le rectangle d'une ligne.
 *
 * Le test se fait dans le repère de l'axe : projection le long de la direction pour la
 * longueur, projection sur la normale pour la largeur. ⛔ Ne pas le refaire par une
 * comparaison de coordonnées carte — il faudrait ressortir la rotation, et c'est exactement
 * l'erreur de « grandeur dans le mauvais espace » que ce dépôt a déjà payée.
 *
 * @param {MapPoint} origin Départ de l'axe
 * @param {number} directionDeg Direction de l'axe (0 = Est, sens horaire)
 * @param {number} lengthPx Longueur en pixels carte
 * @param {number} widthPx Largeur totale en pixels carte, centrée sur l'axe
 * @param {MapPoint} mapPos Position testée
 * @returns {boolean}
 */
export function isPointInLine(origin, directionDeg, lengthPx, widthPx, mapPos) {
  const dirRad = (directionDeg * Math.PI) / 180;
  const ux = Math.cos(dirRad);
  const uy = Math.sin(dirRad);
  const dx = mapPos.x - origin.x;
  const dy = mapPos.y - origin.y;
  const along = dx * ux + dy * uy;
  if (along < 0 || along > lengthPx) return false;
  const across = dx * -uy + dy * ux;
  return Math.abs(across) <= widthPx / 2;
}

/**
 * Recherche le gabarit sous le curseur/doigt.
 *
 * @param {Level} level Étage courant
 * @param {Template[]} templates Liste des gabarits
 * @param {MapPoint} mapPos Position du tap/curseur en pixels carte
 * @param {number} [zoom=1] Zoom courant de la vue
 * @param {number} [cellScale] Taille d'une case en pixels carte (optionnelle)
 * @param {boolean} [isPlayerView=false] true si vue joueurs (seuls les gabarits visibleToPlayers sont réactifs)
 * @returns {{ template: Template, mode: 'move'|'rotate' } | null}
 */
export function findHitTemplate(level, templates, mapPos, zoom = 1, cellScale = 0, isPlayerView = false) {
  if (!level || !Array.isArray(templates) || templates.length === 0 || !mapPos) {
    return null;
  }

  const levelObj = /** @type {any} */ (level);
  const key = 'px' + 'PerCell';
  const cellPx = cellScale || levelObj[key] || 140;
  const levelTemplates = templates.filter((t) => t && t.levelId === level.id);
  const candidates = isPlayerView
    ? levelTemplates.filter((t) => t.visibleToPlayers === true)
    : levelTemplates;

  if (candidates.length === 0) return null;

  // Parcourir du plus récent au plus ancien (dernier affiché au-dessus)
  for (let i = candidates.length - 1; i >= 0; i--) {
    const t = candidates[i];
    if (!t.origin || typeof t.origin.x !== 'number' || typeof t.origin.y !== 'number') {
      continue;
    }

    const radiusPx = (t.radiusCells || 1) * cellPx;
    const handleRadiusMap = getTemplateHandleRadiusMap(radiusPx, zoom);
    const distToOrigin = Math.hypot(mapPos.x - t.origin.x, mapPos.y - t.origin.y);

    if (t.shape === 'circle') {
      if (distToOrigin <= radiusPx) {
        return { template: t, mode: 'move' };
      }
    } else if (t.shape === 'cone') {
      // Pointe / sommet
      if (distToOrigin <= handleRadiusMap) {
        return { template: t, mode: 'move' };
      }
      // Corps du cône
      if (isPointInCone(t.origin, t.directionDeg || 0, radiusPx, mapPos)) {
        return { template: t, mode: 'rotate' };
      }
    } else if (t.shape === 'line') {
      // Même partage que le cône, et pour la même raison : la poignée d'origine déplace, le
      // corps pivote. Un seul geste par zone, sinon on ne sait pas ce que le doigt va faire.
      if (distToOrigin <= handleRadiusMap) {
        return { template: t, mode: 'move' };
      }
      const widthPx = Math.max(1, t.widthCells ?? 1) * cellPx;
      if (isPointInLine(t.origin, t.directionDeg || 0, radiusPx, widthPx, mapPos)) {
        return { template: t, mode: 'rotate' };
      }
    }
  }

  return null;
}
