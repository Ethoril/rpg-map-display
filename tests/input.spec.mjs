// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Seuils désarmant l'appui long.
 *
 * Un maintien exprimé en durée fixe n'est sûr que si le geste n'a **pas** de
 * borne supérieure. Or il en a une : au-delà de `longPressMs` (500 ms par
 * défaut), `PointerInput` bascule `mode = 'longPress'`
 * (`js/input/pointer.js:238`) et le déplacement qui suit ne produit plus jamais
 * de `panBy` ni de `dragToken`. Un maintien de 180 ms n'a donc que 320 ms de
 * marge, et une page affamée la consomme : l'intention attendue n'arrive jamais,
 * et aucune attente d'observation, même de 5 s, ne la fera apparaître.
 *
 * Les tests qui veulent « au-delà du seuil de drag, mais pas un appui long »
 * repoussent donc ce seuil hors d'atteinte au lieu de parier sur l'horloge.
 */
const SANS_APPUI_LONG = { longPressMs: 100_000 };

/**
 * Helper pour monter la scène gm.html avec le Probe d'input.
 * @param {import('@playwright/test').Page} page
 * @param {'players'|'gm'} [role='players']
 * @param {{longPressMs?: number, dragHoldMs?: number}} [options] seuils temporels
 */
async function mountInputStage(page, role = 'players', options = {}) {
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (err) => erreurs.push(err.message));

  await page.goto('/gm.html');
  await page.addScriptTag({ type: 'module', url: '/tests/mountStage.mjs' });
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__stageProbe));

  expect(erreurs).toEqual([]);

  await page.evaluate(
    ({ r, o }) => {
      const probe = /** @type {any} */ (window).__stageProbe;
      probe.setupInput(r, true, o);
    },
    { r: role, o: options }
  );
}

/**
 * Attend qu'une intention du type demandé ait été émise.
 *
 * Remplace les attentes de durée fixe qui rendaient ce fichier instable : sous
 * charge CPU, quelques dizaines de millisecondes ne suffisent pas et le probe
 * est encore vide. Ne pas revenir à un `waitForTimeout` et ne pas rallonger la
 * durée « pour que ça passe » — c'est le contournement que cette fonction
 * supprime.
 *
 * La caméra est modifiée synchronement dans le handler d'intention
 * (`tests/mountStage.mjs`), donc voir l'intention suffit : son effet est déjà
 * appliqué, il n'y a pas de frame à attendre en plus.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} type
 */
async function waitForIntention(page, type) {
  await expect
    .poll(() =>
      page.evaluate(
        (attendu) =>
          /** @type {any} */ (window).__stageProbe
            .getIntentions()
            .filter((/** @type {any} */ item) => item.type === attendu).length,
        type
      )
    )
    .toBeGreaterThan(0);
}

test('Vue joueurs — Interdiction #1 : drag 1 doigt déplace la caméra (panBy) et ne génère aucun dragToken', async ({ page }) => {
  await mountInputStage(page, 'players');

  const initialCam = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return { x: probe.camera.x, y: probe.camera.y };
  });

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const startX = canvasBox.x + 100;
  const startY = canvasBox.y + 100;
  const endX = canvasBox.x + 150;
  const endY = canvasBox.y + 100;

  // Simulation d'un drag 1 doigt : pointerdown -> pointermove -> pointerup
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();

  await waitForIntention(page, 'panBy');

  const finalCam = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return { x: probe.camera.x, y: probe.camera.y };
  });

  const intentions = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  // Vérifier qu'une intention panBy a été émise avec deltaX = 50 (150 - 100)
  const panIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'panBy');
  expect(panIntentions.length).toBeGreaterThan(0);

  const totalDeltaX = panIntentions.reduce(/** @param {number} sum @param {any} i */ (sum, i) => sum + i.deltaX, 0);
  expect(totalDeltaX).toBe(50);

  // La caméra a panné de l'effet inverse (-50, 0)
  expect(finalCam.x).toBeCloseTo(initialCam.x - 50, 1);
  expect(finalCam.y).toBeCloseTo(initialCam.y, 1);

  // AUCUNE intention dragToken en vue joueurs ! (Strict prohibition #1)
  const dragTokenIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'dragToken');
  expect(dragTokenIntentions).toHaveLength(0);
});

