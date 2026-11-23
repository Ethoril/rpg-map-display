// @ts-check
// Défauts relevés par le MJ après un vrai combat (21/11/2026) — partie navigateur.
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp, waitForPlayerVision, setPlayerTestVision } from './browserTestTransport.mjs';

/** @param {string} id @param {string} name @param {number} order */
const level = (id, name, order) => ({ id, name, order, imageUrl: '', videoUrl: null, animatedOverlays: [], pxPerCell: 80, widthCells: 10, heightCells: 8, grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true }, terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false } });

/** @param {Partial<Record<string, unknown>>} [lienPatch] */
const snapshotEscalier = (lienPatch = {}) => ({
  campaign: {
    schemaVersion: 2, campaignId: 'defauts-combat', name: 'Défauts du combat',
    levels: [level('rdc', 'RDC', 0), level('et1', 'Étage 1', 1)],
    links: [
      { id: 'stairs-up', kind: 'stairs', label: 'Montée', a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'et1', at: { cellX: 5, cellY: 4 } }, bidirectional: true, gmOnly: false, ...lienPatch },
    ],
    tokens: [{ id: 'hero', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: '', borderColor: '#00ff00', label: 'Héros', hidden: false, visionBright: 4, visionDim: 6, emitsLight: null, speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed' }],
    templates: [], settings: {},
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
});

/** @param {import('@playwright/test').Page} page */
const etat = (page) => page.evaluate(async () => {
  const store = await import('../js/state/store.js');
  return { activeLevelId: store.getState().activeLevelId, token: store.getCampaign()?.tokens.find((t) => t.id === 'hero') };
});
/** Tap au centre de la case (2,2) — pxPerCell 80. @param {import('@playwright/test').Page} page */
const taperEscalier = (page) => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({ type: 'tap', mapPos: { x: 200, y: 200 }, screenPos: { x: 0, y: 0 } }));

/**
 * Encre blanche dans la bande au-dessus de la case (2,2), où seule l'invite écrit (même sonde que
 * `multiLevelJourney.spec.mjs`, calée sur le bord supérieur de la case).
 * @param {import('@playwright/test').Page} page
 */
const encreInvite = (page) => page.evaluate(() => {
  const app = /** @type {any} */ (window).__RPG_APP__;
  const centre = app.camera.mapToScreen({ x: 200, y: 200 });
  const bordHaut = app.camera.mapToScreen({ x: 200, y: 160 });
  const res = app.stage?.resolution ?? window.devicePixelRatio ?? 1;
  const largeur = 220;
  const d = app.context.getImageData(
    Math.round((centre.screenX - largeur / 2) * res),
    Math.round((bordHaut.screenY - 48) * res),
    Math.round(largeur * res),
    Math.round(28 * res)
  ).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++;
  return n / (res * res);
});

for (const [nom, patch] of /** @type {const} */ ([['publique', {}], ['MJ seule', { gmOnly: true }]])) {
  test(`Liaison ${nom} : le MJ fait franchir l’escalier d’un second tap, et la tablette le reçoit`, async ({ browser }) => {
    const context = await browser.newContext();
    const sessionId = `defauts-mj-${nom === 'MJ seule' ? 'gmonly' : 'pub'}-${Date.now()}`;
    const gm = await context.newPage();
    const player = await context.newPage();
    const snap = snapshotEscalier(patch);
    await Promise.all([installBrowserTransport(gm, sessionId, snap), installBrowserTransport(player, sessionId, snap)]);
    await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
    await Promise.all([waitForApp(gm), waitForApp(player)]);

    // Premier tap : le MJ sélectionne le pion posé sur l'escalier. Rien ne franchit.
    await taperEscalier(gm);
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getState().selectedTokenId)).toBe('hero');
    expect(await etat(gm)).toMatchObject({ token: { levelId: 'rdc', cell: { a: 2, b: 2 } } });

    // Second tap sur sa case : le pion monte, des deux côtés, et aucun écran ne bascule.
    await taperEscalier(gm);
    await expect.poll(() => etat(gm), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'et1', cell: { a: 5, b: 4 } } });
    await expect.poll(() => etat(player), { timeout: 8000 }).toMatchObject({ activeLevelId: 'rdc', token: { levelId: 'et1', cell: { a: 5, b: 4 } } });
    await context.close();
  });
}

