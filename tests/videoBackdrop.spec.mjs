// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Fond animé — la carte réellement publiée, pas une maquette.
 *
 * Ce que ces scénarios prouvent, et qu'aucun test unitaire ne peut prouver :
 *
 * 1. **Que ça bouge.** Une affiche fixe et une vidéo à l'arrêt sont indiscernables sur
 *    une capture unique. Deux captures espacées, elles, tranchent.
 * 2. **Que le canvas se tait.** Si la couche de fond peignait encore, elle recouvrirait
 *    la vidéo : le résultat serait une carte parfaitement correcte… et parfaitement fixe.
 * 3. **Que le fog couvre quand même.** C'est le point dangereux : une vidéo au-dessus du
 *    canvas montrerait aux joueurs toute la carte sous le brouillard.
 * 4. **Que le repli est automatique.** Vidéo absente ou illisible : on doit retomber sur
 *    exactement le comportement d'avant ce chantier.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenePath = path.join(__dirname, '..', 'maps', 'generated', 'testvideo-3.scene.json');
const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
/** @type {any} */
const niveauAnime = scene.levels[0];

/** @param {Partial<{ videoUrl: string|null }>} [override] */
function snapshot(override = {}) {
  return {
    campaign: {
      schemaVersion: 2,
      campaignId: 'c-video',
      name: 'Banc d’essai fond animé',
      levels: [{ ...niveauAnime, ...override }],
      links: [],
      tokens: [],
      templates: [],
      settings: {},
    },
    activeLevelId: niveauAnime.id,
    selectedTokenId: null,
    activeHandout: null,
  };
}

/**
 * Ouvre une vue avec l'instantané voulu.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {'gm'|'player'} vue
 * @param {any} snap
 */
async function ouvrir(browser, vue, snap) {
  const context = await browser.newContext();
  const page = await context.newPage();
  /** @type {string[]} */
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await installBrowserTransport(page, `video-${vue}-${Date.now()}`, snap);
  await page.goto(vue === 'gm' ? '/gm.html' : '/player.html');
  await waitForApp(page);
  return { context, page, erreurs };
}

/**
 * Nombre de pixels du canvas portant une **couleur de carte**, sur 25 échantillons
 * pris au centre.
 *
 * ⛔ Ne pas mesurer la transparence : le voile de fog du MJ peint du noir à alpha 128
 * par-dessus, donc rien n'est transparent même quand le fond n'a pas été dessiné.
 * Relevé sur la carte réelle :
 *   fond animé actif  → 25 pixels `[0, 0, 0, α]` — le voile seul, sur un canvas vide ;
 *   fond animé absent → 25 pixels `[115, 90, 52, 255]` et voisins — l'affiche, voilée.
 * La teinte est donc le seul signal qui distingue « la couche de fond a peint » de
 * « elle s'est tue », et c'est exactement ce qu'on veut savoir.
 */
const pixelsPortantLaCarte = (/** @type {import('@playwright/test').Page} */ page) =>
  page.evaluate(() => {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    let colores = 0;
    for (let fx = 0.3; fx <= 0.7; fx += 0.1) {
      for (let fy = 0.3; fy <= 0.7; fy += 0.1) {
        const x = Math.floor(canvas.width * fx);
        const y = Math.floor(canvas.height * fy);
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        if (r !== 0 || g !== 0 || b !== 0) colores++;
      }
    }
    return colores;
  });

/** Attend que le flux ait au moins une image décodée. */
const attendreFlux = (/** @type {import('@playwright/test').Page} */ page) =>
  expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = /** @type {HTMLVideoElement|null} */ (document.querySelector('.video-backdrop'));
          return v ? v.readyState : -1;
        }),
      { timeout: 30000, message: 'le flux vidéo n’a jamais atteint HAVE_CURRENT_DATA' }
    )
    .toBeGreaterThanOrEqual(2);

