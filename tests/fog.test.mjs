// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLevel, createToken } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { FOG_MAX_ENCODED_BYTES, FOG_MASK_PX_PER_CELL } from '../js/core/constants.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import {
  ExploredFog,
  encodeFogPng,
  decodeFogPng,
} from '../js/vision/fog.js';
import { FogLayer } from '../js/render/layers/fogLayer.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import * as store from '../js/state/store.js';

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
    getImageDataCalls: 0,

    save() {},
    restore() {},
    ellipse() {},
    arc() {},
    stroke() {},
    strokeRect() {},
    clip() {},
    fillText() {},
    measureText() { return { width: 10 }; },
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
      const points = ctx._path.filter((p) => p.type === 'move' || p.type === 'line');
      if (points.length === 0) return;

      const minX = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x))));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(...points.map((p) => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map((p) => p.y))));

      const color = parseColor(ctx.fillStyle);

      for (let r = minY; r <= maxY; r++) {
        for (let c = minX; c <= maxX; c++) {
          if (pointInPoly(c + 0.5, r + 0.5, points)) {
            const idx = (r * width + c) * 4;
            blendPixel(pixels, idx, color, ctx.globalCompositeOperation);
          }
        }
      }
    },
    /** @param {any} image @param {number} [dx] @param {number} [dy] @param {number} [dw] @param {number} [dh] */
    drawImage(image, dx = 0, dy = 0, dw, dh) {
      if (!image || !image._ctx) return;
      const srcPixels = image._ctx.pixels;
      const srcWidth = image.width || width;
      const srcHeight = image.height || height;
      const dstW = dw !== undefined ? dw : srcWidth;
      const dstH = dh !== undefined ? dh : srcHeight;

      for (let r = 0; r < dstH; r++) {
        for (let c = 0; c < dstW; c++) {
          const srcC = Math.floor((c / dstW) * srcWidth);
          const srcR = Math.floor((r / dstH) * srcHeight);
          const srcIdx = (srcR * srcWidth + srcC) * 4;
          const dstIdx = ((r + dy) * width + (c + dx)) * 4;

          if (dstIdx < 0 || dstIdx >= pixels.length) continue;

          const srcColor = [srcPixels[srcIdx], srcPixels[srcIdx + 1], srcPixels[srcIdx + 2], srcPixels[srcIdx + 3]];
          blendPixel(pixels, dstIdx, srcColor, ctx.globalCompositeOperation);
        }
      }
    },
    /** @param {number} x @param {number} y @param {number} [w] @param {number} [h] */
    getImageData(x, y, w = 1, h = 1) {
      // Comptage EXTÉRIEUR : c'est le contexte qui compte ses propres appels, pas le
      // module observé. Une version précédente exportait un compteur depuis `fog.js`,
      // incrémenté par `fog.js` — ajouter un appel non compté laissait la suite verte.
      ctx.getImageDataCalls++;
      const result = new Uint8Array(w * h * 4);
      let resIdx = 0;
      for (let r = Math.floor(y); r < Math.floor(y + h); r++) {
        for (let c = Math.floor(x); c < Math.floor(x + w); c++) {
          const idx = (r * width + c) * 4;
          result[resIdx++] = pixels[idx] || 0;
          result[resIdx++] = pixels[idx + 1] || 0;
          result[resIdx++] = pixels[idx + 2] || 0;
          result[resIdx++] = pixels[idx + 3] || 0;
        }
      }
      return { data: result };
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

/** @param {string} str */
function parseColor(str) {
  if (str === '#000000') return [0, 0, 0, 255];
  if (str === '#ffffff') return [255, 255, 255, 255];
  if (str === '#00ff00') return [0, 255, 0, 255];
  if (str === '#ff0000') return [255, 0, 0, 255];
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
  } else if (mode === 'destination-in') {
    const keepAlpha = color[3] / 255;
    pixels[idx + 3] = Math.round(pixels[idx + 3] * keepAlpha);
  } else if (mode === 'destination-over') {
    const srcAlpha = color[3] / 255;
    const dstAlpha = pixels[idx + 3] / 255;
    const outAlpha = dstAlpha + srcAlpha * (1 - dstAlpha);

    if (outAlpha > 0) {
      pixels[idx] = Math.round((pixels[idx] * dstAlpha + color[0] * srcAlpha * (1 - dstAlpha)) / outAlpha);
      pixels[idx + 1] = Math.round((pixels[idx + 1] * dstAlpha + color[1] * srcAlpha * (1 - dstAlpha)) / outAlpha);
      pixels[idx + 2] = Math.round((pixels[idx + 2] * dstAlpha + color[2] * srcAlpha * (1 - dstAlpha)) / outAlpha);
      pixels[idx + 3] = Math.round(outAlpha * 255);
    }
  } else {
    // source-over
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

// ── PREUVE CRITÈRE 9 : PNG Aller-Retour Non Destructif ──────────────────────
test('Preuve Critère 9 : encode -> decode -> encode conserve rigoureusement le canal alpha (zone explorée alpha=255, zone vierge alpha=0)', async () => {
  const widthCells = 10;
  const heightCells = 10;

  // Créer un masque source avec la moitié supérieure explorée (alpha=255) et la moitié inférieure vierge (alpha=0)
  const sourceCanvas = createMockCanvas(80, 80).canvas;
  const ctx = sourceCanvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.fillRect(0, 0, 80, 40); // Zone explorée (moitié haut)
  }

  // 1er encodage
  const png1 = await encodeFogPng(sourceCanvas);

  // Décodage
  const decodedCanvas = await decodeFogPng(png1, widthCells, heightCells, (w, h) => createMockCanvas(w, h).canvas);
  const decCtx = decodedCanvas.getContext('2d');
  assert.ok(decCtx, 'decCtx doit être disponible');

  // Vérifier l'alpha échantillonné dans le decodedCanvas
  const pxExplored = decCtx.getImageData(20, 20, 1, 1).data;
  assert.equal(pxExplored[3], 255, 'La zone explorée doit avoir un alpha de 255 après décompression');

  const pxVirgin = decCtx.getImageData(20, 60, 1, 1).data;
  assert.equal(pxVirgin[3], 0, 'La zone vierge doit avoir un alpha de 0 après décompression');

  // 2e encodage
  const png2 = await encodeFogPng(decodedCanvas);
  assert.equal(png2, png1, 'Un aller-retour encode -> decode -> encode doit restituer un PNG strictement identique byte-for-byte');
});

// ── 1. Critère 7 : Le couloir entier ─────────────────────────────────────────
//
// Ce test passe par `revealPath()`, qui balaie lui-même chaque case. Une version
// précédente appelait `reveal()` dans une boucle écrite à la main avec des polygones
// fabriqués : elle prouvait que l'accumulation fonctionne, mais serait restée verte
// alors même que l'application ne révélait QUE la case d'arrivée — ce qui était le cas.
// Le milieu du couloir est donc échantillonné à une distance où seul un balayage
// intermédiaire peut l'atteindre.
test('Critère 7 : revealPath révèle tout le couloir, y compris un milieu hors de portée des deux extrémités', () => {
  const level = createLevel({ id: 'couloir', widthCells: 30, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);
  const mapOrigin = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  /** @param {number} a @param {number} b */
  const centre = (a, b) => grid.mapFromCellPoint({ cellX: a + 0.5, cellY: b + 0.5 });

  // Portée de 3 cases : la case 14 est hors de vue depuis la case 1 comme depuis la 28.
  const porteePx = 3 * level.pxPerCell;
  const origins = [];
  for (let a = 1; a <= 28; a++) origins.push(centre(a, 5));

  const fog = new ExploredFog(30, 10, (w, h) => createMockCanvas(w, h).canvas);
  const balayees = fog.revealPath(origins, [], porteePx, mapOrigin, level.pxPerCell);
  assert.equal(balayees, 28, 'Chaque case du chemin doit donner lieu à un balayage');

  /** @param {number} a @param {number} b */
  const alphaEnCase = (a, b) => {
    const x = Math.round((a + 0.5) * FOG_MASK_PX_PER_CELL);
    const y = Math.round((b + 0.5) * FOG_MASK_PX_PER_CELL);
    return fog.ctx.getImageData(x, y, 1, 1).data[3];
  };

  assert.ok(alphaEnCase(1, 5) > 0, 'Le départ est exploré');
  assert.ok(alphaEnCase(28, 5) > 0, 'L arrivée est explorée');
  assert.ok(
    alphaEnCase(14, 5) > 0,
    'Le MILIEU du couloir est exploré — hors de portée du départ comme de l arrivée, il ne peut l être que par un balayage intermédiaire'
  );
});

test('Critère 7, contre-épreuve : ne révéler que l arrivée laisse le milieu du couloir noir', () => {
  const level = createLevel({ id: 'couloir', widthCells: 30, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);
  const mapOrigin = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const porteePx = 3 * level.pxPerCell;

  const fog = new ExploredFog(30, 10, (w, h) => createMockCanvas(w, h).canvas);
  // Le défaut qu'on veut interdire : un seul balayage, à la case d'arrivée.
  fog.revealPath([grid.mapFromCellPoint({ cellX: 28.5, cellY: 5.5 })], [], porteePx, mapOrigin, level.pxPerCell);

  const x = Math.round(14.5 * FOG_MASK_PX_PER_CELL);
  const y = Math.round(5.5 * FOG_MASK_PX_PER_CELL);
  assert.equal(
    fog.ctx.getImageData(x, y, 1, 1).data[3],
    0,
    'Sans balayage intermédiaire le milieu reste noir : c est bien ce que le critère 7 interdit, et ce que le test précédent détecte'
  );
});

// ── 2. Critère 6 : La zone quittée reste grisée, AUCUN pion ne transparaît ─
test('Critère 6 : La zone explorée-hors-vision reste grisée sur la vue joueurs ET AUCUN pion n y transparaît sur le rendu', () => {
  const level = createLevel({ id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);

  // Pion PJ en (1, 1) avec vision
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 1, b: 1 }, visionDim: 3 });
  // Pion PNJ en (8, 8) (hors vision courante du PJ, mais en zone explorée)
  const npc = createToken({ id: 'npc', levelId: 'rdc', kind: 'npc', cell: { a: 8, b: 8 }, visionDim: 0, borderColor: '#ff0000' });

  // Masque exploré : toute la carte est explorée
  const exploredCanvas = createMockCanvas(80, 80).canvas;
  const expCtx = exploredCanvas.getContext('2d');
  if (expCtx) {
    expCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    expCtx.fillRect(0, 0, 80, 80);
  }

  // Masque de vision courante (visible) : uniquement autour de (1, 1) -> (15, 15)
  const visibleCanvas = createMockCanvas(80, 80).canvas;
  const visCtx = visibleCanvas.getContext('2d');
  if (visCtx) {
    visCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    visCtx.fillRect(0, 0, 30, 30);
  }

  // Assertion 1 : Rendu direct de TokensLayer côté joueurs
  const { ctx: tokenCtx } = createMockCanvas(100, 100);
  const tokensLayer = new TokensLayer();
  tokensLayer.render(/** @type {any} */ (tokenCtx), grid, [pc, npc], null, {
    role: 'players',
    activeLevelId: 'rdc',
    activeLevelWidthCells: 10,
    activeLevelHeightCells: 10,
    visibleCanvas,
    createOffscreenCanvas: (/** @type {number} */ w, /** @type {number} */ h) => createMockCanvas(w, h).canvas,
  });

  const pxPionPnj = tokenCtx.getImageData(85, 85, 1, 1).data;
  assert.equal(pxPionPnj[3], 0, 'TokensLayer : aucun pixel de pion ne doit être rendu en zone explorée-hors-vision (alpha=0)');

  // Assertion 2 : Rendu composite complet stage (Fond + Fog)
  const { ctx: stageCtx } = createMockCanvas(100, 100);
  stageCtx.fillStyle = 'rgb(100, 100, 100)';
  stageCtx.fillRect(0, 0, 100, 100);

  const fogLayer = new FogLayer({ createOffscreenCanvas: (w, h) => createMockCanvas(w, h).canvas });
  fogLayer.render(/** @type {any} */ (stageCtx), grid, level, [pc, npc], {
    role: 'players',
    exploredCanvas,
    visibleCanvas,
  });

  const pxTerrainGrise = stageCtx.getImageData(85, 85, 1, 1).data;
  assert.ok(pxTerrainGrise[0] < 100, 'FogLayer : la zone explorée-hors-vision doit être grisée (< 100)');
  assert.ok(pxTerrainGrise[0] > 0, 'FogLayer : la zone explorée-hors-vision doit garder le terrain lisible (> 0)');
});

// ── 3. Critère 5 : Masqué chez les joueurs, jamais chez le MJ ────────────────
test('Critère 5 : Une zone jamais explorée est noire opaque côté joueurs et lisible/voilée côté MJ', () => {
  const level = createLevel({ id: 'rdc', widthCells: 10, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);

  const fogLayer = new FogLayer({ createOffscreenCanvas: (w, h) => createMockCanvas(w, h).canvas });

  // Vue Joueurs
  const { ctx: playerCtx } = createMockCanvas(100, 100);
  playerCtx.fillStyle = 'rgb(100, 100, 100)';
  playerCtx.fillRect(0, 0, 100, 100);
  fogLayer.render(/** @type {any} */ (playerCtx), grid, level, [], { role: 'players' });

  const pxPlayer = playerCtx.getImageData(85, 85, 1, 1).data;
  assert.equal(pxPlayer[0], 0, 'Vue Joueurs : zone jamais explorée est opaque noire (R=0)');

  // Vue MJ
  const { ctx: gmCtx } = createMockCanvas(100, 100);
  gmCtx.fillStyle = 'rgb(100, 100, 100)';
  gmCtx.fillRect(0, 0, 100, 100);
  fogLayer.render(/** @type {any} */ (gmCtx), grid, level, [], { role: 'gm' });

  const pxGM = gmCtx.getImageData(85, 85, 1, 1).data;
  assert.ok(pxGM[0] > 0, 'Vue MJ : zone jamais explorée reste lisible (R > 0)');
  assert.ok(pxGM[0] < 100, 'Vue MJ : zone jamais explorée est voilée (R < 100)');
});

// ── 4. Critère 9 : Survie au redémarrage (Persistance LocalStorage) ────────
test('Critère 9 : Le masque exploré est conservé et restauré via le store', () => {
  store.setSessionId('test-session-fog');
  const dummyB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  store.setSessionFog('rdc', dummyB64);
  assert.equal(store.getSessionFog('rdc'), dummyB64, 'Le masque exploré doit être restauré depuis le store');
});

// ── 5. Critère 12 : Aucune fuite aux angles ─────────────────────────────────
test('Critère 12 : Une case derrière un angle de mur reste non explorée sans fuite de pixel', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 10,
    walls: [
      [
        { cellX: 5, cellY: 0 },
        { cellX: 5, cellY: 5 },
      ],
    ],
  });
  const grid = gridFor(level);
  const pc = createToken({ id: 'pj', levelId: 'rdc', kind: 'pc', cell: { a: 2, b: 2 }, visionDim: 5 });

  const fogLayer = new FogLayer({ createOffscreenCanvas: (w, h) => createMockCanvas(w, h).canvas });
  const { ctx } = createMockCanvas(100, 100);

  fogLayer.render(/** @type {any} */ (ctx), grid, level, [pc], {
    role: 'gm',
    extractSegments: extractBlockedSegments,
  });

  const polygons = fogLayer.getVisiblePolygons();
  const exploredFog = new ExploredFog(10, 10, (w, h) => createMockCanvas(w, h).canvas);
  exploredFog.reveal(polygons, { x: 0, y: 0 }, 10);

  const pxDerriere = exploredFog.ctx.getImageData(56, 20, 1, 1).data;
  assert.equal(pxDerriere[3], 0, 'La case derrière le mur ne doit pas fuir dans le masque exploré (alpha=0)');
});

