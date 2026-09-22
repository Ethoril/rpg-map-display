// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LightMarkersLayer } from '../js/render/layers/lightMarkers.js';
import { collectLightSources } from '../js/render/layers/light.js';
import { findHitLight } from '../js/input/lightHit.js';
import { gridFor } from '../js/grid/index.js';
import { createLevel } from '../js/core/schema.js';

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
    arc(/** @type {number} */ x, /** @type {number} */ y) { journal.push({ op: 'arc', x, y }); },
    fill() { journal.push({ op: 'fill', fillStyle: ctx.fillStyle }); },
    stroke() { journal.push({ op: 'stroke', strokeStyle: ctx.strokeStyle }); },
  };
  return ctx;
}

/** Adaptateur minimal, carré à 100 px : `light.at` est un `CellPoint`, lu par `mapFromCellPoint`. */
const GRID = /** @type {any} */ ({
  mapFromCellPoint: (/** @type {{cellX: number, cellY: number}} */ { cellX, cellY }) => ({ x: cellX * 100, y: cellY * 100 }),
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


// E2 (audit du 22/09/2026) — le marqueur et la zone de tap lisaient `light.at` comme un `Cell`
// (`cellCenter({a: at.cellX, …})`), le halo comme un `CellPoint`. Une lampe UVTT en 4,5 avait son
// marqueur une demi-case à côté de sa lumière. Marqueur, tap et halo doivent coïncider, en carré
// comme en hexagonal, sur une grille décalée.
for (const type of /** @type {const} */ (['square', 'hex'])) {
  test(`E2 (${type}) : marqueur, zone de tap et halo d’une lampe au même point`, () => {
    const level = createLevel({
      id: 'e2', widthCells: 10, heightCells: 10, pxPerCell: 100,
      grid: { type, offsetX: 30, offsetY: 20, color: '#000000', opacity: 0.25, visible: true },
      lights: [{ id: 'uvtt', at: { cellX: 4.5, cellY: 2.5 }, range: 3, intensity: 1, color: '#ffffff', shadows: true, on: true }],
    });
    const grid = gridFor(level);
    const halo = collectLightSources(level, [], grid)[0].center;

    const ctx = fauxContexte();
    new LightMarkersLayer().render(/** @type {any} */ (ctx), grid, level, { zoom: 1 });
    const arc = ctx.journal.find((/** @type {any} */ e) => e.op === 'arc');
    assert.ok(Math.abs(arc.x - halo.x) < 1e-6 && Math.abs(arc.y - halo.y) < 1e-6, `marqueur ${arc.x},${arc.y} ≠ halo ${halo.x},${halo.y}`);

    assert.equal(findHitLight(grid, level, halo, 1)?.light.id, 'uvtt', 'un tap sur le halo désigne la lampe');
  });
}
