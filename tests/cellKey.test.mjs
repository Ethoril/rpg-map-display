import test from 'node:test';
import assert from 'node:assert/strict';
import { cellKey, parseCellKey, edgeKey } from '../js/core/cellKey.js';

test('cellKey et parseCellKey (aller-retour)', () => {
  const cases = [
    { a: 0, b: 0 },
    { a: 4, b: 7 },
    { a: -5, b: 10 },
    { a: 100, b: -20 },
    { a: -12, b: -34 },
    { a: 1, b: 23 },
    { a: 12, b: 3 },
  ];

  for (const cell of cases) {
    const key = cellKey(cell);
    assert.equal(typeof key, 'string');
    const parsed = parseCellKey(key);
    assert.deepEqual(parsed, cell);
  }
});

test('edgeKey est commutatif sur au moins 20 paires de cellules', () => {
  const cells = [
    { a: 0, b: 0 },
    { a: 1, b: 0 },
    { a: 0, b: 1 },
    { a: -1, b: 0 },
    { a: 0, b: -1 },
    { a: 1, b: 23 },
    { a: 12, b: 3 },
    { a: 4, b: 7 },
    { a: 5, b: 7 },
    { a: -5, b: 10 },
    { a: 10, b: -5 },
    { a: -10, b: -10 },
    { a: 100, b: 200 },
  ];

  let pairCount = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = 0; j < cells.length; j++) {
      const cellA = cells[i];
      const cellB = cells[j];
      const keyAB = edgeKey(cellA, cellB);
      const keyBA = edgeKey(cellB, cellA);
      assert.equal(keyAB, keyBA, `edgeKey doit être égal pour (${cellKey(cellA)}, ${cellKey(cellB)})`);
      pairCount++;
    }
  }

  assert.ok(pairCount >= 20, `Nombre de paires testées (${pairCount}) doit être >= 20`);
});

test('aucune collision entre {a:1, b:23} et {a:12, b:3}', () => {
  const cell1 = { a: 1, b: 23 };
  const cell2 = { a: 12, b: 3 };

  const key1 = cellKey(cell1);
  const key2 = cellKey(cell2);

  assert.equal(key1, '1,23');
  assert.equal(key2, '12,3');
  assert.notEqual(key1, key2);

  const edge1 = edgeKey(cell1, { a: 0, b: 0 });
  const edge2 = edgeKey(cell2, { a: 0, b: 0 });
  assert.notEqual(edge1, edge2);
});
