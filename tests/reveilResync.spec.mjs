// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Réveil d'un onglet endormi : quand faut-il resynchroniser, et surtout quand ne le faut-il pas ?
 *
 * Défaut de séance du 16 août 2026 : la tablette s'est désynchronisée après un changement
 * d'onglet sur le poste MJ suivi d'une inactivité. Cause : un onglet masqué cesse d'écrire son
 * curseur de rétention, sort de la barrière au bout de deux minutes, et un autre poste purge
 * alors des événements qu'il n'a jamais lus. `startAfter(curseur)` ne les livrera jamais.
 *
 * ⚠ Le second scénario est le plus important des deux : il interdit le correctif naïf « relire
 * l'instantané à chaque réveil ». L'instantané est réécrit 250 ms après chaque mutation, donc
 * il peut être en retard sur un événement déjà appliqué — le relire sans raison ferait
 * régresser l'état de façon permanente.
 */

const NIVEAU = {
  id: 'lvl',
  name: 'Carte',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: 20,
  heightCells: 16,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

/** @param {{a: number, b: number}} cell */
const pion = (cell) => ({
  id: 'pc-1',
  levelId: 'lvl',
  cell,
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Hero',
  hidden: false,
  visionBright: 20,
  visionDim: 24,
  emitsLight: null,
  speedCells: 30,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
});

/** @param {{a: number, b: number}} cell */
const instantane = (cell) => ({
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-reveil',
    name: 'Réveil',
    levels: [NIVEAU],
    links: [],
    tokens: [pion(cell)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
  activeHandout: null,
});

const S0 = instantane({ a: 2, b: 2 });
const S1 = instantane({ a: 5, b: 5 });
const S2 = instantane({ a: 8, b: 3 });

/**
 * Case du pion telle que la page la connaît réellement, lue dans le store.
 * @param {import('@playwright/test').Page} page
 */
const caseDuPion = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const token = (store.getCampaign()?.tokens ?? []).find((/** @type {any} */ t) => t.id === 'pc-1');
    return token ? `${token.cell.a},${token.cell.b}` : null;
  });

/**
 * Nombre de resynchros que le transport a réellement subies.
 * @param {import('@playwright/test').Page} page
 */
const resynchros = (page) =>
  page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.resyncs);

/**
 * Endort puis réveille l'onglet, avec ou sans trou de rétention déclaré par le transport.
 * @param {import('@playwright/test').Page} page
 * @param {boolean} trou
 */
async function endormirPuisReveiller(page, trou) {
  await page.evaluate((gap) => {
    const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
    wire.setHidden(true);
    wire.gap = gap;
    wire.setHidden(false);
  }, trou);
}

/**
 * Un tap du joueur, comme un vrai geste de déplacement.
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 */
const tap = (page, x, y) =>
  page.evaluate(
    ([mx, my]) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'tap',
        mapPos: { x: mx, y: my },
        screenPos: { x: 0, y: 0 },
      });
    },
    [x, y]
  );

/**
 * Ouvre une page MJ et une page joueurs sur la même session, avec le même instantané.
 * La page MJ est indispensable : c'est elle qui publie la vision réclamée au réveil.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} sessionId
 */
async function ouvrirLaTable(browser, sessionId) {
  const context = await browser.newContext();
  /** @type {string[]} */
  const erreurs = [];

  const gm = await context.newPage();
  gm.on('pageerror', (err) => erreurs.push(`mj: ${err.message}`));
  await installBrowserTransport(gm, sessionId, S0);
  await gm.goto('/gm.html');
  await waitForApp(gm);

  const player = await context.newPage();
  player.on('pageerror', (err) => erreurs.push(`joueur: ${err.message}`));
  await installBrowserTransport(player, sessionId, S0);
  await player.goto('/player.html');
  await waitForApp(player);

  return { context, gm, player, erreurs };
}