test('le fond animé joue réellement : deux captures espacées diffèrent', async ({ browser }) => {
  const { context, page, erreurs } = await ouvrir(browser, 'gm', snapshot());
  await attendreFlux(page);

  const zone = { x: 200, y: 150, width: 400, height: 300 };
  const a = await page.screenshot({ clip: zone });
  await page.waitForTimeout(1200);
  const b = await page.screenshot({ clip: zone });

  // Une affiche fixe donnerait deux captures identiques à l'octet près.
  expect(Buffer.compare(a, b)).not.toBe(0);
  expect(erreurs).toEqual([]);
  await context.close();
});

test('quand la vidéo peint, la couche de fond se tait', async ({ browser }) => {
  const avecVideo = await ouvrir(browser, 'gm', snapshot());
  await attendreFlux(avecVideo.page);
  await avecVideo.page.waitForTimeout(300);
  const avec = await pixelsPortantLaCarte(avecVideo.page);

  // Même carte, vidéo injoignable : la couche de fond doit reprendre la main.
  const sansVideo = await ouvrir(
    browser,
    'gm',
    snapshot({ videoUrl: 'maps/generated/inexistante-404.webm' })
  );
  await expect.poll(() => pixelsPortantLaCarte(sansVideo.page), { timeout: 15000 }).toBe(25);

  expect(avec).toBe(0);
  expect(await pixelsPortantLaCarte(sansVideo.page)).toBe(25);

  await avecVideo.context.close();
  await sansVideo.context.close();
});

/**
 * ⭐ L'invariant porteur du chantier W, et le seul que rien ne vérifiait.
 *
 * Deux moitiés existaient sans jamais se rencontrer : `appIntegration.spec.mjs` prouve que
 * `frameCount` se fige sur une scène immobile — mais **sans vidéo** —, et le scénario
 * ci-dessus prouve que la couche de fond se tait **en pixels** — ce qui dit qu'elle ne
 * dessine pas l'image, pas que la boucle dort.
 *
 * Un `invalidate()` par image vidéo passerait donc les deux : la vidéo jouerait, la couche
 * se tairait, les pixels seraient justes. Le seul symptôme serait une tablette qui se vide
 * sur une séance de 4 h — et il serait mis sur le compte du matériel, R2-06 étant ouvert.
 *
 * La fenêtre est tenue **sous les 2,5 s de `STALL_CHECK_MS`** délibérément : le contrôle de
 * cadence n'appelle `invalidate()` qu'en cas d'échec, mais un headless qui décode 4200×2850
 * en logiciel peut légitimement ramper, et l'assertion deviendrait dépendante de la machine.
 * Ce qu'on éprouve ici est l'absence de réveil **par la lecture**, pas la tenue du décodeur.
 */
test('un fond animé qui joue ne réveille jamais le rendu', async ({ browser }) => {
  for (const vue of /** @type {const} */ (['gm', 'player'])) {
    const { context, page, erreurs } = await ouvrir(browser, vue, snapshot());
    await attendreFlux(page);

    const frames = () =>
      page.evaluate(() => /** @type {any} */ (window).__RPG_APP__.frameLoop.frameCount);

    // Le démarrage demande légitimement des frames — le flux qui devient lisible en est une.
    // On attend donc que la boucle se soit tue d'elle-même avant de mesurer, au lieu de
    // deviner un délai : deux relevés égaux à 300 ms d'écart valent repos établi.
    await expect
      .poll(
        async () => {
          const a = await frames();
          await page.waitForTimeout(300);
          return (await frames()) === a;
        },
        { timeout: 15000, message: `la boucle de rendu ne s’est jamais tue (${vue})` }
      )
      .toBe(true);

    const avant = await frames();
    await page.waitForTimeout(1000);
    const apres = await frames();

    // 1 000 ms de lecture, soit ~30 images à 30 i/s : un réveil par image en produirait ~30,
    // et une seule suffit à faire rougir cette égalité.
    expect(
      apres,
      `${vue} : ${apres - avant} frame(s) rendue(s) pendant 1 s de lecture vidéo`
    ).toBe(avant);
    // La vidéo doit avoir réellement avancé pendant la fenêtre, sans quoi l'égalité
    // ci-dessus serait obtenue par un flux à l'arrêt — vert pour la mauvaise raison.
    const avance = await page.evaluate(() => {
      const v = /** @type {HTMLVideoElement|null} */ (document.querySelector('.video-backdrop'));
      return v ? v.currentTime : 0;
    });
    expect(avance, `${vue} : le flux n’a pas avancé, l’invariant n’est pas éprouvé`).toBeGreaterThan(0);
    expect(erreurs).toEqual([]);
    await context.close();
  }
});

