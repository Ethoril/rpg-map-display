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
 * ⚠ R9 REPRODUIT, correctif EN ATTENTE d'une décision du MJ (voir docs/ETAT.md, « Suite produit »).
 * Le masque publié = (ligne de vue × alpha du champ lumineux) lu à `>= 128` : le champ est un
 * dégradé LINÉAIRE (centre = intensité, bord de portée = 0), donc seule la MOITIÉ de la portée
 * compte comme « éclairée » pour la détection (3 cases pour une torche de 6), alors que le halo
 * dessiné reste en couleur pleine jusqu'à 75 % (`LIGHT_COLOR_VISION_GAIN`, constants.js). Un ennemi
 * à 4 cases d'une torche de 6, dans le halo visible du MJ, n'est pas dessiné aux joueurs.
 * Le témoin (2 cases) passe ; le cas R9 (4 cases) est en `fixme` : le seuil d'« éclairé » n'est
 * fixé par aucun document normatif, le choisir est une décision de règle du jeu.
 */
const CAS = [
  { nom: 'à 2 cases (témoin, passe)', cell: { a: 4, b: 3 }, attendu: test },
  { nom: 'à 4 cases, dans le halo (R9)', cell: { a: 6, b: 3 }, attendu: test.fixme },
];

for (const cas of CAS) {
cas.attendu(`R9 — torche posée par le panneau MJ : l'ennemi Moyen ${cas.nom} est visible des joueurs`, async ({ browser }) => {
  const { context, gm, player } = await ouvrir(browser, [pj(), ennemi()], 'pj1');
  await gm.click('.gm-tab-btn[data-tab="token-maker"]');
  await gm.click('#gm-token-group-vision summary');
  await gm.check('#token-edit-torch');
  await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSelectedToken()?.emitsLight?.range)).toBe(6);

  // Hors de la zone éclairée (9 cases du PJ, torche de 6) : invisible — garde contre un test creux.
  await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).not.toBeNull();
  expect(await dessinesPourLesJoueurs(player)).not.toContain('orc');

  // Il finit son mouvement dans la zone éclairée, en ligne de vue, sans obstacle (le PJ est en (2, 3)).
  await deplacerEnnemi(gm, cas.cell);
  await expect.poll(() => player.evaluate(async () => (await import('../js/state/store.js')).getState().campaign?.tokens.find((t) => t.id === 'orc')?.cell?.a)).toBe(cas.cell.a);
  await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).toContain('orc');
  await context.close();
});

cas.attendu(`R9 — torche déjà portée à l'ouverture (liaison outil / sans liaison) : même résultat, ${cas.nom}`, async ({ browser }) => {
  const torche = { range: 6, intensity: 1, color: '#ffcc66' };
  const { context, gm, player } = await ouvrir(browser, [pj({ emitsLight: torche }), ennemi()], 'orc');
  await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).not.toBeNull();
  expect(await dessinesPourLesJoueurs(player)).not.toContain('orc');
  await deplacerEnnemi(gm, cas.cell);
  await expect.poll(() => dessinesPourLesJoueurs(player), { timeout: 8000 }).toContain('orc');
  await context.close();
});
}
