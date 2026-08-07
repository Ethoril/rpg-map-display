// @ts-check
import { test, expect } from '@playwright/test';
import { RENDER_RESOLUTION_CAP } from '../js/core/constants.js';

/** @param {import('@playwright/test').Page} page */
async function mountStage(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ error) => errors.push(error.message));
  await page.goto('/gm.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountStage.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__stageProbe));
  expect(errors).toEqual([]);
}

test('la pile appelle les vraies fonctions de rendu dans l’ordre canonique', async ({ page }) => {
  await mountStage(page);
  expect(await page.evaluate(() => /** @type {any} */ (window).__stageProbe.layerOrder)).toEqual([
    'background',
    'grid',
    'moveZone',
    'templates',
    'tokens',
    'fog',
    'feedback',
  ]);
});

test('le stage expose des dimensions logiques cohérentes et une résolution plafonnée', async ({ page }) => {
  await mountStage(page);
  const result = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return { resolution: probe.resolution, ...probe.logicalSize() };
  });
  expect(result.resolution).toBeLessThanOrEqual(RENDER_RESOLUTION_CAP);
  expect(result.width).toBeGreaterThan(0);
  expect(result.height).toBeGreaterThan(0);
  expect(result.backingWidth).toBe(Math.round(result.width * result.resolution));
  expect(result.backingHeight).toBe(Math.round(result.height * result.resolution));
});

test('trois invalidations sont coalescées puis la boucle reste inactive', async ({ page }) => {
  await mountStage(page);
  await page.evaluate(() => /** @type {any} */ (window).__stageProbe.requestFrames(3));
  await expect.poll(
    () => page.evaluate(() => /** @type {any} */ (window).__stageProbe.frameCount())
  ).toBe(1);
  expect(await page.evaluate(() => /** @type {any} */ (window).__stageProbe.loopRunning())).toBe(false);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => /** @type {any} */ (window).__stageProbe.frameCount())).toBe(1);
});

test('le fond charge une URL réelle, invalide une fois au chargement, puis une seconde fois quand le décodage se résout', async ({ page }) => {
  await mountStage(page);
  const result = await page.evaluate(
    () => /** @type {any} */ (window).__stageProbe.testBackgroundLoad('/maps/minimal.webp')
  );
  expect(result.status).toBe('ready');
  // Le chargement invalide une fois, comme avant le chantier P.
  expect(result.loadInvalidations).toBe(1);
  // Le premier rendu est FROID et n'invalide pas de lui-même : il lance un décodage et rend la main.
  // Si ce compte montait à 2 ici, `render` aurait invalidé en synchrone, donc décodé dans la frame.
  expect(result.invalidationsApresFroid).toBe(1);
  // La résolution du décodage invalide, et elle seule.
  expect(result.invalidations).toBe(2);
  // La frame d'après peint la carte pleine taille, sans que l'horloge du test ait avancé.
  expect(result.center.a).toBeGreaterThan(0);
});

test('un chargement obsolète ne réaffiche jamais l’ancien fond et une erreur est retentable', async ({ page }) => {
  await mountStage(page);
  const result = await page.evaluate(
    () => /** @type {any} */ (window).__stageProbe.testBackgroundRaceAndRetry()
  );
  expect(result.afterObsolete).toEqual({
    status: 'loading',
    hasImage: false,
    invalidations: 0,
  });
  expect(result.afterError.status).toBe('error');
  expect(result.afterError.invalidations).toBe(1);
  expect(result.afterRetry).toEqual({
    status: 'ready',
    currentUrl: '/second.webp',
    invalidations: 2,
  });
});
