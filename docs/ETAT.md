# ÉTAT D’AVANCEMENT ET REPRISE

> Dernière mise à jour : 29 juillet 2026, soir — **bibliothèque UVTT terminée** (U-00 à
> U-06 de `PLAN-BIBLIOTHEQUE-UVTT.md`) : catalogue transactionnel, contrôles de grille
> couverts, remplacement de scène synchronisé.
>
> ⚠️ **Attention à la numérotation.** Le « lot 2 » de `PLAN-BIBLIOTHEQUE-UVTT.md` désigne la
> bibliothèque UVTT et n'a rien à voir avec le **Lot 2 du cahier des charges §11** (lignes
> de vue, portes, fog, éditeur de murs, gabarits, marqueurs), qui n'est **pas commencé**.
> Ne pas confondre les deux : la bibliothèque est une tranche du Lot 1b du CdC.
>
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
pnpm run verify        # typecheck + test:unit + test:e2e, arrêt à la première erreur
pnpm run check-deps
```

`pnpm run verify` est la commande de référence : c'est celle que le CI exécute et
dont dépend le déploiement GitHub Pages. Lancer seulement `test:unit` a déjà
laissé passer un lot entier dont les 4 tests navigateur étaient rouges.

Résultat de la passe d’intégration du 29 juillet 2026 au soir (lot 2 terminé) :

- typage : vert ;
- tests unitaires : 85 réussis, **aucun ignoré** — le corpus réel de `fixtures/real/` est
  présent, et `realUvtt.test.mjs` le parse au lieu de s'auto-ignorer ;
- tests navigateur : 48 réussis, 2 Firebase ignorés faute de configuration externe ;
- les scénarios couvrent rendu, imports, bibliothèque de cartes, pions, gestes,
  plusieurs pages, reconnexion et remplacement de scène synchronisé.

La suite unitaire est passée d’environ 30 s à moins de 2 s : la préparation de cartes est
désormais exercée sur `fixtures/synthetic/minimal.uvtt` dans un dossier temporaire, et
`maps/` n’est plus muté par les tests.

**Réserve connue, à regarder en premier si le CI rougit.** `tests/input.spec.mjs`
échouait par intermittence — 2 échecs sur 8 exécutions de `verify`, sur des tests
variables. Ses attentes de durée fixe pour les frames rAF ont été remplacées par des
attentes de condition. Depuis : 0 échec sur 6 passes e2e complètes et 4 `verify`. Mais le
défaut **n’a jamais pu être reproduit à la demande** — une charge CPU externe ne le
déclenche pas — donc le correctif est sain par construction, sans démonstration contrôlée
contre l’échec observé. Les runners GitHub étant plus lents et plus variables qu’un poste
de développement, c’est là que le doute subsiste.

Les deux scénarios Firebase réels nécessitent `RPG_FIREBASE_CONFIG` avec la configuration
Web publique et les identifiants du compte technique de test. Ces identifiants restent hors
du dépôt.

## Persistance et assets

La cause historique de la disparition après F5 était la suppression silencieuse d’une
`imageUrl` encodée en `data:` lors de la sauvegarde. Ce comportement n’existe plus :

- le store valide une campagne complète avant chaque mutation et sauvegarde ;
- l’interface exige une URL canonique publiée avant l’ajout d’un étage ou d’un pion ;
- le transport refuse récursivement `data:` et `blob:` ;
- une erreur de chargement d’image produit un placeholder, pas la perte de la campagne ;
- le remplacement de scène voyage en instantané absolu (`scene.load`), validé avant de
  remplacer un état valide, et rejouable sans divergence.

Les cartes sont préparées dans `maps/`, par exemple :

```text
node scripts/import-uvtt.mjs chemin/vers/carte.uvtt
```

La publication du catalogue est **transactionnelle** : `pnpm maps:prepare` n’écrit
`catalog.json` que si toutes les cartes ont été préparées. Une seule carte fautive fait
sortir le CLI en code non nul et laisse le catalogue précédent intact, octet pour octet.
Les artefacts de `maps/generated/` devenus orphelins sont signalés, jamais supprimés : une
campagne enregistrée côté navigateur peut encore les référencer.

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

Avancement mesuré contre les lots du cahier des charges §11, au 29 juillet 2026 au soir.
Relevé pour éviter de confondre « le plateau est solide » et « le produit est proche ».

| Lot du CdC §11 | État |
|---|---|
| **1a — Le plateau** | Code complet. 3 critères sur 11 restent ouverts, et ce sont des **mesures matérielles** : 30 fps sous cast, tenue thermique, limite de texture réelle |
| **1b — La prépa MJ** | ~1 critère sur 4. La bibliothèque de scènes est faite. Manquent la bibliothèque de pions (§5.7), la révélation d’image (§5.8) et le badge d’élévation |
| **2 — Lignes de vue, portes & tactique** | **0 sur 13.** `js/vision/` n’existe pas ; aucun code de fog, de rendu de murs, d’éditeur de murs, de gabarits ni de marqueurs d’état. **Périmètre élargi le 29/07 au soir** : le fog porte désormais la fonction que les toits assuraient — masquer l’intérieur d’un bâtiment non visité (`ANALYSE-DD2VTT-GRILLES.md` §9) |
| **3 — Étages & lumière** | 0 sur 6 |
| **4 — Hexagone & confort de table** | 0 sur 6. La convention hexagonale doit être figée avant de coder (`ANALYSE-DD2VTT-GRILLES.md` §4.3), sans quoi l’adaptateur naîtra désaligné |
| Spike vidéo 1080p sous cast | non fait — à planifier avant de concevoir autour d’`animatedOverlays` |
| §12 Questions ouvertes | 8, dont plusieurs conditionnent des choix de conception du lot 2 |

Le substrat est en place : plateau, grille, pions, gestes, transport, persistance, import.
Le lot 2 est le plus gros du projet et il consommera une géométrie que la chaîne se contente
aujourd’hui de **transporter** — 131 murs et 40 portes arrivent intacts dans le store et
aucun sous-système ne les lit encore.

Toute optimisation GPU future devra passer par un nouveau contrat de renderer et des
mesures tablette ; elle ne justifie pas de restaurer l’ancienne implantation.
