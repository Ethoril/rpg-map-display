// @ts-check

/**
 * Ambiance PROPOSÉE d'après la luminance de l'image de fond.
 *
 * ⛔ **Pourquoi ce fichier existe : le bloc `environment` de Dungeon Alchemist ne porte aucune
 * information.** Relevé le 27/08/2026 sur les cinq exports réels du dépôt — jour et nuit, et
 * les trois modes d'export « lumière partout / dans l'image / dans le VTT » :
 *
 * ```
 * testnoncuitenuit          baked_lighting: true, ambient_light: "ffffffff"
 * testnoncuite (jour)       baked_lighting: true, ambient_light: "ffffffff"
 * test_village_complet_00   baked_lighting: true, ambient_light: "ffffffff"
 * testbig150                baked_lighting: true, ambient_light: "ffffffff"
 * testvideo-3               baked_lighting: true, ambient_light: "ffffffff"
 * ```
 *
 * **Identique en toutes circonstances.** Une carte de nuit s'importait donc en plein jour
 * (`ambient_light` d'alpha `ff` → `ambient.level: 1`), et `baked_lighting: true` verrouillait
 * par-dessus la bascule Jour/Nuit du panneau MJ. Le mainteneur n'avait jamais pu régler
 * « Nuit » sur aucune de ses cartes.
 *
 * ⭐ **L'image, elle, sait.** Même relevé, luminance moyenne sur 64 × 64 échantillons :
 *
 * | carte | moyenne | médiane |
 * |---|---|---|
 * | `testnoncuitenuit` | **12,6** | **8,5** |
 * | `testnoncuite` (jour) | 64,1 | 58,9 |
 * | `test_village_complet_00` (jour) | 71,5 | 65,6 |
 *
 * Un facteur 5 à 6, sans recouvrement.
 *
 * ⚠ **Ce module PROPOSE, il ne décide pas.** Décision du mainteneur du 27/08/2026 : l'import
 * suggère, lui confirme. C'est une heuristique sur le **contenu** d'une image — une forêt
 * dense de jour, un souterrain bien éclairé la prendraient en défaut — et le seul recours
 * juste contre une heuristique est de laisser le dernier mot à un humain. La bascule
 * Jour/Nuit du panneau MJ reste donc active et prime toujours.
 *
 * ⛔ **Pur : aucune I/O, aucun DOM.** Il reçoit des pixels et rend un verdict, exactement comme
 * `gridPitch.js`. Le décodage appartient à `scripts/resample.mjs`.
 */

/**
 * Seuil de luminance moyenne en deçà duquel une image est proposée comme **nocturne**.
 *
 * ⭐ **Il n'est pas choisi au milieu de l'intervalle mesuré, et c'est délibéré.** Les deux
 * groupes du corpus sont à 12,6 d'un côté, 64,1 et 71,5 de l'autre ; le milieu serait vers 38.
 * Le seuil est posé bien plus bas, à **25**, parce que les deux erreurs ne coûtent pas la même
 * chose :
 *
 * - proposer « nuit » à tort sur une carte de jour sombre → le MJ voit sa carte s'assombrir et
 *   corrige d'un clic ; le défaut est **visible immédiatement** ;
 * - proposer « jour » à tort sur une carte de nuit → l'éclairage reste inerte, ce qui est
 *   exactement l'état d'avant, donc **invisible** — c'est le défaut qui dure.
 *
 * ⚠ Le second est pourtant le moins grave des deux : il ne fait que ne rien changer. On penche
 * donc vers la prudence, en gardant 2× de marge au-dessus du cas nocturne mesuré.
 */
export const AMBIANCE_SEUIL_NUIT = 25;

/**
 * Nombre d'échantillons par axe. 64 × 64 = 4096 points, quelle que soit la taille de l'image :
 * assez pour que le mobilier et les motifs de sol se moyennent, assez peu pour rester
 * instantané sur une image de 6300 × 6300.
 */
export const AMBIANCE_ECHANTILLONS = 64;

/**
 * Luminance perçue d'un pixel, coefficients Rec. 709.
 *
 * ⚠ Une moyenne arithmétique des trois canaux donnerait un vert trop faible et un bleu trop
 * fort — sur des cartes qui sont majoritairement de l'herbe et de la pierre, l'écart n'est pas
 * cosmétique.
 *
 * @param {number} red @param {number} green @param {number} blue
 * @returns {number} 0 → 255
 */
