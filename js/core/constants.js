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
 * Durée d'affichage d'un ping, en millisecondes (CdC §5.5, « marqueur animé ~2 s »).
 *
 * ⛔ **Comptée depuis la réception LOCALE, jamais depuis l'horodatage de l'émetteur.** Le
 * `Date.now()` du poste MJ est une horloge étrangère pour la tablette, et celle de ce projet a
 * été mesurée **5,3 s en avance** : un ping de 2 s jugé sur cet écart serait déjà expiré à
 * l'arrivée et **n'apparaîtrait jamais** là où il sert. Contrairement à l'animation d'un pion, un
 * ping n'a aucun état persistant à reconstituer, donc rien n'exige qu'il soit déterministe entre
 * postes — chacun l'affiche 2 s depuis sa propre réception, et la différence est inobservable.
 */
export const PING_DURATION_MS = 2000;

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
 * Identifiants clos des 3 états de santé d'un PNJ (Chantier Q §3.2).
 * @type {('unharmed'|'wounded'|'critical')[]}
 */
export const HEALTH_STATE_IDS = ['unharmed', 'wounded', 'critical'];

/**
 * Libellés français des états de santé pour l'inspecteur MJ uniquement (Chantier Q §3.2).
 * Table distincte des identifiants (CONVENTIONS §7).
 * @type {Record<'unharmed'|'wounded'|'critical', string>}
 */
export const HEALTH_STATE_LABEL_FR = {
  unharmed: 'Indemne',
  wounded: 'Blessé',
  critical: 'Mal en point',
};

/**
 * Couleurs des états de santé d'un PNJ (Chantier Q §3.2, §5.3, §15.3).
 *
 * ⚠ `wounded` prend `#c2410c` (orange brique profond), strictement séparé de l'orange des murs
 * (`walls.js:38` : `#f97316`) et du jaune `control` (`constants.js:194` : `#facc15`).
 * `critical` réutilise `#ef4444` (rouge dégâts de la catégorie damage).
 * @type {Record<'unharmed'|'wounded'|'critical', string>}
 */
export const HEALTH_STATE_COLOR = {
  unharmed: '',
  wounded: '#c2410c',
  critical: '#ef4444',
};

/**
 * Couleur unique et fixe de l'anneau proportionnel des PJ (Chantier Q §5.2, §5.4).
 * `#2563eb` (bleu royal), hors des familles orange/rouge et distinct du bleu ciel des murs temporaires.
 */
export const TOKEN_HP_PJ_RING_COLOR = '#2563eb';

/** Épaisseur de base de l'anneau de santé en pixels ÉCRAN (Chantier Q §5.1). */
export const TOKEN_HP_RING_THICKNESS_PX = 3;

/**
 * Taille et géométrie du compteur chiffré au coin haut-gauche (Chantier Q §5.5).
 * **Toutes les grandeurs sont en pixels ÉCRAN** (divisées par le zoom au dessin).
 *
 * ⚠ Ne dépend NI du zoom NI du diamètre du pion (arbitrage 1).
 * ⚠ Ne possède aucun seuil de disparition au dézoom (arbitrage 1 & §5.5).
 */
export const TOKEN_HP_BADGE_FONT_SIZE_PX = 11;
export const TOKEN_HP_BADGE_PADDING_X_PX = 4;
export const TOKEN_HP_BADGE_HEIGHT_PX = 16;


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

