import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { cellKey, edgeKey } from '../js/core/cellKey.js';
import { computeReachable, reachableCells } from '../js/movement/reachable.js';
import { reconstructPath, findPath } from '../js/movement/path.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';

test('cellsInRange sur grille 10x10 sans obstacle', () => {
  const level = createLevel({ widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);
  const from = { a: 5, b: 5 };
  const emptyBlocked = new Set();

  // Budget 1.0 -> 4 cases orthogonales (coût 1.0)
  const range1 = grid.cellsInRange(from, 1.0, emptyBlocked);
  assert.equal(range1.size, 4, 'Budget 1.0 doit donner 4 cases orthogonales');

  // Budget 1.5 -> 8 cases (4 orthogonales à 1.0 + 4 diagonales à 1.5)
  const range1_5 = grid.cellsInRange(from, 1.5, emptyBlocked);
  assert.equal(range1_5.size, 8, 'Budget 1.5 doit donner 8 cases (1 anneau)');

  // Vérifier les 8 cases autour de (5,5)
  for (let da = -1; da <= 1; da++) {
    for (let db = -1; db <= 1; db++) {
      if (da === 0 && db === 0) continue;
      const key = cellKey({ a: 5 + da, b: 5 + db });
      assert.ok(range1_5.has(key), `La case (${5 + da}, ${5 + db}) doit être atteignable`);
      const expectedCost = (da !== 0 && db !== 0) ? 1.5 : 1.0;
      assert.equal(range1_5.get(key), expectedCost);
    }
  }

  // Budget 2.5 -> ~20 cases (12 cases de coût <= 2.0 + 8 cases de coût 2.5)
  const range2_5 = grid.cellsInRange(from, 2.5, emptyBlocked);
  assert.equal(range2_5.size, 20, 'Budget 2.5 doit donner 20 cases');
});

test('Blocage d arête et anti-corner-cutting', () => {
  const level = createLevel({ widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);
  const from = { a: 5, b: 5 };

  // Bloquer l'arête entre (5,5) et (6,5) (ortho droite)
  const eRight = edgeKey({ a: 5, b: 5 }, { a: 6, b: 5 });
  const blockedEdges = new Set([eRight]);

  const range = grid.cellsInRange(from, 1.5, blockedEdges);
  // (6,5) ne peut plus être atteinte
  assert.equal(range.has('6,5'), false, 'La case derrière l arête bloquée ne doit pas être atteinte directement');

  // Corner cutting : la diagonale (6,6) s'appuie sur (6,5) et (5,6). Comme l'arête vers (6,5) est bloquée, (6,6) ne peut pas être coupée !
  assert.equal(range.has('6,6'), false, 'La diagonale (6,6) doit être refusée par anti-corner-cutting');
  // De même pour (6,4) qui s'appuie sur (6,5) et (5,4)
  assert.equal(range.has('6,4'), false, 'La diagonale (6,4) doit être refusée par anti-corner-cutting');

  // Par contre, (5,6) et (5,4) et (4,4), (4,5), (4,6) restent atteignables
  assert.equal(range.has('5,6'), true);
  assert.equal(range.has('5,4'), true);
  assert.equal(range.has('4,5'), true);
  assert.equal(range.has('4,4'), true);
  assert.equal(range.has('4,6'), true);

  // Avec un budget de 2.5, (6,6) devient atteignable en faisant le détour par (5,6) -> (6,6) (coût 1.0 + 1.0 = 2.0)
  const rangeDétour = grid.cellsInRange(from, 2.5, blockedEdges);
  assert.equal(rangeDétour.has('6,6'), true, '(6,6) est atteignable par détour en budget 2.5');
  assert.equal(rangeDétour.get('6,6'), 2.0, 'Le coût du détour via (5,6) est de 2.0');
});

test('Anti-corner-cutting strict si arêtes orthogonales bloquées', () => {
  const level = createLevel({ widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);
  const from = { a: 5, b: 5 };

  // Bloquer les deux arêtes orthogonales vers (6,5) et (5,6)
  const e1 = edgeKey({ a: 5, b: 5 }, { a: 6, b: 5 });
  const e2 = edgeKey({ a: 5, b: 5 }, { a: 5, b: 6 });
  const blocked = new Set([e1, e2]);

  const range = grid.cellsInRange(from, 1.5, blocked);
  assert.equal(range.has('6,6'), false, 'Diagonale refusée quand les deux arêtes sont bloquées');
});

test('Coût du terrain (terrainCost)', () => {
  const level = createLevel({ widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);
  const from = { a: 5, b: 5 };

  // Terrain difficile sur (5,6) (multiplicateur x2)
  const terrainCost = new Map([['5,6', 2]]);
  const range = grid.cellsInRange(from, 1.5, new Set(), terrainCost);

  // Pour (5,6), coût de base 1.0 * 2 = 2.0 > budget 1.5 -> pas atteignable avec budget 1.5
  assert.equal(range.has('5,6'), false);

  // Avec budget 2.0, (5,6) est atteinte avec un coût de 2.0
  const range2 = grid.cellsInRange(from, 2.0, new Set(), terrainCost);
  assert.equal(range2.has('5,6'), true);
  assert.equal(range2.get('5,6'), 2.0);
});

test('path.js reconstruit correctement les chemins depuis la chaîne de prédécesseurs', () => {
  const level = createLevel({ widthCells: 10, heightCells: 10 });
  const grid = gridFor(level);
  const from = { a: 0, b: 0 };
  const to = { a: 2, b: 0 };

  const { predecessors } = computeReachable(grid, from, 10, new Set());
  const path = reconstructPath(predecessors, from, to);

  assert.deepEqual(path, [
    { a: 0, b: 0 },
    { a: 1, b: 0 },
    { a: 2, b: 0 },
  ]);

  // findPath direct
  const pathDirect = findPath(grid, from, to, new Set());
  assert.deepEqual(pathDirect, path);

  // Cas from === to
  assert.deepEqual(reconstructPath(predecessors, from, from), [{ a: 0, b: 0 }]);

  // Cas destination inatteignable
  const unreachedTo = { a: 9, b: 9 };
  const emptyPreds = new Map();
  assert.deepEqual(reconstructPath(emptyPreds, from, unreachedTo), []);
});

// Le stub de T-08 est vérifié ici, avec le consommateur de sa signature : c'est
// `cellsInRange` qui l'utilise. Ce test vivait dans uvtt.test.mjs, sans rapport.
test('computeBlockedEdges (stub lot 1a) retourne un Set vide', () => {
  const level = createLevel();
  const grid = gridFor(level);
  const edges = computeBlockedEdges(level, grid);

  assert.ok(edges instanceof Set);
  assert.equal(edges.size, 0);
});
