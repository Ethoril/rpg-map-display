// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCampaign, createLevel, createToken, validateCampaign } from '../js/core/schema.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { FogLayer, isAmbientLit } from '../js/render/layers/fogLayer.js';
import { gridFor } from '../js/grid/index.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import * as store from '../js/state/store.js';

test('Lumière R3 : ambiante et torche passent par les mutations store/réseau validées', () => {
  store.resetStore();
  const level = createLevel({
    id: 'rdc',
    ambient: { level: 0, baked: false },
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

test('UX-07 : le moteur ne distingue que deux ambiances, et une campagne fractionnaire vaut « jour »', () => {
  /** @param {object} ambient */
  const eclaire = (ambient) =>
    isAmbientLit(createLevel({ id: 'rdc', ambient: /** @type {any} */ (ambient) }));

  // ⭐ Le curseur offrait 21 positions de 0 à 1 par pas de 0,05, et `fogLayer` n'en lisait
  // qu'une chose : `baked || level > 0`. 0,05 et 1,00 étaient rigoureusement indistinguables ;
  // le seul cran qui changeait quoi que ce soit était le passage par zéro.
  assert.equal(eclaire({ level: 0, baked: false }), false, 'nuit');
  assert.equal(eclaire({ level: 1, baked: false }), true, 'jour');

  // Critère 2 : une campagne enregistrée avec une valeur fractionnaire se charge et vaut jour.
  for (const valeur of [0.05, 0.35, 0.5, 0.95]) {
    assert.equal(eclaire({ level: valeur, baked: false }), true, `level ${valeur} vaut « jour »`);
    assert.deepEqual(
      validateCampaign(createCampaign({ levels: [createLevel({ id: 'rdc', ambient: /** @type {any} */ ({ level: valeur, baked: false }) })] })),
      [],
      `une campagne à level ${valeur} doit continuer de se valider`
    );
  }

  // Un étage cuit est éclairé quel que soit le niveau : la lumière est déjà dans l'image.
  assert.equal(eclaire({ level: 0, baked: true }), true, 'baked');
});

test('UX-07 critère 4 : aucun rendu ne lit ambient.color, vérifié par recherche', () => {
  // ⛔ Vérification par **recherche dans les sources**, comme le demande le critère : un test de
  // comportement ne pourrait pas prouver l'absence d'une lecture. Le champ est supprimé du
  // modèle, mais les campagnes enregistrées en portent un — si un rendu venait à le relire, il
  // se remettrait à dépendre d'une donnée que plus rien n'alimente.
  const fichiers = fs
    .readdirSync('js/render/layers')
    .filter((nom) => nom.endsWith('.js'))
    .map((nom) => `js/render/layers/${nom}`)
    .concat(['js/render/renderer.js', 'js/app/gm.js', 'js/app/player.js']);

  for (const chemin of fichiers) {
    if (!fs.existsSync(chemin)) continue;
    const source = fs.readFileSync(chemin, 'utf8');
    // On cherche la LECTURE du champ, sous ses deux écritures possibles.
    assert.equal(
      /ambient\s*(\?\.)?\s*\.\s*color|ambient\[['"]color['"]\]/.test(source),
      false,
      `${chemin} lit ambient.color, or ce champ n'existe plus dans le modèle`
    );
  }
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
