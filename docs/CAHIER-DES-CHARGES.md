# Cahier des Charges v2 : VTT Minimaliste & Hybride

> Révision du CdC initial après arbitrage. Les décisions tranchées sont en §2 et ne sont
> plus rediscutées. Schéma de données en §6, protocole en §7, lots et critères en §11.

---

## 1. Principe directeur

Le projet existe parce que **Owlbear Rodeo et Foundry VTT sont trop complexes et pas
intuitifs** en usage réel à table. Ce n'est pas un préambule : c'est le critère
d'arbitrage de toute décision fonctionnelle ultérieure.

**Règle de conception :** toute fonctionnalité ajoutée doit être utilisable sans
apprentissage par un joueur qui découvre la tablette en cours de partie. Si un ajout
demande une explication, il est soit à repenser au geste, soit à réserver à la vue MJ,
soit à retirer.

Corollaire opérationnel : la vue joueurs n'a **aucun menu**. Toute interaction joueur
est un geste direct sur la carte.

**Pourquoi construire plutôt qu'adopter.** L'argument n'est pas la fonctionnalité — Foundry
en a davantage et en aura toujours davantage. C'est que chaque écran d'outillage MJ est
arbitré au fil de l'usage, par la personne qui s'en sert. Un outil dont on a décidé
soi-même chaque contrôle ne peut pas devenir opaque à son utilisateur. C'est la
justification du projet, et c'est aussi pourquoi l'outillage MJ (§5.7) doit être conçu
progressivement et non spécifié d'un bloc à l'avance.

---

## 2. Décisions arbitrées

| Sujet | Décision |
|---|---|
| Écran tiers | La **tablette caste son écran** vers la TV. Duplication, pas vue indépendante. Le Mac ne stream jamais. |
| Vision joueurs | **Union de tous les pions PJ.** Pas de sélection, pas de vue par personnage. |
| Fog de guerre | **Persistant.** Les zones explorées restent mémorisées, par étage. |
| Déplacement joueurs | **Tap pion → tap case de destination**, validée contre les cases atteignables. Aucun drag tactile. |
| Déplacement MJ | **Drag libre** à la souris, sans contrainte d'atteignabilité. Seuil de ~150 ms pour distinguer tap et drag. |
| Conflit de saisie | Sans prise continue, **dernière écriture gagne**. Plus de préemption à gérer. |
| Multi-étage | **Scènes indépendantes reliées par points de liaison.** Pas de superposition alignée. |
| Nœud autoritaire | **Le Mac (poste MJ).** Il calcule vision + fog et publie les résultats. |
| Hébergement | GitHub Pages (app statique) + Firebase RTDB (temps réel) + Firestore (scènes). Images de carte dans le dépôt. |
| Cible de perf | **30 fps stables** sur la tablette, pas 60 fps crête. |
| Modèle de confiance | **Assumé et documenté** (§4bis). Aucun filtrage côté données. |
| Sources de cartes | UVTT **et** image simple avec calibration manuelle de grille. |

### Non-objectifs assumés

- Pas de visibilité inter-étages (ni trémie, ni balcon surplombant).
- Pas de fiches de personnage, jets de dés, chat, ni initiative.
- Pas de moteur de règles autour des points de vie : ni calcul de dégâts, ni journal de
  blessures, ni dérivation automatique d'un état de santé depuis un compteur. Le compteur
  lui-même, en revanche, existe depuis le 06/08/2026 — voir l'encadré sous cette liste.
- Pas de snapshot ni de restauration de positions.
- Un groupe séparé sur deux étages ne peut être observé que d'un étage à la fois.

> **Amendement du 06/08/2026 — les points de vie entrent, et l'interdiction se scinde.**
> Cette liste portait « Pas de points de vie. Si le besoin apparaît, la version 10 % est un
> unique état *blessé / à terre* via `markers`, jamais une barre. » Le mainteneur a tranché
> l'inverse ; ce qui suit est la borne exacte de l'ajout (`CHANTIER-Q-POINTS-DE-VIE.md`).
>
> **Ce qui existe** — trois briques, et pas une de plus :
> - un **compteur `courant/max`** saisi à la main par le MJ. C'est le chiffre qu'il tenait
>   déjà sur son bloc-notes, affiché là où il sert. Les joueurs voient celui d'un PJ,
>   **jamais** celui d'un PNJ ;
> - un **anneau proportionnel sur les PJ seulement**, dont la longueur suit `current/max` et
>   dont la couleur est fixe ;
> - un **anneau d'état sur les PNJ**, tour complet, à trois crans **manuels** — Indemne,
>   Blessé, Mal en point — dont la couleur varie et que rien ne calcule.
>
> Chez le PJ la longueur parle et la couleur se tait ; chez le PNJ l'inverse. C'est ce qui
> empêche de confondre un PJ à plein et un PNJ à l'agonie, qui tracent tous deux un tour
> complet.
>
> **Ce qui est levé.** Pour un PJ, l'anneau proportionnel **est** une barre de points de vie :
> l'interdiction n°4 de `CONVENTIONS.md` tombe donc pour les PJ, et il faut l'écrire ainsi
> plutôt que jouer sur les mots. Ce qui rend la levée sans conséquence : elle ne divulgue rien
> qu'un joueur ne lise déjà sur son propre pion.
>
> **Ce qui reste interdit, sans exception** : toute barre, jauge ou anneau proportionnel **sur
> un PNJ** ; **toute dérivation automatique de l'état annoncé depuis le compteur** — c'est ce
> qui permet de laisser un boss à 12/140 annoncé « Indemne », et c'est toute la raison d'être
> du champ ; toute dérivation d'un marqueur depuis les PV ; tout calcul de dégâts, tout journal
> de blessures.
>
> La « version 10 % » que ce paragraphe autorisait est d'ailleurs livrée telle quelle : l'état
> annoncé des PNJ est bien un **état**, en trois crans plutôt qu'un, et non une jauge.

### Grille : carré et hexagone, par étage

Le format UVTT **n'a aucun champ de topologie de grille** et documente `map_size` « in
squares » : l'hexagone ne peut pas être porté par un `.uvtt`, et les cartes exportées par
Dungeondraft / DungeonFog / Arkenforge sont dessinées sur un pas carré.

**Les deux topologies sont supportées, et le choix est libre carte par carte.**
`grid.type` est une propriété **par étage** (§6) :

- **Défaut déduit à l'import** : un étage venant d'un UVTT naît en `square`.
- **Surchargeable par le MJ à tout moment**, sans restriction technique.

Rien dans le code ne contraint la combinaison : `GridAdapter` (§5.3bis) ignore la
provenance de la carte. Le seul effet d'un hexagone sur une carte dessinée en carré est
visuel — embrasures hors arêtes, angles de murs en biais, carrelage désaligné. Certaines
cartes l'absorbent très bien (grottes organiques, extérieurs sans carrelage visible),
d'autres non (couloirs dallés). **C'est un jugement au cas par cas, laissé au MJ.**

---

## 3. Matériel cible

| Poste | Matériel | Rôle |
|---|---|---|
| MJ | Mac | Contrôle total, **nœud autoritaire** (vision, fog, persistance) |
| Joueurs | **Samsung Galaxy Tab S9 FE 10,9"** — Exynos 1380, Mali-G68 MP5, 1920×1200 (16:10), 90 Hz, 6-8 Go | Vue joueurs, source du cast |
| Affichage | TV via Google Cast (mirroring) | Duplication passive de la tablette |

### Contraintes dérivées du matériel

**GPU milieu de gamme + encodage cast simultané.** La tablette rend *et* encode *et*
transmet. Le cast plafonne de fait autour de 30 fps avec 150-400 ms de latence, quelle
que soit la fluidité locale. D'où la cible 30 fps et le déport des calculs lourds.

**Résolution de rendu plafonnée** — levier de perf principal :

```js
new Application({ resolution: Math.min(devicePixelRatio, 1.5), autoDensity: true })
```

Rend ~1440×900 au lieu de 1920×1200 : ~44 % de fill-rate en moins, invisible après
ré-encodage cast vers 1080p.

**Limite de texture à mesurer avant de fixer la résolution des cartes.** À exécuter sur
la tablette :

```js
const gl = document.createElement('canvas').getContext('webgl2');
console.log(gl.getParameter(gl.MAX_TEXTURE_SIZE));
```

- 8192 → cartes jusqu'à ~200 px/case
- 4096 → plafond à ~140 px/case, ou découpage en tuiles

**Ratio 16:10 sur TV 16:9** → ~10 % de hauteur perdue en bandes noires. La vue joueurs
ne fait aucune hypothèse de mise en page : caméra en unités monde, `resize` observé.

**Alimentation et veille.** Mirroring + WebGL sur 4 h : tablette branchée en
permanence, et Wake Lock obligatoire (sinon l'écran s'éteint et le cast tombe).

**Secure context sur le LAN.** Le Wake Lock et l'installation PWA exigent un contexte
sécurisé. Plutôt qu'un certificat : `chrome://flags` → « Insecure origins treated as
secure » → ajouter l'origine du Mac. Manip unique sur la tablette.

**Zero-UI sur Chrome Android** (ce qui suffit, sans les contournements iOS) :
`overscroll-behavior: none`, `touch-action: none`, `user-select: none`,
`screen.orientation.lock('landscape')`, Fullscreen API ou PWA `display: fullscreen`.

---

## 4. Architecture & hébergement

```
   ┌──────────────┐   deltas    ┌─────────────────┐   deltas    ┌──────────────┐
   │  MAC  (MJ)   │◄───────────►│  Firebase RTDB  │◄───────────►│  TAB S9 FE   │
   │  autoritaire │             │  (canal live)   │             │ vue joueurs  │
   └──────┬───────┘             └─────────────────┘             └──────┬───────┘
          │                                                            │
          │ publie vision + fog                              Google Cast (mirroring)
          │                                                            ▼
          │  ┌──────────────────┐    ┌───────────────┐            ┌─────────┐
          └─►│ Firestore        │    │ GitHub Pages  │◄───────────│   TV    │
             │ scènes, liaisons │    │ app + images  │  assets    └─────────┘
             └──────────────────┘    └───────────────┘
```

### Répartition des responsabilités

