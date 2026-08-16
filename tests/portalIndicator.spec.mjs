// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

const LEVEL = {
  id: 'rdc-level',
  name: 'RDC',
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 140,
  widthCells: 10,
  heightCells: 8,
  grid: {
    type: /** @type {import('../js/core/types.js').GridType} */ ('square'),
    offsetX: 0,
    offsetY: 0,
    color: '#000000',
    opacity: 0.25,
    visible: false,
  },
  terrainCost: null,
  walls: [],
  portals: [
    { id: 'p-closed', a: { cellX: 2, cellY: 1 }, b: { cellX: 3, cellY: 1 }, state: 'closed', freestanding: false },
    { id: 'p-locked', a: { cellX: 2, cellY: 2 }, b: { cellX: 3, cellY: 2 }, state: 'locked', freestanding: false },
    { id: 'p-open', a: { cellX: 2, cellY: 4 }, b: { cellX: 3, cellY: 4 }, state: 'open', freestanding: false },
  ],
  lights: [],
  ambient: { color: '#ffffff', level: 1, baked: false },
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'portal-ind',
    name: 'Indicateurs',
    levels: [LEVEL],
    links: [],
    tokens: [],
    templates: [],
    settings: {},
  },
  activeLevelId: 'rdc-level',
  selectedTokenId: null,
};

/**
 * Mesure l'encre des indicateurs de porte à un zoom donné, en pixels d'écran.
 *
 * Le fog doit être révélé d'abord : l'indicateur se dessine SOUS lui, et une sonde posée sur
 * une zone non explorée ne mesure que du noir — puis conclut que rien n'est dessiné. C'est
 * l'erreur qu'a faite la première version de cette mesure.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} zoom
 */
