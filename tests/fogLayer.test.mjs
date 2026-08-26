// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createToken } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { FOG_MASK_PX_PER_CELL, VISION_MAX_RANGE_CELLS } from '../js/core/constants.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import { ExploredFog, composeVisibleMask } from '../js/vision/fog.js';
import {
  FogLayer,
  alphaNonExplore,
  getVisionComputeCount,
  resetVisionComputeCount,
} from '../js/render/layers/fogLayer.js';

/**
 * Mock minimaliste de Canvas 2D avec buffer de pixels pour tester le compositing.
 * @param {number} [width]
 * @param {number} [height]
 */
function createMockCanvas(width = 200, height = 200) {
  const pixels = new Uint8Array(width * height * 4);

  /** @type {any[]} */
  const path = [];

  const ctx = {
    width,
    height,
    pixels,
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over',
    _path: path,

    save() {},
    restore() {},
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    clearRect(x, y, w, h) {
      for (let r = Math.max(0, Math.floor(y)); r < Math.min(height, Math.floor(y + h)); r++) {
        for (let c = Math.max(0, Math.floor(x)); c < Math.min(width, Math.floor(x + w)); c++) {
          const idx = (r * width + c) * 4;
          pixels[idx] = 0;
          pixels[idx + 1] = 0;
          pixels[idx + 2] = 0;
          pixels[idx + 3] = 0;
        }
      }
    },
    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    fillRect(x, y, w, h) {
      const color = parseColor(ctx.fillStyle);
      for (let r = Math.max(0, Math.floor(y)); r < Math.min(height, Math.floor(y + h)); r++) {
        for (let c = Math.max(0, Math.floor(x)); c < Math.min(width, Math.floor(x + w)); c++) {
          const idx = (r * width + c) * 4;
          blendPixel(pixels, idx, color, ctx.globalCompositeOperation);
        }
      }
    },
    beginPath() {
      ctx._path = [];
    },
    /** @param {number} x @param {number} y */
    moveTo(x, y) {
      ctx._path.push({ type: 'move', x, y });
    },
    /** @param {number} x @param {number} y */
    lineTo(x, y) {
      ctx._path.push({ type: 'line', x, y });
    },
    closePath() {
      ctx._path.push({ type: 'close' });
    },
    fill() {
      if (ctx._path.length === 0) return;

      // Un chemin peut porter PLUSIEURS sous-chemins, et c'est tout le mécanisme de
      // l'union des champs de vision : un seul `fill()` en rend la réunion (règle non
      // nulle, sous-chemins de même orientation — `sweep()` les rend triés par angle).
      // Concaténer les sous-chemins en un seul anneau donnerait la règle pair-impair,
      // qui *évide* les recouvrements au lieu de les absorber : l'inverse exact.
      /** @type {Array<Array<{x: number, y: number}>>} */
      const rings = [];
      for (const p of ctx._path) {
        if (p.type === 'move') rings.push([{ x: p.x, y: p.y }]);
        else if (p.type === 'line' && rings.length > 0) rings[rings.length - 1].push({ x: p.x, y: p.y });
      }
      const remplis = rings.filter((ring) => ring.length >= 3);
      if (remplis.length === 0) return;

      const points = remplis.flat();
      const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x))));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((p) => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((p) => p.y))));

      const color = parseColor(ctx.fillStyle);

      for (let r = minY; r <= maxY; r++) {
        for (let c = minX; c <= maxX; c++) {
          if (remplis.some((ring) => pointInPoly(c + 0.5, r + 0.5, ring))) {
            const idx = (r * width + c) * 4;
            blendPixel(pixels, idx, color, ctx.globalCompositeOperation);
          }
        }
      }
    },
    // Le fog compose désormais à la résolution du masque puis étire une seule fois au
    // dépôt final (BRIEF-FOG-BASSE-RESOLUTION.md) : source et destination n'ont plus
    // forcément la même taille. La version d'origine, qui recopiait pixel à pixel en
    // supposant des dimensions identiques, ne peut plus émuler cette étape — d'où
    // l'échantillonnage au plus proche voisin sur `dw`/`dh`.
    //
    // ⭐ **Le mode de fusion est honoré depuis la tranche Z-05 (26/08/2026).** Il ne l'était
    // pas, et le commentaire d'alors l'assumait : « les étapes B et C, en `destination-out`,
    // ne passent par ce mock dans aucun test de ce fichier ». C'est devenu faux le jour où un
    // test a fourni un `visibleCanvas` — le chemin de production depuis Z-05 — qui passe
    // précisément par l'étape C. Le mock repeignait alors du noir là où le vrai contexte
    // perce, et le test rougissait pour une raison qui n'était pas la sienne.
    //
    // ⚠ Un mock qui ignore le mode de fusion ne se contente pas d'être incomplet : il
    // implémente **l'inverse** de l'opération testée. C'est le douzième faux vert de ce
    // projet, et le second de cette seule journée.
    /** @param {any} image @param {number} [dx] @param {number} [dy] @param {number} [dw] @param {number} [dh] */
    drawImage(image, dx = 0, dy = 0, dw, dh) {
      if (!image || !image._ctx) return;
      const srcCtx = image._ctx;
      const srcPixels = srcCtx.pixels;
      const srcW = srcCtx.width;
      const srcH = srcCtx.height;
      const destW = dw ?? srcW;
      const destH = dh ?? srcH;

      for (let r = 0; r < destH; r++) {
        const py = Math.floor(dy) + r;
        if (py < 0 || py >= height) continue;
        const sy = Math.min(srcH - 1, Math.floor((r / destH) * srcH));
        for (let c = 0; c < destW; c++) {
          const px = Math.floor(dx) + c;
          if (px < 0 || px >= width) continue;
          const sx = Math.min(srcW - 1, Math.floor((c / destW) * srcW));
          const srcIdx = (sy * srcW + sx) * 4;
          const dstIdx = (py * width + px) * 4;

          const srcAlpha = srcPixels[srcIdx + 3] / 255;
          const mode = ctx.globalCompositeOperation;

          if (mode === 'destination-out') {
            // Perce la destination à proportion de l'opacité de la source. C'est l'étape C.
            pixels[dstIdx + 3] = Math.round(pixels[dstIdx + 3] * (1 - srcAlpha));
            continue;
          }
          if (mode === 'destination-in') {
            // Ne garde de la destination que là où la source est opaque.
            pixels[dstIdx + 3] = Math.round(pixels[dstIdx + 3] * srcAlpha);
            continue;
          }

          if (srcAlpha > 0) {
            const dstAlpha = pixels[dstIdx + 3] / 255;
            const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);

            if (outAlpha > 0) {
              pixels[dstIdx] = Math.round((srcPixels[srcIdx] * srcAlpha + pixels[dstIdx] * dstAlpha * (1 - srcAlpha)) / outAlpha);
              pixels[dstIdx + 1] = Math.round((srcPixels[srcIdx + 1] * srcAlpha + pixels[dstIdx + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha);
              pixels[dstIdx + 2] = Math.round((srcPixels[srcIdx + 2] * srcAlpha + pixels[dstIdx + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha);
              pixels[dstIdx + 3] = Math.round(outAlpha * 255);
            }
          }
        }
      }
    },
    /** @param {number} x @param {number} y */
    getImageData(x, y) {
      const c = Math.floor(x);
      const r = Math.floor(y);
      const idx = (r * width + c) * 4;
      return {
        data: [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]],
      };
    },
  };

  const canvas = {
    width,
    height,
    _ctx: ctx,
    /** @param {string} type */
    getContext(type) {
      return type === '2d' ? ctx : null;
    },
  };

  return { canvas, ctx };
}

