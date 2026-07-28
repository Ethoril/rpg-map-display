// @ts-check
// Module chargé DANS LA PAGE par tests/stage.spec.mjs. Il monte la vraie scène Pixi —
// résolue par l'import map d'index.html, donc le même chargement qu'à table — et publie
// sur `window.__stageProbe` de quoi vérifier les critères de T-15 depuis Playwright.
//
// Il vit ici plutôt que dans une chaîne passée à page.evaluate() pour une raison précise :
// écrit en fichier, il est typé par `tsc` comme le reste du dépôt. Une sonde de test non
// vérifiée est une sonde qui mentira un jour.
//
// Ce fichier n'est jamais chargé par l'application.

import { initStage } from '../js/render/stage.js';
import { FrameLoop } from '../js/render/frame.js';

/**
 * @typedef {Object} StageProbe
 * @property {string[]} layerOrder Noms des couches dans l'ordre réel des enfants du stage
 * @property {number} resolution Résolution effective du renderer
 * @property {boolean} tickerStarted Le ticker Pixi tourne-t-il de lui-même ?
 * @property {() => number} frameCount Nombre de frames effectivement rendues
 * @property {() => boolean} loopRunning La boucle est-elle encore planifiée ?
 * @property {(n: number) => void} requestFrames Demande n frames d'affilée (coalescence)
 */

const canvas = document.createElement('canvas');
canvas.id = 'board';
canvas.width = 800;
canvas.height = 600;
document.body.appendChild(canvas);

const { app, layers } = await initStage(canvas);
const loop = new FrameLoop(app);

const names = /** @type {Array<keyof typeof layers>} */ (Object.keys(layers));
const layerOrder = app.stage.children.map(
  (child) => names.find((name) => layers[name] === child) ?? 'inconnu'
);

/** @type {StageProbe} */
const probe = {
  layerOrder,
  resolution: app.renderer.resolution,
  tickerStarted: app.ticker.started,
  frameCount: () => loop.frameCount,
  loopRunning: () => loop.running,
  requestFrames: (n) => {
    for (let i = 0; i < n; i++) loop.requestFrame();
  },
};

/** @type {any} */ (window).__stageProbe = probe;
