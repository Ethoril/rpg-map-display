// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * UX-13 — « Remplacer l'étage courant » à l'import d'image.
 */

/**
 * @param {string} id
 * @param {string} name
 * @param {number} [widthCells]
 * @param {number} [heightCells]
 * @param {string} [imageUrl]
 */
const etage = (id, name, widthCells = 10, heightCells = 8, imageUrl = 'maps/minimal.webp') => ({
  id,
  name,
  order: 0,
  imageUrl,
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells,
  heightCells,
  grid: {
    type: /** @type {const} */ ('square'),
    offsetX: 0,
    offsetY: 0,
    color: '#000000',
    opacity: 0.25,
    visible: true,
  },
  terrainCost: null,
  walls: [
    [
      { cellX: 1, cellY: 1 },
      { cellX: 5, cellY: 1 },
    ],
  ],
  portals: [
    {
      id: 'porte-1',
      a: { cellX: 2, cellY: 2 },
      b: { cellX: 3, cellY: 2 },
      state: /** @type {const} */ ('closed'),
      freestanding: false,
    },
  ],
  lights: [
    {
      id: 'lampe-1',
      at: { cellX: 4, cellY: 4 },
      range: 5,
      intensity: 1,
      color: '#ffaa00',
      shadows: true,
    },
  ],
  ambient: { level: 1, baked: false },
});

