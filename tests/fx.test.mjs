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
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { FOG_MASK_PX_PER_CELL } from '../js/core/constants.js';

const level = createLevel({ id: 'rdc', widthCells: 12, heightCells: 12 });
const link = { source: /** @type {'outil-mj'} */ ('outil-mj'), ref: 'p:g1' };
/** @param {object} [patch] */
const token = (patch = {}) => ({ ...createToken({ id: 'g1', levelId: 'rdc', cell: { a: 3, b: 4 } }), link, ...patch });
/** @param {any[]} tokens */
const campaignOf = (tokens) => createCampaign({ levels: [level], tokens });
const msg = (/** @type {string} */ type, /** @type {any} */ payload) => ({ v: 3, type, seq: 1, at: 0, from: 'outil-mj', payload });

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

test('feu : brûlure au sol en multiply puis flammes en screen qui vacillent', () => {
  const [burn, ...flames] = deathSprites('fire');
  assert.equal(burn.blend, 'multiply');
  assert.ok(flames.length >= 2 && flames.every((f) => f.blend === 'screen' && f.file.startsWith('flammes')));
  const flame = flames[0];
  const alphas = new Set();
  for (let age = 700; age < 1100; age += 40) alphas.add(spriteFrame(flame, age)?.alpha.toFixed(3));
  assert.ok(alphas.size > 4, 'l’opacité varie dans le temps (vacillement)');
  // Opacité rapportée au pic : identique si les deux nappes vacillaient en phase.
  const ratio = (/** @type {import('../js/render/layers/fx.js').FxSprite} */ f, /** @type {number} */ age) => (spriteFrame(f, age)?.alpha ?? 0) / f.peak;
  const decale = [800, 840, 880, 920, 960].some((age) => Math.abs(ratio(flames[0], age) - ratio(flames[1], age)) > 0.05);
  assert.ok(decale, 'les deux nappes vacillent en opposition de phase');
  const layer = loaded();
  layer.play({ kind: 'death', cause: 'fire' }, { tokenId: 'g1', now: 0 });
  const { ctx, draws } = recorder();
  layer.render(ctx, grid, level, { tokens: tokens(), now: 1000 });
  assert.deepEqual(draws.map((d) => d.blend), ['multiply', 'screen', 'screen']);
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

// ── H-6 et H-4 : où un effet se dessine, et s'il a le droit de se dessiner ──────────────────
//
// Deux défauts relevés par l'audit du 26/11/2026, tous deux dans `FxLayer.render`.

/** Deux étages au pas DIFFÉRENT : c'est ce qui rend H-6 visible. */
const etageA = createLevel({ id: 'etage-a', widthCells: 12, heightCells: 12, pxPerCell: 100 });
const etageB = createLevel({ id: 'etage-b', widthCells: 12, heightCells: 12, pxPerCell: 140 });
const grilleA = new SquareGrid(etageA);
const grilleB = new SquareGrid(etageB);

/** Contexte qui note AUSSI où chaque image est posée : c'est tout l'objet de H-6. */
function recorderPositionne() {
  /** @type {{ x: number, y: number, side: number, alpha: number }[]} */
  const draws = [];
  const state = { blend: 'source-over', alpha: 1, x: 0, y: 0 };
  const ctx = /** @type {any} */ ({
    save() {}, restore() {}, rotate() {},
    translate(/** @type {number} */ x, /** @type {number} */ y) { state.x = x; state.y = y; },
    set globalCompositeOperation(v) { state.blend = v; }, get globalCompositeOperation() { return state.blend; },
    set globalAlpha(v) { state.alpha = v; }, get globalAlpha() { return state.alpha; },
    drawImage(/** @type {any} */ _i, /** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ w) {
      draws.push({ x: state.x, y: state.y, side: w, alpha: state.alpha });
    },
  });
  return { ctx, draws };
}

/** Un masque de vision : les cases de `visibles` éclairées, le reste noir. */
function masque(/** @type {{a: number, b: number}[]} */ visibles, /** @type {any} */ niveau) {
  const w = niveau.widthCells * FOG_MASK_PX_PER_CELL;
  const h = niveau.heightCells * FOG_MASK_PX_PER_CELL;
  const alpha = new Uint8Array(w * h);
  for (const { a, b } of visibles) {
    for (let y = b * FOG_MASK_PX_PER_CELL; y < (b + 1) * FOG_MASK_PX_PER_CELL; y++) {
      for (let x = a * FOG_MASK_PX_PER_CELL; x < (a + 1) * FOG_MASK_PX_PER_CELL; x++) alpha[y * w + x] = 255;
    }
  }
  return /** @type {any} */ ({ width: w, height: h, maskAlpha: alpha, getContext: () => null });
}

test('H-6 — l’ancre d’un effet se calcule avec la grille de SON étage, jamais celle de l’écran', () => {
  // Défaut : l'ancre était calculée au PREMIER rendu avec la grille de l'étage AFFICHÉ, puis figée.
  // Reçue pendant que A (100 px/case) est à l'écran, une blessure sur la case (2,2) de B
  // (140 px/case) s'ancrait en (250, 250) — le centre de (2,2) chez A — et se dessinait là après
  // bascule sur B, au lieu de (350, 350).
  const layer = loaded();
  const pionSurB = token({ id: 'g1', levelId: 'etage-b', cell: { a: 2, b: 2 } });
  layer.play({ kind: 'wound', hpLost: 5, maxHp: 20 }, { tokenId: 'g1', now: 0, reducedMotion: false });

  // 1. Première image rendue pendant que l'étage A est à l'écran : rien ne se dessine chez A…
  const chezA = recorderPositionne();
  layer.render(chezA.ctx, grilleA, etageA, { tokens: [pionSurB], now: 10 });
  assert.deepEqual(chezA.draws, [], 'un effet d’un autre étage ne se dessine pas sur l’étage affiché');

  // 2. …et quand on bascule sur B, il se dessine au centre de (2,2) CHEZ B.
  const chezB = recorderPositionne();
  layer.render(chezB.ctx, grilleB, etageB, { tokens: [pionSurB], now: 20 });
  assert.ok(chezB.draws.length > 0, 'l’effet doit se dessiner sur l’étage du pion');
  const bornes = grilleB.cellBounds({ cellX: 2, cellY: 2 }, 1);
  const centre = { x: bornes.x + bornes.width / 2, y: bornes.y + bornes.height / 2 };
  assert.deepEqual(centre, { x: 350, y: 350 }, 'fixture : le centre de (2,2) chez B vaut (350, 350)');
  for (const d of chezB.draws) {
    assert.deepEqual(
      { x: d.x, y: d.y }, centre,
      `effet dessiné en (${d.x}, ${d.y}) au lieu de (${centre.x}, ${centre.y}) — ancre calculée avec la mauvaise grille`
    );
  }

  // 3. Et son unité suit le pas de B, pas celui de A : 140/100 = 1,4 fois plus grande.
  const layerA = loaded();
  const pionSurA = token({ id: 'g1', levelId: 'etage-a', cell: { a: 2, b: 2 } });
  layerA.play({ kind: 'wound', hpLost: 5, maxHp: 20 }, { tokenId: 'g1', now: 0, reducedMotion: false });
  const refA = recorderPositionne();
  layerA.render(refA.ctx, grilleA, etageA, { tokens: [pionSurA], now: 20 });
  assert.ok(
    Math.abs(chezB.draws[0].side / refA.draws[0].side - 1.4) < 0.001,
    `l’unité de l’effet doit suivre le pas de son étage : ${chezB.draws[0].side} contre ${refA.draws[0].side}`
  );
});

test('H-4 — un effet ne se dessine que sur une case ACTUELLEMENT visible, et le test est refait à chaque image', () => {
  // Défaut : `shouldPlayFx` ne regardait que le drapeau `hidden` posé à la main par le MJ, jamais
  // la visibilité RÉELLE. Dans une pièce explorée mais sans vision courante, la couche des pions
  // masque bien le PNJ ; l'effet, lui, se dessinait à sa position.
  //
  // ⭐ Arbitrage B du 26/11/2026 : l'effet ET sa tache ne sont dessinés que sur les cases
  // actuellement visibles, le test étant refait À CHAQUE IMAGE et non une fois à la réception.
  const layer = loaded();
  const pion = token({ id: 'g1', levelId: 'etage-b', cell: { a: 2, b: 2 } });
  layer.play({ kind: 'wound', hpLost: 5, maxHp: 20 }, { tokenId: 'g1', now: 0, reducedMotion: false });

  /** @param {{a: number, b: number}[]} visibles @param {number} now */
  const rendreJoueurs = (visibles, now) => {
    const r = recorderPositionne();
    layer.render(r.ctx, grilleB, etageB, {
      tokens: [pion], now,
      role: 'players',
      visibleCanvas: masque(visibles, etageB),
      activeLevelWidthCells: etageB.widthCells,
      activeLevelHeightCells: etageB.heightCells,
      visionPublished: true,
    });
    return r.draws;
  };

  // 1. Case hors vision : rien, alors que le pion n'est pas `hidden`.
  assert.deepEqual(rendreJoueurs([{ a: 9, b: 9 }], 10), [], 'effet dessiné sur une case hors vision');

  // 2. Les joueurs éclairent la pièce : l'effet apparaît — le test est donc refait, et non figé.
  assert.ok(rendreJoueurs([{ a: 2, b: 2 }], 20).length > 0, 'effet absent alors que la case est vue');

  // 3. Et il redisparaît si la vision se referme : à chaque image, dans les deux sens.
  assert.deepEqual(rendreJoueurs([{ a: 9, b: 9 }], 30), [], 'effet maintenu après la perte de vision');

  // 4. ⭐ La TACHE persiste 90 s : entrer dans une salle où il y a du sang est une information de
  //    jeu, pas une fuite. Elle obéit donc à la même règle, tard dans son fondu.
  const tardif = Math.floor(FX_STAIN_FADE_MS * 0.5);
  assert.deepEqual(rendreJoueurs([{ a: 9, b: 9 }], tardif), [], 'tache dessinée hors vision');
  assert.ok(rendreJoueurs([{ a: 2, b: 2 }], tardif).length > 0, 'tache absente alors que la case est vue');
});

test('H-4 — l’écran MJ voit toujours tout : aucun masque passé, aucun filtre appliqué', () => {
  // ⛔ Anti-triche : filtrer sans distinguer le rôle aveuglerait le MJ, à qui le contrat §9 donne
  // l'effet dans tous les cas. Un appelant qui ne passe pas de masque garde l'ancien comportement.
  const layer = loaded();
  const pion = token({ id: 'g1', levelId: 'etage-b', cell: { a: 2, b: 2 } });
  layer.play({ kind: 'death', cause: 'fire' }, { tokenId: 'g1', now: 0, reducedMotion: false });
  const r = recorderPositionne();
  layer.render(r.ctx, grilleB, etageB, { tokens: [pion], now: 10 });
  assert.ok(r.draws.length > 0, 'l’écran MJ doit jouer l’effet sans masque de vision');
});

test('H-4 — le filtre raisonne sur une EMPRISE, pas sur une case unique', () => {
  // ⚠ Contrainte écrite au second addendum du 27/11/2026 : l'arbitrage sur les projectiles porte
  // sur un trajet à DEUX extrémités, et un trait dont l'arrivée tombe en clair donnerait la
  // direction d'un ennemi non vu — une fuite, pas un acte explicite comme le ping. Construire le
  // garde à une seule case obligerait à le rouvrir. Le mécanisme est donc éprouvé ici sur un pion
  // GRAND, dont l'emprise couvre quatre cases, avec la règle des pions : vu dès qu'UNE case l'est.
  const layer = loaded();
  const grand = token({ id: 'g1', levelId: 'etage-b', cell: { a: 2, b: 2 }, sizeCells: 2 });
  layer.play({ kind: 'wound', hpLost: 5, maxHp: 20 }, { tokenId: 'g1', now: 0, reducedMotion: false });
  /** @param {{a: number, b: number}[]} visibles */
  const rendre = (visibles) => {
    const r = recorderPositionne();
    layer.render(r.ctx, grilleB, etageB, {
      tokens: [grand], now: 10, role: 'players',
      visibleCanvas: masque(visibles, etageB),
      activeLevelWidthCells: etageB.widthCells,
      activeLevelHeightCells: etageB.heightCells,
      visionPublished: true,
    });
    return r.draws;
  };
  assert.ok(rendre([{ a: 3, b: 3 }]).length > 0, 'une seule case de l’emprise vue doit suffire');
  assert.deepEqual(rendre([{ a: 9, b: 9 }]), [], 'aucune case de l’emprise vue : rien');
});
