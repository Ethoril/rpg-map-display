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

  test('Critères 1, 2, 3, 5, 8 & Repli palier none : Sondes de pixels sur Canvas', async ({ context }) => {
    const sessionId = `test-chasse-canvas-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'chasse-campaign',
        name: 'Campagne Châsse',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...BASE_TOKEN }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: null,
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

        const campaign = store.getCampaign();
        if (!campaign) return { error: 'Aucune campagne dans le store' };

        const token1 = campaign.tokens.find((t) => t.id === 'tok-socket-test');
        if (!token1) return { error: 'Pion non trouvé dans le store' };

        // Force premier rendu
        forceRender();

        const zoom1 = app.camera.zoom;
        const outerRadiusMap1 = (token1.sizeCells * pxPerCell) / 2;
        const bandWidthMap1 = 6 / zoom1;
        const imageRadiusMap1 = outerRadiusMap1 - bandWidthMap1;

        const centerMap1 = {
          x: (token1.cell.a + token1.sizeCells / 2) * pxPerCell,
          y: (token1.cell.b + token1.sizeCells / 2) * pxPerCell,
        };

        const portraitPointMap = {
          x: centerMap1.x + imageRadiusMap1 - 2 / zoom1,
          y: centerMap1.y,
        };

        const portraitScreen = app.camera.mapToScreen(portraitPointMap);
        const resolution = app.stage?.resolution ?? 1;
        const ctx = app.canvas.getContext('2d');
        const p1 = ctx.getImageData(Math.round(portraitScreen.screenX * resolution), Math.round(portraitScreen.screenY * resolution), 1, 1).data;
        const isImageCovered = Math.abs(p1[0] - 30) < 5 && Math.abs(p1[1] - 41) < 5 && Math.abs(p1[2] - 59) < 5;

        // ── Critère 2 : Opacité absolue de la châsse neutre ──
        store.updateToken('tok-socket-test', { hp: null });
        forceRender();

        const token2 = store.getCampaign()?.tokens.find((t) => t.id === 'tok-socket-test');
        if (!token2) return { error: 'Token2 introuvable après update' };

        const outerRadiusMap2 = (token2.sizeCells * pxPerCell) / 2;
        const innerRadiusMap2 = outerRadiusMap2 - 6 / app.camera.zoom;
        const midBandRadiusMap2 = (innerRadiusMap2 + outerRadiusMap2) / 2;

        const bandPointMap = {
          x: centerMap1.x + midBandRadiusMap2 * Math.cos(Math.PI / 4),
          y: centerMap1.y + midBandRadiusMap2 * Math.sin(Math.PI / 4),
        };

        const bandScreen = app.camera.mapToScreen(bandPointMap);
        const p2 = ctx.getImageData(Math.round(bandScreen.screenX * resolution), Math.round(bandScreen.screenY * resolution), 1, 1).data;
        const socketColorDiff = Math.max(Math.abs(p2[0] - 30), Math.abs(p2[1] - 41), Math.abs(p2[2] - 59));

        // ── Critère 3 : Empreinte externe inchangée ──
        const outsidePointMap = {
          x: centerMap1.x + outerRadiusMap1 + 5 / app.camera.zoom,
          y: centerMap1.y,
        };
        const outsideScreen = app.camera.mapToScreen(outsidePointMap);
        const p3 = ctx.getImageData(Math.round(outsideScreen.screenX * resolution), Math.round(outsideScreen.screenY * resolution), 1, 1).data;
        const pixelsOutsideUnchanged = !(Math.abs(p3[0] - 30) < 5 && Math.abs(p3[1] - 41) < 5 && Math.abs(p3[2] - 59) < 5);

        // ── Critère 5 : Les 3 états de PNJ donnent 3 empreintes distinctes en niveaux de gris ──
        /** @param {any} t */
        const getSamplePattern = (t) => {
          if (!t) return [0, 0, 0];
          const cMap = {
            x: (t.cell.a + t.sizeCells / 2) * pxPerCell,
            y: (t.cell.b + t.sizeCells / 2) * pxPerCell,
          };
          const angles = [-Math.PI / 2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5];
          const rMap = (t.sizeCells * pxPerCell / 2) - 3 / app.camera.zoom;

          return angles.map((ang) => {
            const pt = { x: cMap.x + rMap * Math.cos(ang), y: cMap.y + rMap * Math.sin(ang) };
            const scr = app.camera.mapToScreen(pt);
            const d = ctx.getImageData(Math.round(scr.screenX * resolution), Math.round(scr.screenY * resolution), 1, 1).data;
            return Math.round(0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2]);
          });
        };

        store.updateToken('tok-socket-test', { kind: 'npc', health: 'unharmed' });
        forceRender();
        const tUnharmed = store.getCampaign()?.tokens.find((t) => t.id === 'tok-socket-test');
        const sigUnharmed = getSamplePattern(tUnharmed).join(',');

        store.updateToken('tok-socket-test', { kind: 'npc', health: 'wounded' });
        forceRender();
        const tWounded = store.getCampaign()?.tokens.find((t) => t.id === 'tok-socket-test');
        const sigWounded = getSamplePattern(tWounded).join(',');

        store.updateToken('tok-socket-test', { kind: 'npc', health: 'critical' });
        forceRender();
        const tCritical = store.getCampaign()?.tokens.find((t) => t.id === 'tok-socket-test');
        const sigCritical = getSamplePattern(tCritical).join(',');

        // ── Critère 8 : Pion hidden atténue la châsse (globalAlpha = 0.45) ──
        store.updateToken('tok-socket-test', { hidden: true });
        forceRender();
        const tHidden = store.getCampaign()?.tokens.find((t) => t.id === 'tok-socket-test');
        if (!tHidden) return { error: 'tHidden non trouvé' };

        const bandPointHidden = {
          x: centerMap1.x + ((tHidden.sizeCells * pxPerCell) / 2 - 3 / app.camera.zoom),
          y: centerMap1.y,
        };
        const scrHidden = app.camera.mapToScreen(bandPointHidden);
        const pHidden = ctx.getImageData(Math.round(scrHidden.screenX * resolution), Math.round(scrHidden.screenY * resolution), 1, 1).data;
        const hiddenAttenuation = pHidden[0] > 35 && pHidden[1] > 45 && pHidden[2] > 65;

        // ── Repli du palier 'none' (D < 24 px) ──
        app.camera.zoom = 0.15;
        store.updateToken('tok-socket-test', { kind: 'pc', sizeCells: 1, hp: { current: 15, max: 20 }, hidden: false });
        forceRender();
        const tNone = store.getCampaign()?.tokens.find((t) => t.id === 'tok-socket-test');
        if (!tNone) return { error: 'tNone non trouvé' };

        const ringRadiusMap = (tNone.sizeCells * pxPerCell) / 2 + 1.5 / app.camera.zoom;
        const ringPointMap = { x: centerMap1.x, y: centerMap1.y - ringRadiusMap };
        const ringScreen = app.camera.mapToScreen(ringPointMap);
        const baseRingX = Math.round(ringScreen.screenX * resolution);
        const baseRingY = Math.round(ringScreen.screenY * resolution);

        let noneTierFallbackRendered = false;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const pRing = ctx.getImageData(baseRingX + dx, baseRingY + dy, 1, 1).data;
            if (Math.abs(pRing[0] - 37) < 30 && Math.abs(pRing[1] - 99) < 30 && Math.abs(pRing[2] - 235) < 30) {
              noneTierFallbackRendered = true;
              break;
            }
          }
          if (noneTierFallbackRendered) break;
        }

        return {
          error: null,
          isImageCovered,
          socketColorDiff,
          pixelsOutsideUnchanged,
          sigUnharmed,
          sigWounded,
          sigCritical,
          hiddenAttenuation,
          noneTierFallbackRendered,
        };
      } catch (err) {
        return { error: String(err) };
      }
    }, { pxPerCell });

    expect(res.error).toBeNull();

    expect(res.isImageCovered).toBe(false);
    expect(res.socketColorDiff).toBeLessThanOrEqual(2);
    expect(res.pixelsOutsideUnchanged).toBe(true);

    expect(res.sigUnharmed).not.toBe(res.sigWounded);
    expect(res.sigWounded).not.toBe(res.sigCritical);
    expect(res.sigUnharmed).not.toBe(res.sigCritical);

    expect(res.hiddenAttenuation).toBe(true);
    expect(res.noneTierFallbackRendered).toBe(true);

    await pageGM.close();
  });

  test('Critère 7 : Épaisseurs constantes à l\'écran (liseré, sélection et châsse) sous zoom 0.2x et 2.0x', async ({ context }) => {
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
          const innerRadiusScreen = outerRadiusScreen - 6;
          const imageRadiusScreen = outerRadiusScreen - 6;

          // 1. MESURE DE LA CHÂSSE NEUTRE SOMBRE (#1e293b, RGB [30, 41, 59])
          let bandPxCount = 0;
          const bandStart = Math.floor(startX + innerRadiusScreen - 2);
          const bandEnd = Math.ceil(startX + outerRadiusScreen + 2);
          for (let cx = bandStart; cx <= bandEnd; cx++) {
            const p = ctx.getImageData(cx, cy, 1, 1).data;
            if (Math.abs(p[0] - 30) <= 5 && Math.abs(p[1] - 41) <= 5 && Math.abs(p[2] - 59) <= 5) {
              bandPxCount++;
            }
          }

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
            bandPx: bandPxCount / resolution,
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

    // A. Châsse neutre sombre (~4 px écran de matière pure #1e293b, constante aux deux zooms)
    expect(z02.bandPx).toBeGreaterThanOrEqual(3);
    expect(z02.bandPx).toBeLessThanOrEqual(5);
    expect(z20.bandPx).toBeGreaterThanOrEqual(3);
    expect(z20.bandPx).toBeLessThanOrEqual(5);
    expect(Math.abs(z02.bandPx - z20.bandPx)).toBeLessThanOrEqual(1);

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
