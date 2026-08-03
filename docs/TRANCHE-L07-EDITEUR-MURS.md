# TRANCHE L-07 — éditeur minimal de murs

> Septième tranche du **Lot 2 du CdC §11**. Découpage : `PLAN-LOT2.md` §4. Dépend de L-01
> (arêtes bloquées), livrée. Ne dépend ni de L-05 ni de L-06.
>
> Elle ferme deux critères sur treize — **1** (un segment de mur manquant s'ajoute à la main et
> corrige immédiatement la vision) et **2** (un étage importé en image simple reçoit des murs et
> gagne des lignes de vue). Le lot passe de 6/13 à 8/13.
>
> Spécification de référence : CdC §5.7 « **Éditeur minimal de murs.** Ajouter, déplacer,
> supprimer un segment de mur ou un portail sur un étage », pour deux usages nommés — réparer un
> export UVTT incomplet, et doter un étage importé en image simple de lignes de vue.

---

## 1. Ce qui a été mesuré avant d'écrire ce brief

Six briefs sur six ont été corrigés par une mesure faite **avant** la première ligne de code.
Celle-ci établit que **l'endroit exact où se pose un mur dessiné à la main change ce qu'il
bloque**, et pas d'un peu : le même mur mal placé devient soit une cloison épaisse d'une case,
soit une cloison percée à ses deux extrémités.

Relevé avec `computeBlockedEdges` du dépôt, sur un étage 8 × 8, une seule polyligne horizontale
allant de `cellX: 2` à `cellX: 6`, la seule variable étant son ordonnée.

| Position du mur | Arêtes bloquées | Frontières de grille touchées |
|---|---|---|
| `y = 3` — **frontière de case entière** | **14** | une seule, entre les lignes 2 et 3 |
| `y = 3,5` — **ligne des centres de case** | **29** | **deux**, lignes 2-3 **et** 3-4 |
| `y = 3,1` | 12 | une seule |
| `y = 3,4` | 12 | une seule |

**Le cas du milieu est le pire, et il est contre-intuitif.** Un mur tracé le long d'une ligne de
centres de case bloque les franchissements **des deux côtés** : les segments centre-à-centre qui
montent vers lui et ceux qui en descendent le touchent tous. Un seul trait dessiné par le MJ
produit une cloison d'une case d'épaisseur, infranchissable dans les deux sens. Personne ne
comprendrait pourquoi le couloir est bouché sur deux rangées.

**Le décalage de 0,1 est plus insidieux.** Le compte tombe de 14 à 12, et la différence est
exactement celle-ci :

```
perdues en décalant de 0,1 : ["1,3|2,2", "5,2|6,3"]
gagnées                    : []
```

Ce sont les **deux diagonales des extrémités** : un mur posé exactement sur la frontière croise
aussi les diagonales qui passent par ses bouts, un mur décalé les manque. Autrement dit, **un
mur mal posé laisse un pion passer en diagonale par chacun de ses deux bouts.** C'est du
corner-cutting réintroduit à la main, dans un lot dont le critère 8 existe pour l'interdire.

C'est le même fait que L-05 avait mesuré côté portails, sous un autre angle : sur
`manoir-rdc`, dont les portails sont posés sur des frontières entières, aucun centre de case ne
tombait dans la zone tactile ; sur `testbig150`, dont ils sont à 0,01 près, 176 y tombaient. La
géométrie entière n'est pas une élégance, c'est ce qui rend le comportement prévisible.

> Mesuré au poste de bureau, mais ce ne sont pas des chiffres de performance : ce sont des
> **comptes d'arêtes**, déterministes et indépendants de la machine. L'interdiction n°14 ne
> s'applique pas ici, rien n'est coché sur la foi d'un temps.

---

## 2. Ce qu'il faut écrire

1. **`js/ui/gm/wallEditor.js`** — fichier nouveau, **déjà au manifeste**
   (`ARCHITECTURE.md` §1 : « `[2]` éditeur minimal de murs »).
2. **`js/render/layers/walls.js`** — fichier nouveau, **hors manifeste**, donc amendement (§6).
3. **`js/core/schema.js`** — validation des polylignes de mur (§9).
4. **`js/app/networkEvents.js`** — `wall.add` et `wall.remove` (§8).
5. **`js/state/store.js`** — `addWall` et `removeWall` (§9).
6. **`js/app/gm.js`** et **`js/ui/gm/panel.js`** — montage et branchement du geste (§7).

