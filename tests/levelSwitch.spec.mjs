// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Lot 3, S-02 — la bascule d'étage traverse le réseau.
 *
 * Elle ne le faisait pas : `level.add` et `level.grid` existaient depuis le lot 1a, mais changer
 * l'étage actif restait **purement local**. La tablette n'apprenait l'étage qu'au démarrage, par
 * l'instantané. Le MJ montait à l'étage, la table restait au rez-de-chaussée, et rien ne le
 * signalait.
 *
 * ⚠ Le second constat est le plus important, et c'est celui que le brief annonçait comme risqué :
 * arriver sur un étage **sans masque de vision** serait le défaut du 6 août au matin revenu par une
 * autre porte — la tablette afficherait « exploré mais non visible » partout sur le nouvel étage.
 */

/** @param {string} id @param {string} nom */
const niveau = (id, nom) => ({
  id,
  name: nom,
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: 12,
  heightCells: 10,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
});

/** @param {string} id @param {string} levelId @param {number} a @param {number} b */
const pion = (id, levelId, a, b) => ({
  id,
  levelId,
  cell: { a, b },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: id,
  hidden: false,
  visionBright: 6,
  visionDim: 8,
  emitsLight: null,
  speedCells: 30,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
  hp: null,
  health: 'unharmed',
});

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-etages',
    name: 'Deux étages',
    levels: [niveau('rdc', 'Rez-de-chaussée'), niveau('etage', 'Premier étage')],
    links: [],
    tokens: [pion('pj-rdc', 'rdc', 2, 2), pion('pj-etage', 'etage', 5, 5)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>}
 */
const etageActif = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getActiveLevelId();
  });

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @returns {Promise<boolean>}
 */
const aLaVision = (page, levelId) =>
  page.evaluate(async (id) => {
    const store = await import('../js/state/store.js');
    return typeof store.getSessionVision(id) === 'string';
  }, levelId);

/**
 * UX-10 — le MJ change d'étage, et la table NE LE SUIT PLUS.
 *
 * ⚠ **Ce test s'appelait « la tablette suit » jusqu'au 18/08/2026.** C'était le couplage exact
 * qu'UX-10 coupe : il n'y avait qu'un seul `activeLevelId`, et le MJ ne pouvait pas aller
 * vérifier une carte ou préparer la suite sans y emmener les six personnes qui le regardent.
 *
 * Ce qui reste vrai, et que le test continue de vérifier : la tablette **reçoit** la vision du
 * nouvel étage. C'est même ce qui rend le découplage utilisable — le jour où la table décide d'y
 * aller, l'étage est déjà connu d'elle.
 */
