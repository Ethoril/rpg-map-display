// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

const snapshot = {
  campaign: {
    schemaVersion: 2, campaignId: 'lights', name: 'Lumières', links: [], templates: [],
    settings: {},
    levels: [{
      id: 'rdc', name: 'RDC', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
      pxPerCell: 100, widthCells: 12, heightCells: 8,
      grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
      terrainCost: null, walls: [], portals: [], lights: [],
      ambient: { level: 0, baked: true },
    }],
    tokens: [{
      id: 'torch', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'npc', imageUrl: '',
      borderColor: '#ffcc66', label: 'Torche', hidden: false, visionBright: 0, visionDim: 0,
      emitsLight: null, speedCells: 0, playerMovable: false, locked: false, elevation: 0,
      markers: [], hp: null, health: 'unharmed',
    }],
  }, activeLevelId: 'rdc', selectedTokenId: null, activeHandout: null,
};

test('Lumière R3 : baked est visible et une torche republie la vision sans frame MJ', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `lights-${Date.now()}`;
  const gm = await context.newPage();
  const player = await context.newPage();
  await installBrowserTransport(gm, sessionId, snapshot);
  await installBrowserTransport(player, sessionId, snapshot);
  await gm.goto('/gm.html');
  await player.goto('/player.html');
  await waitForApp(gm);
  await waitForApp(player);

  // L'avertissement reste : l'étage se déclare cuit, et l'assombrir pourrait doubler sa
  // lumière. C'est un conseil.
  await expect(gm.locator('#gm-baked-warning')).toBeVisible();

  // ⭐ **Mais la bascule N'EST PLUS VERROUILLÉE — corrigé le 27/08/2026.**
  //
  // Ce test exigeait `toBeDisabled()`. Relevé sur les cinq exports réels du dépôt : Dungeon
  // Alchemist écrit `baked_lighting: true` **de jour comme de nuit**, et quel que soit le mode
  // d'export choisi — « lumière partout », « dans l'image », « dans le VTT ». Le drapeau ne
  // distingue rien, et il verrouillait cette bascule sur la TOTALITÉ des cartes du mainteneur :
  // il n'a jamais pu régler « Nuit » nulle part.
  //
  // ⛔ Un veto fondé sur un drapeau qui vaut toujours `true` n'est pas une garantie, c'est une
  // panne silencieuse. L'avertissement informe ; c'est le MJ qui tranche.
  await expect(gm.locator('#gm-ambient-day')).toBeEnabled();
  await expect(gm.locator('#gm-ambient-night')).toBeEnabled();

  // Et la bascule agit vraiment : régler « Nuit » sur un étage cuit écrit bien l'ambiante.
  await gm.click('#gm-ambient-night');
  await expect.poll(() => gm.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getRenderSnapshot().activeLevel?.ambient?.level;
  })).toBe(0);
  await expect(gm.locator('#gm-ambient-night')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => gm.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some((/** @type {any} */ e) => e.type === 'vision.update')
  )).toBe(true);

  const before = await gm.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);
  await gm.evaluate(async () => {
    /** @type {any} */ (window).requestAnimationFrame = () => 0;
    const store = await import('../js/state/store.js');
    store.updateToken('torch', { emitsLight: { range: 4, intensity: 1, color: '#ffcc66' } });
  });
  await expect.poll(() => gm.evaluate((count) =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.slice(count).some((/** @type {any} */ e) => e.type === 'vision.update'),
    before
  ), { timeout: 8000 }).toBe(true);
  await context.close();
});

/**
 * UX-07 — le curseur d'ambiance devient une bascule jour / nuit.
 *
 * Il offrait 21 positions de 0 à 1 par pas de 0,05, et le moteur n'en lisait **qu'une seule
 * chose** : `baked || level > 0`. 0,05 et 1,00 étaient rigoureusement indistinguables ; le seul
 * cran qui changeait quoi que ce soit était le passage par zéro. L'interface dit enfin ce que le
 * moteur fait.
 */