**Rien dans `js/input/`.** C'est la conséquence du §7, et c'est voulu : L-06 vient d'y ajouter un
mode, et une tranche qui doit prouver un éditeur neuf n'a pas à remanier la couche d'entrée en
même temps.

---

## 3. Le partage d'autorité

| Calcul | Où | Pourquoi |
|---|---|---|
| Arêtes bloquées | partout, localement | déterministe à partir des données d'étage |
| Vision, fog | **Mac seul**, publiés | CdC §4 : le Mac est le nœud autoritaire |

Un mur ajouté est une **donnée d'étage**, pas un état de session : il vit dans la campagne,
voyage par événement, et chaque client recalcule ses propres arêtes bloquées. C'est le même
partage que les portails à L-05, et pour la même raison — la signature du cache d'arêtes inclut
les murs (`js/import/blockedEdges.js:63-75`), donc muter la campagne suffit à tout réaligner.

**Le critère 1 en découle presque entièrement.** « Corrige immédiatement la vision » : la
signature de vision de `fogLayer` inclut les murs (`js/render/layers/fogLayer.js:49-51`), donc
une mutation de la campagne déclenche `syncVision`, qui republie. La chaîne est celle que L-04 a
câblée et que L-05 a déjà éprouvée. **Ne pas la réécrire, ne pas y toucher.**

---

## 4. L'accrochage à la grille, et le seul cas où il doit céder

### 4.1 La décision

**Un mur dessiné à la main s'accroche aux coins de case** — `cellX` et `cellY` entiers. La
mesure du §1 ne laisse pas le choix : c'est la seule position qui produise exactement ce que le
MJ a tracé, sans cloison double ni fuite en diagonale aux bouts.

Le rayon d'accrochage vaut **une demi-case** : tout point de la carte est alors à portée d'un
coin, et l'accrochage ne rate jamais. Le coin retenu doit être **montré** avant le clic — un
accrochage invisible se découvre en constatant que le mur n'est pas là où on croyait l'avoir
mis.

### 4.2 Le cas où l'entier serait faux : réparer un export UVTT

Le premier usage nommé par le CdC §5.7 est de « réparer un export UVTT incomplet ». Or les murs
d'un export réel ne sont **pas** sur des entiers : `testbig150` porte des coordonnées comme
`60.01005`. Un mur de raccord accroché à l'entier le plus proche laisserait donc un interstice
au raccord — et une fuite de vision dans un angle est précisément ce que le critère 12 interdit.

**Second accrochage, prioritaire sur le premier : les extrémités des murs et portails
existants**, dans le même rayon d'une demi-case. Un mur de réparation se soude alors exactement
à la géométrie qu'il prolonge, quelle que soit sa position, tandis qu'un mur tracé au milieu de
nulle part tombe sur un coin de case.

L'ordre est le seul qui satisfasse les deux usages du §5.7 : **extrémité existante à portée →
coin de case → rien d'autre.** Aucun point libre, jamais : la mesure du §1 dit ce que coûte un
point libre, et le MJ n'a aucun moyen de voir qu'il vient de le payer.

---

## 5. Le périmètre, et deux verbes du CdC §5.7 délibérément écartés

Le §5.7 demande quatre choses : ajouter, déplacer, supprimer, et le faire sur « un segment de
mur **ou un portail** ». La tranche en livre deux, et les deux autres se refusent pour des
raisons différentes.

### 5.1 Livré : ajouter et supprimer un mur

C'est ce que les critères 1 et 2 exigent, et rien de plus.

### 5.2 Écarté : déplacer

**Aucun des deux critères ne le demande**, et un mur mal placé se supprime puis se retrace — un
geste de plus pour une fonction en moins. Surtout, déplacer suppose un glisser, donc un mode
d'entrée et un hit-test de sommet, donc toucher `js/input/pointer.js` où L-06 vient d'ajouter
`'brushing'`. Mêler un remaniement de la couche d'entrée à la première version d'un éditeur est
la façon la plus sûre de casser les deux.

À rouvrir si l'usage réel le réclame. Ce n'est pas un oubli, c'est un report daté.

### 5.3 Écarté, et pour une raison qui mérite ta décision : éditer un portail

