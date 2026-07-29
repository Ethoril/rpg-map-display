# Plan d’implantation — bibliothèque de cartes UVTT

> Document d’implantation uniquement. Aucun élément décrit comme « cible » n’est supposé
> exister tant que ses critères d’acceptation ne sont pas validés.

## 1. Objectif

Permettre au mainteneur de préparer ses cartes avant la séance en déposant des fichiers
`.uvtt` dans `maps/`, puis de les sélectionner dans l’application publiée sans :

- choisir ou comprendre un format d’image ;
- saisir une URL ;
- réimporter un fichier dans le navigateur ;
- perdre les murs, portes, lumières ou données de grille ;
- stocker une image encodée dans LocalStorage, Firestore ou Realtime Database.

## 2. Décisions d’architecture

### 2.1 L’UVTT reste la source

Le `.uvtt` est le document éditable et transportable. Les fichiers JSON et image utilisés
par le runtime sont des artefacts générés.

Une régénération depuis le même UVTT et les mêmes options doit produire une scène
fonctionnellement identique.

### 2.2 Le runtime charge une scène préparée

Le navigateur ne charge pas l’image base64 de l’UVTT à chaque séance. La préparation :

1. parse l’UVTT ;
2. conserve grille, murs, portails, lumières et ambiance ;
3. extrait et optimise l’image ;
4. produit un document de scène validé ;
5. référence cette scène dans un catalogue statique.

Le catalogue et le JSON de scène doivent conserver une référence vers le fichier UVTT
source afin de garantir la traçabilité.

### 2.3 GitHub Pages reste l’hébergement

Tous les fichiers nécessaires au jeu sont committés sous `maps/`. Aucune API d’upload,
Firebase Storage ou fonction serveur n’est nécessaire.

Attention : publier un UVTT publie également l’image qu’il contient. Les licences des cartes
doivent donc autoriser leur présence dans le dépôt et sur GitHub Pages.

### 2.4 Le catalogue remplace l’exploration du dossier

Un navigateur ne peut pas lister le contenu d’un répertoire GitHub Pages. Un fichier
`maps/catalog.json` doit donc décrire les cartes disponibles.

Ce catalogue est généré ; il n’est jamais édité à la main.

## 3. Arborescence cible

```text
maps/
├─ manoir-rdc.uvtt                  source
├─ crypte.uvtt                      source
├─ catalog.json                     catalogue généré
└─ generated/
   ├─ manoir-rdc.scene.json         données de scène générées
   ├─ manoir-rdc.webp               image générée
   ├─ crypte.scene.json
   └─ crypte.webp
```

Les noms publics sont dérivés d’un slug stable. Une nouvelle préparation ne doit pas créer
un nouvel identifiant si le fichier source n’a pas été renommé.

## 4. Contrat du catalogue

Format cible minimal :

```json
{
  "version": 1,
  "maps": [
    {
      "id": "manoir-rdc",
      "name": "Manoir — RDC",
      "sourceUrl": "maps/manoir-rdc.uvtt",
      "sceneUrl": "maps/generated/manoir-rdc.scene.json",
      "imageUrl": "maps/generated/manoir-rdc.webp",
      "sourceHash": "sha256-…",
      "levelCount": 1,
      "features": {
        "walls": 124,
        "portals": 37,
        "lights": 8,
        "bakedLighting": false
      }
    }
  ]
}
```

Règles :

- `version` est obligatoire ;
- `id` est unique et stable ;
- toutes les URLs sont relatives au site ;
- `sourceHash` permet de détecter des artefacts non régénérés ;
- les compteurs sont informatifs et servent aussi aux tests ;
- aucune image, base64 ou URL temporaire n’entre dans le catalogue.

## 5. Contrat de la scène générée

Le document de scène utilise le schéma `Campaign`/`Level` existant et ajoute uniquement des
métadonnées de provenance clairement versionnées.

Il doit conserver exactement :

- `pxPerCell`, dimensions et origine de grille ;
- toutes les polylignes `line_of_sight` ;
- toutes les polylignes `objects_line_of_sight` ;
- tous les portails, leurs bornes et leur état fermé ;
- toutes les lumières, position, portée, intensité, couleur et ombres ;
- l’état `baked_lighting` ;
- les avertissements utiles de préparation.

La scène est refusée si sa validation échoue. Le catalogue précédent reste alors intact.

## 6. Commande cible

Une seule commande publique :

```text
pnpm maps:prepare
```

Elle doit :

1. trouver les `.uvtt` directement sous `maps/` ;
2. trier les sources pour produire des sorties déterministes ;
3. parser et valider chaque source ;
4. générer l’image adaptée à Canvas ;
5. générer la scène JSON ;
6. calculer le hash de la source ;
7. reconstruire `catalog.json` ;
8. écrire les fichiers de manière atomique ;
9. sortir en erreur sans publier un catalogue partiel ;
10. afficher un résumé compréhensible :
   `2 cartes préparées, 161 murs, 42 portes, 8 lumières`.

Le format d’image et les paramètres internes restent dans la configuration du script. Ils ne
sont pas demandés au mainteneur.

## 7. Bibliothèque dans l’application

Ajouter un onglet MJ « Cartes » qui :

- charge `maps/catalog.json` au démarrage ;
- affiche le nom et une miniature de chaque carte ;
- indique les compteurs murs/portes/lumières ;
- signale clairement une carte invalide ou absente ;
- permet « Charger » ou « Ajouter comme étage » ;
- ne présente aucun champ URL ;
- ne présente aucun sélecteur de fichier dans le parcours normal.

Lors de la sélection :