const makeSnapshot = () => ({
  campaign: {
    schemaVersion: 2,
    campaignId: 'ux13-session',
    name: 'Campagne UX-13',
    links: [],
    tokens: [
      {
        id: 'heros-rdc',
        levelId: 'rdc',
        kind: 'pc',
        cell: { a: 2, b: 2 },
        sizeCells: 1,
        imageUrl: '',
        borderColor: '#00ff00',
        label: 'Héros',
        hidden: false,
        visionBright: 4,
        visionDim: 6,
        emitsLight: null,
        speedCells: 30,
        playerMovable: true,
        locked: false,
        elevation: 0,
        markers: ['prone'],
        hp: { current: 15, max: 25 },
      },
      {
        id: 'garde-rdc',
        levelId: 'rdc',
        kind: 'npc',
        cell: { a: 4, b: 4 },
        sizeCells: 1,
        imageUrl: '',
        borderColor: '#ff0000',
        label: 'Garde',
        hidden: false,
        visionBright: 0,
        visionDim: 0,
        emitsLight: null,
        speedCells: 20,
        playerMovable: false,
        locked: false,
        elevation: 0,
        markers: ['stunned'],
        hp: { current: 5, max: 10 },
      },
      {
        id: 'spectre-et1',
        levelId: 'et1',
        kind: 'npc',
        cell: { a: 6, b: 6 },
        sizeCells: 1,
        imageUrl: '',
        borderColor: '#8800ff',
        label: 'Spectre',
        hidden: false,
        visionBright: 0,
        visionDim: 0,
        emitsLight: null,
        speedCells: 20,
        playerMovable: false,
        locked: false,
        elevation: 0,
        markers: [],
        hp: { current: 8, max: 8 },
      },
    ],
    reserve: [],
    templates: [],
    settings: {},
    levels: [
      // ⚠ **L'ancienne carte doit être une AUTRE image que la nouvelle.** Avec la même URL des
      // deux côtés, aucune assertion ne peut distinguer « la carte a été remplacée » de « rien
      // ne s'est passé » — et c'est ce qui a laissé passer le critère 5 en faux vert.
      etage('rdc', 'Rez-de-chaussée', 10, 8, 'fixtures/images/seconde-image.webp'),
      etage('et1', 'Étage 1', 12, 10, 'maps/minimal.webp'),
    ],
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
});

test('UX-13 : « Remplacer l étage courant » remplace sur place, range les pions, vide géométrie et brouillard', async ({
  context,
}) => {
  const sessionId = `ux13-replace-${Date.now()}`;
  const snapshot = makeSnapshot();

  const pageGM = await context.newPage();
  const pagePlayer = await context.newPage();

  await installBrowserTransport(pageGM, sessionId, snapshot);
  await installBrowserTransport(pagePlayer, sessionId, snapshot);

  await pageGM.goto(`/gm.html?session=${sessionId}`);
  await pagePlayer.goto(`/player.html?session=${sessionId}`);
  await waitForApp(pageGM);
  await waitForApp(pagePlayer);

  // 1. Initialiser du brouillard exploré sur le RDC côté MJ
  await pageGM.evaluate(async () => {
    const [store, fog] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/vision/fog.js'),
    ]);
    const activeLevel = store.getActiveLevel();
    if (activeLevel) {
      const masque = new fog.ExploredFog(activeLevel.widthCells, activeLevel.heightCells);
      masque.revealAll();
      const png = await masque.exportPng();
      store.setSessionFog(activeLevel.id, png);
    }
  });

  // 2. Basculer en mode Préparer puis onglet Image
  await pageGM.click('#gm-mode-prep');
  await pageGM.click('.gm-tab-btn[data-tab="import-image"]');

  const btnAdd = pageGM.locator('#btn-validate-image-import');
  const btnReplace = pageGM.locator('#btn-replace-image-import');
  const urlInput = pageGM.locator('#image-url-input');

  // Critère 1 : Boutons désactivés sans URL valide
  await expect(btnAdd).toBeDisabled();
  await expect(btnReplace).toBeDisabled();

  // Remplir l'URL avec maps/minimal.webp (exactement les mêmes dimensions : 10×8 cases à 140px)
  await urlInput.fill('maps/minimal.webp');
  await expect(btnAdd).toBeEnabled();
  await expect(btnReplace).toBeEnabled();

  // Calibration : 10×8 cases (mêmes dimensions que l'ancien RDC pour tester le piège !)
  await pageGM.fill('#img-cells-wide', '10');
  await pageGM.fill('#img-cells-tall', '8');
  await pageGM.fill('#img-px-per-cell', '140');

  // 3. Cliquer sur « Remplacer l'étage courant »
  await btnReplace.click();

  const statusEl = pageGM.locator('#image-status');
  await expect(statusEl).toBeVisible();
  await expect(statusEl).toContainText('Étage courant remplacé et publié');

  // 4. Vérifications côté MJ (Critères 2, 3, 4)
  const gmState = await pageGM.evaluate(async () => {
    const [store, fog] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/vision/fog.js'),
    ]);
    const campaign = store.getCampaign();
    const activeId = store.getActiveLevelId();
    const rdc = campaign?.levels.find((l) => l.id === 'rdc');

    const sessionFogPng = store.getSessionFog('rdc');
    let exploredPixelCount = 0;
    if (sessionFogPng) {
      const decodedCanvas = await fog.decodeFogPng(sessionFogPng, 10, 8);
      const ctx = decodedCanvas?.getContext('2d');
      const imgData = ctx?.getImageData(0, 0, decodedCanvas.width, decodedCanvas.height);
      if (imgData) {
        for (let i = 3; i < imgData.data.length; i += 4) {
          if (imgData.data[i] > 0) exploredPixelCount++;
        }
      }
    }

    const sessionVisionPng = store.getSessionVision('rdc');
    let visiblePixelCount = 0;
    if (sessionVisionPng) {
      const decodedCanvas = await fog.decodeFogPng(sessionVisionPng, 10, 8);
      const ctx = decodedCanvas?.getContext('2d');
      const imgData = ctx?.getImageData(0, 0, decodedCanvas.width, decodedCanvas.height);
      if (imgData) {
        for (let i = 3; i < imgData.data.length; i += 4) {
          if (imgData.data[i] > 0) visiblePixelCount++;
        }
      }
    }

    return {
      activeId,
      levelCount: campaign?.levels.length,
      rdc,
      reserve: store.getReserve(),
      tokensSurPlateau: campaign?.tokens ?? [],
      sessionFog: sessionFogPng,
      sessionVision: sessionVisionPng,
      exploredPixelCount,
      visiblePixelCount,
    };
  });

  // Critère 2 : identifiant conservé, pas d'étage ajouté, géométrie vidée, nouvelles dimensions / densité
  expect(gmState.activeId).toBe('rdc');
  expect(gmState.levelCount).toBe(2);
  expect(gmState.rdc?.id).toBe('rdc');
  expect(gmState.rdc?.widthCells).toBe(10);
  expect(gmState.rdc?.heightCells).toBe(8);
  expect(gmState.rdc?.pxPerCell).toBe(140);
  expect(gmState.rdc?.walls).toEqual([]);
  expect(gmState.rdc?.portals).toEqual([]);
  expect(gmState.rdc?.lights).toEqual([]);

  // Critère 3 : pions du RDC en réserve avec PV et marqueurs, spectre d'Étage 1 intact sur le plateau
  expect(gmState.reserve.length).toBe(2);
  const heros = gmState.reserve.find((t) => t.id === 'heros-rdc');
  expect(heros?.label).toBe('Héros');
  expect(heros?.hp).toEqual({ current: 15, max: 25 });
  expect(heros?.markers).toEqual(['prone']);

  const garde = gmState.reserve.find((t) => t.id === 'garde-rdc');
  expect(garde?.label).toBe('Garde');
  expect(garde?.hp).toEqual({ current: 5, max: 10 });
  expect(garde?.markers).toEqual(['stunned']);

  expect(gmState.tokensSurPlateau.length).toBe(1);
  expect(gmState.tokensSurPlateau[0].id).toBe('spectre-et1');

  // Critère 4 : brouillard exploré et vision visible vides (0 pixels révélés)
  expect(gmState.exploredPixelCount).toBe(0);
  expect(gmState.visiblePixelCount).toBe(0);

  // 5. Vérifications côté Joueurs (Critères 4 et 5)
  // La vue joueurs affichant déjà RDC affiche la nouvelle carte sans changer d'étage
  await pagePlayer.waitForFunction(async () => {
    const store = await import('../js/state/store.js');
    return store.getReserve().length === 2;
  });

  // ⚠ Le décodage de l'image est asynchrone : un relevé pris juste après l'arrivée de
  // l'événement attrape `status: 'loading'`. C'est la forme exacte des rouges CI-seulement que ce
  // dépôt a déjà payés — d'où l'attente explicite avant le relevé.
  await pagePlayer.waitForFunction(() => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    return app.backgroundLayer.currentUrl === 'maps/minimal.webp' && app.backgroundLayer.status === 'ready';
  }, undefined, { timeout: 8000 });

  const playerState = await pagePlayer.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const app = /** @type {any} */ (window).__RPG_APP__;
    return {
      activeLevelId: store.getActiveLevelId(),
      levelImageUrl: store.getCampaign()?.levels.find((l) => l.id === 'rdc')?.imageUrl ?? null,
      bgStatus: app.backgroundLayer.status,
      bgUrl: app.backgroundLayer.currentUrl,
      tokens: store.getCampaign()?.tokens ?? [],
      reserve: store.getReserve(),
    };
  });

  expect(playerState.activeLevelId).toBe('rdc');
  expect(playerState.reserve.length).toBe(2);
  expect(playerState.tokens.length).toBe(1);

  // ⭐ **Critère 5, et c'est ici qu'il se joue.** `bgStatus` et `bgUrl` étaient relevés et
  // jamais comparés : le test passait alors même que `level.replace` n'était pas publié du tout,
  // la table gardant l'ancienne carte. Vérifié par mutation le 18/08/2026 — les deux scénarios
  // restaient verts.
  expect(
    playerState.levelImageUrl,
    'la table doit avoir reçu la nouvelle carte dans sa campagne'
  ).toBe('maps/minimal.webp');
  expect(
    playerState.bgUrl,
    'et l’avoir réellement chargée — sans quoi elle affiche encore l’ancienne'
  ).toBe('maps/minimal.webp');
  expect(playerState.bgStatus, 'la nouvelle carte doit être décodée').toBe('ready');
});

