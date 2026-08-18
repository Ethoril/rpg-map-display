# UX-13 — « Remplacer l'étage courant » à l'import d'image

> Écrit le 18 août 2026, en fin de fenêtre de travail. **C'est la dernière tranche du brief
> `BRIEF-GEMINI-UX-MJ.md`** : UX-01 à UX-12 et UX-14 sont livrées, poussées et vertes en CI.
>
> ⛔ Sa dépendance est **levée** : UX-14 est faite, la réserve existe.

## Ce qu'elle demande

L'onglet Image propose deux gestes au choix :

| | Les pions | La carte, côté joueurs |
|---|---|---|
| **Ajouter un étage** | ne bougent pas | **pas affichée** — livré par UX-01 |
| **Remplacer l'étage courant** | retournent **en réserve** | **affichée immédiatement**, quitte à être toute noire tant qu'aucun pion n'y porte de ligne de vue |

## Ce qui est déjà en place, et qu'il faut réutiliser

- `store.reserveToken(tokenId)` et l'événement `token.reserve` — UX-14. Un pion rangé garde ses
  PV, ses marqueurs et son nom.
- `store.updateLevel(levelId, patch)` — la mutation de contenu d'étage existe déjà.
- Le point d'insertion est `js/ui/gm/importPanel.js:434-500`, dans le gestionnaire de
  `#btn-validate-image-import`. Toute la calibration, la normalisation d'URL et la sonde de
  chargement sont là et n'ont pas à bouger.

## ⭐ « Affichée immédiatement » veut dire quelque chose de précis depuis UX-10

Les deux vues sont découplées : **le MJ ne peut plus emmener la table**. « Affichée
immédiatement » ne peut donc pas signifier « la table bascule sur cet étage ». Ce que ça signifie,
et c'est ce qui distingue Remplacer d'Ajouter : **l'étage est muté sur place**, donc quiconque
l'affiche déjà — et c'est le cas courant, c'est l'étage courant — voit la nouvelle carte à la
seconde. Aucune sélection ne change, aucun écran ne se déplace.

⚠ C'est aussi ce qui rend Remplacer indispensable : un étage **ajouté** n'a aucun masque exploré,
donc il n'apparaît pas dans le sélecteur des joueurs (UX-12). Le MJ ne peut pas montrer une carte
neuve à la table en l'ajoutant. Remplacer est le seul chemin.

## ⛔ Le brouillard de l'étage remplacé doit être remis à zéro

Sinon la forme révélée de l'**ancienne** carte se lirait par-dessus la nouvelle — une fuite, et
une carte incompréhensible. C'est exactement ce que dit le brief par « quitte à être toute noire
tant qu'aucun pion n'y porte de ligne de vue » : plus aucun pion sur l'étage (ils sont en réserve),
donc plus aucune ligne de vue, donc noir. Le noir est le résultat **attendu**, pas un défaut.

⚠ **Le piège** : si les dimensions de la nouvelle carte sont identiques à l'ancienne,
`getExploredFog` (`js/app/gm.js:143`) **réutilise le masque existant** — il ne le recrée que si
`widthCells`/`heightCells` diffèrent. Compter sur le changement de dimensions serait un faux vert :
le test passerait avec une carte 12×8 → 20×15 et échouerait en séance sur deux cartes de même
taille. Il faut donc un effacement **explicite**.

Le geste existe déjà : `js/ui/gm/fogTools.js` le fait pour « Masquer tout » — `fog.clear()` puis
`scheduleFogPublish()`. Il n'est pas exposé. Le plus court est de l'exposer sur l'API de
`fogTools` pour un `levelId` donné, et de le passer au panneau d'import par un rappel injecté,
comme tout le reste du répertoire.

## ⛔ Un événement réseau de plus, et un seul

`level.add`, `level.grid`, `level.ambient` et `level.select` existent ; **aucun** ne remplace le
contenu d'un étage. Il faut donc `level.replace` portant `{ levelId, level }`, validé avant
mutation, enveloppé dans un `try`/`catch` qui journalise et rend `false` — la forme des voisins.

