// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLevel, createToken } from '../js/core/schema.js';
import { HexGrid } from '../js/grid/HexGrid.js';
import { TokensLayer } from '../js/render/layers/tokens.js';

const SQRT3 = Math.sqrt(3);

/**
 * Ctx instrumenté minimal : capture les rectangles peints par le repli « placeholder »
 * de `_drawToken` (pas d'image chargée), qui reçoit directement `p0.x, p0.y, width, height`.
 */
function createRecordingCtx() {
  /** @type {Array<{x: number, y: number, w: number, h: number}>} */
  const rects = [];
  return {
    rects,
    ctx: /** @type {any} */ ({
      save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
      moveTo: () => {}, lineTo: () => {}, arc: () => {}, ellipse: () => {}, clip: () => {},
      fill: () => {}, stroke: () => {}, strokeRect: () => {}, drawImage: () => {},
      fillText: () => {}, measureText: () => ({ width: 10 }),
      fillRect: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) => {
        rects.push({ x, y, w, h });
      },
      fillStyle: '', strokeStyle: '', lineWidth: 1,
      globalAlpha: 1, font: '', textAlign: 'center', textBaseline: 'middle',
    }),
  };
}

test('TokensLayer._drawToken (hexagonal) : boîte correcte en rangée paire et impaire — G-1', () => {
  const level = createLevel({ pxPerCell: 140, widthCells: 10, heightCells: 10, grid: { type: 'hex', offsetX: 0, offsetY: 0 } });
  const grid = new HexGrid(level);
  const layer = new TokensLayer();

  const tokenEven = createToken({ id: 'even', cell: { a: 5, b: 4 }, sizeCells: 1 }); // rangée paire
  const tokenOdd = createToken({ id: 'odd', cell: { a: 5, b: 5 }, sizeCells: 1 }); // rangée impaire

  const recEven = createRecordingCtx();
  layer.render(recEven.ctx, grid, [tokenEven], null, { activeLevelId: 'rdc' });
  const recOdd = createRecordingCtx();
  layer.render(recOdd.ctx, grid, [tokenOdd], null, { activeLevelId: 'rdc' });

  assert.equal(recEven.rects.length, 1);
  assert.equal(recOdd.rects.length, 1);

  const expectedWidth = 140;
  const expectedHeight = 140 * (2 / SQRT3);

  // Avant G-1 : 210 px en rangée paire, 70 px en rangée impaire (défaut C-5). Ce test
  // rougirait immédiatement sur l'ancien code, dans les deux rangées.
  assert.ok(Math.abs(recEven.rects[0].w - expectedWidth) < 1e-6, `largeur rangée paire = ${recEven.rects[0].w}`);
  assert.ok(Math.abs(recOdd.rects[0].w - expectedWidth) < 1e-6, `largeur rangée impaire = ${recOdd.rects[0].w}`);
  assert.ok(Math.abs(recEven.rects[0].h - expectedHeight) < 1e-6, `hauteur rangée paire = ${recEven.rects[0].h}`);
  assert.ok(Math.abs(recOdd.rects[0].h - expectedHeight) < 1e-6, `hauteur rangée impaire = ${recOdd.rects[0].h}`);
});

test('TokensLayer._drawToken (hexagonal) : pion Grand (taille 2) dessiné sur 2 hexagones de diamètre', () => {
  const level = createLevel({ pxPerCell: 140, widthCells: 10, heightCells: 10, grid: { type: 'hex', offsetX: 0, offsetY: 0 } });
  const grid = new HexGrid(level);
  const layer = new TokensLayer();

  const token = createToken({ id: 'big', cell: { a: 4, b: 4 }, sizeCells: 2 });
  const rec = createRecordingCtx();
  layer.render(rec.ctx, grid, [token], null, { activeLevelId: 'rdc' });

  assert.equal(rec.rects.length, 1);
  // Règle du MJ (18/11/2026) : un pion de taille 2 (Grand) est DESSINÉ sur 2 hexagones de diamètre
  // (280 px à 140 px/case), pas sur la rosette de 3 (420 px). L'emprise logique reste la rosette :
  // voir gridCellBounds.test.mjs.
  assert.equal(rec.rects[0].w, 280, 'deux hexagones de diamètre');
  assert.ok(
    Math.abs(rec.rects[0].h - 280 * (2 / SQRT3)) < 1e-6,
    `hauteur de l'hexagone mis à l'échelle, obtenu ${rec.rects[0].h}`
  );
});
