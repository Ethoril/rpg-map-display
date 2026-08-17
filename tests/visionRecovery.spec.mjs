// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * La vision directe doit survivre à la perte du contexte de la tablette.
 *
 * Défaut observé le 6 août 2026, en séance : au retour sur la tablette après une longue
 * inactivité, le fog revenait en version « zone explorée mais non visible » là où les PJ
 * voient — autrement dit la vision directe disparaissait — et ne revenait qu'au premier
 * déplacement.
 *
 * Trois mécanismes, chacun correct isolément, se refermaient ensemble :
 *
 *  1. `getSessionFog` relit le masque exploré depuis `localStorage` quand la mémoire est
 *     vide ; `getSessionVision` ne lit que la `Map` en mémoire. D'où l'asymétrie exacte du
 *     symptôme : l'exploré revient, la vision non.
 *  2. À la connexion, le transport borne son écoute *strictement après* la dernière clé
 *     existante — volontairement, pour ne pas rejouer l'histoire. Le dernier `vision.update`
 *     n'est donc jamais redélivré, et l'instantané ne transporte pas la vision.
 *  3. Le MJ dédoublonne ses publications de vision par signature d'étage, et rien
 *     n'invalidait jamais ce cache. De son point de vue, rien n'avait changé : rien à
 *     publier.
 *
 * Le test fait un **vrai F5** sur la page joueurs et n'émet **aucun geste** ensuite. C'est
 * la seule observation qui distingue « la vision est là » de « la vision revient parce
 * qu'on a bougé un pion » : avec un déplacement, l'ancien code passait.
 *
 * ⚠ `addInitScript` rejoue à chaque navigation : le rechargement obtient un transport
 * neuf, et `BroadcastChannel` ne rejoue rien. Le harnais reproduit donc fidèlement la
 * propriété « pas de replay » du vrai transport, qui est la pièce n°2 du défaut.
 */

const LEVEL = {
  id: 'lvl',
  name: 'Carte',
  order: 0,
  imageUrl: 'maps/minimal.webp',
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
    name: 'Session vision',
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
 * Le masque de vision courante détenu par la page, vu du store.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
const aLaVision = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return typeof store.getSessionVision('lvl') === 'string';
  });

/**
 * Le masque exploré détenu par la page — la moitié qui, elle, survivait déjà.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
const aLExplore = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return typeof store.getSessionFog('lvl') === 'string';
  });

/**
 * Nombre de `vision.update` réellement publiés par la page MJ.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
const visionsPubliees = (page) =>
  page.evaluate(
    () =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter(
        (/** @type {any} */ e) => e.type === 'vision.update'
      ).length
  );

/**
 * Luminance moyenne du canvas joueurs.
 *
 * Le masque de vision **perce** le voile (`destination-out`) : là où les PJ voient, le
 * voile est absent et l'image apparaît en clair. Mesurer la luminance dit donc si le
 * masque restauré agit réellement à l'écran, et pas seulement s'il a atterri dans le store.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
const luminance = (page) =>
  page.evaluate(() => {
    const board = /** @type {HTMLCanvasElement} */ (document.querySelector('#board'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (board.getContext('2d'));
    const data = ctx.getImageData(0, 0, board.width, board.height).data;
    let somme = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      somme += data[i] + data[i + 1] + data[i + 2];
      n += 3;
    }
    return n === 0 ? 0 : somme / n;
  });

/**
 * Ouvre une page applicative munie du transport de test.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} chemin
 * @param {string} sessionId
 * @param {string[]} erreurs
 * @param {string} etiquette
 */
async function ouvrirPage(context, chemin, sessionId, erreurs, etiquette) {
  const page = await context.newPage();
  page.on('pageerror', (err) => erreurs.push(`${etiquette}: ${err.message}`));
  await installBrowserTransport(page, sessionId, SNAPSHOT);
  await page.goto(chemin);
  await waitForApp(page);
  return page;
}

/**
 * Première forme du défaut, et la plus large : la tablette rejoint une session déjà en
 * cours. Le MJ a publié sa vision avant qu'elle n'écoute ; `BroadcastChannel` — comme le
 * vrai canal, borné strictement après la dernière clé — ne rejoue rien ; et le cache de
 * signature du MJ le persuade qu'il n'a rien à redire.
 *
 * Mesuré avant correctif : le MJ publie bien `fog.update, vision.update, fog.update`, et la
 * tablette reçoit une liste **vide**. L'exploré lui revient malgré tout, par `localStorage` :
 * d'où le symptôme « le fog revient en version explorée, la vision directe disparaît ».
 */
test('une tablette qui rejoint une session déjà en cours reçoit la vision directe', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `vision-arrivee-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  // Le MJ d'abord : il aura fini de publier avant que la tablette n'écoute.
  const gm = await ouvrirPage(context, '/gm.html', sessionId, erreurs, 'mj');
  await expect.poll(() => visionsPubliees(gm), { timeout: 8000 }).toBeGreaterThan(0);

  const player = await ouvrirPage(context, '/player.html', sessionId, erreurs, 'joueur');

  // Aucun geste : la tablette doit obtenir la vision du seul fait d'être arrivée.
  await expect.poll(() => aLaVision(player), { timeout: 8000 }).toBe(true);

  expect(erreurs).toEqual([]);
  await context.close();
});

/**
 * Seconde forme, celle observée en séance : la tablette était en règle, puis Chrome Android
 * abandonne le contexte de l'onglet longuement en arrière-plan. Ici la tablette écoute
 * **avant** que le MJ ne publie, donc la référence tient — et c'est le rechargement seul qui
 * fait perdre la vision.
 */
test('après un vrai F5, la tablette retrouve la vision directe sans aucun déplacement', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `vision-reprise-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  // La tablette d'abord, pour qu'elle écoute quand le MJ publiera.
  const player = await ouvrirPage(context, '/player.html', sessionId, erreurs, 'joueur');
  const gm = await ouvrirPage(context, '/gm.html', sessionId, erreurs, 'mj');

  // Référence : en régime normal, la tablette a bien les deux masques.
  await expect.poll(() => aLaVision(player), { timeout: 8000 }).toBe(true);
  await expect.poll(() => aLExplore(player), { timeout: 8000 }).toBe(true);

  const visionsAvant = await visionsPubliees(gm);

  await player.reload();
  await waitForApp(player);

  // Aucun geste, aucun déplacement : la vision doit revenir d'elle-même.
  await expect.poll(() => aLaVision(player), { timeout: 8000 }).toBe(true);

  // Et elle doit revenir de l'autorité, fraîchement calculée — pas d'un cache périmé.
  await expect.poll(() => visionsPubliees(gm), { timeout: 8000 }).toBeGreaterThan(visionsAvant);

  // Elle doit enfin agir à l'écran. Le témoin est pris dans le test lui-même, en retirant
  // le masque : aucune hypothèse sur la clarté absolue de l'image de fond.
  await player.waitForTimeout(500);
  const avecVision = await luminance(player);
  await player.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setSessionVision('lvl', null);
  });
  await player.waitForTimeout(500);
  const sansVision = await luminance(player);

  expect(avecVision).toBeGreaterThan(sansVision + 1);

  expect(erreurs).toEqual([]);
  await context.close();
});
