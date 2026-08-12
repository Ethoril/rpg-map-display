// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/** @param {string} id @param {string} name @param {number} order */
const level = (id, name, order) => ({ id, name, order, imageUrl: '', videoUrl: null, animatedOverlays: [], pxPerCell: 80, widthCells: 10, heightCells: 8, grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true }, terrainCost: null, walls: [], portals: [], lights: [], ambient: { color: '#ffffff', level: 1, baked: false } });
const snapshot = {
  campaign: {
    schemaVersion: 2, campaignId: 'journey-3', name: 'Parcours trois étages',
    levels: [level('rdc', 'RDC', 0), level('et1', 'Étage 1', 1), level('cave', 'Cave', -1)],
    links: [
      { id: 'stairs-up', kind: 'stairs', label: 'Montée', a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'et1', at: { cellX: 2, cellY: 2 } }, bidirectional: true, gmOnly: false },
    ],
    tokens: [{ id: 'hero', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: '', borderColor: '#00ff00', label: 'Héros', hidden: false, visionBright: 4, visionDim: 6, emitsLight: null, speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed' }],
    templates: [], settings: {},
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
};

/** @param {import('@playwright/test').Page} page */
const state = (page) => page.evaluate(async () => {
  const store = await import('../js/state/store.js');
  return { activeLevelId: store.getState().activeLevelId, token: store.getCampaign()?.tokens.find((t) => t.id === 'hero') };
});
/** @param {import('@playwright/test').Page} page */
const tapLink = (page) => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({ type: 'tap', mapPos: { x: 200, y: 200 }, screenPos: { x: 0, y: 0 } }));

test('R3-03 — téléportation, suivi/cadenas MJ et fog restauré restent cohérents sur trois étages', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `journey-r3-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await Promise.all([installBrowserTransport(gm, sessionId, snapshot), installBrowserTransport(player, sessionId, snapshot)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);

  // Le fog est bien indexé par étage : le MJ produit un masque pour le RDC, puis pour l'étage 1.
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('rdc')), { timeout: 8000 }).not.toBeNull();

  // Deux taps : sélectionner le pion puis franchir exactement l'escalier. Le MJ suit le pion.
  await tapLink(player); await tapLink(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'et1', cell: { a: 2, b: 2 } } });
  await expect.poll(() => state(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'et1' } });
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('et1')), { timeout: 8000 }).not.toBeNull();

  // Le cadenas suspend seulement le suivi visuel : le pion redescend mais le MJ reste à l'étage 1.
  await gm.click('#gm-level-lock');
  await expect(gm.locator('#gm-level-lock')).toHaveAttribute('aria-pressed', 'true');
  await tapLink(player); await tapLink(player);
  await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({ token: { levelId: 'rdc' } });
  await expect.poll(() => state(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'et1', token: { levelId: 'rdc' } });

  const fogBeforeReload = await gm.evaluate(async () => { const store = await import('../js/state/store.js'); return [store.getSessionFog('rdc'), store.getSessionFog('et1')]; });
  expect(fogBeforeReload[0]).not.toBeNull(); expect(fogBeforeReload[1]).not.toBeNull();
  await gm.reload(); await waitForApp(gm);
  await expect.poll(() => gm.evaluate(async () => { const store = await import('../js/state/store.js'); return [store.getSessionFog('rdc'), store.getSessionFog('et1')]; }), { timeout: 8000 }).toEqual(fogBeforeReload);
  await context.close();
});

test('R3-03 — l’UI joueurs ne traverse ni une liaison MJ seule ni un pion verrouillé', async ({ browser }) => {
  for (const restricted of ['gmOnly', 'locked']) {
    const restrictedSnapshot = structuredClone(snapshot);
    restrictedSnapshot.campaign.links[0].gmOnly = restricted === 'gmOnly';
    restrictedSnapshot.campaign.tokens[0].locked = restricted === 'locked';
    const context = await browser.newContext();
    const player = await context.newPage();
    const sessionId = `journey-restricted-${restricted}-${Date.now()}`;
    await installBrowserTransport(player, sessionId, restrictedSnapshot);
    await player.goto(`/player.html?session=${sessionId}`);
    await waitForApp(player);

    await tapLink(player); await tapLink(player);
    await expect.poll(() => state(player), { timeout: 8000 }).toMatchObject({
      activeLevelId: 'rdc', token: { levelId: 'rdc', cell: { a: 2, b: 2 } },
    });
    await expect(player.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ event) => event.type === 'link.traverse')
    )).resolves.toHaveLength(0);
    await context.close();
  }
});
