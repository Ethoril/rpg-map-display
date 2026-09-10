// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExploredFog, isCellVisibleInMask, getOrExtractMaskAlpha } from '../js/vision/fog.js';
import { gridFor } from '../js/grid/index.js';
import { createLevel } from '../js/core/schema.js';
import { createFogTools } from '../js/ui/gm/fogTools.js';
import { readFileSync } from 'node:fs';

function createMockElement() {
  return {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    getAttribute: () => null,
    setAttribute: () => {},
    addEventListener: () => {},
    querySelector: () => createMockElement(),
    querySelectorAll: () => [createMockElement()],
  };
}

function createMockCanvas(width = 100, height = 100) {
  const pixels = new Uint8Array(width * height * 4);

  /** @type {Array<{x: number, y: number}>} */
  let path = [];

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

  const ctx = {
    width,
    height,
    pixels,
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over',

    save() {},
    restore() {},
    clearRect(x = 0, y = 0, w = width, h = height) {
      for (let r = Math.max(0, Math.floor(y)); r < Math.min(height, Math.floor(y + h)); r++) {
        for (let c = Math.max(0, Math.floor(x)); c < Math.min(width, Math.floor(x + w)); c++) {
          const idx = (r * width + c) * 4;
          pixels[idx + 3] = 0;
        }
      }
    },
    fillRect(x = 0, y = 0, w = width, h = height) {
      const isErase = ctx.globalCompositeOperation === 'destination-out';
      for (let r = Math.max(0, Math.floor(y)); r < Math.min(height, Math.floor(y + h)); r++) {
        for (let c = Math.max(0, Math.floor(x)); c < Math.min(width, Math.floor(x + w)); c++) {
          const idx = (r * width + c) * 4;
          pixels[idx + 3] = isErase ? 0 : 255;
        }
      }
    },
    beginPath() { path = []; },
    /** @param {number} x @param {number} y */
    moveTo(x, y) { path.push({ x, y }); },
    /** @param {number} x @param {number} y */
    lineTo(x, y) { path.push({ x, y }); },
    closePath() {},
    // ⭐ Rasterise VRAIMENT, point par point — `paintDisc`/`eraseDisc` approximent désormais
    // le disque par un polygone (E-11 : un cercle en pixels carte devient une ellipse en
    // espace masque sous une échelle X/Y distincte), tracé via moveTo/lineTo/closePath/fill
    // plutôt que `ctx.arc()`. Un `fill()` muet laisserait passer un disque qui ne peint rien.
    fill() {
      if (path.length === 0) return;
      const isErase = ctx.globalCompositeOperation === 'destination-out';
      const minX = Math.max(0, Math.floor(Math.min(...path.map((p) => p.x))));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(...path.map((p) => p.x))));
      const minY = Math.max(0, Math.floor(Math.min(...path.map((p) => p.y))));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(...path.map((p) => p.y))));

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (pointInPoly(x + 0.5, y + 0.5, path)) {
            const idx = (y * width + x) * 4;
            pixels[idx + 3] = isErase ? 0 : 255;
          }
        }
      }
    },
    getImageData(x = 0, y = 0, w = width, h = height) {
      return { width: w || width, height: h || height, data: pixels };
    },
    drawImage(/** @type {any} */ src = null) {
      if (src && src._ctx) {
        pixels.set(src._ctx.pixels);
      }
    },
  };

  const canvas = {
    width,
    height,
    getContext: (/** @type {string} */ type) => (type === '2d' ? ctx : null),
    _ctx: ctx,
  };

  return { canvas, ctx };
}

/** @returns {ExploredFog} */
function createFog() {
  return new ExploredFog(10, 10, (w, h) => createMockCanvas(w, h).canvas);
}

test('ExploredFog : revealAll remplit le masque et clear le vide', () => {
  const fog = createFog();
  fog.revealAll();

  if (fog.ctx) {
    const pixelBuf = fog.ctx.pixels || fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
    assert.equal(pixelBuf[3], 255, 'L\'alpha du coin supérieur gauche doit être 255 (révélé)');
  }

  fog.clear();
  if (fog.ctx) {
    const pixelBuf = fog.ctx.pixels || fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
    assert.equal(pixelBuf[3], 0, 'L\'alpha après clear doit être 0 (non exploré)');
  }
});

