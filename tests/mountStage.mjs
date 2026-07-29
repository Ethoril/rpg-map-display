// @ts-check
// Module chargé DANS LA PAGE par tests/*.spec.mjs. Il monte la vraie scène Pixi —
// résolue par l'import map d'index.html — et publie sur `window.__stageProbe`.

import { initStage } from '../js/render/stage.js';
import { FrameLoop } from '../js/render/frame.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { GridLayer } from '../js/render/layers/gridLayer.js';
import { BackgroundLayer } from '../js/render/layers/background.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import { MoveZoneLayer } from '../js/render/layers/moveZone.js';
import { createLevel } from '../js/core/schema.js';

/**
 * @typedef {Object} StageProbe
 * @property {string[]} layerOrder Noms des couches dans l'ordre réel des enfants du stage
 * @property {number} resolution Résolution effective du renderer
 * @property {boolean} tickerStarted Le ticker Pixi tourne-t-il de lui-même ?
 * @property {() => number} frameCount Nombre de frames effectivement rendues
 * @property {() => boolean} loopRunning La boucle est-elle encore planifiée ?
 * @property {(n: number) => void} requestFrames Demande n frames d'affilée (coalescence)
 * @property {(levelOverrides: object, scanY: number) => Promise<{ width: number, height: number, borderColumns: number[] }>} testGridRowScan
 * @property {(params: { levelOverrides?: object, tokensList: any[], selectionData?: any, options?: any }) => Promise<{ width: number, height: number, renderedTokensCount: number, cellAlphaMap: Record<string, number>, cellColorMap: Record<string, { r: number, g: number, b: number, a: number }>, hasElevationBadge: boolean }>} testTokensRender
 * @property {(params: { levelOverrides?: object, token?: any, cellsReachableKeys?: string[] }) => Promise<{ cellAlphaMap: Record<string, number>, eventMode: string }>} testMoveZoneRender
 */

let canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('board'));
if (!canvas) {
  canvas = document.createElement('canvas');
  canvas.id = 'board';
  canvas.width = 1400;
  canvas.height = 1120;
  document.body.appendChild(canvas);
}

const { app, layers } = await initStage(canvas);
const loop = new FrameLoop(app);

const names = /** @type {Array<keyof typeof layers>} */ (Object.keys(layers));
const layerOrder = app.stage.children.map(
  (child) => names.find((name) => layers[name] === child) ?? 'inconnu'
);

const bgLayer = new BackgroundLayer(layers.background);
const gridLayer = new GridLayer(layers.gridLayer);
const tokensLayer = new TokensLayer(layers.tokens);
const moveZoneLayer = new MoveZoneLayer(layers.moveZone);

import { Camera } from '../js/render/camera.js';
import { PointerInput } from '../js/input/pointer.js';

const camera = new Camera(canvas.width, canvas.height);
/** @type {import('../js/input/gestures.js').InputIntention[]} */
const emittedIntentions = [];
/** @type {PointerInput | null} */
let currentInput = null;

