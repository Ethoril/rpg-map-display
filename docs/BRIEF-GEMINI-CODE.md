# Brief Gemini — le code qui reste

> Écrit le 12 août 2026. **Tout ce qui manque en code**, dans l'ordre d'exécution. Les critères
> d'acceptation et les points d'arrêt sont fermes.

## Règles de travail, non négociables

- **Une tâche à la fois**, dans l'ordre de ce document. Ne pas anticiper la suivante.
- **Rapport de 3 lignes** en fin de tâche : ce qui a changé, comment c'est vérifié, ce qui reste.
- **Zéro commit.** Les modifications restent en arbre de travail pour relecture.
- **Arrêt obligatoire à chaque ⛔.** Ce sont des décisions qui ne t'appartiennent pas.
- **`pnpm run verify` doit passer** avant de rendre le rapport. Pas `test:unit` seul : un lot entier
  est déjà passé avec quatre tests navigateur rouges.
- **Preuve par mutation exigée** sur toute assertion qui porte un risque : casse volontairement le
  code, vérifie que le test rougit, révoque. Un test qui ne peut pas échouer ne prouve rien — ce
  dépôt a déjà attrapé 12 faux verts, dont un mock qui implémentait l'inverse du mécanisme testé.
- **Les 16 interdictions de `docs/CONVENTIONS.md` §8 s'appliquent en permanence.** Celles qui
  mordront ici sont citées tâche par tâche.

---

# G-01 — Réparer la sonde de décodage froid *(R2-03)*

**C'est le seul vrai défaut de tout ce qui reste, et il fait passer un faux vert pour une
validation.** À faire en premier pour cette raison.

## Le défaut

`mesurerDecodageFroid`, dans `js/app/diag.js`, fait deux fautes de mesure :

1. Il **refabrique une `Image` et fait `await image.decode()` juste avant** de démarrer le
   chronomètre. Le bitmap est donc chaud par construction, et les deux minutes d'inactivité que
   l'opérateur vient d'attendre sont annulées à la ligne d'avant.
2. Rien ne **vide le pipeline GPU** après le `drawImage`. Sur canvas accéléré, `performance.now()`
   encadre la mise en file d'une commande, pas sa peinture.

Résultat mesuré sur tablette le 11/08/2026 : **0,2 ms pour 12 Mpx** — soit 60 Gpx/s, impossible —
puis **1 146 ms sur la doublure 1024 px**, qui est le coût du premier tracé payé en retard. Les deux
chiffres décrivent le même travail, mal découpé.

⛔ **Le « OUI — critère R2-03 tenu » qu'imprime cette section est donc faux.** Le seuil de 5 ms
n'est pas mesuré.

## ⛔ La contrainte qui décide de la conception, et que j'ai tranchée pour toi

**On ne peut pas mesurer les deux grandeurs sur un même bitmap froid.** `ColdDecodeTrial.measure()`,
dans `js/app/endurance.js`, appelle lui-même `await image.decode()` pour produire `decodeMs` **et
consomme l'image**. Or un `drawImage` sur un bitmap froid décode implicitement : mesurer `decode()`
d'abord réchauffe le bitmap, et mesurer `drawImage` d'abord rend le `decode()` suivant sans intérêt.

**Décision : le `drawImage` gagne.** C'est lui la grandeur du critère R2-03 — le seuil de 5 ms porte
sur le coût payé dans une frame, et les 490 ms historiques du chantier N étaient un `drawImage`, pas
un `decode()`. `decodeMs` est donc **retiré de cette section**, pas conservé en trompe-l'œil.

## Ce qu'il faut faire

1. **Dans `js/app/endurance.js`** : ajouter à `ColdDecodeTrial` une méthode qui rend l'image armée
   **sans la décoder**, et qui consomme l'armement comme `measure()` le fait — une mesure reste à
   usage unique, sinon le second résultat est artificiellement chaud. Garder `measure()` intacte :
   d'autres tests s'appuient dessus (`tests/endurance.test.mjs`).
