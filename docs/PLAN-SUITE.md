# PLAN DE SUITE — après l'audit externe du 18 août 2026

> Écrit le 18/08/2026, après vérification constat par constat des deux documents d'audit remis par
> le mainteneur (`AUDIT-TECHNIQUE-UVTT-ET-RENDU.md`, `ARCHITECTURE-GREENFIELD.md`).
>
> **Ce n'est pas un plan de réparation.** Le produit est à 36 critères sur 41, lots 1a, 1b, 2 et 3
> fermés, lot UX du panneau MJ livré. L'audit n'a trouvé aucun défaut qui empêche de jouer. Il a
> trouvé des risques latents, et un modèle qui promet des choses qu'il ne fait pas.
>
> L'ordre ci-dessous suit le **risque × exposition réelle**, pas les étiquettes P0/P1 de l'audit —
> dont deux portent sur des défauts dont l'exposition est aujourd'hui nulle.

---

## 0. Ce que l'audit a établi, et ce qu'il n'a pas établi

| Constat | Statut après vérification dans le code |
|---|---|
| Le fog compose dans un tampon à la taille de la carte | ✅ **Vrai, et c'est le seul qui vaille une décision** |
| `map_origin` appliqué dans le mauvais sens | ⚠ Vrai en principe, **exposition nulle** — voir §2.2 |
| Contrat carré/hexagone divergent | ✅ Vrai, **déjà mieux documenté en interne** (`QUESTIONS-EN-ATTENTE.md` C-5) |
| Lumières importées non rendues | ✅ Vrai : `intensity`, `color`, `shadows`, `visionBright` validés, persistés, **lus par rien** |
| Import sans plafonds | ✅ Vrai — mais tous les rejets sont déjà **comptés et signalés** ; ce qui manque, c'est la borne |
| Sweep quadratique | ✅ Vrai, correctement classé conditionnel — 2,6 ms pour 300 ms de budget |
| Jimp → Sharp | ✅ Vrai, mais outillage **hors ligne** : aucune exposition en séance |
| « 1 test en échec, `node_modules` incomplet » | ⛔ **Non reproductible** : 454 tests, 453 verts, 1 ignoré, 0 échec. §8 de l'audit à écarter |

---

## 1. Phase 0 — Deux mesures, avant la moindre ligne de code

Aucune ne modifie le produit ; chacune conditionne une décision. C'est la doctrine du projet, et
elle a déjà évité une migration de moteur pour 3 % de gain.

### M1 — le coût réel du compositing du fog

⭐ **L'instrumentation existe déjà.** `FrameProbe` enregistre la durée **par couche**, et son tableau
porte une colonne `background` et une colonne `fog` côte à côte, image par image
(`js/render/probe.js`). Aucun code à écrire.

**Protocole :** ouvrir `player.html?session=<id>&probe=1` sur `testbig150`, pincer pour zoomer et
dézoomer, relever les deux colonnes.

**Ce que ça décide :** l'urgence de la phase 2. Et accessoirement une vieille question — le petit
lag résiduel au zoom, clos le 16/08 sur « sans conséquence ». La signature départage les deux
suspects :

- **coût plat** quel que soit le zoom → c'est le fog, dont le composite balaie la carte entière à
  chaque image indépendamment de l'échelle ;
- **coût variable** avec le facteur d'échelle → c'est le rééchantillonnage du fond.

Le raisonnement est celui déjà écrit dans `CORRECTIF-COUT-DU-MASQUE-JOUEURS.md` pour le défaut
jumeau des pions : *une composition coûte en proportion de sa surface de destination.*

### M2 — le champ lumineux à la résolution du masque

Le vrai pivot. Prototype mesuré sur la tablette, avec les **93 sources** de l'étage 00 du village.

**L'hypothèse à éprouver :** 93 disques de gradient à 8 px/case tiennent dans ~1,9 Mpx par image, et
un gradient est précisément ce qu'un agrandissement bilinéaire ne dégrade pas.

**Ce que ça décide :** le modèle de lumière (§4), et **en aval seulement**, la question du moteur de
rendu.

> ⚠ Ces mesures **n'entrent pas dans la porte** — elles mesurent la machine autant que le code. Ce
> qui y entre, c'est leur **calcul**, éprouvé sur horloge et données synthétiques. La leçon de la
> sonde 7bis, appliquée d'avance. Voir `ETAT.md`, campagne du 11/08.

---

## 2. Phase 1 — Exactitude géométrique

### 2.1. G-1 — remplacer `mapFromCellPoint` par une API explicite

`SquareGrid` en rend le **coin**, `HexGrid` le **centre**. `TokensLayer` calcule sa boîte par
différence de deux appels : juste pour la première convention seulement. En hexagonal, un pion 1×1 à
140 px/case est dessiné à 210 px de large en ligne paire et 70 px en ligne impaire.

**Le correctif** est l'API sans ambiguïté : `cellCenter`, `cellPolygon`, `cellBounds`,
`gridPointToMap`, `mapPointToGrid`. Il supprime **la classe** de bug : aucune couche ne reconstruit
plus la géométrie d'une case par différence de deux points dont la sémantique varie.

