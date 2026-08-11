// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import { WallsLayer } from '../js/render/layers/walls.js';

/**
 * Couche de rendu des murs — la seule couche du moteur qui n'était couverte par aucun test,
 * alors que l'éditeur qui l'alimente en a deux (`wallEditor.test.mjs`, `wallEditor.spec.mjs`).
 *
 * Ce qui se joue ici n'est pas l'aspect des traits, qui se voit à l'œil, mais **l'hygiène
 * d'état du contexte**. Une couche qui laisse fuir un `strokeStyle`, un `globalAlpha` ou un
 * tiret de pointillé contamine toutes les couches dessinées après elle, dans l'ordre canonique
 * du stage. Le défaut se manifeste alors **ailleurs** que dans son propre code — c'est
 * exactement la famille de bogue contre laquelle `templates.spec.mjs` protège déjà le
 * `ctx.clip()`, et elle ne se rattrape pas par relecture.
 */

/**
 * Contexte 2D enregistreur : on juge la séquence émise, pas des pixels.
 *
 * Rendu en `any` délibérément : implémenter les 56 membres de `CanvasRenderingContext2D` que
 * la couche n'appelle jamais n'ajouterait aucune garantie, seulement du bruit.
 * @returns {any}
 */
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
    lineJoin: '',
    /** Profondeur maximale atteinte, pour vérifier qu'on retombe bien à zéro. */
    depthMax: 0,
    get depth() { return stack.length; },
    save() {
      stack.push({
        strokeStyle: ctx.strokeStyle,
        fillStyle: ctx.fillStyle,
        lineWidth: ctx.lineWidth,
        globalAlpha: ctx.globalAlpha,
        lineCap: ctx.lineCap,
        lineJoin: ctx.lineJoin,
        dash: ctx._dash,
      });
      ctx.depthMax = Math.max(ctx.depthMax, stack.length);
      calls.push(['save']);
    },
    restore() {
      const s = stack.pop();
      // Un `restore()` sans `save()` correspondant est un défaut en soi : sur un vrai canvas
      // il est silencieusement ignoré, et l'état du stage a alors déjà fui.
      assert.ok(s, 'restore() sans save() correspondant');
      Object.assign(ctx, s);
      ctx._dash = s.dash;
      calls.push(['restore']);
    },
    /** @type {number[]} */
    _dash: [],
    /** @param {number[]} d */
    setLineDash(d) { ctx._dash = d; calls.push(['setLineDash', [...d]]); },
    getLineDash() { return ctx._dash; },
    beginPath() { calls.push(['beginPath']); },
    /** @param {number} x @param {number} y */
    moveTo(x, y) { calls.push(['moveTo', x, y]); },
    /** @param {number} x @param {number} y */
    lineTo(x, y) { calls.push(['lineTo', x, y]); },
    stroke() { calls.push(['stroke', ctx.strokeStyle, [...ctx._dash]]); },
    fill() { calls.push(['fill', ctx.fillStyle]); },
    /** @param {number} x @param {number} y @param {number} r */
    arc(x, y, r) { calls.push(['arc', x, y, r]); },
  };
  return ctx;
}

/** Grille à pas fixe : la couche n'a pas à savoir comment on convertit, seulement à déléguer. */
const grid = /** @type {any} */ ({
  mapFromCellPoint: (/** @type {{ cellX: number, cellY: number }} */ { cellX, cellY }) => ({
    x: cellX * 140,
    y: cellY * 140,
  }),
});

/** @param {any[]} walls */
const niveau = (walls) => /** @type {any} */ ({ id: 'n1', walls });

/** @param {number} cellX @param {number} cellY */
const p = (cellX, cellY) => ({ cellX, cellY });

const nomsDe = (/** @type {any} */ ctx) => ctx.calls.map((/** @type {any[]} */ c) => c[0]);

test('sans contexte, sans grille ou sans étage : zéro segment et aucun appel', () => {
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  assert.equal(layer.render(/** @type {any} */ (null), grid, niveau([])), 0);
  assert.equal(layer.render(ctx, /** @type {any} */ (null), niveau([])), 0);
  assert.equal(layer.render(ctx, grid, /** @type {any} */ (null)), 0);
  // ⛔ Sortir sans avoir touché au contexte : un `save()` déjà émis serait un déséquilibre.
  assert.deepEqual(ctx.calls, [], 'le contexte a été touché alors qu’il n’y avait rien à faire');
});

test('un mur de trois sommets rend deux segments, aux coordonnées de la grille', () => {
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  const segments = layer.render(ctx, grid, niveau([[p(1, 1), p(2, 1), p(2, 3)]]));

  assert.equal(segments, 2, 'le retour compte les segments, pas les sommets');
  // La conversion est déléguée à la grille : la couche ne calcule aucune coordonnée elle-même
  // (règle d'architecture n°1, vérifiée globalement par `architecture.test.mjs`).
  assert.deepEqual(
    ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'moveTo' || c[0] === 'lineTo'),
    [['moveTo', 140, 140], ['lineTo', 280, 140], ['lineTo', 280, 420]]
  );
});

