// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('G-03 — Mesure de distance au geste (E2E)', () => {
  test('1. Bouton armé, mesure d’une distance octile (différente du vol d’oiseau) et absence de publication réseau', async ({ page }) => {
    const sessionId = `test-measure-e2e-1-${Date.now()}`;
    /** @type {Array<any>} */
    const eventsPublies = [];

    await installBrowserTransport(page, sessionId, null);

    // Espionner les événements publiés par le transport
    await page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      const origPublish = w.__RPG_TRANSPORT_PUBLISH__;
      w.__PUBLISHED_EVENTS__ = [];
      w.__RPG_TRANSPORT_PUBLISH__ = (/** @type {any} */ event) => {
        w.__PUBLISHED_EVENTS__.push(event);
        if (origPublish) origPublish(event);
      };
    });

    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);
      const level = schema.createLevel({
        id: 'level-measure',
        name: 'Étage Mesure',
        widthCells: 10,
        heightCells: 10,
        pxPerCell: 140,
      });
      store.loadCampaign(schema.createCampaign({ levels: [level] }));
    });

    // Armer l'outil de mesure
    const btnMeasure = page.locator('#gm-measure-arm');
    await expect(btnMeasure).toBeVisible();
    await btnMeasure.click();
    await expect(btnMeasure).toHaveAttribute('aria-pressed', 'true');

    // Tap 1 : Point A à {x: 70, y: 70} (centre de la case {a:0, b:0})
    await page.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      app.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 70, y: 70 },
        screenPos: { x: 70, y: 70 },
      });
    });

    const measureAfterTap1 = await page.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      return app.getCurrentMeasure?.();
    });
    expect(measureAfterTap1).not.toBeNull();
    expect(measureAfterTap1?.start).toEqual({ x: 70, y: 70 });
    expect(measureAfterTap1?.end).toBeNull();

    // Tap 2 : Point B à {x: 490, y: 210} (centre de la case {a:3, b:1})
    // ⚠ Couple (0,0) -> (3,1) : distance octile = 3.5, distance euclidienne = sqrt(10) ≈ 3.16.
    await page.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      app.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 490, y: 210 },
        screenPos: { x: 490, y: 210 },
      });
    });

    const measureAfterTap2 = await page.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      return app.getCurrentMeasure?.();
    });

    expect(measureAfterTap2).not.toBeNull();
    expect(measureAfterTap2?.end).toEqual({ x: 490, y: 210 });

    // ⭐ Assertion 1 : La distance est l'octile (3.5 cases), pas la distance euclidienne (3.16)
    expect(measureAfterTap2?.distance).toBe(3.5);

    // L'outil doit s'être désarmé au second tap
    await expect(btnMeasure).toHaveAttribute('aria-pressed', 'false');

    // ⭐ Assertion 2 : Aucun événement n'a été publié sur le réseau pendant la mesure
    const events = await page.evaluate(() => /** @type {any} */ (window).__PUBLISHED_EVENTS__ || []);
    const measureEvents = events.filter((/** @type {any} */ e) => e.type === 'measure' || e.type === 'ping');
    expect(measureEvents, 'aucun événement de mesure ou ping ne doit être publié').toEqual([]);
  });
});
