// @ts-check
import { RENDER_RESOLUTION_CAP } from '../core/constants.js';

/**
 * @typedef {Object} StageLayers
 * @property {any} background Image de fond ou vidéo
 * @property {any} gridLayer Quadrillage
 * @property {any} moveZone Cases atteignables (non interactif)
 * @property {any} templates Gabarits de zone d'effet
 * @property {any} tokens Pions et badges
 * @property {any} fogLayer Masque de fog (au-dessus des pions)
 */

/**
 * Initialise l'application PixiJS v8 et crée la hiérarchie des couches dans l'ordre exact.
 *
 * @param {HTMLCanvasElement} [canvasElement] Canvas HTML optionnel à attacher
 * @returns {Promise<{ app: any, layers: StageLayers }>}
 */
export async function initStage(canvasElement) {
  /** @type {any} */
  let PIXI;
  try {
    PIXI = await import('pixi.js');
  } catch (_err) {
    // Fallback environnement Node / tests unitaires sans CDN pixi.js
    PIXI = await import('../core/types.js');
  }

  const Application = PIXI.Application;
  const Container = PIXI.Container;

  const app = new Application();

  const options = {
    canvas: canvasElement,
    resolution: Math.min(
      typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
      RENDER_RESOLUTION_CAP
    ),
    autoDensity: true,
    antialias: false,
    powerPreference: 'high-performance',
  };

  // Initialisation asynchrone Pixi v8
  if (typeof app.init === 'function') {
    await app.init(options);
  }

  // Ticker à la demande : autoStart = false
  if (app.ticker) {
    app.ticker.autoStart = false;
    app.ticker.stop();
  }

  // Création des couches dans l'ordre de ARCHITECTURE.md §5
  const layers = {
    background: new Container(),
    gridLayer: new Container(),
    moveZone: new Container(),
    templates: new Container(),
    tokens: new Container(),
    fogLayer: new Container(),
  };

  app.stage.addChild(layers.background);
  app.stage.addChild(layers.gridLayer);
  app.stage.addChild(layers.moveZone);
  app.stage.addChild(layers.templates);
  app.stage.addChild(layers.tokens);
  app.stage.addChild(layers.fogLayer);

  return { app, layers };
}
