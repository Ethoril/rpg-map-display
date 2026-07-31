# TRANCHE L-01 — arêtes bloquées réelles + cache par étage

> Première tranche du **Lot 2 du CdC §11**. Découpage d'ensemble : `PLAN-LOT2.md`.
> Ferme le **critère 8** du lot 2 : « un pion joueur ne traverse pas un mur ».
>
> ⚠ **Ne pas confondre « tranche L-01 » et « chantier L »** (l'outil local de préparation des
> cartes, `CHANTIER-L-OUTIL-CARTES.md`). Les deux emploient la lettre L pour des choses sans
> rapport — collision de nommage introduite le 31/07. Les tranches du lot 2 s'écrivent
> **L-01 à L-10**, les chantiers portent une lettre seule.

---

## 1. Ce qui existe déjà, et ce qui manque

Le consommateur est **écrit et testé** ; seul le producteur manque.

| Élément | État |
|---|---|
| `js/movement/reachable.js` | honore un `Set<edgeKey>`, avec anti-corner-cutting. Deux tests unitaires le couvrent |
| `js/import/blockedEdges.js` | **stub** : `return new Set()` |
| `js/core/cellKey.js` | `edgeKey(a, b)` commutatif, testé sur 20 paires |
| Géométrie | 131 murs + 40 portes sur `manoir-rdc`, 1338 + 141 sur la carte de test |

La table d'import du manifeste autorise déjà `state/* → import/*`, ajout fait à T-13
précisément pour que le store atteigne `computeBlockedEdges`. Rien à amender.

---

## 2. LA découverte qui conditionne tout : ne pas accrocher les murs à la grille

L'approche intuitive — « un mur posé sur une ligne de grille bloque l'arête correspondante » —
**ne marche que sur les exports à coordonnées entières**. Mesuré sur les deux cartes réelles :

| | `manoir-rdc` | carte de test (Dungeon Alchemist) |
|---|---|---|
| Segments | 131 | 1338 |
| Obliques (ni verticaux ni horizontaux) | **0** | **233** (17,5 %) |
| Écart médian à la ligne de grille | **0,000000** | **0,070** |
| Écart p95 / max | 0 / 0 | **0,330 / 0,4999** |
| Segments retenus par une comparaison exacte | 131/131 (100 %) | **6/1105 (0,5 %)** |

**Une implantation par accrochage trouverait donc six arêtes sur onze cent cinq**, et le
mainteneur verrait ses joueurs traverser tous les murs de ses propres cartes. Le plan du lot 2
a été écrit en regardant `manoir-rdc`, dont la géométrie est exceptionnellement propre.

Rappel de l'exigence du 31/07 : l'outil doit fonctionner avec **n'importe quel** UVTT, quelle
que soit sa source. Aucune tolérance d'accrochage ne satisfait ça — à 0,2 on capture 88 % des
segments alignés et **zéro** oblique, tout en déclarant bloquée une arête située jusqu'à 0,2
case du mur réel.

### L'algorithme prescrit : test de croisement centre-à-centre

> Une arête `(A, B)` est bloquée **si un segment de mur croise le segment reliant le centre de
> A au centre de B.**

C'est géométriquement ce que « bloquer le passage » veut dire, et ça résout d'un coup les
trois problèmes de l'accrochage : les obliques sont traitées comme les autres, aucune
tolérance n'est à régler, et les segments longs n'ont pas à être découpés.

**Prototype vérifié avant d'écrire ce brief** — ne pas repartir de zéro sur l'approche :

| | arêtes bloquées | temps |
|---|---|---|
| `manoir-rdc` | 1345 sur ~8640 (15,6 %) | 10,2 ms |
| carte de test | 2532 sur ~18460 (13,7 %) | 14,5 ms |

Convention de coordonnées à respecter (`SquareGrid`) : la case `{a, b}` couvre
`cellX ∈ [a, a+1]`, son centre est à `(a + 0,5, b + 0,5)`.

---

## 3. Contrat exact avec le consommateur

`reachable.js` interroge `grid.neighbors()`, soit **les 8 voisins** — diagonales comprises.
Le producteur doit donc peupler les arêtes orthogonales **et** diagonales.

Les deux mécanismes se composent, ils ne se remplacent pas :

- une arête diagonale directement traversée par un mur oblique doit être dans le masque ;
- l'anti-corner-cutting déjà présent bloque en plus toute diagonale dont l'une des quatre
  orthogonales adjacentes est bloquée. Ne rien y toucher.

Les clés viennent **exclusivement** de `edgeKey()` de `js/core/cellKey.js`. Ne pas fabriquer
de clé à la main : elle est commutative par contrat, et deux conventions concurrentes
produiraient un masque à moitié lu.

---

## 4. Les portes

Le masque se calcule sur les murs **plus les portes qui bloquent**. Une porte ouverte ne
bloque rien : dans les exports, l'ouverture est un trou dans la polyligne de mur, et le
segment du portail vient le remplir.

État réel des deux cartes, les deux cas existent : `manoir-rdc` a ses **40 portes fermées**,
la carte de test seulement **58 sur 141**.

**Écrire la condition de façon à survivre à L-05.** Aujourd'hui `Portal.closed` est un
booléen ; L-05 le remplacera par `state: 'open' | 'closed' | 'locked'`, et la décision §2.4 du
plan dit que `closed` et `locked` sont **indiscernables** pour ce calcul. La condition doit
donc s'exprimer « la porte n'est pas ouverte », en un seul endroit isolé, et non par un
`if (portal.closed === true)` dispersé.

Curiosité relevée dans les données, à ne pas traiter comme un bug : un « portail » de la carte
de test mesure **9 cases**. C'est une arche, pas une porte. Le test de croisement s'en
accommode sans cas particulier.

