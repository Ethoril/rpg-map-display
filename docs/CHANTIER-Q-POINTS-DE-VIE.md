# Chantier Q — Points de vie : compteur MJ, jauge des PJ, état annoncé des PNJ

> **Statut : brief, rien d'écrit.** Demandé par le mainteneur le 04/08/2026, précisé par trois
> arbitrages des 06/08 et 06/08 au soir (§0). **Absent du cahier des charges** et contraire à
> deux textes, dont l'un est cette fois **levé** et non plus seulement précisé (§2).
>
> Ce chantier reprend le §6 d'un brouillon de la tranche L-09 jamais commité, conservé hors de
> git à `.claude/TRANCHE-L09-MARQUEURS.local.md`. Il n'est **pas** la référence : le code a bougé
> sous lui (§1) et les arbitrages du 06/08 en ont retiré la moitié.

---

## 0. Les arbitrages

**(1) Le compteur chiffré est toujours lisible, donc sa taille ne dépend pas du pion.** Taille
constante à l'écran, indépendante du zoom **et** du diamètre du pion, sans seuil de disparition.

**(2) L'état de santé annoncé aux joueurs pour un PNJ est un acte manuel du MJ, jamais un
calcul.** Trois valeurs exclusives — **Indemne**, **Blessé**, **Mal en point** — cochées dans le
panneau MJ. Un PNJ naît Indemne et n'en change que si le MJ le décide.

> Le mainteneur veut pouvoir laisser un boss à 12/140 annoncé « Indemne ». **Un état calculé
> depuis les PV, même « juste au premier coup », détruirait la seule chose que cette
> fonctionnalité sert à faire.**

**(3) L'information passe par un anneau autour du pion, et les deux anneaux ne disent pas la même
chose.** L'étiquette de texte que ce brief proposait d'abord est abandonnée pour les PNJ : elle
coûtait de la place **à côté** du pion, donc elle se cognait aux voisins au dézoom.

| | ce qui varie | ce qui est fixe | qui le voit |
|---|---|---|---|
| **PJ** | la **longueur** de l'anneau, proportionnelle à `current/max` | la couleur | tout le monde |
| **PNJ** | la **couleur** et l'épaisseur, sur trois crans manuels | la longueur (tour complet) | tout le monde |

**C'est la clé de lecture du chantier, et elle est réversible :** chez le PJ la longueur parle et
la couleur se tait ; chez le PNJ la couleur parle et la longueur se tait. Deux anneaux qu'on ne
confond pas, et chacun ne dit que ce qu'il a le droit de dire.

---

## 1. Ce qui a bougé sous le brouillon — trois corrections et un blocage

### 1.1 ⛔ Bloquant, et il n'appartient pas aux PV : une campagne d'avant L-09 ne se charge plus

`validateCampaign` exige `Array.isArray(token.markers)` (`js/core/schema.js:798`). La
normalisation qui devrait combler l'absence **n'existe pas** : `normalizeCampaign`
(`js/core/schema.js:270-280`) ne touche que les couleurs et les étages, jamais les pions. Il n'y
a **pas** de `normalizeToken` dans ce dépôt, contrairement à ce que le brouillon supposait.

Mesuré, pas déduit — un document dont un pion n'a pas de `markers`, passé à `loadCampaign` :

```
REFUSE : Impossible de charger la campagne : document invalide.
         Chargement de la campagne refusée : Pion "t1" : objet non conforme au schéma Token
```

Ce que ce refus contredit est écrit trois lignes au-dessus de l'appel, dans le code lui-même
(`js/state/store.js:330`) : « *Normaliser d'abord : un document hérité doit être converti, jamais
refusé.* » Le contrat est énoncé, le code ne le tient pas. La campagne du mainteneur a été
enregistrée avant le 04/08 ; **elle est concernée**.

⚠ Ce défaut est celui des marqueurs, pas des PV — et c'est pourquoi il entre ici : ce chantier
ajoute *deux* champs qui ont besoin de la même normalisation. **Étape Q-a, avant tout le reste**,
livrable seule.

### 1.2 La signature de `_drawToken` n'a plus besoin d'être enrichie

`_drawToken(ctx, grid, token, position, selected, options)` (`js/render/layers/tokens.js:247`)
reçoit `options`, et l'appel le lui passe (`tokens.js:231`).

⚠ **Ne pas pour autant recalculer le prédicat sur place.** `render()` le calcule déjà, en trois
branches (`tokens.js:189`) :

```js
const isPlayerView = options.role === 'players' || options.isPlayerView === true || (options.isGM === false);
```

Une seconde copie dérivera au premier point d'entrée qui n'emploie qu'une des trois formes.
**Passer le booléen déjà calculé** : il n'existe qu'un seul endroit où ce prédicat se calcule.

### 1.3 Le dimensionnement du brouillon est mort deux fois

