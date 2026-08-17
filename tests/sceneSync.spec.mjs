// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * U-05 — synchronisation du remplacement de scène.
 *
 * Le mode « Charger » remplace la campagne côté MJ ; il diffuse `scene.load`,
 * le type prévu au cahier des charges §7. Aucun relais par le test : le seul
 * chemin entre les pages est le canal du navigateur.
 */

/** Catalogue servi à la place de maps/catalog.json. URLs relatives, comme en vrai. */
const CATALOG = {
  version: 1,
  maps: [
    {
      id: 'minimal',
      name: 'Carte minimale',
      sourceUrl: 'maps/minimal.uvtt',
      sceneUrl: 'maps/generated/minimal.scene.json',
      imageUrl: 'maps/minimal.webp',
      sourceHash: 'sha256-test',
      levelCount: 1,
      features: { walls: 2, portals: 1, lights: 1, bakedLighting: false },
    },
  ],
};

/** Scène cohérente avec CATALOG, avec de la vraie géométrie à retrouver côté joueurs. */
const SCENE = {
  schemaVersion: 2,
  campaignId: 'campaign-minimal',
  name: 'Carte minimale',
  levels: [
    {
      id: 'minimal-level',
      name: 'Carte minimale',
      order: 0,
      imageUrl: 'maps/minimal.webp',
      videoUrl: null,
      animatedOverlays: [],
      pxPerCell: 140,
      widthCells: 10,
      heightCells: 8,
      grid: {
        type: 'square',
        offsetX: 0,
        offsetY: 0,
        color: '#000000',
        opacity: 0.25,
        visible: true,
      },
      terrainCost: null,
      // Murs : polylignes de `CellPoint` ({ cellX, cellY }) en unités de case,
      // exactement ce que produit parseUvtt. Ne pas confondre avec la `cell`
      // d'un pion, qui est un index de case ({ a, b }).
      walls: [
        [
          { cellX: 0, cellY: 0 },
          { cellX: 4, cellY: 0 },
        ],
        [
          { cellX: 4, cellY: 0 },
          { cellX: 4, cellY: 3 },
        ],
      ],
      portals: [
        {
          id: 'porte-1',
          a: { cellX: 2, cellY: 0 },
          b: { cellX: 3, cellY: 0 },
          closed: true,
          freestanding: false,
        },
      ],
      lights: [
        {
          id: 'torche-1',
          at: { cellX: 1, cellY: 1 },
          range: 4,
          intensity: 1,
          color: '#ffddaa',
          shadows: true,
        },
      ],
      ambient: { color: '#ffffff', level: 1, baked: false },
    },
  ],
  links: [],
  tokens: [],
  templates: [],
  settings: {},
};

/** Les pages démarrent sans campagne : on veut voir la scène *arriver*. */
const EMPTY_SNAPSHOT = { campaign: null, activeLevelId: null, selectedTokenId: null };

/**
 * Monte la vue MJ avec catalogue et scène interceptés, plus le transport de test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sessionId
 * @param {{scene?: any}} [fixtures]
 * @returns {Promise<string[]>} erreurs de page collectées
 */
async function setupGm(page, sessionId, fixtures = {}) {
  const { scene = SCENE } = fixtures;

  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await installBrowserTransport(page, sessionId, EMPTY_SNAPSHOT);

  await page.route('**/maps/catalog.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CATALOG),
    })
  );
  await page.route('**/maps/generated/minimal.scene.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(scene),
    })
  );

  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);
  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="scene-library"]');
  await page.waitForSelector('.scene-card-load');

  return errors;
}

/**
 * Ouvre une vue joueurs raccordée à la session, sans campagne initiale.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} sessionId
 */
async function openPlayer(context, sessionId) {
  const page = await context.newPage();
  await installBrowserTransport(page, sessionId, EMPTY_SNAPSHOT);
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);
  return page;
}

/**
 * Résumé observable de la scène telle que la page la détient.
 * @param {import('@playwright/test').Page} page
 */
