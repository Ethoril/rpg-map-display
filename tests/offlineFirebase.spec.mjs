// @ts-check
import { test, expect } from '@playwright/test';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { waitForApp } from './browserTestTransport.mjs';

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
