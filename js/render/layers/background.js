// @ts-check

const BACKGROUND_CACHE_LIMIT = 8;

/**
 * @typedef {'idle'|'loading'|'ready'|'error'} BackgroundStatus
 * @typedef {{
 *   status: 'loading'|'ready'|'error',
 *   image: HTMLImageElement|null,
 *   error: Error|null,
 *   promise: Promise<HTMLImageElement>
 * }} CacheEntry
 */

/** @type {Map<string, CacheEntry>} */
const imageCache = new Map();

/** @param {string} url @param {CacheEntry} entry */
function remember(url, entry) {
  imageCache.delete(url);
  imageCache.set(url, entry);
  while (imageCache.size > BACKGROUND_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
}

/** @param {unknown} value @returns {Error} */
function asError(value) {
  return value instanceof Error ? value : new Error('Impossible de charger l’image de fond');
}

/**
 * Fond de carte Canvas avec état explicite et cache LRU par URL.
 */
export class BackgroundLayer {
  /**
   * @param {{
   *   invalidate?: () => void,
   *   imageFactory?: () => HTMLImageElement
   * }} [options]
   */
  constructor(options = {}) {
    this.invalidate = options.invalidate ?? (() => {});
    this.imageFactory = options.imageFactory ?? (() => new Image());
    /** @type {BackgroundStatus} */
    this.status = 'idle';
    /** @type {string|null} */
    this.currentUrl = null;
    /** @type {HTMLImageElement|null} */
    this.image = null;
    /** @type {Error|null} */
    this.error = null;
    /** @type {Promise<void>} */
    this.pending = Promise.resolve();
    this.loadVersion = 0;
  }

  /**
   * @param {string|null|undefined} imageUrl
   * @param {{ retry?: boolean }} [options]
   * @returns {Promise<void>}
   */
  load(imageUrl, options = {}) {
    const url = imageUrl?.trim() ?? '';
    if (!url) {
      this.loadVersion++;
      this.currentUrl = null;
      this.image = null;
      this.error = null;
      this.status = 'idle';
      this.pending = Promise.resolve();
      return this.pending;
    }

    if (
      !options.retry &&
      this.currentUrl === url &&
      (this.status === 'loading' || this.status === 'ready' || this.status === 'error')
    ) {
      return this.pending;
    }

    const version = ++this.loadVersion;
    this.currentUrl = url;
    this.image = null;
    this.error = null;
    this.status = 'loading';

    if (options.retry) imageCache.delete(url);
    let entry = imageCache.get(url);
    if (entry?.status === 'error' && !options.retry) {
      this.status = 'error';
      this.error = entry.error;
      this.pending = Promise.resolve();
      remember(url, entry);
      return this.pending;
    }
    if (!entry || entry.status === 'error') {
      const image = this.imageFactory();
      /** @type {CacheEntry} */
      const nextEntry = {
        status: 'loading',
        image: null,
        error: null,
        promise: Promise.resolve(image),
      };
      nextEntry.promise = new Promise((resolve, reject) => {
        image.onload = () => {
          nextEntry.status = 'ready';
          nextEntry.image = image;
          remember(url, nextEntry);
          resolve(image);
        };
        image.onerror = (event) => {
          const error = asError(event);
          nextEntry.status = 'error';
          nextEntry.error = error;
          remember(url, nextEntry);
          reject(error);
        };
        image.src = url;
      });
      // Évite un rejet non observé entre la création et l'abonnement ci-dessous.
      nextEntry.promise.catch(() => {});
      entry = nextEntry;
      remember(url, entry);
    } else {
      remember(url, entry);
    }

    if (entry.status === 'ready' && entry.image) {
      this.image = entry.image;
      this.status = 'ready';
      this.pending = Promise.resolve();
      return this.pending;
    }

    this.pending = entry.promise.then(
      (image) => {
        if (this.loadVersion !== version || this.currentUrl !== url) return;
        this.image = image;
        this.error = null;
        this.status = 'ready';
        this.invalidate();
      },
      (reason) => {
        if (this.loadVersion !== version || this.currentUrl !== url) return;
        this.image = null;
        this.error = asError(reason);
        this.status = 'error';
        this.invalidate();
      }
    );
    return this.pending;
  }

  /** @returns {Promise<void>} */
  retry() {
    if (!this.currentUrl) return Promise.resolve();
    return this.load(this.currentUrl, { retry: true });
  }

  /**
   * Installe une image locale transitoire sans la placer dans le cache partagé.
   * @param {HTMLImageElement} image
   * @param {string} [url]
   */
  setImage(image, url = '') {
    this.loadVersion++;
    this.currentUrl = url || image.currentSrc || image.src || null;
    this.image = image;
    this.error = null;
    this.status = 'ready';
    this.pending = Promise.resolve();
    this.invalidate();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width Largeur de la carte en pixels carte
   * @param {number} height Hauteur de la carte en pixels carte
   * @param {{ role?: 'gm'|'players', neutralColor?: string }} [options]
   */
  render(ctx, width, height, options = {}) {
    if (!ctx || width <= 0 || height <= 0) return;
    ctx.save();
    ctx.fillStyle = options.neutralColor ?? '#34383f';
    ctx.fillRect(0, 0, width, height);

    if (this.status === 'ready' && this.image) {
      const sourceWidth = this.image.naturalWidth || this.image.width;
      const sourceHeight = this.image.naturalHeight || this.image.height;
      if (sourceWidth > 0 && sourceHeight > 0) {
        const scale = Math.min(width / sourceWidth, height / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        ctx.drawImage(
          this.image,
          (width - drawWidth) / 2,
          (height - drawHeight) / 2,
          drawWidth,
          drawHeight
        );
      }
    } else if (this.status === 'error' && options.role === 'gm') {
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Carte indisponible — réessayez le chargement', width / 2, height / 2);
    }
    ctx.restore();
  }
}
