// @ts-check

import {
  CHASSE_BAND_SCREEN_PX,
  CHASSE_BG_COLOR,
  CHASSE_SEPARATOR_COLOR,
  CHASSE_SEPARATOR_SCREEN_PX,
  CHASSE_BEVEL_LIGHT_COLOR,
  CHASSE_BEVEL_DARK_COLOR,
  CHASSE_NOTCH_COLOR,
  CHASSE_NOTCH_SCREEN_PX,
  CHASSE_TIER_FULL_SCREEN_PX,
  CHASSE_TIER_REDUCED_SCREEN_PX,
  TOKEN_HP_PJ_RING_COLOR,
  HEALTH_STATE_COLOR,
} from '../core/constants.js';

/**
 * @typedef {'full'|'reduced'|'none'} SocketTier
 * @typedef {{ current?: number, max?: number }|null} TokenHpInput
 * @typedef {'unharmed'|'wounded'|'critical'|string|null} TokenHealthInput
 *
 * @typedef {{
 *   tier: SocketTier,
 *   imageRadius: number,
 *   separator: { radius: number, thicknessMap: number, color: string } | null,
 *   band: { innerRadius: number, outerRadius: number, color: string } | null,
 *   hpArc: { radius: number, startAngle: number, endAngle: number, thicknessMap: number, color: string } | null,
 *   stateRing: { radius: number, startAngle: number, endAngle: number, thicknessMap: number, color: string } | null,
 *   stateMarks: { radius: number, angles: number[], lengthMap: number, thicknessMap: number, color: string } | null,
 *   bevel: { innerRadius: number, outerRadius: number, lightColor: string, darkColor: string } | null
 * }} SocketLayout
 */

/**
 * Calcule la géométrie et la disposition de la châsse d'un pion.
 *
 * Toutes les épaisseurs et tous les rayons du résultat sont exprimés en pixels carte,
 * déjà divisés par le zoom. Le dessin les consomme directement sans ré-appliquer de zoom.
 *
 * @param {number} tokenWidthMap Largeur du pion sur la carte (px carte)
 * @param {number} zoom Zoom actuel de la caméra
 * @param {{ kind?: string|null, hp?: TokenHpInput, health?: TokenHealthInput }} options
 * @returns {SocketLayout}
 */
export function computeSocketLayout(tokenWidthMap, zoom, options = {}) {
  const safeZoom = zoom > 0 ? zoom : 1;
  const outerRadius = tokenWidthMap / 2;
  const tokenDiameterPx = tokenWidthMap * safeZoom;

  /** @type {SocketTier} */
  let tier = 'none';
  if (tokenDiameterPx >= CHASSE_TIER_FULL_SCREEN_PX) {
    tier = 'full';
  } else if (tokenDiameterPx >= CHASSE_TIER_REDUCED_SCREEN_PX) {
    tier = 'reduced';
  }

  if (tier === 'none') {
    return {
      tier,
      imageRadius: outerRadius,
      separator: null,
      band: null,
      hpArc: null,
      stateRing: null,
      stateMarks: null,
      bevel: null,
    };
  }

  const bandThicknessMap = CHASSE_BAND_SCREEN_PX / safeZoom;
  const innerRadius = outerRadius - bandThicknessMap;
  const imageRadius = innerRadius;

  const separator = {
    radius: innerRadius,
    thicknessMap: CHASSE_SEPARATOR_SCREEN_PX / safeZoom,
    color: CHASSE_SEPARATOR_COLOR,
  };

  const band = {
    innerRadius,
    outerRadius,
    color: CHASSE_BG_COLOR,
  };

  // Arc de PV pour les PJ (kind === 'pc')
  /** @type {SocketLayout['hpArc']} */
  let hpArc = null;
  if (options.kind === 'pc' && options.hp && typeof options.hp.current === 'number' && typeof options.hp.max === 'number' && options.hp.max >= 1) {
    const ratio = Math.max(0, Math.min(1, options.hp.current / options.hp.max));
    if (ratio > 0) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + ratio * Math.PI * 2;
      hpArc = {
        radius: (innerRadius + outerRadius) / 2,
        startAngle,
        endAngle,
        thicknessMap: bandThicknessMap,
        color: TOKEN_HP_PJ_RING_COLOR,
      };
    }
  }

  // Anneau d'état pour les PNJ (kind === 'npc') : posé PAR-DESSUS la bande neutre (Arbitrage 6)
  /** @type {SocketLayout['stateRing']} */
  let stateRing = null;
  if (options.kind === 'npc' && options.health && (options.health === 'wounded' || options.health === 'critical')) {
    const color = HEALTH_STATE_COLOR[options.health];
    if (color) {
      stateRing = {
        radius: (innerRadius + outerRadius) / 2,
        startAngle: 0,
        endAngle: Math.PI * 2,
        thicknessMap: bandThicknessMap,
        color,
      };
    }
  }

  // Encoches/crans géométriques pour les PNJ (kind === 'npc') au palier 'full' uniquement (Arbitrage 3)
  /** @type {SocketLayout['stateMarks']} */
  let stateMarks = null;
  if (options.kind === 'npc' && tier === 'full') {
    const markCount = options.health === 'critical' ? 2 : options.health === 'wounded' ? 1 : 0;
    if (markCount > 0) {
      const angles = markCount === 1
        ? [-Math.PI / 2]
        : [-Math.PI / 2 - Math.PI / 4, -Math.PI / 2 + Math.PI / 4];
      stateMarks = {
        radius: (innerRadius + outerRadius) / 2,
        angles,
        lengthMap: bandThicknessMap,
        thicknessMap: CHASSE_NOTCH_SCREEN_PX / safeZoom,
        color: CHASSE_NOTCH_COLOR,
      };
    }
  }

  // Biseau plat au palier 'full' uniquement
  /** @type {SocketLayout['bevel']} */
  let bevel = null;
  if (tier === 'full') {
    bevel = {
      innerRadius,
      outerRadius,
      lightColor: CHASSE_BEVEL_LIGHT_COLOR,
      darkColor: CHASSE_BEVEL_DARK_COLOR,
    };
  }

  return {
    tier,
    imageRadius,
    separator,
    band,
    hpArc,
    stateRing,
    stateMarks,
    bevel,
  };
}
