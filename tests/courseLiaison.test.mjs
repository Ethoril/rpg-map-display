// @ts-check
// L6-MD — Course d'un pion lié : zone à deux paliers, budget, étiquette, `map.ran` (contrat §4, §10, §11.6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { movementRulesFor, bondZoneFor } from '../js/state/selection.js';
import { createMovePlan, extendMovePlan, ranStartIndex } from '../js/state/movePlan.js';
import { MoveZoneLayer } from '../js/render/layers/moveZone.js';
import { MovePlanLayer } from '../js/render/layers/movePlan.js';
import { walkLimitFor } from '../js/app/movePlanning.js';
import { startMjLink } from '../js/app/mjLink.js';

const level = createLevel({ id: 'rdc', widthCells: 20, heightCells: 6 });
const link = { source: /** @type {'outil-mj'} */ ('outil-mj'), ref: 'pj:g1' };
/** @param {object} patch */
const pion = (patch = {}) => ({ ...createToken({ id: 'g1', levelId: 'rdc', cell: { a: 1, b: 2 }, speedCells: 4 }), link, runCells: 8, ...patch });
/** Trajet rectiligne de `n` cases (n − 1 pas) depuis la case de départ. */
const path = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ a: 1 + i, b: 2 }));

test('budget : un pion lié va jusqu’à runCells, la Marche reste walkBudget', () => {
  const rules = movementRulesFor(pion(), level);
  assert.equal(rules.budget, 8);
  assert.equal(rules.walkBudget, 4);
});

test('budget : pion non lié, ou lié sans runCells, garde un seul palier', () => {
  const libre = createToken({ id: 'o', levelId: 'rdc', cell: { a: 1, b: 2 }, speedCells: 4 });
  assert.equal(movementRulesFor({ ...libre, runCells: 8 }, level).budget, 4);
  assert.equal(movementRulesFor(pion({ runCells: undefined }), level).budget, 4);
  assert.equal(movementRulesFor(pion({ runCells: 2 }), level).budget, 4, 'Course < Marche : on ne réduit pas');
});

test('trajet : ranStartIndex donne la première case en Course, -1 à la Marche', () => {
  const rules = movementRulesFor(pion(), level);
  assert.equal(ranStartIndex(path(5), rules), -1, '4 pas = la Marche pile');
  assert.equal(ranStartIndex(path(6), rules), 5, 'le 5e pas dépasse la Marche');
  assert.equal(ranStartIndex(path(9), rules), 5);
});

test('plan : la Marche restante se lit par walkLimitFor et la Course reste atteignable', () => {
  const token = pion();
  const rules = movementRulesFor(token, level);
  const plan = createMovePlan(token, level, rules);
  assert.equal(walkLimitFor(plan, token, level), 4);
  const next = extendMovePlan(plan, { a: 7, b: 2 }, rules).plan;
  assert.ok(next, '6 pas : au-delà de la Marche, dans la Course');
  assert.equal(walkLimitFor(next, token, level), 0);
  assert.equal(extendMovePlan(plan, { a: 10, b: 2 }, rules).plan, null, 'au-delà de runCells : refusé');
});

/** @returns {{ctx: any, calls: string[]}} */
function recorder() {
  /** @type {string[]} */
  const calls = [];
  const ctx = {
    globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, arc() {},
    clip() { calls.push('clip'); },
    setLineDash(/** @type {number[]} */ d) { calls.push(`dash:${d.length}`); },
    fill() { calls.push(`fill:${this.fillStyle}`); }, stroke() { calls.push(`stroke:${this.strokeStyle}`); },
    strokeText() {}, fillText(/** @type {string} */ t) { calls.push(`text:${t}`); },
  };
  return { ctx, calls };
}
const fakeGrid = /** @type {any} */ ({ cellPath() {}, cellBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }) });

test('zone : Marche en aplat, Course hachurée (clip) et pointillée ; sans palier, rien de tel', () => {
  const cells = new Map([['0,0', 1], ['1,0', 4], ['2,0', 5], ['3,0', 8]]);
  const deux = recorder();
  new MoveZoneLayer().render(deux.ctx, fakeGrid, { selectedToken: pion(), reachableCells: cells, walkLimit: 4 });
  assert.ok(deux.calls.includes('clip'), 'hachures de la Course');
  assert.ok(deux.calls.includes('fill:#ffdd4a') && deux.calls.includes('stroke:#ffdd4a'), 'Course en jaune');
  assert.ok(deux.calls.some((c) => c.startsWith('dash:2')), 'bordure pointillée');
  const un = recorder();
  new MoveZoneLayer().render(un.ctx, fakeGrid, { selectedToken: pion(), reachableCells: cells });
  assert.ok(!un.calls.includes('clip') && !un.calls.some((c) => c.startsWith('dash')), 'sans walkLimit : un palier');
  const marche = recorder();
  new MoveZoneLayer().render(marche.ctx, fakeGrid, { selectedToken: pion(), reachableCells: new Map([['0,0', 1]]), walkLimit: 4 });
  assert.ok(!marche.calls.includes('clip'), 'tout à la Marche : pas d’anneau');
});

