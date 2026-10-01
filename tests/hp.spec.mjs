// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

const FAKE_LEVEL = {
  id: 'rdc-level',
  name: 'Rez-de-chaussée',
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 140,
  widthCells: 10,
  heightCells: 8,
  grid: { type: /** @type {import('../js/core/types.js').GridType} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

const FAKE_PJ = {
  id: 'hero-1',
  levelId: 'rdc-level',
  cell: { a: 4, b: 2 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#000000',
  label: 'Guerrier',
  hidden: false,
  visionBright: 10,
  visionDim: 10,
  emitsLight: null,
  speedCells: 6,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
  hp: { current: 28, max: 28 },
  health: 'unharmed',
};

const FAKE_PNJ = {
  id: 'boss-1',
  levelId: 'rdc-level',
  cell: { a: 4, b: 2 },
  sizeCells: 1,
  kind: 'npc',
  imageUrl: '',
  borderColor: '#000000',
  label: 'Boss',
  hidden: false,
  visionBright: 0,
  visionDim: 0,
  emitsLight: null,
  speedCells: 3,
  playerMovable: false,
  locked: false,
  elevation: 0,
  markers: [],
  hp: { current: 12, max: 140 },
  health: 'wounded',
};

/**
 * Échantillonne le pixel au centre exact de la pastille chiffrée d'un pion après rendu du frameLoop.
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 * @param {{ current: number, max: number }} [hpPourPosition] PV qui fixent la place de la pastille,
 *   pour sonder au même endroit un pion qui n'en a pas
 * @returns {Promise<[number, number, number, number]>}
 */
async function sampleHpBadgePixel(page, tokenId, hpPourPosition) {
  return page.evaluate(async ([id, hpForce]) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    if (!app || !app.canvas || !app.camera) throw new Error('App non initialisée');
    if (app.vision && typeof app.vision.recompute === 'function') app.vision.recompute();
    if (typeof app.invalidate === 'function') app.invalidate();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const ctx = app.canvas.getContext('2d');
    const store = await import('../js/state/store.js');
    const { computeHpBadgeLayout } = await import('../js/render/statusBadges.js');
    const campaign = store.getCampaign();
    const token = campaign?.tokens.find((/** @type {any} */ t) => t.id === id);
    const hp = token?.hp ?? hpForce;
    if (!token || !hp) throw new Error('Token ou hp non trouvé: ' + id);
    const level = campaign?.levels.find((/** @type {any} */ l) => l.id === token.levelId);
    const pxPerCell = level?.pxPerCell ?? 140;
    const zoom = app.camera.zoom ?? 1;

    const p0Map = { x: token.cell.a * pxPerCell, y: token.cell.b * pxPerCell };
    ctx.save();
    const hpBadge = computeHpBadgeLayout(token.sizeCells * pxPerCell, zoom, hp.current, hp.max);
    ctx.font = `bold ${hpBadge.fontSizeMap}px sans-serif`;
    const textMetrics = ctx.measureText(hpBadge.text);
    const textWidthMap = textMetrics.width;
    const bgWidthMap = textWidthMap + hpBadge.paddingXMap * 2;
    const bgHeightMap = hpBadge.heightMap;

    const badgeLeftMap = p0Map.x + hpBadge.badgeX - bgWidthMap;
    const badgeTopMap = p0Map.y + hpBadge.badgeY - bgHeightMap;
    const centerMap = { x: badgeLeftMap + bgWidthMap / 2, y: badgeTopMap + bgHeightMap / 2 };
    ctx.restore();

    const centerScreen = app.camera.mapToScreen(centerMap);
    const resolution = app.stage?.resolution ?? 1;
    const canvasX = Math.round(centerScreen.screenX * resolution);
    const canvasY = Math.round(centerScreen.screenY * resolution);

    const data = ctx.getImageData(canvasX, canvasY, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }, /** @type {[string, any]} */ ([tokenId, hpPourPosition ?? null]));
}

test.describe('Chantier Q — Points de vie E2E & Rendu', () => {
  test('1. Critère 4 : Les PV d\'un PNJ ne fuient jamais vers la vue joueurs (Sonde de pixels canvas)', async ({ context }) => {
    const sessionId = `test-hp-c4-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'hp-c4-campaign',
        name: 'Campagne PV C4',
        levels: [FAKE_LEVEL],
        links: [],
        // ⚠ Case distincte pour le PJ (C-6, `docs/QUESTIONS-EN-ATTENTE.md`) : une case, un pion.
        // Rester à portée de vue du PNJ importe aussi — sans le PJ pour l'éclairer, le pixel
        // échantillonné côté joueurs serait celui du brouillard, pas celui de l'absence de badge.
        tokens: [{ ...FAKE_PJ, cell: { a: 2, b: 2 } }, { ...FAKE_PNJ }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'boss-1',
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    const pagePlayer = await context.newPage();
    await installBrowserTransport(pagePlayer, sessionId, snapshot);
    // Tout texte écrit sur un canvas de la vue joueurs est relevé.
    await pagePlayer.addInitScript(() => {
      const ecrire = CanvasRenderingContext2D.prototype.fillText;
      /** @type {any} */ (window).__textesDessines = [];
      /**
       * @param {string} texte
       * @param {number} x
       * @param {number} y
       * @param {number} [largeurMax]
       */
      CanvasRenderingContext2D.prototype.fillText = function (texte, x, y, largeurMax) {
        /** @type {any} */ (window).__textesDessines.push(String(texte));
        return largeurMax === undefined ? ecrire.call(this, texte, x, y) : ecrire.call(this, texte, x, y, largeurMax);
      };
    });
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pagePlayer);

    // Attendre le rendu effectif de la pastille côté MJ (fond noir rgba(0,0,0,0.85) -> RGB < 60, Alpha > 180)
    await expect
      .poll(async () => {
        const pixel = await sampleHpBadgePixel(pageGM, 'boss-1');
        return pixel[3] > 180 && pixel[0] < 60 && pixel[1] < 60 && pixel[2] < 60;
      })
      .toBe(true);

    const gmPixel = await sampleHpBadgePixel(pageGM, 'boss-1');
    const playerPixel = await sampleHpBadgePixel(pagePlayer, 'boss-1');

    // Côté MJ : le pixel échantillonné sur la pastille est le fond noir 0.85 du badge chiffré 12/140
    expect(gmPixel[3]).toBeGreaterThan(180);
    expect(gmPixel[0]).toBeLessThan(60);
    expect(gmPixel[1]).toBeLessThan(60);
    expect(gmPixel[2]).toBeLessThan(60);

    // Côté Joueurs : la pastille 12/140 N'EST PAS dessinée pour un PNJ. ⚠ Depuis que la pastille
    // mord le bord du pion (01/10/2026), « le pixel n'est pas sombre » ne prouvait plus rien : le
    // fond sous elle peut l'être. On regarde donc ce que la vue joueurs ÉCRIT sur son canvas — le
    // texte de la pastille ne doit jamais y passer, alors que celui du PJ, lui, y passe.
    const textesJoueurs = () => pagePlayer.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (window).__textesDessines));
    // Le PJ d'abord : sa pastille prouve que la vue joueurs a bien dessiné des pastilles.
    await expect.poll(textesJoueurs).toContain('28/28');
    const textes = await textesJoueurs();
    expect(textes).not.toContain('12/140');
    // Les pixels lus sur les deux canvas sont réels et distincts
    expect(gmPixel).not.toEqual(playerPixel);
  });

  test('3. Critères 9 et 10 : Inspecteur MJ (plancher, vidage, max abaissé, radios exclusives, masquage sur PJ, grisage si hp null)', async ({ context }) => {
    const sessionId = `test-hp-inspector-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'hp-inspector-campaign',
        name: 'Campagne Inspecteur PV',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...FAKE_PJ, cell: { a: 2, b: 2 } }, { ...FAKE_PNJ, cell: { a: 5, b: 2 } }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'hero-1',
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    // Ouvrir l'onglet "Pions"
    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');

    // Sur un PJ (hero-1) : la section d'état PNJ doit être masquée (style.display === 'none')
    const healthSection = pageGM.locator('#token-health-section');
    await expect(healthSection).toBeHidden();

    // Sélectionner le PNJ (boss-1)
    await pageGM.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.setSelection('boss-1');
    });

    await expect(healthSection).toBeVisible();

    // Tester la valeur bornée -3 -> 0 (Critère 9)
    const hpCurrentInput = pageGM.locator('#token-hp-current');
    await hpCurrentInput.fill('-3');
    await hpCurrentInput.dispatchEvent('change');

    // Vérifier que le champ affiche '0' et que le store a '0'
    await expect(hpCurrentInput).toHaveValue('0');
    await expect
      .poll(() =>
        pageGM.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getSelectedToken()?.hp?.current;
        })
      )
      .toBe(0);

    // Saisir un courant de 50 sur max 140
    await hpCurrentInput.fill('50');
    await hpCurrentInput.dispatchEvent('change');

    // Abaiser le max à 30 -> le courant doit s'abaisser à 30 (Critère 9)
    const hpMaxInput = pageGM.locator('#token-hp-max');
    await hpMaxInput.fill('30');
    await hpMaxInput.dispatchEvent('change');

    await expect(hpCurrentInput).toHaveValue('30');
    await expect
      .poll(() =>
        pageGM.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getSelectedToken()?.hp;
        })
      )
      .toEqual({ current: 30, max: 30 });

    // Vider le max -> hp devient null, current est vité et grisé, les radios sont grisés
    await hpMaxInput.fill('');
    await hpMaxInput.dispatchEvent('change');

    await expect(hpCurrentInput).toBeDisabled();
    await expect(pageGM.locator('#token-health-wounded')).toBeDisabled();
    await expect
      .poll(() =>
        pageGM.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getSelectedToken()?.hp;
        })
      )
      .toBeNull();

    // Rétablir max à 100 -> courant passe à 100, les radios redeviennent activés
    await hpMaxInput.fill('100');
    await hpMaxInput.dispatchEvent('change');
    await expect(pageGM.locator('#token-health-wounded')).toBeEnabled();

    // Cocher le radio 'critical'
    const criticalRadio = pageGM.locator('#token-health-critical');
    await criticalRadio.check();

    await expect
      .poll(() =>
        pageGM.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getSelectedToken()?.health;
        })
      )
      .toBe('critical');
  });

  test('4. Critère 11 : Un seul événement publié par saisie', async ({ context }) => {
    const sessionId = `test-hp-events-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'hp-events-campaign',
        name: 'Campagne Events PV',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...FAKE_PNJ }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'boss-1',
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');

    const hpCurrentInput = pageGM.locator('#token-hp-current');
    await hpCurrentInput.fill('45');
    await hpCurrentInput.dispatchEvent('change');

    const publishedHpEvents = await pageGM.evaluate(() => {
      const wire = /** @type {any} */ (window).__RPG_TEST_WIRE__;
      const published = wire ? wire.published : [];
      return published.filter((/** @type {any} */ e) => e.type === 'token.update' && e.payload?.patch?.hp);
    });

    expect(publishedHpEvents.length).toBe(1);
  });

  /**
   * Critère 13, par le comportement et non par la forme du code.
   *
   * ⭐ **Ce test existe parce que le test unitaire du critère 13 est un faux vert**, établi par
   * mutation le 06/08/2026. Celui-là relit les sources et cherche `health` et `hp` sur **une même
   * ligne** ; une dérivation étalée sur trois lignes non couplées passe sans être vue :
   *
   * ```
   * const ratioQ = token.hp.current / token.hp.max;      // `hp`, pas `health`
   * const etatDeduit = ratioQ < 0.5 ? 'critical' : …;    // ni l'un ni l'autre
   * computeStateRing(width, zoom, etatDeduit);           // ni l'un ni l'autre
   * ```
   *
   * Aucune des huit autres mutations n'a échappé aux tests du chantier ; celle-ci a traversé les
   * **deux** suites en restant verte. Et ce n'est pas un détail de forme : c'est l'arbitrage (2)
   * du chantier, la seule raison d'être de la fonctionnalité — le mainteneur veut pouvoir laisser
   * un boss à 12/140 annoncé « Indemne ».
   *
   * ⛔ **Ne pas « réparer » en durcissant l'expression régulière du test unitaire.** Une règle qui
   * lit la forme du code se contourne toujours d'une écriture de plus ; ce qui ne se contourne pas,
   * c'est ce que le pion affiche. La scène est donc exactement celle du mainteneur, et le pixel
   * répond.
   *
   * Le premier des deux constats est le garde-fou du second : on vérifie d'abord que la sonde voit
   * **bien** un anneau quand le MJ en annonce un. Sans lui, « aucun anneau » pourrait n'être que
   * l'aveu d'une sonde qui regarde à côté.
   */
  test('5. Aucune barre d’état autour des pions : un pion à PV dessine les mêmes pixels qu’un pion sans PV', async ({
    context,
  }) => {
    /**
     * ⛔ Décision du mainteneur, 01/10/2026 : les barres d'état qui entouraient les pions sont
     * retirées — châsse du Chantier R (bande, arc de PV, anneau d'état, encoches) et anneau fin
     * de repli du Chantier Q. Seul le cartouche chiffré reste.
     *
     * Le constat ne se fie à aucune couleur : le même pion, au même endroit, est rendu une fois
     * avec des PV et un état « Mal en point », une fois sans PV ni état. Là où passaient la bande
     * et l'anneau — juste dans le bord du portrait et juste au-dehors —, les pixels doivent être
     * identiques. Une barre revenue, quelle que soit sa teinte, les ferait différer.
     *
     * @param {import('@playwright/test').Page} page
     * @param {string} tokenId
     */
    async function sonderCouronne(page, tokenId) {
      return page.evaluate(async (id) => {
        const app = /** @type {any} */ (window).__RPG_APP__;
        if (typeof app.invalidate === 'function') app.invalidate();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const ctx = app.canvas.getContext('2d');
        const store = await import('../js/state/store.js');
        const campaign = store.getCampaign();
        const token = campaign?.tokens.find((/** @type {any} */ t) => t.id === id);
        if (!token) throw new Error('Token non trouvé: ' + id);
        const level = campaign?.levels.find((/** @type {any} */ l) => l.id === token.levelId);
        const pxPerCell = level?.pxPerCell ?? 140;
        const zoom = app.camera.zoom ?? 1;
        const rayon = (token.sizeCells * pxPerCell) / 2;
        const centre = {
          x: (token.cell.a + token.sizeCells / 2) * pxPerCell,
          y: (token.cell.b + token.sizeCells / 2) * pxPerCell,
        };
        const resolution = app.stage?.resolution ?? 1;
        /** @type {number[]} */
        const pixels = [];
        // Trois rayons (dans la bande de la châsse, sur le bord, dans l'anneau de repli) et
        // trois angles (haut, droite, bas) : loin du cartouche, posé au coin haut-gauche.
        for (const ecart of [-5 / zoom, -2 / zoom, 1.5 / zoom]) {
          for (const angle of [-Math.PI / 2, 0, Math.PI / 2]) {
            const ecran = app.camera.mapToScreen({
              x: centre.x + (rayon + ecart) * Math.cos(angle),
              y: centre.y + (rayon + ecart) * Math.sin(angle),
            });
            const d = ctx.getImageData(Math.round(ecran.screenX * resolution), Math.round(ecran.screenY * resolution), 1, 1).data;
            pixels.push(d[0], d[1], d[2], d[3]);
          }
        }
        return pixels;
      }, tokenId);
    }

    /**
     * @param {any} pion
     * @param {string} suffixe
     */
    const ouvrirMJ = async (pion, suffixe) => {
      const sessionId = `test-hp-sans-barre-${suffixe}-${Date.now()}`;
      const snapshot = {
        campaign: {
          schemaVersion: 2,
          campaignId: 'hp-sans-barre',
          name: 'Campagne sans barre',
          levels: [FAKE_LEVEL],
          links: [],
          tokens: [pion],
          templates: [],
          settings: {},
        },
        activeLevelId: FAKE_LEVEL.id,
        // Aucune sélection : l'anneau blanc de sélection passerait dans la même couronne.
        selectedTokenId: null,
      };
      const page = await context.newPage();
      await installBrowserTransport(page, sessionId, snapshot);
      await page.goto(`/gm.html?session=${sessionId}`);
      await waitForApp(page);
      return page;
    };

    for (const [nom, avecPv] of /** @type {[string, any][]} */ ([
      ['PJ entamé', { ...FAKE_PJ, hp: { current: 7, max: 20 } }],
      ['PNJ mal en point', { ...FAKE_PNJ, hp: { current: 12, max: 140 }, health: 'critical' }],
    ])) {
      const sansPv = { ...avecPv, hp: null, health: 'unharmed' };
      const pageAvec = await ouvrirMJ(avecPv, `avec-${avecPv.id}`);
      const pageSans = await ouvrirMJ(sansPv, `sans-${avecPv.id}`);
      // Le rendu se stabilise d'abord (images, fog) : on compare deux sondes successives égales.
      await expect.poll(async () => JSON.stringify(await sonderCouronne(pageSans, sansPv.id))).toBe(
        JSON.stringify(await sonderCouronne(pageSans, sansPv.id))
      );
      const attendu = await sonderCouronne(pageSans, sansPv.id);
      await expect
        .poll(async () => JSON.stringify(await sonderCouronne(pageAvec, avecPv.id)), { message: nom })
        .toBe(JSON.stringify(attendu));
      await pageAvec.close();
      await pageSans.close();
    }
  });
});
