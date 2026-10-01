// @ts-check

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../js/state/store.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';

/** @typedef {import('../js/core/types.js').NetEvent} NetEvent */

beforeEach(() => {
  store.resetStore();
});

test('1. applyNetworkEvent token.elevation (idempotence & rejeu)', () => {
  const level = createLevel({ id: 'l1', name: 'Niveau 1' });
  const token = createToken({
    id: 't-ele-1',
    levelId: 'l1',
    cell: { a: 1, b: 1 },
    label: 'Mage',
  });

  store.loadCampaign(
    createCampaign({
      campaignId: 'c-ele',
      name: 'Campagne Elevation',
      levels: [level],
      tokens: [token],
    })
  );

  /** @type {NetEvent} */
  const eventElevation = {
    type: 'token.elevation',
    payload: {
      tokenId: 't-ele-1',
      elevation: 4,
    },
    at: Date.now(),
    by: 'gm',
  };

  // Premier appel
  const res1 = applyNetworkEvent(eventElevation);
  assert.equal(res1, true);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 4);

  // Rejeu (idempotence)
  const res2 = applyNetworkEvent(eventElevation);
  assert.equal(res2, true);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 4);
});

test('2. applyNetworkEvent token.elevation refuse pion inconnu ou valeur non finie sans muter le store', () => {
  const level = createLevel({ id: 'l1', name: 'Niveau 1' });
  const token = createToken({
    id: 't-ele-2',
    levelId: 'l1',
    cell: { a: 1, b: 1 },
    label: 'Guerrier',
  });

  store.loadCampaign(
    createCampaign({
      campaignId: 'c-ele-2',
      name: 'Campagne Elevation 2',
      levels: [level],
      tokens: [token],
    })
  );

  // Pion inconnu
  /** @type {NetEvent} */
  const unknownTokenEvent = {
    type: 'token.elevation',
    payload: { tokenId: 'pion-inconnu', elevation: 2 },
    at: Date.now(),
    by: 'gm',
  };
  const resUnknown = applyNetworkEvent(unknownTokenEvent);
  assert.equal(resUnknown, false);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 0);

  // Valeur non finie (NaN / Infinity)
  /** @type {NetEvent} */
  const nonFiniteEvent = {
    type: 'token.elevation',
    payload: { tokenId: 't-ele-2', elevation: Infinity },
    at: Date.now(),
    by: 'gm',
  };
  const resNonFinite = applyNetworkEvent(nonFiniteEvent);
  assert.equal(resNonFinite, false);
  assert.equal(store.getCampaign()?.tokens[0].elevation, 0);
});

/**
 * Charge une campagne d'un étage et d'un pion, pour les scénarios token.update / token.delete.
 * @param {string} tokenId
 */
function loadOneTokenCampaign(tokenId) {
  store.loadCampaign(
    createCampaign({
      campaignId: `c-${tokenId}`,
      name: 'Campagne pion',
      levels: [createLevel({ id: 'l1', name: 'Niveau 1' })],
      tokens: [createToken({ id: tokenId, levelId: 'l1', cell: { a: 1, b: 1 }, label: 'Mage' })],
    })
  );
}

test('3. applyNetworkEvent token.update porte un patch absolu, donc rejouable', () => {
  loadOneTokenCampaign('t-upd-1');

  /** @type {NetEvent} */
  const event = {
    type: 'token.update',
    payload: { tokenId: 't-upd-1', patch: { label: 'Archimage', hidden: true, sizeCells: 2 } },
    at: Date.now(),
    by: 'gm',
  };

  assert.equal(applyNetworkEvent(event), true);
  assert.equal(store.getCampaign()?.tokens[0].label, 'Archimage');
  assert.equal(store.getCampaign()?.tokens[0].hidden, true);
  assert.equal(store.getCampaign()?.tokens[0].sizeCells, 2);

  // Rejeu : le patch portant des valeurs absolues et non des deltas, l'état converge.
  assert.equal(applyNetworkEvent(event), true);
  assert.equal(store.getCampaign()?.tokens[0].label, 'Archimage');
  assert.equal(store.getCampaign()?.tokens[0].sizeCells, 2);
});

test('4. applyNetworkEvent token.update refuse pion inconnu, patch absent et champ hors liste blanche', () => {
  loadOneTokenCampaign('t-upd-2');
  const avant = store.getCampaign();

  /** @param {any} payload */
  const refuse = (payload) => {
    const res = applyNetworkEvent({ type: 'token.update', payload, at: Date.now(), by: 'gm' });
    assert.equal(res, false);
    assert.deepStrictEqual(store.getCampaign(), avant);
  };

  refuse({ tokenId: 'pion-inconnu', patch: { label: 'X' } });
  refuse({ tokenId: 't-upd-2' });
  refuse({ tokenId: 't-upd-2', patch: 'pas-un-objet' });
  // Un tableau est un objet en JS : sans garde explicite il traverserait la validation.
  refuse({ tokenId: 't-upd-2', patch: [] });
  // La liste blanche du store reste seule juge, et son refus ne doit pas remonter en
  // exception jusqu'à la boucle réseau.
  refuse({ tokenId: 't-upd-2', patch: { cell: { a: 9, b: 9 } } });
  refuse({ tokenId: 't-upd-2', patch: { levelId: 'l2' } });
});

test('5. applyNetworkEvent token.delete converge, et son rejeu n’est pas une anomalie', () => {
  loadOneTokenCampaign('t-del-1');

  /** @type {NetEvent} */
  const event = {
    type: 'token.delete',
    payload: { tokenId: 't-del-1' },
    at: Date.now(),
    by: 'gm',
  };

  assert.equal(applyNetworkEvent(event), true);
  assert.equal(store.getCampaign()?.tokens.length, 0);

  // Rejeu : `false` parce que rien n'a changé — le pion est déjà absent, donc l'état visé
  // est atteint. C'est le cas nominal d'une reconnexion qui rejoue les événements.
  assert.equal(applyNetworkEvent(event), false);
  assert.equal(store.getCampaign()?.tokens.length, 0);

  // tokenId manquant ou non textuel : refusé sans toucher au store.
  loadOneTokenCampaign('t-del-2');
  const avant = store.getCampaign();
  assert.equal(
    applyNetworkEvent({ type: 'token.delete', payload: {}, at: Date.now(), by: 'gm' }),
    false
  );
  assert.equal(
    applyNetworkEvent({ type: 'token.delete', payload: { tokenId: 42 }, at: Date.now(), by: 'gm' }),
    false
  );
  assert.deepStrictEqual(store.getCampaign(), avant);
});
