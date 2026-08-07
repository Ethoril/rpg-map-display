// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Une horloge d'émetteur décalée ne doit pas geler l'affichage du récepteur.
 *
 * ⭐ **Cause réelle de la « grosse latence » signalée en séance le 7 août 2026**, trouvée par la
 * sonde de `docs/SONDE-LATENCE.md`. Elle a montré que le poste MJ encaissait et repeignait en
 * **23 ms** — donc ni le réseau ni le rendu — tandis que la colonne « réseau » sortait à
 * **−5311 ms**, c'est-à-dire une horloge de tablette **5,3 secondes en avance**.
 *
 * `tokens.js` calcule `elapsed = Math.max(0, now - move.startedAt)` avec le `now` du récepteur.
 * Tant que `startedAt` venait de l'émetteur, on soustrayait deux horloges différentes :
 *
 *  — émetteur en avance : `elapsed` reste à 0 pendant tout le décalage. Le pion demeure affiché
 *    à sa case de DÉPART, alors que le store a la bonne case depuis 23 ms. Une latence purement
 *    visuelle, qu'aucune mesure du réseau ni du store ne pouvait voir.
 *  — émetteur en retard : `elapsed` dépasse aussitôt la durée, le pion SAUTE à destination et
 *    l'animation est escamotée. C'est ce que le mainteneur percevait comme « instantané » dans
 *    l'autre sens.
 *
 * Le test pose les deux dérives, dans les deux sens, parce qu'un correctif qui ne traiterait que
 * l'avance laisserait l'escamotage en place — et que « ça a l'air instantané » est un symptôme,
 * pas une réussite.
 *
 * ⚠ **Portée exacte, mesurée par mutation.** En restaurant l'horodatage de l'émetteur, seul le cas
 * « en avance » rougit : le pion reste figé au départ. Le cas « en retard » **passe quand même**,
 * parce qu'un pion qui saute à destination y *arrive* bel et bien, et que ces constats vérifient
 * l'arrivée. L'escamotage de l'animation n'est donc pas gardé ici.
 *
 * Ce n'est pas un oubli : le prouver demanderait de constater une position intermédiaire dans une
 * fenêtre de quelques dizaines de millisecondes, soit un test à la milliseconde dont l'instabilité
 * coûterait plus cher que le défaut — purement visuel, et sans perte d'information à la table.
 * Le cas « en retard » reste conservé pour ce qu'il garde vraiment : qu'une dérive dans ce sens
 * n'empêche pas le pion d'arriver.
 */

const PX = 100;

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-horloge',
    name: 'Horloge',
    levels: [
      {
        id: 'rdc',
        name: 'RDC',
        order: 0,
        imageUrl: 'maps/minimal.webp',
        videoUrl: null,
        animatedOverlays: [],
        pxPerCell: PX,
        widthCells: 14,
        heightCells: 10,
        grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
        terrainCost: null,
        walls: [],
        portals: [],
        lights: [],
        ambient: { color: '#ffffff', level: 1, baked: false },
      },
    ],
    links: [],
    tokens: [
      {
        id: 'pj-1',
        levelId: 'rdc',
        cell: { a: 2, b: 4 },
        sizeCells: 1,
        kind: 'pc',
        imageUrl: '',
        borderColor: '#00ff00',
        label: 'PJ',
        hidden: false,
        visionBright: 10,
        visionDim: 14,
        emitsLight: null,
        speedCells: 30,
        playerMovable: true,
        locked: false,
        elevation: 0,
        markers: [],
        hp: null,
        health: 'unharmed',
      },
    ],
    templates: [],
    settings: { ambientLevel: 1 },
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Position RENDUE du pion, en cases — et non sa case dans le store.
 *
 * ⚠ C'est toute la question : le store a la bonne case dès l'arrivée de l'événement ; c'est
 * l'affichage qui reste en arrière. Interroger le store ne verrait donc rien du défaut.
 *
 * @param {import('@playwright/test').Page} page
 */
