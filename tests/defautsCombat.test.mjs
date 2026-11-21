// @ts-check
// Défauts relevés par le MJ après un vrai combat (21/11/2026) — partie « logique pure ».
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { createCampaign, createLevel, createLink, createToken } from '../js/core/schema.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import { applyNetworkEvent } from '../js/app/networkEvents.js';
import { getCampaign, moveTokenToCell, resetStore, traverseLink } from '../js/state/store.js';

const PX = 100;

/** Ctx instrumenté : le repli sans image peint la boîte du pion par `fillRect(p0.x, p0.y, w, h)`. */
function recordingCtx() {
  /** @type {Array<{x: number, y: number, w: number, h: number}>} */
  const rects = [];
  return {
    rects,
    ctx: /** @type {any} */ ({
      save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
      moveTo: () => {}, lineTo: () => {}, arc: () => {}, ellipse: () => {}, clip: () => {},
      fill: () => {}, stroke: () => {}, strokeRect: () => {}, drawImage: () => {},
      fillText: () => {}, measureText: () => ({ width: 10 }), setLineDash: () => {},
      fillRect: (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ w, /** @type {number} */ h) => {
        rects.push({ x, y, w, h });
      },
      fillStyle: '', strokeStyle: '', lineWidth: 1,
      globalAlpha: 1, font: '', textAlign: 'center', textBaseline: 'middle',
    }),
  };
}

/** Case où la couche des pions a réellement peint ce pion, déduite de la boîte dessinée. */
function drawnCell(token, levelId) {
  const level = getCampaign()?.levels.find((l) => l.id === levelId);
  assert.ok(level);
  const grid = new SquareGrid(level);
  const rec = recordingCtx();
  const layer = new TokensLayer();
  // Bien après la fin de toute animation : seule la position de repos compte.
  layer.render(rec.ctx, grid, [token], null, { activeLevelId: levelId, now: Date.now() + 60_000 });
  assert.equal(rec.rects.length, 1, 'le pion est peint une fois');
  return { a: Math.round(rec.rects[0].x / PX), b: Math.round(rec.rects[0].y / PX) };
}

function campagneAEscalier() {
  return createCampaign({
    levels: [
      createLevel({ id: 'rdc', pxPerCell: PX, widthCells: 10, heightCells: 8 }),
      createLevel({ id: 'et1', pxPerCell: PX, widthCells: 10, heightCells: 8 }),
    ],
    tokens: [createToken({ id: 'hero', kind: 'pc', levelId: 'rdc', cell: { a: 1, b: 1 } })],
    links: [createLink({ id: 'stairs', a: { levelId: 'rdc', at: { cellX: 3, cellY: 1 } }, b: { levelId: 'et1', at: { cellX: 6, cellY: 5 } } })],
  });
}

beforeEach(() => resetStore());

test('Bug escaliers : après un franchissement, le pion est dessiné sur la case de l’état, pas sur l’arrivée de son dernier trajet', () => {
  assert.equal(applyNetworkEvent({ type: 'scene.load', payload: { campaign: campagneAEscalier() }, at: Date.now(), by: 'gm' }), true);
  // Le pion marche jusqu'à l'escalier (trajet animé), puis le franchit.
  moveTokenToCell('hero', { a: 3, b: 1 }, { from: { a: 1, b: 1 }, to: { a: 3, b: 1 }, path: [{ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 3, b: 1 }], startedAt: Date.now() });
  traverseLink('hero', 'stairs');
  const hero = getCampaign()?.tokens.find((t) => t.id === 'hero');
  assert.ok(hero);
  assert.equal(hero.levelId, 'et1');
  assert.deepEqual(hero.cell, { a: 6, b: 5 }, 'l’état place le pion sur l’arrivée de l’escalier');
  assert.equal(hero.move, undefined, 'le trajet vers l’escalier de départ ne voyage pas avec le pion');
  assert.deepEqual(drawnCell(hero, 'et1'), hero.cell, 'le dessin concorde avec l’état');
});

test('Bug escaliers : un `move` périmé, d’où qu’il vienne, ne déplace jamais le dessin hors de `cell`', () => {
  // Cas défensif : une campagne restaurée ou reçue d'une version antérieure peut porter un `move`
  // dont l'arrivée n'est plus la case du pion. Le rendu suit l'état, toujours.
  const level = createLevel({ id: 'rdc', pxPerCell: PX, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'p', levelId: 'rdc', cell: { a: 7, b: 2 } });
  token.move = { from: { a: 0, b: 0 }, to: { a: 1, b: 1 }, path: [{ a: 0, b: 0 }, { a: 1, b: 1 }], startedAt: Date.now() - 60_000 };
  const rec = recordingCtx();
  new TokensLayer().render(rec.ctx, new SquareGrid(level), [token], null, { activeLevelId: 'rdc' });
  assert.deepEqual({ a: Math.round(rec.rects[0].x / PX), b: Math.round(rec.rects[0].y / PX) }, { a: 7, b: 2 });

  // Même `move` périmé, mais encore « en cours » : il n'anime pas un trajet qui ne mène pas au pion.
  token.move = { ...token.move, startedAt: Date.now() };
  const enCours = recordingCtx();
  const result = new TokensLayer().render(enCours.ctx, new SquareGrid(level), [token], null, { activeLevelId: 'rdc' });
  assert.deepEqual({ a: enCours.rects[0].x / PX, b: enCours.rects[0].y / PX }, { a: 7, b: 2 });
  assert.equal(result.animationActive, false);
});

test('Bug escaliers : le franchissement reçu du réseau (tablette → MJ) donne le même dessin', () => {
  assert.equal(applyNetworkEvent({ type: 'scene.load', payload: { campaign: campagneAEscalier() }, at: Date.now(), by: 'gm' }), true);
  const path = [{ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 3, b: 1 }];
  assert.equal(applyNetworkEvent({ type: 'token.move', payload: { tokenId: 'hero', from: { a: 1, b: 1 }, to: { a: 3, b: 1 }, path, startedAt: Date.now() }, at: Date.now(), by: 'players' }), true);
  assert.equal(applyNetworkEvent({ type: 'link.traverse', payload: { tokenId: 'hero', linkId: 'stairs', destination: { levelId: 'et1', cell: { a: 6, b: 5 } } }, at: Date.now(), by: 'players' }), true);
  const hero = getCampaign()?.tokens.find((t) => t.id === 'hero');
  assert.ok(hero);
  assert.deepEqual(drawnCell(hero, 'et1'), { a: 6, b: 5 });
});
