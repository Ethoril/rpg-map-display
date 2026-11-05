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

test('store : setTokenLink lie et délie un pion posé ; un même ref ne lie qu’un pion', async () => {
  const store = await import('../js/state/store.js');
  const { applyNetworkEvent } = await import('../js/app/networkEvents.js');
  const a = createToken({ id: 'a', levelId: 'rdc', cell: { a: 1, b: 1 }, kind: 'pc' });
  const b = createToken({ id: 'b', levelId: 'rdc', cell: { a: 3, b: 3 }, kind: 'pc' });
  store.loadCampaign(createCampaign({ levels: [level], tokens: [a, b] }));
  store.setTokenLink('a', 'pj:c9');
  assert.deepEqual(store.getCampaign()?.tokens.find((t) => t.id === 'a')?.link, { source: 'outil-mj', ref: 'pj:c9' });
  assert.throws(() => store.setTokenLink('b', 'pj:c9'), /déjà lié/);
  store.setTokenLink('a', null);
  assert.equal(store.getCampaign()?.tokens.find((t) => t.id === 'a')?.link, undefined);
  store.setTokenLink('b', 'pj:c9');
  assert.equal(store.getCampaign()?.tokens.find((t) => t.id === 'b')?.link?.ref, 'pj:c9');
  // Réseau : état absolu ; sans ref, le pion est délié ; un rejeu ne mute rien.
  /** @param {any} payload */
  const ev = (payload) => applyNetworkEvent({ type: 'token.link', payload, at: 0, by: 'gm' });
  assert.equal(ev({ tokenId: 'b' }), true);
  assert.equal(store.getCampaign()?.tokens.find((t) => t.id === 'b')?.link, undefined);
  assert.equal(ev({ tokenId: 'a', ref: 'pj:c9' }), true);
  assert.equal(ev({ tokenId: 'a', ref: 'pj:c9' }), false, 'rejeu sans mutation');
  assert.equal(ev({ tokenId: 'a', ref: 7 }), false, 'payload malformé');
});

/** Faux BroadcastChannel : garde les messages émis, l'outil MJ « parle » par `deliver`. */
class FakeChannel {
  /** @type {any[]} */ static sent = [];
  /** @type {FakeChannel|null} */ static last = null;
  /** @type {((event: { data: any }) => void)|null} */ onmessage = null;
  constructor() { FakeChannel.last = this; }
  /** @param {any} message */ postMessage(message) { FakeChannel.sent.push(message); }
  close() {}
  /** @param {any} message */ deliver(message) { this.onmessage?.({ data: message }); }
}

/**
 * @param {{ campaign: () => any }} options
 */
const openLink = async ({ campaign }) => {
  const { startMjLink } = await import('../js/app/mjLink.js');
  FakeChannel.sent = [];
  /** @type {[string, string|null][]} */ const links = [];
  /** @type {[string, any][]} */ const published = [];
  let clock = 1000;
  const link = startMjLink({
    store: /** @type {any} */ ({ getCampaign: campaign, setTokenLink: (/** @type {string} */ id, /** @type {string|null} */ ref) => links.push([id, ref]) }),
    publish: (/** @type {string} */ type, /** @type {any} */ payload) => published.push([type, payload]),
    createToken,
    activeLevelId: () => null,
    sessionId: 's1',
    Channel: /** @type {any} */ (FakeChannel),
    now: () => clock,
  });
  assert.ok(link);
  const channel = /** @type {FakeChannel} */ (FakeChannel.last);
  /** @param {string} type */
  const count = (type) => FakeChannel.sent.filter((m) => m.type === type).length;
  return { link, channel, count, links, published, advance: (/** @type {number} */ ms) => { clock += ms; } };
};

test('mjLink : écho du battement — un onglet caché répond au ping de l’outil MJ, sans boucle', async () => {
  const { link, channel, count, advance } = await openLink({ campaign: () => null });
  link.tick();
  assert.equal(count('map.ping'), 1);
  advance(1000);
  channel.deliver(msg('mj.ping', {}));
  assert.equal(count('map.ping'), 1, 'battu il y a 1 s : pas d’écho');
  advance(60_000); // minuteries ralenties : aucun tick pendant une minute
  channel.deliver(msg('mj.ping', {}));
  assert.equal(count('map.ping'), 2, 'écho au battement reçu');
  channel.deliver(msg('mj.ping', {}));
  assert.equal(count('map.ping'), 2, 'pas d’écho de l’écho');
});

test('mjLink : message reçu sans campagne → map.hello réémis dès qu’une campagne est chargée', async () => {
  /** @type {any} */
  let campaign = null;
  const { link, channel, count } = await openLink({ campaign: () => campaign });
  assert.equal(count('map.hello'), 1, 'hello d’ouverture');
  channel.deliver(msg('mj.snapshot', { tokens: [] }));
  link.tick();
  assert.equal(count('map.hello'), 1, 'toujours sans campagne : rien');
  campaign = createCampaign({ levels: [level], tokens: [] });
  link.tick();
  assert.equal(count('map.hello'), 2, 'campagne chargée : état redemandé');
  link.tick();
  assert.equal(count('map.hello'), 2, 'une seule fois');
});