/**
 * Demi-largeur de la capsule de désignation d'une porte, en cases.
 *
 * Elle valait **0,5**, soit une case entière de bande autour du segment, et c'était trop :
 * retour de table du 05/08/2026, « si un pion est sur une case adjacente aux portes, souvent
 * on ouvre/ferme la porte au lieu de sélectionner le pion ». Le déséquilibre n'était pas dans
 * cette valeur seule mais dans son rapport à l'autre : **le pion se désigne sans aucune
 * tolérance** (la case exacte, `tokenAtCell`), la porte avec une demi-case tout autour.
 *
 * L'arithmétique de la table le dit : à la vue « carte entière » — la vue normale de la
 * tablette — une case fait 33 px à l'écran (cf. `hardware_measurements`), donc l'ancienne
 * bande faisait 17 px quand un doigt en couvre une quarantaine. Le tap sortait de la case du
 * pion, entrait dans la bande de la porte, et la porte gagnait.
 *
 * Précision qui a failli me faire écrire un test creux : la comparaison est `dist < maxDist`,
 * **stricte**, et une porte court sur une arête de case. Viser le centre exact de la case
 * voisine — à une demi-case pile — ne déclenchait donc **déjà** rien à 0,5. La zone-piège
 * n'était pas ce centre mais tout ce qui se trouve entre lui et la porte, du côté vide : le
 * doigt qui manque le pion d'un tiers de case y tombait. C'est cette bande-là que 0,25 divise
 * en deux, et c'est ce point-là que pinne `tests/portals.test.mjs`, cas 6.
 *
 * ⚠ La contrepartie est réelle et assumée : à 0,25 la bande ne fait plus que 8 px à l'écran à
 * cette vue-là, donc **les portes deviennent plus difficiles à viser quand la carte est
 * dézoomée**. C'est le sens du « un peu réduire » demandé — un tap manqué rend désormais un
 * « rien sélectionné » plutôt qu'une porte ouverte par surprise, ce qui est le bon sens de
 * l'erreur. Si la visée devient pénible, c'est cette constante qu'il faut remonter, et elle
 * est seule : les deux vues l'importent depuis `js/input/portalHit.js`.
 *
 * ⛔ Ne pas la convertir en pixels écran par analogie avec les badges. Un badge doit garder sa
 * taille à l'écran ; une porte est un objet de la carte, et une bande constante à l'écran
 * couvrirait **d'autant plus de cases que la carte est dézoomée** — soit exactement le défaut
 * qu'on corrige, amplifié.
 */
export const PORTAL_HIT_CELL_RATIO = 0.25;

/**
 * Type de l'événement qui congédie les autres sessions MJ. Nommé ici parce qu'il est écrit à
 * deux endroits — publication et réception — et qu'une faute de frappe entre les deux ne
 * produirait aucune erreur : juste un bouton sans effet, ce qui est le pire des deux mondes.
 *
 * **L'éviction est coopérative, et ne peut pas ne pas l'être.** Personne ne coupe la connexion
 * d'un autre appareil à distance : le MJ congédié la coupe lui-même en recevant l'événement.
 * Conséquences à connaître avant de s'y fier — un onglet en veille profonde ne se congédiera
 * qu'à son réveil, et un appareil hors réseau jamais.
 *
 * ⛔ **Ne pas « améliorer » en supprimant les entrées de présence des autres.** Ça aurait l'air
 * de marcher : la liste se vide sous les yeux. Puis le heartbeat de chaque client les recrée
 * quelques secondes plus tard (`FirebaseTransport.publishPresence`), toujours connectés,
 * toujours en train de publier. Vider un affichage n'a jamais déconnecté personne.
 */
export const SESSION_EVICT_GM_EVENT = 'session.evictGm';

/**
 * Demande de rediffusion du masque de vision courante, adressée au MJ par une vue joueurs.
 *
 * Le masque de vision est un **delta**, et rien ne le rejoue : le canal borne son écoute
 * strictement après la dernière clé connue (`FirebaseTransport._subscribeLive`), et
 * l'instantané ne transporte que la campagne, l'étage actif et la sélection. Une vue joueurs
 * qui arrive — ou qui revient après que Chrome a abandonné le contexte de son onglet — n'a
 * donc aucun moyen de retrouver la vision par elle-même. Le masque **exploré**, lui, revient
 * de `localStorage` : c'est cette asymétrie qui produisait le symptôme observé le 6 août 2026,
 * « le fog revient en version explorée là où les PJ devraient voir ».
 *
 * ⛔ **Ne pas « simplifier » en persistant le masque de vision comme l'exploré.** Ça aurait
 * l'air de marcher, et c'est plus court. Mais un masque restauré depuis le disque est un
 * masque d'avant l'absence : la tablette afficherait de la vision directe là où les PJ ne
 * voient plus, jusqu'à la prochaine mise à jour. La vision est la seule chose que le MJ
 * recalcule ; elle doit venir de lui, pas d'une archive.
 */
export const VISION_REQUEST_EVENT = 'vision.request';