| Composant | Responsabilité | Coût |
|---|---|---|
| GitHub Pages | App statique + **images de carte traitées** (commit) | Gratuit |
| Firebase RTDB | Canal temps réel : positions, portes, caméra, pings | Gratuit |
| Firestore | Documents de scène durables, liaisons, masques de fog | Gratuit |
| Mac (client MJ) | Import UVTT, sweep de visibilité, rasterisation du fog, persistance | — |
| Tablette | Rendu + gestes + rendu optimiste local pendant ses propres drags | — |

### Trois règles d'hébergement à ne pas enfreindre

**1. Pas de Firebase Storage.** Depuis le 3 février 2026, un projet doit être lié au
plan Blaze (carte bancaire requise) pour créer ou conserver un bucket, indépendamment du
volume. Les images de carte sont des assets statiques préparés à l'avance → **commit
dans le dépôt Pages**, servi par le CDN GitHub. À 140 px/case une carte fait 2-6 Mo,
très en-dessous des limites (100 Mo/fichier, ~1 Go/dépôt).

**2. RTDB pour le live — préférable, plus indispensable.** Le modèle de déplacement
discret (§5.3) supprime toute écriture haute fréquence : une séance fait quelques
centaines de commits, pas des dizaines de milliers. Le quota Firestore (20 000
écritures/jour) n'est donc plus un risque. RTDB reste le bon choix pour la latence, le
fanout et la présence, mais c'est désormais un choix libre et non une contrainte.

> Corollaire à respecter : pendant un drag MJ, **ne rien publier** avant le `pointerup`.
> Seule la position stabilisée part sur le réseau. C'est ce qui garantit qu'aucun chemin
> de code n'écrit à haute fréquence.

**3. Jamais d'image sur la socket.** Ni base64, ni tuile. Uniquement des URLs.

## 4bis. Modèle de confiance — assumé

**Décision : assumé, sans filtrage.** Le client joueur reçoit l'intégralité du document de
scène et s'abstient d'afficher ce qui est masqué (PNJ `hidden`, liaisons `gmOnly`, zones
non explorées). Un joueur qui ouvre les devtools de Chrome peut donc tout voir.

C'est acceptable ici, et pour des raisons précises :

- La tablette est un **appareil partagé posé sur la table**, sous le regard du MJ.
- Le public est une table entre amis, pas un environnement adversarial.
- L'alternative — séparer les documents Firestore et écrire des règles de lecture par
  rôle — impose une structure de données en double et une complexité de synchronisation
  disproportionnée par rapport au risque réel.

**Conséquences à respecter malgré tout :**

