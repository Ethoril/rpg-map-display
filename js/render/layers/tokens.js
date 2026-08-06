// @ts-check

import { getOrExtractMaskAlpha, isCellVisibleInMask } from '../../vision/fog.js';
import {
  computeElevationBadgeLayout,
  drawStatusBadges,
  computeProportionalRing,
  computeStateRing,
  computeHpBadgeLayout,
} from '../statusBadges.js';

const TOKEN_IMAGE_CACHE_LIMIT = 64;
export const TOKEN_MOVE_STEP_MS = 160;

/**
 * @typedef {import('../../core/types.js').Token} Token
 * @typedef {import('../../core/types.js').Cell} Cell
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 * @typedef {'loading'|'ready'|'error'} ImageStatus
 * @typedef {{
 *   status: ImageStatus,
 *   image: HTMLImageElement|null,
 *   error: Error|null,
 *   promise: Promise<void>
 * }} TokenImageEntry
 *
 * @typedef {{
 *   tokenId?: string|null,
 *   selectedTokenId?: string|null
 * }} SelectionOption
 *
 * @typedef {{
 *   role?: 'gm'|'players',
 *   isGM?: boolean,
 *   isPlayerView?: boolean,
 *   activeLevelId: string,
 *   now?: number,
 *   dragPreview?: { tokenId: string, mapPos: import('../../core/types.js').MapPoint }|null,
 *   visibleCanvas?: any,
 *   visibleAlpha?: Uint8Array|null,
 *   activeLevelWidthCells?: number,
 *   activeLevelHeightCells?: number,
 *   zoom?: number,
 *   resolution?: number,
 *   invalidate?: () => void
 * }} RenderOptions
 */

/** @param {unknown} value @returns {Error} */
function asError(value) {
  return value instanceof Error ? value : new Error('Impossible de charger l’image du pion');
}

/** @param {Cell} a @param {Cell} b @param {number} ratio */
function interpolateCell(a, b, ratio) {
  return {
    cellX: a.a + (b.a - a.a) * ratio,
    cellY: a.b + (b.b - a.b) * ratio,
  };
}

/**
 * Calcule une position purement déterministe depuis les données réseau.
 *
 * @param {Token} token
 * @param {number} now
 * @returns {{ cellX: number, cellY: number, active: boolean }}
 */
function tokenPosition(token, now) {
  const move = token.move;
  if (!move || !Number.isFinite(move.startedAt)) {
    return { cellX: token.cell.a, cellY: token.cell.b, active: false };
  }

  /** @type {Cell[]} */
  const path = Array.isArray(move.path) && move.path.length > 0
    ? move.path
    : [move.from, move.to];
  if (path.length < 2) {
    return { cellX: token.cell.a, cellY: token.cell.b, active: false };
  }

  const elapsed = Math.max(0, now - move.startedAt);
  const duration = (path.length - 1) * TOKEN_MOVE_STEP_MS;
  if (elapsed >= duration) {
    return { cellX: move.to.a, cellY: move.to.b, active: false };
  }

  const progress = elapsed / TOKEN_MOVE_STEP_MS;
  const segment = Math.min(path.length - 2, Math.floor(progress));
  const ratio = Math.max(0, Math.min(1, progress - segment));
  return { ...interpolateCell(path[segment], path[segment + 1], ratio), active: true };
}

/**
 * Rendu Canvas des pions, avec cache d'images borné et invalidation asynchrone.
 */
export class TokensLayer {
  /**
   * @param {{
   *   invalidate?: () => void,
   *   imageFactory?: () => HTMLImageElement,
   *   maxCacheEntries?: number
   * }} [options]
   */
  constructor(options = {}) {
    this.invalidate = options.invalidate ?? (() => {});
    this.imageFactory = options.imageFactory ?? (() => new Image());
    this.maxCacheEntries = Math.max(1, options.maxCacheEntries ?? TOKEN_IMAGE_CACHE_LIMIT);
    /** @type {Map<string, TokenImageEntry>} */
    this.imageCache = new Map();
  }

  /** @param {string} url @param {TokenImageEntry} entry */
  _remember(url, entry) {
    this.imageCache.delete(url);
    this.imageCache.set(url, entry);
    while (this.imageCache.size > this.maxCacheEntries) {
      const oldest = this.imageCache.keys().next().value;
      if (oldest !== undefined) this.imageCache.delete(oldest);
    }
  }