Le §5.7 met les portails dans la même phrase que les murs. **Le protocole n'a pas de nom pour
le faire.** Le CdC §7 liste `wall.add` / `wall.remove`, et pour les portails uniquement
`portal.toggle` — qui change un état, pas l'existence. Ajouter ou supprimer un portail à la main
exigerait donc d'inventer `portal.add` et `portal.remove`, ce que `CONVENTIONS.md` §4 interdit
sans demander.

**C'est une question à trancher, pas une lacune à combler au fil du code.** Le besoin est réel —
un export Dungeondraft omet des portes aussi souvent que des cloisons — mais il vaut deux noms
d'événements dans le cahier des charges, pas une improvisation dans un `ui/`. Voir §10.

Note que le manque est moins grave qu'il n'y paraît : un mur ajouté à la place d'une porte
manquante bloque déjà passage et vision, ce qui rend l'étage jouable. C'est la porte *ouvrable*
qui manque, pas la cloison.

---

## 6. Les murs sont invisibles, et le critère 2 ne survit pas à ça

**Aucune couche ne dessine les murs aujourd'hui.** `level.walls` n'est lu que par
`js/render/layers/fogLayer.js:49-51`, et seulement pour composer la signature de vision.

Pour une carte UVTT, c'est sans conséquence : les murs sont dans le dessin de la carte. Mais le
critère 2 porte sur un étage importé en **image simple**, dont l'image ne montre aucune
cloison. Le MJ y tracerait donc une géométrie invisible, dont il ne pourrait vérifier ni la
position, ni la continuité, ni même l'existence. Le critère serait invérifiable.

### 6.1 Amendement du manifeste

`CONVENTIONS.md` §8 interdiction n°12 : ne jamais créer un fichier absent du manifeste. Un
besoin non couvert se signale — c'est l'objet de cette section, sur le modèle du chantier L et
de L-05.

| Fichier | Rôle |
|---|---|
| `js/render/layers/walls.js` `[2]` | tracé des murs de l'étage, **vue MJ seule** |

`'walls'` s'insère dans `CANVAS_LAYER_ORDER` (`js/render/stage.js`) **juste avant `'portals'`** :
une porte se pose dans l'ouverture d'un mur, et l'ordre de la pile suit la superposition
physique. Comme pour les portails, être avant `'fog'` suffit à ce qu'un mur en zone non explorée
reste invisible aux joueurs — le voile plein s'en charge, sans une ligne pour cela.

### 6.2 Vue MJ seule, et pourquoi ce n'est pas incohérent avec L-05

L-05 dessine l'indicateur de porte sur **les deux** vues, parce qu'une porte porte un **état** —
ouverte, fermée, verrouillée — que les joueurs ont besoin de lire. Un mur n'a pas d'état : c'est
de la géométrie d'auteur. Sur une carte UVTT, la dessiner aux joueurs doublerait le dessin de la
carte ; sur une image simple, elle apparaîtrait comme un calque de mise au point.

La couche n'est donc enregistrée que dans les renderers de `js/app/gm.js`, pas dans ceux de
`js/app/player.js`. Aucun réglage, aucun drapeau : elle n'est simplement pas montée là.

---

## 7. Le geste : aucun nouveau mode d'entrée

### 7.1 Pourquoi c'est possible

Tracer un mur, c'est **poser des sommets l'un après l'autre**, puis clore. Supprimer, c'est
**désigner un mur**. Les deux sont des taps, et le tap arrive déjà dans `handleIntention` de
`js/app/gm.js`. Aucun glisser, donc aucun mode, aucun prédicat injecté, aucune ligne dans
`js/input/`.

C'est le bénéfice direct d'avoir écarté « déplacer » (§5.2), et c'est ce qui rend cette tranche
petite.

### 7.2 L'ordre dans la branche `tap`, qui est le point fragile

La branche `tap` de `gm.js` porte déjà, depuis L-05, un hit-test de portail. Avec l'éditeur de
murs armé, un tap près d'une porte **ne doit pas la basculer**.

Ordre à respecter, et il n'est pas négociable :

1. **Outil de murs armé** → le tap appartient à l'éditeur. Rien d'autre n'est consulté.
2. Sinon, le comportement de L-05 inchangé : pion, puis portail, puis case.

Le même arbitrage vaut pour les deux prédicats de glisser : outil armé ⇒ `canStartTokenDrag`
rend `null` et `canStartBrush` rend `false`, de sorte qu'un glisser **panne la carte** au lieu
de déplacer un pion ou de peindre. C'est le motif que L-06 a établi, et l'exclusion reste dans
la vue, où vit le mode.

