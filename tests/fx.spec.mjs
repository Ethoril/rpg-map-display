// @ts-check
// Effets de blessure et de mort de bout en bout (contrat de liaison §9, lot L4) : un message
// `fx.*` de l'outil MJ arrive sur gm.html par le BroadcastChannel, se joue sur l'écran MJ et, par
// le transport, sur la tablette — sauf pour un pion caché.
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

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
      canal.postMessage({ v: 1, type: 'fx.death', seq: 1, at: Date.now(), from: 'outil-mj', payload: { ref: 'p:gob', cause: 'fire' } });
    });

    await expect.poll(async () => (await dessines(gm)).some((d) => d.file === 'feu-1.webp' && d.blend === 'multiply')).toBe(true);
    if (hidden) {
      await gm.waitForTimeout(1500);
      expect(await dessines(player)).toEqual([]);
    } else {
      await expect.poll(async () => (await dessines(player)).some((d) => d.file === 'feu-1.webp')).toBe(true);
    }
  });
}
