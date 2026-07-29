// @ts-check

/** @type {HTMLImageElement|null} */
let lastImageCache = null;

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
  }

  /**
   * Charge une image de fond de facon asynchrone via Image natif.
   *
   * @param {string} imageUrl URL de l'image de fond
   * @returns {Promise<void>}
   */
  load(imageUrl) {
    if (!imageUrl || this.currentUrl === imageUrl) {
      return Promise.resolve();
    }
    this.currentUrl = imageUrl;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (this.currentUrl === imageUrl) {
          this.image = img;
          lastImageCache = img;
        }
        resolve();
      };
      img.onerror = (err) => {
        console.warn('Erreur lors du chargement de l\'image de fond :', err);
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
    if (img) {
      lastImageCache = img;
      if (img.src) {
        this.currentUrl = img.src;
      }
    }
  }

  /**
   * Dessine l'image de fond sur le contexte Canvas 2D, scalee aux dimensions du grid.
   * La transformation camera (pan & zoom) est deja appliquee au contexte.
   * Redessine la derniere image en cache pendant que le chargement est en cours.
   *
   * @param {CanvasRenderingContext2D} ctx Contexte Canvas 2D
   * @param {number} [width] Largeur du grid en pixels (si omis, utilise taille native image)
   * @param {number} [height] Hauteur du grid en pixels (si omis, utilise taille native image)
   */
  render(ctx, width, height) {
    if (!ctx) return;
    const imgToUse = this.image || lastImageCache;
    if (!imgToUse) return;
    if (width && height) {
      ctx.drawImage(imgToUse, 0, 0, width, height);
    } else {
      ctx.drawImage(imgToUse, 0, 0);
    }
  }
}