test("UX-10 : le MJ change d'étage, la tablette ne bouge pas mais reçoit la vision du nouvel étage", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `etages-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  const joueur = await context.newPage();
  joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  const mj = await context.newPage();
  mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto('/gm.html');
  await waitForApp(mj);

  // Référence : les deux postes sont au rez-de-chaussée, et la tablette en a la vision.
  expect(await etageActif(joueur)).toBe('rdc');
  await expect.poll(() => aLaVision(joueur, 'rdc'), { timeout: 8000 }).toBe(true);

  // La barre d'étage n'apparaît que s'il y a plusieurs étages — c'est le cas ici.
  await expect(mj.locator('#gm-level-bar')).toBeVisible();

  // Le MJ monte à l'étage, par le vrai geste : la liste déroulante.
  await mj.selectOption('#gm-level-select', 'etage');
  await expect.poll(() => etageActif(mj), { timeout: 8000 }).toBe('etage');

  // 1. ⭐ La tablette NE SUIT PAS. C'est le critère 1 d'UX-10.
  await joueur.waitForTimeout(1200);
  expect(await etageActif(joueur), 'la table ne doit pas être emmenée par le MJ').toBe('rdc');

  // 2. ⚠ Et pourtant elle reçoit la vision du NOUVEL étage : le découplage porte sur ce qu'on
  //    AFFICHE, pas sur ce qu'on reçoit. Sans cela, l'étage serait noir le jour où la table y va.
  await expect.poll(() => aLaVision(joueur, 'etage'), { timeout: 8000 }).toBe(true);

  // 3. Le masque du rez-de-chaussée n'est pas écrasé par celui de l'étage : chaque étage garde le
  //    sien, ce que le critère 3 exige et que S-01 vérifie côté store.
  expect(await aLaVision(joueur, 'rdc')).toBe(true);

  expect(erreurs).toEqual([]);
  await context.close();
});

/**
 * Lot 3, S-03 et S-04 — franchir une liaison, et le cadenas.
 *
 * Le typedef `Link` existait depuis le lot 1a et `createCampaign` initialisait `links` à `[]` :
 * le modèle était conçu, **jamais câblé**. Rien ne le lisait, rien ne le fabriquait.
 *
 * ⚠ Le geste est en **deux temps** — se poster sur l'escalier, puis retaper sa case. Un
 * franchissement en un seul tap ferait changer d'étage chaque fois qu'on vise l'escalier pour s'y
 * poster, et la table verrait l'autre étage sans l'avoir demandé.
 */

/** Une campagne à deux étages avec un escalier, et un PJ posté dessus. */
const SNAPSHOT_LIAISON = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-liaison',
    name: 'Escalier',
    levels: [niveau('rdc', 'Rez-de-chaussée'), niveau('etage', 'Premier étage')],
    links: [
      {
        id: 'escalier-1',
        kind: 'stairs',
        label: 'Escalier principal',
        a: { levelId: 'rdc', at: { cellX: 3, cellY: 3 } },
        b: { levelId: 'etage', at: { cellX: 7, cellY: 6 } },
        bidirectional: true,
        gmOnly: false,
      },
    ],
    // Le PJ est déjà sur la case de l'escalier : le test porte sur le franchissement, pas sur
    // le déplacement qui y mène, déjà couvert ailleurs.
    tokens: [pion('pj-1', 'rdc', 3, 3)],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Fait taper le joueur sur la case d'un pion, comme un vrai geste.
 * @param {import('@playwright/test').Page} page
 * @param {number} a
 * @param {number} b
 * @param {number} pxPerCell
 */
const taper = (page, a, b, pxPerCell) =>
  page.evaluate(
    ([ca, cb, px]) => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
        type: 'tap',
        mapPos: { x: (ca + 0.5) * px, y: (cb + 0.5) * px },
        screenPos: { x: 0, y: 0 },
      });
    },
    [a, b, pxPerCell]
  );

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 */
const etageDuPion = (page, tokenId) =>
  page.evaluate(async (id) => {
    const store = await import('../js/state/store.js');
    const t = store.getCampaign()?.tokens.find((/** @type {any} */ x) => x.id === id);
    return t ? `${t.levelId}:${t.cell.a},${t.cell.b}` : null;
  }, tokenId);

/**
 * UX-10 — le franchissement ne fait plus basculer AUCUN écran.
 *
 * ⚠ **Ce test testait l'inverse jusqu'au 18/08/2026**, et il le testait dans les deux sens :
 * une variante « la vue suit » et une variante « le cadenas suspend le suivi ». Les deux
 * décrivaient un couplage qui n'existe plus, et le cadenas 🔒 a disparu avec lui.
 *
 * La raison est celle qui gouverne toute la vague : **rien ne se déplace dans le dos de
 * personne**. Elle mord plus fort ici qu'ailleurs, parce que la vue joueurs est **une seule
 * tablette partagée** : suivre le pion qui monte emmenait toute la table et abandonnait les
 * personnages restés en bas.
 */
test("UX-10 : franchir l'escalier téléporte le pion, et ne déplace ni l'écran du MJ ni celui de la table", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `liaison-decouplee-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  const joueur = await context.newPage();
  joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
  await installBrowserTransport(joueur, sessionId, SNAPSHOT_LIAISON);
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  const mj = await context.newPage();
  mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  await installBrowserTransport(mj, sessionId, SNAPSHOT_LIAISON);
  await mj.goto('/gm.html');
  await waitForApp(mj);

  // Le joueur sélectionne son pion, puis retape sa case pour prendre l'escalier.
  await taper(joueur, 3, 3, 100);
  await taper(joueur, 3, 3, 100);

  // 1. Le pion a bien changé d'étage ET de case, sur les deux postes : le franchissement
  //    lui-même est inchangé, c'est une mutation de l'état de jeu que tous appliquent.
  await expect.poll(() => etageDuPion(joueur, 'pj-1'), { timeout: 8000 }).toBe('etage:7,6');
  await expect.poll(() => etageDuPion(mj, 'pj-1'), { timeout: 8000 }).toBe('etage:7,6');

  // 2. ⭐ Aucune des deux vues ne bouge. Le pion monté cesse simplement d'apparaître sur
  //    l'étage affiché — c'est vrai, et c'est lisible.
  await joueur.waitForTimeout(1200);
  expect(await etageActif(mj), 'le MJ ne doit pas suivre le pion qui monte').toBe('rdc');
  expect(await etageActif(joueur), 'la table ne doit pas être emmenée').toBe('rdc');

  // 3. Rien de nouveau ne transite, et surtout aucun `level.select` : la bascule ne s'est pas
  //    contentée de ne pas s'afficher, elle n'a pas été publiée. Vérifié sur ce qui est
  //    RÉELLEMENT parti sur le canal, pas seulement sur l'état final.
  const publies = await mj.evaluate(() =>
    /** @type {any} */ (window).__RPG_TEST_WIRE__.published.map((/** @type {any} */ e) => e.type)
  );
  expect(
    publies,
    "aucun level.select ne doit partir d'un franchissement"
  ).not.toContain('level.select');

  expect(erreurs).toEqual([]);
  await context.close();
});

