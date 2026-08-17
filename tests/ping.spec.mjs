// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Ping — le geste « regarde ici » du MJ (CdC §5.5, critère du lot 4).
 *
 * ## Ce que ces scénarios prouvent
 *
 * Que le geste **traverse réellement** : un clic MJ armé fait apparaître un marqueur sur la vue
 * joueurs, dessiné sur le canvas, dans le budget de 500 ms. Et que le ping **résiste à un décalage
 * d'horloge**, ce qui est la décision de conception de ce chantier.
 *
 * ## ⛔ Ce qu'ils ne prouvent PAS, et ce n'est pas un oubli
 *
 * Les deux pages tournent dans **le même navigateur sur la même machine**, donc sur un transport
 * local et une horloge unique. Le délai mesuré ici est le coût du **code**, pas celui du réseau :
 * les 500 ms du critère ne se constatent pour de vrai qu'à la table, entre le Mac et la tablette,
 * et c'est `tests/mesures/latenceAllerRetour.spec.mjs` qui mesure ce trajet — hors porte de
 * vérification, parce qu'une mesure dépend de la machine qui l'exécute.
 *
 * Ce que la porte peut donc garder, et qu'elle garde ici, c'est un **jugement reproductible** : le
 * ping apparaît, il apparaît au bon endroit, et le budget n'est pas dépassé par le code lui-même.
 */

const LEVEL = {
  id: 'lvl',
  name: 'Carte',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: 20,
  heightCells: 16,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c1',
    name: 'Session ping',
    levels: [LEVEL],
    links: [],
    tokens: [],
    templates: [],
    settings: {},
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Arme une sonde qui note l'instant où du jaune de ping apparaît sur le canvas.
 *
 * ⛔ Sonde **dans la page**, pas un `poll` depuis le test : chaque aller-retour Playwright coûte
 * des dizaines de millisecondes, ce qui polluerait une mesure dont le budget est de 500 ms. La
 * détection est une signature de teinte — `#facc15` (250, 204, 21) n'est employé par aucune autre
 * couche — et elle échantillonne avec un pas pour rester légère : les ondes couvrent des centaines
 * de pixels, aucun risque de les manquer.
 *
 * @param {import('@playwright/test').Page} page
 */
const armerSondeJaune = (page) =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__PING_VU_A__ = null;
    const board = /** @type {HTMLCanvasElement} */ (document.querySelector('#board'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (board.getContext('2d'));
    const jaune = () => {
      const d = ctx.getImageData(0, 0, board.width, board.height).data;
      for (let i = 0; i < d.length; i += 4 * 13) {
        if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 235 && d[i + 2] < 90) return true;
      }
      return false;
    };
    const boucle = () => {
      if (w.__PING_VU_A__ !== null) return;
      if (jaune()) {
        w.__PING_VU_A__ = Date.now();
        return;
      }
      requestAnimationFrame(boucle);
    };
    // Contrôle : rien de jaune ne doit préexister, sinon la sonde se déclencherait sur le décor.
    w.__JAUNE_AVANT__ = jaune();
    requestAnimationFrame(boucle);
  });

/** @param {import('@playwright/test').Page} page */
const jauneVuA = (page) => page.evaluate(() => /** @type {any} */ (window).__PING_VU_A__);

/** @param {import('@playwright/test').Page} page */
const jauneAvant = (page) => page.evaluate(() => /** @type {any} */ (window).__JAUNE_AVANT__);

/**
 * Ouvre le MJ et les joueurs sur la même session.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} sessionId
 * @param {number} [decalageMjMs] Avance artificielle de l'horloge du MJ, en millisecondes.
 */
async function ouvrirLesDeux(browser, sessionId, decalageMjMs = 0) {
  const context = await browser.newContext();
  /** @type {string[]} */
  const erreurs = [];

  const mj = await context.newPage();
  mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  if (decalageMjMs !== 0) {
    // ⭐ L'horloge du MJ avance de `decalageMjMs`. C'est la situation mesurée à la table : la
    // tablette de ce projet a été relevée **5,3 s en avance** sur le Mac. On la reproduit à
    // l'envers — MJ en avance — parce que c'est le sens qui rend un ping « déjà expiré » à
    // l'arrivée, donc invisible, si son âge était jugé sur l'horodatage de l'émetteur.
    await mj.addInitScript((d) => {
      const vrai = Date.now;
      Date.now = () => vrai.call(Date) + d;
    }, decalageMjMs);
  }
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto('/gm.html');
  await waitForApp(mj);

  const joueurs = await context.newPage();
  joueurs.on('pageerror', (e) => erreurs.push(`joueurs: ${e.message}`));
  await installBrowserTransport(joueurs, sessionId, SNAPSHOT);
  await joueurs.goto('/player.html');
  await waitForApp(joueurs);

  return { context, mj, joueurs, erreurs };
}

/**
 * Arme le ping et clique la carte, comme le MJ le fait à la souris.
 * @param {import('@playwright/test').Page} mj
 */
