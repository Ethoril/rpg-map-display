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
 * @param {number} zoom Zoom courant de la vue
 * @param {number} cellScale Taille d'une case en pixels carte — `grid.cellPitch().x`, la même
 *   que celle du rendu. ⛔ Obligatoire (audit du 22/09, D3) : le repli lisait `level['px' +
 *   'PerCell']`, un nom calculé qui contournait le test d'architecture.
 * @param {boolean} [isPlayerView=false] true si vue joueurs (seuls les gabarits visibleToPlayers sont réactifs)
 * @returns {{ template: Template, mode: 'move'|'rotate' } | null}
 */
export function findHitTemplate(level, templates, mapPos, zoom, cellScale, isPlayerView = false) {
  if (!level || !Array.isArray(templates) || templates.length === 0 || !mapPos) {
    return null;
  }
  if (!(cellScale > 0)) {
    throw new Error(`findHitTemplate : taille de case invalide (${cellScale}) — passer grid.cellPitch().x`);
  }
  const cellPx = cellScale;
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

/**
 * État d'un glisser de gabarit, posé au `start` : tout ce qu'il faut pour calculer la pose à
 * n'importe quel instant sans relire le store.
 *
 * @typedef {Object} TemplateDragState
 * @property {string} templateId
 * @property {'move'|'rotate'} dragMode
 * @property {MapPoint} startMapPos Position du doigt au `start`
 * @property {MapPoint} initialOrigin Origine du gabarit au `start`
 * @property {number} initialDirectionDeg Direction du gabarit au `start`
 */

/**
 * Pose d'un gabarit en cours de glisser : origine et direction, pour une position du doigt.
 *
 * ⛔ Audit du 22/09, B4 : le glisser mutait le store à chaque `pointermove` — clone,
 * validation, sauvegarde locale, reconstruction du panneau, instantané Firebase écrit avant le
 * `pointerup` — puis publiait l'avant-dernière position, lue dans le store AVANT la dernière
 * mutation. La pose est désormais un calcul pur : l'aperçu la dessine, et le `end` la commet et
 * la publie une seule fois, telle quelle, sur le MJ comme sur la tablette.
 *
 * @param {TemplateDragState} drag
 * @param {MapPoint} mapPos Position courante du doigt
 * @returns {{ origin: MapPoint, directionDeg: number }}
 */
export function templateDragPose(drag, mapPos) {
  if (drag.dragMode === 'rotate') {
    const angleRad = Math.atan2(mapPos.y - drag.initialOrigin.y, mapPos.x - drag.initialOrigin.x);
    return {
      origin: { x: drag.initialOrigin.x, y: drag.initialOrigin.y },
      directionDeg: Math.round(((angleRad * 180) / Math.PI + 360) % 360),
    };
  }
  return {
    origin: {
      x: drag.initialOrigin.x + (mapPos.x - drag.startMapPos.x),
      y: drag.initialOrigin.y + (mapPos.y - drag.startMapPos.y),
    },
    directionDeg: drag.initialDirectionDeg,
  };
}

/**
 * Liste de gabarits où l'un d'eux est remplacé par sa pose d'aperçu. La liste d'origine, venue
 * du store gelé, n'est pas touchée.
 *
 * @param {Template[]} templates
 * @param {{ templateId: string, origin: MapPoint, directionDeg: number }|null} preview
 * @returns {Template[]}
 */
export function withTemplatePreview(templates, preview) {
  if (!preview) return templates;
  return templates.map((t) =>
    t.id === preview.templateId ? { ...t, origin: preview.origin, directionDeg: preview.directionDeg } : t
  );
}
