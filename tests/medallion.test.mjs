// @ts-check
// Médaillon des pions liés (lot P2, contrat de liaison §11, étude E1 variante B) : cerclage par
// camp, teinte du PJ, gris du mort, repli sous 36 px, toiles calculées une fois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMP_FILL,
  FRAME_GEOMETRY,
  MEDALLION_MIN_SCREEN_PX,
  MedallionCache,
  enamelLightOf,
  frameCacheKey,
  medallionFrameOf,
  medallionLayout,
  mixHex,
  wantsMedallion,
} from '../js/render/medallion.js';
import { TokensLayer } from '../js/render/layers/tokens.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { createLevel } from '../js/core/schema.js';

const link = { source: 'outil-mj', ref: 'p:x' };

test('cerclage par camp : PJ bronze teinté de sa couleur (sinon du camp), allié étain, ennemi fer, neutre bronze', () => {
  assert.deepEqual(medallionFrameOf({ link, camp: 'pj', color: '#B3262E' }), { frame: 'bronze', tint: '#b3262e' });
  assert.deepEqual(medallionFrameOf({ link, camp: 'pj', color: null }), { frame: 'bronze', tint: CAMP_FILL.pj });
  assert.deepEqual(medallionFrameOf({ link, camp: 'pj', color: 'rouge' }), { frame: 'bronze', tint: CAMP_FILL.pj });
  assert.deepEqual(medallionFrameOf({ link, camp: 'allie' }), { frame: 'etain', tint: null });
  assert.deepEqual(medallionFrameOf({ link, camp: 'ennemi', color: '#b3262e' }), { frame: 'fer', tint: null });
  assert.deepEqual(medallionFrameOf({ link, camp: 'neutre' }), { frame: 'bronze', tint: null });
  assert.deepEqual(medallionFrameOf({ link }), { frame: 'bronze', tint: null });
});

test('fond émaillé : couleur du PJ éclaircie, sinon teinte claire du camp', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(enamelLightOf({ camp: 'pj', color: '#2a4fa8' }), mixHex('#2a4fa8', '#ffffff', 0.35));
  assert.equal(enamelLightOf({ camp: 'ennemi' }), '#e0806c');
  assert.equal(enamelLightOf({}), '#b3b9c0');
});

test('médaillon pour un pion lié dès 36 px à l’écran ; pion ordinaire jamais', () => {
  assert.equal(MEDALLION_MIN_SCREEN_PX, 36);
  assert.equal(wantsMedallion({ link }, 36, 1), true);
  assert.equal(wantsMedallion({ link }, 35.9, 1), false);
  assert.equal(wantsMedallion({ link }, 100, 0.35), false, '35 px à l’écran');
  assert.equal(wantsMedallion({ link }, 100, 0.36), true);
  assert.equal(wantsMedallion({}, 100, 2), false);
});

test('géométrie : anneau dans la case, fenêtre fine à environ 69 % (63 % pour l’étain)', () => {
  for (const frame of /** @type {const} */ (['bronze', 'etain', 'fer'])) {
    const g = FRAME_GEOMETRY[frame];
    const l = medallionLayout(frame, 50, 50, 100);
    const k = l.frameSize / 256;
    assert.ok(Math.abs(g.outer * k - 50) < 1e-9, `${frame} : anneau au bord de la case`);
    assert.ok(Math.abs(l.frameX + g.cx * k - 50) < 1e-9 && Math.abs(l.frameY + g.cy * k - 50) < 1e-9, `${frame} : centré`);
    const ratio = (l.windowRadius - 0.5) / 50;
    assert.ok(ratio > 0.6 && ratio < 0.72, `${frame} : fenêtre ${ratio}`);
  }
  assert.ok(Math.abs((medallionLayout('bronze', 0, 0, 100).windowRadius - 0.5) / 50 - 0.697) < 0.005);
});

/** Fabriques factices : images chargées à la demande, toiles qui notent leurs opérations. */
function fakes() {
  /** @type {any[]} */ const images = [];
  const imageFactory = () => {
    const image = /** @type {any} */ ({ onload: null, onerror: null, src: '' });
    images.push(image);
    return image;
  };
  const canvasFactory = (/** @type {number} */ width, /** @type {number} */ height) => {
    /** @type {string[]} */ const ops = [];
    const ctx = /** @type {any} */ ({
      ops, globalCompositeOperation: 'source-over', globalAlpha: 1, fillStyle: '',
      drawImage() { ops.push(`draw:${ctx.globalCompositeOperation}`); },
      fillRect() { ops.push(`fill:${ctx.globalCompositeOperation}:${ctx.fillStyle}`); },
      createRadialGradient: () => ({ addColorStop() {} }),
    });
    return /** @type {any} */ ({ width, height, ctx, getContext: () => ctx });
  };
  return { images, imageFactory, canvasFactory };
}

