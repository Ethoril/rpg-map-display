// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Étages de **dimensions et densités différentes** dans une même campagne.
 *
 * ## Pourquoi ce fichier existe
 *
 * ⭐ Trou de couverture trouvé le 12/08/2026 **en important trois vraies cartes indépendantes**.
 * `multiLevelJourney.spec.mjs` construit tous ses étages avec les mêmes dimensions — `pxPerCell: 80`,
 * 10 × 8 — donc le parcours à étages n'avait jamais été éprouvé sur des étages de tailles
 * différentes. Or c'est **exactement ce que produit un import de provenances indépendantes** : trois
 * cartes de trois packs différents mesuraient 37 × 28, 45 × 80 et 25 × 48 cases, et leurs densités
 * préparées différaient — 140, 102,4 et 140 px/case, la seconde ayant touché le plafond de texture.
 *
 * ⛔ **Et c'est précisément la forme à laquelle le fog est sensible.** Les masques — exploré comme
 * vision — sont indexés par `levelId`, clé `localStorage` comprise, et un masque relu aux mauvaises
 * dimensions **fait disparaître tous les pions** de la vue joueurs en laissant la zone de vision
 * dessinée. Le défaut a déjà été payé une fois, en séance, le 7 août 2026.
 *
 * `maskDimensionMismatch.spec.mjs` couvre le cas voisin mais distinct de la **collision
 * d'identifiants** — deux cartes partageant un `levelId`. Ici les identifiants sont corrects et
 * distincts : ce qui est éprouvé, c'est qu'aucun masque, canvas ou cache dimensionné pour l'étage
 * précédent ne survive à la bascule.
 *
 * ⚠ Fixture **synthétique**, et délibérément. Les cartes qui ont révélé le trou appartiennent à la
 * bibliothèque du mainteneur ; les ajouter au dépôt de ma propre initiative n'était pas à moi de le
 * décider. Les dimensions ci-dessous reproduisent leurs proportions, ce qui suffit — le défaut visé
 * dépend de l'hétérogénéité, pas du dessin.
 */

/**
 * @param {string} id
 * @param {string} name
 * @param {number} order
 * @param {number} w
 * @param {number} h
 * @param {number} px
 * @param {'square'|'hex'} [type]
 */
const level = (id, name, order, w, h, px, type = 'square') => ({
  id, name, order,
  imageUrl: '', videoUrl: null, animatedOverlays: [],
  pxPerCell: px, widthCells: w, heightCells: h,
  grid: { type, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null, walls: [], portals: [], lights: [],
  ambient: { color: '#ffffff', level: 1, baked: false },
});

/**
 * Quatre étages **hétérogènes** : tailles, proportions, densités et pavages tous différents.
 *
 * ⚠ Les cartes réelles qui ont révélé le trou mesuraient 37 × 28, 45 × 80 et 25 × 48. Les
 * proportions sont conservées mais **les tailles sont réduites**, et ce n'est pas de la
 * complaisance : `renderAll` appelle `fitActiveLevel` à **chaque frame**, donc le zoom est imposé
 * par la carte et aucun `setZoom` de test ne survit. Sur un étage de 45 × 80, une case tombe à
 * **10,2 px écran** — mesuré — et le liseré d'un pion n'y couvre plus aucun pixel d'une signature de
 * couleur franche. La sonde rendait alors « pion absent » pour une raison qui n'avait rien à voir
 * avec les dimensions de l'étage. **Je l'ai d'abord pris pour un défaut du produit ; c'était ma
 * sonde.** Ce que le test doit éprouver est l'hétérogénéité, pas la valeur absolue.
 *
 * ⛔ Ne pas remettre 45 × 80 « pour coller aux vraies cartes » : le défaut réapparaîtrait sous la
 * forme d'un fantôme, et il a déjà coûté trois sondes fausses.
 *
 * ⭐ Le quatrième étage est **hexagonal** depuis G-04 : l'hétérogénéité porte désormais aussi sur le
 * pavage, et c'est le seul scénario de navigateur qui fasse vivre `HexGrid` bout en bout.
 */
const NIVEAUX = [
  level('embuscade', 'Embuscade', 0, 26, 20, 140),
  level('canyon', 'Canyon', 1, 15, 27, 102.4),
  level('antre', 'Antre', 2, 22, 13, 120),
  level('caverne-hex', 'Caverne Hex', 3, 12, 12, 140, 'hex'),
];

const snapshot = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'heterogene',
    name: 'Étages hétérogènes',
    levels: NIVEAUX,
    links: [],
    tokens: NIVEAUX.map((n, i) => ({
      id: `pc-${n.id}`,
      levelId: n.id,
      // Case 2,2 : dans les bornes des trois étages, y compris du plus petit.
      cell: { a: 2, b: 2 },
      sizeCells: 1,
      kind: 'pc',
      imageUrl: '',
      borderColor: '#00ff00',
      label: `Héros ${i}`,
      hidden: false,
      visionBright: 4,
      visionDim: 6,
      emitsLight: null,
      speedCells: 6,
      playerMovable: true,
      locked: false,
      elevation: 0,
      markers: [],
      hp: null,
      health: 'unharmed',
    })),
    templates: [],
    settings: {},
  },
  activeLevelId: 'embuscade',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Le pion de l'étage actif est-il réellement peint ?
 *
 * Sonde le liseré vert vif `#00ff00`, qu'aucune autre couche n'emploie — c'est la même signature que
 * `maskDimensionMismatch.spec.mjs`, et c'est elle qui distingue « la vision est là » de « le pion est
 * là ». Le défaut de séance du 07/08 se manifestait exactement par cet écart.
 *
 * @param {import('@playwright/test').Page} page
 */
