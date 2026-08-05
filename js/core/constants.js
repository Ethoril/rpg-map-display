// @ts-check

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
 * Résolution du masque raster de fog : 8 × 8 pixels de masque par case carte.
 *
 * Compromis entre finesse du bord révélé et taille de la charge publiée — c'est le facteur
 * qui gouverne `FOG_MAX_ENCODED_BYTES` juste au-dessus, dont le tableau donne les charges
 * mesurées à cette résolution. Changer l'un oblige à remesurer l'autre.
 *
 * ⚠ **Domicile unique, et il l'est redevenu le 03/08/2026.** Une constante `FOG_PX_PER_CELL`
 * de même valeur existait depuis le lot 1a et n'était plus importée par personne, tandis que
 * la documentation normative — `CONVENTIONS.md` §3, `ARCHITECTURE.md` §1 — ne nommait qu'elle.
 * Le code lisait donc une constante non documentée et les documents en réglaient une morte :
 * le premier ajustement de résolution aurait été écrit au mauvais endroit et n'aurait rien
 * produit. Ne pas réintroduire l'ancien nom.
 */
export const FOG_MASK_PX_PER_CELL = 8;

/**
 * Opacités du voile de fog dans la **vue MJ**, par état de la case.
 *
 * La vue MJ est une carte de travail : le MJ doit *savoir* qu'une zone n'est pas
 * découverte sans cesser de la lire. Les deux valeurs se règlent donc **ensemble**.
 * Baisser la seule opacité du non-exploré vers celle de l'exploré rendrait les deux
 * états indiscernables — l'information « ils n'ont pas encore vu ça » disparaîtrait
 * au moment même où on croit la rendre plus lisible. Garder un écart net entre les
 * trois états (non exploré, exploré hors vision, vu) est la contrainte, pas le
 * niveau absolu de l'un d'eux.
 *
 * « Vu maintenant » vaut 0 : aucun voile, et donc aucune constante.
 */
export const FOG_VEIL_GM_UNEXPLORED = 0.5;
export const FOG_VEIL_GM_EXPLORED = 0.25;

/**
 * Opacités du voile dans la **vue joueurs**.
 *
 * Contrairement aux précédentes, celles-ci ne se règlent pas au goût : l'opacité pleine
 * du non-exploré est ce qui masque **mécaniquement** les pions qui s'y trouvent, la
 * couche de fog étant dessinée au-dessus des pions (L-04 §7). L'abaisser laisserait
 * transparaître un PNJ embusqué dans une zone que les joueurs n'ont jamais vue.
 */
export const FOG_VEIL_PLAYER_UNEXPLORED = 1;
export const FOG_VEIL_PLAYER_EXPLORED = 0.5;

/**
 * Les quatorze marqueurs d'état — **liste close**, CdC §12 Q7 tranchée le 04/08/2026.
 *
 * L'assertion de constance posée sur le littéral ci-dessous n'est pas décorative : elle fait
 * de ce tableau une union de littéraux, dont `StatusMarker` est dérivé. `Object.freeze([...])`
 * élargirait à `string` et viderait l'union de son sens — mesuré sur TypeScript 5.9.3. Ne pas
 * la retirer, et ne pas non plus écrire cette assertion dans un commentaire de documentation :
 * elle y serait lue comme une annotation de déclaration, et `const` n'est pas un type.
 *
 * **L'ordre est celui de la troncature**, du plus décisif au moins décisif : ce qui change ce
 * qu'un personnage peut faire ce tour-ci passe devant ce qui lui coûte des points de vie.
 * C'est un arbitrage de jeu, à confirmer après une séance qui verra cinq marqueurs sur un
 * pion (`TRANCHE-L09-MARQUEURS.md` §3). L'ordre alphabétique masquerait `unconscious`
 * derrière `deafened`, ce qui serait absurde à la table.
 */
export const STATUS_MARKER_IDS = /** @type {const} */ ([
  'unconscious',
  'prone',
  'stunned',
  'entangled',
  'terror',
  'fear',
  'blinded',
  'deafened',
  'broken',
  'frenzy',
  'ablaze',
  'bleeding',
  'poisoned',
  'surprised',
]);

/** @typedef {typeof STATUS_MARKER_IDS[number]} StatusMarker */
/** @typedef {'damage'|'control'|'senses'|'mind'} StatusCategory */

/**
 * Catégorie de chaque état. Sert au palier intermédiaire, où quatre points dédoublonnés
 * remplacent les icônes : « blessé **et** entravé », sans prétendre dire lequel.
 *
 * @type {Record<StatusMarker, StatusCategory>}
 */