function createTestFogLayer() {
  return new FogLayer({
    createOffscreenCanvas: (w, h) => createMockCanvas(w, h).canvas,
  });
}

/** @param {Record<string, any>} [extra] */
function defaultOptions(extra = {}) {
  return { role: /** @type {'gm'} */ ('gm'), extractSegments: extractBlockedSegments, ...extra };
}

/** @param {string} str */
function parseColor(str) {
  if (str === '#000000') return [0, 0, 0, 255];
  const rgbaMatch = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    return [
      parseInt(rgbaMatch[1], 10),
      parseInt(rgbaMatch[2], 10),
      parseInt(rgbaMatch[3], 10),
      Math.round((rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1) * 255),
    ];
  }
  return [100, 100, 100, 255];
}

/** @param {Uint8Array} pixels @param {number} idx @param {number[]} color @param {string} mode */
function blendPixel(pixels, idx, color, mode) {
  if (mode === 'destination-out') {
    const eraseAlpha = color[3] / 255;
    pixels[idx + 3] = Math.round(pixels[idx + 3] * (1 - eraseAlpha));
  } else {
    const srcAlpha = color[3] / 255;
    const dstAlpha = pixels[idx + 3] / 255;
    const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);

    if (outAlpha > 0) {
      pixels[idx] = Math.round((color[0] * srcAlpha + pixels[idx] * dstAlpha * (1 - srcAlpha)) / outAlpha);
      pixels[idx + 1] = Math.round((color[1] * srcAlpha + pixels[idx + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha);
      pixels[idx + 2] = Math.round((color[2] * srcAlpha + pixels[idx + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha);
      pixels[idx + 3] = Math.round(outAlpha * 255);
    }
  }
}

/** @param {number} x @param {number} y @param {Array<{x: number, y: number}>} points */
function pointInPoly(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

test('Constante VISION_MAX_RANGE_CELLS vaut 20', () => {
  assert.equal(VISION_MAX_RANGE_CELLS, 20);
});

test('Critère 1 & 1bis : Le voile s applique aux zones non vues et laisse le fond intact en vision directe', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 10,
    walls: [
      [
        { cellX: 5, cellY: 0 },
        { cellX: 5, cellY: 10 },
      ],
    ],
  });
  const grid = gridFor(level);

  // Pion PJ à la case (2, 5) avec visionDim = 4
  const pc = createToken({
    id: 'pion-pj',
    levelId: 'rdc',
    kind: 'pc',
    cell: { a: 2, b: 5 },
    visionDim: 4,
  });

  const { ctx } = createMockCanvas(100, 100);
  // Fond gris connu (100, 100, 100)
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 100, 100);

  const fogLayer = createTestFogLayer();
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions({ veilColor: 'rgba(0, 0, 0, 0.5)' }));

  // Point A (30, 55) : vision directe du PJ -> fond intact (100, 100, 100)
  const pixelVisible = ctx.getImageData(30, 55).data;
  assert.equal(pixelVisible[0], 100, 'Point visible doit conserver le fond R');
  assert.equal(pixelVisible[1], 100, 'Point visible doit conserver le fond G');
  assert.equal(pixelVisible[2], 100, 'Point visible doit conserver le fond B');

  // Point B (70, 55) : derrière le mur en x=50 -> masqué et voilé (mélange 100 et 0,5 veil -> 50)
  const pixelVoile = ctx.getImageData(70, 55).data;
  assert.ok(pixelVoile[0] < 100, 'Point voilé doit être plus sombre que le fond');
  assert.ok(pixelVoile[0] > 0, 'Point voilé ne doit pas être du noir absolu ou un trou transparent');
});

