// @ts-check
import { Application, Container } from 'pixi.js';
import { RENDER_RESOLUTION_CAP } from '../core/constants.js';

/**
 * @typedef {Object} StageLayers
 * @property {Container} background Image de fond ou vidéo
 * @property {Container} gridLayer Quadrillage
 * @property {Container} moveZone Cases atteignables (non interactif)
 * @property {Container} templates Gabarits de zone d'effet
 * @property {Container} tokens Pions et badges
 * @property {Container} fogLayer Masque de fog (au-dessus des pions)
 */

/**
 * Initialise l'application PixiJS v8 et crée la hiérarchie des couches dans l'ordre exact
 * de `ARCHITECTURE.md` §5.
 *
 * Module **strictement navigateur** : `pixi.js` est résolu par l'import map d'`index.html`.
 * Aucun repli n'est prévu si le chargement échoue — une scène factice qui s'initialise sans
 * rien dessiner est plus coûteuse à diagnostiquer qu'une erreur nette (`CONVENTIONS.md` §6).
 * Sous Node, l'import échoue donc bruyamment : ce module se teste au navigateur
 * (`tests/stage.spec.mjs`), pas en test unitaire.
 *
 * @param {HTMLCanvasElement} [canvasElement] Canvas HTML à attacher. Si omis, Pixi en crée un.
 * @returns {Promise<{ app: Application, layers: StageLayers }>}
 */
export async function initStage(canvasElement) {
  const app = new Application();

  // Initialisation asynchrone : idiome obligatoire en v8 (STACK.md §3).
  await app.init({
    canvas: canvasElement,
    // Plafond de résolution : au-delà, le coût GPU sur Mali-G68 ne se voit pas à table.
    resolution: Math.min(window.devicePixelRatio || 1, RENDER_RESOLUTION_CAP),
    autoDensity: true,
    antialias: false,
    powerPreference: 'high-performance',
  });

  // Boucle à la demande : le ticker ne tourne jamais de lui-même, c'est `render/frame.js`
  // qui décide quand une frame est nécessaire.
  app.ticker.autoStart = false;
  app.ticker.stop();

  const layers = {
    background: new Container(),
    gridLayer: new Container(),
    moveZone: new Container(),
    templates: new Container(),
    tokens: new Container(),
    fogLayer: new Container(),
  };

  // Ordre figé — `fogLayer` au-dessus de `tokens` garantit mécaniquement l'interdiction n°3.
  app.stage.addChild(layers.background);
  app.stage.addChild(layers.gridLayer);
  app.stage.addChild(layers.moveZone);
  app.stage.addChild(layers.templates);
  app.stage.addChild(layers.tokens);
  app.stage.addChild(layers.fogLayer);

  return { app, layers };
}
