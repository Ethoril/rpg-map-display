// @ts-check

/**
 * Résolution du masque raster de fog (8×8 pixels par case carte).
 * Permet un compromis optimal entre précision visuelle et taille du bitmap.
 */
export const FOG_PX_PER_CELL = 8;

/**
 * Taille maximale de texture de secours (en pixels) si la limite WebGL du GPU ne peut être interrogée.
 * Garantit la compatibilité sur les appareils mobiles et tablettes modestes.
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
