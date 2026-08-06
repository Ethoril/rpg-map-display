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
  ambient: { color: '#ffffff', level: 1, baked: false },
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
 * @returns {Promise<[number, number, number, number]>}
 */
async function sampleHpBadgePixel(page, tokenId) {
  return page.evaluate(async (id) => {
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
    if (!token || !token.hp) throw new Error('Token ou hp non trouvé: ' + id);
    const level = campaign?.levels.find((/** @type {any} */ l) => l.id === token.levelId);
    const pxPerCell = level?.pxPerCell ?? 140;
    const zoom = app.camera.zoom ?? 1;

    const p0Map = { x: token.cell.a * pxPerCell, y: token.cell.b * pxPerCell };
    ctx.save();
    const hpBadge = computeHpBadgeLayout(token.sizeCells * pxPerCell, zoom, token.hp.current, token.hp.max);
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
  }, tokenId);
}

/**
 * Échantillonne le pixel au sommet exact de l'anneau de santé d'un pion après rendu du frameLoop.
 * @param {import('@playwright/test').Page} page
 * @param {string} tokenId
 * @returns {Promise<[number, number, number, number]>}
 */
async function sampleHealthRingPixel(page, tokenId) {
  return page.evaluate(async (id) => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    if (!app || !app.canvas || !app.camera) throw new Error('App non initialisée');
    if (app.vision && typeof app.vision.recompute === 'function') app.vision.recompute();
    if (typeof app.invalidate === 'function') app.invalidate();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const ctx = app.canvas.getContext('2d');
    const store = await import('../js/state/store.js');
    const { computeProportionalRing, computeStateRing } = await import('../js/render/statusBadges.js');
    const campaign = store.getCampaign();
    const token = campaign?.tokens.find((/** @type {any} */ t) => t.id === id);
    if (!token) throw new Error('Token non trouvé: ' + id);
    const level = campaign?.levels.find((/** @type {any} */ l) => l.id === token.levelId);
    const pxPerCell = level?.pxPerCell ?? 140;
    const zoom = app.camera.zoom ?? 1;
    const widthMap = token.sizeCells * pxPerCell;

    const ring = token.kind === 'pc' ? computeProportionalRing(widthMap, zoom, token.hp) : computeStateRing(widthMap, zoom, token.health);
    const centerMap = { x: (token.cell.a + token.sizeCells / 2) * pxPerCell, y: (token.cell.b + token.sizeCells / 2) * pxPerCell };
    const ringTopMap = { x: centerMap.x, y: centerMap.y - ring.radiusMap };

    const topScreen = app.camera.mapToScreen(ringTopMap);
    const resolution = app.stage?.resolution ?? 1;
    const canvasX = Math.round(topScreen.screenX * resolution);
    const canvasY = Math.round(topScreen.screenY * resolution);

    let bestPixel = [0, 0, 0, 0];
    let maxVal = -1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const data = ctx.getImageData(canvasX + dx, canvasY + dy, 1, 1).data;
        const val = Math.max(data[0], data[1], data[2]);
        if (val > maxVal) {
          maxVal = val;
          bestPixel = [data[0], data[1], data[2], data[3]];
        }
      }
    }
    return [bestPixel[0], bestPixel[1], bestPixel[2], bestPixel[3]];
  }, tokenId);
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
        tokens: [{ ...FAKE_PJ }, { ...FAKE_PNJ }],
        templates: [],
        settings: { ambientLevel: 1 },
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

    // Côté Joueurs : la pastille 12/140 N'EST PAS dessinée pour un PNJ.
    // Le pixel sur player.html n'est pas le fond sombre du badge (isPlayerPixelDarkBadge === false)
    const isPlayerPixelDarkBadge = playerPixel[3] > 180 && playerPixel[0] < 60 && playerPixel[1] < 60 && playerPixel[2] < 60;
    expect(isPlayerPixelDarkBadge).toBe(false);

    // Les pixels lus sur les deux canvas sont réels et distincts
    expect(gmPixel).not.toEqual(playerPixel);
  });

  test('2. Critère 6 : Un PJ à plein et un PNJ critical côte à côte (Sonde de pixels canvas)', async ({ context }) => {
    const sessionId = `test-hp-c6-${Date.now()}`;
    const pnjCritical = { ...FAKE_PNJ, id: 'boss-critical', cell: { a: 5, b: 2 }, health: 'critical' };
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'hp-c6-campaign',
        name: 'Campagne PV C6',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...FAKE_PJ, cell: { a: 2, b: 2 } }, pnjCritical],
        templates: [],
        settings: { ambientLevel: 1 },
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: null,
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    // Attendre que les anneaux soient rendus sur le canvas MJ
    await expect
      .poll(async () => {
        const pjPixel = await sampleHealthRingPixel(pageGM, 'hero-1');
        const pnjPixel = await sampleHealthRingPixel(pageGM, 'boss-critical');
        // PJ a l'anneau bleu royal #2563eb (Bleu prédominant)
        const isPjBlue = pjPixel[3] > 0 && pjPixel[2] > pjPixel[0];
        // PNJ a l'anneau rouge critical #ef4444 (Rouge prédominant)
        const isPnjRed = pnjPixel[3] > 0 && pnjPixel[0] > pnjPixel[2];
        return isPjBlue && isPnjRed;
      })
      .toBe(true);

    const pjPixel = await sampleHealthRingPixel(pageGM, 'hero-1');
    const pnjPixel = await sampleHealthRingPixel(pageGM, 'boss-critical');

    // Mesure réelle des pixels du canvas :
    // PJ (bleu royal #2563eb) : la composante Bleu est prédominante (B > R)
    expect(pjPixel[3]).toBeGreaterThan(0);
    expect(pjPixel[2]).toBeGreaterThan(pjPixel[0]);

    // PNJ Critical (rouge #ef4444) : la composante Rouge est prédominante (R > B)
    expect(pnjPixel[3]).toBeGreaterThan(0);
    expect(pnjPixel[0]).toBeGreaterThan(pnjPixel[2]);

    // Les deux pixels canvas mesurés sont distincts
    expect(pjPixel).not.toEqual(pnjPixel);
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
        settings: { ambientLevel: 1 },
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
        settings: { ambientLevel: 1 },
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
  test('5. Critère 13 par le comportement : un boss à 12/140 annoncé « Indemne » n\'affiche aucun anneau', async ({
    context,
  }) => {
    /**
     * Échantillonne l'anneau **à l'endroit où il serait s'il était dessiné**, sans consulter
     * `health` : le rayon ne se déduit que du diamètre et du zoom. Une sonde qui demanderait sa
     * position à `computeStateRing(…, token.health)` — comme le fait `sampleHealthRingPixel` — se
     * placerait au centre du pion pour un état « Indemne », et ne pourrait rien constater.
     *
     * @param {import('@playwright/test').Page} page
     * @param {string} tokenId
     * @returns {Promise<[number, number, number, number]>}
     */
    async function sampleAnnulusPixel(page, tokenId) {
      return page.evaluate(async (id) => {
        const app = /** @type {any} */ (window).__RPG_APP__;
        if (typeof app.invalidate === 'function') app.invalidate();
        await new Promise((resolve) => requestAnimationFrame(resolve));

        const ctx = app.canvas.getContext('2d');
        const store = await import('../js/state/store.js');
        const campaign = store.getCampaign();
        const token = campaign?.tokens.find((/** @type {any} */ t) => t.id === id);
        if (!token) throw new Error('Token non trouvé: ' + id);
        const level = campaign?.levels.find((/** @type {any} */ l) => l.id === token.levelId);
        const pxPerCell = level?.pxPerCell ?? 140;
        const zoom = app.camera.zoom ?? 1;
        const widthMap = token.sizeCells * pxPerCell;

        // Même rayon que `computeProportionalRing` / `computeStateRing`, recalculé ici sans eux.
        const radiusMap = widthMap / 2 + 1.5 / zoom;
        const centerMap = {
          x: (token.cell.a + token.sizeCells / 2) * pxPerCell,
          y: (token.cell.b + token.sizeCells / 2) * pxPerCell,
        };
        const topScreen = app.camera.mapToScreen({ x: centerMap.x, y: centerMap.y - radiusMap });
        const resolution = app.stage?.resolution ?? 1;
        const canvasX = Math.round(topScreen.screenX * resolution);
        const canvasY = Math.round(topScreen.screenY * resolution);

        // Le pixel le plus rouge du voisinage : les deux couleurs d'état sont franchement rouges
        // (#c2410c et #ef4444), et l'anti-aliasing peut décaler le trait d'un pixel.
        let best = [0, 0, 0, 0];
        let maxRougeur = -1e9;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const d = ctx.getImageData(canvasX + dx, canvasY + dy, 1, 1).data;
            const rougeur = d[0] - Math.max(d[1], d[2]);
            if (rougeur > maxRougeur) {
              maxRougeur = rougeur;
              best = [d[0], d[1], d[2], d[3]];
            }
          }
        }
        return [best[0], best[1], best[2], best[3]];
      }, tokenId);
    }

    /**
     * Un anneau d'état est-il là ? Le critère est la **rougeur**, pas la clarté.
     *
     * ⚠ Mesuré, et c'est ce qui a fait échouer la première version de ce test : l'anneau se dessine
     * **sous le fog**, et le voile du MJ le divise par deux. Un anneau « mal en point » #ef4444
     * (239, 68, 68) arrive à l'écran en (119, 34, 34) — un seuil absolu sur le rouge à 150 ne
     * voyait donc jamais l'anneau, alors qu'il était bel et bien là. La différence entre les
     * canaux, elle, survit au voile : 85 pour un anneau présent, 1 sans anneau. C'est aussi
     * pourquoi le test 2 ci-dessus se contente de « rouge > bleu ».
     *
     * @param {[number, number, number, number]} p
     */
    const estAnneauEtat = (p) => p[0] - Math.max(p[1], p[2]) > 40;

    /**
     * @param {string} health
     * @param {string} suffixe
     */
    const ouvrirMJ = async (health, suffixe) => {
      const sessionId = `test-hp-c13-${suffixe}-${Date.now()}`;
      const snapshot = {
        campaign: {
          schemaVersion: 2,
          campaignId: 'hp-c13-campaign',
          name: 'Campagne PV C13',
          levels: [FAKE_LEVEL],
          links: [],
          // Le boss du scénario du mainteneur : très bas en PV, et ce qu'il en annonce varie.
          tokens: [{ ...FAKE_PNJ, hp: { current: 12, max: 140 }, health }],
          templates: [],
          settings: { ambientLevel: 1 },
        },
        activeLevelId: FAKE_LEVEL.id,
        // Aucune sélection : l'anneau blanc de sélection passe dans la même couronne.
        selectedTokenId: null,
      };
      const page = await context.newPage();
      await installBrowserTransport(page, sessionId, snapshot);
      await page.goto(`/gm.html?session=${sessionId}`);
      await waitForApp(page);
      return page;
    };

    // 1. Garde-fou : annoncé « Mal en point », l'anneau est là, et la sonde le voit.
    const pageCritical = await ouvrirMJ('critical', 'critical');
    await expect
      .poll(async () => estAnneauEtat(await sampleAnnulusPixel(pageCritical, 'boss-1')))
      .toBe(true);
    const pixelCritical = await sampleAnnulusPixel(pageCritical, 'boss-1');

    // 2. Le constat : annoncé « Indemne » à 12/140, aucun anneau. Une dérivation depuis les PV
    //    en dessinerait un — 12/140 est bas quel que soit le seuil qu'on imagine.
    const pageUnharmed = await ouvrirMJ('unharmed', 'unharmed');
    const pixelUnharmed = await sampleAnnulusPixel(pageUnharmed, 'boss-1');

    expect(estAnneauEtat(pixelUnharmed)).toBe(false);
    expect(pixelUnharmed).not.toEqual(pixelCritical);
  });
});
