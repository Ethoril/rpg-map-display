// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PingsLayer,
  PING_MAX_RADIUS_SCREEN_PX,
  PING_DOT_RADIUS_SCREEN_PX,
  PING_RING_WIDTH_SCREEN_PX,
  PING_WAVE_COUNT,
} from '../js/render/layers/pings.js';
import { PING_DURATION_MS } from '../js/core/constants.js';

/**
 * Ping — le marqueur « regarde ici » du CdC §5.5.
 *
 * ⭐ **Le test qui porte tout le chantier est celui du décalage d'horloge.** Le réflexe naturel
 * était de copier l'animation des pions, qui dérive de `move.startedAt` + `now` ; appliqué au ping
 * ce serait un défaut, parce que `startedAt` est estampillé avec l'horloge de l'émetteur et que la
 * tablette de ce projet a été mesurée **5,3 s en avance**. Un ping de 2 s jugé sur cet écart serait
 * expiré avant d'être dessiné : il n'apparaîtrait **jamais** sur le poste des joueurs, le seul pour
 * qui le geste existe. Ce fichier vérifie l'inverse — que la couche ne sait rien de l'horloge de
 * l'émetteur, et qu'elle ne peut donc pas en dépendre.
 */

/** Contexte 2D enregistreur : on juge la séquence émise et l'état, pas des pixels. @returns {any} */
function recordingCtx() {
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const stack = [];
  const ctx = {
    calls,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    lineCap: '',
    save() {
      stack.push({ globalAlpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, lineCap: ctx.lineCap, strokeStyle: ctx.strokeStyle, fillStyle: ctx.fillStyle });
      calls.push(['save']);
    },
    restore() {
      const s = stack.pop();
      assert.ok(s, 'restore() sans save() correspondant');
      Object.assign(ctx, s);
      calls.push(['restore']);
    },
    get depth() { return stack.length; },
    beginPath() { calls.push(['beginPath']); },
    /** @param {number} x @param {number} y @param {number} r */
    arc(x, y, r) { calls.push(['arc', x, y, r, ctx.globalAlpha]); },
    stroke() { calls.push(['stroke', ctx.lineWidth, ctx.strokeStyle]); },
    fill() { calls.push(['fill', ctx.fillStyle, ctx.globalAlpha]); },
  };
  return ctx;
}

const grid = /** @type {any} */ ({
  mapFromCellPoint: (/** @type {{cellX: number, cellY: number}} */ { cellX, cellY }) => ({ x: cellX * 140, y: cellY * 140 }),
});

const niveau = (/** @type {string} */ id = 'n1') => /** @type {any} */ ({ id, widthCells: 10, heightCells: 10 });

/** @param {number} at @param {string} [levelId] */
const ping = (at, levelId = 'n1') => ({ levelId, mapPos: { x: 420, y: 280 }, at });

const arcs = (/** @type {any} */ ctx) => ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'arc');

test('⭐ la couche ne lit aucun horodatage d’émetteur : seuls `at` local et `now` entrent', () => {
  // La preuve est dans la signature autant que dans le comportement. Le ping reçu par la couche ne
  // porte QUE la position, l'étage et un `at` que l'appelant a posé lui-même à la réception. Si un
  // jour quelqu'un fait passer `event.at` à la place, ce test ne le verra pas — mais le suivant, si.
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  const r = layer.render(ctx, grid, niveau(), { ping: ping(1000), now: 1500, zoom: 1 });
  assert.equal(r.drawn, true);
  assert.equal(r.animationActive, true);
});

test('⭐ un ping horodaté par une horloge en avance de 5,3 s n’est PAS effacé — il est juste ignoré', () => {
  // Le scénario réel, chiffré : le MJ estampille 5 300 ms dans le futur du point de vue tablette.
  // Si la couche recevait cet horodatage, l'âge serait négatif et rien ne s'afficherait. C'est
  // exactement ce que le câblage évite en réhorodatant à la réception — et ce test fixe le
  // comportement de la couche dans ce cas, pour que l'erreur soit visible si le câblage régresse.
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  const dansLeFutur = layer.render(ctx, grid, niveau(), { ping: ping(5300), now: 0, zoom: 1 });
  assert.equal(dansLeFutur.drawn, false, 'un âge négatif ne doit rien dessiner');
  assert.equal(dansLeFutur.animationActive, false, 'et surtout ne pas entretenir la boucle de rendu');
  assert.deepEqual(ctx.calls, [], 'le contexte a été touché pour un ping incohérent');

  // Réhorodaté localement, le même ping s'affiche normalement. C'est la ligne qui montre que le
  // défaut n'est pas dans la couche mais dans le choix de l'horodatage.
  const rehorodate = layer.render(recordingCtx(), grid, niveau(), { ping: ping(0), now: 0, zoom: 1 });
  assert.equal(rehorodate.drawn, true);
});

test('le ping s’efface exactement à la fin de sa fenêtre, et cesse d’entretenir la boucle', () => {
  const layer = new PingsLayer();
  // Juste avant la fin : encore vivant.
  const avant = layer.render(recordingCtx(), grid, niveau(), { ping: ping(0), now: PING_DURATION_MS - 1 });
  assert.equal(avant.animationActive, true);
  // À la borne exacte : terminé. ⛔ Cette égalité est ce qui permet à `renderAll` d'arrêter la
  // boucle ; un `>` au lieu d'un `>=` laisserait une frame se redemander indéfiniment.
  const pile = layer.render(recordingCtx(), grid, niveau(), { ping: ping(0), now: PING_DURATION_MS });
  assert.equal(pile.drawn, false);
  assert.equal(pile.animationActive, false);
});

