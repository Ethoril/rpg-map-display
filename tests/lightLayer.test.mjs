// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import { LightLayer, collectLightSources, buildLightSignature } from '../js/render/layers/light.js';
import { createLevel, createToken } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import {
  FOG_MASK_PX_PER_CELL,
  LIGHT_GM_DARKNESS_RATIO,
  LIGHT_NIGHT_VISION_FLOOR,
  LIGHT_COLOR_VISION_GAIN,
  LIGHT_GLOW_GAIN,
  FOG_VEIL_GM_UNEXPLORED,
  FOG_VEIL_GM_EXPLORED,
  FOG_VEIL_PLAYER_UNEXPLORED,
  FOG_VEIL_PLAYER_EXPLORED,
} from '../js/core/constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Canvas 2D — volontairement plus mince que celui de `lightField.test.mjs`.
//
// ⚠ **Ce qu'il ne couvre PAS, et il faut le lire avant d'y ajouter un test** : il enregistre
// les `fill()` sans les rasteriser. La fidélité de la COMPOSITION (dégradés, occlusion,
// additif plafonné, teinte) est éprouvée dans `lightField.test.mjs`, avec un mock qui
// rasterise pour de bon. Ici on éprouve autre chose : ce que la COUCHE décide — quand elle
// recompose, quand elle ne peint rien, et par quel mode de fusion elle applique le champ.
//
// ⭐ Les tests qui ont besoin de pixels réels se servent de l'**ambiante**, qui remplit le
// champ d'un `fillRect` uniforme : ni dégradé ni polygone, donc aucune zone d'ombre du mock.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⭐ `rasterise` (ajouté le 02/10/2026, pour le HALO) : le `fill()` remplit alors vraiment le
 * polygone tracé d'un dégradé radial, arrêts interpolés par morceaux — la même règle que le mock
 * de `lightField.test.mjs`. Sans l'option, `fill()` reste un simple journal : tous les tests
 * d'avant le halo tournent sur ce mock mince, inchangé.
 *
 * @param {number} width @param {number} height @param {{ rasterise?: boolean }} [options]
 */
function createMockCanvas(width, height, options = {}) {
  const pixels = new Float64Array(width * height * 4);
  /** @type {Array<{x: number, y: number}>} */
  let chemin = [];
  /** @type {any[]} */
  const journal = [];

  /** @param {string} texte */
  function lireRgba(texte) {
    if (texte === '#000000') return { couleur: [0, 0, 0], alpha: 1 };
    // ⭐ Ajouté pour le stencil « vu sans lumière » (`_construireStencilNocturne`), qui remplit
    // en blanc — gris opaque achromatique, voir son commentaire. Même convention que le noir
    // ci-dessus : un littéral reconnu tel quel, pas une entrée de plus dans la regex `rgba?`.
    if (texte === '#ffffff') return { couleur: [255, 255, 255], alpha: 1 };
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(texte);
    if (!m) return { couleur: [0, 0, 0], alpha: 1 };
    return {
      couleur: [Number(m[1]), Number(m[2]), Number(m[3])],
      alpha: m[4] === undefined ? 1 : Number(m[4]),
    };
  }

  /** @param {number} index @param {number[]} couleur @param {number} alpha @param {string} mode */
  function fusionner(index, couleur, alpha, mode) {
    for (let canal = 0; canal < 3; canal++) {
      const source = couleur[canal] * alpha;
      if (mode === 'lighter') {
        pixels[index + canal] = Math.min(255, pixels[index + canal] + source);
      } else if (mode === 'multiply') {
        // Forme de Porter-Duff complète, et elle n'est pas facultative ici : le terme qui
        // compte est `as·(1−ab)·Cs`, celui qui s'applique là où la DESTINATION est
        // transparente. Il dit qu'une source opaque posée sur du transparent s'y écrit
        // **telle quelle**, sans être multipliée par quoi que ce soit — c'est tout l'objet
        // du test n°8, et l'ignorer donnerait un mock qui blanchit là où le vrai Canvas
        // peint, ou l'inverse.
        const ab = pixels[index + 3] / 255;
        const fondPremultiplie = pixels[index + canal];
        const fond = ab > 0 ? fondPremultiplie / ab : 0;
        const src = couleur[canal];
        pixels[index + canal] =
          alpha * (1 - ab) * src +
          alpha * ab * ((src * fond) / 255) +
          (1 - alpha) * fondPremultiplie;
      } else if (mode === 'screen') {
        // Même forme de Porter-Duff complète que `multiply` ci-dessus, avec
        // `B(Cb, Cs) = Cb + Cs − Cb·Cs` : jamais au-delà du blanc. Sur une destination
        // transparente, la source s'écrit telle quelle à sa propre opacité.
        const ab = pixels[index + 3] / 255;
        const fondPremultiplie = pixels[index + canal];
        const fond = ab > 0 ? fondPremultiplie / ab : 0;
        const src = couleur[canal];
        pixels[index + canal] =
          alpha * (1 - ab) * src +
          alpha * ab * (src + fond - (src * fond) / 255) +
          (1 - alpha) * fondPremultiplie;
      } else if (mode === 'saturation') {
        // Mode NON séparable : traité d'un bloc plus bas, sur les trois canaux à la fois.
      } else if (mode === 'destination-out' || mode === 'destination-in') {
        // Ne touchent pas les couleurs, ne rongent que l'alpha. Traité plus bas.
      } else {
        pixels[index + canal] = source + pixels[index + canal] * (1 - alpha);
      }
    }
    if (mode === 'saturation') {
      // ⭐ Ajouté le 02/10/2026 : avant, ce mode tombait sur `source-over` et peignait le stencil
      // blanc par-dessus le décor. Modèle borné à ce que la couche y dessine — un stencil GRIS,
      // de saturation nulle : `B(Cb, Cs)` est alors le gris de même luminance que `Cb`.
      const ab = pixels[index + 3] / 255;
      if (ab > 0) {
        const [r, g, b] = [pixels[index] / ab, pixels[index + 1] / ab, pixels[index + 2] / ab];
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        for (let canal = 0; canal < 3; canal++) {
          pixels[index + canal] = alpha * ab * lum + (1 - alpha) * pixels[index + canal];
        }
      }
      pixels[index + 3] = alpha * 255 + pixels[index + 3] * (1 - alpha);
    } else if (mode === 'destination-out') {
      pixels[index + 3] = pixels[index + 3] * (1 - alpha);
    } else if (mode === 'destination-in') {
      // ⭐ Ajouté pour le stencil « vu sans lumière » (`_construireStencilNocturne`) : ne
      // garde de la destination que ce que la SOURCE couvre — `resultAlpha = destAlpha ×
      // srcAlpha`. C'est un modèle, pas le Porter-Duff complet : comme `destination-out`
      // ci-dessus, il ne touche pas la couleur, ce qui suffit ici puisque le stencil est
      // rempli d'un gris opaque uniforme avant cette étape.
      pixels[index + 3] = pixels[index + 3] * alpha;
    } else if (mode === 'lighter') {
      pixels[index + 3] = Math.min(255, pixels[index + 3] + alpha * 255);
    } else if (mode === 'multiply') {
      pixels[index + 3] = alpha * 255 + pixels[index + 3] * (1 - alpha);
    } else {
      pixels[index + 3] = alpha * 255 + pixels[index + 3] * (1 - alpha);
    }
  }

  // Typé `any` volontairement : c'est un mock, il n'implémente que les quelques membres
  // de `CanvasRenderingContext2D` dont la couche se sert. Le typer strictement demanderait
  // d'en écrire 58 autres qui ne serviraient à rien.
  const ctx = /** @type {any} */ ({
    width,
    height,
    pixels,
    journal,
    /** @type {any} */
    fillStyle: '#000000',
    globalCompositeOperation: 'source-over',
    // ⚠ `globalAlpha` n'est pas décoratif ici : c'est LUI qui porte l'atténuation de la vue MJ.
    // Un mock qui l'ignorerait rendrait le test n°12 vert quoi qu'il arrive.
    globalAlpha: 1,
    /** @type {any[]} */
    _pile: [],
    canvas: /** @type {any} */ (null),

    save() { this._pile.push({ op: this.globalCompositeOperation, alpha: this.globalAlpha }); },
    restore() {
      const etat = this._pile.pop() ?? { op: 'source-over', alpha: 1 };
      this.globalCompositeOperation = etat.op;
      this.globalAlpha = etat.alpha;
    },

    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    clearRect(x, y, w, h) {
      for (let ligne = Math.max(0, y | 0); ligne < Math.min(height, (y + h) | 0); ligne++) {
        for (let col = Math.max(0, x | 0); col < Math.min(width, (x + w) | 0); col++) {
          const index = (ligne * width + col) * 4;
          pixels[index] = 0; pixels[index + 1] = 0; pixels[index + 2] = 0; pixels[index + 3] = 0;
        }
      }
    },

    /** @param {number} x @param {number} y @param {number} w @param {number} h */
    fillRect(x, y, w, h) {
      const { couleur, alpha } = lireRgba(String(this.fillStyle));
      journal.push({ op: 'fillRect', mode: this.globalCompositeOperation });
      for (let ligne = Math.max(0, y | 0); ligne < Math.min(height, (y + h) | 0); ligne++) {
        for (let col = Math.max(0, x | 0); col < Math.min(width, (x + w) | 0); col++) {
          fusionner((ligne * width + col) * 4, couleur, alpha, this.globalCompositeOperation);
        }
      }
    },

    /** @param {number} x0 @param {number} y0 @param {number} r0 @param {number} x1 @param {number} y1 @param {number} r1 */
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      journal.push({ op: 'gradient' });
      /** @type {Array<{ position: number, texte: string }>} */
      const stops = [];
      return {
        __gradient: true, centre: { x: x1, y: y1 }, rayon: r1, stops,
        /** @param {number} position @param {string} texte */
        addColorStop(position, texte) { stops.push({ position, texte }); },
      };
    },
    beginPath() { chemin = []; },
    /** @param {number} x @param {number} y */
    moveTo(x, y) { chemin.push({ x, y }); },
    /** @param {number} x @param {number} y */
    lineTo(x, y) { chemin.push({ x, y }); },
    closePath() {},
    fill() {
      journal.push({ op: 'fill', mode: this.globalCompositeOperation });
      const style = this.fillStyle;
      if (!options.rasterise || !style?.__gradient || style.stops.length === 0 || chemin.length < 3) return;
      const arrets = style.stops.map((/** @type {any} */ s) => ({ position: s.position, ...lireRgba(s.texte) }));
      /** @param {number} t */
      const alphaA = (t) => {
        for (let k = 1; k < arrets.length; k++) {
          if (t <= arrets[k].position) {
            const a = arrets[k - 1];
            const b = arrets[k];
            const u = b.position > a.position ? (t - a.position) / (b.position - a.position) : 1;
            return a.alpha + (b.alpha - a.alpha) * u;
          }
        }
        return arrets[arrets.length - 1].alpha;
      };
      for (let ligne = 0; ligne < height; ligne++) {
        for (let col = 0; col < width; col++) {
          const point = { x: col + 0.5, y: ligne + 0.5 };
          let dedans = false;
          for (let i = 0, j = chemin.length - 1; i < chemin.length; j = i++) {
            const pi = chemin[i];
            const pj = chemin[j];
            if (pi.y > point.y !== pj.y > point.y &&
                point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x) dedans = !dedans;
          }
          if (!dedans) continue;
          const t = Math.min(1, Math.hypot(point.x - style.centre.x, point.y - style.centre.y) / Math.max(1e-9, style.rayon));
          const alpha = alphaA(t);
          if (alpha > 0) fusionner((ligne * width + col) * 4, arrets[0].couleur, alpha, this.globalCompositeOperation);
        }
      }
    },

    /** @param {any} image @param {...number} reste */
    drawImage(image, ...reste) {
      const mode = this.globalCompositeOperation;
      // `params` porte les arguments REÇUS tels quels : c'est le seul moyen d'éprouver la
      // taille de destination sur son EFFET — ce qui est réellement demandé au contexte —
      // plutôt que sur une variable interne de la couche.
      journal.push({ op: 'drawImage', mode, args: reste.length, params: reste, source: image ? { width: image.width, height: image.height } : null });
      const src = image?._ctx;
      if (!src) return;
      // Rééchantillonnage au plus proche voisin. `reste` vaut soit [dx, dy], soit les neuf
      // arguments de la forme complète — la couche se sert de la seconde.
      const [sx, sy, sw, sh, dx, dy, dw, dh] = reste.length >= 8
        ? reste
        : [0, 0, src.width, src.height, reste[0] ?? 0, reste[1] ?? 0, src.width, src.height];

      for (let ligne = Math.max(0, dy | 0); ligne < Math.min(height, (dy + dh) | 0); ligne++) {
        for (let col = Math.max(0, dx | 0); col < Math.min(width, (dx + dw) | 0); col++) {
          const srcCol = Math.min(src.width - 1, (sx + ((col - dx) / dw) * sw) | 0);
          const srcLigne = Math.min(src.height - 1, (sy + ((ligne - dy) / dh) * sh) | 0);
          const srcIndex = (srcLigne * src.width + srcCol) * 4;
          const alpha = (src.pixels[srcIndex + 3] / 255) * this.globalAlpha;
          // `destination-in` rejoint `multiply` dans cette exception : une source à alpha NUL
          // doit y EFFACER la destination (`destAlpha × 0 = 0`), ce n'est pas un no-op comme
          // pour `lighter`/`destination-out`. Sauter l'appel y laisserait le stencil « vu sans
          // lumière » plein hors de la zone visible — exactement l'inverse de ce qu'il doit
          // modéliser.
          if (alpha <= 0 && mode !== 'multiply' && mode !== 'destination-in') continue;
          fusionner(
            (ligne * width + col) * 4,
            [src.pixels[srcIndex], src.pixels[srcIndex + 1], src.pixels[srcIndex + 2]],
            alpha,
            mode
          );
        }
      }
    },
  });

  const canvas = /** @type {any} */ ({
    width, height, _ctx: ctx,
    /** @param {string} type */
    getContext(type) { return type === '2d' ? ctx : null; },
  });
  ctx.canvas = canvas;
  return canvas;
}

