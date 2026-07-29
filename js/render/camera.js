// @ts-check

/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').ScreenPoint} ScreenPoint */

/** @type {(v: number, a: number, b: number) => number} */
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/**
 * Caméra 2D indépendante du moteur : centre de vue, zoom et conversions de coordonnées.
 * Gère correctement resolution + autoDensity.
 */
export class Camera {
  /**
   * @param {number} [screenWidth=800]
   * @param {number} [screenHeight=600]
   */
  constructor(screenWidth = 800, screenHeight = 600) {
    this.x = 0;
    this.y = 0;
    this.zoom = 1.0;
    this.rotation = 0;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.minZoom = 0.1;
    this.maxZoom = 5.0;
  }

  /**
   * Met à jour les dimensions du viewport (pixels logiques).
   *
   * @param {number} width
   * @param {number} height
   */
  setViewport(width, height) {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  /**
   * Définit la position du centre de la caméra sur la carte.
   *
   * @param {number} x
   * @param {number} y
   */
  setPan(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Définit le niveau de zoom (clampé).
   *
   * @param {number} z
   */
  setZoom(z) {
    this.zoom = clamp(z, this.minZoom, this.maxZoom);
  }

  /**
   * Convertit un point carte en point écran.
   *
   * @param {MapPoint} mapPoint
   * @returns {ScreenPoint}
   */
  mapToScreen(mapPoint) {
    const screenX = (mapPoint.x - this.x) * this.zoom + this.screenWidth / 2;
    const screenY = (mapPoint.y - this.y) * this.zoom + this.screenHeight / 2;
    return { screenX, screenY };
  }

  /**
   * Convertit un point écran en point carte.
   *
   * @param {ScreenPoint} screenPoint
   * @returns {MapPoint}
   */
  screenToMap(screenPoint) {
    const x = (screenPoint.screenX - this.screenWidth / 2) / this.zoom + this.x;
    const y = (screenPoint.screenY - this.screenHeight / 2) / this.zoom + this.y;
    return { x, y };
  }

  /**
   * Applique la transformation caméra au contexte Canvas 2D (pan + zoom).
   *
   * @param {CanvasRenderingContext2D} ctx Contexte Canvas 2D
   */
  applyToContext(ctx) {
    if (!ctx) return;
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    ctx.translate(this.screenWidth / 2, this.screenHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  /**
   * Fait converger progressivement la caméra vers une cible.
   *
   * @param {{ x: number, y: number, zoom?: number }} target
   * @param {number} [factor=0.2]
   */
  convergeTo(target, factor = 0.2) {
    this.x += (target.x - this.x) * factor;
    this.y += (target.y - this.y) * factor;
    if (target.zoom !== undefined) {
      const newZoom = this.zoom + (target.zoom - this.zoom) * factor;
      this.setZoom(newZoom);
    }
  }
}
