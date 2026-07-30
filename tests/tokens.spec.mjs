// @ts-check
import { test, expect } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
async function mountStage(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ error) => errors.push(error.message));
  await page.goto('/gm.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountStage.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__stageProbe));
  expect(errors).toEqual([]);
}

const level = {
  id: 'rdc',
  pxPerCell: 100,
  widthCells: 10,
  heightCells: 8,
  grid: {
    type: 'square',
    offsetX: 0,
    offsetY: 0,
    color: '#000000',
    opacity: 0,
    visible: false,
  },
};

test('pions : niveau actif, taille 2×2 et visibilité par rôle', async ({ page }) => {
  await mountStage(page);
  const tokens = [
    {
      id: 'pc', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc',
      imageUrl: '', label: 'PJ', borderColor: '#ff0000', hidden: false,
      elevation: 0, markers: [],
    },
    {
      id: 'npc', levelId: 'rdc', cell: { a: 5, b: 3 }, sizeCells: 2, kind: 'npc',
      imageUrl: '', label: 'PNJ', borderColor: '#0000ff', hidden: true,
      elevation: 1, markers: [],
    },
    {
      id: 'other-level', levelId: 'cave', cell: { a: 0, b: 0 }, sizeCells: 1, kind: 'pc',
      imageUrl: '', label: 'Hors étage', borderColor: '#00ff00', hidden: false,
      elevation: 0, markers: [],
    },
  ];

  const gm = await page.evaluate(
    ({ levelData, tokenData }) =>
      /** @type {any} */ (window).__stageProbe.testTokensRender({
        levelOverrides: levelData,
        tokensList: tokenData,
        selectionData: { tokenId: 'pc' },
        options: { role: 'gm', activeLevelId: 'rdc' },
      }),
    { levelData: level, tokenData: tokens }
  );
  expect(gm.renderedTokenIds).toEqual(['pc', 'npc']);
  expect(gm.cellAlphaMap['2,2']).toBeGreaterThan(0);
  expect(gm.cellAlphaMap['5,3']).toBeLessThan(gm.cellAlphaMap['2,2']);
  expect(gm.cellAlphaMap['1,2']).toBe(0);
  for (const key of ['5,3', '6,3', '5,4', '6,4']) expect(gm.cellAlphaMap[key]).toBeGreaterThan(0);
  for (const key of ['4,3', '7,3', '5,2', '5,5']) expect(gm.cellAlphaMap[key]).toBe(0);
  expect(gm.cellAlphaMap['0,0']).toBe(0);

  const players = await page.evaluate(
    ({ levelData, tokenData }) =>
      /** @type {any} */ (window).__stageProbe.testTokensRender({
        levelOverrides: levelData,
        tokensList: tokenData,
        options: { role: 'players', activeLevelId: 'rdc' },
      }),
    { levelData: level, tokenData: tokens }
  );
  expect(players.renderedTokenIds).toEqual(['pc']);
  expect(players.cellAlphaMap['5,3']).toBe(0);
});

test('pions : le contenu de l’image est recadré et son chargement invalide une fois', async ({ page }) => {
  await mountStage(page);
  const result = await page.evaluate(async (levelData) => {
    const source = document.createElement('canvas');
    source.width = 80;
    source.height = 40;
    const sourceContext = source.getContext('2d');
    if (!sourceContext) throw new Error('Canvas 2D indisponible');
    sourceContext.fillStyle = '#00ff00';
    sourceContext.fillRect(0, 0, source.width, source.height);
    const imageUrl = source.toDataURL('image/png');
    return /** @type {any} */ (window).__stageProbe.testTokensRender({
      levelOverrides: levelData,
      tokensList: [{
        id: 'portrait', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1,
        kind: 'pc', imageUrl, label: 'Portrait', borderColor: '#ff0000',
        hidden: false, elevation: 0, markers: [],
      }],
      options: { role: 'gm', activeLevelId: 'rdc' },
    });
  }, level);
  const center = result.cellColorMap['2,2'];
  expect(center.g).toBeGreaterThan(240);
  expect(center.r).toBeLessThan(20);
  expect(center.b).toBeLessThan(20);
  expect(result.invalidations).toBe(1);
});

test('pions : une image absente affiche un placeholder sans casser les autres pions', async ({ page }) => {
  await mountStage(page);
  const result = await page.evaluate(
    (levelData) => /** @type {any} */ (window).__stageProbe.testTokensRender({
      levelOverrides: levelData,
      tokensList: [
        {
          id: 'broken', levelId: 'rdc', cell: { a: 1, b: 1 }, sizeCells: 1,
          kind: 'pc', imageUrl: '/maps/absent.webp', label: 'Cassé',
          borderColor: '#ff0000', hidden: false, elevation: 0, markers: [],
        },
        {
          id: 'valid-placeholder', levelId: 'rdc', cell: { a: 3, b: 1 }, sizeCells: 1,
          kind: 'pc', imageUrl: '', label: 'Valide',
          borderColor: '#00ff00', hidden: false, elevation: 0, markers: [],
        },
      ],
      options: { role: 'gm', activeLevelId: 'rdc' },
    }),
    level
  );
  expect(result.renderedTokenIds).toEqual(['broken', 'valid-placeholder']);
  expect(result.cellAlphaMap['1,1']).toBeGreaterThan(0);
  expect(result.cellAlphaMap['3,1']).toBeGreaterThan(0);
});

test('pions : animation déterministe bornée et aperçu de drag sans mutation', async ({ page }) => {
  await mountStage(page);
  const token = {
    id: 'moving', levelId: 'rdc', cell: { a: 4, b: 2 }, sizeCells: 1, kind: 'pc',
    imageUrl: '', label: 'M', borderColor: '#ff0000', hidden: false,
    elevation: 0, markers: [],
    move: {
      from: { a: 2, b: 2 }, to: { a: 4, b: 2 },
      path: [{ a: 2, b: 2 }, { a: 3, b: 2 }, { a: 4, b: 2 }],
      startedAt: 1000,
    },
  };

  const during = await page.evaluate(
    ({ levelData, tokenData }) => /** @type {any} */ (window).__stageProbe.testTokensRender({
      levelOverrides: levelData,
      tokensList: [tokenData],
      options: { role: 'gm', activeLevelId: 'rdc', now: 1160 },
    }),
    { levelData: level, tokenData: token }
  );
  expect(during.animationActive).toBe(true);
  expect(during.cellAlphaMap['3,2']).toBeGreaterThan(0);
  expect(during.cellAlphaMap['4,2']).toBe(0);

  const finished = await page.evaluate(
    ({ levelData, tokenData }) => /** @type {any} */ (window).__stageProbe.testTokensRender({
      levelOverrides: levelData,
      tokensList: [tokenData],
      options: { role: 'gm', activeLevelId: 'rdc', now: 1320 },
    }),
    { levelData: level, tokenData: token }
  );
  expect(finished.animationActive).toBe(false);
  expect(finished.cellAlphaMap['4,2']).toBeGreaterThan(0);

  const preview = await page.evaluate(
    ({ levelData, tokenData }) => /** @type {any} */ (window).__stageProbe.testTokensRender({
      levelOverrides: levelData,
      tokensList: [tokenData],
      options: {
        role: 'gm',
        activeLevelId: 'rdc',
        now: 1320,
        dragPreview: { tokenId: 'moving', mapPos: { x: 750, y: 150 } },
      },
    }),
    { levelData: level, tokenData: token }
  );
  expect(preview.cellAlphaMap['7,1']).toBeGreaterThan(0);
  expect(preview.cellAlphaMap['4,2']).toBe(0);
});
