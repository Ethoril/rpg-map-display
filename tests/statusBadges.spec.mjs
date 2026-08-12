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
  ambient: { color: '#ffffff', level: 1, baked: false },
};

const FAKE_TOKEN = {
  id: 'hero-1',
  levelId: 'rdc-level',
  cell: { a: 2, b: 2 },
  sizeCells: 1,
  kind: 'pc',
  imageUrl: '',
  borderColor: '#00ff00',
  label: 'Guerrier',
  hidden: false,
  visionBright: 6,
  visionDim: 12,
  emitsLight: null,
  speedCells: 6,
  playerMovable: true,
  locked: false,
  elevation: 0,
  markers: [],
};

test.describe('Tranche L-09 — Marqueurs d\'état E2E', () => {
  test('1. Panneau MJ : les 14 cases à cocher de marqueurs modifient token.markers', async ({ context }) => {
    const sessionId = `test-markers-ui-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'markers-campaign',
        name: 'Campagne de test marqueurs',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...FAKE_TOKEN }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'hero-1',
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    // Ouvrir l'onglet "Pions"
    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');

    // Vérifier la présence des 14 cases à cocher
    const checkboxes = pageGM.locator('.token-marker-checkbox');
    await expect(checkboxes).toHaveCount(14);

    // Cocher 'prone' (À terre) et 'ablaze' (En flammes)
    const proneCheckbox = pageGM.locator('.token-marker-checkbox[value="prone"]');
    const ablazeCheckbox = pageGM.locator('.token-marker-checkbox[value="ablaze"]');

    await proneCheckbox.check();
    await ablazeCheckbox.check();

    // Attendre que le store MJ soit mis à jour
    await expect
      .poll(() =>
        pageGM.evaluate(async () => {
          const store = await import('../js/state/store.js');
          const token = store.getCampaign()?.tokens.find((t) => t.id === 'hero-1');
          return token ? token.markers : null;
        })
      )
      .toEqual(['prone', 'ablaze']);
  });

  test('2. Critère 7 : La modification d\'un marqueur côté MJ est propagée vers la vue joueurs', async ({ context }) => {
    const sessionId = `test-markers-sync-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'sync-markers-campaign',
        name: 'Campagne sync marqueurs',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...FAKE_TOKEN }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'hero-1',
    };

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    for (const p of [pageGM, pagePlayer]) {
      await installBrowserTransport(p, sessionId, snapshot);
    }

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    // Ouvrir l'onglet Pions côté MJ et cocher 'unconscious'
    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');
    await pageGM.locator('.token-marker-checkbox[value="unconscious"]').check();

    // Vérifier par poll sur la vue joueur que token.markers a reçu 'unconscious'
    await expect
      .poll(() =>
        pagePlayer.evaluate(async () => {
          const store = await import('../js/state/store.js');
          const token = store.getCampaign()?.tokens.find((t) => t.id === 'hero-1');
          return token ? token.markers : null;
        })
      )
      .toEqual(['unconscious']);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('3. Critère 5 : Le badge d\'élévation conserve sa taille à l\'écran quel que soit le zoom', async ({ page }) => {
    await page.goto('/gm.html');
    await waitForApp(page);

    const layoutZoom1 = await page.evaluate(async () => {
      const { computeElevationBadgeLayout } = await import('../js/render/statusBadges.js');
      return computeElevationBadgeLayout(140, 1.0);
    });

    const layoutZoom024 = await page.evaluate(async () => {
      const { computeElevationBadgeLayout } = await import('../js/render/statusBadges.js');
      return computeElevationBadgeLayout(140, 0.24);
    });

    expect(layoutZoom1.badgeRadiusMap * 1.0).toBeCloseTo(layoutZoom1.badgeRadiusScreen, 5);
    expect(layoutZoom024.badgeRadiusMap * 0.24).toBeCloseTo(layoutZoom024.badgeRadiusScreen, 5);
  });

  test('4. Critères 1 & 2 : Les paliers d\'affichage et la géométrie s\'adaptent au diamètre du pion', async ({ page }) => {
    await page.goto('/gm.html');
    await waitForApp(page);

    const tiers = await page.evaluate(async () => {
      const { getBadgeTier } = await import('../js/render/statusBadges.js');
      return {
        tier1Cell: getBadgeTier(140 * 0.24), // D = 33.6 px -> 'category-dots'
        tier3Cell: getBadgeTier(420 * 0.24), // D = 100.8 px -> 'icons'
      };
    });

    expect(tiers.tier1Cell).toBe('category-dots');
    expect(tiers.tier3Cell).toBe('icons');
  });

  test('5. Rendu effectif d\'une icône SVG sur le canvas et validation géométrique de sa position', async ({ context }) => {
    const sessionId = `test-markers-render-${Date.now()}`;
    const snapshot = {
      campaign: {
        schemaVersion: 2,
        campaignId: 'render-markers-campaign',
        name: 'Campagne rendu marqueurs',
        levels: [FAKE_LEVEL],
        links: [],
        tokens: [{ ...FAKE_TOKEN, markers: [] }],
        templates: [],
        settings: {},
      },
      activeLevelId: FAKE_LEVEL.id,
      selectedTokenId: 'hero-1',
    };

    const pageGM = await context.newPage();
    await installBrowserTransport(pageGM, sessionId, snapshot);
    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(pageGM);

    // 1. Déclencher la mutation et attendre la première frame de rendu effectif (pastille de repli)
    const initialRgb = await pageGM.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const { computeBadgeRowLayout } = await import('../js/render/statusBadges.js');
      const app = /** @type {any} */ (window).__RPG_APP__;

      const waitForNextFrame = () =>
        new Promise((resolve) => {
          const listener = () => {
            app.frameLoop.removeListener(listener);
            resolve(null);
          };
          app.frameLoop.addListener(listener);
        });

      const nextFramePromise = waitForNextFrame();
      store.updateToken('hero-1', { markers: ['poisoned'] });
      await nextFramePromise;

      const token = store.getCampaign()?.tokens.find((t) => t.id === 'hero-1');
      if (!token || !token.markers || token.markers.length === 0) return null;
      const level = store.getCampaign()?.levels.find((l) => l.id === token.levelId);
      const pxPerCell = level?.pxPerCell ?? 140;
      const widthMap = token.sizeCells * pxPerCell;

      const p0 = { x: token.cell.a * pxPerCell, y: token.cell.b * pxPerCell };
      const layout = computeBadgeRowLayout(widthMap, 1);
      const badgeCenterMap = { x: p0.x + layout.centers[0].x, y: p0.y + layout.centers[0].y };

      const screenPos = app.camera.mapToScreen(badgeCenterMap);
      const resolution = app.stage?.resolution ?? 1;
      const canvasX = Math.round(screenPos.screenX * resolution);
      const canvasY = Math.round(screenPos.screenY * resolution);

      const pixelData = app.context.getImageData(canvasX, canvasY, 1, 1).data;
      return [pixelData[0], pixelData[1], pixelData[2]];
    });

    // Helper: vérifie si la couleur est proche de la couleur de repli #ef4444 (rgb 239, 68, 68) de la catégorie 'damage'
    /** @param {number[]|null} rgb */
    const isFallbackCategoryColor = (rgb) => {
      if (!rgb || rgb.length < 3) return false;
      return Math.abs(rgb[0] - 239) < 25 && Math.abs(rgb[1] - 68) < 25 && Math.abs(rgb[2] - 68) < 25;
    };

    // Étape 1 : À la première frame synchrone de rendu du marqueur, l'icône SVG est en cours de chargement.
    // Le centre du badge doit porter la couleur de repli de la catégorie 'damage' (#ef4444).
    if (!isFallbackCategoryColor(initialRgb)) {
      throw new Error(`L'icône est déjà chargée à la première frame, le test ne peut pas prouver l'invalidation. (Couleur reçue: ${JSON.stringify(initialRgb)})`);
    }

    // Étape 2 : Sans aucune interaction sur la page, l'événement `load` de l'icône déclenche `invalidate()`.
    // expect.poll vérifie que le pixel du centre cesse d'être la couleur de repli (l'icône SVG est dessinée).
    await expect
      .poll(async () => {
        return pageGM.evaluate(async () => {
          const app = /** @type {any} */ (window).__RPG_APP__;
          const canvas = app?.canvas;
          if (!canvas || !app?.camera) return null;
          const ctx = canvas.getContext('2d');
          const store = await import('../js/state/store.js');
          const { computeBadgeRowLayout } = await import('../js/render/statusBadges.js');
          const token = store.getCampaign()?.tokens.find((t) => t.id === 'hero-1');
          if (!token || !token.markers || token.markers.length === 0) return null;
          const level = store.getCampaign()?.levels.find((l) => l.id === token.levelId);
          const pxPerCell = level?.pxPerCell ?? 140;
          const widthMap = token.sizeCells * pxPerCell;

          const p0 = { x: token.cell.a * pxPerCell, y: token.cell.b * pxPerCell };
          const layout = computeBadgeRowLayout(widthMap, 1);
          const badgeCenterMap = { x: p0.x + layout.centers[0].x, y: p0.y + layout.centers[0].y };

          const screenPos = app.camera.mapToScreen(badgeCenterMap);
          const resolution = app.stage?.resolution ?? 1;
          const canvasX = Math.round(screenPos.screenX * resolution);
          const canvasY = Math.round(screenPos.screenY * resolution);

          const pixelData = ctx.getImageData(canvasX, canvasY, 1, 1).data;
          const rgb = [pixelData[0], pixelData[1], pixelData[2]];
          return Math.abs(rgb[0] - 239) < 25 && Math.abs(rgb[1] - 68) < 25 && Math.abs(rgb[2] - 68) < 25;
        });
      })
      .toBe(false);

    await pageGM.close();
  });
});
