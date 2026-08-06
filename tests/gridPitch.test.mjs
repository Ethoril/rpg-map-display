// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rowInkProfile,
  detectPaintedRowPitch,
  hexGridWarning,
  HEX_ROW_PITCH_RATIO,
  MIN_AUTOCORRELATION,
} from '../js/import/gridPitch.js';

/**
 * Trace un réseau dans une image RGBA et rend ses pixels.
 *
 * Les profils ne sont pas fabriqués à la main : ils sont extraits de vraies images tracées, sinon
 * le test ne mesurerait que `rowInkProfile` contre lui-même. Un hexagone **pointe en haut** n'a
 * d'ailleurs aucune arête horizontale — son rythme vertical vient de ses sommets, ce qu'un peigne
 * écrit à la main ne reproduirait pas.
 *
 * @param {number} width
 * @param {number} height
 * @param {'square'|'hex'|'none'} reseau
 * @param {number} pas Pas de colonne (largeur plat-à-plat pour l'hexagone)
 */
function tracer(width, height, reseau, pas) {
  const rgba = new Uint8Array(width * height * 4);
  // Fond clair uniforme.
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 242;
    rgba[i + 1] = 239;
    rgba[i + 2] = 230;
    rgba[i + 3] = 255;
  }

  /** @param {number} x @param {number} y */
  const encre = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= width || yi < 0 || yi >= height) return;
    const i = (yi * width + xi) * 4;
    rgba[i] = 60;
    rgba[i + 1] = 60;
    rgba[i + 2] = 60;
  };

  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
  const ligne = (x0, y0, x1, y1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let k = 0; k <= n; k++) {
      encre(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
      encre(x0 + ((x1 - x0) * k) / n + 1, y0 + ((y1 - y0) * k) / n);
    }
  };

  if (reseau === 'square') {
    for (let x = 0; x <= width; x += pas) ligne(x, 0, x, height - 1);
    for (let y = 0; y <= height; y += pas) ligne(0, y, width - 1, y);
  } else if (reseau === 'hex') {
    const hauteur = (2 * pas) / Math.sqrt(3);
    const pasRangee = pas * HEX_ROW_PITCH_RATIO;
    for (let r = -1; r * pasRangee < height + hauteur; r++) {
      const cy = r * pasRangee;
      const decal = r % 2 === 0 ? 0 : pas / 2;
      for (let c = -1; c * pas + decal < width + pas; c++) {
        const cx = c * pas + decal;
        /** @type {[number, number][]} */
        const sommets = [];
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k - Math.PI / 2;
          sommets.push([cx + (pas / 2) * Math.cos(a), cy + (hauteur / 2) * Math.sin(a)]);
        }
        for (let k = 0; k < 6; k++) {
          ligne(sommets[k][0], sommets[k][1], sommets[(k + 1) % 6][0], sommets[(k + 1) % 6][1]);
        }
      }
    }
  }
  // 'none' : aucun trait. Le témoin du §4.2, une carte sans quadrillage peint.

  return rgba;
}

const L = 900;
const H = 780;
const PAS = 150;

test('1. Une grille carrée peinte est reconnue carrée, au pas exact', () => {
  const rgba = tracer(L, H, 'square', PAS);
  const verdict = detectPaintedRowPitch(rowInkProfile(rgba, L, H), PAS);

  assert.equal(verdict.verdict, 'square');
  assert.equal(verdict.rowPitch, PAS, 'le pas de rangée mesuré doit être le pas de colonne');
  assert.ok(verdict.rSquare > verdict.rHex, 'hypothèse carrée dominante');
  assert.equal(hexGridWarning(verdict, PAS), null, 'aucun avertissement sur une carte carrée');
});

test('2. Un réseau hexagonal peint est reconnu, et le rapport mesuré vaut √3/2', () => {
  const rgba = tracer(L, H, 'hex', PAS);
  const verdict = detectPaintedRowPitch(rowInkProfile(rgba, L, H), PAS);

  assert.equal(verdict.verdict, 'hex');
  assert.ok(
    Math.abs(verdict.ratio - HEX_ROW_PITCH_RATIO) < 0.02,
    `rapport ${verdict.ratio} attendu proche de ${HEX_ROW_PITCH_RATIO}`
  );
  assert.ok(verdict.rHex > verdict.rSquare, 'hypothèse hexagonale dominante');

  const avertissement = hexGridWarning(verdict, PAS);
  assert.ok(avertissement, 'un avertissement doit être émis');
  assert.match(avertissement, /HEXAGONAL/);
  // Un avertissement qui ne dit pas quoi faire est du bruit.
  assert.match(avertissement, /lot 4/);
  assert.match(avertissement, /carr[ée]/i);
});

/**
 * ⭐ Le test qui protège du cri au loup, et c'est le plus important des trois.
 *
 * `ANALYSE-DD2VTT-GRILLES.md` §4.2 documente un témoin parfaitement légitime : une carte **sans
 * quadrillage peint**. Un détecteur qui la déclarerait hexagonale apprendrait au mainteneur à
 * ignorer les avertissements — et un avertissement ignoré ne vaut pas mieux que le silence qu'on
 * est en train de corriger.
 */