Le brouillon écrivait `TOKEN_HP_FONT_RATIO = 0,16 × largeur du pion`. Deux choses l'ont tué, et
elles ne disent pas la même chose :

- **la règle de L-09** (`docs/TRANCHE-L09-MARQUEURS.md` §2.1) : « toute grandeur de badge s'écrit
  en pixels écran, puis se divise par le zoom ». Elle interdit de dépendre du **zoom**.
- **l'arbitrage (1)** : ne pas dépendre non plus du **pion**. Un ratio du diamètre satisferait la
  règle de L-09 tout en violant l'arbitrage — c'est d'ailleurs ce que font les marqueurs
  (`BADGE_DIAMETER_RATIO = 0,26`, `constants.js:237`). **Le compteur et les anneaux ne suivent
  donc pas la géométrie des marqueurs**, et il faut l'écrire à côté des constantes, sinon
  quelqu'un « harmonisera ».

### 1.4 ⚠ Le précédent à ne pas recopier est juste à côté de l'anneau à écrire

L'anneau de sélection est tracé à `radiusX + 4` avec `lineWidth = 3`
(`js/render/layers/tokens.js:306-312`) — **en unités carte, à l'intérieur de la transformation
caméra**. Il maigrit donc au dézoom et grossit au zoom : exactement le défaut que L-09 §2.1
dénonce et que le chantier K avait payé d'un facteur 50.

Ce n'est pas à corriger ici (hors périmètre), mais l'anneau de santé se dessinera à deux pixels
de celui-là. **Copier le voisin serait naturel et faux.**

### 1.5 Ce qui, en revanche, tient toujours

- **Il existe un cran concentrique libre** : la bordure du pion est à `radiusX - 1`
  (`tokens.js:300`), la sélection à `radiusX + 4`. L'anneau de santé se loge entre les deux sans
  rien réorganiser, et `borderColor` reste visible.
- **La rangée de marqueurs est en bas du pion** (`statusBadges.js:137`), la pastille d'élévation
  en **haut-droite** (`statusBadges.js:164-165`) : le coin haut-gauche reste libre pour le
  compteur.
- **`markers` est déjà dans `ALLOWED_TOKEN_PATCH_KEYS`** (`js/state/store.js:739`).
- **`applyTokenPatch` existe** (`js/ui/gm/panel.js:723-745`) et fait déjà `store.updateToken`
  puis `transport.publish({ type: 'token.update', … })`. Aucun chemin réseau à inventer.
- **`TokenLibraryEntry` porte toujours 9 métadonnées** (`js/core/types.js:179-190`) et le JSDoc de
  la projection dit toujours « recopie fidèlement les 9 métadonnées »
  (`js/import/tokenCatalog.js:192`).

---

## 2. L'amendement : ce qui est levé, ce qui est précisé, ce qui reste interdit

Deux textes s'y opposent :

- **CdC §2, non-objectifs** (`docs/CAHIER-DES-CHARGES.md:52`) : « Pas de points de vie. Si le
  besoin apparaît, la version 10 % est un unique état *blessé / à terre* via `markers`, jamais
  une barre. »
- **`CONVENTIONS.md` §8, interdiction n°4** (`docs/CONVENTIONS.md:296`) : « Ni fiches de
  personnage, ni jets de dés, ni tchat, ni initiative, **ni barres de points de vie**… »

### 2.1 Pour les PNJ, l'interdiction est précisée

Ce que l'interdiction nomme est une **barre**, une jauge graphique, et le CdC §2 confirme que
c'est là le vrai refus. Un compteur numérique saisi à la main n'est ni une jauge, ni une fiche de
personnage, ni un moteur de règles. Et l'anneau à trois crans est **exactement** ce que le CdC
prévoyait comme repli acceptable — « un unique état *blessé / à terre* » — en trois crans plutôt
qu'un, et dans son propre champ plutôt que dans `markers`.

### 2.2 Pour les PJ, elle est levée, et il faut l'écrire ainsi

**L'anneau proportionnel d'un PJ est une barre de points de vie.** L'appeler autrement serait se
mentir : sa longueur suit `current/max`. Le texte doit donc être **amendé**, pas interprété.

Ce qui rend la levée défendable, et qui doit figurer dans l'amendement :

- **elle ne divulgue rien.** Les deux objections à une barre étaient qu'elle transforme l'outil en
  fiche de personnage, et qu'elle vend la mèche sur un adversaire. Un PJ n'a rien à cacher à son
  propre joueur : le chiffre `12/28` est déjà écrit sur le pion, l'anneau ne fait que le rendre
  lisible d'un coup d'œil sur les quatre pions de la table.
- **elle est bornée aux PJ, par le rendu, et cette borne est le cœur du chantier.** Un PNJ n'a
  jamais d'anneau proportionnel — c'est l'arbitrage (2), et c'est ce que garde le critère 4.