test('Bail périmé : la tablette resynchronise et rattrape l’état manqué', async ({ browser }) => {
  const { context, player, erreurs } = await ouvrirLaTable(browser, 'reveil-trou');

  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('2,2');

  // L'état que la tablette a « manqué » pendant son sommeil : le pion a changé de case.
  await player.evaluate((suivant) => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = suivant;
  }, S1);

  await endormirPuisReveiller(player, true);

  await expect.poll(() => resynchros(player), { timeout: 5000 }).toBe(1);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('5,5');

  // ⛔ Le SECOND réveil est le vrai piège, et aucun test ne l'attrapait. Une version du
  // correctif retirait puis reposait un écouteur `visibilitychange` dans le transport à chaque
  // resynchro : le DOM classe les écouteurs par ordre d'insertion, donc le transport repassait
  // DERRIÈRE celui de l'application, qui interrogeait le trou avant qu'il soit constaté. La
  // resynchro ne fonctionnait qu'une seule fois par chargement de page — et la tablette restait
  // désynchronisée exactement comme le 16 août 2026.
  await player.evaluate((suivant) => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = suivant;
  }, S2);

  await endormirPuisReveiller(player, true);

  await expect.poll(() => resynchros(player), { timeout: 5000 }).toBe(2);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('8,3');

  expect(erreurs).toEqual([]);
  await context.close();
});

test('Bail valide : aucune resynchro, et aucune régression de l’état', async ({ browser }) => {
  const { context, player, erreurs } = await ouvrirLaTable(browser, 'reveil-sans-trou');

  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('2,2');

  // Le store avance par un vrai geste, l'instantané reste celui du démarrage : il est donc
  // périmé, exactement comme l'instantané réel écrit 250 ms après la mutation.
  await tap(player, 250, 250);
  await tap(player, 650, 250);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('6,2');

  await endormirPuisReveiller(player, false);

  // Laisser au réveil le temps de faire le mal qu'il pourrait faire.
  await player.waitForTimeout(1000);
  expect(await caseDuPion(player)).toBe('6,2');
  expect(await resynchros(player)).toBe(0);

  expect(erreurs).toEqual([]);
  await context.close();
});

// A3 (audit du 22/09/2026) — la resynchro du réveil relisait l'instantané SANS l'étage mémorisé
// par la table : la tablette rebasculait sur l'étage que le MJ regardait, et mémorisait ce
// nouvel étage pour le prochain F5. Le démarrage, lui, le passait déjà.
test('Bail périmé : la resynchro garde l’étage choisi par la table, pas celui du MJ', async ({ browser }) => {
  const deuxEtages = structuredClone(S0);
  deuxEtages.campaign.levels.push({ ...NIVEAU, id: 'lvl2', name: 'Cave', order: 1 });
  const context = await browser.newContext();
  const player = await context.newPage();
  await installBrowserTransport(player, 'reveil-etage', deuxEtages);
  await player.goto('/player.html');
  await waitForApp(player);

  const etageActif = () =>
    player.evaluate(async () => (await import('../js/state/store.js')).getState().activeLevelId);
  await expect.poll(etageActif, { timeout: 5000 }).toBe('lvl');

  await player.evaluate(async () => (await import('../js/state/store.js')).selectLevel('lvl2'));
  await expect.poll(etageActif, { timeout: 5000 }).toBe('lvl2');

  // L'instantané porte l'étage du MJ, `lvl`, comme le vrai document.
  await player.evaluate((suivant) => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = suivant;
  }, deuxEtages);
  await endormirPuisReveiller(player, true);

  await expect.poll(() => resynchros(player), { timeout: 5000 }).toBe(1);
  await player.waitForTimeout(300);
  expect(await etageActif()).toBe('lvl2');
  await context.close();
});