test('Critère 1 : deux PJ éloignés donnent deux zones disjointes, rapprochés une seule zone connexe', () => {
  /** @param {{a: number, b: number}} cellA @param {{a: number, b: number}} cellB */
  function rendre(cellA, cellB) {
    const level = createLevel({
      id: 'rdc', widthCells: 40, heightCells: 10, pxPerCell: 10,
      ambient: { level: 0, baked: false },
    });
    const grid = gridFor(level);
    const pcA = createToken({ id: 'pjA', levelId: 'rdc', kind: 'pc', cell: cellA, visionDim: 4 });
    const pcB = createToken({ id: 'pjB', levelId: 'rdc', kind: 'pc', cell: cellB, visionDim: 4 });

    const { ctx } = createMockCanvas(400, 100);
    ctx.fillStyle = 'rgb(100, 100, 100)';
    ctx.fillRect(0, 0, 400, 100);
    createTestFogLayer().render(/** @type {any} */ (ctx), grid, level, [pcA, pcB], defaultOptions());
    return ctx;
  }

  // Éloignés : centres en x=25 et x=355, rayon 40 px. Les deux zones existent, séparées.
  const ctxLoin = rendre({ a: 2, b: 5 }, { a: 35, b: 5 });
  assert.equal(ctxLoin.getImageData(25, 55).data[0], 100, 'La zone du premier PJ est dévoilée');
  assert.equal(ctxLoin.getImageData(355, 55).data[0], 100, 'La zone du second PJ est dévoilée aussi');
  assert.ok(ctxLoin.getImageData(200, 55).data[0] < 100, 'Entre les deux, le voile subsiste : zones disjointes');

  // Rapprochés : centres en x=25 et x=85, rayons de 40 px qui se recouvrent.
  const ctxPres = rendre({ a: 2, b: 5 }, { a: 8, b: 5 });
  for (const x of [25, 45, 55, 65, 85]) {
    assert.equal(
      ctxPres.getImageData(x, 55).data[0],
      100,
      `Rapprochés, la zone est connexe et continue en x=${x}`
    );
  }
});

test('Critère 1bis : la couleur de voile par défaut laisse la carte lisible dessous', () => {
  const level = createLevel({ id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);

  const { ctx } = createMockCanvas(100, 100);
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 100, 100);

  // Aucun PJ : toute la carte est voilée, avec la couleur par défaut de la couche.
  createTestFogLayer().render(/** @type {any} */ (ctx), grid, level, [], defaultOptions());

  const pixel = ctx.getImageData(50, 50).data;
  assert.ok(pixel[0] < 100, 'Le voile par défaut assombrit bien la zone non vue');
  assert.ok(pixel[0] > 25, 'Le voile par défaut reste translucide : le MJ joue à travers');
  assert.equal(pixel[3], 255, 'Le voile ne perce pas de trou transparent dans la scène');
});

test('Critère 2 : PNJ, visionDim: 0 et pions d un autre étage ne contribuent pas', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 10,
    ambient: { level: 0, baked: false },
  });
  const grid = gridFor(level);

  const npc = createToken({ id: 'npc', levelId: 'rdc', kind: 'npc', cell: { a: 2, b: 2 }, visionDim: 10 });
  const noVision = createToken({ id: 'pc0', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 2 }, visionDim: 0 });
  const otherLevel = createToken({ id: 'pcOther', levelId: 'étage1', kind: 'pc', cell: { a: 2, b: 2 }, visionDim: 10 });

  const { ctx } = createMockCanvas(100, 100);
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 100, 100);

  const fogLayer = createTestFogLayer();
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [npc, noVision, otherLevel], defaultOptions({ veilColor: 'rgba(0, 0, 0, 0.5)' }));

  // Aucun PJ porteur de vision sur l'étage -> toute la carte reste voilée
  const pixel = ctx.getImageData(25, 25).data;
  assert.ok(pixel[0] < 100, 'Sans PJ porteur de vision, le voile couvre toute la carte');
});

test('Critère 3 : Une porte ouverte étend la vision', () => {
  const levelFerme = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 10,
    portals: [
      { id: 'p1', a: { cellX: 5, cellY: 0 }, b: { cellX: 5, cellY: 10 }, state: 'closed', closed: true, freestanding: false },
    ],
  });
  const gridFerme = gridFor(levelFerme);
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 5 }, visionDim: 8 });

  const { ctx: ctxFerme } = createMockCanvas(100, 100);
  ctxFerme.fillStyle = 'rgb(100, 100, 100)';
  ctxFerme.fillRect(0, 0, 100, 100);

  const fogFerme = createTestFogLayer();
  fogFerme.render(/** @type {any} */ (ctxFerme), gridFerme, levelFerme, [pc], defaultOptions());
  const pixelDerriereFerme = ctxFerme.getImageData(70, 55).data;
  assert.ok(pixelDerriereFerme[0] < 100, 'Porte fermée : le point derrière est voilé');

  // Ouvrir la porte
  const levelOuvert = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 10,
    portals: [
      { id: 'p1', a: { cellX: 5, cellY: 0 }, b: { cellX: 5, cellY: 10 }, closed: false, state: 'open', freestanding: false },
    ],
  });
  const gridOuvert = gridFor(levelOuvert);
  const { ctx: ctxOuvert } = createMockCanvas(100, 100);
  ctxOuvert.fillStyle = 'rgb(100, 100, 100)';
  ctxOuvert.fillRect(0, 0, 100, 100);

  const fogOuvert = createTestFogLayer();
  fogOuvert.render(/** @type {any} */ (ctxOuvert), gridOuvert, levelOuvert, [pc], defaultOptions());
  const pixelDerriereOuvert = ctxOuvert.getImageData(70, 55).data;
  assert.equal(pixelDerriereOuvert[0], 100, 'Porte ouverte : la vision s étend derrière la porte');
});

