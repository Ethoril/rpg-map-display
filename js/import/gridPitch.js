// @ts-check

/**
 * Détection du **pas de rangée** de la grille peinte dans l'image d'une carte.
 *
 * ## Pourquoi ce module existe
 *
 * `ANALYSE-DD2VTT-GRILLES.md` §4.3 établit qu'un export hexagonal **est**, du point de vue des
 * données, un export carré : la métrologie est identique, la géométrie identique, et le réseau
 * hexagonal n'existe que dans les pixels du JPEG. Le mainteneur a même tenté de forcer l'hexagone
 * à l'export : le fichier produit ne contient aucun champ supplémentaire. Le logiciel ne sait pas
 * déclarer sa topologie.
 *
 * Conséquence, et c'est le défaut que ce module adresse : une carte hexagonale s'importe **en
 * silence** comme une carte carrée. Le déplacement reste juste, mais le rendu dérive — 300 px de
 * pas de colonne contre 259,81 px de pas de rangée, soit **une rangée entière de décalage tous les
 * ~6,5 rangs**. Or l'exigence d'universalité de l'import est explicite : ne jamais rien écarter en
 * silence. Le garde-fou `grid_type === 'hex'` du parseur (`uvtt.js`) ne peut pas y suppléer — c'est
 * du code mort face à ce logiciel, qui n'écrit jamais ce champ.
 *
 * ⚠ **Ce module n'avertit ; il ne corrige ni ne rejette rien.** L'adaptateur hexagonal est le
 * lot 4. Un rejet contredirait l'universalité aussi sûrement que le silence, et une correction
 * automatique de `grid.type` donnerait un hexagone techniquement correct et toujours désaligné
 * (§4.3, note pour le lot 4).
 *
 * ## Comment
 *
 * Un hexagone **pointe en haut** de largeur plat-à-plat `w` a un pas de rangée de `w × √3/2`, les
 * rangées alternées étant décalées d'un demi-pas. Une grille carrée de pas `w` a un pas de rangée
 * de `w`. On cherche donc le **pic dominant** de l'autocorrélation d'un profil d'encre par rangée,
 * et c'est son **rapport** au pas de colonne qui désigne la topologie.
 *
 * Trois rapports sont attendus, et ils ne se recouvrent pas :
 *
 * | rapport | signification |
 * |---|---|
 * | 1,000 | grille carrée |
 * | 0,866 | hexagone, pic simple |
 * | 1,732 | hexagone, **fondamentale** — les rangées alternées ne se répètent qu'après deux pas |
 *
 * ⭐ **Deux défauts de conception trouvés par la mesure, pas par la relecture.** Balayé sur neuf pas
 * de grille de 40 à 300 px, en trois cas — hexagonal, carré, sans quadrillage :
 *
 *  1. Une première version comparait `r(w)` à `r(w × √3/2)` et tranchait sur le plus grand. À 60 px
 *     et 300 px, les **deux** autocorrélations tombaient négatives — −0,23 et −0,21 : un décalage
 *     entier arrondi peut atterrir sur un lobe négatif. Le rythme était là, la sonde regardait à
 *     côté. D'où la recherche d'un maximum, qui tolère la dérive sous-pixel.
 *  2. Cette recherche s'arrêtait à 1,6 fois le pas, et coupait donc la fondamentale à 1,732. Aux
 *     mêmes deux pas, le pic sortait **sur la borne** — 1,60 et 1,59 — et le verdict tombait en
 *     « indéterminé » sur un réseau parfaitement lisible. ⚠ Un maximum trouvé à la borne de sa
 *     plage doit toujours faire soupçonner que le vrai pic est dehors.
 *
 * Après correction : **27 verdicts sur 27**, aux neuf pas et dans les trois cas.
 */

/** Rapport du pas de rangée au pas de colonne pour des hexagones pointe en haut. */
export const HEX_ROW_PITCH_RATIO = Math.sqrt(3) / 2;