⚠ **Conséquence à assumer et à écrire dans l'interface : deux outils ne s'arment pas ensemble.**
Armer l'éditeur de murs désarme le pinceau de fog, et réciproquement. Sans cette règle, l'état
« pinceau + murs » serait représentable et personne ne saurait ce qu'un tap y fait.

### 7.3 Poser, clore, annuler

- Chaque tap ajoute un sommet, accroché selon le §4.
- Le tracé en cours se **dessine** au fur et à mesure (la couche du §6 le montre, en style
  distinct du définitif) : sans retour visuel, on trace à l'aveugle.
- **Clore** valide la polyligne — bouton explicite, et non un double-tap : sur une tablette le
  double-tap est déjà pris par le zoom du navigateur, et un geste ambigu qui *valide* une
  mutation est un mauvais geste.
- **Annuler le tracé en cours** le jette sans rien muter. Une polyligne de moins de deux points
  n'est pas un mur : elle se jette en silence, ce n'est pas une erreur.

La suppression est un tap sur un mur existant, dans une tolérance d'une demi-case autour du
segment — la même capsule que L-05 a établie pour les portails, et pour la même raison. En cas
d'ambiguïté, le plus proche gagne ; à égalité, le premier dans l'ordre du tableau, pour que les
tests soient stables.

---

## 8. `wall.add` et `wall.remove`

### 8.1 Les noms existent, le payload est à décider

Le CdC §7 les liste : « `wall.add` / `wall.remove` | MJ | ponctuel — invalide le masque
d'arêtes ». Les noms ne s'inventent donc pas, et cette fois ils s'émettent réellement — à la
différence de `fog.paint` et `fog.reset`, écartés à L-06 parce que les tablettes auraient dû
calculer. Ici, un mur est une donnée que chaque client doit détenir pour calculer ses arêtes
localement (§3).

**Les deux portent la même forme, et c'est délibéré :**

```js
{ type: 'wall.add',    payload: { levelId, wall: CellPoint[] }, at, by: 'gm' }
{ type: 'wall.remove', payload: { levelId, wall: CellPoint[] }, at, by: 'gm' }
```

### 8.2 Supprimer par valeur, jamais par indice

Un indice dans `level.walls` serait fragile et non rejouable : deux éditions successives le
décalent, et rejouer une suppression supprimerait un autre mur. Le retrait se fait donc **par
valeur** — la première polyligne dont tous les points coïncident exactement.

Trois propriétés en découlent, toutes souhaitables : le rejeu est idempotent (le second retrait
ne trouve rien et ne change rien) ; l'ordre d'arrivée est indifférent ; et `wall.remove` est le
miroir exact de `wall.add`, donc une seule forme à retenir.

**La comparaison exacte de flottants est sûre ici**, et c'est le §4 qui la rend sûre : les murs
tracés à la main sont sur des entiers, et un mur importé se compare aux valeurs mêmes qui ont
été reçues et stockées — on ne recalcule rien, donc rien ne dérive.

### 8.3 Le piège Firestore, à ne pas réveiller

`CONVENTIONS.md` §1 : **Firestore refuse un tableau contenant directement un tableau.**
`Level.walls` étant un `CellPoint[][]`, chaque polyligne est enrobée en `{ points: CellPoint[] }`
au seul franchissement de la frontière Firestore, et `assertNoNestedArrays` vérifie le document
avant l'appel en nommant le chemin fautif.

Le payload ci-dessus porte **une seule** polyligne, donc un tableau d'objets : il passe. Porter
`walls: CellPoint[][]` — le tableau entier — le ferait échouer, en plus de violer le
« ne jamais transmettre ce que le destinataire peut recalculer » du §4. Ne pas le faire.

L'instantané durable, lui, passe par le chemin d'enrobage existant, qui n'a rien à changer.

---

## 9. La mutation passe par le store, et le schéma doit valider les murs

### 9.1 Deux fonctions nommées

`CONVENTIONS.md` §5 : toute mutation passe par une fonction nommée du store. `updateLevel`
existe et suffirait, mais obligerait chaque appelant à reconstruire le tableau complet et à
porter la règle de comparaison du §8.2 — qui se retrouverait dupliquée côté interface et côté
réseau.