  /**
   * @param {string|null|undefined} imageUrl
   * @param {{ retry?: boolean }} [options]
   * @returns {Promise<void>}
   */
  preload(imageUrl, options = {}) {
    const url = imageUrl?.trim() ?? '';
    if (!url) return Promise.resolve();
    if (options.retry) this.imageCache.delete(url);

    const cached = this.imageCache.get(url);
    if (cached) {
      this._remember(url, cached);
      return cached.promise;
    }

    const image = this.imageFactory();
    /** @type {TokenImageEntry} */
    const entry = {
      status: 'loading',
      image: null,
      error: null,
      promise: Promise.resolve(),
    };
    entry.promise = new Promise((resolve) => {
      image.onload = () => {
        entry.status = 'ready';
        entry.image = image;
        this._remember(url, entry);
        this.invalidate();
        resolve();
      };
      image.onerror = (reason) => {
        entry.status = 'error';
        entry.error = asError(reason);
        this._remember(url, entry);
        this.invalidate();
        resolve();
      };
      image.src = url;
    });
    this._remember(url, entry);
    return entry.promise;
  }

  /** @param {string} url @returns {Promise<void>} */
  retry(url) {
    return this.preload(url, { retry: true });
  }

  /** @param {string|null|undefined} url @returns {'idle'|ImageStatus} */
  imageStatus(url) {
    if (!url) return 'idle';
    return this.imageCache.get(url)?.status ?? 'idle';
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Token[]} tokens
   * @param {SelectionOption|string|null} selection
   * @param {RenderOptions} options
   * @returns {{ renderedTokenIds: string[], animationActive: boolean }}
   */
  render(ctx, grid, tokens, selection, options) {
    const result = { renderedTokenIds: /** @type {string[]} */ ([]), animationActive: false };
    if (!ctx || !grid || !Array.isArray(tokens) || !options?.activeLevelId) return result;

    const selectedTokenId = typeof selection === 'string'
      ? selection
      : selection?.tokenId ?? selection?.selectedTokenId ?? null;
    const isPlayerView = options.role === 'players' || options.isPlayerView === true || (options.isGM === false);
    const now = options.now ?? Date.now();
    const visibleTokens = tokens.filter(
      (token) =>
        token?.levelId === options.activeLevelId &&
        !(isPlayerView && token.hidden)
    );

    // Filtrage discret pion par pion côté joueurs (Option A / CORRECTIF) :
    // Aucun canvas hors écran n'est alloué, aucune composition destination-in sur la carte complète.
    // Pour chaque pion, on vérifie si la case d'ancrage token.cell est vue dans le masque.
    let maskAlpha = null;
    if (isPlayerView && (options.visibleAlpha || options.visibleCanvas)) {
      if (options.visibleAlpha && options.visibleAlpha instanceof Uint8Array) {
        maskAlpha = options.visibleAlpha;
      } else if (options.visibleCanvas && options.activeLevelWidthCells && options.activeLevelHeightCells) {
        maskAlpha = getOrExtractMaskAlpha(options.visibleCanvas, options.activeLevelWidthCells, options.activeLevelHeightCells);
      }
    }

    ctx.save();
    for (const token of visibleTokens) {
      if (!token.cell) continue;

      if (isPlayerView && maskAlpha && options.activeLevelWidthCells && options.activeLevelHeightCells) {
        if (!isCellVisibleInMask(token.cell, maskAlpha, options.activeLevelWidthCells, options.activeLevelHeightCells)) {
          continue;
        }
      }

      let position = tokenPosition(token, now);
      if (options.dragPreview?.tokenId === token.id) {
        const cellPoint = grid.cellPointFromMap(options.dragPreview.mapPos);
        const halfSize = Math.max(1, token.sizeCells || 1) / 2;
        position = {
          cellX: cellPoint.cellX - halfSize,
          cellY: cellPoint.cellY - halfSize,
          active: false,
        };
      }
      result.animationActive ||= position.active;
      result.renderedTokenIds.push(token.id);
      this._drawToken(ctx, grid, token, position, selectedTokenId === token.id, {
        ...options,
        isPlayerView,
      });
    }
    ctx.restore();

    return result;
  }


  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid
   * @param {Token} token
   * @param {{cellX: number, cellY: number}} position
   * @param {boolean} selected
   * @param {RenderOptions} [options]
   */
  _drawToken(ctx, grid, token, position, selected, options) {
    const sizeCells = Math.max(1, token.sizeCells || 1);
    const p0 = grid.mapFromCellPoint(position);
    const p1 = grid.mapFromCellPoint({
      cellX: position.cellX + sizeCells,
      cellY: position.cellY + sizeCells,
    });
    const width = p1.x - p0.x;
    const height = p1.y - p0.y;
    const centerX = p0.x + width / 2;
    const centerY = p0.y + height / 2;
    const radiusX = width / 2;
    const radiusY = height / 2;
    const borderColor = token.borderColor || '#ffffff';
    const imageUrl = token.imageUrl?.trim() ?? '';
    const imageEntry = imageUrl ? this.imageCache.get(imageUrl) : undefined;
    if (imageUrl && !imageEntry) void this.preload(imageUrl);

    ctx.save();
    if (token.hidden) ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.clip();

    if (imageEntry?.status === 'ready' && imageEntry.image) {
      const image = imageEntry.image;
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const scale = Math.max(width / sourceWidth, height / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      ctx.drawImage(
        image,
        centerX - drawWidth / 2,
        centerY - drawHeight / 2,
        drawWidth,
        drawHeight
      );
    } else {
      ctx.fillStyle = imageEntry?.status === 'error' ? '#5f2530' : '#555d68';
      ctx.fillRect(p0.x, p0.y, width, height);
      const initial = (token.label || token.kind || '?').trim().charAt(0).toUpperCase() || '?';
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(12, Math.round(Math.min(width, height) * 0.35))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, centerX, centerY);
    }
    ctx.restore();

    ctx.save();
    if (token.hidden) ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX - 1, radiusY - 1, 0, 0, Math.PI * 2);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.035);
    ctx.stroke();
    ctx.restore();

    const zoom = options?.zoom && options.zoom > 0 ? options.zoom : 1;
    const resolution = options?.resolution && options.resolution > 0 ? options.resolution : 1;
    const isPlayerView = options?.isPlayerView === true;

    // ── Anneau de santé (Chantier Q §5.1-5.3) ────────────────────────────────────────────────
    // Dessiné entre la bordure et la sélection. Uniquement si hp !== null.
    if (token.hp !== null && token.hp !== undefined) {
      const ringLayout =
        token.kind === 'pc'
          ? computeProportionalRing(width, zoom, token.hp)
          : computeStateRing(width, zoom, token.health);

      if (ringLayout.visible) {
        ctx.save();
        if (token.hidden) ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringLayout.radiusMap, ringLayout.startAngle, ringLayout.endAngle);
        ctx.strokeStyle = ringLayout.color;
        ctx.lineWidth = ringLayout.lineWidthMap;
        ctx.stroke();
        ctx.restore();
      }
    }

    if (selected) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX + 4, radiusY + 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    if (typeof token.elevation === 'number' && token.elevation !== 0) {
      const { badgeX, badgeY, badgeRadiusMap, badgeRadiusScreen, visible } = computeElevationBadgeLayout(width, zoom);
      if (visible) {
        const cx = p0.x + badgeX;
        const cy = p0.y + badgeY;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, badgeRadiusMap, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
        ctx.font = `bold ${Math.max(9, Math.round(badgeRadiusScreen * 1.1)) / zoom}px sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(token.elevation > 0 ? `+${token.elevation}` : `${token.elevation}`, cx, cy);
        ctx.restore();
      }
    }

    drawStatusBadges(ctx, token, p0, {
      widthMap: width,
      zoom,
      resolution,
      invalidate: options?.invalidate ?? this.invalidate.bind(this),
    });

    // ── Compteur chiffré (Chantier Q §5.5 & §4 Qui voit quoi) ──────────────────────────────
    // Visible sur PJ pour tout le monde, sur PNJ pour la vue MJ uniquement.
    const canSeeHpDigits = token.kind === 'pc' || !isPlayerView;
    if (canSeeHpDigits && token.hp && typeof token.hp.current === 'number' && typeof token.hp.max === 'number') {
      const hpBadge = computeHpBadgeLayout(width, zoom, token.hp.current, token.hp.max);
      if (hpBadge.visible) {
        ctx.save();
        if (token.hidden) ctx.globalAlpha = 0.45;
        ctx.font = `bold ${hpBadge.fontSizeMap}px sans-serif`;
        const textMetrics = ctx.measureText(hpBadge.text);
        const textWidthMap = textMetrics.width;
        const bgWidthMap = textWidthMap + hpBadge.paddingXMap * 2;
        const bgHeightMap = hpBadge.heightMap;

        // Ancrer le coin bas-droit de la pastille à (p0.x + hpBadge.badgeX, p0.y + hpBadge.badgeY)
        const badgeLeft = p0.x + hpBadge.badgeX - bgWidthMap;
        const badgeTop = p0.y + hpBadge.badgeY - bgHeightMap;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(badgeLeft, badgeTop, bgWidthMap, bgHeightMap, 3 / zoom);
        } else {
          ctx.rect(badgeLeft, badgeTop, bgWidthMap, bgHeightMap);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          hpBadge.text,
          badgeLeft + bgWidthMap / 2,
          badgeTop + bgHeightMap / 2 + 0.5 / zoom
        );
        ctx.restore();
      }
    }
  }
}
