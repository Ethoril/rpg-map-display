// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';

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
      const originY1 = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
      // ⚠ E-11 : deux echelles, une par axe. Ici la grille est CARREE — createLevel sans
      // propriete grid, donc de type square : les deux echelles sont egales, d ou le meme
      // calcul deux fois. ⛔ Pas de backtick dans ce commentaire : il vit DANS un template
      // literal injecte par addScriptTag, et un backtick y refermerait la chaine.
      const gridScaleX = Math.abs(origin1.x - origin0.x);
      const gridScaleY = Math.abs(originY1.y - origin0.y);

      const visibleFog = new ExploredFog(level.widthCells, level.heightCells);
      visibleFog.composeVisible({
        losPolygons: fogLayer.getLosPolygons(),
        nearPolygons: fogLayer.getNearPolygons(),
        litCanvas: lightLayer.getFieldCanvas(),
        mapOrigin: origin0,
        gridScaleX,

        gridScaleY,
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

/**
 * La preuve en pixels du SEUIL de désaturation (décision du mainteneur du 10/09/2026).
 *
 * Mot pour mot, en séance : « avec un pion PJ qui est dans le noir, quand j'ajoute une lumière
 * ça modifie bien son champ de vision, ce qui est cool. Mais il continue à voir en niveaux de
 * gris alors que dans le champ de la lumière il devrait voir en couleur. »
 *
 * Même montage géométrique que le test « VU SANS LUMIÈRE » ci-dessus : lampe au centre de la
 * case (2,2), portée 2 cases (200 px, `pxPerCell: 100`), donc centrée en (200, 200). Le point
 * `(300, 200)` est à 100 px du centre — exactement la MI-RAYON du halo, alpha du champ brut
 * mesuré 0,47 (dégradé linéaire à 64 sommets, pas exactement 0,5). Avant le correctif,
 * `destination-out` par le champ BRUT y laissait la majorité du gris résiduel. Le point
 * `(390, 200)`, à 190 px (0,95 du rayon), reste dans la frange extérieure où le champ AMPLIFIÉ
 * n'a pas encore saturé — le dégradé doit y survivre, en comparatif seulement : la valeur
 * absolue dépend de la composition native `saturation` du navigateur, pas modélisable à la
 * main.
 *
 * ⚠ **`visionDim: 20` (le plafond), pas 6 comme le test précédent.** Sondé (mesure directe
 * du canvas) : avec `visionDim: 6`, le PJ à (7,7) est à 640 px du point mi-rayon, hors de son
 * disque de vision nocturne (600 px) — le masque visible s'y limite alors à `LoS ∩ éclairé`,
 * dont l'alpha suit lui-même le champ, ce qui mêle « visibilité partielle » et « gain de
 * désaturation » dans le même nombre et masque la mutation (a). Au plafond, le disque de
 * vision nocturne couvre tout le halo : le masque y est mesuré PLEINEMENT opaque (255), et
 * seul le gain de désaturation explique la différence mi-rayon / frange.
 */
test('R… ⭐ SEUIL DE COULEUR : à MI-RAYON d’un halo, la couleur est déjà revenue (gain de désaturation)', async ({ page }) => {
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
      // ⭐ visionDim au PLAFOND (20 cases) : le disque de vision nocturne du PJ (Terme 2) couvre
      // alors tout le halo de la lampe, et le masque visible y est PLEINEMENT opaque partout —
      // découplé de l'alpha du champ. Sans ce découplage, le masque visible se limiterait à
      // (LoS ∩ éclairé) dans cette zone, dont l'alpha suit lui-même le champ : la comparaison
      // mi-rayon / frange se ferait alors sur un stencil déjà atténué par la visibilité, pas
      // seulement par le gain de désaturation — un mauvais test masquerait la mutation (a).
      const pj = createToken({ id: 'pj1', levelId: 'rdc', kind: 'pc', cell: { a: 7, b: 7 }, visionDim: 20 });

      const fogLayer = new FogLayer();
      fogLayer.updateVision(grid, level, [pj], { segments: [] });

      const lightLayer = new LightLayer();
      lightLayer.update(grid, level, [pj], { segments: [] });

      const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
      const origin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
      const originY1 = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
      // ⚠ E-11 : deux echelles, une par axe. Ici la grille est CARREE — createLevel sans
      // propriete grid, donc de type square : les deux echelles sont egales, d ou le meme
      // calcul deux fois. ⛔ Pas de backtick dans ce commentaire : il vit DANS un template
      // literal injecte par addScriptTag, et un backtick y refermerait la chaine.
      const gridScaleX = Math.abs(origin1.x - origin0.x);
      const gridScaleY = Math.abs(originY1.y - origin0.y);

      const visibleFog = new ExploredFog(level.widthCells, level.heightCells);
      visibleFog.composeVisible({
        losPolygons: fogLayer.getLosPolygons(),
        nearPolygons: fogLayer.getNearPolygons(),
        litCanvas: lightLayer.getFieldCanvas(),
        mapOrigin: origin0,
        gridScaleX,

        gridScaleY,
      });

      const scene = document.createElement('canvas');
      scene.width = 1000; scene.height = 1000;
      const ctx = scene.getContext('2d');
      const brut = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);

      ctx.fillStyle = 'rgb(200, 60, 30)';
      ctx.fillRect(0, 0, scene.width, scene.height);

      lightLayer.render(ctx, grid, level, { role: 'players', visibleCanvas: visibleFog.canvas });

      window.__mesuresSeuilCouleur = {
        miRayon: brut(300, 200),   // 100 px du centre (200,200) : mi-rayon, alpha brut ≈ 0,47
        frange: brut(360, 200),    // 160 px du centre : frange extérieure, alpha brut ≈ 0,16
      };
    `,
  });

  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__mesuresSeuilCouleur));
  const { miRayon, frange } = await page.evaluate(
    () => /** @type {any} */ (window).__mesuresSeuilCouleur
  );

  // ⭐ Test 1 du brief, celui qui compte : à MI-RAYON, la couleur doit être revenue — canaux
  // nettement inégaux, exactement comme au centre de la lampe (voir le test précédent).
  // ⛔ Preuve par mutation (a) : revenir au champ BRUT pour le `destination-out` du stencil
  // couleur fait rougir ces deux assertions (le point retombe à moitié gris).
  const ecartRV = Math.abs(miRayon[0] - miRayon[1]);
  const ecartRB = Math.abs(miRayon[0] - miRayon[2]);
  expect(ecartRV, `mi-rayon : R et V doivent rester nettement inégaux (obtenu ${miRayon})`).toBeGreaterThan(60);
  expect(ecartRB, `mi-rayon : R et B doivent rester nettement inégaux (obtenu ${miRayon})`).toBeGreaterThan(60);

  // Test 2 du brief : la frange extérieure garde un dégradé — en COMPARATIF, jamais en seuil
  // absolu, puisque la composition `saturation` réelle du navigateur n'est pas modélisable à
  // la main. ⚠ **L'écart BRUT (R−V) ne suffit pas** : la frange est aussi plus SOMBRE que le
  // mi-rayon (moins de champ à multiplier), ce qui réduit l'écart brut par simple assombrissement
  // — indépendamment de toute désaturation, et ça a fait passer une mutation (b) inaperçue à la
  // première écriture de ce test. L'indicateur qui isole la SATURATION de la LUMINOSITÉ est le
  // rapport `|R−V| / (R+V+B)` : invariant à un assombrissement uniforme, il chute vers 0 quand un
  // gris s'y mélange. Le point à 0,8 du rayon doit rester MOINS saturé, au sens de ce rapport,
  // que le mi-rayon (déjà pleinement saturé, alpha amplifié ≥ 1).
  /** @param {number[]} rgb */
  const saturation = ([r, v, b]) => {
    const somme = r + v + b;
    return somme > 0 ? Math.abs(r - v) / somme : 0;
  };
  const saturationMiRayon = saturation(miRayon);
  const saturationFrange = saturation(frange);
  // ⛔ Preuve par mutation (b) : un gain énorme (100) sature aussi la frange — l'écart chute à
  // ~0 et cette assertion rougit. Marge de 0,05 : mesuré 0,376 (code fixé) contre 0,479 (gain
  // 100, quasi identique au 0,477 du mi-rayon) — largement au-delà du bruit de mesure.
  expect(
    saturationMiRayon - saturationFrange,
    `frange (${saturationFrange.toFixed(3)}) doit être MOINS saturée que mi-rayon (${saturationMiRayon.toFixed(3)}) — obtenu mi-rayon=${miRayon}, frange=${frange}`
  ).toBeGreaterThan(0.05);

  expect(erreurs).toEqual([]);
});

// C-2, tranche 2 — les GESTES : basculer, poser, supprimer.
//
// ⭐ Chaque test précharge sa campagne via `installBrowserTransport` (INSTANTANÉ de transport),
// PAS via un `store.loadCampaign` après coup — c'est le piège documenté en tête de ce fichier
// pour `portals.spec.mjs` : `__RPG_TEST_WIRE__`, qui journalise ce qui est publié, n'existe que
// si le transport de test est injecté par `addInitScript` AVANT le premier script de la page.
// Un chargement tardif via `store.loadCampaign` laisserait `__RPG_TEST_WIRE__` absent.

test('C-2 : un tap MJ sur une lampe la bascule, et le champ lumineux se recompose (effet, pas seulement l\'état)', async ({ page }) => {
  const sessionId = `light-toggle-${Date.now()}`;
  const level = createLevel({
    id: 'level-toggle',
    name: 'Toggle',
    pxPerCell: 100,
    widthCells: 10,
    heightCells: 10,
    ambient: { level: 0, baked: false },
    lights: [{ id: 'l1', at: { cellX: 5, cellY: 5 }, range: 4, intensity: 1, color: '#ffffff', shadows: false, on: true }],
  });
  // ⚠ Un PJ est nécessaire pour que la ligne de vue atteigne la case de la lampe — sans lui,
  // `fogLayer` ne calcule aucune ligne de vue et le masque reste vide quel que soit l'état de la
  // lampe. ⛔ `visionDim: 0` est tout aussi délibéré : la vision propre dans le noir
  // (`nearPolygons`) s'AJOUTE SANS CONDITION au masque (`js/vision/fog.js`) — si elle couvrait
  // déjà la case de la lampe, la case resterait visible que la lampe soit allumée ou pas, et
  // l'assertion « le masque a changé » serait creuse. Loin du PJ, seule `(ligne de vue ∩
  // éclairé)` peut rendre cette case visible : c'est le terme que la bascule doit faire bouger.
  const pj = createToken({ id: 'pj1', levelId: 'level-toggle', cell: { a: 1, b: 1 }, kind: 'pc', visionDim: 0 });
  await installBrowserTransport(page, sessionId, {
    campaign: createCampaign({ campaignId: 'c-toggle', levels: [level], tokens: [pj] }),
    activeLevelId: 'level-toggle',
    selectedTokenId: null,
  });
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  /** PNG du masque de vision publié le plus récemment. */
  const dernierPng = () => page.evaluate(() => {
    const publies = /** @type {any} */ (window).__RPG_TEST_WIRE__?.published ?? [];
    return publies.filter((/** @type {any} */ e) => e.type === 'vision.update').at(-1)?.payload?.png;
  });

  // Attend que la passe d'autorité déclenchée par `loadCampaign` ait publié sa première vision,
  // sans quoi `pngAvant` serait `undefined` et l'assertion « a changé » serait creuse.
  await expect.poll(dernierPng).not.toBeUndefined();
  const pngAvant = await dernierPng();
  const onAvant = await page.evaluate(async () =>
    (await import('../js/state/store.js')).getCampaign()?.levels[0].lights[0].on
  );
  expect(onAvant, 'fixture : la lampe part allumée').toBe(true);

  // Tap en plein sur le centre de la case de la lampe (5,5) → (550, 550).
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 550, y: 550 },
      mapPos: { x: 550, y: 550 },
    });
  });

  const onApres = await page.evaluate(async () =>
    (await import('../js/state/store.js')).getCampaign()?.levels[0].lights[0].on
  );
  expect(onApres, 'la lampe est éteinte').toBe(false);

  const publieToggle = await page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some(
      (/** @type {any} */ e) => e.type === 'light.toggle' && e.payload.on === false && e.payload.lightId === 'l1'
    )
  );
  expect(publieToggle, 'light.toggle est publié avec l\'état ABSOLU').toBe(true);

  // ⭐ L'assertion qui compte : l'EFFET, pas l'état lu seul. Une bascule que le moteur
  // ignorerait (champ lumineux non recomposé) passerait au vert sur les deux assertions
  // ci-dessus sans que rien n'ait changé à l'écran.
  await expect.poll(dernierPng, 'éteindre la lampe change le masque de vision publié').not.toBe(pngAvant);
});