### 2.3 Ce qui reste interdit

- Toute barre, jauge ou anneau proportionnel **sur un PNJ**, quel que soit le prétexte.
- **Toute dérivation automatique de `health`** (§0). Un grep du chantier ne doit montrer aucune
  lecture de `hp` dans le calcul de `health`, ni « au chargement », ni « comme valeur initiale
  intelligente ».
- Toute dérivation d'un **marqueur** depuis `hp` ou `health` : « 0 PV ⇒ `unconscious` » est la
  première marche vers le moteur de règles que le CdC refuse.
- Tout calcul automatique de dégâts, tout journal de blessures.
- Toute fiche de personnage, tout jet de dés, toute initiative : le reste de l'interdiction n°4
  est intact.

---

## 3. Le modèle — deux champs, et ils ne se parlent pas

```js
/** @property {{ current: number, max: number }|null} hp */
/** @property {'unharmed'|'wounded'|'critical'} health */
```

### 3.1 `hp` — le compteur

- **`null` signifie « PV non suivis »**, défaut de `createToken`. Une torche, un décor, un pion de
  porte n'ont pas de PV — et `0/0` n'est pas une façon de le dire : il s'afficherait.
- **Un objet unique plutôt que `hpCurrent` / `hpMax`** : deux champs rendent représentable « un
  courant sans maximum », qui ne veut rien dire. `emitsLight` est déjà un objet nullable de cette
  forme — le précédent est dans le modèle.
- **Validation stricte** : `null`, ou deux entiers avec `max >= 1` et `0 <= current <= max`.
  Message nommant le pion, comme ceux des marqueurs (`schema.js:802-810`).
- **Zéro est le plancher, pas de négatif.** ⚠ Côté interface le plancher se **borne**, il ne se
  refuse pas : saisir `-3` inscrit `0`, sans message d'erreur. Refuser ferait dire à l'outil « ce
  n'est pas un nombre » quand la réponse est « c'est zéro ».
- **Le dépassement du maximum reste refusé** (PV temporaires), faute de besoin exprimé.

### 3.2 `health` — l'annonce faite aux joueurs, sur un PNJ

- **Vocabulaire clos de trois valeurs**, dans `js/core/constants.js` à côté des marqueurs :
  `HEALTH_STATE_IDS = ['unharmed', 'wounded', 'critical']`, plus `HEALTH_STATE_LABEL_FR`
  (Indemne / Blessé / Mal en point) et `HEALTH_STATE_COLOR`. **Trois tables distinctes**, comme
  les marqueurs en ont trois (`constants.js:200-206`) : les réunir obligerait le schéma à importer
  des libellés d'interface, ce que `CONVENTIONS.md` §7 refuse. Identifiants en anglais, libellés
  en français.
- **Ce n'est pas une quinzième valeur de `markers`, et ce point n'est pas négociable.** Les
  quatorze marqueurs sont un **ensemble** : indépendants, cumulables. Les trois états de santé
  sont **exclusifs**. Les loger dans `markers` demanderait une logique d'exclusion dans un champ
  dont toute la validation (`schema.js:802-810`) suppose l'inverse. **Le vocabulaire des quatorze
  reste clos ; CdC §12 Q7 n'est pas rouvert.**
- **Défaut `'unharmed'`, absent ⇒ `'unharmed'`.** Pas de `null` : « exactement un des trois » est
  la propriété qui rend le champ simple, un quatrième cas la reprendrait.
- **Le champ existe sur tous les pions, mais n'est dessiné que sur les PNJ.** Un modèle uniforme
  coûte moins cher qu'une exception ; en revanche l'inspecteur le **masque** sur un PJ (§8), sinon
  il offre un réglage sans effet.

### 3.3 La seule chose que les deux champs partagent : une porte d'affichage

**Rien ne s'affiche si `hp === null`** — ni compteur, ni anneau, ni état.

Sans cette porte, une torche annoncerait « Indemne » aux joueurs. Avec elle, `hp !== null` se lit
« le MJ suit ce pion au combat », et c'est la seule question à laquelle un état de santé répond.

⚠ **C'est une porte d'affichage, pas une dérivation.** La *valeur* de `health` ne descend jamais
de `hp` (§0) ; seule sa *visibilité* dépend de l'existence du compteur. Un relecteur qui
confondrait les deux croirait le §2.3 violé — d'où cette ligne.

### 3.4 Aucun `schemaVersion` à incrémenter

Deux champs optionnels dont l'absence a un sens défini ne cassent aucun document.

---

## 4. Qui voit quoi

| | Vue MJ | Vue joueurs |
|---|---|---|
| **PJ**, `hp` renseigné | anneau proportionnel + `courant/max` | anneau proportionnel + `courant/max` |
| **PNJ**, `hp` renseigné | anneau de l'état + `courant/max` | **anneau de l'état seul** |
| `hp === null` | rien | rien |

