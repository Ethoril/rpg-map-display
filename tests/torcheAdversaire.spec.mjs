// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * R9 (retour de recette du 22/11/2026) : « un adversaire qui finit son mouvement dans la zone
 * éclairée par la torche d'un PJ n'est pas détecté ». Réponses du MJ : torche posée par le panneau
 * de l'écran MJ, ennemi Moyen (1 case), étage en nuit (ambiante 0), ni mur ni porte, ennemi non caché.
 *
 * ⭐ L'assertion porte sur l'EFFET côté joueurs : les pions que la couche des pions dessine pour la
 * tablette, avec le masque de vision que le MJ a réellement publié.
 */
const pj = (/** @type {any} */ extra = {}) => ({
  id: 'pj1', levelId: 'rdc', cell: { a: 2, b: 3 }, sizeCells: 1, kind: 'pc', imageUrl: '',
  borderColor: '#2563eb', label: 'Héros', hidden: false, visionBright: 0, visionDim: 0,
  emitsLight: null, speedCells: 6, playerMovable: false, locked: false, elevation: 0,
  markers: [], hp: null, health: 'unharmed', ...extra,
});
const ennemi = (/** @type {any} */ extra = {}) => ({
  id: 'orc', levelId: 'rdc', cell: { a: 11, b: 6 }, sizeCells: 1, kind: 'npc', imageUrl: '',
  borderColor: '#b91c1c', label: 'Orc', hidden: false, visionBright: 0, visionDim: 0,
  emitsLight: null, speedCells: 6, playerMovable: false, locked: false, elevation: 0,
  markers: [], hp: null, health: 'unharmed', ...extra,
});
/** @param {any[]} tokens @param {string} selected */
const snapshot = (tokens, selected) => ({
  campaign: {
    schemaVersion: 2, campaignId: 'torche-adv', name: 'Torche', links: [], templates: [], settings: {},
    levels: [{
      id: 'rdc', name: 'RDC', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
      pxPerCell: 100, widthCells: 12, heightCells: 8,
      grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
      terrainCost: null, walls: [], portals: [], lights: [],
      ambient: { level: 0, baked: false },
    }],
    tokens,
  }, activeLevelId: 'rdc', selectedTokenId: selected, activeHandout: null,
});

/** Ce que la tablette dessine, avec le masque publié par le MJ. @param {import('@playwright/test').Page} player */
const dessinesPourLesJoueurs = (player) => player.evaluate(async () => {
  const app = /** @type {any} */ (window).__RPG_APP__;
  const store = await import('../js/state/store.js');
  const grid = await import('../js/grid/index.js');
  const level = store.getActiveLevel();
  const state = store.getState();
  if (!level || !state.campaign || !app.getPlayerVisibleCanvas(level)) return null;
  const ctx = document.createElement('canvas').getContext('2d');
  return app.tokensLayer.render(ctx, grid.gridFor(level), state.campaign.tokens, null, {
    role: 'players', isPlayerView: true, activeLevelId: level.id,
    activeLevelWidthCells: level.widthCells, activeLevelHeightCells: level.heightCells,
    visibleCanvas: app.getPlayerVisibleCanvas(level),
  }).renderedTokenIds;
});

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {any[]} tokens
 * @param {string} selected
 */
async function ouvrir(browser, tokens, selected) {
  const context = await browser.newContext();
  const sessionId = `torche-adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await installBrowserTransport(gm, sessionId, snapshot(tokens, selected));
  await installBrowserTransport(player, sessionId, snapshot(tokens, selected));
  await gm.goto(`/gm.html?session=${sessionId}`);
  await player.goto(`/player.html?session=${sessionId}`);
  await waitForApp(gm);
  await waitForApp(player);
  return { context, gm, player };
}

/** Le MJ déplace l'ennemi depuis son écran (chemin `moveTokenToCell`, puis `token.move` aux joueurs). */
const deplacerEnnemi = (/** @type {import('@playwright/test').Page} */ gm, /** @type {{a:number,b:number}} */ cell) =>
  gm.evaluate(async (c) => {
    const store = await import('../js/state/store.js');
    const from = { a: 11, b: 6 };
    const startedAt = Date.now();
    store.moveTokenToCell('orc', c, { from, to: c, path: [from, c], startedAt });
    await /** @type {any} */ (window).__RPG_APP__.transport.publish({
      type: 'token.move', payload: { tokenId: 'orc', from, to: c, path: [from, c], startedAt },
    });
  }, cell);


/**
 * R9 (retour de recette du 22/11/2026), CORRIGÉ le 23/11/2026 sur décision du MJ : une lumière
 * éclaire sur TOUTE sa portée, donc un ennemi est vu jusqu'au bord du rayon (torche de 6 cases :
 * détection à 6 cases), pour toutes les lumières. Avant : le masque lisait
 * (ligne de vue × alpha du dégradé linéaire du champ) à >= 128, soit la moitié de la portée.
 * Le PJ est en (2, 3) ; la torche porte 6. Cas : près, mi-portée (échouait), bord exact (vu),
 * juste au-delà (non vu).
 */
const CAS = [
  { nom: 'à 2 cases', cell: { a: 4, b: 3 }, vu: true },
  { nom: 'à 4 cases, dans le halo (échouait)', cell: { a: 6, b: 3 }, vu: true },
  { nom: 'au bord exact de la portée (6 cases)', cell: { a: 8, b: 3 }, vu: true },
  { nom: 'juste au-delà de la portée (7 cases)', cell: { a: 9, b: 3 }, vu: false },
];

/** @param {import('@playwright/test').Page} player @param {boolean} vu */
async function verifierCote(player, vu) {
  if (vu) {
    await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).toContain('orc');
  } else {
    await new Promise((r) => setTimeout(r, 1500)); // laisse le masque se republier
    expect(await dessinesPourLesJoueurs(player)).not.toContain('orc');
  }
}

for (const cas of CAS) {
  test(`R9 — torche posée par le panneau MJ : l'ennemi Moyen ${cas.nom} ${cas.vu ? 'est vu' : "n'est pas vu"} des joueurs`, async ({ browser }) => {
    const { context, gm, player } = await ouvrir(browser, [pj(), ennemi()], 'pj1');
    await gm.click('.gm-tab-btn[data-tab="token-maker"]');
    await gm.click('#gm-token-group-vision summary');
    await gm.check('#token-edit-torch');
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSelectedToken()?.emitsLight?.range)).toBe(6);

    // Loin de la torche (9 cases) : invisible — garde contre un test creux.
    await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).not.toBeNull();
    expect(await dessinesPourLesJoueurs(player)).not.toContain('orc');

    await deplacerEnnemi(gm, cas.cell);
    await expect.poll(() => player.evaluate(async () => (await import('../js/state/store.js')).getState().campaign?.tokens.find((t) => t.id === 'orc')?.cell?.a)).toBe(cas.cell.a);
    await verifierCote(player, cas.vu);
    await context.close();
  });

  test(`R9 — torche déjà portée à l'ouverture (liaison outil / sans liaison) : ${cas.nom} ${cas.vu ? 'vu' : 'non vu'}`, async ({ browser }) => {
    const torche = { range: 6, intensity: 1, color: '#ffcc66' };
    const { context, gm, player } = await ouvrir(browser, [pj({ emitsLight: torche }), ennemi()], 'orc');
    await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).not.toBeNull();
    expect(await dessinesPourLesJoueurs(player)).not.toContain('orc');
    await deplacerEnnemi(gm, cas.cell);
    await verifierCote(player, cas.vu);
    await context.close();
  });
}
