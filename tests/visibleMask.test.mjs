// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import { composeVisibleMask } from '../js/vision/fog.js';
import { FOG_MASK_PX_PER_CELL } from '../js/core/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Z-05 — la règle du mode tactique :
//
//     visible = (ligne de vue ∩ éclairé)  ∪  (ce que le PJ voit dans le noir)
//
// ⛔ **C'est le chemin le plus exposé du projet.** Une erreur ici ne fait pas planter une page :
// elle montre à la table quelque chose qu'elle ne devrait pas voir, et personne ne s'en aperçoit
// avant la séance. Le mock rasterise donc pour de bon — polygones remplis, `destination-in`
// honoré — et les assertions portent sur des PIXELS, jamais sur un drapeau.
// ─────────────────────────────────────────────────────────────────────────────

/** @param {number} w @param {number} h */
function createMockCanvas(w, h) {
  const pixels = new Float64Array(w * h * 4);
  /** @type {Array<{x: number, y: number}>} */
  let chemin = [];
  /** @type {Array<Array<{x: number, y: number}>>} */
  let sousChemins = [];

  /** @param {{x: number, y: number}} pt @param {Array<{x: number, y: number}>} poly */
  function dedans(pt, poly) {
    let dans = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
        dans = !dans;
      }
    }
    return dans;
  }

  const ctx = /** @type {any} */ ({
    width: w,
    height: h,
    pixels,
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    /** @type {any[]} */
    _pile: [],
    save() { this._pile.push(this.globalCompositeOperation); },
    restore() { this.globalCompositeOperation = this._pile.pop() ?? 'source-over'; },

    clearRect() { pixels.fill(0); },

    beginPath() { chemin = []; sousChemins = []; },
    /** @param {number} x @param {number} y */
    moveTo(x, y) { if (chemin.length) sousChemins.push(chemin); chemin = [{ x, y }]; },
    /** @param {number} x @param {number} y */
    lineTo(x, y) { chemin.push({ x, y }); },
    closePath() {},

    fill() {
      const polys = chemin.length ? [...sousChemins, chemin] : sousChemins;
      const mode = this.globalCompositeOperation;
      for (let ligne = 0; ligne < h; ligne++) {
        for (let col = 0; col < w; col++) {
          const pt = { x: col + 0.5, y: ligne + 0.5 };
          const dansForme = polys.some((poly) => poly.length >= 3 && dedans(pt, poly));
          const index = (ligne * w + col) * 4;
          // ⛔ Ce mock a d'abord posé l'alpha à 255 sans regarder le mode de fusion. La
          // mutation « intersecter au lieu d'ajouter le terme nocturne » passait donc VERTE :
          // le mock implémentait l'inverse du mécanisme testé, le piège exact que ce projet a
          // déjà payé douze fois. Le mode est désormais honoré.
          if (mode === 'destination-in') {
            if (!dansForme) pixels[index + 3] = 0;
          } else if (dansForme) {
            pixels[index + 3] = 255;
          }
        }
      }
    },

    /** @param {any} image @param {number[]} reste */
    drawImage(image, ...reste) {
      const src = image?._ctx;
      if (!src) return;
      const [, , , , dx = 0, dy = 0, dw = src.width, dh = src.height] =
        reste.length >= 8 ? reste : [0, 0, src.width, src.height, reste[0] ?? 0, reste[1] ?? 0, src.width, src.height];
      const mode = this.globalCompositeOperation;

      for (let ligne = 0; ligne < h; ligne++) {
        for (let col = 0; col < w; col++) {
          const index = (ligne * w + col) * 4;
          let alphaSrc = 0;
          if (col >= dx && col < dx + dw && ligne >= dy && ligne < dy + dh) {
            const sc = Math.min(src.width - 1, Math.floor(((col - dx) / dw) * src.width));
            const sl = Math.min(src.height - 1, Math.floor(((ligne - dy) / dh) * src.height));
            alphaSrc = src.pixels[(sl * src.width + sc) * 4 + 3] / 255;
          }
          if (mode === 'destination-in') {
            // Ne garde de la destination que là où la source est opaque. C'est l'opération qui
            // porte l'intersection « ligne de vue ∩ éclairé » : la fausser, c'est la fuite.
            pixels[index + 3] = pixels[index + 3] * alphaSrc;
          } else {
            pixels[index + 3] = alphaSrc * 255 + pixels[index + 3] * (1 - alphaSrc);
          }
        }
      }
    },
  });

  const canvas = /** @type {any} */ ({
    width: w, height: h, _ctx: ctx,
    /** @param {string} t */
    getContext(t) { return t === '2d' ? ctx : null; },
  });
  ctx.canvas = canvas;
  return canvas;
}