function mesurer(page, zoom) {
  return page.evaluate(async (z) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    app.camera.setZoom(z);
    // `setPan` place le CENTRE de la caméra sur la carte : on la centre donc entre les deux
    // portes, à mi-hauteur de (2·140) et (4·140). La première version calculait un pan
    // « à peu près bon » multiplié par le zoom — une confusion d'espace — et ne tombait juste
    // que par chance, sur un canvas de la largeur du poste de développement. Sur le runner
    // Linux, dont le panneau MJ n'a pas la même largeur, l'échantillon tombait hors du canvas
    // et `getImageData` rendait du noir transparent : épaisseur mesurée **0**, sans un mot.
    app.camera.setPan(2.5 * 140, 3 * 140);
    await new Promise((resolve) => {
      const listener = () => {
        app.frameLoop.removeListener(listener);
        resolve(null);
      };
      app.frameLoop.addListener(listener);
      app.frameLoop.requestFrame();
    });
    const res = app.stage?.resolution ?? 1;
    /** @typedef {(d: Uint8ClampedArray, i: number) => boolean} TestCouleur */
    /** @type {TestCouleur} */
    const rouge = (d, i) => d[i] > 140 && d[i + 1] < 110 && d[i + 2] < 110;
    /** @type {TestCouleur} */
    const vert = (d, i) => d[i + 1] > 130 && d[i] < 120 && d[i + 2] < 120;

    // Épaisseur d'un trait PLEIN : une colonne d'un pixel le traversant, à l'écart du cadenas.
    /** @param {number} mapY @param {TestCouleur} test */
    const epaisseur = (mapY, test) => {
      const p = app.camera.mapToScreen({ x: 2.15 * 140, y: mapY });
      const col = app.context.getImageData(
        Math.round(p.screenX * res),
        Math.round((p.screenY - 14) * res),
        1,
        Math.round(28 * res)
      ).data;
      let n = 0;
      for (let i = 0; i < col.length; i += 4) if (test(col, i)) n++;
      return n / res;
    };

    // Un trait DISCONTINU ne se mesure pas en colonne : une colonne d'un pixel tombe une fois
    // sur deux dans un creux du pointillé, et rend zéro sur un trait parfaitement dessiné. On
    // mesure donc l'encre sur toute la longueur de la porte, ramenée à cette longueur — ce qui
    // reste comparable d'un zoom à l'autre puisque c'est un rapport.
    /** @param {number} mapY @param {TestCouleur} test */
    const encreParPxDeSegment = (mapY, test) => {
      const a = app.camera.mapToScreen({ x: 2 * 140, y: mapY });
      const b = app.camera.mapToScreen({ x: 3 * 140, y: mapY });
      const longueur = Math.max(1, Math.hypot(b.screenX - a.screenX, b.screenY - a.screenY));
      const d = app.context.getImageData(
        Math.round(a.screenX * res),
        Math.round((a.screenY - 6) * res),
        Math.round(longueur * res),
        Math.round(12 * res)
      ).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (test(d, i)) n++;
      return n / (res * res) / longueur;
    };

    /** @param {number} mapX @param {number} mapY @param {number} cote */
    const boite = (mapX, mapY, cote) => {
      const p = app.camera.mapToScreen({ x: mapX, y: mapY });
      const d = app.context.getImageData(
        Math.round((p.screenX - cote / 2) * res),
        Math.round((p.screenY - cote / 2) * res),
        Math.round(cote * res),
        Math.round(cote * res)
      ).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (rouge(d, i)) n++;
      return n / (res * res);
    };

    // PRÉCONDITIONS, rendues avec la mesure et non supposées. Une sonde qui échantillonne hors
    // du canvas, ou une carte restée sous la brume, rendent zéro — c'est-à-dire exactement ce
    // qu'un indicateur absent rendrait. Sans ces champs, l'échec est muet et se lit comme une
    // régression du rendu (`debugging_lessons` : « une sonde fausse ferme la question »).
    const marge = 30;
    /** @param {number} mapX @param {number} mapY */
    const dansLeCanvas = (mapX, mapY) => {
      const p = app.camera.mapToScreen({ x: mapX, y: mapY });
      return (
        p.screenX > marge &&
        p.screenY > marge &&
        p.screenX < app.canvas.width / res - marge &&
        p.screenY < app.canvas.height / res - marge
      );
    };
    // Clarté d'une zone SANS indicateur : si la brume n'a pas été levée, elle est quasi nulle.
    //
    // Échantillonnée **au centre de la caméra**, donc toujours dans le canvas quel que soit son
    // format — et le canvas ne fait pas la largeur de la fenêtre, le panneau MJ en prend 360 px
    // sur 900. Un point choisi « loin des portes » en coordonnées carte, comme dans la première
    // version, sortait du cadre à zoom 1 et rendait 0 : la précondition destinée à démasquer les
    // sondes aveugles en était une.
    const fond = (() => {
      const p = app.camera.mapToScreen({ x: 2.5 * 140, y: 3 * 140 });
      const d = app.context.getImageData(
        Math.round(p.screenX * res),
        Math.round(p.screenY * res),
        Math.round(6 * res),
        Math.round(6 * res)
      ).data;
      let somme = 0;
      for (let i = 0; i < d.length; i += 4) somme += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return somme / (d.length / 4);
    })();

    return {
      zoomEffectif: app.camera.zoom,
      canvas: `${app.canvas.width}x${app.canvas.height}@${res}`,
      portesDansLeCanvas:
        dansLeCanvas(2.15 * 140, 1 * 140) &&
        dansLeCanvas(2.15 * 140, 2 * 140) &&
        dansLeCanvas(2.15 * 140, 4 * 140),
      clarteDuFond: fond,
      epaisseurVerrouillee: epaisseur(2 * 140, rouge),
      encreOuverte: encreParPxDeSegment(4 * 140, vert),
      // La porte FERMÉE, mesurée exactement comme l'ouverte : même sonde, même unité, seule la
      // couleur change. C'est ce qui rend les deux valeurs comparables entre elles.
      encreFermee: encreParPxDeSegment(1 * 140, rouge),
      // Le cadenas : l'encre au centre du segment, moins celle d'une portion nue de même taille.
      cadenas: boite(2.5 * 140, 2 * 140, 11) - boite(2.15 * 140, 2 * 140, 11),
    };
  }, zoom);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} session
 */
async function prepare(page, session) {
  await installBrowserTransport(page, session, SNAPSHOT);
  await page.goto(`/gm.html?session=${session}`);
  await waitForApp(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.click('.gm-tab-btn[data-tab="fog-tools"]');
  await page.click('#fog-btn-reveal-all');
  // Les indicateurs de porte se dessinent SOUS le fog : sans révélation, tout ce qui suit
  // mesurerait du noir. La preuve que le geste a porté est prise dans le DOM — la pile d'undo
  // passe à un pas — et non aux pixels : un seuil de clarté sur une carte de test serait un
  // pari sur la pile de rendu du runner, exactement ce qui a fait rougir ce fichier en CI.
  await expect(page.locator('#fog-btn-undo')).toHaveText(/Annuler \((?!0\))\d+\)/);
}

