# Analyse — grilles peintes, `.dd2vtt` et couches multiples

> Document de constat, écrit le 29 juillet 2026 à partir de **douze fichiers réels**
> exportés par le logiciel de cartographie du MJ, en deux lots.
>
> Il ne propose pas de correctif : il dit ce que ces fichiers contiennent, ce que notre
> chaîne en fait aujourd'hui, et quelles conventions d'export ont été arrêtées.
>
> Aucune modification de code n'a accompagné cette analyse.

---

## 0. Décisions arrêtées

Quatre décisions prises après mesure. Elles portent sur **la production des cartes du
MJ**, pas sur le code : elles réduisent la surface de risque à traiter, elles ne
dispensent pas de gérer le cas général pour des cartes tierces (Patreon, scans).

| Décision | Ce qu'elle élimine |
|---|---|
| **`.dd2vtt` est une norme de premier rang**, à traiter au même plan que `.uvtt` | Le logiciel du MJ **ne sait pas** exporter en `.uvtt`. Ce n'est pas un cas exotique à tolérer, c'est le format d'entrée principal |
| **Export en grille carrée, ou sans quadrillage du tout** — jamais d'hexagone peint | Le déphasage vertical décrit au §4.3, indétectable sans analyse d'image |
| **Export 2D uniquement**, jamais « limited 3D » | Le déplacement des murs hors des lignes de grille (§6) |
| **Export systématiquement sans bordures** | Les cases fantômes et le gaspillage de texture (§5) |
| **Export à 150 ppg**, jamais 300 | Le dépassement du plafond de décodage JPEG (§7.2), et 78 % de pixels décodés pour rien |

**Précision sur la cinquième décision, ajoutée le 29/07 au soir après mesure.** Le plafond
de décodage ne porte pas sur le ppg mais sur le **nombre total de pixels**, autour de
20 Mpx. Il couple donc la résolution *et* la taille de carte : un 29×22 à 150 ppg fait
14,4 Mpx et passe, un 40×30 à 150 ppg fait 27 Mpx et échoue. La formulation robuste est
donc **largeur × hauteur × ppg² sous ~20 Mpx**, soit environ 36×24 cases à 150 ppg. Dire
« j'exporte en 150 » ne suffit pas pour une carte sensiblement plus grande.

Mesures à l'appui, sur `test multi layer square grid_00` (29×22) :

| Export | Pixels | Décodage au plafond par défaut de 512 Mo |
|---|---|---|
| 150 ppg → 4350×3300 | 14,4 Mpx | passe |
| 200 ppg → 5800×4400 | 25,5 Mpx | échoue |
| 300 ppg → 8700×6600 | 57,4 Mpx | échoue |

Et le réglage est bon, pas un compromis : la chaîne cible `targetPxPerCell` 140, donc
150 ppg est du 1:1 alors que 300 ppg fait décoder quatre fois trop pour jeter le surplus.
Vérifié de bout en bout sur `fixtures/real/testvtt150dpi.dd2vtt` (21×14, 6,6 Mpx) :
`prepareMap()` réussit sans aucune modification de code.

Conséquence directe sur le code : le filtre d'extension et le `sourceUrl` de
`prepare-maps.mjs` doivent traiter `.uvtt`, `.dd2vtt` et `.df2vtt` comme **un seul
format**, ce que le CdC §5.1 annonçait déjà (« Source A — UVTT / DD2VTT / DF2VTT »).
C'est un alignement, pas une extension de périmètre.

Les mesures des §4 à §6 restent utiles même après ces décisions : elles documentent ce
qu'on saurait diagnostiquer si une carte tierce arrivait hors convention.

---

## 1. Partage des responsabilités : métrologie contre topologie

L'UVTT ne porte pas *une grille* mais une **métrologie** de grille. Trois champs, et rien
d'autre ([`js/import/uvtt.js:50-58`](../js/import/uvtt.js#L50-L58)) :

| Champ source | Devient |
|---|---|
| `resolution.pixels_per_grid` | `level.pxPerCell` |
| `resolution.map_size` | `level.widthCells` / `heightCells` |
| `resolution.map_origin` | `level.grid.offsetX/Y`, par multiplication par `pxPerCell` |

