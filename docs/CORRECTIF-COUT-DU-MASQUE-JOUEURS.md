# CORRECTIF — le masquage des pions coûte seize budgets d'image

> Écrit le 4 août 2026. **Défaut relevé par le mainteneur sur la tablette, en usage réel** :
> « gros gros soucis de perfs depuis qu'on a le fog. »
>
> Ce n'est pas une tranche du lot 2 mais la réparation d'un défaut de conception introduit par
> **L-04**. `PLAN-LOT2.md` §4 réservait la tranche **L-10** à « tenue 30 fps, 500 segments,
> 6 pions » : ce correctif est le travail que cette ligne annonçait, déclenché par une mesure
> plutôt que par un calendrier.

---

## 1. Ce qui a été mesuré

### 1.1 Le mécanisme

`js/render/layers/tokens.js:198-217`, côté joueurs, quand un masque de vision existe :

```js
let mapWidth = ctx.canvas?.width || 800;
if (usePlayerMask && options.activeLevelWidthCells && ...) {
  const bottomRight = grid.mapFromCellPoint({ cellX: …widthCells, cellY: …heightCells });
  mapWidth = Math.ceil(bottomRight.x);          // ← la CARTE, pas le viewport
  mapHeight = Math.ceil(bottomRight.y);
}
if (usePlayerMask) {
  offscreenCanvas = document.createElement('canvas');   // ← alloué à CHAQUE render
  offscreenCanvas.width = mapWidth;
  offscreenCanvas.height = mapHeight;
}
```

À chaque image : allouer un canvas aux dimensions de la **carte entière**, y dessiner les pions,
appliquer le masque en `destination-in` **sur toute la surface**, recopier le tout, le jeter.

### 1.2 L'arithmétique

| Étage | Surface allouée par image | RGBA | À 30 img/s |
|---|---|---|---|
| `manoir-rdc` | 6720 × 6300 | **161 Mio** | 4,7 Gio/s |
| `testbig150` | 7500 × 8193 | **234 Mio** | 6,9 Gio/s |
| *le viewport de la tablette* | *1440 × 900* | *5 Mio* | — |

**La surface travaillée est 32 fois trop grande**, en permanence.

### 1.3 Le coût réel, mesuré dans Chromium

Reproduction du chemin exact — allocation, dessin, `destination-in`, recopie — dans un vrai
navigateur, sur un **poste de bureau** :

| Cas | Coût par image |
|---|---|
| `manoir-rdc`, 6720 × 6300 | **541,7 ms** |
| `testbig150`, 7500 × 8193 | **848,3 ms** |
| la même chose à l'échelle du viewport | 14,7 ms |
| **budget pour 30 images/s** | **33,3 ms** |

**Seize fois le budget d'image entier, sur une machine de bureau.** Sur le Mali-G68 de la
Tab S9 FE, davantage.

### 1.4 Quand cela se déclenche

`usePlayerMask` est vrai dès qu'un `vision.update` est arrivé, donc **en permanence en jeu**. La
boucle de rendu étant à la demande, rien ne brûle au repos — mais elle tourne à plein :

- à chaque image d'une **animation de déplacement** (`animationActive` redemande une frame) ;
- à chaque `pinchZoom`, donc **pendant tout un geste de zoom**.

C'est-à-dire exactement quand les joueurs regardent, et exactement quand ils touchent l'écran.

> Le coût est **indépendant du zoom**, dans les deux sens : une composition coûte en proportion
> de sa surface de **destination**. Le canvas de la carte fait 42 M pixels qu'on soit zoomé sur
> une case ou qu'on voie l'étage entier. Ce n'est pas le zoom qui coûte, c'est la surface.

---

## 2. La correction retenue : filtrer les pions, ne pas masquer les pixels

**Décision du mainteneur, 4 août 2026 : option A.**

Pour chaque pion, tester si sa case est dans la vision courante ; si non, **ne pas le dessiner**.
Le coût passe de 42 millions de pixels par image à **quelques dizaines de tests**, et il devient
proportionnel au nombre de pions — donc lui aussi indépendant du zoom.

**Pourquoi c'est correct, et pas seulement rapide.** Le modèle du projet est **discret** (CdC
§5.3bis) : un pion occupe des cases entières, sa position est toujours entière. La visibilité par
case est donc la granularité du modèle, pas une approximation de celle du masque.

**Ce qu'on perd, et il faut l'écrire** : le découpage partiel. Un pion à cheval sur la limite de
vision apparaîtra **entier ou pas du tout**, au lieu d'être coupé au bord. C'est accepté.

**Ce qu'on ne perd pas** : l'interdiction n°3 et le critère 6 du §11 — « aucun pion n'est visible
en zone explorée hors vision » — sont tenus, et mieux : un pion non dessiné ne peut pas
transparaître, là où un masquage par pixels dépend de la justesse d'une composition.

### 2.1 Le piège à ne pas retomber dedans : `getImageData` par image

Tester si une case est vue demande de lire **un pixel** du masque de vision. Le faire par pion et
par image ferait un `getImageData` par image — coûteux, et c'est déjà ce que Chromium signale par
son avertissement `willReadFrequently` (consigné dans `ETAT.md`).

