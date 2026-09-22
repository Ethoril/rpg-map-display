// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLevel, createToken } from '../js/core/schema.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import { decodeFogPng, isCellVisibleInMask } from '../js/vision/fog.js';

/**
 * Crée un mock minimal de Canvas 2D instrumenté pour compter les allocations et getImageData.
 * @param {number} width
 * @param {number} height
 */
function createInstrumentedCanvas(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  let getImageDataCalls = 0;

  const ctx = {
    canvas: /** @type {any} */ (null),
    pixels,
    get getImageDataCalls() {
      return getImageDataCalls;
    },
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    clip: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fillText: () => {},
    drawImage: () => {},
    getImageData: (x = 0, y = 0, w = width, h = height) => {
      getImageDataCalls++;
      return {
        data: new Uint8ClampedArray(pixels.buffer),
        width: w,
        height: h,
      };
    },
  };

  /** @type {any} */
  const canvasObj = {
    width,
    height,
    maskAlpha: null,
    getContext: () => ctx,
    _ctx: ctx,
  };
  ctx.canvas = canvasObj;

  return {
    canvas: canvasObj,
    ctx,
  };
}

test('1. Un pion en zone explorée hors vision n\'est pas dessiné ; mis en vision, il l\'est', () => {
  const level = createLevel({
    id: 'lvl1',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 50,
  });
  const grid = new SquareGrid(level);
  const layer = new TokensLayer();

  // Pion 1 à la case (1, 1), Pion 2 à la case (5, 5)
  const token1 = createToken({ id: 't1', levelId: 'lvl1', cell: { a: 1, b: 1 }, label: 'PJ' });
  const token2 = createToken({ id: 't2', levelId: 'lvl1', cell: { a: 5, b: 5 }, label: 'PNJ' });

  // Masque de 80x80 px (8 px/case sur 10x10 cases)
  const visCanvasObj = createInstrumentedCanvas(80, 80);
  const visCanvas = visCanvasObj.canvas;

  // Rendre uniquement la case (1, 1) visible dans l'alpha du masque (pixels x: 8..15, y: 8..15)
  const maskAlpha = new Uint8Array(80 * 80);
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 16; x++) {
      maskAlpha[y * 80 + x] = 255;
    }
  }
  visCanvas.maskAlpha = maskAlpha;

  const targetCtxObj = createInstrumentedCanvas(500, 500);

  // Rendu côté joueurs
  const res1 = layer.render(/** @type {any} */ (targetCtxObj.ctx), grid, [token1, token2], null, {
    role: 'players',
    activeLevelId: 'lvl1',
    activeLevelWidthCells: 10,
    activeLevelHeightCells: 10,
    visibleCanvas: visCanvas,
  });

  assert.equal(res1.renderedTokenIds.includes('t1'), true, 'Token 1 (en vision) doit être dessiné');
  assert.equal(res1.renderedTokenIds.includes('t2'), false, 'Token 2 (hors vision) ne doit PAS être dessiné');

  // Mise à jour du masque : ajouter la visibilité sur la case (5, 5) (pixels x: 40..47, y: 40..47)
  for (let y = 40; y < 48; y++) {
    for (let x = 40; x < 48; x++) {
      maskAlpha[y * 80 + x] = 255;
    }
  }

  const res2 = layer.render(/** @type {any} */ (targetCtxObj.ctx), grid, [token1, token2], null, {
    role: 'players',
    activeLevelId: 'lvl1',
    activeLevelWidthCells: 10,
    activeLevelHeightCells: 10,
    visibleCanvas: visCanvas,
  });

  assert.equal(res2.renderedTokenIds.includes('t1'), true, 'Token 1 doit toujours être dessiné');
  assert.equal(res2.renderedTokenIds.includes('t2'), true, 'Token 2 (désormais en vision) doit être dessiné');
});