const GRID_SCALE = 100;
const ORIGIN = { x: 0, y: 0 };
/** Une case vaut 100 px carte ; le masque en met 8. Facteur 0,08. */
const CASES = 10;
const MASQUE = CASES * FOG_MASK_PX_PER_CELL; // 80

/** Un carré axé, en pixels carte. @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
const carre = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ x1, /** @type {number} */ y1) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

/** @param {any} canvas @param {number} mx @param {number} my */
const vuA = (canvas, mx, my) => canvas._ctx.pixels[(my * canvas.width + mx) * 4 + 3] > 0;

/**
 * Un champ lumineux qui n'éclaire qu'un rectangle donné, en pixels MASQUE.
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 */
function champEclairant(x0, y0, x1, y1) {
  const c = createMockCanvas(MASQUE, MASQUE);
  const ctx = c._ctx;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x0, y1);
  ctx.closePath();
  ctx.fill();
  return c;
}

const fabrique = (/** @type {number} */ w, /** @type {number} */ h) => createMockCanvas(w, h);

// ─────────────────────────────────────────────────────────────────────────────

test('0. Le mock rasterise vraiment — sinon rien de ce qui suit ne vaut', () => {
  const c = champEclairant(10, 10, 30, 30);
  assert.equal(vuA(c, 20, 20), true, 'dans le rectangle');
  assert.equal(vuA(c, 50, 50), false, 'hors du rectangle');

  // Et `destination-in` coupe bien : une destination pleine, intersectée par un champ
  // restreint, ne garde que le champ.
  const dest = champEclairant(0, 0, MASQUE, MASQUE);
  dest._ctx.globalCompositeOperation = 'destination-in';
  dest._ctx.drawImage(c, 0, 0, MASQUE, MASQUE, 0, 0, MASQUE, MASQUE);
  assert.equal(vuA(dest, 20, 20), true);
  assert.equal(vuA(dest, 50, 50), false, 'destination-in doit RETIRER hors du champ');
});

test('1. ⭐ LA RÈGLE : une zone dans la ligne de vue mais NON éclairée n’est PAS vue', () => {
  // C'est tout le mode tactique. Avant ce chantier, `ambientLit` était un booléen GLOBAL à
  // l'étage : une seule lampe et l'étage entier basculait en « éclairé ».
  const cible = createMockCanvas(MASQUE, MASQUE);

  composeVisibleMask(cible, {
    losPolygons: [carre(0, 0, 1000, 1000)],          // le PJ voit toute la carte, sans mur
    nearPolygons: [],                                 // aucune vision propre
    litCanvas: champEclairant(0, 0, 40, MASQUE),      // moitié gauche éclairée seulement
    mapOrigin: ORIGIN,
    gridScale: GRID_SCALE,
    createCanvas: fabrique,
  });

  assert.equal(vuA(cible, 20, 40), true, 'côté éclairé : vu');
  assert.equal(vuA(cible, 60, 40), false, '⛔ côté non éclairé : NON vu, même en ligne de vue');
});

test('2. ⭐ La vision propre dans le noir S’AJOUTE, elle ne se fait pas rogner', () => {
  // ⚠ L'ordre des opérations n'est pas interchangeable : intersecter APRÈS l'union
  // rognerait la portée propre du PJ par l'obscurité, ce qui est exactement son contraire.
  // Sans ce terme, un PJ dans un couloir noir ne verrait rien du tout.
  const cible = createMockCanvas(MASQUE, MASQUE);

  composeVisibleMask(cible, {
    losPolygons: [carre(0, 0, 1000, 1000)],
    nearPolygons: [carre(500, 400, 800, 600)],   // le PJ est dans le noir, à droite
    litCanvas: champEclairant(0, 0, 40, MASQUE), // et la lumière est à gauche
    mapOrigin: ORIGIN,
    gridScale: GRID_SCALE,
    createCanvas: fabrique,
  });

  assert.equal(vuA(cible, 50, 40), true, '⭐ dans le noir mais à portée propre : VU');
  assert.equal(vuA(cible, 20, 40), true, 'et la zone éclairée reste vue');
  assert.equal(vuA(cible, 70, 10), false, 'ni éclairé ni à portée : non vu');
});

test('3. ⛔ UN MUR TIENT : une zone éclairée hors ligne de vue reste invisible', () => {
  // Le terme « ligne de vue » est ce qui empêche de voir à travers les murs toute zone
  // éclairée de l'étage. Le retirer serait la fuite la plus grave du chantier.
  const cible = createMockCanvas(MASQUE, MASQUE);

  composeVisibleMask(cible, {
    losPolygons: [carre(0, 0, 500, 1000)],        // le PJ ne voit que la moitié gauche
    nearPolygons: [],
    litCanvas: champEclairant(0, 0, MASQUE, MASQUE), // mais TOUT est éclairé
    mapOrigin: ORIGIN,
    gridScale: GRID_SCALE,
    createCanvas: fabrique,
  });

  assert.equal(vuA(cible, 20, 40), true, 'éclairé ET en ligne de vue : vu');
  assert.equal(vuA(cible, 60, 40), false, '⛔ éclairé mais DERRIÈRE LE MUR : jamais vu');
});

