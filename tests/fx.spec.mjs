// @ts-check
// Effets de blessure et de mort de bout en bout (contrat de liaison §9, lot L4) : un message
// `fx.*` de l'outil MJ arrive sur gm.html par le BroadcastChannel, se joue sur l'écran MJ et, par
// le transport, sur la tablette — sauf pour un pion caché.
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp, waitForPlayerVision } from './browserTestTransport.mjs';

const LEVEL = {
  id: 'rdc-level', name: 'Rez-de-chaussée', order: 0, imageUrl: 'maps/minimal.webp', videoUrl: null, animatedOverlays: [],
  pxPerCell: 140, widthCells: 10, heightCells: 8,
  grid: { type: /** @type {import('../js/core/types.js').GridType} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null, walls: [], portals: [], lights: [], ambient: { level: 1, baked: false },
};
/** @param {object} patch */
const token = (patch) => ({
  id: 'x', levelId: 'rdc-level', cell: { a: 4, b: 2 }, sizeCells: 1, kind: 'npc', imageUrl: '', borderColor: '#000000', label: 'Gobelin',
  hidden: false, visionBright: 0, visionDim: 0, emitsLight: null, speedCells: 3, playerMovable: false, locked: false, elevation: 0,
  markers: [], hp: { current: 5, max: 10 }, health: 'wounded', ...patch,
});
const PJ = token({ id: 'pj', kind: 'pc', cell: { a: 3, b: 2 }, label: 'Héros', visionBright: 10, visionDim: 10, playerMovable: true });

/** Relève les images d'effet dessinées sur le canvas de la page. */
async function spyFx(/** @type {import('@playwright/test').Page} */ page) {
  await page.addInitScript(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    /** @type {any} */ (window).__fxDessines = [];
    /** @type {any} */ (CanvasRenderingContext2D.prototype).drawImage = function (/** @type {any} */ img, /** @type {any[]} */ ...rest) {
      if (img && typeof img.src === 'string' && img.src.includes('assets/fx/')) {
        /** @type {any} */ (window).__fxDessines.push({ file: img.src.split('/').pop(), blend: this.globalCompositeOperation });
      }
      return /** @type {any} */ (draw).call(this, img, ...rest);
    };
  });
}
const dessines = (/** @type {import('@playwright/test').Page} */ page) =>
  page.evaluate(() => /** @type {{ file: string, blend: string }[]} */ (/** @type {any} */ (window).__fxDessines));

for (const hidden of [false, true]) {
  test(`fx.death (feu) de l'outil MJ : joué sur l'écran MJ${hidden ? ', absent de la tablette (pion caché)' : ' et sur la tablette'}`, async ({ context }) => {
    const sessionId = `test-fx-${hidden}-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2, campaignId: 'fx', name: 'FX', levels: [LEVEL], links: [], templates: [], settings: {},
        tokens: [PJ, token({ id: 'gob', hidden, link: { source: 'outil-mj', ref: 'p:gob' } })],
      },
      activeLevelId: LEVEL.id, selectedTokenId: null,
    };
    const gm = await context.newPage();
    await spyFx(gm);
    await installBrowserTransport(gm, sessionId, snapshot);
    await gm.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(gm);
    const player = await context.newPage();
    await spyFx(player);
    await installBrowserTransport(player, sessionId, snapshot);
    await player.goto(`/player.html?session=${sessionId}`);
    await waitForApp(player);

    // L'outil MJ parle sur le canal de liaison, depuis une autre page du même contexte.
    const outil = await context.newPage();
    await outil.goto('/gm.html?session=emetteur-fx');
    await outil.evaluate(() => {
      const canal = new BroadcastChannel('wfrp-map-link');
      canal.postMessage({ v: 3, type: 'fx.death', seq: 1, at: Date.now(), from: 'outil-mj', payload: { ref: 'p:gob', cause: 'fire' } });
    });

    // Feu en deux couches : brûlure au sol en multiply, flammes en screen.
    await expect.poll(async () => {
      const d = await dessines(gm);
      return d.some((x) => x.file === 'feu.webp' && x.blend === 'multiply') && d.some((x) => x.file === 'flammes-1.webp' && x.blend === 'screen');
    }).toBe(true);
    if (hidden) {
      await gm.waitForTimeout(1500);
      expect(await dessines(player)).toEqual([]);
    } else {
      await expect.poll(async () => (await dessines(player)).some((d) => d.file === 'flammes-1.webp')).toBe(true);
    }
  });
}

// ── H-4 : un effet ne révèle pas un PNJ hors de vue, et le câblage le prouve ────────────────
//
// `shouldPlayFx` ne regardait que le drapeau `hidden` posé à la main par le MJ, jamais la
// visibilité RÉELLE du pion pour la table. Dans une pièce explorée mais sans vision courante, la
// couche des pions masque correctement le PNJ ; l'effet, lui, se dessinait à sa position.
//
// ⛔ Ce test est de BOUT EN BOUT exprès. Les tests unitaires de `tests/fx.test.mjs` passent les
// options de vision à la main : ils prouvent que la couche sait filtrer, pas que la vue joueurs lui
// transmet son masque. Retirer le câblage laisserait le défaut entier et les unitaires verts.
for (const { nom, cell, visible } of /** @type {const} */ ([
  { nom: 'dans la vision du PJ', cell: { a: 4, b: 2 }, visible: true },
  { nom: 'hors de la vision du PJ', cell: { a: 9, b: 7 }, visible: false },
])) {
  test(`H-4 : fx.death d'un PNJ ${nom} — ${visible ? 'joué' : 'ABSENT'} sur la tablette, toujours joué chez le MJ`, async ({ context }) => {
    const sessionId = `test-h4-${visible ? 'vu' : 'cache'}-${Date.now()}`;
    // ⚠ Le PJ ne voit qu'à deux cases : sans cela, un étage de 10 × 8 tient entier dans sa vision
    // et le cas « hors de vue » n'existerait pas.
    const pjCourteVue = { ...PJ, visionBright: 2, visionDim: 2 };
    // ⚠ Et l'étage doit être SOMBRE : `ambient.level: 1` éclaire tout, la vision du PJ ne borne
    // alors plus rien et il n'y aurait pas de hors-de-vue à cacher. Première écriture de ce test.
    const etageSombre = { ...LEVEL, ambient: { level: 0, baked: false } };
    const snapshot = {
      campaign: {
        schemaVersion: 2, campaignId: 'fx-h4', name: 'FX H-4', levels: [etageSombre], links: [], templates: [], settings: {},
        tokens: [pjCourteVue, token({ id: 'gob', cell, hidden: false, link: { source: 'outil-mj', ref: 'p:gob' } })],
      },
      activeLevelId: LEVEL.id, selectedTokenId: null,
    };
    const gm = await context.newPage();
    await spyFx(gm);
    await installBrowserTransport(gm, sessionId, snapshot);
    await gm.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(gm);
    const player = await context.newPage();
    await spyFx(player);
    await installBrowserTransport(player, sessionId, snapshot);
    await player.goto(`/player.html?session=${sessionId}`);
    await waitForApp(player);
    // ⛔ Attendre la vision publiée : sans masque, la tablette ne dessine aucun pion et ne doit
    // dessiner aucun effet — le cas « dans la vision » échouerait pour la mauvaise raison.
    await waitForPlayerVision(player);

    const outil = await context.newPage();
    await outil.goto(`/gm.html?session=emetteur-h4-${visible ? 'vu' : 'cache'}`);
    await outil.evaluate(() => {
      const canal = new BroadcastChannel('wfrp-map-link');
      canal.postMessage({ v: 3, type: 'fx.death', seq: 1, at: Date.now(), from: 'outil-mj', payload: { ref: 'p:gob', cause: 'fire' } });
    });

    // L'écran MJ joue l'effet dans les deux cas : le contrat §9 le lui donne toujours.
    await expect.poll(async () => (await dessines(gm)).some((x) => x.file === 'flammes-1.webp')).toBe(true);

    if (visible) {
      await expect.poll(async () => (await dessines(player)).some((d) => d.file === 'flammes-1.webp')).toBe(true);
    } else {
      // Les flammes durent bien plus que cette attente : si elles devaient apparaître, elles
      // seraient déjà là. On vérifie aussi que le PNJ lui-même n'est pas dessiné — sinon le test
      // porterait sur un cas où il n'y avait rien à cacher.
      await player.waitForTimeout(1500);
      expect(await dessines(player)).toEqual([]);
    }
  });
}
