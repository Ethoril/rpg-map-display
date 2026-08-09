import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { screenToMapPoint } from '../js/render/camera.js';

test('gridFor(level) instaure SquareGrid ou lève sur hex/inconnu', () => {
  const squareLevel = createLevel({ grid: { type: 'square', offsetX: 10, offsetY: 20 } });
  const grid = gridFor(squareLevel);
  assert.ok(grid instanceof SquareGrid);
  assert.equal(grid.type, 'square');

  const hexLevel = createLevel({ grid: { type: 'hex', offsetX: 0, offsetY: 0 } });
  assert.throws(() => gridFor(hexLevel), /Grille hexagonale non supportée/);

  // Type de grille volontairement invalide : un document de campagne peut arriver de
  // Firestore ou du LocalStorage avec n'importe quoi dedans, et le refus doit se produire
  // À L'EXÉCUTION. D'où un transtypage ciblé et non un `@ts-ignore` (interdit, §8 n°16) :
  // le reste de la ligne continue d'être vérifié.
  const grilleInvalide =
    /** @type {import('../js/core/types.js').GridConfig} */
    (/** @type {unknown} */ ({ type: 'triangle', offsetX: 0, offsetY: 0 }));
  const unknownLevel = createLevel({ grid: grilleInvalide });
  assert.throws(() => gridFor(unknownLevel), /Type de grille inconnu/);
});

test('Roundtrip cellFromPoint(pointFromCell(c)) sur 100 cases y compris bords', () => {
  const level = createLevel({
    pxPerCell: 100,
    widthCells: 20,
    heightCells: 20,
    grid: { type: 'square', offsetX: 15, offsetY: 25 },
  });
  const grid = gridFor(level);

  let checkedCount = 0;
  for (let a = 0; a < 20; a += 2) {
    for (let b = 0; b < 20; b += 2) {
      const cell = { a, b };
      const point = grid.pointFromCell(cell);
      const res = grid.cellFromPoint(point);
      assert.deepEqual(res, cell, `Incohérence roundtrip pour case (${a}, ${b})`);
      checkedCount++;
    }
  }
  assert.ok(checkedCount >= 100, `Au moins 100 cases testées (${checkedCount})`);

  // Hors carte
  assert.equal(grid.cellFromPoint({ x: 0, y: 0 }), null, 'Devrait être null hors offset');
  assert.equal(grid.cellFromPoint({ x: 10000, y: 10000 }), null, 'Devrait être null hors carte');
});

test('Distances octiles sur 10 paires connues', () => {
  const level = createLevel();
  const grid = gridFor(level);

  const pairs = [
    { a: { a: 0, b: 0 }, b: { a: 0, b: 0 }, expected: 0 },
    { a: { a: 0, b: 0 }, b: { a: 3, b: 0 }, expected: 3 },
    { a: { a: 0, b: 0 }, b: { a: 0, b: 4 }, expected: 4 },
    { a: { a: 0, b: 0 }, b: { a: 1, b: 1 }, expected: 1.5 },
    { a: { a: 0, b: 0 }, b: { a: 2, b: 2 }, expected: 3.0 },
    { a: { a: 0, b: 0 }, b: { a: 3, b: 1 }, expected: 3.5 }, // max 3, min 1 -> 3 + 0.5 = 3.5
    { a: { a: 2, b: 5 }, b: { a: 5, b: 2 }, expected: 4.5 }, // dx 3, dy 3 -> 3 + 1.5 = 4.5
    { a: { a: 10, b: 10 }, b: { a: 10, b: 20 }, expected: 10 },
    { a: { a: 10, b: 10 }, b: { a: 15, b: 20 }, expected: 12.5 }, // dx 5, dy 10 -> 10 + 2.5 = 12.5
    { a: { a: 1, b: 1 }, b: { a: 4, b: 5 }, expected: 5.5 }, // dx 3, dy 4 -> 4 + 1.5 = 5.5
  ];

  for (const { a, b, expected } of pairs) {
    const dist = grid.distance(a, b);
    assert.equal(dist, expected, `Distance entre (${a.a},${a.b}) et (${b.a},${b.b}) doit valoir ${expected}`);
  }
});

test('neighbors retourne 8 voisines au centre et moins sur les bords', () => {
  const level = createLevel({ widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);

  // Centre
  const centerNeighbors = grid.neighbors({ a: 5, b: 5 });
  assert.equal(centerNeighbors.length, 8);

  // Coin haut-gauche
  const cornerNeighbors = grid.neighbors({ a: 0, b: 0 });
  assert.equal(cornerNeighbors.length, 3);
  assert.deepEqual(cornerNeighbors, [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 1 }]);

  // Bord droit
  const borderNeighbors = grid.neighbors({ a: 9, b: 5 });
  assert.equal(borderNeighbors.length, 5);
});

