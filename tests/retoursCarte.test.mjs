// @ts-check
// L5-MD — Retours de la carte vers l'outil MJ (docs/CONTRAT-LIAISON-OUTIL-MJ.md §10, §14 D4) :
// `map.placed` / `map.unplaced`, `map.adjacency`, `map.distance`, traits d'engagement (écran MJ seul).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import * as store from '../js/state/store.js';
import { startMjLink, adjacencyPairs, answerDistanceQuery, placedLinkedRefs, parseEngagements } from '../js/app/mjLink.js';
import { EngagementsLayer, engagementSegments } from '../js/render/layers/engagements.js';
import { gridFor } from '../js/grid/index.js';

const level = createLevel({ id: 'rdc', widthCells: 20, heightCells: 20 });
const cave = createLevel({ id: 'cave', widthCells: 20, heightCells: 20 });
const hexLevel = createLevel({ id: 'hex', widthCells: 20, heightCells: 20, grid: { type: 'hex' } });

/**
 * @param {string} id @param {string} ref @param {'pj'|'allie'|'ennemi'|'neutre'} camp
 * @param {number} a @param {number} b @param {object} [patch]
 */
const pion = (id, ref, camp, a, b, patch = {}) => ({
  ...createToken({ id, levelId: 'rdc', cell: { a, b } }), link: { source: /** @type {'outil-mj'} */ ('outil-mj'), ref }, camp, ...patch,
});
/** @param {any[]} tokens @param {any[]} [reserve] */
const scene = (tokens, reserve = []) => ({ ...createCampaign({ levels: [level, cave, hexLevel], tokens }), reserve });

/** @param {string} type @param {any} payload */
const msg = (type, payload) => ({ v: 1, type, seq: 1, at: 0, from: 'outil-mj', payload });

class FakeChannel {
  /** @type {FakeChannel|null} */ static last = null;
  /** @type {any[]} */ static sent = [];
  /** @type {((e: any) => void)|null} */ onmessage = null;
  constructor() { FakeChannel.last = this; }
  /** @param {any} m */ postMessage(m) { FakeChannel.sent.push(m); }
  close() {}
  /** @param {any} data */ deliver(data) { this.onmessage?.({ data }); }
}
const sent = (/** @type {string} */ type) => FakeChannel.sent.filter((m) => m.type === type).map((m) => m.payload);

/** @type {{ close: () => void }[]} */
const opened = [];
/** Liaison branchée sur le VRAI store : ses abonnés sont prévenus à chaque mutation. */
function openLink() {
  FakeChannel.sent = [];
  const link = startMjLink({
    store: /** @type {any} */ (store), publish: () => {}, createToken, activeLevelId: () => store.getActiveLevelId(),
    sessionId: 's', Channel: /** @type {any} */ (FakeChannel), now: () => 0,
  });
  assert.ok(link && FakeChannel.last);
  opened.push(link);
  return { link, channel: /** @type {FakeChannel} */ (FakeChannel.last) };
}

beforeEach(() => {
  for (const link of opened.splice(0)) link.close();
  store.resetStore();
});

test('adjacence : camps opposés seulement, diagonale comprise, emprises comprises, même étage, morts exclus', () => {
  const tokens = [
    pion('h', 'pj:h', 'pj', 2, 2),
    pion('o', 'p:o', 'ennemi', 3, 3), // diagonale de h
    pion('al', 'p:al', 'allie', 4, 3), // à côté de o, même bord que h
    pion('n', 'p:n', 'neutre', 1, 2), // neutre : aucun bord
    pion('t', 'p:t', 'ennemi', 1, 1), // diagonale de h, mais à côté d'aucun autre
    pion('g', 'p:g', 'ennemi', 8, 8, { sizeCells: 2 }), // 2×2 : (8..9, 8..9)
    pion('k', 'pj:k', 'pj', 10, 9), // contre le flanc droit du 2×2
    pion('mort', 'p:mort', 'ennemi', 2, 3, { dead: true }),
    pion('p1', 'pj:p1', 'pj', 15, 15), pion('p2', 'p:p2', 'allie', 16, 15), // même bord, au contact
    pion('e1', 'p:e1', 'ennemi', 15, 18), pion('e2', 'p:e2', 'ennemi', 16, 18), // même bord, au contact
    pion('c', 'p:c', 'ennemi', 3, 2, { levelId: 'cave' }),
    { ...createToken({ id: 'libre', levelId: 'rdc', cell: { a: 2, b: 1 } }), camp: 'ennemi' }, // non lié
  ];
  assert.deepEqual(adjacencyPairs(scene(tokens)), [['p:al', 'p:o'], ['p:g', 'pj:k'], ['p:o', 'pj:h'], ['p:t', 'pj:h']]);
});

