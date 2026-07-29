// @ts-check
import { RENDER_RESOLUTION_CAP } from '../core/constants.js';

export const CANVAS_LAYER_ORDER = Object.freeze([
  'background',
  'grid',
  'moveZone',
  'templates',
  'tokens',
  'fog',
]);

/**
 * Exécute les fonctions de rendu dans l'ordre canonique. Une couche non encore
 * implantée peut être omise sans créer de faux conteneur.
 *
 * @param {Partial<Record<(typeof CANVAS_LAYER_ORDER)[number], () => void>>} renderers
 */
export function renderLayerStack(renderers) {
  for (const name of CANVAS_LAYER_ORDER) {
    const render = renderers[name];
    if (render) render();
  }
}

/**
 * Initialise un canvas 2D sans installer d'écouteur global. Le point d'entrée
 * reste propriétaire du resize et de l'invalidation qui doit en découler.
 *
 * @param {HTMLCanvasElement} [canvasElement]
 * @returns {Promise<{
 *   canvas: HTMLCanvasElement,
 *   context: CanvasRenderingContext2D,
 *   resolution: number,
 *   width: number,
 *   height: number,
 *   resize: () => boolean
 * }>}
 */
export async function initStage(canvasElement) {
  const canvas = canvasElement || document.createElement('canvas');
  const resolution = typeof window === 'undefined'
    ? 1
    : Math.min(window.devicePixelRatio || 1, RENDER_RESOLUTION_CAP);
  let logicalWidth = 0;
  let logicalHeight = 0;

  function resize() {
    const parent = canvas.parentElement;
    const width = Math.max(
      1,
      parent?.clientWidth ||
        canvas.clientWidth ||
        (typeof window !== 'undefined' ? window.innerWidth : 800)
    );
    const height = Math.max(
      1,
      parent?.clientHeight ||
        canvas.clientHeight ||
        (typeof window !== 'undefined' ? window.innerHeight : 600)
    );
    const backingWidth = Math.max(1, Math.round(width * resolution));
    const backingHeight = Math.max(1, Math.round(height * resolution));
    const changed = canvas.width !== backingWidth || canvas.height !== backingHeight;

    if (changed) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    logicalWidth = width;
    logicalHeight = height;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    return changed;
  }

  resize();
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Impossible de récupérer le contexte 2D du canvas');
  }

  return {
    canvas,
    context,
    resolution,
    get width() { return logicalWidth; },
    get height() { return logicalHeight; },
    resize,
  };
}