test('UX-07 : la bascule écrit 0 ou 1, et une campagne à 0,35 s\'affiche « jour »', async ({ page }) => {
  const sessionId = `ambiance-${Date.now()}`;
  // ⭐ Critère 2 : une campagne enregistrée AVANT ce changement porte une valeur fractionnaire —
  // et un `ambient.color` que plus rien ne lit. Les deux doivent traverser sans erreur.
  const heritee = {
    ...snapshot,
    campaign: {
      ...snapshot.campaign,
      levels: [
        {
          ...snapshot.campaign.levels[0],
          ambient: /** @type {any} */ ({ color: '#ffeecc', level: 0.35, baked: false }),
        },
      ],
    },
  };
  await installBrowserTransport(page, sessionId, heritee);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  const jour = page.locator('#gm-ambient-day');
  const nuit = page.locator('#gm-ambient-night');

  await expect(jour, 'une ambiance à 0,35 est « jour » pour le moteur').toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(nuit).toHaveAttribute('aria-pressed', 'false');

  // Critère 1 : la bascule produit exactement les deux comportements que le moteur distingue.
  await nuit.click();
  await expect(nuit).toHaveAttribute('aria-pressed', 'true');
  await expect(jour).toHaveAttribute('aria-pressed', 'false');

  const apresNuit = await page.evaluate(async () => {
    const [store, fog] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/render/layers/fogLayer.js'),
    ]);
    const level = store.getRenderSnapshot().activeLevel;
    return { level: level?.ambient?.level, eclaire: fog.isAmbientLit(/** @type {any} */ (level)) };
  });
  expect(apresNuit.level, 'la position « nuit » écrit exactement 0').toBe(0);
  expect(apresNuit.eclaire, 'et le moteur la lit comme éteinte').toBe(false);

  await jour.click();
  const apresJour = await page.evaluate(async () => {
    const [store, fog] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/render/layers/fogLayer.js'),
    ]);
    const level = store.getRenderSnapshot().activeLevel;
    return { level: level?.ambient?.level, eclaire: fog.isAmbientLit(/** @type {any} */ (level)) };
  });
  expect(apresJour.level, 'la position « jour » écrit exactement 1').toBe(1);
  expect(apresJour.eclaire).toBe(true);

  // Les deux positions passent par le même événement réseau qu'avant, sans en inventer un.
  const publies = await page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published
      .filter((/** @type {any} */ e) => e.type === 'level.ambient')
      .map((/** @type {any} */ e) => e.payload.ambient.level)
  );
  expect(publies).toEqual([0, 1]);
});

/**
 * Le besoin du mainteneur, mot pour mot : « je dois pouvoir en séance cocher ou décocher le
 * port d'une torche par un personnage ». `emitsLight` était déjà lu de bout en bout par le
 * moteur (`light.js`) mais rien ne l'écrivait en séance — le panneau MJ n'exposait aucune
 * torche sur un pion déjà posé.
 *
 * ⭐ **L'assertion porte sur l'EFFET, jamais sur l'état de la case à cocher.** Sur un étage à
 * ambiante nulle, allumer la torche d'un PJ doit changer ce que la table voit : la vision
 * publiée change. Une case cochée que le moteur ignorerait passerait au vert sur un test qui
 * ne lirait que le DOM ou le store — c'est le genre de faux vert déjà attrapé douze fois dans
 * ce dépôt.
 */