test('mjLink : un simple battement sans campagne ne redemande pas l’état', async () => {
  /** @type {any} */
  let campaign = null;
  const { link, channel, count } = await openLink({ campaign: () => campaign });
  channel.deliver(msg('mj.ping', {}));
  campaign = createCampaign({ levels: [level], tokens: [] });
  link.tick();
  assert.equal(count('map.hello'), 1);
});

test('rendu « mort » (contrat §7) : portrait désaturé et croix sur un pion lié mort, rien sur un vivant', async () => {
  const { TokensLayer } = await import('../js/render/layers/tokens.js');
  const { SquareGrid } = await import('../js/grid/SquareGrid.js');
  /** Ctx enregistreur : fusions utilisées pour peindre, segments tracés. */
  const recorder = () => {
    /** @type {string[]} */ const fills = [];
    let segments = 0;
    const ctx = /** @type {any} */ ({
      save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, ellipse() {}, clip() {},
      fill() {}, stroke() {}, strokeRect() {}, drawImage() {}, fillText() {}, measureText: () => ({ width: 10 }),
      moveTo() {}, lineTo() { segments += 1; },
      fillRect() { fills.push(ctx.globalCompositeOperation); },
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
      font: '', textAlign: 'center', textBaseline: 'middle',
    });
    return { ctx, fills, segments: () => segments };
  };
  const grid = new SquareGrid(createLevel({ id: 'rdc', pxPerCell: 100, widthCells: 6, heightCells: 6 }));
  const draw = (/** @type {object} */ patch) => {
    const rec = recorder();
    new TokensLayer().render(rec.ctx, grid, [linked(patch)], null, { activeLevelId: 'rdc' });
    return rec;
  };
  const dead = draw({ dead: true, deathCause: 'poison' });
  assert.ok(dead.fills.includes('saturation'), 'portrait désaturé');
  assert.equal(dead.ctx.globalCompositeOperation, 'source-over', 'fusion rendue au dessin suivant');
  const alive = draw({ dead: false });
  assert.ok(!alive.fills.includes('saturation'));
  assert.equal(dead.segments() - alive.segments(), 2, 'deux branches de croix');
});

test('badge d’état : niveau affiché dès 2 pour un état cumulable, rien à 1', async () => {
  const { drawStatusBadges } = await import('../js/render/statusBadges.js');
  /** @param {any} token */
  const texts = (token) => {
    /** @type {string[]} */ const out = [];
    const ctx = /** @type {any} */ ({
      save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, drawImage() {},
      fillText(/** @type {string} */ text) { out.push(text); },
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'center', textBaseline: 'middle',
    });
    drawStatusBadges(ctx, token, { x: 0, y: 0 }, { widthMap: 140, zoom: 1, iconCache: /** @type {any} */ ({ getRasterCanvas: () => null }) });
    return out;
  };
  assert.deepEqual(texts(linked({ markers: ['stunned', 'bleeding'], markerLevels: { stunned: 3, bleeding: 1 } })), ['3']);
  assert.deepEqual(texts(linked({ markers: ['stunned'] })), [], 'pion sans niveaux : aucun chiffre');
});

test('mjLink : liste des PJ reçue (mj.roster), liaison durable d’un pion puis état redemandé', async () => {
  const { link, channel, count, links, published } = await openLink({ campaign: () => null });
  assert.deepEqual(link.roster(), []);
  channel.deliver(msg('mj.roster', { characters: [{ ref: 'pj:c9', label: 'Ulrika' }, { ref: 'p:g1', label: 'Gobelin' }, { label: 'sans ref' }] }));
  assert.deepEqual(link.roster(), [{ ref: 'pj:c9', label: 'Ulrika' }], 'seuls les PJ bien formés');
  const hellos = count('map.hello');
  link.bind('t1', 'pj:c9');
  assert.deepEqual(links, [['t1', 'pj:c9']]);
  assert.deepEqual(published, [['token.link', { tokenId: 't1', ref: 'pj:c9' }]], 'la tablette apprend la liaison');
  assert.equal(count('map.hello'), hellos + 1, 'état du PJ redemandé à l’outil MJ');
  link.bind('t1', null);
  assert.deepEqual(published.at(-1), ['token.link', { tokenId: 't1' }], 'déliaison : sans ref');
});

test('marqueurs Exténué et Souillé (contrat §5, Q7 rouverte) : acceptés par la validation, libellés et icône présents', async () => {
  const { STATUS_MARKER_LABEL_FR, STATUS_MARKER_CATEGORY, STATUS_MARKER_IDS } = await import('../js/core/constants.js');
  const { existsSync } = await import('node:fs');
  assert.deepEqual(errorsOf(linked({ markers: ['fatigued', 'tainted'], markerLevels: { fatigued: 2 } })), []);
  assert.equal(STATUS_MARKER_LABEL_FR.fatigued, 'Exténué');
  assert.equal(STATUS_MARKER_LABEL_FR.tainted, 'Souillé');
  for (const id of STATUS_MARKER_IDS) {
    assert.ok(STATUS_MARKER_CATEGORY[id], `catégorie de ${id}`);
    assert.ok(existsSync(new URL(`../assets/icons/status/${id}.svg`, import.meta.url)), `icône de ${id}`);
  }
});