Les pions, eux, partent par autant de `token.reserve` qu'il y a de pions sur l'étage : l'événement
existe, il est idempotent, et le rejeu d'un lot converge. ⛔ Ne pas inventer un événement composite
qui ferait les deux : `CONVENTIONS.md` §4 interdit les événements imbriqués, et un lot de deux
types déjà éprouvés vaut mieux qu'un troisième à éprouver.

Amender `docs/CAHIER-DES-CHARGES.md` §7 dans la même tranche, comme l'ont fait UX-05, UX-07 et
UX-14.

## Critères d'acceptation

1. L'onglet Image propose les deux gestes, et « Remplacer » est **désactivé s'il n'y a pas d'étage
   actif** — il n'y a rien à remplacer.
2. Après remplacement : l'étage courant porte la nouvelle `imageUrl`, ses nouvelles dimensions et
   sa nouvelle densité ; **son identifiant ne change pas**, et aucun étage n'est ajouté.
3. Tous les pions qui étaient sur cet étage sont **en réserve**, avec leurs PV et leurs marqueurs.
   Ceux des autres étages n'ont pas bougé.
4. Le masque exploré de l'étage est vide après remplacement, **y compris quand la nouvelle carte a
   exactement les mêmes dimensions que l'ancienne**. ⚠ C'est le critère qui attrape le piège
   ci-dessus ; un test qui change les dimensions ne prouve rien.
5. La vue joueurs qui affichait cet étage affiche la nouvelle carte **sans changer d'étage**, et
   la vue MJ ne déplace personne.
6. « Ajouter un étage » conserve exactement le comportement d'UX-01 : les pions ne bougent pas, et
   la table ne bascule pas.
7. **Deux preuves par mutation.** (a) Ne pas ranger les pions → le critère 3 rougit. (b) Ne pas
   effacer le masque, avec deux cartes **de mêmes dimensions** → le critère 4 rougit.

## Pourquoi cette tranche n'a pas été faite dans la même fenêtre

Par prudence, pas par blocage : elle traverse quatre fichiers de plus (`importPanel.js`,
`fogTools.js`, `panel.js`, `networkEvents.js`) et porte deux pièges — le masque de mêmes
dimensions, et le sens exact de « affichée immédiatement » depuis le découplage. La bâcler en fin
de fenêtre aurait produit le genre de faux vert que ce dépôt paye ensuite en séance.

---

# Amendement du 18/08/2026 — arbitrage du mainteneur et revue du plan d'implémentation

> Écrit après lecture du plan d'implémentation de Gemini. Ce qui suit **prime sur les sections
> ci-dessus** partout où les deux se contredisent.

## ✅ Arbitrage du mainteneur : la géométrie est effacée

**« Remplacer » vide `walls`, `portals` et `lights`.** J'avais soulevé le risque — l'usage le plus
probable est un meilleur scan de *la même* carte, et l'effacement détruit alors des heures de
tracé sans retour possible. **Le mainteneur a tranché pour l'effacement**, sans confirmation
supplémentaire. C'est donc le comportement à implémenter.

⛔ Ne pas ajouter de boîte de dialogue « êtes-vous sûr ». Elle a été explicitement écartée : un
dialogue de plus en pleine séance coûte plus qu'il ne protège. Le geste est nommé « Remplacer », et
il remplace.

## ⛔ Une SEULE transaction, et c'est le point le plus important de cette tranche

Le plan enchaîne `store.reserveToken()` × N **puis** `store.updateLevel()`. Ce sont deux
transactions, et leur ordre est **forcé** : les pions doivent quitter le plateau avant que la carte
rétrécisse, sinon `assertValidCampaign` refuse la mutation pour « position hors limites de
l'étage ». Donc si `updateLevel` échoue, le MJ se retrouve avec **un plateau vide et l'ancienne
carte** — état à moitié appliqué, sans annulation, devant la table.

**Il faut donc `store.replaceLevelMap(levelId, patch)`**, qui sur **un seul** `structuredClone` :
déplace les pions de cet étage vers `reserve`, vide `walls`/`portals`/`lights`, applique le patch,
`assertValidCampaign`, `replaceCampaign`, **une seule** `notifySubscribers`. Le panneau publie
ensuite les événements, une fois la mutation acquise.

