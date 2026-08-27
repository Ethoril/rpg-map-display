// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  luminance,
  profilLuminance,
  ambianceProposee,
  AMBIANCE_SEUIL_NUIT,
  AMBIANCE_ECHANTILLONS,
} from '../js/import/ambianceImage.js';

/**
 * Un bitmap RGBA uni.
 * @param {number} valeur @param {number} [w] @param {number} [h]
 */
function uni(valeur, w = 40, h = 30) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = valeur; data[i + 1] = valeur; data[i + 2] = valeur; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test('1. La luminance suit Rec. 709, pas une moyenne des canaux', () => {
  // ⚠ Sur des cartes majoritairement herbe et pierre, l'écart n'est pas cosmétique : une
  // moyenne arithmétique sous-pondérerait le vert d'un facteur deux.
  assert.equal(luminance(0, 0, 0), 0);
  // ⚠ Pas d'égalité stricte : 0,2126 + 0,7152 + 0,0722 vaut 1 en décimal mais pas en
  // binaire — le blanc rend 254,999… Exiger 255 exactement ferait rougir un code juste.
  assert.ok(Math.abs(luminance(255, 255, 255) - 255) < 1e-9);
  assert.ok(Math.abs(luminance(0, 255, 0) - 182.4) < 0.1, 'le vert pèse 0,7152');
  assert.ok(Math.abs(luminance(0, 0, 255) - 18.4) < 0.1, 'le bleu pèse 0,0722');

  // ⭐ La mutation qui compte : une moyenne des trois canaux rendrait 85 pour du vert pur.
  assert.notEqual(Math.round(luminance(0, 255, 0)), 85);
});

test('2. Le profil échantillonne toute l’image, pas un coin', () => {
  // Moitié gauche noire, moitié droite blanche : la moyenne doit tomber au milieu. Un
  // échantillonnage qui ne balaierait qu'une région rendrait 0 ou 255.
  const w = 100;
  const h = 60;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? 0 : 255;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const profil = profilLuminance({ data, width: w, height: h });
  assert.ok(Math.abs(profil.moyenne - 127.5) < 3, `moyenne attendue ~127,5, obtenue ${profil.moyenne}`);
  assert.equal(profil.points, AMBIANCE_ECHANTILLONS * AMBIANCE_ECHANTILLONS);

  // Et l'échantillonnage ne dépend pas de la taille : une image minuscule rend le même compte.
  assert.equal(profilLuminance(uni(100, 3, 2)).points, AMBIANCE_ECHANTILLONS ** 2);
});

test('3. ⭐ LES CHIFFRES DU CORPUS RÉEL, relevés le 27/08/2026', () => {
  // ⛔ C'est le cœur : ces trois valeurs viennent des exports réels du mainteneur, mesurées
  // sur l'image décodée. Elles justifient le seuil, et elles doivent rester du bon côté.
  //
  //   testnoncuitenuit          moyenne 12,6   médiane  8,5   ← nuit
  //   testnoncuite (jour)       moyenne 64,1   médiane 58,9
  //   test_village_complet_00   moyenne 71,5   médiane 65,6
  const nuit = ambianceProposee({ moyenne: 12.6, mediane: 8.5 });
  assert.equal(nuit.nocturne, true, '⛔ la carte de nuit DOIT être proposée nocturne');
  assert.equal(nuit.level, 0);
  assert.match(nuit.raison, /image sombre/);
  assert.match(nuit.raison, /Jour\/Nuit/, 'la proposition doit dire qu’elle est corrigeable');

  for (const [nom, moy] of /** @type {Array<[string, number]>} */ ([['testnoncuite', 64.1], ['village', 71.5]])) {
    const jour = ambianceProposee({ moyenne: moy, mediane: moy - 5 });
    assert.equal(jour.nocturne, false, `${nom} doit rester diurne`);
    assert.equal(jour.level, 1);
  }

  // ⭐ La marge, dans les deux sens. Le seuil est à 25 : 2× au-dessus du cas nocturne mesuré,
  // 2,5× en dessous du cas diurne le plus sombre. Le resserrer d'un côté ou de l'autre
  // rapprocherait le corpus de la frontière.
  assert.equal(AMBIANCE_SEUIL_NUIT, 25);
  assert.ok(12.6 * 2 <= AMBIANCE_SEUIL_NUIT + 0.2, 'au moins 2× de marge au-dessus de la nuit mesurée');
  assert.ok(64.1 / AMBIANCE_SEUIL_NUIT >= 2.5, 'au moins 2,5× de marge sous le jour le plus sombre');
});

