// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExploredFog } from '../js/vision/fog.js';
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
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    arc(cx = 0, cy = 0, r = 0) {
      const isErase = ctx.globalCompositeOperation === 'destination-out';
      const minX = Math.max(0, Math.floor(cx - r));
      const maxX = Math.min(width - 1, Math.ceil(cx + r));
      const minY = Math.max(0, Math.floor(cy - r));
      const maxY = Math.min(height - 1, Math.ceil(cy + r));

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (Math.hypot(x - cx, y - cy) <= r) {
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
  const gridScale = 50;

  fog.paintDisc({ x: 100, y: 100 }, 50, mapOrigin, gridScale);
  if (fog.ctx) {
    const pixelBuf = fog.ctx.pixels || fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
    assert.ok(pixelBuf.some((/** @type {number} */ val, /** @type {number} */ idx) => idx % 4 === 3 && val > 0), 'Des pixels doivent être explorés après paintDisc');
  }

  fog.eraseDisc({ x: 100, y: 100 }, 60, mapOrigin, gridScale);
  if (fog.ctx) {
    const pixelBuf = fog.ctx.pixels || fog.ctx.getImageData(0, 0, fog.maskWidth, fog.maskHeight).data;
    assert.ok(pixelBuf.every((/** @type {number} */ val, /** @type {number} */ idx) => idx % 4 !== 3 || val === 0), 'L\'alpha doit être retombé à 0 après eraseDisc');
  }
});

test('ExploredFog : aller-retour exportPng / importPng conserve la zone peinte', async () => {
  const fog = createFog();
  const mapOrigin = { x: 0, y: 0 };
  fog.paintDisc({ x: 50, y: 50 }, 30, mapOrigin, 50);

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