> ⛔ **Le piège, et il est réel.** La méthode ambiguë sert aussi aux murs, portails, lumières,
> gabarits et fog. Un correctif naïf les déplace tous. Donc : **ajouter** la nouvelle API, migrer
> **un appelant à la fois** avec son test, **retirer** l'ancienne en dernier. Le motif se valide sur
> le premier cas, les suivants sont mécaniques.

**Critères :** pions hexagonaux corrects pour plusieurs tailles et les deux parités de ligne ;
résultats en grille carrée **inchangés** ; aucune méthode de grille ne rend plus un point dont le
JSDoc ne dit pas s'il est coin ou centre.

**Ce que ça débloque :** le lot 4 (hexagone), et l'acceptation de la grille hexagonale à l'import,
refusée aujourd'hui alors que `HexGrid` existe.

### 2.2. G-2 — `map_origin` : un avertissement, pas un pari

Le projet **additionne** l'origine ; l'importeur Foundry `FVTT-DD-Import` applique
`(point − map_origin) × pixels_per_grid`, soustraction, uniformément sur murs, portails et lumières.
C'est le premier point de comparaison extérieur que le projet ait jamais eu.

⛔ **Mais on ne bascule pas le signe sur la foi d'un importeur tiers**, et surtout :

- tous les exports réels du dépôt ont `map_origin` à `{0,0}` ;
- **Dungeon Alchemist est la source principale du mainteneur**, et DA **rebase sa géométrie** —
  `docs/ANALYSE-DD2VTT-GRILLES.md` appelle ça « le scénario propre » ;
- la seule fixture qui couvre le cas a une image de 1 × 1 pixel : elle ne peut rien aligner.

Fabriquer un export recadré pour trancher un cas que la chaîne d'outils réelle ne produit jamais est
du travail contre un risque théorique. **Ce qu'on fait à la place, tout de suite et sans fixture :**

> Quand `map_origin` est non nul, **avertir bruyamment** et dire quelle interprétation a été
> appliquée.

Trois lignes, aucun pari sur le signe, et un désalignement silencieux devient un défaut visible et
diagnosticable — la doctrine que l'import applique déjà partout ailleurs. Le jour où un fichier réel
déclenche l'avertissement, on aura le cas réel qui manque, et on tranchera **alors**.

---

## 3. Phase 2 — Le fog à la résolution du masque

Composer les trois états à 8 px/case, mettre en cache tant que fog et vision ne changent pas, étirer
**une seule fois** au rendu final. Les 245 Mio d'un tampon `7499 × 8192` disparaissent, et le coût
devient proportionnel à l'information plutôt qu'à la surface.

Ce qui rend ce point sérieux n'est pas l'audit, c'est le dépôt : **c'est le défaut déjà mesuré et
corrigé sur la couche des pions le 04/08** — 848 ms par image, « seize fois le budget » — et
`CORRECTIF-COUT-DU-MASQUE-JOUEURS.md` §3 écrit noir sur blanc « la couche de fog n'est pas touchée ».
Le correctif a laissé le jumeau en place.

> ⚠ **Où un bug se cachera :** le chemin des polygones dessine en **pixels carte**. Il faut le porter
> dans l'espace du masque. C'est exactement le type d'erreur « grandeur dans le mauvais espace » qui
> a déjà coûté un facteur 3 sur ce projet.

**Critères :** rendu visuellement identique avant/après ; trois états discernables en vue MJ ; zones
jamais explorées totalement masquées côté joueurs ; aucune fuite aux bords ; mise à jour correcte
après déplacement, ouverture de porte et changement d'étage.

⭐ **Faire la phase 2 avant la phase 3 rend la phase 3 nettement moins chère** : c'est la même
machinerie de composition basse résolution. C'est la raison principale de cet ordre.

---

## 4. Phase 3 — La lumière, le pivot

M2 tranche entre deux chemins, et **il faut trancher explicitement**. L'état actuel est le pire des
deux : des champs validés, persistés, édités dans l'UI, et lus par rien.

- **Tactique binaire** → retirer `intensity`, `color`, `shadows` et `visionBright` du modèle
  exécutable. Un modèle qui transporte des champs que personne ne lit ment à chaque relecture.
- **Éclairage réel** → une `LightLayer` séparée du fog, honorant portée, intensité, couleur et la
  sémantique de `shadows`.

Ce choix ferme aussi **CdC §12 question 9** — l'approximation « voir le centre d'une lampe révèle
tout son halo » — parce que séparer la ligne de vue de l'illumination est le même changement.

Et c'est **seulement si cette couche dépasse le budget de la tablette** que WebGL revient sur la
table, cette fois avec la mesure qui a toujours manqué.

---

## 5. Phase 4 — Robustesse de l'import

Borner **avant** l'allocation : taille du JSON, taille estimée de l'image décodée, largeur, hauteur,
nombre de cellules, polylignes, sommets, portes, lumières, valeurs non finies et coordonnées hors
domaine. Les seuils viennent du corpus réel et du matériel cible, jamais d'une valeur choisie au
hasard.

