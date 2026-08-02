// @ts-check

import {
  FOG_VEIL_GM_EXPLORED,
  FOG_VEIL_GM_UNEXPLORED,
  FOG_VEIL_PLAYER_EXPLORED,
  FOG_VEIL_PLAYER_UNEXPLORED,
  VISION_MAX_RANGE_CELLS,
} from '../../core/constants.js';
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
 * Couche de rendu du masque de fog / voile de vision à trois états (L-04).
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
   * Retourne les polygones de vision actuellement mis en cache.
   * @returns {MapPoint[][]}
   */
  getVisiblePolygons() {
    return this._cachedPolygons;
  }

  /**
   * Signature de la vision courante, pour que l'appelant sache si elle a changé
   * **sans avoir à encoder le masque pour s'en apercevoir**.
   *
   * Sans elle, la publication encodait un PNG à chaque image — `getImageData` plus
   * deflate, environ 6 ms sur la grande carte — avant de constater que la chaîne
   * produite était identique à la précédente. Comparer la signature coûte une
   * comparaison de chaînes ; comparer le PNG coûtait tout l'encodage.
   *
   * @returns {string}
   */
  getVisionSignature() {
    return this._lastSignature;
  }

  /**
   * Recalcule la vision courante si elle a changé, **sans rien dessiner**.
   *
   * ⚠ Ce calcul ne doit surtout pas rester prisonnier du rendu. Côté MJ il est
   * autoritaire : c'est lui qui alimente le masque publié aux tablettes. Tant qu'il ne
   * vivait que dans `render()`, un onglet MJ caché, occulté ou minimisé — le navigateur
   * suspend alors `requestAnimationFrame` — cessait de recalculer la vision, et le fog
   * de toutes les tablettes restait figé jusqu'au retour de la fenêtre au premier plan.
   * Mesuré : privé de frames, le MJ ne publiait plus aucun `vision.update`.
   *
   * La mémoïsation par signature est conservée : appeler cette méthode à chaque mutation
   * du store coûte une construction de chaîne quand rien de visuel n'a bougé.
   *
   * @param {GridAdapter} grid
   * @param {Level|null} level
   * @param {Token[]} tokens
   * @param {Object} [options]
   * @param {Segment[]} [options.segments]
   * @param {(lvl: Level, g: GridAdapter) => Segment[]} [options.extractSegments]
   * @returns {boolean} true si la vision a réellement été recalculée
   */
  updateVision(grid, level, tokens, options = {}) {
    if (!grid || !level) return false;

    const signature = buildVisionSignature(level, tokens || []);
    if (signature === this._lastSignature) return false;
    this._lastSignature = signature;
    computeCount++;

    const pcTokens = (tokens || []).filter(
      (t) => t && t.levelId === level.id && t.kind === 'pc' && typeof t.visionDim === 'number' && t.visionDim > 0
    );

    if (pcTokens.length === 0) {
      this._cachedPolygons = [];
      return true;
    }

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
    return true;
  }

  /**
   * Rendu du voile à trois états (vu maintenant, exploré-hors-vision, jamais exploré).
   *
   * @param {CanvasRenderingContext2D} ctx Contexte de scène principal
   * @param {GridAdapter} grid Adaptateur de grille
   * @param {Level|null} level Étage actif
   * @param {Token[]} tokens Liste des pions
   * @param {Object} [options]
   * @param {'gm'|'players'} [options.role] Rôle d'affichage ('gm' ou 'players')
   * @param {any} [options.exploredCanvas] Canvas du masque exploré (8 px/case)
   * @param {any} [options.visibleCanvas] Canvas du masque de vision courante (8 px/case)
   * @param {MapPoint[][]} [options.visiblePolygons] Polygones de vision transmis si calculés ailleurs
   * @param {Segment[]} [options.segments] Segments d'obstacles pré-extraits
   * @param {(lvl: Level, g: GridAdapter) => Segment[]} [options.extractSegments] Injecteur d'extraction
   */
  render(ctx, grid, level, tokens, options = {}) {
    if (!ctx || !grid || !level) return;

    const role = options.role || 'gm';
    const isPlayer = role === 'players';

    // 1. Calcul / mise à jour des polygones de vision courante (Mac / GM autoritaire).
    // Le calcul lui-même vit dans `updateVision`, que le MJ appelle aussi hors rendu.
    if (options.visiblePolygons) {
      this._cachedPolygons = options.visiblePolygons;
    } else if (role === 'gm') {
      this.updateVision(grid, level, tokens, options);
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

    // Opacités visées selon la vue (CdC §5.6 / L-04 §7). Elles se règlent dans
    // `core/constants.js`, où le lien entre elles est documenté — vue MJ : trois états
    // qui doivent rester discernables ; vue joueurs : opacité pleine qui masque les pions.
    const veilUnexplored = isPlayer ? FOG_VEIL_PLAYER_UNEXPLORED : FOG_VEIL_GM_UNEXPLORED;
    const veilExplored = isPlayer ? FOG_VEIL_PLAYER_EXPLORED : FOG_VEIL_GM_EXPLORED;

    // ⚠ L'étape B pose le voile exploré **sous** ce qui reste de l'étape A
    // (`destination-over`). Dans les zones jamais explorées, où l'étape A n'a rien
    // effacé, les deux voiles s'additionnent donc au lieu de se remplacer : peindre
    // l'étape A directement à l'opacité visée affichait `1-(1-U)(1-E)`. C'est ce qui
    // rendait la vue MJ bien plus opaque que ses propres valeurs ne le disaient —
    // 0,70 et 0,45 donnaient un voile réel de 0,835, et la zone non découverte était
    // illisible. On ne peint ici que le **complément**, pour que la somme vaille U.
    //
    // Sans masque exploré, l'étape B n'a pas lieu : la valeur visée se peint telle
    // quelle. Et côté joueurs, U vaut 1 : le complément vaut 1 aussi, rien ne change.
    const unexploredAlpha =
      options.exploredCanvas && veilExplored < 1
        ? Math.max(0, (veilUnexplored - veilExplored) / (1 - veilExplored))
        : veilUnexplored;

    offCtx.save();
    offCtx.clearRect(0, 0, mapWidth, mapHeight);

    // Étape A : Remplir tout le canvas avec le voile non exploré
    offCtx.fillStyle = `rgba(0, 0, 0, ${unexploredAlpha})`;
    offCtx.fillRect(0, 0, mapWidth, mapHeight);

    // Étape B : Si le masque exploré existe, remplacer le voile non exploré par le voile exploré
    if (options.exploredCanvas) {
      // Effacer le voile non exploré dans les zones explorées avec destination-out
      offCtx.globalCompositeOperation = 'destination-out';
      offCtx.drawImage(options.exploredCanvas, 0, 0, mapWidth, mapHeight);

      // Appliquer le voile exploré dans ces zones libérées
      offCtx.globalCompositeOperation = 'destination-over';
      offCtx.fillStyle = `rgba(0, 0, 0, ${veilExplored})`;
      offCtx.fillRect(0, 0, mapWidth, mapHeight);
    }

    // Étape C : Percer le masque de vision courante (visible) avec destination-out
    if (options.visibleCanvas) {
      offCtx.globalCompositeOperation = 'destination-out';
      offCtx.drawImage(options.visibleCanvas, 0, 0, mapWidth, mapHeight);
    } else if (this._cachedPolygons.length > 0) {
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
    }

    offCtx.restore();

    // Étape D : Déposer le voile final à trois états sur le contexte de scène en source-over
    ctx.drawImage(this._offscreenCanvas, 0, 0);
  }
}
