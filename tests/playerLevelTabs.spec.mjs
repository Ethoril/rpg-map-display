// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * UX-12 — le sélecteur d'étage de la vue joueurs.
 *
 * ## ✅ Aucune dérogation à demander
 *
 * L'interdiction n°2 de `docs/CONVENTIONS.md` — « ne jamais ajouter d'élément d'interface à la vue
 * joueurs » — **liste déjà le sélecteur d'étage** parmi ce qui a le droit de s'afficher.
 *
 * ## ⛔ Un étage inconnu est ABSENT, pas grisé
 *
 * Et c'est le cœur de ce fichier. Un onglet « Cave » verrouillé apprendrait aux joueurs qu'il
 * **existe** une cave : une fuite de la même famille que celles que le fog empêche.
 */

/**
 * @param {string} id
 * @param {string} name
 * @param {number} [widthCells]
 * @param {number} [heightCells]
 */
const etage = (id, name, widthCells = 10, heightCells = 8) => ({
  id,
  name,
  order: 0,
  imageUrl: '',
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
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
});

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'ux12',
    name: 'Trois étages',
    links: [],
    tokens: [],
    templates: [],
    settings: {},
    levels: [etage('rdc', 'Rez-de-chaussée'), etage('et1', 'Étage 1'), etage('cave', 'Cave')],
  },
  activeLevelId: 'rdc',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Écrit un masque exploré pour un étage, comme le ferait le MJ en publiant `fog.update`.
 *
 * `revele: false` produit un masque **présent et entièrement vide** — exactement ce que le bouton
 * « Masquer tout » du MJ publie, et c'est le cas qui distingue « le masque existe » de « l'étage
 * est connu ».
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} levelId
 * @param {boolean} revele
 */
const poserMasque = (page, levelId, revele) =>
  page.evaluate(
    async ({ id, plein }) => {
      const [store, fog] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/vision/fog.js'),
      ]);
      const level = store.getCampaign()?.levels.find((l) => l.id === id);
      if (!level) throw new Error(`etage inconnu : ${id}`);
      const masque = new fog.ExploredFog(level.widthCells, level.heightCells);
      if (plein) masque.revealAll();
      store.setSessionFog(id, await masque.exportPng());
    },
    { id: levelId, plein: revele }
  );

/** @param {import('@playwright/test').Page} page */
const onglets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#player-level-tabs .player-level-tab')].map((b) => ({
      id: /** @type {HTMLElement} */ (b).dataset.levelId,
      texte: b.textContent,
      selected: b.getAttribute('aria-selected'),
    }))
  );

/** @param {import('@playwright/test').Page} page */
const idsDesOnglets = (page) => onglets(page).then((o) => o.map((x) => x.id));

/** @param {import('@playwright/test').Page} page */
const etageAffiche = (page) =>
  page.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId());

test('UX-12 critères 1 et 2 : seuls les étages au masque non vide apparaissent, les autres sont ABSENTS du DOM', async ({
  page,
}) => {
  const sessionId = `ux12-connu-${Date.now()}`;
  await installBrowserTransport(page, sessionId, SNAPSHOT);
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  // Un seul étage connu : la barre n'apporte rien et disparaît.
  await poserMasque(page, 'rdc', true);
  await expect(page.locator('#player-level-tabs')).toBeHidden();

  // L'étage 1 devient connu : deux onglets, et la barre apparaît.
  await poserMasque(page, 'et1', true);
  await expect(page.locator('#player-level-tabs')).toBeVisible();
  await expect.poll(() => onglets(page)).toEqual([
    { id: 'rdc', texte: 'Rez-de-chaussée', selected: 'true' },
    { id: 'et1', texte: 'Étage 1', selected: 'false' },
  ]);

  // ⭐ La cave reçoit un masque PRÉSENT MAIS VIDE — ce que publie « Masquer tout ». Elle ne doit
  // pas apparaître : un onglet menant à un écran noir vaut la fuite qu'on évite.
  await poserMasque(page, 'cave', false);
  await page.waitForTimeout(400);
  expect(await idsDesOnglets(page), 'un masque vide ne rend pas un étage connu').toEqual([
    'rdc',
    'et1',
  ]);

  // ⛔ Et l'étage inconnu est ABSENT du DOM, pas grisé : rien dans la page ne doit le nommer.
  const domNommeLaCave = await page.evaluate(() => document.body.innerHTML.includes('Cave'));
  expect(domNommeLaCave, 'un étage inconnu ne doit pas exister dans le DOM, même désactivé').toBe(
    false
  );

  // La cave devient connue à son tour : elle apparaît, et l'ordre de la campagne est conservé.
  await poserMasque(page, 'cave', true);
  await expect.poll(() => idsDesOnglets(page)).toEqual(['rdc', 'et1', 'cave']);
});