test('UX-13 : « Ajouter un étage » conserve le comportement UX-01', async ({ page }) => {
  const sessionId = `ux13-add-${Date.now()}`;
  const snapshot = makeSnapshot();

  await installBrowserTransport(page, sessionId, snapshot);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="import-image"]');

  await page.fill('#image-url-input', 'maps/minimal.webp');
  await expect(page.locator('#btn-validate-image-import')).toBeEnabled();

  await page.fill('#img-cells-wide', '15');
  await page.fill('#img-cells-tall', '12');

  // Cliquer sur « Ajouter un étage »
  await page.click('#btn-validate-image-import');

  await expect(page.locator('#image-status')).toContainText('chargé et publié');

  const gmState = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const campaign = store.getCampaign();
    return {
      activeId: store.getActiveLevelId(),
      levelCount: campaign?.levels.length,
      reserve: store.getReserve(),
      tokens: campaign?.tokens ?? [],
    };
  });

  // L'étage est ajouté (3 au total)
  expect(gmState.levelCount).toBe(3);
  // L'étage actif n'a pas bougé
  expect(gmState.activeId).toBe('rdc');
  // Aucun pion n'a été déplacé en réserve
  expect(gmState.reserve.length).toBe(0);
  expect(gmState.tokens.length).toBe(3);
});