/**
 * Épaisseurs des indicateurs d'état de porte, **en pixels écran**.
 *
 * Elles étaient écrites en pixels **carte**, à l'intérieur du contexte que
 * `camera.applyToContext` met à l'échelle par `ctx.scale(zoom, zoom)` — donc justes à zoom 1
 * et nulle part ailleurs. Mesuré sur le rendu réel, fog révélé : à la vue « carte entière »
 * (zoom 0,238), le trait de la porte verrouillée tombait à **1 px** d'épaisseur et son
 * cadenas — le seul signe qui la distingue d'une porte fermée — ne pesait plus que **2 px**
 * d'encre, contre 4 px et 16 px à zoom 1. Le pointillé vert de la porte ouverte, lui,
 * n'atteignait plus aucun pixel saturé : `[4, 4]` en pixels carte donne des tirets de 0,95 px
 * sous une épaisseur de 0,71 px, soit une teinte et non une couleur.
 *
 * ⭐ C'est le défaut du chantier K et de L-09, à un troisième endroit : **une grandeur écrite
 * dans le mauvais espace**. La règle du projet ne change pas — toute taille d'indicateur
 * s'écrit en pixels écran, puis se divise par le zoom au moment de tracer.
 *
 * Le rayon du cadenas est en outre borné par la longueur de la porte à l'écran : sur une porte
 * courte et une carte très dézoomée, un disque de taille fixe finirait par la recouvrir
 * entièrement, ce qui ne dirait plus « verrouillée » mais « quelque chose ici ».
 */
export const PORTAL_OPEN_LINE_SCREEN_PX = 3;
export const PORTAL_OPEN_DASH_SCREEN_PX = 4;
export const PORTAL_LOCKED_LINE_SCREEN_PX = 4;
export const PORTAL_LOCK_DOT_RADIUS_SCREEN_PX = 5;
export const PORTAL_LOCK_DOT_MAX_SEGMENT_RATIO = 0.35;
export const PORTAL_LOCK_DOT_BORDER_SCREEN_PX = 1.5;

/**
 * Durée du battement qui signale « cette porte est verrouillée » après un tap sans effet.
 *
 * `TRANCHE-L05-PORTES.md` §7.6 l'exigeait dès la conception — « depuis `locked`, un tap ne
 * fait rien **et le signale** » — et seule la première moitié avait été livrée : le code
 * sortait en silence. Un geste sans effet ni explication est indiscernable d'une panne, et
 * c'est ce qui a fait croire que l'état verrouillé n'était pas implémenté.
 *
 * 600 ms : assez pour être vu après que le doigt se soit relevé, assez court pour ne pas
 * survivre au geste suivant. Le battement passe par `animationActive`, donc par la boucle de
 * rendu à la demande — il ne pose aucun minuteur propre.
 */
export const PORTAL_LOCKED_FLASH_MS = 600;

/**
 * Angle d'ouverture du cône en degrés (convention D&D 5e : 60°).
 */
export const CONE_ANGLE_DEG = 60;

/**
 * Diamètre cible de la poignée de pointe / centre d'un gabarit, en pixels ÉCRAN.
 */
export const TEMPLATE_VERTEX_HANDLE_PX = 24;

/**
 * Ratio maximal du rayon de la poignée par rapport à la portée en pixels écran.
 * Évite d'engloutir le corps d'un cône de rayon 1 dézoomé.
 */
export const TEMPLATE_VERTEX_HANDLE_MAX_RATIO = 0.4;

/**
 * Épsilon de décollement d'origine pour éviter de poser l'origine d'un sweep pile sur un segment.
 */
export const TEMPLATE_ORIGIN_EPS = 0.5;

/**
 * Tolérance de désignation des pions au doigt, en pixels ÉCRAN.
 *
 * Contrairement aux portes (`PORTAL_HIT_CELL_RATIO` qui est une grandeur en espace carte),
 * la tolérance d'un pion n'est pas une propriété de l'objet mais une compensation de l'imprécision
 * du doigt (grandeur écran).
 *
 * À la vue « carte entière » (zoom ~0.24), une case fait 33 px écran quand un doigt en couvre 40 px.
 * Une marge de 24 px écran permet de saisir facilement un pion même si le tap déborde légèrement du pion.
 *
 * Pour éviter d'attraper un pion situé 2 cases plus loin sur une carte très dézoomée, cette marge en pixels
 * est convertie en unités carte (`marginScreen / zoom`) puis plafonnée par `TOKEN_HIT_MAX_CELL_RATIO`
 * (0.75 case carte, strictement inférieur à 1 case). À la vue carte entière (33 px/case), 0.75 * 33 = 24.75 px,
 * ce qui laisse la marge de 24 px totalement active sans être restreinte artificiellement.
 */
