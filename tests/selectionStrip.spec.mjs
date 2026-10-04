// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Chantier C-9, tranche 2 — la bande de sélection de la tablette, sur la vraie vue joueurs.
 *
 * Cinquième dérogation de `CONVENTIONS.md` §8 n°2 : une bande verticale au bord droit, qui
 * n'existe que tant qu'un pion manipulable est sélectionné. En haut le bouton monter / descendre,
 * dessous les badges d'état ; un appui sur un badge affiche son nom quelques secondes.
 *
 * ⚠ Chaque assertion regarde un EFFET — ce qui a transité sur le canal, l'état du store, la taille
 * de la zone, le rectangle de la bulle — et jamais un drapeau interne de la bande.
 */

const PX = 100;

const ETAGE = {
  id: 'rdc',
  name: 'Rez-de-chaussée',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: PX,
  widthCells: 12,
  heightCells: 10,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

/**
 * @param {string} id
 * @param {'pc'|'npc'} kind
 * @param {{a: number, b: number}} cell
 * @param {string[]} [markers]
 */
const pion = (id, kind, cell, markers = []) => ({
  id,
  levelId: 'rdc',
  cell,
  sizeCells: 1,
  kind,
  imageUrl: '',
  borderColor: '#00ff00',
  label: id,
  hidden: false,
  visionDim: 8,
  emitsLight: null,
  // Budget de 3 à pied, 6 monté : sur un étage ouvert, la zone grandit nettement.
  speedCells: 3,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers,
  hp: null,
  health: 'unharmed',
  mounted: false,
});

/** @param {string[]} [markers] */
const instantane = (markers = []) => ({
  campaign: {
    schemaVersion: 2,
    campaignId: 'c9-bande',
    name: 'Bande',
    levels: [ETAGE],
    links: [],
    tokens: [pion('pj', 'pc', { a: 4, b: 4 }, markers), pion('pnj', 'npc', { a: 8, b: 4 })],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
});

/**
 * Tap joueur au centre d'une case, par le vrai `PointerInput` de la vue.
 * @param {import('@playwright/test').Page} page
 * @param {number} a
 * @param {number} b
 */
const taper = (page, a, b) =>
  page.evaluate(
    ([ca, cb, px]) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'tap',
        mapPos: { x: (ca + 0.5) * px, y: (cb + 0.5) * px },
        screenPos: { x: 0, y: 0 },
      });
    },
    [a, b, PX]
  );

/** @param {import('@playwright/test').Page} page */
const selection = (page) =>
  page.evaluate(async () => (await import('../js/state/store.js')).getState().selectedTokenId);

/** @param {import('@playwright/test').Page} page */
const tailleZone = (page) =>
  page.evaluate(async () => (await import('../js/state/store.js')).getState().reachableCells.size);

/** @param {import('@playwright/test').Page} page */
const monture = (page) =>
  page.evaluate(
    async () =>
      (await import('../js/state/store.js')).getCampaign()?.tokens.find((t) => t.id === 'pj')
        ?.mounted
  );

/**
 * Types et charges de ce qui est RÉELLEMENT parti sur le canal.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{type: string, payload: any, by: string}[]>}
 */
const publies = (page) =>
  page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.map((/** @type {any} */ e) => ({
      type: e.type,
      payload: e.payload,
      by: e.by,
    }))
  );

/**
 * La barre du cheval barré est-elle réellement peinte ? Lit le pseudo-élément calculé, pas la
 * classe : une classe sans règle CSS ne barre rien.
 * @param {import('@playwright/test').Locator} bouton
 */
const barre = (bouton) =>
  bouton.evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    return s.content !== 'none' && s.content !== 'normal' && s.backgroundColor === 'rgb(255, 255, 255)';
  });

const BANDE = '#player-selection-strip';

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} nom
 * @param {string[]} [markers]
 */
async function ouvrir(page, nom, markers = []) {
  await installBrowserTransport(page, `c9-bande-${nom}-${Date.now()}`, instantane(markers));
  await page.goto('/player.html');
  await waitForApp(page);
}

test('C-9 bande : masquée sans sélection, visible sur un PJ sélectionné, masquée à la désélection', async ({
  page,
}) => {
  await ouvrir(page, 'visibilite');
  await expect(page.locator(BANDE)).toBeHidden();

  await taper(page, 4, 4);
  await expect.poll(() => selection(page)).toBe('pj');
  await expect(page.locator(BANDE)).toBeVisible();

  // Tap hors de la zone atteignable : la vue joueurs désélectionne, la bande s'en va avec.
  await taper(page, 11, 9);
  await expect.poll(() => selection(page)).toBe(null);
  await expect(page.locator(BANDE)).toBeHidden();
});

