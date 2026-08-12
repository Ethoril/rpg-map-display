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

const FAKE_TOKEN = {
  id: 'hero-1',
  levelId: 'rdc-level',
  cell: { a: 2, b: 2 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Guerrier',
  hidden: false,
  visionBright: 6,
  visionDim: 12,
  emitsLight: null,
  speedCells: 6,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
};

/** @param {string} sessionId */
function snapshotFor(sessionId) {
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: `eviction-${sessionId}`,
      name: 'Campagne éviction',
      levels: [FAKE_LEVEL],
      links: [],
      tokens: [{ ...FAKE_TOKEN }],
      templates: [],
      settings: {},
    },
    activeLevelId: FAKE_LEVEL.id,
    selectedTokenId: 'hero-1',
  };
}

/**
 * Lit les marqueurs du pion témoin dans une page.
 *
 * Le geste qui les modifie est une case à cocher du panneau MJ, et non `store.updateToken` :
 * muter le store en direct ne publie **rien**. Une première version de ce test s'en servait et
 * passait au vert en ne prouvant rien du tout — l'absence de réception chez le MJ congédié
 * n'aurait rien dit, puisque personne n'avait émis.
 *
 * @param {import('@playwright/test').Page} page
 */
function markersOf(page) {
  return page.evaluate(async () => {
    const store = await import('../js/state/store.js');
    return store.getCampaign()?.tokens.find((t) => t.id === 'hero-1')?.markers ?? null;
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} marker
 */
async function cocherMarqueur(page, marker) {
  await page.click('.gm-tab-btn[data-tab="token-maker"]');
  await page.locator(`.token-marker-checkbox[value="${marker}"]`).check();
}

test.describe('Éviction des sessions MJ concurrentes', () => {
  test('Un MJ congédie l\'autre : écran bloquant, et surtout plus aucune mutation reçue', async ({
    context,
  }) => {
    const sessionId = `test-eviction-${Date.now()}`;
    const snapshot = snapshotFor(sessionId);

    const pageA = await context.newPage();
    const pageB = await context.newPage();
    for (const page of [pageA, pageB]) {
      await installBrowserTransport(page, sessionId, snapshot);
      await page.goto(`/gm.html?session=${sessionId}`);
      await waitForApp(page);
    }

    // CONTRÔLE, avant toute éviction : le même geste qui servira de preuve plus bas traverse
    // bien le canal. Sans ce contrôle, l'assertion « B ne reçoit plus rien » serait vraie même
    // si rien n'avait jamais été émis, et le test serait creux.
    await cocherMarqueur(pageA, 'prone');
    await expect.poll(() => markersOf(pageB)).toEqual(['prone']);

    // Le transport de test ne porte pas la présence : le compte d'autres MJ vient du registre
    // local, qu'on amorce donc à la main. C'est bien ce registre que le bouton interroge.
    const boutonA = pageA.locator('#gm-evict-others');
    await expect(boutonA).toBeDisabled();
    await expect(boutonA).toHaveText('Aucun autre MJ');

    await pageA.evaluate(async () => {
      const presence = await import('../js/state/presence.js');
      presence.updatePresence('c_autre-mj', {
        role: 'gm',
        at: Date.now(),
        build: 35,
        label: 'tablette du salon',
      });
    });
    // Le bouton se relit au retour du focus, pas en continu.
    await pageA.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(boutonA).toBeEnabled();
    await expect(boutonA).toHaveText('Autres MJ (1)');

    // L'écran du congédié nomme le poste qui a agi, et cette étiquette est lue dans SON
    // registre de présence à partir du `clientId` de l'événement. Le transport de test ne
    // partage pas la présence entre pages : sans cet amorçage, l'écran dirait « un autre poste
    // MJ » et l'assertion sur le nom passerait sans jamais avoir exercé la recherche.
    const clientIdA = await pageA.evaluate(
      () => /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.clientId
    );
    await pageB.evaluate(
      async ({ clientId }) => {
        const presence = await import('../js/state/presence.js');
        presence.updatePresence(clientId, {
          role: 'gm',
          at: Date.now(),
          build: 35,
          label: 'portable du MJ',
        });
      },
      { clientId: clientIdA }
    );

    // Sans ce gestionnaire, Playwright referme la confirmation, donc rien n'est publié — et le
    // test passerait au vert en n'ayant rien testé.
    let confirmVu = '';
    pageA.on('dialog', (dialog) => {
      confirmVu = dialog.message();
      dialog.accept();
    });
    await boutonA.click();
    expect(confirmVu).toContain('tablette du salon');

    // 1. L'écran bloquant est là, et il nomme le poste qui a agi.
    await expect(pageB.locator('#gm-evicted')).toBeVisible();
    await expect(pageB.locator('#gm-evicted')).toContainText('reprise ailleurs');
    await expect(pageB.locator('#gm-evicted')).toContainText('portable du MJ');

    // 2. Et surtout : le geste qui passait à l'étape de contrôle ne passe plus. C'est ce qui
    // distingue une véritable déconnexion d'un message posé sur une session toujours vivante.
    await cocherMarqueur(pageA, 'unconscious');
    // L'ordre est celui de STATUS_MARKER_IDS, pas celui des clics : `unconscious` précède
    // `prone` dans la liste close.
    await expect.poll(() => markersOf(pageA)).toEqual(['unconscious', 'prone']);
    await pageA.waitForTimeout(400);
    expect(await markersOf(pageB)).toEqual(['prone']);

    // 3. L'autre sens, et c'est celui qui compte le plus : B ne PUBLIE plus. Ne vérifier que
    // la réception laissait passer un congédié qui continue d'émettre — donc de piloter la
    // table depuis un écran dont on croit s'être débarrassé. Cette assertion tombe si l'on
    // retire `transport.disconnect()` de l'éviction, là où les précédentes survivaient au seul
    // désabonnement.
    await pageB.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP_OPTIONS__.transport.publish({
        type: 'token.update',
        payload: { tokenId: 'hero-1', patch: { elevation: 9 } },
        at: Date.now(),
        by: 'gm',
      });
    });
    await pageA.waitForTimeout(400);
    const elevationA = await pageA.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getCampaign()?.tokens.find((t) => t.id === 'hero-1')?.elevation ?? null;
    });
    expect(elevationA).toBe(0);

    // 4. Le MJ qui a publié l'éviction n'est pas congédié par son propre événement.
    await expect(pageA.locator('#gm-evicted')).toHaveCount(0);

    // 5. Reprendre la main retire l'écran (la page se recharge derrière).
    await pageB.locator('#gm-evicted-reconnect').click();
    await expect(pageB.locator('#gm-evicted')).toHaveCount(0);
  });

  test('La vue joueurs ignore l\'éviction, qui ne concerne que les MJ', async ({ context }) => {
    const sessionId = `test-eviction-joueurs-${Date.now()}`;
    const snapshot = snapshotFor(sessionId);

    const pageGM = await context.newPage();
    const pagePlayers = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);
    await installBrowserTransport(pagePlayers, sessionId, snapshot);
    await pagePlayers.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pagePlayers);

    await pageGM.evaluate(async () => {
      const constants = await import('../js/core/constants.js');
      const app = /** @type {any} */ (window).__RPG_APP_OPTIONS__;
      app.transport.publish({
        type: constants.SESSION_EVICT_GM_EVENT,
        payload: {},
        at: Date.now(),
        by: 'gm',
      });
    });
    await pagePlayers.waitForTimeout(400);

    await expect(pagePlayers.locator('#gm-evicted')).toHaveCount(0);

    // Et la table continue de recevoir la partie — un écran joueurs muet aurait la même
    // apparence qu'un écran joueurs intact.
    await cocherMarqueur(pageGM, 'prone');
    await expect.poll(() => markersOf(pagePlayers)).toEqual(['prone']);
  });
});