/**
 * UX-10 critère 3 — l'étage affiché côté joueurs survit à un rechargement.
 *
 * ⚠ **C'est la moitié qui se perd le plus facilement.** Le découplage peut tenir toute la séance
 * et se défaire au premier F5 : l'instantané servi par le transport porte l'étage du MJ, et sans
 * mémoire locale la tablette y retomberait — exactement le couplage qu'on vient de couper.
 */
/**
 * UX-15 — le MJ EMMÈNE la table sur un étage, par un geste explicite.
 *
 * ⚠ En deux temps, et le premier temps n'est pas un détail : il rejoue exactement le test
 * UX-10 ci-dessus (la barre du MJ ne fait QUE le regarder, elle) pour montrer que le bouton
 * est un geste supplémentaire, pas un couplage restauré. Sans ce premier temps, on ne
 * distinguerait pas « le bouton fonctionne » de « le sélecteur a recommencé à emmener la
 * table », qui est exactement la régression qu'UX-10 avait corrigée.
 */
const SNAPSHOT_SHOW = structuredClone(SNAPSHOT);
SNAPSHOT_SHOW.campaign.campaignId = 'c-show';
SNAPSHOT_SHOW.campaign.levels[0].imageUrl = 'maps/rdc-show.webp';
SNAPSHOT_SHOW.campaign.levels[1].imageUrl = 'maps/etage-show.webp';

/** @param {import('@playwright/test').Page} page */
const etageEtImage = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    const level = store.getActiveLevel();
    return { activeLevelId: store.getActiveLevelId(), imageUrl: level?.imageUrl ?? null };
  });