test('C-9 bande : le bouton cheval publie token.mounted (by players), monte le pion, agrandit la zone et se barre', async ({
  page,
}) => {
  await ouvrir(page, 'bascule');
  await taper(page, 4, 4);
  await expect(page.locator(BANDE)).toBeVisible();

  const bouton = page.locator(`${BANDE} .player-selection-mount`);
  await expect(bouton).toHaveAttribute('aria-label', 'Monter à cheval');
  await expect(bouton).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(bouton.locator('img')).toHaveAttribute('src', 'assets/icons/mounted.svg');
  expect(await barre(bouton), 'à pied, le cheval n’est pas barré').toBe(false);
  // Aucun marqueur → aucun badge : le bouton cheval reste seul.
  await expect(page.locator(`${BANDE} > *`)).toHaveCount(1);

  const zoneAPied = await tailleZone(page);
  expect(zoneAPied).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Monter à cheval' }).click();

  await expect.poll(() => monture(page)).toBe(true);
  expect((await publies(page)).filter((e) => e.type === 'token.mounted')).toEqual([
    { type: 'token.mounted', payload: { tokenId: 'pj', mounted: true }, by: 'players' },
  ]);
  // La zone recalculée : budget doublé, donc strictement plus de cases.
  await expect.poll(() => tailleZone(page)).toBeGreaterThan(zoneAPied);
  await expect(bouton).toHaveAttribute('aria-label', 'Descendre de cheval');
  await expect(bouton).toHaveClass(/\bis-mounted\b/);
  expect(await barre(bouton), 'monté, le cheval est barré').toBe(true);

  await page.getByRole('button', { name: 'Descendre de cheval' }).click();
  await expect.poll(() => monture(page)).toBe(false);
  expect((await publies(page)).filter((e) => e.type === 'token.mounted')).toEqual([
    { type: 'token.mounted', payload: { tokenId: 'pj', mounted: true }, by: 'players' },
    { type: 'token.mounted', payload: { tokenId: 'pj', mounted: false }, by: 'players' },
  ]);
  await expect.poll(() => tailleZone(page)).toBe(zoneAPied);
  await expect(bouton).toHaveAttribute('aria-label', 'Monter à cheval');
  expect(await barre(bouton)).toBe(false);
});

test('C-9 bande : un appui dans la bande ne désélectionne pas, ne déplace rien et ne publie aucun token.move', async ({
  page,
}) => {
  await ouvrir(page, 'isolement', ['prone']);
  await taper(page, 4, 4);
  await expect(page.locator(BANDE)).toBeVisible();

  const camera = () =>
    page.evaluate(() => {
      const c = /** @type {any} */ (window).__RPG_APP__.camera;
      return { x: c.x, y: c.y, zoom: c.zoom };
    });
  const cameraAvant = await camera();

  // Souris réelle aux coordonnées du viewport : si l'appui traversait la bande jusqu'au canvas, il
  // tomberait hors de la carte (bord droit) et désélectionnerait.
  for (const cible of ['.player-selection-badge', '.player-selection-mount']) {
    const boite = await page.locator(`${BANDE} ${cible}`).boundingBox();
    if (!boite) throw new Error(`${cible} sans boîte`);
    await page.mouse.click(boite.x + boite.width / 2, boite.y + boite.height / 2);
  }

  await expect.poll(() => monture(page)).toBe(true);
  expect(await selection(page), 'la sélection survit aux appuis dans la bande').toBe('pj');
  expect((await publies(page)).map((e) => e.type)).not.toContain('token.move');
  expect(await camera(), 'la carte n’a pas défilé').toEqual(cameraAvant);
  expect(
    await page.evaluate(async () =>
      (await import('../js/state/store.js')).getCampaign()?.tokens.find((t) => t.id === 'pj')?.cell
    )
  ).toEqual({ a: 4, b: 4 });
});

