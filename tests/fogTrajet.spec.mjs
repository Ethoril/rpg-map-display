// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Qui révèle un trajet, et qui ne le révèle pas.
 *
 * Un joueur **marche** son déplacement : les cases traversées et ce qu'il en a aperçu lui
 * restent acquis (critère 7). Le MJ, lui, franchit les murs et pose son pion où il veut :
 * son glisser n'est pas un trajet marché, et ne doit révéler que ce qui se voit depuis la
 * case d'arrivée.
 *
 * Le code faisait l'inverse jusqu'au 02/08/2026. Les deux moitiés du test cassent
 * indépendamment : ne vérifier que la première laisserait le glisser MJ continuer
 * d'ouvrir des couloirs que personne n'a parcourus.
 */

// Carte longue et vide. La vision est courte (2 cases) et le trajet long (24 cases) :
// le milieu du trajet est hors de portée du départ **comme** de l'arrivée. C'est la seule
// façon de distinguer « le trajet est révélé » de « l'arrivée est révélée ».
const CELL_DEPART = { a: 2, b: 8 };
const CELL_ARRIVEE = { a: 26, b: 8 };
const CELL_MILIEU = { a: 14, b: 8 };
const PX_PAR_CASE = 100;

/** @param {{a: number, b: number}} cell */
const centre = (cell) => ({
  x: (cell.a + 0.5) * PX_PAR_CASE,
  y: (cell.b + 0.5) * PX_PAR_CASE,
});

const LEVEL = {
  id: 'lvl',
  name: 'Couloir',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: PX_PAR_CASE,
  widthCells: 30,
  heightCells: 16,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { color: '#ffffff', level: 1, baked: false },
};

const TOKEN = {
  id: 'pc-1',
  levelId: 'lvl',
  cell: CELL_DEPART,
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Hero',
  hidden: false,
  visionBright: 1,
  visionDim: 2,
  emitsLight: null,
  speedCells: 60,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c1',
    name: 'Trajet',
    levels: [LEVEL],
    links: [],
    tokens: [TOKEN],
    templates: [],
    settings: { ambientLevel: 1 },
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Installe, dans la page joueurs, une sonde qui lit le masque exploré **tel que reçu**.
 *
 * On mesure le masque publié, pas les pixels rendus : le voile, la grille et le
 * placeholder de fond se superposent à l'écran, et une mesure de couleur dirait autant
 * du décor que du fog. Le module importé est la même instance que celle de
 * `app/player.js` — même URL, même singleton de store.
 *
 * @param {import('@playwright/test').Page} page
 */
async function installerSonde(page) {
  await page.addScriptTag({
    type: 'module',
    content: `
      import * as store from './js/state/store.js';
      import { decodeFogPng } from './js/vision/fog.js';

      window.__sondeFog = {
        pngRecu: () => store.getSessionFog('lvl'),
        // Alpha du masque exploré au centre d'une case : 0 = jamais exploré.
        alphaCase: async (a, b) => {
          const png = store.getSessionFog('lvl');
          if (!png) return null;
          const canvas = await decodeFogPng(png, ${LEVEL.widthCells}, ${LEVEL.heightCells});
          const ctx = canvas.getContext('2d');
          return ctx.getImageData(a * 8 + 4, b * 8 + 4, 1, 1).data[3];
        },
      };
    `,
  });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__sondeFog));
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{a: number, b: number}} cell
 * @returns {Promise<number|null>}
 */
const alphaCase = (page, cell) =>
  page.evaluate(
    ([a, b]) => /** @type {any} */ (window).__sondeFog.alphaCase(a, b),
    [cell.a, cell.b]
  );

/**
 * Monte une session MJ + joueurs sur un identifiant propre.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} sessionId
 */
async function monterSession(browser, sessionId) {
  const context = await browser.newContext();
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
  await installerSonde(player);

  // On attend la première publication : sans elle, un « pas encore exploré » ne
  // prouverait rien, il dirait seulement que rien n'est encore arrivé.
  await expect.poll(() => alphaCase(player, CELL_DEPART), { timeout: 8000 }).toBeGreaterThan(0);

  return { context, gm, player, erreurs };
}

test('Un déplacement joueur révèle tout le trajet, y compris son milieu', async ({ browser }) => {
  const { context, player, erreurs } = await monterSession(browser, 'fog-trajet-joueur');

  expect(await alphaCase(player, CELL_MILIEU)).toBe(0);

  // Le joueur sélectionne son pion, puis tape la case d'arrivée : un vrai geste.
  await player.evaluate(
    ([depart, arrivee]) => {
      const input = /** @type {any} */ (window).__RPG_APP__.pointerInput;
      input.emit({ type: 'tap', mapPos: depart, screenPos: { x: 0, y: 0 } });
      input.emit({ type: 'tap', mapPos: arrivee, screenPos: { x: 0, y: 0 } });
    },
    [centre(CELL_DEPART), centre(CELL_ARRIVEE)]
  );

  await expect.poll(() => alphaCase(player, CELL_ARRIVEE), { timeout: 8000 }).toBeGreaterThan(0);
  // Le milieu est à douze cases de chaque extrémité, pour une vision de deux : il n'est
  // révélé que si le trajet lui-même l'a été.
  expect(await alphaCase(player, CELL_MILIEU)).toBeGreaterThan(0);

  expect(erreurs).toEqual([]);
  await context.close();
});

test('Un glisser MJ ne révèle que la case d arrivée, pas la ligne parcourue', async ({
  browser,
}) => {
  const { context, gm, player, erreurs } = await monterSession(browser, 'fog-trajet-mj');

  expect(await alphaCase(player, CELL_MILIEU)).toBe(0);

  await gm.evaluate(
    ([arrivee]) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'dragToken',
        phase: 'end',
        tokenId: 'pc-1',
        mapPos: arrivee,
        screenPos: { x: 0, y: 0 },
      });
    },
    [centre(CELL_ARRIVEE)]
  );

  await expect.poll(() => alphaCase(player, CELL_ARRIVEE), { timeout: 8000 }).toBeGreaterThan(0);
  // Le MJ a franchi la carte d'un geste ; personne n'a marché ce couloir.
  expect(await alphaCase(player, CELL_MILIEU)).toBe(0);

  expect(erreurs).toEqual([]);
  await context.close();
});
