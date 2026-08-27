// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import { LightField, cappedLightRange, parseLightColor } from '../js/vision/lightField.js';
import { FOG_MASK_PX_PER_CELL, VISION_MAX_RANGE_CELLS } from '../js/core/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Canvas 2D qui RASTERISE VRAIMENT.
//
// ⛔ Il ne peut pas se contenter de `arc() {}` et `fill() {}` comme celui de `fog.test.mjs` :
// ce qu'on éprouve ici est justement ce qui se peint, et où. Un mock qui n'écrit aucun pixel
// laisserait passer une composition qui ne dessine rien — c'est exactement la forme du faux
// vert que ce projet a déjà attrapée douze fois, dont une où le mock implémentait l'inverse
// du mécanisme testé.
//
// Il implémente donc : le remplissage d'un polygone par un dégradé radial, et les deux modes
// de fusion utilisés par `LightField` — `source-over` pour l'ambiante, `lighter` pour les
// sources. Sa propre justesse est éprouvée par le premier test du fichier.
// ─────────────────────────────────────────────────────────────────────────────

/** @param {number} width @param {number} height */
function createMockCanvas(width, height) {
  const pixels = new Float64Array(width * height * 4);

  /** @type {Array<{x: number, y: number}>} */
  let path = [];
  /** @type {any[]} */
  const journal = [];

  /**
   * @param {number} index
   * @param {[number, number, number]} couleur
   * @param {number} alpha
   * @param {string} mode
   */
  function fusionner(index, couleur, alpha, mode) {
    if (alpha <= 0) return;
    for (let canal = 0; canal < 3; canal++) {
      const source = couleur[canal] * alpha;
      if (mode === 'lighter') {
        // Additif PLAFONNÉ : c'est la borne à 255 qui réalise le plafonnement, exactement
        // comme le fait `globalCompositeOperation = 'lighter'` dans un vrai contexte.
        pixels[index + canal] = Math.min(255, pixels[index + canal] + source);
      } else {
        pixels[index + canal] = source + pixels[index + canal] * (1 - alpha);
      }
    }
    if (mode === 'lighter') {
      pixels[index + 3] = Math.min(255, pixels[index + 3] + alpha * 255);
    } else {
      pixels[index + 3] = alpha * 255 + pixels[index + 3] * (1 - alpha);
    }
  }

  /** @param {string} texte */
  function lireRgba(texte) {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(texte);
    if (!m) throw new Error(`Couleur non comprise par le mock : ${texte}`);
    return {
      couleur: /** @type {[number, number, number]} */ ([Number(m[1]), Number(m[2]), Number(m[3])]),
      alpha: m[4] === undefined ? 1 : Number(m[4]),
    };
  }

  /** @param {{x: number, y: number}} point @param {Array<{x: number, y: number}>} polygone */
  function dansLePolygone(point, polygone) {
    let dedans = false;
    for (let i = 0, j = polygone.length - 1; i < polygone.length; j = i++) {
      const pi = polygone[i];
      const pj = polygone[j];
      const traverse = pi.y > point.y !== pj.y > point.y;
      if (traverse && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x) {
        dedans = !dedans;
      }
    }
    return dedans;
  }

  const ctx = {
    width,
    height,
    pixels,
    journal,
    /** @type {any} */
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over',
    /** @type {string[]} */
    _pile: [],

    save() { this._pile.push(this.globalCompositeOperation); },
    restore() { this.globalCompositeOperation = this._pile.pop() ?? 'source-over'; },

    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    clearRect(x, y, w, h) {
      for (let ligne = Math.max(0, y | 0); ligne < Math.min(height, (y + h) | 0); ligne++) {
        for (let col = Math.max(0, x | 0); col < Math.min(width, (x + w) | 0); col++) {
          const index = (ligne * width + col) * 4;
          pixels[index] = 0; pixels[index + 1] = 0; pixels[index + 2] = 0; pixels[index + 3] = 0;
        }
      }
      journal.push({ op: 'clearRect' });
    },

    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    fillRect(x, y, w, h) {
      const { couleur, alpha } = lireRgba(String(this.fillStyle));
      journal.push({ op: 'fillRect', mode: this.globalCompositeOperation, alpha });
      for (let ligne = Math.max(0, y | 0); ligne < Math.min(height, (y + h) | 0); ligne++) {
        for (let col = Math.max(0, x | 0); col < Math.min(width, (x + w) | 0); col++) {
          fusionner((ligne * width + col) * 4, couleur, alpha, this.globalCompositeOperation);
        }
      }
    },

    /** @param {number} x0 @param {number} y0 @param {number} r0 @param {number} x1 @param {number} y1 @param {number} r1 */
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const stops = /** @type {Array<{ position: number, texte: string }>} */ ([]);
      journal.push({ op: 'gradient', centre: [x1, y1], rayon: r1 });
      return {
        __gradient: true,
        centre: { x: x1, y: y1 },
        rayon: r1,
        stops,
        /** @param {number} position @param {string} texte */
        addColorStop(position, texte) { stops.push({ position, texte }); },
      };
    },

    beginPath() { path = []; },
    /** @param {number} x @param {number} y */
    moveTo(x, y) { path.push({ x, y }); },
    /** @param {number} x @param {number} y */
    lineTo(x, y) { path.push({ x, y }); },
    closePath() {},

    fill() {
      const style = this.fillStyle;
      if (!style || !style.__gradient) throw new Error('Le mock n’attend un fill() qu’avec un dégradé.');
      if (path.length < 3) return;
      const mode = this.globalCompositeOperation;
      journal.push({ op: 'fill', mode, sommets: path.length });

      const debut = lireRgba(style.stops[0].texte);
      const fin = lireRgba(style.stops[style.stops.length - 1].texte);

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const point of path) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }

      for (let ligne = Math.max(0, Math.floor(minY)); ligne <= Math.min(height - 1, Math.ceil(maxY)); ligne++) {
        for (let col = Math.max(0, Math.floor(minX)); col <= Math.min(width - 1, Math.ceil(maxX)); col++) {
          const point = { x: col + 0.5, y: ligne + 0.5 };
          if (!dansLePolygone(point, path)) continue;
          const distance = Math.hypot(point.x - style.centre.x, point.y - style.centre.y);
          const t = Math.min(1, distance / Math.max(1e-9, style.rayon));
          const alpha = debut.alpha + (fin.alpha - debut.alpha) * t;
          fusionner((ligne * width + col) * 4, debut.couleur, alpha, mode);
        }
      }
    },
  };

  const canvas = {
    width,
    height,
    _ctx: ctx,
    /** @param {string} type */
    getContext(type) { return type === '2d' ? ctx : null; },
  };

  return { canvas, ctx };
}