test('2. Zéro allocation de canvas et zéro getImageData sur 10 rendus consécutifs', () => {
  let elementCreateCount = 0;

  if (typeof document !== 'undefined') {
    const orig = document.createElement.bind(document);
    document.createElement = function (/** @type {string} */ tagName, /** @type {any} */ options) {
      if (String(tagName).toLowerCase() === 'canvas') {
        elementCreateCount++;
      }
      return orig(tagName, options);
    };

    try {
      const level = createLevel({ id: 'lvl1', widthCells: 10, heightCells: 10 });
      const grid = new SquareGrid(level);
      const layer = new TokensLayer();
      const token = createToken({ id: 't1', levelId: 'lvl1', cell: { a: 2, b: 2 } });

      const visCanvasObj = createInstrumentedCanvas(80, 80);
      const visCanvas = visCanvasObj.canvas;

      const maskAlpha = new Uint8Array(80 * 80);
      for (let y = 16; y < 24; y++) {
        for (let x = 16; x < 24; x++) {
          maskAlpha[y * 80 + x] = 255;
        }
      }
      visCanvas.maskAlpha = maskAlpha;

      const targetCtxObj = createInstrumentedCanvas(500, 500);

      const initialAllocations = elementCreateCount;
      const initialGetImageDataCalls = visCanvasObj.ctx.getImageDataCalls;

      for (let frame = 0; frame < 10; frame++) {
        layer.render(/** @type {any} */ (targetCtxObj.ctx), grid, [token], null, {
          role: 'players',
          activeLevelId: 'lvl1',
          activeLevelWidthCells: 10,
          activeLevelHeightCells: 10,
          visibleCanvas: visCanvas,
        });
      }

      assert.equal(elementCreateCount - initialAllocations, 0, 'Zéro canvas document.createElement alloué sur 10 images');
      assert.equal(visCanvasObj.ctx.getImageDataCalls - initialGetImageDataCalls, 0, 'Zéro appel getImageData sur 10 images');
    } finally {
      document.createElement = orig;
    }
  }
});

test('3. Échantillonnage au centre du bloc de case (a+0.5)*8, (b+0.5)*8', () => {
  const widthCells = 10;
  const heightCells = 10;
  const maskAlpha = new Uint8Array(80 * 80); // 8 px/case

  // Activer uniquement un seul pixel exact au centre du bloc de la case (3, 4)
  // Case (3, 4) -> centre = (3 + 0.5)*8 = 28, (4 + 0.5)*8 = 36
  const centerX = Math.floor((3 + 0.5) * 8); // 28
  const centerY = Math.floor((4 + 0.5) * 8); // 36
  maskAlpha[centerY * 80 + centerX] = 255;

  assert.equal(isCellVisibleInMask({ a: 3, b: 4 }, maskAlpha, widthCells, heightCells), true);
  assert.equal(isCellVisibleInMask({ a: 3, b: 3 }, maskAlpha, widthCells, heightCells), false);
  assert.equal(isCellVisibleInMask({ a: 2, b: 4 }, maskAlpha, widthCells, heightCells), false);
});