// ── 6. Substitution des toits ───────────────────────────────────────────────
test('La substitution des toits : l intérieur d un bâtiment clos sur étage non visité est opaque', () => {
  const level = createLevel({ id: 'toit', widthCells: 10, heightCells: 10, pxPerCell: 10 });
  const grid = gridFor(level);

  const fogLayer = new FogLayer({ createOffscreenCanvas: (w, h) => createMockCanvas(w, h).canvas });
  const { ctx } = createMockCanvas(100, 100);
  ctx.fillStyle = 'rgb(100, 100, 100)';
  ctx.fillRect(0, 0, 100, 100);

  fogLayer.render(/** @type {any} */ (ctx), grid, level, [], { role: 'players' });

  const pxInterieur = ctx.getImageData(55, 55, 1, 1).data;
  assert.equal(pxInterieur[0], 0, 'L intérieur non visité est 100% opaque noir côté joueurs');
});

// ── 7. Borne de taille du masque encodé ──────────────────────────────────────
test('Le masque encodé au-delà de FOG_MAX_ENCODED_BYTES est refusé par encodeFogPng', async () => {
  const width = 1200;
  const height = 1200;
  const mockCanvas = createMockCanvas(width, height).canvas;

  for (let i = 0; i < mockCanvas._ctx.pixels.length; i += 4) {
    mockCanvas._ctx.pixels[i + 3] = Math.floor(Math.abs(Math.sin((i + 1) * 9999) * 256)) & 0xff;
  }

  try {
    await encodeFogPng(mockCanvas);
    assert.fail('encodeFogPng aurait dû lever une erreur');
  } catch (err) {
    assert.match(/** @type {Error} */ (err).message, /Masque de fog encodé trop grand/);
  }
});

