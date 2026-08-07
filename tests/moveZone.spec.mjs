// @ts-check
import { test, expect } from '@playwright/test';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { createLevel } from '../js/core/schema.js';

/**
 * Helper pour charger gm.html et monter le stage avec la sonde.
 * @param {import('@playwright/test').Page} page
 */
async function mountStage(page) {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/gm.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountStage.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__stageProbe));

  expect(erreurs).toEqual([]);
}

test('MoveZoneLayer : surlignage exact des cases atteignables et non-interactivité', async ({ page }) => {
  await mountStage(page);

  /** @type {import('../js/core/types.js').GridType} */
  const gridType = 'square';
  const levelData = {
    pxPerCell: 140,
    widthCells: 10,
    heightCells: 8,
    grid: { type: gridType, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.0, visible: false },
  };

  const level = createLevel(levelData);
  const grid = new SquareGrid(level);
  const startCell = { a: 2, b: 2 };
  const speedCells = 3;

  // Calcul Dijkstra de référence des cases atteignables
  const reachableMap = grid.cellsInRange(startCell, speedCells, new Set());
  const reachableKeys = Array.from(reachableMap.keys());

  const tokenPJ = {
    id: 'token-pj',
    levelId: 'rdc',
    cell: startCell,
    sizeCells: 1,
    kind: 'pc',
    borderColor: '#ff0000',
    speedCells: speedCells,
  };

  // 1. Rendu avec pion sélectionné
  const resSelected = await page.evaluate(
    ({ level, token, keys }) =>
      /** @type {any} */ (window).__stageProbe.testMoveZoneRender({
        levelOverrides: level,
        token: token,
        cellsReachableKeys: keys,
      }),
    { level: levelData, token: tokenPJ, keys: reachableKeys }
  );

  expect(resSelected.renderedCells).toBe(reachableMap.size);

  // Vérification case par case : chaque case atteignable est surlignée, et AUCUNE case hors Dijkstra
  for (let a = 0; a < level.widthCells; a++) {
    for (let b = 0; b < level.heightCells; b++) {
      const key = `${a},${b}`;
      const isReachable = reachableMap.has(key);
      const alpha = resSelected.cellAlphaMap[key];

      if (isReachable) {
        expect(alpha).toBeGreaterThan(0);
      } else {
        expect(alpha).toBe(0);
      }
    }
  }

  // 2. Rendu si aucun pion sélectionné (token: null) -> 0 case surlignée
  const resUnselected = await page.evaluate(
    ({ level, keys }) =>
      /** @type {any} */ (window).__stageProbe.testMoveZoneRender({
        levelOverrides: level,
        token: null,
        cellsReachableKeys: keys,
      }),
    { level: levelData, keys: reachableKeys }
  );
  expect(resUnselected.renderedCells).toBe(0);

  for (let a = 0; a < level.widthCells; a++) {
    for (let b = 0; b < level.heightCells; b++) {
      const key = `${a},${b}`;
      expect(resUnselected.cellAlphaMap[key]).toBe(0);
    }
  }
});

test('MoveZoneLayer : le refus de destination est dessiné brièvement puis disparaît', async ({ page }) => {
  await mountStage(page);

  const levelOverrides = {
    pxPerCell: 140,
    widthCells: 4,
    heightCells: 4,
  };

  const refused = await page.evaluate(
    (args) => /** @type {any} */ (window).__stageProbe.testMoveZoneFeedbackRender(args),
    { levelOverrides, cell: { a: 1, b: 1 }, kind: 'refused' }
  );
  expect(refused.active).toBe(true);
  expect(refused.center.a).toBeGreaterThan(0);
  expect(refused.center.r).toBeGreaterThan(refused.center.g);

  const occupied = await page.evaluate(
    (args) => /** @type {any} */ (window).__stageProbe.testMoveZoneFeedbackRender(args),
    { levelOverrides, cell: { a: 1, b: 1 }, kind: 'occupied' }
  );
  expect(occupied.active).toBe(true);
  expect(occupied.center.a).toBeGreaterThan(0);
  expect(occupied.center.r).toBeGreaterThan(occupied.center.g);
  expect(occupied.center.g).toBeGreaterThan(refused.center.g);

  const expired = await page.evaluate(
    (args) => /** @type {any} */ (window).__stageProbe.testMoveZoneFeedbackRender(args),
    { levelOverrides, cell: { a: 1, b: 1 }, kind: 'refused', elapsed: 700 }
  );
  expect(expired.active).toBe(false);
  expect(expired.center.a).toBe(0);
});