2. **Dans `js/app/diag.js`, `mesurerDecodageFroid`** : supprimer la fabrication d'une seconde `Image`
   et le `await image.decode()` qui la précède. Prendre l'image armée, non décodée.
3. Chronométrer : `t0` → `ctx.drawImage(image, …)` → `ctx.getImageData(0, 0, 1, 1)` → `t1`. Le
   `getImageData` force le vidage du pipeline ; sans lui on chronomètre une mise en file.
4. **Mesurer d'abord le coût de la relecture seule** — un `drawImage` d'un bitmap 1×1 suivi du même
   `getImageData` — et le retrancher. Le seuil est à 5 ms : quelques millisecondes de relecture
   changent le verdict.
5. Afficher le coût **brut**, le coût de la relecture, et le coût **net**. Le verdict porte sur le net.
6. Retirer la ligne `Image.decode()` de l'affichage, et écrire dans le texte de la page **pourquoi**
   elle a disparu : on ne peut pas mesurer les deux sur un bitmap qui ne refroidit qu'une fois.

## Critères d'acceptation

- Le verdict R2-03 se prononce sur le **coût net**, jamais sur le brut.
- Le texte affiché nomme explicitement le coût de la relecture retranché, en millisecondes.
- `tests/diagVideo.spec.mjs` et `tests/endurance.test.mjs` restent verts — `measure()` n'a pas changé.
- Un test unitaire vérifie que la nouvelle méthode **n'appelle pas `decode()`** : injecte une
  `imageFactory` dont le `decode` compte ses appels, comme le fait déjà `tests/endurance.test.mjs`.
- Un test vérifie que l'armement est **consommé** : deux appels d'affilée doivent échouer au second.
- Mutation : rétablir un `decode()` dans le nouveau chemin doit faire rougir le premier test ; retirer
  la soustraction de la relecture doit faire rougir un test sur le coût net.

## Interdictions qui mordent ici

- **N°14 : ne jamais cocher un critère de performance.** Tu répares l'instrument, tu ne déclares pas
  R2-03 tenu. C'est une mesure sur tablette, et elle appartient au mainteneur.
- **N°16 : ne jamais désactiver une vérification pour la faire passer.**

---

# G-02 — Trois écarts des gabarits

Petits, indépendants, dans `js/ui/gm/templateTools.js`. Relevés le 11/08/2026.

## G-02a — `onPlaceTemplate` est déclaré et jamais appelé

Le typedef `TemplateToolsOptions` annonce `onPlaceTemplate`, mais il n'est ni destructuré ni appelé.
Un appelant qui le passerait n'obtiendrait **rien, en silence**. La pose passe en réalité par
`js/app/gm.js`, qui lit `getConfig()`.

**À faire : supprimer la propriété du typedef.** Ne pas la câbler — le chemin par `gm.js` est le bon,
et ajouter un second chemin de pose créerait deux sources pour un même acte.

## G-02b — `currentTemplateId` vient de `Date.now()`

Deux armements dans la même milliseconde produiraient le même identifiant, et `placeTemplate`
recevrait deux gabarits de même `id`. Improbable au doigt, atteignable par un test rapide.

**À faire : suffixer par un compteur monotone** interne au composant. Pas de `crypto.randomUUID` :
l'identifiant doit rester lisible et stable pour la relecture, comme les autres identifiants du
dépôt.

## G-02c — ⛔ Le champ de rayon déclare `max="20"` mais le composant borne à 50

`<input id="tpl-radius" max="20">` contre `Math.min(50, …)` dans le gestionnaire. `max` n'empêche rien
hors validation de formulaire : **le maximum effectif est 50**.

⛔ **ARRÊT. Ne code rien sur ce point.** Laquelle des deux bornes est la bonne est un arbitrage de
jeu, pas de code — un gabarit de 50 cases de rayon a-t-il un sens à cette table ? Le test
`tests/templates.spec.mjs` fixe aujourd'hui le comportement réel (50) sans dire lequel est voulu.
Demande l'arbitrage, puis aligne les deux valeurs et le test.