test('4. ⚠ Le seuil n’est PAS au milieu, et c’est délibéré', () => {
  // Les deux erreurs ne coûtent pas la même chose. Proposer « nuit » à tort assombrit une
  // carte sous les yeux du MJ : visible, corrigé d'un clic. Proposer « jour » à tort laisse
  // l'éclairage inerte — c'est-à-dire l'état d'avant, donc invisible, donc durable.
  const milieu = (12.6 + 64.1) / 2; // ≈ 38,4
  assert.ok(AMBIANCE_SEUIL_NUIT < milieu, 'le seuil penche vers la prudence, pas vers le milieu');

  // Une carte de jour sombre — forêt dense — reste proposée diurne.
  assert.equal(ambianceProposee({ moyenne: 30, mediane: 28 }).nocturne, false);
  // Une carte franchement noire est proposée nocturne.
  assert.equal(ambianceProposee({ moyenne: 5, mediane: 3 }).nocturne, true);

  // ⭐ Et la frontière est stricte du bon côté : à la valeur exacte du seuil, on propose la
  // nuit. Une image à 25 est déjà très sombre.
  assert.equal(ambianceProposee({ moyenne: AMBIANCE_SEUIL_NUIT, mediane: 20 }).nocturne, true);
  assert.equal(ambianceProposee({ moyenne: AMBIANCE_SEUIL_NUIT + 0.1, mediane: 20 }).nocturne, false);
});

test('5. Entrées absurdes : aucune proposition par accident', () => {
  assert.throws(() => profilLuminance(/** @type {any} */ (null)), /bitmap/);
  assert.throws(() => profilLuminance(/** @type {any} */ ({ data: [], width: 0, height: 5 })), /dimensions/);
  assert.throws(() => profilLuminance(/** @type {any} */ ({ width: 4, height: 4 })), /bitmap/);
  assert.throws(() => ambianceProposee(/** @type {any} */ (null)), /profil/);
  assert.throws(() => ambianceProposee(/** @type {any} */ ({ moyenne: NaN })), /profil/);

  // Une image entièrement noire est nocturne ; entièrement blanche, diurne. Les deux bornes.
  assert.equal(ambianceProposee(profilLuminance(uni(0))).nocturne, true);
  assert.equal(ambianceProposee(profilLuminance(uni(255))).nocturne, false);
});

test('6. ⛔ La DÉCLARATION du fichier prime sur la devinette', () => {
  // ⛔ Le défaut, introduit puis corrigé le 27/08/2026 : la première version consultait
  // toujours l'image. `manoir-rdc` (format 0.3) porte `ambient_light: "00000000"` — un donjon
  // qu'on annonce noir — et l'heuristique l'a repassé en plein jour. Remplacer un fait par une
  // devinette.
  //
  // ⭐ La règle : on ne devine QUE si le fichier ne dit rien, et « ne rien dire » a une valeur
  // précise — l'alpha plein, soit un niveau déclaré de 1. C'est ce que Dungeon Alchemist écrit
  // en toutes circonstances, donc son défaut, donc son silence.
  const imageClaire = { moyenne: 64.1, mediane: 58.9 };
  const imageSombre = { moyenne: 12.6, mediane: 8.5 };

  // Un fichier qui déclare 0 est cru, MÊME si son image est claire.
  const declareNuit = ambianceProposee(imageClaire, { niveauDeclare: 0 });
  assert.equal(declareNuit.level, 0, '⛔ la déclaration prime, l’image n’est pas consultée');
  assert.equal(declareNuit.devinee, false);
  assert.match(declareNuit.raison, /le fichier déclare/);

  // Et une valeur intermédiaire est respectée telle quelle, sans être arrondie.
  assert.equal(ambianceProposee(imageClaire, { niveauDeclare: 0.35 }).level, 0.35);

  // ⭐ Un niveau déclaré à 1 est le SILENCE de Dungeon Alchemist : on consulte l’image.
  assert.equal(ambianceProposee(imageSombre, { niveauDeclare: 1 }).level, 0, 'silence ⇒ on devine');
  assert.equal(ambianceProposee(imageSombre, { niveauDeclare: 1 }).devinee, true);
  assert.equal(ambianceProposee(imageClaire, { niveauDeclare: 1 }).level, 1);

  // Sans déclaration du tout, on devine aussi.
  assert.equal(ambianceProposee(imageSombre).devinee, true);
  assert.equal(ambianceProposee(imageSombre).level, 0);

  // ⭐ La mutation qui compte : si la garde disparaissait, `manoir-rdc` — déclaré à 0, image
  // claire — repasserait en plein jour. C'est exactement le défaut du 27/08.
  assert.notEqual(ambianceProposee(imageClaire, { niveauDeclare: 0 }).level, 1);
});
