// @ts-check

/**
 * Boucle de rendu à la demande. Une demande déjà planifiée est coalescée et
 * aucune frame suivante n'est créée implicitement.
 */
export class FrameLoop {
  /**
   * @param {(timestamp: number) => void} onRender
   */
  constructor(onRender) {
    if (typeof onRender !== 'function') {
      throw new TypeError('FrameLoop attend un callback de rendu');
    }

    /** @type {(timestamp: number) => void} */
    this.onRender = onRender;
    this.requested = false;
    this.running = false;
    /** @type {number|ReturnType<typeof setTimeout>|null} */
    this.rafId = null;
    this.frameCount = 0;
    /** @type {Set<(count: number, timestamp: number) => void>} */
    this.listeners = new Set();
  }

  /**
   * @returns {boolean} true si une nouvelle frame a été planifiée
   */
  requestFrame() {
    if (this.requested) return false;
    this.requested = true;
    this.running = true;
    this._schedule();
    return true;
  }

  /** @param {(count: number, timestamp: number) => void} fn */
  addListener(fn) {
    this.listeners.add(fn);
  }

  /** @param {(count: number, timestamp: number) => void} fn */
  removeListener(fn) {
    this.listeners.delete(fn);
  }

  /** @private */
  _schedule() {
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame((timestamp) => this._tick(timestamp));
    } else {
      this.rafId = setTimeout(() => this._tick(Date.now()), 16);
    }
  }

  /**
   * @param {number} timestamp
   * @private
   */
  _tick(timestamp) {
    // La demande est consommée avant le callback. Une invalidation émise pendant
    // le rendu planifie donc explicitement une nouvelle frame.
    this.requested = false;
    this.running = false;
    this.rafId = null;
    this.frameCount++;

    // Les exceptions restent observables par le navigateur ou le test appelant.
    this.onRender(timestamp);
    for (const listener of this.listeners) {
      listener(this.frameCount, timestamp);
    }
  }

  stop() {
    this.requested = false;
    this.running = false;
    if (this.rafId === null) return;

    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(/** @type {number} */ (this.rafId));
    } else {
      clearTimeout(this.rafId);
    }
    this.rafId = null;
  }
}
