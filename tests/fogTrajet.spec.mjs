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
  // Le scénario mesure le trajet dans l'obscurité. En ambiance pleine, le milieu
  // est déjà visible avant tout mouvement et l'assertion n'a plus de sens.
  ambient: { color: '#ffffff', level: 0, baked: false },
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
  //
  // ⚠ `poll` et non une assertion sèche, et ce n'est pas une précaution de style : les deux
  // cases arrivent dans DEUX publications distinctes, mesuré le 05/08/2026. La vision de la
  // case d'arrivée part dès le commit du déplacement (relevé entre 336 ms et 2,4 s), le
  // trajet marché ne suit qu'à la fin de l'animation — `TOKEN_MOVE_STEP_MS` × 24 pas, soit
  // 3 840 ms (relevé entre 3,3 s et 4,4 s). Le `poll` ci-dessus est donc satisfait par la
  // première, bien avant que la seconde n'existe.
  //
  // Sur une machine au repos les deux publications se coalescent et l'assertion sèche
  // passait ; sous la charge des workers parallèles l'écart de 3,5 s s'ouvre et elle lisait
  // l'état intermédiaire. 2 échecs sur 16 en `--repeat-each=8 --workers=6`. La convergence,
  // elle, n'a jamais manqué : le milieu finit toujours par être révélé, et le masque ne
  // régresse jamais — ce n'était donc pas un défaut de l'application.
  await expect.poll(() => alphaCase(player, CELL_MILIEU), { timeout: 8000 }).toBeGreaterThan(0);

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
  //
  // ⚠ L'attente n'est pas superflue, elle est ce qui rend l'assertion capable d'échouer.
  // Vérifier une **absence** juste après le `poll` ci-dessus la vérifiait à un instant où
  // aucune publication de trajet n'a encore pu partir — mesuré le 05/08/2026, celle du
  // déplacement joueur n'arrive qu'après `TOKEN_MOVE_STEP_MS` × 24 pas. L'assertion passait
  // donc quoi qu'il arrive, y compris si l'application révélait le couloir à tort : un test
  // qui ne peut pas échouer ne vérifie rien.
  //
  // La fenêtre est dérivée de la constante d'animation, pas choisie : 24 pas × 160 ms, plus
  // une marge. Sonde à l'appui, le couloir reste noir sur 10 s de relevé — l'absence est
  // réelle, elle est désormais aussi prouvée.
  await player.waitForTimeout(24 * 160 + 1200);
  expect(await alphaCase(player, CELL_MILIEU)).toBe(0);

  expect(erreurs).toEqual([]);
  await context.close();
});