test('Panneau MJ : cocher/décocher la torche d\'un PJ republie la vision, et la portée saisie est celle qui part', async ({ page }) => {
  const sessionId = `torch-panel-${Date.now()}`;
  const pjSnapshot = {
    campaign: {
      ...snapshot.campaign,
      campaignId: 'torch-panel',
      tokens: [
        {
          id: 'pj1', levelId: 'rdc', cell: { a: 3, b: 3 }, sizeCells: 1, kind: 'pc', imageUrl: '',
          // ⚠ `visionDim` volontairement SOUS la portée de la torche (`TOKEN_TORCH_DEFAULT.range`,
          // 6) : la vision dans le noir vaut déjà de la vision sans lumière jusqu'à ce rayon-là,
          // donc une torche de même portée ne changerait rien au masque — et un test qui
          // constaterait « aucun changement » à tort serait exactement le faux vert redouté ici.
          borderColor: '#2563eb', label: 'Héros', hidden: false, visionBright: 0, visionDim: 2,
          emitsLight: null, speedCells: 6, playerMovable: false, locked: false, elevation: 0,
          markers: [], hp: null, health: 'unharmed',
        },
      ],
    },
    activeLevelId: 'rdc', selectedTokenId: 'pj1', activeHandout: null,
  };
  await installBrowserTransport(page, sessionId, pjSnapshot);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);
  await page.click('.gm-tab-btn[data-tab="token-maker"]');

  await expect(page.locator('#token-edit-torch')).toBeEnabled();
  await expect(page.locator('#token-edit-torch')).not.toBeChecked();
  await expect(page.locator('#token-edit-torch-range')).toBeDisabled();

  /** PNG du masque de vision publié le plus récemment (le dernier `vision.update` reçu). */
  const dernierPng = () => page.evaluate(() => {
    const publies = /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter(
      (/** @type {any} */ e) => e.type === 'vision.update'
    );
    return publies.at(-1)?.payload?.png;
  });
  const pngAvant = await dernierPng();

  const before = await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);

  // Cocher : la portée par défaut (6) est déjà dans le champ, la torche s'allume.
  await page.check('#token-edit-torch');
  await expect(page.locator('#token-edit-torch-range')).toBeEnabled();
  await expect(page.locator('#token-edit-torch-range')).toHaveValue('6');

  await expect.poll(() => page.evaluate((count) =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.slice(count).some((/** @type {any} */ e) => e.type === 'vision.update'),
    before
  )).toBe(true);

  const rangeStore = await page.evaluate(async () =>
    (await import('../js/state/store.js')).getSelectedToken()?.emitsLight?.range
  );
  expect(rangeStore, 'la portée par défaut part bien dans le store/sur le réseau').toBe(6);
  const pngAllume = await dernierPng();
  expect(pngAllume, 'la torche allumée change le masque de vision publié').not.toBe(pngAvant);

  // Changer la portée d'une torche déjà allumée la republie avec la nouvelle portée.
  const beforeRange = await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);
  await page.fill('#token-edit-torch-range', '12');
  await page.locator('#token-edit-torch-range').dispatchEvent('change');
  await expect.poll(() => page.evaluate(async () => (await import('../js/state/store.js')).getSelectedToken()?.emitsLight?.range))
    .toBe(12);
  const rangePubliee = await page.evaluate((count) =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published
      .slice(count)
      .filter((/** @type {any} */ e) => e.type === 'token.update')
      .map((/** @type {any} */ e) => e.payload.patch.emitsLight?.range),
    beforeRange
  );
  expect(rangePubliee, 'la portée saisie (12) est celle publiée sur le réseau').toContain(12);
  await expect.poll(dernierPng, 'la nouvelle portée change encore le masque de vision publié')
    .not.toBe(pngAllume);

  // Décocher ramène exactement à l'état d'avant : plus de source, le masque redevient identique.
  const beforeOff = await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);
  await page.uncheck('#token-edit-torch');
  await expect(page.locator('#token-edit-torch-range')).toBeDisabled();
  await expect.poll(() => page.evaluate((count) =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.slice(count).some((/** @type {any} */ e) => e.type === 'vision.update'),
    beforeOff
  )).toBe(true);
  const emitsLightApresExtinction = await page.evaluate(async () =>
    (await import('../js/state/store.js')).getSelectedToken()?.emitsLight
  );
  expect(emitsLightApresExtinction, 'décocher éteint bien la torche (emitsLight: null)').toBeNull();
  const pngEteint = await dernierPng();
  expect(pngEteint, 'et le masque de vision revient exactement à l\'état d\'avant la torche').toBe(pngAvant);
});

/**
 * Deuxième moitié du besoin : la vision dans le noir se règle aussi sur un pion déjà posé,
 * pas seulement à la création. Effet observé : la vision publiée change.
 */