/**
 * UX-13 critère 1, seconde moitié — sans étage actif, il n'y a rien à remplacer.
 *
 * ⚠ **Cette moitié n'était pas couverte.** Le scénario principal vérifie bien que le bouton est
 * désactivé avant qu'une image soit prête, mais son instantané porte toujours un étage actif :
 * rien ne distinguait « désactivé faute d'image » de « désactivé faute d'étage ». Or les deux
 * causes sont indépendantes, et c'est la seconde que le critère nomme.
 */
test('UX-13 critère 1 : sans étage actif, « Ajouter » est possible mais « Remplacer » reste désactivé', async ({
  page,
}) => {
  const sessionId = `ux13-sans-etage-${Date.now()}`;
  // Aucun instantané : la campagne est vide, donc aucun étage n'est actif.
  await installBrowserTransport(page, sessionId, null);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="import-image"]');

  const btnAdd = page.locator('#btn-validate-image-import');
  const btnReplace = page.locator('#btn-replace-image-import');

  await page.fill('#image-url-input', 'maps/minimal.webp');

  // L'image est prête : « Ajouter » devient possible — c'est ainsi qu'on crée le premier étage.
  await expect(btnAdd).toBeEnabled();
  // ⭐ Mais « Remplacer » reste désactivé : il n'y a aucun étage courant à remplacer.
  await expect(
    btnReplace,
    'sans étage actif, « Remplacer » n’a pas de cible et doit rester désactivé'
  ).toBeDisabled();

  // Et dès qu'un étage existe et devient actif, il s'active — par le seul rafraîchissement de
  // l'abonnement au store, sans que l'onglet soit rouvert.
  await btnAdd.click();
  await expect(btnReplace, 'un étage actif rend « Remplacer » atteignable').toBeEnabled();
});

/**
 * E-9 — le panneau d'import ne doit plus annoncer « publié » quand rien n'est parti.
 *
 * ⭐ C'est le site le plus exposé : `assertNoTransientAssetUrls` refuse les URL `blob:` et
 * `data:`, et c'est précisément ce panneau qui en fabrique. Le `try/catch` de ces deux
 * gestionnaires rattrapait autrefois le `throw` de `publish` ; depuis que `publish` rend
 * `{ok:false}` au lieu de lever, seul un examen du résultat empêche le faux succès.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]|null} [typesEnEchec] types refusés ; `null` les refuse tous
 */
async function faireEchouerLesPublications(page, typesEnEchec = null) {
  // Script injecté APRÈS installBrowserTransport : le transport existe déjà, on n'intercepte que
  // l'issue de ses publications — le reste du canal est intact.
  await page.addInitScript((types) => {
    const transport = /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport;
    const publierVraiment = transport.publish.bind(transport);
    /** @param {any} event */
    transport.publish = async (event) => {
      if (types && !types.includes(event.type)) return publierVraiment(event);
      return { ok: false, error: new Error('URL transitoire interdite (transport de test)') };
    };
  }, typesEnEchec);
}

