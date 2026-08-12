# Brief Gemini — reprise après audit du 12 août 2026

> Le travail livré est **en arbre, non commité**. `verify` est vert, les 14 tests de L-01 sont intacts.
> Cinq corrections, dans cet ordre. **Une tâche à la fois, rapport de 3 lignes, arrêt à chaque ⛔.**

## Ce qui est validé et ne doit pas être retouché

- **G-02c** — rayon borné à 20 partout, commentaire remplacé par la décision. ✅
- **G-03** — `MeasureLayer` et son scénario. ✅ La distance assertée à 3,5 là où le vol d'oiseau vaut
  3,16 est exactement la bonne façon de prouver que `grid.distance` est employée. Et l'absence de
  publication réseau est vérifiée.
- **L'extension du contrat** — `allCells` documentée dans `GridAdapter.js` et implémentée. ✅
- **La réécriture de `computeBlockedEdges` est JUSTE** : 2701 arêtes, identiques à l'ancienne version,
  et `pointFromCell` / `mapFromCellPoint` sont bien les bons outils. ✅
  ⚠ **Portée exacte de cette validation, corrigée le 12 août au soir** : elle porte sur la version
  **sans index**, et sur `testbig150`, qui est une carte **carrée**. Elle ne dit rien de l'index de
  seaux écrit ensuite pour R-01, ni d'aucun pavage hexagonal. Voir R-06.
- **L'arrondi cubique de `HexGrid.cellFromPoint` est exact** : 0 erreur sur 16 969 points balayés. ✅
  ⚠ Cette validation porte sur `cellFromPoint` **seule**. `neighbors`, `distance` et `cellsOccupied`
  n'ont pas été audités, et les deux critères de R-02 ne les touchent pas. Voir R-07.

---

# R-01 ⛔ Restaurer l'index spatial de `computeBlockedEdges`

**Régression mesurée, pas supposée** : sur `testbig150` (65 × 71, 1338 murs), le calcul passe de
**25,3 ms à 334,3 ms — 13×** — pour un résultat identique.

Le brief demandait « un index spatial **en pixels-carte**, au pas de la grille, valable pour tout
pavage ». Il a été supprimé au lieu d'être porté. La nouvelle boucle teste **tous** les segments pour
chaque arête.

⚠ **Ce n'est pas un coût de chargement seul.** L'éditeur de murs de L-07 recalcule à chaque trait, et
`tests/wallEditor.spec.mjs` scénario 2 vérifie que la zone de déplacement se restreint
**immédiatement**. 334 ms par trait sur la grande carte est un gel visible pendant l'édition.

**À faire** : indexer les segments dans des seaux **en pixels-carte**, au pas `pxPerCell`, par la boîte
englobante de chaque segment. Pour une arête (cellA, cellB), ne tester que les segments des seaux
touchés par le segment centre-à-centre. Aucune arithmétique de case : uniquement des pixels et
`Math.floor(x / pxPerCell)`, ce qui vaut pour tout pavage.

**Critère d'acceptation, chiffré** : `computeBlockedEdges` sur `testbig150` doit revenir **sous 40 ms**
et rendre **exactement 2701 arêtes**. Mesure-le et donne le chiffre dans ton rapport. Les 14 tests de
L-01 restent verts **sans modification**.

---

# R-02 ⛔ `HexGrid` passe en coordonnées décalées `odd-r`

**Ce n'est pas ta faute** : `js/core/types.js` prescrivait « Hexagone : axial (q, r) » et tu l'as suivi
fidèlement. **C'est ma documentation qui était fausse, et je l'ai corrigée** — relis le typedef `Cell`,
il porte maintenant la décision et son motif.

**Le défaut mesuré sur l'implémentation actuelle** : le décalage d'une demi-case par rangée
**s'accumule**. Sur un étage de 12 × 12, la case (0, 11) est à 6 cases vers la droite, **5 cases
débordent hors de l'image**, et un tiers de la hauteur reste vide. Sur 65 × 71 : **34,5 cases hors
image, 153 % de la largeur**. La grille est un parallélogramme, pas un rectangle.

**À faire** : `Cell.a` = colonne, `Cell.b` = rangée, en **`odd-r`** — les rangées impaires décalées
d'une demi-case, **sans accumulation**.

