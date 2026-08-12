// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Un pion créé par le MJ arrive-t-il chez les joueurs ?
 *
 * ⭐ **Ce chemin n'était couvert par aucun test**, et c'est celui que le mainteneur signale cassé
 * le 7 août 2026 : « quand le MJ fait un nouveau pion, il ne s'affiche plus côté joueur ».
 * `tokenMaker.spec.mjs` éprouve la génération et le téléchargement, jamais la propagation ;
 * `tokenLibrary.spec.mjs` éprouve la propagation depuis la **bibliothèque**, qui est un autre
 * chemin. Le générateur du panneau MJ n'avait donc rien qui garde son arrivée à la table.
 *
 * Le test porte sur les deux moitiés, parce qu'un pion peut manquer pour deux raisons très
 * différentes et qu'il faut savoir laquelle :
 *
 *  1. il n'arrive pas dans les **données** du joueur — défaut de réseau ou de réducteur ;
 *  2. il y est mais n'est pas **dessiné** — défaut de rendu, la châsse par exemple.
 */

const NIVEAU = {
  id: 'rdc',
  name: 'Rez-de-chaussée',
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
  ambient: { color: '#ffffff', level: 1, baked: false },
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-propagation',
    name: 'Propagation',
    levels: [NIVEAU],
    links: [],
    tokens: [],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Les pions présents dans les données d'une page.
 * @param {import('@playwright/test').Page} page
 */
const pions = (page) =>
  page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return (store.getCampaign()?.tokens ?? []).map(
      (/** @type {any} */ t) => `${t.id}:${t.kind}:${t.levelId}:${t.hidden}`
    );
  });

/**
 * Le pion est-il réellement DESSINÉ sur le canvas de cette page ?
 *
 * ⚠ Mesuré et non déduit : un pion présent dans les données mais absent de l'écran est le
 * symptôme d'un défaut de rendu, pas de réseau, et les deux se corrigent à des endroits opposés.
 * On échantillonne le centre de sa case et on compare au même pixel avant sa création.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} a
 * @param {number} b
 */
const pixelCase = (page, a, b) =>
  page.evaluate(
    async ([ca, cb]) => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      if (typeof app.invalidate === 'function') app.invalidate();
      await new Promise((r) => requestAnimationFrame(r));
      const store = await import('../js/state/store.js');
      const niveau = store.getActiveLevel();
      const px = niveau?.pxPerCell ?? 100;
      const centre = { x: (ca + 0.5) * px, y: (cb + 0.5) * px };
      const ecran = app.camera.mapToScreen(centre);
      const res = app.stage?.resolution ?? 1;
      const ctx = app.canvas.getContext('2d');
      const d = ctx.getImageData(
        Math.round(ecran.screenX * res),
        Math.round(ecran.screenY * res),
        1,
        1
      ).data;
      return `${d[0]},${d[1]},${d[2]},${d[3]}`;
    },
    [a, b]
  );

/**
 * ⭐ **Le PJ et le PNJ ne doivent PAS se comporter pareil, et c'est tout l'enjeu.**
 *
 * `fogLayer.updateVision` ne retient que les pions `kind === 'pc'` dotés de vision : **seuls les
 * PJ éclairent**. Un PNJ posé là où aucun PJ n'a jamais vu reste donc derrière le voile
 * non-exploré, opaque à 100 % dans la vue joueurs — c'est la garantie de L-04 §7, celle qui
 * masque **mécaniquement** un PNJ embusqué, et non un défaut à réparer.
 *
 * Le tableau ci-dessous dit donc, pour chaque cas, ce qui doit arriver à l'écran. Un test qui
 * exigerait la visibilité du PNJ dans les deux cas ferait « corriger » la seule chose qui protège
 * l'embuscade.
 */