test.describe('Indicateurs de porte — grandeurs d\'écran, pas de carte', () => {
  test('Le verrou et la porte ouverte gardent leur épaisseur à tous les zooms', async ({ context }) => {
    const page = await context.newPage();
    await prepare(page, `portal-ind-${Date.now()}`);

    const zoomUn = await mesurer(page, 1);
    // 0,238 est la vue « carte entière » de la Tab S9 FE : 33 px par case pour pxPerCell 140.
    const vueTable = await mesurer(page, 0.238);

    // Les préconditions AVANT les mesures, et avec leur contexte dans le message : sur le runner
    // GitHub, la première version de ce test a échoué avec « épaisseur 0 » sans dire pourquoi,
    // ce qui a coûté un aller-retour complet de déploiement.
    /** @type {[string, Awaited<ReturnType<typeof mesurer>>][]} */
    const mesures = [
      ['zoom 1', zoomUn],
      ['vue table', vueTable],
    ];
    for (const [nom, m] of mesures) {
      const contexte = `${nom} — zoom ${m.zoomEffectif}, canvas ${m.canvas}`;
      expect(m.portesDansLeCanvas, `${contexte} : les portes sont hors du canvas, la sonde échantillonne du vide`).toBe(true);
      // Bar volontairement bas : cette garde n'existe que pour distinguer « le canvas est noir »
      // de « l'indicateur manque ». La preuve que la brume est levée est prise dans le DOM par
      // `prepare`, pas ici — un seuil de clarté serré serait le pari qu'on cherche à éviter.
      expect(m.clarteDuFond, `${contexte} : le canvas est noir à cet endroit, rien n'y est dessiné`).toBeGreaterThan(8);
      expect(Math.abs(m.zoomEffectif - (nom === 'zoom 1' ? 1 : 0.238)), `${contexte} : le zoom demandé n'a pas été appliqué`).toBeLessThan(0.01);
    }

    // Avant correctif, mesuré : épaisseur 4 px à zoom 1 mais **1 px** à 0,238 ; cadenas 16 px
    // d'encre puis **2 px** ; pointillé vert 96 px puis **aucun** pixel saturé. C'est cet
    // effondrement que ce test interdit.
    //
    // Les seuils sont volontairement placés loin sous les valeurs mesurées après correctif
    // (4–5 px, 0,90–1,00 et 9–11) et loin au-dessus de celles d'avant. Un seuil serré sur une
    // mesure d'antialiasing serait un flake en attente : la pile de rendu du runner Linux n'est
    // pas celle du poste de développement, et ce dépôt s'est déjà fait piéger par un échec
    // Linux-only sur des métriques de police (`DIAGNOSTIC-GESTE-GABARITS.md`). Ce qui compte
    // ici est l'ordre de grandeur, pas la décimale.
    expect(zoomUn.epaisseurVerrouillee).toBeGreaterThanOrEqual(3);
    expect(vueTable.epaisseurVerrouillee).toBeGreaterThanOrEqual(3);
    expect(zoomUn.encreOuverte).toBeGreaterThanOrEqual(0.5);
    expect(vueTable.encreOuverte).toBeGreaterThanOrEqual(0.5);
    // La porte fermée ne dessinait **rien** : mesuré 0 exactement, aux deux zooms. Elle se
    // confondait donc avec le décor, et c'est ce qu'a signalé le mainteneur après la séance du
    // 16 août 2026. Le seuil est celui du vert, puisque c'est la même géométrie.
    expect(zoomUn.encreFermee).toBeGreaterThanOrEqual(0.5);
    expect(vueTable.encreFermee).toBeGreaterThanOrEqual(0.5);
    expect(zoomUn.cadenas).toBeGreaterThanOrEqual(5);
    expect(vueTable.cadenas).toBeGreaterThanOrEqual(5);

    // Et les grandeurs ne dérivent pas d'un zoom à l'autre : ce sont bien des pixels d'écran.
    expect(Math.abs(vueTable.epaisseurVerrouillee - zoomUn.epaisseurVerrouillee)).toBeLessThanOrEqual(1);
    expect(vueTable.encreOuverte).toBeGreaterThan(zoomUn.encreOuverte * 0.5);
  });

  test('Un tap sur une porte verrouillée la signale, sans changer son état', async ({ context }) => {
    const page = await context.newPage();
    await prepare(page, `portal-flash-${Date.now()}`);

    const avant = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      app.camera.setZoom(1);
      app.camera.setPan(1.5 * 140, 1 * 140);
      // Attendre une frame à cette caméra AVANT de relever la ligne de base. Sans cela, on
      // échantillonne aux coordonnées du nouveau zoom une image peinte à l'ancien : la ligne
      // de base tombe à zéro, et la fine bordure blanche du cadenas — bien présente — se
      // retrouve comptée comme un reste de battement à la fin du test.
      await new Promise((resolve) => {
        const listener = () => {
          app.frameLoop.removeListener(listener);
          resolve(null);
        };
        app.frameLoop.addListener(listener);
        app.frameLoop.requestFrame();
      });
      const p = app.camera.mapToScreen({ x: 2.5 * 140, y: 2 * 140 });
      const rect = app.canvas.getBoundingClientRect();
      return {
        etat: store.getActiveLevel()?.portals?.find((x) => x.id === 'p-locked')?.state,
        x: p.screenX + rect.left,
        y: p.screenY + rect.top,
      };
    });
    expect(avant.etat).toBe('locked');

    // Clarté MOYENNE du voisinage du cadenas, et non un comptage de pixels au-dessus d'un
    // seuil. Deux raisons, la seconde ayant coûté trois tours :
    //
    // 1. le halo est tracé à `globalAlpha` décroissant et lissé sur deux pixels : son pixel le
    //    plus clair culmine à 187, donc tout seuil placé plus haut ne voit rien ;
    // 2. surtout, **la brume MJ voile l'indicateur** — les portes se dessinent sous le fog, et
    //    sur un étage sans pion aucune case n'est « actuellement visible », donc tout le
    //    voisinage est assombri. Un comptage par seuil devient alors une mesure du voile.
    //    Une moyenne, elle, monte dès que de la lumière est ajoutée, quel que soit le voile.
    const clarte = () =>
      page.evaluate(async () => {
        const app = /** @type {any} */ (window).__RPG_APP__;
        const p = app.camera.mapToScreen({ x: 2.5 * 140, y: 2 * 140 });
        const res = app.stage?.resolution ?? 1;
        const cote = 44;
        const d = app.context.getImageData(
          Math.round((p.screenX - cote / 2) * res),
          Math.round((p.screenY - cote / 2) * res),
          Math.round(cote * res),
          Math.round(cote * res)
        ).data;
        let somme = 0;
        for (let i = 0; i < d.length; i += 4) somme += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return somme / (d.length / 4);
      });

    const frames = () =>
      page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.frameLoop.frameCount);

    const avantTap = await clarte();
    const framesAvant = await frames();
    await page.mouse.click(avant.x, avant.y);

    // Deux mesures pour deux choses distinctes, parce qu'aucune ne suffit seule.
    //
    // 1. De l'encre claire apparaît. Le seuil est bas volontairement : le halo s'élargit et
    //    s'efface en 600 ms, et un `page.evaluate` coûte assez de millisecondes pour que
    //    l'échantillon tombe n'importe où dans cette fenêtre. Exiger un écart précis rendrait
    //    le test intermittent — ce qu'on ne veut pas d'un test de rendu.
    await expect.poll(clarte, { timeout: 400 }).toBeGreaterThan(avantTap + 2);
    // …et il ne change rien : une porte verrouillée reste verrouillée.
    const apres = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel()?.portals?.find((x) => x.id === 'p-locked')?.state;
    });
    expect(apres).toBe('locked');

    // 2. La boucle s'est réellement animée, puis s'est arrêtée. Compté après la fenêtre des
    //    600 ms, donc sans dépendre de l'instant où l'échantillon d'encre est tombé.
    //
    //    C'est cette mesure qui a trouvé un vrai défaut, et l'encre seule ne l'aurait pas vu :
    //    la couche des pions écrasait le drapeau `animationActive` par affectation au lieu de
    //    l'accumuler, alors qu'elle se dessine APRÈS les portes. La boucle s'arrêtait après une
    //    frame et le battement restait figé à l'écran — un halo figé étant même plus visible
    //    qu'un halo correct, un seuil d'encre l'aurait déclaré réussi.
    await page.waitForTimeout(900);
    expect(await frames()).toBeGreaterThan(framesAvant + 4);
    expect(await clarte()).toBeLessThanOrEqual(avantTap + 0.5);

    // Et rien ne tourne derrière : le rendu est à la demande, une animation qui ne s'arrête
    // jamais vide la batterie de la tablette en silence.
    const framesEteint = await frames();
    await page.waitForTimeout(300);
    expect(await frames()).toBe(framesEteint);
  });
});
