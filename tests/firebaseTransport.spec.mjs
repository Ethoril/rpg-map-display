// @ts-check
import { test, expect } from '@playwright/test';

// Vérification de T-14 contre un VRAI projet Firebase, dans deux contextes de navigateur
// distincts — donc deux clients au sens du contrat : stockage isolé, authentification
// propre, connexion séparée. Deux instances dans un même processus Node ne prouveraient
// rien : elles partagent l'application Firebase, donc la session et la connexion.
//
// La configuration arrive par RPG_FIREBASE_CONFIG (JSON), jamais par un fichier du dépôt.
// Le compte de test utilise e-mail/mot de passe : la connexion Google n'est pas scriptable,
// Google la refuse depuis un navigateur piloté.

/** @type {Record<string, any>|null} */
let config = null;
const brut = process.env.RPG_FIREBASE_CONFIG;
if (brut) {
  try {
    config = JSON.parse(brut);
  } catch (err) {
    console.warn('RPG_FIREBASE_CONFIG illisible (JSON attendu) :', err);
  }
}
const champsRequis = [
  'apiKey',
  'authDomain',
  'databaseURL',
  'projectId',
  'appId',
  'testEmail',
  'testPassword',
];
const complet = Boolean(config && champsRequis.every((champ) => config?.[champ]));
const RAISON =
  'RPG_FIREBASE_CONFIG absente ou incomplète (apiKey, authDomain, databaseURL, projectId, ' +
  'appId, testEmail, testPassword requis) : un projet Firebase réel est nécessaire.';

// ⛔ En CI, une configuration absente est une PANNE, pas un contexte (audit du 22/09, D8). Ce
// sont les seuls tests du vrai `FirebaseTransport` : un secret renommé ou un JSON cassé les
// faisait tous passer en `skip`, et la porte restait verte sans avoir rien éprouvé.
test('CI : la configuration Firebase réelle est présente', () => {
  test.skip(!process.env.CI, 'hors CI, l’absence de configuration est permise');
  expect(complet, RAISON).toBe(true);
});

/**
 * Ouvre un contexte isolé, y monte un client transport, et rend sa sonde.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} sessionId
 * @param {'gm'|'players'} role
 */
async function ouvrirClient(browser, sessionId, role) {
  const context = await browser.newContext();
  const page = await context.newPage();

  /** @type {string[]} */
  const erreursPage = [];
  page.on('pageerror', (err) => erreursPage.push(err.message));

  await page.addInitScript(
    ([cfg, sid, r]) => {
      /** @type {any} */ (window).__rpgTest = {
        config: cfg,
        sessionId: sid,
        role: r,
        email: /** @type {any} */ (cfg).testEmail,
        password: /** @type {any} */ (cfg).testPassword,
      };
    },
    /** @type {[Record<string, any>, string, string]} */ ([config, sessionId, role])
  );

  await page.goto('/gm.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountTransport.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__probe), null, {
    timeout: 30000,
  });
  expect(erreursPage, `erreurs de page du client ${role}`).toEqual([]);

  return {
    context,
    /** @returns {Promise<string[]>} */
    recus: () => page.evaluate(() => /** @type {any} */ (window).__probe.recus()),
    /** @returns {Promise<string[]>} */
    erreurs: () => page.evaluate(() => /** @type {any} */ (window).__probe.erreurs()),
    /** @param {string} type */
    publish: (type) =>
      page.evaluate((t) => /** @type {any} */ (window).__probe.publish(t), type),
    snapshot: () => page.evaluate(() => /** @type {any} */ (window).__probe.snapshot()),
    reconnect: () => page.evaluate(() => /** @type {any} */ (window).__probe.reconnect()),
    purge: () => page.evaluate(() => /** @type {any} */ (window).__probe.purge()),
    purgeSession: () => page.evaluate(() => /** @type {any} */ (window).__probe.purgeSession()),
    /** @returns {Promise<number>} */
    purgeAutomatique: () => page.evaluate(() => /** @type {any} */ (window).__probe.purgeAutomatique()),
    /** @returns {Promise<number>} */
    compterEvenements: () => page.evaluate(() => /** @type {any} */ (window).__probe.compterEvenements()),
    /** @returns {Promise<Array<string|null>>} */
    curseurs: () => page.evaluate(() => /** @type {any} */ (window).__probe.curseurs()),
    resync: () => page.evaluate(() => /** @type {any} */ (window).__probe.resync()),
    /** @param {any} instantane */
    sauver: (instantane) => page.evaluate((i) => /** @type {any} */ (window).__probe.sauver(i), instantane),
    /** @returns {Promise<any>} */
    relire: () => page.evaluate(() => /** @type {any} */ (window).__probe.relire()),
    /** @returns {Promise<any>} */
    parentFirestore: () => page.evaluate(() => /** @type {any} */ (window).__probe.parentFirestore()),
    /** @returns {Promise<boolean>} */
    horlogePrete: () => page.evaluate(() => /** @type {any} */ (window).__probe.horlogePrete()),
  };
}

