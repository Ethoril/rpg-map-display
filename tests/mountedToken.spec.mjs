// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Chantier C-9 — le pion monté, dans les vraies vues.
 *
 * Ce que l'unitaire ne peut pas prouver : que le chemin ANIMÉ de la tablette lit les mêmes règles
 * que la zone (sinon le cheval traverse une porte ouverte pendant l'animation et révèle le
 * brouillard derrière), que la tablette refuse la liaison, que le bouton du MJ publie l'état
 * absolu, et que la tête de cheval atteint vraiment le canvas.
 */

const PX = 100;

/**
 * Étage coupé par un mur vertical en x = 5, percé d'une porte OUVERTE entre (4,4) et (5,4), et
 * contournable par le bas (rangées 8 et 9). Par la porte, (6,4) est à 2 ; par le bas, à 9,5 :
 * hors du budget à pied (6), dans le budget monté (12).
 */
const ETAGE = {
  id: 'rdc',
  name: 'Rez-de-chaussée',
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: PX,
  widthCells: 12,
  heightCells: 10,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [
    [{ cellX: 5, cellY: 0 }, { cellX: 5, cellY: 4 }],
    [{ cellX: 5, cellY: 5 }, { cellX: 5, cellY: 8 }],
  ],
  portals: [
    { id: 'porte', a: { cellX: 5, cellY: 4 }, b: { cellX: 5, cellY: 5 }, state: 'open', freestanding: false },
  ],
  lights: [],
  ambient: { level: 1, baked: false },
};