export function luminance(red, green, blue) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Échantillonne une image RGBA et rend son profil de luminance.
 *
 * @param {{ data: Uint8Array|Uint8ClampedArray|number[], width: number, height: number }} bitmap
 * @param {number} [echantillons] Points par axe
 * @returns {{ moyenne: number, mediane: number, points: number }}
 */
export function profilLuminance(bitmap, echantillons = AMBIANCE_ECHANTILLONS) {
  if (!bitmap || !bitmap.data || !Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height)) {
    throw new TypeError('profilLuminance attend un bitmap { data, width, height }.');
  }
  if (bitmap.width <= 0 || bitmap.height <= 0) {
    throw new RangeError('profilLuminance : dimensions nulles ou négatives.');
  }
  const n = Math.max(1, Math.floor(echantillons));

  /** @type {number[]} */
  const valeurs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = Math.min(bitmap.width - 1, Math.floor(((i + 0.5) / n) * bitmap.width));
      const y = Math.min(bitmap.height - 1, Math.floor(((j + 0.5) / n) * bitmap.height));
      const index = (y * bitmap.width + x) * 4;
      valeurs.push(luminance(bitmap.data[index], bitmap.data[index + 1], bitmap.data[index + 2]));
    }
  }

  valeurs.sort((a, b) => a - b);
  const somme = valeurs.reduce((s, v) => s + v, 0);
  return {
    moyenne: somme / valeurs.length,
    mediane: valeurs[Math.floor(valeurs.length / 2)],
    points: valeurs.length,
  };
}

/**
 * Ambiance proposée pour un étage, d'après le profil de son image.
 *
 * ⛔ **Rend une PROPOSITION, jamais une décision.** Le champ `raison` existe pour que le rapport
 * d'import dise ce qu'il a mesuré : une suggestion qu'on ne peut pas contredire est un ordre.
 *
 * ⛔ **On ne devine QUE si le fichier ne dit rien**, et « ne rien dire » a ici une valeur
 * précise : `ambient_light` d'alpha plein, soit `niveauDeclare === 1`. C'est la valeur que
 * Dungeon Alchemist écrit en toutes circonstances — donc son défaut, donc son silence.
 *
 * ⚠ **Toute autre valeur est une déclaration délibérée et prime.** `manoir-rdc` (format 0.3)
 * porte `ambient_light: "00000000"` : un donjon qu'on annonce noir. Écraser cela par une
 * mesure d'image serait remplacer un fait par une devinette — et c'est exactement ce que la
 * première version de ce module a fait le 27/08, en repassant ce donjon en plein jour.
 *
 * @param {{ moyenne: number, mediane: number }} profil
 * @param {Object} [options]
 * @param {number} [options.niveauDeclare] Ambiante lue dans le fichier, 0 → 1
 * @param {number} [options.seuil]
 * @returns {{ level: number, nocturne: boolean, moyenne: number, raison: string, devinee: boolean }}
 */
export function ambianceProposee(profil, options = {}) {
  if (!profil || !Number.isFinite(profil.moyenne)) {
    throw new TypeError('ambianceProposee attend un profil { moyenne, mediane }.');
  }
  const seuil = options.seuil ?? AMBIANCE_SEUIL_NUIT;
  const declare = options.niveauDeclare;

  if (Number.isFinite(declare) && declare !== 1) {
    const valeur = /** @type {number} */ (declare);
    return {
      level: valeur,
      nocturne: valeur <= 0,
      moyenne: profil.moyenne,
      devinee: false,
      raison: `le fichier déclare une ambiante de ${valeur} : elle prime, l'image n'est pas `
        + "consultée. Corrigeable par la bascule Jour/Nuit.",
    };
  }

  const nocturne = profil.moyenne <= seuil;
  const arrondie = Math.round(profil.moyenne * 10) / 10;
  return {
    level: nocturne ? 0 : 1,
    nocturne,
    moyenne: profil.moyenne,
    devinee: true,
    raison: nocturne
      ? `image sombre (luminance moyenne ${arrondie} ≤ ${seuil}) : ambiante proposée à 0 — `
        + 'les sources de la carte feront la lumière. Corrigeable par la bascule Jour/Nuit.'
      : `image claire (luminance moyenne ${arrondie} > ${seuil}) : ambiante proposée à 1. `
        + 'Corrigeable par la bascule Jour/Nuit — une cave se règle sur Nuit.',
  };
}