- `pointFromCell` : `x = offsetX + px * (a + 0.5 * (b & 1) + 0.5)`, `y` inchangé.
- `cellFromPoint` : garde **l'arrondi cubique**, qui est exact — convertis simplement décalé ⇄ cubique
  autour de lui. ⛔ Ne le réécris pas.
- `neighbors`, `distance` : passe en cubique, calcule, reviens en décalé. L'axial ne franchit jamais le
  contrat.
- `allCells` : redevient le rectangle `0..width × 0..height`, ce qui est alors **juste**.

**Critère d'acceptation, chiffré** : pour un étage de 12 × 12 à 140 px, **aucune case ne doit dépasser
`widthCells × pxPerCell`** en x, ni `heightCells × pxPerCell` en y. Écris ce test. Et un aller-retour
`cellFromPoint(pointFromCell(c)) === c` sur **toutes** les cases d'un 12 × 12.

---

# R-03 ⛔ Le test du critère 2 est un faux vert — à réécrire

J'ai retiré la correction cubique de `cellFromPoint` : **17,2 % des points tombent alors sur la
mauvaise case** — une sur six — et **les trois tests de `hexGrid.test.mjs` passent quand même**.

La cause est l'assertion : `distToHit <= distToCenter` compare la case trouvée à la **seule** case
(1,1). Elle est donc satisfaite trivialement dès que la fonction rend (1,1). Elle ne vérifie pas que
l'arrondi choisit la plus proche **de toutes**.

**À faire** : balayer une grille de points et vérifier, pour chacun, que la case rendue est celle dont
le centre est le plus proche **parmi toutes les cases de l'étage**. C'est ce que j'ai fait à la main
pour l'auditer, et ça tient en une dizaine de lignes.

**Critère d'acceptation** : mutation obligatoire. Retire la correction cubique — le bloc
`if (q_diff > r_diff …)` — et **le test doit rougir**. Donne le nombre de points mal attribués dans
ton rapport. Le critère 3, lui, attrape déjà sa mutation : ne le touche pas.

---

# R-04 Deux points mineurs

**a) `grid.allCells ? grid.allCells(…) : []` doit lever.** Le contrat garantit la méthode ; si elle
manque, c'est une erreur de programmation. Rendre `[]` fait rendre **zéro arête bloquée**, donc **les
murs cessent de bloquer, en silence**. Remplace par un `throw` explicite.

**b) Restaure le commentaire supprimé de `tests/heterogeneousLevels.spec.mjs`** — celui qui expliquait
pourquoi les tailles sont réduites : `fitActiveLevel` impose le zoom à chaque frame, une case de
45 × 80 tombe à 10,2 px écran, et le liseré d'un pion n'y couvre plus aucun pixel. Sans ce
commentaire, quelqu'un remettra 45 × 80 et redécouvrira un défaut fantôme — ça m'a coûté trois sondes
fausses. ⭐ L'ajout de l'étage hex à ce test, en revanche, est bien vu : garde-le.

---

# R-05 G-01 — la sonde de décodage froid ✅ **elle était livrée ; mon reproche était faux**

⛔ **Correction du 12 août au soir, après vérification du dépôt.** J'ai écrit « elle n'a pas été
livrée ». **C'est faux, et l'erreur est la mienne** : le correctif était en place depuis le commit
`a429491` — image armée non décodée via `takeArmedImage()`, `getImageData(0,0,1,1)` pour vider le
pipeline, coût de relecture mesuré à part et retranché, verdict sur le net, `Image.decode()` retiré
de l'affichage avec sa raison écrite sur la page. Les tests étaient là aussi
(`tests/endurance.test.mjs`, `tests/diag.spec.mjs`).

**Pourquoi je ne l'ai pas vu** : le code a été livré dans un commit intitulé `docs(brief Gemini):
reponse d'architecture sur G-04` — un message qui annonce de la documentation et transporte
`js/app/diag.js`, `js/app/endurance.js` et deux fichiers de test. ⚠ **Leçon de forme, pour les deux
côtés** : un message de commit qui cache son contenu m'a fait réclamer deux fois un travail déjà
fait, et aurait pu faire refaire par-dessus.

