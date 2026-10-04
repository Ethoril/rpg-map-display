import test from 'node:test';
import assert from 'node:assert/strict';

import { SquareGrid } from '../js/grid/SquareGrid.js';
import { HexGrid } from '../js/grid/HexGrid.js';
import { edgeKey } from '../js/core/cellKey.js';
import { createMovePlan, extendMovePlan, validateMovePlan } from '../js/state/movePlan.js';
import { createLevel, createToken } from '../js/core/schema.js';
import { movementRulesFor } from '../js/state/selection.js';
import { MovePlanLayer } from '../js/render/layers/movePlan.js';

const level = /** @type {any} */ ({
  id: 'level-1', widthCells: 12, heightCells: 8, pxPerCell: 10,
  name: 'Étage', order: 0, imageUrl: '', videoUrl: null, animatedOverlays: [],
  grid: { type: 'square', offsetX: 0, offsetY: 0 }, terrainCost: {}, walls: [], portals: [], lights: [], ambient: {},
});
const token = /** @type {any} */ ({ id: 'pc-1', levelId: level.id, cell: { a: 1, b: 2 }, speedCells: 6 });

function rules(budget = 6, blockedEdges = new Set()) {
  return { grid: new SquareGrid(level), budget, blockedEdges, terrainCost: new Map() };
}

test('les étapes successives s’ajoutent au chemin et au coût déjà préparés', () => {
  const r = rules();
  let plan = createMovePlan(token, level, r);
  const first = extendMovePlan(plan, { a: 4, b: 2 }, r);
  assert.equal(first.reason, null);
  assert.ok(first.plan);
  plan = first.plan;
  assert.equal(plan.cost, 3);
  assert.equal(plan.remaining, 3);

  const second = extendMovePlan(plan, { a: 6, b: 2 }, r);
  assert.equal(second.reason, null);
  assert.ok(second.plan);
  plan = second.plan;
  assert.equal(plan.cost, 5);
  assert.equal(plan.remaining, 1);
  assert.deepEqual(plan.steps, [{ a: 4, b: 2 }, { a: 6, b: 2 }]);
  assert.deepEqual(plan.path, [
    { a: 1, b: 2 }, { a: 2, b: 2 }, { a: 3, b: 2 }, { a: 4, b: 2 },
    { a: 5, b: 2 }, { a: 6, b: 2 },
  ]);

  // L’endpoint reste valide même si l’utilisateur attend avant de le choisir à nouveau.
  assert.equal(validateMovePlan(plan, token, level, r).valid, true);
});

test('un endpoint qui consomme tout le budget reste validable mais ne peut plus être prolongé', () => {
  const r = rules(2);
  const start = createMovePlan(token, level, r);
  const result = extendMovePlan(start, { a: 3, b: 2 }, r);
  assert.ok(result.plan);
  assert.equal(result.plan.remaining, 0);
  assert.equal(result.plan.reachable.size, 0);
  assert.equal(validateMovePlan(result.plan, token, level, r).valid, true);
  assert.equal(extendMovePlan(result.plan, { a: 4, b: 2 }, r).reason, 'exhausted');
});

test('la revalidation refuse un trajet bloqué après sa préparation, sans muter le pion', () => {
  const initialRules = rules();
  const initialPlan = createMovePlan(token, level, initialRules);
  const prepared = extendMovePlan(initialPlan, { a: 3, b: 2 }, initialRules).plan;
  assert.ok(prepared);
  const blocked = rules(6, new Set([edgeKey({ a: 2, b: 2 }, { a: 3, b: 2 })]));
  assert.equal(validateMovePlan(prepared, token, level, blocked).valid, false);
  assert.deepEqual(token.cell, { a: 1, b: 2 });
  assert.deepEqual(prepared.path.at(-1), { a: 3, b: 2 });
});

test('le moteur conserve les règles hexagonales lors de la préparation et revalidation', () => {
  const hexLevel = /** @type {any} */ ({ ...level, id: 'hex', grid: { type: 'hex' } });
  const hexToken = /** @type {any} */ ({ ...token, levelId: 'hex', cell: { a: 2, b: 2 } });
  const hexRules = { ...rules(2), grid: new HexGrid(hexLevel) };
  const plan = createMovePlan(hexToken, hexLevel, hexRules);
  const extended = extendMovePlan(plan, { a: 3, b: 2 }, hexRules);

  assert.ok(extended.plan);
  assert.equal(extended.plan.cost, 1);
  assert.deepEqual(extended.plan.path, [{ a: 2, b: 2 }, { a: 3, b: 2 }]);
  assert.equal(validateMovePlan(extended.plan, hexToken, hexLevel, hexRules).valid, true);
});

