// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FIRESTORE_BATCH_MAX_OPERATIONS,
  FIRESTORE_V3_SCHEMA_VERSION,
  createFirestoreV3TransitionParent,
  joinSnapshotFromFirestoreV3,
  measureFirestoreSnapshot,
  nextFirestoreV3Revision,
  splitSnapshotForFirestoreV3,
} from '../js/transport/FirebaseTransport.js';

/** @param {string} id @param {number} order @returns {any} */
function level(id, order) {
  return {
    id, name: id, order, imageUrl: `maps/${id}.webp`, videoUrl: null, animatedOverlays: [],
    pxPerCell: 140, widthCells: 10, heightCells: 8,
    grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    terrainCost: null,
    walls: [[{ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 0 }]],
    portals: [], lights: [], ambient: { color: '#ffffff', level: 1, baked: false },
  };
}

/** @returns {any} */
function snapshot() {
  return {
    campaign: {
      schemaVersion: 2, campaignId: 'three-levels', name: 'Fixture trois étages',
      levels: [level('rdc', 0), level('etage', 1), level('cave', -1)],
      links: [{ id: 'stairs', kind: 'stairs', label: 'Escalier', a: { levelId: 'rdc', at: { cellX: 2, cellY: 2 } }, b: { levelId: 'etage', at: { cellX: 2, cellY: 2 } }, bidirectional: true, gmOnly: false }],
      tokens: [{ id: 'hero', levelId: 'rdc', cell: { a: 2, b: 2 }, sizeCells: 1, kind: 'pc', imageUrl: 'maps/hero.webp', borderColor: '#ffffff', label: 'Héros', hidden: false, visionBright: 5, visionDim: 10, emitsLight: null, speedCells: 6, playerMovable: true, locked: false, elevation: 0, markers: [], hp: null, health: 'unharmed' }],
      templates: [{ id: 'template', levelId: 'cave', shape: 'circle', origin: { x: 280, y: 280 }, radiusCells: 2, directionDeg: 0, widthCells: 1, color: '#ff0000', visibleToPlayers: true }],
      settings: { ambientLevel: 1 },
    },
    activeLevelId: 'rdc', selectedTokenId: 'hero', activeHandout: { id: 'note' },
  };
}

test('v3 répartit puis reconstitue trois étages sans relire les sous-documents obsolètes', () => {
  const source = snapshot();
  const v3 = splitSnapshotForFirestoreV3(source, 'session-three', 42);
  assert.equal(v3.parent.schemaVersion, FIRESTORE_V3_SCHEMA_VERSION);
  assert.deepEqual(v3.parent.levelIds, ['rdc', 'etage', 'cave']);
  assert.deepEqual(v3.parent.tokenIds, ['hero']);
  assert.equal('levels' in v3.parent, false);
  assert.equal('tokens' in v3.parent, false);
  assert.deepEqual(v3.parent.activeHandout, { id: 'note' });
  assert.equal('activeHandout' in v3.state, false);
  assert.deepEqual(v3.levels[0].data.level.walls, [{ points: [{ cellX: 0, cellY: 0 }, { cellX: 3, cellY: 0 }] }]);

  const restored = joinSnapshotFromFirestoreV3(
    v3.parent,
    [...v3.levels, { id: 'obsolete-level', data: level('obsolete-level', 99) }],
    [...v3.tokens, { id: 'obsolete-token', data: { id: 'obsolete-token' } }],
    v3.state
  );
  assert.deepEqual(restored.campaign.levels.map((/** @type {any} */ item) => item.id), ['rdc', 'etage', 'cave']);
  assert.deepEqual(restored.campaign.tokens.map((/** @type {any} */ item) => item.id), ['hero']);
  assert.deepEqual(restored.campaign.templates, source.campaign.templates);
  assert.equal(restored.activeHandout.id, 'note');
});

test('la transition conserve le secours v2 jusqu au nettoyage de la revision relue', () => {
  const source = snapshot();
  const legacyV2 = { schemaVersion: 2, campaign: source.campaign, activeHandout: source.activeHandout };
  const v3 = splitSnapshotForFirestoreV3(source, 'session-three', 99);
  const transition = createFirestoreV3TransitionParent(legacyV2, v3.parent);

  assert.equal(transition.schemaVersion, FIRESTORE_V3_SCHEMA_VERSION);
  assert.equal(transition.revision, 99);
  assert.equal(transition.migration.legacyV2CleanupPending, true);
  assert.strictEqual(transition.campaign, source.campaign);
  assert.deepEqual(joinSnapshotFromFirestoreV3(transition, v3.levels, v3.tokens, v3.state), source);
});

