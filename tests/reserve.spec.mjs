// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * UX-14 — la réserve, par les vrais gestes.
 *
 * ⭐ **UX-08 est la moitié visible de cette tranche** : sortir un pion de la réserve, c'est le
 * poser quelque part. Les deux gestes n'en font qu'un, et ce fichier vérifie qu'ils partagent bien
 * le même armement — donc la même exclusivité mutuelle avec les autres outils.
 */

const NIVEAU = {
  id: 'rdc',
  name: 'RDC',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 140,
  widthCells: 12,
  heightCells: 10,
  grid: {
    type: /** @type {const} */ ('square'),
    offsetX: 0,
    offsetY: 0,
    color: '#000000',
    opacity: 0.25,
    visible: true,
  },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

const GOBELIN = {
  id: 'gobelin',
  levelId: 'rdc',
  cell: { a: 4, b: 4 },
  sizeCells: 1,
  kind: /** @type {const} */ ('npc'),
  imageUrl: '',
  borderColor: '#e74c3c',
  label: 'Gobelin blessé',
  hidden: false,
  visionBright: 0,
  visionDim: 0,
  emitsLight: null,
  speedCells: 3,
  playerMovable: false,
  locked: false,
  elevation: 0,
  markers: /** @type {any[]} */ (['stunned']),
  hp: { current: 3, max: 7 },
  health: /** @type {const} */ ('unharmed'),
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'reserve',
    name: 'Réserve',
    levels: [NIVEAU],
    links: [],
    tokens: [GOBELIN],
    reserve: [],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/** @param {import('@playwright/test').Page} page */
const etat = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const campaign = store.getState().campaign;
    return {
      plateau: (campaign?.tokens ?? []).map((t) => ({ id: t.id, cell: t.cell })),
      reserve: store.getReserve().map((t) => ({ id: t.id, hp: t.hp, markers: t.markers })),
      outil: /** @type {any} */ (window).__RPG_APP__?.gmPanel?.getActiveToolName(),
    };
  });

test('UX-14 : ranger un pion depuis le panneau, puis le reposer par le geste d’UX-08', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `reserve-${Date.now()}`;

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  // Le tiroir n'existe pas tant que la réserve est vide : rien d'inerte à l'écran.
  await mj.click('button[data-tab="token-maker"]');
  await expect(mj.locator('#gm-reserve-drawer')).toBeHidden();
  await expect(mj.locator('#btn-reserve-token')).toBeDisabled();

  // Sélectionner le pion par le vrai geste : un tap sur sa case.
  await mj.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
      type: 'tap',
      mapPos: { x: 4.5 * 140, y: 4.5 * 140 },
      screenPos: { x: 300, y: 300 },
    });
  });
  await expect(mj.locator('#btn-reserve-token')).toBeEnabled();

  await mj.click('#btn-reserve-token');

  // Le pion quitte le plateau avec son état, et le tiroir apparaît en le nommant.
  const apresRangement = await etat(mj);
  expect(apresRangement.plateau).toEqual([]);
  expect(apresRangement.reserve).toEqual([
    { id: 'gobelin', hp: { current: 3, max: 7 }, markers: ['stunned'] },
  ]);
  await expect(mj.locator('#gm-reserve-drawer')).toBeVisible();
  await expect(mj.locator('#gm-reserve-list .gm-reserve-row')).toHaveCount(1);
  // ⛔ Interdiction n°4 : un PNJ n'a jamais de PV chiffrés. La ligne le nomme et donne son cran
  // de santé, jamais « 3/7 ».
  await expect(mj.locator('#gm-reserve-list .gm-reserve-row')).toContainText('Gobelin blessé');
  await expect(mj.locator('#gm-reserve-list .gm-reserve-row')).not.toContainText('3/7');

  // ⭐ Et la table le perd aussi : un pion rangé n'est sur aucune carte.
  await expect
    .poll(() => joueur.evaluate(async () => (await import('../js/state/store.js')).getState().campaign?.tokens.length))
    .toBe(0);

  // « Poser » arme, exactement comme « Générer » d'UX-08 — même outil, donc même exclusivité.
  await mj.click('.gm-reserve-place[data-token-id="gobelin"]');
  expect((await etat(mj)).outil).toBe('token-place');
  expect((await etat(mj)).reserve.length, 'armer ne sort pas encore le pion').toBe(1);

  // Le tap le pose là où le doigt tombe, et le sort de la réserve dans la même transaction.
  await mj.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
      type: 'tap',
      mapPos: { x: 8.5 * 140, y: 2.5 * 140 },
      screenPos: { x: 300, y: 300 },
    });
  });

  const apresPose = await etat(mj);
  expect(apresPose.plateau).toEqual([{ id: 'gobelin', cell: { a: 8, b: 2 } }]);
  expect(apresPose.reserve, 'le pion ne doit pas rester AUSSI en réserve').toEqual([]);
  expect(apresPose.outil, 'l’outil se désarme seul après la pose').toBe('none');
  await expect(mj.locator('#gm-reserve-drawer')).toBeHidden();

  // Le pion revient sur la table, à sa nouvelle case et avec son état.
  await expect
    .poll(() =>
      joueur.evaluate(async () => {
        const store = await import('../js/state/store.js');
        const t = store.getState().campaign?.tokens[0];
        return t ? { id: t.id, cell: t.cell, hp: t.hp } : null;
      })
    )
    .toEqual({ id: 'gobelin', cell: { a: 8, b: 2 }, hp: { current: 3, max: 7 } });

  // Les deux événements qui ont transité, et pas un de plus.
  const publies = await mj.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published
      .map((/** @type {any} */ e) => e.type)
      .filter((/** @type {string} */ t) => t.startsWith('token.'))
  );
  expect(publies).toEqual(['token.reserve', 'token.add']);

  await context.close();
});

test('UX-14 : annuler la pose laisse le pion en réserve', async ({ page }) => {
  const sessionId = `reserve-annule-${Date.now()}`;
  await installBrowserTransport(page, sessionId, {
    ...SNAPSHOT,
    campaign: { ...SNAPSHOT.campaign, tokens: [], reserve: [GOBELIN] },
  });
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);
  await page.click('button[data-tab="token-maker"]');

  await expect(page.locator('#gm-reserve-drawer')).toBeVisible();
  await page.click('.gm-reserve-place[data-token-id="gobelin"]');
  expect((await etat(page)).outil).toBe('token-place');

  // Échap désarme, comme pour tout autre outil. ⚠ Le pion doit être resté en réserve : il n'y
  // était pas « en attente », il n'a jamais cessé d'y être.
  await page.keyboard.press('Escape');
  const apres = await etat(page);
  expect(apres.outil).toBe('none');
  expect(apres.reserve.length, 'annuler ne doit pas égarer le pion').toBe(1);
  expect(apres.plateau).toEqual([]);
  await expect(page.locator('#gm-reserve-drawer')).toBeVisible();
});
