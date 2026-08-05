// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Seuils désarmant l'appui long pour les tests de seuil spatial.
 *
 * Historiquement, un appui long était déclenché au milieu du geste à l'échéance du timer.
 * Désormais, l'appui long est un geste achevé émis au `pointerup` dont le mouvement annule
 * la candidature. Cette constante est conservée à titre de précaution dans les tests qui
 * testent des seuils spatiaux avec de longs délais temporisés.
 */
const SANS_APPUI_LONG = { longPressMs: 100_000 };

/**
 * Seuils désarmant **les deux** bornes temporelles du tap.
 *
 * `longPressMs` n'est pas la plus serrée, et c'est le piège : émettre un `tap`
 * exige aussi `duration < dragHoldMs` (`js/input/pointer.js:388`), soit **150 ms**
 * par défaut pour tout l'enchaînement `down` → `move` → `up`. Or chacun de ces
 * trois gestes est un aller-retour CDP entre Playwright et le navigateur : sous
 * six workers concurrents, les 150 ms tombent bien avant les 500 ms de l'appui
 * long. Ne désarmer que `longPressMs` ne change donc rien — vérifié, l'échec
 * persistait 4 fois sur 8.
 *
 * À n'employer que dans les tests dont l'objet est le seuil **spatial**. Un test
 * qui porte sur la brièveté du tap doit évidemment garder le seuil réel.
 */
const SANS_SEUILS_TEMPORELS = { longPressMs: 100_000, dragHoldMs: 100_000 };

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
  // Seuils désarmés alors même que ce test ne maintient **rien** : les trois allers-retours
  // CDP de `down` → `move` → `up` dépassent les 150 ms de `dragHoldMs` sur une machine
  // chargée, et `pointer.js:388` n'émet alors plus aucun `tap`. Ce test porte sur le seuil
  // spatial — 3 px restent un tap — pas sur la brièveté du geste.
  await mountInputStage(page, 'players', SANS_SEUILS_TEMPORELS);
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

test('Correctif — Hésitation avant déplacement (700 ms) émet la panBy et AUCUN longPress (Amendement A1)', async ({ page }) => {
  // Monte la scène avec les seuils réels (500 ms) pour mesurer l'hésitation réelle
  await mountInputStage(page, 'players');

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const startX = canvasBox.x + 100;
  const startY = canvasBox.y + 100;
  const endX = canvasBox.x + 170;
  const endY = canvasBox.y + 100;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Hésitation immobile de 700 ms > 500 ms (longPressMs)
  await page.waitForTimeout(700);
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();

  await waitForIntention(page, 'panBy');

  const intentions = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  const panIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'panBy');
  expect(panIntentions.length).toBeGreaterThan(0);

  const longPressIntentions = intentions.filter(/** @param {any} i */ (i) => i.type === 'longPress');
  expect(longPressIntentions).toHaveLength(0);
});

test("Correctif — Vue MJ : hésitation avant glisser (700 ms) émet dragToken et AUCUN longPress", async ({
  page,
}) => {
  // C'est LE symptôme que le mainteneur a signalé : presser un pion, hésiter une demi-seconde,
  // glisser — et le pion ne bougeait pas, tout en verrouillant la porte sous le point pressé
  // (`js/app/gm.js` traite `longPress` en bascule de verrou).
  //
  // Le rôle MJ mérite son propre test et ne se déduit pas de celui du rôle joueurs : la branche
  // du glisser de pion est distincte de celle du pan dans `handlePointerMove`, et elle est
  // gardée par `role === 'gm' && this.dragTokenId`. Le glisser réel est bien exercé par
  // `tests/manuel/gmToolDisarmGeste.spec.mjs`, mais ce projet est **hors de la porte** : sans ce
  // test, le symptôme d'origine ne serait plus vérifié à chaque push.
  //
  // Seuils réels, aucun désarmement — sinon le test ne mesure rien (Amendement A1).
  await mountInputStage(page, 'gm');

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const startX = canvasBox.x + 100;
  const startY = canvasBox.y + 100;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // L'hésitation du MJ : au-delà de longPressMs (500 ms), donc la candidature est posée.
  await page.waitForTimeout(700);
  await page.mouse.move(startX + 70, startY, { steps: 5 });
  await page.mouse.up();

  await waitForIntention(page, 'dragToken');

  const intentions = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  const drags = intentions.filter(/** @param {any} i */ (i) => i.type === 'dragToken');
  expect(drags.length).toBeGreaterThan(0);
  // Le glisser doit aller jusqu'à son terme : c'est la phase `end` qui déplace réellement le pion.
  expect(drags.some(/** @param {any} i */ (i) => i.phase === 'end')).toBe(true);

  expect(intentions.filter(/** @param {any} i */ (i) => i.type === 'longPress')).toHaveLength(0);
});

test('Correctif — Appui long immobile (700 ms) émet exactement UN longPress au pointerup et AUCUN panBy (Amendement A1)', async ({ page }) => {
  // Monte la scène avec les seuils réels (500 ms)
  await mountInputStage(page, 'players');

  const canvasBox = await page.locator('#board').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;

  const clickX = canvasBox.x + 350;
  const clickY = canvasBox.y + 350;

  await page.mouse.move(clickX, clickY);
  await page.mouse.down();
  await page.waitForTimeout(700);

  // Avant le pointerup, aucune intention longPress ne doit être émise
  const intentionsMid = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });
  expect(intentionsMid.filter(/** @param {any} i */ (i) => i.type === 'longPress')).toHaveLength(0);

  await page.mouse.up();

  await waitForIntention(page, 'longPress');

  const intentionsFinal = await page.evaluate(() => {
    const probe = /** @type {any} */ (window).__stageProbe;
    return probe.getIntentions();
  });

  expect(intentionsFinal.filter(/** @param {any} i */ (i) => i.type === 'longPress')).toHaveLength(1);
  expect(intentionsFinal.filter(/** @param {any} i */ (i) => i.type === 'panBy')).toHaveLength(0);
  expect(intentionsFinal.filter(/** @param {any} i */ (i) => i.type === 'dragToken')).toHaveLength(0);
});

// ⚠ Chantier O — il n'y a volontairement AUCUN test de la tolérance de désignation dans ce
// fichier. Une première version en avait ajouté un, étiqueté « E2E … au zoom tablette 0.24 » :
// il n'ouvrait aucun geste, ne touchait ni `PointerInput` ni `gm.js`, rejouait l'unitaire dans un
// navigateur par `page.evaluate` — et recalculait lui-même `min(marge / zoom, plafond × case)`,
// donc ne pouvait pas détecter une erreur dans la formule qu'il refaisait.
//
// L'arithmétique est couverte par `tests/tokenHit.test.mjs`, y compris le plafond au zoom lointain.
// Ce qui reste non couvert est le **geste réel** au doigt, et ça ne se simule pas ici : les tests
// qui pressent des coordonnées d'écran sur `gm.html` ont déjà coûté six runs de CI
// (`DIAGNOSTIC-GESTE-GABARITS.md` — `camera.mapToScreen` est relatif au canvas, `page.mouse` au
// viewport). C'est donc porté par la liste des vérifications manuelles d'`ETAT.md`, pas par un
// test qui ferait semblant.