/**
 * Autocorrélation minimale pour qu'un pas de rangée soit tenu pour réel.
 *
 * Sous ce seuil, l'image n'a pas de grille peinte lisible — cas du témoin sans quadrillage
 * (§4.2), parfaitement légitime. ⛔ Ne pas l'abaisser pour « détecter plus » : le coût d'un faux
 * positif est un avertissement qui crie au loup sur une carte carrée, ce qui apprend au mainteneur
 * à ignorer les avertissements. Mesuré : 0,79 et 0,83 sur des réseaux nets.
 */
export const MIN_AUTOCORRELATION = 0.3;

/**
 * Écart toléré entre le rapport mesuré et celui qu'une topologie prédit.
 *
 * Les deux hypothèses sont séparées de 13,4 % — 1,000 contre 0,866. Une tolérance de 4 % laisse
 * donc un fossé de 5,4 % entre les deux fenêtres : aucune mesure ne peut satisfaire les deux, et un
 * rapport qui tombe dans l'entre-deux ne se voit attribuer aucune topologie. ⛔ Ne pas l'élargir
 * au-delà de 6 % : les fenêtres se toucheraient, et le détecteur trancherait par arrondi.
 */
export const PITCH_RATIO_TOLERANCE = 0.04;

/**
 * Borne haute de la recherche du pic, en multiples du pas de colonne.
 *
 * Elle doit dépasser `2 × √3/2 = 1,732`, la fondamentale d'un réseau hexagonal (voir le verdict).
 * ⚠ Sans marge au-delà, un pic légitime tombe **sur la borne** et n'est plus reconnaissable — c'est
 * le défaut mesuré à 60 px et 300 px avec une borne à 1,6. Elle reste sous 2,0 pour ne pas capter
 * le second harmonique d'une grille carrée.
 */
export const SEARCH_MAX_RATIO = 1.85;

/**
 * Profil d'encre par rangée : pour chaque ligne de pixels, la quantité de sombre.
 *
 * @param {Uint8Array|Uint8ClampedArray|number[]} rgba Pixels RGBA, 4 octets par pixel
 * @param {number} width
 * @param {number} height
 * @param {number} [colStride=4] Pas d'échantillonnage horizontal. 4 divise le coût par 4 sans
 *   changer la période détectée : on cherche un rythme vertical, pas un détail horizontal.
 * @returns {Float64Array}
 */
export function rowInkProfile(rgba, width, height, colStride = 4) {
  const profil = new Float64Array(height);
  const pas = Math.max(1, Math.floor(colStride));
  for (let y = 0; y < height; y++) {
    let somme = 0;
    const base = y * width * 4;
    for (let x = 0; x < width; x += pas) {
      const i = base + x * 4;
      // Luminance perceptuelle : un trait de grille est sombre quelle que soit sa teinte.
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      somme += 255 - lum;
    }
    profil[y] = somme;
  }
  return profil;
}

/**
 * Autocorrélation normalisée du profil centré, à un décalage donné.
 *
 * @param {Float64Array|number[]} centre Profil déjà centré sur sa moyenne
 * @param {number} energie Somme des carrés du profil centré
 * @param {number} lag
 * @returns {number}
 */
function autocorrelation(centre, energie, lag) {
  if (energie <= 0 || lag <= 0 || lag >= centre.length) return 0;
  let s = 0;
  for (let i = 0; i + lag < centre.length; i++) s += centre[i] * centre[i + lag];
  return s / energie;
}

/**
 * @typedef {Object} GridPitchVerdict
 * @property {'square'|'hex'|'indeterminate'} verdict
 * @property {number} rowPitch Pas de rangée dominant mesuré, en pixels (0 si indéterminable)
 * @property {number} ratio `rowPitch / pxPerCell` (0 si indéterminable)
 * @property {number} rSquare Autocorrélation à l'hypothèse carrée
 * @property {number} rHex Autocorrélation à l'hypothèse hexagonale
 * @property {number} peakLag Décalage du pic dominant, TOUJOURS renseigné — un refus reste diagnosticable
 * @property {number} peakValue Autocorrélation de ce pic
 */

