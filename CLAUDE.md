# rpg-map-display — à lire avant d'agir

VTT minimaliste pour jeu de rôle en table physique : le MJ sur Mac (nœud autoritaire pour la
vision, le fog et la persistance), les joueurs sur une Galaxy Tab S9 FE castée vers la TV.
Rien d'autre : pas de fiches, pas de dés, pas de tchat.

## Où est la vérité

| Question | Document |
|---|---|
| Où en est le projet ? | ⭐ la **table « Suite produit »** de `docs/ETAT.md` — **pas** son chapeau, qui a déjà dérivé |
| Que faut-il construire, et pourquoi ? | `docs/CAHIER-DES-CHARGES.md` |
| Quelles décisions attendent le mainteneur ? | `docs/QUESTIONS-EN-ATTENTE.md` |
| Comment nomme-t-on et convertit-on ? | `docs/CONVENTIONS.md` — **normatif** |
| Quels fichiers ont le droit d'exister ? | `docs/ARCHITECTURE.md` — **normatif et fermé** |
| Quelles versions et quels idiomes ? | `docs/STACK.md` — **normatif** |

Ces trois documents normatifs priment sur toute habitude venue d'un autre projet.

## Les cinq règles qui ne se discutent pas

1. **Zéro build.** Site statique, ES modules natifs, aucun bundler. JavaScript avec `// @ts-check`
   et JSDoc strict — jamais `@ts-nocheck` ni `@ts-ignore`. Aucune dépendance runtime hors Firebase
   12.16.0, épinglée.
2. **Manifeste fermé.** Aucun fichier créé s'il n'est pas listé dans `ARCHITECTURE.md` §1. Un besoin
   non couvert **se signale, il ne s'improvise pas**.
3. **Quatre espaces de coordonnées, jamais mélangés** — `Cell {a,b}`, `CellPoint {cellX,cellY}`,
   `MapPoint {x,y}`, `ScreenPoint {screenX,screenY}`. Les noms de propriétés sont distincts exprès :
   c'est ce qui rend le mélange impossible à compiler. Trois conversions, trois seuls endroits :
   `CellPoint ⇄ MapPoint` et `Cell ⇄ MapPoint` dans `js/grid/*`, `MapPoint ⇄ ScreenPoint` dans
   `js/render/camera.js`. **Aucune arithmétique `pxPerCell` ailleurs.**
4. **Rien ne se déplace dans le dos de personne.** Ajouter un étage n'emmène pas la table, importer
   une carte ne replace aucun pion, franchir un escalier ne fait basculer aucun écran. Devant un cas
   nouveau que la spec ne tranche pas, **appliquer cette règle plutôt que demander**.
5. **En cas de doute, s'arrêter et demander.** Ne jamais « choisir raisonnablement » sur un point
   traité par un document normatif.

## La porte

```bash
pnpm run verify
```

typecheck → `check-deps` → 454 unitaires → e2e Playwright → gestes. ⚠ `pnpm run test:manuel` est
**hors porte** : `verify` ne couvre pas le geste réel.

**Ce qui entre dans la porte** : un jugement reproductible. **Ce qui n'y entre pas** : une mesure —
elle dépend de la machine, donc elle serait instable, donc désactivée un jour. Les invariants
d'architecture sont déjà des tests (`tests/architecture.test.mjs` : `pxPerCell` hors `GridAdapter`,
imports interdits, URL CDN, fichiers hors manifeste).

## Vérifier, jamais croire

Le code de ce projet est en partie écrit par un autre modèle, et **chaque livraison relue dans
l'arbre de travail a révélé au moins un écart avec son compte rendu**. Un test vert ne prouve rien
tant qu'on n'a pas cassé le mécanisme qu'il prétend couvrir et vu le rouge : `/muter`.

⚠ **Muter l'effet, pas l'étiquette.** Un test qui relève un drapeau au lieu du comportement passe au
vert sur une panne réelle. Douze faux verts ont déjà été attrapés ainsi.

## Interdictions courantes

- **Vue joueurs** : pas de drag & drop de pion (un doigt qui glisse = pan de carte), aucune UI hors
  overlay transitoire. Le drag tactile a été testé puis **aboli** — le remettre est une régression.
- **Réseau** : rien publié pendant un drag MJ avant `pointerup` ; positions en RTDB, jamais en
  Firestore. Sur le réseau et en persistance ne circulent que des coordonnées de cellule.
- **Performance** : aucun critère de perf coché sans mesure sur le matériel physique.
- **Licence des cartes** : ⛔ le domaine du mainteneur. Jamais un blocage technique, jamais une
  raison de ne pas livrer.

## Git

Deux machines (Mac et poste Windows) synchronisées **par git seulement** : ce qui n'est pas poussé
n'existe pour aucune autre. `git fetch` puis lire **les deux sens** avant toute analyse — il y a déjà
eu 11 commits de retard d'un côté et 4 non poussés, donc non vérifiés, de l'autre.

Commits **sur demande**, pas spontanés.