Pas de topologie, pas de couleur, pas d'opacité, pas d'affichage on/off. Et **pas de champ
d'offset** : l'alignement se dérive de `map_origin`. Les trois champs de rendu (`color`,
`opacity`, `visible`) sont initialisés en dur par le parseur ; ils n'existent pas dans le
format.

Tout le reste appartient à l'outil : `SquareGrid` est le seul endroit qui connaît la
géométrie des cases, et c'est lui qui trace
([`js/grid/SquareGrid.js:169`](../js/grid/SquareGrid.js#L169)), via une `GridLayer` qui ne
fait que déléguer. Le pont ne se fait qu'une fois, à l'import ; après quoi plus personne
ne sait que la carte vient d'un UVTT — c'est voulu (CdC §2 : « `GridAdapter` ignore la
provenance de la carte »).

---

## 2. Une grille peinte ne casse pas le déplacement

`cellFromPoint`, `pointFromCell`, `neighbors`, `distance`, `cellsInRange` ne dépendent que
de `pxPerCell`, `offsetX/Y` et des dimensions en cases. Aucun pixel du fond n'est lu. Les
murs restent en unités de case dans le modèle, donc murs, portails, arêtes bloquées et
pathfinding sont tous exprimés dans **le même repère** que la grille logique. L'ensemble
est cohérent avec lui-même par construction.

Ce qui se dégrade est la **lisibilité** : un pion se centre au milieu de *notre* case et
peut se retrouver visuellement à cheval sur deux cases peintes. Le déplacement reste
juste, il devient illisible.

**Le vrai piège est le correctif intuitif.** `line_of_sight` et `portals` sont exprimés en
unités de case relatives aux `pixels_per_grid` / `map_origin` **déclarés**. Recalibrer à
l'œil sur les lignes dessinées déphase la géométrie importée par rapport à la grille →
arêtes bloquées fausses → pions qui traversent les murs. La métrologie déclarée est la
seule vérité ; la grille peinte est une décoration à masquer (`grid.visible = false`).

**Tolérance disponible.** Le pont mur → arête du CdC §5.3bis n'est pas un magnétisme sur
la grille mais un test de croisement : « pour chaque paire de cases adjacentes, tester si
le segment joignant leurs centres croise un mur ou un portail fermé ». Ce test absorbe
donc **±0,5 case** de déplacement d'un mur avant de désigner la mauvaise arête. C'est ce
budget qui rend le §6 bénin, et c'est lui qu'il faut surveiller.

---

## 3. Les deux corpus

### Lot 1 — trois variantes de grille, bordures présentes

```text
test multi layer square grid_00 / _01     grille carrée peinte
test multi layer hexagone_00    / _01     grille hexagonale peinte
test multilayer gridoff_00      / _01     aucune grille peinte  (témoin)
```

`map_size` 29×22, `pixels_per_grid` 300, `map_origin` 0,0, image 8700×6600.
`_00` = sans toit (10 `line_of_sight`, 5 `portals`, 0 `lights`), `_01` = avec toit (aucune
géométrie).

Le témoin `gridoff` fait de ce lot un banc de mesure : les trois variantes ne diffèrent
**que** par la couche grille — hash de `line_of_sight` + `portals` identique aux trois
(`2a91a4e477c1`). Soustraire `gridoff` d'une autre variante isole donc exactement le
quadrillage peint. C'est la méthode des §4.1 et §4.3.

### Lot 2 — sans bordures, trois couches, 2D contre « limited 3D »

```text
testvtthexa2D_00        / _01 / _02       hexagone peint, murs 2D
testvtthexalimited3d_00 / _01 / _02       hexagone peint, murs en fausse perspective
```

`map_size` 21×14, `pixels_per_grid` 300, `map_origin` 0,0, image 6300×4200. Noms sans
espaces (le lot 1 en contenait, d'où le point §7.3).

Pas de témoin `gridoff` dans ce lot : les six fichiers ont l'hexagone peint.

### Commun aux douze

```text
format 0.2 | environment.baked_lighting: true | ambient_light "ffffffff"
image JPEG (ffd8ffe0, 3 composantes)  ->  aucun canal alpha
```

Absents des douze : `grid_type`, `name`, `objects_line_of_sight`, `software`, `creator`.
L'image intégrée est un **JPEG**, pas un PNG comme le suppose la spec UVTT, et le MJ a
vérifié qu'aucune option PNG n'existe dans le logiciel. Donc pas d'alpha, jamais.

---

## 4. Mesures de la grille peinte

### 4.1 Grille carrée — phase parfaite

Masque isolé par `square grid_00` − `gridoff_00`, puis autocorrélation des profils :

| Axe | Période mesurée | Phase |
|---|---|---|
| colonnes | 300 px = 1,0000 case | 0 |
| lignes | 300 px = 1,0000 case | 0 |

Exactement `pixels_per_grid`, calé sur l'origine de l'image. `map_origin: 0,0` est
honnête. **Notre grille logique tombe pile sur la grille dessinée** : rien à corriger, le
seul arbitrage est esthétique (masquer la nôtre, ou la laisser par-dessus).

C'est ce résultat qui rend l'export carré acceptable au même titre que l'export sans
quadrillage.

### 4.2 Sans quadrillage — témoin

Aucune structure périodique détectable : score de peigne au niveau du bruit, phases
aléatoires. Témoin négatif confirmé, et c'est la variante la plus robuste puisqu'elle
supprime tout couplage entre l'image et notre grille.

### 4.3 Hexagone — le cas écarté par convention

Le fichier hex a une métrologie **strictement identique** à la version carrée et la même
géométrie. Du point de vue des données, un export hexagonal **est** un export carré : le
réseau hexagonal n'existe que dans les pixels du JPEG. Rien, dans le format, ne le
signale.

Mesures sur le masque isolé — hexagones pointe en haut :

| Grandeur | Mesuré | Rapport à `pixels_per_grid` |
|---|---|---|
| pas de colonne | 300 px | 1,0000 case |
| pas de rangée | 259 px | 300 × √3/2 = 259,81 |

L'autocorrélation en X pique à 150 px : c'est le décalage d'une demi-colonne entre rangées
alternées, le pas réel de colonne étant 300.

Donc **horizontalement notre grille carrée coïncide** avec le réseau hex (une frontière de
colonne sur deux). **Verticalement elle dérive** : 300 contre 259,81, soit une rangée
entière de décalage tous les ~6,5 rangs — deux rangées d'écart sur 14 rangées. Déplacement
juste, rendu illisible à mi-carte, et aucun moyen de le détecter sans analyser l'image.

**Convention confirmée sur les deux lots.** Le MJ a tenté de *forcer* l'hexagone à
l'export dans le lot 2 : le fichier produit ne contient aucun champ supplémentaire, et le
réseau peint est identique au pixel près — pas de colonne 150 px, phase 148,5 contre 150 px
/ phase 149 au lot 1 ; pas de rangée confirmé à 520 px = 2 × 259,81. Le logiciel ne sait
pas déclarer sa topologie.

**Note pour le lot 4.** Passer `grid.type = 'hex'` ne réparerait rien mécaniquement. Il
faudrait que l'adaptateur hexagonal adopte précisément cette convention — pointe en haut,
largeur plat-à-plat = `pixels_per_grid`, pas de rangée = `pixels_per_grid` × √3/2 — sinon
on obtiendra un hexagone techniquement correct et toujours désaligné. Le garde-fou
`grid_type === 'hex'` du parseur ([`uvtt.js:43`](../js/import/uvtt.js#L43)) est du code
mort face à ce logiciel : il n'écrit jamais ce champ.

---

## 5. Les bordures — résolu par convention d'export

### Ce que le lot 1 montrait

Le contenu éclairé n'occupait pas l'image : zone claire mesurée `x[1197..7503]`,
`y[1200..5402]`, soit **exactement 4 cases de marge de chaque côté** pour une aire utile
de 21×14 cases. Or `map_size` déclarait 29×22, marge comprise (`29 = 4+21+4`,
`22 = 4+14+4`).

Deux conséquences :

1. **8 colonnes et 8 rangées de cases parfaitement légitimes dans le noir.**
   `cellFromPoint` les accepte, `cellsInRange` les traverse, un pion s'y promène. Rien ne
   les distingue du reste, faute de murs sur le pourtour.
2. **Seulement 46 % de la surface de texture utile**, donc ~54 % de perte : à
   `targetPxPerCell` 140 on produit 4060×3080 alors que l'aire utile n'y occupe que
   2940×1960.

### Ce que le lot 2 montre

`map_size` 21×14 pour une image 6300×4200 — exact. Et surtout **l'outil a rebasé la
géométrie** : les murs passent en x 11,00–15,03 / y 4,98–11,03, tous dans les bornes, avec
`map_origin` resté à 0,0. C'est le scénario propre, pas celui qui laisse les coordonnées
dans l'ancien repère.

L'export sans bordures étant devenu la convention (§0), la question « faut-il recadrer à
l'import ? » **est sans objet**. Ne pas écrire de code de recadrage : il faudrait
translater `map_origin` et toutes les coordonnées de géométrie, avec précisément le risque
du §2.

Un manque subsiste : aucun corpus réel n'a jamais présenté un `map_origin` **non nul**.
La seule fixture qui le couvre, `fixtures/synthetic/offset-origin.uvtt`, a une image de
1×1 pixel.

---

## 6. La fausse perspective — mesuré, puis démontré bénin

Le lot 2 oppose deux rendus du même bâtiment : murs 2D, et murs « limited 3D » avec
épaisseur et hauteur visibles.

### Les murs sont réellement déplacés

Pas seulement redessinés : les coordonnées diffèrent sur les 10 polygones **et** les 6
portails.

| | 2D | limited 3D | écart |
|---|---|---|---|
| mur ouest (x) | 11,000 | 11,020 | +6 px |
| mur est (x) | 15,030 | 15,210 | **+54 px** |
| mur nord (y) | 4,977 | 4,907 | −21 px |
| mur sud (y) | 11,027 | 11,187 | **+48 px** |

Écart à la ligne de grille la plus proche, sur l'ensemble des points de murs et de
portails :

| Variante | médian | maximum |
|---|---|---|
| 2D | 6–7 px | **9 px = 0,03 case** |
| limited 3D | 28–36 px | **63 px = 0,21 case** |

Le déplacement est asymétrique, vers le bas-droite : c'est la direction de la fausse
perspective. L'exporteur suit la silhouette **dessinée** du mur, pas son emprise au sol.
Les largeurs de portes s'en trouvent gonflées aussi (1,05 case contre 1,01). Les lumières,
elles, ne bougent quasiment pas (0,016 case) : elles sont ancrées au sol.

### Et pourtant l'accessibilité est identique

Masques d'arêtes bloquées calculés selon le test de croisement centre-à-centre du CdC
§5.3bis, sur les deux variantes :

```text
2D_00        -> 48 arêtes bloquées
limited3d_00 -> 47 arêtes bloquées
   identiques : 47   seulement 2D : 1   seulement limited3d : 0
   la seule différence : la diagonale 10,7 -> 11,6
```

Et cette différence est **sans effet** : la règle anti-corner-cutting du CdC exige que les
deux orthogonales adjacentes soient libres pour emprunter une diagonale, or l'orthogonale
`10,7 → 11,7` est bloquée dans les deux variantes. La diagonale était déjà interdite.
Résultat identique sur la paire `_01`.

**Conclusion : la fausse perspective est esthétique.** Elle ne touche pas le déplacement,
parce que les 0,21 case de déplacement tiennent largement dans les ±0,5 case de tolérance
du test de croisement.

### Ce qui reste vrai

- **Lisibilité** : le mur dessiné est jusqu'à 63 px de l'arête logique, et sa hauteur
  dessinée occulte du terrain qui reste jouable.
- **Marge consommée** : 42 % du budget de 0,5 case. Des murs plus hauts déplaceraient
  davantage, et rien ne borne ce déplacement dans le format.
- **Cohérence inter-sous-systèmes** : le module `vision/` travaillant sur les polygones
  bruts et non sur la grille (CdC, `vision/` indépendant de `grid/`), les ombres suivront
  les murs *déplacés* alors que le blocage de passage suit les arêtes. Deux positions de
  mur légèrement différentes selon le sous-système. Pas un bug, mais à savoir.

L'export 2D étant devenu la convention (§0), tout ceci est théorique — sauf pour une carte
tierce, d'où le diagnostic proposé au §10.

---

## 7. Ce que la chaîne actuelle en fait : elle échoue

Trois blocages cumulés, dans l'ordre où on les rencontre.

### 7.1 Extension non reconnue

`prepareMaps()` ne glob que `.uvtt`
([`scripts/prepare-maps.mjs:184`](../scripts/prepare-maps.mjs#L184)) : les douze fichiers
sont invisibles. Or `.dd2vtt` est désormais le format d'entrée principal (§0), pas un cas
limite.

Point de vigilance sur l'élargissement du filtre : `_00`, `_01` et `_02` ne collisionnent
pas entre eux, mais `x.uvtt` et `x.dd2vtt` produisent le même slug.

### 7.2 Décodage JPEG — blocage sec

En appelant `prepareMap` directement :

```text
ECHEC: Impossible de lire l'image source avec Jimp :
       maxMemoryUsageInMB limit exceeded by at least 119MB
```

`jpeg-js` plafonne à 512 Mo par défaut ; 8700×6600 en RGBA le dépasse. Le `catch` de
[`scripts/resample.mjs:60-66`](../scripts/resample.mjs#L60-L66) tente ensuite le décodeur
WebP, qui échoue aussi sur du JPEG, d'où un message final trompeur qui accuse Jimp plutôt
que le plafond mémoire.

**Portée : toute carte à 300 ppg**, pas seulement ces corpus. Et comme aucune option PNG
n'existe dans le logiciel du MJ, le chemin JPEG est le chemin normal, pas un cas dégradé.
C'est le blocage à traiter en premier.

### 7.3 Métadonnées de provenance

- `sourceUrl` est codé en dur en `maps/${baseName}.uvtt`
  ([`scripts/prepare-maps.mjs:131`](../scripts/prepare-maps.mjs#L131)) : il doit porter
  l'extension réelle du fichier source.
- Les noms du lot 1 contiennent des espaces, donc URL à encoder. Le lot 2 n'en a plus,
  mais rien ne le garantit à l'avenir.
- Pas de champ `name` dans les fichiers → `displayNameFromSlug` ne coupe que sur `-` et
  `_`, ce qui donne « Test multi layer square grid — 00 ».

---

## 8. Un bug révélé par les lumières du lot 2

Premières vraies lumières du corpus (3 sur `_00`, 2 sur `_01` ; les lots précédents en
avaient zéro). Le format de couleur est **ARGB, alpha en premier, sans `#`** :

```json
{"position":{"x":13.0097723,"y":7.99791431},"range":4.16,"intensity":2.52,
 "color":"ffF7EAE4","shadows":true}
```

Le parseur fait `color: l.color ?? '#ffffff'`
([`js/import/uvtt.js:114`](../js/import/uvtt.js#L114)) : il recopie la chaîne telle quelle.
Donc `level.lights[0].color === "ffF7EAE4"`, qui n'est pas une couleur CSS valide. Il faut
convertir en `#RRGGBB` plus un alpha séparé.

**Et `validateCampaign` laisse passer** : vérifié, il retourne `[]`. La validation ne
contrôle pas le format des couleurs.

Deux points connexes :

- `intensity` vaut 2,52 et 3, au-dessus de 1, sans que `js/core/types.js` documente
  l'échelle attendue (`@property {number} intensity`, sans borne). À trancher avant le lot
  éclairage.
- `environment.ambient_light: "ffffffff"` est purement ignoré : le parseur code
  `ambient.color = '#ffffff'` et `level = 1.0` en dur.

---

## 9. Les couches multiples

### Lot 1 — deux couches

`_00` sans toit (10 `line_of_sight`, 5 `portals`), `_01` avec toit (**aucune** géométrie).

### Lot 2 — trois couches, mieux structuré

| | `line_of_sight` | portails | lumières |
|---|---|---|---|
| `_00` | 10 | 6 | 3 |
| `_01` | 10 | 4 | 2 |
| `_02` | 0 | 0 | 0 |

`_02` est le toit — toujours zéro géométrie. Mais `_00` et `_01` sont **deux étages avec
chacun sa géométrie propre** : les deux portails absents du premier étage sont les deux
portes du mur sud (les seules à `closed: true` du lot, les quatre autres étant des
ouvertures `closed: false`), et les lumières diffèrent.

Ça correspond bien à « un étage = une scène autonome » du CdC §5.2. Le toit reste le cas
bâtard : un fond de plus pour l'étage supérieur, sans données propres.

**Et ce ne sont pas des calques.** Le JPEG à 3 composantes n'a aucun canal alpha, et
aucune option PNG n'existe dans le logiciel — donc chaque couche est un **fond complet**,
jamais une surcouche transparente. Sur le lot 1, le diff `_00`/`_01` porte sur 3,75 % des
pixels et sa bbox couvre toute la zone claire : le toit **et** son ombre portée sur
l'herbe.

Un basculement toit / sans-toit se modélise donc comme **deux images pour un seul jeu de
murs**. Modèle à trancher, la superposition par transparence n'étant pas une option.

---

## 10. Diagnostics à ajouter à l'import

Les conventions du §0 protègent les cartes du MJ. Elles ne protègent pas d'une carte
tierce. Trois contrôles peu coûteux, tous calculables sans analyser l'image :

1. **Écart à la grille.** Si un point de mur ou de portail est à plus de ~0,25 case d'une
   ligne de grille, signaler. Attrape la fausse perspective (0,21 mesuré) avant que le
   budget de ±0,5 case ne soit dépassé. Métrique de référence : 0,03 case sur un export
   2D sain.
2. **Cohérence dimensionnelle.** Comparer les dimensions réelles de l'image à
   `map_size × pixels_per_grid`. Un écart signifie que `resample` va **déformer** l'image
   pour la faire rentrer dans le compte de cases
   ([`scripts/resample.mjs:74-77`](../scripts/resample.mjs#L74-L77) impose
   `targetWidth = round(widthCells × targetPxPerCell)` sans regarder la source) : la
   grille peinte dériverait alors progressivement. Les douze fichiers tombent pile, rien
   ne le garantit ailleurs.
3. **Géométrie hors bornes.** Un point de mur en dehors de `[0, map_size]` trahit un
   recadrage sans rebasage — le cas qui casse réellement le déplacement (§2).

Détection automatique d'une **grille peinte** : techniquement faisable — l'ajustement de
peigne sur le profil de gradient fonctionne sur un fichier seul, sans variante témoin —
mais hors périmètre. Le contournement manuel existe déjà : onglet « Grille » du panneau
MJ, `#grid-visible` / `#grid-opacity`, persisté par étage et diffusé aux joueurs.

---

## 11. Ordre de traitement suggéré

1. **Décodage JPEG** (§7.2) — blocage sec, et c'est le chemin normal puisqu'aucun PNG
   n'est possible à la source.
2. **`.dd2vtt` au même plan que `.uvtt`** (§7.1) et provenance (§7.3) — mécanique, avec la
   garde de collision de slug.
3. **Couleur ARGB des lumières** (§8) — bug franc, silencieux, non attrapé par la
   validation.
4. **Modèle deux-fonds / un-jeu-de-murs** pour le toit (§9) — choix de conception, à
   trancher avant de coder.
5. **Diagnostics d'import** (§10) — filet pour les cartes hors convention.
6. **Convention hexagonale** (§4.3) — à figer avant le lot 4, sans quoi l'adaptateur hex
   naîtra désaligné.

Sans objet, par décision d'export : le recadrage des bordures (§5), la tolérance à la
fausse perspective (§6), la gestion d'une grille hexagonale peinte (§4.3).