## Critères d'acceptation (G-02a et G-02b)

- `pnpm run typecheck` vert : la suppression du typedef ne casse aucun appelant.
- Un test unitaire pose deux gabarits successifs et vérifie que leurs identifiants **diffèrent**.
- Mutation : rétablir `Date.now()` seul doit faire rougir ce test.

---

# G-03 — Mesure au geste *(dernier critère de confort du lot 4)*

⛔ **ARRÊT AVANT DE CODER. La conception doit être confirmée par le mainteneur.**

## Le critère

« Mesurer une distance sans quitter le Zero-UI » (CdC §11, lot 4). Le §5.5 précise le besoin : les
portées de tir, d'un point arbitraire à un autre — les cases atteignables répondent déjà à « est-ce
que j'y arrive ? », et le §5.5 note lui-même que **la priorité est abaissée**.

## La conception que je recommande, et le piège qu'elle évite

Le CdC prévoyait **appui long + glisser**, donc `js/input/pointer.js`. ⚠ C'est le fichier le plus
délicat du dépôt : l'appui long et le glisser s'y disputent déjà le doigt, et la marge mesurée à la
table le 11/08/2026 n'est que de **10,8 ms** entre le p95 d'un tap réel (139,2 ms) et `DRAG_HOLD_MS`
(150 ms). Un troisième geste dans cette zone est le mauvais endroit pour un critère déprécié.

**Le chantier X a montré une voie sans risque** : un **bouton armé hors onglets**, dans la barre de
séance du panneau MJ, à côté du ping. Armer « Mesurer », cliquer deux points, lire la distance, se
désarmer. Cela réutilise `setActiveTool` — donc l'exclusivité mutuelle et le désarmement au
changement d'onglet, déjà éprouvés — et **ne touche pas à `pointer.js`**. Le Zero-UI n'est pas violé :
le bouton vit dans le panneau, pas sur la carte.

## Si cette voie est retenue

- Nouvel outil `'measure'` dans l'union de `setActiveTool`, sur le modèle exact de `'ping'`
  (`CHANTIER-X-PING.md` §2).
- État transitoire **local à la vue**, jamais dans le store, jamais sur le réseau : la mesure est un
  geste du MJ pour lui-même. Modèle : `currentPing` dans `js/app/gm.js`.
- Couche de rendu dans `js/render/layers/`, déclarée au manifeste `docs/ARCHITECTURE.md` §1 **avant**
  d'écrire le fichier — interdiction n°12.
- La distance vient de **`grid.distance(a, b)`**. ⛔ Interdiction n°7 : ne jamais coder une distance
  en dur, ni Chebyshev, ni octile, ni euclidienne. C'est ce qui fera fonctionner la mesure en
  hexagone sans une ligne de plus.
- Grandeurs de rendu **en pixels écran divisées par le zoom**, comme `portals.js` et `pings.js`.

---

# G-04 — `HexGrid` *(les trois derniers critères)*

⛔ **ARRÊT AVANT DE COMMENCER. Voir la question d'architecture en fin de tâche : elle décide de la
faisabilité du troisième critère.**

⚠ **À savoir avant d'investir** : aucune carte hexagonale n'existe dans la bibliothèque du
mainteneur — les 1 774 images du corpus sont carrées. Ce travail est propre et bien préparé, mais sa
valeur d'usage est nulle jusqu'à ce qu'une carte hex existe. Le mainteneur en est informé ; s'il
lance cette tâche, c'est en connaissance de cause.

## Les trois critères

1. Un étage `grid.type: 'hex'` coexiste avec des étages carrés importés d'UVTT.
2. Le hit-test pixel→hexagone sélectionne la bonne case au doigt du premier coup.
3. Les cases atteignables en hexagone sont à coût uniforme 1 et respectent les murs.

## Ce qui est déjà prêt — n'invente rien de tout ça

- `js/core/types.js` porte `GridType = 'square'|'hex'`, `HexOrientation = 'flat'|'pointy'` et le champ
  `Level.hexOrientation`.
