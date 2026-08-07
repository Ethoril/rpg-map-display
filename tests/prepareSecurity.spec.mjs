// @ts-check
import { test, expect } from '@playwright/test';

test('R0 — noms de sources et pions distants rendus comme texte dans l’outil de préparation', async ({
  page,
}) => {
  const hostile = '<img data-r0-xss="prepare" src=x>';
  await page.route('**/api/sources', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        defaults: { targetPxPerCell: 140, maxTexturePx: 8192, quality: 90 },
        sources: [
          {
            file: hostile,
            name: hostile,
            bytes: 100,
            cellsX: 10,
            cellsY: 8,
            densiteSource: 64,
            sourceWidth: 640,
            sourceHeight: 512,
            walls: 0,
            portals: 0,
            lights: 0,
            declares: { walls: 0, portals: 0, lights: 0 },
            bakedLighting: false,
            warnings: [hostile],
          },
        ],
        illisibles: [],
      }),
    });
  });
  await page.route('**/api/tokens', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        tokens: [
          {
            id: hostile,
            name: hostile,
            imageUrl: 'maps/tokens/placeholder.png',
            kind: 'npc',
            sizeCells: 1,
            speedCells: 3,
            visionBright: 5,
            visionDim: 10,
            maxHp: null,
          },
        ],
        errors: [],
      }),
    });
  });

  await page.goto('/prepare.html');
  await expect(page.locator('#outil')).not.toHaveClass(/cache/);
  await expect(page.locator('#source option')).toHaveText(new RegExp(hostile));
  await expect(page.locator('#details')).toContainText(hostile);
  await expect(page.locator('#tokens-liste')).toContainText(hostile);
  await expect(page.locator('[data-r0-xss="prepare"]')).toHaveCount(0);
});