- Ne jamais placer dans le document de scène quoi que ce soit qui ne doive *jamais* fuiter
  (notes de campagne, révélations d'intrigue). Les notes MJ, si elles arrivent un jour,
  vont dans un document séparé que le rôle joueurs ne lit pas.
- Le masque de fog diffusé aux joueurs est le masque **exploré**, pas la carte complète —
  il n'y a donc rien à révéler de ce côté.
- Cette décision est à revoir si l'outil sort du cadre d'une table physique unique (jeu à
  distance, joueurs sur leurs propres appareils).

### Abstraction de transport (obligatoire dès le lot 1)

Toute la synchro passe derrière une interface unique :

```js
interface Transport {
  connect(sessionId, role)          // role: 'gm' | 'players'
  publish(event)                    // {type, payload}
  subscribe(handler)                // handler(event)
  snapshot()                        // état complet, pour (re)connexion
  disconnect()
}
```

Deux implémentations : `FirebaseTransport` (défaut) et `LocalSocketTransport` (shim
Node + Socket.io sur le Mac, ~80 lignes). L'hébergement devient un choix d'exécution.
Bascule en mode LAN à latence nulle et sans internet si le Wi-Fi de la table déçoit —
sans refactor.

### URL joueur autonome (option de repli du cast)

La vue joueurs est une URL indépendante :
`…/player?session=<id>&camera=follow`

- Sans `camera=follow` : caméra locale libre.
- Avec : la caméra suit celle publiée par la tablette.

Coût ~30 lignes. Si le mirroring déçoit (latence, netteté du texte, coupures), on ouvre
cette URL sur n'importe quel navigateur côté TV et on récupère un rendu natif 60 fps.
Option conservée gratuitement, non utilisée par défaut.

---

## 5. Spécifications fonctionnelles

### 5.1 Import & cartes — deux sources

Import réalisé **sur le Mac uniquement** (voir pipeline §8). Produit : une image
rééchantillonnée + un document de scène. La tablette ne parse jamais de fichier source.

**Source A — UVTT / DD2VTT / DF2VTT** (donjons)

- Extraction image de fond, grille (`pixels_per_grid`, `map_origin`), murs
  (`line_of_sight`, `objects_line_of_sight`), portails, lumières, ambiance.
- Grille déduite automatiquement, type `square` par défaut.

**Source B — Image simple + calibration manuelle** (JPG/PNG/WebP)

Indispensable : une large part des cartes existantes ne sont pas des UVTT (Patreon,
scans, cartes de livres). Techniquement **plus simple** que l'UVTT — aucune géométrie à
parser.

- Assistant de calibration : le MJ étire un rectangle sur N×M cases visibles de la carte,
  l'outil en déduit `pxPerCell` et l'offset. Réglage fin au clavier.
- Choix du type de grille à la calibration (carré ou hexagone, §2).
- Pas de murs ni de lumières → l'étage démarre **sans lignes de vue**, avec un fog
  entièrement peint à la main par le MJ (§5.4). C'est un palier pleinement jouable.
- Les murs peuvent être ajoutés ensuite à la main via l'éditeur du §5.7.

**Commun aux deux sources :** grille ajustable (opacité, couleur, affichage on/off).
Le snap n'est plus une option — le modèle de déplacement discret (§5.3bis) rend les
positions toujours exactement sur case.

### 5.2 Étages & liaisons

Chaque étage est une **scène autonome** : sa propre image, sa propre grille, ses propres
murs / portails / lumières, son propre masque de fog. Aucun alignement géométrique.

Une liaison est une paire de coordonnées (escalier, ascenseur, échelle, trappe,
passage). Traversée : **la case de liaison est une destination atteignable comme une
autre** — un tap dessus déplace le pion, puis bascule son `levelId` et sa position sur
l'autre extrémité. Exactement le comportement d'un jeu de plateau, et l'ambiguïté de la
téléportation accidentelle disparaît avec le drag.

**Sélecteur d'étage** (vue joueurs et vue MJ) :
- Un badge par étage = nombre de pions PJ présents.
- Bascule automatique quand la majorité du groupe change d'étage, avec un cadenas pour
  figer la vue.
- MJ uniquement : glisser un pion **sur** le sélecteur le déplace vers cet étage.
- Les marqueurs de liaison sont discrets côté joueurs (l'escalier est déjà dessiné sur
  la carte), et explicites côté MJ. Une liaison peut être `gmOnly`.

### 5.3 Pions

**Générateur intégré** (vue MJ) : import PNG/JPG/WebP par drag & drop ou sélecteur,
recadrage circulaire ou carré avec zoom et déplacement de l'image dans le cadre, choix
PJ / PNJ, couleur de bordure.

**Droits :** les pions PJ sont manipulables sur la tablette ; les PNJ uniquement par le
MJ. Les PNJ ont un état Visible / Masqué (préparation d'embuscades).

**Attributs obligatoires dès le lot 1** — les rajouter ensuite est un refactor :
- `levelId` — appartenance à un étage
- `sizeCells` — 1, 2, 3… (indispensable dès le premier ogre)
- `visionBright` / `visionDim` — rayon de vision par pion (vision dans le noir)
- `emitsLight` — le pion « Torche » du CdC initial en dépend
- `speedCells` — allocation de déplacement, pour les cases atteignables
- `playerMovable`, `locked` — droits de manipulation par pion
- `elevation` — altitude numérique (vol, escalade, fosse). Simple badge affiché sur le
  pion, sans aucune incidence sur la géométrie ni sur la vision.
- `hp` / `health` — points de vie (Chantier Q, 06/08/2026). `hp` porte `{ current, max }` ou `null`. `health` porte l'état annoncé d'un PNJ (`unharmed`, `wounded`, `critical`).
- `markers` — tableau d'identifiants d'états. **Le jeu de marqueurs est clos depuis le
  04/08/2026** : quatorze valeurs, dont `poisoned`, `prone` et `unconscious`, énumérées par
  `assets/icons/status/SOURCES.md`, qui fait autorité. Le nom de fichier de l'icône **est**
  l'identifiant, et le schéma refuse tout le reste. Voir §12 Q7 et
  `TRANCHE-L09-MARQUEURS.md`.
  > La rédaction initiale citait « concentré » en exemple. **Il n'est pas des quatorze** :
  > l'arbitrage de la liste, promis « après une séance réelle », a été rendu sur les états que
  > le mainteneur voit effectivement à sa table, et la concentration n'en fait pas partie. Un
  > quinzième état rouvrirait Q7, ce n'est donc pas une omission à réparer au fil de l'eau.
  >
  > Un marqueur reste **un affichage et rien d'autre** : aucun n'altère la vision, le
  > déplacement ou un gabarit. Le jeu reste dans la tête du MJ.

### 5.3bis Modèle de déplacement — style jeu de plateau

Décision structurante, reprise de l'implémentation `shadowrunbank` (`reachableCells` /
`moveTokenToCell`) où elle a déjà remplacé le drag tactile avec succès.

**Vue joueurs (tactile) — aucun drag.**
1. Tap sur un pion PJ → sélection (anneau visible) + affichage des **cases atteignables**.
2. Tap sur une case atteignable → déplacement validé et commité.
3. Tap sur le vide → désélection.
4. Le drag à un doigt reste donc **entièrement dédié au pan de la carte**.

**Vue MJ (souris) — drag conservé**, sans contrainte d'atteignabilité, avec seuil de
~150 ms pour distinguer tap et drag. Le MJ garde ainsi le placement libre hors grille
quand il en a besoin.

**Cases atteignables :** Dijkstra pondéré respectant le masque d'arêtes bloquées. Portée =
`token.speedCells`, **valeur propre à chaque personnage**, éditable dans le créateur de
pions. Restriction toujours active côté joueurs, jamais côté MJ.

- **Grille carrée** : coût octile (orthogonal 1, diagonale ≈ 1,5), corner-cutting interdit.
- **Grille hexagonale** : coût uniforme 1, 6 voisins. Ni diagonale, ni octile, ni
  anti-corner-cutting — l'implémentation est **plus simple** qu'en carré.

Le Dijkstra étant déjà pondéré, un **terrain difficile** (`terrainCost` par case, §6) est
un ajout quasi gratuit. Hors périmètre pour l'instant, mais la porte reste ouverte.

**Abstraction de grille (obligatoire dès le lot 1)**, même logique que `Transport` :

```js
interface GridAdapter {
  cellFromPoint(px, py)        pointFromCell(cell)
  neighbors(cell)              distance(a, b)
  edgesOf(cell)                cellsOccupied(cell, sizeCells)
  cellsInRange(cell, budget, blockedEdges)
  renderGrid(ctx, viewport)
}
```

`SquareGrid` au lot 1, `HexGrid` au lot 4 comme implémentation ajoutée — pas un refactor,
**à condition de tenir les quatre règles ci-dessous**.

#### Ce qui est indifférent à la topologie de grille

Tout ce qui est coûteux dans le projet, en fait — c'est ce qui rend le support des deux
topologies bon marché :

| Composant | Dépend de la grille ? |
|---|---|
| Sweep de visibilité | **Non** — opère sur des segments, produit un polygone |
| Masque de fog | **Non** — raster en espace pixel |
| Murs, portails, lumières | **Non** — géométrie vectorielle UVTT |
| Protocole réseau, persistance | **Non** — si les coordonnées sont opaques (règle 1) |
| Multi-étage, liaisons | **Non** |

#### Les quatre règles de discipline (lot 1)

1. Une coordonnée de case est un **couple opaque** `{a, b}`, jamais `{col, row}`. Le
   protocole (§7) et la persistance (§10) n'ont alors jamais à changer.
2. Rien ne suppose 4 ni 8 voisins — toujours passer par `neighbors()`.
3. `distance()` n'est jamais Chebyshev ni octile en dur.
4. **Aucun module hors de l'adaptateur ne fait d'arithmétique `pxPerCell`.**

> La règle 4 est la plus facile à enfreindre et la plus coûteuse. Elle est vérifiable
> mécaniquement : un grep de `pxPerCell` hors du fichier de l'adaptateur doit revenir
> vide. **À transformer en test.**

#### Les trois seuls points de fuite réels

1. **`sizeCells > 1`** — seule vraie décision de conception. Bloc n×n évident en carré ;
   pas de forme canonique en hexagone. D'où `cellsOccupied()` dans l'interface. Convention
   à trancher (§12, question 6).
2. **Masque d'arêtes bloquées** — calcul identique, nombre d'arêtes différent. Et c'est
   le **carré** le plus pénible : la diagonale exige que les deux arêtes orthogonales
   adjacentes soient libres. L'hexagone n'a pas ce cas.
3. **Outil d'alignement** — l'hexagone ajoute `hexOrientation` (pointe en haut / à plat)
   en plus de l'offset.

**Pont UVTT → grille (à faire à l'import).** `reachableCells` raisonne en arêtes de
grille bloquées ; l'UVTT fournit des segments arbitraires. Pour chaque paire de cases
adjacentes, tester si le segment joignant leurs centres croise un mur ou un portail
fermé → **masque d'arêtes bloquées précalculé et mis en cache**. Invalidation limitée aux
arêtes voisines d'une porte lors d'un `portal.toggle`. Le même masque sert au pathfinding
et au blocage de passage.

**Révélation du fog le long du chemin.** Recalculer le sweep sur **chaque case du chemin
validé** et cumuler dans le masque — sinon un pion qui traverse un couloir laisse ce
couloir inexploré. Le chemin est déjà fourni par la chaîne de prédécesseurs du Dijkstra.
Quelques millisecondes, une fois au commit.

**Conséquences architecturales** (elles allègent les §4, §7 et §9) :

| Ce que le modèle discret supprime | Pourquoi |
|---|---|
| Throttling, coalescence rAF, canal haute fréquence | Un déplacement = **un** événement |
| Rendu optimiste + réconciliation | Plus de retour continu à prédire |
| Verrou de saisie, préemption, snap-back | Pas de prise continue → pas de contention |
| Vision calculée obligatoirement sur le Mac | Un sweep par déplacement (2-5 ms) tient sur la tablette |
| Sensibilité à la latence du cast | Tap + tween court : le retard TV est imperceptible |
| Hystérésis de snap, coordonnées flottantes | Positions **toujours entières** |

**Ce que le modèle coûte :** placement libre hors grille (réservé au MJ via drag), et le
déplacement simultané de plusieurs pions au multi-touch — abandonné, jamais réaliste.

### 5.4 Vision, fog, portes, lumière

**Vision dynamique.** Union des champs de vision de tous les pions PJ de l'étage
affiché, obstruée par les murs et les portes fermées.

**Plafond de vision : 20 cases**, quelle que soit la lumière. Arrêté le 31/07/2026, et il
faut savoir ce qu'il est : **une borne technique, pas une règle de jeu.** Le sweep teste
tous les segments *à portée* sans savoir d'avance lesquels seront masqués — mesuré, 1338
segments traités pour 284 réellement visibles. Sans borne, un pion en zone éclairée
(`ambient.level = 1`) coûterait 347 ms pour six pions au lieu de 2 ms. Le jour où les rayons
seront accélérés (`ETAT.md`, « piste d'accélération »), ce plafond redeviendra un pur choix
de jeu. 20 cases couvrent très largement l'usage, et se paient encore sans effort.

**Fog persistant.** Masque raster mono-canal par étage, à **8 px par case** — une carte
de 40×30 cases fait 320×240 px, soit ~76 Ko brut et ~5 Ko en PNG. Le Mac y applique un
OR à chaque recalcul et le persiste. À 5 Ko, diffusion du masque entier plutôt que
gestion de rectangles sales.

**Trois états de rendu joueurs** — la distinction est critique :

| État | Décor | Pions |
|---|---|---|
| Non exploré | noir opaque | masqués |
| Exploré, hors vision | grisé / désaturé | **masqués** |
| Visible | pleine couleur | affichés |

> Piège classique : afficher les pions en zone explorée-hors-vision permet aux joueurs
> de suivre les PNJ à travers les murs. Les pions ne s'affichent **que** en vision courante.

**Outils fog MJ :** tout révéler, tout masquer, pinceau révéler, pinceau masquer, par
étage, avec undo.

**Portes.** Les portails UVTT deviennent des objets interactifs Ouvert / Fermé (bloque
vision et passage). Hitbox élargie à au moins une demi-case autour du segment : un
segment de 2 points est une cible minuscule au doigt. Règle explicite de désambiguïsation
entre « tap sur porte » et « tap sur le vide ».

**Lumière.** Curseur de luminosité ambiante globale, sources fixes importées de l'UVTT,
sources portées par les pions (`emitsLight`).

### 5.5 Outils de table (pas du confort)

- **Mesure de distance** — ~~au geste : appui long + glisser~~ **par bouton armé, amendé le
  12/08/2026.** Priorité abaissée : les cases atteignables (§5.3bis) répondent déjà à « est-ce que
  j'y arrive ? ». Reste utile pour les portées de tir, d'un point arbitraire à un autre.

  *Pourquoi l'écart au geste initialement prévu.* L'appui long et le glisser se disputent déjà le
  doigt dans `js/input/pointer.js`, et la mesure de séance du 11/08/2026 a chiffré la marge : le p95
  d'un tap réel est à **139,2 ms** contre `DRAG_HOLD_MS = 150`, soit **10,8 ms**. Ajouter un
  troisième geste dans cette zone pour un critère de priorité abaissée serait mal employer le seul
  endroit du code où une erreur se paie à chaque geste de la séance.

  Le chantier X a ouvert la voie sûre : un **bouton armé dans la barre de séance MJ**, hors des
  onglets, sur le modèle du ping. Armer, cliquer deux points, lire la distance, se désarmer. Il
  hérite de l'exclusivité mutuelle des outils et du désarmement au changement d'onglet, déjà
  éprouvés. ⭐ **Le Zero-UI n'est pas violé** : la contrainte porte sur la vue joueurs et sur la
  carte, pas sur le panneau MJ — qui est un poste clavier-souris et porte déjà dix onglets.

  ⛔ La distance vient de **`grid.distance(a, b)`**, jamais d'un calcul en dur (interdiction n°7).
  C'est ce qui la fera fonctionner en hexagone sans une ligne de plus.
- **Ping** — ~~deux doigts tap~~, marqueur animé ~2 s, **visible sur les trois postes**.
  **Amendé le 12/08/2026 : émission MJ seule, par bouton armé.**

  *Ce qui a changé et pourquoi.* Le geste tactile est **supprimé** : côté joueurs il n'y a pas de
  besoin, parce qu'il leur suffit de **zoomer sur la tablette** pour que le MJ voie de quoi ils
  parlent. Le ping ne sert donc que dans le sens MJ → table, et le poste MJ est toujours
  clavier-souris. ⭐ L'affichage, lui, reste sur **les trois postes** : c'est tout l'objet du geste,
  et le critère du lot 4 est inchangé.

  *Bouton armé plutôt que double-clic, et pas seulement par facilité.* Sur la vue MJ un clic a déjà
  des effets — sélectionner un pion, désigner une destination. Un double-clic les déclencherait au
  premier clic, ou imposerait de **retarder chaque clic simple** de la fenêtre de double-clic pour
  lever l'ambiguïté : ~250 ms ajoutés à toute l'interface MJ pour un geste occasionnel. Le bouton
  armé n'a aucun de ces défauts et **réutilise l'exclusivité mutuelle des outils MJ** ainsi que le
  désarmement au changement d'onglet, déjà éprouvés (`gmToolDisarmGeste`). Il est **toujours
  visible, hors des onglets** : c'est un geste de séance, pas un outil de préparation.

  ⛔ *Le piège de conception, tranché ici parce qu'il est contre-intuitif.* Le marqueur s'anime
  depuis **l'instant de réception local**, et **non** depuis l'horodatage de l'émetteur — donc
  **pas** comme l'animation des pions. Motif : `Date.now()` de l'émetteur est une horloge
  étrangère, et la tablette de ce projet a été mesurée **5,3 s en avance**. Un ping de 2 s calculé
  sur cet écart serait déjà expiré à l'arrivée : il **n'apparaîtrait jamais** sur le poste qui
  compte le plus. Un pion a besoin de déterminisme entre postes — un joueur qui rejoint doit le
  voir au bon endroit ; un ping n'a **aucun état persistant**, donc chacun peut l'afficher 2 s à
  partir de sa propre réception sans que la différence soit observable.
- **Undo MJ** — une révélation de fog ou une suppression de pion accidentelles sont
  irréversibles sinon. Rendu quasi gratuit par les commandes discrètes (§5.3bis).

> **Écarté explicitement :** snapshot nommé et restauration de positions. Jugé sans usage
> réel à table.

**Version visible & détection de désynchronisation.** Trois surfaces à vérifier et aucune
étape de build pour invalider les caches : sans indicateur, on perd du temps de test à se
demander si le code exécuté est le bon. Chaque client publie son numéro de build dans sa
présence ; la vue MJ signale tout écart par une bannière nommant les deux builds. Spécifié
en détail dans `STACK.md` §5bis — c'est le seul élément d'interface toléré en vue joueurs,
sous forme d'overlay transitoire non interactif.

### 5.6 Vue MJ

Panneau latéral : import (§5.1), sélecteur d'étages, créateur de pions, outils fog,
lumière ambiante, bibliothèques (§5.7). Visualisation en semi-transparence de tout ce qui
est masqué aux joueurs (PNJ cachés, zones non explorées, liaisons `gmOnly`).

### 5.7 Outillage MJ & bibliothèques

> Section délibérément **conçue progressivement** (cf. §1) : les écrans se raffinent à
> l'usage. Ce qui suit fixe le périmètre et les structures de données, pas l'ergonomie
> définitive.

**Bibliothèque de scènes.** Liste des étages/cartes de la campagne avec vignettes,
recherche par nom, et action « charger sur la table ». Sans elle, gérer vingt cartes sur
une campagne est ingérable — c'est précisément le point où les VTT existants deviennent
pesants.

**Bibliothèque de pions.** Persistance de ce que produit le générateur (§5.3) : les PNJ
récurrents sont recadrés une fois, pas à chaque séance. Métadonnées conservées :
`sizeCells`, `speedCells`, vision, couleur de bordure. Instancier depuis la bibliothèque
crée un pion pré-réglé.

**Éditeur minimal de murs.** Ajouter, déplacer, supprimer un segment de mur ou un portail
sur un étage. Deux usages :
- Réparer un export UVTT incomplet — les exports Dungeondraft manquent régulièrement des
  cloisons, ce qui rend un import inutilisable sans cet outil.
- Doter un étage importé en **image simple** (§5.1, source B) de lignes de vue.

Toute modification invalide les arêtes de grille concernées dans le masque bloqué
(§5.3bis).

*Note (Tranche L-07)* : Déplacer un mur est reporté (exigerait un mode de glisser dans `js/input/`). L'édition de portails attend deux noms d'événements — `portal.add` et `portal.remove` — qui n'existent pas au §7 et ne s'inventent pas sans décision du mainteneur.

### 5.8 Révélation d'image aux joueurs

Le MJ choisit une image (portrait, lettre, rune, plan trouvé) ; elle s'affiche **en plein
écran sur la vue joueurs** jusqu'à fermeture par le MJ. Ne touche ni la carte, ni les
pions, ni le fog.

Meilleur rapport valeur/effort du cahier des charges : quelques dizaines de lignes, un
seul événement réseau, et un usage constant sur une table hybride équipée d'un grand
écran.

### 5.9 Gabarits de zone d'effet

Cercle, cône, ligne, placés par le MJ (ou par un joueur si autorisé) et **surlignant les
cases affectées**.

S'appuie entièrement sur des briques déjà spécifiées : énumération de cases via
`GridAdapter`, et occlusion par les segments de murs et portes fermées.

> **Amendement L-08 (04/08/2026)** : L'occlusion se calcule au sweep (`vision/sweep.js`), et non par le masque d'arêtes bloquées §5.3bis (mesuré : 3 cases d'écart en moyenne, 11 dans le pire cas sur `manoir-rdc`). Le cône et la ligne sont reportés car ils demandent un geste d'orientation. Les cases affectées calculées par le MJ transitent avec `template.place` et ne sont pas recalculées par la tablette.
>
> **Amendement L-10 (05/08/2026)** : La forme réelle déplaçable et pivotable (cercle et cône à 60°) remplace le surlignage des cases. Plus d'énumération de cases. Découpe stricte par les murs au `ctx.clip()` sur le polygone de sweep. `origin` passe en `MapPoint` carte et la pointe du cône est l'ancre fixe des rotations. Les joueurs peuvent manipuler les gabarits libres marqués `visibleToPlayers`.

Règle le principal arbitrage verbal pénible à table — « est-ce que le gobelin est dans la
boule de feu ? » — en le rendant visible de tous sur l'écran partagé.

---

## 6. Modèle de données

### Document de campagne (Firestore, ou fichier JSON en mode local)

```js
{
  schemaVersion: 2,
  campaignId: 'string',
  name: 'string',

  levels: [{
    id: 'rdc',
    name: 'Rez-de-chaussée',
    order: 0,
    imageUrl: 'maps/manoir-rdc.webp',   // relatif au dépôt Pages
    videoUrl: null,                     // optionnel : fond animé (WebM/VP9 ou MP4/H.264)
    animatedOverlays: [],               // [{ url, at: CellPoint, widthCells, heightCells, fps }]
                                        // préféré à videoUrl (§9)
    pxPerCell: 140,                     // après rééchantillonnage
    widthCells: 40, heightCells: 30,
    grid:    { type: 'square'|'hex',    // défaut 'square' à l'import UVTT, surchargeable
               hexOrientation: 'flat'|'pointy',
               offsetX: 0, offsetY: 0,
               color: '#000000', opacity: 0.25, visible: true },
    terrainCost: null,                  // optionnel : Record<cellKey, coût> (défaut 1)
    walls:   [ [CellPoint, CellPoint, …], … ],   // polylignes
    portals: [{ id, a: CellPoint, b: CellPoint, state: 'closed', freestanding: false }],
                                        // state: 'open'|'closed'|'locked' (§7, amendement 03/08)
    lights:  [{ id, at: CellPoint, range, intensity, color, shadows: true }],
    ambient: { color: '#ffffff', level: 1.0, baked: false }
  }],

  links: [{
    id, kind: 'stairs'|'elevator'|'ladder'|'hatch'|'passage',
    label: 'Escalier nord',
    a: { levelId: 'rdc', at: { cellX: 12, cellY: 7 } },
    b: { levelId: 'et1', at: { cellX: 3,  cellY: 19 } },
    bidirectional: true, gmOnly: false
  }],

  tokens: [{
    id, levelId, x, y,                  // ENTIERS : index de case (modèle discret §5.3bis)
    sizeCells: 1,
    kind: 'pc'|'npc',
    imageUrl, borderColor, label,
    hidden: false,                      // PNJ masqué aux joueurs
    visionBright: 6, visionDim: 12,     // en cases, 0 = aucune vision
    emitsLight: null,                   // ou { range, intensity, color }
    speedCells: 6,                      // portée des cases atteignables
    playerMovable: true, locked: false,
    elevation: 0,                       // badge affiché, sans effet géométrique
    markers: [],                        // ['poisoned', 'prone', …] — jeu clos à 14 marqueurs
    hp: null,                           // ou { current: 14, max: 28 } (Chantier Q)
    health: 'unharmed'                  // 'unharmed'|'wounded'|'critical' (PNJ uniquement)
  }],

  templates: [{                         // gabarits de zone d'effet (§5.9)
    id, levelId, shape: 'circle'|'cone'|'line',
    origin: {a, b}, radiusCells, directionDeg, widthCells,
    color, visibleToPlayers: true
  }],

  settings: { ambientLevel: 1.0 }
}
```

> **Amendement du 03/08/2026 — une porte a trois états, et un seul champ pour les porter.**
> `closed: boolean` devient `state: 'open'|'closed'|'locked'`. Une porte **fermée** s'ouvre par
> les joueurs ; une porte **verrouillée** doit être déverrouillée par le MJ avant qu'ils
> puissent l'ouvrir (§7, règle d'autorisation par transition).
>
> **Un champ unique plutôt qu'un `locked` à côté de `closed`** : la seconde forme rend
> représentable `{closed: false, locked: true}`, qui ne veut rien dire. Un état unique rend
> l'état illégal **impossible à écrire**, ce qui vaut mieux qu'un contrôle qui l'attrape.
>
> **Les 182 portails déjà commités** — 40 dans `manoir-rdc`, 141 dans `testbig150`, 1 dans
> `minimal`, tous au format booléen — sont **normalisés à la lecture, jamais refusés** :
> `closed: true → 'closed'`, `closed: false → 'open'` (83 portails dans ce second cas). C'est le
> traitement retenu au chantier G pour les couleurs ARGB, et pour la même raison : refuser
> reproduirait la « disparition après F5 » qu'`ETAT.md` documente comme cause historique d'une
> perte de campagne. `closed` reste toléré en lecture, n'est plus jamais écrit, et n'est plus lu
> après normalisation.
>
> Pour le calcul des arêtes bloquées comme pour le sweep, `closed` et `locked` sont
> **indiscernables** : les deux bloquent passage et vision. Seules l'interface et l'autorisation
> les distinguent. Détail dans `docs/TRANCHE-L05-PORTES.md` §4.

### Bibliothèques (documents séparés, §5.7)

```js
// tokenLibrary
[{ id, name, imageUrl, kind, sizeCells, speedCells,
   visionBright, visionDim, emitsLight, borderColor,
   maxHp }]        // number|null — PV maximum du gabarit (Chantier Q, 06/08/2026).
                   // Absent toléré et normalisé à `null` : ce fichier s'édite à la main.
                   // Un scalaire, pas un objet : un gabarit n'a pas de « courant ».
                   // La projection pose le pion à plein — `{ current: maxHp, max: maxHp }`.

// sceneLibrary — index de navigation, dérivé des levels
[{ levelId, name, thumbUrl, gridType, source: 'uvtt'|'image', updatedAt }]

// handouts (§5.8)
[{ id, name, imageUrl }]
```

**Convention d'unités — source du bug n°1.** Toutes les coordonnées du modèle
(`walls`, `portals`, `lights`, `tokens`, `links`) sont en **unités de case**, jamais en
pixels. La conversion en pixels se fait au dernier moment, au rendu, via `pxPerCell`.
C'est aussi la convention de l'UVTT, ce qui évite une double conversion.

Deux formes distinctes, **non interchangeables par construction** (cf. `CONVENTIONS.md` §1) :

- `Cell` = `{a, b}` — index de case **entier**. Position d'un pion, origine d'un gabarit.
- `CellPoint` = `{cellX, cellY}` — unité de case **fractionnaire**. Géométrie importée :
  murs, portails, lumières, extrémités de liaison. Un portail se pose en
  `{cellX: 4.5, cellY: 2}`, ce n'est pas un index de case.

Les noms de propriétés diffèrent délibérément de ceux de `MapPoint` (`{x, y}`, pixels) :
le typage étant structurel, c'est la seule façon de rendre le mélange **impossible à
compiler** plutôt que simplement déconseillé.

### Canal temps réel (RTDB)

```
/session/{sid}/events             → flux d'événements en append (§7), tous domaines confondus
/session/{sid}/presence/{cid}     → { role, at, build, label }
/session/{sid}/retentionClients/{cid} → { state: joining|active, eventCursor?, at } barrière et accusé de réception éphémères
```

Plus, hors RTDB, un unique document Firestore `campaigns/{sid}` portant **toute** la campagne,
réécrit par `saveSnapshot` à chaque mutation.

> **Amendement du 03/08/2026 — ce tableau décrivait une disposition qui n'a jamais été
> construite.** Il listait sept chemins par domaine — `/tokens`, `/portals`, `/view`,
> `/vision`, `/fog`, `/pings`, `/presence`. Vérifié dans `js/transport/FirebaseTransport.js` :
> **trois existent**, `session/{sid}/events`, `session/{sid}/presence/{cid}` et le curseur
> éphémère `session/{sid}/retentionClients/{cid}` ; le premier porte tout le trafic de jeu.
>
> **Ce n'est pas une dérive, c'est une simplification qui a bien tourné.** Un flux d'événements
> unique donne l'ordre total et le rejeu gratuitement, là où sept branches par domaine
> auraient demandé de réconcilier sept horloges. Le modèle discret du §5.3bis, qui supprime
> toute écriture haute fréquence, a retiré la seule raison qu'il y avait de séparer `/tokens`
> et `/view` du reste.
>
> **Conséquence à ne pas manquer : l'état de jeu ne vit pas dans un espace de session.** Il
> vit dans la campagne, et les événements en portent les transitions — c'est vrai de la
> position d'un pion depuis le lot 1a, et c'est ce qui rend la persistance d'une porte ouverte
> gratuite (`TRANCHE-L05-PORTES.md` §5.1). Un futur besoin d'état de session partagé se
> décide, il ne se déduit pas de ce tableau.

> **Amendement du 01/08/2026 — `/vision` porte un masque, plus un polygone.** Ce qui suit
> décrit la **représentation** de la charge, qui reste exacte ; l'amendement du 03/08 ci-dessus
> corrige seulement l'endroit — les deux masques voyagent dans les événements `vision.update`
> et `fog.update` du flux `/events`, non sur des chemins dédiés. Mesuré avant
> d'écrire la tranche L-04 : l'union des champs de vision de six PJ pèse **38 à 180 Kio** de
> JSON en polygones sur la géométrie publiée, contre **11,7 Kio** pour le même contenu en
> masque raster. Le polygone était intenable sur le fil, et il aurait de surcroît obligé les
> tablettes à rasteriser — donc à calculer, ce que le §4 leur interdit. `/vision` et `/fog`
> portent désormais la **même** représentation : un PNG mono-canal à 8 px par case, en base64
> brut. Ils gardent des cycles de vie distincts — `/fog` est cumulatif et persisté, `/vision`
> est éphémère et se recalcule au redémarrage.
>
> **La charge est stockée en base64 brut, sans préfixe `data:`.** Avec le préfixe, elle
> tomberait sous `assertNoTransientAssetUrls`, qui refuse toute chaîne `data:` au-delà de
> `TOKEN_IMAGE_MAX_BYTES` (24 Kio) sur **chaque** événement. Sans lui, plus rien ne la borne :
> `vision/fog.js` porte donc son propre plafond, `FOG_MAX_ENCODED_BYTES`. Voir
> `TRANCHE-L04-FOG-PERSISTANT.md` §6.

---

## 7. Protocole de synchronisation

### Événements

| Type | Émetteur | Fréquence |
|---|---|---|
| `token.move` | MJ, joueurs | **ponctuel** — `{id, from, to, path, startedAt}` |
| `token.levelChange` | MJ, joueurs (liaison) | ponctuel |
| `token.create` / `update` / `delete` | MJ | ponctuel |
| `portal.toggle` | MJ, joueurs si autorisé | ponctuel — `{levelId, portalId, state}`, état **absolu** |
| `view.change` | tablette | throttlé 10 Hz |
| `level.select` | MJ, tablette | ponctuel |
| `vision.update` | **Mac seul** | après chaque mouvement, throttlé |
| `fog.update` | **Mac seul** | throttlé 1 Hz ou à la révélation |
| `fog.reset` / `fog.paint` | MJ | non émis (réservés — `fog.update` porte le PNG complet, L-06) |
| `ping` | **MJ seul** (amendé le 12/08/2026, §5.5) | ponctuel — `{levelId, mapPos}` ; **pas d'horodatage d'émetteur exploité au rendu**, chaque poste anime depuis sa réception |
| `ambient.set` | MJ | throttlé |
| `handout.show` / `handout.hide` | MJ | ponctuel |
| `template.place` / `remove` / `clear` | MJ | ponctuel |
| `token.markers` / `token.elevation` | MJ | ponctuel |
| `wall.add` / `wall.remove` | MJ | ponctuel — invalide le masque d'arêtes |
| `scene.load` | MJ | ponctuel — déclenche un snapshot complet |

> **Amendement L-08 (04/08/2026)** : `template.place` porte `{ template: Template, cells: string[] }` (idempotent, un `id` existant remplace). `template.move` n'est pas émis (`template.place` au même `id` déplace). `template.clear` porte `{ levelId: string }` et efface les gabarits de l'étage.

> **Amendement UX-05 (17/08/2026)** : `template.remove` porte `{ templateId: string }` et retire **un** gabarit. Il est demandé par le mainteneur et n'est donc pas une invention de la couche réseau (`CONVENTIONS.md` §4). Son absence rendait `template.clear` seul retrait possible : retirer le cône d'un sort résolu effaçait aussi la zone de ténèbres posée deux tours plus tôt. Rejeu inoffensif — un gabarit déjà retiré rend `false` sans lever. `template.move` **est** émis depuis L-10 malgré l'amendement ci-dessus, par le glisser de gabarit ; il ne porte que l'origine et la direction.

### Règles

**Concurrence : dernière écriture gagne.** Le modèle discret (§5.3bis) supprime la prise
continue, donc la contention. Si le MJ déplace un pion pendant qu'un joueur l'a
sélectionné, la sélection du joueur devient simplement périmée : son prochain tap se
valide contre la position fraîche. Aucun verrou, aucun snap-back, aucun `grab_revoked`.

**Animation déterministe, sans état streamé.** Pattern repris de `anim.js` : publier
`{from, to, path, startedAt}` et laisser chaque client calculer la position comme
fonction pure de `(Date.now() - startedAt)`. Les trois écrans animent en phase sans
qu'aucune position intermédiaire ne transite. Même principe pour les PNJ en ronde et le
vacillement des torches : **aucune synchro nécessaire**.

**Aucune écriture haute fréquence.** Pendant un drag MJ, rien n'est publié avant le
`pointerup`. C'est la règle qui rend le choix RTDB/Firestore libre (§4).

**Reconnexion.** À chaque `connect`, le client reçoit un **snapshot complet** avant tout
delta. Pas de reprise sur deltas seuls. Une session doit survivre à un F5 accidentel sur
la tablette en cours de partie — c'est le scénario nominal, pas le cas limite.

**`portal.toggle` porte l'état cible, malgré son nom** (amendement du 03/08/2026). Le nom vient
de ce document et `CONVENTIONS.md` §4 interdit d'en inventer un autre. Mais avec les trois états
du §6, « basculer » n'a plus de sens — basculer depuis `locked` mènerait où ? Le payload porte
donc `{levelId, portalId, state}`, valeur absolue, ce qu'exige aussi l'idempotence. `levelId` y
figure et ne se déduit pas de l'étage affiché : le MJ et la tablette peuvent regarder deux
étages différents.

**L'autorisation porte sur la transition, pas sur l'acteur.** « MJ, joueurs si autorisé »
suffisait à deux états ; à trois, la règle est plus fine :

| Transition | MJ | Joueurs |
|---|---|---|
| `closed` ↔ `open` | oui | **oui** |
| `locked` → `closed` | oui | non |
| `closed`/`open` → `locked` | oui | non |

Elle s'applique **à l'émission**, là où l'intention naît, jamais à l'application d'un événement
reçu : un client qui refuserait d'appliquer un verrouillage émis par le MJ divergerait de la
table, en silence. Et **c'est une règle de jeu, pas une frontière de sécurité** — elle est
appliquée côté client, et un `by: 'players'` n'est pas une preuve d'identité. La vraie frontière
reste la liste blanche d'adresses des règles Firebase (`ETAT.md`).

---

## 8. Pipeline d'import UVTT (Mac)

```
.uvtt / .dd2vtt
   │
   ├─ 1. Parse JSON
   ├─ 2. Décoder `image` (base64) → PNG
   ├─ 3. Rééchantillonner à pxPerCell cible (≤ MAX_TEXTURE_SIZE) → WebP
   ├─ 4. Écrire dans maps/ du dépôt Pages
   ├─ 5. Convertir la géométrie (voir pièges) → document de scène
   └─ 6. Publier le document dans Firestore
```

### Pièges de format à traiter explicitement

**Coordonnées en unités de case.** `line_of_sight`, `objects_line_of_sight`, `portals`
et `lights` sont exprimés en **cases**, pas en pixels. Le bug n°1 des imports maison est
d'oublier la conversion via `resolution.pixels_per_grid`. Le modèle §6 conservant les
unités de case, la conversion n'a lieu qu'au rendu.

**Pas de champ « offset de grille ».** L'alignement vient de `resolution.map_origin`
(en unités de case). Ne pas chercher un champ d'offset qui n'existe pas.

**`environment.baked_lighting`.** Si vrai, l'éclairage est **déjà cuit dans l'image**.
Appliquer le curseur jour/nuit par-dessus double l'effet et donne un rendu sale. À
détecter à l'import et à signaler dans l'UI MJ.

**Grille carrée uniquement.** Le format ne décrit que des grilles carrées. Une option
« basculer en hexagone » produirait une grille désalignée avec le dessin de la carte →
retirée du périmètre (§2, non-objectifs).

**Ne pas simplifier avec Ramer-Douglas-Peucker.** RDP *déplace* la géométrie sous un
seuil : sur un donjon, il décale les murs de quelques pixels et casse l'alignement avec
les portails (une porte est un segment posé exactement dans l'ouverture d'un mur) → fuites
de lumière dans les angles. Si déduplication souhaitée : fusion de segments
**exactement colinéaires et contigus** uniquement, sans déplacement de point.

---

## 9. Rendu & performance

**Stack.** Canvas 2D natif pour le rendu. Vanilla JS pour la logique et l'UI, cohérent
avec l'existant. Le moteur tiers précédemment essayé a été retiré après échec d'intégration.

**Boucle de rendu à la demande** (pattern repris de `anim.js`) : la boucle rAF
**s'arrête complètement** quand rien n'est animé, et ne redémarre qu'à un déplacement,
une bascule de porte ou une ronde de PNJ en cours. Sur une tablette qui encode déjà un
flux cast, ne pas rendre à 90 Hz sur un plateau immobile est un gain thermique et
batterie majeur sur 4 h. **Exigence, pas optimisation optionnelle.**

### Fonds animés — faisables, mais ils annulent l'exigence ci-dessus

Une future vidéo de fond devra utiliser un élément `<video>` comme source de `drawImage`.
WebM/VP9 ou MP4/H.264 sont requis pour le décodage matériel de l'Exynos ; jamais de
GIF/APNG/WebP animé à la taille d'une carte. Autoplay Chrome Android : `muted` +
`playsinline` requis. Cette capacité reste hors du lot stabilisé et exige une mesure dédiée.

Deux coûts réels :

1. **Rendu continu pendant 4 h** + décodage vidéo + encodage cast = trois charges
   continues simultanées sur un Mali-G68. C'est le risque principal.
2. **Plafond de résolution** : les cartes animées se distribuent en 1080p/1440p, jamais en
   8k. Nettement moins définies qu'une statique, et ça se paie au zoom.

**Approche recommandée — hybride.** Fond statique en pleine résolution + petites
`animatedOverlays` en boucle (eau, feu, brume, torches), qui est tout ce qu'animent les
cartes du commerce. Netteté conservée partout, frames dépensées seulement là où ça bouge,
et pilotage par le pattern d'animation déterministe (§7) donc **zéro synchro**.

`videoUrl` reste supporté en opt-in explicite par étage.

> **Corrigé le 11/08/2026 — la phrase précédente disait « avec avertissement UI que l'étage
> désactive le rendu à la demande », et c'était faux.** Elle supposait que la vidéo passerait
> par `drawImage`, ce qui aurait effectivement imposé une boucle continue. L'implantation
> retenue pose un `<video>` **sous** le canvas (`js/render/videoBackdrop.js`) : le compositeur
> du navigateur la décode sur son propre fil, `requestAnimationFrame` ne la voit jamais, et le
> rendu à la demande est intégralement conservé. Le coût n°1 listé ci-dessus — « rendu continu
> + décodage + encodage cast = trois charges » — se réduit donc à deux.
>
> Ce qui reste vrai et non mesuré : le décodage d'un flux de 12 Mpx sur Mali-G68, sa
> consommation mémoire, et la batterie sur 4 h. Voir le spike dans `ETAT.md`.

**Ce qui coûte cher, dans l'ordre :**

1. **L'image de fond**, pas les murs. C'est là que se joue la tenue sur Mali-G68.
   → rééchantillonnage à l'import, jamais de plein format.
2. **La rasterisation du fog** le long d'un chemin. Une fois au commit, pas par frame.
3. **Le sweep de visibilité.** Devenu marginal grâce au modèle discret : un sweep par
   déplacement (× le nombre de cases du chemin), jamais par frame.

**Optimisations retenues :**
- Index spatial (grille uniforme ou quadtree) sur les segments : ne tester que ceux dans
  le rayon utile.
- Union des polygones de vision rendue en **un seul masque Canvas hors écran**, pas en
  passes multiples.
- Résolution de rendu plafonnée à 1.5 (§3).
- Textures de pions en atlas.

**Budget cible, à valider sur la tablette réelle :** 30 fps stables avec 500 segments de
murs, 8 sources de lumière, 6 pions PJ porteurs de vision, pendant 4 h sans throttling
thermique bloquant.

### Ce que la mesure du 31/07/2026 a établi

Relevé sur la **tablette cible**, section 6 de `diag.html`, à la livraison de la tranche
L-02. Trois conclusions, dont deux invalident la formulation d'origine.

**1. « 500 segments » mesurait la mauvaise grandeur.** Le coût ne dépend pas du nombre de
segments de la carte, mais du nombre de segments **à portée de vision** — soit environ
`densité locale × π × portée²`. Une carte de 200 × 200 cases à densité réelle donne le même
nombre de segments à portée qu'une carte de 65 × 71 : **le coût du sweep est indépendant de
la taille de la carte.** Une plaine immense coûte moins qu'une petite pièce meublée.

**2. La portée est le seul levier qui compte.** Le coût varie comme le carré du nombre de
segments à portée, lequel varie comme le carré de la portée : **doubler la portée multiplie
le coût par environ seize.** À portée 15, le corpus réel passe avec un ordre de grandeur de
marge ; c'est bien au-delà des besoins.

**3. Aucune limite n'est à imposer**, ni de portée, ni de dimension de carte. Le seul terme
croissant avec la surface est le tri par portée, linéaire et négligeable — de l'ordre de
0,1 ms pour 12 800 segments, contre plusieurs millisecondes pour le sweep lui-même.

**La non-régression est tenue en intégration continue**, sans tablette, par le test « le tri
par portée est interne » de `tests/sweep.test.mjs` : il compte les segments évalués au lieu
de chronométrer, et un test de mutation confirme qu'il rougit quand le tri disparaît. C'est
ce test, et non un seuil dans ce document, qui protège réellement la performance.

> **Ce que cette mesure ne couvre pas**, et qui reste ouvert : le rendu du polygone, la
> rastérisation du fog (lot 2, tranche L-04), et les 150 à 400 ms ajoutées par le cast (§3).
> Le budget de 4 h sans throttling thermique reste lui aussi à vérifier.

---

## 10. Persistance

| Donnée | Support | Fréquence |
|---|---|---|
| Documents de scène | Firestore | à l'édition |
| Masques de fog | RTDB, événements `fog.update` + LocalStorage **par poste** (PNG base64 **mono-canal**, ~12 Ko/étage) | throttlé 1 Hz |
| Positions de pions | RTDB (autoritatif live) + snapshot Firestore | snapshot throttlé |
| Images de carte | Dépôt GitHub Pages | à l'import |
| Repli hors-ligne | LocalStorage | continu |

> **Amendement du 01/08/2026 — le masque pèse ~12 Ko, pas ~5 Ko.** L'estimation d'origine
> n'avait jamais été mesurée. Relevé sur la géométrie publiée (`testbig150`, 65 × 71 cases,
> masque 8 px/case presque plein) : **11,7 Kio** de base64 en PNG **mono-canal**, encodé en
> 6 ms. Un canvas ne sachant produire que du RGBA, `toDataURL` en donnerait 26,8 Kio — d'où
> l'encodeur mono-canal écrit à la main dans `vision/fog.js`, que le manifeste prévoyait déjà.
> L'ordre de grandeur reste sans danger : 1 Hz, et loin du plafond que le projet s'est donné.

> **Amendement du 03/08/2026 — le fog n'atteint pas Firestore.** La ligne annonçait « Firestore,
> throttlé et en fin de séance ». Vérifié dans le code : le masque ne va **pas** dans le document
> de campagne, seul contenu Firestore du projet (`campaigns/{sid}`). Il voyage en événements
> `fog.update` sur la RTDB, et chaque poste le conserve dans son propre `localStorage`, clé
> `rpg_fog_{sessionId}_{levelId}`.
>
> **Ce que cela change pour le critère 9**, « le fog survit à un redémarrage complet » : il y
> survit **par poste**, et non par le serveur. Le MJ retrouve le sien dans son stockage local ;
> un poste au stockage vide, ou une tablette qui rejoint en cours de séance, ne reçoit rien
> jusqu'à la première publication — que le MJ émet de toute façon au démarrage, `syncVision`
> étant appelée à l'initialisation. Le critère tient donc, mais par republication et non par
> lecture d'un état serveur. Vider le stockage du **Mac** perd le fog exploré de la séance :
> c'est le seul poste dont la copie fasse autorité.
>
> Le plafond qui protège la charge n'est pas celui de Firestore mais `FOG_MAX_ENCODED_BYTES`
> (50 Kio), porté par `vision/fog.js` — la charge étant en base64 brut, elle échappe à
> `assertNoTransientAssetUrls`. Voir `CONVENTIONS.md` §3.

`schemaVersion` dans chaque document, avec migration explicite. Le format va changer
entre les lots — prévoir le chemin de migration dès le lot 1.

---

## 11. Lots & critères d'acceptation

> **Décompte au 12/08/2026 : 37 critères acquis sur 41.** Lot 1a 11/11, lot 1b 4/4, lot 2 13/13,
> **lot 3 6/6 — fermé**, lot 4 **2/6**, **spike vidéo 1/1 — fermé**.
>
> Trois acquis le 12/08 : le **ping** du lot 4 (chantier X) ; le **critère 1 du lot 3**, qui n'était
> pas ouvert pour une raison technique mais parce que je l'avais mal lu — voir la note sous ce
> critère ; et le **spike vidéo**, dont le volet cast est validé sur confirmation du mainteneur.
>
> **Les quatre restants sont tous dans le lot 4** : trois critères hexagonaux et la mesure au geste.
> Tous sont du développement.
>
> ⚠ **Ce §11 fait foi sur le décompte, et les cases de ce document en sont la seule preuve.** Un
> résumé qui annonce un autre nombre est à corriger sur celui-ci, jamais l'inverse. La règle qui a
> manqué jusqu'ici : **un critère n'appartient qu'à une seule liste** — une mesure suivie par la
> feuille de route complémentaire ou par le §12 ne se recompte pas dans un lot.

### Lot 1a — Le plateau (première séance jouable)

Import UVTT **et** image simple avec calibration (§5.1), `GridAdapter` + `SquareGrid`,
générateur de pions, déplacement plateau avec cases atteignables, les trois vues,
`Transport`, persistance.

**Le modèle de données du §6 est implémenté en entier dès ce lot** — `levelId`,
`sizeCells`, `visionBright`/`visionDim`, `emitsLight`, `speedCells`, `elevation`,
`markers` — même si certains champs ne sont pas encore exploités. Les ajouter plus tard
est un refactor transverse.

Critères :
- [x] Une carte UVTT s'importe et s'affiche alignée sur sa grille sur les trois postes.
- [x] Un JPG quelconque se calibre en moins d'une minute et devient jouable.
- [x] Tap pion → tap destination déplace le pion ; le Mac l'affiche en < 300 ms.
- [x] Le drag à un doigt sur la tablette pan la carte et ne déplace **jamais** un pion.
- [x] Les cases atteignables respectent `speedCells`, propre à chaque pion.
- [x] Un F5 sur la tablette en cours de partie restaure l'état complet en < 3 s.
- [x] La vue joueurs n'affiche aucun élément d'UI.
- [x] Le cast vers la TV tient 30 fps pendant une animation de déplacement — validé le 05/08/2026, première séance réelle.
- [x] La boucle rAF est à l'arrêt mesurable quand le plateau est immobile.
- [x] Un pion `sizeCells: 2` occupe 2×2 cases et ses coordonnées restent entières.
- [x] Un grep de `pxPerCell` hors du fichier `GridAdapter` revient vide (test automatisé).

> **Lot 1a fermé à 11/11 le 08/08/2026, par réconciliation.** Aucune de ces cases n'était cochée
> alors que les onze critères étaient acquis, le dernier — les 30 fps sous cast — depuis le
> 05/08/2026.
>
> ⚠ **Deux mesures matérielles restent ouvertes, et elles n'appartiennent pas à ce lot.** La tenue
> thermique sur la durée est **R2-06** de la feuille de route complémentaire ; la limite de texture
> réelle de la dalle est la **question ouverte n°1 du §12**. `ETAT.md` les comptait dans le lot 1a,
> d'où un « 10 sur 11 » qui nommait pourtant deux points ouverts — un décompte impossible.
> Un critère n'appartient qu'à une seule liste.

> **Jouer une vraie séance sur le lot 1a avant d'écrire le lot 1b.** Le passage du drag au
> déplacement plateau est né d'un test réel, pas d'une spécification — c'est la boucle à
> conserver. Plusieurs options des lots suivants se hiérarchiseront d'elles-mêmes, et
> certaines disparaîtront.

### Lot 1b — La prépa MJ

Bibliothèque de scènes, bibliothèque de pions (§5.7), révélation d'image (§5.8), badge
d'élévation.

C'est ce qui fait passer l'outil d'« une carte » à « une campagne », et c'est le terrain
où les VTT existants deviennent pesants — donc celui à affiner à l'usage plutôt qu'à
spécifier d'avance (§1).

Critères :
- [x] Vingt cartes se parcourent et se chargent sur la table sans quitter la vue MJ.
- [x] Un PNJ récurrent est recadré une seule fois et réinstancié pré-réglé.
- [x] Une image révélée s'affiche en plein écran chez les joueurs en < 500 ms, et sa
      fermeture rend la carte intacte.
- [x] L'élévation d'un pion est lisible sur les trois écrans — validé le 05/08/2026.

> **Lot 1b fermé à 4/4 le 08/08/2026, par réconciliation.** Les quatre critères étaient acquis
> depuis le chantier M et la séance du 5 août ; aucune case ne l'indiquait. Le deuxième critère est
> celui que le chantier M a réellement fermé : la bibliothèque de pions ne persistait pas ce que le
> générateur produisait, alors que `ETAT.md` l'annonçait complète.

### Lot 2 — Lignes de vue, portes & tactique

Sweep de visibilité, union des PJ, portes interactives, fog persistant avec ses trois
états de rendu et les outils MJ. Plus, parce qu'ils dépendent tous de la géométrie de
murs : **éditeur minimal de murs** (§5.7), **gabarits de zone d'effet** (§5.9),
**marqueurs d'état** (§5.3).

Critères :
- [x] Un segment de mur manquant s'ajoute à la main et corrige immédiatement la vision.
- [x] Un étage importé en image simple reçoit des murs et gagne des lignes de vue.
- [x] Un gabarit (cercle ou cône) dessine la forme réelle affectée **en respectant les murs** (découpe par les murs obligatoire).
- [x] Les marqueurs d'un pion sont lisibles sur les trois écrans.
- [x] Les zones hors vision sont masquées côté joueurs, pas côté MJ.
- [x] Une zone explorée puis quittée reste grisée, et **aucun pion n'y est visible**.
- [x] Traverser un couloir d'un bout à l'autre révèle **tout le couloir**, pas seulement l'arrivée.
- [x] Les cases atteignables s'arrêtent aux murs et aux portes fermées, sans corner-cutting.
- [x] Le fog survit à un redémarrage complet de la session.
- [x] Ouvrir une porte étend la vision des deux côtés en < 300 ms et rouvre les arêtes de passage.
- [x] Une porte est ouvrable au doigt du premier coup sur la tablette.
- [x] Aucune fuite de lumière dans les angles de murs.
- [x] **Coût de la vision mesuré sur la tablette cible** — voir §9, « Ce que la mesure du
      31/07/2026 a établi ». Le critère n'est plus un seuil à franchir mais une mesure
      consignée : le coût est gouverné par la **densité locale de murs et la portée de
      vision**, jamais par la taille de la carte. Aucune limite de dimension n'est requise.

> **Lot 2 fermé à 13/13 le 07/08/2026.** Le mainteneur confirme sur le dispositif réel la
> lisibilité des marqueurs sur les trois écrans, la réponse des portes sous 300 ms et leur
> ouverture tactile du premier coup. Les dix autres critères étaient déjà acquis par le code,
> les tests et les mesures consignées dans `ETAT.md`.

### Lot 3 — Étages & lumière

Sélecteur d'étage avec badges de présence, liaisons ponctuelles, téléportation au drop,
bascule auto avec cadenas, lumières portées, ambiante et cycle jour/nuit.

Critères :
- [x] Trois étages importés indépendamment, sans alignement manuel. **Coché le 12/08/2026, et il
      était satisfait depuis un moment.** `maps/test_village_complet_00/01/02.dd2vtt` sont trois
      exports réels de ~9 Mo, importés séparément, assemblés en une campagne à trois étages par
      `maps/scenes.json`. Constat : **tous les `grid.offsetX/offsetY` valent 0** — aucun alignement
      manuel —, deux liaisons inter-étages fonctionnent, et chaque niveau porte sa propre géométrie
      (200, 37 et 16 murs).

      ⛔ **« Importés indépendamment » veut dire les uns des autres, pas de provenances
      indépendantes.** J'ai lu la seconde chose et inventé une exigence qui n'est pas écrite : trois
      étages d'un même bâtiment viennent naturellement d'un même export, et c'est le cas normal, pas
      une triche. Le critère demande que l'outil n'exige aucun lien entre les fichiers ni aucun
      recalage à la main — ce qui est le cas.
- [x] Taper une case d'escalier téléporte le pion et bascule la vue de la tablette.
- [x] Le fog de chaque étage est indépendant et persistant.
- [x] Le cadenas empêche la bascule auto quand le groupe est séparé.
- [x] Un pion « Torche » éclaire et son déplacement met la vision à jour.
- [x] Une carte `baked_lighting: true` est signalée et n'est pas double-éclairée.

> **Lot 3 porté à 5/6 le 07/08/2026.** Le parcours complet, le fog et le cadenas sont réunis dans
> un scénario multi-pages ; l'éditeur de liaisons rend ce parcours préparatoire utilisable sans
> JSON. Les lumières partagent le sweep borné du lot 2 et `baked_lighting` force une ambiance pleine
> signalée au MJ. Le premier critère reste ouvert : la persistance v3 et la fixture synthétique à
> trois étages ne remplacent pas l'import de trois cartes réelles autorisées.

### Lot 4 — Grille hexagonale & confort de table

`HexGrid` comme seconde implémentation de `GridAdapter`, étages construits à la main.
Mesure au geste, ping, undo MJ, réglages fins.

Critères :
- [ ] Un étage `grid.type: 'hex'` coexiste avec des étages carrés importés d'UVTT.
- [ ] Le hit-test pixel→hexagone sélectionne la bonne case au doigt du premier coup.
- [ ] Les cases atteignables en hexagone sont à coût uniforme 1 et respectent les murs.
- [ ] Mesurer une distance sans quitter le Zero-UI.
- [x] Un ping est visible sur les trois postes en < 500 ms. **Livré le 12/08/2026, chantier X**
      (`CHANTIER-X-PING.md`). Émission MJ par bouton armé, affichage sur les trois postes,
      horodatage réhorodaté à la réception. ⚠ Le budget est éprouvé sur transport local : les
      500 ms réels restent à constater à la table.
- [x] Undo restaure l'état fog précédent.

### Spike à planifier tôt (lot 2 ou 3, avant de concevoir autour)

- [x] Un fond `videoUrl` 1080p tient-il 30 fps **avec le cast actif pendant 45 min**
      sans throttling bloquant sur la Tab S9 FE ? Si non, `animatedOverlays` uniquement.
      **✅ Oui, validé le 12/08/2026.** Le fond animé est constaté fluide sur la tablette le 11/08 —
      4200 × 2850 VP9, décodage matériel confirmé, cadence nominale à 29,9 i/s pour un fichier à
      30 i/s, zoom et dézoom compris. Le volet cast est validé le 12/08 sur confirmation du
      mainteneur : ses essais Mac + tablette + cast n'ont montré aucune difficulté. `videoUrl` est
      donc retenu, et `animatedOverlays` n'a pas à le remplacer.

---

## 12. Questions ouvertes

1. ~~**Limite de texture réelle** de la Tab S9 FE (§3)~~ **Tranchée le 12/08/2026 : 8192, et le
   plafond y reste.** `gl.MAX_TEXTURE_SIZE` a été mesuré à 8192 sur la Tab S9 FE, et
   `MAX_PREPARED_TEXTURE_PX` vaut cette valeur exacte.

   ⚠ Le point qui a laissé la question ouverte était l'absence de marge : `testbig150` est préparée à
   7499 × 8192, soit **245 Mio de RGBA décodés**. Il est tranché par l'usage — la carte se prépare,
   se sert et se joue, et la campagne de diagnostics du 11/08/2026 n'a signalé **aucun problème de
   performance**. Le coût de décodage, lui, est déjà couvert par la doublure 1024 px du chantier P.

   ⛔ Ne pas réduire le plafond « par prudence » : ce serait rendre toutes les grandes cartes moins
   nettes contre un risque qui ne s'est jamais manifesté, sur un parc d'un seul appareil dont la
   limite est connue. Si un appareil au plafond plus bas rejoint le parc un jour, c'est **là** qu'il
   faudra trancher, et sur sa mesure.
2. ~~**Latence Firebase mesurée** à table~~ **Tranchée le 07/08/2026 : on reste sur Firebase,
   `LocalSocketTransport` n'est pas activé.** Décision prise **sciemment sans** la mesure que ce §12
   réclamait. Le détail est dans `ETAT.md`, « Décision n°2 du §12 » ; l'essentiel est que le seuil de
   250 ms n'était pas le maillon dominant — le cast ajoute sa propre latence, bien supérieure.

   ⚠ Cette décision n'était consignée que dans `ETAT.md` jusqu'au 12/08/2026, alors que **c'est ce
   §12 qui fait foi**. Elle a donc figuré comme « ouverte » pendant cinq jours sans l'être.
3. ~~**Portes ouvrables par les joueurs** ou MJ uniquement ?~~ **Tranchée le 03/08/2026 : les
   deux, avec une règle par transition.** Les joueurs ouvrent et ferment (`closed` ↔ `open`) ;
   verrouiller et déverrouiller sont réservés au MJ. Voir §7 et `TRANCHE-L05-PORTES.md` §6.3.
4. ~~**Ambiance globale ou par étage ?**~~ **Tranchée le 12/08/2026 : par étage, et le champ global
   est supprimé.** Le §6 la plaçait déjà par étage et l'argument tenait — une cave sombre sous un rez
   éclairé.

   ⭐ **L'implémentation avait en réalité déjà répondu, et la question restait ouverte par
   inadvertance.** Le curseur d'ambiance du panneau MJ publie `level.ambient`, `fogLayer` lit
   `level.ambient`, et `isAmbientLit` en dérive la portée de vision — ambiante active, chaque PJ voit
   jusqu'au plafond technique ; ambiante nulle, sa portée nocturne seule.

   ⛔ **`settings.ambientLevel` n'était relu par aucun rendu ni aucune vision** : écrit par le défaut
   du schéma, jamais lu. Il est retiré de `js/core/schema.js` et de `js/core/types.js`, et des 39
   fixtures de test qui le renseignaient. Un réglage qu'on peut écrire sans effet finit par piéger
   quelqu'un qui croit le régler. `CampaignSettings` reste comme conteneur vide : **ne rien y remettre
   sans un lecteur en face.**
5. ~~**D'où viennent les cartes hexagonales ?**~~ **Tranchée le 12/08/2026 : image calibrée, plus
   l'étage vierge.** Un étage hexagonal se crée soit sur une **image de fond calibrée à la main**,
   comme au lot 1a — le MJ règle la largeur **plat-à-plat**, l'application en déduit le pas de rangée
   par la convention du §4.3 —, soit **vierge**, ce qui est le même chemin sans image, les murs
   étant tracés avec l'éditeur du lot 2.

   ⛔ **L'import UVTT hexagonal est écarté, et pour une raison plus forte que la difficulté : il est
   mal posé.** Aucun outil ne déclare sa topologie, et la géométrie de murs d'un export DD2VTT
   hexagonal est exprimée dans la métrique **carrée** (`ANALYSE-DD2VTT-GRILLES.md` §4.3, vérifié sur
   deux corpus, le MJ ayant explicitement tenté de forcer l'export). La relire en hexagone
   déplacerait **chaque** mur, avec une dérive croissante — deux rangées sur quatorze. Aucune
   quantité de code ne répare une information absente du fichier.

   ⭐ Ce que la chaîne peut faire, en revanche, et qui existe déjà : `js/import/gridPitch.js` détecte
   un réseau hexagonal **peint** par autocorrélation du profil d'encre. Aujourd'hui il avertit ; il
   devrait désormais **proposer** la calibration hexagonale, ce qui sert l'exigence d'universalité
   de l'import — ne jamais rien écarter en silence — au lieu de la contredire.
6. ~~**Forme des grandes créatures en hexagone** (`sizeCells > 1`)~~ **Tranchée le 12/08/2026 : la
   rosette centrée, soit 1, 7 puis 19 cases.** `sizeCells` s'y lit comme un **rayon d'anneau** : 1
   couvre l'hexagone seul, 2 couvre l'hexagone et ses six voisines, 3 ajoute la couronne suivante.

   Le motif de la décision n'est pas l'élégance du nombre, c'est que **la rosette est la seule forme
   dont le centre reste un centre d'hexagone.** Tout le modèle existant survit donc sans retouche :
   la sélection, la case de destination, l'origine du champ de vision et le hit-test continuent de
   désigner *une* case. Une grappe centrée sur un sommet serait tactiquement plus fine — 2 vaudrait
   3 cases — mais briserait « un pion occupe une case », donc quatre mécanismes déjà livrés et
   éprouvés.

   ⚠ **Le défaut assumé : la granularité est grossière.** Il n'existe aucun équivalent hexagonal du
   2×2 carré ; une créature passe de 1 à 7 cases d'un coup. C'est une propriété du pavage
   hexagonal, pas un manque d'imagination — et c'est précisément pourquoi aucune convention ne
   s'est établie ailleurs. Si l'usage à la table montre que le saut est intenable, le repli écrit
   est le **visuel seul** : occuper une case et déborder graphiquement, au prix de `sizeCells`
   signifiant deux choses selon le type de grille.
7. ~~**Jeu de marqueurs d'état** (§5.3) : liste et icônes à définir.~~ **Tranchée le
   04/08/2026 : quatorze états, liste close.** À terre, assourdi, aveuglé, brisé, empêtré,
   empoisonné, en flammes, hémorragique, inconscient, sonné, surpris, frénésie, peur, terreur.
   Les identifiants et leurs icônes sont dans `assets/icons/status/SOURCES.md`, qui fait
   autorité ; le nom de fichier est l'identifiant. Voir `TRANCHE-L09-MARQUEURS.md`.
   > La question demandait d'attendre « une séance réelle ». Elle a été tranchée avant, par le
   > mainteneur, sur les états qu'il voit à sa table — ce qui était l'objet de l'attente. Ce
   > que la séance dira encore : l'**ordre de troncature** quand un pion porte plus de trois
   > marqueurs, et le **seuil de 14 px** au-delà duquel une icône vaut mieux qu'un point
   > coloré. Deux constantes, pas deux décisions de conception.
   >
   > ⚠ **Le chantier Q ne rouvre pas cette question, et le vocabulaire reste à quatorze.** Ses
   > trois états de santé — `unharmed`, `wounded`, `critical` — vivent dans un **champ séparé**,
   > `health`, et non dans `markers`. La raison est structurelle : les quatorze marqueurs sont un
   > **ensemble** — indépendants, cumulables, sans hiérarchie —, quand les trois états de santé
   > s'**excluent** mutuellement. Les loger dans `markers` demanderait une logique d'exclusion
   > dans un champ dont toute la validation suppose l'inverse. Ne pas lire « 14 + 3 = 17 » :
   > ce sont deux vocabulaires clos, portés par deux champs, et un quinzième **marqueur**
   > rouvrirait Q7 exactement comme avant.
8. ~~**Gabarits manipulables par les joueurs ?**~~ **Tranchée le 04/08/2026 : MJ seul au lot 2** (Voir `TRANCHE-L08-GABARITS.md` §10). **Rouverte et amendée le 05/08/2026 (L-10)** : Les joueurs manipulent (déplacer, pivoter) les gabarits visibles (`visibleToPlayers`), avec autorisation à l'émission. La pose, l'effacement et le réglage restent réservés au MJ. Voir `TRANCHE-L10-GABARITS-LIBRES.md`.
9. **Une lumière vue révèle-t-elle tout ce qu'elle éclaire, ou seulement ce que le PJ voit ?**
   **Ouverte, et mise de côté sciemment le 11/08/2026.**

   La règle de base est tranchée et implantée : *une lumière n'est pas un œil*. Une source
   ne contribue à la visibilité que si un PJ a une ligne de vue dégagée jusqu'à elle, et sans
   PJ sur l'étage rien n'est visible. Elle vient d'un constat de séance — une carte Dungeon
   Alchemist, qui en place systématiquement, se dévoilait toute seule **sans aucun pion**.

   Ce qui reste ouvert est l'**approximation** retenue : le test porte sur le **centre** de la
   source. Un PJ qui aperçoit une lampe se voit donc révéler *tout son halo*, y compris des
   recoins que lui-même ne verrait pas. Le cas visible serait : apercevoir une lanterne par
   l'embrasure d'une porte et découvrir toute la pièce derrière.

   **La version stricte** croiserait, pour chaque PJ, son polygone de vue à portée complète
   avec l'union des zones éclairées. Coût estimé, mesuré sur les cartes du dépôt :
   - l'intersection elle-même est **quasi gratuite** — le masque de fog est déjà rasterisé à
     8 px/case, soit 336 × 336 px sur la plus grande carte : un seul `source-in` ;
   - ce qui coûte est **un balayage supplémentaire par PJ**, et seulement dans le noir : sous
     ambiante allumée le polygone à portée maximale existe déjà. Environ **+4 à 7 ms** avec
     six PJ sur `test_village_complet_00`, soit 15 à 20 ms contre 300 de budget ;
   - le vrai prix est **une centaine de lignes dans le chemin du fog**, celui où une erreur
     fait voir aux joueurs ce qu'ils ne devraient pas.

   ⭐ **Le déclencheur pour y revenir est écrit** : voir en séance une pièce entière se
   dévoiler parce qu'un PJ aperçoit une lampe par une porte. Tant que le cas reste théorique,
   l'approximation tient. Tentative de reproduction sur `testvideo-3` le 11/08/2026 : les murs
   obliques de la tour bloquent la ligne vers les lampes, le cas ne s'est pas déclenché.