/**
 * Après la fermeture des autres contextes, `onDisconnect` peut demander un bref aller-retour
 * serveur. La première tentative termine volontairement le transport MJ ; les suivantes passent
 * par l'API de session explicite, qui reste disponible sur sa connexion Firebase initialisée.
 *
 * @param {Awaited<ReturnType<typeof ouvrirClient>>} client
 */
async function purgerQuandLesLeasesOntDisparu(client) {
  try {
    await client.purge();
  } catch {
    await expect(async () => client.purgeSession()).toPass({ timeout: 15_000, intervals: [500] });
  }
}

test('deux clients : rien n\'est livré avant snapshot(), tout l\'est après', async ({
  browser,
}) => {
  test.skip(!complet, RAISON);

  const sessionId = `test-ordre-${Date.now()}`;
  const mj = await ouvrirClient(browser, sessionId, 'gm');
  const joueurs = await ouvrirClient(browser, sessionId, 'players');

  try {
    // Le MJ publie alors qu'aucun des deux n'a encore appelé snapshot().
    await mj.publish('token.move');
    await mj.publish('door.toggle');
    await mj.publish('camera.publish');

    // L'événement a bel et bien traversé le réseau — mais il ne doit PAS avoir été livré :
    // c'est tout le contrat de T-14. Sans tampon, ce test échoue ici.
    await new Promise((r) => setTimeout(r, 2000));
    expect(
      await joueurs.recus(),
      'aucun delta ne doit être livré avant que snapshot() ne soit résolu'
    ).toEqual([]);

    // Après snapshot(), le tampon est vidé une seule fois et dans l'ordre des clés push.
    await joueurs.snapshot();
    await expect.poll(() => joueurs.recus(), { timeout: 10000 }).toEqual([
      'token.move',
      'door.toggle',
      'camera.publish',
    ]);

    expect(await joueurs.erreurs(), 'aucun échec asynchrone attendu').toEqual([]);
    expect(await mj.erreurs(), 'aucun échec asynchrone attendu').toEqual([]);
  } finally {
    await joueurs.context.close();
    await purgerQuandLesLeasesOntDisparu(mj);
    await mj.context.close();
  }
});

test('une reconnexion ne rejoue pas l\'historique de la session', async ({ browser }) => {
  test.skip(!complet, RAISON);

  const sessionId = `test-reconnexion-${Date.now()}`;
  const mj = await ouvrirClient(browser, sessionId, 'gm');
  /** @type {Awaited<ReturnType<typeof ouvrirClient>>|null} */
  let joueurs = null;

  try {
    await mj.snapshot();
    await mj.publish('token.move');
    await mj.publish('door.toggle');
    await mj.publish('camera.publish');
    await expect.poll(() => mj.recus(), { timeout: 10000 }).toHaveLength(3);

    // Un client qui arrive après coup ne doit PAS se voir resservir les trois événements :
    // `onChildAdded` non borné les rejouerait tous, et le client rejouerait toute la séance.
    const clientJoueurs = await ouvrirClient(browser, sessionId, 'players');
    joueurs = clientJoueurs;
    await clientJoueurs.snapshot();
    await new Promise((r) => setTimeout(r, 2000));
    expect(
      await clientJoueurs.recus(),
      'l\'historique antérieur à la connexion ne doit pas être rejoué'
    ).toEqual([]);

    // Seuls les événements postérieurs arrivent.
    await mj.publish('token.move');
    await expect.poll(() => clientJoueurs.recus(), { timeout: 10000 }).toEqual(['token.move']);

    // Même discipline après une reconnexion du même client.
    await clientJoueurs.reconnect();
    await clientJoueurs.snapshot();
    await new Promise((r) => setTimeout(r, 2000));
    expect(
      await clientJoueurs.recus(),
      'une reconnexion ne doit pas rejouer les événements déjà passés'
    ).toEqual([]);

    await clientJoueurs.context.close();
    joueurs = null;
  } finally {
    await joueurs?.context.close();
    await purgerQuandLesLeasesOntDisparu(mj);
    await mj.context.close();
  }
});


