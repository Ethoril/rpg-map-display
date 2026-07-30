// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

test('les vraies pages Canvas arrêtent de rendre lorsque la scène est immobile', async ({ page }) => {
  for (const path of ['/gm.html?session=idle-gm', '/player.html?session=idle-player']) {
    await page.goto(path);
    await waitForApp(page);
    await page.waitForTimeout(300);
    const before = await page.evaluate(
      () => /** @type {any} */ (window).__RPG_APP__.frameLoop.frameCount
    );
    await page.waitForTimeout(700);
    const after = await page.evaluate(
      () => /** @type {any} */ (window).__RPG_APP__.frameLoop.frameCount
    );
    expect(after).toBe(before);
  }
});

test('un vrai F5 MJ conserve campagne, URL canonique, pion, étage et caméra', async ({ page }) => {
  const sessionId = `real-f5-${Date.now()}`;
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);
    const level = schema.createLevel({
      id: 'cave',
      name: 'Cave',
      imageUrl: 'maps/minimal.webp',
      widthCells: 10,
      heightCells: 8,
      pxPerCell: 140,
    });
    const token = schema.createToken({
      id: 'hero-f5',
      levelId: level.id,
      imageUrl: 'maps/minimal.webp',
      cell: { a: 2, b: 3 },
    });
    store.loadCampaign(
      schema.createCampaign({
        campaignId: 'campaign-f5',
        levels: [level],
        tokens: [token],
      })
    );
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'panBy',
      deltaX: 42,
      deltaY: -28,
    });
  });

  const beforeReload = await page.evaluate(() => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    return { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom };
  });

  await page.reload();
  await waitForApp(page);

  const restored = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const state = store.getState();
    const token = state.campaign?.tokens.find((item) => item.id === 'hero-f5');
    const app = /** @type {any} */ (window).__RPG_APP__;
    return {
      campaignId: state.campaign?.campaignId,
      activeLevelId: state.activeLevelId,
      levelImageUrl: state.activeLevel?.imageUrl,
      tokenLevelId: token?.levelId,
      tokenImageUrl: token?.imageUrl,
      tokenCell: token?.cell,
      camera: { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom },
    };
  });

  expect(restored).toEqual({
    campaignId: 'campaign-f5',
    activeLevelId: 'cave',
    levelImageUrl: 'maps/minimal.webp',
    tokenLevelId: 'cave',
    tokenImageUrl: 'maps/minimal.webp',
    tokenCell: { a: 2, b: 3 },
    camera: beforeReload,
  });
});

test('deux vraies pages joueurs convergent via leur transport, sans relais du test', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  const sessionId = `two-real-pages-${Date.now()}`;
  const snapshot = {
    campaign: {
      schemaVersion: 2,
      campaignId: 'two-pages',
      name: 'Deux pages',
      levels: [
        {
          id: 'rdc',
          name: 'RDC',
          order: 0,
          imageUrl: 'maps/minimal.webp',
          videoUrl: null,
          animatedOverlays: [],
          pxPerCell: 140,
          widthCells: 10,
          heightCells: 8,
          grid: {
            type: 'square',
            offsetX: 0,
            offsetY: 0,
            color: '#000000',
            opacity: 0.25,
            visible: true,
          },
          terrainCost: null,
          walls: [],
          portals: [],
          lights: [],
          ambient: { color: '#ffffff', level: 1, baked: false },
        },
      ],
      links: [],
      tokens: [
        {
          id: 'hero-sync',
          levelId: 'rdc',
          cell: { a: 2, b: 2 },
          sizeCells: 1,
          kind: 'pc',
          imageUrl: '',
          borderColor: '#00ff00',
          label: 'Héros',
          hidden: false,
          visionBright: 6,
          visionDim: 12,
          emitsLight: null,
          speedCells: 6,
          playerMovable: true,
          locked: false,
          elevation: 0,
          markers: [],
        },
      ],
      templates: [],
      settings: { ambientLevel: 1 },
    },
    activeLevelId: 'rdc',
    selectedTokenId: null,
  };

  await Promise.all([
    installBrowserTransport(page1, sessionId, snapshot),
    installBrowserTransport(page2, sessionId, snapshot),
  ]);
  await Promise.all([
    page1.goto(`/player.html?session=${sessionId}`),
    page2.goto(`/player.html?session=${sessionId}`),
  ]);
  await Promise.all([waitForApp(page1), waitForApp(page2)]);

  const points = await page1.evaluate(async () => {
    const { gridFor } = await import('../js/grid/index.js');
    const store = await import('../js/state/store.js');
    const app = /** @type {any} */ (window).__RPG_APP__;
    const activeLevel = store.getActiveLevel();
    if (!activeLevel) throw new Error('Étage initial absent');
    const grid = gridFor(activeLevel);
    return {
      token: app.camera.mapToScreen(grid.pointFromCell({ a: 2, b: 2 })),
      target: app.camera.mapToScreen(grid.pointFromCell({ a: 4, b: 4 })),
    };
  });

  await page1.mouse.click(points.token.screenX, points.token.screenY);
  await page1.mouse.click(points.target.screenX, points.target.screenY);

  await expect
    .poll(() =>
      page2.evaluate(async () => {
        const store = await import('../js/state/store.js');
        return store.getCampaign()?.tokens.find((token) => token.id === 'hero-sync')?.cell;
      })
    )
    .toEqual({ a: 4, b: 4 });

  await context.close();
});