test('adjacence : deux cases d écart, ce n est plus adjacent', () => {
  assert.deepEqual(adjacencyPairs(scene([pion('h', 'pj:h', 'pj', 2, 2), pion('o', 'p:o', 'ennemi', 4, 2)])), []);
});

test('distance : octile (diagonale 1,5), emprises au plus près, null hors plateau ou autre étage, hexagone', () => {
  const tokens = [
    pion('h', 'pj:h', 'pj', 0, 0),
    pion('o', 'p:o', 'ennemi', 3, 3),
    pion('l', 'p:l', 'ennemi', 5, 0),
    pion('g', 'p:g', 'ennemi', 4, 4, { sizeCells: 3 }),
    pion('c', 'p:c', 'ennemi', 1, 1, { levelId: 'cave' }),
    pion('x1', 'p:x1', 'pj', 0, 0, { levelId: 'hex' }),
    pion('x2', 'p:x2', 'ennemi', 3, 0, { levelId: 'hex' }),
  ];
  const campaign = scene(tokens, [pion('r', 'p:r', 'ennemi', 9, 9)]);
  const ask = (/** @type {string} */ fromRef, /** @type {string} */ toRef) => answerDistanceQuery(campaign, { fromRef, toRef, queryId: 'q' });
  assert.deepEqual(ask('pj:h', 'p:o'), { queryId: 'q', cells: 4.5 }, '3 diagonales = 4,5 cases');
  assert.deepEqual(ask('pj:h', 'p:l'), { queryId: 'q', cells: 5 });
  assert.deepEqual(ask('pj:h', 'p:g'), { queryId: 'q', cells: 6 }, 'jusqu’au coin le plus proche du 3×3');
  assert.deepEqual(ask('p:l', 'p:g'), { queryId: 'q', cells: 4 }, 'case (5,4) du 3×3, pas son ancre (4,4) à 4,5');
  assert.deepEqual(ask('pj:h', 'p:c'), { queryId: 'q', cells: null }, 'autre étage');
  assert.deepEqual(ask('pj:h', 'p:r'), { queryId: 'q', cells: null }, 'en réserve');
  assert.deepEqual(ask('p:x1', 'p:x2'), { queryId: 'q', cells: gridFor(hexLevel).distance({ a: 0, b: 0 }, { a: 3, b: 0 }) });
  assert.equal(answerDistanceQuery(campaign, { fromRef: 'pj:h', toRef: 'p:o' }), null, 'sans queryId : pas de réponse');
});

test('canal : mj.distanceQuery reçoit map.distance avec son queryId', () => {
  store.loadCampaign(scene([pion('h', 'pj:h', 'pj', 0, 0), pion('o', 'p:o', 'ennemi', 3, 3)]));
  const { channel } = openLink();
  channel.deliver(msg('mj.distanceQuery', { fromRef: 'pj:h', toRef: 'p:o', queryId: 7 }));
  assert.deepEqual(sent('map.distance'), [{ queryId: 7, cells: 4.5 }]);
});

test('posé : pose depuis la réserve, changement d étage, retrait → map.placed / map.unplaced, rien de rejoué à vide', () => {
  store.loadCampaign(scene([pion('h', 'pj:h', 'pj', 0, 0)], [pion('o', 'p:o', 'ennemi', 0, 0)]));
  openLink();
  assert.deepEqual(sent('map.placed'), [], 'à l’ouverture, rien n’est annoncé');
  store.placeTokenFromReserve('o', 'rdc', { a: 5, b: 5 });
  assert.deepEqual(sent('map.placed'), [{ ref: 'p:o', levelId: 'rdc' }]);
  store.updateToken('h', { hp: { current: 3, max: 10 } });
  assert.equal(sent('map.placed').length, 1, 'une mutation sans pose ne réannonce rien');
  store.reserveToken('o');
  assert.deepEqual(sent('map.unplaced'), [{ ref: 'p:o', levelId: 'rdc' }]);
  store.removeToken('h');
  assert.deepEqual(sent('map.unplaced').at(-1), { ref: 'pj:h', levelId: 'rdc' });
});

test('posé : l’outil MJ (re)démarre → tout ce qui est posé lui est redit', () => {
  store.loadCampaign(scene([pion('h', 'pj:h', 'pj', 0, 0), pion('o', 'p:o', 'ennemi', 3, 3)]));
  const { channel } = openLink();
  channel.deliver(msg('mj.hello', {}));
  assert.deepEqual(sent('map.placed'), [{ ref: 'pj:h', levelId: 'rdc' }, { ref: 'p:o', levelId: 'rdc' }]);
  channel.deliver(msg('mj.ping', {}));
  assert.equal(sent('map.placed').length, 2, 'un battement ne réannonce rien');
});