**Ce qui manquait réellement, et que j'ai complété moi-même :**

- Le dernier critère de mutation de G-01 — « retirer la soustraction de la relecture doit faire
  rougir un test sur le coût net » — n'était pas tenu : aucun test ne regardait la **valeur**, seuls
  les libellés étaient assertés, et `net = brut` restait vert. L'arithmétique **et la phrase de
  verdict** vivent maintenant dans `resumeDecodageFroid()` (`js/app/endurance.js`), pure et éprouvée
  sur le cas 6,4 / 2,1 ms où la soustraction **fait basculer le verdict**. La phrase devait sortir de
  la page elle aussi : composée dans `diag.js`, la faire porter sur le brut ne faisait rougir aucun
  test, les durées d'un Chromium sans charge étant trop petites pour que les deux verdicts diffèrent.
- Le texte d'**armement** promettait encore « le second `Image.decode()` réellement payé », en
  contradiction avec ce que la sonde mesure désormais.
- Les documents d'opération demandaient toujours de reporter une durée que la page n'imprime plus :
  `PROTOCOLE-ENDURANCE.md`, `SEANCE-TABLETTE.md`, `RAPPORT-ENDURANCE.md`.

⚠ **R2-03 n'est pas coché pour autant.** L'instrument est réparé ; le relevé sur la tablette reste à
faire et il appartient au mainteneur — interdiction n°14.

---

## Note de discipline

Le point d'arrêt de G-04 était **après** la réécriture de `computeBlockedEdges`, avant `HexGrid`. Il a
été franchi, et les deux régressions — l'index spatial et le cisaillement — sont arrivées ensemble.
C'est précisément ce que l'arrêt devait éviter : chacune se diagnostique en dix minutes, mêlées elles
en ont coûté beaucoup plus. **R-01 et R-02 sont deux rapports séparés.**

---
---

# Seconde passe — audit de R-03, 12 août 2026 au soir

> **R-03 est acceptée.** Le critère 2 balaie 16 287 points et compare chacun à la plus proche des 100
> cases de l'étage. La mutation exigée — retrait du bloc `if (q_diff > r_diff …)` — fait rougir :
> **2 500 points mal attribués, 15,3 %**. Quatre mutations supplémentaires sont attrapées (conversion
> odd-r inversée, décalage retiré de `pointFromCell`, `Math.round` → `Math.floor`, bornes rétrécies).
> Le critère 3 est intact et attrape toujours les siennes. `verify` est vert sur arbre propre :
> typecheck, `check-deps`, 428 unitaires, 174 e2e, 3 gestes.
>
> Deux défauts trouvés en cherchant le sens non couvert. **Ils ne viennent pas de R-03** : R-06 est du
> code postérieur à ma validation, R-07 est un trou dans mes propres critères. **Deux rapports
> séparés, arrêt après R-06.**

---

# R-06 ⛔ L'index de `computeBlockedEdges` est faux en hexagonal

**Régression mesurée, pas supposée.** Étage hex 20 × 20, 140 px/case, 120 segments de mur : l'index
rend **286 arêtes bloquées là où la force brute en rend 302 — 16 perdues, 5,3 %**. Le même étage en
carré : **0 perte**. Aucune arête en trop : l'index élague de **vraies** intersections.

**Conséquence** : sur un étage hexagonal, **les murs cessent de bloquer, en silence**. Et `verify`
reste vert — le critère 3 de `hexGrid.test.mjs` passe parce que son unique mur est en rangée 1.

**Cas isolé, à reproduire en premier** : le mur qui coupe l'arête centre-à-centre (1,3)–(2,2) est rangé
dans le seau **(col 1, rangée 2)**. L'arête, elle, ne consulte que les seaux de ses deux cases
d'extrémité : (1,3) et (2,2). Ni l'un ni l'autre n'est (1,2). Le mur n'est jamais testé.

**La cause est structurelle, et ce n'est pas l'indexation** : ranger un segment par la boîte englobante
de ses `cellPointFromMap` est correct. C'est **l'interrogation par identité de case** qui est fausse.
Elle suppose que le seau `(floor(cellX), floor(cellY))` **est** l'hexagone `(a, b)` — vrai en carré,
faux en odd-r, où les bandeaux de `cellPointFromMap` ne pavent pas les hexagones : un point à
l'intérieur de l'hexagone (a, b) tombe dans le bandeau (a′, b′).