/** @param {number} w @param {number} h */
const fabrique = (w, h) => createMockCanvas(w, h);

/** Adaptateur de pavage minimal : une case vaut 100 pixels carte, en carré. */
const ADAPTATEUR = {
  /** @param {{cellX: number, cellY: number}} p */
  mapFromCellPoint: (p) => ({ x: p.cellX * 100, y: p.cellY * 100 }),
  /** @param {{cellX: number, cellY: number}} p Lecture de la géométrie (D-11), carrée elle aussi */
  mapFromGeometryPoint: (p) => ({ x: p.cellX * 100, y: p.cellY * 100 }),
  /** @param {{cellX: number, cellY: number}} cp @param {number} sizeCells */
  cellBounds: (cp, sizeCells) => {
    const size = Math.max(1, sizeCells || 1);
    return { x: cp.cellX * 100, y: cp.cellY * 100, width: size * 100, height: size * 100 };
  },
  // Un vrai `GridAdapter` tient ses dimensions du niveau qui l'a construit. Ce faux-ci est
  // partagé par tout le fichier, donc `etage()` les lui repose à chaque niveau fabriqué.
  widthCells: 10,
  heightCells: 10,
  /** @returns {{width: number, height: number}} */
  mapExtent() {
    return { width: this.widthCells * 100, height: this.heightCells * 100 };
  },
  /** @returns {{x: number, y: number}} */
  cellPitch() {
    return { x: 100, y: 100 };
  },
  /** @returns {{x: number, y: number, width: number, height: number}} */
  maskRect() {
    return { x: 0, y: 0, width: this.widthCells * 100, height: this.heightCells * 100 };
  },
};

/**
 * ⛔ **Repose les dimensions sur `ADAPTATEUR` — ne pas retirer.** Écrire ici un `mapExtent`
 * constant, ou le recopier à la main dans le faux adaptateur, ferait exactement le faux vert
 * que ce projet a déjà payé : le test passerait pendant qu'en production la carte serait
 * mesurée autrement. Un seul endroit fabrique le niveau, donc un seul fixe les deux.
 *
 * @param {any} overrides
 */
function etage(overrides = {}) {
  const level = createLevel({ id: 'lvl-1', widthCells: 10, heightCells: 10, ...overrides });
  ADAPTATEUR.widthCells = level.widthCells;
  ADAPTATEUR.heightCells = level.heightCells;
  return level;
}

/** Le champ interne de la couche. Il existe des que `update` a tourne ; le cas nul est
 *  eprouve separement au test n°10.
 *  @param {LightLayer} couche @returns {any} */
function champDe(couche) {
  return couche._field;
}

/** @param {any} ctx @param {number} x @param {number} y */
function pixelAu(ctx, x, y) {
  const index = (y * ctx.width + x) * 4;
  return { red: ctx.pixels[index], alpha: ctx.pixels[index + 3] };
}

// ─────────────────────────────────────────────────────────────────────────────

test('1. ⭐ LA propriété du modèle : déplacer un PJ ne recompose RIEN', () => {
  // Le champ est une propriété de la carte — une lampe éclaire qu'on la regarde ou non.
  // C'est cette séparation qui fait tomber la question 9 du §12 : la vision dépend de
  // l'observateur, l'éclairage non.
  //
  // ⭐ Preuve par mutation : recopier `buildVisionSignature` (qui, lui, inclut les PJ avec
  // leur case et leur `move`) ferait rougir ce test — et recomposerait 93 sources à chaque
  // pas d'un pion en séance.
  const level = etage({ lights: [{ id: 'l1', at: { cellX: 3, cellY: 3 }, range: 4, intensity: 1, color: '#ffffff', shadows: true }] });
  const pj = createToken({ id: 'pj', levelId: 'lvl-1', kind: 'pc', cell: { a: 1, b: 1 }, visionDim: 6 });

  const avant = buildLightSignature(level, [pj], ADAPTATEUR);
  const deplace = { ...pj, cell: { a: 7, b: 8 } };
  const apres = buildLightSignature(level, [deplace], ADAPTATEUR);

  assert.equal(avant, apres, '⛔ un PJ qui bouge ne doit pas invalider le champ lumineux');
  assert.ok(avant.includes('l:l1'), 'la lampe, elle, est bien dans la signature');
  assert.ok(!avant.includes('pj'), 'aucun PJ ne doit apparaître dans la signature');

  // Et la couche ne recompose effectivement pas.
  const couche = new LightLayer({ createCanvas: fabrique });
  assert.equal(couche.update(ADAPTATEUR, level, [pj]), true, 'premier calcul');
  assert.equal(couche.update(ADAPTATEUR, level, [deplace]), false, '⛔ pas de recomposition');
});

test('2. Une torche PORTÉE, elle, recompose quand son porteur bouge', () => {
  // ⚠ Ambiante NULLE, et c'est indispensable : à ambiante pleine le champ est déjà blanc et
  // aucune source n'est balayée — la torche n'aurait rien à composer. Le défaut du 27/08 :
  // ce test utilisait l'étage par défaut, à ambiante 1.
  const level = etage({ ambient: { level: 0, baked: false } });
  const porteur = createToken({
    id: 'torche', levelId: 'lvl-1', kind: 'npc', cell: { a: 2, b: 2 },
    emitsLight: { range: 6, intensity: 1, color: '#ffdca8' },
  });

  const couche = new LightLayer({ createCanvas: fabrique });
  assert.equal(couche.update(ADAPTATEUR, level, [porteur]), true);
  assert.equal(couche.lastSourceCount, 1, 'la torche est bien une source');
  assert.equal(
    couche.update(ADAPTATEUR, level, [{ ...porteur, cell: { a: 5, b: 5 } }]),
    true,
    'déplacer une source doit recomposer'
  );

  // Un pion sans `emitsLight` n'est pas une source, et ne compte pas dans la signature.
  const muet = createToken({ id: 'muet', levelId: 'lvl-1', kind: 'npc', cell: { a: 9, b: 9 } });
  const avec = buildLightSignature(level, [porteur, muet], ADAPTATEUR);
  const sans = buildLightSignature(level, [porteur], ADAPTATEUR);
  assert.equal(avec, sans);
});

