// @ts-check
import { RENDER_RESOLUTION_CAP } from '../core/constants.js';

/**
 * @typedef {Object} StageLayer
 * @property {string} name
 */

/**
 * @typedef {Object} StageLayers
 * @property {StageLayer} background Image de fond
 * @property {StageLayer} gridLayer Quadrillage
 * @property {StageLayer} moveZone Cases atteignables (non interactif)
 * @property {StageLayer} templates Gabarits de zone d'effet
 * @property {StageLayer} tokens Pions et badges
 * @property {StageLayer} fogLayer Masque de fog (au-dessus des pions)
 */

/**
 * Initialise le canvas Canvas 2D natif et crée la hiérarchie des couches dans l'ordre exact
 * de `ARCHITECTURE.md` §5.
 *
 * @param {HTMLCanvasElement} [canvasElement] Canvas HTML à attacher. Si omis, un canvas est créé.
 * @returns {Promise<{ canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, layers: StageLayers, resolution: number }>}
 */
export async function initStage(canvasElement) {
  const canvas = canvasElement || document.createElement('canvas');

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, RENDER_RESOLUTION_CAP) : 1;

  function resizeCanvas() {
    const parent = canvas.parentElement;
    const width = parent ? parent.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 800);
    const height = parent ? parent.clientHeight : (typeof window !== 'undefined' ? window.innerHeight : 600);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
  }

  resizeCanvas();

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeCanvas);
  }

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Impossible de récupérer le contexte 2D du canvas');
  }

  const layers = {
    background: { name: 'background' },
    gridLayer: { name: 'gridLayer' },
    moveZone: { name: 'moveZone' },
    templates: { name: 'templates' },
    tokens: { name: 'tokens' },
    fogLayer: { name: 'fogLayer' },
  };

  return { canvas, context, layers, resolution: dpr };
}
