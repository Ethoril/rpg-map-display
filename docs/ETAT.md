# ÉTAT D’AVANCEMENT ET REPRISE

> Dernière mise à jour : 30 juillet 2026 — **le lot 1b du CdC est complet côté code.**
> Chantiers H (révélation d'image), I (bibliothèque de pions), J (page d'accueil et vue MJ
> sur `gm.html`) et K (badge d'élévation) livrés, après la bibliothèque UVTT (U-00 à U-06 de
> `PLAN-BIBLIOTHEQUE-UVTT.md`). Ne reste ouvert, sur les lots 1a et 1b, que des **mesures
> matérielles** — voir « Ce qui reste à vérifier manuellement ».
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

Résultat de la passe d’intégration du 30 juillet 2026 (fin du lot 1b du CdC) :

- typage : vert ;
- tests unitaires : **103 réussis**, **aucun ignoré** — le corpus réel de `fixtures/real/`
  est présent, et `realUvtt.test.mjs` le parse au lieu de s'auto-ignorer ;
- tests navigateur : **64 réussis**, 2 Firebase ignorés faute de configuration externe ;
- `pnpm run check-deps` : vert, import maps identiques entre `gm.html`, `player.html` et
  `diag.html` ;
- les scénarios couvrent rendu, imports, bibliothèque de cartes, bibliothèque de pions,
  pions, gestes, élévation, révélation d'image, page d'accueil, plusieurs pages,
  reconnexion et remplacement de scène synchronisé.

La suite unitaire est passée d’environ 30 s à moins de 2 s : la préparation de cartes est
désormais exercée sur `fixtures/synthetic/minimal.uvtt` dans un dossier temporaire, et
`maps/` n’est plus muté par les tests.

**Instabilité de `tests/input.spec.mjs` — résolue, en deux temps.** Le fichier échouait par
intermittence sous charge, 2 fois sur 8 exécutions de `verify`, sur des tests variables. Il
y avait **deux causes distinctes**, et la première correction n’a traité que l’une :

1. **Attentes d’observation trop courtes.** Des `waitForTimeout` de 30 à 50 ms pour laisser
   arriver une intention. Remplacées par des attentes de condition (`expect.poll`).
2. **Maintien d’appui dans une fenêtre bornée.** Les tests qui maintiennent l’appui pour
   dépasser `DRAG_HOLD_MS` (150 ms) doivent rester **sous** `longPressMs` (500 ms) : au-delà,
   `PointerInput` bascule `mode = 'longPress'` (`js/input/pointer.js:238`) et le déplacement
   suivant ne produit plus jamais de `panBy` ni de `dragToken`. Un maintien de 180 ms n’avait
   que 320 ms de marge, et une page affamée la consomme. Aucune attente d’observation, même
   de 5 s, ne pouvait rattraper ça : l’intention n’était jamais émise. Ces tests désarment
   désormais le seuil (`longPressMs` porté hors d’atteinte) au lieu de parier sur l’horloge.

Démonstration contrôlée du second point : avec le seuil désarmé, un maintien de 1500 ms
passe ; sans désarmement, le même maintien échoue. La course est supprimée, pas rendue
improbable.

Leçon à garder : **une attente de durée fixe n’est sûre comme durée de geste que si le geste
n’a pas de borne supérieure.** Ici il en avait une.

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
2. Ouvrir `gm.html?session=<id>` côté MJ (ou passer par l'accueil `/`).
3. Ouvrir `player.html?session=<même-id>` côté tablette.
4. En mode Firebase, se connecter avec Google lorsque la page le demande.
5. Vérifier le badge réseau : `Firebase connecté` ou `Mode local`.

La configuration runtime peut être injectée par `window.RPG_FIREBASE_CONFIG` ou par
`localStorage["rpg-firebase-config"]`. Elle ne doit contenir aucun mot de passe.

## Ce qui reste à vérifier manuellement

- tenue à 30 fps sous cast sur la tablette cible ;
- lisibilité du badge d'élévation (+N/−N) sous cast sur la tablette cible (miroir passif Google Cast) ;
- température et stabilité pendant une séance de 45 minutes puis quatre heures ;
- limite de texture réelle et qualité du rééchantillonnage ;
- reprise du Wake Lock et du plein écran sur Android réel ;
- règles de sécurité du projet Firebase de production ;
- **restriction de la clé d'API Google** (Cloud Console → Identifiants) : référents HTTP
  limités au domaine Pages et à `127.0.0.1`, et restriction aux seules API utilisées. La clé
  est commitée dans `firebase-config.js` et publique par nature — elle identifie le projet,
  elle n'autorise rien — mais **non restreinte**, elle peut être présentée à d'autres API
  Google activées sur le projet, avec le coût correspondant. C'est la seule conséquence réelle
  de l'alerte « secret détecté » de GitHub, qui se déclenche sur le motif `AIzaSy` ;
- purge de fin de séance selon l’usage réel.

Ces points ne doivent pas être déclarés réussis à partir d’un test desktop.

## Décision n°2 du §12 — latence Firebase : tranchée par architecture, pas par mesure

**On reste sur Firebase. `LocalSocketTransport` n'est pas activé.** Cette décision est prise
sciemment **sans** la mesure que le CdC §12 réclamait, et il faut savoir pourquoi pour ne pas
la rouvrir par erreur.

1. **Le seuil de 250 ms n'est pas le maillon dominant.** Le CdC §3 relève que le cast ajoute
   lui-même **150 à 400 ms** de latence. Ce que voient les joueurs sur la TV est gouverné par
   le mirroring, pas par le transport : un aller-retour Firebase, même à 80 ms, disparaît dans
   ce bruit.
2. **La décision est de fait déjà prise.** Les lots 1a et 1b sont construits sur Firebase.
   Basculer serait aujourd'hui un chantier, pas un réglage — la fenêtre où la mesure était
   décisionnelle s'est refermée.
3. **Le seul relevé obtenu ne mesurait pas la bonne grandeur.** La section 5 de `diag.html` a
   donné p50 4,7 ms / p95 7,1 ms / max 10,6 ms le 30 juillet 2026. Ces chiffres sont **en
   dessous du temps de trajet physique** vers `europe-west1` : la sonde ne filtre pas les
   échos propres, et la Realtime Database délivre les écouteurs locaux sur la valeur optimiste
   avant tout acquittement serveur. Elle chronomètre donc la boucle locale du SDK. Le verdict
   automatique qu'elle affichait a été retiré.

**Ce que ce relevé établit tout de même, et qui valait le détour :** la configuration Firebase
est bonne, l'authentification Google passe, et les règles autorisent écriture, lecture et purge
sur une session.

**Ce qui reste le vrai juge**, et qui ne coûte rien : la première séance à table. Si la tablette
décroche, ça se verra sans instrumentation.

## Suite produit

Avancement mesuré contre les lots du cahier des charges §11, au 30 juillet 2026.
Relevé pour éviter de confondre « le plateau est solide » et « le produit est proche ».

| Lot du CdC §11 | État |
|---|---|
| **1a — Le plateau** | Code complet. 3 critères sur 11 restent ouverts, et ce sont des **mesures matérielles** : 30 fps sous cast, tenue thermique, limite de texture réelle |
| **1b — La prépa MJ** | **Code complet, 4 critères sur 4.** Bibliothèque de scènes (U-00 à U-06), révélation d’image (§5.8, chantier H), bibliothèque de pions (§5.7, chantier I), badge d’élévation (chantier K). Un seul point reste ouvert et c’est une **mesure matérielle** : la lisibilité du badge sous cast |
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