test('un ping d’un autre étage ne se dessine pas', () => {
  // Un repère « regarde ici » posé sur un étage qu'on ne regarde pas désignerait un endroit qui ne
  // veut rien dire — pire qu'une absence de repère.
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  const r = layer.render(ctx, grid, niveau('n1'), { ping: ping(0, 'n2'), now: 100 });
  assert.equal(r.drawn, false);
  assert.deepEqual(ctx.calls, []);
});

test('sans ping, sans étage ou sans contexte : rien n’est touché', () => {
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  assert.equal(layer.render(ctx, grid, niveau(), { ping: null }).drawn, false);
  assert.equal(layer.render(ctx, grid, null, { ping: ping(0), now: 10 }).drawn, false);
  assert.equal(
    layer.render(/** @type {any} */ (null), grid, niveau(), { ping: ping(0), now: 10 }).drawn,
    false
  );
  assert.deepEqual(ctx.calls, [], 'le contexte a été touché alors qu’il n’y avait rien à faire');
});

test('un `mapPos` absent ne fait pas échouer le rendu', () => {
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  const r = layer.render(ctx, grid, niveau(), {
    ping: /** @type {any} */ ({ levelId: 'n1', at: 0 }),
    now: 10,
  });
  assert.equal(r.drawn, false);
});

test('⛔ les grandeurs sont en pixels écran, donc divisées par le zoom', () => {
  // Le défaut classique de ce projet — « grandeur dans le mauvais espace », déjà payé une fois avec
  // un facteur 3. Le contexte reçu est déjà mis à l'échelle par `camera.applyToContext` : une
  // épaisseur écrite crûment serait une épaisseur CARTE, juste à zoom 1 et fausse partout ailleurs.
  const layer = new PingsLayer();
  const a = recordingCtx();
  const b = recordingCtx();
  layer.render(a, grid, niveau(), { ping: ping(0), now: 10, zoom: 1 });
  layer.render(b, grid, niveau(), { ping: ping(0), now: 10, zoom: 2 });

  const dotA = arcs(a).at(-1);
  const dotB = arcs(b).at(-1);
  assert.equal(dotA[3], PING_DOT_RADIUS_SCREEN_PX, 'rayon du point à zoom 1');
  assert.equal(dotB[3], PING_DOT_RADIUS_SCREEN_PX / 2, 'le rayon doit être divisé par le zoom');

  const traitA = a.calls.filter((/** @type {any[]} */ c) => c[0] === 'stroke').at(-1);
  const traitB = b.calls.filter((/** @type {any[]} */ c) => c[0] === 'stroke').at(-1);
  assert.equal(traitA[1], PING_RING_WIDTH_SCREEN_PX);
  assert.equal(traitB[1], PING_RING_WIDTH_SCREEN_PX / 2, 'l’épaisseur aussi');
});

test('les ondes partent décalées, grandissent et s’effacent', () => {
  const layer = new PingsLayer();
  // Au tout début, une seule onde est née : les autres attendent leur décalage.
  const debut = recordingCtx();
  layer.render(debut, grid, niveau(), { ping: ping(0), now: 1, zoom: 1 });
  const ondesDebut = arcs(debut).length - 1; // le dernier arc est le point central
  assert.equal(ondesDebut, 1, `une seule onde au début, vu ${ondesDebut}`);

  // À mi-parcours, plusieurs cohabitent — c'est ce qui fait lire une pulsation.
  const milieu = recordingCtx();
  layer.render(milieu, grid, niveau(), { ping: ping(0), now: PING_DURATION_MS * 0.7, zoom: 1 });
  assert.ok(arcs(milieu).length - 1 > 1, 'plusieurs ondes doivent cohabiter à mi-parcours');
  assert.ok(arcs(milieu).length - 1 <= PING_WAVE_COUNT);

  // Une onde grandit avec le temps, et jamais au-delà du rayon annoncé.
  const tot = recordingCtx();
  const tard = recordingCtx();
  layer.render(tot, grid, niveau(), { ping: ping(0), now: PING_DURATION_MS * 0.2, zoom: 1 });
  layer.render(tard, grid, niveau(), { ping: ping(0), now: PING_DURATION_MS * 0.5, zoom: 1 });
  assert.ok(arcs(tard)[0][3] > arcs(tot)[0][3], 'la première onde doit grandir');
  for (const a of arcs(tard)) {
    assert.ok(a[3] <= PING_MAX_RADIUS_SCREEN_PX + 1e-9, `rayon ${a[3]} au-delà du maximum`);
  }
});

test('le point central reste lisible presque jusqu’à la fin', () => {
  // C'est lui qui DÉSIGNE l'endroit ; les ondes ne servent qu'à attirer l'œil. S'il s'effaçait au
  // même rythme qu'elles, le MJ pointerait un endroit que personne ne distingue plus.
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  layer.render(ctx, grid, niveau(), { ping: ping(0), now: PING_DURATION_MS * 0.5, zoom: 1 });
  const point = ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'fill').at(-1);
  assert.equal(point[2], 1, 'à mi-parcours le point doit encore être pleinement opaque');
});

test('l’état du contexte est rendu intact', () => {
  // L'invariant qui protège les couches suivantes — ici il n'y en a aucune, le ping étant le dernier
  // de la pile canonique, mais rien ne garantit qu'il le restera.
  const layer = new PingsLayer();
  const ctx = recordingCtx();
  ctx.globalAlpha = 0.33;
  ctx.strokeStyle = '#123456';
  ctx.lineWidth = 9;
  layer.render(ctx, grid, niveau(), { ping: ping(0), now: 500, zoom: 1 });
  assert.equal(ctx.depth, 0, 'pile de sauvegarde non vidée');
  assert.equal(ctx.globalAlpha, 0.33);
  assert.equal(ctx.strokeStyle, '#123456');
  assert.equal(ctx.lineWidth, 9);
});