test('UX-15 : le MJ change sa propre barre sans emmener la table, puis l’y emmène d’un clic', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `ux15-show-${Date.now()}`;

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT_SHOW);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT_SHOW);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  expect(await etageEtImage(joueur)).toMatchObject({
    activeLevelId: 'rdc',
    imageUrl: 'maps/rdc-show.webp',
  });

  // 1. Le MJ change SA barre. C'est UX-10 : la table ne bouge pas.
  await mj.selectOption('#gm-level-select', 'etage');
  await expect.poll(() => etageEtImage(mj)).toMatchObject({ activeLevelId: 'etage' });

  await joueur.waitForTimeout(1200);
  expect(
    await etageEtImage(joueur),
    'le simple changement de barre du MJ ne doit rien emmener'
  ).toMatchObject({ activeLevelId: 'rdc', imageUrl: 'maps/rdc-show.webp' });

  // 2. Le MJ clique le bouton : la table est cette fois EMMENÉE sur l'étage affiché du MJ.
  await mj.click('#gm-level-show');
  await expect
    .poll(() => etageEtImage(joueur), { timeout: 8000 })
    .toMatchObject({ activeLevelId: 'etage', imageUrl: 'maps/etage-show.webp' });

  // Et la vue MJ, elle, n'a pas bougé du geste qui emmène la table.
  expect(await etageEtImage(mj)).toMatchObject({ activeLevelId: 'etage' });

  await context.close();
});

/**
 * UX-15 — le cas qui motive tout : emmener la table sur un étage SANS brouillard révélé.
 *
 * Une carte fraîchement chargée, ou un étage que personne n'a jamais visité, n'a aucun masque
 * exploré : avant ce geste, la table n'avait aucun moyen d'y aller (UX-12 l'exclut du
 * sélecteur), et le MJ aucun moyen de l'y emmener (UX-10 a coupé la bascule automatique).
 */
test('UX-15 : emmener la table sur un étage sans brouillard révélé — elle l’affiche, et il figure dans sa barre', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `ux15-nofog-${Date.now()}`;

  // Un troisième étage, vierge de tout pion : aucune vision n'y a jamais été calculée, donc
  // aucun masque exploré n'existe pour lui avant le geste.
  const snapshot = structuredClone(SNAPSHOT_SHOW);
  snapshot.campaign.campaignId = 'c-show-nofog';
  const grenier = structuredClone(snapshot.campaign.levels[1]);
  grenier.id = 'grenier';
  grenier.name = 'Grenier';
  grenier.imageUrl = 'maps/grenier.webp';
  snapshot.campaign.levels.push(grenier);

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, snapshot);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, snapshot);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  // Précondition : aucun masque n'existe pour le grenier avant le geste.
  expect(
    await mj.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('grenier'))
  ).toBeNull();

  await mj.selectOption('#gm-level-select', 'grenier');
  await mj.click('#gm-level-show');

  // La table affiche le grenier…
  await expect.poll(() => etageEtImage(joueur), { timeout: 8000 }).toMatchObject({
    activeLevelId: 'grenier',
  });

  // …et il figure dans sa barre, alors même qu'aucun pion n'y a jamais vu quoi que ce soit :
  // c'est l'exception « étage AFFICHÉ », pas un étage devenu « connu ».
  await expect
    .poll(() =>
      joueur.evaluate(() =>
        [...document.querySelectorAll('#player-level-tabs .player-level-tab')].map(
          (b) => /** @type {HTMLElement} */ (b).dataset.levelId
        )
      )
    )
    .toContain('grenier');

  await context.close();
});

test('UX-10 : après un F5, la tablette retrouve SON étage, pas celui du MJ', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `f5-etage-${Date.now()}`;

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  // La table va voir l'étage — le geste que lui donnera le sélecteur d'UX-12.
  await joueur.evaluate(async () => {
    const store = await import('../js/state/store.js');
    store.selectLevel('etage');
  });
  await expect.poll(() => etageActif(joueur), { timeout: 8000 }).toBe('etage');

  // ⚠ L'instantané servi au rechargement porte `activeLevelId: 'rdc'`, celui du MJ : c'est
  // exactement ce contre quoi la mémoire locale protège.
  await joueur.reload();
  await waitForApp(joueur);

  await expect
    .poll(() => etageActif(joueur), { timeout: 8000 })
    .toBe('etage');

  await context.close();
});

