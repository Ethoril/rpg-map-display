// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createCampaign, createLevel, validateCampaign } from '../js/core/schema.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { gridFor } from '../js/grid/index.js';
import { computeTemplateCells, isPointInPolygon } from '../js/render/layers/templates.js';
import { extractBlockedSegments } from '../js/import/blockedEdges.js';
import * as store from '../js/state/store.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';

test('isPointInPolygon détermine correctement si un point est dans un polygone', () => {
  const poly = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(isPointInPolygon({ x: 5, y: 5 }, poly), true);
  assert.equal(isPointInPolygon({ x: 15, y: 5 }, poly), false);
  assert.equal(isPointInPolygon({ x: -1, y: 5 }, poly), false);
});

test('Énumération géométrique par grid.distance() sans obstacle : 5, 13, 29, 49 cases (rayons 1 à 4) et limite à 73 au rayon 5', () => {
  const level = createLevel({
    id: 'lvl-open',
    widthCells: 30,
    heightCells: 30,
    pxPerCell: 100,
  });
  const grid = new SquareGrid(level);
  const origin = { a: 15, b: 15 };

  // Rayon 1
  const t1 = {
    id: 't1',
    levelId: 'lvl-open',
    shape: /** @type {const} */ ('circle'),
    origin,
    radiusCells: 1,
    directionDeg: 0,
    widthCells: 1,
    color: '#ef4444',
    visibleToPlayers: true,
  };
  const cells1 = computeTemplateCells(t1, grid, level);
  assert.equal(cells1.length, 5, 'Rayon 1 doit retenir 5 cases');

  // Rayon 2
  const t2 = { ...t1, id: 't2', radiusCells: 2 };
  const cells2 = computeTemplateCells(t2, grid, level);
  assert.equal(cells2.length, 13, 'Rayon 2 doit retenir 13 cases');

  // Rayon 3
  const t3 = { ...t1, id: 't3', radiusCells: 3 };
  const cells3 = computeTemplateCells(t3, grid, level);
  assert.equal(cells3.length, 29, 'Rayon 3 doit retenir 29 cases');

  // Rayon 4
  const t4 = { ...t1, id: 't4', radiusCells: 4 };
  const cells4 = computeTemplateCells(t4, grid, level);
  assert.equal(cells4.length, 49, 'Rayon 4 doit retenir 49 cases');

  // Rayon 5 (limite acceptée de grid.distance : 73 cases vs 81 euclidienne)
  const t5 = { ...t1, id: 't5', radiusCells: 5 };
  const cells5 = computeTemplateCells(t5, grid, level);
  assert.equal(cells5.length, 73, 'Rayon 5 par grid.distance() doit retenir 73 cases');

  // Compte euclidien pour comparaison gelée
  let euclidCount = 0;
  for (let a = 0; a < 30; a++) {
    for (let b = 0; b < 30; b++) {
      const dx = a - origin.a;
      const dy = b - origin.b;
      if (Math.hypot(dx, dy) <= 5) {
        euclidCount++;
      }
    }
  }
  assert.equal(euclidCount, 81, 'Distance du centre euclidienne au rayon 5 fait 81 cases');
});

test('Occlusion adossée au §1.2 : manoir-rdc à l\'origine {a:31, b:31}, rayon 4 retient 21 cases (vs 31 par arêtes bloquées)', () => {
  const scenePath = path.resolve('maps/generated/manoir-rdc.scene.json');
  assert.equal(fs.existsSync(scenePath), true, 'Fichier de scène manoir-rdc.scene.json requis');

  const campaignData = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const level = createLevel(campaignData.levels[0]);
  const grid = gridFor(level);
  const origin = { a: 31, b: 31 };

  const template = {
    id: 'tpl-manoir-31-31',
    levelId: level.id,
    shape: /** @type {const} */ ('circle'),
    origin,
    radiusCells: 4,
    directionDeg: 0,
    widthCells: 1,
    color: '#ef4444',
    visibleToPlayers: true,
  };

  const segments = extractBlockedSegments(level, grid);
  const affectedCells = computeTemplateCells(template, grid, level, segments);
  assert.equal(affectedCells.length, 21, 'Le sweep pour {a:31, b:31} au rayon 4 doit retenir exactement 21 cases');

  // Énumération par arêtes bloquées sans sweep (pour vérifier le constat du §1.2)
  let blockedEdgesCellsCount = 0;
  for (let a = 0; a < level.widthCells; a++) {
    for (let b = 0; b < level.heightCells; b++) {
      if (grid.distance(origin, { a, b }) <= 4) {
        blockedEdgesCellsCount++;
      }
    }
  }
  assert.equal(blockedEdgesCellsCount, 49, 'Énumération sans occlusion ferait 49 cases');
});