test('Panneau MJ : modifier la vision dans le noir d\'un pion posé change la vision publiée', async ({ page }) => {
  const sessionId = `visiondim-panel-${Date.now()}`;
  const pjSnapshot = {
    campaign: {
      ...snapshot.campaign,
      campaignId: 'visiondim-panel',
      tokens: [
        {
          id: 'pj1', levelId: 'rdc', cell: { a: 3, b: 3 }, sizeCells: 1, kind: 'pc', imageUrl: '',
          borderColor: '#2563eb', label: 'Héros', hidden: false, visionBright: 0, visionDim: 6,
          emitsLight: null, speedCells: 6, playerMovable: false, locked: false, elevation: 0,
          markers: [], hp: null, health: 'unharmed',
        },
      ],
    },
    activeLevelId: 'rdc', selectedTokenId: 'pj1', activeHandout: null,
  };
  await installBrowserTransport(page, sessionId, pjSnapshot);
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);
  await page.click('.gm-tab-btn[data-tab="token-maker"]');

  await expect(page.locator('#token-edit-vision-dim')).toHaveValue('6');

  /** PNG du masque de vision publié le plus récemment. */
  const dernierPng = () => page.evaluate(() => {
    const publies = /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter(
      (/** @type {any} */ e) => e.type === 'vision.update'
    );
    return publies.at(-1)?.payload?.png;
  });
  const pngAvant = await dernierPng();

  const before = await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length);
  await page.fill('#token-edit-vision-dim', '15');
  await page.locator('#token-edit-vision-dim').dispatchEvent('change');

  await expect.poll(() => page.evaluate(async () => (await import('../js/state/store.js')).getSelectedToken()?.visionDim))
    .toBe(15);
  await expect.poll(() => page.evaluate((count) =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.slice(count).some((/** @type {any} */ e) => e.type === 'vision.update'),
    before
  )).toBe(true);

  // ⭐ Et le masque lui-même doit AVOIR CHANGÉ : publier un evenement de vision qui n'honorerait
  // pas la nouvelle portée passerait au vert sur l'assertion ci-dessus.
  await expect.poll(dernierPng, 'la vision dans le noir portée à 15 change le masque publié')
    .not.toBe(pngAvant);
});

/**
 * La preuve réelle du stencil « vu sans lumière » (décision du mainteneur du 07/09/2026).
 *
 * ⛔ **Pourquoi un navigateur, et pas le mock de `lightLayer.test.mjs`.** Ce mock ne modélise
 * pas `globalCompositeOperation = 'saturation'` — il ne peut donc rien prouver sur la
 * désaturation elle-même, seulement sur les DÉCISIONS de la couche (quand elle peint, à
 * partir de quel cache). La composition réelle — un gris qui désature sans changer la
 * luminance — n'existe que dans un vrai Canvas 2D.
 *
 * Le montage passe par les VRAIES pièces de la règle tactique (`FogLayer.updateVision`,
 * `ExploredFog.composeVisible`, `LightLayer`), plutôt que par un masque visible fabriqué à la
 * main : c'est le stencil ∧ ¬champ qui est sous preuve, pas seulement son tampon.
 *
 * Géométrie : une lampe au centre de la case (2,2), portée 2 cases — bien en-deçà des 20
 * cases du plafond technique de ligne de vue, donc VUE quelle que soit la portée du PJ. Un PJ
 * en (7,7) avec `visionDim: 6` voit sa propre case dans le noir (Terme 2), à 707 px de la
 * lampe — largement hors de sa portée de 200 px. Aucun mur : la ligne de vue ne rogne rien.
 */