test('C-9 bande : badges dans l’ordre canonique, bulle du nom à gauche pendant labelDurationMs, relancée par un autre badge', async ({
  page,
}) => {
  await page.clock.install();
  // Ordre du tableau volontairement INVERSE de l'ordre canonique (`prone` avant `poisoned`).
  await ouvrir(page, 'badges', ['poisoned', 'prone']);
  await taper(page, 4, 4);
  await expect(page.locator(BANDE)).toBeVisible();

  const badges = page.locator(`${BANDE} .player-selection-badge`);
  await expect(badges).toHaveCount(2);
  expect(
    await badges.evaluateAll((els) =>
      els.map((el) => ({
        label: el.getAttribute('aria-label'),
        src: el.querySelector('img')?.getAttribute('src'),
      }))
    )
  ).toEqual([
    { label: 'À terre', src: 'assets/icons/status/prone.svg' },
    { label: 'Empoisonné', src: 'assets/icons/status/poisoned.svg' },
  ]);
  // Le bouton cheval est en haut, avant les badges.
  expect(
    await page.locator(`${BANDE} > *`).evaluateAll((els) => els.map((el) => el.className))
  ).toEqual(['player-selection-mount', 'player-selection-badge', 'player-selection-badge']);

  // Le temps est figé à partir d'ici : seuls `runFor` le font avancer.
  await page.clock.pauseAt(Date.now() + 1000);

  const bulle = page.locator('.player-selection-label');
  await expect(bulle).toBeHidden();

  const empoisonne = page.getByRole('button', { name: 'Empoisonné' });
  await empoisonne.click();
  await expect(bulle).toBeVisible();
  await expect(bulle).toHaveText('Empoisonné');

  // Hors de la bande défilante, à gauche du badge, centrée sur lui verticalement.
  const geometrie = await page.evaluate(() => {
    const b = /** @type {HTMLElement} */ (document.querySelector('.player-selection-label'));
    const badge = /** @type {HTMLElement} */ (
      document.querySelector('.player-selection-badge[data-marker="poisoned"]')
    );
    const rb = b.getBoundingClientRect();
    const rg = badge.getBoundingClientRect();
    return {
      dansLaBande: Boolean(b.closest('#player-selection-strip')),
      ecart: rg.left - rb.right,
      decalageVertical: Math.abs(rb.top + rb.height / 2 - (rg.top + rg.height / 2)),
      largeur: rb.width,
    };
  });
  expect(geometrie.dansLaBande, 'une bande défilante couperait la bulle').toBe(false);
  expect(geometrie.ecart).toBeGreaterThanOrEqual(0);
  expect(geometrie.ecart).toBeLessThan(20);
  expect(geometrie.decalageVertical).toBeLessThan(2);
  expect(geometrie.largeur).toBeGreaterThan(0);

  await page.clock.runFor(2400);
  await expect(bulle).toHaveText('Empoisonné');
  await page.clock.runFor(200);
  await expect(bulle).toBeHidden();

  // Un autre badge remplace la bulle ET relance la minuterie.
  await page.getByRole('button', { name: 'À terre' }).click();
  await expect(bulle).toHaveText('À terre');
  await page.clock.runFor(2000);
  await empoisonne.click();
  await expect(bulle).toHaveText('Empoisonné');
  await page.clock.runFor(2000);
  // 4 000 ms après le premier appui : sans relance, la bulle serait déjà partie.
  await expect(bulle).toBeVisible();
  await page.clock.runFor(600);
  await expect(bulle).toBeHidden();

  // La bulle disparaît avec la bande.
  await empoisonne.click();
  await expect(bulle).toBeVisible();
  await taper(page, 11, 9);
  await expect(page.locator(BANDE)).toBeHidden();
  await expect(bulle).toBeHidden();

  // Les marqueurs retirés par le MJ : plus aucun badge, le cheval reste seul.
  await taper(page, 4, 4);
  await expect(badges).toHaveCount(2);
  await page.evaluate(async () =>
    (await import('../js/state/store.js')).updateToken('pj', { markers: [] })
  );
  await expect(badges).toHaveCount(0);
  await expect(page.locator(`${BANDE} .player-selection-mount`)).toBeVisible();
});

test('C-9 bande : un token.mounted reçu du MJ pendant la sélection barre le bouton', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `c9-bande-recu-${Date.now()}`;

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, instantane());
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, instantane());
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  await taper(joueur, 4, 4);
  const bouton = joueur.locator(`${BANDE} .player-selection-mount`);
  await expect(bouton).toHaveAttribute('aria-label', 'Monter à cheval');

  // Le vrai bouton du MJ, par le vrai canal.
  await mj.evaluate(async () => (await import('../js/state/store.js')).setSelection('pj'));
  await mj.locator('#gm-vitals-mounted').click();

  await expect.poll(() => monture(joueur)).toBe(true);
  await expect(bouton).toHaveAttribute('aria-label', 'Descendre de cheval');
  expect(await barre(bouton)).toBe(true);
  // Reçu, pas émis : la tablette ne republie rien.
  expect((await publies(joueur)).map((e) => e.type)).not.toContain('token.mounted');

  await context.close();
});

test('C-9 bande : jamais ouverte pour un PNJ, même sélectionné par un autre chemin que le tap', async ({
  page,
}) => {
  await ouvrir(page, 'pnj');

  await taper(page, 8, 4);
  await page.waitForTimeout(200);
  expect(await selection(page)).toBe(null);
  await expect(page.locator(BANDE)).toBeHidden();

  // Une sélection héritée (instantané ou autre mutation du store) est aussitôt purgée côté
  // joueurs : le garde-fou de manipulation ne laisse pas un PNJ devenir sélection active.
  await page.evaluate(async () => (await import('../js/state/store.js')).setSelection('pnj'));
  expect(await selection(page)).toBe(null);
  await expect(page.locator(BANDE)).toBeHidden();
  await expect(page.locator(`${BANDE} .player-selection-mount`)).toHaveCount(0);
});
