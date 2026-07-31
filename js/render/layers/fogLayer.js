// @ts-check

import { VISION_MAX_RANGE_CELLS } from '../../core/constants.js';
import { sweep } from '../../vision/sweep.js';

/** @typedef {import('../../core/types.js').Level} Level */
/** @typedef {import('../../core/types.js').Token} Token */
/** @typedef {import('../../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../../core/types.js').Segment} Segment */
/** @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter */

let computeCount = 0;

/**
 * Compteur du nombre de recalculs réels de vision effectués (pour les tests).
 * @returns {number}
 */
export function getVisionComputeCount() {
  return computeCount;
}

/**
 * Réinitialise le compteur de recalculs de vision.
 * @returns {void}
 */
export function resetVisionComputeCount() {
  computeCount = 0;
}

/**
 * Génère la signature de mémoïsation incluant l'étage, les obstacles et les pions PJ porteurs de vision.
 *
 * @param {Level} level
 * @param {Token[]} tokens
 * @returns {string}
 */
function buildVisionSignature(level, tokens) {
  if (!level) return '';

  /** @type {string[]} */
  const parts = [`level:${level.id || 'default'}`];

  if (Array.isArray(level.walls)) {
    for (let i = 0; i < level.walls.length; i++) {
      const poly = level.walls[i];
      if (Array.isArray(poly)) {
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          if (p) parts.push(`w:${p.cellX},${p.cellY}`);
        }
      }
    }
  }

  if (Array.isArray(level.portals)) {
    for (let i = 0; i < level.portals.length; i++) {
      const p = level.portals[i];
      if (p) {
        parts.push(`p:${p.id}:${p.a?.cellX},${p.a?.cellY}-${p.b?.cellX},${p.b?.cellY}:${p.closed}:${p.state}`);
      }
    }
  }

  const pcTokens = tokens.filter(
    (t) => t && t.levelId === level.id && t.kind === 'pc' && typeof t.visionDim === 'number' && t.visionDim > 0
  );
  pcTokens.sort((a, b) => a.id.localeCompare(b.id));

  for (const t of pcTokens) {
    const size = Math.max(1, t.sizeCells || 1);
    parts.push(
      `t:${t.id}:kind=${t.kind}:lvl=${t.levelId}:cell=${t.cell?.a},${t.cell?.b}:size=${size}:vDim=${t.visionDim}`
    );
    if (t.move) {
      parts.push(`m:${t.move.from?.a},${t.move.from?.b}->${t.move.to?.a},${t.move.to?.b}:${t.move.startedAt}`);
    }
  }

  return parts.join(';');
}

/**
 * Fabrique d'élément canvas hors écran autonome.
 *
 * @param {number} width
 * @param {number} height
 * @param {CanvasRenderingContext2D} mainCtx
 * @param {((w: number, h: number) => any)} [factory]
 * @returns {any}
 */