test('3. Ouvrir une porte recompose — l’occlusion change, donc le champ aussi', () => {
  const porte = { id: 'p1', a: { cellX: 4, cellY: 0 }, b: { cellX: 4, cellY: 1 }, state: 'closed', freestanding: false };
  const level = etage({ portals: [porte] });
  const ouvert = etage({ portals: [{ ...porte, state: 'open' }] });

  assert.notEqual(
    buildLightSignature(level, [], ADAPTATEUR),
    buildLightSignature(ouvert, [], ADAPTATEUR),
    '⛔ une porte qui s’ouvre doit invalider le champ'
  );

  // Un mur déplacé aussi : l'éditeur de murs travaille en séance.
  const avecMur = etage({ walls: [[{ cellX: 1, cellY: 1 }, { cellX: 1, cellY: 5 }]] });
  assert.notEqual(buildLightSignature(level, [], ADAPTATEUR), buildLightSignature(avecMur, [], ADAPTATEUR));
});

test('4. ⭐ L’ambiante entre par sa VALEUR — 0,35 se distingue de 1', () => {
  // Décision §4.3 : le moteur lit un continu. Le prédicat `baked || level > 0` de la vision
  // rendrait ces deux signatures identiques, donc un demi-jour resterait affiché en plein jour.
  const sombre = etage({ ambient: { level: 0.35, baked: false } });
  const plein = etage({ ambient: { level: 1, baked: false } });
  assert.notEqual(
    buildLightSignature(sombre, [], ADAPTATEUR),
    buildLightSignature(plein, [], ADAPTATEUR),
    '⛔ 0,35 et 1 doivent produire des champs différents'
  );

  // ⛔ **`baked` ne force plus la pleine ambiance — corrigé le 27/08/2026.** Le drapeau de
  // Dungeon Alchemist vaut `true` en toutes circonstances ; le forcer rendait sans effet tout
  // réglage « Nuit » du mainteneur. Seul le NIVEAU décide désormais.
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, etage({ ambient: { level: 0, baked: true } }), []);
  const champ = champDe(couche);
  assert.ok(champ, 'un champ existe');
  assert.equal(
    pixelAu(champ.canvas._ctx, 5, 5).alpha, 0,
    '⛔ un étage cuit réglé sur Nuit est SOMBRE : le drapeau n’impose plus rien'
  );
});

test('5. Une torche éclaire depuis le MILIEU de son pion, pas depuis un coin', () => {
  const level = etage();
  const grand = createToken({
    id: 'ogre', levelId: 'lvl-1', kind: 'npc', cell: { a: 4, b: 4 }, sizeCells: 2,
    emitsLight: { range: 5, intensity: 1, color: '#ffffff' },
  });

  const [source] = collectLightSources(level, [grand], ADAPTATEUR);
  // Case (4,4), taille 2 ⇒ centre en (5,5) cases ⇒ (500, 500) pixels carte.
  assert.deepEqual(source.center, { x: 500, y: 500 });
  assert.equal(source.radiusPx, 500, '5 cases × 100 px');

  // ⭐ La mutation : oublier `+ taille / 2` placerait la source en (400, 400), soit une case
  // entière de décalage pour un pion 2×2.
  assert.notDeepEqual(source.center, { x: 400, y: 400 });

  // Une source hors de l'étage courant est ignorée.
  const ailleurs = { ...grand, id: 'ailleurs', levelId: 'lvl-2' };
  assert.equal(collectLightSources(level, [grand, ailleurs], ADAPTATEUR).length, 1);

  // Portée nulle ou absente : pas une source.
  const eteint = createToken({ id: 'eteint', levelId: 'lvl-1', kind: 'npc', cell: { a: 1, b: 1 } });
  assert.equal(collectLightSources(level, [eteint], ADAPTATEUR).length, 0);
});

test('5b. ⭐ En HEXAGONAL, la torche portée d’un pion de taille 2 éclaire depuis son centre DESSINÉ', () => {
  // Le carré ne distingue pas les deux formules (5) — c'est en hexagonal que l'écart se voit :
  // jusqu'au correctif, `+ taille / 2` plaçait la source sur un point du RÉSEAU de la grille,
  // pas au centre du pion, avec un décalage qui dépend de la parité de la rangée (C-5).
  const level = createLevel({
    id: 'hex-1', widthCells: 10, heightCells: 10, pxPerCell: 100,
    grid: { type: 'hex', offsetX: 0, offsetY: 0 },
  });
  const grid = gridFor(level);
  const grand = createToken({
    id: 'ogre', levelId: 'hex-1', kind: 'npc', cell: { a: 4, b: 4 }, sizeCells: 2,
    emitsLight: { range: 5, intensity: 1, color: '#ffffff' },
  });

  const [source] = collectLightSources(level, [grand], grid);

  // Centre DESSINÉ, celui que `tokens.js` peint (G-1) — lu sur `cellBounds`, indépendamment
  // du code de `collectLightSources` qu'on éprouve ici.
  const bounds = grid.cellBounds({ cellX: 4, cellY: 4 }, 2);
  const centreDessine = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  assert.deepEqual(source.center, centreDessine);

  // ⭐ Preuve par mutation (b) : rétablir `mapFromCellPoint({cellX: a + taille/2, cellY: b +
  // taille/2})` placerait la source en (550, 433.01) au lieu de (450, 396.41) — une case
  // entière de décalage en x (100 px), plus un tiers de case en y (36,6 px). Ce test doit
  // rougir sur cette mutation.
  assert.notDeepEqual(source.center, { x: 550, y: 433.0127018922194 });
});

