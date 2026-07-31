# Cartes UVTT — principe et workflow cible

## L’idée essentielle

Le fichier `.uvtt` reste la source de vérité d’une carte.

Il contient à la fois :

- l’image de fond ;
- la taille et l’origine de la grille ;
- les murs (`line_of_sight` et `objects_line_of_sight`) ;
- les portes et ouvertures (`portals`) ;
- les lumières ;
- l’indication d’un éclairage déjà intégré à l’image (`baked_lighting`).

La préparation d’une carte ne doit supprimer aucune de ces informations.

## Pourquoi deux fichiers sont utilisés par l’application

Un UVTT contient son image sous forme de texte encodé. C’est pratique pour transporter une
carte dans un seul fichier, mais moins adapté à une application publiée :

- le fichier est plus lourd à télécharger ;
- chaque navigateur doit redécoder l’image ;
- l’image encodée ne doit pas être copiée dans Firebase ou LocalStorage ;
- une grande carte consomme beaucoup de mémoire si elle n’est pas redimensionnée.

La préparation décompose donc l’UVTT en deux artefacts complémentaires :

```text
scène JSON : grille + murs + portes + lumières
image       : fond optimisé pour Canvas
```

Ce n’est pas une conversion de l’UVTT en « simple image ». C’est l’équivalent d’une
compilation : l’UVTT reste la source, et la scène produite doit conserver toute sa structure.

Le format de l’image produite est un détail interne. L’utilisateur ne doit ni choisir le
format, ni écrire son chemin dans l’interface.

## État actuel

Le parseur `js/import/uvtt.js` extrait déjà :

- la grille ;
- les murs ;
- les portails, avec `closed` et `freestanding` ;
- les lumières ;
- l’éclairage ambiant ;
- l’image intégrée.

Ces données sont bien placées dans le modèle `Level`.

En revanche :

- l’interface demande encore manuellement une URL d’image ;
- il n’existe pas encore de bibliothèque lisant les cartes disponibles dans `maps/` ;
- les murs, portes et lumières sont conservés, mais leur rendu et leur interaction relèvent
  des prochains lots vision/fog/éclairage.

## Workflow cible pour le mainteneur

Une fois le plan d’implantation terminé :

1. déposer `manoir-rdc.uvtt` dans `maps/` ;
2. lancer une seule commande de préparation ;
3. vérifier que « Manoir — RDC » apparaît dans la bibliothèque ;
4. commiter et pousser les fichiers générés avec le dépôt ;
5. sélectionner la carte dans l’outil publié.

Le mainteneur ne doit pas :

- extraire lui-même l’image ;
- connaître ou saisir un chemin WebP ;
- modifier le JSON produit ;
- saisir une URL ;
- réimporter la carte depuis son ordinateur pendant une séance.

GitHub Pages héberge les artefacts placés dans `maps/` avec le reste du site. Le catalogue
permet à l’application de connaître leur liste, car un site statique ne peut pas parcourir
directement le contenu d’un répertoire. Les **sources** d’export, elles, ne sont plus
commitées : elles ne sont jamais téléchargées à l’exécution, et elles pèsent lourd.

### Les deux façons de préparer

| Geste | Ce que ça fait |
|---|---|
| **double-clic sur `outil-cartes.cmd`** | démarre l'outil local et ouvre la page. Tout se pilote ensuite dans l'interface |
| `pnpm maps:prepare` | passe complète, sans interface. Utile en script ou en CI |

Le double-clic est le geste normal. `pnpm maps:tool` fait la même chose depuis un terminal,
pour qui préfère.

**Pourquoi un lanceur, et pas simplement la page ?** Un navigateur n'a pas le droit de démarrer
un processus sur la machine — barrière de sécurité, pas manque du projet. Or la préparation
d'image vit en Node et n'a qu'une implantation. Le lanceur réduit donc cette contrainte à un
double-clic, et le serveur ouvre la page lui-même. Fermer la fenêtre noire arrête l'outil ; un
second double-clic pendant que l'outil tourne rouvre simplement la page.

L’outil local (chantier L) sert à **décider** avant de committer : il fabrique une carte à la
fois, montre le résultat, et met deux réglages côte à côte. Trois choses à savoir :

- ses variantes vont dans `maps/.preview/`, jamais dans `maps/generated/` ;
- **il ne publie jamais un réglage particulier.** Le bouton « Publier » relance la passe
  complète avec les constantes du dépôt. Un réglage publié au coup par coup serait écrasé sans
  un mot au prochain `maps:prepare` — le réglage retenu se fixe dans `scripts/resample.mjs` ;
- il n’existe que sur la machine du mainteneur. La page est déployée avec le site, mais elle
  y est inerte et le dit.

Depuis le chantier L, les deux commandes **ne réencodent que ce qui a changé** : une passe sans
modification est passée de 74 s à 0,1 s. Le cache tient compte de la source, des réglages **et
du code du pipeline** — une correction de `resample.mjs` invalide donc tout, ce qui évite de
servir des artefacts périmés avec un air d’être à jour.

> **Consigne d’export, la seule à retenir : 140 px/case ou plus.** En dessous, la chaîne ne
> peut que rendre ce que la source contient, et elle le signale.

## Limite fonctionnelle à ne pas masquer

Charger correctement une scène UVTT et exploiter toutes ses données sont deux étapes
différentes.

La bibliothèque prévue par ce document garantit que murs, portes et lumières arrivent
intacts dans le store. Elle ne suffit pas, à elle seule, à produire :

- le brouillard de guerre ;
- le calcul de vision ;
- les ombres ;
- l’éclairage dynamique ;
- l’ouverture interactive des portes.

Ces fonctions devront consommer les données UVTT déjà conservées, sans demander une nouvelle
importation de la carte.

