// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { MovePlanningController } from '../js/app/movePlanning.js';
import { createLevel, createToken } from '../js/core/schema.js';
import { clearPresence, updatePresence } from '../js/state/presence.js';

/** @typedef {import('../js/core/types.js').MovePreview} MovePreview */

test('aperçu reçu avant la présence : affichage dès que son propriétaire arrive', () => {
  clearPresence();
  /** @type {((previews: Record<string, MovePreview>) => void)|null} */
  let receive = null;
  const controller = new MovePlanningController({ transport: {
    getClientId: () => 'local',
    subscribeMovePreviews: (callback) => { receive = callback; return () => {}; },
  } });
  const preview = {
    planId: 'plan-distance', revision: 1, levelId: 'rdc', tokenId: 'hero',
    start: { a: 1, b: 1 }, path: [{ a: 1, b: 1 }, { a: 2, b: 1 }],
    destination: { a: 2, b: 1 }, remaining: 5,
  };
  try {
    assert.ok(receive);
    /** @type {(previews: Record<string, MovePreview>) => void} */ (receive)({ distant: preview });
    assert.deepEqual(controller.getRemotePreviews(), {}, 'aucun propriétaire présent pour le moment');
    updatePresence('distant', { role: 'players', at: Date.now(), build: 35, label: 'Table' });
    assert.equal(controller.getRemotePreviews().distant?.planId, preview.planId,
      'la réception tardive de présence doit suffire, sans nouvelle publication de trajet');
    clearPresence();
    assert.deepEqual(controller.getRemotePreviews(), {}, 'un propriétaire disparu retire le trajet');
  } finally {
    controller.dispose();
    clearPresence();
  }
});

test('validation : le trajet complet est soumis une seule fois, puis la préparation disparaît', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  const token = createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 }, speedCells: 3 });
  const original = structuredClone(token);
  const controller = new MovePlanningController();
  let commits = 0;
  try {
    controller.start(token, level);
    assert.equal(controller.extend({ a: 3, b: 1 }, token, level).ok, true);
    assert.equal(controller.extend({ a: 3, b: 2 }, token, level).ok, true);
    assert.deepEqual(token, original, 'la préparation ne modifie pas le pion');
    const result = controller.validate(token, level, (path, destination) => {
      commits++;
      assert.deepEqual(path, [{ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 3, b: 1 }, { a: 3, b: 2 }]);
      assert.deepEqual(destination, { a: 3, b: 2 });
      return true;
    });
    assert.equal(result.ok, true);
    assert.equal(controller.getPlan(), null);
    assert.equal(controller.validate(token, level, () => { commits++; return true; }).ok, false);
    assert.equal(commits, 1);
  } finally { controller.dispose(); }
});

test('validation : une position de départ modifiée interdit de commettre le trajet préparé', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  const token = createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 } });
  const controller = new MovePlanningController();
  try {
    controller.start(token, level);
    assert.equal(controller.extend({ a: 2, b: 1 }, token, level).ok, true);
    let commits = 0;
    const result = controller.validate({ ...token, cell: { a: 1, b: 2 } }, level, () => {
      commits++; return true;
    });
    assert.equal(result.ok, false);
    assert.equal(commits, 0);
  } finally { controller.dispose(); }
});

test('réconciliation : une position réelle modifiée retire même une sélection sans étapes', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  const token = createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 } });
  /** @type {string[]} */
  const reasons = [];
  const controller = new MovePlanningController({ onInvalidated: (reason) => reasons.push(reason) });
  try {
    controller.start(token, level);
    controller.reconcile({ ...token, cell: { a: 2, b: 1 } }, level);
    assert.equal(controller.getPlan(), null);
    assert.equal(reasons.length, 1);
  } finally { controller.dispose(); }
});

test('réconciliation : un coût modifié republie le budget restant sans déplacer le pion', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  const token = createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 }, speedCells: 5 });
  /** @type {MovePreview[]} */
  const published = [];
  const controller = new MovePlanningController({ transport: {
    publishMovePreview: async (preview) => { published.push(structuredClone(preview)); return { ok: true }; },
    clearMovePreview: async () => ({ ok: true }),
  } });
  try {
    controller.start(token, level);
    assert.equal(controller.extend({ a: 2, b: 1 }, token, level).ok, true);
    const revision = published[0].revision;
    controller.reconcile(token, { ...level, terrainCost: { '2,1': 2 } });
    assert.equal(controller.getPlan()?.remaining, 3);
    assert.equal(published.at(-1)?.remaining, 3);
    assert.ok((published.at(-1)?.revision ?? 0) > revision);
    assert.deepEqual(token.cell, { a: 1, b: 1 });
  } finally { controller.dispose(); }
});

test('validation : sa propre notification de déplacement ne signale pas une invalidation', () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  const token = createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 } });
  /** @type {string[]} */
  const reasons = [];
  const controller = new MovePlanningController({ onInvalidated: (reason) => reasons.push(reason) });
  try {
    controller.start(token, level);
    assert.equal(controller.extend({ a: 2, b: 1 }, token, level).ok, true);
    const result = controller.validate(token, level, (_path, destination) => {
      controller.reconcile({ ...token, cell: destination }, level);
      controller.reconcile(null, level);
      return true;
    });
    assert.equal(result.ok, true);
    assert.deepEqual(reasons, []);
    assert.equal(controller.getPlan(), null);
  } finally { controller.dispose(); }
});

test('publication : un échec tardif ne remplace pas une préparation plus récente synchronisée', async () => {
  const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
  const token = createToken({ id: 'hero', levelId: 'rdc', cell: { a: 1, b: 1 }, speedCells: 5 });
  /** @type {((result: {ok:boolean,error?:unknown}) => void)|null} */
  let finishOld = null;
  let calls = 0;
  const controller = new MovePlanningController({
    onPublicationError: () => {},
    transport: {
      publishMovePreview: () => {
        if (++calls === 1) return new Promise((resolve) => { finishOld = resolve; });
        return Promise.resolve({ ok: true });
      },
      clearMovePreview: async () => ({ ok: true }),
    },
  });
  try {
    controller.start(token, level);
    controller.extend({ a: 2, b: 1 }, token, level);
    controller.extend({ a: 3, b: 1 }, token, level);
    const latestId = controller.getPlan()?.planId;
    assert.ok(finishOld);
    /** @type {(result: {ok:boolean,error?:unknown}) => void} */ (finishOld)({ ok: false, error: new Error('ancienne écriture') });
    await Promise.resolve();
    assert.equal(controller.getPlan()?.planId, latestId);
    assert.deepEqual(controller.getPlan()?.steps, [{ a: 2, b: 1 }, { a: 3, b: 1 }]);
  } finally { controller.dispose(); }
});
