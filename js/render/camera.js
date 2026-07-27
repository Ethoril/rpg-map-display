// @ts-check

/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').ScreenPoint} ScreenPoint */

/**
 * Caméra de vue 2D.
 * SEUL composant du projet effectuant la conversion entre l'espace carte (MapPoint)
 * et l'espace écran (ScreenPoint).
 */
export class Camera {
  /**
   * @param {number} [screenWidth=800]
   * @param {number} [screenHeight=600]
   */
  constructor(screenWidth = 800, screenHeight = 600) {
    this.x = 0; // Centre x sur la carte (MapPoint.x)
    this.y = 0; // Centre y sur la carte (MapPoint.y)
    this.zoom = 1.0; // Facteur d'échelle (zoom)
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    this.minZoom = 0.1;
    this.maxZoom = 5.0;
  }

  /**
   * Met à jour les dimensions du viewport écran.
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
   * Définit le niveau de zoom (clampé entre minZoom et maxZoom).
   *
   * @param {number} z
   */
  setZoom(z) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
  }

  /**
   * Convertit un point carte (MapPoint) en point écran (ScreenPoint).
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
   * Convertit un point écran (ScreenPoint) en point carte (MapPoint).
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
   * Applique les transformations de la caméra à un conteneur PixiJS (stage).
   *
   * @param {any} container Conteneur PixiJS (ex. app.stage)
   */
  applyToContainer(container) {
    if (!container) return;
    if (typeof container.scale?.set === 'function') {
      container.scale.set(this.zoom);
    } else if (container.scale) {
      container.scale.x = this.zoom;
      container.scale.y = this.zoom;
    }
    if (container.position) {
      container.position.x = -this.x * this.zoom + this.screenWidth / 2;
      container.position.y = -this.y * this.zoom + this.screenHeight / 2;
    }
  }

  /**
   * Fait converger progressivement la caméra vers une cible.
   *
   * @param {{ x: number, y: number, zoom?: number }} target
   * @param {number} [factor=0.2] Facteur d'interpolation entre 0 et 1
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