async function pinger(mj) {
  await mj.click('#gm-ping-arm');
  await expect(mj.locator('#gm-ping-arm')).toHaveAttribute('aria-pressed', 'true');
  await mj.evaluate(() => {
    /** @type {any} */ (window).__RPG_APP__.pointerInput.emit({
      type: 'tap',
      mapPos: { x: 700, y: 500 },
      screenPos: { x: 0, y: 0 },
    });
  });
}

test('le ping du MJ apparaît sur la vue joueurs, dans le budget de 500 ms', async ({ browser }) => {
  const { context, mj, joueurs, erreurs } = await ouvrirLesDeux(browser, `ping-${Date.now()}`);

  await armerSondeJaune(joueurs);
  expect(await jauneAvant(joueurs), 'du jaune de ping préexistait : la sonde ne prouverait rien').toBe(false);

  const envoyeA = await mj.evaluate(() => Date.now());
  await pinger(mj);

  await expect
    .poll(() => jauneVuA(joueurs), { timeout: 10000, message: 'le ping n’est jamais apparu chez les joueurs' })
    .not.toBeNull();

  const vuA = /** @type {number} */ (await jauneVuA(joueurs));
  const delai = vuA - envoyeA;
  // Même navigateur, même horloge système : la comparaison est licite ici, et elle ne le serait
  // pas entre deux machines. C'est tout l'objet de l'avertissement en tête de fichier.
  expect(delai, `délai constaté ${delai} ms`).toBeLessThan(500);
  expect(delai, 'délai négatif : la sonde a vu du jaune avant l’envoi').toBeGreaterThanOrEqual(0);

  expect(erreurs).toEqual([]);
  await context.close();
});

test('⭐ un MJ dont l’horloge avance de 5,3 s reste visible chez les joueurs', async ({ browser }) => {
  // Le test qui justifie la conception du chantier. Si le ping était animé depuis `event.at`, comme
  // l'animation des pions l'est depuis `move.startedAt`, cet horodatage arriverait 5,3 s dans le
  // futur du poste joueurs : l'âge serait négatif, la couche ne dessinerait rien, et le geste
  // échouerait **en silence** sur le seul écran qui compte. Chaque poste réhorodate à la réception,
  // donc l'écart n'a aucun effet.
  const { context, mj, joueurs, erreurs } = await ouvrirLesDeux(browser, `ping-skew-${Date.now()}`, 5300);

  // L'horloge du MJ avance réellement : sans cette vérification, le scénario pourrait passer parce
  // que l'injection n'a pas pris, et il serait vert pour la mauvaise raison.
  const ecart = await mj.evaluate(() => Date.now()) - (await joueurs.evaluate(() => Date.now()));
  expect(ecart, `écart d’horloge injecté insuffisant (${ecart} ms)`).toBeGreaterThan(5000);

  await armerSondeJaune(joueurs);
  expect(await jauneAvant(joueurs)).toBe(false);
  await pinger(mj);

  await expect
    .poll(() => jauneVuA(joueurs), {
      timeout: 10000,
      message: 'le ping a disparu à cause du décalage d’horloge — la régression que ce test existe pour attraper',
    })
    .not.toBeNull();

  expect(erreurs).toEqual([]);
  await context.close();
});

test('le ping se désarme après un seul usage, et n’est pas un mode', async ({ browser }) => {
  // Rester armé ferait pointer au clic suivant, qui est presque toujours destiné à autre chose —
  // sélectionner un pion, désigner une destination.
  const { context, mj, erreurs } = await ouvrirLesDeux(browser, `ping-disarm-${Date.now()}`);

  await pinger(mj);
  await expect(mj.locator('#gm-ping-arm')).toHaveAttribute('aria-pressed', 'false');
  expect(
    await mj.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.getActiveToolName()),
    'l’outil ping est resté armé après la pose'
  ).toBe('none');

  expect(erreurs).toEqual([]);
  await context.close();
});

test('armer le ping désarme l’outil précédent, et changer d’onglet désarme le ping', async ({ browser }) => {
  // L'exclusivité mutuelle et le désarmement au changement d'onglet ne sont pas réécrits pour le
  // ping : il passe par `setActiveTool`, donc il en hérite. Ce test vérifie l'héritage, qui est
  // précisément ce qui justifiait de ne pas lui donner de module à lui.
  const { context, mj, erreurs } = await ouvrirLesDeux(browser, `ping-exclu-${Date.now()}`);

  const outil = () => mj.evaluate(() => /** @type {any} */ (window).__RPG_APP__.gmPanel.getActiveToolName());

  await mj.click('button[data-tab="template-tools"]');
  await mj.click('#tpl-toggle-arm');
  expect(await outil()).toBe('template-place');

  await mj.click('#gm-ping-arm');
  expect(await outil(), 'armer le ping doit désarmer les gabarits').toBe('ping');
  await expect(mj.locator('#tpl-toggle-arm')).toHaveText(/désarmé/i);

  // Le ping vit hors des onglets, mais il reste un outil armé : changer d'onglet doit le rendre.
  await mj.click('button[data-tab="fog-tools"]');
  expect(await outil(), 'changer d’onglet doit désarmer le ping').toBe('none');
  await expect(mj.locator('#gm-ping-arm')).toHaveAttribute('aria-pressed', 'false');

  expect(erreurs).toEqual([]);
  await context.close();
});