- Le contrat de `js/grid/GridAdapter.js` anticipe l'hexagone **à chaque méthode** : arrondi cubique,
  six voisines, distance uniforme.
- `Cell` est un **couple opaque** `{a, b}` : carré = (colonne, ligne), **hex = axial (q, r)**.
  ⛔ Interdiction n°2 du §2 de `CONVENTIONS.md` : ne jamais nommer `.q`/`.r` hors de `js/grid/`, et
  le troisième test d'architecture le vérifie à chaque `verify`.
- Le blocage tient en **une seule ligne** : `js/grid/index.js:18` lève `Grille hexagonale non
  supportée`. Il y a une couture, pas une refonte.

## La convention géométrique est mesurée, pas à choisir

Relevée sur deux corpus dans `docs/ANALYSE-DD2VTT-GRILLES.md` §4.3 :

- **pointe en haut** (`pointy`) ;
- largeur **plat-à-plat** = `pixels_per_grid` ;
- **pas de rangée = `pixels_per_grid` × √3/2** — 259,81 px pour 300.

⛔ Toute autre convention produira un hexagone techniquement correct et **toujours désaligné**.

## Les deux décisions de jeu sont prises — CdC §12 q.5 et q.6

- **Provenance** : image de fond calibrée à la main, ou étage vierge. L'import UVTT hexagonal est
  écarté — la géométrie de murs d'un export DD2VTT hex est en métrique **carrée**, donc la relire en
  hexagone déplacerait chaque mur. N'essaie pas.
- **Grandes créatures** : **rosette centrée**, `sizeCells` lu comme un rayon d'anneau — 1 couvre
  l'hexagone seul, 2 couvre l'hexagone et ses six voisines (7 cases), 3 ajoute la couronne suivante
  (19). C'est la seule forme dont le centre reste un centre d'hexagone, ce qui préserve la sélection,
  la destination, l'origine de vision et le hit-test.

## Méthodes à écrire, sur le modèle de `js/grid/SquareGrid.js`

`cellFromPoint`, `pointFromCell`, `mapFromCellPoint`, `cellPointFromMap`, `neighbors`, `distance`,
`edgesOf`, `cellsOccupied`, `cellsInRange`, `renderGrid`. Rien de plus, rien de moins : le contrat est
figé.

- `distance` : distance hexagonale, donc **uniforme**. En axial, `max(|dq|, |dr|, |dq+dr|)`.
- `neighbors` : les **six** voisines. ⛔ Interdiction n°6 : jamais 4 ni 8 en dur.
- `cellFromPoint` : **arrondi cubique**, pas un arrondi par rectangle — c'est la seule méthode qui
  donne la bonne case près des sommets, et c'est le critère 2 tout entier.
- `cellsInRange` : coût **uniforme 1** par pas, et respecte `blockedEdges`. Pas de diagonale à
  arbitrer, l'hexagone n'en a pas — ce qui rend cette méthode plus simple qu'en carré.

## ✅ Réponse d'architecture — établie le 12/08/2026 en lisant le code

### 1. La convention de clé d'arête tient telle quelle. Rien à changer.

`edgeKey(cellA, cellB)` dans `js/core/cellKey.js` est **purement dérivée du couple de cellules** :
les deux `cellKey` triées lexicographiquement et jointes par `|`. `cellKey` vaut `${cell.a},${cell.b}`,
sur le couple opaque. **Aucune géométrie carrée n'y intervient**, et six voisines lui vont aussi bien
que huit.

`edgesOf(cell)` de `SquareGrid` est `this.neighbors(cell).map((n) => [cell, n])` : elle délègue à
`neighbors`, donc elle se recopie à l'identique dans `HexGrid`.

### 2. ⛔ Mais `computeBlockedEdges` est carré, en trois endroits. C'est **lui** le blocage.

`js/import/blockedEdges.js` appelle `extractBlockedSegments(level)` **sans la grille** (ligne 267),
donc tout le calcul vit en **unités de case avec une sémantique carrée** :

