// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { MeasureLayer } from '../js/render/layers/measure.js';
import { createLevel } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';

// H2 (audit du 22/09/2026) — les tailles de la mesure étaient en pixels CARTE : au zoom « carte
// entière », l'étiquette de distance faisait 3 px. Elles sont en pixels écran, divisées par le
// zoom de la caméra.
test('H2 : l’étiquette et les pastilles de mesure gardent leur taille à l’écran, quel que soit le zoom', () => {
  const level = createLevel({ id: 'h2', widthCells: 20, heightCells: 20, pxPerCell: 100 });
  const grid = gridFor(level);
  /** @param {number} zoom */
  const relever = (zoom) => {
    /** @type {{fonts: string[], rayons: number[]}} */
    const r = { fonts: [], rayons: [] };
    const noop = () => {};
    const ctx = /** @type {any} */ ({
      save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
      fill: noop, fillText: noop, setLineDash: noop, roundRect: noop,
      measureText: () => ({ width: 40 }),
      arc: (/** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ rayon) => r.rayons.push(rayon),
      set font(/** @type {string} */ f) { r.fonts.push(f); },
    });
    new MeasureLayer().render(ctx, grid, level, {
      measure: { levelId: 'h2', start: { x: 150, y: 150 }, end: { x: 750, y: 150 } },
      camera: /** @type {any} */ ({ zoom }),
    });
    return r;
  };
  const proche = relever(1);
  const loin = relever(0.25);
  assert.match(proche.fonts[0], /\b14px\b/);
  assert.match(loin.fonts[0], /\b56px\b/, 'au zoom 0,25, 14 px écran = 56 px carte');
  assert.equal(loin.rayons[0], proche.rayons[0] * 4);
});

test('H2 : l’épaisseur des murs se donne en pixels écran', async () => {
  const { WallsLayer } = await import('../js/render/layers/walls.js');
  const level = createLevel({ id: 'h2m', widthCells: 10, heightCells: 10, pxPerCell: 100,
    walls: [[{ cellX: 1, cellY: 1 }, { cellX: 5, cellY: 1 }]] });
  /** @type {number[]} */
  const epaisseurs = [];
  const noop = () => {};
  const ctx = /** @type {any} */ ({
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    set lineWidth(/** @type {number} */ v) { epaisseurs.push(v); },
  });
  new WallsLayer().render(ctx, gridFor(level), level, null, 0.25);
  assert.equal(epaisseurs[0], 12, '3 px écran au zoom 0,25 = 12 px carte');
});
