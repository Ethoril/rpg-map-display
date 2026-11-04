// @ts-check
// Liaison outil MJ Warhammer, étape C (docs/CONTRAT-LIAISON-OUTIL-MJ.md §3, §4, §11) : champs du pion lié,
// source de vision, pas de ×2 monté pour un pion lié. Un pion ordinaire ne change pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createToken, validateCampaign, isVisionSource, isLinkedToken } from '../js/core/schema.js';
import { movementRulesFor } from '../js/state/selection.js';

const link = { source: /** @type {'outil-mj'} */ ('outil-mj'), ref: 'p:g1' };
const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
/** @param {any} token */
const errorsOf = (token) => validateCampaign(createCampaign({ levels: [level], tokens: [token] }));
/** @param {object} patch */
const linked = (patch = {}) => ({ ...createToken({ id: 'g1', levelId: 'rdc', cell: { a: 2, b: 2 } }), link, ...patch });

test('un pion lié complet se valide ; un pion ordinaire aussi, sans aucun champ de liaison', () => {
  assert.deepEqual(errorsOf(linked({ runCells: 8, visionSource: false, markerLevels: { stunned: 3 }, dead: true, deathCause: 'fire', camp: 'ennemi' })), []);
  const ordinaire = createToken({ id: 'o', levelId: 'rdc', cell: { a: 1, b: 1 } });
  assert.deepEqual(errorsOf(ordinaire), []);
  assert.equal(isLinkedToken(ordinaire), false);
  assert.equal(isLinkedToken(linked()), true);
});

test('les champs de liaison mal formés sont refusés', () => {
  for (const patch of [
    { link: { source: 'autre', ref: 'x' } }, { link: { source: 'outil-mj', ref: '' } }, { runCells: -1 }, { runCells: 2.5 },
    { visionSource: 'oui' }, { markerLevels: { stunned: 1 } }, { markerLevels: { inconnu: 2 } }, { dead: 1 },
    { deathCause: 'chute' }, { camp: 'pirate' }
  ]) assert.equal(errorsOf(linked(patch)).length, 1, JSON.stringify(patch));
});

test('source de vision : visionSource explicite, sinon kind pc', () => {
  assert.equal(isVisionSource({ kind: 'pc' }), true);
  assert.equal(isVisionSource({ kind: 'npc' }), false);
  assert.equal(isVisionSource({ kind: 'pc', visionSource: false }), false, 'monture d’un PJ : pc sans vision');
  assert.equal(isVisionSource({ kind: 'npc', visionSource: true }), true);
});

test('monté : ×2 pour un pion ordinaire, portée de l’outil MJ telle quelle pour un pion lié', () => {
  const base = createToken({ id: 'c', levelId: 'rdc', cell: { a: 2, b: 2 }, speedCells: 7, mounted: true });
  assert.equal(movementRulesFor(base, level).budget, 14);
  assert.equal(movementRulesFor({ ...base, link }, level).budget, 7);
  assert.equal(movementRulesFor({ ...base, link, mounted: false }, level).budget, 7);
});

test('store : un pion lié accepte image et champs de liaison, un pion ordinaire les refuse sans muter', async () => {
  const { loadCampaign, updateToken, getCampaign } = await import('../js/state/store.js');
  const ordinaire = createToken({ id: 'o', levelId: 'rdc', cell: { a: 1, b: 1 } });
  loadCampaign(createCampaign({ levels: [level], tokens: [linked(), ordinaire] }));
  const image = 'data:image/webp;base64,UklGRg==';
  updateToken('g1', { imageUrl: image, runCells: 8, markerLevels: { stunned: 2 }, dead: true, deathCause: 'blood', camp: 'ennemi', visionSource: false });
  const g1 = getCampaign()?.tokens.find((t) => t.id === 'g1');
  assert.equal(g1?.imageUrl, image);
  assert.equal(g1?.deathCause, 'blood');
  for (const patch of [{ imageUrl: image }, { runCells: 8 }, { dead: true }]) {
    assert.throws(() => updateToken('o', patch), /champ non autorisé/, JSON.stringify(patch));
  }
  assert.throws(() => updateToken('g1', { link: { source: 'outil-mj', ref: 'autre' } }), /champ non autorisé/);
  assert.throws(() => updateToken('g1', { mounted: true }), /champ non autorisé/);
  assert.equal(getCampaign()?.tokens.find((t) => t.id === 'o')?.dead, undefined);
});
