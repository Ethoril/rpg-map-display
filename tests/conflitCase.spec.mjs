// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * C3 (audit du 22/09/2026, tranché le 23/09 : D-10) — le MJ et la table déplacent chacun un pion
 * vers la MÊME case, chacun avant d'avoir reçu le coup de l'autre. Chaque poste refusait le coup
 * reçu (une case, un pion), et les deux écrans divergeaient jusqu'au F5, sans rien signaler.
 *
 * Règle : le MJ arbitre. Il garde son coup, renvoie au pion de la table sa case d'origine, et
 * réannonce son propre pion, que la tablette avait refusé.
 */

const NIVEAU = {
  id: 'lvl', name: 'Salle', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
  pxPerCell: 100, widthCells: 12, heightCells: 8,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false },
};

/** @param {string} id @param {'pc'|'npc'} kind @param {{a: number, b: number}} cell */
const pion = (id, kind, cell) => ({
  id, levelId: 'lvl', cell, sizeCells: 1, kind, imageUrl: '', borderColor: '#00ff00', label: id,
  hidden: false, visionBright: 6, visionDim: 8, emitsLight: null, speedCells: 30,
  playerMovable: kind === 'pc', locked: false, elevation: 0, markers: [],
});

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2, campaignId: 'c3', name: 'Conflit', levels: [NIVEAU], links: [],
    tokens: [pion('pc-1', 'pc', { a: 2, b: 2 }), pion('pnj-1', 'npc', { a: 6, b: 2 })],
    templates: [], settings: {},
  },
  activeLevelId: 'lvl', selectedTokenId: null, activeHandout: null,
};

/** @param {import('@playwright/test').Page} page */
const positions = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const t = store.getCampaign()?.tokens ?? [];
    /** @param {string} id */
    const cellule = (id) => {
      const c = t.find((x) => x.id === id)?.cell;
      return c ? `${c.a},${c.b}` : null;
    };
    return { pc: cellule('pc-1'), pnj: cellule('pnj-1') };
  });

/**
 * Joue un coup comme le fait l'application : mutation locale, puis publication.
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 * @param {'gm'|'players'} par
 */
const jouer = (page, tokenId, par) =>
  page.evaluate(async ([id, auteur]) => {
    const store = await import('../js/state/store.js');
    const token = store.getCampaign()?.tokens.find((t) => t.id === id);
    if (!token) throw new Error(`pion ${id} absent`);
    const from = { ...token.cell };
    const to = { a: 4, b: 2 };
    store.moveTokenToCell(id, to, { from, to, path: [from, to], startedAt: Date.now() });
    await /** @type {any} */ (window).__RPG_APP__.transport.publish({
      type: 'token.move', payload: { tokenId: id, from, to, path: [from, to], startedAt: Date.now() },
      at: Date.now(), by: auteur,
    });
  }, /** @type {const} */ ([tokenId, par]));

test('C3 : deux coups vers la même case — le MJ arbitre, et les deux écrans convergent', async ({ browser }) => {
  const context = await browser.newContext();
  /** @type {string[]} */
  const erreurs = [];
  const gm = await context.newPage();
  gm.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  await installBrowserTransport(gm, 'c3-conflit', SNAPSHOT);
  await gm.goto('/gm.html?session=c3-conflit');
  await waitForApp(gm);
  const player = await context.newPage();
  player.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
  await installBrowserTransport(player, 'c3-conflit', SNAPSHOT);
  await player.goto('/player.html?session=c3-conflit');
  await waitForApp(player);

  // Chacun joue AVANT d'avoir reçu le coup de l'autre.
  for (const page of [gm, player]) {
    await page.evaluate(() => { /** @type {any} */ (window).__RPG_TEST_WIRE__.retenir = true; });
  }
  await jouer(player, 'pc-1', 'players');
  await jouer(gm, 'pnj-1', 'gm');
  for (const page of [gm, player]) {
    await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.relacher());
  }

  // Le coup du MJ l'emporte, partout.
  const attendu = { pc: '2,2', pnj: '4,2' };
  await expect.poll(() => positions(gm), { timeout: 5000 }).toEqual(attendu);
  await expect.poll(() => positions(player), { timeout: 5000 }).toEqual(attendu);
  expect(erreurs).toEqual([]);
  await context.close();
});