```js
export function addWall(levelId, wall)      // wall : CellPoint[], au moins deux points
export function removeWall(levelId, wall)   // retrait par valeur, no-op si absent
```

Elles portent, à elles seules : la validation de la polyligne, la campagne candidate clonée puis
validée par `assertValidCampaign` — la forme de `updateLevel` et de `setPortalState`, pas
`validateCampaign` qui rend un tableau —, et la notification des abonnés, qui déclenche tout le
reste (§3).

Le coût est connu et mesuré à L-05 : clonage complet plus revalidation, 0,31 ms sur `manoir-rdc`
et 3,15 ms sur `testbig150`. Une édition de mur est ponctuelle.

⚠ **Rafraîchir la sélection**, comme `setPortalState` a dû le faire : `reachableCells` n'est
calculé qu'au moment de la sélection (`js/state/selection.js`), et `updateLevel` ne le
rafraîchit pas. Sans cela, ajouter un mur devant un pion sélectionné laisserait sa zone de
déplacement traverser le mur jusqu'à la resélection. C'est le défaut que L-05 a rencontré au
même endroit ; le motif à copier est celui de `moveTokenToCell`.

### 9.2 Le schéma ne valide aucun point de mur

`validateCampaign` se contente de `Array.isArray(level.walls)` (`js/core/schema.js:611`). C'est
le même trou que les portails avaient avant L-05, et il s'ouvre pour de bon maintenant qu'un
humain fabrique la donnée : un `NaN` venu d'un accrochage raté entrerait en silence, et se
manifesterait en arêtes bloquées aberrantes, très loin de sa cause.

À valider par polyligne : c'est un tableau, il porte **au moins deux points**, et chaque point a
des `cellX` / `cellY` **finis**. Le message nomme l'étage et l'indice de la polyligne, comme
celui des portails nomme l'étage et l'identifiant.

---

## 10. Amendements requis

- **CdC §5.7** : consigner que « déplacer » est reporté (§5.2), et que l'édition de portails
  attend **deux noms d'événements** — `portal.add` et `portal.remove` — qui n'existent pas au §7
  et ne s'inventent pas (§5.3). C'est la seule question que cette tranche laisse ouverte, et
  elle t'appartient.
- **CdC §11, lot 2** : cocher les critères 1 et 2 une fois vérifiés. Ni l'un ni l'autre ne porte
  de seuil ni ne dépend du matériel — l'interdiction n°14 ne s'y applique pas, contrairement aux
  critères 10 et 11 restés décochés.
- **`ARCHITECTURE.md` §1** : ajouter `js/render/layers/walls.js` `[2]` (§6.1). `wallEditor.js`
  y est déjà.
- **`CONVENTIONS.md` §8 n°2** : rien à changer. La couche des murs est côté MJ seul, la liste de
  ce qui s'affiche en vue joueurs est inchangée.

---

## 11. Ce qui n'est PAS dans cette tranche

- **Déplacer** un mur (§5.2), **éditer un portail** (§5.3).
- Les gabarits (**L-08**), les marqueurs (**L-09**).
- **Aucun undo.** L-06 a construit une pile pour le fog, indexée sur des masques PNG ; les murs
  sont une autre donnée et mériteraient leur propre mécanisme. Supprimer un mur qu'on vient
  d'ajouter est immédiat et suffit. Ne pas étendre la pile de fog aux murs : elle porte des
  instantanés de masque, pas des mutations de campagne.
- **Aucune édition côté joueurs**, et aucun rendu des murs sur leur vue (§6.2).
- Pas de mur courbe, pas d'épaisseur, pas de type de mur. Une polyligne, comme le modèle.
- Pas d'import ni d'export de murs par fichier : c'est le rôle du pipeline UVTT.

---

## 12. Critères d'acceptation

1. **Critère 1 du §11** — sur `manoir-rdc`, ajouter un segment à la main dans une ouverture
   corrige **immédiatement** la vision sur les trois écrans, sans rechargement.
2. **Critère 2 du §11** — un étage importé en image simple, donc `walls: []`, reçoit des murs et
   gagne des lignes de vue : le fog s'arrête aux murs tracés.
3. **Accrochage** — un mur tracé loin de toute géométrie tombe sur des `cellX` / `cellY`
   **entiers**. Vérifié sur la donnée, pas à l'œil.
