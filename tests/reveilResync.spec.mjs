// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Réveil d'un onglet endormi : quand faut-il resynchroniser, et surtout quand ne le faut-il pas ?
 *
 * Défaut de séance du 16 août 2026 : la tablette s'est désynchronisée après un changement
 * d'onglet sur le poste MJ suivi d'une inactivité. Cause : un onglet masqué cesse d'écrire son
 * curseur de rétention, sort de la barrière au bout de deux minutes, et un autre poste purge
 * alors des événements qu'il n'a jamais lus. `startAfter(curseur)` ne les livrera jamais.
 *
 * ⚠ Le second scénario est le plus important des deux : il interdit le correctif naïf « relire
 * l'instantané à chaque réveil ». L'instantané est réécrit 250 ms après chaque mutation, donc
 * il peut être en retard sur un événement déjà appliqué — le relire sans raison ferait
 * régresser l'état de façon permanente.
 */

const NIVEAU = {
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
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

/** @param {{a: number, b: number}} cell */
const pion = (cell) => ({
  id: 'pc-1',
  levelId: 'lvl',
  cell,
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Hero',
  hidden: false,
  visionBright: 20,
  visionDim: 24,
  emitsLight: null,
  speedCells: 30,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
});

/** @param {{a: number, b: number}} cell */
const instantane = (cell) => ({
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-reveil',
    name: 'Réveil',
    levels: [NIVEAU],
    links: [],
    tokens: [pion(cell)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
  activeHandout: null,
});

const S0 = instantane({ a: 2, b: 2 });
const S1 = instantane({ a: 5, b: 5 });
const S2 = instantane({ a: 8, b: 3 });

/**
 * Case du pion telle que la page la connaît réellement, lue dans le store.
 * @param {import('@playwright/test').Page} page
 */
const caseDuPion = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const token = (store.getCampaign()?.tokens ?? []).find((/** @type {any} */ t) => t.id === 'pc-1');
    return token ? `${token.cell.a},${token.cell.b}` : null;
  });

/**
 * Nombre de resynchros que le transport a réellement subies.
 * @param {import('@playwright/test').Page} page
 */
const resynchros = (page) =>
  page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.resyncs);

/**
 * Endort puis réveille l'onglet, avec ou sans trou de rétention déclaré par le transport.
 * @param {import('@playwright/test').Page} page
 * @param {boolean} trou
 */
async function endormirPuisReveiller(page, trou) {
  await page.evaluate((gap) => {
    const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
    wire.setHidden(true);
    wire.gap = gap;
    wire.setHidden(false);
  }, trou);
}

/**
 * Un tap du joueur, comme un vrai geste de déplacement.
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

/**
 * Ouvre une page MJ et une page joueurs sur la même session, avec le même instantané.
 * La page MJ est indispensable : c'est elle qui publie la vision réclamée au réveil.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} sessionId
 */
async function ouvrirLaTable(browser, sessionId) {
  const context = await browser.newContext();
  /** @type {string[]} */
  const erreurs = [];

  const gm = await context.newPage();
  gm.on('pageerror', (err) => erreurs.push(`mj: ${err.message}`));
  await installBrowserTransport(gm, sessionId, S0);
  await gm.goto('/gm.html');
  await waitForApp(gm);

  const player = await context.newPage();
  player.on('pageerror', (err) => erreurs.push(`joueur: ${err.message}`));
  await installBrowserTransport(player, sessionId, S0);
  await player.goto('/player.html');
  await waitForApp(player);

  return { context, gm, player, erreurs };
}

test('Bail périmé : la tablette resynchronise et rattrape l’état manqué', async ({ browser }) => {
  const { context, player, erreurs } = await ouvrirLaTable(browser, 'reveil-trou');

  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('2,2');

  // L'état que la tablette a « manqué » pendant son sommeil : le pion a changé de case.
  await player.evaluate((suivant) => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = suivant;
  }, S1);

  await endormirPuisReveiller(player, true);

  await expect.poll(() => resynchros(player), { timeout: 5000 }).toBe(1);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('5,5');

  // ⛔ Le SECOND réveil est le vrai piège, et aucun test ne l'attrapait. Une version du
  // correctif retirait puis reposait un écouteur `visibilitychange` dans le transport à chaque
  // resynchro : le DOM classe les écouteurs par ordre d'insertion, donc le transport repassait
  // DERRIÈRE celui de l'application, qui interrogeait le trou avant qu'il soit constaté. La
  // resynchro ne fonctionnait qu'une seule fois par chargement de page — et la tablette restait
  // désynchronisée exactement comme le 16 août 2026.
  await player.evaluate((suivant) => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = suivant;
  }, S2);

  await endormirPuisReveiller(player, true);

  await expect.poll(() => resynchros(player), { timeout: 5000 }).toBe(2);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('8,3');

  expect(erreurs).toEqual([]);
  await context.close();
});

test('Bail valide : aucune resynchro, et aucune régression de l’état', async ({ browser }) => {
  const { context, player, erreurs } = await ouvrirLaTable(browser, 'reveil-sans-trou');

  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('2,2');

  // Le store avance par un vrai geste, l'instantané reste celui du démarrage : il est donc
  // périmé, exactement comme l'instantané réel écrit 250 ms après la mutation.
  await tap(player, 250, 250);
  await tap(player, 650, 250);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('6,2');

  await endormirPuisReveiller(player, false);

  // Laisser au réveil le temps de faire le mal qu'il pourrait faire.
  await player.waitForTimeout(1000);
  expect(await caseDuPion(player)).toBe('6,2');
  expect(await resynchros(player)).toBe(0);

  expect(erreurs).toEqual([]);
  await context.close();
});