function readScene(page) {
  return page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const campaign = store.getCampaign();
    if (!campaign) return null;
    const level = campaign.levels[0];
    return {
      campaignId: campaign.campaignId,
      activeLevelId: store.getActiveLevelId(),
      levelIds: campaign.levels.map((item) => item.id),
      imageUrl: level?.imageUrl,
      walls: level?.walls.length ?? 0,
      portals: level?.portals.length ?? 0,
      lights: level?.lights.length ?? 0,
    };
  });
}

test.describe('U-05 — remplacement de scène synchronisé', () => {
  test('« Charger » : deux clients reçoivent la même scène et les mêmes compteurs', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const sessionId = `scene-load-${Date.now()}`;

    const player1 = await openPlayer(context, sessionId);
    const player2 = await openPlayer(context, sessionId);

    const gm = await context.newPage();
    const gmErrors = await setupGm(gm, sessionId);

    await gm.click('.scene-card-load');
    await expect(gm.locator('.scene-library-status')).toContainText('chargée');

    const attendu = {
      campaignId: 'campaign-minimal',
      activeLevelId: 'minimal-level',
      levelIds: ['minimal-level'],
      imageUrl: 'maps/minimal.webp',
      walls: 2,
      portals: 1,
      lights: 1,
    };

    await expect.poll(() => readScene(player1)).toEqual(attendu);
    await expect.poll(() => readScene(player2)).toEqual(attendu);

    // Le MJ tient exactement la même scène que ses joueurs.
    expect(await readScene(gm)).toEqual(attendu);
    expect(gmErrors).toEqual([]);

    await context.close();
  });

  test('aucun UVTT complet ni base64 ne transite', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const sessionId = `scene-payload-${Date.now()}`;

    const player = await openPlayer(context, sessionId);
    const gm = await context.newPage();
    await setupGm(gm, sessionId);

    await gm.click('.scene-card-load');
    await expect.poll(() => readScene(player)).not.toBeNull();

    // On inspecte ce qui a réellement traversé le canal, pas l'état final.
    const recu = await player.evaluate(() => {
      const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
      return wire.received.filter((/** @type {any} */ e) => e.type === 'scene.load');
    });

    expect(recu).toHaveLength(1);
    const serialise = JSON.stringify(recu[0]);

    // L'image ne voyage que par son URL relative.
    expect(serialise).toContain('maps/minimal.webp');
    expect(serialise).not.toContain('data:');
    expect(serialise).not.toContain('blob:');
    expect(serialise).not.toContain('base64');

    // Aucun champ du format UVTT source ne doit apparaître : les joueurs
    // reçoivent le modèle du projet, pas le fichier importé.
    for (const champUvtt of [
      'line_of_sight',
      'objects_line_of_sight',
      'pixels_per_grid',
      'map_origin',
      'resolution',
    ]) {
      expect(serialise).not.toContain(champUvtt);
    }

    // Garde-fou de volume : un instantané de scène minimale reste petit. Une
    // image encodée ferait exploser ce seuil.
    expect(serialise.length).toBeLessThan(8000);

    await context.close();
  });

  test('idempotence : recevoir deux fois le même remplacement converge', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const sessionId = `scene-idempotent-${Date.now()}`;

    const player = await openPlayer(context, sessionId);
    const gm = await context.newPage();
    await setupGm(gm, sessionId);

    await gm.click('.scene-card-load');
    await expect.poll(() => readScene(player)).not.toBeNull();
    const apresPremier = await readScene(player);

    // Rejouer le même événement, tel quel, depuis le fil observé.
    await player.evaluate(() => {
      const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
      const original = wire.received.find((/** @type {any} */ e) => e.type === 'scene.load');
      const transport = /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport;
      transport.publish(structuredClone(original));
    });

    // Puis un second « Charger » côté MJ, chemin complet.
    await gm.click('.scene-card-load');
    await gm.waitForTimeout(200);

    expect(await readScene(player)).toEqual(apresPremier);

    const campagnes = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const campaign = store.getCampaign();
      return { levels: campaign?.levels.length, tokens: campaign?.tokens.length };
    });
    // Aucun doublon d'étage : un remplacement n'est pas un ajout.
    expect(campagnes).toEqual({ levels: 1, tokens: 0 });

    await context.close();
  });

  test('un instantané invalide ne remplace pas un état valide', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const sessionId = `scene-invalide-${Date.now()}`;

    const player = await openPlayer(context, sessionId);
    const emetteur = await openPlayer(context, sessionId);

    /** @type {string[]} */
    const erreursPage = [];
    player.on('pageerror', (err) => erreursPage.push(err.message));
    /** @type {string[]} */
    const erreursConsole = [];
    player.on('console', (msg) => {
      if (msg.type() === 'error') erreursConsole.push(msg.text());
    });

    // Établir un état valide de référence via le chemin normal.
    const gm = await context.newPage();
    await setupGm(gm, sessionId);
    await gm.click('.scene-card-load');
    await expect.poll(() => readScene(player)).not.toBeNull();
    const etatValide = await readScene(player);

    // Diffuser un instantané dont l'étage est incomplet.
    await emetteur.evaluate(() => {
      const transport = /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport;
      transport.publish({
        type: 'scene.load',
        payload: {
          campaign: {
            schemaVersion: 2,
            campaignId: 'campagne-corrompue',
            name: 'Corrompue',
            levels: [{ id: 'etage-incomplet' }],
            links: [],
            tokens: [],
            templates: [],
            settings: {},
          },
          activeLevelId: 'etage-incomplet',
          selectedTokenId: null,
        },
        at: Date.now(),
        by: 'gm',
      });
    });

    // Laisser le temps à l'événement d'être reçu et refusé.
    await expect
      .poll(() =>
        player.evaluate(() => {
          const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
          return wire.received.filter((/** @type {any} */ e) => e.type === 'scene.load').length;
        })
      )
      .toBe(2);

    // L'état valide est resté en place, à l'identique.
    expect(await readScene(player)).toEqual(etatValide);

    // CONVENTIONS §6 : journaliser et ignorer. Donc une trace, mais aucune
    // exception non rattrapée qui remonterait dans le transport.
    expect(erreursConsole.some((texte) => texte.includes('scene.load'))).toBe(true);
    expect(erreursPage).toEqual([]);

    await context.close();
  });

  test('un vrai F5 joueurs restaure la scène', async ({ page }) => {
    const sessionId = `player-f5-${Date.now()}`;
    await page.goto(`/player.html?session=${sessionId}`);
    await waitForApp(page);

    // Aucun transport injecté : on exerce la persistance locale, pas le réseau.
    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);
      const level = schema.createLevel({
        id: 'crypte',
        name: 'Crypte',
        imageUrl: 'maps/minimal.webp',
        widthCells: 10,
        heightCells: 8,
        pxPerCell: 140,
      });
      const token = schema.createToken({
        id: 'hero-player-f5',
        levelId: level.id,
        imageUrl: 'maps/minimal.webp',
        cell: { a: 3, b: 4 },
      });
      store.loadCampaign(
        schema.createCampaign({
          campaignId: 'campaign-player-f5',
          levels: [level],
          tokens: [token],
        })
      );
    });

    await page.reload();
    await waitForApp(page);

    const restaure = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const state = store.getState();
      const token = state.campaign?.tokens.find((item) => item.id === 'hero-player-f5');
      return {
        campaignId: state.campaign?.campaignId,
        activeLevelId: state.activeLevelId,
        levelImageUrl: state.activeLevel?.imageUrl,
        tokenCell: token?.cell,
      };
    });

    expect(restaure).toEqual({
      campaignId: 'campaign-player-f5',
      activeLevelId: 'crypte',
      levelImageUrl: 'maps/minimal.webp',
      tokenCell: { a: 3, b: 4 },
    });
  });
});