test('L1b : statut et PJ en attente exposés à l’indicateur, abonnés prévenus à chaque changement', async () => {
  let campaign = createCampaign({ levels: [level], tokens: [] });
  const { link, channel, advance } = await openLink({ campaign: () => campaign });
  assert.deepEqual(link.status(), { status: 'disconnected', awaiting: [] });
  let calls = 0;
  const off = link.subscribe(() => { calls += 1; });
  channel.deliver(msg('mj.ping', {}));
  assert.equal(link.status().status, 'connected');
  assert.equal(calls, 1);
  channel.deliver(msg('token.state', { ref: 'pj:c1', label: 'Gunnar', camp: 'pj', kind: 'pc', markers: [], markerLevels: {} }));
  assert.deepEqual(link.status().awaiting, [{ ref: 'pj:c1', label: 'Gunnar' }]);
  assert.equal(calls, 2, 'nouvelle attente : abonné prévenu');
  channel.deliver(msg('token.state', { ref: 'pj:c1', label: 'Gunnar', camp: 'pj', kind: 'pc', markers: [], markerLevels: {} }));
  assert.equal(calls, 2, 'même attente : rien de plus');
  link.bind('t1', 'pj:c1');
  assert.deepEqual(link.status().awaiting, []);
  assert.equal(calls, 3, 'liaison faite : abonné prévenu');
  advance(20_000);
  link.tick();
  assert.equal(link.status().status, 'disconnected');
  assert.equal(calls, 4);
  channel.deliver({ ...msg('mj.ping', {}), v: 99 });
  assert.equal(link.status().status, 'version-mismatch');
  off();
  channel.deliver(msg('mj.ping', {}));
  assert.equal(calls, 5, 'désabonné : plus prévenu');
});

test('L2 : pion sans image — disque à la couleur du camp, initiales du nom ; sans camp, rendu d’avant', async () => {
  const { TokensLayer, CAMP_FILL, campInitials } = await import('../js/render/layers/tokens.js');
  const { SquareGrid } = await import('../js/grid/SquareGrid.js');
  const { TOKEN_BORDER_PALETTE } = await import('../js/core/constants.js');
  const grid = new SquareGrid(createLevel({ id: 'rdc', pxPerCell: 100, widthCells: 6, heightCells: 6 }));
  const draw = (/** @type {object} */ patch) => {
    /** @type {string[]} */ const fills = [];
    /** @type {string[]} */ const texts = [];
    const ctx = /** @type {any} */ ({
      save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, ellipse() {}, clip() {},
      fill() {}, stroke() {}, strokeRect() {}, drawImage() {}, measureText: () => ({ width: 10 }), moveTo() {}, lineTo() {},
      fillText(/** @type {string} */ t) { texts.push(t); },
      fillRect() { fills.push(ctx.fillStyle); },
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
      font: '', textAlign: 'center', textBaseline: 'middle',
    });
    new TokensLayer().render(ctx, grid, [linked({ imageUrl: undefined, ...patch })], null, { activeLevelId: 'rdc' });
    return { fills, texts };
  };
  const palette = new Set(TOKEN_BORDER_PALETTE.map((e) => e.color));
  /** @type {Record<string, string>} */ const expected = { pj: '#34507f', allie: '#3f6e4a', ennemi: '#a8402f', neutre: '#6b7178' };
  for (const camp of ['pj', 'allie', 'ennemi', 'neutre']) {
    const { fills, texts } = draw({ camp, label: 'Gobelin Noir' });
    assert.equal(fills[0], expected[camp], camp);
    assert.ok(palette.has(CAMP_FILL[camp]), `${camp} : teinte de la palette de bordures`);
    assert.deepEqual(texts, ['GN']);
  }
  assert.deepEqual(draw({ camp: 'ennemi', label: 'Gobelin' }).texts, ['G'], 'un mot : une lettre');
  assert.deepEqual(draw({ camp: 'ennemi', label: 'Gobelin des Marais' }).texts, ['GD'], 'trois mots : deux lettres');
  const sansCamp = draw({ camp: undefined, label: 'Gobelin Noir' });
  assert.equal(sansCamp.fills[0], '#555d68', 'sans camp : gris d’avant');
  assert.deepEqual(sansCamp.texts, ['G'], 'sans camp : lettre unique d’avant');
  assert.equal(campInitials('   '), '?');
  // Initiales blanches lisibles : contraste WCAG ≥ 4,5 sur chaque teinte.
  const lum = (/** @type {string} */ h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [camp, color] of Object.entries(CAMP_FILL)) assert.ok(1.05 / (lum(color) + 0.05) >= 4.5, `contraste ${camp}`);
});
