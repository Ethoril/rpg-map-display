// @ts-check
// Effets de blessure et de mort (docs/CONTRAT-LIAISON-OUTIL-MJ.md §9, lot L4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import {
  FxLayer, woundIntensity, woundSprites, deathSprites, reduceSprites, spriteFrame, spriteDuration, shouldPlayFx, parseFx,
  FX_STAIN_FADE_MS, FX_REDUCED_MS, FX_DEATH_CAUSES,
} from '../js/render/layers/fx.js';
import { planMjMessage, executeMjOperations } from '../js/app/mjLink.js';

const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
const link = { source: /** @type {'outil-mj'} */ ('outil-mj'), ref: 'p:g1' };
/** @param {object} [patch] */
const token = (patch = {}) => ({ ...createToken({ id: 'g1', levelId: 'rdc', cell: { a: 3, b: 4 } }), link, ...patch });
/** @param {any[]} tokens */
const campaignOf = (tokens) => createCampaign({ levels: [level], tokens });
const msg = (/** @type {string} */ type, /** @type {any} */ payload) => ({ v: 1, type, seq: 1, at: 0, from: 'outil-mj', payload });

/** Grille factice : case de 100 px. */
const grid = /** @type {any} */ ({
  cellBounds: (/** @type {any} */ cp, /** @type {number} */ size) => ({ x: cp.cellX * 100, y: cp.cellY * 100, width: size * 100, height: size * 100 }),
});
/** Contexte qui note ce qui est dessiné. */
function recorder() {
  /** @type {{ blend: string, alpha: number, side: number }[]} */
  const draws = [];
  const state = { blend: 'source-over', alpha: 1 };
  const ctx = /** @type {any} */ ({
    save() {}, restore() {}, translate() {}, rotate() {},
    set globalCompositeOperation(v) { state.blend = v; }, get globalCompositeOperation() { return state.blend; },
    set globalAlpha(v) { state.alpha = v; }, get globalAlpha() { return state.alpha; },
    drawImage(/** @type {any} */ _i, /** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ w) { draws.push({ blend: state.blend, alpha: state.alpha, side: w }); },
  });
  return { ctx, draws };
}
const loaded = () => new FxLayer({ loadImage: () => /** @type {any} */ ({ complete: true, naturalWidth: 512 }), random: () => 0 });
const tokens = () => [token()];

test('intensité : petite gerbe sous ¼ du maximum, grosse à partir de ¼', () => {
  assert.equal(woundIntensity(2, 10), 'light');
  assert.equal(woundIntensity(2.4, 10), 'light');
  assert.equal(woundIntensity(3, 10), 'heavy');
  assert.equal(woundIntensity(9, 10), 'heavy');
  assert.equal(woundIntensity(5, 0), 'light', 'maximum inconnu : jamais une grosse gerbe par défaut');
});

test('rendu : la grosse gerbe est dessinée plus grande que la petite, en multiply', () => {
  const sides = [];
  for (const [lost, max] of [[2, 10], [6, 10]]) {
    const layer = loaded();
    layer.play({ kind: 'wound', hpLost: lost, maxHp: max }, { tokenId: 'g1', now: 0 });
    const { ctx, draws } = recorder();
    layer.render(ctx, grid, level, { tokens: tokens(), now: 450 });
    assert.equal(draws.length, 1);
    assert.equal(draws[0].blend, 'multiply');
    sides.push(draws[0].side);
  }
  assert.ok(sides[1] > sides[0] * 1.5, `grosse ${sides[1]} vs petite ${sides[0]}`);
});

test('blessure : la gerbe devient une tache au sol qui s’estompe en 1 à 2 minutes puis disparaît', () => {
  const layer = loaded();
  layer.play({ kind: 'wound', hpLost: 1, maxHp: 10 }, { tokenId: 'g1', now: 0 });
  const alphaAt = (/** @type {number} */ now) => {
    const { ctx, draws } = recorder();
    layer.render(ctx, grid, level, { tokens: tokens(), now });
    return draws[0]?.alpha;
  };
  const a1 = alphaAt(1000), a2 = alphaAt(60_000);
  assert.ok(a1 > a2 && a2 > 0, 'la tache s’estompe sans disparaître à 1 min');
  assert.ok(FX_STAIN_FADE_MS >= 60_000 && FX_STAIN_FADE_MS <= 120_000);
  assert.equal(alphaAt(FX_STAIN_FADE_MS + 1000), undefined);
  assert.equal(layer.active.length, 0, 'effet oublié : rien n’est conservé');
});

test('chaque cause de mort a sa propre animation ; la magie se pose en screen', () => {
  const signatures = new Set();
  for (const cause of FX_DEATH_CAUSES) {
    const sprites = deathSprites(cause);
    assert.ok(sprites.length >= 1);
    signatures.add(JSON.stringify(sprites));
    const layer = loaded();
    layer.play({ kind: 'death', cause }, { tokenId: 'g1', now: 0 });
    const { ctx, draws } = recorder();
    layer.render(ctx, grid, level, { tokens: tokens(), now: 1000 });
    assert.ok(draws.length >= 1, cause);
    assert.equal(draws[0].blend, cause === 'magic' ? 'screen' : 'multiply', cause);
  }
  assert.equal(signatures.size, FX_DEATH_CAUSES.length);
});

test('cause inconnue ou absente : blood ; blessure malformée refusée', () => {
  assert.deepEqual(parseFx('death', { cause: 'chute' }), { kind: 'death', cause: 'blood' });
  assert.deepEqual(parseFx('death', {}), { kind: 'death', cause: 'blood' });
  assert.equal(parseFx('wound', { hpLost: 0, maxHp: 10 }), null);
  assert.equal(parseFx('wound', { hpLost: 'x', maxHp: 10 }), null);
});

test('un effet n’est dessiné que sur l’étage du pion', () => {
  const layer = loaded();
  layer.play({ kind: 'death', cause: 'fire' }, { tokenId: 'g1', now: 0 });
  const { ctx, draws } = recorder();
  layer.render(ctx, grid, createLevel({ id: 'etage', widthCells: 5, heightCells: 5 }), { tokens: tokens(), now: 500 });
  assert.equal(draws.length, 0);
});

test('pion caché : aucun effet sur la tablette, l’écran MJ le joue', () => {
  assert.equal(shouldPlayFx({ hidden: true }, true), false);
  assert.equal(shouldPlayFx({ hidden: true }, false), true);
  assert.equal(shouldPlayFx({ hidden: false }, true), true);
  assert.equal(shouldPlayFx(null, true), false);
});

test('liaison : l’effet est joué sur la carte MJ et republié vers la tablette, sauf pion caché', () => {
  for (const hidden of [false, true]) {
    const campaign = campaignOf([token({ hidden })]);
    const ops = planMjMessage(campaign, msg('fx.wound', { ref: 'p:g1', hpLost: 4, maxHp: 10, target: 'self' }));
    assert.equal(ops.length, 1);
    /** @type {any[]} */ const played = [];
    /** @type {any[]} */ const published = [];
    executeMjOperations(ops, /** @type {any} */ ({
      store: { getCampaign: () => campaign },
      publish: (/** @type {string} */ t, /** @type {any} */ p) => published.push([t, p]),
      playFx: (/** @type {any} */ fx, /** @type {string} */ id) => played.push([fx, id]),
    }));
    assert.equal(played.length, 1, 'jouée sur l’écran MJ, caché ou non');
    assert.equal(published.length, hidden ? 0 : 1);
    if (!hidden) assert.deepEqual(published[0], ['fx', { tokenId: 'g1', kind: 'wound', hpLost: 4, maxHp: 10 }]);
  }
});

test('liaison : ref inconnu, message malformé ou autre émetteur ne produisent rien, et rien n’est persisté', () => {
  const campaign = campaignOf([token()]);
  assert.deepEqual(planMjMessage(campaign, msg('fx.death', { ref: 'p:inconnu', cause: 'fire' })), []);
  assert.deepEqual(planMjMessage(campaign, msg('fx.wound', { ref: 'p:g1', hpLost: -2, maxHp: 10 })), []);
  assert.deepEqual(planMjMessage(campaign, { ...msg('fx.death', { ref: 'p:g1', cause: 'fire' }), from: 'map' }), []);
  const ops = planMjMessage(campaign, msg('fx.death', { ref: 'p:g1', cause: 'poison' }));
  /** @type {string[]} */ const calls = [];
  const store = new Proxy({ getCampaign: () => campaign }, { get: (t, k) => (k === 'getCampaign' ? t.getCampaign : () => calls.push(String(k))) });
  executeMjOperations(ops, /** @type {any} */ ({ store, publish: () => {} }));
  assert.deepEqual(calls, [], 'aucune écriture dans le store');
});

test('mouvement réduit : une seule image, sans zoom ni rotation, fondu bref, pas de tache persistante', () => {
  const reduced = reduceSprites(woundSprites('heavy'));
  assert.equal(reduced.length, 1);
  assert.ok(spriteDuration(reduced[0]) <= FX_REDUCED_MS);
  assert.equal(reduced[0].scaleFrom, 1);
  assert.equal(reduceSprites(deathSprites('dismemberment')).length, 1);

  const layer = loaded();
  layer.play({ kind: 'wound', hpLost: 9, maxHp: 10 }, { tokenId: 'g1', now: 0, reducedMotion: true });
  const sides = new Set();
  for (const now of [10, 150, 300]) {
    const { ctx, draws } = recorder();
    layer.render(ctx, grid, level, { tokens: tokens(), now });
    for (const d of draws) sides.add(d.side);
  }
  assert.equal(sides.size, 1, 'taille constante : pas de zoom');
  const { ctx, draws } = recorder();
  layer.render(ctx, grid, level, { tokens: tokens(), now: FX_REDUCED_MS + 50 });
  assert.equal(draws.length, 0, 'plus de tache après le fondu');
});

test('spriteFrame : avant le délai et après la fin, rien', () => {
  const [s] = woundSprites('light');
  assert.equal(spriteFrame(s, -1), null);
  assert.equal(spriteFrame(s, spriteDuration(s)), null);
  assert.ok(spriteFrame(s, 10));
});