- **Une seule case du tableau dépend de la vue** : le chiffre d'un PNJ. Tout le reste se dessine
  à l'identique des deux côtés, ce qui réduit la surface où une divergence peut se glisser.
- **Le MJ voit donc exactement l'anneau que ses joueurs voient**, sans avoir à sélectionner le
  pion : il sait ce qu'il a annoncé.
- **Les joueurs ne voient jamais le chiffre d'un PNJ**, quel que soit son état.

⚠ **Ne pas confondre avec `hidden`.** Un PNJ masqué n'est déjà pas dessiné côté joueurs ; ce
filtre-ci cache **un chiffre sur un pion visible**. Un PNJ visible dont les PV fuiteraient
annoncerait aux joueurs exactement quand frapper.

**Et ce n'est pas une frontière de sécurité**, comme l'autorisation des portes à L-05
(`PLAN-LOT2.md` §2.3) : la tablette **reçoit** les PV des PNJ dans l'instantané et choisit de ne
pas les dessiner. Le modèle de confiance du CdC §4bis est assumé ; la seule vraie frontière est la
liste blanche d'adresses des règles Firebase. Le dire évite de croire le masquage plus solide
qu'il n'est — et surtout qu'on « corrige » en filtrant les données transmises, ce qui casserait le
passage d'un pion de PNJ à PJ.

---

## 5. Les anneaux

### 5.1 Géométrie commune

Un anneau concentrique logé entre la bordure du pion (`radiusX - 1`) et l'anneau de sélection
(`radiusX + 4`), **écrit en pixels écran puis divisé par le zoom** — et surtout pas copié sur son
voisin de `tokens.js:306-312`, qui est écrit en unités carte (§1.4).

- **Ordre de dessin** : image, bordure, **anneau de santé**, anneau de sélection, puis les badges
  de marqueurs et d'élévation par-dessus. Les badges du bas croisent l'anneau et doivent le
  recouvrir, pas l'inverse.
- **Départ à midi, sens horaire** pour tout arc partiel. Écrit une fois, ici, sinon deux
  implémentations divergeront.
- **Épaisseur constante à l'écran** : à 33 px la case (vue « carte entière » de la tablette,
  `CHANTIER-O` §1), 3 px d'anneau restent parfaitement visibles là où « Mal en point » écrit en
  toutes lettres n'avait aucune chance de tenir. **C'est tout le gain de l'arbitrage (3).**
- **`hp === null` ⇒ aucun anneau** (§3.3).

### 5.2 L'anneau du PJ — la longueur parle, la couleur se tait

Arc partant de midi, de longueur `current / max` du tour complet. **Couleur unique et fixe**,
définie en constante.

⚠ **La couleur ne varie pas avec le pourcentage**, et c'est un arbitrage du 04/08/2026 qu'il faut
respecter ici plutôt que le contourner : le mainteneur a écarté « la couleur variable selon le
pourcentage restant ». La longueur porte désormais l'information — la couleur n'a plus rien à
dire, et la faire parler quand même serait une redondance qui ne coûte que de la confusion avec
l'anneau des PNJ (§5.4).

- **`current === 0` ⇒ arc de longueur nulle, donc rien.** Ce n'est pas ambigu : le PJ porte
  toujours son compteur, qui lit `0/28`. Ne pas dessiner de moignon minimal pour « signaler » le
  zéro — ce serait un arc dont la longueur ne veut plus rien dire.
- **Choix de la couleur** : ni orange ni rouge (§5.4), hors des quatre couleurs de catégorie des
  marqueurs (`constants.js:192-197`) et hors de l'orange des murs. **Pas `borderColor`** : elle
  est libre, un joueur peut choisir le rouge, et l'anneau deviendrait celui d'un PNJ agonisant.

### 5.3 L'anneau du PNJ — la couleur parle, la longueur se tait

Tour complet, toujours. Trois crans :

| `health` | anneau | épaisseur |
|---|---|---|
| `unharmed` | **rien du tout** | — |
| `wounded` | orange | 1× |
| `critical` | rouge | **2×** |

- **Le cran par défaut ne dessine rien**, et c'est ce qui garde la carte propre : sur un plateau
  où la plupart des PNJ vont bien, presque rien n'est tracé. C'est aussi ce qui rend le bluff
  gratuit — un boss à 12/140 laissé « Indemne » n'est **pas décoré**, il ne porte pas un anneau
  vert qui inviterait à chercher la nuance.
- **L'épaisseur double au cran rouge**, et c'est une redondance voulue : orange et rouge seuls se
  confondent pour un daltonien, une épaisseur non. Redonder par l'épaisseur et non par la
  **longueur** — un arc partiel rouvrirait la lecture proportionnelle interdite au §2.3.
