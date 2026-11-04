// @ts-check
// Liaison outil MJ Warhammer, étape C (docs/CONTRAT-LIAISON-OUTIL-MJ.md §3, §4, §11) : champs du pion lié,
// source de vision, pas de ×2 monté pour un pion lié. Un pion ordinaire ne change pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createToken, validateCampaign, isVisionSource, isLinkedToken } from '../js/core/schema.js';
import { movementRulesFor } from '../js/state/selection.js';

/**
 * @param {string} type
 * @param {any} payload
 */
const msg = (type, payload) => ({ v: 1, type, seq: 1, at: 0, from: 'outil-mj', payload });
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

test('mjLink : PNJ inconnu en réserve, PJ inconnu en attente de liaison, PJ jamais retiré', async () => {
  const { planMjMessage } = await import('../js/app/mjLink.js');
  const campaign = createCampaign({ levels: [level], tokens: [] });
  const gob = { ref: 'p:g9', label: 'Gobelin 2', camp: 'ennemi', kind: 'npc', visionSource: false, imageUrl: null, sizeCells: 1, speedCells: 4, runCells: 8, visionDim: 1, hp: { current: 8, max: 8 }, health: 'unharmed', markers: [], markerLevels: {}, dead: false };
  const [add] = planMjMessage(campaign, msg('token.add', gob));
  assert.equal(add.op, 'reserveAdd');
  assert.deepEqual(add.token.link, { source: 'outil-mj', ref: 'p:g9' });
  assert.equal('imageUrl' in add.token, false, 'imageUrl nulle : rien n’est écrit');
  assert.deepEqual(planMjMessage(campaign, msg('token.state', { ...gob, ref: 'pj:c9', kind: 'pc' })).map((o) => o.op), ['awaitBinding']);
  assert.deepEqual(planMjMessage(campaign, msg('token.remove', { ref: 'pj:c9' })), []);
  assert.deepEqual(planMjMessage(campaign, { ...msg('token.add', gob), v: 2 }), [], 'autre version ignorée');
  assert.deepEqual(planMjMessage(campaign, { ...msg('token.add', gob), from: 'map' }), [], 'ses propres messages ignorés');
});

test('mjLink : pion lié trouvé → patch des seuls champs changés, bascule monté, retrait ; instantané nettoie les PNJ disparus', async () => {
  const { planMjMessage } = await import('../js/app/mjLink.js');
  const g1 = linked({ label: 'Gobelin 2', hp: { current: 8, max: 8 }, speedCells: 4 });
  const pj = { ...createToken({ id: 'u', levelId: 'rdc', cell: { a: 5, b: 5 }, kind: 'pc' }), link: { ...link, ref: 'pj:c9' } };
  const campaign = createCampaign({ levels: [level], tokens: [g1, pj] });
  const ops = planMjMessage(campaign, msg('token.state', { ref: 'p:g1', label: 'Gobelin 2', hp: { current: 3, max: 8 }, speedCells: 4, mounted: true }));
  assert.deepEqual(ops, [{ op: 'update', tokenId: 'g1', patch: { hp: { current: 3, max: 8 } } }, { op: 'mounted', tokenId: 'g1', mounted: true }]);
  assert.deepEqual(planMjMessage(campaign, msg('token.remove', { ref: 'p:g1' })), [{ op: 'remove', tokenId: 'g1', where: 'board' }]);
  const snap = planMjMessage(campaign, msg('mj.snapshot', { tokens: [{ ref: 'pj:c9', label: 'Ulrika' }] }));
  assert.deepEqual(snap, [{ op: 'update', tokenId: 'u', patch: { label: 'Ulrika' } }, { op: 'remove', tokenId: 'g1', where: 'board' }]);
});

test('store : addTokenToReserve range un pion lié hors plateau, refuse un doublon', async () => {
  const { loadCampaign, addTokenToReserve, getCampaign } = await import('../js/state/store.js');
  loadCampaign(createCampaign({ levels: [level], tokens: [] }));
  addTokenToReserve(linked({ id: 'r1' }));
  assert.deepEqual(getCampaign()?.reserve?.map((t) => t.id), ['r1']);
  assert.equal(getCampaign()?.tokens.length, 0);
  assert.throws(() => addTokenToReserve(linked({ id: 'r1' })), /déjà présent/);
  assert.throws(() => addTokenToReserve(linked({ id: 'r2', runCells: -1 })), /runCells/);
  assert.deepEqual(getCampaign()?.reserve?.map((t) => t.id), ['r1'], 'refus sans mutation');
});

test('mjLink : exécution — réserve locale, plateau republié vers la tablette', async () => {
  const { planMjMessage, executeMjOperations } = await import('../js/app/mjLink.js');
  const store = await import('../js/state/store.js');
  const pose = linked({ id: 'g1' });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [pose] }));
  /** @type {[string, any][]} */
  const published = [];
  let n = 0;
  const deps = { store, publish: (/** @type {string} */ type, /** @type {any} */ payload) => { published.push([type, payload]); }, createToken, newTokenId: () => `lie-${++n}`, trace: { levelId: 'rdc', cell: { a: 0, b: 0 } } };
  const run = (/** @type {string} */ type, /** @type {any} */ payload) => executeMjOperations(planMjMessage(/** @type {any} */ (store.getCampaign()), msg(type, payload)), deps);
  const gob = { ref: 'p:g9', label: 'Gobelin 3', camp: 'ennemi', kind: 'npc', visionSource: false, imageUrl: null, sizeCells: 1, speedCells: 4, runCells: 8, visionDim: 1, hp: { current: 8, max: 8 }, health: 'unharmed', markers: [], markerLevels: {}, dead: false };

  run('token.add', gob);
  assert.deepEqual(store.getCampaign()?.reserve?.map((t) => [t.id, t.label, t.link?.ref]), [['lie-1', 'Gobelin 3', 'p:g9']]);
  run('token.state', { ...gob, hp: { current: 2, max: 8 }, health: 'critical', mounted: true });
  assert.equal(store.getCampaign()?.reserve?.[0].health, 'critical');
  assert.equal(store.getCampaign()?.reserve?.[0].mounted, true);
  assert.deepEqual(published, [], 'rien ne part vers la tablette tant que le pion est en réserve');

  run('token.state', { ref: 'p:g1', hp: { current: 1, max: 20 }, dead: true, deathCause: 'fire' });
  assert.deepEqual(published, [['token.update', { tokenId: 'g1', patch: { hp: { current: 1, max: 20 }, dead: true, deathCause: 'fire' } }]]);
  run('token.remove', { ref: 'p:g1' });
  run('token.remove', { ref: 'p:g9' });
  assert.deepEqual(published.at(-1), ['token.delete', { tokenId: 'g1' }]);
  assert.equal(store.getCampaign()?.tokens.length, 0);
  assert.equal(store.getCampaign()?.reserve?.length, 0);
  assert.deepEqual(run('token.state', { ...gob, ref: 'pj:c9', label: 'Ulrika' }).awaiting, [{ ref: 'pj:c9', label: 'Ulrika' }]);
});
