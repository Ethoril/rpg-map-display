// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Catalogue de test servi à la place de maps/catalog.json.
 * Les URLs restent RELATIVES, comme dans un vrai catalogue généré.
 */
const FAKE_CATALOG = {
  version: 1,
  maps: [
    {
      id: 'minimal',
      name: 'Carte minimale',
      sourceUrl: 'maps/minimal.uvtt',
      sceneUrl: 'maps/generated/minimal.scene.json',
      imageUrl: 'maps/minimal.webp',
      thumbUrl: 'maps/generated/minimal.thumb.webp',
      levels: [
        {
          levelId: 'minimal-level',
          name: 'Carte minimale',
          thumbUrl: 'maps/generated/minimal.thumb.webp',
          gridType: 'square',
          source: 'uvtt',
          updatedAt: 1700000000000,
        },
      ],
      sourceHash: 'sha256-test',
      levelCount: 1,
      features: { walls: 3, portals: 2, lights: 1, bakedLighting: false },
    },
  ],
};

/** Scène cohérente avec FAKE_CATALOG : imageUrl identique, relative. */
const FAKE_SCENE = {
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
      walls: [],
      portals: [],
      lights: [],
      ambient: { level: 1, baked: false },
    },
  ],
  links: [],
  tokens: [],
  templates: [],
  settings: {},
};

const MESSAGE_ECHEC = 'canal indisponible (transport de test)';

/**
 * Une image RÉELLE de 1 × 1 px, servie à la place des vignettes générées.
 *
 * ⚠ Elle existe parce qu'une `<img>` dont l'URL ne mène nulle part est présente dans le DOM
 * comme une autre : seul `naturalWidth > 0` distingue une vignette affichée d'une image cassée.
 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Injecte un transport dont chaque publication réussit — ou échoue de bout en bout, comme le
 * ferait Firebase sur un refus de règles : `{ok:false}` rendu à l'appelant ET signalé aux
 * handlers `onError`, exactement les deux canaux du vrai transport.
 *
 * @param {import('@playwright/test').Page} page
 * @param {boolean} echoue
 */
async function installerTransport(page, echoue) {
  await page.addInitScript((doitEchouer) => {
    class TransportDeTest {
      constructor() {
        /** @type {Set<(err: unknown) => void>} */
        this.handlers = new Set();
        /** @type {any[]} */
        this.publies = [];
      }
      async connect() {}
      /** @param {any} event */
      async publish(event) {
        this.publies.push(event);
        if (!doitEchouer) return { ok: true };
        const error = new Error('canal indisponible (transport de test)');
        for (const handler of this.handlers) handler(error);
        return { ok: false, error };
      }
      subscribe() {
        return () => {};
      }
      async snapshot() {
        return {};
      }
      async saveSnapshot() {}
      /** @param {(err: unknown) => void} handler */
      onError(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
      }
      isOwnEvent() {
        return false;
      }
      disconnect() {}
    }
    /** @type {any} */ (window).__RPG_APP_OPTIONS__ = { transport: new TransportDeTest() };
  }, echoue);
}

/**
 * Monte la vue MJ en interceptant le catalogue et la scène.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{catalog?: any, scene?: any, catalogStatus?: number, sceneStatus?: number,
 *   transport?: 'aucun'|'ok'|'echec'}} [fixtures]
 * @returns {Promise<string[]>} erreurs de page collectées
 */
async function setupWithCatalog(page, fixtures = {}) {
  const {
    catalog = FAKE_CATALOG,
    scene = FAKE_SCENE,
    catalogStatus = 200,
    sceneStatus = 200,
    transport = 'aucun',
  } = fixtures;

  if (transport !== 'aucun') {
    await installerTransport(page, transport === 'echec');
  }

  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.route('**/maps/catalog.json', (route) =>
    route.fulfill({
      status: catalogStatus,
      contentType: 'application/json',
      body: JSON.stringify(catalog),
    })
  );

  await page.route('**/maps/generated/*.thumb.webp', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX })
  );

  await page.route('**/maps/generated/minimal.scene.json', (route) =>
    route.fulfill({
      status: sceneStatus,
      contentType: 'application/json',
      body: JSON.stringify(scene),
    })
  );

  await page.goto('/gm.html');
  await page.click('#gm-mode-prep');
  await page.waitForSelector('.gm-tab-btn[data-tab="scene-library"]');
  await page.click('.gm-tab-btn[data-tab="scene-library"]');

  return errors;
}