const CAS = /** @type {const} */ ([
  {
    genre: 'pc',
    // Un PJ éclaire sa propre case : il se voit lui-même.
    avecEclaireur: false,
    dessine: true,
    quoi: 'un PJ créé par le MJ s\'affiche chez les joueurs — il porte sa propre vision',
  },
  {
    genre: 'npc',
    // Aucun PJ sur l'étage : la case n'a jamais été vue, le voile est opaque.
    avecEclaireur: false,
    dessine: false,
    quoi: '⛔ un PNJ posé en zone jamais vue reste INVISIBLE aux joueurs (garantie L-04 §7)',
  },
  {
    genre: 'npc',
    // Un PJ voisin éclaire la case : le PNJ apparaît.
    avecEclaireur: true,
    dessine: true,
    quoi: 'un PNJ posé dans le champ de vision d\'un PJ s\'affiche bien',
  },
]);

for (const cas of CAS) {
  const genre = cas.genre;
  test(cas.quoi, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const sessionId = `propagation-${genre}-${cas.avecEclaireur ? 'eclaire' : 'noir'}-${Date.now()}`;
    /** @type {string[]} */
    const erreurs = [];

    // L'éclaireur est un PJ posté à côté de la case visée : c'est lui qui la rend visible.
    const snapshot = /** @type {any} */ (structuredClone(SNAPSHOT));
    if (cas.avecEclaireur) {
      snapshot.campaign.tokens = [
        {
          id: 'eclaireur',
          levelId: 'rdc',
          cell: { a: 4, b: 4 },
          sizeCells: 1,
          kind: 'pc',
          imageUrl: '',
          borderColor: '#00ff00',
          label: 'Éclaireur',
          hidden: false,
          visionBright: 8,
          visionDim: 12,
          emitsLight: null,
          speedCells: 30,
          playerMovable: true,
          locked: false,
          elevation: 0,
          markers: [],
          hp: null,
          health: 'unharmed',
        },
      ];
    }

    const joueur = await context.newPage();
    joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
    await installBrowserTransport(joueur, sessionId, snapshot);
    await joueur.goto('/player.html');
    await waitForApp(joueur);

    const mj = await context.newPage();
    mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
    await installBrowserTransport(mj, sessionId, snapshot);
    await mj.goto('/gm.html');
    await waitForApp(mj);

    const pionsInitiaux = await pions(joueur);
    const avant = await pixelCase(joueur, 5, 4);

    // Le MJ crée un pion par le chemin réel du panneau : `store.addToken` puis `token.add`.
    const id = `pion-${genre}`;
    await mj.evaluate(
      async ([tokenId, kind]) => {
        const [store, schema] = await Promise.all([
          import('../js/state/store.js'),
          import('../js/core/schema.js'),
        ]);
        const token = schema.createToken({
          id: tokenId,
          levelId: 'rdc',
          cell: { a: 5, b: 4 },
          kind: /** @type {any} */ (kind),
          label: tokenId,
          imageUrl: '',
          borderColor: '#ff00ff',
        });
        store.addToken(token);
        /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
          type: 'token.add',
          payload: { token },
          at: Date.now(),
          by: 'gm',
        });
      },
      [id, genre]
    );

    // 1. Le pion arrive TOUJOURS dans les données du joueur — le réseau ne filtre rien. Ce qui
    //    varie est ce qu'on en montre, et c'est le fog qui en décide.
    await expect
      .poll(() => pions(joueur), { timeout: 8000 })
      .toEqual([...pionsInitiaux, `${id}:${genre}:rdc:false`]);

    // 2. À l'écran, en revanche, tout dépend de ce que les PJ voient.
    if (cas.dessine) {
      await expect.poll(() => pixelCase(joueur, 5, 4), { timeout: 8000 }).not.toBe(avant);
    } else {
      await joueur.waitForTimeout(1200);
      expect(await pixelCase(joueur, 5, 4)).toBe(avant);
      // Et le voile est bien l'opacité pleine : c'est LUI qui masque, pas un pion mal dessiné.
      expect(await pixelCase(joueur, 5, 4)).toBe('0,0,0,255');
    }

    expect(erreurs).toEqual([]);
    await context.close();
  });
}