test('6. ⭐ « Préparer » ne peint RIEN, « Jouer » peint — décision §4.5', () => {
  const level = etage({ ambient: { level: 1, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);

  const cible = createMockCanvas(1000, 1000);
  const ctx = cible._ctx;

  assert.equal(
    couche.render(ctx, ADAPTATEUR, level, { role: 'gm', mode: 'prep' }),
    false,
    'en préparation, poser des murs dans une cave ne doit pas se faire à l’aveugle'
  );
  assert.equal(ctx.journal.length, 0, '⛔ rien du tout, pas même un tampon');

  assert.equal(couche.render(ctx, ADAPTATEUR, level, { role: 'gm', mode: 'play' }), true);
  assert.ok(ctx.journal.some((/** @type {any} */ e) => e.op === 'drawImage'));

  // ⭐ La vue joueurs n'a pas de mode : elle est TOUJOURS éclairée. Lui appliquer le mode du
  // MJ éteindrait la lumière chez la table pendant que le MJ prépare.
  const ctxJoueurs = createMockCanvas(1000, 1000)._ctx;
  assert.equal(
    couche.render(ctxJoueurs, ADAPTATEUR, level, { role: 'players', mode: 'prep' }),
    true,
    '⛔ le mode du panneau MJ ne doit pas éteindre la vue joueurs'
  );
});

test('7. Le décor est MODULÉ, pas recouvert : multiply par défaut', () => {
  const level = etage({ ambient: { level: 1, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);

  const ctx = createMockCanvas(1000, 1000)._ctx;
  // Un décor déjà peint : gris moyen opaque.
  ctx.fillStyle = 'rgba(128, 128, 128, 1)';
  ctx.fillRect(0, 0, 1000, 1000);
  ctx.journal.length = 0;

  couche.render(ctx, ADAPTATEUR, level, { role: 'players' });

  const dessin = ctx.journal.find((/** @type {any} */ e) => e.op === 'drawImage');
  assert.equal(dessin.mode, 'multiply', 'le modèle est décor × éclairement');
  // Pleine lumière blanche : le décor doit ressortir INCHANGÉ. C'est le test qui attrape une
  // modulation qui assombrirait tout, ou qui délaverait la carte en plein jour.
  assert.ok(Math.abs(pixelAu(ctx, 500, 500).red - 128) < 1, `attendu 128, obtenu ${pixelAu(ctx, 500, 500).red}`);

  // Et le mode de fusion est rendu à l'appelant : le laisser à `multiply` teindrait tout ce
  // que les couches suivantes dessinent — murs, portes, pions.
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('8. ⭐ AU-DESSUS D’UN FOND ANIMÉ, le multiply BLANCHIRAIT la vidéo — d’où le voile', () => {
  // `background.render` se tait quand la vidéo joue (`suppressed`), pour la laisser voir sous
  // le canvas : le décor y est TRANSPARENT.
  //
  // ⭐ Ce test a d'abord été écrit sur une prémisse fausse — « multiplier du transparent ne
  // fait rien ». C'est vrai d'une source transparente, pas d'une destination transparente. Le
  // tampon de modulation est OPAQUE, et sur du transparent il s'écrit tel quel : noir la nuit
  // (ce qui tombe juste par accident) mais **blanc en plein jour**, ce qui effacerait la
  // vidéo derrière un aplat blanc. Le rouge de ce test est ce qui a corrigé la prémisse.
  const jour = etage({ ambient: { level: 1, baked: false } });
  const coucheJour = new LightLayer({ createCanvas: fabrique });
  coucheJour.update(ADAPTATEUR, jour, []);

  const parMultiply = createMockCanvas(1000, 1000)._ctx;
  coucheJour.render(parMultiply, ADAPTATEUR, jour, { role: 'players' });
  assert.equal(pixelAu(parMultiply, 500, 500).red, 255);
  assert.equal(pixelAu(parMultiply, 500, 500).alpha, 255, '⛔ le multiply écrase la vidéo de blanc');

  // Le voile, lui, ne peint RIEN en plein jour : la vidéo passe intacte.
  const parVoileJour = createMockCanvas(1000, 1000)._ctx;
  assert.equal(coucheJour.render(parVoileJour, ADAPTATEUR, jour, { role: 'players', suppressed: true }), true);
  assert.ok(pixelAu(parVoileJour, 500, 500).alpha < 5, '⭐ en plein jour le voile est transparent');

  // Et de nuit, il couvre : le fond animé s'assombrit comme le reste de la carte.
  const nuit = etage({ ambient: { level: 0, baked: false } });
  const coucheNuit = new LightLayer({ createCanvas: fabrique });
  coucheNuit.update(ADAPTATEUR, nuit, []);
  const parVoileNuit = createMockCanvas(1000, 1000)._ctx;
  coucheNuit.render(parVoileNuit, ADAPTATEUR, nuit, { role: 'players', suppressed: true });

  const voile = parVoileNuit.journal.find((/** @type {any} */ e) => e.op === 'drawImage');
  assert.equal(voile.mode, 'source-over', 'le voile peint par-dessus, il ne module pas');
  assert.ok(pixelAu(parVoileNuit, 500, 500).alpha > 250, 'nuit noire : le fond animé est couvert');
  assert.equal(pixelAu(parVoileNuit, 500, 500).red, 0, 'et il est couvert de NOIR, pas de blanc');
});

test('9. Les tampons se reconstruisent quand le champ change, et pas plus souvent', () => {
  const level = etage({ ambient: { level: 1, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);

  const ctx = createMockCanvas(1000, 1000)._ctx;
  couche.render(ctx, ADAPTATEUR, level, { role: 'players' });
  const premier = couche._modulation;
  const revision = couche._modulationRevision;

  // Deuxième image sans mutation : le tampon est réutilisé tel quel.
  couche.render(ctx, ADAPTATEUR, level, { role: 'players' });
  assert.equal(couche._modulation, premier, 'aucune reconstruction sans changement');
  assert.equal(couche._modulationRevision, revision);

  // ⭐ Une mutation du champ doit le reconstruire — sinon la lumière resterait figée sur son
  // premier état, ce qui est exactement le défaut que `__lightRevision` existe pour empêcher.
  couche.update(ADAPTATEUR, etage({ ambient: { level: 0.2, baked: false } }), []);
  couche.render(ctx, ADAPTATEUR, level, { role: 'players' });
  assert.notEqual(couche._modulationRevision, revision, '⛔ le tampon doit suivre le champ');

  couche.invalidate();
  assert.equal(couche.update(ADAPTATEUR, level, []), true, 'invalider force le recalcul');
});

test('10. Dimensions, et refus de ce qui ne veut rien dire', () => {
  const couche = new LightLayer({ createCanvas: fabrique });
  const level = etage({ widthCells: 42, heightCells: 42, ambient: { level: 1, baked: false } });
  couche.update(ADAPTATEUR, level, []);
  assert.equal(champDe(couche).maskWidth, 42 * FOG_MASK_PX_PER_CELL);

  assert.equal(buildLightSignature(null, [], ADAPTATEUR), '');
  assert.equal(buildLightSignature(level, [], null), '');
  assert.deepEqual(collectLightSources(null, [], ADAPTATEUR), []);
  assert.equal(couche.update(ADAPTATEUR, null, []), false);

  const ctx = createMockCanvas(100, 100)._ctx;
  assert.equal(couche.render(ctx, ADAPTATEUR, null, {}), false);
  assert.equal(couche.render(/** @type {any} */ (null), ADAPTATEUR, level, {}), false);

  // Un étage sans surface ne peint pas — un `drawImage` de largeur nulle lève dans un vrai
  // contexte, et il n'y a rien à moduler de toute façon.
  const plat = etage({ widthCells: 0, heightCells: 0, ambient: { level: 1, baked: false } });
  const couchePlate = new LightLayer({ createCanvas: fabrique });
  couchePlate.update(ADAPTATEUR, plat, []);
  assert.equal(couchePlate.render(ctx, ADAPTATEUR, plat, { role: 'players' }), false);
});

test('11. Changer d’étage refabrique le champ à la bonne taille', () => {
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, etage({ id: 'a', widthCells: 10, heightCells: 10 }), []);
  const petit = couche._field;

  couche.update(ADAPTATEUR, etage({ id: 'b', widthCells: 30, heightCells: 20 }), []);
  assert.notEqual(couche._field, petit, 'un étage plus grand exige un nouveau champ');
  assert.equal(champDe(couche).maskWidth, 30 * FOG_MASK_PX_PER_CELL);
  assert.equal(champDe(couche).maskHeight, 20 * FOG_MASK_PX_PER_CELL);
  // Le tampon dérivé de l'ancien champ ne doit pas survivre à ce changement.
  assert.equal(couche._modulationRevision, -1);
});

test('12. ⭐ La vue MJ est assombrie DEUX FOIS MOINS que la table — décision du 26/08', () => {
  // Mesuré le 26/08 sur `manoir-rdc` — ambiante nulle, zéro source déclarée — la modulation
  // est entièrement noire et la carte disparaît. La couche étant SOUS le fog, le mainteneur
  // perdrait le décor que le voile partiel lui laisse voir pour mener la partie.
  //
  // ⭐ Le rapport n'est pas choisi au goût : c'est celui que le fog applique déjà dans ses
  // DEUX états depuis L-04 — 0,5 contre 1 pour le non-exploré, 0,25 contre 0,5 pour
  // l'exploré. La lumière le reprend au lieu d'en inventer un second.
  assert.equal(LIGHT_GM_DARKNESS_RATIO, FOG_VEIL_GM_UNEXPLORED / FOG_VEIL_PLAYER_UNEXPLORED);
  assert.equal(LIGHT_GM_DARKNESS_RATIO, FOG_VEIL_GM_EXPLORED / FOG_VEIL_PLAYER_EXPLORED);

  const nuit = etage({ ambient: { level: 0, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, nuit, []);

  /** @param {'gm'|'players'} role */
  const peindreSurGris = (role) => {
    const ctx = createMockCanvas(1000, 1000)._ctx;
    ctx.fillStyle = 'rgba(200, 200, 200, 1)';
    ctx.fillRect(0, 0, 1000, 1000);
    couche.render(ctx, ADAPTATEUR, nuit, { role, mode: 'play' });
    return pixelAu(ctx, 500, 500).red;
  };

  const table = peindreSurGris('players');
  const mj = peindreSurGris('gm');

  assert.equal(table, 0, 'la table voit le noir : c’est ce qu’elle DOIT voir');
  // 200 × 0,5 = 100 : le MJ garde la moitié de son décor.
  assert.ok(Math.abs(mj - 100) < 1, `le MJ doit garder la moitié du décor, obtenu ${mj}`);
  assert.ok(mj > table, '⛔ le MJ ne doit jamais être aussi aveugle que la table');

  // Le même rapport s'applique au chemin du fond animé — sinon le MJ serait aveugle sur une
  // carte animée alors qu'il voit sur une carte fixe.
  const voileMj = createMockCanvas(1000, 1000)._ctx;
  couche.render(voileMj, ADAPTATEUR, nuit, { role: 'gm', mode: 'play', suppressed: true });
  const voileTable = createMockCanvas(1000, 1000)._ctx;
  couche.render(voileTable, ADAPTATEUR, nuit, { role: 'players', suppressed: true });
  assert.ok(
    pixelAu(voileMj, 500, 500).alpha < pixelAu(voileTable, 500, 500).alpha - 100,
    'le voile MJ doit être nettement moins couvrant que celui de la table'
  );
});

test('13. ⭐ EN PLEIN JOUR, le décor sort INTACT — et sans cas particulier', () => {
  // Exigence du mainteneur, 26/08/2026 : « l'outil doit être capable de gérer à la fois les
  // cartes cuites et les cartes non cuites. »
  //
  // ⛔ **Le 26/08, cette exigence était portée par le drapeau `baked`. Le 27/08 a montré que ce
  // drapeau ne distingue rien** : Dungeon Alchemist écrit `baked_lighting: true` de jour comme
  // de nuit, et quel que soit le mode d'export. S'y fier rendait l'éclairage inerte partout.
  //
  // ⭐ **Ce qui le remplace ne coûte rien et ne décide de rien.** À ambiante pleine, le champ
  // est uniformément blanc, et `multiply` par du blanc laisse la destination EXACTEMENT
  // inchangée. Une carte de jour est donc rendue à l'identique par la seule arithmétique de
  // composition — aucune garde, aucun drapeau, aucun chemin de repli.
  const jour = etage({
    ambient: { level: 1, baked: true },   // ⚠ cuit ET plein jour : le cas de toutes ses cartes
    lights: [
      { id: 'l1', at: { cellX: 3, cellY: 3 }, range: 4, intensity: 1, color: '#ffdca8', shadows: true },
      { id: 'l2', at: { cellX: 7, cellY: 7 }, range: 4, intensity: 1, color: '#ffdca8', shadows: true },
    ],
  });

  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, jour, []);

  // ⭐ Et l'économie : à ambiante pleine, AUCUNE source n'est balayée. Ce n'est pas une
  // optimisation opportuniste, c'est l'invariant — elles seraient invisibles de toute façon.
  // Sur `testbig150` cela évite 185 sweeps par recomposition.
  assert.equal(jour.lights.length, 2, 'le cas n’est probant que si la carte porte des sources');
  assert.equal(couche.lastSourceCount, 0, '⛔ ambiante pleine : aucune source balayée');

  for (const role of /** @type {const} */ (['gm', 'players'])) {
    const ctx = createMockCanvas(1000, 1000)._ctx;
    ctx.fillStyle = 'rgba(200, 200, 200, 1)';
    ctx.fillRect(0, 0, 1000, 1000);
    couche.render(ctx, ADAPTATEUR, jour, { role, mode: 'play' });
    assert.equal(
      pixelAu(ctx, 500, 500).red, 200,
      `⛔ plein jour : le décor sort INTACT (${role})`
    );
  }
});

test('14. ⭐ EXIGENCE : jour et nuit sur la même couche, sans bavure entre eux', () => {
  // Le risque n'est aucun des deux cas pris seul : c'est le **passage de l'un à l'autre**. La
  // couche est réutilisée d'un étage au suivant et son champ est un canvas muté EN PLACE — un
  // champ resté sur l'étage précédent éclairerait un donjon avec l'ambiante d'un village.
  const couche = new LightLayer({ createCanvas: fabrique });

  const lampes = [
    { id: 'l1', at: { cellX: 3, cellY: 3 }, range: 4, intensity: 1, color: '#ffdca8', shadows: true },
  ];
  // ⚠ Les deux étages sont annoncés CUITS, comme le sont les cinq exports réels du mainteneur.
  // Seul leur niveau d'ambiante les sépare — et c'est lui, désormais, qui décide.
  const jour = etage({ id: 'village', ambient: { level: 1, baked: true }, lights: lampes });
  const nuit = etage({ id: 'donjon', ambient: { level: 0, baked: true }, lights: [] });

  /** @param {number} x @param {number} y */
  const champEclaireA = (x, y) => pixelAu(champDe(couche).canvas._ctx, x, y).alpha > 0;

  couche.update(ADAPTATEUR, jour, []);
  assert.equal(champEclaireA(70, 70), true, 'jour : le champ est entièrement éclairé');

  couche.update(ADAPTATEUR, nuit, []);
  assert.equal(champEclaireA(70, 70), false, '⛔ nuit sans source : NOIR, aucune bavure du jour');

  couche.update(ADAPTATEUR, jour, []);
  assert.equal(champEclaireA(70, 70), true, '⛔ retour au jour : le noir du donjon ne survit pas');

  // ⭐ Et la garantie qui l'assure : la signature sépare les deux étages par leur NIVEAU, à
  // `baked` identique — puisque le drapeau, lui, vaut `true` des deux côtés.
  const memeEtageJour = etage({ id: 'X', ambient: { level: 1, baked: true }, lights: lampes });
  const memeEtageNuit = etage({ id: 'X', ambient: { level: 0, baked: true }, lights: lampes });
  assert.notEqual(
    buildLightSignature(memeEtageJour, [], ADAPTATEUR),
    buildLightSignature(memeEtageNuit, [], ADAPTATEUR),
    '⛔ jour et nuit doivent produire des champs différents, à tout le reste égal'
  );

  // Et le rendu suit : intact de jour, assombri de nuit, sur le même décor gris.
  /** @param {any} niveau */
  const rendu = (niveau) => {
    couche.update(ADAPTATEUR, niveau, []);
    const ctx = createMockCanvas(1000, 1000)._ctx;
    ctx.fillStyle = 'rgba(200, 200, 200, 1)';
    ctx.fillRect(0, 0, 1000, 1000);
    couche.render(ctx, ADAPTATEUR, niveau, { role: 'players' });
    return pixelAu(ctx, 500, 500).red;
  };
  assert.equal(rendu(memeEtageJour), 200, 'jour : décor intact');
  assert.equal(rendu(memeEtageNuit), 0, 'nuit sans source à cet endroit : décor noir');
});

/**
 * Fabrique un masque visible mock, à la résolution du masque (8 px/case, comme
 * `champ.maskWidth/maskHeight`) : gris opaque sur le rectangle donné, transparent ailleurs.
 * @param {number} largeur @param {number} hauteur @param {{x:number,y:number,w:number,h:number}} rect
 */
function masqueVisible(largeur, hauteur, rect) {
  const masque = createMockCanvas(largeur, hauteur);
  const ctx = masque._ctx;
  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  return masque;
}

test('15. ⭐ VU SANS LUMIÈRE : le masque visible porte le PLANCHER, pas du noir', () => {
  // Décision du mainteneur du 07/09/2026. Étage sans aucune source : le champ est vide
  // partout, donc SEUL le stencil (masque visible ∧ ¬champ) peut expliquer une différence
  // entre les deux moitiés du masque.
  const level = etage({ ambient: { level: 0, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);

  const maskW = champDe(couche).maskWidth;   // 80 : 10 cases × 8 px/case
  const maskH = champDe(couche).maskHeight;
  // Visible seulement sur la moitié GAUCHE du masque.
  const masque = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW / 2, h: maskH });

  const ctx = createMockCanvas(1000, 1000)._ctx;
  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });

  const modulation = couche._modulation._ctx;
  const vu = pixelAu(modulation, maskW / 4, maskH / 2);       // dans la moitié visible
  const nonVu = pixelAu(modulation, (3 * maskW) / 4, maskH / 2); // hors du masque

  assert.notEqual(vu.red, 0, '⛔ vu et non éclairé ne doit PAS rester noir');
  assert.ok(
    Math.abs(vu.red - 255 * LIGHT_NIGHT_VISION_FLOOR) < 2,
    `attendu le plancher (${255 * LIGHT_NIGHT_VISION_FLOOR}), obtenu ${vu.red}`
  );
  assert.equal(nonVu.red, 0, 'hors du masque visible : rien à peindre, donc toujours noir');
});

test('16. Une passe `saturation` est dessinée quand la zone existe, et seulement alors', () => {
  const level = etage({ ambient: { level: 0, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);
  const maskW = champDe(couche).maskWidth;
  const maskH = champDe(couche).maskHeight;
  const masque = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW, h: maskH });

  const avecMasque = createMockCanvas(1000, 1000)._ctx;
  couche.render(avecMasque, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });
  assert.ok(
    avecMasque.journal.some((/** @type {any} */ e) => e.op === 'drawImage' && e.mode === 'saturation'),
    'la désaturation doit être dessinée'
  );

  // ⛔ Sans masque visible fourni, aucun stencil — donc aucune passe.
  const sansMasque = createMockCanvas(1000, 1000)._ctx;
  couche.render(sansMasque, ADAPTATEUR, level, { role: 'players' });
  assert.ok(
    !sansMasque.journal.some((/** @type {any} */ e) => e.mode === 'saturation'),
    '⛔ aucun masque visible ⇒ aucune passe de désaturation'
  );
});

test('16 bis. ⭐ EXPLORÉ SANS LUMIÈRE : la zone explorée hors de vue porte aussi le plancher (03/10/2026)', () => {
  // Décision du mainteneur du 03/10/2026 : de nuit, une zone révélée au pinceau ou déjà vue
  // montre son décor en gris, comme de jour sous son voile. Étage sans source : seul le stencil
  // peut expliquer une différence.
  const level = etage({ ambient: { level: 0, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);
  const maskW = champDe(couche).maskWidth;
  const maskH = champDe(couche).maskHeight;
  // Visible : quart gauche. Exploré : moitié gauche, donc un quart exploré HORS de vue.
  const visible = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW / 4, h: maskH });
  const explore = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW / 2, h: maskH });

  const ctx = createMockCanvas(1000, 1000)._ctx;
  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: visible, exploredCanvas: explore });

  const modulation = couche._modulation._ctx;
  const plancher = 255 * LIGHT_NIGHT_VISION_FLOOR;
  const vu = pixelAu(modulation, maskW / 8, maskH / 2);
  const exploreHorsVue = pixelAu(modulation, (3 * maskW) / 8, maskH / 2);
  const jamaisVu = pixelAu(modulation, (3 * maskW) / 4, maskH / 2);

  assert.ok(Math.abs(vu.red - plancher) < 2, `visible : plancher attendu, obtenu ${vu.red}`);
  assert.ok(
    Math.abs(exploreHorsVue.red - plancher) < 2,
    `⛔ exploré hors de vue : plancher attendu (${plancher}), obtenu ${exploreHorsVue.red}`
  );
  assert.equal(jamaisVu.red, 0, 'jamais exploré : toujours noir');

  // Exploré sans aucune vision publiée (tablette juste démarrée) : le plancher est là quand même.
  const seul = new LightLayer({ createCanvas: fabrique });
  seul.update(ADAPTATEUR, level, []);
  seul.render(createMockCanvas(1000, 1000)._ctx, ADAPTATEUR, level, { role: 'players', exploredCanvas: explore });
  assert.ok(
    Math.abs(pixelAu(seul._modulation._ctx, (3 * maskW) / 8, maskH / 2).red - plancher) < 2,
    '⛔ exploré seul, sans masque visible : plancher attendu'
  );
});

test('16 ter. Un pinceau qui étend l’exploré EN PLACE reconstruit le plancher au rendu suivant', () => {
  // Côté MJ, `ExploredFog` mute son canvas en place et n'estampille que `__fogRevision` : sans
  // relire cette estampille, le cache du masque vu figerait le plancher sur le premier rendu.
  const level = etage({ ambient: { level: 0, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);
  const maskW = champDe(couche).maskWidth;
  const maskH = champDe(couche).maskHeight;
  const explore = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW / 4, h: maskH });
  explore.__fogRevision = 1;

  couche.render(createMockCanvas(1000, 1000)._ctx, ADAPTATEUR, level, { role: 'gm', mode: 'play', exploredCanvas: explore });
  assert.equal(pixelAu(couche._modulation._ctx, (3 * maskW) / 4, maskH / 2).red, 0);

  // Coup de pinceau : tout l'étage exploré, même objet, révision suivante.
  explore._ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  explore._ctx.fillRect(0, 0, maskW, maskH);
  explore.__fogRevision = 2;
  couche.render(createMockCanvas(1000, 1000)._ctx, ADAPTATEUR, level, { role: 'gm', mode: 'play', exploredCanvas: explore });
  assert.ok(
    Math.abs(pixelAu(couche._modulation._ctx, (3 * maskW) / 4, maskH / 2).red - 255 * LIGHT_NIGHT_VISION_FLOOR) < 2,
    '⛔ la zone peinte au pinceau doit recevoir le plancher'
  );
});

test('17. ⭐ Ambiante PLEINE : aucune passe supplémentaire — le test 13 doit rester vert', () => {
  // Économie du brief : à ambiante pleine, le stencil serait vide de toute façon (rien de
  // non-éclairé). On ne le construit ni ne le peint, MÊME si un masque visible est fourni.
  const level = etage({ ambient: { level: 1, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);
  const maskW = champDe(couche).maskWidth;
  const maskH = champDe(couche).maskHeight;
  const masque = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW, h: maskH });

  const ctx = createMockCanvas(1000, 1000)._ctx;
  ctx.fillStyle = 'rgba(200, 200, 200, 1)';
  ctx.fillRect(0, 0, 1000, 1000);

  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });

  assert.ok(
    !ctx.journal.some((/** @type {any} */ e) => e.mode === 'saturation'),
    '⛔ ambiante pleine : aucune passe de désaturation, même avec un masque visible'
  );
  assert.equal(couche._modulationStencilRev, null, '⛔ aucun stencil composé dans la modulation');
  assert.equal(pixelAu(ctx, 500, 500).red, 200, 'et le décor sort toujours INTACT (test 13)');
});