test('R… ⭐ VU SANS LUMIÈRE : la portée nocturne d’un PJ sort en gris, une source garde sa couleur', async ({ page }) => {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto('/player.html');

  await page.addScriptTag({
    type: 'module',
    content: `
      import { FogLayer } from './js/render/layers/fogLayer.js';
      import { LightLayer } from './js/render/layers/light.js';
      import { gridFor } from './js/grid/index.js';
      import { createLevel, createToken } from './js/core/schema.js';
      import { ExploredFog } from './js/vision/fog.js';

      const level = createLevel({
        id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 100,
        ambient: { level: 0, baked: false },
        lights: [{ id: 'l1', at: { cellX: 2, cellY: 2 }, range: 2, intensity: 1, color: '#ffffff' }],
      });
      const grid = gridFor(level);
      const pj = createToken({ id: 'pj1', levelId: 'rdc', kind: 'pc', cell: { a: 7, b: 7 }, visionDim: 6 });

      const fogLayer = new FogLayer();
      fogLayer.updateVision(grid, level, [pj], { segments: [] });

      const lightLayer = new LightLayer();
      lightLayer.update(grid, level, [pj], { segments: [] });

      const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
      const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
      const gridScale = Math.abs(origin1.x - origin0.x);

      const visibleFog = new ExploredFog(level.widthCells, level.heightCells);
      visibleFog.composeVisible({
        losPolygons: fogLayer.getLosPolygons(),
        nearPolygons: fogLayer.getNearPolygons(),
        litCanvas: lightLayer.getFieldCanvas(),
        mapOrigin: origin0,
        gridScale,
      });

      // Scène RÉELLE, à une couleur franche connue et UNIFORME sur toute la carte —
      // seule façon de comparer deux points de la même image sans qu'un décor déjà gris
      // n'affaiblisse l'assertion.
      const scene = document.createElement('canvas');
      scene.width = 1000; scene.height = 1000;
      const ctx = scene.getContext('2d');
      const brut = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);

      ctx.fillStyle = 'rgb(200, 60, 30)';
      ctx.fillRect(0, 0, scene.width, scene.height);
      const decorAvant = brut(250, 250); // vérifie la fixture AVANT toute lumière

      lightLayer.render(ctx, grid, level, { role: 'players', visibleCanvas: visibleFog.canvas });

      window.__mesuresNocturnes = {
        decorAvant,
        eclaire: brut(250, 250),     // au centre de la lampe
        nonEclaire: brut(750, 850),  // portée nocturne du PJ, à 707+ px de la lampe
      };
    `,
  });

  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__mesuresNocturnes));
  const { decorAvant, eclaire, nonEclaire } = await page.evaluate(
    () => /** @type {any} */ (window).__mesuresNocturnes
  );

  // ⭐ D'abord, la fixture : sa couleur est bien franche (canaux nettement inégaux), sans quoi
  // les deux assertions suivantes seraient creuses. Relu sur la scène AVANT tout rendu, pas
  // seulement supposé : (200, 60, 30), soit 170 d'écart entre R et B et 140 entre R et V.
  expect(decorAvant[0], 'fixture : rouge franc').toBe(200);
  expect(decorAvant[1], 'fixture : vert franc').toBe(60);
  expect(decorAvant[2], 'fixture : bleu franc').toBe(30);

  // Point A — dans la source : la couleur d'origine SURVIT (canaux nettement inégaux).
  // Une modulation par une lumière blanche ne peut qu'échelonner les trois canaux ensemble,
  // jamais les égaliser.
  expect(Math.abs(eclaire[0] - eclaire[1]), 'éclairé : R et V doivent rester nettement inégaux').toBeGreaterThan(60);
  expect(Math.abs(eclaire[0] - eclaire[2]), 'éclairé : R et B doivent rester nettement inégaux').toBeGreaterThan(60);

  // Point B — la portée nocturne du PJ, hors de portée de la lampe : VISIBLE (le plancher
  // l'empêche de tomber à noir) ET désaturé (R ≈ G ≈ B, à quelques unités près).
  const somme = nonEclaire[0] + nonEclaire[1] + nonEclaire[2];
  expect(somme, '⛔ vu sans lumière ne doit PAS être noir').toBeGreaterThan(15);
  expect(Math.abs(nonEclaire[0] - nonEclaire[1]), 'vision nocturne : R ≈ V').toBeLessThan(6);
  expect(Math.abs(nonEclaire[1] - nonEclaire[2]), 'vision nocturne : V ≈ B').toBeLessThan(6);
  expect(Math.abs(nonEclaire[0] - nonEclaire[2]), 'vision nocturne : R ≈ B').toBeLessThan(6);

  expect(erreurs).toEqual([]);
});