test('Critère 4 : Un pion à visionDim = 50 est plafonné à 20 sans erreur', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 60,
    heightCells: 60,
    pxPerCell: 10,
  });
  const grid = gridFor(level);
  const pc = createToken({ id: 'pj50', levelId: 'rdc', kind: 'pc', cell: { a: 30, b: 30 }, visionDim: 50 });

  const { ctx } = createMockCanvas(600, 600);
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 600, 600);

  const fogLayer = createTestFogLayer();
  assert.doesNotThrow(() => {
    fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());
  });

  // À 15 cases (150 px) du centre (305, 305) -> visible (100)
  const pixelProche = ctx.getImageData(400, 305).data;
  assert.equal(pixelProche[0], 100, 'Point dans le rayon plafonné (15 cases) est visible');

  // À 25 cases (250 px) du centre (305, 305) -> hors vision plafonnée -> voilé (< 100)
  const pixelLointain = ctx.getImageData(580, 305).data;
  assert.ok(pixelLointain[0] < 100, 'Point au-delà du plafond 20 cases est voilé');
});

test('Critère 5 : Mémoïsation et sensibilité de la signature aux mutations', () => {
  resetVisionComputeCount();

  const level = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 10,
  });
  const grid = gridFor(level);
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 2 }, visionDim: 5 });

  const { ctx } = createMockCanvas(100, 100);
  const fogLayer = createTestFogLayer();

  // 1er rendu -> calcul
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());
  assert.equal(getVisionComputeCount(), 1);

  // 2e et 3e rendus sans changement -> pas de recalcul
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());
  assert.equal(getVisionComputeCount(), 1, 'Rendre des images identiques ne recalcul pas sweep');

  // Déplacement du pion (`cell.a`) -> recalcul
  const pcDeplace = { ...pc, cell: { a: 3, b: 2 } };
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pcDeplace], defaultOptions());
  assert.equal(getVisionComputeCount(), 2, 'Changer cell.a déclenche un recalcul');

  // Changement de visionDim -> recalcul
  const pcVisionMod = { ...pcDeplace, visionDim: 8 };
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pcVisionMod], defaultOptions());
  assert.equal(getVisionComputeCount(), 3, 'Changer visionDim déclenche un recalcul');

  // Changement de kind (ex. PC -> NPC) -> recalcul
  const pcKindMod = { ...pcVisionMod, kind: /** @type {'npc'} */ ('npc') };
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pcKindMod], defaultOptions());
  assert.equal(getVisionComputeCount(), 4, 'Changer kind déclenche un recalcul');
});

test('Critère 5 : la signature couvre l axe b, l état des portes et la géométrie des murs', () => {
  resetVisionComputeCount();

  const grid = gridFor(createLevel({ id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10 }));
  const { ctx } = createMockCanvas(100, 100);
  const fogLayer = createTestFogLayer();

  /** @param {Record<string, any>} extra */
  const etage = (extra) => createLevel({ id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10, ...extra });
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 2 }, visionDim: 5 });

  const nu = etage({});
  fogLayer.render(/** @type {any} */ (ctx), grid, nu, [pc], defaultOptions());
  assert.equal(getVisionComputeCount(), 1);

  // Déplacement sur l'axe b seul : `cell.a` est inchangé, la vision doit suivre quand même.
  const pcVertical = { ...pc, cell: { a: 2, b: 6 } };
  fogLayer.render(/** @type {any} */ (ctx), grid, nu, [pcVertical], defaultOptions());
  assert.equal(getVisionComputeCount(), 2, 'Changer cell.b seul déclenche un recalcul');

  // Une porte apparaît, fermée.
  const porteFermee = etage({
    portals: [{ id: 'p1', a: { cellX: 5, cellY: 0 }, b: { cellX: 5, cellY: 10 }, closed: true, freestanding: false }],
  });
  fogLayer.render(/** @type {any} */ (ctx), grid, porteFermee, [pcVertical], defaultOptions());
  assert.equal(getVisionComputeCount(), 3, 'Ajouter une porte déclenche un recalcul');

  // Bascule de la porte : même géométrie, seul l'état change. C'est le piège du cache de L-01.
  const porteOuverte = etage({
    portals: [
      { id: 'p1', a: { cellX: 5, cellY: 0 }, b: { cellX: 5, cellY: 10 }, closed: false, state: 'open', freestanding: false },
    ],
  });
  fogLayer.render(/** @type {any} */ (ctx), grid, porteOuverte, [pcVertical], defaultOptions());
  assert.equal(getVisionComputeCount(), 4, 'Basculer une porte déclenche un recalcul');

  // Un mur apparaît, la porte restant identique : seule la géométrie des murs change.
  const avecMur = etage({
    portals: [
      { id: 'p1', a: { cellX: 5, cellY: 0 }, b: { cellX: 5, cellY: 10 }, closed: false, state: 'open', freestanding: false },
    ],
    walls: [[{ cellX: 0, cellY: 8 }, { cellX: 10, cellY: 8 }]],
  });
  fogLayer.render(/** @type {any} */ (ctx), grid, avecMur, [pcVertical], defaultOptions());
  assert.equal(getVisionComputeCount(), 5, 'Changer la géométrie des murs déclenche un recalcul');

  // Réimporter le même fichier remplace l'étage en conservant son id. Les polygones étant en
  // pixels carte, une nouvelle densité ou origine doit invalider le cache même si les murs sont
  // encore déclarés dans les mêmes cases.
  const reimporte = etage({
    pxPerCell: 20,
    grid: { type: 'square', offsetX: 7, offsetY: 11, color: '#000000', opacity: 0.25, visible: true },
    portals: avecMur.portals,
    walls: avecMur.walls,
  });
  fogLayer.render(/** @type {any} */ (ctx), gridFor(reimporte), reimporte, [pcVertical], defaultOptions());
  assert.equal(getVisionComputeCount(), 6, 'Réimporter un même id avec une grille différente déclenche un recalcul');
});

