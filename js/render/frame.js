// @ts-check

/**
 * Gestionnaire de la boucle de rendu à la demande (rAF coalescé).
 * Ne fait tourner le rendu PixiJS que lorsqu'une frame est explicitement demandée.
 */
export class FrameLoop {
  /**
   * @param {any} [app] Application PixiJS (optionnelle)
   */
  constructor(app = null) {
    this.app = app;
    this.requested = false;
    this.running = false;
    /** @type {any} */
    this.rafId = null;
    this.frameCount = 0;
    /** @type {Set<(count: number) => void>} */
    this.listeners = new Set();
  }

  /**
   * Demande le rendu d'une frame à la prochaine rAF.
   * Si une frame est déjà planifiée, plusieurs appels consécutifs sont coalescés.
   */
  requestFrame() {
    if (this.requested) return;
    this.requested = true;
    if (!this.running) {
      this.running = true;
      this._schedule();
    }
  }

  /**
   * Ajoute un écouteur de rendu.
   * @param {(count: number) => void} fn
   */
  addListener(fn) {
    this.listeners.add(fn);
  }

  /**
   * Retire un écouteur de rendu.
   * @param {(count: number) => void} fn
   */
  removeListener(fn) {
    this.listeners.delete(fn);
  }

  /**
   * Internal scheduler using rAF or fallback.
   * @private
   */
  _schedule() {
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(() => this._tick());
    } else {
      this.rafId = setTimeout(() => this._tick(), 16);
    }
  }

  /**
   * @private
   */
  _tick() {
    this.requested = false;
    this.frameCount++;

    if (this.app && typeof this.app.render === 'function') {
      this.app.render();
    }

    for (const listener of this.listeners) {
      try {
        listener(this.frameCount);
      } catch (err) {
        console.error(err);
      }
    }

    // Arrêt immédiat si aucun réabonnement de frame n'a eu lieu pendant le tick
    if (!this.requested) {
      this.running = false;
      this.rafId = null;
    } else {
      this._schedule();
    }
  }

  /**
   * Arrête la boucle de rendu et annule la rAF planifiée.
   */
  stop() {
    this.requested = false;
    this.running = false;
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(/** @type {number} */ (this.rafId));
      } else {
        clearTimeout(this.rafId);
      }
      this.rafId = null;
    }
  }
}
