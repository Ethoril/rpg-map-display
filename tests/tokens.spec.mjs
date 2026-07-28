// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Helper pour charger index.html et monter le stage avec la sonde.
 * @param {import('@playwright/test').Page} page
 */
async function mountStage(page) {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/index.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountStage.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__stageProbe));

  expect(erreurs).toEqual([]);
}

test('TokensLayer : géométrie, sizeCells, transparence PNJ, anneau de sélection et badge d elevation', async ({ page }) => {
  await mountStage(page);

  // Fixture minimal.json avec 2 pions :
  // - 1 pion PJ à case (2, 2), sizeCells: 1, borderColor: '#ff0000', elevation: 0
  // - 1 pion PNJ hidden: true à case (5, 3), sizeCells: 2, borderColor: '#0000ff', elevation: 1
  const levelData = {
    pxPerCell: 140,
    widthCells: 10,
    heightCells: 8,
    grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.0, visible: false },
  };

  const tokenPJ = {
    id: 'token-pj',
    levelId: 'rdc',
    cell: { a: 2, b: 2 },
    sizeCells: 1,
    kind: 'pc',
    borderColor: '#ff0000',
    hidden: false,
    elevation: 0,
  };

  const tokenPNJ = {
    id: 'token-pnj',
    levelId: 'rdc',
    cell: { a: 5, b: 3 },
    sizeCells: 2,
    kind: 'npc',
    borderColor: '#0000ff',
    hidden: true,
    elevation: 1,
  };

  const tokensList = [tokenPJ, tokenPNJ];

  // --- Test 1 : Rendu Vue MJ (role: 'gm') ---
  const resGM = await page.evaluate(
    ({ level, tokens }) =>
      /** @type {any} */ (window).__stageProbe.testTokensRender({
        levelOverrides: level,
        tokensList: tokens,
        selectionData: { tokenId: 'token-pj' },
        options: { role: 'gm' },
      }),
    { level: levelData, tokens: tokensList }
  );

  // En vue MJ, les 2 pions doivent être présents
  expect(resGM.renderedTokensCount).toBe(2);

  // Pion PJ (sizeCells: 1) à case (2,2) : exactement case (2,2) couverte
  expect(resGM.cellAlphaMap['2,2']).toBeGreaterThan(0);
  expect(resGM.cellAlphaMap['1,2']).toBe(0);
  expect(resGM.cellAlphaMap['3,2']).toBe(0);
  expect(resGM.cellAlphaMap['2,1']).toBe(0);
  expect(resGM.cellAlphaMap['2,3']).toBe(0);

  // Pion PNJ (sizeCells: 2) à case (5,3) : couvre exactement le bloc 2x2 [(5,3), (6,3), (5,4), (6,4)]
  expect(resGM.cellAlphaMap['5,3']).toBeGreaterThan(0);
  expect(resGM.cellAlphaMap['6,3']).toBeGreaterThan(0);
  expect(resGM.cellAlphaMap['5,4']).toBeGreaterThan(0);
  expect(resGM.cellAlphaMap['6,4']).toBeGreaterThan(0);

  // Cases environnantes hors du 2x2 ne doivent pas être couvertes
  expect(resGM.cellAlphaMap['4,3']).toBe(0);
  expect(resGM.cellAlphaMap['7,3']).toBe(0);
  expect(resGM.cellAlphaMap['5,2']).toBe(0);
  expect(resGM.cellAlphaMap['5,5']).toBe(0);

  // Badge d'élévation présent pour tokenPNJ (elevation = 1)
  expect(resGM.hasElevationBadge).toBe(true);

  // --- Test 2 : Rendu Vue Joueurs (role: 'players') ---
  const resPlayers = await page.evaluate(
    ({ level, tokens }) =>
      /** @type {any} */ (window).__stageProbe.testTokensRender({
        levelOverrides: level,
        tokensList: tokens,
        selectionData: null,
        options: { role: 'players' },
      }),
    { level: levelData, tokens: tokensList }
  );

  // En vue joueurs, le PNJ hidden: true doit être totalement absent
  expect(resPlayers.renderedTokensCount).toBe(1);
  expect(resPlayers.cellAlphaMap['5,3']).toBe(0);
  expect(resPlayers.cellAlphaMap['6,4']).toBe(0);

  // Le pion PJ est toujours présent
  expect(resPlayers.cellAlphaMap['2,2']).toBeGreaterThan(0);
});