export const STATUS_MARKER_CATEGORY = {
  unconscious: 'senses',
  prone: 'control',
  stunned: 'control',
  entangled: 'control',
  terror: 'mind',
  fear: 'mind',
  blinded: 'senses',
  deafened: 'senses',
  broken: 'mind',
  frenzy: 'mind',
  ablaze: 'damage',
  bleeding: 'damage',
  poisoned: 'damage',
  surprised: 'control',
};

/**
 * Couleur de chaque catégorie. **Deux de ces valeurs ne sont pas libres.**
 *
 * `#ef4444` est déjà l'indicateur d'état des portails (`portals.js`) et la couleur par défaut
 * d'un gabarit : collision assumée, rouge = dégâts vaut plus qu'une unicité de teinte, et un
 * trait fin ne se confond pas avec un disque plein posé sur un pion.
 *
 * ⚠ `control` ne prend **pas** l'orange `#f97316`, qui est la couleur des murs
 * (`walls.js:38`) — un point orange sur un pion et un mur orange se scannent ensemble sur
 * l'écran de cast. Le jaune `#facc15` est déjà celui des points de marqueurs. Ne pas
 * « harmoniser » vers l'orange plus tard : ce serait revenir à la collision évitée.
 *
 * @type {Record<StatusCategory, string>}
 */
export const STATUS_MARKER_CATEGORY_COLORS = {
  damage: '#ef4444',
  control: '#facc15',
  senses: '#64748b',
  mind: '#a855f7',
};

/**
 * Libellés français, pour le sélecteur du panneau MJ uniquement.
 *
 * Table distincte des deux précédentes, et c'est délibéré : les réunir obligerait le schéma
 * à importer des libellés d'interface (`CONVENTIONS.md` §7, identifiants en anglais).
 *
 * @type {Record<StatusMarker, string>}
 */
export const STATUS_MARKER_LABEL_FR = {
  unconscious: 'Inconscient',
  prone: 'À terre',
  stunned: 'Sonné',
  entangled: 'Empêtré',
  terror: 'Terreur',
  fear: 'Peur',
  blinded: 'Aveuglé',
  deafened: 'Assourdi',
  broken: 'Brisé',
  frenzy: 'Frénésie',
  ablaze: 'En flammes',
  bleeding: 'Hémorragique',
  poisoned: 'Empoisonné',
  surprised: 'Surpris',
};

/**
 * Géométrie des badges. **Toutes ces valeurs sont en pixels ÉCRAN**, jamais en pixels carte :
 * la couche de rendu travaille en espace carte et le zoom est appliqué par-dessus, donc une
 * grandeur absolue s'écrit ici en pixels écran puis se divise par le zoom au dessin. Un
 * garde-fou écrit dans le mauvais espace ne borne rien — c'était le défaut du chantier K, qui
 * variait d'un facteur 50 sur la plage de zoom.
 *
 * Les deux ratios diffèrent parce que les deux paliers n'ont pas le même nombre
 * d'emplacements. Une rangée de `n` badges de ratio `r` espacés de 1,1 occupe
 * `r × (1,1n − 0,1)` fois le diamètre du pion : à 0,26 quatre emplacements débordent
 * (1,118 D) quand trois tiennent (0,832 D) ; le palier des points en exige quatre — une
 * catégorie chacun — d'où 0,22, qui tient en 0,946 D.
 */
export const BADGE_DIAMETER_RATIO = 0.26;
export const BADGE_DOT_DIAMETER_RATIO = 0.22;

/** Sous 14 px de badge, un glyphe de viewBox 512 devient une tache : on passe aux points. */
export const BADGE_ICON_MIN_PX = 14;

/** Sous 20 px de pion, même quatre points ne tiennent plus : un seul point neutre. */
export const BADGE_DOT_MIN_TOKEN_PX = 20;

/** Plancher d'un point, pour qu'il reste un point et non un pixel. */
export const BADGE_DOT_MIN_PX = 3;

/**
 * Trois emplacements, **jamais quatre** — et le dernier porte le compte `+N` en cas de
 * débordement. Nommer cette constante « max icônes » invitait à dessiner un quatrième badge
 * à côté des trois, qui sortait du pion.
 */
export const BADGE_ROW_SLOTS = 3;

/** Pas d'arrondi de la rastérisation, pour ne pas re-rastériser à chaque cran de pinch. */
export const BADGE_RASTER_STEP_PX = 2;

/**
 * Plafond du cache de rastérisation. Dix tailles distinctes apparaissent sur toute la plage
 * de zoom pour des pions de 1 à 3 cases, soit 140 entrées au pire théorique ; l'usage réel
 * n'expose que trois à cinq états simultanés.
 */
export const STATUS_ICON_CACHE_LIMIT = 128;