test('C-2 : l\'arbitrage à trois — le plus proche gagne, sans ordre de branche privilégié', async ({ page }) => {
  const sessionId = `light-arbitrage-${Date.now()}`;
  const level = createLevel({
    id: 'level-arbitrage',
    name: 'Arbitrage',
    pxPerCell: 100,
    widthCells: 20,
    heightCells: 20,
    ambient: { level: 1, baked: false },
    // Cas A (780, 750) : lampe à 10, porte à 15, pion à 20 — la lampe est la plus proche des
    // TROIS et doit l'emporter.
    lights: [
      { id: 'l-close', at: { cellX: 7.4, cellY: 7.0 }, range: 4, intensity: 1, color: '#ffffff', shadows: false, on: true },
      // Cas B (1000, 1000) : à portée d'un pion pile sous le doigt (dist 0) ET d'une lampe
      // dans sa tolérance (dist 15) — le pion doit gagner malgré la lampe candidate.
      { id: 'l-near-token', at: { cellX: 9.35, cellY: 9.5 }, range: 4, intensity: 1, color: '#ffffff', shadows: false, on: true },
    ],
    portals: [
      { id: 'door-far', a: { cellX: 7.65, cellY: 7 }, b: { cellX: 7.65, cellY: 8 }, state: 'closed', freestanding: false },
    ],
  });
  const tokenFar = createToken({ id: 'npc-far', levelId: 'level-arbitrage', cell: { a: 8, b: 7 }, kind: 'npc' });
  const tokenAtTap = createToken({ id: 'npc-under-tap', levelId: 'level-arbitrage', cell: { a: 10, b: 10 }, kind: 'npc' });
  await installBrowserTransport(page, sessionId, {
    campaign: createCampaign({ campaignId: 'c-arbitrage', levels: [level], tokens: [tokenFar, tokenAtTap] }),
    activeLevelId: 'level-arbitrage',
    selectedTokenId: null,
  });
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  // Cas A : (780, 750) — la lampe (dist 10) bat la porte (dist 15) et le pion (dist 20).
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 780, y: 750 },
      mapPos: { x: 780, y: 750 },
    });
  });

  const apresCasA = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const level = store.getCampaign()?.levels[0];
    return {
      lightOn: level?.lights.find((/** @type {any} */ l) => l.id === 'l-close')?.on,
      portalState: level?.portals[0].state,
      selectedTokenId: store.getState().selectedTokenId,
    };
  });
  expect(apresCasA.lightOn, 'la lampe la plus proche des trois est basculée').toBe(false);
  expect(apresCasA.portalState, 'la porte, plus loin, ne bouge pas').toBe('closed');
  expect(apresCasA.selectedTokenId, 'aucun pion n\'est sélectionné').toBeNull();

  // Cas B : (1000, 1000) — pile sur le pion `npc-under-tap` (dist 0), avec une lampe
  // `l-near-token` dans sa tolérance (dist 15). Le pion doit gagner.
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 1000, y: 1000 },
      mapPos: { x: 1000, y: 1000 },
    });
  });

  const apresCasB = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const level = store.getCampaign()?.levels[0];
    return {
      lightOn: level?.lights.find((/** @type {any} */ l) => l.id === 'l-near-token')?.on,
      selectedTokenId: store.getState().selectedTokenId,
    };
  });
  expect(apresCasB.selectedTokenId, 'le pion pile sous le doigt gagne').toBe('npc-under-tap');
  expect(apresCasB.lightOn, 'et la lampe voisine, plus loin, n\'est PAS basculée').toBe(true);
});

