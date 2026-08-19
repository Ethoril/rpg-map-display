# BRIEF — Composer le fog à la résolution du masque

> Écrit le 19/08/2026, après la mesure M1. Découle de [PLAN-SUITE.md](./PLAN-SUITE.md) §3.
>
> **Ce n'est pas une optimisation, c'est une réparation.** M1 a mesuré le compositing du fog à
> **1580–1700 ms par image** sur la Tab S9 FE, `testbig150`, vue joueurs — **plat quel que soit le
> zoom**, soit ~50 fois le budget de 33 ms. La carte est injouable.

---

## 1. Ce que le code fait, et pourquoi ça coûte

`FogLayer.render()` (`js/render/layers/fogLayer.js`) crée un canvas hors écran **aux dimensions de
la carte** :

```js
const bottomRight = grid.mapFromCellPoint({ cellX: level.widthCells, cellY: level.heightCells });
const mapWidth  = Math.ceil(bottomRight.x);   // 7499 sur testbig150
const mapHeight = Math.ceil(bottomRight.y);   // 8192
```

Puis, **à chaque image** : `clearRect` + `fillRect` pleine surface (étape A), `drawImage` du masque
exploré étiré à cette taille + `fillRect` pleine surface (étape B), `drawImage` du masque visible
étiré (étape C), et enfin dépôt sur la scène (étape D).

Soit **61 mégapixels balayés deux à trois fois par image**, pour représenter une information qui
tient dans `65 × 8` par `71 × 8` = **520 × 568 pixels**. Le tampon est **plus de deux cents fois
plus grand que ce qu'il porte**.

⭐ **Ce défaut a déjà été corrigé une fois, sur la couche voisine.**
`CORRECTIF-COUT-DU-MASQUE-JOUEURS.md` (04/08) l'a mesuré à 848 ms par image sur les **pions**, et
son §3 écrit noir sur blanc : « la couche de fog n'est pas touchée ». Le jumeau est resté en place.

---

## 2. Ce qu'il faut faire

Composer les trois états **à la résolution du masque** (`FOG_MASK_PX_PER_CELL`, soit 8 px/case),
mettre le résultat en cache tant que ni le fog ni la vision ne changent, et **l'étirer une seule
fois** au dépôt final.

Les masques exploré et visible sont **déjà** à cette résolution : ils sont aujourd'hui étirés vers le
grand tampon, ce qui est exactement le travail à supprimer.

```
aujourd'hui : masque 520×568 ──étiré──> tampon 7499×8192 ──> scène
demain      : masque 520×568 ──composé à 520×568──> ──étiré une fois──> scène
```

---

## 3. ⚠ Les pièges, nommés

**1. Les polygones sont en pixels carte.** Le chemin sans `visibleCanvas` (`this._cachedPolygons`,
étape C) trace `moveTo/lineTo` avec des `MapPoint`. Dans un canvas à l'échelle du masque, ces
coordonnées sont **17,5 fois trop grandes** à 140 px/case. C'est l'erreur « grandeur dans le mauvais
espace », qui a déjà coûté un facteur 3 sur ce projet. La conversion passe par
`FOG_MASK_PX_PER_CELL` et l'origine de l'étage, comme partout (`CONVENTIONS.md` §3).

**2. ⭐ La netteté du chemin polygones va changer, et c'est le seul écart visuel attendu.**
Aujourd'hui ce chemin trace à pleine résolution : ses bords sont **nets**. Demain il sera tracé à
8 px/case puis agrandi : ses bords seront **adoucis**. Les masques exploré et visible, eux, étaient
déjà étirés — pour eux, rien ne change.

⛔ **Ne pas masquer cet écart, ne pas le "compenser" par une astuce.** Il se signale au mainteneur,
qui juge. Si l'adoucissement est refusé, la solution de repli est un tampon **borné au viewport**
plutôt qu'au masque — plus cher, mais net.