4. **Accrochage prioritaire** — un sommet posé à moins d'une demi-case de l'extrémité d'un mur
   ou d'un portail existant en reprend les coordonnées **exactes**, entières ou non. C'est ce qui
   rend la réparation d'un export UVTT sans interstice.
5. **Ce qu'un mur bloque est ce qui a été tracé** — un mur horizontal accroché sur une frontière
   bloque les franchissements d'**une seule** frontière de grille. Test unitaire adossé aux
   chiffres du §1 : 14 arêtes pour le cas mesuré, une seule frontière touchée.
6. **Suppression par valeur, idempotente** — rejouer un `wall.remove` ne retire pas un second
   mur ; un `wall.remove` sur un mur absent ne change rien et ne journalise pas.
7. **La zone de déplacement suit** — avec un pion sélectionné, ajouter un mur devant lui
   restreint **immédiatement** ses cases atteignables, sans resélection (§9.1).
8. **Les murs sont visibles côté MJ, invisibles côté joueurs** ; un mur en zone non explorée ne
   se devine pas davantage.
9. **Exclusion des outils** — armer l'éditeur de murs désarme le pinceau de fog ; un tap près
   d'une porte ne la bascule pas quand l'éditeur est armé ; un glisser panne la carte.
10. **Le schéma refuse une polyligne malformée** — moins de deux points, ou un point non fini —
    en nommant l'étage et l'indice.
11. **Le payload traverse Firestore** — un instantané portant des murs ajoutés à la main
    s'enregistre sans réveiller `assertNoNestedArrays`.
12. `pnpm run verify` vert, `pnpm run check-deps` vert. En particulier : `js/render/layers/walls.js`
    au manifeste, aucune mention de `pxPerCell` hors de `js/grid/`, et `js/input/` intouché.

---

## 13. Tests attendus

Unitaires (`node:test`) :

- **accrochage** — coin de case par défaut ; extrémité existante prioritaire dans le rayon ;
  aucun point libre produit ;
- **arêtes** — les quatre positions du §1 reproduites : 14 arêtes sur une frontière pour
  `y = 3`, deux frontières pour `y = 3,5`, et les deux diagonales d'extrémité perdues à
  `y = 3,1`. C'est la mesure transformée en garde ;
- **`addWall` / `removeWall`** — polyligne invalide refusée, retrait par valeur, retrait d'un
  absent sans effet, sélection rafraîchie, abonnés notifiés une fois ;
- **schéma** — polyligne à un point refusée, point non fini refusé, message nommant l'étage et
  l'indice ;
- **événements** — `wall.add` et `wall.remove` idempotents, payload malformé refusé et
  journalisé, étage inconnu refusé.

Navigateur (`*.spec.mjs`) :

- tracer un mur côté MJ arrête le fog des joueurs — mesuré sur le masque publié puis décodé, pas
  sur les pixels rendus (leçon de L-04) ;
- la zone de déplacement d'un pion sélectionné se restreint sans resélection ;
- un étage sans mur en reçoit et gagne des lignes de vue, de bout en bout ;
- éditeur armé : un tap près d'une porte ne la bascule pas, un glisser panne ;
- les murs ne sont pas dessinés sur `player.html`.

---

## 14. Ce que cette tranche laisse au lot suivant

Après L-07, il ne reste du lot 2 que les gabarits (L-08) et les marqueurs (L-09), et **L-09
attend une séance jouée** — `PLAN-LOT2.md` §7 le dit depuis le début, le jeu de marqueurs se
décide à table.

Autrement dit : L-07 et L-08 livrées, **tout le lot 2 sera écrit**, et ce qui restera ouvert
n'attendra plus de code — les deux critères de L-05 attendent la Tab S9 FE, celui des marqueurs
attend une partie jouée. Le lot ne se terminera pas par un commit mais par une séance.

> **Écart de décompte à réconcilier, repéré en écrivant ceci.** Le critère 13 (« coût de la
> vision mesuré sur la tablette ») est coché `[x]` dans le CdC §11 depuis L-02, mais il est exclu
> du « 6 sur 13 » d'`ETAT.md` — dont le compte part de 1/13 après L-01 puis ajoute les cinq de
> L-04. Les deux comptes sont donc décalés d'une unité selon qu'on inclut ou non une mesure
> consignée. Ce brief s'aligne sur celui d'`ETAT.md` pour ne pas ajouter une troisième
> convention, mais l'un des deux documents devrait être corrigé — hors périmètre de L-07.