/**
 * @param {import('@playwright/test').Page} page
 * @param {number} a
 * @param {number} b
 */
const pionDessineSurLaCase = (page, a, b) =>
  page.evaluate(
    async ([ca, cb]) => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      if (typeof app.invalidate === 'function') app.invalidate();
      await new Promise((r) => requestAnimationFrame(r));
      const ctx = app.canvas.getContext('2d');
      const res = app.stage?.resolution ?? 1;
      // Le liseré du pion est un vert vif que rien d'autre ne porte dans cette scène.
      for (let dx = -0.45; dx <= 0.45; dx += 0.05) {
        for (let dy = -0.45; dy <= 0.45; dy += 0.05) {
          const e = app.camera.mapToScreen({ x: (ca + 0.5 + dx) * 100, y: (cb + 0.5 + dy) * 100 });
          const d = ctx.getImageData(Math.round(e.screenX * res), Math.round(e.screenY * res), 1, 1)
            .data;
          if (d[1] > 90 && d[1] - d[0] > 40 && d[1] - d[2] > 40) return true;
        }
      }
      return false;
    },
    [a, b]
  );

for (const cas of /** @type {const} */ ([
  { nom: 'en avance de 5,3 s (le cas mesuré en séance)', derive: 5311 },
  { nom: 'en retard de 5,3 s', derive: -5311 },
])) {
  test(`un émetteur dont l'horloge est ${cas.nom} n'empêche pas le pion d'arriver à l'écran`, async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const sessionId = `horloge-${cas.derive}-${Date.now()}`;
    /** @type {string[]} */
    const erreurs = [];

    const recepteur = await context.newPage();
    recepteur.on('pageerror', (e) => erreurs.push(e.message));
    await installBrowserTransport(recepteur, sessionId, SNAPSHOT);
    await recepteur.goto('/gm.html');
    await waitForApp(recepteur);

    const emetteur = await context.newPage();
    await installBrowserTransport(emetteur, sessionId, SNAPSHOT);
    await emetteur.goto('/player.html');
    await waitForApp(emetteur);

    // L'émetteur publie un déplacement daté avec une horloge décalée, comme la tablette du
    // mainteneur le faisait.
    await emetteur.evaluate(async (derive) => {
      const store = await import('../js/state/store.js');
      const chemin = [
        { a: 2, b: 4 },
        { a: 3, b: 4 },
        { a: 4, b: 4 },
      ];
      const date = Date.now() + derive;
      store.moveTokenToCell('pj-1', { a: 4, b: 4 }, {
        from: { a: 2, b: 4 }, to: { a: 4, b: 4 }, path: chemin, startedAt: Date.now(),
      });
      /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
        type: 'token.move',
        payload: {
          tokenId: 'pj-1',
          from: { a: 2, b: 4 },
          to: { a: 4, b: 4 },
          path: chemin,
          startedAt: date,
        },
        at: date,
        by: 'players',
      });
    }, cas.derive);

    // ⛔ Le pion doit être RENDU à sa case d'arrivée bien avant la dérive.
    //
    // Le trajet fait 2 pas, soit 320 ms d'animation. On laisse 2 secondes : largement de quoi
    // l'achever, et cinq fois moins que les 5,3 s de dérive. Avant correctif, l'émetteur en
    // avance laissait le pion figé à sa case de départ pendant toute la dérive — ce constat
    // échouait donc, et c'est exactement la latence ressentie à la table.
    await expect
      .poll(() => pionDessineSurLaCase(recepteur, 4, 4), { timeout: 2000, intervals: [100] })
      .toBe(true);

    // Et il n'est plus dessiné à sa case de départ : sans ce second constat, un pion qui serait
    // dessiné aux deux endroits — ou une sonde trop permissive — passerait pour un succès.
    expect(await pionDessineSurLaCase(recepteur, 2, 4)).toBe(false);

    expect(erreurs).toEqual([]);
    await context.close();
  });
}