/**
 * Défaut rapporté en séance, localisé le 09/09/2026 dans `syncVision` (`js/app/gm.js`) : elle
 * ne calculait la vision que pour l'étage actif du MJ. Un PJ qui franchissait une liaison
 * changeait bien d'étage, et cet étage devenait « connu » — le bloc `link.traverse` publiait
 * son masque EXPLORÉ — mais son masque VISIBLE, celui que `tokens.js` exige pour peindre un
 * pion côté joueurs, n'était jamais publié tant que le MJ n'allait pas lui-même sur cet étage.
 * La table voyait l'étage proposé dans son sélecteur, et rien dessus.
 *
 * ⚠ On asserte ici sur ce que la vue JOUEURS peut lire — le masque visible reçu et le pion
 * effectivement peint à l'écran — jamais sur un drapeau interne du MJ.
 */

/**
 * Luminosité moyenne autour d'un point carte, côté joueurs — le pion sur son fond peint
 * l'élève nettement, le fog noir opaque la laisse proche de zéro. Même idiome que la sonde de
 * `multiLevelJourney.spec.mjs` (« la table voit réellement le pion »).
 * @param {import('@playwright/test').Page} page
 * @param {number} mapX @param {number} mapY
 */
const luminositeAutourDe = (page, mapX, mapY) =>
  page.evaluate(
    ([x, y]) => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      const p = app.camera.mapToScreen({ x, y });
      const res = app.stage?.resolution ?? 1;
      const d = app.context.getImageData(
        Math.round((p.screenX - 8) * res),
        Math.round((p.screenY - 8) * res),
        Math.round(16 * res),
        Math.round(16 * res)
      ).data;
      let somme = 0;
      for (let i = 0; i < d.length; i += 4) somme += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return somme / (d.length / 4);
    },
    [mapX, mapY]
  );

test('syncVision — un PJ franchit une liaison, le MJ ne touche à rien, la table voit son pion sur l’étage d’arrivée', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `syncvision-defaut-${Date.now()}`;

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT_LIAISON);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT_LIAISON);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  await expect.poll(() => aLaVision(joueur, 'rdc'), { timeout: 8000 }).toBe(true);

  // Le joueur seul franchit l'escalier — deux taps sur sa propre case.
  await taper(joueur, 3, 3, 100);
  await taper(joueur, 3, 3, 100);
  await expect.poll(() => etageDuPion(joueur, 'pj-1'), { timeout: 8000 }).toBe('etage:7,6');

  // ⭐ Le MJ n'a rien fait : il regarde toujours le rez-de-chaussée.
  expect(await etageActif(mj)).toBe('rdc');

  // 1. Le masque VISIBLE de l'étage d'arrivée — pas seulement l'exploré — est publié.
  await expect.poll(() => aLaVision(joueur, 'etage'), { timeout: 8000 }).toBe(true);

  // 2. La table va voir cet étage, geste purement local (UX-12) : le pion doit s'y dessiner.
  await joueur.evaluate(async () => {
    (await import('../js/state/store.js')).selectLevel('etage');
  });
  await expect.poll(() => etageActif(joueur), { timeout: 8000 }).toBe('etage');
  await expect
    .poll(() => luminositeAutourDe(joueur, 750, 650), { timeout: 8000 })
    .toBeGreaterThan(20);

  await context.close();
});

