// @ts-check

/**
 * Résolution du masque raster de fog (8×8 pixels par case carte).
 * Permet un compromis optimal entre précision visuelle et taille du bitmap.
 */
export const FOG_PX_PER_CELL = 8;

/**
 * Taille maximale de texture de secours (en pixels) si la limite WebGL du GPU ne peut être interrogée.
 * Garantit la compatibilité sur les appareils mobiles et tablettes modestes.
 *
 * **Ce n'est pas le plafond de préparation des cartes**, qui vaut
 * `MAX_PREPARED_TEXTURE_PX` dans `scripts/resample.mjs` et se mesure sur le parc réel.
 * Les deux ont divergé volontairement : celui-ci est une hypothèse prudente là où on
 * ne sait pas, celui-là un budget assumé là où on a mesuré. Ne pas les réunifier.
 */
export const MAX_TEXTURE_FALLBACK = 4096;

/**
 * Plafond du ratio de résolution de rendu (devicePixelRatio cap).
 * Limite la consommation mémoire et la charge GPU sur les écrans ultra-haute densité.
 */
export const RENDER_RESOLUTION_CAP = 1.5;

/**
 * Durée minimale du maintien d'appui (en millisecondes) avant d'initier un glisser (drag).
 * Permet de distinguer un tap rapide d'une intention de déplacement de pion ou de carte.
 */
export const DRAG_HOLD_MS = 150;

/**
 * Fréquence maximale de publication de l'état de la caméra/vue sur le réseau (10 Hz, soit toutes les 100 ms).
 * Évite de saturer le canal temps réel tout en assurant une fluidité perçue suffisante.
 */
export const VIEW_PUBLISH_HZ = 10;

/**
 * Clé de `sessionStorage` mémorisant le code de session du MJ.
 *
 * Cette mémorisation est **voulue** : elle fait qu'un F5 accidentel reprend la même session,
 * ce que le CdC §7 qualifie de scénario nominal. Mais `sessionStorage` survit à la
 * restauration d'onglets des navigateurs, si bien qu'une session peut coller après un
 * redémarrage complet — d'où le besoin d'un geste explicite pour la quitter.
 *
 * Domicile unique de la clé : elle est lue par `app/gm.js` et effacée par `ui/gm/panel.js`.
 */
export const GM_SESSION_STORAGE_KEY = 'rpg-gm-session-id';

/**
 * Plafond de la portée de vision des pions en cases (décision mainteneur 31/07/2026).
 * Borne technique pour meuler le coût de balayage du sweep sans altérer l'expérience.
 */
export const VISION_MAX_RANGE_CELLS = 20;

/**
 * Plafond de la charge base64 d'un masque de fog encodé, avant publication au réseau.
 *
 * **Budget assumé, mesuré le 01/08/2026** avec l'encodeur du projet dans Chromium, sur
 * des masques à 90 % explorés — le pire cas, le bord étant alors le plus découpé :
 *
 * | Étage | Masque 8 px/case | Charge base64 |
 * |---|---|---|
 * | `testbig150`, 65 × 71 — la plus grande du dépôt | 520 × 568 | **13,4 Kio** |
 * | hypothétique 100 × 100 | 800 × 800 | 18,7 Kio |
 * | 130 × 142, quatre fois la surface de `testbig150` | 1040 × 1136 | 25,7 Kio |
 *
 * La charge croît **moins vite que la surface** — quadrupler la carte ne double même pas
 * la charge, deflate absorbant le reste. Ce plafond laisse donc près du double de marge
 * au-delà de la plus grande carte imaginée, tout en restant loin du plafond Firestore de
 * 1 Mio.
 *
 * **Pourquoi une borne explicite ici.** La charge est stockée en base64 **brut**, sans
 * préfixe `data:`, faute de quoi `assertNoTransientAssetUrls` la refuserait à 24 Kio.
 * Elle échappe donc à cette garde — et ce projet a déjà perdu une campagne sur une
 * charge non bornée (`ETAT.md`). C'est `vision/fog.js` qui porte la borne à sa place.
 *
 * Comparé à une longueur de chaîne base64, donc légèrement plus strict que le nombre
 * d'octets du PNG : conservateur, ce qui est le bon sens pour un plafond.
 */
export const FOG_MAX_ENCODED_BYTES = 51200;

/**
 * Résolution du masque raster de fog (8 pixels par case).
 */
export const FOG_MASK_PX_PER_CELL = 8;