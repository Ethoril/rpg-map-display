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
      ambient: { level: 0, baked: true },
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
  // UX-07 : le curseur est devenu une bascule à deux états ; l'étage cuit la neutralise toujours.
  await expect(gm.locator('#gm-ambient-day')).toBeDisabled();
  await expect(gm.locator('#gm-ambient-night')).toBeDisabled();
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

/**
 * UX-07 — le curseur d'ambiance devient une bascule jour / nuit.
 *
 * Il offrait 21 positions de 0 à 1 par pas de 0,05, et le moteur n'en lisait **qu'une seule
 * chose** : `baked || level > 0`. 0,05 et 1,00 étaient rigoureusement indistinguables ; le seul
 * cran qui changeait quoi que ce soit était le passage par zéro. L'interface dit enfin ce que le
 * moteur fait.
 */
test('UX-07 : la bascule écrit 0 ou 1, et une campagne à 0,35 s\'affiche « jour »', async ({ page }) => {
  const sessionId = `ambiance-${Date.now()}`;
  // ⭐ Critère 2 : une campagne enregistrée AVANT ce changement porte une valeur fractionnaire —
  // et un `ambient.color` que plus rien ne lit. Les deux doivent traverser sans erreur.
  const heritee = {
    ...snapshot,
    campaign: {
      ...snapshot.campaign,
      levels: [
        {
          ...snapshot.campaign.levels[0],
          ambient: /** @type {any} */ ({ color: '#ffeecc', level: 0.35, baked: false }),
        },
      ],
    },
  };
  await installBrowserTransport(page, sessionId, heritee);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  const jour = page.locator('#gm-ambient-day');
  const nuit = page.locator('#gm-ambient-night');

  await expect(jour, 'une ambiance à 0,35 est « jour » pour le moteur').toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(nuit).toHaveAttribute('aria-pressed', 'false');

  // Critère 1 : la bascule produit exactement les deux comportements que le moteur distingue.
  await nuit.click();
  await expect(nuit).toHaveAttribute('aria-pressed', 'true');
  await expect(jour).toHaveAttribute('aria-pressed', 'false');

  const apresNuit = await page.evaluate(async () => {
    const [store, fog] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/render/layers/fogLayer.js'),
    ]);
    const level = store.getRenderSnapshot().activeLevel;
    return { level: level?.ambient?.level, eclaire: fog.isAmbientLit(/** @type {any} */ (level)) };
  });
  expect(apresNuit.level, 'la position « nuit » écrit exactement 0').toBe(0);
  expect(apresNuit.eclaire, 'et le moteur la lit comme éteinte').toBe(false);

  await jour.click();
  const apresJour = await page.evaluate(async () => {
    const [store, fog] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/render/layers/fogLayer.js'),
    ]);
    const level = store.getRenderSnapshot().activeLevel;
    return { level: level?.ambient?.level, eclaire: fog.isAmbientLit(/** @type {any} */ (level)) };
  });
  expect(apresJour.level, 'la position « jour » écrit exactement 1').toBe(1);
  expect(apresJour.eclaire).toBe(true);

  // Les deux positions passent par le même événement réseau qu'avant, sans en inventer un.
  const publies = await page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published
      .filter((/** @type {any} */ e) => e.type === 'level.ambient')
      .map((/** @type {any} */ e) => e.payload.ambient.level)
  );
  expect(publies).toEqual([0, 1]);
});
