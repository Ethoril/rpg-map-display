// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Point d'impact d'un sort de zone (contrat de liaison §10.1, version 3, révision du 23/11/2026).
 *
 * L'outil MJ est simulé par le vrai canal `wfrp-map-link` ouvert dans la page MJ (comme
 * `tourDeJeu.spec.mjs`) : `mj.impactQuery` → bandeau et aperçu du cercle sur l'écran MJ → clic sur
 * une case → un seul `map.impact { queryId, levelId, cell, refs }` → gabarit cercle posé, visible
 * des joueurs. Échap, demande remplacée et `mj.impactCancel`. La tablette ne voit rien du mode.
 */

const PX = 100;
const BANDEAU = '#gm-active-tool-banner';

/**
 * @param {string} id @param {string} ref @param {{ a: number, b: number }} cell
 * @param {Record<string, any>} [overrides]
 */
function pionLie(id, ref, cell, overrides = {}) {
  return {
    id, levelId: 'rdc', cell, sizeCells: 1, kind: ref.startsWith('pj:') ? 'pc' : 'npc', imageUrl: '',
    borderColor: '#22c55e', label: id, hidden: false, visionBright: 3, visionDim: 6, emitsLight: null,
    speedCells: 4, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed',
    link: { source: 'outil-mj', ref }, camp: ref.startsWith('pj:') ? 'pj' : 'ennemi',
    ...overrides,
  };
}

/** Pion ordinaire (non lié) : jamais dans `refs`. @param {Record<string, any>} pion */
function nonLie({ link: _link, camp: _camp, ...pion }) {
  return pion;
}

function instantane() {
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: 'point-impact',
      name: 'Point d’impact',
      levels: [{
        id: 'rdc', name: 'Salle', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
        pxPerCell: PX, widthCells: 12, heightCells: 10,
        grid: { type: /** @type {const} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
        terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false },
      }],
      links: [],
      tokens: [
        pionLie('lanceur', 'pj:lanceur', { a: 2, b: 4 }),
        pionLie('gobelin', 'p:gobelin', { a: 5, b: 4 }),
        pionLie('ogre', 'p:ogre', { a: 9, b: 4 }),
        nonLie(pionLie('libre', 'p:x', { a: 4, b: 5 })),
      ],
      reserve: [],
      templates: [],
      settings: {},
    },
    activeLevelId: 'rdc',
    selectedTokenId: null,
    activeHandout: null,
  };
}

/**
 * Ouvre l'écoute de la carte sur le canal (les `map.impact` émis) et rend l'émetteur outil MJ.
 * @param {import('@playwright/test').Page} gm
 */
async function simulerOutil(gm) {
  await gm.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__impacts = [];
    w.__outil = new BroadcastChannel('wfrp-map-link');
    w.__outil.onmessage = (/** @type {MessageEvent} */ e) => {
      if (e.data?.from === 'map' && e.data.type === 'map.impact') w.__impacts.push(e.data);
    };
  });
}

/**
 * @param {import('@playwright/test').Page} gm @param {string} type @param {any} payload
 */
const envoyer = (gm, type, payload) => gm.evaluate(([t, p]) => {
  /** @type {any} */ (window).__outil.postMessage({ v: 3, type: t, seq: Date.now(), at: Date.now(), from: 'outil-mj', payload: p });
}, /** @type {const} */ ([type, payload]));

/** @param {import('@playwright/test').Page} gm @returns {Promise<any[]>} */
const impacts = (gm) => gm.evaluate(() => /** @type {any} */ (window).__impacts.map((/** @type {any} */ m) => ({ v: m.v, ...m.payload })));

/** @param {import('@playwright/test').Page} page */
const outilActif = (page) => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.getActiveToolName());

/** @param {import('@playwright/test').Page} page */
const gabarits = (page) => page.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.templates ?? []);

/**
 * Point client du centre de la case `(a, b)`, décalé de `(dx, dy)` cases.
 * @param {import('@playwright/test').Page} page @param {number} a @param {number} b
 */
async function pointClient(page, a, b, dx = 0, dy = 0) {
  const s = await page.evaluate((mp) => /** @type {any} */ (window).__RPG_APP__.camera.mapToScreen(mp),
    { x: (a + 0.5 + dx) * PX, y: (b + 0.5 + dy) * PX });
  const box = await page.locator('#board').boundingBox();
  if (!box) throw new Error('Canvas #board introuvable');
  return { x: box.x + s.screenX, y: box.y + s.screenY, sx: s.screenX, sy: s.screenY };
}

/** @param {import('@playwright/test').Page} page @param {number} a @param {number} b */
async function cliquerCase(page, a, b) {
  const p = await pointClient(page, a, b);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Pixel du canvas MJ au centre de la case `(a, b)` décalé d'un tiers de case (hors pion).
 * @param {import('@playwright/test').Page} page @param {number} a @param {number} b
 */
async function pixel(page, a, b) {
  const p = await pointClient(page, a, b, 0.3, 0.3);
  return page.evaluate(([x, y]) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const res = app.context.canvas.width / app.context.canvas.clientWidth || 1;
    return Array.from(app.context.getImageData(Math.round(x * res), Math.round(y * res), 1, 1).data);
  }, [p.sx, p.sy]);
}