test('E-9 : « Ajouter un étage » n’annonce pas « publié » quand la publication échoue', async ({
  page,
}) => {
  const sessionId = `e9-add-${Date.now()}`;
  await installBrowserTransport(page, sessionId, makeSnapshot());
  await faireEchouerLesPublications(page);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="import-image"]');
  await page.fill('#image-url-input', 'maps/minimal.webp');
  await expect(page.locator('#btn-validate-image-import')).toBeEnabled();
  await page.click('#btn-validate-image-import');

  const statut = page.locator('#image-status');
  await expect(statut).toContainText('NON publié');
  await expect(statut).toContainText('URL transitoire interdite');
  // Le faux succès est exactement ce que cette dette corrige.
  await expect(statut).not.toContainText('et publié.');

  // L'étage est bien arrivé dans le store du MJ : le message dit la vérité des deux côtés.
  const levelCount = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.levels.length ?? 0;
  });
  expect(levelCount).toBe(3);
});

test('E-9 : « Remplacer l’étage courant » n’annonce pas « publié » quand la publication échoue', async ({
  page,
}) => {
  const sessionId = `e9-replace-${Date.now()}`;
  await installBrowserTransport(page, sessionId, makeSnapshot());
  await faireEchouerLesPublications(page);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="import-image"]');
  await page.fill('#image-url-input', 'maps/minimal.webp');
  await expect(page.locator('#btn-replace-image-import')).toBeEnabled();
  await page.fill('#img-cells-wide', '10');
  await page.fill('#img-cells-tall', '8');
  await page.fill('#img-px-per-cell', '140');
  await page.click('#btn-replace-image-import');

  const statut = page.locator('#image-status');
  await expect(statut).toContainText('NON publié');
  await expect(statut).toContainText('URL transitoire interdite');
  await expect(statut).not.toContainText('remplacé et publié');

  // Le remplacement local a bien eu lieu, réserve comprise — c'est ce que le message annonce.
  const etat = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return {
      imageUrl: store.getCampaign()?.levels.find((l) => l.id === 'rdc')?.imageUrl ?? null,
      reserve: store.getReserve().length,
    };
  });
  expect(etat.imageUrl).toBe('maps/minimal.webp');
  expect(etat.reserve).toBeGreaterThan(0);
});

test('E-9 : un seul « token.reserve » perdu suffit à retirer l’annonce « publié »', async ({
  page,
}) => {
  const sessionId = `e9-reserve-${Date.now()}`;
  await installBrowserTransport(page, sessionId, makeSnapshot());
  // ⭐ Ici `level.replace` PART bel et bien : seule la mise en réserve échoue. Sans la règle du
  // premier échec dans la boucle, le panneau annoncerait « publié » alors que la table garde des
  // pions sur une carte qu'ils n'occupent plus.
  await faireEchouerLesPublications(page, ['token.reserve']);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="import-image"]');
  await page.fill('#image-url-input', 'maps/minimal.webp');
  await expect(page.locator('#btn-replace-image-import')).toBeEnabled();
  await page.fill('#img-cells-wide', '10');
  await page.fill('#img-cells-tall', '8');
  await page.fill('#img-px-per-cell', '140');
  await page.click('#btn-replace-image-import');

  const statut = page.locator('#image-status');
  await expect(statut).toContainText('NON publié');
  await expect(statut).not.toContainText('remplacé et publié');

  // Et le `level.replace`, lui, a bien transité : c'est bien la boucle qui disqualifie.
  const publies = await page.evaluate(
    () => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.map((/** @type {any} */ e) => e.type)
  );
  expect(publies).toContain('level.replace');
});

