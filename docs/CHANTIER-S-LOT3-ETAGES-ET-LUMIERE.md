# Chantier S — Lot 3 : étages & lumière

> **Statut : brief écrit puis mis en œuvre dans la même séance**, nuit du 6 au 7 août 2026, en
> autonomie. Le mainteneur a demandé de trancher sans attendre ses arbitrages et de consigner
> chaque choix avec ses alternatives — c'est le §0, et le rapport final reprend les mêmes.
>
> Lot 3 du CdC §11, **0 sur 6** à l'ouverture.

---

## 1. Ce qui existe déjà — mesuré avant d'écrire quoi que ce soit

Le lot est à 0 sur 6 **en comportement**, mais les emplacements de données sont largement en place.
Distinguer les deux évite d'écrire une liste de vœux.

| élément | état mesuré |
|---|---|
| Plusieurs étages dans la campagne | ✅ `campaign.levels[]`, `store.selectLevel()` avec validation |
| Fog par étage | ✅ `sessionFogMap` indexé par `levelId`, persisté par étage dans `localStorage` |
| `links` (liaisons) | ⚠ **Emplacement vide** : créé à `[]` par le schéma, lu par personne |
| `token.emitsLight` | ⚠ **Emplacement vide** : normalisé par le schéma, consommé par personne |
| `level.lights` | ⚠ **Parsé puis jeté** : `uvtt.js` les lit, aucun module ne les consomme |
| `level.ambient.level` | ⚠ **Parsé puis jeté**, en 0..1 |
| `baked_lighting` | ⚠ Signalé **à la préparation** seulement ; rien en séance |
| Sélecteur d'étage MJ | ⛔ **Inexistant** — aucune interface, `selectLevel` n'est appelé qu'au démarrage |
| Événement réseau de bascule | ⛔ **Inexistant** — `level.add` et `level.grid` existent, pas `level.select` |

⭐ **Le manque central des critères 1 et 2 est là** : changer d'étage côté MJ ne déplace pas la
tablette, faute d'événement. Tout le reste du lot s'appuie dessus.

⚠ **Le critère 3 est peut-être déjà satisfait** — le fog est indexé et persisté par étage — mais
**aucun test n'utilise deux étages**. « Probablement juste, jamais vérifié » n'est pas « acquis » :
c'est la première chose à éprouver, et si ça marche, c'est un critère gagné pour le prix d'un test.

---

## 0. Les arbitrages

**(1) Un pion ne voit jamais d'un étage à l'autre.** Chaque étage est un monde clos : vision, fog,
lumières, déplacement. Les mezzanines, balcons et puits de lumière sont hors lot.

> Alternative écartée — des ouvertures verticales déclarées entre étages. Elle demanderait un
> modèle de visibilité 3D que ni le format UVTT ni le sweep 2D ne portent, pour un cas que le
> mainteneur n'a pas demandé.

**(2) Une liaison est un point à point, bidirectionnelle par défaut.** `{ id, a: {levelId, cell},
b: {levelId, cell}, oneWay }`. Taper la case d'une extrémité téléporte à l'autre.

> Alternative écartée — des **zones** de liaison (plusieurs cases par escalier). Plus fidèle à un
> escalier réel, mais on peut poser deux liaisons côte à côte pour le même effet, et une zone
> demande une géométrie de plus à éditer, à synchroniser et à tester.

**(3) La bascule automatique suit le pion téléporté, et le cadenas la suspend.** Quand un pion
franchit une liaison, la vue joueurs bascule sur l'étage d'arrivée. Le cadenas est une bascule du
MJ, par session : armé, plus aucune bascule automatique, le MJ choisit l'étage à la main.

> C'est la lecture littérale du critère 4 — « le cadenas empêche la bascule auto quand le groupe
> est séparé ». Alternative écartée : basculer **seulement si tous les PJ** sont arrivés, ce qui
> automatise le jugement au lieu de le laisser au MJ. Un groupe peut être séparé volontairement,
> et c'est le MJ qui sait sur quel étage la table doit regarder.

**(4) La lumière est une seconde source de vision, unie à celle des pions, et bornée par les mêmes
murs.** Une source éclaire un disque, découpé par le sweep existant. L'ambiante décide si un pion
voit **sans** lumière.

> Alternative écartée — un modèle d'éclairage continu, avec atténuation et couleurs mélangées. Le
> CdC ne demande pas de dégradé, la vue joueurs est binaire (vu / pas vu), et une atténuation
> continue coûterait un rendu par pixel là où le projet tient par le sweep polygonal.

**(5) `baked_lighting: true` force l'ambiante à pleine lumière, et le dit.** Une carte dont
l'éclairage est déjà peint dans l'image ne doit pas recevoir une seconde couche.

> C'est la lecture littérale du critère 6 — « signalée et n'est pas double-éclairée ». Alternative
> écartée : ignorer les sources de lumière sur ces cartes. Mais une torche portée par un pion reste
> une information de **jeu**, pas seulement un effet ; on garde la vision qu'elle donne, on retire
> l'assombrissement ambiant.

---

## 2. Les tranches, dans l'ordre où elles se débloquent

### S-01 — Le fog par étage est indépendant *(critère 3)*

Éprouver ce qui existe. Deux étages, révéler sur l'un, vérifier que l'autre est intact, revenir,
vérifier que le premier est restauré. Si c'est vert, le critère est gagné pour le prix d'un test.

### S-02 — Sélecteur d'étage et bascule synchronisée *(critères 1 et 2, socle)*

- Un événement `level.select` porté au réseau.
- Un sélecteur d'étage dans le panneau MJ.
- La vue joueurs suit.

⚠ **La bascule doit republier la vision**, sinon la tablette arrive sur un étage sans masque — c'est
exactement le défaut de vision corrigé le 06/08 au matin, qui reviendrait par une autre porte.

### S-03 — Liaisons et téléportation *(critère 2)*

Poser une liaison côté MJ, taper la case côté joueurs, le pion se téléporte et la vue bascule.

### S-04 — Le cadenas *(critère 4)*

Bascule du MJ qui suspend la bascule automatique.

### S-05 — Lumières et ambiante *(critères 5 et 6)*

`token.emitsLight` et `level.lights` alimentent le masque de vision ; `ambient.level` décide de la
vision sans lumière ; `baked_lighting` force la pleine lumière et le signale.

---

## 3. Ce qu'il ne faut pas casser

- ⛔ **Aucun `getImageData` sur le chemin de déplacement** (critère 8 du lot 2).
- ⛔ **La vision reste calculée sur mutation du store, jamais dans `rAF`** — c'est ce qui la rend
  indépendante des frames que le navigateur accorde au MJ.
- ⚠ **Toute grandeur d'écran se divise par le zoom**, quatre occurrences déjà payées.
- ⚠ **Un `skip` n'est pas un échec**, et **un test vert sur du code juste ne prouve rien** : chaque
  tranche est éprouvée par mutation.
