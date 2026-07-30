// @ts-check
import { test, expect } from '@playwright/test';

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

test('GridLayer et SquareGrid.renderGrid : alignement strict sur pixels (offset nul et offset non-nul)', async ({ page }) => {
  await mountStage(page);

  // --- Test 1 : Offset nul (profil minimal.json : 10×8 cases @ 140 px, offset 0) ---
  const levelDataOffsetNul = {
    pxPerCell: 140,
    widthCells: 10,
    heightCells: 8,
    grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 1.0, visible: true },
  };

  // Scan de la ligne Y = offsetY + 1 * pxPerCell = 140
  const scanY1 = 140;
  const res1 = await page.evaluate(
    ({ level, scanY }) => /** @type {any} */ (window).__stageProbe.testGridRowScan(level, scanY),
    { level: levelDataOffsetNul, scanY: scanY1 }
  );

  // Colonnes attendues : offsetX + k * pxPerCell -> 0, 140, 280, 420, 560, 700, 840, 980, 1120, 1260, 1400 (tolérance 1px à la rasterisation)
  for (let k = 0; k <= 10; k++) {
    const expectedX = k * 140;
    const found = res1.borderColumns.some((/** @type {number} */ col) => Math.abs(col - expectedX) <= 1);
    expect(found).toBe(true);
  }

  // --- Test 2 : Offset non-nul (Piège n°1 : offset 25x40, 5×5 cases @ 100 px) ---
  const levelDataOffsetNonNul = {
    pxPerCell: 100,
    widthCells: 5,
    heightCells: 5,
    grid: { type: 'square', offsetX: 25, offsetY: 40, color: '#000000', opacity: 1.0, visible: true },
  };

  // Scan de la ligne Y = offsetY + 1 * pxPerCell = 40 + 100 = 140
  const scanY2 = 140;
  const res2 = await page.evaluate(
    ({ level, scanY }) => /** @type {any} */ (window).__stageProbe.testGridRowScan(level, scanY),
    { level: levelDataOffsetNonNul, scanY: scanY2 }
  );

  // Colonnes attendues : offsetX + k * pxPerCell -> 25, 125, 225, 325, 425, 525 (tolérance 1px à la rasterisation)
  for (let k = 0; k <= 5; k++) {
    const expectedX = 25 + k * 100;
    const found = res2.borderColumns.some((/** @type {number} */ col) => Math.abs(col - expectedX) <= 1);
    expect(found).toBe(true);
  }
});
