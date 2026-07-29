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

  await page.goto('/index.html');
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
  };
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
    await mj.purge();
    await mj.context.close();
    await joueurs.context.close();
  }
});

test('une reconnexion ne rejoue pas l\'historique de la session', async ({ browser }) => {
  test.skip(!complet, RAISON);

  const sessionId = `test-reconnexion-${Date.now()}`;
  const mj = await ouvrirClient(browser, sessionId, 'gm');

  try {
    await mj.snapshot();
    await mj.publish('token.move');
    await mj.publish('door.toggle');
    await mj.publish('camera.publish');
    await expect.poll(() => mj.recus(), { timeout: 10000 }).toHaveLength(3);

    // Un client qui arrive après coup ne doit PAS se voir resservir les trois événements :
    // `onChildAdded` non borné les rejouerait tous, et le client rejouerait toute la séance.
    const joueurs = await ouvrirClient(browser, sessionId, 'players');
    await joueurs.snapshot();
    await new Promise((r) => setTimeout(r, 2000));
    expect(
      await joueurs.recus(),
      'l\'historique antérieur à la connexion ne doit pas être rejoué'
    ).toEqual([]);

    // Seuls les événements postérieurs arrivent.
    await mj.publish('token.move');
    await expect.poll(() => joueurs.recus(), { timeout: 10000 }).toEqual(['token.move']);

    // Même discipline après une reconnexion du même client.
    await joueurs.reconnect();
    await joueurs.snapshot();
    await new Promise((r) => setTimeout(r, 2000));
    expect(
      await joueurs.recus(),
      'une reconnexion ne doit pas rejouer les événements déjà passés'
    ).toEqual([]);

    await joueurs.context.close();
  } finally {
    await mj.purge();
    await mj.context.close();
  }
});