test('chaque mur ouvre son propre chemin : deux murs ne sont jamais reliés', () => {
  // Sans `beginPath()` par mur, le `stroke()` relierait la fin d'un mur au début du suivant
  // par un trait qui n'existe pas dans la géométrie. Le défaut serait invisible sur une carte
  // dont les murs se touchent, et flagrant sur une carte où ils sont éloignés.
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  const segments = layer.render(ctx, grid, niveau([[p(0, 0), p(1, 0)], [p(5, 5), p(6, 5)]]));

  assert.equal(segments, 2);
  assert.equal(ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'beginPath').length, 2);
  assert.equal(ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'stroke').length, 2);
  // Un seul `moveTo` par mur, et il précède les `lineTo` de ce mur.
  assert.deepEqual(nomsDe(ctx).slice(1), [
    'beginPath', 'moveTo', 'lineTo', 'stroke',
    'beginPath', 'moveTo', 'lineTo', 'stroke',
    'restore',
  ]);
});

test('un mur de moins de deux sommets est ignoré, et ne compte pas', () => {
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  // Un sommet unique, un tableau vide, une valeur qui n'est pas un tableau : trois formes
  // qu'un import ou un éditeur interrompu peut produire.
  const segments = layer.render(
    ctx,
    grid,
    niveau([[p(0, 0)], [], /** @type {any} */ (null), [p(1, 1), p(2, 2)]])
  );
  assert.equal(segments, 1);
  assert.equal(ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'beginPath').length, 1);
});

test('`walls` absent ou non tabulaire ne fait pas échouer le rendu', () => {
  const layer = new WallsLayer();
  for (const walls of [undefined, null, 'des murs', 42, {}]) {
    const ctx = recordingCtx();
    assert.equal(layer.render(ctx, grid, niveau(/** @type {any} */ (walls))), 0);
    assert.equal(ctx.depth, 0);
  }
});

test('le tracé en cours est en pointillés, et ses segments ne sont pas comptés', () => {
  // Le retour documente « le nombre de segments de murs dessinés » : un tracé non confirmé
  // n'est pas un mur, et le compter ferait dériver toute mesure fondée sur ce retour.
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  const segments = layer.render(ctx, grid, niveau([]), [p(0, 0), p(1, 0), p(1, 1)]);

  assert.equal(segments, 0, 'le brouillon a été compté comme des murs');
  const traces = ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'stroke');
  assert.equal(traces.length, 1);
  assert.deepEqual(traces[0][2], [6, 4], 'le tracé en cours doit être discontinu');
  // Un disque par sommet posé, pour que le MJ voie où il a cliqué.
  assert.equal(ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'arc').length, 3);
});

test('un tracé d’un seul sommet montre son point sans dessiner de segment', () => {
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  layer.render(ctx, grid, niveau([]), [p(4, 4)]);

  assert.deepEqual(
    ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'lineTo'),
    [],
    'aucun segment ne peut exister avec un seul sommet'
  );
  assert.equal(ctx.calls.filter((/** @type {any[]} */ c) => c[0] === 'arc').length, 1);
});

test('⭐ l’état du contexte est rendu intact, murs et tracé compris', () => {
  // L'invariant qui protège toutes les couches suivantes de l'ordre canonique.
  const layer = new WallsLayer();
  for (const draft of [null, [p(0, 0), p(1, 1)]]) {
    const ctx = recordingCtx();
    ctx.strokeStyle = '#123456';
    ctx.fillStyle = '#abcdef';
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 7;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    layer.render(ctx, grid, niveau([[p(0, 0), p(1, 0)]]), draft);

    assert.equal(ctx.depth, 0, 'pile de sauvegarde non vidée');
    assert.ok(ctx.depthMax >= 1, 'le contexte n’a jamais été sauvegardé');
    assert.equal(ctx.strokeStyle, '#123456');
    assert.equal(ctx.fillStyle, '#abcdef');
    assert.equal(ctx.globalAlpha, 0.42);
    assert.equal(ctx.lineWidth, 7);
    assert.equal(ctx.lineCap, 'butt');
    assert.equal(ctx.lineJoin, 'miter');
    assert.deepEqual(ctx.getLineDash(), [], 'un tiret de pointillé a fui hors de la couche');
  }
});

test('⚠ la couche hérite du pointillé de son appelant : les murs confirmés le subissent', () => {
  // Comportement **constaté**, pas approuvé. `render()` fixe `strokeStyle`, `lineWidth`,
  // `globalAlpha`, `lineCap` et `lineJoin`, mais **jamais** `setLineDash` avant de tracer les
  // murs confirmés : un contexte arrivant avec des pointillés dessinerait des murs en
  // pointillés, indiscernables d'un tracé en cours. Aujourd'hui `renderAll` n'en laisse pas
  // fuir — c'est justement ce que le test précédent verrouille pour chaque couche.
  //
  // Ce test fixe la dépendance pour qu'elle soit vue si elle casse, et rougisse le jour où la
  // couche décidera de neutraliser le pointillé elle-même. Il ne valide pas la situation.
  const layer = new WallsLayer();
  const ctx = recordingCtx();
  ctx.setLineDash([2, 2]);
  layer.render(ctx, grid, niveau([[p(0, 0), p(1, 0)]]));

  const trace = ctx.calls.find((/** @type {any[]} */ c) => c[0] === 'stroke');
  assert.deepEqual(trace[2], [2, 2], 'le comportement a changé — relire le commentaire ci-dessus');
});