test('La signature de vision distingue deux visions différentes — c est elle qui évite un encodage PNG par image', () => {
  const level = createLevel({ id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 2 }, visionDim: 5 });

  const { ctx } = createMockCanvas(100, 100);
  const fogLayer = createTestFogLayer();

  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());
  const s1 = fogLayer.getVisionSignature();
  assert.ok(s1.length > 0, 'Une vision existante doit produire une signature non vide');

  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());
  assert.equal(fogLayer.getVisionSignature(), s1, 'Une vision inchangée garde la même signature');

  // `gm.js` s'appuie sur ce changement pour republier le masque `visible`. Si la
  // signature restait constante, la vision courante des joueurs se figerait après la
  // première publication — sans que rien ne le signale.
  const deplace = { ...pc, cell: { a: 7, b: 2 } };
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [deplace], defaultOptions());
  assert.notEqual(
    fogLayer.getVisionSignature(),
    s1,
    'Déplacer un pion doit changer la signature, sinon la vision publiée ne serait jamais rafraîchie'
  );
});

test('Critère 6 : Helper extractBlockedSegments est partagé', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 5,
    heightCells: 5,
    pxPerCell: 10,
    walls: [[{ cellX: 0, cellY: 0 }, { cellX: 5, cellY: 0 }]],
  });
  const grid = gridFor(level);

  const segmentsPixel = extractBlockedSegments(level, grid);
  assert.equal(segmentsPixel.length, 1);
  assert.deepEqual(segmentsPixel[0], { p1: { x: 0, y: 0 }, p2: { x: 50, y: 0 } });

  const segmentsCell = extractBlockedSegments(level);
  assert.equal(segmentsCell.length, 1);
  assert.deepEqual(segmentsCell[0], { A: { x: 0, y: 0 }, B: { x: 5, y: 0 } });
});