test('ExploredFog : paintDisc ajoute et eraseDisc retire (canal alpha destination-out)', () => {
  const fog = createFog();
  const mapOrigin = { x: 0, y: 0 };
  // ⚠ Grille CARREE : les deux echelles sont egales, d'ou le meme nombre passe deux fois.
  // C'est justement l'invariant de non-regression d'E-11 — le carre ne bouge pas.
  const gridScale = 50;

  fog.paintDisc({ x: 100, y: 100 }, 50, mapOrigin, gridScale, gridScale);
  if (fog.ctx) {
    const pixelBuf = fog.ctx.pixels || fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
    assert.ok(pixelBuf.some((/** @type {number} */ val, /** @type {number} */ idx) => idx % 4 === 3 && val > 0), 'Des pixels doivent être explorés après paintDisc');
  }

  fog.eraseDisc({ x: 100, y: 100 }, 60, mapOrigin, gridScale, gridScale);
  if (fog.ctx) {
    const pixelBuf = fog.ctx.pixels || fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
    assert.ok(pixelBuf.every((/** @type {number} */ val, /** @type {number} */ idx) => idx % 4 !== 3 || val === 0), 'L\'alpha doit être retombé à 0 après eraseDisc');
  }
});

test('ExploredFog : aller-retour exportPng / importPng conserve la zone peinte', async () => {
  const fog = createFog();
  const mapOrigin = { x: 0, y: 0 };
  fog.paintDisc({ x: 50, y: 50 }, 30, mapOrigin, 50, 50);

  const png = await fog.exportPng();
  assert.ok(png.length > 0, 'Le PNG exporté ne doit pas être vide');

  const fog2 = createFog();
  await fog2.importPng(png);

  if (fog2.ctx) {
    const pixelBuf = fog2.ctx.pixels || fog2.ctx.getImageData(0, 0, fog2.maskWidth, fog2.maskHeight).data;
    assert.ok(pixelBuf.some((/** @type {number} */ val, /** @type {number} */ idx) => idx % 4 === 3 && val > 0), 'Le masque réimporté doit conserver les pixels explorés');
  }
});

test('Amendement A4 : capture synchrone des pixels dans exportPng()', async () => {
  const fog = createFog();
  const promise = fog.exportPng();
  // Modification synchrone immédiatement après l'appel
  fog.revealAll();
  const capturedPng = await promise;

  // Réimporter le PNG capturé et vérifier qu'il est vierge (capturé avant revealAll)
  const fogCheck = createFog();
  await fogCheck.importPng(capturedPng);

  if (fogCheck.ctx) {
    const pixelBuf = fogCheck.ctx.pixels || fogCheck.ctx.getImageData(0, 0, fogCheck.maskWidth, fogCheck.maskHeight).data;
    assert.equal(pixelBuf[3], 0, 'L\'instantané capturé doit précéder la mutation synchrone');
  }
});

test('Pile d\'undo : profondeur bornée à 10, vidation sur déplacement et isolation par étage', async () => {
  const fogMap = new Map();
  fogMap.set('level-1', createFog());
  fogMap.set('level-2', createFog());

  let activeLevelId = 'level-1';
  let publishedCount = 0;

  const mockContainer = createMockElement();

  const fogTools = createFogTools(/** @type {any} */ (mockContainer), {
    getActiveLevelId: () => activeLevelId,
    getExploredFog: (id) => fogMap.get(id) || null,
    scheduleFogPublish: () => { publishedCount++; },
    requestRender: () => {},
  });

  // Empiler 12 pas sur level-1 avec des états distincts
  for (let i = 0; i < 12; i++) {
    const fog = fogMap.get('level-1');
    if (fog) {
      fog.paintDisc({ x: (i + 1) * 10, y: 10 }, 5, { x: 0, y: 0 }, 50);
    }
    await fogTools.pushUndoState();
  }

  // Vérifier qu'on est plafonné à 10 pas
  assert.equal(fogTools.getUndoStackLength('level-1'), 10, 'La pile d\'undo doit contenir exactement 10 pas maximum');

  // Empiler un pas puis vider via clearUndoStack (mouvement de pion)
  await fogTools.pushUndoState();
  fogTools.clearUndoStack('level-1');

  const beforeClearUndo = publishedCount;
  await fogTools.undo();
  assert.equal(publishedCount, beforeClearUndo, 'L\'undo sur une pile vidée ne doit rien faire');

  // Isolation par étage : empiler sur level-1, basculer vers level-2 et undo
  await fogTools.pushUndoState();
  activeLevelId = 'level-2';
  const beforeLevel2Undo = publishedCount;
  await fogTools.undo();
  assert.equal(publishedCount, beforeLevel2Undo, 'Annuler sur level-2 ne doit pas annuler la pile de level-1');
});

test('Vérification A6 : Aucun import de fogTools.js dans la vue joueurs', () => {
  const playerBootstrap = readFileSync('js/ui/player/bootstrap.js', 'utf8');
  const playerApp = readFileSync('js/app/player.js', 'utf8');

  assert.ok(!playerBootstrap.includes('fogTools'), 'bootstrap.js ne doit pas importer fogTools');
  assert.ok(!playerApp.includes('fogTools'), 'player.js ne doit pas importer fogTools');
});

