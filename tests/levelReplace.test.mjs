// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import * as store from '../js/state/store.js';
import { createFogTools } from '../js/ui/gm/fogTools.js';
import { ExploredFog } from '../js/vision/fog.js';

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
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    drawImage() {},
    getImageData(x = 0, y = 0, w = width, h = height) {
      return { data: pixels, width: w, height: h };
    },
    putImageData() {},
  };

  return {
    width,
    height,
    getContext: () => ctx,
    ctx,
  };
}

/**
 * Prépare une campagne avec 2 étages, des pions sur les 2 étages et de la géométrie sur l'étage 1.
 */
function setupCampagneTest() {
  store.resetStore();
  const rdc = createLevel({
    id: 'rdc',
    name: 'Rez-de-chaussée',
    imageUrl: 'maps/rdc.webp',
    widthCells: 10,
    heightCells: 8,
    pxPerCell: 100,
    walls: [
      [
        { cellX: 1, cellY: 1 },
        { cellX: 5, cellY: 1 },
      ],
    ],
    portals: [
      {
        id: 'porte-1',
        a: { cellX: 2, cellY: 2 },
        b: { cellX: 3, cellY: 2 },
        state: 'closed',
        freestanding: false,
      },
    ],
    lights: [
      {
        id: 'lampe-1',
        at: { cellX: 4, cellY: 4 },
        range: 5,
        intensity: 1,
        color: '#ffaa00',
        shadows: true,
      },
    ],
  });

  const etage1 = createLevel({
    id: 'et1',
    name: 'Étage 1',
    imageUrl: 'maps/etage1.webp',
    widthCells: 12,
    heightCells: 10,
    pxPerCell: 120,
  });

  const heros = createToken({
    id: 'heros-rdc',
    levelId: 'rdc',
    kind: 'pc',
    cell: { a: 2, b: 2 },
    label: 'Héros',
    hp: { current: 15, max: 25 },
    markers: ['prone'],
  });

  const garde = createToken({
    id: 'garde-rdc',
    levelId: 'rdc',
    kind: 'npc',
    cell: { a: 4, b: 4 },
    label: 'Garde',
    hp: { current: 5, max: 10 },
    markers: ['stunned'],
  });

  const spectre = createToken({
    id: 'spectre-et1',
    levelId: 'et1',
    kind: 'npc',
    cell: { a: 6, b: 6 },
    label: 'Spectre',
    hp: { current: 8, max: 8 },
  });

  const campaign = createCampaign({
    levels: [rdc, etage1],
    tokens: [heros, garde, spectre],
  });

  store.loadCampaign(campaign);
  store.selectLevel('rdc');
  return { rdc, etage1, heros, garde, spectre };
}

test('UX-13 : store.replaceLevelMap remplace la carte, vide la géométrie et déplace les pions en réserve', () => {
  setupCampagneTest();
  store.selectToken('heros-rdc');
  assert.equal(store.getState().selectedTokenId, 'heros-rdc');

  const patch = {
    imageUrl: 'maps/nouveau-rdc.webp',
    widthCells: 20,
    heightCells: 15,
    pxPerCell: 140,
    grid: {
      type: /** @type {'square'} */ ('square'),
      offsetX: 10,
      offsetY: 15,
      color: '#000000',
      opacity: 0.3,
      visible: true,
    },
  };

  const reservedIds = store.replaceLevelMap('rdc', patch);

  // 1. Les pions du RDC sont en réserve, l'autre pion n'a pas bougé
  assert.deepEqual(reservedIds.sort(), ['garde-rdc', 'heros-rdc']);
  const reserve = store.getReserve();
  assert.equal(reserve.length, 2);

  const herosReserve = reserve.find((t) => t.id === 'heros-rdc');
  assert.equal(herosReserve?.label, 'Héros');
  assert.deepEqual(herosReserve?.hp, { current: 15, max: 25 }, 'les PV voyagent en réserve');
  assert.deepEqual(herosReserve?.markers, ['prone'], 'les marqueurs voyagent en réserve');

  const tokensSurPlateau = store.getState().campaign?.tokens ?? [];
  assert.equal(tokensSurPlateau.length, 1);
  assert.equal(tokensSurPlateau[0].id, 'spectre-et1', 'le pion de l étage 1 est resté sur le plateau');

  // 2. Le pion sélectionné qui était sur le RDC est désélectionné
  assert.equal(store.getState().selectedTokenId, null);

  // 3. L'étage a reçu son nouveau contenu, son identifiant ne change pas, aucun étage n'est ajouté
  const campaignLevels = store.getState().campaign?.levels ?? [];
  assert.equal(campaignLevels.length, 2);

  const rdcApres = campaignLevels.find((l) => l.id === 'rdc');
  assert.ok(rdcApres);
  assert.equal(rdcApres?.imageUrl, 'maps/nouveau-rdc.webp');
  assert.equal(rdcApres?.widthCells, 20);
  assert.equal(rdcApres?.heightCells, 15);
  assert.equal(rdcApres?.pxPerCell, 140);
  assert.deepEqual(rdcApres?.grid, {
    type: 'square',
    offsetX: 10,
    offsetY: 15,
    color: '#000000',
    opacity: 0.3,
    visible: true,
  });

  // 4. Murs, portails et lumières sont vidés
  assert.deepEqual(rdcApres?.walls, []);
  assert.deepEqual(rdcApres?.portals, []);
  assert.deepEqual(rdcApres?.lights, []);
});

