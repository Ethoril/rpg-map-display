// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Monte la sonde d'interaction de la vue joueurs dans la page.
 * @param {import('@playwright/test').Page} page
 */
async function mountPlayerViewInPage(page) {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/index.html');
  await page.addScriptTag({
    type: 'module',
    content: `
      import * as store from './js/state/store.js';
      import { bootstrapPlayerView } from './js/ui/player/bootstrap.js';
      import { createCampaign, createLevel, createToken } from './js/core/schema.js';
      import { Camera } from './js/render/camera.js';

      const canvas = document.createElement('canvas');
      canvas.id = 'board';
      canvas.width = 1400;
      canvas.height = 1120;
      document.body.appendChild(canvas);

      const camera = new Camera(canvas.width, canvas.height);

      /** @type {any[]} */
      const netEventsPublished = [];
      /** @type {Set<(evt: any) => void>} */
      const transportListeners = new Set();

      const fakeTransport = {
        connect: async () => {},
        publish: (/** @type {any} */ evt) => {
          netEventsPublished.push(evt);
          for (const listener of Array.from(transportListeners)) {
            listener(evt);
          }
        },
        subscribe: (/** @type {(evt: any) => void} */ cb) => {
          transportListeners.add(cb);
          return () => transportListeners.delete(cb);
        },
        snapshot: async () => ({}),
        disconnect: () => {},
      };

      let mounted = null;

      window.__playerProbe = {
        store,
        camera,
        bootstrapPlayerView,
        createCampaign,
        createLevel,
        createToken,
        canvas,
        netEventsPublished,
        fakeTransport,
        getMounted: () => mounted,
        lastTapLog: null,

        initFixture: (overrides = {}) => {
          if (mounted) {
            mounted.detach();
          }
          netEventsPublished.length = 0;
          camera.setPan(canvas.width / 2, canvas.height / 2);

          const level = createLevel({
            id: 'rdc',
            pxPerCell: 140,
            widthCells: 10,
            heightCells: 8,
          });

          const tokenPJ = createToken({
            id: 'token-pj',
            levelId: 'rdc',
            cell: { a: 2, b: 2 },
            sizeCells: 1,
            kind: 'pc',
            speedCells: 3,
            playerMovable: overrides.playerMovable ?? true,
            locked: overrides.locked ?? false,
          });

          const campaign = createCampaign({
            levels: [level],
            tokens: [tokenPJ],
          });

          store.loadCampaign(campaign);

          mounted = bootstrapPlayerView({
            element: canvas,
            camera,
            transport: fakeTransport,
          });
        },

        dispatchIntention: (intention) => {
          if (mounted && mounted.pointerInput) {
            mounted.pointerInput.onIntention(intention);
          }
        },
      };
    `,
  });

  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__playerProbe));
  expect(erreurs).toEqual([]);
}

