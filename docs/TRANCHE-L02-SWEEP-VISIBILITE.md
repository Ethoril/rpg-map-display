# TRANCHE L-02 — polygone de visibilité + mesure du critère 13

> Deuxième tranche du **Lot 2 du CdC §11**. Découpage d'ensemble : `PLAN-LOT2.md`.
>
> Elle ne ferme **aucun critère** à elle seule : elle produit la géométrie que L-03 (union
> des PJ) et L-04 (fog) consommeront. Mais elle porte la **mesure du critère 13**, et c'est
> la moitié de son intérêt — `PLAN-LOT2.md` §5.1 exige qu'elle arrive *avec* L-02 et non à la
> fin, parce qu'une mesure défavorable invaliderait l'approche du sweep et que la découvrir
> après L-04 coûterait le fog entier.
>
> ⚠ « Tranche L-02 » n'a rien à voir avec le « chantier L » (outil de cartes).

---

## 1. Ce qu'il faut écrire

`js/vision/sweep.js` — le fichier est **au manifeste** mais n'existe pas encore. Le dossier
`js/vision/` non plus.

Contrat visé :

```
sweep(origine: MapPoint, segments: Segment[], portee: number) -> MapPoint[]
```

Un point, des murs, une portée → le polygone de ce qui est visible. **Rien d'autre** : pas
d'union entre pions (c'est L-03), pas de fog (L-04), pas de rendu.

### La contrainte structurelle, à ne pas contourner

`ARCHITECTURE.md` §2 : **`vision/*` ne peut importer que `core/*`. Jamais `grid/*`.**

Le sweep travaille donc en **coordonnées carte** (`MapPoint`), pas en cases. C'est voulu : la
visibilité est un problème géométrique, pas un problème de grille. Un mur oblique traverse une
case sans se soucier de ses arêtes. C'est ce qui distingue cette tranche de L-01, qui vit dans
`import/` et produit justement un masque de grille.

La conversion des murs (`CellPoint`) vers les coordonnées carte appartient donc à l'appelant.

---

## 2. LA mesure qui décide de l'implantation

J'ai prototypé un sweep naïf — pour chaque extrémité de mur, trois rayons (θ-ε, θ, θ+ε)
testés contre tous les segments — avant d'écrire ce brief. **Il échoue à tous les seuils, y
compris les 500 segments du critère 13 actuel :**

| segments | 1 sweep | 6 pions | verdict 30 fps |
|---|---|---|---|
| 500 | 25,1 ms | 151 ms | **dépasse ×4,5** |
| 1479 | 154,5 ms | 927 ms | **dépasse ×27,8** |
| 3000 | 639,2 ms | 3835 ms | **dépasse ×115** |

Coût quadratique, et ce sont des chiffres de **poste de bureau** : la tablette est 3 à 5 fois
plus lente. Écrire cette version, la mesurer, et conclure que « le sweep ne tient pas » serait
une erreur de diagnostic — c'est l'algorithme qui ne tient pas, pas l'approche.

### Ce qui change tout : la vision est bornée

Un pion voit à `visionBright` / `visionDim` cases — 5 et 10 sur les entrées réelles, pas la
carte entière. **Seuls les segments situés dans la portée peuvent occulter quoi que ce soit.**
En les triant d'abord, le même sweep naïf redevient tenable :

| segments sur la carte | à portée 10 (moy.) | 6 pions | verdict |
|---|---|---|---|
| 500 | 25 | 3,5 ms | tient |
| 1479 (carte réelle) | 47 | 5,4 ms | tient |
| 3000 | 89 | 15,9 ms | tient |

**Un facteur 240 sur la carte réelle**, obtenu sans algorithme sophistiqué. La grandeur qui
gouverne le coût n'est pas le nombre de segments de la carte, c'est le nombre de segments
**à portée** — soit environ `densité × π × portée²`.

Et ça se dégrade vite quand la portée grandit :

| portée | segments à portée (carte réelle) | 6 pions | verdict |
|---|---|---|---|
| 10 cases | 47 | 5,4 ms | tient |
| 20 cases | 298 | 114 ms | **dépasse ×3,4** |

### Conséquence sur ce qu'il faut coder

1. **Le tri par portée est dans `sweep()`, pas à la charge de l'appelant.** Un appelant qui
   oublierait de trier n'obtiendrait pas une erreur mais une lenteur — défaut silencieux, et
   ce projet en a assez payé. La fonction reçoit la portée, donc elle a tout pour trier
   elle-même.
2. **Ne PAS écrire un sweep angulaire en O(n log n) pour l'instant.** À une centaine de
   segments, le naïf suffit largement, et un balayage angulaire à ensemble actif est
   notoirement délicat — ordre de l'ensemble, événements colinéaires, cas dégénérés — donc un
   nid à fuites d'angle, précisément ce que le critère 12 interdit. On mesure d'abord ; on
   n'escalade que si la tablette le réclame.
3. Le coût du tri fait partie du coût mesuré : il est refait à chaque sweep, la position du
   pion changeant.

---

## 3. Le critère 12 : pas de fuite dans les angles