/** Fabrique liée à un mock, pour l'injecter dans `LightField`. */
function fabrique() {
  /** @type {any} */
  let dernier = null;
  /** @param {number} w @param {number} h */
  const createCanvas = (w, h) => {
    dernier = createMockCanvas(w, h);
    return dernier.canvas;
  };
  return { createCanvas, ctxDe: () => dernier.ctx };
}

const GRID_SCALE = 100;
const ORIGIN = { x: 0, y: 0 };
const ECHELLE = FOG_MASK_PX_PER_CELL / GRID_SCALE; // 0,08 px de masque par pixel carte

/** @param {any} ctx @param {number} mx @param {number} my */
function pixelAu(ctx, mx, my) {
  const index = (my * ctx.width + mx) * 4;
  return {
    red: ctx.pixels[index],
    green: ctx.pixels[index + 1],
    blue: ctx.pixels[index + 2],
    alpha: ctx.pixels[index + 3],
  };
}

// ─────────────────────────────────────────────────────────────────────────────

test('0. Le mock lui-même est juste — sinon rien de ce qui suit ne vaut', () => {
  const { ctx } = createMockCanvas(4, 4);

  // source-over : une couche à 50 % de blanc sur du noir transparent donne 127,5.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fillRect(0, 0, 4, 4);
  assert.ok(Math.abs(pixelAu(ctx, 1, 1).red - 127.5) < 0.01, `obtenu ${pixelAu(ctx, 1, 1).red}`);

  // lighter : une seconde couche s'AJOUTE au lieu de recouvrir.
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(0, 0, 4, 4);
  assert.ok(Math.abs(pixelAu(ctx, 1, 1).red - (127.5 + 63.75)) < 0.01, `obtenu ${pixelAu(ctx, 1, 1).red}`);

  // et il PLAFONNE à 255, ce qui est tout l'objet du mode additif plafonné.
  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  ctx.fillRect(0, 0, 4, 4);
  assert.equal(pixelAu(ctx, 1, 1).red, 255);

  // save/restore rendent bien le mode de fusion, sans quoi la boucle de composition
  // laisserait `lighter` actif et le test n°4 mesurerait autre chose que ce qu'il croit.
  ctx.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.restore();
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('1. Une source éclaire, et son centre est plus clair que son bord', () => {
  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);

  const ok = champ.compose(
    [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 1, color: '#ffffff' }],
    { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );
  assert.equal(ok, true);
  assert.equal(champ.paintedCount, 1);

  const ctx = ctxDe();
  const centre = pixelAu(ctx, 40, 40);          // 500 px carte × 0,08
  const milieu = pixelAu(ctx, 40 + 12, 40);     // à mi-rayon
  const dehors = pixelAu(ctx, 40 + 30, 40);     // au-delà des 24 px de rayon

  assert.ok(centre.red > 200, `centre attendu lumineux, obtenu ${centre.red}`);
  assert.ok(milieu.red > 0 && milieu.red < centre.red, `mi-rayon attendu intermédiaire, obtenu ${milieu.red}`);
  assert.equal(dehors.red, 0, 'au-delà de la portée, aucune lumière');
});

test('2. ⭐ L’OCCLUSION : un mur ampute le champ, et c’est le sweep qui le fait', () => {
  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);

  // Un mur vertical en x = 600 px carte, soit x = 48 px de masque. La source est à sa gauche.
  const mur = { p1: { x: 600, y: 0 }, p2: { x: 600, y: 1000 } };

  champ.compose(
    [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 1, color: '#ffffff' }],
    { ambientLevel: 0, segments: [mur], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );

  const ctx = ctxDe();
  const avantLeMur = pixelAu(ctx, 44, 40);  // x = 550 px carte : entre la source et le mur
  const apresLeMur = pixelAu(ctx, 54, 40);  // x = 675 px carte : derrière le mur, dans la portée
  const aGauche = pixelAu(ctx, 34, 40);     // du côté opposé : rien ne bloque

  assert.ok(avantLeMur.red > 0, 'entre la source et le mur, la lumière passe');
  assert.ok(aGauche.red > 0, 'du côté libre, la lumière passe');
  assert.equal(apresLeMur.red, 0, '⛔ derrière le mur, AUCUNE lumière — sinon la vision traverserait');

  // ⭐ Preuve par mutation : si la forme peinte était le disque complet au lieu du polygone de
  // sweep, `apresLeMur` serait éclairé — il est à 175 px carte du centre, pour 300 de portée.
  const distanceCarte = Math.hypot(675 - 500, 500 - 500);
  assert.ok(distanceCarte < 300, 'le cas n’est probant que si le point est DANS la portée');
});

