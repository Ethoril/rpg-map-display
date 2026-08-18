---
name: muter
description: Prouve par mutation qu'un test échoue vraiment quand le mécanisme qu'il prétend couvrir est cassé. À lancer avant de déclarer un critère tenu, et sur toute livraison écrite par un autre modèle.
disable-model-invocation: true
---

# Muter — la preuve par la panne

Un test vert prouve qu'il passe. Il ne prouve pas qu'il **échouerait** si le produit était cassé.
Douze faux verts ont déjà été attrapés sur ce projet ; tous passaient au vert sur une panne réelle.

⛔ **Ne jamais déclarer un critère tenu sur la seule foi d'une suite verte** — ni de la sienne, ni
surtout du compte rendu d'un autre modèle.

## Avant de commencer

⚠ **L'arbre de travail doit être propre.** La mutation se révoque par restauration du fichier, ce qui
emporte toute édition non commitée faite en parallèle. Si l'arbre est sale : commiter d'abord, ou
travailler dans un worktree séparé.

```bash
git status --porcelain
```

## La procédure

### 1. Nommer le mécanisme, pas le test

Écrire en une phrase **ce que le produit fait** et que le test prétend garantir. Pas « le test de la
porte passe » mais « une porte fermée bloque la ligne de vue ».

Si la phrase ne se laisse pas écrire, le test ne couvre rien de nommable — c'est déjà le résultat.

### 2. Choisir la mutation : l'effet, pas l'étiquette

⭐ **C'est ici que tout se joue.** Casser le drapeau, le nom, le compteur ou le statut que le test
relève ne prouve rien : il faut casser **le comportement lui-même**, en laissant intact tout ce que
le test observe directement.

| ✅ Muter l'effet | ❌ Muter l'étiquette |
|---|---|
| Faire que la porte fermée n'ajoute plus son segment | Renommer l'état de la porte |
| Ne pas publier l'événement du tout | Changer le libellé publié |
| Rendre le calcul faux tout en gardant le drapeau à `true` | Mettre le drapeau à `false` |

Si le test reste vert après une mutation de l'effet : **il est faux**, quel que soit son nom.

### 3. Muter, relancer, exiger le rouge

Casser dans le code de **production** — jamais dans le test — puis relancer exactement la commande
qui prétendait prouver le critère :

```bash
node --test tests/<le-fichier>.test.mjs
```

- **Rouge** → le test tient. Noter *quelle* mutation l'a fait rougir : c'est la preuve, pas le vert.
- **Vert** → faux vert. Ne pas réparer le test tout de suite : d'abord comprendre **pourquoi** il ne
  voyait rien, parce que la cause se répète en général sur ses voisins.

### 4. Restaurer et vérifier la restauration

```bash
git diff --stat
```

L'arbre doit être revenu exactement à son état d'avant. Ne pas laisser une mutation derrière soi.

### 5. Rapporter

Trois lignes : le mécanisme, la mutation appliquée, ce qui s'est passé. Si un test était faux, dire
**ce qu'il croyait mesurer** et ce qu'il mesurait réellement.

## Les familles de faux verts déjà rencontrées ici

À essayer en priorité — chacune a déjà démasqué un test de ce dépôt :

1. **Le test relève un drapeau au lieu du comportement.** La survie d'un outil armé était prouvée sur
   `getActiveToolName()` ; casser `canStartBrush` en laissant le drapeau intact laissait le vert.
2. **Deux valeurs relevées, jamais comparées.** Un critère lisait `bgStatus` et `bgUrl` côté joueurs
   sans les confronter — et l'ancienne carte étant la **même image** que la nouvelle, ne rien publier
   du tout gardait les deux scénarios verts.
3. **La fixture ne peut pas distinguer les deux cas.** Ancienne et nouvelle valeur identiques, ou
   `map_origin` à `{0,0}` sur tout le corpus : le test ne peut pas voir le défaut qu'il vise.
4. **La fenêtre de mesure évite le cas.** Un test vidéo tournait à `?duree=8` sur un flux de 30 s :
   la boucle ne repassait jamais par zéro, donc le bug de bouclage était hors de portée.
5. **Le mock implémente l'inverse du mécanisme testé.** Le test valide alors le mock.
6. **Le critère n'est pas implémenté du tout**, et rien ne le signale — personne ne teste l'absence.
7. **Le test exerce le bouton, pas la grandeur.** Il prouve que l'action se déclenche, jamais que son
   résultat est juste.

## Ce que la mutation ne remplace pas

- Une **mesure** de performance : elle dépend de la machine, elle n'entre pas dans la porte. Séparer
  le calcul (assertable, déterministe) de la lecture (dépendante du matériel), et n'asserter que le
  calcul.
- Le **geste réel** : `pnpm run test:manuel` est hors porte, et rien n'y supplée.