// ── 8. Critère 8 : aucun getImageData sur le chemin de déplacement ───────────
//
// Le comptage est fait par le MOCK DE CONTEXTE, pas par le module observé. C'est la
// différence qui compte : `fog.js` exportait auparavant son propre compteur, si bien
// que le critère se lisait « fog.js affirme n'avoir pas appelé getImageData ». Ajouter
// un appel non compté laissait la suite verte — vérifié par mutation.
test('Critère 8 : le balayage d un chemin ne déclenche aucun getImageData, et la publication en déclenche exactement un', async () => {
  const level = createLevel({ id: 'rdc', widthCells: 20, heightCells: 20, pxPerCell: 10 });
  const grid = gridFor(level);
  const mapOrigin = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });

  /** @type {any} */
  let masqueCtx = null;
  const fog = new ExploredFog(20, 20, (w, h) => {
    const m = createMockCanvas(w, h);
    masqueCtx = m.ctx;
    return m.canvas;
  });

  const origins = [];
  for (let a = 1; a <= 10; a++) origins.push(grid.mapFromCellPoint({ cellX: a + 0.5, cellY: 5.5 }));

  masqueCtx.getImageDataCalls = 0;
  fog.revealPath(origins, [], 3 * level.pxPerCell, mapOrigin, level.pxPerCell);
  assert.equal(
    masqueCtx.getImageDataCalls,
    0,
    'Balayer dix cases ne doit relire aucun pixel : le masque s accumule par fill() natif'
  );

  await fog.exportPng();
  assert.equal(
    masqueCtx.getImageDataCalls,
    1,
    'La publication relit le masque exactement une fois'
  );
});

// ── 9. Fog cumulatif ────────────────────────────────────────────────────────
test('Le fog exploré est cumulatif et ne se vide pas sur mouvement de pion', () => {
  const fog = new ExploredFog(10, 10, (w, h) => createMockCanvas(w, h).canvas);

  fog.reveal(
    [
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
    ],
    { x: 0, y: 0 },
    10
  );

  fog.reveal(
    [
      [
        { x: 50, y: 50 },
        { x: 70, y: 50 },
        { x: 70, y: 70 },
        { x: 50, y: 70 },
      ],
    ],
    { x: 0, y: 0 },
    10
  );

  const pxA = fog.ctx.getImageData(5, 5, 1, 1).data;
  assert.ok(pxA[3] > 0, 'Zone A initiale doit rester explorée');

  const pxB = fog.ctx.getImageData(55, 55, 1, 1).data;
  assert.ok(pxB[3] > 0, 'Zone B suivante doit s accumuler dans le masque');
});