test('3. ⭐ ADDITIF PLAFONNÉ : deux halos se somment, et rien ne dépasse 255', () => {
  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);

  // Deux sources faibles au MÊME endroit : leur recouvrement est total.
  const source = (/** @type {number} */ intensite) => ({
    center: { x: 500, y: 500 }, radiusPx: 300, intensity: intensite, color: '#ffffff',
  });

  champ.compose([source(0.3)], { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE });
  const seule = pixelAu(ctxDe(), 40, 40).red;

  champ.compose([source(0.3), source(0.3)], { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE });
  const deux = pixelAu(ctxDe(), 40, 40).red;

  // ⭐ La mutation visée : passer `lighter` à `source-over` rendrait `deux === seule`, la
  // seconde source recouvrant simplement la première.
  assert.ok(deux > seule * 1.8, `deux sources doivent s’ajouter : seule ${seule}, deux ${deux}`);

  // Et le plafond : quatre sources à pleine intensité ne débordent pas.
  champ.compose(
    [source(1), source(1), source(1), source(1)],
    { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );
  const quatre = pixelAu(ctxDe(), 40, 40);
  assert.equal(quatre.red, 255, 'plafonné, jamais au-delà');
  assert.ok(quatre.alpha <= 255);
});

test('4. ⭐ L’AMBIANTE EST UN CONTINU, pas une bascule — décision §4.3', () => {
  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);

  champ.compose([], { ambientLevel: 0.35, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE });
  const gris = pixelAu(ctxDe(), 5, 5);

  // 0,35 × 255 = 89,25. ⭐ C'est LA mutation qui compte : le moteur lisait l'ambiante comme
  // `baked || level > 0`, donc 0,35 valait plein jour. Rétablir ce prédicat rendrait 255 ici.
  assert.ok(Math.abs(gris.red - 89.25) < 0.5, `0,35 doit rendre 89, obtenu ${gris.red}`);
  assert.notEqual(gris.red, 255, '⛔ une ambiante à 0,35 n’est PAS du plein jour');

  // Un coin éloigné de toute source porte la même valeur : l'ambiante est un plancher uniforme.
  assert.ok(Math.abs(pixelAu(ctxDe(), 78, 78).red - gris.red) < 0.01);

  // Et elle reste le plancher : une source par-dessus ajoute, elle ne remplace pas.
  champ.compose(
    [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 0.5, color: '#ffffff' }],
    { ambientLevel: 0.35, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );
  const sousLaSource = pixelAu(ctxDe(), 40, 40).red;
  assert.ok(sousLaSource > gris.red, 'la source s’ajoute au plancher ambiant');

  // Ambiante nulle : le noir est vraiment noir, sinon les joueurs verraient partout.
  champ.compose([], { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE });
  assert.equal(pixelAu(ctxDe(), 5, 5).alpha, 0, '⛔ ambiante à 0 : aucune lumière nulle part');
});

