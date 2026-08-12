// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

const snapshot = {
  campaign: {
    schemaVersion: 2, campaignId: 'lights', name: 'Lumières', links: [], templates: [],
    settings: {},
    levels: [{
      id: 'rdc', name: 'RDC', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
      pxPerCell: 100, widthCells: 12, heightCells: 8,
      grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
      terrainCost: null, walls: [], portals: [], lights: [],
      ambient: { color: '#ffffff', level: 0, baked: true },
    }],
    tokens: [{
      id: 'torch', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'npc', imageUrl: '',
      borderColor: '#ffcc66', label: 'Torche', hidden: false, visionBright: 0, visionDim: 0,
      emitsLight: null, speedCells: 0, playerMovable: false, locked: false, elevation: 0,
      markers: [], hp: null, health: 'unharmed',
    }],
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
};

test('Lumière R3 : baked est visible et une torche republie la vision sans frame MJ', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `lights-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await installBrowserTransport(gm, sessionId, snapshot);
  await installBrowserTransport(player, sessionId, snapshot);
  await gm.goto('/gm.html');
  await player.goto('/player.html');
  await waitForApp(gm);
  await waitForApp(player);

  await expect(gm.locator('#gm-baked-warning')).toBeVisible();
  await expect(gm.locator('#gm-ambient-level')).toBeDisabled();
  await expect.poll(() => gm.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some((/** @type {any} */ e) => e.type === 'vision.update')
  )).toBe(true);

  const before = await gm.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);
  await gm.evaluate(async () => {
    /** @type {any} */ (window).requestAnimationFrame = () => 0;
    const store = await import('../js/state/store.js');
    store.updateToken('torch', { emitsLight: { range: 4, intensity: 1, color: '#ffcc66' } });
  });
  await expect.poll(() => gm.evaluate((count) =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.slice(count).some((/** @type {any} */ e) => e.type === 'vision.update'),
    before
  ), { timeout: 8000 }).toBe(true);
  await context.close();
});