function createOffscreenCanvas(width, height, mainCtx, factory) {
  if (typeof factory === 'function') {
    return factory(width, height);
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (mainCtx?.canvas?.ownerDocument?.createElement) {
    const canvas = mainCtx.canvas.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Couche de rendu du masque de fog / voile de vision (GM view preview en L-03).
 */
export class FogLayer {
  /**
   * @param {{ createOffscreenCanvas?: (w: number, h: number) => any }} [options]
   */
  constructor(options = {}) {
    /** @type {string} */
    this._lastSignature = '';
    /** @type {MapPoint[][]} */
    this._cachedPolygons = [];
    /** @type {any} */
    this._offscreenCanvas = null;
    /** @type {CanvasRenderingContext2D|null} */
    this._offscreenCtx = null;
    /** @type {((w: number, h: number) => any)|undefined} */
    this._offscreenFactory = options.createOffscreenCanvas;
  }

  /**
   * Efface le cache de calcul interne.
   */
  invalidate() {
    this._lastSignature = '';
    this._cachedPolygons = [];
  }

  /**
   * Rendu de l'union des champs de vision et du voile.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte de scène principal
   * @param {GridAdapter} grid Adaptateur de grille
   * @param {Level|null} level Étage actif
   * @param {Token[]} tokens Liste des pions
   * @param {Object} [options]
   * @param {'gm'|'players'} [options.role] Rôle d'affichage
   * @param {string} [options.veilColor] Couleur du voile (défaut 'rgba(0, 0, 0, 0.45)')
   * @param {Segment[]} [options.segments] Segments d'obstacles pré-extraits
   * @param {(lvl: Level, g: GridAdapter) => Segment[]} [options.extractSegments] Injecteur d'extraction
   */
  render(ctx, grid, level, tokens, options = {}) {
    if (!ctx || !grid || !level) return;

    const signature = buildVisionSignature(level, tokens || []);
    if (signature !== this._lastSignature) {
      this._lastSignature = signature;
      computeCount++;

      const pcTokens = (tokens || []).filter(
        (t) => t && t.levelId === level.id && t.kind === 'pc' && typeof t.visionDim === 'number' && t.visionDim > 0
      );

      if (pcTokens.length === 0) {
        this._cachedPolygons = [];
      } else {
        /** @type {Segment[]} */
        const segments =
          options.segments ||
          (typeof options.extractSegments === 'function' ? options.extractSegments(level, grid) : []);

        const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });

        /** @type {MapPoint[][]} */
        const polygons = [];
        for (const t of pcTokens) {
          const rangeCells = Math.min(t.visionDim, VISION_MAX_RANGE_CELLS);
          if (rangeCells <= 0) continue;

          const originR = grid.mapFromCellPoint({ cellX: rangeCells, cellY: 0 });
          const rangePx = Math.hypot(originR.x - origin0.x, originR.y - origin0.y);

          const size = Math.max(1, t.sizeCells || 1);
          const centerPoint = grid.mapFromCellPoint({
            cellX: t.cell.a + size / 2,
            cellY: t.cell.b + size / 2,
          });

          const poly = sweep(centerPoint, segments, rangePx);
          if (Array.isArray(poly) && poly.length > 0) {
            polygons.push(poly);
          }
        }
        this._cachedPolygons = polygons;
      }
    }

    const bottomRight = grid.mapFromCellPoint({
      cellX: level.widthCells,
      cellY: level.heightCells,
    });
    const mapWidth = Math.ceil(bottomRight.x);
    const mapHeight = Math.ceil(bottomRight.y);

    if (mapWidth <= 0 || mapHeight <= 0) return;

    if (
      !this._offscreenCanvas ||
      this._offscreenCanvas.width !== mapWidth ||
      this._offscreenCanvas.height !== mapHeight
    ) {
      this._offscreenCanvas = createOffscreenCanvas(mapWidth, mapHeight, ctx, this._offscreenFactory);
      if (this._offscreenCanvas) {
        this._offscreenCtx = this._offscreenCanvas.getContext('2d');
      }
    }

    const offCtx = this._offscreenCtx;
    if (!offCtx || !this._offscreenCanvas) return;

    // 1. Remplir le canvas hors écran avec le voile
    offCtx.clearRect(0, 0, mapWidth, mapHeight);
    offCtx.fillStyle = options.veilColor || 'rgba(0, 0, 0, 0.45)';
    offCtx.fillRect(0, 0, mapWidth, mapHeight);

    // 2. Percer l'union des polygones de vision avec destination-out
    if (this._cachedPolygons.length > 0) {
      offCtx.save();
      offCtx.globalCompositeOperation = 'destination-out';
      offCtx.beginPath();

      for (const poly of this._cachedPolygons) {
        if (!poly || poly.length === 0) continue;
        offCtx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          offCtx.lineTo(poly[i].x, poly[i].y);
        }
        offCtx.closePath();
      }

      offCtx.fillStyle = '#000000';
      offCtx.fill();
      offCtx.restore();
    }

    // 3. Déposer le voile percé sur le contexte principal en source-over
    ctx.drawImage(this._offscreenCanvas, 0, 0);
  }
}