for (const [nom, patch] of /** @type {const} */ ([['publique', {}], ['MJ seule', { gmOnly: true }]])) test(`Liaison ${nom} : l’invite « Retaper pour prendre l’escalier » s’affiche aussi côté MJ`, async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `defauts-mj-invite-${Date.now()}`;
  const gm = await context.newPage();
  await installBrowserTransport(gm, sessionId, snapshotEscalier(patch));
  await gm.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(gm);
  const zoom = await gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.zoom);
  expect(zoom, 'zoom hors du domaine de validité de la sonde').toBeGreaterThan(0.2);
  expect(zoom, 'zoom hors du domaine de validité de la sonde').toBeLessThan(2);
  const avant = await encreInvite(gm);
  await taperEscalier(gm);
  await expect.poll(() => encreInvite(gm), { timeout: 8000 }).toBeGreaterThan(avant + 40);
  await context.close();
});

// ── Encart des joueurs : consulter un pion que la tablette ne déplace pas ──────────────────────

const PXE = 100;
/** @param {number} ambiant */
const etageEncart = (ambiant) => ({ id: 'rdc', name: 'RDC', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [], pxPerCell: PXE, widthCells: 14, heightCells: 8, grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true }, terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: ambiant, baked: false } });
/**
 * @param {string} id
 * @param {{a: number, b: number}} cell
 * @param {Record<string, unknown>} patch
 */