/**
 * Défaut miroir, trouvé le 09/09/2026 en relisant le correctif ci-dessus qui a ajouté les deux
 * tests précédents : `syncVision` entre dans sa boucle tout étage qui porte au moins un PJ, plus
 * l'étage actif du MJ — mais un étage qui vient de PERDRE son dernier PJ n'y entrait plus.
 * Sa vision publiée n'était donc plus jamais recalculée : la tablette gardait le dernier masque
 * visible, celui que le PJ parti voyait, et un PNJ qui entrerait ensuite dans ce cône figé
 * s'afficherait à la table alors que plus personne n'y regarde.
 *
 * ⚠ On asserte sur ce que la vue JOUEURS peut lire — le masque visible reçu pour l'étage vidé —
 * jamais sur un drapeau interne du MJ. Le décodage réutilise `decodeFogPng` /
 * `getOrExtractMaskAlpha`, les mêmes fonctions que `player.js` : un masque vide, c'est un canal
 * alpha entièrement à zéro.
 */

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @param {number} widthCells @param {number} heightCells
 * @returns {Promise<boolean|null>} `null` si rien n'a encore été publié pour cet étage
 */
const masqueVisibleVide = (page, levelId, widthCells, heightCells) =>
  page.evaluate(
    async ([id, w, h]) => {
      const store = await import('../js/state/store.js');
      const fog = await import('../js/vision/fog.js');
      const png = store.getSessionVision(/** @type {string} */ (id));
      if (!png) return null;
      const canvas = await fog.decodeFogPng(
        png,
        /** @type {number} */ (w),
        /** @type {number} */ (h)
      );
      const alpha = fog.getOrExtractMaskAlpha(
        canvas,
        /** @type {number} */ (w),
        /** @type {number} */ (h)
      );
      return alpha ? [...alpha].every((a) => a === 0) : null;
    },
    [levelId, widthCells, heightCells]
  );

test('syncVision — le dernier PJ quitte un étage : son masque visible publié devient VIDE', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `syncvision-vide-${Date.now()}`;

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT_LIAISON);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT_LIAISON);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  // La table regarde le rez-de-chaussée (défaut), et le PJ y est seul, posté sur l'escalier :
  // son masque visible y est non vide.
  await expect.poll(() => aLaVision(joueur, 'rdc'), { timeout: 8000 }).toBe(true);
  await expect
    .poll(() => masqueVisibleVide(joueur, 'rdc', 12, 10), { timeout: 8000 })
    .toBe(false);

  // ⭐ Le MJ s'en va ailleurs : il ne rend plus le rez-de-chaussée à son propre écran, et ce
  // sera bientôt un étage sans aucun PJ — les deux conditions qui, avant ce correctif, sortaient
  // un étage de la boucle de `syncVision`.
  await mj.selectOption('#gm-level-select', 'etage');
  await expect.poll(() => etageActif(mj), { timeout: 8000 }).toBe('etage');

  // Le PJ, seul sur le rez-de-chaussée, franchit l'escalier vers l'étage — deux taps sur sa
  // propre case, comme dans les tests ci-dessus.
  await taper(joueur, 3, 3, 100);
  await taper(joueur, 3, 3, 100);
  await expect.poll(() => etageDuPion(joueur, 'pj-1'), { timeout: 8000 }).toBe('etage:7,6');

  // Le rez-de-chaussée n'a plus aucun PJ, et le MJ n'y est pas : sans le correctif, son masque
  // visible reste celui d'avant le franchissement, non vide.
  await expect
    .poll(() => masqueVisibleVide(joueur, 'rdc', 12, 10), { timeout: 8000 })
    .toBe(true);

  await context.close();
});

