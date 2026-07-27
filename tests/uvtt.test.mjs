import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseUvtt } from '../js/import/uvtt.js';
import { calibrateImage, calibrateFromRect } from '../js/import/imageCalibrate.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';
import { createLevel } from '../js/core/schema.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';

test('parseUvtt sur minimal.uvtt (unités de case et absence d’effet de pixels)', () => {
  const minimalPath = path.resolve('fixtures/synthetic/minimal.uvtt');
  const jsonStr = fs.readFileSync(minimalPath, 'utf-8');
  const res = parseUvtt(jsonStr);

  assert.ok(res.level);
  assert.equal(res.level.pxPerCell, 64);
  assert.equal(res.level.widthCells, 10);
  assert.equal(res.level.heightCells, 8);
  assert.equal(res.level.grid.type, 'square');
  assert.equal(res.level.ambient.baked, false);

  // Vérifier que les coordonnées de murs sont en unités de case (cellX, cellY) et non en pixels
  assert.equal(res.walls.length, 1);
  const poly = res.walls[0];
  assert.deepEqual(poly[0], { cellX: 2, cellY: 2 });
  assert.deepEqual(poly[1], { cellX: 8, cellY: 2 });

  // Portails en unités de case
  assert.equal(res.portals.length, 1);
  assert.deepEqual(res.portals[0].a, { cellX: 4.5, cellY: 2 });
  assert.deepEqual(res.portals[0].b, { cellX: 5.5, cellY: 2 });
  assert.equal(res.portals[0].closed, true);

  // Lumière en unités de case
  assert.equal(res.lights.length, 1);
  assert.deepEqual(res.lights[0].at, { cellX: 5, cellY: 4 });
  assert.equal(res.lights[0].range, 3);
});

test('parseUvtt avec map_origin non nul (offset-origin.uvtt et valeurs négatives/décimales)', () => {
  const offsetPath = path.resolve('fixtures/synthetic/offset-origin.uvtt');
  const jsonStr = fs.readFileSync(offsetPath, 'utf-8');
  const res = parseUvtt(jsonStr);

  // origin: { x: 1.5, y: 0.5 }, pxPerCell: 64 -> offsetX = 1.5 * 64 = 96, offsetY = 0.5 * 64 = 32
  assert.equal(res.grid.offsetX, 96);
  assert.equal(res.grid.offsetY, 32);

  // Test avec coordonnées négatives dans map_origin
  const negativeOriginUvtt = {
    resolution: {
      map_origin: { x: -2, y: -1.5 },
      map_size: { x: 10, y: 8 },
      pixels_per_grid: 100,
    },
    line_of_sight: [[{ x: -1, y: -0.5 }, { x: 5, y: 5 }]],
  };

  const resNeg = parseUvtt(negativeOriginUvtt);
  assert.equal(resNeg.grid.offsetX, -200);
  assert.equal(resNeg.grid.offsetY, -150);
  assert.deepEqual(resNeg.walls[0][0], { cellX: -1, cellY: -0.5 });
});

test('parseUvtt détecte baked_lighting', () => {
  const bakedPath = path.resolve('fixtures/synthetic/baked-lighting.uvtt');
  const jsonStr = fs.readFileSync(bakedPath, 'utf-8');
  const res = parseUvtt(jsonStr);

  assert.equal(res.level.ambient.baked, true);
  assert.ok(res.warnings.some((w) => w.includes('baked_lighting')));
});

test('parseUvtt refuse le type hex', () => {
  const hexUvtt = {
    grid_type: 'hex',
    resolution: { pixels_per_grid: 64, map_size: { x: 10, y: 8 } },
  };
  assert.throws(() => parseUvtt(hexUvtt), /Grille hexagonale non supportée/);
});

test('calibrateImage et calibrateFromRect', () => {
  // Rect: w=700, cellsWide=5 -> pxPerCell=140, offsetX=30, imageSize 1400x1120 -> 10x8 cases
  const cal1 = calibrateFromRect({
    rectPx: { x: 30, y: 15, w: 700, h: 700 },
    cellsWide: 5,
    imageSize: { w: 1400, h: 1120 },
  });

  assert.equal(cal1.pxPerCell, 140);
  assert.equal(cal1.offsetX, 30);
  assert.equal(cal1.offsetY, 15);
  assert.equal(cal1.widthCells, 10);
  assert.equal(cal1.heightCells, 8);

  // Calibration par clics
  const p1 = { x: 100, y: 50 };
  const p2 = { x: 300, y: 50 };
  const cal2 = calibrateImage(p1, p2, 2, 1000, 800);

  assert.equal(cal2.pxPerCell, 100);
  assert.equal(cal2.widthCells, 10);
  assert.equal(cal2.heightCells, 8);
});

test('computeBlockedEdges (stub lot 1a) retourne un Set vide', () => {
  const level = createLevel();
  const grid = new SquareGrid(level);
  const edges = computeBlockedEdges(level, grid);

  assert.ok(edges instanceof Set);
  assert.equal(edges.size, 0);
});