- **Réutiliser `#ef4444` pour `critical`**, qui est déjà le rouge de la catégorie `damage`
  (`constants.js:193`) : deux rouges différents sur le même canvas seraient un défaut, pas une
  distinction. L'orange est à choisir hors de celui des murs (`walls.js:38`) — c'est la collision
  que L-09 a évitée en refusant d'harmoniser `control` vers l'orange (`constants.js:186-188`).

### 5.4 ⚠ Le risque propre à cette combinaison : deux anneaux pleins qui disent le contraire

**Un PJ à plein affiche un tour complet. Un PNJ « mal en point » affiche un tour complet.** La
même image signifie « en pleine forme » et « à l'agonie » selon le pion qui la porte. C'est le
seul vrai danger de l'arbitrage (3), et il ne se règle que par la couleur :

> **La couleur de l'anneau des PJ ne doit appartenir ni à la famille de l'orange, ni à celle du
> rouge.** C'est une contrainte de correction, pas de goût, et elle se garde par un test
> (critère 6).

### 5.5 Le compteur chiffré

Pastille au coin haut-gauche, fond sombre opaque, texte blanc gras `courant/max`. Taille
constante à l'écran, sans seuil de disparition (arbitrage 1). Constante rangée avec les `BADGE_*`
de `js/core/constants.js`, **avec le commentaire disant pourquoi elle n'est pas un ratio comme
ses voisines** (§1.3).

⚠ **Pas de seuil de disparition, contrairement à la pastille d'élévation** qui s'efface sous 40 px
de pion (`statusBadges.js:166`). Deux règles opposées sur le même pion : l'élévation est un
confort, le compteur est ce qu'on est venu lire. À écrire dans le commentaire, sinon quelqu'un
alignera l'une sur l'autre en croyant réparer un oubli.

**Ce qui reste du problème de chevauchement** : les pastilles ne subsistent que sur les PJ côté
joueurs — ils sont quatre, le risque est théorique. Côté MJ elles subsistent sur tout ce qui a des
PV, PNJ compris. Si le plateau devient illisible en combat, le repli est de **ne dessiner la
pastille que sur le pion sélectionné côté MJ** — l'anneau porte déjà l'état de tous les autres.
À constater à la table (§12), pas à décider maintenant.

### 5.6 Où l'écrire

`js/render/statusBadges.js` porte déjà le calcul de géométrie de la pastille d'élévation alors que
son dessin est resté en ligne dans `tokens.js:332-336`. **Suivre la même répartition** — géométrie
pure et testable sous Node dans `statusBadges.js`, dessin dans `_drawToken` — plutôt qu'inventer
une troisième convention.

---

## 6. Le maximum est préréglable dans la bibliothèque de pions

Un gobelin récurrent réglé à 7 PV s'instancie prêt, comme il s'instancie déjà avec sa taille, sa
vitesse et sa vision.

**`TokenLibraryEntry` gagne `maxHp: number|null`** — un scalaire, et c'est la raison **inverse** de
celle du §3.1 : une entrée de bibliothèque est un **gabarit**, elle n'a pas de « courant » à
porter. Aucun état illégal à rendre irreprésentable, et un `{ current, max }` dans un gabarit
inviterait à y écrire un courant qui ne veut rien dire.

**Aucun `health` dans la bibliothèque** : un gabarit naît indemne, toujours. Un champ qui n'aurait
qu'une valeur utile n'est pas un champ.

**La projection pose le pion à plein** : `createTokenFromLibraryEntry`
(`js/import/tokenCatalog.js:198`) calcule
`hp = entry.maxHp === null ? null : { current: entry.maxHp, max: entry.maxHp }` et
`health: 'unharmed'`. **Aucune option `hp` dans `TokenProjectionOptions`** : elle ne servirait
qu'à instancier un pion déjà blessé, ce que l'inspecteur fait mieux et sans doublon de chemin.

⚠ Le JSDoc « recopie fidèlement les **9** métadonnées » (`tokenCatalog.js:192`) en fera **dix**.
Non mis à jour, il ment.

⚠ **Le champ doit être saisissable dans l'outil de cartes, dans le même chantier.** Le formulaire
vit dans `prepare.html:129-142`. **Un champ ajouté au modèle et absent de ce formulaire est un
champ que personne ne pourra jamais renseigner**, et le dépôt porte déjà cette cicatrice :
`ETAT.md` §Chantier M raconte la bibliothèque « en lecture seule » dont le mécanisme de
compensation était devenu inopérant en silence. **Quatre endroits** :

| fichier | ligne | quoi |
|---|---|---|
| `prepare.html` | 129-142 | le champ, à côté de `tk-vd` |
| `js/app/prepare.js` | 354-356 | lecture du formulaire à l'enregistrement |
| `js/app/prepare.js` | 299-301 | pré-remplissage à l'édition |
| `js/app/prepare.js` | 265-266 | ligne de résumé d'une entrée |