test('18. La modulation se reconstruit quand la révision du masque VISIBLE change, et pas plus souvent', () => {
  const level = etage({ ambient: { level: 0, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);
  const maskW = champDe(couche).maskWidth;
  const maskH = champDe(couche).maskHeight;

  // ⭐ Convention `__fogRevision` de `fogLayer.js`, reprise ici : le masque est mutable EN
  // PLACE, sa RÉFÉRENCE ne change donc jamais — seule cette estampille le fait.
  const masque = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW, h: maskH });
  masque.__fogRevision = 1;

  const ctx = createMockCanvas(1000, 1000)._ctx;
  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });
  const revision1 = couche._modulationStencilRev;
  const dessinsApres1 = couche._modulation._ctx.journal.length;
  assert.notEqual(revision1, null, 'un stencil a bien été composé');

  // Deuxième image, RIEN n'a changé : ni le champ, ni la révision du masque.
  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });
  assert.equal(couche._modulationStencilRev, revision1, '⛔ pas de reconstruction sans changement');
  assert.equal(
    couche._modulation._ctx.journal.length, dessinsApres1,
    '⛔ pas plus souvent : aucun dessin de plus dans le tampon de modulation'
  );

  // Le masque MUTE en place (même référence), et c'est cette estampille-là qui doit
  // déclencher la reconstruction — comparer la seule référence resterait bloqué dessus,
  // exactement le défaut que le brief interdit.
  masque.__fogRevision = 2;
  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });
  assert.notEqual(
    couche._modulationStencilRev, revision1,
    '⛔ la révision du masque visible a changé : la modulation doit suivre'
  );
});

