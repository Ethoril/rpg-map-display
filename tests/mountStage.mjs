// @ts-check
// Sonde navigateur contre le vrai CanvasRenderingContext2D.

import { initStage, renderLayerStack } from '../js/render/stage.js';
import { FrameLoop } from '../js/render/frame.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { GridLayer } from '../js/render/layers/gridLayer.js';
import { BackgroundLayer } from '../js/render/layers/background.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import { MoveZoneLayer } from '../js/render/layers/moveZone.js';
import { createLevel } from '../js/core/schema.js';
import { Camera } from '../js/render/camera.js';
import { PointerInput } from '../js/input/pointer.js';

let canvas = /** @type {HTMLCanvasElement|null} */ (document.getElementById('board'));
if (!canvas) {
  canvas = document.createElement('canvas');
  canvas.id = 'board';
  document.body.appendChild(canvas);
}

const stage = await initStage(canvas);
const { canvas: canvasElem, context, resolution } = stage;
const loop = new FrameLoop(() => {});
const gridLayer = new GridLayer();
let tokenInvalidations = 0;
const tokensLayer = new TokensLayer({ invalidate: () => tokenInvalidations++ });
const moveZoneLayer = new MoveZoneLayer();

/** @type {string[]} */
const layerOrder = [];
renderLayerStack({
  background: () => layerOrder.push('background'),
  grid: () => layerOrder.push('grid'),
  moveZone: () => layerOrder.push('moveZone'),
  templates: () => layerOrder.push('templates'),
  tokens: () => layerOrder.push('tokens'),
  fog: () => layerOrder.push('fog'),
});

const camera = new Camera(stage.width, stage.height);
/** @type {import('../js/input/gestures.js').InputIntention[]} */
const emittedIntentions = [];
/** @type {PointerInput|null} */
let currentInput = null;

/** @param {number} width @param {number} height */
function resetCanvas(width, height) {
  canvasElem.width = width;
  canvasElem.height = height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray} pixels
 * @param {number} x
 * @param {number} y
 */
function pixelAt(width, height, pixels, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return { r: 0, g: 0, b: 0, a: 0 };
  const index = (Math.floor(y) * width + Math.floor(x)) * 4;
  return {
    r: pixels[index] || 0,
    g: pixels[index + 1] || 0,
    b: pixels[index + 2] || 0,
    a: pixels[index + 3] || 0,
  };
}