test.describe('U-04 — Bibliothèque de cartes MJ', () => {
  test('affiche les cartes du catalogue avec leurs compteurs, sans champ URL', async ({ page }) => {
    await setupWithCatalog(page);

    await expect(page.locator('.scene-card')).toHaveCount(1);
    await expect(page.locator('.scene-card-name')).toHaveText('Carte minimale');

    const counters = await page.locator('.scene-card-counters').textContent();
    expect(counters).toContain('3'); // murs
    expect(counters).toContain('2'); // portes
    expect(counters).toContain('1'); // lumières

    // Plan §7 : aucun champ URL, aucun sélecteur de fichier dans ce parcours. Le diagnostic UVTT,
    // replié en bas du volet Cartes depuis C-10, porte le sien : la garde vise la bibliothèque.
    const pane = page.locator('#scene-library-mount');
    await expect(pane.locator('input[type="text"]')).toHaveCount(0);
    await expect(pane.locator('input[type="file"]')).toHaveCount(0);
  });

  test('« Charger » charge la scène dans le store sans erreur de page', async ({ page }) => {
    const errors = await setupWithCatalog(page);

    await page.click('.scene-card-load');

    // Le statut confirme le chargement dans l'interface
    await expect(page.locator('.scene-library-status')).toContainText('chargée');

    // Le store contient l'étage préparé, avec son imageUrl RELATIVE
    const level = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const activeLevel = store.getActiveLevel();
      return activeLevel
        ? { id: activeLevel.id, imageUrl: activeLevel.imageUrl, pxPerCell: activeLevel.pxPerCell }
        : null;
    });

    expect(level).not.toBeNull();
    expect(level?.id).toBe('minimal-level');
    expect(level?.imageUrl).toBe('maps/minimal.webp');
    expect(level?.pxPerCell).toBe(140);

    // Aucune exception non rattrapée (la régression loadBtn hors portée)
    expect(errors).toEqual([]);
  });

  test('une scène incohérente avec le catalogue est refusée sans muter le store', async ({
    page,
  }) => {
    const driftedScene = structuredClone(FAKE_SCENE);
    driftedScene.levels[0].imageUrl = 'maps/generated/autre-image.webp';

    await setupWithCatalog(page, { scene: driftedScene });
    await page.click('.scene-card-load');

    await expect(page.locator('.scene-library-status')).toContainText('incohérence');

    const hasLevel = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel() !== null;
    });
    expect(hasLevel).toBe(false);
  });

  test('E-9 — une publication qui échoue interdit l’annonce « ✓ chargée »', async ({ page }) => {
    await setupWithCatalog(page, { transport: 'echec' });

    await page.click('.scene-card-load');

    const statut = page.locator('.scene-library-status');
    await expect(statut).toContainText('NON transmise à la table');
    await expect(statut).toContainText(MESSAGE_ECHEC);
    // Le faux succès est précisément ce qui a laissé passer le défaut de canal.
    await expect(statut).not.toContainText('✓');

    // Le store, lui, a bien été chargé côté MJ : le message dit la vérité des deux côtés.
    const chargee = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel()?.id ?? null;
    });
    expect(chargee).toBe('minimal-level');
  });

  test('E-9 — une publication qui réussit annonce toujours « ✓ chargée »', async ({ page }) => {
    await setupWithCatalog(page, { transport: 'ok' });

    await page.click('.scene-card-load');

    await expect(page.locator('.scene-library-status')).toContainText('✓');
    await expect(page.locator('.scene-library-status')).toContainText('chargée');
  });

  test('E-9 — un échec de publication se voit sur le badge réseau du MJ', async ({ page }) => {
    await setupWithCatalog(page, { transport: 'echec' });

    // Avant la publication, le badge annonce une session saine.
    await expect(page.locator('#network-status-gm')).not.toContainText('Erreur réseau');

    await page.click('.scene-card-load');

    // L'effet observable est le message réellement affiché à la table, pas un drapeau interne.
    await expect(page.locator('#network-status-gm')).toContainText(
      `Erreur réseau — ${MESSAGE_ECHEC}`
    );
  });

  test('un catalogue corrompu laisse la bibliothèque indisponible et visible en erreur', async ({
    page,
  }) => {
    await setupWithCatalog(page, { catalog: { version: 99, maps: 'pas-un-tableau' } });

    await expect(page.locator('.scene-library-status')).toContainText('indisponible');
    await expect(page.locator('.scene-card')).toHaveCount(0);
  });
});

