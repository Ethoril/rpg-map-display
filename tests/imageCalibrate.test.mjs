import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateImage, calibrateFromRect } from '../js/import/imageCalibrate.js';

// Fichier de test prévu par le contrat de T-12. Ces cas vivaient dans uvtt.test.mjs,
// où ils n'avaient rien à faire : le parsing UVTT et la calibration d'image sont les
// deux sources de carte, indépendantes l'une de l'autre.

test('calibrateFromRect : 700 px sur 5 cases donne pxPerCell = 140', () => {
  // Rect w=700 sur 5 cases → pxPerCell=140 ; offset déduit d'un rect non aligné sur 0,0.
  const cal = calibrateFromRect({
    rectPx: { x: 30, y: 15, w: 700, h: 700 },
    cellsWide: 5,
    imageSize: { w: 1400, h: 1120 },
  });

  assert.equal(cal.pxPerCell, 140);
  assert.equal(cal.offsetX, 30);
  assert.equal(cal.offsetY, 15);
  assert.equal(cal.widthCells, 10);
  assert.equal(cal.heightCells, 8);
});

test('calibrateImage : calibration par deux clics', () => {
  const p1 = { x: 100, y: 50 };
  const p2 = { x: 300, y: 50 };
  const cal = calibrateImage(p1, p2, 2, 1000, 800);

  assert.equal(cal.pxPerCell, 100);
  assert.equal(cal.widthCells, 10);
  assert.equal(cal.heightCells, 8);
});