const probe = {
  layerOrder,
  resolution,
  logicalSize: () => ({
    width: stage.width,
    height: stage.height,
    backingWidth: canvasElem.width,
    backingHeight: canvasElem.height,
  }),
  frameCount: () => loop.frameCount,
  loopRunning: () => loop.running,
  requestFrames: (/** @type {number} */ n) => {
    for (let index = 0; index < n; index++) loop.requestFrame();
  },
  camera,
  getIntentions: () => [...emittedIntentions],
  clearIntentions: () => {
    emittedIntentions.length = 0;
  },
  setupInput: (
    /** @type {'gm'|'players'} */ role = 'players',
    /** @type {boolean} */ canDrag = true,
    /**
     * Seuils temporels, à surcharger quand un test doit maintenir l'appui dans
     * une fenêtre bornée — voir le commentaire de `waitForIntention` dans
     * `tests/input.spec.mjs`.
     * @type {{longPressMs?: number, dragHoldMs?: number}}
     */
    options = {}
  ) => {
    currentInput?.detach();
    emittedIntentions.length = 0;
    currentInput = new PointerInput(canvasElem, camera, {
      role,
      ...options,
      canStartTokenDrag: (_screenPoint, _mapPoint) =>
        role === 'gm' && canDrag ? 'probe-token' : null,
      onIntention: (intention) => {
        emittedIntentions.push(intention);
        if (intention.type === 'panBy') {
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
  applyPanToIntention: (/** @type {any} */ intention) => {
    if (intention.type === 'panBy') {
      camera.setPan(
        camera.x - intention.deltaX / camera.zoom,
        camera.y - intention.deltaY / camera.zoom
      );
    }
  },
  testGridRowScan: async (
    /** @type {any} */ levelOverrides,
    /** @type {number} */ scanY
  ) => {
    const level = createLevel(levelOverrides);
    const width = level.grid.offsetX + level.widthCells * level.pxPerCell + 2;
    const height = level.grid.offsetY + level.heightCells * level.pxPerCell + 2;
    resetCanvas(width, height);
    gridLayer.render(context, new SquareGrid(level));
    const pixels = context.getImageData(0, 0, width, height).data;
    /** @type {number[]} */
    const borderColumns = [];
    for (let x = 0; x < width; x++) {
      if (pixelAt(width, height, pixels, x, scanY).a > 0) borderColumns.push(x);
    }
    return { width, height, borderColumns };
  },
  testBackgroundLoad: async (/** @type {string} */ url) => {
    let invalidations = 0;
    const layer = new BackgroundLayer({ invalidate: () => invalidations++ });
    await layer.load(url);
    resetCanvas(120, 80);
    layer.render(context, 120, 80, { role: 'gm' });
    const pixels = context.getImageData(0, 0, 120, 80).data;
    return {
      status: layer.status,
      invalidations,
      center: pixelAt(120, 80, pixels, 60, 40),
    };
  },
  testBackgroundRaceAndRetry: async () => {
    /** @type {any[]} */
    const images = [];
    const imageFactory = () => {
      const image = {
        src: '',
        naturalWidth: 10,
        naturalHeight: 10,
        width: 10,
        height: 10,
        onload: null,
        onerror: null,
      };
      images.push(image);
      return /** @type {HTMLImageElement} */ (/** @type {unknown} */ (image));
    };
    let invalidations = 0;
    const layer = new BackgroundLayer({ imageFactory, invalidate: () => invalidations++ });
    const first = layer.load('/first.webp');
    const second = layer.load('/second.webp');
    images[0].onload();
    await first;
    const afterObsolete = { status: layer.status, hasImage: Boolean(layer.image), invalidations };
    images[1].onerror(new Error('404'));
    await second;
    const afterError = { status: layer.status, invalidations };
    const retry = layer.retry();
    images[2].onload();
    await retry;
    return {
      afterObsolete,
      afterError,
      afterRetry: {
        status: layer.status,
        currentUrl: layer.currentUrl,
        invalidations,
      },
    };
  },
  testTokensRender: async (/** @type {any} */ {
    levelOverrides = {},
    tokensList = [],
    selectionData = null,
    options = {},
  }) => {
    const level = createLevel(levelOverrides);
    const width = level.grid.offsetX + level.widthCells * level.pxPerCell;
    const height = level.grid.offsetY + level.heightCells * level.pxPerCell;
    await Promise.all(tokensList.map((/** @type {any} */ token) => tokensLayer.preload(token.imageUrl)));
    resetCanvas(width, height);
    const grid = new SquareGrid(level);
    const result = tokensLayer.render(context, grid, tokensList, selectionData, {
      role: options.role,
      isGM: options.isGM,
      activeLevelId: options.activeLevelId ?? level.id,
      now: options.now,
      dragPreview: options.dragPreview,
    });
    const pixels = context.getImageData(0, 0, width, height).data;
    /** @type {Record<string, number>} */
    const cellAlphaMap = {};
    /** @type {Record<string, {r:number,g:number,b:number,a:number}>} */
    const cellColorMap = {};
    for (let a = 0; a < level.widthCells; a++) {
      for (let b = 0; b < level.heightCells; b++) {
        const point = grid.pointFromCell({ a, b });
        const pixel = pixelAt(width, height, pixels, point.x, point.y);
        cellAlphaMap[`${a},${b}`] = pixel.a;
        cellColorMap[`${a},${b}`] = pixel;
      }
    }
    return {
      renderedTokenIds: result.renderedTokenIds,
      animationActive: result.animationActive,
      cellAlphaMap,
      cellColorMap,
      invalidations: tokenInvalidations,
    };
  },
  testMoveZoneRender: async (/** @type {any} */ {
    levelOverrides = {},
    token = null,
    cellsReachableKeys = [],
  }) => {
    const level = createLevel(levelOverrides);
    const width = level.grid.offsetX + level.widthCells * level.pxPerCell;
    const height = level.grid.offsetY + level.heightCells * level.pxPerCell;
    resetCanvas(width, height);
    const grid = new SquareGrid(level);
    const reachableCells = new Map(cellsReachableKeys.map((/** @type {string} */ key) => [key, 1]));
    const renderedCells = moveZoneLayer.render(context, grid, {
      selectedToken: token,
      reachableCells,
    });
    const pixels = context.getImageData(0, 0, width, height).data;
    /** @type {Record<string, number>} */
    const cellAlphaMap = {};
    for (let a = 0; a < level.widthCells; a++) {
      for (let b = 0; b < level.heightCells; b++) {
        const point = grid.pointFromCell({ a, b });
        cellAlphaMap[`${a},${b}`] = pixelAt(width, height, pixels, point.x, point.y).a;
      }
    }
    return { cellAlphaMap, renderedCells };
  },
};

/** @type {any} */ (window).__stageProbe = probe;
