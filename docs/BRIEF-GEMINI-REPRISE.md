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
- **L'arrondi cubique de `HexGrid.cellFromPoint` est exact** : 0 erreur sur 16 969 points balayés. ✅

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

# R-05 G-01 — la sonde de décodage froid, toujours à faire

**Elle n'a pas été livrée**, et c'était la tâche n°1 : c'est le **seul vrai défaut** de tout ce qui
reste, et la page imprime aujourd'hui « OUI — critère R2-03 tenu » sur une mesure fausse.

La spécification complète est dans `BRIEF-GEMINI-CODE.md`, section G-01, y compris la contrainte que
j'ai tranchée : on ne peut pas mesurer `decode()` **et** `drawImage` sur un bitmap qui ne refroidit
qu'une fois, donc le `drawImage` gagne et `decodeMs` sort de la section.

---

## Note de discipline

Le point d'arrêt de G-04 était **après** la réécriture de `computeBlockedEdges`, avant `HexGrid`. Il a
été franchi, et les deux régressions — l'index spatial et le cisaillement — sont arrivées ensemble.
C'est précisément ce que l'arrêt devait éviter : chacune se diagnostique en dix minutes, mêlées elles
en ont coûté beaucoup plus. **R-01 et R-02 sont deux rapports séparés.**
