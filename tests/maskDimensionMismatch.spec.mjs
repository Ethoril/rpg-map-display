// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Deux cartes différentes qui partagent un identifiant d'étage partagent aussi leurs masques.
 *
 * ⭐ **Hypothèse à vérifier**, formulée le 7 août 2026 sur un symptôme de séance : « la zone de
 * vision est là, mais pas le pion ». La vision se rend, donc le masque existe et le fog s'en sert
 * correctement — mais la couche des pions, qui lit le **même** masque pour décider qui montrer,
 * refuse de dessiner.
 *
 * La cause soupçonnée est en amont : `parseUvtt` donne à tout étage importé l'identifiant
 * `'uvtt-level'`, un export Dungeondraft ne portant pas d'`id`. Or les masques — exploré comme
 * vision — sont indexés par `levelId`, **y compris la clé `localStorage`**
 * `rpg_fog_<session>_<levelId>`. Deux cartes de tailles différentes se partagent donc le même
 * masque, et celui d'une carte de 65 × 71 est relu pour une carte de 20 × 16.
 *
 * Ce que ce test établit : **les pions disparaissent-ils quand le masque n'a pas les dimensions
 * de l'étage ?** Si oui, l'identifiant partagé n'est pas un défaut de confort — il fait
 * disparaître les pions de la table.
 */

/** @param {string} id @param {number} w @param {number} h */
const niveau = (id, w, h) => ({
  id,
  name: `Carte ${w}x${h}`,
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: w,
  heightCells: h,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
});

/** @param {string} levelId @param {number} w @param {number} h */
const instantane = (levelId, w, h) => ({
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-masque',
    name: 'Masque',
    levels: [niveau(levelId, w, h)],
    links: [],
    tokens: [
      {
        id: 'pj-1',
        levelId,
        cell: { a: 3, b: 3 },
        sizeCells: 1,
        kind: 'pc',
        imageUrl: '',
        borderColor: '#00ff00',
        label: 'Héros',
        hidden: false,
        visionBright: 8,
        visionDim: 12,
        emitsLight: null,
        speedCells: 30,
        playerMovable: true,
        locked: false,
        elevation: 0,
        markers: [],
        hp: null,
        health: 'unharmed',
      },
    ],
    templates: [],
    settings: {},
  },
  activeLevelId: levelId,
  selectedTokenId: null,
  activeHandout: null,
});

/**
 * Le pion est-il dessiné ? On échantillonne le liseré vert vif du pion, qu'aucun autre élément
 * de la scène ne porte.
 * @param {import('@playwright/test').Page} page
 */
const pionDessine = (page) =>
  page.evaluate(async () => {
    const app = /** @type {any} */ (window).__RPG_APP__;
    if (typeof app.invalidate === 'function') app.invalidate();
    await new Promise((r) => requestAnimationFrame(r));
    const store = await import('../js/state/store.js');
    const niveau = store.getActiveLevel();
    const px = niveau?.pxPerCell ?? 100;
    const ctx = app.canvas.getContext('2d');
    const res = app.stage?.resolution ?? 1;
    // Balayage de la case du pion : on cherche du vert dominant.
    for (let dx = -0.45; dx <= 0.45; dx += 0.05) {
      for (let dy = -0.45; dy <= 0.45; dy += 0.05) {
        const e = app.camera.mapToScreen({ x: (3 + 0.5 + dx) * px, y: (3 + 0.5 + dy) * px });
        const d = ctx.getImageData(Math.round(e.screenX * res), Math.round(e.screenY * res), 1, 1)
          .data;
        if (d[1] > 90 && d[1] - d[0] > 40 && d[1] - d[2] > 40) return true;
      }
    }
    return false;
  });

test('un masque aux dimensions d\'une AUTRE carte est écarté, et les pions restent visibles', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sessionId = `masque-${Date.now()}`;
  /** @type {string[]} */
  const erreurs = [];

  // ── 1. Référence : une carte 20 × 16, sans masque hérité. Le pion doit se voir.
  const joueur = await context.newPage();
  joueur.on('pageerror', (e) => erreurs.push(`joueur: ${e.message}`));
  await installBrowserTransport(joueur, sessionId, instantane('uvtt-level', 20, 16));
  await joueur.goto('/player.html');
  await waitForApp(joueur);

  const mj = await context.newPage();
  mj.on('pageerror', (e) => erreurs.push(`mj: ${e.message}`));
  await installBrowserTransport(mj, sessionId, instantane('uvtt-level', 20, 16));
  await mj.goto('/gm.html');
  await waitForApp(mj);

  await expect.poll(() => pionDessine(joueur), { timeout: 8000 }).toBe(true);

  // ── 2. Le défaut : un masque encodé pour une carte BIEN PLUS GRANDE, sous le même identifiant.
  //      C'est exactement ce que produit `rpg_fog_<session>_uvtt-level` quand deux cartes de
  //      tailles différentes se succèdent dans une même session.
  const masqueGrandeCarte = await mj.evaluate(async () => {
    const { ExploredFog } = await import('../js/vision/fog.js');
    // 65 × 71, la taille de `testbig150`. Tout révélé, pour que le masque soit franchement non nul.
    const fog = new ExploredFog(65, 71);
    fog.revealAll?.();
    return fog.exportPng();
  });

  await joueur.evaluate(async (png) => {
    const store = await import('../js/state/store.js');
    store.setSessionVision('uvtt-level', png);
  }, masqueGrandeCarte);

  await joueur.waitForTimeout(600);
  const dessineApres = await pionDessine(joueur);

  // ⛔ Le pion doit RESTER visible : un masque aux mauvaises dimensions est écarté, jamais obéi.
  //
  // Mesuré avant correctif : ce constat était FAUX — le pion disparaissait. Le fog continuait
  // pourtant d'afficher une zone claire, si bien que le MJ voyait ses pions et la table non, sans
  // qu'aucun message ne le dise. Mieux vaut tout montrer que tout cacher en silence.
  expect(
    dessineApres,
    'Un masque aux mauvaises dimensions doit être écarté, pas appliqué : sinon tous les pions ' +
      'disparaissent de la vue joueurs alors que la zone de vision reste dessinée.'
  ).toBe(true);

  expect(erreurs).toEqual([]);
  await context.close();
});