test.describe('C-1 tranche B — vignettes et étages dans le panneau MJ', () => {
  /**
   * Catalogue d'une scène à deux étages, sur le modèle de ce que publie `pnpm maps:prepare`.
   * @param {{ thumbs?: boolean }} [options]
   */
  const catalogueMultiEtages = ({ thumbs = true } = {}) => ({
    version: 1,
    maps: [
      {
        id: 'tour',
        name: 'Tour de guet',
        sourceUrl: ['maps/tour_00.uvtt', 'maps/tour_01.uvtt'],
        sceneUrl: 'maps/generated/tour.scene.json',
        imageUrl: 'maps/generated/pied.webp',
        ...(thumbs ? { thumbUrl: 'maps/generated/pied.thumb.webp' } : {}),
        levels: [
          {
            levelId: 'pied',
            name: 'Pied de la tour',
            thumbUrl: 'maps/generated/pied.thumb.webp',
            gridType: 'square',
            source: 'uvtt',
            updatedAt: 1700000000000,
          },
          {
            levelId: 'sommet',
            name: 'Sommet',
            thumbUrl: 'maps/generated/sommet.thumb.webp',
            gridType: 'square',
            source: 'uvtt',
            updatedAt: 1700000000001,
          },
        ],
        sourceHash: ['sha256-a', 'sha256-b'],
        levelCount: 2,
        features: { walls: 0, portals: 0, lights: 0, bakedLighting: false },
      },
    ],
  });

  test('la vignette de la carte est une image RÉELLEMENT chargée', async ({ page }) => {
    await setupWithCatalog(page);

    const vignette = page.locator('.scene-card .scene-card-thumb').first();
    await expect(vignette).toBeVisible();

    // ⭐ Une `<img>` dont l'URL est fausse existe aussi dans le DOM : seule la largeur
    // naturelle prouve que le navigateur a réellement décodé une image.
    await expect
      .poll(() => vignette.evaluate((el) => /** @type {HTMLImageElement} */ (el).naturalWidth))
      .toBeGreaterThan(0);

    await expect(vignette).toHaveAttribute('src', 'maps/generated/minimal.thumb.webp');
    await expect(page.locator('.scene-card-thumb-placeholder')).toHaveCount(0);
  });

  test('sans thumbUrl, un substitut discret et AUCUNE image cassée', async ({ page }) => {
    const ancien = structuredClone(FAKE_CATALOG);
    delete (/** @type {any} */ (ancien.maps[0]).thumbUrl);
    delete (/** @type {any} */ (ancien.maps[0]).levels);

    await setupWithCatalog(page, { catalog: ancien });

    await expect(page.locator('.scene-card')).toHaveCount(1);
    await expect(page.locator('.scene-card-thumb-placeholder')).toHaveCount(1);

    // Aucune `<img>` du tout dans la carte : pas d'icône d'image cassée, pas de trou.
    await expect(page.locator('.scene-card img')).toHaveCount(0);

    // Et le substitut occupe bien une boîte : un élément de hauteur nulle serait un trou.
    const boite = await page
      .locator('.scene-card-thumb-placeholder')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(boite).toBeGreaterThan(0);
  });

  test('une carte multi-étages liste ses étages, une carte mono-étage n’en liste aucun', async ({
    page,
  }) => {
    await setupWithCatalog(page, { catalog: catalogueMultiEtages() });

    await expect(page.locator('.scene-card-level')).toHaveCount(2);
    await expect(page.locator('.scene-card-level-name')).toHaveText([
      'Pied de la tour',
      'Sommet',
    ]);

    // Chaque étage a sa propre vignette, réellement chargée elle aussi.
    const largeurs = await page
      .locator('.scene-card-level .scene-card-thumb')
      .evaluateAll((els) =>
        els.map((el) => /** @type {HTMLImageElement} */ (el).naturalWidth)
      );
    expect(largeurs).toHaveLength(2);
    for (const largeur of largeurs) expect(largeur).toBeGreaterThan(0);

    // Mono-étage : rien à énumérer.
    await setupWithCatalog(page, { catalog: FAKE_CATALOG });
    await expect(page.locator('.scene-card')).toHaveCount(1);
    await expect(page.locator('.scene-card-level')).toHaveCount(0);
  });

  test('les deux boutons font exactement ce qu’ils faisaient', async ({ page }) => {
    const errors = await setupWithCatalog(page);

    await expect(page.locator('.scene-card-load')).toHaveText('📂 Charger');
    await expect(page.locator('.scene-card-add')).toHaveText('➕ Ajouter étage');

    // Cliquer la vignette ne charge rien : elle n'a pas de comportement propre.
    await page.locator('.scene-card-thumb').first().click();
    await expect(page.locator('.scene-library-status')).not.toContainText('chargée');

    await page.click('.scene-card-load');
    await expect(page.locator('.scene-library-status')).toContainText('chargée');
    expect(errors).toEqual([]);
  });
});