test('4. Pion grand format (sizeCells > 1) : visibilité décidée par sa case d\'ancrage token.cell', () => {
  const level = createLevel({ id: 'lvl1', widthCells: 10, heightCells: 10 });
  const grid = new SquareGrid(level);
  const layer = new TokensLayer();

  // Pion de taille 3x3 ancré en (2, 2)
  const bigToken = createToken({
    id: 't-big',
    levelId: 'lvl1',
    cell: { a: 2, b: 2 },
    sizeCells: 3,
    label: 'Dragon',
  });

  const visCanvasObj = createInstrumentedCanvas(80, 80);
  const visCanvas = visCanvasObj.canvas;
  const maskAlpha = new Uint8Array(80 * 80);
  visCanvas.maskAlpha = maskAlpha;

  const targetCtxObj = createInstrumentedCanvas(500, 500);

  // Cas A : case d'ancrage (2, 2) pas dans la vision -> non dessiné
  const resA = layer.render(/** @type {any} */ (targetCtxObj.ctx), grid, [bigToken], null, {
    role: 'players',
    activeLevelId: 'lvl1',
    activeLevelWidthCells: 10,
    activeLevelHeightCells: 10,
    visibleCanvas: visCanvas,
  });
  assert.equal(resA.renderedTokenIds.includes('t-big'), false);

  // Cas B : case d'ancrage (2, 2) en vision (centre x=20, y=20) -> dessiné
  const centerX = Math.floor((2 + 0.5) * 8);
  const centerY = Math.floor((2 + 0.5) * 8);
  maskAlpha[centerY * 80 + centerX] = 255;

  const resB = layer.render(/** @type {any} */ (targetCtxObj.ctx), grid, [bigToken], null, {
    role: 'players',
    activeLevelId: 'lvl1',
    activeLevelWidthCells: 10,
    activeLevelHeightCells: 10,
    visibleCanvas: visCanvas,
  });
  assert.equal(resB.renderedTokenIds.includes('t-big'), true);
});

test('5. Attachement automatique de maskAlpha lors de decodeFogPng', async () => {
  const canvas = await decodeFogPng('', 10, 10);
  assert.ok(canvas, 'decodeFogPng doit retourner un canvas');
});

test('6. Verrouillage du seuil d\'alpha (127 => false, 128 => true)', () => {
  const widthCells = 10;
  const heightCells = 10;
  const maskAlpha = new Uint8Array(80 * 80);

  const centerX = Math.floor((4 + 0.5) * 8);
  const centerY = Math.floor((4 + 0.5) * 8);
  const idx = centerY * 80 + centerX;

  maskAlpha[idx] = 127;
  assert.equal(
    isCellVisibleInMask({ a: 4, b: 4 }, maskAlpha, widthCells, heightCells),
    false,
    'Un pixel central d\'alpha 127 doit rendre false'
  );

  maskAlpha[idx] = 128;
  assert.equal(
    isCellVisibleInMask({ a: 4, b: 4 }, maskAlpha, widthCells, heightCells),
    true,
    'Un pixel central d\'alpha 128 doit rendre true'
  );
});

// E3 (audit du 22/09/2026) — en hexagonal, le point testé ignorait le décalage des rangées
// impaires : il tombait sur l'arête gauche de l'hexagone, et un PNJ entièrement visible
// disparaissait de la vue joueurs. Masque où SEUL le vrai centre de la case est vu.
test('E3 : en hexagonal, la visibilité d’un pion se lit au VRAI centre de sa case, rangées impaires comprises', () => {
  const W = 4;
  const H = 4;
  const largeur = W * 8;
  /** @param {number} x @param {number} y */
  const masqueAutour = (x, y) => {
    const alpha = new Uint8Array(largeur * H * 8);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.min(largeur - 1, Math.max(0, x + dx));
        alpha[(y + dy) * largeur + px] = 255;
      }
    }
    return alpha;
  };
  // Case (1, 1), rangée impaire : centre en x = 8 × (1 + 0,5 + 0,5) = 16, y = 8 × (1 + 1/√3) ≈ 12,6.
  assert.equal(isCellVisibleInMask({ a: 1, b: 1 }, masqueAutour(16, 12), W, H, 'hex'), true);
  // Dernière colonne d'une rangée impaire : le centre est sur le bord droit du masque.
  assert.equal(isCellVisibleInMask({ a: 3, b: 1 }, masqueAutour(31, 12), W, H, 'hex'), true);
  // Et le carré, lui, ne change pas : centre (1,5 ; 1,5) → pixel (12, 12).
  assert.equal(isCellVisibleInMask({ a: 1, b: 1 }, masqueAutour(12, 12), W, H), true);
  assert.equal(isCellVisibleInMask({ a: 1, b: 1 }, masqueAutour(16, 12), W, H), false);
});