test('cellsOccupied génère les blocs n×n appropriés', () => {
  const level = createLevel();
  const grid = gridFor(level);

  const occ1 = grid.cellsOccupied({ a: 2, b: 3 }, 1);
  assert.deepEqual(occ1, [{ a: 2, b: 3 }]);

  const occ2 = grid.cellsOccupied({ a: 2, b: 3 }, 2);
  assert.equal(occ2.length, 4);
  assert.deepEqual(occ2, [
    { a: 2, b: 3 },
    { a: 2, b: 4 },
    { a: 3, b: 3 },
    { a: 3, b: 4 },
  ]);

  const occ3 = grid.cellsOccupied({ a: 0, b: 0 }, 3);
  assert.equal(occ3.length, 9);
});

test('Conversion aux 4 coins et sous différents zooms et offsets via SquareGrid.cellFromPoint', () => {
  const level = createLevel({
    pxPerCell: 100,
    widthCells: 10,
    heightCells: 8,
    grid: { type: 'square', offsetX: 50, offsetY: 20 },
  });
  const grid = gridFor(level);

  // 1. Coin supérieur gauche de la case (0, 0)
  assert.deepEqual(grid.cellFromPoint({ x: 50, y: 20 }), { a: 0, b: 0 });

  // 2. Centre de la case (2, 3)
  assert.deepEqual(grid.cellFromPoint({ x: 280, y: 350 }), { a: 2, b: 3 });

  // 3. Coin inférieur droit de la case (9, 7)
  assert.deepEqual(grid.cellFromPoint({ x: 1049, y: 819 }), { a: 9, b: 7 });

  // 4. Hors limites (gauche/haut/droite/bas)
  assert.equal(grid.cellFromPoint({ x: 49, y: 20 }), null);
  assert.equal(grid.cellFromPoint({ x: 50, y: 19 }), null);
  assert.equal(grid.cellFromPoint({ x: 1050, y: 500 }), null);
  assert.equal(grid.cellFromPoint({ x: 500, y: 820 }), null);

  // 5. Test sous une autre densité pxPerCell (e.g. 70 px/case)
  const levelZoom = createLevel({
    pxPerCell: 70,
    widthCells: 10,
    heightCells: 10,
    grid: { type: 'square', offsetX: 50, offsetY: 20 },
  });
  const gridZoom = gridFor(levelZoom);
  assert.deepEqual(gridZoom.cellFromPoint({ x: 190, y: 160 }), { a: 2, b: 2 });
});

test('Composée écran -> pixels carte -> case (via screenToMapPoint + SquareGrid.cellFromPoint)', () => {
  const level = createLevel({
    pxPerCell: 140,
    widthCells: 40,
    heightCells: 30,
    grid: { type: 'square', offsetX: 0, offsetY: 0 },
  });
  const grid = gridFor(level);

  const rect = { left: 50, top: 100 };
  const mapPanX = 120;
  const mapPanY = -40;
  const mapZoom = 1.5;

  // Case (3, 4) : centre carte x = 3.5 * 140 = 490, y = 4.5 * 140 = 630
  // clientX = 50 + 120 + 490 * 1.5 = 905
  // clientY = 100 - 40 + 630 * 1.5 = 1005
  const pt1 = screenToMapPoint(
    { clientX: 905, clientY: 1005 },
    { rectLeft: rect.left, rectTop: rect.top, panX: mapPanX, panY: mapPanY, zoom: mapZoom }
  );
  const cellTarget = grid.cellFromPoint(pt1);
  assert.deepEqual(cellTarget, { a: 3, b: 4 });

  // Test sous zoom arrière (mapZoom = 0.5) et décalage inverse
  const zoomOut = 0.5;
  const panOutX = -50;
  const panOutY = 30;

  // Case (1, 2) : coin sup gauche carte x = 140, y = 280
  // clientX = 50 - 50 + 140 * 0.5 = 70
  // clientY = 100 + 30 + 280 * 0.5 = 270
  const pt2 = screenToMapPoint(
    { clientX: 70, clientY: 270 },
    { rectLeft: rect.left, rectTop: rect.top, panX: panOutX, panY: panOutY, zoom: zoomOut }
  );
  const cellTargetZoomOut = grid.cellFromPoint(pt2);
  assert.deepEqual(cellTargetZoomOut, { a: 1, b: 2 });
});