// ── H-3 : « Ajouter comme étage » ne doit jamais écraser un étage déjà joué ─────────────────
//
// Défaut relevé par l'audit du 26/11/2026. En mode `add`, la boucle appelle `store.addLevel(level)`
// par étage SANS aucune garde d'identifiant, alors qu'`addLevel` remplace en place à identifiant
// égal (`store.js:1033`). Les scènes préparées ont un identifiant fixe : rajouter une carte déjà
// présente rejoue ses étages à neuf, portes refermées, sans un mot.
//
// ⭐ Arbitrage A du 26/11/2026 : **refuser, sans rien muter, et nommer l'étage déjà présent**, en
// renvoyant vers « Remplacer l'étage courant » (onglet Image). C'est déjà, mot pour mot, ce que
// fait le chemin d'aperçu UVTT depuis l'audit du 22/09 (`importPanel.js:288`).
//
// ⛔ Le second volet du défaut est l'application PARTIELLE : la boucle mute le store étage par
// étage, donc un lot dont le deuxième étage est refusé laisse le premier posé. La scène
// « Extension » ci-dessous porte exprès un identifiant déjà pris ET un identifiant neuf.

/** Une porte fermée, pour avoir un état de jeu à perdre. */
const PORTE_FERMEE = { id: 'porte-1', a: { cellX: 1, cellY: 1 }, b: { cellX: 1, cellY: 2 }, state: 'closed', freestanding: false };

/** @param {string} id @param {string} nom @param {number} ordre */
function etageScene(id, nom, ordre) {
  return {
    ...FAKE_SCENE.levels[0],
    id, name: nom, order: ordre,
    portals: [{ ...PORTE_FERMEE, id: `${id}-porte` }],
  };
}

/** Scène « Carte minimale » : un seul étage, avec une porte. */
const SCENE_PORTE = { ...FAKE_SCENE, levels: [etageScene('minimal-level', 'Carte minimale', 0)] };

