// @ts-check
import { test, expect } from '@playwright/test';
import { RENDER_RESOLUTION_CAP } from '../js/core/constants.js';

// Vérification de T-15 sur la VRAIE application Pixi v8, chargée par l'import map
// d'index.html. C'était le critère du contrat ; il avait été satisfait par un test
// unitaire contre un faux Pixi, ce qui ne prouvait rien du comportement réel.
//
// Ce qui reste NON vérifiable ici et demande la tablette physique (interdiction n°14) :
// la tenue à 30 fps sous cast, le comportement thermique, le MAX_TEXTURE_SIZE réel.

/**
 * Charge index.html, monte la scène et attend que la sonde soit publiée.
 * @param {import('@playwright/test').Page} page
 */
async function mountStage(page) {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/index.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountStage.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__stageProbe));

  // Un échec de chargement de Pixi doit être visible, pas silencieux.
  expect(erreurs).toEqual([]);
}

test('les couches sont créées dans l’ordre de ARCHITECTURE.md §5', async ({ page }) => {
  await mountStage(page);

  const layerOrder = await page.evaluate(
    () => /** @type {any} */ (window).__stageProbe.layerOrder
  );

  // fogLayer APRÈS tokens : c'est ce qui garantit mécaniquement l'interdiction n°3.
  expect(layerOrder).toEqual([
    'background',
    'gridLayer',
    'moveZone',
    'templates',
    'tokens',
    'fogLayer',
  ]);
});

test('la résolution est plafonnée et le ticker ne tourne pas de lui-même', async ({ page }) => {
  await mountStage(page);

  const { resolution, tickerStarted } = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return { resolution: probe.resolution, tickerStarted: probe.tickerStarted };
  });

  expect(resolution).toBeLessThanOrEqual(RENDER_RESOLUTION_CAP);
  expect(tickerStarted).toBe(false);
});

test('les demandes de frame sont coalescées et la boucle s’arrête à l’inactivité', async ({
  page,
}) => {
  await mountStage(page);

  // Trois demandes dans le même tick doivent produire une seule frame.
  await page.evaluate(() => /** @type {any} */ (window).__stageProbe.requestFrames(3));
  await expect
    .poll(() => page.evaluate(() => /** @type {any} */ (window).__stageProbe.frameCount()))
    .toBe(1);

  const running = await page.evaluate(() =>
    /** @type {any} */ (window).__stageProbe.loopRunning()
  );
  expect(running).toBe(false);

  // Critère de T-15 : après 2 s d'inactivité, le compteur n'augmente plus.
  await page.waitForTimeout(2000);
  const apresInactivite = await page.evaluate(() =>
    /** @type {any} */ (window).__stageProbe.frameCount()
  );
  expect(apresInactivite).toBe(1);
});