test('un micro-mouvement reste un tap unique et ne déplace pas la caméra', async ({ page }) => {
  await mountInputStage(page, 'players');
  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  await page.mouse.move(canvasBox.x + 120, canvasBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 123, canvasBox.y + 121);
  await page.mouse.up();
  await waitForIntention(page, 'tap');

  const intentions = await page.evaluate(
    () => /** @type {any} */ (window).__stageProbe.getIntentions()
  );
  expect(intentions.filter((/** @type {any} */ item) => item.type === 'tap')).toHaveLength(1);
  expect(intentions.filter((/** @type {any} */ item) => item.type === 'panBy')).toHaveLength(0);
  expect(intentions.filter((/** @type {any} */ item) => item.type === 'dragToken')).toHaveLength(0);
});

test('Vue MJ — un drag commencé hors pion pan la caméra sans déplacer de pion', async ({ page }) => {
  await mountInputStage(page, 'gm');
  // `canDrag: false` — aucun pion sous le doigt — et appui long désarmé.
  await page.evaluate(
    (o) => /** @type {any} */ (window).__stageProbe.setupInput('gm', false, o),
    SANS_APPUI_LONG
  );
  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  await page.mouse.move(canvasBox.x + 180, canvasBox.y + 180);
  await page.mouse.down();
  // Durée du geste, pas attente d'un résultat : maintien au-delà de
  // DRAG_HOLD_MS pour montrer que sans pion sous le doigt, le drag pan quand même.
  // La borne supérieure est désarmée par SANS_APPUI_LONG, donc un dépassement
  // sous charge ne reclasse plus le geste en appui long.
  await page.waitForTimeout(180);
  await page.mouse.move(canvasBox.x + 240, canvasBox.y + 180, { steps: 4 });
  await page.mouse.up();
  await waitForIntention(page, 'panBy');

  const intentions = await page.evaluate(
    () => /** @type {any} */ (window).__stageProbe.getIntentions()
  );
  expect(intentions.some((/** @type {any} */ item) => item.type === 'panBy')).toBe(true);
  expect(intentions.some((/** @type {any} */ item) => item.type === 'dragToken')).toBe(false);
});

test('Vue MJ — Drag d un doigt au-delà du seuil émet une intention dragToken avec screenPos et mapPos', async ({ page }) => {
  // Appui long désarmé : le maintien ci-dessous doit dépasser DRAG_HOLD_MS sans
  // risquer de franchir longPressMs sous charge.
  await mountInputStage(page, 'gm', SANS_APPUI_LONG);

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const startX = canvasBox.x + 200;
  const startY = canvasBox.y + 200;
  const endX = canvasBox.x + 280;
  const endY = canvasBox.y + 200;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Durée du geste, pas attente d'un résultat.
  await page.waitForTimeout(200); // Maintien > DRAG_HOLD_MS (150ms)
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();

  await waitForIntention(page, 'dragToken');

  const intentions = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  const dragTokenIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'dragToken');
  expect(dragTokenIntentions.length).toBeGreaterThan(0);

  const lastDrag = dragTokenIntentions[dragTokenIntentions.length - 1];
  expect(lastDrag.screenPos).toBeDefined();
  expect(lastDrag.screenPos.screenX).toBeDefined();
  expect(lastDrag.screenPos.screenY).toBeDefined();

  expect(lastDrag.mapPos).toBeDefined();
  expect(lastDrag.mapPos.x).toBeDefined();
  expect(lastDrag.mapPos.y).toBeDefined();
});

test('Pinch zoom / molette — Émission d une intention pinchZoom', async ({ page }) => {
  await mountInputStage(page, 'players');

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  // Zoom via molette de souris
  await page.mouse.move(canvasBox.x + 300, canvasBox.y + 300);
  await page.mouse.wheel(0, -100);

  await waitForIntention(page, 'pinchZoom');

  const intentions = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  const zoomIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'pinchZoom');
  expect(zoomIntentions.length).toBeGreaterThan(0);
  expect(zoomIntentions[0].scaleFactor).toBeGreaterThan(1.0);
  expect(zoomIntentions[0].center).toBeDefined();
});

test('Appui long — Émission d une intention longPress si immobile pendant longPressMs', async ({ page }) => {
  await mountInputStage(page, 'players');

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const clickX = canvasBox.x + 400;
  const clickY = canvasBox.y + 400;

  await page.mouse.move(clickX, clickY);
  await page.mouse.down();
  // Durée du geste, pas attente d'un résultat.
  await page.waitForTimeout(600); // Maintien immobile > 500ms
  await page.mouse.up();

  await waitForIntention(page, 'longPress');

  const intentions = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  const longPressIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'longPress');
  expect(longPressIntentions.length).toBe(1);
  expect(longPressIntentions[0].screenPos).toEqual({ screenX: 400, screenY: 400 });
  expect(longPressIntentions[0].mapPos).toBeDefined();
});
