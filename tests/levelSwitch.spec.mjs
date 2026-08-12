// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Lot 3, S-02 — la bascule d'étage traverse le réseau.
 *
 * Elle ne le faisait pas : `level.add` et `level.grid` existaient depuis le lot 1a, mais changer
 * l'étage actif restait **purement local**. La tablette n'apprenait l'étage qu'au démarrage, par
 * l'instantané. Le MJ montait à l'étage, la table restait au rez-de-chaussée, et rien ne le
 * signalait.
 *
 * ⚠ Le second constat est le plus important, et c'est celui que le brief annonçait comme risqué :
 * arriver sur un étage **sans masque de vision** serait le défaut du 6 août au matin revenu par une
 * autre porte — la tablette afficherait « exploré mais non visible » partout sur le nouvel étage.
 */

/** @param {string} id @param {string} nom */
const niveau = (id, nom) => ({
  id,
  name: nom,
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: 12,
  heightCells: 10,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { color: '#ffffff', level: 1, baked: false },
});

/** @param {string} id @param {string} levelId @param {number} a @param {number} b */
const pion = (id, levelId, a, b) => ({
  id,
  levelId,
  cell: { a, b },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: id,
  hidden: false,
  visionBright: 6,
  visionDim: 8,
  emitsLight: null,
  speedCells: 30,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
  hp: null,
  health: 'unharmed',
});

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-etages',
    name: 'Deux étages',
    levels: [niveau('rdc', 'Rez-de-chaussée'), niveau('etage', 'Premier étage')],
    links: [],
    tokens: [pion('pj-rdc', 'rdc', 2, 2), pion('pj-etage', 'etage', 5, 5)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>}
 */
const etageActif = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getActiveLevelId();
  });

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @returns {Promise<boolean>}
 */
const aLaVision = (page, levelId) =>
  page.evaluate(async (id) => {
    const store = await import('../js/state/store.js');
    return typeof store.getSessionVision(id) === 'string';
  }, levelId);

