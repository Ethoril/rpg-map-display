// @ts-check

/**
 * Couche de fond d'etage (image de carte en Canvas 2D natif).
 */
export class BackgroundLayer {
  /**
   * @param {any} [container] Conteneur de couche factice (compatibilite).
   */
  constructor(container = null) {
    /** @type {HTMLImageElement|null} */
    this.image = null;
    /** @type {string|null} */
    this.currentUrl = null;
    /** @type {string} */
    this.loadState = 'idle';
    /** @type {Function|null} */
    this.onStateChange = null;
  }

  /**
   * Charge une image de fond de facon asynchrone via Image natif.
   *
   * @param {string} imageUrl URL de l'image de fond
   * @returns {Promise<void>}
   */
  load(imageUrl) {
    if (!imageUrl || (this.currentUrl === imageUrl && this.loadState === 'loaded')) {
      return Promise.resolve();
    }

    this.currentUrl = imageUrl;
    this.loadState = 'loading';

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (this.currentUrl === imageUrl) {
          this.image = img;
          this.loadState = 'loaded';
          if (this.onStateChange) this.onStateChange('loaded');
        }
        resolve();
      };
      img.onerror = (err) => {
        console.warn('Erreur lors du chargement de l\'image de fond :', err);
        this.loadState = 'error';
        resolve();
      };
      img.src = imageUrl;
    });
  }

  /**
   * Applique directement un element Image.
   *
   * @param {HTMLImageElement} img
   */
  setImage(img) {
    this.image = img;
    if (img && img.src) {
      this.currentUrl = img.src;
    }
  }

  /**
   * Dessine l'image de fond sur le contexte Canvas 2D, scalee aux dimensions du grid.
   * La transformation camera (pan & zoom) est deja appliquee au contexte.
   * Ne dessine que si l'image est entierement chargee.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte Canvas 2D
   * @param {number} [width] Largeur du grid en pixels (si omis, utilise taille native image)
   * @param {number} [height] Hauteur du grid en pixels (si omis, utilise taille native image)
   */
  render(ctx, width, height) {
    if (this.loadState !== 'loaded' || !this.image || !ctx) return;
    if (width && height) {
      ctx.drawImage(this.image, 0, 0, width, height);
    } else {
      ctx.drawImage(this.image, 0, 0);
    }
  }
}