test('Le centre de la case décide de l\'inclusion', () => {
  const level = createLevel({ id: 'lvl-test', widthCells: 10, heightCells: 10, pxPerCell: 100 });
  const grid = new SquareGrid(level);
  const origin = { a: 5, b: 5 };

  const template = {
    id: 't-center',
    levelId: 'lvl-test',
    shape: /** @type {const} */ ('circle'),
    origin,
    radiusCells: 1,
    directionDeg: 0,
    widthCells: 1,
    color: '#ef4444',
    visibleToPlayers: true,
  };

  const cells = computeTemplateCells(template, grid, level);
  // (5,5), (4,5), (6,5), (5,4), (5,6)
  assert.equal(cells.includes('5,5'), true);
  assert.equal(cells.includes('4,5'), true);
  assert.equal(cells.includes('6,5'), true);
  assert.equal(cells.includes('5,4'), true);
  assert.equal(cells.includes('5,6'), true);
  // Diagonale (4,4) est à distance octile 1.5, donc > radius 1
  assert.equal(cells.includes('4,4'), false);
});

test('Store placeTemplate et clearTemplates (idempotence, remplacement, isolation et persistance)', () => {
  store.resetStore();
  const lvl1 = createLevel({ id: 'lvl1', name: 'Étage 1' });
  const lvl2 = createLevel({ id: 'lvl2', name: 'Étage 2' });
  const campaign = createCampaign({ levels: [lvl1, lvl2] });
  store.loadCampaign(campaign);

  const t1 = {
    id: 'tpl-1',
    levelId: 'lvl1',
    shape: /** @type {const} */ ('circle'),
    origin: { a: 2, b: 2 },
    radiusCells: 3,
    directionDeg: 0,
    widthCells: 1,
    color: '#ef4444',
    visibleToPlayers: true,
  };

  let notifCount = 0;
  const unsub = store.subscribe(() => {
    notifCount++;
  });

  // Placement d'un premier gabarit
  store.placeTemplate(t1, ['2,2', '2,3']);
  const state1 = store.getState();
  assert.equal(state1.campaign?.templates.length, 1);
  assert.equal(state1.campaign?.templates[0].id, 'tpl-1');
  assert.deepEqual(store.getSessionTemplateCells('tpl-1'), ['2,2', '2,3']);

  // Reposer le même id remplace l'existant sans le dupliquer
  const t1Modified = { ...t1, radiusCells: 5 };
  store.placeTemplate(t1Modified, ['2,2', '2,3', '2,4']);
  const state2 = store.getState();
  assert.equal(state2.campaign?.templates.length, 1);
  assert.equal(state2.campaign?.templates[0].radiusCells, 5);
  assert.deepEqual(store.getSessionTemplateCells('tpl-1'), ['2,2', '2,3', '2,4']);

  // Ajouter un gabarit sur l'étage 2
  const t2 = {
    id: 'tpl-2',
    levelId: 'lvl2',
    shape: /** @type {const} */ ('circle'),
    origin: { a: 10, b: 10 },
    radiusCells: 2,
    directionDeg: 0,
    widthCells: 1,
    color: '#3b82f6',
    visibleToPlayers: false,
  };
  store.placeTemplate(t2, ['10,10']);
  assert.equal(store.getState().campaign?.templates.length, 2);

  // Effacer uniquement l'étage 1 laisse l'étage 2 intact
  store.clearTemplates('lvl1');
  const state3 = store.getState();
  assert.equal(state3.campaign?.templates.length, 1);
  assert.equal(state3.campaign?.templates[0].id, 'tpl-2');
  assert.deepEqual(store.getSessionTemplateCells('tpl-1'), []);
  assert.deepEqual(store.getSessionTemplateCells('tpl-2'), ['10,10']);

  // Effacer un étage inconnu lève une erreur
  assert.throws(() => store.clearTemplates('lvl-inconnu'), /Étage inconnu/);

  unsub();
});