**Le catalogue commité est vide** (`maps/tokens/catalog.json` : `{ version: 1, tokens: [] }`) —
aucune entrée à migrer. La validation doit tout de même tolérer `maxHp` absent en le normalisant à
`null` (modèle : `tokenCatalog.js:88-93`) : ce fichier s'édite à la main, et un fichier écrit à la
main précède toujours le champ qu'on vient d'ajouter.

---

## 7. Les événements

```js
{ type: 'token.update', payload: { tokenId, patch: { hp } },     at, by: 'gm' }
{ type: 'token.update', payload: { tokenId, patch: { health } }, at, by: 'gm' }
```

**Ne créer ni `token.hp` ni `token.health`.** `CONVENTIONS.md` §4 interdit d'inventer un type
d'événement, et `token.update` fait déjà le travail : patch de valeurs absolues, périmètre décidé
par la seule liste blanche du store. Un type de plus serait un second chemin vers la même donnée.

**Deux entrées à ajouter à `ALLOWED_TOKEN_PATCH_KEYS`** (`js/state/store.js:727-739`) : `hp` et
`health`. `markers` y est déjà.

**Valeurs absolues, jamais de delta.** Ce serait la quatrième fois que le dépôt paierait la leçon
(`handout.hide` au chantier H, `token.elevation` au chantier K, `portal.toggle` à L-05) : un
« retire 3 PV » rejoué deux fois ne converge pas.

---

## 8. L'inspecteur MJ

Mise en forme : la section d'élévation (`js/ui/gm/panel.js:117-122`). Câblage : la grille des
marqueurs (`panel.js:154-160`, synchronisation `panel.js:705-706`).

**Points de vie** — deux champs numériques, `courant` et `maximum` :

- **Vider le maximum remet `hp` à `null`** : la façon de dire « ce pion n'a pas de PV suivis »
  sans ajouter une case à cocher.
- **Le plancher se borne sans se plaindre** : `-3` devient `0`.
- **Baisser le maximum sous le courant abaisse le courant avec lui.** `12/12` dont le maximum
  passe à `8` vaut `8/8`, pas une erreur : le MJ corrige une fiche, il ne commet pas une faute.
- Identifiants DOM : `#token-hp-current`, `#token-hp-max`.

**État de santé** — ⚠ **trois boutons radio, pas trois cases à cocher.** La demande disait « comme
les marqueurs » : l'emplacement et le geste doivent leur ressembler, mais les marqueurs se cumulent
quand les trois états s'excluent (§3.2). Trois cases rendraient cochable « Indemne + Mal en
point », que le modèle refuse : le panneau publierait une valeur invalide et le store la
rejetterait sous le nez du MJ. Un groupe de radios rend l'état illégal **impossible à composer**,
ce qui vaut toujours mieux que de le rendre détectable.

- Identifiants DOM : `#token-health-unharmed`, `#token-health-wounded`, `#token-health-critical`.
- **Masqué sur un PJ** — son anneau est calculé, le réglage n'aurait aucun effet (§3.2).
- **Grisé quand `hp === null`** — cohérent avec la porte du §3.3.

**Les deux passent par `applyTokenPatch`** (`panel.js:723`), qui journalise déjà le refus dans
`tokenEditStatus` et resynchronise depuis le store. Rien à ajouter là.

⚠ **Un piège déjà payé sur ce même panneau** : `panel.js:638` documente que la saisie de
l'élévation faisait passer le pion à `+1` **puis** `+12` quand on tapait « 12 », parce que
l'événement écoutait chaque frappe. Écouter `change`, pas `input` — sinon chaque chiffre tapé part
sur le réseau.

---

## 9. Ce qu'il faut écrire

| fichier | état | quoi |
|---|---|---|
| `js/core/schema.js` | modifié | **Q-a** : normalisation d'un pion hérité (`markers` ⇒ `[]`, `hp` ⇒ `null`, `health` ⇒ `'unharmed'`), appelée depuis `normalizeCampaign`. **Q-b** : validation de `hp` et `health`, défauts dans `createToken` |
| `js/state/store.js` | modifié | `hp` et `health` dans `ALLOWED_TOKEN_PATCH_KEYS` |
| `js/core/types.js` | modifié | `Token.hp`, `Token.health`, `TokenLibraryEntry.maxHp` |
| `js/core/constants.js` | modifié | `HEALTH_STATE_IDS`, `HEALTH_STATE_LABEL_FR`, `HEALTH_STATE_COLOR`, couleur et épaisseurs des anneaux, géométrie de la pastille — **en pixels écran**, avec les avertissements des §1.3 et §5.5 |
| `js/render/statusBadges.js` | modifié | géométrie des anneaux et de la pastille, pure et testable sous Node |
| `js/render/layers/tokens.js` | modifié | `isPlayerView` transmis à `_drawToken` (§1.2), dessin des deux anneaux et de la pastille selon le §4, dans l'ordre du §5.1 |
| `js/ui/gm/panel.js` | modifié | deux champs numériques, trois radios, masquage sur PJ, grisage, écoute sur `change` |
| `js/import/tokenCatalog.js` | modifié | validation et normalisation de `maxHp`, projection vers `hp` et `health`, JSDoc « 9 » → « 10 » |
| `prepare.html`, `js/app/prepare.js` | modifiés | le champ `maxHp` et ses quatre points (§6) |

