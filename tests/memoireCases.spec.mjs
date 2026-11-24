// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Mémoire des cases (contrat de liaison §7, révision du 24/11/2026, amendement n° 11).
 *
 * Reproduit la recette du 24/11 : le MJ « Termine le combat » puis annule. L'outil MJ est simulé par le
 * vrai canal `wfrp-map-link` (comme `pointImpact.spec.mjs`) : trois `token.remove`, puis trois `token.add`.
 * Les trois pions doivent retrouver leur case, la réserve ne grossit pas et la tablette voit la même
 * table que le MJ. Second scénario : la page MJ est rechargée entre le retrait et l'ajout.
 */

const PX = 100;

/** @param {string} id @param {string} ref @param {{ a: number, b: number }} cell @param {Record<string, any>} [overrides] */
function pionLie(id, ref, cell, overrides = {}) {
  return {
    id, levelId: 'rdc', cell, sizeCells: 1, kind: ref.startsWith('pj:') ? 'pc' : 'npc', imageUrl: '',
    borderColor: '#22c55e', label: id, hidden: false, visionBright: 3, visionDim: 6, emitsLight: null,
    speedCells: 4, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed',
    link: { source: 'outil-mj', ref }, camp: ref.startsWith('pj:') ? 'pj' : 'ennemi',
    ...overrides,
  };
}