test('une diagonale applique le coût du terrain et un mur de coin empêche de couper le coin', () => {
  const start = { a: 2, b: 2 };
  const destination = { a: 3, b: 3 };
  const diagonalToken = { ...token, cell: start };
  const terrainRules = { ...rules(2), terrainCost: new Map([['3,3', 1.25]]) };
  const terrainPlan = createMovePlan(diagonalToken, level, terrainRules);
  const terrainResult = extendMovePlan(terrainPlan, destination, terrainRules);

  assert.ok(terrainResult.plan);
  assert.deepEqual(terrainResult.plan.path, [start, destination]);
  assert.equal(terrainResult.plan.cost, 1.875, 'diagonale 1,5 × multiplicateur 1,25');
  assert.equal(validateMovePlan(terrainResult.plan, diagonalToken, level, terrainRules).cost, 1.875);

  const cornerStart = { a: 1, b: 1 };
  const cornerToken = { ...token, cell: cornerStart };
  const initial = rules(1.5);
  const prepared = extendMovePlan(
    createMovePlan(cornerToken, level, initial),
    { a: 2, b: 2 },
    initial
  ).plan;
  assert.ok(prepared, 'la diagonale est initialement ouverte');
  const cornerBlocked = rules(1.5, new Set([edgeKey(cornerStart, { a: 2, b: 1 })]));
  assert.equal(validateMovePlan(prepared, cornerToken, level, cornerBlocked).valid, false);
  assert.equal(extendMovePlan(createMovePlan(cornerToken, level, cornerBlocked), { a: 2, b: 2 }, cornerBlocked).reason, 'unreachable');
});

test('budget nul et cellules invalides ne produisent aucune arrivée préparée', () => {
  const zero = rules(0);
  const zeroPlan = createMovePlan(token, level, zero);
  assert.equal(zeroPlan.reachable.size, 0);
  assert.equal(extendMovePlan(zeroPlan, { a: 2, b: 2 }, zero).reason, 'exhausted');

  const normal = rules();
  const plan = createMovePlan(token, level, normal);
  assert.equal(extendMovePlan(plan, { a: 12, b: 2 }, normal).reason, 'unreachable');
  assert.equal(extendMovePlan(plan, token.cell, normal).reason, 'unreachable');
});

test('la validation reconstitue les règles monté/portes depuis movementRulesFor', () => {
  const portalLevel = createLevel({
    id: 'mounted-plan-level', widthCells: 12, heightCells: 10,
    walls: [
      [{ cellX: 5, cellY: 0 }, { cellX: 5, cellY: 4 }],
      [{ cellX: 5, cellY: 5 }, { cellX: 5, cellY: 10 }],
    ],
    portals: [{
      id: 'open-door', a: { cellX: 5, cellY: 4 }, b: { cellX: 5, cellY: 5 },
      state: 'open', freestanding: false,
    }],
  });
  const foot = createToken({
    id: 'mounted-plan-token', levelId: portalLevel.id, cell: { a: 4, b: 4 }, speedCells: 3,
  });
  const footRules = movementRulesFor(foot, portalLevel);
  const prepared = extendMovePlan(
    createMovePlan(foot, portalLevel, footRules), { a: 5, b: 4 }, footRules
  ).plan;
  assert.ok(prepared, 'le pion à pied prépare le passage par la porte ouverte');

  const mounted = { ...foot, mounted: true };
  const mountedRules = movementRulesFor(mounted, portalLevel);
  assert.equal(validateMovePlan(prepared, mounted, portalLevel, mountedRules).valid, false);
});

test('préparer et revalider ne modifient pas le pion, l’étage ni leur vision', () => {
  const visionLevel = /** @type {any} */ ({ ...level, exploredFog: { '1,2': true }, visibleFog: { '2,2': true } });
  const sourceToken = structuredClone(token);
  const sourceLevel = structuredClone(visionLevel);
  const r = rules();
  const plan = createMovePlan(sourceToken, visionLevel, r);
  const prepared = extendMovePlan(plan, { a: 3, b: 2 }, r).plan;
  assert.ok(prepared);
  assert.equal(validateMovePlan(prepared, sourceToken, visionLevel, r).valid, true);
  assert.deepEqual(sourceToken, token);
  assert.deepEqual(visionLevel, sourceLevel);
});

test('la flèche de trajet reste visible avant le disque d’arrivée', () => {
  /** @typedef {{type:'point',x:number,y:number}|{type:'circle',x:number,y:number,radius:number}} DrawCommand */
  /** @type {DrawCommand[][]} */
  const filledPaths = [];
  /** @type {DrawCommand[]} */
  let currentPath = [];
  const ctx = /** @type {any} */ ({
    save() {}, restore() {}, setLineDash() {}, stroke() {}, strokeText() {}, fillText() {},
    beginPath() { currentPath = []; },
    /** @param {number} x @param {number} y */
    moveTo(x, y) { currentPath.push({ type: 'point', x, y }); },
    /** @param {number} x @param {number} y */
    lineTo(x, y) { currentPath.push({ type: 'point', x, y }); },
    closePath() {},
    fill() { filledPaths.push([...currentPath]); },
    /** @param {number} x @param {number} y @param {number} radius */
    arc(x, y, radius) { currentPath.push({ type: 'circle', x, y, radius }); },
  });
  const preview = /** @type {any} */ ({
    levelId: level.id, planId: 'plan', revision: 1, tokenId: token.id,
    start: { a: 1, b: 2 }, path: [{ a: 1, b: 2 }, { a: 3, b: 2 }],
    destination: { a: 3, b: 2 }, remaining: 4,
  });
  new MovePlanLayer().render(ctx, new SquareGrid(level), level.id, preview, {}, 1);

  const arrowTip = filledPaths[0]?.[0];
  const arrivalDot = filledPaths[1]?.find((entry) => entry.type === 'circle');
  assert.ok(arrowTip && arrivalDot);
  assert.ok(Math.hypot(arrowTip.x - arrivalDot.x, arrowTip.y - arrivalDot.y) > arrivalDot.radius);
});
