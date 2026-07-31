# TRANCHE L-03 — union des champs de vision des PJ, rendue côté MJ

> Troisième tranche du **Lot 2 du CdC §11**. Découpage : `PLAN-LOT2.md`. Dépend de L-01
> (arêtes bloquées) et L-02 (`vision/sweep.js`), toutes deux livrées.
>
> Elle ne ferme aucun critère à elle seule. C'est la **première tranche visible à l'écran** :
> le MJ voit enfin ce que ses joueurs voient. Le fog persistant, les trois états de rendu et
> le masquage côté joueurs sont L-04.
>
> ⚠ « Tranche L-03 » ≠ « chantier L » (outil de cartes).

---

## 1. Ce qu'il faut écrire

Pour chaque pion **PJ porteur de vision** de l'étage actif : un sweep. Puis rendre l'union de
ces polygones sur la vue MJ.

Rien d'autre. Pas de fog, pas de persistance, pas de réseau, pas de masquage joueurs.

### L'union ne demande AUCUNE géométrie booléenne

Le piège serait d'implémenter une union de polygones — algorithme lourd et fragile. Inutile :
**Canvas 2D remplit nativement l'union d'un chemin à plusieurs sous-chemins.** On ouvre un
chemin, on y ajoute chaque polygone comme sous-chemin (`moveTo` puis `lineTo`, puis
`closePath`), et **un seul `fill()`** produit l'union. Les recouvrements sont absorbés par la
règle de remplissage.

C'est plus court, plus rapide, et sans cas dégénéré. Ne pas chercher mieux.

---

## 2. Le plafond de vision — 20 cases, et pourquoi il est là

**Décision du mainteneur du 31/07/2026.** À porter dans une constante, pas en dur au point
d'usage.

Ce plafond n'est **pas** une règle de jeu : c'est une borne technique. Le sweep teste tous
les segments *à portée* sans savoir d'avance lesquels seront masqués — mesuré sur la carte de
test, 1338 segments traités pour **284 réellement visibles**. Sans borne, un pion en zone
éclairée coûte **347 ms pour six pions** au lieu de 2 ms. Détail dans `ETAT.md`.

**Conséquence à coder :** le rayon effectif d'un pion est `min(visionDim, plafond)`. Un pion
réglé à 50 cases est ramené à 20, **sans erreur et sans message** — c'est une borne, pas une
faute de saisie.

### Quelle portée pour un pion, au juste

`visionBright` / `visionDim` sont définis par le CdC comme la **vision dans le noir**, et le
modèle d'éclairage est le lot 3. Pour cette tranche, prendre **`visionDim` seul**, plafonné.

Écrire dans le code que c'est une simplification assumée en attendant l'éclairage, et non un
oubli. Un pion à `visionDim: 0` ne porte aucune vision et ne produit aucun polygone.

---

## 3. Le partage d'autorité, à ne pas inverser

`PLAN-LOT2.md` §3 : **la vision et le fog se calculent sur le Mac seul**, le MJ étant le nœud
autoritaire (CdC §4). Les tablettes recevront un résultat, elles ne calculeront rien.

Pour L-03 c'est simple, puisque rien ne part sur le réseau : **le calcul vit côté MJ, et
uniquement là.** Ne rien ajouter dans `js/ui/player/` ni dans `js/app/player.js`. La
publication vers les joueurs est le sujet de L-04.

---

## 4. Contraintes de structure

**`vision/*` ne peut importer que `core/*`.** `sweep()` travaille en coordonnées carte. La
conversion des murs (`CellPoint`) et de la portée (cases) vers les pixels carte appartient à
l'appelant.

**L'arithmétique case ↔ pixel passe par le `GridAdapter`, jamais à la main.** Interdiction
dure, vérifiée par le test d'architecture n°1 : il refuse toute mention de `pxPerCell` hors
de `js/grid/`. Utiliser `grid.mapFromCellPoint()` et `grid.pointFromCell()`. **Ce garde-fou a
déjà arrêté deux personnes sur ce lot, dont l'auteur de ce brief** — ce n'est pas une
formalité.