**3. L'arithmétique des opacités ne change pas.** Le calcul du complément
(`(veilUnexplored - veilExplored) / (1 - veilExplored)`) et l'ordre `destination-out` /
`destination-over` restent identiques. C'est un changement de **surface de travail**, pas de recette.
Le commentaire qui explique pourquoi ce complément existe doit survivre : sans lui, quelqu'un
rétablira la valeur directe et la vue MJ redeviendra illisible.

**4. Le cache doit s'invalider sur ce qui le rend faux** — changement de masque exploré, de masque
visible, de polygones, de dimensions d'étage, d'opacités. ⚠ Un cache qui ne s'invalide pas est un
défaut plus coûteux que le coût qu'il supprime : il fige un fog périmé, et le mainteneur voit une
zone révélée qui ne l'est pas.

---

## 4. Ce qui se vérifie sans yeux, et ce qui attend

⭐ **La séparation est la clé de cette tranche.**

| | Où | Comment |
|---|---|---|
| **Les dimensions du tampon** — il fait bien `widthCells × 8` par `heightCells × 8`, et **jamais** la taille de la carte | test unitaire | assertable, **dans la porte** |
| **La conversion des polygones** vers l'espace du masque | fonction pure, testée | assertable, **dans la porte** |
| **L'invalidation du cache** — chaque entrée qui doit le casser le casse | test unitaire | assertable, **dans la porte** |
| **L'arithmétique des opacités**, inchangée | tests existants | déjà couverte, ils doivent rester verts |
| ⛔ **« Le rendu est visuellement identique »** | l'écran du mainteneur | **hors porte, et hors de portée d'un agent** |

⛔ **Aucun agent ne déclare cette tranche terminée.** Elle est *implémentée* quand la porte est verte
et les mutations prouvées ; elle est *validée* quand le mainteneur a regardé les trois états en vue
MJ et en vue joueurs. Un agent qui doit juger sans pouvoir mesurer juge toujours que ça va.

---

## 5. Critères d'acceptation

1. Le tampon hors écran ne dépasse **jamais** les dimensions du masque, quelle que soit la carte —
   test qui échoue si quelqu'un rétablit `mapWidth`.
2. Les trois états restent distincts en vue MJ ; côté joueurs, les zones jamais explorées restent
   **totalement** masquées.
3. Aucune fuite aux bords du masque lors de l'agrandissement.
4. Le fog se met à jour correctement après déplacement, ouverture de porte et changement d'étage.
5. Les tests d'opacité existants restent verts **sans être modifiés**. ⚠ Un test qu'il faut retoucher
   pour passer signale un changement de comportement, pas un test à corriger.
6. `pnpm run verify` verte, lancée **seule**, code de sortie capturé hors de tout tube.

---

## 6. Preuves par mutation exigées

Chacune doit faire rougir au moins un test, et le rapport doit dire **lequel** :

1. rétablir les dimensions de la carte pour le tampon → le test de dimensions rougit ;
2. tracer les polygones en pixels carte dans le canvas de masque → la géométrie convertie rougit ;
3. ne jamais invalider le cache → le test d'invalidation rougit ;
4. peindre l'opacité visée au lieu de son complément → un test d'opacité existant rougit.

⚠ **Muter l'effet, pas l'étiquette.** Un test qui relève la largeur déclarée d'un canvas sans
vérifier ce qui y est peint passera au vert sur une panne réelle.

---

## 7. Mesurer après

La même sonde que M1 : `player.html?session=<id>&probe=1` sur `testbig150`, pincer, relever la
colonne `fog`. **Relevé du mainteneur, hors porte.** Point de départ : 1580–1700 ms.

⚠ Et `PLAN-SUITE.md` §1 rappelle un **second coût, distinct** : le fond à 1131–1431 ms sur les images
où il se redessine. Cette tranche ne le traite pas. Ne pas s'attendre à ce que le total tombe à zéro,
et ne pas conclure à un échec si le fond reste cher.