1. charger `sceneUrl` ;
2. valider la campagne avant toute mutation ;
3. vérifier que son `imageUrl` correspond au catalogue ;
4. charger la scène dans le store ;
5. publier le snapshot vers les joueurs ;
6. afficher la carte même si l’image échoue, avec le placeholder existant ;
7. conserver la scène et la sélection après F5.

## 8. Sort du panneau d’import actuel

Le panneau actuel ne doit pas rester comme parcours principal.

Migration prévue :

- supprimer les champs « URL publiée » ;
- déplacer l’import local dans une section avancée « Diagnostic développeur », ou le retirer ;
- ne jamais ajouter une scène partagée depuis un simple aperçu local ;
- expliquer que l’ajout de cartes se fait avant la séance par `maps:prepare`.

Les campagnes LocalStorage existantes utilisant une URL relative restent compatibles.

## 9. Découpage d’implantation

### U-00 — Tests rouges du contrat UVTT

Fichiers principaux :

- `tests/uvtt.test.mjs`
- `tests/realUvtt.test.mjs`
- nouveau test de préparation

Tests à écrire avant le code :

- compte exact des murs, portails et lumières après préparation ;
- conservation de `closed`, `freestanding`, `shadows` et `baked_lighting` ;
- refus d’un UVTT invalide sans altérer le catalogue précédent ;
- aucune `data:` ou `blob:` dans la scène générée ;
- identifiant stable entre deux préparations ;
- résultat déterministe hors hash réellement modifié.

### U-01 — Extraire une API de préparation pure

Refactorer `scripts/import-uvtt.mjs` afin d’exposer une fonction appelable sans modifier
`process.argv` et sans appeler `process.exit`.

Critères :

- une source et un dossier de sortie explicites ;
- aucune écriture hors du dossier cible ;
- erreurs levées avec le fichier et la cause ;
- ancien CLI unitaire maintenu temporairement.

### U-02 — Génération atomique du catalogue

Ajouter le scan de `maps/*.uvtt`, les hashes et les écritures temporaires.

Critères :

- ordre stable ;
- doublons de slug refusés ;
- catalogue précédent conservé si une carte échoue ;
- fichiers obsolètes signalés, jamais supprimés silencieusement.

### U-03 — Modèle et chargeur de catalogue

Ajouter un module pur qui charge et valide le catalogue.

Critères :

- version inconnue refusée ;
- URLs temporaires refusées ;
- doublons refusés ;
- aucune dépendance au DOM ou au store ;
- compatibilité avec un site servi sous `/rpg-map-display/`, pas seulement à la racine.

### U-04 — Interface de bibliothèque MJ

Ajouter l’onglet « Cartes » et brancher le chargement transactionnel.

Critères :

- aucun champ URL ;
- aucun fichier local demandé ;
- erreurs visibles ;
- la carte minimale est sélectionnable ;
- murs, portails et lumières présents dans le store après chargement.

### U-05 — Synchronisation et reconnexion

Publier la campagne préparée via le transport existant.

Critères :

- la vue joueurs reçoit la même scène ;
- aucun UVTT complet ni base64 ne transite dans Firebase ;
- F5 MJ et joueurs restaure la scène ;
- un autre navigateur charge l’image depuis GitHub Pages ;
- un snapshot invalide ne remplace pas l’état valide.

### U-06 — Retrait du parcours URL manuel

Supprimer les champs et messages devenus inutiles, puis mettre à jour README, état et tests.

Critères :

- aucune occurrence utilisateur de « URL publiée » ;
- aucun chemin d’image à saisir ;
- le workflow documenté tient en trois actions :
  déposer, préparer, pousser.

## 10. Matrice minimale de tests navigateur

| Scénario | Résultat attendu |
|---|---|
| Catalogue servi localement | cartes affichées sans saisie |
| Site sous un sous-chemin GitHub Pages | toutes les URLs se résolvent |
| Chargement d’une scène UVTT préparée | grille, murs, portes et lumières présents |
| Deux clients | même scène et mêmes compteurs |
| F5 | carte et niveau actif restaurés |
| Image absente | placeholder, scène conservée |
| Scène JSON absente | erreur visible, ancien état conservé |
| Catalogue corrompu | bibliothèque indisponible, plateau courant conservé |
| Source UVTT modifiée sans préparation | hash incohérent signalé |

## 11. Hors périmètre de cette implantation

Cette bibliothèque ne doit pas prétendre terminer :

- le rendu des murs ;
- l’ouverture interactive des portes ;
- le calcul de vision ;
- le fog ;
- les ombres et lumières dynamiques.

Elle garantit que les données nécessaires sont correctement préparées, chargées,
persistées et synchronisées. Ces fonctions graphiques devront ensuite les consommer.

## 12. Définition de terminé

Le plan est terminé lorsque :

1. déposer un UVTT et lancer une commande suffit à le publier ;
2. l’application liste automatiquement les cartes ;
3. aucune URL ni notion de WebP n’est exposée au MJ ;
4. le document chargé conserve tous les éléments structurels UVTT ;
5. aucun contenu d’image encodé n’entre dans le store durable ou Firebase ;
6. deux navigateurs et un vrai F5 chargent la même scène ;
7. les erreurs de préparation ou de chargement ne détruisent jamais l’état valide ;
8. les limites vision/portes/lumière restent explicitement annoncées jusqu’à leur
   implantation réelle.

## 13. Consignes à l’implémenteur

- Commencer par U-00.
- Ne pas modifier simultanément le moteur Canvas.
- Ne pas réintroduire les `data:` persistées.
- Ne pas utiliser l’API GitHub pour lister le dossier.
- Ne pas ajouter de serveur d’upload.
- Ne pas déclarer murs, portes ou lumière « fonctionnels » parce que leurs données sont
  présentes dans le store.
- Conserver `maps/manoir-rdc.uvtt` et tout autre fichier utilisateur sans le modifier ni le
  supprimer.