test('Lumière R3 : ambiante binaire, sources occluses et torche mobile invalident la vision', () => {
  const level = createLevel({
    id: 'rdc', widthCells: 12, heightCells: 10, pxPerCell: 10,
    ambient: { level: 0, baked: false },
    walls: [[{ cellX: 5, cellY: 0 }, { cellX: 5, cellY: 10 }]],
    lights: [{
      id: 'fixed', at: { cellX: 2.5, cellY: 5.5 }, range: 3, intensity: 1,
      color: '#ffffff', shadows: true,
    }],
  });
  const grid = gridFor(level);
  const darkPc = createToken({ id: 'pc-dark', levelId: 'rdc', kind: 'pc', cell: { a: 9, b: 5 }, visionDim: 0 });
  const torch = createToken({
    id: 'torch', levelId: 'rdc', kind: 'npc', cell: { a: 8, b: 5 }, visionDim: 0,
    emitsLight: { range: 2, intensity: 1, color: '#ffcc66' },
  });

  // ⭐ **Règle changée le 11/08/2026 : une lumière n'est pas un œil.**
  //
  // Ce test affirmait l'inverse — « la lumière fixe révèle son côté du mur » — alors que le
  // seul PJ est aveugle (`visionDim: 0`) et se tient derrière ce mur. Personne ne pouvait
  // donc voir cette zone, et elle était pourtant dévoilée.
  //
  // Le défaut s'est vu en séance sur une carte Dungeon Alchemist, qui place des lumières
  // systématiquement : chargée **sans aucun pion**, elle projetait des cônes de vision à
  // travers les portes d'une tour. Le mainteneur a tranché : l'éclairage aide les joueurs à
  // voir plus loin, il ne révèle rien par lui-même.
  const { ctx } = createMockCanvas(120, 100);
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 120, 100);
  const fogLayer = createTestFogLayer();
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [darkPc], defaultOptions());
  assert.ok(
    ctx.getImageData(25, 55).data[0] < 100,
    'aucun PJ n’a vue sur la lumière : elle ne doit rien révéler'
  );
  assert.ok(ctx.getImageData(70, 55).data[0] < 100, 'le mur bloque la lumière fixe');

  // Et le pendant : un PJ du même côté que la lumière, avec une ligne de vue dégagée,
  // bénéficie bien de son éclairage — sinon la règle aurait tué la fonctionnalité.
  //
  // ⭐ **Réécrit avec la tranche Z-05 (26/08/2026), et il éprouve désormais la VRAIE chaîne.**
  //
  // Jusque-là, ce pendant passait par le repli de `render`, qui unissait les polygones de
  // vision des PJ ET ceux des lumières. Ce repli est devenu **conservateur** — la vision
  // nocturne seule — parce que sans champ lumineux la ligne de vue entière révélerait une
  // pièce noire à 20 cases, ce qui est une fuite.
  //
  // Le chemin de production compose donc la vision et la passe en `visibleCanvas` :
  //
  //     visible = (ligne de vue ∩ éclairé)  ∪  (ce que le PJ voit dans le noir)
  //
  // ⚠ Le champ lumineux est fabriqué **à la main** ici, et c'est délibéré : la composition
  // des dégradés est déjà éprouvée dans `lightField.test.mjs`, avec un mock qui rasterise.
  // Ce test-ci éprouve l'INTÉGRATION — que les polygones du sweep et le champ se rencontrent
  // dans le bon espace de coordonnées et dans le bon ordre.
  const pcEclaire = createToken({
    id: 'pc-eclaire', levelId: 'rdc', kind: 'pc', cell: { a: 1, b: 5 }, visionDim: 0,
  });

  const coucheVision = createTestFogLayer();
  coucheVision.updateVision(grid, level, [pcEclaire], { extractSegments: extractBlockedSegments });

  // La lampe est en (2,5 ; 5,5) cases et porte à 3 cases. On éclaire ce disque, en pixels de
  // masque — 8 par case.
  const masque = level.widthCells * FOG_MASK_PX_PER_CELL;
  const champ = createMockCanvas(masque, level.heightCells * FOG_MASK_PX_PER_CELL);
  champ.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  champ.ctx.fillRect(
    (2.5 - 3) * FOG_MASK_PX_PER_CELL, (5.5 - 3) * FOG_MASK_PX_PER_CELL,
    6 * FOG_MASK_PX_PER_CELL, 6 * FOG_MASK_PX_PER_CELL
  );

  const vision = createMockCanvas(masque, level.heightCells * FOG_MASK_PX_PER_CELL);
  const coin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const coin1 = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const compose = composeVisibleMask(vision.canvas, {
    losPolygons: coucheVision.getLosPolygons(),
    nearPolygons: coucheVision.getNearPolygons(),
    litCanvas: champ.canvas,
    mapOrigin: coin0,
    gridScale: Math.abs(coin1.x - coin0.x),
    createCanvas: (/** @type {number} */ w, /** @type {number} */ h) => createMockCanvas(w, h).canvas,
  });
  assert.equal(compose, true, 'la vision doit se composer');

  const { ctx: ctx2 } = createMockCanvas(120, 100);
  ctx2.fillStyle = 'rgb(100, 100, 100)';
  ctx2.fillRect(0, 0, 120, 100);
  createTestFogLayer().render(
    /** @type {any} */ (ctx2), grid, level, [pcEclaire],
    defaultOptions({ visibleCanvas: vision.canvas })
  );
  assert.equal(
    ctx2.getImageData(25, 55).data[0],
    100,
    'un PJ qui voit la lumière profite de son éclairage'
  );

  // ⭐ Et le contre-épreuve, qui n'existait pas : SANS champ lumineux, ce même PJ aveugle ne
  // voit RIEN. C'est ce qui distingue « la lumière sert » de « la ligne de vue suffit ».
  const visionSansLumiere = createMockCanvas(masque, level.heightCells * FOG_MASK_PX_PER_CELL);
  composeVisibleMask(visionSansLumiere.canvas, {
    losPolygons: coucheVision.getLosPolygons(),
    nearPolygons: coucheVision.getNearPolygons(),
    litCanvas: createMockCanvas(masque, level.heightCells * FOG_MASK_PX_PER_CELL).canvas,
    mapOrigin: coin0,
    gridScale: Math.abs(coin1.x - coin0.x),
    createCanvas: (/** @type {number} */ w, /** @type {number} */ h) => createMockCanvas(w, h).canvas,
  });
  const { ctx: ctxEteint } = createMockCanvas(120, 100);
  ctxEteint.fillStyle = 'rgb(100, 100, 100)';
  ctxEteint.fillRect(0, 0, 120, 100);
  createTestFogLayer().render(
    /** @type {any} */ (ctxEteint), grid, level, [pcEclaire],
    defaultOptions({ visibleCanvas: visionSansLumiere.canvas })
  );
  assert.ok(
    ctxEteint.getImageData(25, 55).data[0] < 100,
    '⛔ champ éteint : le PJ aveugle ne voit rien, même en ligne de vue'
  );

  // Et sans aucun pion, une carte à lumières reste intégralement couverte.
  const { ctx: ctx3 } = createMockCanvas(120, 100);
  ctx3.fillStyle = 'rgb(100, 100, 100)';
  ctx3.fillRect(0, 0, 120, 100);
  createTestFogLayer().render(/** @type {any} */ (ctx3), grid, level, [], defaultOptions());
  assert.ok(
    ctx3.getImageData(25, 55).data[0] < 100,
    'sans pion, une carte Dungeon Alchemist ne doit rien dévoiler'
  );

  fogLayer.updateVision(grid, level, [darkPc, torch], { extractSegments: extractBlockedSegments });
  const before = fogLayer.getVisionSignature();
  const movedTorch = { ...torch, cell: { a: 10, b: 5 } };
  assert.equal(
    fogLayer.updateVision(grid, level, [darkPc, movedTorch], { extractSegments: extractBlockedSegments }),
    true,
    'déplacer une torche invalide immédiatement le cache sans attendre rAF'
  );
  assert.notEqual(fogLayer.getVisionSignature(), before);

  const litLevel = { ...level, ambient: { ...level.ambient, level: 1 } };
  assert.equal(
    fogLayer.updateVision(grid, litLevel, [darkPc], { extractSegments: extractBlockedSegments }),
    true,
    'une ambiante positive rend le PJ sans vision nocturne contributeur'
  );

  // ⭐ **Ce que « contribuer » veut dire a changé avec la tranche Z-05 (26/08/2026).**
  //
  // Avant, l'ambiante gouvernait la GÉOMÉTRIE : un PJ à `visionDim: 0` ne produisait un
  // polygone que si l'étage était éclairé. C'était le prédicat `ambientLit`, global à
  // l'étage — une seule lampe et tout l'étage basculait.
  //
  // Désormais un PJ porte **toujours** une ligne de vue, et c'est la rasterisation qui
  // l'intersecte avec le champ lumineux, point par point. La contribution se lit donc sur
  // `getLosPolygons()`, et `getVisiblePolygons()` n'est plus que le repli conservateur —
  // la vision nocturne seule, nulle pour ce PJ aveugle, et c'est correct.
  assert.ok(
    fogLayer.getLosPolygons().length > 0,
    'un PJ porte toujours une ligne de vue, éclairé ou non'
  );
  assert.equal(
    fogLayer.getNearPolygons().length,
    0,
    'mais aucune portée nocturne : ce PJ est aveugle dans le noir'
  );
  assert.equal(
    fogLayer.getVisiblePolygons().length,
    0,
    '⛔ et le repli sans champ lumineux ne révèle RIEN — révéler moins, jamais plus'
  );
  assert.equal(
    fogLayer.updateVision(
      grid,
      litLevel,
      [{ ...darkPc, cell: { a: 8, b: 5 } }],
      { extractSegments: extractBlockedSegments }
    ),
    true,
    'en ambiance éclairée, le déplacement d’un PJ visionDim=0 invalide aussi la signature'
  );

  const bakedLevel = { ...level, ambient: { ...level.ambient, baked: true } };
  assert.equal(
    fogLayer.updateVision(grid, bakedLevel, [darkPc], { extractSegments: extractBlockedSegments }),
    true,
    'baked force la même ambiante éclairée sans modifier le niveau importé'
  );
});