test('adjacence : envoyée à chaque fin de déplacement d un pion lié, jamais sur une autre mutation', () => {
  store.loadCampaign(scene([pion('h', 'pj:h', 'pj', 2, 2), pion('o', 'p:o', 'ennemi', 6, 6)]));
  openLink();
  store.updateToken('o', { hp: { current: 1, max: 5 } });
  assert.deepEqual(sent('map.adjacency'), [], 'pas de déplacement');
  store.moveTokenToCell('o', { a: 3, b: 3 });
  assert.deepEqual(sent('map.adjacency'), [{ pairs: [['p:o', 'pj:h']] }]);
  store.moveTokenToCell('o', { a: 9, b: 9 });
  assert.deepEqual(sent('map.adjacency').at(-1), { pairs: [] }, 'désengagé : liste vide, la suggestion tombe');
});

test('engagements : mj.engagements retenus pour l’écran MJ, abonnés prévenus, paires mal formées écartées', () => {
  store.loadCampaign(scene([]));
  const { link, channel } = openLink();
  channel.deliver(msg('mj.ping', {})); // connecté : cette notification-là n’est pas celle des engagements
  let notified = 0;
  link.subscribe(() => notified++);
  channel.deliver(msg('mj.engagements', { pairs: [['pj:h', 'p:o'], ['pj:h'], ['x', 'x'], [1, 'p:o']] }));
  assert.deepEqual(link.engagements(), [['pj:h', 'p:o']]);
  assert.equal(notified, 1);
  assert.deepEqual(parseEngagements({}), []);
});

test('calque : un trait entre les centres des pions engagés du même étage, monture fusionnée comprise', () => {
  const grid = gridFor(level);
  const tokens = [
    pion('h', 'pj:h', 'pj', 2, 2),
    pion('o', 'p:o', 'ennemi', 3, 3, { sizeCells: 2 }),
    pion('c', 'p:c', 'ennemi', 3, 2, { levelId: 'cave' }),
    pion('rider', 'pj:r', 'pj', 7, 7, { rider: { ref: 'p:cheval', label: 'Cheval', imageUrl: null } }),
  ];
  const segments = engagementSegments(grid, level, /** @type {any} */ (tokens), [['pj:h', 'p:o'], ['pj:h', 'p:c'], ['p:cheval', 'p:o'], ['pj:h', 'p:inconnu']]);
  const centre = (/** @type {number} */ a, /** @type {number} */ b, size = 1) => {
    const box = grid.cellBounds({ cellX: a, cellY: b }, size);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  assert.deepEqual(segments, [
    { from: centre(2, 2), to: centre(3, 3, 2) },
    { from: centre(7, 7), to: centre(3, 3, 2) },
  ]);

  /** @type {string[]} */
  const calls = [];
  const ctx = /** @type {any} */ ({
    save() {}, restore() {}, beginPath() {}, stroke() { calls.push('stroke'); },
    moveTo(/** @type {number} */ x, /** @type {number} */ y) { calls.push(`M${x},${y}`); }, lineTo(/** @type {number} */ x, /** @type {number} */ y) { calls.push(`L${x},${y}`); },
  });
  new EngagementsLayer().render(ctx, grid, level, { tokens: /** @type {any} */ (tokens), pairs: [['pj:h', 'p:o']] });
  const c0 = centre(2, 2);
  const c1 = centre(3, 3, 2);
  assert.ok(calls.includes(`M${c0.x},${c0.y}`) && calls.includes(`L${c1.x},${c1.y}`));
  assert.ok(calls.includes('stroke'));
  calls.length = 0;
  new EngagementsLayer().render(ctx, grid, level, { tokens: /** @type {any} */ (tokens), pairs: [] });
  assert.deepEqual(calls, [], 'sans paire, rien');
});

test('posé : placedLinkedRefs ignore la réserve et les pions non liés', () => {
  const campaign = scene([pion('h', 'pj:h', 'pj', 0, 0), createToken({ id: 'libre', levelId: 'rdc', cell: { a: 1, b: 1 } })], [pion('o', 'p:o', 'ennemi', 0, 0)]);
  assert.deepEqual([...placedLinkedRefs(campaign)], [['pj:h', 'rdc']]);
});

test('écran MJ seul : player.js ne branche pas le calque des engagements', async () => {
  const { readFile } = await import('node:fs/promises');
  const player = await readFile(new URL('../js/app/player.js', import.meta.url), 'utf8');
  assert.equal(/engagements/i.test(player), false);
  const gm = await readFile(new URL('../js/app/gm.js', import.meta.url), 'utf8');
  assert.match(gm, /engagements: \(\) => \{/);
});