// C1 (audit du 22/09/2026) — la purge AUTOMATIQUE des événements supprime-t-elle quoi que ce soit ?
// À la lecture, son `runTransaction` sur `session/{id}` rendait `undefined` quand le cache local
// était vide, ce qui annule la transaction : `events` grossirait alors sans fin. Seule une base
// réelle tranche. Deux clients reçoivent tout, leurs curseurs atteignent le dernier événement :
// la purge doit en supprimer.
test('C1 : la purge automatique supprime les événements que tous les clients ont reçus', async ({ browser }) => {
  test.skip(!complet, RAISON);

  const sessionId = `test-purge-auto-${Date.now()}`;
  const mj = await ouvrirClient(browser, sessionId, 'gm');
  const joueurs = await ouvrirClient(browser, sessionId, 'players');
  try {
    await mj.snapshot();
    await joueurs.snapshot();
    for (let i = 0; i < 6; i++) await mj.publish('token.move');
    await expect.poll(() => joueurs.recus().then((r) => r.length), { timeout: 15000 }).toBe(6);

    const avant = await mj.compterEvenements();
    expect(avant, 'les six événements sont dans la base').toBeGreaterThanOrEqual(6);
    // Chaque curseur a rattrapé le dernier événement, et l'horloge serveur est connue.
    await expect
      .poll(async () => {
        const c = await mj.curseurs();
        return c.length >= 2 && new Set(c).size === 1 && c[0] !== null;
      }, { timeout: 20000 })
      .toBe(true);
    await expect.poll(() => mj.horlogePrete(), { timeout: 10000 }).toBe(true);

    const supprimes = await mj.purgeAutomatique();
    const apres = await mj.compterEvenements();
    console.log(`[C1] avant ${avant}, supprimés annoncés ${supprimes}, après ${apres}`);
    expect(supprimes, 'la purge automatique annonce des suppressions').toBeGreaterThan(0);
    expect(apres, 'et la base les a réellement perdues').toBeLessThan(avant);
  } finally {
    await joueurs.context.close();
    await purgerQuandLesLeasesOntDisparu(mj);
    await mj.context.close();
  }
});


// C6 (audit du 22/09/2026) — pendant une resynchro, le `cancel()` de l'ancien filet `onDisconnect`
// partait après la nouvelle inscription, sur le même chemin, et l'annulait. Le client se
// déconnectait ensuite sans que son bail disparaisse : un fantôme, qui bloquait la purge 120 s.
// ⚠ Sans le correctif, l'échec dépend d'une course réseau : ce test peut passer par chance.
test('C6 : après une resynchro, le bail d’un client disparaît quand il se déconnecte', async ({ browser }) => {
  test.skip(!complet, RAISON);
  test.setTimeout(90_000);

  const sessionId = `test-filet-${Date.now()}`;
  const mj = await ouvrirClient(browser, sessionId, 'gm');
  const joueurs = await ouvrirClient(browser, sessionId, 'players');
  try {
    await mj.snapshot();
    await joueurs.snapshot();
    await expect.poll(() => mj.curseurs().then((c) => c.length), { timeout: 15000 }).toBe(2);
    await joueurs.resync();
    await expect.poll(() => mj.curseurs().then((c) => c.length), { timeout: 15000 }).toBe(2);

    await joueurs.context.close();
    await expect
      .poll(() => mj.curseurs().then((c) => c.length), { timeout: 30000, message: 'le bail fantôme reste' })
      .toBe(1);
  } finally {
    await purgerQuandLesLeasesOntDisparu(mj);
    await mj.context.close();
  }
});


// C7 (audit du 22/09/2026 ; amendement ADR-012 du 23/09, D-10) — contre la vraie base : après un
// déplacement, seul le pion déplacé est réécrit, et un client neuf relit l'état exact.
test('C7 : deux sauvegardes, un pion déplacé — seul lui est réécrit, et la relecture est exacte', async ({ browser }) => {
  test.skip(!complet, RAISON);

  const sessionId = `test-ecritures-${Date.now()}`;
  /** @param {number} a */
  const instantane = (a) => ({
    campaign: {
      schemaVersion: 2, campaignId: sessionId, name: 'C7', links: [], settings: {}, templates: [],
      levels: [{ id: 'rdc', name: 'RdC', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
        pxPerCell: 100, widthCells: 12, heightCells: 8,
        grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
        terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false } }],
      tokens: ['heros', 'garde'].map((id, i) => ({
        id, levelId: 'rdc', cell: { a: id === 'heros' ? a : 9, b: i }, sizeCells: 1, kind: 'pc', imageUrl: '',
        borderColor: '#00ff00', label: id, hidden: false, visionBright: 6, visionDim: 8, emitsLight: null,
        speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [],
      })),
    },
    activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
  });
  const mj = await ouvrirClient(browser, sessionId, 'gm');
  try {
    await mj.sauver(instantane(1));
    const p1 = await mj.parentFirestore();
    await mj.sauver(instantane(2));
    const p2 = await mj.parentFirestore();
    expect(p2.revision).toBeGreaterThan(p1.revision);
    expect(p2.tokenRevisions.garde, 'le pion inchangé n’est pas réécrit').toBe(p1.revision);
    expect(p2.tokenRevisions.heros, 'le pion déplacé l’est').toBe(p2.revision);
    expect(p2.levelRevisions.rdc, 'l’étage inchangé n’est pas réécrit').toBe(p1.revision);

    const neuf = await ouvrirClient(browser, sessionId, 'players');
    const lu = await neuf.relire();
    expect(lu.campaign.tokens.find((/** @type {any} */ t) => t.id === 'heros').cell.a).toBe(2);
    await neuf.context.close();
  } finally {
    await purgerQuandLesLeasesOntDisparu(mj);
    await mj.context.close();
  }
});
