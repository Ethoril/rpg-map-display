// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import { LightLayer, collectLightSources, buildLightSignature } from '../js/render/layers/light.js';
import { createLevel, createToken } from '../js/core/schema.js';
import {
  FOG_MASK_PX_PER_CELL,
  LIGHT_GM_DARKNESS_RATIO,
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

/** @param {number} width @param {number} height */
function createMockCanvas(width, height) {
  const pixels = new Float64Array(width * height * 4);
  /** @type {any[]} */
  const journal = [];

  /** @param {string} texte */
  function lireRgba(texte) {
    if (texte === '#000000') return { couleur: [0, 0, 0], alpha: 1 };
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
      } else if (mode === 'destination-out') {
        // Ne touche pas les couleurs, ronge l'alpha. Traité plus bas.
      } else {
        pixels[index + canal] = source + pixels[index + canal] * (1 - alpha);
      }
    }
    if (mode === 'destination-out') {
      pixels[index + 3] = pixels[index + 3] * (1 - alpha);
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

    createRadialGradient() {
      journal.push({ op: 'gradient' });
      return { __gradient: true, addColorStop() {} };
    },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
    fill() { journal.push({ op: 'fill', mode: this.globalCompositeOperation }); },

    /** @param {any} image @param {...number} reste */
    drawImage(image, ...reste) {
      const mode = this.globalCompositeOperation;
      journal.push({ op: 'drawImage', mode, args: reste.length });
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
          if (alpha <= 0 && mode !== 'multiply') continue;
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

/** Adaptateur de pavage minimal : une case vaut 100 pixels carte. */
const ADAPTATEUR = {
  /** @param {{cellX: number, cellY: number}} p */
  mapFromCellPoint: (p) => ({ x: p.cellX * 100, y: p.cellY * 100 }),
};

/** @param {any} overrides */
function etage(overrides = {}) {
  return createLevel({ id: 'lvl-1', widthCells: 10, heightCells: 10, ...overrides });
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
