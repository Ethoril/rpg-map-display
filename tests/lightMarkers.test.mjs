// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LightMarkersLayer } from '../js/render/layers/lightMarkers.js';

/** Faux contexte qui journalise — motif de `tests/links.test.mjs` et `tests/lightLayer.test.mjs`. */
function fauxContexte() {
  /** @type {any[]} */
  const journal = [];
  /** @type {any} */
  const ctx = {
    journal,
    fillStyle: '',
    strokeStyle: '',
    save() {},
    restore() {},
    beginPath() {},
    arc() { journal.push({ op: 'arc' }); },
    fill() { journal.push({ op: 'fill', fillStyle: ctx.fillStyle }); },
    stroke() { journal.push({ op: 'stroke', strokeStyle: ctx.strokeStyle }); },
  };
  return ctx;
}

/** Adaptateur minimal : `cellCenter` rend le centre d'une case de 100 px, en carré. */
const GRID = /** @type {any} */ ({
  cellCenter: (/** @type {{a: number, b: number}} */ { a, b }) => ({ x: a * 100 + 50, y: b * 100 + 50 }),
});

test('LightMarkersLayer dessine les DEUX états, allumée et éteinte, avec des couleurs distinctes', () => {
  const level = /** @type {any} */ ({
    id: 'rdc',
    lights: [
      { id: 'allumee', at: { cellX: 1, cellY: 1 }, on: true },
      { id: 'eteinte', at: { cellX: 2, cellY: 2 }, on: false },
    ],
  });
  const layer = new LightMarkersLayer();
  const ctx = fauxContexte();

  assert.equal(layer.render(/** @type {any} */ (ctx), GRID, level, { zoom: 1 }), 2);

  const fills = ctx.journal.filter((/** @type {any} */ e) => e.op === 'fill').map((/** @type {any} */ e) => e.fillStyle);
  assert.equal(fills.length, 2, '⛔ une lampe éteinte n’a aucun indice dans le décor : elle DOIT se dessiner');
  assert.notEqual(fills[0], fills[1], 'les deux états doivent rester visuellement distincts');
});

test('LightMarkersLayer : absence du champ `on` équivaut à allumée (ceinture de la normalisation)', () => {
  const level = /** @type {any} */ ({
    id: 'rdc',
    lights: [{ id: 'sans-champ', at: { cellX: 1, cellY: 1 } }],
  });
  const layer = new LightMarkersLayer();
  const ctx = fauxContexte();
  layer.render(/** @type {any} */ (ctx), GRID, level, { zoom: 1 });
  const fill = ctx.journal.find((/** @type {any} */ e) => e.op === 'fill');
  assert.ok(fill, 'la lampe sans champ `on` doit tout de même se dessiner, allumée');
});

test('LightMarkersLayer : rien à dessiner sans lampes ni étage', () => {
  const layer = new LightMarkersLayer();
  const ctx = fauxContexte();
  assert.equal(layer.render(/** @type {any} */ (ctx), GRID, /** @type {any} */ ({ id: 'rdc', lights: [] }), {}), 0);
  assert.equal(layer.render(/** @type {any} */ (ctx), GRID, /** @type {any} */ (null), {}), 0);
  assert.equal(ctx.journal.length, 0);
});

test('⛔ C-2 — la couche de marqueurs n’est JAMAIS câblée côté joueurs (js/app/player.js)', () => {
  // ⭐ Preuve par mutation attendue : brancher `lightMarkers` dans `player.js` doit faire
  // rougir ce test. Décision du mainteneur du 10/09/2026 — un marqueur côté joueurs dirait
  // « il y a quelque chose ici » dans une pièce noire.
  const source = fs.readFileSync('js/app/player.js', 'utf8');
  assert.equal(source.includes('LightMarkersLayer'), false, 'player.js ne doit importer aucune LightMarkersLayer');
  assert.equal(source.includes('lightMarkers'), false, 'player.js ne doit brancher aucun renderer « lightMarkers »');
});

test('C-2 — `lightMarkers` figure dans CANVAS_LAYER_ORDER, au rang 12 (entre `feedback` et `measure`)', async () => {
  const { CANVAS_LAYER_ORDER } = await import('../js/render/stage.js');
  assert.ok(CANVAS_LAYER_ORDER.includes('lightMarkers'));
  assert.ok(CANVAS_LAYER_ORDER.indexOf('lightMarkers') > CANVAS_LAYER_ORDER.indexOf('fog'));
  assert.ok(CANVAS_LAYER_ORDER.indexOf('lightMarkers') < CANVAS_LAYER_ORDER.indexOf('measure'));
});
