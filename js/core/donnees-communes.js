// Données communes à l'outil MJ, à RPG Map Display et aux fiches des PJ (ennemi-interieur-wfrp4).
// SOURCE UNIQUE : dépôt « Outil MJ Warhammer », js/data/donnees-communes.js.
// Les deux autres dépôts en ont une copie identique, produite par `node tools/recopier-donnees-communes.mjs`
// (dépôt de l'outil MJ) ; `--check` échoue si une copie a dérivé. Ne modifiez jamais une copie : modifiez
// la source, puis relancez le script. Module pur, sans import, lisible par le navigateur et par Node.

/**
 * Clé de comparaison d'un nom d'espèce : sans accents ni casse, tirets et soulignés lus comme des espaces.
 * @param {unknown} valeur @returns {string}
 */
export function cleEspece(valeur) {
  return String(valeur ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @typedef {{ id: string, nom: string, alias: readonly string[], taille: 'small'|'average'|'large', mouvement: number,
 *   sansBonusForce: boolean, multiplicateurBlessures: number, mutationPhysiqueMax: number|null }} Espece
 */

/**
 * @param {string} id @param {string} nom
 * @param {{ alias?: string[], taille: Espece['taille'], mouvement: number, sansBonusForce?: boolean,
 *   multiplicateurBlessures?: number, mutationPhysiqueMax?: number|null }} valeurs
 * @returns {Readonly<Espece>}
 */
const espece = (id, nom, { alias = [], taille, mouvement, sansBonusForce = false, multiplicateurBlessures = 1, mutationPhysiqueMax = null }) =>
  Object.freeze({ id, nom, alias: Object.freeze(alias), taille, mouvement, sansBonusForce, multiplicateurBlessures, mutationPhysiqueMax });

/**
 * Espèces jouables (clé `race` des fiches, à tirets). Pour chacune :
 * - `taille` : Taille V5 (`small`, `average`, `large`) ; Halfelin, Gnome, Skink Petits, Ogre Grand (MJ, 07/11/2026 ;
 *   Skink et Skink caméléon : Lustria L07 p. 160, bestiaire p. 136 et 142) ;
 * - `mouvement` : Mouvement de l'espèce ;
 * - Blessures = BF + 2 × BE + BFM (+ BE par « Dur à cuire ») ; `sansBonusForce` retire le BF (espèces Petites
 *   Gnome et Skink ; le Halfelin le garde, L06 p. 341), `multiplicateurBlessures` double le total de l'Ogre ;
 * - `mutationPhysiqueMax` : seuil du jet de manifestation physique (livre de base p. 188) ; null = choix du MJ.
 * `elfe` et `halfling` sont des clés d'anciennes sauvegardes des fiches.
 */
export const ESPECES = Object.freeze([
  espece('humain', 'Humain', { alias: ['human'], taille: 'average', mouvement: 4, mutationPhysiqueMax: 50 }),
  espece('nain', 'Nain', { alias: ['dwarf'], taille: 'average', mouvement: 3, mutationPhysiqueMax: 5 }),
  espece('halfelin', 'Halfelin', { alias: ['halfling', 'halfing'], taille: 'small', mouvement: 3, mutationPhysiqueMax: 10 }),
  espece('gnome', 'Gnome', { taille: 'small', mouvement: 3, sansBonusForce: true }),
  espece('haut-elfe', 'Haut Elfe', { alias: ['high elf', 'elfe haut'], taille: 'average', mouvement: 5, mutationPhysiqueMax: 0 }),
  espece('elfe-sylvain', 'Elfe Sylvain', { alias: ['wood elf'], taille: 'average', mouvement: 5, mutationPhysiqueMax: 0 }),
  espece('elfe-noir', 'Elfe Noir', { taille: 'average', mouvement: 5 }),
  espece('elfe-des-mers', 'Elfe des Mers', { alias: ['sea elf', 'elfe marin'], taille: 'average', mouvement: 5, mutationPhysiqueMax: 0 }),
  espece('elfe', 'Elfe', { alias: ['elf'], taille: 'average', mouvement: 5, mutationPhysiqueMax: 0 }),
  espece('ogre', 'Ogre', { taille: 'large', mouvement: 6, multiplicateurBlessures: 2 }),
  espece('skink', 'Skink', { taille: 'small', mouvement: 6, sansBonusForce: true }),
  espece('skink-cameleon', 'Skink caméléon', { taille: 'small', mouvement: 6, sansBonusForce: true })
]);

const PAR_CLE = new Map(ESPECES.flatMap(entree => [entree.id, ...entree.alias].map(nom => [cleEspece(nom), entree])));

/**
 * Espèce correspondant à un nom (clé de fiche, libellé, alias anglais) ; null si inconnue ou vide.
 * @param {unknown} valeur @returns {Readonly<Espece>|null}
 */
export function especeDe(valeur) {
  return PAR_CLE.get(cleEspece(valeur)) ?? null;
}

/** Contrat de liaison outil MJ ↔ RPG Map Display (docs/CONTRAT_LIAISON_MAP_DISPLAY.md §2). */
export const LIAISON_CARTE = Object.freeze({
  canal: 'wfrp-map-link',
  version: 1,
  battementMs: 5000,
  delaiDeconnexionMs: 15000,
  echoMs: 4000
});