test('19. ⭐ C-2 — une lampe ÉTEINTE n’émet RIEN, et basculer l’état force la recomposition', () => {
  const allumee = { id: 'l1', at: { cellX: 3, cellY: 3 }, range: 4, intensity: 1, color: '#ffffff', shadows: true, on: true };
  const eteinte = { ...allumee, on: false };

  // ⚠ Ambiante NULLE, indispensable : à ambiante pleine (le défaut de `etage()`) le champ est
  // déjà blanc et aucune source n'est balayée — voir le test 2, même remarque.
  const ambiante = { level: 0, baked: false };

  // (1) Le champ lumineux ne la compose pas : aucune source collectée pour une lampe éteinte.
  const levelAllume = etage({ ambient: ambiante, lights: [allumee] });
  const levelEteint = etage({ ambient: ambiante, lights: [eteinte] });
  assert.equal(collectLightSources(levelAllume, [], ADAPTATEUR).length, 1);
  assert.equal(collectLightSources(levelEteint, [], ADAPTATEUR).length, 0, '⛔ une lampe éteinte n’émet rien');

  // Absence du champ (scène déjà sur disque, jamais repassée par `normalizeLevel`) : vaut
  // ALLUMÉE, même précédent que `Portal.state`.
  const sansChamp = etage({
    ambient: ambiante,
    lights: [/** @type {any} */ ({ id: 'l2', at: { cellX: 1, cellY: 1 }, range: 3, intensity: 1, color: '#ffffff', shadows: true })],
  });
  assert.equal(collectLightSources(sansChamp, [], ADAPTATEUR).length, 1, 'absence du champ = allumée');

  // (2) ⛔ Le piège nommé par C-2 : basculer l'état DOIT changer la signature de cache — sans
  // quoi la bascule ne changerait rien à l'écran, le cache court-circuitant la recomposition.
  const sigAllumee = buildLightSignature(levelAllume, [], ADAPTATEUR);
  const sigEteinte = buildLightSignature(levelEteint, [], ADAPTATEUR);
  assert.notEqual(sigAllumee, sigEteinte, '⛔ basculer une lampe doit changer la signature de cache');

  // Et la couche recompose bien quand l'étage bascule.
  const couche = new LightLayer({ createCanvas: fabrique });
  assert.equal(couche.update(ADAPTATEUR, levelAllume, []), true, 'premier calcul');
  assert.equal(couche.lastSourceCount, 1);
  assert.equal(couche.update(ADAPTATEUR, levelEteint, []), true, 'la bascule DOIT recomposer');
  assert.equal(couche.lastSourceCount, 0, 'plus aucune source une fois éteinte');
});

