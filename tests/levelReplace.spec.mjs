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
      etage('rdc', 'Rez-de-chaussée', 10, 8, 'maps/marais-hex_16x16.jpg'),
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