**À faire** : interroger les seaux par la **boîte englobante du segment centre-à-centre**, dans le même
lattice que l'indexation, au lieu des deux `cellIdx` d'extrémité. Deux segments qui se croisent ont
nécessairement des boîtes englobantes qui se recouvrent, donc **au moins un seau commun** : c'est
conservateur pour tout pavage, et sans aucune mention de `pxPerCell`.

Concrètement, dans la boucle 2 de `blockedEdges.js` : remplacer `buckets.get(cellIdx)` /
`buckets.get(nCellIdx)` par un parcours `col`/`row` sur la boîte de `(centerA, centerB)` passée par
`grid.cellPointFromMap`, avec le même `Math.max(0, …)` / `Math.min(width - 1, …)` que l'indexation.
Le tampon `seenStamp` reste utile : un segment présent dans plusieurs seaux ne doit être testé qu'une
fois par arête.

**Critères d'acceptation** — deux, tous deux des jugements reproductibles, aucun chronomètre :

1. **Écris le test qui manquait** : sur un étage hex **et** sur un étage carré de 20 × 20 avec au moins
   100 segments de mur, `computeBlockedEdges` doit rendre **exactement** le même ensemble d'arêtes
   qu'une force brute qui teste tous les segments contre toutes les arêtes. **0 manquée, 0 en trop**,
   sur les deux pavages. Le jeu de murs doit être **déterministe** — générateur à graine, pas de
   `Math.random`.
2. `computeBlockedEdges` rend toujours **exactement 2701 arêtes** sur `testbig150`.

**Mutation obligatoire** : remets l'interrogation par identité de case. Le nouveau test **doit rougir
sur le cas hex et rester vert sur le cas carré** — c'est la signature du défaut. Donne les deux
chiffres dans ton rapport.

⚠ **Le gain de R-01 ne doit pas être rendu.** Mesuré sur mon prototype du correctif : 2,7 % des tests
segment/arête de la force brute en hex, 1,6 % en carré. Si ton chiffre de perf sur `testbig150`
s'éloigne de l'ordre de 21 ms mesuré isolément, dis-le au lieu de le taire.

---

# R-07 ⚠ La conversion odd-r de `neighbors` n'est couverte par rien

**C'est un trou dans mes critères de R-02, pas une faute de ta part** : j'ai demandé la conversion
cubique dans `neighbors` et je n'ai écrit aucun critère pour elle. L'implémentation livrée est juste.

**Le trou, mesuré** : retirer `- (cell.b >> 1)` dans `HexGrid.neighbors` laisse **428 tests sur 428 au
vert**. La mutation est un no-op en rangées 0 et 1 **seulement** ; dès la rangée 2 le voisinage est
entièrement faux — voisines de (5,4) : `(6,3) (6,4) (6,5) (7,3) (7,5) (8,4)` au lieu de
`(4,3) (4,4) (4,5) (5,3) (5,5) (6,4)`. Le critère 3 part de (1,1), la seule rangée où c'est invisible.

**À faire** : déplacer le départ du critère 3 de `hexGrid.test.mjs` en **rangée ≥ 2** (agrandir l'étage
et déplacer le mur en conséquence), ou ajouter un critère dédié qui asserte les 6 voisines d'une case
de rangée paire **et** d'une case de rangée impaire, écrites à la main.

**Critère d'acceptation** : mutation obligatoire. Retire `- (cell.b >> 1)` de `neighbors` — le test
**doit rougir**. Même exigence pour `distance` : elle est déjà attrapée, vérifie-le et dis-le.

---

# R-08 Point mineur — une durée n'a pas sa place dans la porte

`tests/blockedEdges.test.mjs` asserte `duration < 60` alors que son titre annonce 40 ms. C'est une
**mesure**, pas un jugement reproductible : elle a rougi pendant l'audit, sous simple charge
concurrente, sur du code juste.

**À faire** : garder l'assertion de **compte** (2701 arêtes) dans `verify`, et déplacer l'assertion de
durée dans `tests/mesures/`, où vivent déjà les mesures. Aligner le titre sur ce qui est réellement
asserté.