// ── BRIEF-FOG-BASSE-RESOLUTION.md : composer à la résolution du masque ─────────────────

test('Le tampon hors écran travaille à la résolution du masque, jamais à celle de la carte', () => {
  // pxPerCell largement supérieur à FOG_MASK_PX_PER_CELL (8) : sur une vraie carte
  // Stained Karbon (140 px/case), un tampon à la taille de la carte ferait 17,5× la
  // largeur du masque. Si `render()` régresse vers `mapWidth`/`mapHeight`, ce test le
  // voit directement sur les dimensions du canvas hors écran.
  const level = createLevel({ id: 'rdc', widthCells: 10, heightCells: 6, pxPerCell: 140 });
  const grid = gridFor(level);
  const { ctx } = createMockCanvas(1400, 840); // 10×140 par 6×140, taille carte

  const fogLayer = createTestFogLayer();
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [], defaultOptions());

  assert.equal(fogLayer._offscreenCanvas.width, 10 * FOG_MASK_PX_PER_CELL, 'largeur du tampon = widthCells × 8');
  assert.equal(fogLayer._offscreenCanvas.height, 6 * FOG_MASK_PX_PER_CELL, 'hauteur du tampon = heightCells × 8');
  assert.notEqual(fogLayer._offscreenCanvas.width, 1400, 'jamais la largeur de la carte');
  assert.notEqual(fogLayer._offscreenCanvas.height, 840, 'jamais la hauteur de la carte');
});

test('La conversion des polygones vers l’espace du masque tient à 140 px/case', () => {
  // Les polygones de vision sont en pixels carte (`MapPoint`). Sans la conversion par
  // `FOG_MASK_PX_PER_CELL` et l'origine de l'étage, ils seraient tracés 17,5× trop grands
  // dans le petit canvas de masque (piège n°1 du brief) : le trou de vision manquerait
  // entièrement sa cible, et le point proche du PJ resterait voilé au lieu d'être révélé.
  const level = createLevel({
    id: 'rdc', widthCells: 10, heightCells: 6, pxPerCell: 140,
    ambient: { level: 0, baked: false },
  });
  const grid = gridFor(level);
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 3 }, visionDim: 4 });

  const { ctx } = createMockCanvas(1400, 840);
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 1400, 840);

  createTestFogLayer().render(/** @type {any} */ (ctx), grid, level, [pc], defaultOptions());

  // Le PJ est au centre de la case (2,3), soit (350, 490) en pixels carte : un point tout
  // proche doit rester visible malgré le passage par un masque à 8 px/case.
  const pixelProche = ctx.getImageData(360, 490).data;
  assert.equal(pixelProche[0], 100, 'le point proche du PJ reste visible après le passage par le masque');

  // Hors de la portée de vision (4 cases = 560 px), le voile doit subsister.
  const pixelLoin = ctx.getImageData(1350, 800).data;
  assert.ok(pixelLoin[0] < 100, 'un point hors de portée reste voilé');
});