test('cache : chaque cerclage teinté ou gris se calcule une fois, puis resert tel quel', () => {
  const f = fakes();
  let invalidations = 0;
  const cache = new MedallionCache({ imageFactory: f.imageFactory, canvasFactory: f.canvasFactory, invalidate: () => { invalidations += 1; } });
  assert.equal(cache.frameCanvas('bronze', '#b3262e', false), null, 'pas encore chargé');
  assert.equal(f.images.length, 1);
  assert.equal(f.images[0].src, 'assets/medaillons/cerclage-bronze-fin.webp');
  assert.equal(cache.frameCanvas('bronze', '#b3262e', false), null, 'chargement en cours : pas de second chargement');
  assert.equal(f.images.length, 1);
  f.images[0].onload();
  assert.equal(invalidations, 1, 'le chargement relance une image');
  const rouge = cache.frameCanvas('bronze', '#b3262e', false);
  assert.ok(rouge);
  assert.deepEqual(/** @type {any} */ (rouge).ctx.ops, ['draw:source-over', 'fill:color:#b3262e', 'draw:destination-in']);
  for (let i = 0; i < 50; i++) assert.equal(cache.frameCanvas('bronze', '#b3262e', false), rouge);
  const gris = cache.frameCanvas('bronze', '#b3262e', true);
  assert.notEqual(gris, rouge);
  assert.equal(cache.frameCanvas('bronze', '#2e9e6e', true), gris, 'le gris efface la teinte : une seule toile');
  assert.deepEqual(/** @type {any} */ (gris).ctx.ops, ['draw:source-over', 'fill:saturation:#808080', 'fill:source-atop:rgba(0, 0, 0, 0.35)', 'draw:destination-in']);
  const jade = cache.frameCanvas('bronze', '#2e9e6e', false);
  assert.notEqual(jade, rouge);
  assert.equal(cache.builds, 3);
  assert.equal(frameCacheKey('fer', null, true), 'fer|mort');
  const email = cache.enamelCanvas('#e0806c');
  assert.equal(cache.enamelCanvas('#e0806c'), email);
  assert.equal(cache.builds, 4);
});

test('cache sans navigateur : aucun cerclage, jamais d’erreur', () => {
  const cache = new MedallionCache({ imageFactory: null, canvasFactory: null });
  assert.equal(cache.frameCanvas('fer', null, false), null);
  assert.equal(cache.enamelCanvas('#e0806c'), null);
});

/** Contexte 2D factice qui note les toiles posées et les liserés tracés. */
function recordingContext() {
  /** @type {any[]} */ const drawn = [];
  /** @type {string[]} */ const strokes = [];
  const ctx = /** @type {any} */ ({
    drawn, strokes,
    save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, ellipse() {}, clip() {}, fill() {},
    stroke() { strokes.push(ctx.strokeStyle); }, drawImage(/** @type {any} */ source) { drawn.push(source); },
    fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }), moveTo() {}, lineTo() {}, rect() {}, roundRect() {},
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '', textAlign: 'center', textBaseline: 'middle',
  });
  return ctx;
}

test('rendu : médaillon d’un pion lié, une toile posée ; mort en gris ; disque simple sous 36 px et pour un pion ordinaire', () => {
  const f = fakes();
  const layer = new TokensLayer({ medallionImageFactory: f.imageFactory, canvasFactory: f.canvasFactory });
  const grid = new SquareGrid(createLevel({ id: 'rdc', pxPerCell: 100, widthCells: 6, heightCells: 6 }));
  const base = { id: 'e', levelId: 'rdc', cell: { a: 1, b: 1 }, sizeCells: 1, kind: 'pc', imageUrl: '', label: 'Elysia', borderColor: '#00ff00', hidden: false, elevation: 0, markers: [] };
  const pj = { ...base, link: { source: 'outil-mj', ref: 'pj:c1' }, camp: 'pj', color: '#b3262e' };
  const draw = (/** @type {any} */ token, zoom = 1) => {
    const ctx = recordingContext();
    layer.render(ctx, grid, [token], null, { activeLevelId: 'rdc', zoom });
    return ctx;
  };
  // Premier rendu : le cerclage se charge, le pion garde son disque et son liseré de PJ.
  assert.deepEqual(draw(pj).strokes, ['#b3262e']);
  const loaded = f.images.length;
  for (const image of f.images) image.onload();
  const avant = layer.medallions.builds;
  const vivant = draw(pj);
  assert.deepEqual(vivant.strokes, [], 'le cerclage tient lieu de liseré');
  assert.ok(vivant.drawn.includes(layer.medallions.canvases.get('bronze|#b3262e')), 'cerclage bronze teinté posé');
  draw(pj); draw(pj);
  assert.equal(layer.medallions.builds, avant + 2, 'cerclage et émail calculés une seule fois');
  const mort = draw({ ...pj, dead: true });
  assert.ok(mort.drawn.includes(layer.medallions.canvases.get('bronze|mort')), 'mort : cerclage gris');
  draw({ ...pj, camp: 'ennemi', color: undefined });
  assert.ok(f.images.length > loaded, 'le fer se charge à la demande');
  for (const image of f.images) image.onload?.();
  const ennemi = draw({ ...pj, camp: 'ennemi', color: undefined });
  assert.ok(ennemi.drawn.includes(layer.medallions.canvases.get('fer|')), 'ennemi : fer à pointes');
  const petit = draw(pj, 0.3);
  assert.deepEqual(petit.strokes, ['#b3262e'], '30 px : disque simple au liseré du PJ');
  assert.equal(petit.drawn.length, 0);
  assert.deepEqual(draw({ ...pj, dead: true }, 0.3).strokes.slice(0, 1), ['#7a7a7a'], 'mort au petit zoom : liseré gris');
  const ordinaire = draw(base);
  assert.deepEqual(ordinaire.strokes, ['#00ff00'], 'pion ordinaire : liseré choisi, pas de médaillon');
  assert.equal(ordinaire.drawn.length, 0);
});