test('C-2 : poser crée la lampe exactement à la case tapée', async ({ page }) => {
  const sessionId = `light-place-${Date.now()}`;
  const level = createLevel({ id: 'level-place', name: 'Place', pxPerCell: 100, widthCells: 10, heightCells: 10 });
  await installBrowserTransport(page, sessionId, {
    campaign: createCampaign({ campaignId: 'c-place', levels: [level] }),
    activeLevelId: 'level-place',
    selectedTokenId: null,
  });
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.gmPanel.setActiveTool('light-place');
  });

  // Case tapée : (250, 250) → case (2, 2) (floor(250/100)).
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 250, y: 250 },
      mapPos: { x: 250, y: 250 },
    });
  });

  const apres = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const lights = store.getCampaign()?.levels[0].lights ?? [];
    return lights.map((/** @type {any} */ l) => ({ id: l.id, at: l.at, on: l.on, range: l.range, color: l.color }));
  });
  expect(apres.length, 'une seule lampe a été créée').toBe(1);
  // ⭐ Égalité avec la case VISÉE, pas seulement « différent de (0,0) ».
  expect(apres[0].at).toEqual({ cellX: 2, cellY: 2 });
  expect(apres[0].on, 'une lampe posée est allumée par défaut').toBe(true);

  const publie = await page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.find(
      (/** @type {any} */ e) => e.type === 'light.place'
    )
  );
  expect(publie?.payload?.levelId).toBe('level-place');
  expect(publie?.payload?.light?.at).toEqual({ cellX: 2, cellY: 2 });
});