/**
 * ⛔ Un étage sans vision publiée ne montre AUCUN pion à la table.
 *
 * ⚠ Sans ce garde-fou, l'absence de masque **ouvre** la porte au lieu de la fermer : le filtre de
 * visibilité de `tokens.js` ne s'applique que si un masque existe. C'est aujourd'hui une fenêtre
 * de quelques centaines de millisecondes au démarrage — mais elle devient permanente avec le
 * sélecteur d'étage joueurs du lot 3, où la table pourra regarder un étage **sans PJ**, donc sans
 * vision calculée par le MJ.
 *
 * Elle y verrait alors tous les PNJ qui l'y attendent. L'arbitrage du mainteneur, le 7 août 2026,
 * est explicite : sur un tel étage on montre « le dernier état connu, le fog tel qu'il était, et
 * aucune zone de vision directe ». Un pion est une information vive ; il n'a pas sa place dans un
 * souvenir.
 */
test('⛔ un étage sans vision publiée n\'affiche aucun pion côté joueurs', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `sans-vision-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  const snapshot = /** @type {any} */ (structuredClone(SNAPSHOT));
  // Un PNJ bien visible, posé sur la carte. Aucun PJ : le MJ ne publiera donc jamais de vision
  // pour cet étage, exactement comme un étage que la table va « regarder pour réfléchir ».
  snapshot.campaign.tokens = [
    {
      id: 'pnj-embusque',
      levelId: 'rdc',
      cell: { a: 5, b: 4 },
      sizeCells: 1,
      kind: 'npc',
      imageUrl: '',
      borderColor: '#ff00ff',
      label: 'Embuscade',
      hidden: false,
      visionBright: 0,
      visionDim: 0,
      emitsLight: null,
      speedCells: 6,
      playerMovable: false,
      locked: false,
      elevation: 0,
      markers: [],
      hp: null,
      health: 'unharmed',
    },
  ];

  const joueur = await context.newPage();
  joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
  await installBrowserTransport(joueur, sessionId, snapshot);
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  // ⚠ L'étage est EXPLORÉ, et c'est tout l'enjeu. Une première version de ce test laissait la
  // zone jamais vue : le voile y est OPAQUE, il recouvrait le pion, et le constat passait sans
  // rien prouver — la mutation qui retirait le garde-fou restait verte. Sur une zone explorée le
  // voile n'est qu'à 50 %, et un pion dessiné transparaît. C'est le vrai cas du sélecteur : un
  // étage que la table a déjà visité, qu'elle regarde pour réfléchir, et où aucun PJ ne se trouve.
  await joueur.evaluate(async () => {
    const [store, { ExploredFog }] = await Promise.all([
      import('../js/state/store.js'),
      import('../js/vision/fog.js'),
    ]);
    const fog = new ExploredFog(12, 10);
    fog.revealAll();
    store.setSessionFog('rdc', await fog.exportPng());
  });
  await joueur.waitForTimeout(1200);

  const visionPubliee = await joueur.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getSessionVision('rdc');
  });
  expect(visionPubliee, 'la référence du test : aucune vision publiée').toBeNull();

  // Le pion est bien dans les données — le réseau ne filtre rien — mais il ne doit PAS être dessiné.
  expect(await pions(joueur)).toEqual(['pnj-embusque:npc:rdc:false']);

  // On cherche le liseré MAGENTA du PNJ, que rien d'autre ne porte dans cette scène — et non
  // une couleur de fond, qui varierait avec le voile.
  const magentaVisible = await joueur.evaluate(async () => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    if (typeof app.invalidate === 'function') app.invalidate();
    await new Promise((r) => requestAnimationFrame(r));
    const ctx = app.canvas.getContext('2d');
    const res = app.stage?.resolution ?? 1;
    for (let dx = -0.45; dx <= 0.45; dx += 0.05) {
      for (let dy = -0.45; dy <= 0.45; dy += 0.05) {
        const e = app.camera.mapToScreen({ x: (5 + 0.5 + dx) * 100, y: (4 + 0.5 + dy) * 100 });
        const d = ctx.getImageData(Math.round(e.screenX * res), Math.round(e.screenY * res), 1, 1)
          .data;
        if (d[0] > 60 && d[2] > 60 && d[0] - d[1] > 30 && d[2] - d[1] > 30) return true;
      }
    }
    return false;
  });

  expect(
    magentaVisible,
    'un PNJ ne doit pas transparaître sur un étage exploré dont aucune vision n est publiée'
  ).toBe(false);

  expect(erreurs).toEqual([]);
  await context.close();
});