const pionEncart = (id, cell, patch) => ({ id, levelId: 'rdc', cell, sizeCells: 1, kind: 'npc', imageUrl: '', borderColor: '#ff0000', label: id, hidden: false, visionDim: 2, emitsLight: null, speedCells: 4, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed', mounted: false, ...patch });
const instantaneEncart = (ambiant = 1) => ({
  campaign: {
    schemaVersion: 2, campaignId: 'defauts-encart', name: 'Encart', levels: [etageEncart(ambiant)], links: [],
    tokens: [
      pionEncart('pj', { a: 4, b: 4 }, { kind: 'pc', label: 'Elysia', hp: { current: 7, max: 12 } }),
      pionEncart('gob', { a: 5, b: 4 }, { label: 'Gobelin 2', camp: 'ennemi', health: 'wounded', hp: { current: 3, max: 10 }, markers: ['prone', 'bleeding'] }),
      pionEncart('cache', { a: 4, b: 2 }, { label: 'Assassin', camp: 'ennemi', hidden: true }),
      pionEncart('loin', { a: 12, b: 4 }, { label: 'Sentinelle', camp: 'neutre' }),
    ],
    templates: [], settings: {},
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
});
/** @param {import('@playwright/test').Page} page @param {number} a @param {number} b */
const taperCase = (page, a, b) => page.evaluate(([ca, cb, px]) => /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({ type: 'tap', mapPos: { x: (ca + 0.5) * px, y: (cb + 0.5) * px }, screenPos: { x: 0, y: 0 } }), [a, b, PXE]);
const BANDE = '#player-selection-strip';

/** @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
const pointEcran = (page, x, y) => page.evaluate(([x, y]) => {
  const { camera, canvas } = /** @type {any} */ (window).__RPG_APP__;
  const point = camera.mapToScreen({ x, y });
  const rect = canvas.getBoundingClientRect();
  return { x: Math.round(point.screenX + rect.left), y: Math.round(point.screenY + rect.top) };
}, [x, y]);

/** @param {import('@playwright/test').Page} page */
const selectionJoueur = (page) => page.evaluate(async () =>
  (await import('../js/state/store.js')).getState().selectedTokenId);

/** @param {import('@playwright/test').Browser} browser @param {number} ambiant */
async function tableAvecMj(browser, ambiant) {
  const context = await browser.newContext();
  const sessionId = `defauts-encart-${ambiant}-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  const snap = instantaneEncart(ambiant);
  await Promise.all([installBrowserTransport(gm, sessionId, snap), installBrowserTransport(player, sessionId, snap)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);
  // La vision du MJ doit être arrivée : sans elle, la tablette ne montre aucun pion.
  await waitForPlayerVision(player);
  return { context, gm, player };
}

test('Encart joueurs : un ennemi visible s’ouvre en lecture seule — image, nom, état à trois crans, états ; jamais ses PV', async ({ browser }) => {
  const { context, player } = await tableAvecMj(browser, 1);
  await expect(player.locator(BANDE)).toBeHidden();
  const avant = await player.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);

  await taperCase(player, 5, 4);
  const bande = player.locator(BANDE);
  await expect(bande).toBeVisible();
  await expect(bande.locator('.player-selection-name')).toHaveText('Gobelin 2');
  await expect(bande.locator('.player-selection-vitality')).toHaveText('Blessé');
  await expect(bande.locator('.player-selection-portrait')).toHaveText('G2');
  await expect(bande).not.toContainText('PV');
  await expect(bande).not.toContainText('3/10');
  await expect(bande.locator('.player-selection-badge')).toHaveCount(2);
  // Lecture seule : aucun bouton d'action, aucune sélection, rien publié.
  await expect(bande.locator('.player-selection-mount')).toHaveCount(0);
  expect(await player.evaluate(async () => (await import('../js/state/store.js')).getState().selectedTokenId)).toBe(null);
  expect(await player.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length)).toBe(avant);

  // Un état change côté MJ : l'encart suit.
  await player.evaluate(async () => (await import('../js/state/store.js')).updateToken('gob', { markers: ['prone'] }));
  await expect(bande.locator('.player-selection-badge')).toHaveCount(1);

  // Un tap ailleurs referme.
  await taperCase(player, 10, 6);
  await expect(bande).toBeHidden();

  // Un PJ sélectionné ouvre la bande avec son encart : nom et PV (lisibles sur son anneau).
  await taperCase(player, 4, 4);
  await expect(bande.locator('.player-selection-name')).toHaveText('Elysia');
  await expect(bande.locator('.player-selection-vitality')).toHaveText('PV 7/12');
  await expect(bande.locator('.player-selection-mount')).toHaveCount(1);
  await context.close();
});

test('Encart joueurs : un pion caché ne s’ouvre pas, et l’encart se ferme quand le MJ cache le pion consulté', async ({ browser }) => {
  const { context, player } = await tableAvecMj(browser, 1);
  await taperCase(player, 4, 2);
  await player.waitForTimeout(200);
  await expect(player.locator(BANDE)).toBeHidden();

  await taperCase(player, 5, 4);
  await expect(player.locator(BANDE)).toBeVisible();
  await player.evaluate(async () => (await import('../js/state/store.js')).updateToken('gob', { hidden: true }));
  await expect(player.locator(BANDE)).toBeHidden();
  // Redevenu visible, il ne se rouvre pas tout seul.
  await player.evaluate(async () => (await import('../js/state/store.js')).updateToken('gob', { hidden: false }));
  await player.waitForTimeout(200);
  await expect(player.locator(BANDE)).toBeHidden();
  await context.close();
});

test('Encart joueurs : dans le noir, un pion hors de la vision de la table ne s’ouvre pas', async ({ browser }) => {
  const { context, player } = await tableAvecMj(browser, 0);
  // Témoin : le gobelin, adjacent au PJ, est vu — l'encart s'ouvre, la vision est donc bien là.
  await taperCase(player, 5, 4);
  await expect(player.locator(BANDE)).toBeVisible();
  // La sentinelle, à huit cases dans le noir, n'est pas peinte : la toucher ne dit rien.
  await taperCase(player, 12, 4);
  await player.waitForTimeout(200);
  await expect(player.locator(BANDE)).toBeHidden();
  await context.close();
});

test.describe('Gestes sur tablette pendant un trajet', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  for (const lie of [false, true]) {
    test(`la consigne à cheval indique comment descendre (${lie ? 'outil MJ' : 'autonome'})`, async ({ page }) => {
      const snapshot = snapshotEscalier();
      Object.assign(snapshot.campaign.tokens[0], { mounted: true }, lie ? { link: { source: 'outil-mj', ref: 'pj:hero' } } : {});
      const sid = `tablette-escalier-${lie}-${Date.now()}`;
      await installBrowserTransport(page, sid, snapshot);
      await page.goto(`/player.html?session=${sid}`);
      await waitForApp(page);
      await setPlayerTestVision(page);
      await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const ctx = /** @type {CanvasRenderingContext2D} */ (w.__RPG_APP__.context);
        const original = ctx.fillText.bind(ctx);
        w.__textesLiaison = [];
        ctx.fillText = (text, x, y, maxWidth) => {
          w.__textesLiaison.push(text);
          original(text, x, y, maxWidth);
        };
      });
      const textes = () => page.evaluate(() => /** @type {any} */ (window).__textesLiaison);
      const p = await pointEcran(page, 200, 200);
      await page.touchscreen.tap(p.x, p.y);
      await expect.poll(textes).toContain(lie ? 'Demander au MJ de vous faire descendre de cheval' : 'Descendre de cheval');
      expect(await textes()).not.toContain('Prendre l’escalier');
      await page.touchscreen.tap(p.x, p.y);
      expect(await etat(page)).toMatchObject({ token: { levelId: 'rdc', mounted: true } });

      const bouton = page.locator(`${BANDE} .player-selection-mount`);
      if (lie) {
        await expect(bouton).toBeDisabled();
        // Même événement que la descente commandée depuis l'outil MJ.
        await page.evaluate(async () => (await import('../js/app/networkEvents.js')).applyNetworkEvent({
          type: 'token.mounted', payload: { tokenId: 'hero', mounted: false }, at: Date.now(), by: 'gm',
        }));
      } else {
        await bouton.tap();
      }
      // Amendé le 22/11/2026 (décision 1, CA1–CA4, CA11) : descendu de cheval et hors préparation
      // de mouvement (désélectionné), le bouton « Prendre l’escalier » apparaît et son tap franchit.
      const horsZone = await pointEcran(page, 600, 400);
      await page.touchscreen.tap(horsZone.x, horsZone.y);
      await expect.poll(textes).toContain('Prendre l’escalier');
      const rectBouton = await page.evaluate(async () => {
        const [store, gridMod, linksMod] = await Promise.all([
          import('../js/state/store.js'),
          import('../js/grid/index.js'),
          import('../js/render/layers/links.js'),
        ]);
        const app = /** @type {any} */ (window).__RPG_APP__;
        const { campaign, activeLevel } = store.getState();
        if (!campaign || !activeLevel) return null;
        const token = campaign.tokens.find((t) => t.id === 'hero');
        if (!token) return null;
        return linksMod.boutonLiaison(gridMod.gridFor(activeLevel), activeLevel, campaign.links, token, {
          zoom: app.camera.zoom,
          turn: store.getTurn(),
          camera: app.camera,
          insetTop: document.getElementById('player-level-tabs')?.offsetHeight ?? 0,
        })?.rect ?? null;
      });
      if (!rectBouton) throw new Error('Bouton de liaison attendu après descente de cheval');
      const pb = await pointEcran(page, rectBouton.x + rectBouton.width / 2, rectBouton.y + rectBouton.height / 2);
      await page.touchscreen.tap(pb.x, pb.y);
      await expect.poll(() => etat(page)).toMatchObject({ token: { levelId: 'et1', mounted: false } });
    });
  }

  test('l’appui tenu consulte l’adversaire, puis restaure le PJ et son trajet', async ({ page }) => {
    const snapshot = instantaneEncart();
    const sid = `tablette-consultation-${Date.now()}`;
    await installBrowserTransport(page, sid, snapshot);
    await page.goto(`/player.html?session=${sid}`);
    await waitForApp(page);
    await setPlayerTestVision(page);
    const toucher = async (/** @type {number} */ x, /** @type {number} */ y) => {
      const point = await pointEcran(page, x, y);
      await page.touchscreen.tap(point.x, point.y);
    };
    const lireTrajets = () => page.evaluate((sid) =>
      /** @type {any} */ (window).__rpgTestMovePreviews('get', sid, 'lecteur', null), sid);
    const lirePublications = () => page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published);
    await toucher(450, 450);
    await expect.poll(() => selectionJoueur(page)).toBe('pj');
    await toucher(450, 550);
    await expect.poll(async () => Object.keys(await lireTrajets())).toHaveLength(1);
    const trajet = await lireTrajets();
    const publications = await lirePublications();
    const bande = page.locator(BANDE);
    const devTools = await page.context().newCDPSession(page);
    for (const fin of ['touchEnd', 'touchCancel', 'glissement', 'pincement']) {
      const adversaire = await pointEcran(page, 550, 450);
      await devTools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...adversaire, id: 0 }] });
      await expect(bande).toHaveAttribute('data-mode', 'consultation');
      await expect(bande).toContainText('Gobelin 2');
      await expect(bande).toContainText('À 1 case d’Elysia');
      await expect(bande.locator('.player-selection-mount')).toHaveCount(0);
      expect(await selectionJoueur(page)).toBe('pj');
      expect(await lireTrajets()).toEqual(trajet);

      if (fin === 'glissement') {
        const cameraX = () => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.x);
        const avant = await cameraX();
        await devTools.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ ...adversaire, x: adversaire.x + 60, id: 0 }],
        });
        await expect(bande).toContainText('Elysia');
        await expect.poll(cameraX).toBeLessThan(avant);
      } else if (fin === 'pincement') {
        const cameraZoom = () => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.zoom);
        const avant = await cameraZoom();
        await devTools.send('Input.dispatchTouchEvent', {
          type: 'touchStart', touchPoints: [{ ...adversaire, id: 0 }, { x: adversaire.x + 80, y: adversaire.y, id: 1 }],
        });
        await expect(bande).toContainText('Elysia');
        await devTools.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ ...adversaire, id: 0 }, { x: adversaire.x + 120, y: adversaire.y, id: 1 }],
        });
        await expect.poll(cameraZoom).toBeGreaterThan(avant);
      }
      await devTools.send('Input.dispatchTouchEvent', { type: fin === 'touchCancel' ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await expect(bande).toHaveAttribute('data-mode', 'selection');
      await expect(bande).toContainText('Elysia');
    }
    expect(await lireTrajets()).toEqual(trajet);
    expect(await lirePublications()).toEqual(publications);
    expect(await page.evaluate(async () => (await import('../js/state/store.js')).getSelectedToken()?.cell))
      .toEqual({ a: 4, b: 4 });

    // La poignée d'un gabarit posé sur l'adversaire garde la priorité, même après le délai.
    await page.evaluate(async () => (await import('../js/state/store.js')).placeTemplate({
      id: 'sur-gobelin', levelId: 'rdc', shape: 'circle', origin: { x: 550, y: 450 },
      radiusCells: 1, directionDeg: 0, widthCells: 1, color: '#ef4444', visibleToPlayers: true,
    }));
    const poignee = await pointEcran(page, 550, 450);
    await devTools.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...poignee, id: 0 }] });
    await page.waitForTimeout(600);
    await expect(bande).toHaveAttribute('data-mode', 'selection');
    await devTools.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ ...poignee, x: poignee.x + 48, id: 0 }],
    });
    await devTools.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await lirePublications()).filter((/** @type {any} */ e) => e.type === 'template.move'))
      .toHaveLength(1);
    expect(await lireTrajets()).toEqual(trajet);
  });

  test('la sélection suit la vision courante, y compris dans la marge d’un pion invisible', async ({ page }) => {
    const snapshot = instantaneEncart();
    snapshot.campaign.tokens.push(pionEncart('pj-hors-vision', { a: 3, b: 4 }, { kind: 'pc' }));
    const sid = `tablette-vision-${Date.now()}`;
    await installBrowserTransport(page, sid, snapshot);
    await page.goto(`/player.html?session=${sid}`);
    await waitForApp(page);
    const taper = async (/** @type {number} */ x, /** @type {number} */ y) => {
      const p = await pointEcran(page, x, y);
      await page.touchscreen.tap(p.x, p.y);
    };
    const bande = page.locator(BANDE);
    await taper(450, 450);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.pointerInput.pendingTap)).toBeNull();
    expect(await selectionJoueur(page)).toBeNull();
    await expect(bande).toBeHidden();

    await setPlayerTestVision(page, [{ a: 5, b: 4 }], true);
    await taper(450, 450);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.pointerInput.pendingTap)).toBeNull();
    expect(await selectionJoueur(page)).toBeNull();
    await expect(bande).toBeHidden();

    await setPlayerTestVision(page, [{ a: 4, b: 4 }, { a: 5, b: 4 }]);
    // x=395 est dans le rectangle du PJ hors vision, à 5 px carte du PJ visible.
    await taper(395, 450);
    await expect.poll(() => selectionJoueur(page)).toBe('pj');
    await expect(bande).toContainText('Elysia');
    await taper(450, 550);
    const lireTrajets = () => page.evaluate((sid) =>
      /** @type {any} */ (window).__rpgTestMovePreviews('get', sid, 'lecteur', null), sid);
    await expect.poll(async () => Object.keys(await lireTrajets())).toHaveLength(1);

    await setPlayerTestVision(page, [{ a: 5, b: 4 }]);
    await expect(bande).toBeHidden();
    expect(await selectionJoueur(page)).toBeNull();
    await expect.poll(async () => Object.keys(await lireTrajets())).toHaveLength(0);
    await setPlayerTestVision(page, [{ a: 4, b: 4 }, { a: 5, b: 4 }]);
    await expect(bande).toBeHidden();
    await taper(450, 450);
    await expect(bande).toContainText('Elysia');
  });
});

// ── Pion actif cerné sur l'écran MJ (`mj.turn`, contrat §10, révision du 21/11/2026) ───────────

/**
 * Pixels dorés (halo du tour) autour du centre de la case (a, b), en pixels écran.
 * @param {import('@playwright/test').Page} page @param {number} a @param {number} b
 */
const orAutour = (page, a, b) => page.evaluate(([ca, cb, px]) => {
  const app = /** @type {any} */ (window).__RPG_APP__;
  const c = app.camera.mapToScreen({ x: (ca + 0.5) * px, y: (cb + 0.5) * px });
  const res = app.stage?.resolution ?? window.devicePixelRatio ?? 1;
  const demi = (px / 2) * app.camera.zoom + 24;
  const d = app.context.getImageData(Math.round((c.screenX - demi) * res), Math.round((c.screenY - demi) * res), Math.round(2 * demi * res), Math.round(2 * demi * res)).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 180 && d[i + 1] < 225 && d[i + 2] < 90) n++;
  return n / (res * res);
}, [a, b, PXE]);

/** Message de l'outil MJ, par le vrai canal (même origine). @param {import('@playwright/test').Page} page @param {any} payload */
const envoyerTour = (page, payload) => page.evaluate((p) => {
  const canal = new BroadcastChannel('wfrp-map-link');
  canal.postMessage({ v: 3, type: 'mj.turn', seq: Date.now(), at: Date.now(), from: 'outil-mj', payload: p });
  canal.close();
}, payload);

test('Pion actif : le MJ voit le pion du participant actif cerné d’or ; la tablette, jamais', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `defauts-tour-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  const snap = instantaneEncart(1);
  // Le gobelin et le PJ sont liés à l'outil MJ.
  const tokens = /** @type {any[]} */ (snap.campaign.tokens);
  tokens[0].link = { source: 'outil-mj', ref: 'pj:c1' };
  tokens[1].link = { source: 'outil-mj', ref: 'p:gob' };
  await Promise.all([installBrowserTransport(gm, sessionId, snap), installBrowserTransport(player, sessionId, snap)]);
  await Promise.all([gm.goto(`/gm.html?session=${sessionId}`), player.goto(`/player.html?session=${sessionId}`)]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);
  await expect.poll(() => player.evaluate(async () => (await import('../js/state/store.js')).getSessionVision('rdc') !== null), { timeout: 8000 }).toBe(true);

  // Aucun tour : aucun or autour des pions.
  expect(await orAutour(gm, 5, 4)).toBe(0);
  expect(await orAutour(gm, 4, 4)).toBe(0);

  await envoyerTour(gm, { ref: 'p:gob' });
  await expect.poll(() => orAutour(gm, 5, 4), { timeout: 5000 }).toBeGreaterThan(150);

  // Le tour passe au PJ : le halo le suit.
  await envoyerTour(gm, { ref: 'pj:c1' });
  await expect.poll(() => orAutour(gm, 4, 4), { timeout: 5000 }).toBeGreaterThan(150);
  // Et quitte le gobelin — hors de la bande qu'il partage avec le PJ voisin, côté droit.
  await expect.poll(() => gm.evaluate(([ca, cb, px]) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    const c = app.camera.mapToScreen({ x: (ca + 1) * px, y: (cb + 0.5) * px });
    const res = app.stage?.resolution ?? window.devicePixelRatio ?? 1;
    const d = app.context.getImageData(Math.round(c.screenX * res), Math.round((c.screenY - 20) * res), Math.round(20 * res), Math.round(40 * res)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 180 && d[i + 1] < 225 && d[i + 2] < 90) n++;
    return n;
  }, [5, 4, PXE]), { timeout: 5000 }).toBe(0);

  // La tablette ne montre jamais le tour.
  expect(await orAutour(player, 4, 4)).toBe(0);

  // Fin du combat : plus de halo.
  await envoyerTour(gm, { ref: null });
  await expect.poll(() => orAutour(gm, 4, 4), { timeout: 5000 }).toBe(0);
  await context.close();
});
