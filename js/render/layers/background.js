// @ts-check
import { Assets, Container, Sprite } from 'pixi.js';

/**
 * Couche de fond d'étage (image ou média de carte).
 */
export class BackgroundLayer {
  /**
   * @param {Container} container Conteneur PixiJS parent dédié à la couche background.
   */
  constructor(container) {
    /** @type {Container} */
    this.container = container;
    /** @type {Sprite} */
    this.sprite = new Sprite();
    this.container.addChild(this.sprite);
    /** @type {string|null} */
    this.currentUrl = null;
  }

  /**
   * Charge une image et l'applique au sprite de fond.
   *
   * @param {string} imageUrl URL de l'image de fond
   * @returns {Promise<void>}
   */
  async load(imageUrl) {
    if (!imageUrl || this.currentUrl === imageUrl) return;
    this.currentUrl = imageUrl;
    try {
      const texture = await Assets.load(imageUrl);
      if (this.currentUrl === imageUrl) {
        this.sprite.texture = texture;
      }
    } catch (err) {
      console.warn('Erreur lors du chargement de l’image de fond :', err);
    }
  }

  /**
   * Remplace ou ajoute un sprite directement.
   *
   * @param {Sprite} sprite
   */
  setSprite(sprite) {
    this.container.removeChildren();
    this.sprite = sprite;
    this.container.addChild(this.sprite);
  }
}