---

## 5. Le cache par étage

> **Amendé à la livraison, le 31 juillet 2026.** Ce brief demandait le cache dans
> `js/state/store.js`. Il a été livré dans `js/import/blockedEdges.js`, indexé sur
> `levelId` **+ une empreinte géométrique de l'étage**, et **cette déviation est retenue** :
> l'empreinte fait que le cache s'auto-invalide à tout changement de mur ou d'état de porte,
> ce qui est plus solide que l'invalidation manuelle au `portal.toggle` prescrite ici. C'est
> la leçon de l'empreinte de pipeline du chantier L, appliquée au bon endroit.
>
> **`import/*` reste « de la logique pure » au sens du manifeste** — aucune I/O, aucun DOM.
> Une mémoïsation déterministe indexée sur le contenu ne contredit pas ce contrat : ne pas
> la prendre pour une violation. Mesuré à la livraison : gain ×117 sur `manoir-rdc`, ×24 sur
> la carte de test, pour un coût d'empreinte de 0,16 à 1,08 ms.

Il vit dans le store (`js/state/store.js`), une entrée par `levelId`.

**Correction au plan, à connaître.** `PLAN-LOT2.md` §4 justifie le cache en affirmant que
l'appel par tap « devient intenable sur 500 segments ». **C'est faux, et mesuré** : 1338
segments coûtent 14,5 ms. Le cache reste justifié, mais par d'autres raisons — la tablette est
plus lente d'un facteur 3 à 5, et le critère 7 du lot 2 exigera de recalculer le sweep **sur
chaque case du chemin**, ce qui multipliera les appels. Ne pas répéter l'argument faux dans le
code : un commentaire qui affirme une mesure inexistante est une dette.

Invalidation : à la charge de `portal.toggle`, limitée aux arêtes voisines du portail (CdC
ligne 381). Un étage dont la géométrie n'a pas changé ne recalcule rien.

---

## 6. Le MJ continue de traverser les murs — et ce n'est PAS une régression

**Décision du mainteneur, 30 juillet 2026.** À lire avant de « corriger » quoi que ce soit.

Implémenter `computeBlockedEdges` ne suffira **pas** à empêcher un pion MJ de traverser un
mur, et c'est voulu. Le glisser MJ (`js/app/gm.js`, autour des lignes 344-351) ne consulte pas
`state.reachableCells`, n'appelle pas `findPath`, et publie un chemin en ligne droite
`[from, targetCell]`. Seul le côté joueur passe par la zone atteignable et par `findPath`
(`js/ui/player/bootstrap.js:108-125`).

Poser une figurine où l'on veut est un geste de table légitime. Quand les 131 murs bloqueront
enfin les joueurs, le MJ continuera de les franchir. **Ne pas « réparer » ce contournement, ne
pas chercher pourquoi le masque « ne marche pas » côté MJ.**

---

## 7. Limite connue, à documenter et non à corriger

Un mur dont l'écart à la ligne de grille approche **0,5** court au milieu d'une case : il ne
sépare aucune paire de cases voisines, et **aucun masque d'arêtes ne peut le représenter**.
C'est une limite du modèle, pas un défaut d'implantation. Mesuré : l'écart maximum observé est
0,4999, mais le p95 est à 0,330 — le cas est rare.

Décision à prendre et à écrire dans le code : un contact exact entre le mur et le segment
centre-à-centre **bloque** (choix du prototype). C'est le choix prudent — un mur qu'on ne
traverse pas — mais il sur-bloque légèrement sur ce cas limite. L'alternative silencieuse
serait de laisser passer, ce qui est pire en séance.

---

## 8. Critères d'acceptation

1. `computeBlockedEdges(level, grid)` rend un masque non vide sur les deux cartes réelles,
   avec des ordres de grandeur cohérents avec le prototype (§2).
2. Une carte à coordonnées entières (`manoir-rdc`) et une carte à coordonnées fractionnaires
   (Dungeon Alchemist) sont **toutes deux** couvertes par un test. Un test qui ne porterait
   que sur la première laisserait passer exactement le défaut que ce brief existe pour éviter.
3. Un mur oblique bloque au moins une arête — sinon les 233 obliques de la carte de test sont
   perdus en silence.
4. Une porte **ouverte** ne bloque pas ; la même porte **fermée** bloque. Vérifié sur la même
   fixture, en ne changeant que l'état de la porte.
5. Le cache rend le même masque qu'un calcul direct, et un second appel sans changement ne
   recalcule pas.
6. Les deux tests existants de `reachable.js` restent verts sans modification : le contrat du
   consommateur ne change pas.
7. `pnpm run verify` vert. Suite unitaire toujours sous 10 s.

## 9. Ne pas faire

- **Ne pas** accrocher les murs à la grille par tolérance (§2).
- **Ne pas** toucher à `reachable.js` ni à l'anti-corner-cutting : ils sont corrects et testés.
- **Ne pas** fabriquer de clé d'arête à la main, `edgeKey()` seul fait foi.
- **Ne pas** faire du calcul de vision, de fog, ni d'éditeur de murs : ce sont L-02 à L-07.
- **Ne pas** faire passer le glisser MJ par `findPath` (§6).
- **Ne pas** ajouter de fichier hors manifeste. `blockedEdges.js` existe déjà.
- **Ne pas** utiliser les fixtures de `fixtures/real/` dans un test unitaire : elles pèsent
  jusqu'à 9 Mo et la suite tient aujourd'hui en quelques secondes. Fabriquer une fixture
  synthétique portant les cas à couvrir.

## 10. Attendu en fin de tâche

Un rapport de **3 lignes**, puis **arrêt**. Aucun commit : les modifications restent en arbre
de travail pour relecture.
