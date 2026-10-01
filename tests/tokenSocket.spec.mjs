// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

const FAKE_LEVEL = {
  id: 'rdc-level',
  name: 'Rez-de-chaussée',
  order: 0,
  imageUrl: 'maps/minimal.webp',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 140,
  widthCells: 10,
  heightCells: 8,
  grid: { type: /** @type {import('../js/core/types.js').GridType} */ ('square'), offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

const BASE_TOKEN = {
  id: 'tok-socket-test',
  levelId: 'rdc-level',
  cell: { a: 2, b: 2 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Héros Test',
  hidden: false,
  visionBright: 6,
  visionDim: 12,
  emitsLight: null,
  speedCells: 6,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
  hp: { current: 15, max: 20 },
  health: 'unharmed',
};

test.describe('Chantier R — Sondes Canvas indépendantes de validation', () => {

  // ⛔ Le test « Critères 1, 2, 3, 5, 8 & repli palier none » est retiré le 01/10/2026 (C-14) :
  // il sondait la châsse elle-même, que le rendu ne dessine plus — et il passait aussi bien
  // avec elle que sans, ce qui disait déjà ce qu'il prouvait. `tokenSocket.js` reste dormant,
  // couvert par ses unitaires. Ce qui reste ici vaut pour tout pion : liseré et anneau de
  // sélection d'épaisseur constante à l'écran.

  test('Critère 7 : Épaisseurs constantes à l\'écran (liseré, sélection) sous zoom 0.2x et 2.0x', async ({ context }) => {
    const sessionId = `test-chasse-c7-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'c7-campaign',
        name: 'Campagne C7',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...BASE_TOKEN, sizeCells: 2 }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'tok-socket-test',
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    const pxPerCell = FAKE_LEVEL.pxPerCell;

    const res = await pageGM.evaluate(async ({ pxPerCell }) => {
      try {
        const app = /** @type {any} */ (window).__RPG_APP__;
        const store = await import('../js/state/store.js');

        const forceRender = () => {
          if (app.frameLoop && typeof app.frameLoop._tick === 'function') {
            app.frameLoop._tick(performance.now());
          }
        };

        /** 
         * Mesure les épaisseurs en pixels écran du liseré, de la châsse et de l'anneau de sélection sur le canvas.
         * @param {number} targetZoom Zoom de la caméra à tester (0.20x et 2.00x exactement selon brief §2)
         */
        const measureTokenScreenElements = (targetZoom) => {
          app.camera.zoom = targetZoom;

          store.updateToken('tok-socket-test', {
            sizeCells: 2,
            borderColor: '#00ff00',
            hp: null,
            hidden: false,
          });

          const token = store.getCampaign()?.tokens?.find((t) => t.id === 'tok-socket-test');

          const centerMap = {
            x: ((token?.cell?.a ?? 2) + (token?.sizeCells ?? 2) / 2) * pxPerCell,
            y: ((token?.cell?.b ?? 2) + (token?.sizeCells ?? 2) / 2) * pxPerCell,
          };

          if (app.camera && typeof app.camera.setPan === 'function') {
            app.camera.setPan(centerMap.x, centerMap.y);
          }

          forceRender();

          const ctx = app.canvas.getContext('2d');
          const resolution = app.stage?.resolution ?? 1;

          const centerScreen = app.camera.mapToScreen(centerMap);
          const startX = Math.round(centerScreen.screenX * resolution);
          const cy = Math.round(centerScreen.screenY * resolution);

          const outerRadiusScreen = (2 * pxPerCell / 2) * targetZoom;
          // Sans châsse, le portrait et son liseré reprennent tout le rayon du pion.
          const imageRadiusScreen = outerRadiusScreen - 1.5;

          // 2. MESURE DU LISERÉ D'IDENTITÉ (#00ff00, TOKEN_BORDER_SCREEN_PX = 3)
          let borderPxCount = 0;
          const borderStart = Math.floor(startX + imageRadiusScreen - 5);
          const borderEnd = Math.ceil(startX + imageRadiusScreen + 5);
          for (let cx = borderStart; cx <= borderEnd; cx++) {
            const p = ctx.getImageData(cx, cy, 1, 1).data;
            if (p[1] > 200 && p[0] < 50 && p[2] < 50) {
              borderPxCount++;
            }
          }

          // 3. MESURE DE L'ANNEAU DE SÉLECTION (#ffffff, TOKEN_SELECTION_RING_SCREEN_PX = 3)
          let selectionPxCount = 0;
          const selectionRadiusScreen = outerRadiusScreen + 4;
          const selStart = Math.floor(startX + selectionRadiusScreen - 5);
          const selEnd = Math.ceil(startX + selectionRadiusScreen + 5);
          for (let cx = selStart; cx <= selEnd; cx++) {
            const p = ctx.getImageData(cx, cy, 1, 1).data;
            if (p[0] > 230 && p[1] > 230 && p[2] > 230) {
              selectionPxCount++;
            }
          }

          return {
            borderPx: borderPxCount / resolution,
            selectionPx: selectionPxCount / resolution,
          };
        };

        const z02 = measureTokenScreenElements(0.20);
        const z20 = measureTokenScreenElements(2.00);

        return { error: null, z02, z20 };
      } catch (e) {
        return { error: String(e) };
      }
    }, { pxPerCell });

    expect(res.error).toBeNull();
    if (!res.z02 || !res.z20) throw new Error('Mesures z02 ou z20 non retournées');

    const z02 = res.z02;
    const z20 = res.z20;

    // ── Validations du Critère 7 (Épaisseurs constantes à l'écran) ──

    // A. L'absence de châsse n'est PAS jugée ici : sa teinte se retrouve dans le décor autour du
    // pion, et un comptage de pixels n'en prouverait rien. Elle est prouvée par comparaison dans
    // `hp.spec.mjs` (« Aucune barre d'état autour des pions »), qui rougit si la châsse revient.

    // B. Liseré d'identité (~3 px écran, TOKEN_BORDER_SCREEN_PX = 3, constante aux deux zooms)
    expect(z02.borderPx).toBeGreaterThanOrEqual(2);
    expect(z02.borderPx).toBeLessThanOrEqual(4);
    expect(z20.borderPx).toBeGreaterThanOrEqual(2);
    expect(z20.borderPx).toBeLessThanOrEqual(4);
    expect(Math.abs(z02.borderPx - z20.borderPx)).toBeLessThanOrEqual(1);

    // C. Anneau de sélection (~3 px écran, TOKEN_SELECTION_RING_SCREEN_PX = 3, constante aux deux zooms)
    expect(z02.selectionPx).toBeGreaterThanOrEqual(2);
    expect(z02.selectionPx).toBeLessThanOrEqual(4);
    expect(z20.selectionPx).toBeGreaterThanOrEqual(2);
    expect(z20.selectionPx).toBeLessThanOrEqual(4);
    expect(Math.abs(z02.selectionPx - z20.selectionPx)).toBeLessThanOrEqual(1);

    await pageGM.close();
  });

});