Aucun fichier nouveau : **`docs/ARCHITECTURE.md` n'est pas à toucher**, le test qui garde le
manifeste ne se déclenche que sur un module créé.

---

## 10. Ce qui n'est PAS dans ce chantier

- **Aucun anneau proportionnel sur un PNJ** (§2.3). C'est l'interdiction centrale.
- **Aucune dérivation de `health` depuis `hp`** — ni au chargement, ni « comme valeur initiale
  intelligente ».
- Aucune dérivation d'un marqueur depuis `hp` ou `health`.
- **Aucune quinzième valeur de `markers`** : Q7 reste tranchée à quatorze (§3.2).
- Aucune correction de l'anneau de sélection (§1.4) — le défaut est relevé, pas traité ici.
- Aucun calcul de dégâts, aucun journal de blessures.
- Aucun PV temporaire, aucun dépassement du maximum.
- Aucune saisie de PV ni d'état par les joueurs.
- Aucun `health` dans la bibliothèque de pions (§6).

---

## 11. Amendements requis

À écrire **dans le même lot que le code**, sinon le dépôt se contredit :

- **CdC §2, non-objectifs** (`CAHIER-DES-CHARGES.md:52`) — remplacer « Pas de points de vie » par
  les trois briques : compteur `xx/xx`, anneau proportionnel **sur les PJ seulement**, état
  annoncé en trois crans sur les PNJ. Reprendre les §2.1 à 2.3 dans l'ordre : ce qui est précisé,
  ce qui est **levé**, ce qui reste interdit.
- **`CONVENTIONS.md` §8, interdiction n°4** (`CONVENTIONS.md:296`) — « ni barres de points de
  vie » devient « ni barre de points de vie **sur un PNJ** », plus l'interdiction de dériver
  `health` d'un compteur. ⚠ **Ne pas se contenter de la nuancer** : la barre existe désormais
  pour de bon sur les PJ, et un texte qui prétendrait l'inverse serait faux.
- **CdC §5.2** — `hp` et `health` dans le document `Token`, et la règle de visibilité du §4.
- **CdC §6** — `maxHp` dans `tokenLibrary`, `hp: null` et `health: 'unharmed'` dans la campagne
  d'exemple.
- **CdC §12** — Q7 **n'est pas rouvert** ; le dire, sinon la lecture croisée du §3.2 et de Q7
  laissera croire que le vocabulaire est passé à dix-sept.
- **`ETAT.md`** — le chantier et ses vérifications de table.

---

## 12. Critères d'acceptation

1. **Une campagne enregistrée avant le 04/08/2026 se recharge** — `markers` absent devient `[]`,
   `hp` devient `null`, `health` devient `'unharmed'`, et `loadCampaign` ne refuse rien. Premier
   critère parce que c'est une régression en cours (§1.1).
2. `hp === null` n'affiche rien : ni anneau, ni compteur, ni état, des deux côtés.
3. Un **PJ** à `14/28` montre un demi-anneau et `14/28`, des deux côtés, à l'identique.
4. Un **PNJ** à `12/140` laissé `unharmed` **n'affiche aucun anneau** côté joueurs, et son chiffre
   n'apparaît nulle part sur la tablette. C'est le critère qui justifie tout le chantier : le jour
   où il échoue, quelqu'un a automatisé.
5. Un **PNJ** ne porte **jamais** d'anneau proportionnel, quel que soit son `hp`.
6. **Un PJ à plein et un PNJ `critical` ne se confondent pas** : les deux tracent un tour complet,
   la couleur seule les distingue (§5.4). Vérifié à la sonde, sur les deux pions côte à côte.
7. **L'épaisseur des anneaux et la taille de la pastille sont identiques à l'écran** à trois zooms
   **et** pour trois tailles de pion. Le test qui garde l'arbitrage (1) et le §1.4.
8. La pastille ne disparaît à aucun zoom (§5.5).
9. `-3` inscrit `0`, sans message. Vider le maximum remet `hp` à `null`. Abaisser le maximum sous
   le courant abaisse le courant.
10. Le groupe de radios rend « Indemne + Mal en point » **impossible à composer**, est **masqué**
    sur un PJ et **grisé** quand `hp === null`.