function instantane() {
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: 'memoire-cases',
      name: 'Mémoire des cases',
      levels: [{
        id: 'rdc', name: 'Salle', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
        pxPerCell: PX, widthCells: 12, heightCells: 10,
        grid: { type: /** @type {const} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
        terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false },
      }],
      links: [],
      tokens: [
        pionLie('pj', 'pj:aldric', { a: 1, b: 1 }),
        pionLie('gobelin', 'p:gobelin', { a: 3, b: 2 }),
        pionLie('ogre', 'p:ogre', { a: 8, b: 6 }, { hidden: true }),
        pionLie('loup', 'p:loup', { a: 5, b: 7 }),
      ],
      // Déjà en réserve avant la rencontre : le compteur ne part pas de zéro.
      reserve: [pionLie('archer', 'p:archer', { a: 0, b: 0 })],
      templates: [],
      settings: {},
    },
    activeLevelId: 'rdc',
    selectedTokenId: null,
    activeHandout: null,
  };
}

/** @param {string} ref */
const etatOutil = (ref) => ({
  ref, label: ref, camp: 'ennemi', kind: 'npc', visionSource: false, imageUrl: null, sizeCells: 1,
  speedCells: 4, runCells: 8, visionDim: 1, hp: { current: 8, max: 8 }, health: 'unharmed',
  markers: [], markerLevels: {}, dead: false,
});

const REFS = ['p:gobelin', 'p:ogre', 'p:loup'];

/** @param {import('@playwright/test').Page} gm */
async function simulerOutil(gm) {
  await gm.evaluate(() => { /** @type {any} */ (window).__outil = new BroadcastChannel('wfrp-map-link'); });
}

/** @param {import('@playwright/test').Page} gm @param {string} type @param {any} payload */
const envoyer = (gm, type, payload) => gm.evaluate(([t, p]) => {
  /** @type {any} */ (window).__outil.postMessage({ v: 3, type: t, seq: Date.now(), at: Date.now(), from: 'outil-mj', payload: p });
}, /** @type {const} */ ([type, payload]));

/**
 * Pions liés du plateau, par ref, et nombre de lignes de la réserve visible (le « À poser » de la carte).
 * @param {import('@playwright/test').Page} page
 */
const table = (page) => page.evaluate(async () => {
  const store = await import('../js/state/store.js');
  const campaign = store.getState().campaign;
  return {
    plateau: (campaign?.tokens ?? [])
      .filter((t) => t.link)
      .map((t) => `${t.link?.ref}@${t.levelId}:${t.cell.a},${t.cell.b}${t.hidden ? ':caché' : ''}`)
      .sort(),
    reserve: (campaign?.reserve ?? []).map((t) => t.link?.ref).sort(),
  };
});

const AVANT = ['p:gobelin@rdc:3,2', 'p:loup@rdc:5,7', 'p:ogre@rdc:8,6:caché', 'pj:aldric@rdc:1,1'];

/** @param {import('@playwright/test').Browser} browser */
async function monter(browser) {
  const sessionId = `memoire-cases-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const snap = instantane();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  /** @type {string[]} */
  const erreurs = [];
  const gm = await context.newPage();
  const player = await context.newPage();
  gm.on('pageerror', (e) => erreurs.push(`gm: ${e.message}`));
  player.on('pageerror', (e) => erreurs.push(`player: ${e.message}`));
  await Promise.all([installBrowserTransport(gm, sessionId, snap), installBrowserTransport(player, sessionId, snap)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);
  await simulerOutil(gm);
  return { context, gm, player, erreurs };
}

/** @param {import('@playwright/test').Page} gm */
async function finDeRencontre(gm) {
  for (const ref of REFS) await envoyer(gm, 'token.remove', { ref });
}

/** @param {import('@playwright/test').Page} gm */
async function annulerLaFin(gm) {
  for (const ref of REFS) await envoyer(gm, 'token.add', etatOutil(ref));
}

test('fin de rencontre puis annulation : les trois pions reviennent à leur case, la réserve ne bouge pas, la tablette suit', async ({ browser }) => {
  const { context, gm, player, erreurs } = await monter(browser);
  try {
    expect((await table(gm)).plateau).toEqual(AVANT);
    expect((await table(gm)).reserve).toEqual(['p:archer']);

    await finDeRencontre(gm);
    await expect.poll(async () => (await table(gm)).plateau).toEqual(['pj:aldric@rdc:1,1']);
    await expect.poll(async () => (await table(player)).plateau).toEqual(['pj:aldric@rdc:1,1']);

    await annulerLaFin(gm);
    await expect.poll(async () => (await table(gm)).plateau).toEqual(AVANT);
    expect((await table(gm)).reserve, 'rien de plus à poser').toEqual(['p:archer']);
    await expect.poll(async () => (await table(player)).plateau, 'la tablette voit la même table').toEqual(AVANT);
    expect((await table(player)).reserve, 'la tablette n’a rien reçu en réserve non plus').toEqual(['p:archer']);
    expect(erreurs).toEqual([]);
  } finally {
    await context.close();
  }
});

test('fin de rencontre, rechargement de la page MJ, puis annulation : mêmes cases retrouvées', async ({ browser }) => {
  const { context, gm, player, erreurs } = await monter(browser);
  try {
    await finDeRencontre(gm);
    await expect.poll(async () => (await table(gm)).plateau).toEqual(['pj:aldric@rdc:1,1']);

    // Ce que la sauvegarde de la page a écrit (le double de transport la garde) revient au rechargement,
    // comme l'instantané du vrai transport : la mémoire doit y figurer pour survivre.
    await expect.poll(() => gm.evaluate(() => {
      const saved = /** @type {any} */ (window).__RPG_TEST_WIRE__.savedSnapshot;
      return saved ? JSON.parse(saved).campaign.removedLinkedPlaces?.length ?? 0 : 0;
    })).toBe(3);
    const sauve = await gm.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.savedSnapshot);
    await gm.addInitScript((json) => { /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = JSON.parse(json); }, sauve);
    await gm.reload();
    await waitForApp(gm);
    await simulerOutil(gm);
    expect((await table(gm)).plateau).toEqual(['pj:aldric@rdc:1,1']);

    await annulerLaFin(gm);
    await expect.poll(async () => (await table(gm)).plateau).toEqual(AVANT);
    expect((await table(gm)).reserve).toEqual(['p:archer']);
    await expect.poll(async () => (await table(player)).plateau).toEqual(AVANT);
    expect(erreurs).toEqual([]);
  } finally {
    await context.close();
  }
});
