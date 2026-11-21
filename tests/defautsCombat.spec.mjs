// @ts-check
// Défauts relevés par le MJ après un vrai combat (21/11/2026) — partie navigateur.
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/** @param {string} id @param {string} name @param {number} order */
const level = (id, name, order) => ({ id, name, order, imageUrl: '', videoUrl: null, animatedOverlays: [], pxPerCell: 80, widthCells: 10, heightCells: 8, grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true }, terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false } });

/** @param {Partial<Record<string, unknown>>} [lienPatch] */
const snapshotEscalier = (lienPatch = {}) => ({
  campaign: {
    schemaVersion: 2, campaignId: 'defauts-combat', name: 'Défauts du combat',
    levels: [level('rdc', 'RDC', 0), level('et1', 'Étage 1', 1)],
    links: [
      { id: 'stairs-up', kind: 'stairs', label: 'Montée', a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'et1', at: { cellX: 5, cellY: 4 } }, bidirectional: true, gmOnly: false, ...lienPatch },
    ],
    tokens: [{ id: 'hero', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: '', borderColor: '#00ff00', label: 'Héros', hidden: false, visionBright: 4, visionDim: 6, emitsLight: null, speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed' }],
    templates: [], settings: {},
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
});

/** @param {import('@playwright/test').Page} page */
const etat = (page) => page.evaluate(async () => {
  const store = await import('../js/state/store.js');
  return { activeLevelId: store.getState().activeLevelId, token: store.getCampaign()?.tokens.find((t) => t.id === 'hero') };
});
/** Tap au centre de la case (2,2) — pxPerCell 80. @param {import('@playwright/test').Page} page */
const taperEscalier = (page) => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({ type: 'tap', mapPos: { x: 200, y: 200 }, screenPos: { x: 0, y: 0 } }));

/**
 * Encre blanche dans la bande au-dessus de la case (2,2), où seule l'invite écrit (même sonde que
 * `multiLevelJourney.spec.mjs`, calée sur le bord supérieur de la case).
 * @param {import('@playwright/test').Page} page
 */
const encreInvite = (page) => page.evaluate(() => {
  const app = /** @type {any} */ (window).__RPG_APP__;
  const centre = app.camera.mapToScreen({ x: 200, y: 200 });
  const bordHaut = app.camera.mapToScreen({ x: 200, y: 160 });
  const res = app.stage?.resolution ?? window.devicePixelRatio ?? 1;
  const largeur = 220;
  const d = app.context.getImageData(
    Math.round((centre.screenX - largeur / 2) * res),
    Math.round((bordHaut.screenY - 48) * res),
    Math.round(largeur * res),
    Math.round(28 * res)
  ).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++;
  return n / (res * res);
});

for (const [nom, patch] of /** @type {const} */ ([['publique', {}], ['MJ seule', { gmOnly: true }]])) {
  test(`Liaison ${nom} : le MJ fait franchir l’escalier d’un second tap, et la tablette le reçoit`, async ({ browser }) => {
    const context = await browser.newContext();
    const sessionId = `defauts-mj-${nom === 'MJ seule' ? 'gmonly' : 'pub'}-${Date.now()}`;
    const gm = await context.newPage();
    const player = await context.newPage();
    const snap = snapshotEscalier(patch);
    await Promise.all([installBrowserTransport(gm, sessionId, snap), installBrowserTransport(player, sessionId, snap)]);
    await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
    await Promise.all([waitForApp(gm), waitForApp(player)]);

    // Premier tap : le MJ sélectionne le pion posé sur l'escalier. Rien ne franchit.
    await taperEscalier(gm);
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getState().selectedTokenId)).toBe('hero');
    expect(await etat(gm)).toMatchObject({ token: { levelId: 'rdc', cell: { a: 2, b: 2 } } });

    // Second tap sur sa case : le pion monte, des deux côtés, et aucun écran ne bascule.
    await taperEscalier(gm);
    await expect.poll(() => etat(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'et1', cell: { a: 5, b: 4 } } });
    await expect.poll(() => etat(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'et1', cell: { a: 5, b: 4 } } });
    await context.close();
  });
}

for (const [nom, patch] of /** @type {const} */ ([['publique', {}], ['MJ seule', { gmOnly: true }]])) test(`Liaison ${nom} : l’invite « Retaper pour prendre l’escalier » s’affiche aussi côté MJ`, async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `defauts-mj-invite-${Date.now()}`;
  const gm = await context.newPage();
  await installBrowserTransport(gm, sessionId, snapshotEscalier(patch));
  await gm.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(gm);
  const zoom = await gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.zoom);
  expect(zoom, 'zoom hors du domaine de validité de la sonde').toBeGreaterThan(0.2);
  expect(zoom, 'zoom hors du domaine de validité de la sonde').toBeLessThan(2);
  const avant = await encreInvite(gm);
  await taperEscalier(gm);
  await expect.poll(() => encreInvite(gm), { timeout: 8000 }).toBeGreaterThan(avant + 40);
  await context.close();
});