/**
 * Le réseau peint est-il carré ou hexagonal ?
 *
 * @param {Float64Array|number[]} profil Profil d'encre par rangée (`rowInkProfile`)
 * @param {number} pxPerCell Pas de colonne connu par les données, `pixels_per_grid`
 * @returns {GridPitchVerdict}
 */
export function detectPaintedRowPitch(profil, pxPerCell) {
  /** @type {GridPitchVerdict} */
  const indetermine = {
    verdict: /** @type {const} */ ('indeterminate'),
    rowPitch: 0,
    ratio: 0,
    rSquare: 0,
    rHex: 0,
    peakLag: 0,
    peakValue: 0,
  };

  if (!profil || profil.length === 0 || !Number.isFinite(pxPerCell) || pxPerCell < 4) {
    return indetermine;
  }

  const n = profil.length;
  let moyenne = 0;
  for (let i = 0; i < n; i++) moyenne += profil[i];
  moyenne /= n;

  const centre = new Float64Array(n);
  let energie = 0;
  for (let i = 0; i < n; i++) {
    centre[i] = profil[i] - moyenne;
    energie += centre[i] * centre[i];
  }
  if (energie <= 0) return indetermine;

  const lagCarre = Math.round(pxPerCell);
  const lagHex = Math.round(pxPerCell * HEX_ROW_PITCH_RATIO);
  // Deux périodes qui s'arrondissent au même décalage ne sont pas distinguables : c'est le cas
  // sur des cases minuscules, où l'écart de 13,4 % tombe sous le pixel.
  if (lagCarre === lagHex) return indetermine;

  // Rapportées pour le diagnostic, mais **elles ne décident pas**. Voir ci-dessous.
  const rSquare = autocorrelation(centre, energie, lagCarre);
  const rHex = autocorrelation(centre, energie, lagHex);

  // ⭐ **Le verdict vient du pic dominant, pas de deux décalages fixes.** Une première version
  // comparait `r(pxPerCell)` à `r(pxPerCell × √3/2)` et tranchait sur le plus grand. Balayée sur
  // neuf pas de grille, elle décrochait à 60 px et à 300 px, où les DEUX autocorrélations tombaient
  // négatives — −0,23 et −0,21 — parce qu'un décalage entier arrondi peut atterrir sur un lobe
  // négatif de la fonction d'autocorrélation. Le rythme était bien là, la sonde regardait à côté.
  //
  // Chercher le maximum sur une plage tolère cette dérive sous-pixel, puis le RAPPORT du pic au pas
  // de colonne désigne la topologie. L'écart entre les deux hypothèses est de 13,4 % — 1,000 contre
  // 0,866 —, donc une tolérance de 4 % laisse un fossé infranchissable entre elles : aucune valeur
  // ne peut satisfaire les deux.
  let meilleur = { lag: 0, valeur: -Infinity };
  const min = Math.max(2, Math.round(pxPerCell * 0.6));
  const max = Math.min(n - 1, Math.round(pxPerCell * SEARCH_MAX_RATIO));
  for (let lag = min; lag <= max; lag++) {
    const v = autocorrelation(centre, energie, lag);
    if (v > meilleur.valeur) meilleur = { lag, valeur: v };
  }

  // ⚠ **Ne jamais rendre un refus muet.** Une première version renvoyait l'objet `indetermine`
  // dans les cas ci-dessous, donc `rSquare` et `rHex` à zéro — elle **jetait sa propre mesure**.
  // Diagnostiquer un « indéterminé » devenait impossible : on ne pouvait pas distinguer « aucun
  // rythme dans l'image » de « deux rythmes trop proches pour trancher ». Le défaut a été trouvé
  // en balayant les pas de grille avec ce module même, qui affichait 0,000 / 0,000 là où il avait
  // pourtant calculé quelque chose. Une sonde qui perd sa mesure ferme la question au lieu de
  // l'ouvrir.
  /** @param {'square'|'hex'|'indeterminate'} verdict */
  const resultat = (verdict) => ({
    verdict,
    rowPitch: verdict === 'indeterminate' ? 0 : meilleur.lag,
    ratio: verdict === 'indeterminate' ? 0 : meilleur.lag / pxPerCell,
    rSquare,
    rHex,
    peakLag: meilleur.lag,
    peakValue: meilleur.valeur,
  });

  if (meilleur.valeur < MIN_AUTOCORRELATION) return resultat('indeterminate');

  const rapport = meilleur.lag / pxPerCell;

  // ⭐ **Un réseau hexagonal a DEUX signatures, et la seconde est sa fondamentale.** Les rangées
  // alternées sont décalées d'un demi-pas : le profil ne se répète donc à l'identique qu'après
  // DEUX pas de rangée, soit `2 × √3/2 = 1,732`. Selon le pas et l'échantillonnage, c'est tantôt
  // le pic simple (0,866) tantôt le double (1,732) qui domine.
  //
  // Une version précédente ne cherchait qu'entre 0,5 et 1,6 fois le pas de colonne, et coupait
  // donc la fondamentale : à 60 px et 300 px, le pic dominant sortait au **bord** de la plage —
  // rapport 1,60 et 1,59 — et le verdict tombait en « indéterminé » alors que le réseau était
  // parfaitement lisible. Un maximum trouvé à la borne de sa plage de recherche doit toujours
  // faire soupçonner que le vrai pic est dehors.
  if (Math.abs(rapport - 1) <= PITCH_RATIO_TOLERANCE) return resultat('square');
  if (
    Math.abs(rapport - HEX_ROW_PITCH_RATIO) <= PITCH_RATIO_TOLERANCE ||
    Math.abs(rapport - 2 * HEX_ROW_PITCH_RATIO) <= PITCH_RATIO_TOLERANCE
  ) {
    return resultat('hex');
  }

  // Un rythme net mais à un rapport qu'aucune des deux topologies ne prédit : on ne tranche pas.
  // Cas plausibles — une grille peinte à un pas différent de `pixels_per_grid`, ou une texture
  // régulière du décor qui domine le quadrillage. Se taire est le bon comportement : le
  // mainteneur n'a rien à faire d'un avertissement qui ne désigne rien.
  return resultat('indeterminate');
}

