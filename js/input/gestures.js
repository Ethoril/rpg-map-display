// @ts-check

/** @typedef {import('../core/types.js').ScreenPoint} ScreenPoint */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */

/**
 * Intention de tap unique. Le point d'entrée applicatif effectue ensuite le hit-test et
 * décide si la cible est un pion, une case ou le vide.
 *
 * @typedef {Object} TapIntention
 * @property {'tap'} type
 * @property {ScreenPoint} screenPos
 * @property {MapPoint} mapPos
 */

/**
 * @typedef {Object} PanIntention
 * @property {'panBy'} type
 * @property {number} deltaX Pixels écran (négatif = pan gauche)
 * @property {number} deltaY Pixels écran (négatif = pan haut)
 */

/**
 * @typedef {Object} DragTokenIntention
 * @property {'dragToken'} type
 * @property {ScreenPoint} screenPos Position courante sur l'écran
 * @property {MapPoint} mapPos Même position sur la carte
 * @property {string} tokenId Identifiant déterminé au pointerdown
 * @property {'start'|'move'|'end'} phase Phase du glisser
 */

/**
 * @typedef {Object} PinchZoomIntention
 * @property {'pinchZoom'} type
 * @property {number} scaleFactor Facteur d'échelle relatif (ex: 1.05)
 * @property {ScreenPoint} center Centre du pinch en pixels écran
 */

/**
 * @typedef {Object} LongPressIntention
 * @property {'longPress'} type
 * @property {ScreenPoint} screenPos Position écran
 * @property {MapPoint} mapPos Position carte
 */

/**
 * @typedef {TapIntention | PanIntention | DragTokenIntention | PinchZoomIntention | LongPressIntention} InputIntention
 */

/**
 * Calcule la distance en pixels entre deux points écran.
 *
 * @param {ScreenPoint} p1
 * @param {ScreenPoint} p2
 * @returns {number}
 */
export function distanceBetween(p1, p2) {
  return Math.hypot(p2.screenX - p1.screenX, p2.screenY - p1.screenY);
}

/**
 * Calcule le point central entre deux points écran.
 *
 * @param {ScreenPoint} p1
 * @param {ScreenPoint} p2
 * @returns {ScreenPoint}
 */
export function centerBetween(p1, p2) {
  return {
    screenX: (p1.screenX + p2.screenX) / 2,
    screenY: (p1.screenY + p2.screenY) / 2,
  };
}

/**
 * Détermine si un mouvement de pointeur dépasse le seuil pour être considéré comme un drag.
 *
 * @param {ScreenPoint} startPos
 * @param {ScreenPoint} currentPos
 * @param {number} startTime
 * @param {number} currentTime
 * @param {number} dragHoldMs
 * @param {number} distanceThreshold
 * @returns {boolean}
 */
export function isDragThresholdExceeded(
  startPos,
  currentPos,
  startTime,
  currentTime,
  dragHoldMs,
  distanceThreshold = 5
) {
  const dist = distanceBetween(startPos, currentPos);
  const duration = currentTime - startTime;
  return dist >= distanceThreshold || duration >= dragHoldMs;
}