test('vidéo illisible : repli sur l’affiche, sans page en erreur', async ({ browser }) => {
  const { context, page, erreurs } = await ouvrir(
    browser,
    'gm',
    snapshot({ videoUrl: 'maps/generated/inexistante-404.webm' })
  );
  // L'échec doit rendre la main : l'affiche est peinte, donc le canvas porte la carte.
  await expect.poll(() => pixelsPortantLaCarte(page), { timeout: 15000 }).toBe(25);
  expect(erreurs).toEqual([]);
  await context.close();
});

test('étage sans fond animé : aucun élément vidéo actif, comportement d’avant', async ({ browser }) => {
  const { context, page, erreurs } = await ouvrir(browser, 'gm', snapshot({ videoUrl: null }));
  const etat = await page.evaluate(() => {
    const v = /** @type {HTMLVideoElement|null} */ (document.querySelector('.video-backdrop'));
    return v ? { display: getComputedStyle(v).display, src: v.getAttribute('src') } : null;
  });
  expect(etat?.display).toBe('none');
  expect(etat?.src).toBeNull();
  await expect.poll(() => pixelsPortantLaCarte(page), { timeout: 15000 }).toBe(25);
  expect(erreurs).toEqual([]);
  await context.close();
});

test('le fond animé est sous le canvas, et ne reçoit aucun geste', async ({ browser }) => {
  const { context, page } = await ouvrir(browser, 'gm', snapshot());
  await attendreFlux(page);

  const empilement = await page.evaluate(() => {
    const v = /** @type {HTMLElement} */ (document.querySelector('.video-backdrop'));
    const c = /** @type {HTMLElement} */ (document.getElementById('board'));
    const sv = getComputedStyle(v);
    const sc = getComputedStyle(c);
    // Qui reçoit réellement un clic au centre de la carte ?
    const r = c.getBoundingClientRect();
    const cible = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      zVideo: Number(sv.zIndex),
      zCanvas: Number(sc.zIndex),
      positionCanvas: sc.position,
      pointerEvents: sv.pointerEvents,
      cibleEstCanvas: cible === c,
    };
  });

  expect(empilement.zVideo).toBeLessThan(empilement.zCanvas);
  // Un canvas `static` peint sous tout élément positionné, quel que soit son z-index.
  expect(empilement.positionCanvas).not.toBe('static');
  expect(empilement.pointerEvents).toBe('none');
  expect(empilement.cibleEstCanvas).toBe(true);
  await context.close();
});