| | Hypothèse carrée | Pourquoi elle tombe en hexagone |
|---|---|---|
| Centre de case | `centerA = { x: a + 0.5, y: b + 0.5 }` | le centre d'un hexagone axial (q, r) n'est pas (q+0,5 ; r+0,5) |
| Énumération du pavage | `for (a = 0..width) for (b = 0..height)` | en axial, les (q, r) valides d'une carte rectangulaire forment une région cisaillée, pas un rectangle |
| Indexation des seaux | `Math.floor(seg.A.x)` puis `row * width + col` | suppose que la case (col, row) couvre le carré unité — un hexagone ne pave pas des carrés unité |

⭐ **C'est une fuite de topologie hors de `js/grid/`**, de la même famille que l'interdiction n°5, et le
troisième test d'architecture ne l'attrape pas : il cherche les coordonnées **nommées**
(`.col`, `.row`, `.q`, `.r`), pas un `+ 0.5`.

### 3. Ce qu'il faut faire, et c'est plus large que `cellsInRange`

**Passer le calcul en espace pixels-carte**, où tout est déjà topologie-agnostique :

- centres par **`grid.pointFromCell(cell)`** — au contrat, rend un `MapPoint` ;
- sommets de murs par **`grid.mapFromCellPoint(vertex)`** — au contrat aussi ;
- seaux : un index spatial en pixels-carte, au pas de la grille, valable pour tout pavage.

⛔ **Et il manque une méthode au contrat** : rien ne sait énumérer les cases d'un étage, parce que
`0..width × 0..height` en tenait lieu. C'est une **extension de `GridAdapter`**, donc mon arbitrage :
ajoute `allCells()` au contrat, implémentée dans `SquareGrid` (le double `for` actuel) et dans
`HexGrid` (la région axiale correspondante). Déclare-la dans `js/grid/GridAdapter.js` **avant** de
l'utiliser.

### 4. Ordre imposé pour cette tâche

1. `allCells()` au contrat + `SquareGrid`, et `computeBlockedEdges` réécrit en pixels-carte.
   ⛔ **À iso-comportement sur le carré** : les tests de L-01 (`tests/blockedEdges.test.mjs`,
   `tests/reachable.test.mjs`) doivent rester verts **sans être modifiés**. C'est la seule garantie
   que le passage en pixels n'a rien déplacé. Rapport, puis arrêt.
2. Ensuite seulement `HexGrid`, `allCells()` comprise.
3. `cellsInRange` hexagonale en dernier.

**Pourquoi cet ordre** : l'étape 1 est un refactoring à comportement constant sur du code éprouvé et
elle est vérifiable par les tests existants. La mêler à l'écriture de `HexGrid` rendrait impossible de
savoir laquelle des deux a cassé quoi. Le critère 1 de L-01 notait déjà que « l'accrochage à la grille
échoue sur DA » : la géométrie des murs est la partie de ce projet qui a produit les défauts les plus
coûteux, et un `cellsInRange` hexagonal bâti sur des centres faux serait **invisible en test
synthétique et faux à la table**.

## Critères d'acceptation

- `pnpm run verify` vert, **les huit règles d'architecture comprises** — dont l'interdiction des
  coordonnées nommées hors `js/grid/` et le manifeste `ARCHITECTURE.md`.
- Un étage hex et un étage carré coexistent dans **la même campagne**, et la bascule entre eux ne
  casse ni le fog ni les pions. Modèle de test : `tests/heterogeneousLevels.spec.mjs`, qui couvre
  déjà cette classe de défaut pour des dimensions hétérogènes.
- Le hit-test est vérifié **près des sommets**, pas seulement au centre des hexagones : c'est là que
  l'arrondi par rectangle échoue, et c'est tout l'objet du critère 2.
- `cellsInRange` est vérifié avec un mur, et le résultat compare à un ensemble de cases écrit à la
  main dans le test — pas calculé par la même fonction.
- Mutation exigée sur les trois : remplacer l'arrondi cubique par un arrondi de rectangle, mettre
  `neighbors` à quatre voisines, ignorer `blockedEdges` — chacune doit faire rougir un test précis.