---
---

# Clôture — 12 août 2026 au soir

> **Plus d'aller-retour.** Le mainteneur a quitté la machine ; R-06 a été audité et les points
> restants traités directement. Cette section est le procès-verbal.

## R-06 — accepté, avec deux corrections

L'approche livrée est **la bonne** et le test d'équivalence livré est **solide** : égalité stricte
d'ensembles contre une force brute indépendante, murs déterministes à graine, sur carré et hex.
Vérifié moi-même par un balayage de **144 cas** (6 formes × 12 graines × 2 pavages) : 0 écart.

Deux défauts trouvés en cherchant le sens non couvert, tous deux corrigés :

1. ⛔ **La clé de déduplication d'arête mélangeait `cellIdx` et `cIdx`**, l'index de boucle sur
   `allCells`. Conséquences mesurées sur un balayage de 3 042 formes : **98,8 % des arêtes testées
   deux fois** — la déduplication ne prenait plus du tout, ce qui mangeait une bonne part du gain de
   R-01 — et **une arête perdue en silence** sur un hex 4 × 2, l'arête (2,0)|(3,0). La constante
   magique `100000` est remplacée par `width * height`, qui rend la clé injective quelle que soit la
   taille de l'étage. Après correction, `testbig150` tombe de ~25 ms à **~13 ms en node, 9,6 ms en
   navigateur**.
2. ⚠ **La justesse en hexagonal ne tenait qu'à un `- 1e-9`.** La colonne rendue par
   `cellPointFromMap` dépend de la **parité de la rangée** : `cellX` saute d'une demi-case au
   franchissement d'une rangée, donc un point *intérieur* au segment centre-à-centre peut tomber une
   colonne en dessous de celles de ses deux extrémités. La boîte englobante ne couvrait ce cas que
   parce que la tolérance numérique élargissait d'une colonne **par accident** — retirer l'epsilon
   faisait passer l'hex de 866 à **862 arêtes**. L'élargissement est désormais explicite (`- 1`),
   commenté, et gardé par le test. Le côté haut, lui, n'en a pas besoin : le saut de parité retire
   une demi-case, il n'en ajoute jamais.

Le test R-06 couvre maintenant **six formes**, dont `hex 4 × 2` et deux non carrées — les 20 × 20
confondent index de boucle et index de case à la diagonale près, et n'auraient jamais vu le défaut n°1.

## Les points restants, traités

| Point | État | Preuve |
|---|---|---|
| R-04 a) `allCells` lève | ✅ était fait, **n'était pas gardé** | Test ajouté : remplacer le `throw` par un retour vide fait rougir |
| R-04 b) commentaire restauré | ✅ fait | Le motif des tailles réduites est rétabli, avec le ⛔ « ne pas remettre 45 × 80 » |
| R-05 / G-01 | ✅ était livrée, complétée | Voir la section R-05 corrigée ci-dessus |
| R-06 | ✅ accepté + 2 corrections | Ci-dessus |
| R-07 `neighbors` en odd-r | ✅ fait | `neighbors`, `distance`, `cellsOccupied` et `cellsInRange` assertés en rangées ≥ 2, voisinages **déduits du pavage** et non relevés sur le code. Les quatre mutations de conversion rougissent |
| R-08 durée hors de la porte | ✅ fait | La porte n'asserte plus que le compte ; `tests/mesures/blockedEdgesIndex.spec.mjs` imprime index contre force brute — **×40 mesuré en navigateur**, 2701 arêtes des deux côtés |

## Contre-audit — ce que deux revues adversariales ont trouvé en plus

Le travail ci-dessus a ensuite été **attaqué** par deux relectures indépendantes, avec pour consigne
de le supposer faux. Elles ont sorti un bug de plus et huit tests trop faibles. Tout est corrigé, et
chaque correction est prouvée par la mutation correspondante.

### ⛔ Un troisième défaut de l'index, du côté **indexation** cette fois

