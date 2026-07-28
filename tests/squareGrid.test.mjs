import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';

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

