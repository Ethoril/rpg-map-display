// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createToken } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { VISION_MAX_RANGE_CELLS } from '../js/core/constants.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import {
  FogLayer,
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
    /** @param {any} image */
    drawImage(image) {
      if (!image || !image._ctx) return;
      const srcPixels = image._ctx.pixels;
      for (let i = 0; i < pixels.length; i += 4) {
        const srcAlpha = srcPixels[i + 3] / 255;
        if (srcAlpha > 0) {
          const dstAlpha = pixels[i + 3] / 255;
          const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);

          if (outAlpha > 0) {
            pixels[i] = Math.round((srcPixels[i] * srcAlpha + pixels[i] * dstAlpha * (1 - srcAlpha)) / outAlpha);
            pixels[i + 1] = Math.round((srcPixels[i + 1] * srcAlpha + pixels[i + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha);
            pixels[i + 2] = Math.round((srcPixels[i + 2] * srcAlpha + pixels[i + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha);
            pixels[i + 3] = Math.round(outAlpha * 255);
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
    const level = createLevel({ id: 'rdc', widthCells: 40, heightCells: 10, pxPerCell: 10 });
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
      { id: 'p1', a: { cellX: 5, cellY: 0 }, b: { cellX: 5, cellY: 10 }, closed: true, freestanding: false },
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