Un mur dont les **deux extrémités** ont `cellX < 0` — un mur longeant le bord gauche, ce que produit
couramment un UVTT importé — donnait `minCol = max(0, -1) = 0` et `maxCol = min(w-1, -1) = -1`, soit
une plage **vide** : le mur n'était rangé dans aucun seau et cessait de bloquer, en silence. Mesuré
sur un hex 10 × 8 à 102,4 px/case : **0 arête bloquée au lieu de 11**. Invisible en carré.

La cause est le miroir de celle de R-06 : le saut de parité déplace la colonne d'un point intérieur
d'une demi-case **dans les deux sens**, et si l'arête centre-à-centre n'en subit qu'un (ses extrémités
sont des centres, donc des `cellX` entiers), **un mur a des extrémités quelconques**. L'indexation est
donc élargie d'une colonne des deux côtés, et le commentaire porte maintenant la **démonstration** de
couverture plutôt qu'un argument d'intuition.

⚠ Le test R-06 était aveugle à cette classe **par construction** : il tirait ses murs dans
`[0, w] × [0, h]`, donc jamais de coordonnée négative. Le générateur déborde désormais d'une case et
demie de chaque côté, deux murs de bord sont posés à la main, et le corpus passe à **neuf formes**
incluant une densité fractionnaire (102,4 px) et des décalages non nuls.

### Huit tests renforcés

| Faiblesse | Mutation qui survivait | État |
|---|---|---|
| Seuil R2-03 comparé à la constante importée — tautologie | `COLD_DRAW_BUDGET_MS` 5 → 7 | épinglé sur le littéral 5 ✅ |
| Frontière `net === seuil` non testée | `<` → `<=` | ✅ |
| Relecture négative non gardée | `brutMs < 0 \|\| relectureMs < 0` → `brutMs < 0` | ✅ |
| `distance` : les 3 paires assertées étaient toutes verticales | retrait de `\|dq + dr\|` — **28,5 % des paires fausses** | paire diagonale ajoutée ✅ |
| `assert.throws(/allCells/)` acceptait le `TypeError` incident | garde `allCells` neutralisée | motif du contrat exigé ✅ |
| Bords droit et bas de `neighbors` non testés | `ncol < width` → `ncol <= width` | deux cas de bord ✅ |
| `cellsOccupied` sans découpe aux bornes | test de bornes supprimé | rosette de coin ✅ |
| Empreinte de cache sans pavage ni dimensions — **masque périmé resservi** | champs retirés | pavage + dimensions dans la signature, test dédié ✅ |
| Assertion de coût net reparsée sur l'affichage arrondi | — | ⛔ **fausse rougeur ~25 %** : les nombres sont lus non arrondis sur `window.__coldDecodeDernier` ✅ |

⚠ **La seule mutation qui reste verte** : faire juger le verdict par un second appel
`resumeDecodageFroid(brut, 0)` tout en affichant le net correct. Aucun scénario de navigateur ne peut
la distinguer, les deux durées d'un Chromium sans charge tombant du même côté du seuil de 5 ms. Ce
n'est pas une régression plausible — recomposer le verdict dans la page, elle, est attrapée, la phrase
n'existant plus que dans la fonction pure.

## Ce qui reste ouvert, et qui n'est pas du code

- **R2-03** : relevé sur la tablette. Interdiction n°14.
- **`js/core/types.js`** documente désormais odd-r ; aucun étage hexagonal réel n'a encore été
  importé, donc le pavage hex n'a jamais tourné sur une vraie carte — seulement sur des fixtures.
- ⚠ **`cellPointFromMap(pointFromCell(c))` n'est pas un aller-retour exact en hexagonal** : l'erreur
  sur `cellY` atteint 7 · 10⁻⁵, et lorsqu'elle fait basculer le plancher, la parité change et `cellX`
  revient faux d'**une demi-case**. Cela ne casse pas `computeBlockedEdges`, qui n'évalue que des
  points réels, mais les tolérances à `1e-9` de ce fichier n'absorberaient jamais une erreur de 0,5 :
  tout futur code qui supposerait cet aller-retour exact casserait en silence.
- ⚠ `cellCount = width * height` reste injectif jusqu'à ~9 741 × 9 741 cases ; au-delà, la clé d'arête
  dépasse 2⁵³. `js/core/schema.js` n'impose aucune borne supérieure, mais `allCells()` allouerait
  10⁸ objets bien avant.
