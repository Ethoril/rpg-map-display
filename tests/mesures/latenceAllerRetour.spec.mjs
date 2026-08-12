// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from '../browserTestTransport.mjs';

/**
 * MESURE — latence d'un déplacement dans les deux sens (hors porte de vérification).
 *
 * Symptôme rapporté en séance le 7 août 2026 : « quand je fais une action côté MJ, ça arrive
 * quasiment instantanément sur la tablette. Mais quand le joueur déplace son pion, il y a une
 * grosse latence dans la répercussion côté MJ ».
 *
 * ⚠ **Ce fichier ne corrige rien et n'affirme aucun seuil.** Il répond à une question et une
 * seule : *l'asymétrie est-elle réelle, et où passe le temps ?* Poser un seuil avant de savoir
 * ce qu'on mesure produirait un test qui rougit sans rien apprendre — et un correctif écrit sur
 * une intuition.
 *
 * Il vit dans `tests/manuel/` parce qu'une mesure de temps sur une machine partagée n'est pas une
 * garantie : elle dépend de la charge, et la faire rougir la porte apprendrait à ignorer la porte.
 *
 * Trois instants sont relevés pour chaque sens, parce que « c'est lent » peut vouloir dire trois
 * choses très différentes, qui se corrigent à trois endroits opposés :
 *
 *   t0 → t1  l'événement traverse le canal          (réseau / transport)
 *   t1 → t2  le poste applique la mutation au store (réducteur, validation, clones)
 *   t2 → t3  le poste redessine                     (rendu, vision, fog)
 */

const PX = 100;

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
});

/**
 * Une campagne de la taille de la vraie carte du mainteneur, murs compris : la latence dépend
 * directement du volume cloné et du coût du sweep, donc une campagne jouet ne mesurerait rien.
 *
 * @param {number} nbMurs
 */
function instantane(nbMurs) {
  /** @type {any[]} */
  const walls = [];
  for (let i = 0; i < nbMurs; i++) {
    const x = (i * 7) % 60;
    const y = (i * 13) % 66;
    walls.push([
      { cellX: x, cellY: y },
      { cellX: x + 1, cellY: y + 1 },
    ]);
  }
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: 'c-latence',
      name: 'Latence',
      levels: [
        {
          id: 'grande',
          name: 'Grande carte',
          order: 0,
          imageUrl: 'maps/minimal.webp',
          videoUrl: null,
          animatedOverlays: [],
          pxPerCell: PX,
          widthCells: 65,
          heightCells: 71,
          grid: {
            type: 'square',
            offsetX: 0,
            offsetY: 0,
            color: '#000000',
            opacity: 0.25,
            visible: true,
          },
          terrainCost: null,
          walls,
          portals: [],
          lights: [],
          ambient: { color: '#ffffff', level: 1, baked: false },
        },
      ],
      links: [],
      tokens: [pion('pj-1', 'grande', 10, 10), pion('pj-2', 'grande', 12, 10)],
      templates: [],
      settings: {},
    },
    activeLevelId: 'grande',
    selectedTokenId: null,
    activeHandout: null,
  };
}

/**
 * Instrumente une page : horodate la réception d'un `token.move`, l'application au store, et la
 * première frame rendue après.
 *
 * @param {import('@playwright/test').Page} page
 */
async function instrumenter(page) {
  await page.evaluate(async () => {
    const store = await import('../../js/state/store.js');
    const app = /** @type {any} */ (window).__RPG_APP__;
    const mesures = /** @type {any} */ (window);
    mesures.__LAT__ = { recu: 0, applique: 0, rendu: 0, cellAttendue: null };

    // t1 — l'événement arrive sur ce poste.
    //
    // ⚠ **L'ordre d'abonnement décide de ce qu'on mesure, et une première version s'est trompée
    // ici.** `subscribe` ajoute à la fin : mon écouteur passait donc APRÈS celui de l'application,
    // et l'horodatage « reçu » était pris une fois le poste ayant déjà tout appliqué. La sonde
    // rapportait alors 613 ms de « canal → application » qui n'étaient rien de tel.
    //
    // On réinsère donc l'écouteur de mesure EN TÊTE, avant ceux de l'application.
    const transport = /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport;
    const anciens = [...transport.listeners];
    transport.listeners.clear();
    transport.listeners.add((/** @type {any} */ e) => {
      if (e?.type === 'token.move') mesures.__LAT__.recu = performance.now();
    });
    for (const l of anciens) transport.listeners.add(l);

    // t2 — la mutation est visible dans le store.
    store.subscribe(() => {
      const l = mesures.__LAT__;
      if (!l.recu || l.applique) return;
      const t = store.getCampaign()?.tokens.find((/** @type {any} */ x) => x.id === l.tokenId);
      if (t && l.cellAttendue && t.cell.a === l.cellAttendue.a && t.cell.b === l.cellAttendue.b) {
        l.applique = performance.now();
        // t3 — la première frame qui suit l'application.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            l.rendu = performance.now();
          });
        });
      }
    });
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 * @param {{a: number, b: number}} cellAttendue
 */
const armer = (page, tokenId, cellAttendue) =>
  page.evaluate(
    ([id, cell]) => {
      const l = /** @type {any} */ (window).__LAT__;
      l.recu = 0;
      l.applique = 0;
      l.rendu = 0;
      l.tokenId = id;
      l.cellAttendue = cell;
    },
    [tokenId, cellAttendue]
  );

/** @param {import('@playwright/test').Page} page */
const releve = (page) => page.evaluate(() => /** @type {any} */ (window).__LAT__);