export const TOKEN_HIT_MARGIN_SCREEN_PX = 24;
export const TOKEN_HIT_MAX_CELL_RATIO = 0.75;

/**
 * Constantes du Chantier R — La châsse des pions.
 * Toutes les grandeurs d'affichage sont exprimées en pixels ÉCRAN (divisées par le zoom au dessin).
 */
export const CHASSE_BAND_SCREEN_PX = 6;
export const CHASSE_BG_COLOR = '#1e293b';
export const CHASSE_SEPARATOR_COLOR = '#090d16';
export const CHASSE_SEPARATOR_SCREEN_PX = 1.5;
export const CHASSE_BEVEL_LIGHT_COLOR = 'rgba(255, 255, 255, 0.15)';
export const CHASSE_BEVEL_DARK_COLOR = 'rgba(0, 0, 0, 0.35)';
export const CHASSE_NOTCH_COLOR = '#090d16';
export const CHASSE_NOTCH_SCREEN_PX = 2;

export const CHASSE_TIER_FULL_SCREEN_PX = 44;
export const CHASSE_TIER_REDUCED_SCREEN_PX = 24;

/**
 * Part maximale du **rayon** du pion que la châsse peut occuper.
 *
 * Sans cette borne, `CHASSE_BAND_SCREEN_PX` est une valeur absolue : elle mange donc une part
 * d'autant plus grande que le pion est petit. Mesuré sur les bornes du palier `reduced` — un pion
 * de 24 px d'écran a un rayon de 12 px, et une bande de 6 px lui laisse un portrait de 6 px de
 * rayon, soit **un quart de la surface**. Le pion n'est plus une illustration châssée, c'est un
 * cadre avec un point au milieu. Défaut signalé par Gemini le 06/08/2026 sans être tranché, borné
 * ici sur décision du mainteneur.
 *
 * ⭐ **La valeur n'est pas choisie, elle est dérivée — et c'est tout l'intérêt.** Au seuil du
 * palier `full`, un pion de `CHASSE_TIER_FULL_SCREEN_PX` de diamètre a un rayon de la moitié, et
 * la bande nominale y occupe déjà `2 × CHASSE_BAND_SCREEN_PX / CHASSE_TIER_FULL_SCREEN_PX` de ce
 * rayon. Prendre exactement cette proportion comme plafond donne deux propriétés qu'aucun nombre
 * écrit à la main n'aurait garanties :
 *
 *  1. **Le palier `full` n'est jamais affecté** : au-dessus du seuil, le plafond est plus large que
 *     la bande nominale, donc inopérant. Les mesures des critères 2 et 7, prises au palier `full`,
 *     restent inchangées — le bornage ne peut pas les invalider.
 *  2. **Aucune discontinuité au passage de palier** : le plafond vaut exactement la bande nominale
 *     au seuil, puis se resserre continûment sous lui. La châsse s'amincit progressivement au
 *     dézoom au lieu de sauter.
 *
 * ⚠ Elle reste donc cohérente si le mainteneur règle `CHASSE_BAND_SCREEN_PX` ou le seuil : la
 * règle exprimée est « la châsse ne prend jamais, sur un petit pion, une part de rayon plus grande
 * que celle qu'elle a au seuil du palier `full` ». Ne pas la remplacer par une constante en dur,
 * qui contredirait silencieusement les deux autres au premier réglage.
 */
export const CHASSE_BAND_MAX_RADIUS_RATIO =
  (2 * CHASSE_BAND_SCREEN_PX) / CHASSE_TIER_FULL_SCREEN_PX;

export const TOKEN_BORDER_SCREEN_PX = 3;
export const TOKEN_SELECTION_RING_SCREEN_PX = 3;
export const TOKEN_SELECTION_OFFSET_SCREEN_PX = 4;
export const CHASSE_BEVEL_LINE_SCREEN_PX = 1;