test('Schema : validateCampaign refuse un gabarit malformé en nommant le gabarit (Critère 10)', () => {
  const level = createLevel({ id: 'lvl1' });
  const campaign = createCampaign({ levels: [level] });

  // 1. shape inconnue
  const c1 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-bad-shape',
        levelId: 'lvl1',
        shape: 'triangle',
        origin: { a: 1, b: 1 },
        radiusCells: 2,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err1 = validateCampaign(c1);
  assert.equal(err1.some((e) => e.includes('tpl-bad-shape') && e.includes('shape invalide')), true);

  // 2. origin fractionnaire (non entière)
  const c2 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-float-origin',
        levelId: 'lvl1',
        shape: 'circle',
        origin: { a: 1.5, b: 2 },
        radiusCells: 2,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err2 = validateCampaign(c2);
  assert.equal(err2.some((e) => e.includes('tpl-float-origin') && e.includes('origin invalide')), true);

  // 3. radiusCells nul ou négatif
  const c3 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-neg-radius',
        levelId: 'lvl1',
        shape: 'circle',
        origin: { a: 1, b: 1 },
        radiusCells: -3,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err3 = validateCampaign(c3);
  assert.equal(err3.some((e) => e.includes('tpl-neg-radius') && e.includes('radiusCells invalide')), true);

  // 4. levelId inexistant
  const c4 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-unknown-level',
        levelId: 'lvl-fantome',
        shape: 'circle',
        origin: { a: 1, b: 1 },
        radiusCells: 2,
        visibleToPlayers: true,
        color: '#ef4444',
      },
    ],
  };
  const err4 = validateCampaign(c4);
  assert.equal(err4.some((e) => e.includes('tpl-unknown-level') && e.includes('levelId invalide')), true);

  // 5. visibleToPlayers non booléen
  const c5 = {
    ...campaign,
    templates: [
      {
        id: 'tpl-bad-vis',
        levelId: 'lvl1',
        shape: 'circle',
        origin: { a: 1, b: 1 },
        radiusCells: 2,
        visibleToPlayers: 'oui',
        color: '#ef4444',
      },
    ],
  };
  const err5 = validateCampaign(c5);
  assert.equal(err5.some((e) => e.includes('tpl-bad-vis') && e.includes('visibleToPlayers invalide')), true);
});

test('Événements réseau template.place et template.clear dans networkEvents.js', () => {
  store.resetStore();
  const level = createLevel({ id: 'lvl1' });
  const campaign = createCampaign({ levels: [level] });
  store.loadCampaign(campaign);

  // Payload valide template.place
  const template = {
    id: 'tpl-net-1',
    levelId: 'lvl1',
    shape: /** @type {const} */ ('circle'),
    origin: { a: 5, b: 5 },
    radiusCells: 3,
    directionDeg: 0,
    widthCells: 1,
    color: '#10b981',
    visibleToPlayers: true,
  };

  const res1 = applyNetworkEvent({
    type: 'template.place',
    payload: { template, cells: ['5,5', '5,6'] },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res1, true);
  assert.equal(store.getState().campaign?.templates.length, 1);
  assert.deepEqual(store.getSessionTemplateCells('tpl-net-1'), ['5,5', '5,6']);

  // Idempotence : réappliquer le même événement fonctionne
  const res1b = applyNetworkEvent({
    type: 'template.place',
    payload: { template, cells: ['5,5', '5,6'] },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res1b, true);
  assert.equal(store.getState().campaign?.templates.length, 1);

  // Payload malformé refusé
  const res2 = applyNetworkEvent({
    type: 'template.place',
    payload: { template: null },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res2, false);

  // Étage inconnu refusé
  const res3 = applyNetworkEvent({
    type: 'template.place',
    payload: { template: { ...template, levelId: 'inconnu' } },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(res3, false);

  // Effacement valide template.clear
  const resClear = applyNetworkEvent({
    type: 'template.clear',
    payload: { levelId: 'lvl1' },
    at: Date.now(),
    by: 'gm',
  });
  assert.equal(resClear, true);
  assert.equal(store.getState().campaign?.templates.length, 0);
  assert.deepEqual(store.getSessionTemplateCells('tpl-net-1'), []);
});

test('Vérification d\'isolation : aucun calcul de distance de case à case ne réinvente de formule euclidienne', () => {
  const codeTemplates = fs.readFileSync('js/render/layers/templates.js', 'utf8');
  const codeTools = fs.readFileSync('js/ui/gm/templateTools.js', 'utf8');

  assert.equal(codeTemplates.includes('Math.hypot'), false, 'templates.js ne doit pas appeler Math.hypot');
  assert.equal(codeTemplates.includes('Math.sqrt'), false, 'templates.js ne doit pas appeler Math.sqrt');
  assert.equal(codeTools.includes('Math.hypot'), false, 'templateTools.js ne doit pas appeler Math.hypot');
  assert.equal(codeTools.includes('Math.sqrt'), false, 'templateTools.js ne doit pas appeler Math.sqrt');
});