Le CdC met en garde à deux endroits : la simplification de géométrie « décale les murs de
quelques pixels et casse l'alignement avec les portails → fuites de lumière dans les angles ».

C'est le piège classique du sweep par rayons : à un coin, si l'on ne lance qu'un rayon
exactement sur l'extrémité, un flottant défavorable le fait passer **du mauvais côté** du mur
et la vision fuit dans la pièce voisine. D'où les trois rayons par extrémité (θ-ε, θ, θ+ε).

**Le choix de ε doit être écrit et justifié**, pas copié : trop petit, il ne sépare rien ;
trop grand, il fait fuir par construction. Et il doit être testé par un cas dédié — deux
pièces séparées par un mur, l'œil dans l'une, aucun point du polygone dans l'autre.

---

## 4. La section de mesure dans `diag.html`

Elle fait partie de la tranche, pas d'un travail ultérieur.

**Deux axes, pas un.** La discussion initiale ne portait que sur le nombre de segments ; la
mesure du §2 montre que la portée compte autant. Il faut donc une grille de mesure :

- segments : **500, 1000, 1500, 2000, 3000** ;
- portée : **5, 10, 15, 20** cases.

**Plusieurs positions d'origine**, au moins cinq réparties, et rendre la **médiane**. Mes
chiffres au prototype sont bruités — 2000 segments ressortaient parfois plus rapides que 1479,
simplement parce que le tri par portée dépend de l'endroit où l'on se tient. Une mesure sur un
seul point ne veut rien dire.

**Rendre trois grandeurs** : coût d'un sweep, coût de 6 pions, et **le nombre de segments
effectivement à portée** — c'est cette dernière qui explique les deux autres.

**Et traduire en taille de carte.** « 3205 segments » ne dit rien à table ; « à ta densité, des
cartes jusqu'à 100×100 » répond à la question réelle. Densités mesurées à reprendre :
`manoir-rdc` 0,079 segment/case, export Dungeon Alchemist **0,320** — quatre fois plus.

### Interdiction n°14, à respecter à la lettre

`CONVENTIONS.md` : *« Ne jamais cocher un critère de performance. 30 fps […] exigent la
tablette physique. Les signaler "à vérifier par le mainteneur", jamais "fait". »*

Les chiffres de poste de bureau **ne concluent rien**. Marge à connaître : à portée 10 et 3000
segments, mes 15,9 ms deviennent ~64 ms sur une tablette 4 fois plus lente, soit un échec. La
carte réelle (5,4 ms → ~22 ms) passerait, mais de peu. **La tranche se termine sur « à mesurer
sur la tablette », jamais sur un verdict.**

Le critère 13 du CdC reste écrit à 500 segments : le modifier est une décision du mainteneur,
qui la prendra avec la courbe en main.

---

## 5. Critères d'acceptation

1. `sweep()` rend un polygone fermé et non vide sur une pièce simple, sans mur intérieur.
2. **Un mur occulte** : un point situé derrière un mur n'est dans aucun triangle du polygone.
3. **Aucune fuite d'angle** (critère 12) : deux pièces séparées par un mur avec un coin,
   l'œil dans l'une, aucun sommet du polygone dans l'autre. Test dédié, pas un corollaire.
4. **La portée borne le polygone** : sans aucun mur, le polygone est inscrit dans le cercle de
   rayon `portee`, à la tolérance de discrétisation près.
5. **Le tri par portée est interne** : un appel avec 3000 segments et une portée de 10 ne coûte
   pas significativement plus qu'un appel avec les 89 segments à portée. Vérifié par mesure de
   comptage, pas par chronométrage — un test qui chronomètre est instable en CI.
6. Un mur **oblique** occulte comme un mur aligné : rien dans le code ne doit privilégier les
   axes.
7. `js/vision/sweep.js` n'importe **que** `core/*`. Le test d'architecture n°6 le vérifie déjà.
8. La section de `diag.html` rend la grille du §4 et affiche « à vérifier sur la tablette ».
9. `pnpm run verify` vert, suite unitaire toujours sous 10 s.

## 6. Ne pas faire

- **Ne pas** écrire un sweep angulaire à ensemble actif (§2.2). On mesure d'abord.
- **Ne pas** importer `grid/*` depuis `vision/*`, ni raisonner en cases.
- **Ne pas** faire l'union des polygones de plusieurs pions : c'est L-03.
- **Ne pas** toucher au fog, au rendu, ni à `blockedEdges.js` : L-01 est clos.
- **Ne pas** cocher le critère 13, ni écrire « 30 fps tenus » (interdiction n°14).
- **Ne pas** chronométrer dans un test unitaire : la CI est bruitée, et le projet a déjà payé
  trois budgets en horloge murale (`ETAT.md`, § instabilité de la suite navigateur).
- **Ne pas** ajouter de fichier hors manifeste. `sweep.js` y est déjà ; le dossier `js/vision/`
  est à créer.

## 7. Attendu en fin de tâche

Un rapport de **3 lignes**, puis **arrêt**. Aucun commit.
