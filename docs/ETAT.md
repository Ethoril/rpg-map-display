# ÉTAT D’AVANCEMENT ET REPRISE

> Dernière mise à jour : 29 juillet 2026 — mise en œuvre du plan de stabilisation Canvas.
> Les mesures physiques sur tablette et les scénarios Firebase réels restent à valider dans
> leur environnement.

## État courant

Le moteur officiel est Canvas 2D. L’ancienne implantation Pixi a été retirée du runtime,
des import maps, du typage et des dépendances.

Les blocs C-01 à C-11 du plan de stabilisation sont implémentés :

- stage Canvas et couches dans l’ordre canonique ;
- rendu à la demande, sans boucle active au repos ;
- fond et pions asynchrones avec placeholders ;
- grille et zone de mouvement alignées ;
- gestes exclusifs, drag libre côté MJ, tap vers destination côté joueurs ;
- assets persistants limités aux URLs relatives ou HTTPS ;
- mutations transactionnelles et `levelId` de pion valide ;
- configuration, authentification et états réseau explicites ;
- snapshot, événements idempotents, présence et reprise locale ;
- cycle de vie mobile, paysage, Wake Lock et nettoyage ;
- tests et documentation réconciliés avec le runtime Canvas.

## Vérifications de référence

```text
pnpm install
pnpm run typecheck
pnpm run test:unit
pnpm run test:e2e
pnpm run check-deps
```

Résultat de la passe d’intégration du 29 juillet 2026 :

- typage : vert ;
- tests unitaires : 67 réussis, 1 fixture réelle ignorée car absente ;
- tests navigateur : 39 réussis, 2 Firebase ignorés faute de configuration externe ;
- les scénarios couvrent rendu, imports, pions, gestes, plusieurs pages et reconnexion.

Les deux scénarios Firebase réels nécessitent `RPG_FIREBASE_CONFIG` avec la configuration
Web publique et les identifiants du compte technique de test. Ces identifiants restent hors
du dépôt.

## Persistance et assets

La cause historique de la disparition après F5 était la suppression silencieuse d’une
`imageUrl` encodée en `data:` lors de la sauvegarde. Ce comportement n’existe plus :

- le store valide une campagne complète avant chaque mutation et sauvegarde ;
- l’interface exige une URL canonique publiée avant l’ajout d’un étage ou d’un pion ;
- le transport refuse récursivement `data:` et `blob:` ;
- une erreur de chargement d’image produit un placeholder, pas la perte de la campagne.

Les cartes sont préparées dans `maps/`, par exemple :

```text
node scripts/import-uvtt.mjs chemin/vers/carte.uvtt
```

## Démarrage d’une séance

1. Servir le dépôt avec `pnpm run serve`.
2. Ouvrir `index.html?session=<id>` côté MJ.
3. Ouvrir `player.html?session=<même-id>` côté tablette.
4. En mode Firebase, se connecter avec Google lorsque la page le demande.
5. Vérifier le badge réseau : `Firebase connecté` ou `Mode local`.

La configuration runtime peut être injectée par `window.RPG_FIREBASE_CONFIG` ou par
`localStorage["rpg-firebase-config"]`. Elle ne doit contenir aucun mot de passe.

## Ce qui reste à vérifier manuellement

- tenue à 30 fps sous cast sur la tablette cible ;
- température et stabilité pendant une séance de 45 minutes puis quatre heures ;
- limite de texture réelle et qualité du rééchantillonnage ;
- reprise du Wake Lock et du plein écran sur Android réel ;
- latence et règles de sécurité du projet Firebase de production ;
- purge de fin de séance selon l’usage réel.

Ces points ne doivent pas être déclarés réussis à partir d’un test desktop.

## Suite produit

La stabilisation du plateau doit être relue avant de reprendre les lots fonctionnels
suivants : brouillard de guerre, vision, éclairage, bibliothèques et étages multiples.
Toute optimisation GPU future devra passer par un nouveau contrat de renderer et des
mesures tablette ; elle ne justifie pas de restaurer l’ancienne implantation.