/**
 * @param {import('@playwright/test').Browser} browser
 */
async function monter(browser) {
  const sessionId = `point-impact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

test('mj.impactQuery → bandeau et aperçu MJ → clic → un seul map.impact, gabarit cercle visible des joueurs', async ({ browser }) => {
  const { context, gm, player, erreurs } = await monter(browser);
  try {
    // Un outil armé est désarmé par le mode, comme par tout changement d'outil.
    await gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.setActiveTool('ping'));
    await expect(gm.locator('#gm-ping-arm')).toHaveAttribute('aria-pressed', 'true');
    await envoyer(gm, 'mj.impactQuery', { queryId: 'q1', label: 'Boule de feu', radiusCells: 2, casterRef: 'pj:lanceur' });

    const bandeau = gm.locator(BANDEAU);
    await expect(bandeau).toBeVisible();
    await expect(bandeau).toContainText('Point d’impact : Boule de feu · rayon 2 cases');
    await expect(bandeau).toContainText('clique une case ; Échap annule');
    expect(await outilActif(gm)).toBe('impact-pick');
    await expect(gm.locator('#gm-ping-arm')).toHaveAttribute('aria-pressed', 'false');

    // Aperçu du cercle sous le pointeur, sur l'écran MJ seulement.
    const avant = await pixel(gm, 7, 7);
    const survol = await pointClient(gm, 7, 6);
    await gm.mouse.move(survol.x, survol.y);
    await expect.poll(() => pixel(gm, 7, 7)).not.toEqual(avant);
    const apres = await pixel(gm, 7, 7);
    expect(apres[0]).toBeGreaterThan(apres[1]);
    expect(await gabarits(gm)).toEqual([]);
    expect(await impacts(gm)).toEqual([]);

    // La tablette ne voit ni bandeau ni aperçu.
    await expect(player.locator(BANDEAU)).toHaveCount(0);
    expect(await gabarits(player)).toEqual([]);

    await cliquerCase(gm, 4, 4);
    await expect.poll(() => impacts(gm)).toHaveLength(1);
    await gm.waitForTimeout(300);
    const recus = await impacts(gm);
    expect(recus).toHaveLength(1);
    expect(recus[0]).toEqual({ v: 3, queryId: 'q1', levelId: 'rdc', cell: { a: 4, b: 4 }, refs: ['pj:lanceur', 'p:gobelin'] });

    await expect(bandeau).toBeHidden();
    expect(await outilActif(gm)).toBe('none');
    const poses = await gabarits(gm);
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({ levelId: 'rdc', shape: 'circle', radiusCells: 2, origin: { x: 450, y: 450 }, visibleToPlayers: true });
    await expect.poll(async () => (await gabarits(player)).map((/** @type {any} */ t) => t.id)).toEqual([poses[0].id]);

    // Un second clic ne répond plus : la demande est close.
    await cliquerCase(gm, 6, 6);
    await gm.waitForTimeout(200);
    expect(await impacts(gm)).toHaveLength(1);
    expect(erreurs).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Échap → cancelled ; seconde demande → cancelled pour la première ; mj.impactCancel → bandeau retiré, aucune réponse', async ({ browser }) => {
  const { context, gm, player, erreurs } = await monter(browser);
  try {
    const bandeau = gm.locator(BANDEAU);
    await envoyer(gm, 'mj.impactQuery', { queryId: 'q1', label: 'Tempête', radiusCells: 1, casterRef: null });
    await expect(bandeau).toContainText('Point d’impact : Tempête · rayon 1 case —');
    await gm.keyboard.press('Escape');
    await expect.poll(() => impacts(gm)).toEqual([{ v: 3, queryId: 'q1', cancelled: true }]);
    await expect(bandeau).toBeHidden();

    await envoyer(gm, 'mj.impactQuery', { queryId: 'q2', label: 'A', radiusCells: 1, casterRef: null });
    await expect(bandeau).toContainText('Point d’impact : A');
    await envoyer(gm, 'mj.impactQuery', { queryId: 'q3', label: 'B', radiusCells: 3, casterRef: null });
    await expect(bandeau).toContainText('Point d’impact : B · rayon 3 cases');
    await expect.poll(() => impacts(gm)).toHaveLength(2);
    expect((await impacts(gm))[1]).toEqual({ v: 3, queryId: 'q2', cancelled: true });

    await envoyer(gm, 'mj.impactCancel', { queryId: 'q3' });
    await expect(bandeau).toBeHidden();
    expect(await outilActif(gm)).toBe('none');
    await gm.waitForTimeout(300);
    expect(await impacts(gm)).toHaveLength(2);
    expect(await gabarits(gm)).toEqual([]);
    expect(await gabarits(player)).toEqual([]);
    expect(erreurs).toEqual([]);
  } finally {
    await context.close();
  }
});