test('3. Une carte sans quadrillage peint ne déclenche rien', () => {
  const rgba = tracer(L, H, 'none', PAS);
  const verdict = detectPaintedRowPitch(rowInkProfile(rgba, L, H), PAS);

  assert.equal(verdict.verdict, 'indeterminate');
  assert.equal(hexGridWarning(verdict, PAS), null);
});

test('4. Entrées dégénérées : aucun verdict, aucune exception', () => {
  assert.equal(detectPaintedRowPitch([], 150).verdict, 'indeterminate');
  assert.equal(detectPaintedRowPitch(new Float64Array(100), 150).verdict, 'indeterminate');
  assert.equal(detectPaintedRowPitch([1, 2, 3], Number.NaN).verdict, 'indeterminate');
  // Cases minuscules : l'écart de 13,4 % tombe sous le pixel, les deux hypothèses se
  // confondent, et on refuse de trancher plutôt que de tirer au sort.
  assert.equal(detectPaintedRowPitch(new Float64Array(60).fill(1), 3).verdict, 'indeterminate');
});

test('5. Le seuil d\'autocorrélation refuse un rythme trop faible', () => {
  // Réseau carré noyé dans un fond bruité déterministe : le rythme existe mais reste sous le
  // seuil. On vérifie que le refus vient bien du seuil et non d'un plantage.
  const rgba = tracer(L, H, 'square', PAS);
  const profil = rowInkProfile(rgba, L, H);
  const attenue = Float64Array.from(profil, (v, i) => v * 0.001 + ((i * 7919) % 1000));
  const verdict = detectPaintedRowPitch(attenue, PAS);
  assert.ok(
    Math.max(verdict.rSquare, verdict.rHex) < MIN_AUTOCORRELATION ||
      verdict.verdict === 'indeterminate',
    'un rythme noyé ne doit pas produire de verdict'
  );
});

/**
 * Balayage des pas de grille — le test qui a trouvé les deux défauts de conception du module.
 *
 * ⭐ Les tests 1 à 3 utilisent un seul pas, et ils passaient tous les trois sur une version du
 * détecteur qui décrochait à 60 px et à 300 px. Un cas unique bien choisi ne dit rien de la
 * robustesse : c'est le balayage qui a révélé que le pic dominant d'un réseau hexagonal est tantôt
 * son pic simple (0,866), tantôt sa **fondamentale** (1,732), les rangées alternées ne se répétant
 * qu'après deux pas.
 *
 * 60 px est conservé ici précisément parce qu'il tombe dans le régime de la fondamentale.
 */
test('6. Les trois topologies sont reconnues à tous les pas de grille, pas seulement à un', () => {
  // 300 px est écarté : l'image ferait 43 Mo. Le régime de la fondamentale est déjà couvert par 60.
  const pasATester = [40, 60, 100, 150];
  /** @type {string[]} */
  const echecs = [];

  for (const pas of pasATester) {
    const largeur = pas * 12;
    const hauteur = pas * 10;
    /** @type {[('square'|'hex'|'none'), string][]} */
    const cas = [
      ['square', 'square'],
      ['hex', 'hex'],
      ['none', 'indeterminate'],
    ];
    for (const [reseau, attendu] of cas) {
      const rgba = tracer(largeur, hauteur, reseau, pas);
      const v = detectPaintedRowPitch(rowInkProfile(rgba, largeur, hauteur), pas);
      if (v.verdict !== attendu) {
        echecs.push(
          `pas ${pas}, réseau ${reseau} : attendu ${attendu}, obtenu ${v.verdict} ` +
            `(pic ${v.peakLag} px, rapport ${(v.peakLag / pas).toFixed(3)}, valeur ${v.peakValue.toFixed(3)})`
        );
      }
    }
  }

  assert.deepEqual(echecs, [], `verdicts erronés :\n  ${echecs.join('\n  ')}`);
});

/**
 * ⛔ Le refus doit rester diagnosticable.
 *
 * Une version du module renvoyait des autocorrélations à zéro dès qu'il déclinait, **jetant sa
 * propre mesure**. Diagnostiquer un « indéterminé » devenait impossible : on ne pouvait pas
 * distinguer « aucun rythme » de « rythme net mais à un rapport inattendu ». Le défaut a été trouvé
 * en balayant les pas avec ce module même, qui affichait 0,000 là où il avait pourtant calculé.
 * Une sonde qui perd sa mesure ferme la question au lieu de l'ouvrir.
 */
test('7. Un refus rapporte quand même le pic mesuré', () => {
  // Rythme net à un rapport qu'aucune topologie ne prédit : 1,3 fois le pas de colonne.
  const n = 2000;
  const pas = 150;
  const profil = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * i) / (pas * 1.3)));
  const v = detectPaintedRowPitch(profil, pas);

  assert.equal(v.verdict, 'indeterminate', 'un rapport de 1,3 ne désigne aucune topologie');
  assert.ok(v.peakValue > 0.3, `le pic doit rester rapporté, obtenu ${v.peakValue}`);
  assert.ok(v.peakLag > 0, 'le décalage du pic doit rester rapporté');
});