test.describe('T-20 — Déplacement type plateau (vue joueurs)', () => {

  test('Enchaînement nominal : tap pion -> sélection + surlignage, tap case atteignable -> déplacement accepté', async ({ page }) => {
    await mountPlayerViewInPage(page);

    await page.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture({
        playerMovable: true,
        locked: false,
      });
    });

    // 1. Tap pion à (2,2) (centre de la case = x: 350, y: 350) -> sélection + cases atteignables calculées
    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.dispatchIntention({ type: 'tapToken', at: { screenX: 350, screenY: 350 } });
    });

    const stateSelected = await page.evaluate(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      return {
        selectedTokenId: state.selectedTokenId,
        reachableCount: state.reachableCells.size,
        reachableHas4_4: state.reachableCells.has('4,4'),
      };
    });

    expect(stateSelected.selectedTokenId).toBe('token-pj');
    expect(stateSelected.reachableCount).toBeGreaterThan(0);
    expect(stateSelected.reachableHas4_4).toBe(true);

    // 2. Tap case (4,4) (distance 2 <= speedCells 3) -> déplacement accepté
    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      // Centre de la case (4,4) à 140px par case = (4.5 * 140, 4.5 * 140) = (630, 630)
      probe.dispatchIntention({ type: 'tapCell', at: { x: 630, y: 630 } });
    });

    const stateMoved = await page.evaluate(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const probe = /** @type {any} */ (window).__playerProbe;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return {
        cell: token.cell,
        isIntegerA: Number.isInteger(token.cell.a),
        isIntegerB: Number.isInteger(token.cell.b),
        move: token.move,
        netEventsCount: probe.netEventsPublished.length,
        lastNetEvent: probe.netEventsPublished[0],
      };
    });

    expect(stateMoved.cell).toEqual({ a: 4, b: 4 });
    expect(stateMoved.isIntegerA).toBe(true);
    expect(stateMoved.isIntegerB).toBe(true);
    expect(stateMoved.move.from).toEqual({ a: 2, b: 2 });
    expect(stateMoved.move.to).toEqual({ a: 4, b: 4 });
    expect(Array.isArray(stateMoved.move.path)).toBe(true);

    // Aucune position intermédiaire publiée : exactement un événement réseau final
    expect(stateMoved.netEventsCount).toBe(1);
    expect(stateMoved.lastNetEvent.type).toBe('token.move');
    expect(stateMoved.lastNetEvent.payload.to).toEqual({ a: 4, b: 4 });

    // 3. Tap case hors portée (9,9) (distance > speedCells) -> refus de déplacement, désélection
    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      // Centre de la case (9,9) = (9.5 * 140, 9.5 * 140) = (1330, 1330)
      probe.dispatchIntention({ type: 'tapCell', at: { x: 1330, y: 1330 } });
    });

    const stateRefused = await page.evaluate(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return {
        cell: token.cell,
        selectedTokenId: state.selectedTokenId,
      };
    });

    // Le pion est resté à (4,4) et la sélection est réinitialisée à null
    expect(stateRefused.cell).toEqual({ a: 4, b: 4 });
    expect(stateRefused.selectedTokenId).toBeNull();
  });

  test('Flags de sécurité : playerMovable: false et locked: true bloquent le déplacement', async ({ page }) => {
    await mountPlayerViewInPage(page);

    // 1. Test playerMovable: false
    await page.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture({
        playerMovable: false,
        locked: false,
      });
    });

    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.dispatchIntention({ type: 'tapToken', at: { screenX: 350, screenY: 350 } });
      probe.dispatchIntention({ type: 'tapCell', at: { x: 490, y: 490 } }); // case (3,3)
    });

    const resUnmovable = await page.evaluate(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return token.cell;
    });

    // Pion doit rester sur sa case initiale (2,2)
    expect(resUnmovable).toEqual({ a: 2, b: 2 });

    // 2. Test locked: true
    await page.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture({
        playerMovable: true,
        locked: true,
      });
    });

    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.dispatchIntention({ type: 'tapToken', at: { screenX: 350, screenY: 350 } });
      probe.dispatchIntention({ type: 'tapCell', at: { x: 490, y: 490 } }); // case (3,3)
    });

    const resLocked = await page.evaluate(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return token.cell;
    });

    // Pion locked reste sur place (2,2)
    expect(resLocked).toEqual({ a: 2, b: 2 });
  });

  test('Deux onglets : déplacement en vue joueurs répercuté avec le payload token.move', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await mountPlayerViewInPage(page1);
    await mountPlayerViewInPage(page2);

    // Initialiser la même campagne sur les 2 onglets et relier leur transport fictif
    await page1.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture();
    });
    await page2.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture();
    });

    // Relier la sortie réseau de page1 à l'entrée de page2 et vice-versa
    await page1.exposeFunction('emitToPage2', async (/** @type {any} */ evt) => {
      await page2.evaluate((eventData) => {
        const transport = /** @type {any} */ (window).__playerProbe.fakeTransport;
        transport.publish(eventData);
      }, evt);
    });

    await page1.evaluate(() => {
      const transport = /** @type {any} */ (window).__playerProbe.fakeTransport;
      transport.subscribe((/** @type {any} */ evt) => {
        /** @type {any} */ (window).emitToPage2(evt);
      });
    });

    // Onglet 1 : effectue un déplacement de (2,2) à (4,4)
    await page1.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.dispatchIntention({ type: 'tapToken', at: { screenX: 350, screenY: 350 } });
      probe.dispatchIntention({ type: 'tapCell', at: { x: 630, y: 630 } });
    });

    // Attendre la synchronisation réseau sur Onglet 2
    await page2.waitForFunction(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return token && token.cell.a === 4 && token.cell.b === 4;
    });

    const page2State = await page2.evaluate(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return {
        cell: token.cell,
        isIntegerA: Number.isInteger(token.cell.a),
        isIntegerB: Number.isInteger(token.cell.b),
        move: token.move,
      };
    });

    expect(page2State.cell).toEqual({ a: 4, b: 4 });
    expect(page2State.isIntegerA).toBe(true);
    expect(page2State.isIntegerB).toBe(true);
    expect(page2State.move.from).toEqual({ a: 2, b: 2 });
    expect(page2State.move.to).toEqual({ a: 4, b: 4 });
    expect(Array.isArray(page2State.move.path)).toBe(true);
  });
});