⚠ C'est la forme de **toutes** les mutations de ce store, et le commentaire de `removeToken` dit
pourquoi elle a été généralisée : « avec un `splice`, l'état fautif serait déjà en place quand on
s'en apercevrait ».

## ⚠ L'événement porte un `patch`, pas un `level`

Le plan nomme le champ `level` alors qu'il contient un partiel. C'est trompeur pour le prochain
lecteur, et le dépôt a déjà sa convention : `token.update` porte `{ tokenId, patch }`, avec des
**valeurs absolues** et non des deltas — c'est ce qui le rend rejouable. Donc
`level.replace` → `{ levelId, patch }`.

## ⚠ `clearFog(levelId)` publierait le masque d'un autre étage

Le `scheduleFogPublish` injecté dans le panneau n'est pas celui de `gm.js` : c'est l'emballage
`(immediate = true) => { … }` de `js/app/gm.js`, qui **résout lui-même l'étage actif** et ignore
tout identifiant. Un `clearFog(levelId)` qui honore `levelId` pour effacer et l'ignore pour publier
est une API qui ment — elle marche pour UX-13, où l'étage remplacé *est* l'étage actif, et elle
piège le premier appelant suivant.

Deux issues acceptables : `clearFog()` **sans paramètre**, qui agit sur l'étage actif et le dit ;
ou élargir le publieur injecté pour qu'il accepte un `levelId`. La première suffit ici.

⚠ Et il faut **vider la pile d'undo** de cet étage, sans y pousser d'état au préalable : annuler
ramènerait la forme révélée de l'*ancienne* carte sur la nouvelle.

## ⚠ Le masque de vision VISIBLE n'est pas traité par le plan

Seul l'exploré est effacé. `store.getSessionVision(levelId)` garde le polygone visible de l'ancienne
carte, et la vue joueurs le lit (`getPlayerVisibleCanvas`). Il *devrait* finir vide, puisque plus
aucun pion n'a de ligne de vue sur cet étage — mais c'est une hypothèse sur l'ordonnancement de
`syncVision`, pas une vérification. **À passer en critère e2e**, sinon c'est un faux vert en
attente.

## ⚠ Pas de `store.subscribe` dans `importPanel`

`createImportPanel` ne rend que `{ drawCalibrationPreview }` : aucun `destroy`, donc aucun endroit
pour se désabonner, donc une fuite à chaque démontage du panneau. Exposer un `refresh()` et le
faire appeler par l'abonnement **déjà existant** de `panel.js`, exactement comme
`templateTools.refresh()` depuis UX-05.

## Mineur, à signaler et pas forcément à corriger

Les nouvelles dimensions peuvent laisser la caméra hors cadre après remplacement. Si tu ne le
traites pas, dis-le dans ton rapport plutôt que de le laisser se découvrir en séance.

## Critères d'acceptation — révisés

Les critères 1, 5, 6 et 7 de la section précédente sont inchangés. Les autres deviennent :

2. Après remplacement : l'étage porte la nouvelle `imageUrl`, ses nouvelles dimensions, sa nouvelle
   densité et son nouveau calage de grille ; **son identifiant ne change pas**, aucun étage n'est
   ajouté, et `walls`, `portals` et `lights` sont **vides**.
3. Tous les pions qui étaient sur cet étage sont en réserve, avec leurs PV et leurs marqueurs.
   Ceux des autres étages n'ont pas bougé.
4. Le masque exploré **et** le masque de vision visible de l'étage sont vides après remplacement,
   **y compris quand la nouvelle carte a exactement les mêmes dimensions que l'ancienne**.
8. ⭐ **Atomicité** : si la mutation est refusée — par exemple une calibration qui produirait un
   étage invalide — **rien** n'a changé : les pions sont toujours sur le plateau, la carte est
   toujours l'ancienne. Un test doit provoquer ce refus, et pas seulement le cas nominal.
9. **Trois preuves par mutation**, au lieu de deux : les deux prévues, plus (c) **casser
   l'atomicité** — ranger les pions puis échouer sur l'étage — et vérifier que le critère 8
   rougit.