Puis : adaptateurs de dialecte par producteur, validation du champ `format`, acceptation de la grille
hexagonale explicite (débloquée par G-1), et un rapport d'import listant champs ignorés, valeurs
normalisées et éléments rejetés.

L'import est déjà bien meilleur que l'audit ne le dit — **tous les rejets sont comptés et
signalés**. Ce qui manque, c'est le plafond. Et il compte, avec 152 packs et 1 774 cartes en entrée.

### 5.1. Calibration par le nom de fichier — une prise offerte

Constaté le 18/08 sur `maps/Dungeondraft/` : **16 JPEG, aucun fichier VTT** — c'est un pack
commercial d'images. Mais le nom porte les cases et le DPI, et les deux tombent exactement juste sur
les seize :

```
Bandit Ambush - Summer - Day - 22x16 - 300 DPI.jpg  ->  6600 x 4800 px  ->  300,0 px/case
Treetops - Summer - Day 2   - 11x8  -  72 DPI.jpg   ->   792 x  576 px  ->   72,0 px/case
```

L'import d'image (chantier Y) peut donc **proposer** la calibration au lieu de la demander, et la
**vérifier** en recoupant `largeur/NN`, `hauteur/MM` et le DPI annoncé — trois sources concordantes.

⛔ Proposer, jamais imposer : un pack au nommage différent retombe sur la saisie manuelle, pas sur
une valeur inventée. Un désaccord entre les trois sources se **signale**.

---

## 6. Phase 5 — Sharp, quand il n'y aura rien de mieux à faire

Zéro exposition en séance : c'est de l'outillage hors ligne. Et le vrai travail n'est pas le
redimensionnement, c'est de **réétablir l'équivalence de la détection de grille**. `resample.mjs`
porte du savoir durement acquis sur les pièges de Jimp — options de décodage JPEG jetées en
silence, greffon WebP à enregistrer soi-même.

Prototype **à côté** de Jimp, comparaison sur les trois plus grosses sources réelles (durée, pic
mémoire, poids WebP, dimensions, densité détectée), bascule seulement si les sorties sont
équivalentes.

---

## 7. Phase 6 — Lot 4, et passage à l'échelle conditionnel

Hexagone et confort de table, débloqués par G-1.

Puis, **et seulement sur symptôme constaté** :

- **index spatial du sweep** — si un seuil défini à l'avance est franchi. Aujourd'hui : 2,6 ms pour
  300 ms de budget ;
- **pyramide de tuiles** — si une carte dépasse 8192 px, si le contexte se perd, ou si plusieurs
  étages restent chauds simultanément.

> Les tuiles sont **orthogonales au moteur de rendu**. Le Canvas 2D existant sait les dessiner ;
> ni OpenSeadragon ni PixiJS ne sont requis. Elles ne sont donc ni un argument pour WebGL, ni un
> argument contre — seulement un prérequis que WebGL rendrait obligatoire tout de suite, là où
> Canvas 2D le laisse optionnel et différable.

---

## 8. Ce qu'on ne fait pas, et pourquoi

| | Raison |
|---|---|
| **WebGL / PixiJS** | Pas avant M2. La seule chose que le GPU apporte vraiment ici est la lumière par pixel. Et `MAX_TEXTURE_SIZE` vaut **8192 sur la Tab S9 FE**, mesuré, quand `testbig150` fait 7499 × 8192 : le tuilage deviendrait un prérequis immédiat. Deux objections tiennent par ailleurs — la **testabilité** (on perdrait les assertions déterministes contre un contexte 2D simulé, dans un projet où 12 faux verts ont été attrapés à la main) et la **perte de contexte** sur Android en séance de 4 h |
| **Vite** | Contredit `STACK.md` §1, normatif : « sans bundler ni étape de compilation » |
| **Réécriture TypeScript** | `tsc --noEmit` tourne déjà dans la porte. Et l'argument porte à faux : C-5 n'est **pas** une erreur qu'un type marqué aurait attrapée — coin et centre sont tous deux des `MapPoint`. Ce qui l'évite, c'est l'API explicite de G-1, qui ne coûte pas une chaîne de compilation |
| **Optimiser le sweep** | Pas sans seuil franchi. Une réécriture augmenterait le risque de fuite visuelle aux angles sans bénéfice démontré |
| **FlatBuffers / Protobuf / WebGPU seul** | Ne ciblent aucun coût réel de ce projet |

---

## 9. Exécution

Chaque tranche suit le modèle en place : un **brief** avec ses critères d'acceptation et ses preuves
par mutation exigées ; le code ; une **relecture à contexte neuf** par un agent distinct, sur arbre
propre ou en worktree ; `/muter` avant de déclarer un critère tenu ; `pnpm run verify` verte avant
commit.

⚠ **Un test vert ne prouve rien tant qu'on n'a pas cassé le mécanisme qu'il prétend couvrir et vu le
rouge.** Voir `.claude/skills/muter/SKILL.md` et ses sept familles de faux verts déjà rencontrées
ici.
