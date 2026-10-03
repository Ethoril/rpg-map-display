// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Le fog des tablettes ne doit pas dépendre des frames accordées à la fenêtre MJ.
 *
 * Défaut observé le 2 août 2026 : côté joueur, le fog ne bougeait qu'au F5 ou au
 * changement de fenêtre, alors même que c'était le joueur qui déplaçait son pion. Cause
 * mesurée : le MJ, autorité de vision de la session, ne recalculait et ne publiait la
 * vision que depuis `renderAll`, donc depuis `requestAnimationFrame` — que le navigateur
 * suspend dès que la fenêtre MJ est cachée, occultée ou minimisée.
 *
 * Le test prive délibérément la page MJ de `requestAnimationFrame`. C'est la seule
 * observation qui distingue « le MJ publie » de « le MJ publie parce qu'on le regarde » :
 * avec des frames, l'ancien code passait.
 */

const LEVEL = {
  id: 'lvl',
  name: 'Carte',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: 20,
  heightCells: 16,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [
    [
      { cellX: 8, cellY: 0 },
      { cellX: 8, cellY: 6 },
    ],
  ],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

const TOKEN = {
  id: 'pc-1',
  levelId: 'lvl',
  cell: { a: 2, b: 2 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Hero',
  hidden: false,
  visionBright: 6,
  visionDim: 8,
  emitsLight: null,
  speedCells: 30,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c1',
    name: 'Session fog',
    levels: [LEVEL],
    links: [],
    tokens: [TOKEN],
    templates: [],
    settings: {},
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Types d'événements réellement publiés par une page, depuis le journal du transport.
 * @param {import('@playwright/test').Page} page
 */
const published = (page) =>
  page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.map((/** @type {any} */ e) => e.type)
  );

/**
 * Empreinte du canvas affiché : dit si le voile a *réellement* bougé à l'écran.
 * @param {import('@playwright/test').Page} page
 */
const canvasHash = (page) =>
  page.evaluate(() => {
    const board = /** @type {HTMLCanvasElement} */ (document.querySelector('#board'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (board.getContext('2d'));
    const data = ctx.getImageData(0, 0, board.width, board.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 97) hash = (hash * 31 + data[i]) >>> 0;
    return hash;
  });

/** Fait taper le joueur sur une case, comme un vrai geste de déplacement.
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 */
const tap = (page, x, y) =>
  page.evaluate(
    ([mx, my]) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'tap',
        mapPos: { x: mx, y: my },
        screenPos: { x: 0, y: 0 },
      });
    },
    [x, y]
  );

test('Le MJ privé de frames publie quand même la vision, et la tablette la rend', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = 'fog-temps-reel';

  /** @type {string[]} */
  const erreurs = [];

  const gm = await context.newPage();
  gm.on('pageerror', (err) => erreurs.push(`mj: ${err.message}`));
  await installBrowserTransport(gm, sessionId, SNAPSHOT);
  await gm.goto('/gm.html');
  await waitForApp(gm);

  const player = await context.newPage();
  player.on('pageerror', (err) => erreurs.push(`joueur: ${err.message}`));
  await installBrowserTransport(player, sessionId, SNAPSHOT);
  await player.goto('/player.html');
  await waitForApp(player);

  await expect.poll(() => published(gm), { timeout: 5000 }).toContain('vision.update');
  await player.waitForTimeout(1200);

  // La fenêtre MJ passe en arrière-plan : le navigateur ne lui donne plus de frame.
  await gm.evaluate(() => {
    /** @type {any} */ (window).requestAnimationFrame = () => 0;
  });
  const dejaPublies = (await published(gm)).length;
  const empreinteAvant = await canvasHash(player);

  // Le joueur sélectionne son pion, puis le déplace derrière le mur.
  await tap(player, 250, 250);
  await tap(player, 650, 250);

  await expect
    .poll(() => published(gm).then((types) => types.slice(dejaPublies)), { timeout: 8000 })
    .toContain('vision.update');

  await expect
    .poll(() => canvasHash(player), { timeout: 8000 })
    .not.toBe(empreinteAvant);

  expect(erreurs).toEqual([]);
  await context.close();
});