test('20. ⭐ Le champ AMPLIFIÉ est dessiné GAIN fois en `lighter`, et se met en cache sur la révision du champ', () => {
  // Ambiante à 0,2 : un remplissage UNIFORME (pas de dégradé, donc éprouvable par ce mock —
  // voir la remarque en tête de fichier), qui représente une zone à peine éclairée.
  const level = etage({ ambient: { level: 0.2, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);

  const ctx = createMockCanvas(1000, 1000)._ctx;
  const amplifie = couche._construireChampAmplifie(ctx);
  assert.ok(amplifie, 'un tampon amplifié doit exister');

  const dessins = amplifie._ctx.journal.filter(
    (/** @type {any} */ e) => e.op === 'drawImage' && e.mode === 'lighter'
  );
  assert.equal(dessins.length, LIGHT_COLOR_VISION_GAIN, 'le champ brut doit être dessiné GAIN fois, en additif');

  // alpha brut = 0,2 × 255 = 51 ; amplifié = min(255, GAIN × 51).
  const brut = pixelAu(champDe(couche).canvas._ctx, 5, 5);
  assert.ok(Math.abs(brut.alpha - 51) < 2, `alpha brut attendu ~51, obtenu ${brut.alpha}`);
  const attendu = Math.min(255, LIGHT_COLOR_VISION_GAIN * brut.alpha);
  const obtenu = pixelAu(amplifie._ctx, 5, 5);
  assert.ok(Math.abs(obtenu.alpha - attendu) < 2, `alpha amplifié attendu ~${attendu}, obtenu ${obtenu.alpha}`);

  // Deuxième appel, rien n'a changé : le tampon est réutilisé tel quel.
  const journalAvant = amplifie._ctx.journal.length;
  const memeAmplifie = couche._construireChampAmplifie(ctx);
  assert.equal(memeAmplifie, amplifie, 'aucune reconstruction sans changement du champ');
  assert.equal(amplifie._ctx.journal.length, journalAvant, '⛔ pas de dessin supplémentaire');

  // ⭐ Une mutation du champ doit le reconstruire — même exigence que le tampon de modulation
  // (test 9) : un champ amplifié figé sur son premier état suivrait mal une lampe qui bouge.
  couche.update(ADAPTATEUR, etage({ ambient: { level: 0.5, baked: false } }), []);
  const apres = couche._construireChampAmplifie(ctx);
  assert.equal(couche._champAmplifieRevision, champDe(couche).revision);
  const dessinsApres = apres._ctx.journal.filter(
    (/** @type {any} */ e) => e.op === 'drawImage' && e.mode === 'lighter'
  );
  assert.ok(
    dessinsApres.length > dessins.length,
    '⛔ le champ amplifié doit se reconstruire quand le champ change'
  );
});

test('21. ⭐ Le stencil COULEUR est DISTINCT du stencil du plancher — l’un ronge le champ brut, l’autre l’amplifié', () => {
  // Décision du mainteneur du 10/09/2026 : la couleur revient à SEUIL, la clarté du décor
  // reste progressive. Ambiante uniforme à 0,2 pour rendre les deux résidus calculables.
  const level = etage({ ambient: { level: 0.2, baked: false } });
  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(ADAPTATEUR, level, []);

  const maskW = champDe(couche).maskWidth;
  const maskH = champDe(couche).maskHeight;
  const masque = masqueVisible(maskW, maskH, { x: 0, y: 0, w: maskW, h: maskH });

  const ctx = createMockCanvas(1000, 1000)._ctx;
  couche.render(ctx, ADAPTATEUR, level, { role: 'players', visibleCanvas: masque });

  const plancher = pixelAu(couche._stencilNocturne._ctx, maskW / 2, maskH / 2);
  const couleur = pixelAu(couche._stencilCouleur._ctx, maskW / 2, maskH / 2);

  // Plancher : rongé par le champ BRUT (alpha ≈ 0,2) — résidu ≈ 255 × 0,8 = 204. INCHANGÉ par
  // ce chantier : la clarté du décor doit continuer de suivre le champ réel.
  assert.ok(Math.abs(plancher.alpha - 204) < 3, `plancher : résidu attendu ~204, obtenu ${plancher.alpha}`);

  // Couleur : rongé par le champ AMPLIFIÉ (GAIN × 0,2) — résidu ≈ 255 × (1 − min(1, GAIN×0,2)).
  const attenue = Math.min(1, LIGHT_COLOR_VISION_GAIN * 0.2);
  const residuAttendu = 255 * (1 - attenue);
  assert.ok(
    Math.abs(couleur.alpha - residuAttendu) < 3,
    `couleur : résidu attendu ~${residuAttendu}, obtenu ${couleur.alpha}`
  );

  // ⛔ Preuve par mutation (a) du rapport : ronger le stencil couleur par le champ BRUT (comme
  // avant le 10/09/2026) ferait `couleur.alpha === plancher.alpha` — cette assertion rougirait.
  assert.ok(
    couleur.alpha < plancher.alpha,
    '⛔ le stencil couleur doit être plus rongé que celui du plancher, sinon la couleur revient aussi lentement qu’avant'
  );

  // Et la couche peint bien une passe de désaturation à partir de ce stencil.
  const dessinSaturation = ctx.journal.find((/** @type {any} */ e) => e.op === 'drawImage' && e.mode === 'saturation');
  assert.ok(dessinSaturation, 'une passe de désaturation doit être dessinée');
});

// ─────────────────────────────────────────────────────────────────────────────
// E-12 — l'agrandissement du champ vers l'espace carte ne doit pas porter le décalage odd-r.
//
// ⚠ Ces tests éprouvent l'EFFET : la largeur de destination réellement passée à `drawImage`
// (`params[6]` de la forme à neuf arguments), pour les TROIS passes — voile, modulation,
// désaturation. Aucun n'interroge une variable de la couche.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rend un étage hexagonal ou carré et rend les largeurs de destination des passes peintes.
 * @param {{widthCells: number, heightCells: number, hex: boolean, suppressed?: boolean}} forme
 * @returns {{largeurs: number[], hauteurs: number[]}}
 */
function etirementsDuChamp(forme) {
  const level = createLevel({
    id: 'e12',
    widthCells: forme.widthCells,
    heightCells: forme.heightCells,
    pxPerCell: 140,
    ambient: { level: 0, baked: false },
    ...(forme.hex ? { grid: { type: 'hex', offsetX: 0, offsetY: 0 } } : {}),
  });
  const adaptateur = gridFor(level);

  const couche = new LightLayer({ createCanvas: fabrique });
  couche.update(adaptateur, level, []);
  const champ = champDe(couche);
  const masque = masqueVisible(champ.maskWidth, champ.maskHeight, {
    x: 0, y: 0, w: champ.maskWidth, h: champ.maskHeight,
  });

  // Contexte minuscule : ce qu'on relève, ce sont les arguments reçus, pas les pixels écrits.
  const ctx = createMockCanvas(4, 4)._ctx;
  couche.render(ctx, adaptateur, level, {
    role: /** @type {'players'} */ ('players'),
    visibleCanvas: masque,
    ...(forme.suppressed ? { suppressed: true } : {}),
  });

  const passes = ctx.journal.filter((/** @type {any} */ e) => e.op === 'drawImage');
  assert.ok(passes.length > 0, 'la couche doit peindre au moins une passe');
  return {
    largeurs: passes.map((/** @type {any} */ e) => e.params[6]),
    hauteurs: passes.map((/** @type {any} */ e) => e.params[7]),
  };
}

test('E-12 : carte HEXAGONALE à rangées IMPAIRES — le champ est étiré à la largeur de la carte, pas une demi-case de plus', () => {
  // ⛔ Avant le correctif, la largeur venait de `mapFromCellPoint({cellX: 16, cellY: 15})`,
  // qui ajoute le décalage odd-r de la rangée 15 : 140 × 16,5 = 2310 au lieu de 2240.
  const attendueY = 15 * 140 * (Math.sqrt(3) / 2);

  // Modulation + désaturation.
  const { largeurs, hauteurs } = etirementsDuChamp({ widthCells: 16, heightCells: 15, hex: true });
  assert.ok(largeurs.length >= 2, 'modulation et désaturation sont toutes deux peintes');
  for (const largeur of largeurs) {
    assert.equal(largeur, 16 * 140, 'chaque passe couvre exactement 16 cases de large');
    assert.notEqual(largeur, 2310, 'la demi-case du décalage odd-r n’est pas une largeur de carte');
  }
  for (const hauteur of hauteurs) assert.equal(hauteur, attendueY, 'l’axe Y, lui, ne change pas');

  // Et le voile, qui emprunte l'autre chemin de `render`.
  const voile = etirementsDuChamp({ widthCells: 16, heightCells: 15, hex: true, suppressed: true });
  for (const largeur of voile.largeurs) assert.equal(largeur, 16 * 140, 'le voile aussi');
  for (const hauteur of voile.hauteurs) assert.equal(hauteur, attendueY);
});

test('E-12 : carte HEXAGONALE à rangées PAIRES — la largeur reste celle d’avant le correctif', () => {
  const { largeurs, hauteurs } = etirementsDuChamp({ widthCells: 16, heightCells: 16, hex: true });
  for (const largeur of largeurs) assert.equal(largeur, 16 * 140, 'rangées paires : le décalage odd-r valait déjà 0');
  for (const hauteur of hauteurs) assert.equal(hauteur, 16 * 140 * (Math.sqrt(3) / 2));
});

test('E-12 : carte CARRÉE à rangées impaires — inchangée', () => {
  const { largeurs, hauteurs } = etirementsDuChamp({ widthCells: 16, heightCells: 15, hex: false });
  for (const largeur of largeurs) assert.equal(largeur, 16 * 140);
  for (const hauteur of hauteurs) assert.equal(hauteur, 15 * 140);
});

// A1 (audit du 22/09/2026) — le champ se pose sur l'origine de la grille, offset compris. Un
// VRAI adaptateur ici, pas le faux du fichier : c'est lui qui porte l'offset.
test('A1 : sur une grille DÉCALÉE, chaque passe part de l’origine de la grille, pas de (0,0)', () => {
  const level = createLevel({
    id: 'a1', widthCells: 10, heightCells: 8, pxPerCell: 140,
    ambient: { level: 0, baked: false },
    grid: { type: 'square', offsetX: 70, offsetY: 35, color: '#000000', opacity: 0.25, visible: true },
  });
  const adaptateur = gridFor(level);
  for (const suppressed of [false, true]) {
    const couche = new LightLayer({ createCanvas: fabrique });
    couche.update(adaptateur, level, []);
    const champ = champDe(couche);
    const masque = masqueVisible(champ.maskWidth, champ.maskHeight, {
      x: 0, y: 0, w: champ.maskWidth, h: champ.maskHeight,
    });
    const ctx = createMockCanvas(4, 4)._ctx;
    couche.render(ctx, adaptateur, level, {
      role: /** @type {'players'} */ ('players'), visibleCanvas: masque, ...(suppressed ? { suppressed } : {}),
    });
    const passes = ctx.journal.filter((/** @type {any} */ e) => e.op === 'drawImage');
    assert.ok(passes.length > 0);
    for (const passe of passes) {
      assert.deepEqual(passe.params.slice(4, 8), [70, 35, 1400, 1120], 'destination = rectangle de la grille');
    }
  }
});

// E1 (audit du 22/09/2026) — les caches de la couche (amplifié, voile, stencils) comparent la
// SEULE révision du champ. Un champ recréé au changement d'étage repartait de 0 et retombait sur
// la révision du précédent : l'étage B était modulé et désaturé avec les tampons de A, à la
// taille de A. Chaque passe doit peindre à partir d'une image à la taille du champ COURANT.
test('E1 : après un changement d’étage de taille différente, aucune passe ne peint un tampon de l’étage précédent', () => {
  const couche = new LightLayer({ createCanvas: fabrique });
  for (const suppressed of [false, true]) {
    for (const [w, h] of [[10, 10], [20, 16]]) {
      const level = createLevel({ id: `e1-${w}`, widthCells: w, heightCells: h, pxPerCell: 100, ambient: { level: 0.3, baked: false } });
      const adaptateur = gridFor(level);
      couche.update(adaptateur, level, []);
      const champ = champDe(couche);
      const masque = masqueVisible(champ.maskWidth, champ.maskHeight, { x: 0, y: 0, w: champ.maskWidth, h: champ.maskHeight });
      const ctx = createMockCanvas(4, 4)._ctx;
      couche.render(ctx, adaptateur, level, {
        role: /** @type {'players'} */ ('players'), visibleCanvas: masque, ...(suppressed ? { suppressed } : {}),
      });
      const passes = ctx.journal.filter((/** @type {any} */ e) => e.op === 'drawImage');
      assert.ok(passes.length > 0);
      for (const passe of passes) {
        assert.equal(passe.source?.width, champ.maskWidth, `${w}×${h} : tampon d’un autre étage (${passe.source?.width} px de large)`);
      }
      // Le champ AMPLIFIÉ (désaturation) est recopié dans un stencil neuf : c'est lui, et lui seul,
      // qui restait celui de l'étage précédent — l'éprouver directement.
      const amplifie = /** @type {any} */ (couche)._champAmplifie;
      if (amplifie) assert.equal(amplifie.width, champ.maskWidth, `${w}×${h} : champ amplifié de l’étage précédent`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Le HALO — décision du mainteneur du 02/10/2026. Ces tests tournent sur le mock RASTERISANT :
// le halo est un dégradé dans un polygone, le mock mince n'en écrirait aucun pixel.
// ─────────────────────────────────────────────────────────────────────────────

/** @param {number} w @param {number} h */
const fabriqueRaster = (w, h) => createMockCanvas(w, h, { rasterise: true });

/** @param {any} ctx @param {number} x @param {number} y */
function rgbAu(ctx, x, y) {
  const index = (y * ctx.width + x) * 4;
  return { red: ctx.pixels[index], green: ctx.pixels[index + 1], blue: ctx.pixels[index + 2], alpha: ctx.pixels[index + 3] };
}

/**
 * Un étage de nuit portant une lampe au centre (case 5,5 → pixel carte 500,500), portée 3.
 * @param {{ on?: boolean, color?: string, ambient?: number }} [o]
 */
function etageLampe(o = {}) {
  return etage({
    ambient: { level: o.ambient ?? 0, baked: true },
    lights: [{ id: 'l1', at: { cellX: 5, cellY: 5 }, range: 3, intensity: 1, color: o.color ?? '#ffa54f', shadows: true, on: o.on ?? true }],
  });
}

/** Un décor sombre et opaque, comme une image de nuit sans lueur peinte. */
function decorSombre() {
  const ctx = createMockCanvas(1000, 1000)._ctx;
  ctx.fillStyle = 'rgba(60, 60, 60, 1)';
  ctx.fillRect(0, 0, 1000, 1000);
  ctx.journal.length = 0;
  return ctx;
}

/**
 * Rend `level` sur un décor sombre (transparent sous un fond animé). `sansHalo` retire le halo
 * du champ juste avant le rendu : la référence « même scène, sans la fonction ».
 * @param {any} level @param {any} options @param {boolean} [sansHalo]
 */
function rendre(level, options, sansHalo = false) {
  const couche = new LightLayer({ createCanvas: fabriqueRaster });
  couche.update(ADAPTATEUR, level, []);
  if (sansHalo) champDe(couche).glowCount = 0;
  const ctx = options.suppressed ? createMockCanvas(1000, 1000)._ctx : decorSombre();
  couche.render(ctx, ADAPTATEUR, level, options);
  return { ctx, couche };
}

/** @param {any} ctx */
const passeHalo = (ctx) => ctx.journal.some((/** @type {any} */ e) => e.op === 'drawImage' && e.mode === 'screen');

test('H1. ⭐ Une lampe ALLUMÉE, à ambiante nulle, rend le décor PLUS CLAIR que l’image source', () => {
  for (const role of /** @type {const} */ (['gm', 'players'])) {
    const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 });
    const { ctx } = rendre(etageLampe(), { role, mode: 'play', visibleCanvas: masque });
    const pres = rgbAu(ctx, 520, 500);
    assert.ok(pres.red > 60 + 40, `${role} : près de la lampe, attendu bien au-dessus de 60, obtenu ${pres.red}`);
    assert.ok(pres.red <= 255 && pres.green <= 255, 'screen ne dépasse jamais le blanc');
  }
});

test('H2. Une lampe ÉTEINTE n’ajoute RIEN : rendu identique à un étage sans lampe', () => {
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 });
  const options = { role: 'players', visibleCanvas: masque };
  const eteinte = rendre(etageLampe({ on: false }), options).ctx;
  const vide = rendre(etage({ ambient: { level: 0, baked: true } }), options).ctx;
  assert.deepEqual(rgbAu(eteinte, 520, 500), rgbAu(vide, 520, 500));
  assert.equal(passeHalo(eteinte), false, '⛔ aucune passe de halo');
});

test('H3. ⛔ En plein JOUR (ambiante 1), aucun halo — le décor sort intact', () => {
  for (const role of /** @type {const} */ (['gm', 'players'])) {
    const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 });
    const { ctx } = rendre(etageLampe({ ambient: 1 }), { role, mode: 'play', visibleCanvas: masque });
    assert.equal(rgbAu(ctx, 520, 500).red, 60, `${role} : plein jour, décor intact`);
    assert.equal(passeHalo(ctx), false, `${role} : aucune passe de halo`);
  }
});

test('H4. ⛔ MJ en « Préparer » : aucun halo, rien du tout', () => {
  const { ctx } = rendre(etageLampe(), { role: 'gm', mode: 'prep' });
  assert.equal(rgbAu(ctx, 520, 500).red, 60);
  assert.equal(ctx.journal.length, 0);
});

test('H5. ⭐ Joueurs : le halo est RÉDUIT à ce qui est vu à l’instant — rien ne filtre d’une pièce hors de vue', () => {
  // Visible : la moitié GAUCHE du masque seulement (x < 40, soit x < 500 px carte).
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 40, h: 80 });
  const options = { role: 'players', visibleCanvas: masque };
  const avec = rendre(etageLampe(), options).ctx;
  const sans = rendre(etageLampe(), options, true).ctx;

  assert.ok(rgbAu(avec, 480, 500).red > rgbAu(sans, 480, 500).red + 40, 'dans la zone vue, le halo luit');
  assert.deepEqual(rgbAu(avec, 560, 500), rgbAu(sans, 560, 500), '⛔ hors de la zone vue, AUCUN halo');

  // ⛔ Et sans masque du tout, la table ne reçoit aucun halo : ne rien montrer ne fuit pas.
  assert.equal(passeHalo(rendre(etageLampe(), { role: 'players' }).ctx), false);
});