test('4. ⭐ Le halo derrière un angle n’est plus révélé — la §12 q.9 tombe', () => {
  // Avant : une lampe était un ŒIL. Si un PJ voyait son CENTRE, tout son halo était révélé,
  // y compris ce que le PJ ne pouvait pas voir lui-même. C'était l'approximation de q.9.
  //
  // Maintenant : la lampe éclaire, et c'est la ligne de vue du PJ VERS CHAQUE POINT qui
  // décide. On modélise ici une lampe dont le halo déborde de la ligne de vue du PJ.
  const cible = createMockCanvas(MASQUE, MASQUE);

  composeVisibleMask(cible, {
    // Le PJ voit une bande étroite — l'entrebâillement de la porte.
    losPolygons: [carre(0, 300, 1000, 500)],
    nearPolygons: [],
    // La lampe éclaire une pièce entière, bien plus haute que la bande.
    litCanvas: champEclairant(40, 0, 70, MASQUE),
    mapOrigin: ORIGIN,
    gridScale: GRID_SCALE,
    createCanvas: fabrique,
  });

  assert.equal(vuA(cible, 55, 32), true, 'la part du halo DANS l’entrebâillement est vue');
  assert.equal(vuA(cible, 55, 10), false, '⛔ le reste du halo, hors ligne de vue, ne l’est PAS');
  assert.equal(vuA(cible, 55, 70), false, '⛔ ni en dessous');
});

test('5. ⚠ Sans champ lumineux, le repli est la ligne de vue ENTIÈRE, jamais le noir', () => {
  // Mieux vaut le comportement d'avant le chantier qu'un écran noir en pleine séance. Ce
  // repli couvre le premier rendu, avant que le champ n'ait été composé.
  const cible = createMockCanvas(MASQUE, MASQUE);

  composeVisibleMask(cible, {
    losPolygons: [carre(0, 0, 1000, 1000)],
    nearPolygons: [],
    litCanvas: null,
    mapOrigin: ORIGIN,
    gridScale: GRID_SCALE,
    createCanvas: fabrique,
  });

  assert.equal(vuA(cible, 40, 40), true, '⛔ sans champ, on VOIT — on ne noircit pas la table');
  assert.equal(vuA(cible, 5, 5), true);
});

test('6. Le masque est VIDÉ à chaque composition — pas de vision fantôme', () => {
  // Le canvas est réutilisé d'une image à l'autre. Sans le vidage, une zone vue à l'image
  // précédente resterait vue après que le PJ s'en est éloigné : une fuite qui s'accumule.
  const cible = createMockCanvas(MASQUE, MASQUE);
  const opts = { nearPolygons: [], litCanvas: null, mapOrigin: ORIGIN, gridScale: GRID_SCALE, createCanvas: fabrique };

  composeVisibleMask(cible, { ...opts, losPolygons: [carre(0, 0, 1000, 1000)] });
  assert.equal(vuA(cible, 40, 40), true);

  composeVisibleMask(cible, { ...opts, losPolygons: [carre(0, 0, 200, 200)] });
  assert.equal(vuA(cible, 40, 40), false, '⛔ la vision précédente ne doit pas survivre');
  assert.equal(vuA(cible, 8, 8), true, 'la nouvelle, si');
});

test('7. Entrées absurdes : aucun masque plein par accident', () => {
  const cible = createMockCanvas(MASQUE, MASQUE);
  const base = { losPolygons: [carre(0, 0, 1000, 1000)], nearPolygons: [], litCanvas: null, gridScale: GRID_SCALE, createCanvas: fabrique };

  assert.equal(composeVisibleMask(cible, { ...base, mapOrigin: /** @type {any} */ (null) }), false);
  assert.equal(composeVisibleMask(cible, { ...base, mapOrigin: ORIGIN, gridScale: NaN }), false);
  assert.equal(composeVisibleMask(/** @type {any} */ (null), { ...base, mapOrigin: ORIGIN }), false);

  // Aucun PJ, aucune lumière : rien n'est vu. ⛔ Surtout pas tout.
  const vide = createMockCanvas(MASQUE, MASQUE);
  assert.equal(composeVisibleMask(vide, { ...base, losPolygons: [], mapOrigin: ORIGIN }), true);
  assert.equal(vuA(vide, 40, 40), false, '⛔ sans observateur, rien n’est vu');
  assert.equal(vuA(vide, 0, 0), false);
});