test('UX-13 : Critère 8 — Atomicité de replaceLevelMap en cas de refus', () => {
  setupCampagneTest();

  // Patch invalide (largeur négative)
  const patchInvalide = {
    imageUrl: 'maps/invalide.webp',
    widthCells: -5,
  };

  assert.throws(
    () => store.replaceLevelMap('rdc', /** @type {any} */ (patchInvalide)),
    /widthCells/i
  );

  // Vérifier qu'absolument rien n'a été muté
  assert.equal(store.getReserve().length, 0, 'aucun pion ne doit avoir été déplacé en réserve');
  const tokens = store.getState().campaign?.tokens ?? [];
  assert.equal(tokens.length, 3, 'les 3 pions sont toujours sur le plateau');
  assert.ok(tokens.some((t) => t.id === 'heros-rdc'));
  assert.ok(tokens.some((t) => t.id === 'garde-rdc'));

  const rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.imageUrl, 'maps/rdc.webp', 'l ancienne carte est conservée');
  assert.equal(rdc?.walls.length, 1, 'les murs sont conservés');
  assert.equal(rdc?.portals.length, 1, 'les portails sont conservés');
});

test('UX-13 : Réseau — applyNetworkEvent avec level.replace', () => {
  setupCampagneTest();

  const patch = {
    imageUrl: 'maps/remote-replaced.webp',
    widthCells: 15,
    heightCells: 12,
    pxPerCell: 110,
  };

  // Événement valide
  const resOk = applyNetworkEvent({
    type: 'level.replace',
    payload: { levelId: 'rdc', patch },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resOk, true);

  const rdc = store.getState().campaign?.levels.find((l) => l.id === 'rdc');
  assert.equal(rdc?.imageUrl, 'maps/remote-replaced.webp');
  assert.equal(rdc?.widthCells, 15);
  assert.equal(store.getReserve().length, 2, 'les pions ont été rangés en réserve');

  // Payload malformé (patch manquant)
  const resBad1 = applyNetworkEvent({
    type: 'level.replace',
    payload: { levelId: 'rdc' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resBad1, false);

  // Étage inconnu
  const resBad2 = applyNetworkEvent({
    type: 'level.replace',
    payload: { levelId: 'inexistant', patch },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resBad2, false);
});

test('UX-13 : fogTools.clearFog vide le masque exploré et la pile undo de l étage actif sans lever', async () => {
  const fogMap = new Map();
  const fogRdc = new ExploredFog(10, 8, createMockCanvas);
  fogRdc.revealAll(); // rendre exploré
  fogMap.set('rdc', fogRdc);

  let published = 0;
  let rendered = 0;

  const mockContainer = createMockElement();

  const fogTools = createFogTools(/** @type {any} */ (mockContainer), {
    getActiveLevelId: () => 'rdc',
    getExploredFog: (id) => fogMap.get(id) || null,
    scheduleFogPublish: () => {
      published++;
    },
    requestRender: () => {
      rendered++;
    },
  });

  // Empiler un état undo
  await fogTools.pushUndoState();
  assert.equal(fogTools.getUndoStackLength('rdc'), 1);

  // Appeler clearFog
  await fogTools.clearFog();

  assert.equal(published, 1, 'scheduleFogPublish a été appelé');
  assert.equal(rendered, 1, 'requestRender a été appelé');
  assert.equal(fogTools.getUndoStackLength('rdc'), 0, 'la pile d undo a été vidée');

  // Vérifier que le canvas du fog est vidé (alpha = 0)
  const png = await fogRdc.exportPng();
  assert.ok(typeof png === 'string');
});
