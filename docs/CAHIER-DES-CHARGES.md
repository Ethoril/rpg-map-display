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
- Pas de points de vie. Si le besoin apparaît, la version 10 % est un unique état
  « blessé / à terre » via `markers`, jamais une barre.
- Pas de snapshot ni de restauration de positions.
- Un groupe séparé sur deux étages ne peut être observé que d'un étage à la fois.

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
- `markers` — tableau d'identifiants d'états (empoisonné, à terre, concentré…). **Le jeu
  de marqueurs reste à définir** ; seul le champ est figé maintenant.

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

- **Mesure de distance** — au geste : appui long + glisser. Priorité abaissée : les cases
  atteignables (§5.3bis) répondent déjà à « est-ce que j'y arrive ? ». Reste utile pour les
  portées de tir, d'un point arbitraire à un autre.
- **Ping** — deux doigts tap, marqueur animé ~2 s, visible de tous.
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
`GridAdapter`, et occlusion par les segments de murs et portes fermées du §5.3bis. Un
gabarit respecte donc les murs sans code de géométrie supplémentaire.

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
    portals: [{ id, a: CellPoint, b: CellPoint, closed: true, freestanding: false }],
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
    markers: []                         // ['poisoned', 'prone', …] — jeu à définir
  }],

  templates: [{                         // gabarits de zone d'effet (§5.9)
    id, levelId, shape: 'circle'|'cone'|'line',
    origin: {a, b}, radiusCells, directionDeg, widthCells,
    color, visibleToPlayers: true
  }],

  settings: { ambientLevel: 1.0 }
}
```

### Bibliothèques (documents séparés, §5.7)

```js
// tokenLibrary
[{ id, name, imageUrl, kind, sizeCells, speedCells,
   visionBright, visionDim, emitsLight, borderColor }]

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
/session/{sid}/tokens/{tokenId}   → { x, y, levelId, grab: { by, at } }
/session/{sid}/portals/{portalId} → { closed }
/session/{sid}/view               → { levelId, camera: { x, y, zoom }, locked }
/session/{sid}/vision             → { levelId, polygon: [...], rev }
/session/{sid}/fog/{levelId}      → { png: 'base64…', rev }
/session/{sid}/pings/{pushId}     → { x, y, levelId, at }
/session/{sid}/presence/{cid}     → { role, at, build, label }
```

Séparation volontaire : `/tokens` et `/view` sont écrits en haute fréquence, `/fog` et
`/vision` par le Mac seul, `/pings` en append éphémère.

---

## 7. Protocole de synchronisation

### Événements

| Type | Émetteur | Fréquence |
|---|---|---|
| `token.move` | MJ, joueurs | **ponctuel** — `{id, from, to, path, startedAt}` |
| `token.levelChange` | MJ, joueurs (liaison) | ponctuel |
| `token.create` / `update` / `delete` | MJ | ponctuel |
| `portal.toggle` | MJ, joueurs si autorisé | ponctuel |
| `view.change` | tablette | throttlé 10 Hz |
| `level.select` | MJ, tablette | ponctuel |
| `vision.update` | **Mac seul** | après chaque mouvement, throttlé |
| `fog.update` | **Mac seul** | throttlé 1 Hz ou à la révélation |
| `fog.reset` / `fog.paint` | MJ | ponctuel |
| `ping` | tous | ponctuel |
| `ambient.set` | MJ | throttlé |
| `handout.show` / `handout.hide` | MJ | ponctuel |
| `template.place` / `move` / `clear` | MJ, joueurs si autorisé | ponctuel |
| `token.markers` / `token.elevation` | MJ | ponctuel |
| `wall.add` / `wall.remove` | MJ | ponctuel — invalide le masque d'arêtes |
| `scene.load` | MJ | ponctuel — déclenche un snapshot complet |

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

`videoUrl` reste supporté en opt-in explicite par étage, avec avertissement UI que
l'étage désactive le rendu à la demande.

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

---

## 10. Persistance

| Donnée | Support | Fréquence |
|---|---|---|
| Documents de scène | Firestore | à l'édition |
| Masques de fog | Firestore (PNG base64, ~5 Ko/étage) | throttlé, et en fin de séance |
| Positions de pions | RTDB (autoritatif live) + snapshot Firestore | snapshot throttlé |
| Images de carte | Dépôt GitHub Pages | à l'import |
| Repli hors-ligne | LocalStorage | continu |

`schemaVersion` dans chaque document, avec migration explicite. Le format va changer
entre les lots — prévoir le chemin de migration dès le lot 1.

---

## 11. Lots & critères d'acceptation

### Lot 1a — Le plateau (première séance jouable)

Import UVTT **et** image simple avec calibration (§5.1), `GridAdapter` + `SquareGrid`,
générateur de pions, déplacement plateau avec cases atteignables, les trois vues,
`Transport`, persistance.

**Le modèle de données du §6 est implémenté en entier dès ce lot** — `levelId`,
`sizeCells`, `visionBright`/`visionDim`, `emitsLight`, `speedCells`, `elevation`,
`markers` — même si certains champs ne sont pas encore exploités. Les ajouter plus tard
est un refactor transverse.

Critères :
- [ ] Une carte UVTT s'importe et s'affiche alignée sur sa grille sur les trois postes.
- [ ] Un JPG quelconque se calibre en moins d'une minute et devient jouable.
- [ ] Tap pion → tap destination déplace le pion ; le Mac l'affiche en < 300 ms.
- [ ] Le drag à un doigt sur la tablette pan la carte et ne déplace **jamais** un pion.
- [ ] Les cases atteignables respectent `speedCells`, propre à chaque pion.
- [ ] Un F5 sur la tablette en cours de partie restaure l'état complet en < 3 s.
- [ ] La vue joueurs n'affiche aucun élément d'UI.
- [ ] Le cast vers la TV tient 30 fps pendant une animation de déplacement.
- [ ] La boucle rAF est à l'arrêt mesurable quand le plateau est immobile.
- [ ] Un pion `sizeCells: 2` occupe 2×2 cases et ses coordonnées restent entières.
- [ ] Un grep de `pxPerCell` hors du fichier `GridAdapter` revient vide (test automatisé).

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
- [ ] Vingt cartes se parcourent et se chargent sur la table sans quitter la vue MJ.
- [ ] Un PNJ récurrent est recadré une seule fois et réinstancié pré-réglé.
- [ ] Une image révélée s'affiche en plein écran chez les joueurs en < 500 ms, et sa
      fermeture rend la carte intacte.
- [ ] L'élévation d'un pion est lisible sur les trois écrans.

### Lot 2 — Lignes de vue, portes & tactique

Sweep de visibilité, union des PJ, portes interactives, fog persistant avec ses trois
états de rendu et les outils MJ. Plus, parce qu'ils dépendent tous de la géométrie de
murs : **éditeur minimal de murs** (§5.7), **gabarits de zone d'effet** (§5.9),
**marqueurs d'état** (§5.3).

Critères :
- [ ] Un segment de mur manquant s'ajoute à la main et corrige immédiatement la vision.
- [ ] Un étage importé en image simple reçoit des murs et gagne des lignes de vue.
- [ ] Un gabarit circulaire surligne les cases affectées **en respectant les murs**.
- [ ] Les marqueurs d'un pion sont lisibles sur les trois écrans.
- [ ] Les zones hors vision sont masquées côté joueurs, pas côté MJ.
- [ ] Une zone explorée puis quittée reste grisée, et **aucun pion n'y est visible**.
- [ ] Traverser un couloir d'un bout à l'autre révèle **tout le couloir**, pas seulement l'arrivée.
- [ ] Les cases atteignables s'arrêtent aux murs et aux portes fermées, sans corner-cutting.
- [ ] Le fog survit à un redémarrage complet de la session.
- [ ] Ouvrir une porte étend la vision des deux côtés en < 300 ms et rouvre les arêtes de passage.
- [ ] Une porte est ouvrable au doigt du premier coup sur la tablette.
- [ ] Aucune fuite de lumière dans les angles de murs.
- [ ] 30 fps tenus avec 500 segments et 6 pions porteurs de vision.

### Lot 3 — Étages & lumière

Sélecteur d'étage avec badges de présence, liaisons ponctuelles, téléportation au drop,
bascule auto avec cadenas, lumières portées, ambiante et cycle jour/nuit.

Critères :
- [ ] Trois étages importés indépendamment, sans alignement manuel.
- [ ] Taper une case d'escalier téléporte le pion et bascule la vue de la tablette.
- [ ] Le fog de chaque étage est indépendant et persistant.
- [ ] Le cadenas empêche la bascule auto quand le groupe est séparé.
- [ ] Un pion « Torche » éclaire et son déplacement met la vision à jour.
- [ ] Une carte `baked_lighting: true` est signalée et n'est pas double-éclairée.

### Lot 4 — Grille hexagonale & confort de table

`HexGrid` comme seconde implémentation de `GridAdapter`, étages construits à la main.
Mesure au geste, ping, undo MJ, réglages fins.

Critères :
- [ ] Un étage `grid.type: 'hex'` coexiste avec des étages carrés importés d'UVTT.
- [ ] Le hit-test pixel→hexagone sélectionne la bonne case au doigt du premier coup.
- [ ] Les cases atteignables en hexagone sont à coût uniforme 1 et respectent les murs.
- [ ] Mesurer une distance sans quitter le Zero-UI.
- [ ] Un ping est visible sur les trois postes en < 500 ms.
- [ ] Undo restaure l'état fog précédent.

### Spike à planifier tôt (lot 2 ou 3, avant de concevoir autour)

- [ ] Un fond `videoUrl` 1080p tient-il 30 fps **avec le cast actif pendant 45 min**
      sans throttling bloquant sur la Tab S9 FE ? Si non, `animatedOverlays` uniquement.

---

## 12. Questions ouvertes

1. **Limite de texture réelle** de la Tab S9 FE (§3) → conditionne la résolution des cartes.
2. **Latence Firebase mesurée** à table : si le p95 dépasse ~250 ms, basculer
   `LocalSocketTransport`. À mesurer au lot 1, avant de construire dessus.
3. **Portes ouvrables par les joueurs** ou MJ uniquement ? Le modèle le permet
   (`portal.toggle` autorisé aux deux), le défaut reste à trancher.
4. **Ambiance globale ou par étage ?** Le §6 la place par étage ; une cave sombre sous un
   rez éclairé plaide pour ce choix, à confirmer.
5. **D'où viennent les cartes hexagonales ?** Aucun outil UVTT n'en produit. Soit tu les
   dessines, soit l'hexagone reste réservé aux étages construits dans l'outil. Ça
   conditionne l'ampleur réelle du lot 4.
6. **Forme des grandes créatures en hexagone** (`sizeCells > 1`) : pas de convention
   établie. À trancher avant d'implémenter `HexGrid`.
7. **Jeu de marqueurs d'état** (§5.3) : liste et icônes à définir. Le champ `markers` est
   figé, son contenu non. À arbitrer après une séance réelle, pas avant.
8. **Gabarits manipulables par les joueurs ?** Le modèle l'autorise
   (`template.place` ouvert aux deux). Défaut à trancher — probablement MJ seul au début.