test('⭐ De nuit, une zone révélée au pinceau par le MJ montre son décor sur la tablette (03/10/2026)', async ({
  browser,
}) => {
  // Défaut de table du 03/10/2026 : sur un étage réglé sur Nuit, le pinceau « Révéler »
  // marchait côté MJ mais la tablette restait noire — le fog arrivait, mais l'exploré non
  // éclairé n'y recevait aucun plancher. Décision du mainteneur : il reçoit le même plancher
  // gris que la vision nocturne. Ce test passe par la VRAIE page joueurs : c'est son
  // branchement (`exploredCanvas` vers la couche lumière) qu'il épingle.
  const context = await browser.newContext();
  const sessionId = 'pinceau-de-nuit';
  /** @type {string[]} */
  const erreurs = [];

  const nuit = structuredClone(SNAPSHOT);
  nuit.campaign.levels[0].ambient = { level: 0, baked: false };
  nuit.campaign.levels[0].walls = [];
  // Un fond uni et clair : le noir de la nuit et le gris du plancher s'y distinguent sans doute.
  // ⚠ URL relative, servie par `context.route` : le schéma refuse `data:` pour un étage.
  nuit.campaign.levels[0].imageUrl = 'fond-nuit-pinceau.svg';
  await context.route('**/fond-nuit-pinceau.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1600"><rect width="2000" height="1600" fill="#c8c8c8"/></svg>',
    })
  );
  nuit.campaign.tokens[0].visionDim = 2;
  nuit.campaign.tokens[0].visionBright = 0;

  const gm = await context.newPage();
  gm.on('pageerror', (err) => erreurs.push(`mj: ${err.message}`));
  await installBrowserTransport(gm, sessionId, nuit);
  await gm.goto('/gm.html');
  await waitForApp(gm);

  const player = await context.newPage();
  player.on('pageerror', (err) => erreurs.push(`joueur: ${err.message}`));
  await installBrowserTransport(player, sessionId, nuit);
  await player.goto('/player.html');
  await waitForApp(player);

  // Loin du PJ (case 2,2) et de sa portée nocturne : la case 15,12.
  const cible = { x: 1550, y: 1250 };
  /** Somme R+V+B du canvas joueurs au point carte donné. */
  const luminance = () =>
    player.evaluate(([mx, my]) => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      const board = /** @type {HTMLCanvasElement} */ (app.canvas);
      const ecran = app.camera.mapToScreen({ x: mx, y: my });
      const echelle = board.width / board.getBoundingClientRect().width;
      const ctx = /** @type {CanvasRenderingContext2D} */ (board.getContext('2d'));
      const d = ctx.getImageData(Math.round(ecran.screenX * echelle), Math.round(ecran.screenY * echelle), 1, 1).data;
      return d[0] + d[1] + d[2];
    }, [cible.x, cible.y]);

  // Le point doit être à l'écran de la tablette, sinon la mesure ne veut rien dire.
  await player.evaluate(([mx, my]) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    app.camera.setZoom(0.3);
    app.camera.setPan(mx - 1000, my - 800);
  }, [cible.x, cible.y]);

  await expect.poll(() => published(gm), { timeout: 5000 }).toContain('vision.update');
  await player.waitForTimeout(1200);
  expect(await luminance(), 'avant le pinceau : noir de nuit').toBeLessThan(15);

  await gm.click('#gm-rail-fog-tools');
  await gm.click('#fog-btn-tool-reveal');
  const dejaPublies = (await published(gm)).length;
  await gm.evaluate(([mx, my]) => {
    const input = /** @type {any} */ (window).__RPG_APP__.pointerInput;
    for (const phase of ['start', 'end']) {
      input.emit({ type: 'brushStroke', mapPos: { x: mx, y: my }, screenPos: { screenX: 0, screenY: 0 }, phase });
    }
  }, [cible.x, cible.y]);

  await expect
    .poll(() => published(gm).then((types) => types.slice(dejaPublies)), { timeout: 5000 })
    .toContain('fog.update');
  await expect
    .poll(luminance, { timeout: 8000, message: '⛔ la zone peinte doit sortir du noir sur la tablette' })
    .toBeGreaterThan(40);

  expect(erreurs).toEqual([]);
  await context.close();
});