/** @param {boolean} mounted */
const pj = (mounted) => ({
  id: 'pj',
  levelId: 'rdc',
  cell: { a: 4, b: 4 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Cavalier',
  hidden: false,
  visionDim: 8,
  emitsLight: null,
  speedCells: 6,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
  hp: null,
  health: 'unharmed',
  mounted,
});

/** @param {boolean} mounted @param {string|null} selectedTokenId */
const instantane = (mounted, selectedTokenId = null) => ({
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-c9',
    name: 'Cavalier',
    levels: [ETAGE],
    links: [],
    tokens: [pj(mounted)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId,
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
const publies = (page) =>
  page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published);

/**
 * Le chemin franchit-il la porte ? Une marche franchit la ligne x = 5 au-dessus de la rangée 8
 * seulement par la porte : le mur couvre le reste.
 * @param {{a: number, b: number}[]} path
 */
const passeParLaPorte = (path) =>
  path.some((c, i) => {
    const n = path[i + 1];
    if (!n) return false;
    const traverse = (c.a <= 4 && n.a >= 5) || (c.a >= 5 && n.a <= 4);
    return traverse && Math.max(c.b, n.b) < 8;
  });

test('C-9 tablette : le chemin animé d’un pion monté contourne la porte ouverte, celui d’un pion à pied la prend', async ({
  browser,
}) => {
  for (const mounted of [true, false]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    /** @type {string[]} */
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    await installBrowserTransport(page, `c9-chemin-${mounted}-${Date.now()}`, instantane(mounted));
    await page.goto('/player.html');
    await waitForApp(page);

    await taper(page, 4, 4);
    await expect
      .poll(() => page.evaluate(async () => (await import('../js/state/store.js')).getState().selectedTokenId))
      .toBe('pj');
    await taper(page, 6, 4);

    await expect.poll(async () => (await publies(page)).some((/** @type {any} */ e) => e.type === 'token.move')).toBe(true);
    const move = (await publies(page)).find((/** @type {any} */ e) => e.type === 'token.move');
    /** @type {{a: number, b: number}[]} */
    const path = move.payload.path;
    expect(path[0]).toEqual({ a: 4, b: 4 });
    expect(path[path.length - 1]).toEqual({ a: 6, b: 4 });
    if (mounted) {
      expect(passeParLaPorte(path), `chemin publié : ${JSON.stringify(path)}`).toBe(false);
      expect(Math.max(...path.map((c) => c.b)), 'le détour passe par le bas').toBeGreaterThanOrEqual(8);
    } else {
      // Témoin : à pied, le plus court passe par la porte. Sans lui, un chemin qui contournerait
      // toujours ne prouverait rien sur la règle du cheval.
      expect(passeParLaPorte(path), `chemin publié : ${JSON.stringify(path)}`).toBe(true);
    }
    expect(erreurs).toEqual([]);
    await context.close();
  }
});

/**
 * Monte la vraie `bootstrapPlayerView` sur le vrai store, avec un transport qui journalise : seul
 * moyen d'observer le retour `'refused'` que la vue joueurs dessine sur la carte.
 * @param {import('@playwright/test').Page} page
 */
async function sondeJoueur(page) {
  await page.goto('/gm.html');
  await waitForApp(page);
  await page.addScriptTag({
    type: 'module',
    content: `
      import * as store from './js/state/store.js';
      import { bootstrapPlayerView } from './js/ui/player/bootstrap.js';
      import { createCampaign, createLevel, createToken } from './js/core/schema.js';
      import { Camera } from './js/render/camera.js';

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);
      const camera = new Camera(canvas.width, canvas.height);
      const publies = [];
      const refus = [];
      store.loadCampaign(createCampaign({
        levels: [createLevel({ id: 'rdc', widthCells: 10, heightCells: 8 }), createLevel({ id: 'etage', widthCells: 10, heightCells: 8 })],
        links: [{
          id: 'escalier', kind: 'stairs', label: 'Escalier',
          a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
          b: { levelId: 'etage', at: { cellX: 7, cellY: 6 } },
          bidirectional: true, gmOnly: false,
        }],
        tokens: [createToken({ id: 'pj', levelId: 'rdc', cell: { a: 3, b: 3 }, kind: 'pc', mounted: true })],
      }));
      const vue = bootstrapPlayerView({
        element: canvas,
        camera,
        transport: { publish: (e) => publies.push(e) },
        onDestinationRejected: (cell, kind) => refus.push({ cell: { a: cell.a, b: cell.b }, kind }),
      });
      window.__c9 = {
        store, publies, refus,
        taper: (a, b) => vue.pointerInput.onIntention({
          type: 'tap', screenPos: { screenX: 0, screenY: 0 }, mapPos: { x: (a + 0.5) * 140, y: (b + 0.5) * 140 },
        }),
        pion: () => { const t = store.getCampaign().tokens.find((x) => x.id === 'pj'); return t.levelId + ':' + t.cell.a + ',' + t.cell.b; },
      };
    `,
  });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__c9));
}

test('C-9 tablette : monté sur un escalier, retaper sa case est refusé et ne publie aucun link.traverse ; à pied, il franchit', async ({
  page,
}) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await sondeJoueur(page);

  const etat = () =>
    page.evaluate(() => {
      const c9 = /** @type {any} */ (window).__c9;
      return {
        pion: c9.pion(),
        types: c9.publies.map((/** @type {any} */ e) => e.type),
        refus: c9.refus,
        selection: c9.store.getState().selectedTokenId,
      };
    });

  await page.evaluate(() => /** @type {any} */ (window).__c9.taper(3, 3));
  expect((await etat()).selection).toBe('pj');
  await page.evaluate(() => /** @type {any} */ (window).__c9.taper(3, 3));

  const monte = await etat();
  expect(monte.pion, 'monté, le pion reste sur l’escalier').toBe('rdc:3,3');
  expect(monte.types).not.toContain('link.traverse');
  expect(monte.refus).toEqual([{ cell: { a: 3, b: 3 }, kind: 'refused' }]);

  // Témoin : descendu de cheval, le même geste franchit.
  await page.evaluate(() => /** @type {any} */ (window).__c9.store.setTokenMounted('pj', false));
  await page.evaluate(() => /** @type {any} */ (window).__c9.taper(3, 3));
  const aPied = await etat();
  expect(aPied.pion).toBe('etage:7,6');
  expect(aPied.types).toContain('link.traverse');
  expect(aPied.refus.length, 'aucun nouveau refus à pied').toBe(1);
  expect(erreurs).toEqual([]);
});