test('étiquette « Course : Action utilisée » seulement au-delà de la Marche', () => {
  const grid = new SquareGrid(level);
  const rules = movementRulesFor(pion(), level);
  const preview = /** @type {any} */ ({
    levelId: 'rdc', planId: 'p', revision: 1, tokenId: 'g1', start: { a: 1, b: 2 },
    path: path(7), destination: { a: 7, b: 2 }, remaining: 2,
  });
  const resolver = (/** @type {any} */ p) => ranStartIndex(p.path, rules);
  const run = recorder();
  new MovePlanLayer().render(run.ctx, grid, 'rdc', preview, {}, 1, resolver);
  assert.ok(run.calls.includes('text:Course : Action utilisée'));
  const walk = recorder();
  new MovePlanLayer().render(walk.ctx, grid, 'rdc', { ...preview, path: path(5), destination: { a: 5, b: 2 } }, {}, 1, resolver);
  assert.ok(!walk.calls.some((c) => c.includes('Course')));
  const none = recorder();
  new MovePlanLayer().render(none.ctx, grid, 'rdc', preview, {}, 1);
  assert.ok(!none.calls.some((c) => c.includes('Course')), 'sans résolveur : comme avant');
});

test('map.ran : une seule fois, seulement au-delà de la Marche, jamais pour un pion non lié', () => {
  const campaign = createCampaign({
    levels: [level],
    tokens: [pion(), createToken({ id: 'o', levelId: 'rdc', cell: { a: 1, b: 3 }, speedCells: 4 })],
  });
  /** @type {any[]} */
  const sent = [];
  class FakeChannel {
    /** @param {any} m */ postMessage(m) { sent.push(m); }
    close() {}
  }
  const lien = startMjLink({
    store: /** @type {any} */ ({ getCampaign: () => campaign }), publish() {}, createToken, activeLevelId: () => 'rdc',
    sessionId: 's', Channel: /** @type {any} */ (FakeChannel),
  });
  assert.ok(lien);
  const ran = () => sent.filter((m) => m.type === 'map.ran');
  assert.equal(lien.reportMove('g1', path(5)), false, 'la Marche pile ne court pas');
  assert.equal(lien.reportMove('o', path(9)), false, 'pion non lié');
  assert.equal(ran().length, 0);
  assert.equal(lien.reportMove('g1', path(8)), true);
  assert.equal(ran().length, 1);
  assert.deepEqual(ran()[0].payload, { ref: 'pj:g1' });
  assert.equal(ran()[0].from, 'map');
});

test('Bond : bondZoneFor donne les cases au-delà de la Course jusqu’à bondCells, sans toucher au budget', () => {
  const avec = pion({ runCells: 8, bondCells: 16 });
  assert.equal(movementRulesFor(avec, level).budget, 8, 'le budget de déplacement ne change pas');
  const zone = bondZoneFor(avec, level);
  assert.ok(zone && zone.size > 0);
  assert.ok([...zone.values()].every((c) => c > 8 && c <= 16), 'coûts dans ]Course, Bond]');
  assert.ok(zone.has('17,2') && !zone.has('18,2'), 'portée 16 depuis la case 1 : jusqu’à la case 17');
  for (const patch of [{ bondCells: undefined }, { bondCells: 0 }, { bondCells: 8 }, { bondCells: 5 }]) {
    assert.equal(bondZoneFor(pion(patch), level), null, `sans palier : ${JSON.stringify(patch)}`);
  }
  assert.equal(bondZoneFor({ ...avec, link: undefined }, level), null, 'pion non lié');
});

test('zone : le palier Bond se dessine à part ; sans lui, rendu identique à aujourd’hui', () => {
  const cells = new Map([['0,0', 1], ['1,0', 4], ['2,0', 5], ['3,0', 8]]);
  /** @param {Map<string, number>|undefined} bond */
  const rendre = (bond) => {
    const r = recorder();
    const n = new MoveZoneLayer().render(r.ctx, fakeGrid, { selectedToken: pion(), reachableCells: cells, walkLimit: 4, bondCells: bond });
    return { n, calls: r.calls };
  };
  const sans = rendre(undefined);
  const avec = rendre(new Map([['4,0', 12], ['5,0', 16]]));
  assert.equal(sans.n, 4);
  assert.equal(avec.n, 6, 'deux cases de Bond dessinées en plus');
  assert.deepEqual(rendre(new Map()).calls, sans.calls, 'palier vide : rien de changé');
  assert.ok(avec.calls.length > sans.calls.length);
});