11. Taper « 12 » dans un champ publie **un** événement, pas deux (§8).
12. Une entrée de bibliothèque à `maxHp: 7` instancie un pion à `7/7`, `'unharmed'` ; une entrée
    sans `maxHp` instancie un pion à `hp: null`. Le champ est **saisissable** dans `prepare.html`
    et survit à un aller-retour enregistrement / réédition.
13. Un grep du chantier ne montre aucune dérivation de `health` depuis `hp` (§10).
14. **Vérifications de table**, qui ne se cochent pas en machine :
    - les PV d'un PNJ ne fuient sur aucun des trois écrans, TV sous cast comprise ;
    - l'anneau se distingue à la vue « carte entière » de la tablette, orange contre rouge ;
    - les pastilles chiffrées du MJ restent lisibles en combat, ou il faut appliquer le repli du
      §5.5.

---

## 13. Tests attendus

**Sous Node** (`tests/*.test.mjs`) :

- **normalisation** — un pion sans `markers`, sans `hp`, sans `health` traverse `loadCampaign` et
  ressort `[]` / `null` / `'unharmed'`. Le test qui aurait attrapé le §1.1.
- **`validateCampaign`** — refus nommant le pion sur : `hp.max` nul ou négatif,
  `hp.current > hp.max`, `hp` non entier, `hp` mal formé, `health` hors vocabulaire.
- **`updateToken`** — `hp` et `health` acceptés ; un patch invalide **ne mute rien**.
- **géométrie des anneaux** — l'épaisseur en pixels écran est identique à trois zooms **et** pour
  trois tailles de pion ; l'arc d'un PJ à `14/28` couvre la moitié du tour, à `0/28` rien du tout.
- **`tokenCatalog`** — `maxHp` absent normalisé à `null` ; nul, négatif ou non entier refusé ;
  projection `7` ⇒ `{ current: 7, max: 7 }` et `'unharmed'`.

**Navigateur** (`tests/*.spec.mjs`) :

- **le filtre du §4** — un PNJ `wounded` à `5/9` : la sonde trouve `5/9` sur le canvas MJ et **pas
  sur le canvas joueurs**, au même endroit et au même zoom, alors que l'anneau orange est présent
  des deux côtés. Un test qui vérifierait seulement « quelque chose est dessiné » ne prouverait
  rien.
- **le critère 6** — un PJ à plein et un PNJ `critical` côte à côte : deux tours complets, deux
  couleurs mesurées distinctes.
- **l'inspecteur** — `-3`, maximum vidé, maximum abaissé sous le courant, radios exclusives,
  masquage sur PJ, grisage quand `hp === null` ; l'état du store après chaque geste.
- **un seul événement par saisie** (critère 11), compté sur le transport.

---

## 14. Découpage et ordre

| étape | contenu | pourquoi séparée |
|---|---|---|
| **Q-a** | La normalisation d'un pion hérité — `markers`, `hp`, `health` — et son test | **Corrige une régression en cours** (§1.1). Ne dépend d'aucun arbitrage et se livre seule si le reste attend. En premier. |
| **Q-b** | Le modèle : les deux champs, le vocabulaire de `health`, validation, `createToken`, liste blanche du store, tests unitaires | Tout le modèle en une passe — les deux champs touchent les **mêmes** fonctions du schéma et du store. Les séparer, c'est les modifier deux fois. |
| **Q-c** | Les deux anneaux : géométrie, couleurs, épaisseurs, ordre de dessin, filtre du §4 | Consomme Q-b. Porte les critères 3 à 8. |
| **Q-d** | La pastille chiffrée et sa règle de vue | Consomme Q-b. Séparée de Q-c parce qu'elle porte l'arbitrage (1) et son repli du §5.5, qui peuvent bouger seuls. |
| **Q-e** | L'inspecteur MJ : deux champs, trois radios, masquage, grisage | Consomme Q-b, indépendante de Q-c et Q-d. |
| **Q-f** | `maxHp` : bibliothèque, catalogue, formulaire de l'outil de cartes | Autre surface, autre serveur, autres tests. Peut suivre Q-b sans attendre le reste. |
| **Q-g** | Les amendements du §11 | En dernier, quand ce qui est écrit est ce qui tourne. |

---

## 15. Ce qui reste à mesurer

Plus aucun arbitrage n'est ouvert. Restent trois réglages, qui se prennent en écrivant :

1. **L'épaisseur des anneaux et leur écart à la bordure** — assez pour se voir à 33 px la case,
   assez peu pour ne pas manger le portrait.
2. **La couleur de l'anneau des PJ** — ni orange ni rouge (§5.4), hors des quatre couleurs de
   catégorie (`constants.js:192-197`) et hors de l'orange des murs.
3. **L'orange du cran `wounded`** — même contrainte, côté murs.