test('H6. Le MJ voit le halo PARTOUT et à pleine force — ni réduction ni atténuation', () => {
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 40, h: 80 });
  const options = { role: 'gm', mode: 'play', visibleCanvas: masque };
  const avec = rendre(etageLampe(), options).ctx;
  const sans = rendre(etageLampe(), options, true).ctx;
  assert.ok(rgbAu(avec, 560, 500).red > rgbAu(sans, 560, 500).red + 40, 'le MJ voit le halo hors de la vue des PJ');

  // Pleine force : le même halo que la table, au même endroit vu des deux côtés.
  const joueurs = rendre(etageLampe(), { role: 'players', visibleCanvas: masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 }) });
  const gainJoueurs = rgbAu(joueurs.ctx, 520, 500).red - rgbAu(rendre(etageLampe(), { role: 'players', visibleCanvas: masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 }) }, true).ctx, 520, 500).red;
  const gainMJ = rgbAu(avec, 520, 500).red - rgbAu(sans, 520, 500).red;
  assert.ok(gainMJ > gainJoueurs * 0.9, `⛔ halo MJ atténué : +${gainMJ} contre +${gainJoueurs} chez la table`);
});

test('H7. ⭐ Le halo vient APRÈS la désaturation : un violet le reste jusque dans la frange', () => {
  // ⭐ Le pixel final doit être EXACTEMENT `screen(scène déjà assombrie et désaturée, halo)`.
  // Posé avant la désaturation, le halo y perdrait sa couleur là où le stencil mord encore —
  // la frange extérieure, où le champ amplifié n’a pas saturé. D’où ce point à 80 % de la portée.
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 });
  const level = etageLampe({ color: '#a040ff' });
  const options = { role: 'players', visibleCanvas: masque };
  const { ctx, couche } = rendre(level, options);
  const sans = rendre(level, options, true).ctx;

  // ⚠ Écart attendu sous mutation : quelques millièmes de niveau, la frange étant faible — le
  // mock calcule en flottants exacts, la tolérance de 1e-6 les voit sans ambiguïté.
  const x = 500 + 240;
  // Côté joueurs, la passe dessine le halo RÉDUIT à la zone vue — c’est lui la source.
  const halo = rgbAu(couche._haloVisible._ctx, Math.floor((x * 80) / 1000), 40);
  assert.ok(halo.alpha > 0, 'le cas n’est probant que si le halo porte jusque-là');
  const a = (halo.alpha / 255) * LIGHT_GLOW_GAIN;
  const fond = rgbAu(sans, x, 500);
  const obtenu = rgbAu(ctx, x, 500);
  for (const canal of /** @type {const} */ (['red', 'green', 'blue'])) {
    // ⚠ Convention du mock : `drawImage` lit les canaux stockés tels quels comme couleur.
    const source = halo[canal];
    const attendu = fond[canal] + a * source * (1 - fond[canal] / 255);
    assert.ok(Math.abs(obtenu[canal] - attendu) < 1e-6, `${canal} : attendu ${attendu}, obtenu ${obtenu[canal]}`);
  }
  assert.ok(obtenu.blue - obtenu.green > fond.blue - fond.green, 'le violet du halo survit');
});

test('H8. Fond animé : le halo se pose au-dessus du voile, et rien d’opaque hors de lui', () => {
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 });
  const options = { role: 'players', suppressed: true, visibleCanvas: masque };
  const avec = rendre(etageLampe(), options).ctx;
  const sans = rendre(etageLampe(), options, true).ctx;
  assert.ok(rgbAu(avec, 520, 500).red > rgbAu(sans, 520, 500).red + 40, 'le halo luit au-dessus de la vidéo');
  assert.deepEqual(rgbAu(avec, 900, 100), rgbAu(sans, 900, 100), '⛔ hors du halo, le halo n’ajoute rien');
});

test('H9. ⛔ Le champ de la vision (`getFieldCanvas`) n’est jamais touché par le halo', () => {
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 80, h: 80 });
  const couche = new LightLayer({ createCanvas: fabriqueRaster });
  const level = etageLampe();
  couche.update(ADAPTATEUR, level, []);
  const avant = Array.from(couche.getFieldCanvas()._ctx.pixels);
  assert.ok(champDe(couche).glowCount > 0, 'le cas n’est probant que si un halo existe');
  for (const role of /** @type {const} */ (['gm', 'players'])) {
    couche.render(decorSombre(), ADAPTATEUR, level, { role, mode: 'play', visibleCanvas: masque });
  }
  assert.deepEqual(Array.from(couche.getFieldCanvas()._ctx.pixels), avant);
});

test('H10. Le halo réduit suit la révision du masque VISIBLE, muté en place', () => {
  const level = etageLampe();
  const couche = new LightLayer({ createCanvas: fabriqueRaster });
  couche.update(ADAPTATEUR, level, []);

  // Visible à GAUCHE d'abord. ⭐ Même convention `__fogRevision` que le test 18 : le masque
  // est mutable EN PLACE, seule l'estampille dit qu'il a changé.
  const masque = masqueVisible(80, 80, { x: 0, y: 0, w: 40, h: 80 });
  masque.__fogRevision = 1;
  const options = { role: /** @type {const} */ ('players'), visibleCanvas: masque };
  couche.render(decorSombre(), ADAPTATEUR, level, options);

  // La vue passe à DROITE, même objet.
  masque._ctx.clearRect(0, 0, 80, 80);
  masque._ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  masque._ctx.fillRect(40, 0, 40, 80);
  masque.__fogRevision = 2;
  const ctx = decorSombre();
  couche.render(ctx, ADAPTATEUR, level, options);

  const sans = rendre(level, options, true).ctx;
  assert.ok(rgbAu(ctx, 560, 500).red > rgbAu(sans, 560, 500).red + 40, 'la zone désormais vue reçoit le halo');
  assert.deepEqual(rgbAu(ctx, 480, 500), rgbAu(sans, 480, 500), '⛔ la zone qui n’est plus vue n’en garde rien');
});

test('D-11 : en hexagonal décalé, le champ lumineux se compose dans un masque calé sur l’image', () => {
  // Le champ se pose sur `maskRect()` (render) : il doit être composé depuis la MÊME origine. Celle
  // du réseau, reculée de 25 px, décalerait toute lampe de 25 px vers la droite à l'écran.
  const level = createLevel({
    id: 'hex-d11', widthCells: 10, heightCells: 10, pxPerCell: 100,
    grid: { type: 'hex', offsetX: 0, offsetY: 0, hexShiftX: -25 },
    lights: [{ id: 'l1', at: { cellX: 3, cellY: 3 }, range: 4, intensity: 1, color: '#ffffff', shadows: true, on: true }],
    ambient: { level: 0, baked: false },
  });
  const grid = gridFor(level);
  const couche = new LightLayer({ createCanvas: fabrique });
  /** @type {any[]} */
  const appels = [];
  // Le champ n'existe qu'après le premier `update` : on l'enrobe au premier passage.
  couche.update(grid, level, []);
  const field = champDe(couche);
  const composer = field.compose.bind(field);
  field.compose = (/** @type {any} */ sources, /** @type {any} */ options) => {
    appels.push({ sources, options });
    return composer(sources, options);
  };
  couche.update(grid, { ...level, lights: [{ ...level.lights[0], range: 5 }] }, []);
  assert.equal(appels.length, 1);
  const { sources, options } = appels[0];
  assert.deepEqual(options.mapOrigin, { x: grid.maskRect().x, y: grid.maskRect().y });
  // La lampe, lue en carré, tombe donc au pixel de masque 8 × 3 = 24 sur X.
  assert.equal(((sources[0].center.x - options.mapOrigin.x) * 8) / options.gridScaleX, 24);
});