test('C-9 MJ : « À cheval » bascule aria-pressed et publie token.mounted, état absolu, by gm', async ({ page }) => {
  await installBrowserTransport(page, `c9-mj-${Date.now()}`, instantane(false, 'pj'));
  await page.goto('/gm.html');
  await waitForApp(page);
  await page.evaluate(async () => (await import('../js/state/store.js')).setSelection('pj'));

  const bouton = page.locator('#gm-vitals-mounted');
  await expect(bouton).toBeVisible();
  await expect(bouton).toHaveText('À cheval');
  await expect(bouton).toHaveAttribute('aria-pressed', 'false');

  const mountedPublies = async () =>
    (await publies(page))
      .filter((/** @type {any} */ e) => e.type === 'token.mounted')
      .map((/** @type {any} */ e) => ({ payload: e.payload, by: e.by }));
  /** @returns {Promise<unknown>} */
  const monture = () =>
    page.evaluate(async () =>
      (await import('../js/state/store.js')).getCampaign()?.tokens.find((t) => t.id === 'pj')?.mounted
    );

  await bouton.click();
  await expect(bouton).toHaveAttribute('aria-pressed', 'true');
  expect(await monture()).toBe(true);
  expect(await mountedPublies()).toEqual([{ payload: { tokenId: 'pj', mounted: true }, by: 'gm' }]);

  await bouton.click();
  await expect(bouton).toHaveAttribute('aria-pressed', 'false');
  expect(await monture()).toBe(false);
  expect(await mountedPublies()).toEqual([
    { payload: { tokenId: 'pj', mounted: true }, by: 'gm' },
    { payload: { tokenId: 'pj', mounted: false }, by: 'gm' },
  ]);
});

test('C-9 rendu : la tête de cheval d’un pion monté sans marqueur atteint le canvas, en bas à droite', async ({ page }) => {
  await installBrowserTransport(page, `c9-rendu-${Date.now()}`, instantane(false));
  await page.goto('/gm.html');
  await waitForApp(page);

  // Pixels du disque du cheval : combien de clairs (l'icône blanche) et de sombres (le disque).
  const mesurer = () =>
    page.evaluate(async () => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      const store = await import('../js/state/store.js');
      const { computeMountedBadgeRowLayout } = await import('../js/render/statusBadges.js');
      const token = store.getCampaign()?.tokens.find((t) => t.id === 'pj');
      const level = store.getActiveLevel();
      if (!token || !level) return null;
      const px = level.pxPerCell;
      const layout = computeMountedBadgeRowLayout(token.sizeCells * px, 0);
      const centre = app.camera.mapToScreen({ x: token.cell.a * px + layout.horse.x, y: token.cell.b * px + layout.horse.y });
      const bord = app.camera.mapToScreen({ x: token.cell.a * px + layout.horse.x + layout.badgeRadiusMap * 0.75, y: 0 });
      const resolution = app.stage?.resolution ?? 1;
      const cx = Math.round(centre.screenX * resolution);
      const cy = Math.round(centre.screenY * resolution);
      const r = Math.max(2, Math.floor((bord.screenX - centre.screenX) * resolution));
      const data = app.context.getImageData(cx - r, cy - r, 2 * r, 2 * r).data;
      let clairs = 0;
      let sombres = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) clairs++;
        else if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) sombres++;
      }
      return { clairs, sombres, total: data.length / 4 };
    });

  const aPied = await mesurer();
  expect(aPied).not.toBeNull();

  await page.evaluate(async () => (await import('../js/state/store.js')).setTokenMounted('pj', true));
  await expect
    .poll(async () => {
      const m = await mesurer();
      // Sombres à 5 % et non plus 10 % : la bande sombre de la châsse, qui entourait le disque et
      // gonflait ce compte, a été retirée le 01/10/2026 (C-14). Mesuré sans elle : 83 clairs et
      // 13 sombres sur 144. Le témoin « à pied » ci-dessous garde la sonde honnête.
      return m ? m.clairs > m.total * 0.1 && m.sombres > m.total * 0.05 : false;
    }, { timeout: 8000 })
    .toBe(true);

  // Témoin : à pied, le même emplacement ne porte pas ce badge — sans quoi la sonde ne prouverait rien.
  const a = /** @type {{ clairs: number, sombres: number, total: number }} */ (aPied);
  expect(a.clairs > a.total * 0.1 && a.sombres > a.total * 0.05, JSON.stringify(a)).toBe(false);
});
