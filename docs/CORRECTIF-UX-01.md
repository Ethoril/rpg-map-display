# Correctif UX-01 — la vue joueurs ne doit pas basculer sur l'étage ajouté

> Écrit le 16 août 2026, après relecture du travail livré. **Ce document ne remplace pas UX-01 dans
> `BRIEF-GEMINI-UX-MJ.md`** — il dit ce qui change, et pourquoi. La version à jour des critères
> d'acceptation est dans le brief.

## Avant tout : ce qui est bon, et qui ne bouge pas

Trois quarts du travail sont justes. **N'y retouche pas :**

- **`js/app/networkEvents.js`** — le durcissement de `level.add` est exactement dans le style de ses
  voisins : validation de forme, `try`/`catch`, journalisation avec la raison, `false` sans lever.
- **`js/ui/gm/panel.js`** — passer `transport` plutôt que `options.transport` colle au
  `createHandouts` monté deux lignes plus bas. Bon réflexe.
- **`js/ui/gm/importPanel.js`** — le champ d'adresse, la normalisation des liens Google Drive, le
  refus des URL non persistables, la sonde de chargement, la suppression du rappel mort
  `onImportImage` : tout cela est conforme et reste.
- **L'audit CORS statique** sur `imageCalibrate.js`, `importPanel.js` et `background.js` : c'était
  la bonne réponse à un piège qu'aucun test ne peut attraper. Garde-la dans ton rapport.
- Tes deux mutations mordaient pour les bonnes raisons.

⚠ **Ce correctif ne t'est pas reproché.** La décision qui suit a été prise par le mainteneur
**pendant** que tu écrivais, et l'ancienne version du brief demandait explicitement le comportement
que tu as implémenté. C'est une erreur de séquencement de ma part, pas une faute de la tienne.

## Ce qui change

Décision du mainteneur, mot pour mot :

> « quand je rajoute un étage, la map ne doit pas s'afficher immédiatement côté joueur, seulement
> quand ils iront (par eux-même ou par moi) »

⭐ **Ajouter un étage est un acte de préparation, pas un acte de séance.** Personne ne doit être
déplacé parce que le MJ a préparé le niveau suivant.

C'est une déclinaison d'une règle qui gouverne désormais tout le produit — **rien ne se déplace dans
le dos de personne** — et qui est née le même jour sur trois sujets sans rapport : l'ajout d'étage,
le replacement des pions à l'import, et le franchissement d'un escalier.

## La cause, et elle n'est pas dans ton code

`store.addLevel` **sélectionne** l'étage qu'il ajoute. Le réducteur `level.add` appelle cette même
fonction côté joueurs : la tablette bascule donc toute seule, sans que rien ne soit publié à ce
sujet.

## Ce qu'il faut faire

**`store.addLevel` ne sélectionne l'étage ajouté que s'il n'y avait pas d'étage actif.** C'est
l'initialisation d'une campagne — le seul cas où quelqu'un doit bien être choisi. Si un étage est
déjà actif, il le reste.

⛔ **La règle vaut pour les deux chemins, le local et le réseau.** Ne la mets pas seulement dans le
réducteur : le poste MJ appelle `store.addLevel` en direct, et il ne doit pas sauter non plus.

⚠ Vérifie les autres appelants de `addLevel` avant de changer sa signature ou son comportement —
notamment la restauration d'instantané et le chargement de scène, où la sélection initiale est
peut-être attendue.

## Le test à retourner

Ton test affirme aujourd'hui, lignes 261-277 de `tests/gmPanel.spec.mjs`, exactement ce qui est
désormais interdit :

```js
store.getActiveLevel()?.imageUrl === 'maps/minimal.webp'   // le joueur a basculé
expect(playerBgStatus.status).toBe('ready')                 // et il affiche la carte
```

Il devient, **en deux temps** :

1. **Après l'import** — l'étage est présent dans la campagne du joueur, avec son `imageUrl` ; mais
   `getActiveLevel()` n'a **pas changé** et la couche de fond n'affiche **pas** la nouvelle image.
2. **Puis le MJ change d'étage par la barre** — et alors seulement la tablette affiche la carte.
   ⭐ Ce second temps n'est pas décoratif : sans lui, le premier ne distingue pas « l'étage est bien
   arrivé » de « l'étage s'est perdu en route ».

Et un troisième cas, qui protège l'exception : **sur une campagne vide, le premier étage ajouté est
bien sélectionné.**

## Les deux mutations exigées

- **(a)** Coupe la propagation de `imageUrl` → le temps 2 rougit, **côté joueurs**. C'est ta
  mutation actuelle, elle reste valable.
- **(b)** ⭐ **Nouvelle** : fais sélectionner l'étage ajouté même quand un étage est déjà actif → le
  temps 1 doit rougir. Sans elle, **rien ne défend la règle « ajouter n'emmène personne »**, et elle
  se reperdra au premier remaniement. C'est la mutation la plus importante de cette tâche.

Donne dans ton rapport la réponse exacte du test pour chacune des deux.

## Ce qui n'est PAS dans ce correctif

⛔ Ne les ajoute pas, ils ont leur propre tranche :

- le geste « **remplacer l'étage courant** » à l'import — UX-13 ;
- la **réserve de pions** — UX-14, qui est encore sur un point d'arrêt ;
- le **sélecteur d'étage des joueurs** et le découplage des deux vues — UX-10 et UX-12 ;
- la **suppression d'un étage**, qui n'existe pas et qui attend deux arbitrages — C-7.
