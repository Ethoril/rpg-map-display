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

  await page.goto('/gm.html');
  await page.addScriptTag({
    type: 'module',
    content: `
      import * as store from './js/state/store.js';
      import { bootstrapPlayerView } from './js/ui/player/bootstrap.js';
      import { applyNetworkEvent } from './js/app/networkEvents.js';
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
      /** @type {Array<{cell: {a: number, b: number}, kind: 'refused'|'occupied'}>} */
      const destinationFeedbacks = [];
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
        destinationFeedbacks,
        fakeTransport,
        getMounted: () => mounted,
        lastTapLog: null,

        initFixture: (overrides = {}) => {
          if (mounted) {
            mounted.detach();
          }
          netEventsPublished.length = 0;
          destinationFeedbacks.length = 0;
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

          const tokens = [tokenPJ];
          if (overrides.occupied) {
            tokens.push(createToken({
              id: 'token-occupied',
              levelId: 'rdc',
              cell: { a: 3, b: 3 },
              sizeCells: 1,
              kind: 'npc',
            }));
          }

          const campaign = createCampaign({
            levels: [level],
            tokens,
          });

          store.loadCampaign(campaign);

          mounted = bootstrapPlayerView({
            element: canvas,
            camera,
            transport: fakeTransport,
            onDestinationRejected: (cell, kind) => {
              destinationFeedbacks.push({ cell: { ...cell }, kind });
            },
          });
        },

        dispatchIntention: (intention) => {
          if (mounted && mounted.pointerInput) {
            mounted.pointerInput.onIntention(intention);
          }
        },
        dispatchTap: (x, y) => {
          if (mounted && mounted.pointerInput) {
            mounted.pointerInput.onIntention({
              type: 'tap',
              screenPos: { screenX: x, screenY: y },
              mapPos: { x, y },
            });
          }
        },
      };
      fakeTransport.subscribe((event) => applyNetworkEvent(event));
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
      probe.dispatchTap(350, 350);
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
      probe.dispatchTap(630, 630);
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
      probe.dispatchTap(1330, 1330);
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
      probe.dispatchTap(350, 350);
      probe.dispatchTap(490, 490); // case (3,3)
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
      probe.dispatchTap(350, 350);
      probe.dispatchTap(490, 490); // case (3,3)
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
      probe.dispatchTap(350, 350);
      probe.dispatchTap(630, 630);
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

test.describe('T-23 — Vue joueurs autonome', () => {
  test('Zero-UI : pas d\'éléments UI (button, nav, input) et styles CSS appliqués sur player.html', async ({ page }) => {
    await page.goto('/player.html?session=test-zero-ui');

    // 1. Vérification Zero-UI strict (aucun button, nav, input)
    //
    // Une seule tolérance, nommée : le bouton plein écran (dérogation demandée le
    // 30 juillet 2026, cf. CONVENTIONS.md §8, interdiction 2). L'exclure par identifiant
    // plutôt qu'assouplir le compte garde le test capable de refuser tout le reste.
    const uiElementsCount = await page.evaluate(() => {
      const forbidden = Array.from(document.querySelectorAll('button, nav, input')).filter(
        (el) => el.id !== 'player-fullscreen-btn'
      );
      return forbidden.length;
    });
    expect(uiElementsCount).toBe(0);

    // 2. Vérification des styles CSS de verrouillage
    const styles = await page.evaluate(() => {
      const bodyStyle = window.getComputedStyle(document.body);
      const canvas = document.querySelector('canvas');
      const canvasStyle = canvas ? window.getComputedStyle(canvas) : null;
      return {
        overscrollBehavior: bodyStyle.overscrollBehavior || bodyStyle.overscrollBehaviorY,
        touchAction: canvasStyle ? canvasStyle.touchAction : null,
      };
    });

    expect(styles.overscrollBehavior).toBe('none');
    expect(styles.touchAction).toBe('none');
  });

  test('Bouton plein écran : en haut à droite, il entre puis sort du plein écran', async ({
    page,
  }) => {
    await page.goto('/player.html?session=test-fullscreen-btn');

    const bouton = page.locator('#player-fullscreen-btn');
    await expect(bouton).toBeVisible();

    // Ancré en haut à droite, au-dessus du handout (9000) et sous l'alerte de version (9999).
    const ancrage = await page.evaluate(() => {
      const el = /** @type {HTMLElement} */ (document.getElementById('player-fullscreen-btn'));
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        position: style.position,
        zIndex: Number(style.zIndex),
        distanceHaut: rect.top,
        distanceDroite: window.innerWidth - rect.right,
        libelle: el.getAttribute('aria-label'),
      };
    });
    expect(ancrage.position).toBe('fixed');
    expect(ancrage.zIndex).toBeGreaterThan(9000);
    expect(ancrage.zIndex).toBeLessThan(9999);
    expect(ancrage.distanceHaut).toBeLessThan(40);
    expect(ancrage.distanceDroite).toBeLessThan(40);
    expect(ancrage.libelle).toBe('Plein écran');

    // Aller : le tap fait vraiment entrer le document en plein écran.
    await bouton.click();
    await page.waitForFunction(() => document.fullscreenElement !== null, undefined, {
      timeout: 5000,
    });
    await expect(bouton).toHaveAttribute('aria-label', 'Quitter le plein écran');

    // Retour : le même bouton en ressort. C'est ce qui manquait — l'activation au premier
    // geste ne savait qu'entrer.
    await bouton.click();
    await page.waitForFunction(() => document.fullscreenElement === null, undefined, {
      timeout: 5000,
    });
    await expect(bouton).toHaveAttribute('aria-label', 'Plein écran');
  });

  test('Deux onglets synchronisés sur même session : déplacements réciproques', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await mountPlayerViewInPage(page1);
    await mountPlayerViewInPage(page2);

    await page1.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture();
    });
    await page2.evaluate(() => {
      /** @type {any} */ (window).__playerProbe.initFixture();
    });

    await page1.exposeFunction('relayEventToPage2', async (/** @type {any} */ evt) => {
      await page2.evaluate((e) => {
        const transport = /** @type {any} */ (window).__playerProbe.fakeTransport;
        transport.publish(e);
      }, evt);
    });

    await page1.evaluate(() => {
      const transport = /** @type {any} */ (window).__playerProbe.fakeTransport;
      transport.subscribe((/** @type {any} */ evt) => {
        /** @type {any} */ (window).relayEventToPage2(evt);
      });
    });

    await page1.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.dispatchTap(350, 350);
      probe.dispatchTap(630, 630);
    });

    // Le `timeout: 2000` est la garde, et il se suffit : il échouerait si la
    // propagation cessait d'être portée par un événement. La mesure en horloge
    // murale qui le doublait chronométrait en réalité le relais `exposeFunction`
    // entre deux processus Playwright, pas le produit — cf. docs/ETAT.md,
    // « Budgets de latence dans les tests navigateur ».
    await page2.waitForFunction(() => {
      const store = /** @type {any} */ (window).__playerProbe.store;
      const state = store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return token && token.cell.a === 4 && token.cell.b === 4;
    }, { timeout: 2000 });
  });
});

test.describe('T-24 — Persistance & reconnexion', () => {
  test('Recharger vue joueurs pendant séance : état restauré en < 3 s (positions, niveau, caméra)', async ({ page }) => {
    await mountPlayerViewInPage(page);

    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.initFixture();
      // Modifier la position du pion, le niveau actif et la caméra
      probe.store.setSessionId('sess-f5-test');
      probe.store.moveTokenToCell('token-pj', { a: 5, b: 5 });
      probe.camera.setPan(750, 600);
      probe.camera.setZoom(1.5);
      probe.store.saveToLocalStorage('sess-f5-test');
      localStorage.setItem('rpg_camera_sess-f5-test', JSON.stringify({ x: 750, y: 600, zoom: 1.5 }));
    });

    const startTime = Date.now();
    // Simuler F5 en rechargeant la sonde / page
    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.store.loadFromLocalStorage('sess-f5-test');
      const camStr = localStorage.getItem('rpg_camera_sess-f5-test');
      if (camStr) {
        const c = JSON.parse(camStr);
        probe.camera.setPan(c.x, c.y);
        probe.camera.setZoom(c.zoom);
      }
    });

    const restoredState = await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      const state = probe.store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return {
        cell: token.cell,
        levelId: state.activeLevelId,
        camX: probe.camera.x,
        camY: probe.camera.y,
        camZoom: probe.camera.zoom,
      };
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(3000);
    expect(restoredState.cell).toEqual({ a: 5, b: 5 });
    expect(restoredState.levelId).toBe('rdc');
    expect(restoredState.camX).toBe(750);
    expect(restoredState.camY).toBe(600);
    expect(restoredState.camZoom).toBe(1.5);
  });

  test('Déplacer pion MJ -> vérifier apparition côté joueurs après F5 (reprise locale)', async ({ page }) => {
    await mountPlayerViewInPage(page);

    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.initFixture();
      probe.store.setSessionId('sess-recon-test');
    });

    await page.evaluate(() => {
      const probe = /** @type {any} */ (window).__playerProbe;
      const camp = JSON.parse(JSON.stringify(probe.store.getCampaign()));
      camp.tokens[0].cell = { a: 3, b: 4 };
      probe.store.restoreFromSnapshot(camp, { sessionId: 'sess-recon-test' });
    });

    // `loadFromLocalStorage` est synchrone : la durée mesurée ici était celle d'un
    // aller-retour CDP entre Playwright et la page, jamais celle du produit. Ce qui
    // se vérifie, c'est que la reprise locale rend la bonne case.
    const syncState = await page.evaluate(async () => {
      const probe = /** @type {any} */ (window).__playerProbe;
      probe.store.loadFromLocalStorage('sess-recon-test');
      const state = probe.store.getState();
      const token = state.campaign.tokens.find((/** @type {any} */ t) => t.id === 'token-pj');
      return token.cell;
    });

    expect(syncState).toEqual({ a: 3, b: 4 });
  });
});

test.describe('T-24b — Badge de version & détection de désynchronisation', () => {
  test('Sans écart : overlay joueurs a opacity: 0 et pointer-events: none après 5 s', async ({ page }) => {
    await page.goto('/player.html?session=test-overlay-hide');

    // Attendre 4,5 s (le timer cache l'overlay après 4 s)
    await page.waitForTimeout(4500);

    const overlayState = await page.evaluate(() => {
      const el = document.getElementById('player-version-overlay');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      return {
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
      };
    });

    expect(overlayState).not.toBeNull();
    expect(overlayState?.opacity).toBe('0');
    expect(overlayState?.pointerEvents).toBe('none');
  });

  test('Tap à trois doigts rappelle overlay même après disparition', async ({ page }) => {
    await page.goto('/player.html?session=test-overlay-recall');

    // Attendre la disparition (4 s timer)
    await page.waitForTimeout(4500);

    // Simuler le tap à 3 doigts
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('three-finger-tap'));
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 101, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 102, bubbles: true }));
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 103, bubbles: true }));
    });

    await page.waitForFunction(() => {
      const el = document.getElementById('player-version-overlay');
      return el && el.style.opacity === '1';
    }, { timeout: 2000 });

    const recalledOpacity = await page.evaluate(() => {
      const el = document.getElementById('player-version-overlay');
      return el ? el.style.opacity : null;
    });

    expect(recalledOpacity).toBe('1');
  });

  test('Deux onglets, forcer build différent sur l\'un -> bannière MJ et overlay rouge joueurs apparaissent', async ({ page }) => {
    await page.goto('/gm.html');

    const res = await page.evaluate(async () => {
      const vPath = './js/ui/versionBadge.js';
      const pPath = './js/state/presence.js';
      const { mountGMVersionBadge, mountPlayerVersionBadge } = await import(/* @vite-ignore */ /** @type {any} */ (vPath));
      const { updatePresence } = await import(/* @vite-ignore */ /** @type {any} */ (pPath));

      // Simuler la présence d'une tablette avec la build 41
      updatePresence('tablet-client', {
        role: 'players',
        at: Date.now(),
        build: 41,
        label: '0.1.0+41',
      });

      const gmFooter = document.createElement('div');
      document.body.appendChild(gmFooter);
      mountGMVersionBadge(gmFooter, { build: 42 });
      mountPlayerVersionBadge({ build: 42 });

      // Interroger le pied de panneau monté ici, et non `getElementById` : gm.html monte
      // déjà son propre badge, avec le même identifiant et la build réelle du dépôt. La
      // recherche globale tombait donc sur la bannière de l'application — le test lisait un
      // écart 35 vs 41 en croyant vérifier 42 vs 41, et le sens de la consigne lui échappait.
      const gmBanner = gmFooter.querySelector('#version-mismatch-banner-gm');
      const playerOverlay = document.getElementById('player-version-overlay');

      return {
        gmBannerVisible: gmBanner ? window.getComputedStyle(gmBanner).display !== 'none' : false,
        gmBannerText: gmBanner ? gmBanner.textContent : '',
        playerOverlayBg: playerOverlay ? window.getComputedStyle(playerOverlay).backgroundColor : '',
        playerOverlayOpacity: playerOverlay ? window.getComputedStyle(playerOverlay).opacity : '',
      };
    });

    expect(res.gmBannerVisible).toBe(true);
    expect(res.gmBannerText).toContain('41');
    // Ce poste est en 42, la tablette en 41 : c'est bien elle qu'il faut recharger, et le
    // message doit désigner le bon écran — envoyer recharger le mauvais est pire que se taire.
    expect(res.gmBannerText).toContain('La tablette exécute la build 41');
    expect(res.gmBannerText).toContain('Recharge la tablette');
    expect(res.playerOverlayBg).toContain('211, 47, 47'); // rgb(211, 47, 47)
    expect(res.playerOverlayOpacity).toBe('1');
  });

  test('Tablette en retard : le bouton « Mettre à jour » apparaît, seul tapable de l\'overlay', async ({
    page,
  }) => {
    await page.goto('/gm.html');

    await page.evaluate(async () => {
      const vPath = './js/ui/versionBadge.js';
      const pPath = './js/state/presence.js';
      const { mountPlayerVersionBadge } = await import(
        /* @vite-ignore */ /** @type {any} */ (vPath)
      );
      const { updatePresence } = await import(/* @vite-ignore */ /** @type {any} */ (pPath));

      // Le MJ tourne sur la build 43, la tablette sur la 42 : c'est elle qui est en retard.
      updatePresence('gm-client', {
        role: 'gm',
        at: Date.now(),
        build: 43,
        label: '0.1.0+43',
      });
      mountPlayerVersionBadge({ build: 42 });
    });

    const bouton = page.locator('#player-version-update');
    await expect(bouton).toBeVisible();

    const etat = await page.evaluate(() => {
      const overlay = /** @type {HTMLElement} */ (
        document.getElementById('player-version-overlay')
      );
      const button = /** @type {HTMLElement} */ (document.getElementById('player-version-update'));
      return {
        texte: document.getElementById('player-version-text')?.textContent || '',
        overlayPointerEvents: window.getComputedStyle(overlay).pointerEvents,
        boutonPointerEvents: window.getComputedStyle(button).pointerEvents,
      };
    });

    // L'écart est nommé dans le bon sens : c'est cette page qui est périmée.
    expect(etat.texte).toContain('Version périmée');
    expect(etat.texte).toContain('43');
    // La dérogation reste étroite : l'overlay n'intercepte toujours rien, le bouton seul si.
    expect(etat.overlayPointerEvents).toBe('none');
    expect(etat.boutonPointerEvents).toBe('auto');
  });

  test('Un tap sur « Mettre à jour » purge les caches et recharge réellement la page', async ({
    page,
  }) => {
    await page.goto('/gm.html');

    await page.evaluate(async () => {
      const vPath = './js/ui/versionBadge.js';
      const pPath = './js/state/presence.js';
      const { mountPlayerVersionBadge } = await import(
        /* @vite-ignore */ /** @type {any} */ (vPath)
      );
      const { updatePresence } = await import(/* @vite-ignore */ /** @type {any} */ (pPath));

      updatePresence('gm-client', { role: 'gm', at: Date.now(), build: 43, label: '0.1.0+43' });
      mountPlayerVersionBadge({ build: 42 });

      // Marqueur volontairement non persistant : seul un vrai rechargement le fait
      // disparaître. Un `update()` qui se contenterait de changer le libellé le laisserait.
      /** @type {any} */ (window).__avantMiseAJour = true;
    });

    expect(await page.evaluate(() => /** @type {any} */ (window).__avantMiseAJour)).toBe(true);

    await page.locator('#player-version-update').click();

    await page.waitForFunction(
      () => /** @type {any} */ (window).__avantMiseAJour === undefined,
      undefined,
      { timeout: 15_000 }
    );
  });
});

test('Vue joueurs : une destination refusée ou occupée déclenche un retour transitoire ciblé', async ({ page }) => {
  await mountPlayerViewInPage(page);

  await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__playerProbe;
    probe.initFixture({ occupied: true });
    probe.dispatchTap(350, 350); // sélection du PJ en (2,2)
    probe.dispatchTap(490, 490); // case (3,3), occupée par un PNJ
  });

  const occupied = await page.evaluate(
    () => /** @type {any} */ (window).__playerProbe.destinationFeedbacks
  );
  expect(occupied).toEqual([{ cell: { a: 3, b: 3 }, kind: 'occupied' }]);

  await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__playerProbe;
    probe.initFixture();
    probe.dispatchTap(350, 350); // sélection du PJ en (2,2)
    probe.dispatchTap(1190, 350); // case (8,2), valide mais hors portée
  });

  const refused = await page.evaluate(
    () => /** @type {any} */ (window).__playerProbe.destinationFeedbacks
  );
  expect(refused).toEqual([{ cell: { a: 8, b: 2 }, kind: 'refused' }]);
});