/**
 * ⭐ **E-11 — LE CAS DU MAINTENEUR, rapporte le 10/09/2026 au soir.**
 *
 * Sur `marais-hex_16x16`, en mode nuit et sans aucune lampe, un personnage laisse dans le noir
 * voyait **en couleur** au lieu des niveaux de gris. Cause mesuree : `fog.js` projetait les pixels
 * carte dans le masque avec **une seule echelle pour les deux axes**, alors que les rangees
 * hexagonales ne sont espacees que de √3/2 case. Le contenu n'occupait donc que **86,6 %** de la
 * hauteur du masque, et tout remontait :
 *
 * | rangee | ecart entre le pion et la zone peinte |
 * |---|---|
 * | 0 | 0,07 case |
 * | 4 | 0,53 case |
 * | 8 | **1,00 case** |
 * | 15 | **1,81 case** |
 *
 * Le personnage se tenait donc HORS de la zone desaturee — d'ou la couleur. Et le voile de
 * brouillard comme le champ lumineux sortent du meme masque : ils etaient decales d'autant.
 *
 * ⚠ L'assertion passe par `isCellVisibleInMask`, qui est **la fonction dont la vue joueurs se sert
 * pour decider si un pion est dessine**. Elle place la case (a,b) au pixel ((a+0,5)×8, (b+0,5)×8) :
 * le masque est un espace de cases UNIFORME, et c'est precisement ce que la projection par axe
 * retablit.
 */
test('E-11 : sur une grille HEXAGONALE, la zone revelee tombe sur la case du pion, pas une case plus haut', () => {
  const level = createLevel({
    id: 'hex',
    widthCells: 16,
    heightCells: 16,
    pxPerCell: 140,
    grid: { type: 'hex', offsetX: 0, offsetY: 0 },
    imageUrl: 'maps/minimal.webp',
  });
  const grid = gridFor(level);
  const fog = new ExploredFog(16, 16, (w, h) => createMockCanvas(w, h).canvas);

  // Les deux echelles, prises a l'adaptateur — ⛔ jamais √3/2 ecrit ici, la regle n°3 l'interdit.
  const origine = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const uneCaseX = grid.mapFromCellPoint({ cellX: 1, cellY: 0 });
  const uneCaseY = grid.mapFromCellPoint({ cellX: 0, cellY: 1 });
  const echelleX = Math.abs(uneCaseX.x - origine.x);
  const echelleY = Math.abs(uneCaseY.y - origine.y);

  // ⭐ Rangee 8 : c'est la que l'ecart mesure valait une case entiere.
  const cible = { a: 8, b: 8 };
  const centre = grid.cellCenter(cible);
  // Un petit disque — 0,45 case — pour que le test distingue la case visee de ses voisines.
  fog.paintDisc(centre, 0.45 * echelleX, origine, echelleX, echelleY);

  const alpha = getOrExtractMaskAlpha(fog.canvas, 16, 16);
  assert.ok(alpha, 'le masque doit se relire');

  assert.equal(
    isCellVisibleInMask(cible, alpha, 16, 16),
    true,
    '⛔ la case du pion doit etre dans la zone revelee — c est le defaut vu en seance'
  );
  assert.equal(
    isCellVisibleInMask({ a: 8, b: 6 }, alpha, 16, 16),
    false,
    'et deux rangees plus haut ne doit PAS l etre : c est la ou le masque comprime peignait'
  );
});

/**
 * Non-regression carree : les deux echelles sont egales, donc rien ne bouge. C'est la moitie de
 * la promesse d'E-11 — le corpus de jeu reel du mainteneur est carre.
 */
test('E-11 : sur une grille CARREE, la projection est inchangee — les deux echelles sont egales', () => {
  const level = createLevel({
    id: 'carre',
    widthCells: 16,
    heightCells: 16,
    pxPerCell: 140,
    grid: { type: 'square', offsetX: 0, offsetY: 0 },
    imageUrl: 'maps/minimal.webp',
  });
  const grid = gridFor(level);
  const origine = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const echelleX = Math.abs(grid.mapFromCellPoint({ cellX: 1, cellY: 0 }).x - origine.x);
  const echelleY = Math.abs(grid.mapFromCellPoint({ cellX: 0, cellY: 1 }).y - origine.y);
  assert.equal(echelleX, echelleY, 'en carre les deux echelles sont egales, par construction');

  const fog = new ExploredFog(16, 16, (w, h) => createMockCanvas(w, h).canvas);
  const cible = { a: 8, b: 8 };
  fog.paintDisc(grid.cellCenter(cible), 0.45 * echelleX, origine, echelleX, echelleY);
  const alpha = getOrExtractMaskAlpha(fog.canvas, 16, 16);
  assert.equal(isCellVisibleInMask(cible, alpha, 16, 16), true, 'la case visee est revelee');
  assert.equal(
    isCellVisibleInMask({ a: 8, b: 6 }, alpha, 16, 16),
    false,
    'et pas ses voisines eloignees'
  );
});
