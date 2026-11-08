// @ts-check
import { test, expect } from '@playwright/test';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * R0-03 — le repli local ne doit pas seulement afficher son badge : il doit pouvoir démarrer
 * et jouer une campagne persistée sans que le graphe Firebase soit même résolu.
 */
test('R0-03 : une session locale joue avec le CDN Firebase bloqué', async ({ page }) => {
  const sessionId = `offline-cdn-${Date.now()}`;
  const level = createLevel({
    id: 'offline-level',
    pxPerCell: 100,
    widthCells: 10,
    heightCells: 8,
  });
  const campaign = createCampaign({
    campaignId: 'offline-campaign',
    levels: [level],
    tokens: [
      createToken({
        id: 'offline-hero',
        levelId: level.id,
        cell: { a: 2, b: 2 },
        speedCells: 3,
      }),
    ],
  });

  /** @type {string[]} */
  const gstaticRequests = [];
  /** @type {string[]} */
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('https://www.gstatic.com/firebasejs/**', async (route) => {
    gstaticRequests.push(route.request().url());
    await route.abort();
  });

  // Le contexte de test est normalement vierge, mais supprimer les deux domiciles de
  // configuration rend le test explicite et le protège d'un serveur réutilisé.
  await page.addInitScript(() => {
    delete /** @type {any} */ (window).RPG_FIREBASE_CONFIG;
    localStorage.removeItem('rpg-firebase-config');
    localStorage.removeItem('rpg-diag-firebase-config');
  });

  // On installe une vraie campagne locale avant d'ouvrir la vue joueurs, comme après une
  // précédente utilisation hors ligne. Les deux intentions qui suivent passent par le vrai
  // gestionnaire de la vue montée, pas par une mutation directe du store. La chaîne physique
  // PointerEvent -> intention est couverte séparément par tests/input.spec.mjs.
  await page.goto('/');
  await page.evaluate(
    ({ storedSessionId, storedCampaign, activeLevelId }) => {
      localStorage.setItem(`rpg_campaign_${storedSessionId}`, JSON.stringify(storedCampaign));
      localStorage.setItem(
        `rpg_session_${storedSessionId}`,
        JSON.stringify({ activeLevelId, selectedTokenId: null, activeHandout: null })
      );
    },
    { storedSessionId: sessionId, storedCampaign: campaign, activeLevelId: level.id }
  );

  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);

  await expect(page.locator('#network-status-players')).toHaveAttribute('data-status', 'local');
  expect(gstaticRequests).toEqual([]);
  expect(pageErrors).toEqual([]);

  await page.evaluate(() => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    app.pointerInput.onIntention({
      type: 'tap',
      screenPos: app.camera.mapToScreen({ x: 250, y: 250 }),
      mapPos: { x: 250, y: 250 },
    });
  });
  await expect
    .poll(() =>
      page.evaluate(async () => (await import('../js/state/store.js')).getSelectedToken()?.id)
    )
    .toBe('offline-hero');

  await page.evaluate(() => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    app.pointerInput.onIntention({
      type: 'tap',
      screenPos: app.camera.mapToScreen({ x: 450, y: 450 }),
      mapPos: { x: 450, y: 450 },
    });
  });
  await page.evaluate(() => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    app.pointerInput.onIntention({
      type: 'tap',
      screenPos: app.camera.mapToScreen({ x: 450, y: 450 }),
      mapPos: { x: 450, y: 450 },
    });
  });

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const store = await import('../js/state/store.js');
        const token = store.getCampaign()?.tokens.find((item) => item.id === 'offline-hero');
        return token?.cell;
      })
    )
    .toEqual({ a: 4, b: 4 });

  const persistedCell = await page.evaluate((storedSessionId) => {
    const saved = localStorage.getItem(`rpg_campaign_${storedSessionId}`);
    return JSON.parse(saved || '{}').tokens?.find((/** @type {any} */ item) => item.id === 'offline-hero')
      ?.cell;
  }, sessionId);
  expect(persistedCell).toEqual({ a: 4, b: 4 });
  expect(gstaticRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// ── Audit du 08/11/2026 : A13 et A9 — une coupure se voit au badge ──────────────────────────

// A13 — navigateur ordinaire (configuration Firebase active), CDN bloqué : avant, la campagne
// s'ouvrait avec un badge vide et rien ne reprenait jamais.
test('A13 : un SDK injoignable au démarrage se dit « hors ligne » et la partie locale s’ouvre', async ({ browser }) => {
  const sid = `audit-cdn-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 5, heightCells: 5 });
  const token = createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 1, b: 1 } });
  const campaign = createCampaign({ campaignId: sid, levels: [level], tokens: [token] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    /** @type {string[]} */
    const blocked = [];
    await page.route('https://www.gstatic.com/firebasejs/**', async route => {
      blocked.push(route.request().url());
      await route.abort();
    });
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false }));
    await page.goto('/');
    await page.evaluate(({ sessionId, data }) => {
      localStorage.setItem(`rpg_campaign_${sessionId}`, JSON.stringify(data));
    }, { sessionId: sid, data: campaign });
    await page.goto(`/gm.html?session=${sid}`);
    await waitForApp(page);
    expect(blocked.length).toBeGreaterThan(0);
    expect(await page.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.id)).toBe('hero');
    await expect(page.locator('#network-status-gm')).toHaveAttribute('data-status', /^(offline|error)$/, { timeout: 2000 });
  } finally {
    await context.close();
  }
});

// A13, suite — Chromium garde l'échec d'un import() en cache : seule la page rechargée peut
// charger le SDK. Le CDN revenu (la sonde répond), la page se recharge d'elle-même.
test('A13 : le CDN revenu, la page se recharge pour repartir en ligne', async ({ browser }) => {
  const sid = `a13-retour-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 5, heightCells: 5 });
  const campaign = createCampaign({ campaignId: sid, levels: [level], tokens: [createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 1, b: 1 } })] });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    let cdnRevenu = false;
    // Les modules restent bloqués (la page rechargée retombera hors ligne : peu importe ici) ;
    // seule la sonde, une requête `fetch`, voit le CDN revenir.
    await page.route('https://www.gstatic.com/firebasejs/**', (route) =>
      cdnRevenu && route.request().resourceType() === 'fetch' ? route.fulfill({ status: 200, body: '' }) : route.abort());
    await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false }));
    await page.goto('/');
    await page.evaluate(({ sessionId, data }) => localStorage.setItem(`rpg_campaign_${sessionId}`, JSON.stringify(data)), { sessionId: sid, data: campaign });
    await page.goto(`/gm.html?session=${sid}`);
    await waitForApp(page);
    await expect(page.locator('#network-status-gm')).toHaveAttribute('data-status', 'offline');
    await page.evaluate(() => { /** @type {any} */ (window).__avantRechargement = true; });
    cdnRevenu = true;
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__avantRechargement === true), { timeout: 10000, message: 'la page a été rechargée' }).toBe(false);
  } finally {
    await context.close();
  }
});

// A9 — une coupure du temps réel ne lève aucune erreur : le badge le disait « connecté ».
test('A9 : la coupure puis le retour du temps réel se lisent au badge, MJ comme tablette', async ({ browser }) => {
  const sid = `a9-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 5, heightCells: 5 });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level] }), activeLevelId: 'a' };
  const context = await browser.newContext();
  try {
    for (const role of /** @type {const} */ (['gm', 'players'])) {
      const page = await context.newPage();
      await installBrowserTransport(page, sid, snapshot);
      await page.goto(`/${role === 'gm' ? 'gm' : 'player'}.html?session=${sid}`);
      await waitForApp(page);
      const badge = page.locator(`#network-status-${role}`);
      await expect(badge).toHaveAttribute('data-status', 'connected');
      await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.setConnected(false));
      await expect(badge).toHaveAttribute('data-status', 'offline');
      await expect(badge, 'visible, même sur la tablette').toBeVisible();
      await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.setConnected(true));
      await expect(badge).toHaveAttribute('data-status', 'connected');
      if (role === 'players') await expect(badge).toBeHidden();
    }
  } finally {
    await context.close();
  }
});