/** @type {StageProbe & { camera: Camera, getIntentions: () => any[], clearIntentions: () => void, setupInput: (role?: 'players'|'gm') => void, applyPanToIntention: (intention: any) => void }} */
const probe = {
  layerOrder,
  resolution: app.renderer.resolution,
  tickerStarted: app.ticker.started,
  frameCount: () => loop.frameCount,
  loopRunning: () => loop.running,
  requestFrames: (n) => {
    for (let i = 0; i < n; i++) loop.requestFrame();
  },
  camera,
  getIntentions: () => [...emittedIntentions],
  clearIntentions: () => {
    emittedIntentions.length = 0;
  },
  setupInput: (role = 'players') => {
    if (currentInput) {
      currentInput.detach();
    }
    emittedIntentions.length = 0;
    currentInput = new PointerInput(canvas, camera, {
      role,
      onIntention: (intention) => {
        emittedIntentions.push(intention);
        if (intention.type === 'panBy') {
          // Application du pan sur la caméra : effet inverse du mouvement du doigt / zoom
          camera.setPan(
            camera.x - intention.deltaX / camera.zoom,
            camera.y - intention.deltaY / camera.zoom
          );
        } else if (intention.type === 'pinchZoom') {
          camera.setZoom(camera.zoom * intention.scaleFactor);
        }
      },
    });
  },
  applyPanToIntention: (intention) => {
    if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
    }
  },
  testGridRowScan: async (levelOverrides, scanY) => {
    const level = createLevel(levelOverrides);
    const canvasWidth = level.grid.offsetX + level.widthCells * level.pxPerCell;
    const canvasHeight = level.grid.offsetY + level.heightCells * level.pxPerCell;
    app.renderer.resize(canvasWidth, canvasHeight);

    if (level.imageUrl) {
      await bgLayer.load(level.imageUrl);
    }

    const grid = new SquareGrid(level);
    gridLayer.render(grid);

    app.renderer.render(app.stage);

    const extracted = app.renderer.extract.pixels(app.stage);
    const width = extracted.width || canvasWidth;
    const height = extracted.height || canvasHeight;
    const pixels = extracted.pixels || extracted;

    /** @type {number[]} */
    const borderColumns = [];
    for (let x = 0; x < width; x++) {
      const idx = Math.floor(scanY * width + x) * 4;
      const alpha = pixels[idx + 3];
      if (alpha > 0) {
        borderColumns.push(x);
      }
    }

    return { width, height, borderColumns };
  },
  testTokensRender: async ({ levelOverrides = {}, tokensList = [], selectionData = null, options = {} }) => {
    const level = createLevel(levelOverrides);
    const canvasWidth = level.grid.offsetX + level.widthCells * level.pxPerCell;
    const canvasHeight = level.grid.offsetY + level.heightCells * level.pxPerCell;
    app.renderer.resize(canvasWidth, canvasHeight);

    // Ne pas afficher la grille pour le test d'extraction des pixels des pions
    gridLayer.graphics.clear();

    const grid = new SquareGrid(level);
    tokensLayer.render(grid, tokensList, selectionData, options);

    app.renderer.render(app.stage);

    const extracted = app.renderer.extract.pixels(app.stage);
    const width = extracted.width || canvasWidth;
    const height = extracted.height || canvasHeight;
    const pixels = extracted.pixels || extracted;

    /** @type {Record<string, number>} */
    const cellAlphaMap = {};
    /** @type {Record<string, { r: number, g: number, b: number, a: number }>} */
    const cellColorMap = {};

    for (let a = 0; a < level.widthCells; a++) {
      for (let b = 0; b < level.heightCells; b++) {
        const cx = level.grid.offsetX + (a + 0.5) * level.pxPerCell;
        const cy = level.grid.offsetY + (b + 0.5) * level.pxPerCell;
        const pxX = Math.floor(cx);
        const pxY = Math.floor(cy);

        let r = 0;
        let g = 0;
        let bCol = 0;
        let alpha = 0;

        if (pxX >= 0 && pxX < width && pxY >= 0 && pxY < height) {
          const idx = (pxY * width + pxX) * 4;
          r = pixels[idx] || 0;
          g = pixels[idx + 1] || 0;
          bCol = pixels[idx + 2] || 0;
          alpha = pixels[idx + 3] || 0;
        }

        const key = `${a},${b}`;
        cellAlphaMap[key] = alpha;
        cellColorMap[key] = { r, g, b: bCol, a: alpha };
      }
    }

    let hasElevationBadge = false;
    for (const child of layers.tokens.children) {
      if (child.children.some((c) => ('text' in c) || (c.constructor && c.constructor.name.includes('Text')))) {
        hasElevationBadge = true;
      }
    }

    return {
      width,
      height,
      renderedTokensCount: layers.tokens.children.length,
      cellAlphaMap,
      cellColorMap,
      hasElevationBadge,
    };
  },
  testMoveZoneRender: async ({ levelOverrides = {}, token = null, cellsReachableKeys = [] }) => {
    const level = createLevel(levelOverrides);
    const canvasWidth = level.grid.offsetX + level.widthCells * level.pxPerCell;
    const canvasHeight = level.grid.offsetY + level.heightCells * level.pxPerCell;
    app.renderer.resize(canvasWidth, canvasHeight);

    gridLayer.graphics.clear();
    tokensLayer.container.removeChildren();

    const grid = new SquareGrid(level);
    /** @type {Map<string, number>} */
    const cellsReachableMap = new Map();
    for (const key of cellsReachableKeys) {
      cellsReachableMap.set(key, 1);
    }

    const selectedTokenId = token ? token.id : null;
    moveZoneLayer.render(grid, selectedTokenId, cellsReachableMap, token);

    app.renderer.render(app.stage);

    const extracted = app.renderer.extract.pixels(app.stage);
    const width = extracted.width || canvasWidth;
    const height = extracted.height || canvasHeight;
    const pixels = extracted.pixels || extracted;

    /** @type {Record<string, number>} */
    const cellAlphaMap = {};

    for (let a = 0; a < level.widthCells; a++) {
      for (let b = 0; b < level.heightCells; b++) {
        const cx = level.grid.offsetX + (a + 0.5) * level.pxPerCell;
        const cy = level.grid.offsetY + (b + 0.5) * level.pxPerCell;
        const pxX = Math.floor(cx);
        const pxY = Math.floor(cy);

        let alpha = 0;
        if (pxX >= 0 && pxX < width && pxY >= 0 && pxY < height) {
          const idx = (pxY * width + pxX) * 4;
          alpha = pixels[idx + 3] || 0;
        }

        const key = `${a},${b}`;
        cellAlphaMap[key] = alpha;
      }
    }

    return {
      cellAlphaMap,
      eventMode: String(moveZoneLayer.container.eventMode),
    };
  },
};

/** @type {any} */ (window).__stageProbe = probe;