test('C-2 : supprimer retire la lampe, et le rejeu converge sans lever', async ({ page }) => {
  const sessionId = `light-delete-${Date.now()}`;
  const level = createLevel({
    id: 'level-delete', name: 'Delete', pxPerCell: 100, widthCells: 10, heightCells: 10,
    lights: [{ id: 'l1', at: { cellX: 3, cellY: 3 }, range: 4, intensity: 1, color: '#ffffff', shadows: false, on: true }],
  });
  await installBrowserTransport(page, sessionId, {
    campaign: createCampaign({ campaignId: 'c-delete', levels: [level] }),
    activeLevelId: 'level-delete',
    selectedTokenId: null,
  });
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.gmPanel.setActiveTool('light-delete');
  });

  // Tap au centre de la case (3,3) → (350, 350).
  await page.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 350, y: 350 },
      mapPos: { x: 350, y: 350 },
    });
  });

  const apresSuppression = await page.evaluate(async () =>
    (await import('../js/state/store.js')).getCampaign()?.levels[0].lights.length
  );
  expect(apresSuppression, 'la lampe a été retirée, sans confirmation').toBe(0);

  const publie = await page.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.some(
      (/** @type {any} */ e) => e.type === 'light.delete' && e.payload.lightId === 'l1'
    )
  );
  expect(publie).toBe(true);

  // Rejeu : `store.removeLight` sur une lampe déjà absente converge — `false`, sans lever.
  const rejeu = await page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    try {
      return { ok: true, removed: store.removeLight('level-delete', 'l1') };
    } catch (e) {
      return { ok: false, message: /** @type {Error} */ (e).message };
    }
  });
  expect(rejeu).toEqual({ ok: true, removed: false });
});