**Le rendu vit dans `render/layers/fogLayer.js`**, qui est au manifeste [2] et n'existe pas
encore. L-03 le crée pour l'aperçu MJ ; L-04 l'étendra aux trois états de rendu. Ne pas créer
de fichier supplémentaire.

### Une duplication à supprimer plutôt qu'à étendre

Extraire les segments d'un étage — murs plus portes non ouvertes — est **déjà écrit deux
fois** : dans `js/import/blockedEdges.js` (en coordonnées de case) et dans `js/app/diag.js`
(en coordonnées carte). L-03 en aurait besoin une troisième fois.

**Écrire un helper partagé et l'utiliser aux trois endroits.** `js/import/` peut importer
`grid/*`, donc il a sa place là, exporté depuis `blockedEdges.js` — aucun fichier nouveau,
aucun amendement du manifeste. Trois copies d'une même règle divergeront, et la règle en
question est « une porte ouverte ne bloque pas » : la voir diverger coûterait une séance.

---

## 5. Le rendu attendu

Le MJ n'est **jamais** masqué (CdC : « les zones hors vision sont masquées côté joueurs, pas
côté MJ »). L-03 lui donne donc une **indication**, pas un masque : la zone actuellement vue
par les PJ, en surimpression légère, par-dessus la carte et sous les pions.

Le CdC parle de « visualisation en semi-transparence de tout ce qui est caché aux joueurs »
(§5.7). L'ergonomie exacte se raffine à l'usage — fixer une surimpression lisible et passer à
la suite, pas y consacrer la tranche.

**Rendu à la demande.** L'application n'a pas de boucle active au repos. Le recalcul se
déclenche sur changement : pion déplacé, pion ajouté ou retiré, étage changé, porte
basculée. **Pas à chaque image**, et surtout pas dans une boucle d'animation.

---

## 6. Critères d'acceptation

1. Deux PJ éloignés produisent **deux zones visibles disjointes** ; rapprochés, une seule
   zone connexe. C'est la preuve que l'union fonctionne.
2. Un PNJ, un pion à `visionDim: 0` et un pion d'un autre étage **ne contribuent pas**.
3. Un mur coupe la zone visible ; **ouvrir une porte l'étend des deux côtés**.
4. Un pion réglé à 50 cases est ramené à 20 sans erreur, et la zone visible ne dépasse pas
   20 cases.
5. Le recalcul se produit **uniquement** sur changement, jamais par image. Vérifié par un
   compteur d'appels, pas par un chronomètre — la CI est bruitée et ce projet a déjà payé
   trois budgets en horloge murale.
6. Le helper d'extraction des segments est **partagé** : `blockedEdges.js`, `diag.js` et le
   nouveau code l'appellent tous. Aucune troisième copie.
7. Rien n'est ajouté sous `js/ui/player/` ni `js/app/player.js`.
8. `pnpm run verify` vert, suite unitaire sous 10 s, `pnpm run check-deps` vert.

## 7. Ne pas faire

- **Ne pas** implémenter d'union booléenne de polygones (§1).
- **Ne pas** écrire de balayage angulaire ni toucher à `sweep.js` : L-02 est close, et la
  piste d'accélération est documentée dans `ETAT.md` pour *après* L-04.
- **Ne pas** faire de fog, de persistance, de masquage joueurs ni de réseau : c'est L-04.
- **Ne pas** calculer la vision côté joueurs (§3).
- **Ne pas** nommer `pxPerCell` hors de `js/grid/` (§4).
- **Ne pas** recalculer par image (§5).
- **Ne pas** créer de fichier hors manifeste : `fogLayer.js` y est déjà.

## 8. Attendu en fin de tâche

Un rapport de **3 lignes**, puis **arrêt**. Aucun commit.