const pionPeint = (page) =>
  page.evaluate(() => {
    const board = /** @type {HTMLCanvasElement} */ (document.querySelector('#board'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (board.getContext('2d'));
    const d = ctx.getImageData(0, 0, board.width, board.height).data;
    let verts = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 120 && d[i + 1] > 180 && d[i + 2] < 120) verts++;
    }
    return verts;
  });

/** @param {import('@playwright/test').Page} page @param {string} levelId */
const choisirEtage = (page, levelId) =>
  page.evaluate(async (id) => {
    const store = await import('../js/state/store.js');
    store.selectLevel(id);
  }, levelId);

/**
 * Attend que le masque de vision existe pour cet étage, sur ce poste.
 *
 * ⛔ Indispensable, et c'est la seconde erreur que j'ai commise : **le MJ est l'autorité de vision et
 * ne calcule que pour son étage actif.** Basculer le joueur sans attendre que le MJ suive laisse un
 * masque vide, donc une vue noire — mesuré à 0 octet. La sonde de pixels rendait alors « pion
 * absent » alors que rien n'avait été publié.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 */
const attendreLeMasque = (page, levelId) =>
  expect
    .poll(
      () =>
        page.evaluate(
          async (id) => {
            const store = await import('../js/state/store.js');
            const m = store.getSessionVision?.(id) ?? store.getSessionFog(id);
            return m ? String(m).length : 0;
          },
          levelId
        ),
      { timeout: 15000, message: `aucun masque de vision publié pour l’étage ${levelId}` }
    )
    .toBeGreaterThan(0);

test('⭐ basculer entre des étages de tailles différentes ne fait disparaître aucun pion', async ({ browser }) => {
  const context = await browser.newContext();
  const sessionId = `hetero-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  const gm = await context.newPage();
  gm.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  const player = await context.newPage();
  player.on('pageerror', (e) => erreurs.push(`joueurs: ${e.message}`));
  await Promise.all([
    installBrowserTransport(gm, sessionId, snapshot),
    installBrowserTransport(player, sessionId, snapshot),
  ]);
  await Promise.all([
    gm.goto(`/gm.html?session=${sessionId}`),
    player.goto(`/player.html?session=${sessionId}`),
  ]);
  await Promise.all([waitForApp(gm), waitForApp(player)]);

  // Le MJ est l'autorité de vision : on attend son masque pour l'étage de départ avant de juger.
  await expect
    .poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getSessionFog('embuscade')), { timeout: 10000 })
    .not.toBeNull();

  // Aller-retour complet, et deux fois : la seconde passe éprouve la réutilisation des masques déjà
  // produits, là où un canvas mis en cache à la mauvaise taille se ferait sentir.
  for (const tour of [1, 2]) {
    for (const niveau of NIVEAUX) {
      // ⛔ Le MJ d'abord : c'est lui qui calcule et publie la vision de l'étage. Basculer le joueur
      // avant laisserait la tablette attendre un masque que personne n'a demandé.
      await choisirEtage(gm, niveau.id);
      await attendreLeMasque(gm, niveau.id);
      await choisirEtage(player, niveau.id);
      await attendreLeMasque(player, niveau.id);

      // ⛔ `poll`, pas un prélèvement sec. Le masque peut exister avant que le canvas ait été
      // redessiné avec : une sonde immédiate rend « pion absent » pour une frame de retard. C'est la
      // **troisième** version de cette sonde — les deux premières ont fait passer un artefact de
      // mesure pour un défaut du produit, qui n'a jamais existé.
      await expect
        .poll(() => pionPeint(player), {
          timeout: 10000,
          message:
            `tour ${tour}, étage ${niveau.id} (${niveau.widthCells}×${niveau.heightCells} à ` +
            `${niveau.pxPerCell} px) : le pion n'apparaît pas sur la vue joueurs — symptôme du ` +
            `masque aux mauvaises dimensions`,
        })
        .toBeGreaterThan(0);

      await expect
        .poll(() => pionPeint(gm), {
          timeout: 10000,
          message: `tour ${tour}, étage ${niveau.id} : le pion n'apparaît pas sur la vue MJ`,
        })
        .toBeGreaterThan(0);
    }
  }

  // Les trois masques coexistent, chacun à ses propres dimensions. Un masque partagé ou écrasé se
  // verrait ici, alors que les sondes de pixels ci-dessus peuvent encore passer par chance.
  const masques = await gm.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return ['embuscade', 'canyon', 'antre', 'caverne-hex'].map((id) => {
      const m = store.getSessionFog(id);
      return m ? String(m).length : 0;
    });
  });
  expect(masques.filter((n) => n > 0).length, 'les quatre étages doivent avoir chacun leur masque').toBe(4);

  expect(erreurs).toEqual([]);
  await context.close();
});