// ── H-2, le scénario exact : le MJ change d'étage PENDANT la confirmation réseau ────────────
//
// ⛔ De bout en bout exprès. Les unitaires de `tests/fogTools.test.mjs` prouvent que `clearFog`
// honore l'étage qu'on lui donne ; ils ne prouvent pas que les QUATRE maillons en amont le lui
// donnent — `importPanel` l'appelant, `panel` le rappel, et surtout le rappel de `gm.js`, qui
// relisait `store.getActiveLevel()` quoi qu'on lui passe. Un correctif partiel laisse les
// unitaires verts et publie encore le `fog.update` sur le mauvais étage.
//
// La publication de `level.replace` est ralentie pour que la bascule d'étage tombe DANS la fenêtre
// de l'`await`, comme chez le mainteneur : sans ce ralentissement la course n'est pas reproductible.

/**
 * Ralentit la publication d'un type d'événement, pour ouvrir une fenêtre déterministe.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} type
 * @param {number} delaiMs
 */
async function ralentirLesPublications(page, type, delaiMs) {
  await page.addInitScript(([t, d]) => {
    const transport = /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport;
    const publierVraiment = transport.publish.bind(transport);
    /** @param {any} event */
    transport.publish = async (event) => {
      if (event.type === t) await new Promise((r) => setTimeout(r, Number(d)));
      return publierVraiment(event);
    };
  }, /** @type {const} */ ([type, delaiMs]));
}

/**
 * Pour chaque étage, le nombre de cases révélées dans le DERNIER `fog.update` publié pour lui.
 * ⛔ On lit le CONTENU et non la présence de l'événement : la bascule d'étage publie elle-même un
 * `fog.update` légitime pour l'étage d'arrivée, et compter les événements ne distinguerait pas
 * cette publication normale d'un masque écrasé.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, {w: number, h: number}>} etages
 */
function casesRevelees(page, etages) {
  return page.evaluate(async (dims) => {
    const fog = await import('../js/vision/fog.js');
    const publies = /** @type {any} */ (window).__RPG_TEST_WIRE__.published;
    /** @type {Record<string, number>} */
    const compte = {};
    for (const [levelId, { w, h }] of Object.entries(dims)) {
      const dernier = publies.filter((/** @type {any} */ e) => e.type === 'fog.update' && e.payload?.levelId === levelId).pop();
      if (!dernier) { compte[levelId] = -1; continue; }
      // ⚠ `decodeFogPng` rend un CANVAS, pas un tableau d'alpha : passer son résultat directement
      // à `isCellVisibleInMask` rend « rien n'est vu » partout, et la sonde fausse ferme la question.
      const alpha = fog.getOrExtractMaskAlpha(await fog.decodeFogPng(dernier.payload.png, w, h), w, h);
      let n = 0;
      for (let a = 0; a < w; a++) {
        for (let b = 0; b < h; b++) if (fog.isCellVisibleInMask({ a, b }, alpha, w, h)) n++;
      }
      compte[levelId] = n;
    }
    return compte;
  }, etages);
}