test('MESURE — latence d\'un déplacement, joueur → MJ contre MJ → joueur', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `latence-${Date.now()}`;
  const snap = instantane(1338);

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, snap);
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, snap);
  await mj.goto('/gm.html');
  await waitForApp(mj);

  await joueur.waitForTimeout(1500);
  await instrumenter(joueur);
  await instrumenter(mj);

  /** @type {Record<string, any>} */
  const resultats = {};

  // ── Sens 1 : le joueur déplace, le MJ encaisse ────────────────────────────────────────
  // ⚠ Les deux sens sont pilotés **de la même façon** : mutation locale puis publication, sans
  // passer par le geste. Le tap ajouterait le calcul de trajet du poste émetteur, qui n'a rien à
  // voir avec ce qu'on compare — et une première version, pilotée au tap, n'a rien mesuré du tout
  // parce que la case visée était injoignable derrière les murs de synthèse.
  await armer(mj, 'pj-1', { a: 14, b: 10 });
  const t0Joueur = await joueur.evaluate(async () => {
    const store = await import('../../js/state/store.js');
    const t = performance.now();
    store.moveTokenToCell('pj-1', { a: 14, b: 10 }, null);
    /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
      type: 'token.move',
      payload: { tokenId: 'pj-1', from: { a: 10, b: 10 }, to: { a: 14, b: 10 }, path: [] },
      at: Date.now(),
      by: 'players',
    });
    return t;
  });
  await expect.poll(async () => (await releve(mj)).rendu > 0, { timeout: 15000 }).toBe(true);
  resultats.joueurVersMj = await releve(mj);
  resultats.joueurVersMj.t0 = t0Joueur;

  // ── Sens 2 : le MJ déplace, le joueur encaisse ────────────────────────────────────────
  await armer(joueur, 'pj-2', { a: 16, b: 10 });
  await mj.evaluate(async () => {
    const store = await import('../../js/state/store.js');
    store.moveTokenToCell('pj-2', { a: 16, b: 10 }, null);
    /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
      type: 'token.move',
      payload: { tokenId: 'pj-2', from: { a: 12, b: 10 }, to: { a: 16, b: 10 }, path: [] },
      at: Date.now(),
      by: 'gm',
    });
  });
  await expect.poll(async () => (await releve(joueur)).rendu > 0, { timeout: 15000 }).toBe(true);
  resultats.mjVersJoueur = await releve(joueur);

  /** @param {string} nom @param {any} r */
  const ligne = (nom, r) =>
    `${nom.padEnd(18)} canal→application ${(r.applique - r.recu).toFixed(1).padStart(7)} ms   ` +
    `application→rendu ${(r.rendu - r.applique).toFixed(1).padStart(7)} ms   ` +
    `total encaissé ${(r.rendu - r.recu).toFixed(1).padStart(7)} ms`;

  console.log('\n===== LATENCE MESURÉE (65×71 cases, 1338 murs) =====');
  console.log(ligne('joueur → MJ', resultats.joueurVersMj));
  console.log(ligne('MJ → joueur', resultats.mjVersJoueur));
  console.log('====================================================\n');

  // Aucun seuil : ce fichier mesure, il ne juge pas. Le seul échec possible est de n'avoir
  // rien pu mesurer.
  expect(resultats.joueurVersMj.rendu).toBeGreaterThan(0);
  expect(resultats.mjVersJoueur.rendu).toBeGreaterThan(0);

  await context.close();
});

/**
 * MESURE — où partent les 600 ms ? On compte les clones profonds du store.
 *
 * `getCampaign()` et `getState()` font chacun `structuredClone` + `deepFreeze` de toute la
 * campagne. Mesuré hors navigateur sur la vraie grande carte : **3,64 ms par appel**. Reste à
 * savoir combien d'appels un seul déplacement provoque — c'est ce nombre, et lui seul, qui dit
 * si le clonage est le sujet ou une goutte d'eau.
 */
test('MESURE — nombre et coût des clones profonds pendant un déplacement', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `clones-${Date.now()}`;
  const snap = instantane(1338);

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, snap);
  await mj.goto('/gm.html');
  await waitForApp(mj);
  await mj.waitForTimeout(1500);

  const releveClones = await mj.evaluate(async () => {
    const store = await import('../../js/state/store.js');
    /** @type {any} */ (window).__CLONES__ = { getState: 0, getCampaign: 0, ms: 0 };
    const c = /** @type {any} */ (window).__CLONES__;

    // On enveloppe les deux accesseurs pour les compter et les chronométrer. Ils sont exportés
    // en lecture seule : on passe donc par le module lui-même, dont les liaisons sont mutables
    // via un objet intermédiaire — d'où la mesure par échantillonnage ci-dessous à défaut.
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) store.getState();
    const coutGetState = (performance.now() - t0) / 30;

    const t1 = performance.now();
    for (let i = 0; i < 30; i++) store.getCampaign();
    const coutGetCampaign = (performance.now() - t1) / 30;

    // Coût d'un déplacement complet, du point de vue du fil principal.
    const t2 = performance.now();
    store.moveTokenToCell('pj-1', { a: 14, b: 10 }, null);
    const coutMutation = performance.now() - t2;

    return { coutGetState, coutGetCampaign, coutMutation };
  });

  console.log('\n===== COÛT DES ACCESSEURS (65×71, 1338 murs) =====');
  console.log(`getState()    : ${releveClones.coutGetState.toFixed(2)} ms par appel`);
  console.log(`getCampaign() : ${releveClones.coutGetCampaign.toFixed(2)} ms par appel`);
  console.log(
    `une mutation complète (moveTokenToCell + tous les abonnés) : ${releveClones.coutMutation.toFixed(1)} ms`
  );
  console.log('==================================================\n');

  expect(releveClones.coutMutation).toBeGreaterThan(0);
  await context.close();
});