test('C-2 : light.place sur une lampe éteinte qui existe déjà la laisse ÉTEINTE (un champ, un écrivain)', async ({ page }) => {
  const sessionId = `light-place-preserve-on-${Date.now()}`;
  await page.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(page);

  const onApresRepose = await page.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);
    const level = schema.createLevel(/** @type {any} */ ({
      id: 'level-preserve', name: 'Preserve', pxPerCell: 100, widthCells: 10, heightCells: 10,
      lights: [{ id: 'l1', at: { cellX: 1, cellY: 1 }, range: 4, intensity: 1, color: '#ffffff', shadows: false, on: true }],
    }));
    const campaign = schema.createCampaign({ levels: [level] });
    store.loadCampaign(campaign);

    // La lampe est éteinte par `light.toggle`...
    store.setLightState('level-preserve', 'l1', false);

    // ...puis « reposée » par `light.place`, au même identifiant, avec `on: true` dans les
    // données — comme le ferait un MJ qui tape à nouveau la même case avec l'outil « Poser ».
    store.placeLight('level-preserve', {
      id: 'l1', at: { cellX: 1, cellY: 1 }, range: 6, intensity: 1, color: '#ffdca8', shadows: true, on: true,
    });

    return store.getCampaign()?.levels[0].lights.find((/** @type {any} */ l) => l.id === 'l1')?.on;
  });

  expect(onApresRepose, 'light.place ne touche jamais `on` sur une lampe existante').toBe(false);
});

test('C-2 : les joueurs n\'ont aucun chemin vers la bascule — un tap sur une lampe ne publie rien et ne change rien', async ({ page }) => {
  const sessionId = `light-player-notouch-${Date.now()}`;
  const playerPage = page;
  await playerPage.goto(`/player.html?session=${sessionId}`);
  await waitForApp(playerPage);

  await playerPage.evaluate(async () => {
    const [store, schema] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/core/schema.js'),
    ]);
    const level = schema.createLevel(/** @type {any} */ ({
      id: 'level-player', name: 'Player', pxPerCell: 100, widthCells: 10, heightCells: 10,
      lights: [{ id: 'l1', at: { cellX: 5, cellY: 5 }, range: 4, intensity: 1, color: '#ffffff', shadows: false, on: true }],
    }));
    const campaign = schema.createCampaign({ levels: [level] });
    store.loadCampaign(campaign);
  });

  // Tap en plein sur le centre de la case de la lampe (5,5) → (550, 550), côté JOUEURS.
  await playerPage.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      screenPos: { x: 550, y: 550 },
      mapPos: { x: 550, y: 550 },
    });
  });

  const apres = await playerPage.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return {
      on: store.getCampaign()?.levels[0].lights[0].on,
      publieToggle: /** @type {any} */ (window).__RPG_TEST_WIRE__?.published?.some(
        (/** @type {any} */ e) => e.type === 'light.toggle'
      ) ?? false,
    };
  });
  expect(apres.on, 'la lampe reste allumée : les joueurs ne peuvent pas la basculer').toBe(true);
  expect(apres.publieToggle, 'aucun light.toggle ne part côté joueurs').toBe(false);
});