test('5. La couleur de la source est honorée — décision §4.4a', () => {
  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);

  champ.compose(
    [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 1, color: '#FFE5BF' }],
    { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );
  const centre = pixelAu(ctxDe(), 40, 40);

  // `#FFE5BF` est l'une des neuf teintes réellement présentes dans le corpus.
  //
  // ⚠ On éprouve les RAPPORTS entre canaux, pas des valeurs absolues : le pixel échantillonné
  // est à un demi-pixel du centre du dégradé, donc déjà atténué de ~3 %. Cette atténuation est
  // le comportement voulu — l'affirmation à tenir est que **la teinte survit au rendu**, et
  // une teinte est un rapport.
  assert.ok(centre.red > 200, `le centre doit être lumineux, obtenu ${centre.red}`);
  assert.ok(
    Math.abs(centre.green / centre.red - 229 / 255) < 0.01,
    `vert/rouge attendu ${(229 / 255).toFixed(3)}, obtenu ${(centre.green / centre.red).toFixed(3)}`
  );
  assert.ok(
    Math.abs(centre.blue / centre.red - 191 / 255) < 0.01,
    `bleu/rouge attendu ${(191 / 255).toFixed(3)}, obtenu ${(centre.blue / centre.red).toFixed(3)}`
  );
  // ⭐ La mutation : peindre du blanc en dur rendrait les trois canaux égaux, donc les deux
  // rapports ci-dessus à 1,000 — très loin des 0,898 et 0,749 attendus.
  assert.ok(centre.red > centre.green && centre.green > centre.blue, 'la teinte doit survivre au rendu');
});

test('6. L’intensité module réellement, et 0 ne peint rien', () => {
  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);
  const source = (/** @type {number} */ i) => ({
    center: { x: 500, y: 500 }, radiusPx: 300, intensity: i, color: '#ffffff',
  });
  const opts = { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE };

  champ.compose([source(1)], opts);
  const pleine = pixelAu(ctxDe(), 40, 40).red;
  champ.compose([source(0.5)], opts);
  const moitie = pixelAu(ctxDe(), 40, 40).red;

  assert.ok(Math.abs(moitie - pleine / 2) < 1, `moitié attendue ${pleine / 2}, obtenue ${moitie}`);

  // Intensité nulle ou portée nulle : la source n'est pas peinte du tout, et le compteur le dit.
  champ.compose([source(0)], opts);
  assert.equal(champ.paintedCount, 0);
  assert.equal(pixelAu(ctxDe(), 40, 40).alpha, 0);

  champ.compose([{ ...source(1), radiusPx: 0 }], opts);
  assert.equal(champ.paintedCount, 0);
});