test('groupe séparé — un PJ bouge sur un étage que le MJ ne regarde pas : sa vision se publie et se met à jour', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `groupe-separe-${Date.now()}`;

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  // Le MJ reste au rez-de-chaussée toute la scène : personne ne va vérifier l'étage.
  expect(await etageActif(mj)).toBe('rdc');

  // ⭐ Dès le démarrage, l'étage porte un PJ (`pj-etage`) : sa vision doit déjà être connue,
  // MJ ou pas MJ dessus. Preuve qu'un étage entre dans la boucle par PJ, pas par MJ actif.
  await expect.poll(() => aLaVision(joueur, 'etage'), { timeout: 8000 }).toBe(true);

  // Combien de `vision.update` l'étage a déjà reçus (le tout premier, à l'ouverture de
  // session). Compté côté MJ : c'est lui qui les publie. Le mouvement à suivre en compte au
  // moins un de plus — la garde par étage n'empêche que les republications SANS changement.
  const visionsEtage = () =>
    mj.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter(
        (/** @type {any} */ e) => e.type === 'vision.update' && e.payload.levelId === 'etage'
      ).length
    );
  const avant = await visionsEtage();

  // Le joueur consulte SEUL l'étage — choix local, ne publie rien (UX-10/12).
  await joueur.evaluate(async () => {
    (await import('../js/state/store.js')).selectLevel('etage');
  });
  await expect.poll(() => etageActif(joueur), { timeout: 8000 }).toBe('etage');

  // Il déplace son PJ, posté là-haut, d'une case : sélection puis destination.
  await taper(joueur, 5, 5, 100);
  await taper(joueur, 6, 5, 100);
  await expect.poll(() => etageDuPion(joueur, 'pj-etage'), { timeout: 8000 }).toBe('etage:6,5');

  // Le MJ n'a pas bougé : la scène exacte du groupe séparé.
  expect(await etageActif(mj)).toBe('rdc');

  // Et pourtant la vision de l'étage se REPUBLIE, mise à jour par le mouvement du PJ — la
  // signature qui commande la publication porte la case du pion, changée par ce mouvement,
  // même si le résultat composé se trouve être visuellement identique dans cette pièce ouverte.
  await expect.poll(visionsEtage, { timeout: 8000 }).toBeGreaterThan(avant);

  await context.close();
});

/**
 * ⭐ LE test qui manquait à la relecture du correctif ci-dessus : au repos, rien n'est
 * republié. Un PJ posté sur un étage que le MJ ne regarde pas suffisait, avant ce correctif,
 * à faire tourner `syncVisionForLevel` sur cet étage à chaque mutation du store — et
 * `fogLayer.invalidate()`, en fin de passe non active, effaçait la garde de l'instance
 * PARTAGÉE : au tour suivant, `updateVision` ne reconnaissait plus rien, republiait, ce qui
 * mutait le store, qui rappelait `syncVision`. Un masque d'environ 13 Kio par seconde,
 * indéfiniment, partie à l'arrêt.
 *
 * ⚠ Sans l'attente franche ci-dessous, ce test ne prouve rien : le cycle défectueux tourne
 * au throttle de `scheduleFogPublish`, 1 Hz — il faut laisser passer au moins un cycle
 * entier pour le voir, ou ne pas le voir.
 */
test("au repos, un PJ sur un étage non regardé par le MJ : rien n'est republié", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `au-repos-${Date.now()}`;

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  // Le MJ reste au rez-de-chaussée ; `pj-etage` est posté sur l'étage depuis le snapshot
  // initial — c'est la précondition exacte qui déclenchait le rebouclage.
  expect(await etageActif(mj)).toBe('rdc');
  await expect.poll(() => aLaVision(joueur, 'etage'), { timeout: 8000 }).toBe(true);

  const evenementsFog = () =>
    mj.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published.filter(
        (/** @type {any} */ e) => e.type === 'fog.update' || e.type === 'vision.update'
      ).length
    );

  // Laisser la première salve de publications se stabiliser avant de compter.
  await mj.waitForTimeout(1200);
  const avant = await evenementsFog();

  // La scène est laissée tranquille : aucune interaction, ni côté MJ ni côté table. Au moins
  // 2,5 s, franchement au-delà du cycle de republication défectueux (throttlé à 1 Hz).
  await mj.waitForTimeout(2500);

  expect(await evenementsFog(), 'aucune publication au repos').toBe(avant);

  await context.close();
});