test('une migration concurrente rebase sa revision et conserve le secours v2 du parent courant', () => {
  const source = snapshot();
  const legacyV2 = { schemaVersion: 2, campaign: source.campaign, activeHandout: source.activeHandout };
  const first = splitSnapshotForFirestoreV3(source, 'session-three', nextFirestoreV3Revision(legacyV2));
  const parentAfterFirst = createFirestoreV3TransitionParent(legacyV2, first.parent);
  const second = splitSnapshotForFirestoreV3(source, 'session-three', nextFirestoreV3Revision(parentAfterFirst));
  const parentAfterRetry = createFirestoreV3TransitionParent(parentAfterFirst, second.parent);

  assert.equal(first.parent.revision, 1);
  assert.equal(second.parent.revision, 2);
  assert.strictEqual(parentAfterRetry.campaign, source.campaign);
  assert.equal(parentAfterRetry.migration.revision, 2);
});

test('v3 échoue explicitement sur parent corrompu ou sous-document référencé manquant', () => {
  const v3 = splitSnapshotForFirestoreV3(snapshot(), 'session-three', 1);
  assert.throws(
    () => joinSnapshotFromFirestoreV3({ ...v3.parent, levelIds: ['rdc', 4] }, v3.levels, v3.tokens, v3.state),
    /corrompu/
  );
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, v3.levels.filter((item) => item.id !== 'cave'), v3.tokens, v3.state),
    /incomplet.*étage/
  );
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, v3.levels, [], v3.state),
    /incomplet.*pion/
  );
});

test('v3 refuse un batch dépassant 500 opérations avant toute écriture SDK', () => {
  const tooMany = snapshot();
  tooMany.campaign.tokens = Array.from({ length: FIRESTORE_BATCH_MAX_OPERATIONS }, (_, i) => ({ id: `token-${i}` }));
  assert.throws(() => splitSnapshotForFirestoreV3(tooMany, 'overflow'), /dépassent la limite de lot/);
});

test('la fixture synthétique à trois étages est transportable sans assets réels', () => {
  const fixturePath = fileURLToPath(new URL('../fixtures/three-level-transport-v3.json', import.meta.url));
  /** @type {any} */
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const v3 = splitSnapshotForFirestoreV3(fixture, 'fixture-three-levels', 7);
  assert.deepEqual(v3.parent.levelIds, ['cave', 'rdc', 'etage']);
  const ground = v3.levels.find((entry) => entry.id === 'rdc');
  assert.ok(ground);
  assert.equal(ground.data.level.portals[0].locked, true);
  assert.deepEqual(joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, v3.state), fixture);
});

test('replay transport : teleport, suivi, selection et verrou restent independants par etage', () => {
  const fixturePath = fileURLToPath(new URL('../fixtures/three-level-transport-v3.json', import.meta.url));
  /** @type {any} */
  const campaign = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  // Le lien est le declencheur du teleport ; le transport ne calcule pas l interaction UI.
  campaign.campaign.tokens[0].levelId = campaign.campaign.links[0].b.levelId;
  campaign.activeLevelId = 'etage'; // suivi camera/selection apres teleport
  const v3 = splitSnapshotForFirestoreV3(campaign, 'replay-three-levels', 12);
  const replayed = joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, v3.state);

  assert.equal(replayed.campaign.tokens[0].levelId, 'etage');
  assert.equal(replayed.activeLevelId, 'etage');
  assert.equal(replayed.selectedTokenId, 'hero');
  assert.equal(replayed.campaign.levels.find((/** @type {any} */ item) => item.id === 'rdc').portals[0].locked, true);
  assert.equal('fog' in v3.state, false);
});

test('v3 accepte une campagne globale trop grande si chaque document réparti reste sous le plafond', () => {
  const source = snapshot();
  source.campaign.levels = ['rdc', 'etage', 'cave'].map((id, order) => ({
    ...level(id, order),
    notes: 'x'.repeat(360_000),
  }));
  assert.equal(measureFirestoreSnapshot(source, 'single-doc').severity, 'error');
  assert.doesNotThrow(() => splitSnapshotForFirestoreV3(source, 'distributed', 8));
});

test('v3 refuse de joindre des sous-documents d une autre révision', () => {
  const v3 = splitSnapshotForFirestoreV3(snapshot(), 'session-three', 10);
  const newer = splitSnapshotForFirestoreV3(snapshot(), 'session-three', 11);
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, newer.levels, v3.tokens, v3.state),
    /incomplet.*étage/
  );
  assert.throws(
    () => joinSnapshotFromFirestoreV3(v3.parent, v3.levels, v3.tokens, newer.state),
    /incohérent/
  );
});

test('la révision v3 est monotone depuis le parent transactionnel, jamais dérivée de l horloge', () => {
  assert.equal(nextFirestoreV3Revision(null), 1);
  assert.equal(nextFirestoreV3Revision({ schemaVersion: 2 }), 1);
  assert.equal(nextFirestoreV3Revision({ schemaVersion: FIRESTORE_V3_SCHEMA_VERSION, revision: 41 }), 42);
  assert.throws(
    () => nextFirestoreV3Revision({ schemaVersion: FIRESTORE_V3_SCHEMA_VERSION, revision: 1.5 }),
    /révision entière/
  );
});