test('le fond animé se superpose exactement à la carte, après pan et zoom', async ({ browser }) => {
  // ⭐ **Le trou le plus grave que la revue ait trouvé.** Sans ce scénario, désactiver
  // entièrement `place()` laissait les six autres tests verts : la vidéo s'affichait à sa
  // taille intrinsèque dans le coin, totalement désalignée, et « ça bouge », « le canvas
  // se tait », « c'est sous le canvas », « le fog couvre » passaient tous. Les teintes et
  // les différences de captures ne disent rien de la géométrie.
  //
  // On compare donc le rectangle réel de l'élément vidéo à celui que la caméra calcule
  // pour la carte, avec la caméra du projet comme seule référence.
  const { context, page, erreurs } = await ouvrir(browser, 'gm', snapshot());
  await attendreFlux(page);

  /** @param {{ dx: number, dy: number, dz: number }} geste */
  const ecartApres = (geste) =>
    page.evaluate(async ({ dx, dy, dz }) => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      const camera = app.camera;
      camera.setPan(camera.x + dx, camera.y + dy);
      camera.setZoom(camera.zoom * dz);
      app.frameLoop.requestFrame();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const store = await import('../js/state/store.js');
      const { gridFor } = await import('../js/grid/index.js');
      const campagne = /** @type {any} */ (store.getCampaign());
      const niveau = /** @type {any} */ (
        campagne.levels.find((/** @type {any} */ l) => l.id === store.getActiveLevelId())
      );
      const grille = gridFor(niveau);
      const coin = grille.mapFromCellPoint({ cellX: niveau.widthCells, cellY: niveau.heightCells });

      // Ce que la caméra dit : les deux coins de la carte, en pixels écran.
      const hg = camera.mapToScreen({ x: 0, y: 0 });
      const bd = camera.mapToScreen({ x: coin.x, y: coin.y });

      // Ce que le navigateur a réellement peint.
      const v = /** @type {HTMLElement} */ (document.querySelector('.video-backdrop'));
      const canvas = /** @type {HTMLElement} */ (document.getElementById('board'));
      const rv = v.getBoundingClientRect();
      const rc = canvas.getBoundingClientRect();

      return {
        gauche: Math.abs(rv.left - rc.left - hg.screenX),
        haut: Math.abs(rv.top - rc.top - hg.screenY),
        largeur: Math.abs(rv.width - (bd.screenX - hg.screenX)),
        hauteur: Math.abs(rv.height - (bd.screenY - hg.screenY)),
      };
    }, geste);

  for (const geste of [
    { dx: 0, dy: 0, dz: 1 },        // état initial
    { dx: 350, dy: -220, dz: 1 },   // panoramique seul
    { dx: 0, dy: 0, dz: 1.9 },      // zoom seul
    { dx: -500, dy: 300, dz: 0.55 }, // les deux
  ]) {
    const ecart = await ecartApres(geste);
    // 1,5 px de tolérance : le conteneur peut avoir une largeur fractionnaire, et le
    // canvas mappe son backing store par cette largeur-là. La dérive tolérée est
    // sous-pixel ; un `place()` absent ou un facteur de densité en trop se compteraient
    // en centaines de pixels.
    for (const [nom, valeur] of Object.entries(ecart)) {
      expect(valeur, `${nom} après ${JSON.stringify(geste)}`).toBeLessThan(1.5);
    }
  }
  expect(erreurs).toEqual([]);
  await context.close();
});

test('vue joueurs : le brouillard couvre le fond animé', async ({ browser }) => {
  const { context, page, erreurs } = await ouvrir(browser, 'player', snapshot());
  await attendreFlux(page);

  // Sans pion ni vision, la vue joueurs est intégralement inexplorée. Si la vidéo
  // passait au-dessus du canvas, la carte apparaîtrait malgré le brouillard.
  const capture = await page.screenshot({ clip: { x: 250, y: 200, width: 300, height: 200 } });
  // Décodage PNG minimal évité : on passe par le navigateur pour mesurer la clarté.
  const clarte = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let somme = 0;
    for (let i = 0; i < d.length; i += 4) somme += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return somme / (d.length / 4);
  }, capture.toString('base64'));

  // Le sable de cette carte est très clair (~180). Sous brouillard opaque, on doit être
  // très bas. Le seuil est volontairement large : il ne mesure pas une teinte, il
  // distingue « on voit la carte » de « on ne la voit pas ».
  expect(clarte).toBeLessThan(60);
  expect(erreurs).toEqual([]);
  await context.close();
});