test('H-2 : remplacer la carte du RDC pendant que le MJ passe à l’Étage 1 n’efface que le brouillard du RDC', async ({ page }) => {
  const sessionId = `h2-course-${Date.now()}`;
  await installBrowserTransport(page, sessionId, makeSnapshot());
  await ralentirLesPublications(page, 'level.replace', 500);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  // Les DEUX étages sont explorés de bout en bout, PAR L'INTERFACE : il y a donc quelque chose à
  // perdre des deux côtés, et une assertion peut distinguer celui qui perd son exploration de celui
  // qui la garde.
  //
  // ⚠ Pré-remplir `store.setSessionFog` ne suffit PAS : le masque exploré du MJ vit dans la mémoire
  // de `gm.js`, et celui d'un étage jamais visité y naît vierge. Un test qui se contente de la
  // graine mesure « le masque n'a jamais été chargé » et non « il a été effacé » — il échouait
  // alors même sur une version correcte. On passe donc par « Tout révéler », étage par étage.
  // Les outils de brouillard vivent dans la palette, ouverte par le rail — pas dans un mode.
  await page.click('#gm-rail-fog-tools');
  for (const levelId of ['et1', 'rdc']) {
    await page.evaluate(async (id) => {
      const store = await import('../js/state/store.js');
      store.selectLevel(id);
    }, levelId);
    await page.click('#fog-btn-reveal-all');
    // Le throttle de `scheduleFogPublish` est d'1 Hz par étage : laisser partir la publication.
    await page.waitForTimeout(1200);
  }
  // Le RDC est redevenu l'étage actif, celui que « Remplacer » va viser.
  expect(await page.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId())).toBe('rdc');

  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="import-image"]');
  await page.locator('#image-url-input').fill('maps/minimal.webp');
  await page.fill('#img-cells-wide', '10');
  await page.fill('#img-cells-tall', '8');
  await page.fill('#img-px-per-cell', '140');

  // Le remplacement part… et le MJ change d'étage avant que le réseau ait répondu.
  await page.locator('#btn-replace-image-import').click();
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.selectLevel('et1');
  });

  await expect(page.locator('#image-status')).toContainText('Étage courant remplacé', { timeout: 10000 });
  // Laisser le throttle de `scheduleFogPublish` rendre sa publication traînante (1 Hz par étage).
  await page.waitForTimeout(1500);

  const compte = await casesRevelees(page, { rdc: { w: 10, h: 8 }, et1: { w: 12, h: 10 } });

  // 1. Le RDC, dont la carte vient d'être remplacée, perd son exploration périmée. C'est voulu.
  expect(compte.rdc, 'le brouillard du RDC doit être remis à zéro : sa carte a changé').toBe(0);

  // 2. ⛔ Le cœur du test : l'Étage 1, que le MJ regarde maintenant, garde la SIENNE. Sans le
  //    correctif, `clearFog()` relisait l'étage actif et c'est lui qui était effacé — le RDC
  //    gardant au passage une exploration qui ne correspondait plus à sa nouvelle carte.
  expect(compte.et1, 'l’étage que le MJ regarde ne doit RIEN perdre').toBe(12 * 10);
});

test('H-14 : changer le pavage du RDC pendant que le MJ passe à l’Étage 1 n’efface que le brouillard du RDC', async ({ page }) => {
  // ⛔ Jumeau de H-2 par l'autre porte. `updateGridTypeFromUI` appelait `fogTools?.clearFog()`
  // APRÈS son `await transport.publish(...)` et sans identifiant, sous un commentaire qui disait
  // la même intention qu'en H-2 (« le brouillard suit l'état d'ici, publié ou non »). Même défaut,
  // même cause, autre chemin — et les corriger séparément rouvrait la seconde porte aussitôt la
  // première fermée.
  const sessionId = `h14-course-${Date.now()}`;
  await installBrowserTransport(page, sessionId, makeSnapshot());
  await ralentirLesPublications(page, 'level.grid', 500);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.click('#gm-rail-fog-tools');
  for (const levelId of ['et1', 'rdc']) {
    await page.evaluate(async (id) => {
      const store = await import('../js/state/store.js');
      store.selectLevel(id);
    }, levelId);
    await page.click('#fog-btn-reveal-all');
    await page.waitForTimeout(1200);
  }
  expect(await page.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId())).toBe('rdc');

  // Le pavage du RDC passe en hexagonal… et le MJ change d'étage avant la réponse du réseau.
  await page.click('#gm-mode-prep');
  await page.click('.gm-tab-btn[data-tab="grid-settings"]');
  await page.selectOption('#grid-type', 'hex');
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.selectLevel('et1');
  });
  await page.waitForTimeout(2200);

  // Le pavage du RDC a bien changé : sans cela le test porterait sur un geste sans effet.
  expect(await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.levels.find((l) => l.id === 'rdc')?.grid.type;
  })).toBe('hex');

  const compte = await casesRevelees(page, { rdc: { w: 10, h: 8 }, et1: { w: 12, h: 10 } });
  expect(compte.rdc, 'le brouillard du RDC doit être remis à zéro : son pavage a changé').toBe(0);
  expect(compte.et1, 'l’étage que le MJ regarde ne doit RIEN perdre').toBe(12 * 10);
});