/** Scène « Extension » : un étage DÉJÀ PRIS puis un étage neuf, dans cet ordre. */
const SCENE_EXTENSION = {
  ...FAKE_SCENE,
  campaignId: 'campaign-extension',
  name: 'Extension',
  levels: [etageScene('minimal-level', 'Carte minimale (version neuve)', 0), etageScene('etage-neuf', 'Étage neuf', 1)],
};

/** Scène « Extension » dont AUCUN identifiant n'est pris : le cas qui doit continuer de marcher. */
const SCENE_DISJOINTE = {
  ...FAKE_SCENE,
  campaignId: 'campaign-disjointe',
  name: 'Extension',
  levels: [etageScene('etage-neuf', 'Étage neuf', 1), etageScene('etage-encore-neuf', 'Étage encore neuf', 2)],
};

/** Catalogue à deux entrées : la carte minimale, et une « Extension » servie à part. */
const CATALOG_DEUX = {
  ...FAKE_CATALOG,
  maps: [
    FAKE_CATALOG.maps[0],
    {
      ...FAKE_CATALOG.maps[0],
      id: 'extension',
      name: 'Extension',
      sceneUrl: 'maps/generated/extension.scene.json',
      levelCount: 2,
    },
  ],
};

/**
 * Pose la carte minimale, puis OUVRE sa porte : un état de jeu que rien ne doit effacer.
 *
 * @param {import('@playwright/test').Page} page
 */
async function poserLaCarteEtOuvrirLaPorte(page) {
  await page.click('.scene-card-load');
  await expect(page.locator('.scene-library-status')).toContainText('chargée');
  const ouverte = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.setPortalState('minimal-level', 'minimal-level-porte', 'open');
    return store.getCampaign()?.levels.find((l) => l.id === 'minimal-level')?.portals[0]?.state;
  });
  expect(ouverte).toBe('open');
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ ids: string[], porte: string|undefined, noms: string[] }>}
 */
function lireLesEtages(page) {
  return page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const niveaux = store.getCampaign()?.levels ?? [];
    return {
      ids: niveaux.map((l) => l.id),
      noms: niveaux.map((l) => l.name),
      porte: niveaux.find((l) => l.id === 'minimal-level')?.portals[0]?.state,
    };
  });
}