test('Le cache de composition s’invalide quand le masque exploré change, même sans changer d’objet', () => {
  // `ExploredFog` mute son canvas en place (`reveal`/`paintDisc`...) : son identité ne
  // change jamais. C'est exactement le cas que le cache de `FogLayer` doit détecter via
  // `canvas.__fogRevision`, sans quoi le premier fog composé resterait figé à l'écran —
  // le défaut « plus coûteux que le coût supprimé » nommé par le brief.
  const level = createLevel({
    id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10,
    ambient: { level: 0, baked: false },
  });
  const grid = gridFor(level);
  const exploredFog = new ExploredFog(level.widthCells, level.heightCells, (w, h) => createMockCanvas(w, h).canvas);

  const { ctx } = createMockCanvas(100, 100);
  const fogLayer = createTestFogLayer();

  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 100, 100);
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [], defaultOptions({ exploredCanvas: exploredFog.canvas }));
  const avant = ctx.getImageData(15, 15).data;
  assert.ok(avant[0] < 100, 'avant révélation, la zone reste voilée');

  // Révéler cette zone SANS remplacer le canvas — même référence, contenu changé.
  // `reveal()` plutôt que `paintDisc()` : le mock de canvas ne connaît que
  // moveTo/lineTo/closePath/fill, pas `arc()`.
  const origin0 = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  exploredFog.reveal(
    [[
      { x: origin0.x, y: origin0.y },
      { x: origin0.x + 30, y: origin0.y },
      { x: origin0.x + 30, y: origin0.y + 30 },
      { x: origin0.x, y: origin0.y + 30 },
    ]],
    origin0,
    10
  );

  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 100, 100);
  fogLayer.render(/** @type {any} */ (ctx), grid, level, [], defaultOptions({ exploredCanvas: exploredFog.canvas }));
  const apres = ctx.getImageData(15, 15).data;

  assert.notEqual(apres[0], avant[0], 'après révélation, le rendu doit changer : le cache ne fige pas le premier fog composé');
});

test('⭐ alphaNonExplore — le complément, seule garde de la lisibilité de la vue MJ', () => {
  // Ce calcul vivait EN LIGNE dans `render()` jusqu'au 23/08/2026, donc hors de portée de tout
  // test unitaire : sa seule garde était `fogVeil.spec.mjs`, un e2e. Un e2e mesure aussi la
  // machine — il finit désactivé un jour, et l'arithmétique se retrouve sans surveillance.

  // ⛔ Le cas qui compte, et celui qui a réellement cassé : vue MJ, 0,70 visé sur 0,45 de voile
  // exploré. Peindre 0,70 directement donnait 1−(1−0,70)(1−0,45) = 0,835 — la zone non
  // découverte devenait illisible. Le complément vaut (0,70−0,45)/(1−0,45).
  const complement = alphaNonExplore(0.7, 0.45, true);
  assert.ok(Math.abs(complement - 0.25 / 0.55) < 1e-12, `complément attendu 0,4545…, obtenu ${complement}`);

  // ⭐ Et la propriété qui donne son SENS au complément : une fois les deux voiles superposés,
  // la somme doit rendre exactement l'opacité visée. C'est ça qu'on protège, pas une formule.
  const somme = 1 - (1 - complement) * (1 - 0.45);
  assert.ok(Math.abs(somme - 0.7) < 1e-12, `les deux voiles doivent totaliser 0,70, obtenu ${somme}`);

  // Sans masque exploré, l'étape B n'a pas lieu : la valeur visée se peint telle quelle.
  assert.equal(alphaNonExplore(0.7, 0.45, false), 0.7);

  // Côté joueurs, U vaut 1 : le complément vaut 1 aussi, les pions restent masqués.
  assert.equal(alphaNonExplore(1, 0.6, true), 1);

  // ⛔ Un voile exploré déjà opaque rendrait la division infinie : on retombe sur la valeur visée.
  assert.equal(alphaNonExplore(0.7, 1, true), 0.7);

  // Jamais de négatif : un voile exploré plus opaque que le visé n'inverse pas le calcul.
  assert.equal(alphaNonExplore(0.3, 0.8, true), 0);
});

test('⭐ Z-05 — plus aucun PJ : les TROIS jeux de polygones retombent à vide', () => {
  // ⛔ **Vision fantôme.** Le retour anticipé « aucun PJ sur l'étage » ne vidait que
  // `_cachedPolygons`. `_losPolygons` gardait sa valeur précédente, et la vision composée à
  // partir de lui continuait d'être publiée alors que plus personne n'était là pour voir.
  //
  // Attrapé par le scénario e2e UX-13 — « Remplacer l'étage courant » range les pions en
  // réserve, et le masque visible devait retomber à zéro. Il gardait la vision d'avant.
  //
  // ⚠ Ce test existe parce que la mutation correspondante restait VERTE à l'unité : seul un
  // e2e la voyait. Une propriété aussi bon marché n'a pas à coûter un navigateur.
  const level = createLevel({
    id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10,
    ambient: { level: 1, baked: false },
  });
  const grid = gridFor(level);
  const pc = createToken({ id: 'pc', levelId: 'rdc', kind: 'pc', cell: { a: 5, b: 5 }, visionDim: 6 });

  const couche = createTestFogLayer();
  couche.updateVision(grid, level, [pc], { extractSegments: extractBlockedSegments });
  assert.ok(couche.getLosPolygons().length > 0, 'un PJ présent produit bien une ligne de vue');
  assert.ok(couche.getNearPolygons().length > 0);

  // Le PJ s'en va — rangé en réserve, monté d'un étage, retiré du plateau.
  couche.updateVision(grid, level, [], { extractSegments: extractBlockedSegments });
  assert.deepEqual(couche.getLosPolygons(), [], '⛔ la ligne de vue ne doit RIEN garder');
  assert.deepEqual(couche.getNearPolygons(), [], '⛔ ni la portée nocturne');
  assert.deepEqual(couche.getVisiblePolygons(), [], '⛔ ni le repli');
});
