// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { FogLayer } from '../js/render/layers/fogLayer.js';
import { gridFor } from '../js/grid/index.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import * as store from '../js/state/store.js';

test('Lumière R3 : ambiante et torche passent par les mutations store/réseau validées', () => {
  store.resetStore();
  const level = createLevel({
    id: 'rdc',
    ambient: { color: '#ffffff', level: 0, baked: false },
  });
  const token = createToken({ id: 'torche', levelId: 'rdc', kind: 'npc', cell: { a: 2, b: 2 } });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [token] }));

  assert.equal(
    applyNetworkEvent({
      type: 'level.ambient',
      payload: { levelId: 'rdc', ambient: { color: '#ffffff', level: 0.5, baked: false } },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.equal(store.getRenderSnapshot().activeLevel?.ambient.level, 0.5);

  assert.equal(
    applyNetworkEvent({
      type: 'token.update',
      payload: {
        tokenId: 'torche',
        patch: { emitsLight: { range: 4, intensity: 1, color: '#ffcc66' } },
      },
      at: Date.now(), by: 'gm',
    }),
    true
  );
  assert.deepEqual(store.getRenderSnapshot().campaign?.tokens[0].emitsLight, {
    range: 4, intensity: 1, color: '#ffcc66',
  });

  assert.equal(
    applyNetworkEvent({
      type: 'level.ambient',
      payload: { levelId: 'rdc', ambient: { color: '#ffffff', level: 2, baked: false } },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une ambiance hors 0..1 reste refusée avant mutation'
  );
  assert.equal(store.getRenderSnapshot().activeLevel?.ambient.level, 0.5);

  assert.equal(
    applyNetworkEvent({
      type: 'token.update',
      payload: { tokenId: 'torche', patch: { emitsLight: { range: 21, intensity: 1, color: '#ffcc66' } } },
      at: Date.now(), by: 'gm',
    }),
    false,
    'une torche au-delà du plafond est refusée avant mutation'
  );
  assert.deepEqual(store.getRenderSnapshot().campaign?.tokens[0].emitsLight, {
    range: 4, intensity: 1, color: '#ffcc66',
  });
  store.resetStore();
});

test('Lumière R3 : le schéma refuse explicitement les sources fixes et portées malformées', () => {
  const level = createLevel({
    id: 'rdc',
    widthCells: 10,
    heightCells: 8,
    lights: [
      /** @type {any} */ ({ id: '', at: { cellX: 11, cellY: -1 }, range: 21, intensity: 2, color: 'orange', shadows: 'oui' }),
      { id: 'dupe', at: { cellX: 2, cellY: 2 }, range: 2, intensity: 1, color: '#ffffff', shadows: true },
      { id: 'dupe', at: { cellX: 3, cellY: 3 }, range: 2, intensity: 1, color: '#ffffff', shadows: true },
    ],
  });
  const token = createToken({
    id: 'torche', levelId: 'rdc', kind: 'npc', cell: { a: 2, b: 2 },
    emitsLight: { range: Infinity, intensity: -1, color: '#gg0000' },
  });
  const malformedEmitter = createToken({
    id: 'pas-objet', levelId: 'rdc', kind: 'npc', cell: { a: 3, b: 2 }, emitsLight: /** @type {any} */ ([]),
  });
  const errors = validateCampaign(createCampaign({ levels: [level], tokens: [token, malformedEmitter] }));

  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : id doit être une chaîne non vide'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : coordonnées hors limites de l\'étage'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : range invalide (nombre entre 0 et 20 attendu)'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : intensity invalide (nombre entre 0 et 1 attendu)'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : color invalide "orange" (format #RRGGBB attendu)'));
  assert.ok(errors.includes('Étage "rdc" : lumière "inconnue" : shadows doit être un booléen'));
  assert.ok(errors.includes('Étage "rdc" : lumière "dupe" : id dupliqué'));
  assert.ok(errors.includes('Pion "torche" : emitsLight.range invalide (nombre entre 0 et 20 attendu)'));
  assert.ok(errors.includes('Pion "torche" : emitsLight.intensity invalide (nombre entre 0 et 1 attendu)'));
  assert.ok(errors.includes('Pion "torche" : emitsLight.color invalide "#gg0000" (format #RRGGBB attendu)'));
  assert.ok(errors.includes('Pion "pas-objet" : emitsLight doit être null ou un objet'));
});

test('MESURE R3 — testbig150, six PJ et huit sources restent un profil exécutable', () => {
  const campaign = JSON.parse(fs.readFileSync('maps/generated/testbig150.scene.json', 'utf8'));
  const level = campaign.levels[0];
  level.ambient = { color: '#ffffff', level: 0, baked: false };
  level.lights = Array.from({ length: 8 }, (_, index) => ({
    id: `fixed-${index}`,
    at: { cellX: 6 + index * 7, cellY: 10 + (index % 3) * 16 },
    range: 8, intensity: 1, color: '#ffffff', shadows: true,
  }));
  const tokens = Array.from({ length: 6 }, (_, index) =>
    createToken({
      id: `pc-${index}`, levelId: level.id, kind: 'pc', cell: { a: 5 + index * 9, b: 5 + (index % 3) * 18 },
      visionDim: 6, emitsLight: index % 2 ? { range: 5, intensity: 1, color: '#ffcc66' } : null,
    })
  );
  const fogLayer = new FogLayer();
  const started = performance.now();
  fogLayer.updateVision(gridFor(level), level, tokens, { extractSegments: extractBlockedSegments });
  const elapsed = performance.now() - started;
  console.log(`[R3] testbig150 — 6 PJ + 8 sources (+3 torches) : ${elapsed.toFixed(2)} ms, ${fogLayer.getVisiblePolygons().length} polygones`);
  assert.ok(Number.isFinite(elapsed));
  assert.equal(fogLayer.getVisiblePolygons().length, 17);
});