**L'alpha du masque s'extrait une fois, au décodage**, dans un `Uint8Array` gardé à côté du canvas
décodé — là où `js/app/player.js:240-280` mémoïse déjà les canvas par chaîne PNG. Le test par pion
devient un accès tableau : `alpha[(y * largeurMasque + x)] > seuil`.

La conversion case → pixel de masque passe par `FOG_MASK_PX_PER_CELL` et l'origine de l'étage,
comme partout (`CONVENTIONS.md` §3) : la case `{a, b}` échantillonne le **centre** de son bloc,
soit `(a + 0,5) × 8` et `(b + 0,5) × 8` en pixels de masque, arrondis.

### 2.2 Ce qui disparaît

`options.visibleCanvas` et `options.visiblePolygons` du chemin de composition de
`js/render/layers/tokens.js`, ainsi que `createOffscreenCanvas`. **Supprimer, ne pas laisser en
place « au cas où »** : un chemin mort qui coûte 542 ms par image est une mine.

`js/app/player.js` cesse d'appeler `getPlayerVisibleCanvas` **deux fois par image** (une pour les
pions, une pour le fog) — la couche de fog en garde besoin, la couche des pions non.

---

## 3. Ce qui n'est PAS dans ce correctif

- **Rien côté MJ** : le MJ voit tous les pions, son chemin n'utilise pas ce masquage.
- **La couche de fog n'est pas touchée.** Le voile continue de consommer le masque de vision
  comme aujourd'hui ; c'est le masquage des **pions** qui change. Si ce correctif modifie
  `fogLayer.js`, il s'égare.
- Aucun changement de format, de publication ni de protocole : le masque publié est identique.
- Pas d'`OffscreenCanvas`, pas de WebGL, pas de nouveau contrat de renderer — `ETAT.md` le dit
  déjà : « toute optimisation GPU future devra passer par un nouveau contrat de renderer et des
  mesures tablette ». Ce n'en est pas une, c'est le retrait d'un travail inutile.

---

## 4. Critères d'acceptation

1. **Un pion en zone explorée hors vision est invisible côté joueurs** — interdiction n°3 et
   critère 6 du §11, inchangés. Mesuré sur le rendu joueurs, pas sur l'intention.
2. **Un pion en vision courante est visible**, et le reste pendant son animation de déplacement.
3. **Aucun canvas n'est alloué par image** dans `js/render/layers/tokens.js` : un test qui
   instrumente `document.createElement` compte **zéro** création de canvas sur dix images
   consécutives de la vue joueurs.
4. **Aucun `getImageData` par image** : le compteur du contexte simulé reste à zéro sur dix
   images, l'alpha étant extrait au décodage du masque.
5. **Le coût par image s'effondre** — à mesurer, et **à ne pas cocher sur ce poste** :
   l'interdiction n°14 vaut dans les deux sens, on ne déclare pas un correctif de performance
   réussi sur une mesure de bureau. Le compte rendu donne la mesure de bureau **et** dit
   explicitement que la validation attend la tablette.
6. **Le masquage par pixels a disparu** : `visibleCanvas`, `visiblePolygons` et
   `createOffscreenCanvas` ne figurent plus dans le chemin des pions, et `player.js` n'appelle
   plus `getPlayerVisibleCanvas` pour eux.
7. `pnpm run verify` vert, `pnpm run check-deps` vert. `js/vision/`, `js/input/` et le protocole
   intouchés.

---

## 5. Tests attendus

Unitaires — le mock de contexte de `tests/fogLayer.test.mjs` compte déjà les `getImageData`, et
c'est l'outil qu'il faut ici :

- un pion dont la case est hors du masque n'est **pas dessiné** ; le même pion, masque mis à
  jour, l'est ;
- **zéro allocation de canvas** et **zéro `getImageData`** sur une suite de rendus ;
- l'échantillonnage tombe bien au centre du bloc de la case, origine d'étage non nulle comprise ;
- un pion de `sizeCells > 1` : décider et tester — je propose **visible si le centre de sa case
  d'ancrage est vu**, cohérent avec la règle des gabarits à L-08, et à écrire.

Navigateur (`*.spec.mjs`) :

- le scénario du critère 6 de bout en bout, sur le rendu joueurs réel ;
- une mesure de coût par image consignée pour comparaison avant/après, **sans verdict**.

---

## 6. Ce que ce défaut apprend

Il a vécu quatre tranches sans être vu, et aucune n'était en faute : L-05 à L-08 ne touchent pas
ce chemin, et mes contrôles ont vérifié ce que chaque tranche changeait. Ce qui l'a trouvé, c'est
dix minutes d'usage réel sur le matériel cible.

`ETAT.md` porte depuis le début une liste « ce qui reste à vérifier manuellement », dont la
première ligne parle de 245 Mio décodés pour une image de fond. Le même ordre de grandeur était
alloué **par image** à trois lignes de là, et personne ne l'a rapproché. La leçon n'est pas
« mesurer plus » mais **mesurer sur le matériel dès qu'un chemin de rendu change** — le budget de
33 ms ne se devine pas depuis un poste où l'on en a mille.