test('7. ⚠ Une couleur illisible rend du BLANC, jamais du noir', () => {
  // Une source muette serait un trou noir dans le champ — donc, en mode tactique, une zone
  // que la table ne verrait plus. Le défaut serait invisible en relecture.
  assert.deepEqual(parseLightColor('#ffffff'), { red: 255, green: 255, blue: 255 });
  assert.deepEqual(parseLightColor('#FFE5BF'), { red: 255, green: 229, blue: 191 });
  assert.deepEqual(parseLightColor('#fb0'), { red: 255, green: 187, blue: 0 }, 'forme courte acceptée');

  for (const illisible of ['pouet', '', '#12345', 'rgb(1,2,3)', undefined, null, 42]) {
    assert.deepEqual(
      parseLightColor(/** @type {any} */ (illisible)),
      { red: 255, green: 255, blue: 255 },
      `« ${String(illisible)} » doit rendre du blanc`
    );
  }

  const { createCanvas, ctxDe } = fabrique();
  const champ = new LightField(10, 10, createCanvas);
  champ.compose(
    [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 1, color: /** @type {any} */ ('pouet') }],
    { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );
  assert.ok(pixelAu(ctxDe(), 40, 40).red > 200, 'une couleur illisible éclaire quand même');
});

test('8. La portée est plafonnée comme celle de la vision', () => {
  assert.equal(cappedLightRange(5), 5);
  assert.equal(cappedLightRange(999), VISION_MAX_RANGE_CELLS);
  assert.equal(cappedLightRange(-3), 0);
  assert.equal(cappedLightRange(NaN), 0);
  assert.equal(cappedLightRange(undefined), 0);
  // ⭐ Le plafond n'est pas décoratif : sans lui, un sweep sur carte dense passait de 2 ms à
  // 347 ms (tranche L-02). Aucune source du corpus ne l'atteint — la plus longue porte à 10.
  assert.equal(VISION_MAX_RANGE_CELLS, 20);
});

test('9. La révision rend la mutation observable — sans quoi tout cache resterait figé', () => {
  const { createCanvas } = fabrique();
  const champ = new LightField(10, 10, createCanvas);

  const depart = champ.revision;
  assert.equal(champ.canvas.__lightRevision, depart, 'la révision est recopiée sur le canvas');

  champ.compose(
    [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 1, color: '#ffffff' }],
    { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
  );
  assert.ok(champ.revision > depart, 'composer doit incrémenter la révision');
  assert.equal(champ.canvas.__lightRevision, champ.revision);

  // ⭐ Le canvas est muté EN PLACE : son identité ne change jamais. Un cache qui ne comparerait
  // que la référence resterait bloqué sur le premier champ composé — c'est le défaut exact que
  // `ExploredFog._touch()` avait été écrit pour rendre impossible.
  const avant = champ.canvas;
  champ.compose([], { ambientLevel: 1, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE });
  assert.equal(champ.canvas, avant, 'le canvas ne doit pas être remplacé');
  assert.notEqual(champ.canvas.__lightRevision, depart);
});

test('10. Dimensions du masque, et refus des entrées qui ne veulent rien dire', () => {
  const { createCanvas } = fabrique();
  const champ = new LightField(42, 42, createCanvas);
  assert.equal(champ.maskWidth, 42 * FOG_MASK_PX_PER_CELL);
  assert.equal(champ.maskHeight, 42 * FOG_MASK_PX_PER_CELL);
  assert.equal(champ.maskWidth, 336, 'le village étage 00 fait bien 336 px de masque');

  const opts = { ambientLevel: 0, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE };
  // Une composition sans origine ni échelle ne compose PAS : elle ne se rabat pas sur 0, ce
  // qui empilerait toutes les sources dans le coin supérieur gauche sans rien dire.
  assert.equal(champ.compose([], { ...opts, mapOrigin: /** @type {any} */ (null) }), false);
  assert.equal(champ.compose([], { ...opts, gridScale: /** @type {any} */ (NaN) }), false);
  assert.equal(champ.compose([], opts), true);

  // Sources absurdes : ignorées une par une, jamais une composition avortée.
  assert.equal(
    champ.compose(/** @type {any} */ ([null, undefined, {}, { center: null }]), opts),
    true
  );
  assert.equal(champ.paintedCount, 0);
});

test('11. Un champ sans contexte de dessin ne prétend pas avoir composé', () => {
  // Le cas du nœud sans DOM : `LightField` reste construisible, mais `compose` dit non.
  const champ = new LightField(10, 10, () => ({ getContext: () => null }));
  assert.equal(champ.ctx, null);
  assert.equal(
    champ.compose(
      [{ center: { x: 500, y: 500 }, radiusPx: 300, intensity: 1, color: '#fff' }],
      { ambientLevel: 1, segments: [], mapOrigin: ORIGIN, gridScale: GRID_SCALE }
    ),
    false,
    '⛔ rendre `true` ferait croire à un champ composé qui n’existe pas'
  );
});
