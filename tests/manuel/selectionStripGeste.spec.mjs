// @ts-check
/**
 * GESTE RÉEL — la bande de sélection de la tablette (chantier C-9, tranche 2).
 *
 * Un vrai appui sur le pion, puis un vrai appui sur le bouton cheval de la bande : le pion monte,
 * reste sélectionné, et la carte ne bouge pas. `tests/selectionStrip.spec.mjs` garde la mécanique ;
 * celui-ci garde le geste, de bout en bout, par les événements que le navigateur fabrique lui-même.
 *
 * Le projet `manuel` est un « Desktop Chrome » sans écran tactile : le geste passe donc par la
 * souris réelle (`page.mouse`), qui produit les mêmes `pointerdown` / `pointerup` que le doigt.
 *
 * ⚠ **Coordonnées du VIEWPORT, jamais du canvas.** `camera.mapToScreen` rend des coordonnées
 * relatives au canvas, `page.mouse` en attend du viewport ; les deux ne coïncident que si `#board`
 * commence en `(0, 0)`. C'est exactement le faux diagnostic que raconte l'en-tête de
 * `gmToolDisarmGeste.spec.mjs` : on y ajoute donc toujours le coin du canvas mesuré.
 *
 * ⚠ Les `import()` dans les `page.evaluate` s'écrivent `../../js/…`, pour la raison donnée dans
 * l'en-tête de `gmToolDisarmGeste.spec.mjs`.
 */
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from '../browserTestTransport.mjs';

const PX = 100;

const INSTANTANE = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c9-bande-geste',
    name: 'Bande, geste réel',
    levels: [
      {
        id: 'rdc',
        name: 'Rez-de-chaussée',
        order: 0,
        imageUrl: '',
        videoUrl: null,
        animatedOverlays: [],
        pxPerCell: PX,
        widthCells: 12,
        heightCells: 10,
        grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
        terrainCost: null,
        walls: [],
        portals: [],
        lights: [],
        ambient: { level: 1, baked: false },
      },
    ],
    links: [],
    tokens: [
      {
        id: 'pj',
        levelId: 'rdc',
        cell: { a: 4, b: 4 },
        sizeCells: 1,
        kind: 'pc',
        imageUrl: '',
        borderColor: '#00ff00',
        label: 'Cavalier',
        hidden: false,
        visionDim: 8,
        emitsLight: null,
        speedCells: 3,
        playerMovable: true,
        locked: false,
        elevation: 0,
        markers: [],
        hp: null,
        health: 'unharmed',
        mounted: false,
      },
    ],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

test('GESTE C-9 — un vrai appui sur le cheval de la bande monte le pion, sans pan ni désélection', async ({
  page,
}) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));

  await installBrowserTransport(page, `c9-bande-geste-${Date.now()}`, INSTANTANE);
  await page.goto('/player.html');
  await waitForApp(page);

  const etat = () =>
    page.evaluate(async () => {
      const store = await import('../../js/state/store.js');
      const c = /** @type {any} */ (window).__RPG_APP__.camera;
      const pj = store.getCampaign()?.tokens.find((t) => t.id === 'pj');
      return {
        selection: store.getState().selectedTokenId,
        mounted: pj?.mounted,
        cell: pj?.cell,
        camera: { x: c.x, y: c.y, zoom: c.zoom },
        publies: /** @type {any} */ (window).__RPG_TEST_WIRE__.published.map(
          (/** @type {any} */ e) => e.type
        ),
      };
    });

  // Centre du pion, en coordonnées du VIEWPORT : coin du canvas + point écran de la caméra.
  const cible = await page.evaluate((px) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const rect = app.canvas.getBoundingClientRect();
    const p = app.camera.mapToScreen({ x: 4.5 * px, y: 4.5 * px });
    return { x: rect.left + p.screenX, y: rect.top + p.screenY };
  }, PX);
  await page.mouse.click(cible.x, cible.y);

  await expect.poll(async () => (await etat()).selection).toBe('pj');
  const bande = page.locator('#player-selection-strip');
  await expect(bande).toBeVisible();
  const avant = await etat();

  const bouton = page.locator('#player-selection-strip .player-selection-mount');
  const boite = await bouton.boundingBox();
  if (!boite) throw new Error('bouton cheval sans boîte');
  // Cible tactile d'au moins 44 px, mesurée sur le rendu réel.
  expect(boite.width).toBeGreaterThanOrEqual(44);
  expect(boite.height).toBeGreaterThanOrEqual(44);
  await page.mouse.click(boite.x + boite.width / 2, boite.y + boite.height / 2);

  await expect.poll(async () => (await etat()).mounted).toBe(true);
  const apres = await etat();
  expect(apres.selection, 'la bande ne désélectionne pas').toBe('pj');
  expect(apres.cell, 'la bande ne déplace pas le pion').toEqual({ a: 4, b: 4 });
  expect(apres.camera, 'la bande ne fait pas défiler la carte').toEqual(avant.camera);
  expect(apres.publies).toContain('token.mounted');
  expect(apres.publies).not.toContain('token.move');
  await expect(bouton).toHaveAttribute('aria-label', 'Descendre de cheval');
  expect(erreurs).toEqual([]);
});