test('H-3 — « Ajouter comme étage » refuse un identifiant déjà pris, le nomme, et ne mute RIEN', async ({ page }) => {
  const errors = await setupWithCatalog(page, { catalog: CATALOG_DEUX, scene: SCENE_PORTE });
  await page.route('**/maps/generated/extension.scene.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCENE_EXTENSION) })
  );

  await poserLaCarteEtOuvrirLaPorte(page);

  const carteExtension = page.locator('.scene-card', { hasText: 'Extension' });
  await carteExtension.locator('.scene-card-add').click();

  // 1. Le refus se dit, et il NOMME l'étage déjà présent — pas un message générique.
  const statut = page.locator('.scene-library-status');
  await expect(statut).toHaveClass(/gm-err/);
  await expect(statut).toContainText('Carte minimale');
  // 2. Et il renvoie vers la seule porte d'entrée légitime, comme le fait l'aperçu UVTT.
  //    ⚠ L'apostrophe est libre : `importPanel.js` en met une droite, le reste du dépôt une
  //    typographique. Le test porte sur le renvoi, pas sur ce choix de glyphe.
  await expect(statut).toContainText(/Remplacer l['’]étage courant/);

  // 3. ⛔ Le cœur du test : RIEN n'a bougé. Ni l'étage neuf posé au passage (application
  // partielle), ni la porte ouverte (écrasement en place).
  const apres = await lireLesEtages(page);
  expect(apres.ids).toEqual(['minimal-level']);
  expect(apres.noms).toEqual(['Carte minimale']);
  expect(apres.porte).toBe('open');

  expect(errors).toEqual([]);
});

test('H-3 — « Ajouter comme étage » pose bien un lot dont AUCUN identifiant n’est pris', async ({ page }) => {
  // ⛔ Anti-triche : refuser tout ferait passer le test ci-dessus au vert en cassant la
  // fonctionnalité. Le cas nominal — deux étages neufs — doit continuer de s'ajouter en entier.
  const errors = await setupWithCatalog(page, { catalog: CATALOG_DEUX, scene: SCENE_PORTE });
  await page.route('**/maps/generated/extension.scene.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCENE_DISJOINTE) })
  );

  await poserLaCarteEtOuvrirLaPorte(page);

  const carteExtension = page.locator('.scene-card', { hasText: 'Extension' });
  await carteExtension.locator('.scene-card-add').click();

  const statut = page.locator('.scene-library-status');
  await expect(statut).not.toHaveClass(/gm-err/);

  const apres = await lireLesEtages(page);
  expect(apres.ids).toEqual(['minimal-level', 'etage-neuf', 'etage-encore-neuf']);
  expect(apres.porte).toBe('open');

  expect(errors).toEqual([]);
});

// ── H-3, seconde divergence : le MJ et la table ne recevaient pas le même étage ─────────────
//
// En mode « ajouter », la boucle de publication parcourait `sceneData.levels` — le JSON BRUT relu
// du fichier — alors que le store avait reçu `normalizedData.levels`. Et `normalizeCampaign` rend
// un `structuredClone` (`schema.js:126`) : les deux tableaux ne sont donc pas le même objet, et
// tout ce que la normalisation corrige partait normalisé d'un côté, brut de l'autre.
//
// La sonde est une lumière hors bornes et sans `on` : `normalizeLevel` borne l'intensité à 1 et
// pose `on: true` (amendement C-2). Un étage publié brut porte encore `intensity: 4` et pas de
// `on` — deux écrans qui n'éclairent pas la même pièce.

/** Scène « Extension » dont l'étage neuf porte une lumière que la normalisation doit corriger. */
const SCENE_A_NORMALISER = {
  ...FAKE_SCENE,
  campaignId: 'campaign-a-normaliser',
  name: 'Extension',
  levels: [{
    ...etageScene('etage-neuf', 'Étage neuf', 1),
    lights: [{ id: 'torche', at: { cellX: 2, cellY: 2 }, range: 4, intensity: 4, color: '#ffaa00', shadows: false }],
  }],
};

test('H-3 — l’étage publié à la table est le NORMALISÉ, le même que celui posé chez le MJ', async ({ page }) => {
  const errors = await setupWithCatalog(page, { catalog: CATALOG_DEUX, scene: SCENE_PORTE, transport: 'ok' });
  await page.route('**/maps/generated/extension.scene.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SCENE_A_NORMALISER) })
  );

  await poserLaCarteEtOuvrirLaPorte(page);
  await page.locator('.scene-card', { hasText: 'Extension' }).locator('.scene-card-add').click();
  await expect(page.locator('.scene-library-status')).not.toHaveClass(/gm-err/);

  // Ce que le store a reçu, et ce qui est parti sur le réseau.
  const { chezLeMj, versLaTable } = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const publies = /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publies;
    const ajout = publies.filter((/** @type {any} */ e) => e.type === 'level.add')
      .find((/** @type {any} */ e) => e.payload?.level?.id === 'etage-neuf');
    return {
      chezLeMj: store.getCampaign()?.levels.find((l) => l.id === 'etage-neuf')?.lights?.[0] ?? null,
      versLaTable: ajout?.payload?.level?.lights?.[0] ?? null,
    };
  });

  // 1. Le MJ a bien l'étage normalisé : c'est l'état d'aujourd'hui, et il ne doit pas changer.
  expect(chezLeMj).toMatchObject({ id: 'torche', intensity: 1, on: true });

  // 2. ⛔ Et la table reçoit EXACTEMENT le même objet. Sans le correctif elle recevait
  //    `intensity: 4` et aucun `on` : deux écrans qui n'éclairent pas la même pièce.
  expect(versLaTable).not.toBeNull();
  expect(versLaTable).toEqual(chezLeMj);

  expect(errors).toEqual([]);
});