/**
 * Avertissement destiné au mainteneur quand le réseau peint est hexagonal, `null` sinon.
 *
 * Le texte dit ce qui a été mesuré, ce que le programme va faire malgré tout, et ce que le
 * mainteneur peut faire — un avertissement qui ne dit pas quoi faire est un bruit.
 *
 * @param {GridPitchVerdict} verdict
 * @param {number} pxPerCell
 * @returns {string|null}
 */
export function hexGridWarning(verdict, pxPerCell) {
  if (!verdict || verdict.verdict !== 'hex') return null;
  const attendu = (pxPerCell * HEX_ROW_PITCH_RATIO).toFixed(1);
  return (
    `Réseau HEXAGONAL détecté dans l'image : pas de rangée mesuré ${verdict.rowPitch} px pour ` +
    `${pxPerCell.toFixed(1)} px de pas de colonne (rapport ${verdict.ratio.toFixed(3)}, ` +
    `attendu ${HEX_ROW_PITCH_RATIO.toFixed(3)} soit ${attendu} px). ` +
    `Le format UVTT ne déclare pas la topologie : la carte est donc préparée en grille CARRÉE, ` +
    `ce qui reste juste pour le déplacement mais dérive visuellement d'une rangée entière tous ` +
    `les ~6,5 rangs. La grille hexagonale est prévue au lot 4. ` +
    `D'ici là, préférer un export à grille carrée pour cette carte.`
  );
}