test('UX-12 critère 3 : choisir un étage ne publie rien et ne déplace pas la vue MJ', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `ux12-local-${Date.now()}`;

  const mj = await context.newPage();
  await installBrowserTransport(mj, sessionId, SNAPSHOT);
  await mj.goto(`/gm.html?session=${sessionId}`);
  await waitForApp(mj);

  const joueur = await context.newPage();
  await installBrowserTransport(joueur, sessionId, SNAPSHOT);
  await joueur.goto(`/player.html?session=${sessionId}`);
  await waitForApp(joueur);

  await poserMasque(joueur, 'rdc', true);
  await poserMasque(joueur, 'et1', true);
  await expect(joueur.locator('#player-level-tabs')).toBeVisible();

  const avant = await joueur.evaluate(
    () => /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length
  );

  await joueur.click('.player-level-tab[data-level-id="et1"]');
  await expect.poll(() => etageAffiche(joueur)).toBe('et1');

  // ⛔ Rien de nouveau ne transite : c'est un point de vue, pas un fait de jeu. Vérifié sur ce qui
  // est RÉELLEMENT parti sur le canal, et pas seulement sur l'état final.
  const publiesDepuis = await joueur.evaluate(
    (n) =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published
        .slice(n)
        .map((/** @type {any} */ e) => e.type),
    avant
  );
  expect(publiesDepuis, 'un choix local ne doit pas publier level.select').not.toContain(
    'level.select'
  );

  // Et la vue MJ n'a pas bougé.
  await mj.waitForTimeout(600);
  expect(
    await mj.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId()),
    'le choix de la table ne doit pas déplacer le MJ'
  ).toBe('rdc');

  await context.close();
});

test('UX-12 critères 4 et 5 : ARIA, navigation aux flèches, cible tactile et absence de débordement', async ({
  page,
}) => {
  const sessionId = `ux12-a11y-${Date.now()}`;
  await installBrowserTransport(page, sessionId, SNAPSHOT);
  // Une tablette étroite : c'est là que la barre déborderait.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  for (const id of ['rdc', 'et1', 'cave']) await poserMasque(page, id, true);
  await expect(page.locator('#player-level-tabs')).toBeVisible();
  await expect.poll(() => idsDesOnglets(page)).toEqual(['rdc', 'et1', 'cave']);

  // Critère 4 : les attributs de la barre MJ, à l'identique.
  await expect(page.locator('#player-level-tabs')).toHaveAttribute('role', 'tablist');
  const premier = page.locator('.player-level-tab[data-level-id="rdc"]');
  await expect(premier).toHaveAttribute('role', 'tab');
  await expect(premier).toHaveAttribute('aria-selected', 'true');

  // `tabindex` glissant, comme la barre MJ : un seul onglet est atteignable au Tab.
  const tabIndex = await page.evaluate(() =>
    [...document.querySelectorAll('#player-level-tabs .player-level-tab')].map(
      (b) => /** @type {HTMLElement} */ (b).tabIndex
    )
  );
  expect(tabIndex).toEqual([0, -1, -1]);

  await premier.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => etageAffiche(page)).toBe('et1');
  await page.keyboard.press('End');
  await expect.poll(() => etageAffiche(page)).toBe('cave');
  await page.keyboard.press('Home');
  await expect.poll(() => etageAffiche(page)).toBe('rdc');

  // Critère 5 : cible tactile ≥ 44 px, une seule ligne, barre défilable, page sans débordement.
  const mesures = await page.evaluate(() => {
    const barre = /** @type {HTMLElement} */ (document.getElementById('player-level-tabs'));
    const boutons = [...barre.querySelectorAll('.player-level-tab')].map((b) =>
      b.getBoundingClientRect()
    );
    return {
      hauteurMini: Math.min(...boutons.map((r) => r.height)),
      uneSeuleLigne: new Set(boutons.map((r) => Math.round(r.top))).size === 1,
      barreDefilable: getComputedStyle(barre).overflowX === 'auto',
      pageSansDebordement: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(mesures.hauteurMini, 'cible tactile trop petite pour un doigt').toBeGreaterThanOrEqual(44);
  expect(mesures.uneSeuleLigne, 'la barre passe à la ligne et mange la carte').toBe(true);
  expect(mesures.barreDefilable).toBe(true);
  expect(mesures.pageSansDebordement).toBe(true);

  // Le focus reste visible : on reprend la forme de la référence, pas son retard.
  const contourVisible = await page.evaluate(() => {
    const btn = /** @type {HTMLElement} */ (
      document.querySelector('.player-level-tab[data-level-id="rdc"]')
    );
    btn.focus();
    const style = getComputedStyle(btn);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  });
  expect(contourVisible, 'le focus clavier doit rester visible').toBe(true);
});