test('S-02 : le MJ change d\'étage, la tablette suit et reçoit la vision du nouvel étage', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `etages-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  const joueur = await context.newPage();
  joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  const mj = await context.newPage();
  mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto('/gm.html');
  await waitForApp(mj);

  // Référence : les deux postes sont au rez-de-chaussée, et la tablette en a la vision.
  expect(await etageActif(joueur)).toBe('rdc');
  await expect.poll(() => aLaVision(joueur, 'rdc'), { timeout: 8000 }).toBe(true);

  // La barre d'étage n'apparaît que s'il y a plusieurs étages — c'est le cas ici.
  await expect(mj.locator('#gm-level-bar')).toBeVisible();

  // Le MJ monte à l'étage, par le vrai geste : la liste déroulante.
  await mj.selectOption('#gm-level-select', 'etage');

  // 1. La tablette suit.
  await expect.poll(() => etageActif(joueur), { timeout: 8000 }).toBe('etage');

  // 2. ⚠ Et elle reçoit la vision du NOUVEL étage. Sans cela, elle afficherait le voile
  //    « exploré mais non visible » partout, là où le PJ de l'étage voit.
  await expect.poll(() => aLaVision(joueur, 'etage'), { timeout: 8000 }).toBe(true);

  // 3. Le masque du rez-de-chaussée n'est pas écrasé par celui de l'étage : chaque étage garde le
  //    sien, ce que le critère 3 exige et que S-01 vérifie côté store.
  expect(await aLaVision(joueur, 'rdc')).toBe(true);

  expect(erreurs).toEqual([]);
  await context.close();
});

/**
 * Lot 3, S-03 et S-04 — franchir une liaison, et le cadenas.
 *
 * Le typedef `Link` existait depuis le lot 1a et `createCampaign` initialisait `links` à `[]` :
 * le modèle était conçu, **jamais câblé**. Rien ne le lisait, rien ne le fabriquait.
 *
 * ⚠ Le geste est en **deux temps** — se poster sur l'escalier, puis retaper sa case. Un
 * franchissement en un seul tap ferait changer d'étage chaque fois qu'on vise l'escalier pour s'y
 * poster, et la table verrait l'autre étage sans l'avoir demandé.
 */

/** Une campagne à deux étages avec un escalier, et un PJ posté dessus. */
const SNAPSHOT_LIAISON = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-liaison',
    name: 'Escalier',
    levels: [niveau('rdc', 'Rez-de-chaussée'), niveau('etage', 'Premier étage')],
    links: [
      {
        id: 'escalier-1',
        kind: 'stairs',
        label: 'Escalier principal',
        a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
        b: { levelId: 'etage', at: { cellX: 7, cellY: 6 } },
        bidirectional: true,
        gmOnly: false,
      },
    ],
    // Le PJ est déjà sur la case de l'escalier : le test porte sur le franchissement, pas sur
    // le déplacement qui y mène, déjà couvert ailleurs.
    tokens: [pion('pj-1', 'rdc', 3, 3)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Fait taper le joueur sur la case d'un pion, comme un vrai geste.
 * @param {import('@playwright/test').Page} page
 * @param {number} a
 * @param {number} b
 * @param {number} pxPerCell
 */
const taper = (page, a, b, pxPerCell) =>
  page.evaluate(
    ([ca, cb, px]) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'tap',
        mapPos: { x: (ca + 0.5) * px, y: (cb + 0.5) * px },
        screenPos: { x: 0, y: 0 },
      });
    },
    [a, b, pxPerCell]
  );

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 */
const etageDuPion = (page, tokenId) =>
  page.evaluate(async (id) => {
    const store = await import('../js/state/store.js');
    const t = store.getCampaign()?.tokens.find((/** @type {any} */ x) => x.id === id);
    return t ? `${t.levelId}:${t.cell.a},${t.cell.b}` : null;
  }, tokenId);

for (const cadenas of [false, true]) {
  test(`S-03/S-04 : franchir l'escalier téléporte le pion${cadenas ? ', et le cadenas suspend la bascule' : ' et bascule la vue'}`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const sessionId = `liaison-${cadenas ? 'verrouille' : 'libre'}-${Date.now()}`;
    /** @type {string[]} */
    const erreurs = [];

    const joueur = await context.newPage();
    joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
    await installBrowserTransport(joueur, sessionId, SNAPSHOT_LIAISON);
    await joueur.goto('/player.html');
    await waitForApp(joueur);

    const mj = await context.newPage();
    mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
    await installBrowserTransport(mj, sessionId, SNAPSHOT_LIAISON);
    await mj.goto('/gm.html');
    await waitForApp(mj);

    if (cadenas) {
      await mj.click('#gm-level-lock');
      await expect(mj.locator('#gm-level-lock')).toHaveAttribute('aria-pressed', 'true');
    }

    // Le joueur sélectionne son pion, puis retape sa case pour prendre l'escalier.
    await taper(joueur, 3, 3, 100);
    await taper(joueur, 3, 3, 100);

    // 1. Le pion a changé d'étage ET de case, sur les deux postes.
    await expect.poll(() => etageDuPion(joueur, 'pj-1'), { timeout: 8000 }).toBe('etage:7,6');
    await expect.poll(() => etageDuPion(mj, 'pj-1'), { timeout: 8000 }).toBe('etage:7,6');

    // 2. La vue suit — ou pas, selon le cadenas. C'est toute la différence entre les deux cas,
    //    et le franchissement lui-même est identique : le cadenas ne retient pas les pions.
    if (cadenas) {
      await joueur.waitForTimeout(1200);
      expect(await etageActif(mj)).toBe('rdc');
      expect(await etageActif(joueur)).toBe('rdc');
    } else {
      await expect.poll(() => etageActif(mj), { timeout: 8000 }).toBe('etage');
      await expect.poll(() => etageActif(joueur), { timeout: 8000 }).toBe('etage');
    }

    expect(erreurs).toEqual([]);
    await context.close();
  });
}