// A5 (audit du 22/09/2026) — la tablette réécrit l'instantané avec SON étage. Au F5 comme au
// réveil, le MJ le reprenait et se retrouvait sur l'étage choisi par la table.
test('MJ : au F5 comme au réveil, il garde SON étage, pas celui écrit par la tablette', async ({ browser }) => {
  const deuxEtages = structuredClone(S0);
  deuxEtages.campaign.levels.push({ ...NIVEAU, id: 'lvl2', name: 'Cave', order: 1 });
  deuxEtages.activeLevelId = 'lvl'; // l'étage de la TABLE, tel que le document le porte
  const context = await browser.newContext();
  const gm = await context.newPage();
  await gm.addInitScript(() => localStorage.setItem('rpg_gm_level_etage-mj', 'lvl2'));
  await installBrowserTransport(gm, 'etage-mj', deuxEtages);
  await gm.goto('/gm.html?session=etage-mj');
  await waitForApp(gm);

  const etageActif = () =>
    gm.evaluate(async () => (await import('../js/state/store.js')).getState().activeLevelId);
  await expect.poll(etageActif, { timeout: 5000 }).toBe('lvl2');

  await gm.evaluate((suivant) => {
    /** @type {any} */ (window).__RPG_TEST_WIRE__.snapshot = suivant;
  }, deuxEtages);
  await endormirPuisReveiller(gm, true);
  await expect.poll(() => resynchros(gm), { timeout: 5000 }).toBe(1);
  await gm.waitForTimeout(300);
  expect(await etageActif()).toBe('lvl2');
  await context.close();
});

// B10 (audit du 22/09/2026) — tout `resize` de la vue joueurs recadrait la caméra sur la carte
// entière, y compris le passage en plein écran au premier geste : le zoom réglé par la table
// était perdu. Il ne l'est plus dès que la table a touché sa caméra.
test('B10 : un redimensionnement garde la caméra que la table a réglée', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const player = await context.newPage();
  await installBrowserTransport(player, 'b10-camera', S0);
  await player.goto('/player.html?session=b10-camera');
  await waitForApp(player);

  const camera = () =>
    player.evaluate(() => {
      const c = /** @type {any} */ (window).__RPG_APP__.camera;
      return { x: c.x, y: c.y, zoom: c.zoom };
    });
  await player.evaluate(() => {
    const input = /** @type {any} */ (window).__RPG_APP__.pointerInput;
    input.emit({ type: 'pinchZoom', scaleFactor: 2, center: { screenX: 500, screenY: 350 } });
    input.emit({ type: 'panBy', deltaX: 40, deltaY: 0 });
  });
  const reglee = await camera();

  await player.setViewportSize({ width: 1200, height: 800 });
  await player.waitForTimeout(300);
  const apres = await camera();
  expect(apres.zoom).toBeCloseTo(reglee.zoom, 6);
  expect(apres.x).toBeCloseTo(reglee.x, 6);
  await context.close();
});

// D-6 (tranché le 23/09/2026) — plus aucun suivi de caméra : chaque écran cadre seul. Le MJ ne
// publie plus son cadrage, et une tablette ignore un `view.change` reçu, même ouverte avec
// l'ancien `?camera=follow`.
test('D-6 : le cadrage ne voyage plus, dans aucun sens', async ({ browser }) => {
  const context = await browser.newContext();
  const gm = await context.newPage();
  await installBrowserTransport(gm, 'd6-cadrage', S0);
  await gm.goto('/gm.html?session=d6-cadrage');
  await waitForApp(gm);
  const publies = await gm.evaluate(async () => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    for (let i = 0; i < 10; i++) app.pointerInput.emit({ type: 'panBy', deltaX: 5, deltaY: 0 });
    app.pointerInput.emit({ type: 'pinchZoom', scaleFactor: 1.5, center: { screenX: 100, screenY: 100 } });
    await new Promise((ok) => setTimeout(ok, 300));
    return /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter((/** @type {any} */ e) => e.type === 'view.change').length;
  });
  expect(publies, 'le MJ ne publie plus son cadrage').toBe(0);

  const player = await context.newPage();
  await installBrowserTransport(player, 'd6-cadrage', S0);
  await player.goto('/player.html?session=d6-cadrage&camera=follow');
  await waitForApp(player);
  const avant = await player.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.zoom);
  // Un ancien client MJ publierait encore ceci : on le publie à la main, par le vrai canal.
  await gm.evaluate(() =>
    /** @type {any} */ (window).__RPG_APP__.transport.publish({
      type: 'view.change', payload: { camera: { x: 1, y: 1, zoom: 7 } }, at: Date.now(), by: 'gm',
    })
  );
  await expect.poll(() => player.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.received.some((/** @type {any} */ e) => e.type === 'view.change'))).toBe(true);
  await player.waitForTimeout(200);
  expect(await player.evaluate(() => /** @type {any} */ (window).__RPG_APP__.camera.zoom)).toBe(avant);
  await context.close();
});

