// @ts-check

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../js/state/store.js';
import { applyNetworkEvent, createSnapshotPayload } from '../js/app/networkEvents.js';

/** @typedef {import('../js/core/types.js').NetEvent} NetEvent */

beforeEach(() => {
  store.resetStore();
});

test('1. applyNetworkEvent handout.show et handout.hide (idempotence & rejeu)', () => {
  /** @type {NetEvent} */
  const showEvent = {
    type: 'handout.show',
    payload: {
      handout: {
        id: 'handout-1',
        name: 'Lettre du roi',
        imageUrl: './assets/lettre.jpg',
      },
    },
    at: Date.now(),
    by: 'gm',
  };

  // Premier appel
  const changed1 = applyNetworkEvent(showEvent);
  assert.equal(changed1, true);

  const active1 = store.getActiveHandout();
  assert.notEqual(active1, null);
  assert.equal(active1?.id, 'handout-1');
  assert.equal(active1?.name, 'Lettre du roi');
  assert.equal(active1?.imageUrl, './assets/lettre.jpg');

  // Rejeu (idempotence)
  const changed2 = applyNetworkEvent(showEvent);
  assert.equal(changed2, true);
  const active2 = store.getActiveHandout();
  assert.deepEqual(active1, active2);

  // Masquage
  /** @type {NetEvent} */
  const hideEvent = {
    type: 'handout.hide',
    payload: {},
    at: Date.now(),
    by: 'gm',
  };

  const changedHide1 = applyNetworkEvent(hideEvent);
  assert.equal(changedHide1, true);
  assert.equal(store.getActiveHandout(), null);

  // Rejeu masquage
  const changedHide2 = applyNetworkEvent(hideEvent);
  assert.equal(changedHide2, true);
  assert.equal(store.getActiveHandout(), null);
});

test('2. Refus des URLs data: et blob: par le store et networkEvents (sans mutation)', () => {
  assert.equal(store.getActiveHandout(), null);

  // Tentative data: direct store
  assert.throws(() => {
    store.setActiveHandout({
      id: 'bad-1',
      name: 'Image data',
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
  }, /imageUrl/i);
  assert.equal(store.getActiveHandout(), null);

  // Tentative blob: direct store
  assert.throws(() => {
    store.setActiveHandout({
      id: 'bad-2',
      name: 'Image blob',
      imageUrl: 'blob:http://localhost:3000/550e8400-e29b-41d4-a716-446655440000',
    });
  }, /imageUrl/i);
  assert.equal(store.getActiveHandout(), null);

  // Tentative networkEvent data:
  /** @type {NetEvent} */
  const badEvent = {
    type: 'handout.show',
    payload: {
      handout: {
        id: 'bad-3',
        name: 'Network Data',
        imageUrl: 'data:image/png;base64,12345',
      },
    },
    at: Date.now(),
    by: 'gm',
  };

  const res = applyNetworkEvent(badEvent);
  assert.equal(res, false);
  assert.equal(store.getActiveHandout(), null);
});

test('3. Aller-retour createSnapshotPayload -> restoreFromSnapshot conservant le handout', () => {
  store.setActiveHandout({
    id: 'snap-handout',
    name: 'Carte du trésor',
    imageUrl: './maps/treasure.jpg',
  });

  const snapshot = createSnapshotPayload();
  assert.notEqual(snapshot.activeHandout, null);
  assert.equal(snapshot.activeHandout?.id, 'snap-handout');

  // Réinitialiser le store
  store.resetStore();
  assert.equal(store.getActiveHandout(), null);

  // Restaurer
  store.restoreFromSnapshot(snapshot);
  const restored = store.getActiveHandout();
  assert.notEqual(restored, null);
  assert.equal(restored?.id, 'snap-handout');
  assert.equal(restored?.name, 'Carte du trésor');
  assert.equal(restored?.imageUrl, './maps/treasure.jpg');
});