// D-5 (tranché le 23/09/2026) — la tablette n'écrit l'instantané que si aucun MJ n'est présent.
// Avant, elle le réécrivait à chaque mutation locale, et une tablette réveillée pouvait écraser
// l'état du MJ avec des données périmées.
test('D-5 : la tablette n’écrit l’instantané que si aucun MJ n’est présent', async ({ browser }) => {
  const context = await browser.newContext();
  const player = await context.newPage();
  await installBrowserTransport(player, 'd5-ecriture', S0);
  await player.goto('/player.html?session=d5-ecriture');
  await waitForApp(player);

  const ecrituresApres = (/** @type {boolean} */ mjPresent) =>
    player.evaluate(async (present) => {
      const [store, presence] = await Promise.all([import('../js/state/store.js'), import('../js/state/presence.js')]);
      const w = /** @type {any} */ (window);
      w.__ecritures = 0;
      w.__RPG_APP__.transport.saveSnapshot = async () => { w.__ecritures++; };
      presence.clearPresence();
      if (present) presence.updatePresence('mj-1', { role: 'gm', at: Date.now(), build: 1, label: 'x' });
      // Une vraie mutation de campagne, comme un déplacement joué à la table.
      store.moveTokenToCell('pc-1', { a: 3, b: 3 }, { from: { a: 2, b: 2 }, to: { a: 3, b: 3 }, path: [], startedAt: Date.now() });
      await new Promise((ok) => setTimeout(ok, 500));
      return w.__ecritures;
    }, mjPresent);

  expect(await ecrituresApres(true), 'un MJ présent persiste seul').toBe(0);
  expect(await ecrituresApres(false), 'sans MJ, la table persiste').toBe(1);
  await context.close();
});


// C5 (audit du 22/09/2026) — une resynchro qui échouait laissait la tablette sans écoute, et rien
// ne réessayait avant le prochain `visibilitychange`. Or une tablette castée ne se masque jamais.
test('C5 : une reprise échouée est réessayée seule, et la tablette rattrape l’état', async ({ browser }) => {
  const { context, player } = await ouvrirLaTable(browser, 'reveil-echec');
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('2,2');

  await player.evaluate((suivant) => {
    const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
    wire.snapshot = suivant;
    wire.resyncFailures = 1;
  }, S1);
  await endormirPuisReveiller(player, true);

  // Premier essai : échec. Le second part seul, sans nouveau réveil.
  await expect.poll(() => resynchros(player), { timeout: 8000 }).toBe(2);
  await expect.poll(() => caseDuPion(player), { timeout: 5000 }).toBe('5,5');
  await context.close();
});

test('C5 (MJ) : une reprise échouée est réessayée seule', async ({ browser }) => {
  const context = await browser.newContext();
  const gm = await context.newPage();
  await installBrowserTransport(gm, 'reveil-echec-mj', S0);
  await gm.goto('/gm.html?session=reveil-echec-mj');
  await waitForApp(gm);
  await gm.evaluate((suivant) => {
    const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
    wire.snapshot = suivant;
    wire.resyncFailures = 1;
  }, S1);
  await endormirPuisReveiller(gm, true);
  await expect.poll(() => resynchros(gm), { timeout: 8000 }).toBe(2);
  await expect.poll(() => caseDuPion(gm), { timeout: 5000 }).toBe('5,5');
  await context.close();
});
