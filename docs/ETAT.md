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
- assets persistants limités aux URLs relatives ou HTTPS, sauf l’image de pion embarquée
  bornée (voir « Persistance et assets ») ;
- pions créés, édités et supprimés côté MJ (`token.add` / `token.update` / `token.delete`) ;
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

**La leçon n’avait pas été appliquée partout — corrigé le 30 juillet 2026 au soir.** `verify`
échouait encore une fois sur deux environ, et **pas** sur les causes déjà consignées.
Reproduit sur `HEAD` sans aucune modification en cours : ce n’est donc une régression de rien.
**Trois causes distinctes**, et il a fallu les traiter toutes les trois :

1. **Trois budgets en horloge murale** — `handoutOverlay.spec.mjs:45`, `player.spec.mjs:454`
   et `:535`, tous `toBeLessThan(500)`. Chacun **doublait** une attente de condition déjà
   bornée qui gardait la même chose : les supprimer ne retire aucune couverture. Ce qu’ils
   chronométraient n’était d’ailleurs pas le produit — pour `:454` le relais `exposeFunction`
   entre deux processus Playwright, pour `:535` un aller-retour CDP sur une fonction
   **synchrone**. Les attentes de condition (`timeout: 2000`) restent, et ce sont elles la
   vraie garde : elles échoueraient si la propagation cessait d’être portée par un événement.
2. **Un test qui touchait réellement `drive.google.com`** (`handoutOverlay.spec.mjs:79`), donc
   dépendant d’une connexion et d’un tiers. Il est désormais intercepté par `page.route`, ce
   qui le rend hermétique **et** le renforce : son titre promet de vérifier ce qui part sur le
   réseau, ce que la lecture d’un attribut `src` ne prouvait pas. Il assère maintenant les URL
   réellement demandées par le navigateur.
3. **Le seuil temporel du tap, et ce n’était pas celui qu’on croit.** `input.spec.mjs:127`
   échouait faute de `tap` émis. La cause évidente — `longPressMs` à 500 ms — **n’était pas la
   bonne** : le désarmer seul laissait l’échec à 4 passes sur 8. Émettre un `tap` exige aussi
   `duration < dragHoldMs` (`js/input/pointer.js:388`), soit **150 ms** pour tout
   l’enchaînement `down` → `move` → `up`, chacun étant un aller-retour CDP. C’est la borne
   serrée, trois fois plus basse que celle qu’on soupçonnait.

Mesure avant/après, huit passes complètes à chaque fois : **de ~5 échecs sur 10 à 0 sur 8**,
puis `verify` complet vert deux fois de suite.

> Leçon complémentaire, qui a coûté une correction fausse : **quand deux bornes gardent le
> même événement, c’est la plus serrée qui décide**, et ce n’est pas forcément celle qui est
> documentée. Désarmer la mauvaise ne produit aucun signal — le test échoue exactement pareil.

**Question produit ouverte, découverte en chemin et laissée telle quelle.** Un appui immobile
entre 150 ms et 500 ms n’émet **rien du tout** : trop long pour un `tap`, trop court pour un
`longPress`. Sur la vue joueurs, un tap un peu lent ne déplacerait donc pas le pion, sans
aucun retour. Reste à savoir si c’est perceptible à table — la mesure est un geste humain,
pas une suite de tests.

Les deux scénarios Firebase réels nécessitent `RPG_FIREBASE_CONFIG` avec la configuration
Web publique et les identifiants du compte technique de test. Ces identifiants restent hors
du dépôt.

## Persistance et assets

La cause historique de la disparition après F5 était la suppression silencieuse d’une
`imageUrl` encodée en `data:` lors de la sauvegarde. Ce comportement n’existe plus :

- le store valide une campagne complète avant chaque mutation et sauvegarde ;
- l’interface exige une URL canonique publiée avant l’ajout d’un étage ;
- le transport refuse récursivement `blob:`, et tout `data:` non borné ;
- une erreur de chargement d’image produit un placeholder, pas la perte de la campagne ;
- le remplacement de scène voyage en instantané absolu (`scene.load`), validé avant de
  remplacer un état valide, et rejouable sans divergence.

### Amendement du 30 juillet 2026 — l’image d’un pion peut être embarquée

**Le défaut corrigé.** Le générateur de pions inscrivait `maps/tokens/token-<uuid>.webp`
dans le pion, alors qu’il ne téléchargeait le WebP que dans le dossier de téléchargement du
MJ. Le fichier n’existant à cette URL ni sur le Mac ni sur la tablette, chaque pion créé
s’affichait comme un cercle gris portant l’initiale de son nom — le repli de
`render/layers/tokens.js`, qui faisait correctement son travail sur une donnée fausse. Le
dépôt manuel décrit au chantier I était une consigne, pas un mécanisme : rien ne
l’appliquait, et rien ne signalait qu’il manquait.

**Ce qui change.** `token.imageUrl` accepte désormais une image `data:` **bornée** :
`isBoundedImageDataUrl` la limite à 24 KiB et aux formats png/jpeg/webp/gif. Le générateur
ré-encode jusqu’à tenir sous ce plafond — qualité d’abord, dimension ensuite — plutôt que de
refuser l’image du MJ en pleine séance. Une URL publiée renseignée à la main l’emporte
toujours : référencer un fichier déjà publié vaut mieux que dupliquer ses octets.

**Pourquoi la règle antérieure ne s’appliquait pas ici.** Elle avait été écrite pour un fond
de carte : `maps/generated/manoir-rdc.webp` pèse 4,9 Mo, et c’est bien un `data:` de cet
ordre qui était supprimé en silence à la sauvegarde. Un pion de 200 px pèse trois
kilo-octets — `maps/tokens/goblin.webp` en fait 2982. Le danger n’était jamais le schéma
`data:`, qui **survit** au rechargement et voyage vers un autre navigateur puisqu’il porte
ses octets ; le danger était la taille. La garde du transport teste donc maintenant cette
propriété, et non le schéma : `blob:` reste refusé sans condition, car lui ne survit à rien.

**La garde qui compte vraiment est le plafond cumulé.** `saveSnapshot` écrit la campagne
entière dans **un seul** document Firestore, limité à 1 MiB. Un plafond par pion ne protège
pas ce document : vingt-quatre pions au maximum individuel le rempliraient à moitié sans
qu’aucune vérification ne se déclenche, et le défaut n’apparaîtrait qu’en séance.
`TOKEN_IMAGE_TOTAL_MAX_BYTES` plafonne donc le cumul à 512 KiB, vérifié par
`validateCampaign` sur la campagne et non sur le pion.

**Le partage des responsabilités, à ne pas confondre.** Le champ auquel une image embarquée
est permise est décidé par `validateCampaign`, jamais par le transport : un fond d’étage en
`data:` reste refusé, quelle que soit sa taille. La garde du transport est un filet contre
l’éphémère et le non borné, pas un contrôle de schéma de données.

`CONVENTIONS.md` §4 porte l’exception correspondante.

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
- **règles de sécurité du projet Firebase** — le point le plus important de cette liste, et le
  seul qui protège les données. Voir la section dédiée plus bas, avec les règles à appliquer et
  les deux pièges du mode test ;
- restriction de la clé d'API Google (Cloud Console → Identifiants, « Browser key (auto created
  by Firebase) ») : référents HTTP et API limitées. **Confort, pas urgence** — sans compte de
  facturation, aucun coût n'est possible, les quotas du plan gratuit étant des plafonds durs.
  Le seul gain est d'éviter qu'un tiers épuise le quota. C'est aussi la réponse à l'alerte
  « secret détecté » de GitHub, qui se déclenche sur le motif `AIzaSy` de toute clé Google ;
- purge de fin de séance selon l’usage réel ;
- **efficacité réelle du bouton « Mettre à jour »** du bandeau de désynchronisation
  (`js/ui/versionBadge.js`, `forceReloadToLatest`). Le mécanisme — refetch de chaque URL de
  code en `cache: 'reload'`, qui remplace l'entrée du cache HTTP, avant `location.reload()` —
  est vérifié en Chromium par `tests/player.spec.mjs`. Mais le défaut qu'il corrige est propre
  au cache de Safari iOS, qui ressert les modules ES d'un `max-age` non expiré sans revalider :
  **seule la tablette peut confirmer que la version affichée change après le tap.** Si l'écart
  survit au bouton, le pas suivant est de servir le code sous une URL versionnée plutôt que de
  négocier avec le cache.

Ces points ne doivent pas être déclarés réussis à partir d’un test desktop.

## Images Google Drive : le lien de partage n'est pas une image

Constaté le 30 juillet 2026 : un handout dont l'URL venait de Drive s'affichait en cadre noir
avec une icône de fichier cassé sur la tablette. Le lien que Drive met dans le presse-papier,
`https://drive.google.com/file/d/<ID>/view?usp=drive_link`, sert **une page HTML de 75 Ko** —
mesuré, `content-type: text/html`. Aucune balise `<img>` n'en tirera une image.

Deux points d'accès servent réellement les octets d'un fichier « tous ceux qui ont le lien »,
mesurés sur le même scan PNG :

| URL | Type | Poids |
|---|---|---|
| `/file/d/<ID>/view` | `text/html` | 74 Ko |
| `/uc?export=view&id=<ID>` | `image/png` | 9,8 Mo |
| `/thumbnail?id=<ID>&sz=w2000` | `image/png` | 4,0 Mo |

`normalizeImageUrl` (`js/core/schema.js`) retient le troisième : la liaison d'une tablette n'a
rien à gagner à transporter un original que sa dalle ne peut pas afficher. La conversion a lieu
**côté MJ, avant le store et avant le réseau** — c'est une URL affichable qui part, pas un lien
corrigé à l'arrivée — et elle est répétée à l'affichage pour les handouts déjà enregistrés. Un
lien de *dossier* n'a pas d'octets à servir : il est refusé avec un message, plutôt que révélé
en cadre vide.

> Ces deux points d'accès ne figurent dans aucune API publiée. S'ils changent, `normalizeImageUrl`
> est le seul endroit à corriger. La conversion ne s'applique qu'aux handouts : un fond d'étage
> ou une image de pion collés depuis Drive resteraient cassés — à étendre le jour où le besoin
> se présente.

## Présence : trois défauts qui rendaient l'alerte d'écart de version inextinguible

Constaté le 30 juillet 2026 en séance : la tablette affichait un écart avec la build 91,
puis 90, alors qu'elle exécutait bien la 93 — la preuve étant que les boutons ajoutés en 93
s'affichaient. Forcer la mise à jour ne changeait donc rien, et ne pouvait rien changer.

1. **`at` était daté par l'horloge du client** (`Date.now()` dans `publishPresence`), mais la
   péremption se calcule chez le lecteur : `now - at > 90 s`. Deux horloges, une soustraction.
   Un client en avance produisait un `at` futur, donc un âge **négatif**, qui satisfait la
   borne — la présence ne périmait jamais. Un écran éteint depuis des jours continuait
   d'annoncer sa build. Corrigé par `serverTimestamp()` à l'écriture et reconversion vers
   l'horloge locale via `.info/serverTimeOffset` à la frontière du transport ; `getPresenceList`
   borne désormais l'âge **en valeur absolue**, ce qui élimine sans migration les
   enregistrements laissés par les anciennes versions.
2. **Le battement de cœur continuait en arrière-plan.** Les navigateurs bornent les minuteries
   d'un onglet masqué à environ une par minute — sous les 90 s de péremption. Un onglet oublié
   sur n'importe quel appareil tenait donc la session en alerte permanente. La présence décrit
   les écrans *en service* : masqué, un client cesse de battre et se périme ; revenu au premier
   plan, il se réannonce.
3. **Le diagnostic désignait le mauvais écran.** `checkBuildMismatch` s'arrête au premier
   client divergent — d'où le numéro qui sautait de 91 à 90 selon l'ordre d'itération — et le
   message MJ annonçait « la tablette » quel que soit le rôle du fautif. `listBuildMismatches`
   les rend tous, triés, et les deux vues nomment le rôle. Le bouton « Mettre à jour » ne
   s'affiche plus que si la page est **réellement** en retard : sur l'écran déjà à jour, il
   promettait un remède qu'il ne pouvait pas tenir.

> Le premier défaut est le plus instructif : comparer deux horloges sans référentiel commun ne
> produit pas une erreur, mais une condition qui **s'inverse silencieusement**. Une borne à
> sens unique sur une différence de temps mérite toujours la question « et si c'était négatif ? ».

## Règles de sécurité Firebase — les seules qui protègent réellement

La clé d'API est publique par conception (`firebase-config.js`) : **ce sont les règles, et
elles seules, qui empêchent un tiers de lire ou d'écrire une campagne.** Sans compte de
facturation, il n'y a aucun risque de coût ; le risque est l'accès aux données et l'épuisement
du quota gratuit.

**Deux pièges du mode test**, à vérifier avant toute séance : il autorise lecture et écriture
**sans authentification**, et il **expire au bout de 30 jours** — après quoi tout casse, y
compris en pleine partie.

Chemins réellement utilisés par `FirebaseTransport`, et rien d'autre :

| Service | Chemin |
|---|---|
| Realtime Database | `session/{code}/events`, `session/{code}/presence/{clientId}` |
| Firestore | `campaigns/{code}` |

Les règles en place sont une **liste blanche d'adresses**, plus strictes qu'un simple
`auth != null` : seuls le compte du mainteneur, avec adresse vérifiée, et le compte technique
de test sont admis. La console fait foi ; ce qui suit en est le reflet.

Realtime Database. **La condition est portée au niveau `$sessionId`, pas sur `events` seul** —
et c'est un correctif, pas un détail de style : les règles RTDB ne se propagent pas
latéralement, donc une condition posée sur `events` laisse `presence` **sans aucune règle, donc
refusé**. Le code écrit `session/{code}/presence/{clientId}` toutes les 30 s et lit le nœud
entier ; sans cette règle, la présence échoue en `PERMISSION_DENIED` et la **détection d'écart
de build (T-24b) ne se déclenche jamais**, `checkBuildMismatch` parcourant une liste vide.
Porter la condition sur `$sessionId` couvre en outre les chemins que le lot 2 ajoutera.

```json
{
  "rules": {
    "session": {
      "$sessionId": {
        ".read":  "auth != null && ((auth.token.email === 'ethoril@gmail.com' && auth.token.email_verified === true) || auth.token.email === 'et.horil@gmail.com')",
        ".write": "auth != null && ((auth.token.email === 'ethoril@gmail.com' && auth.token.email_verified === true) || auth.token.email === 'et.horil@gmail.com')"
      }
    }
  }
}
```

Firestore :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /campaigns/{sessionId} {
      allow read, write: if request.auth != null
        && ( (request.auth.token.email == "ethoril@gmail.com" && request.auth.token.email_verified == true)
             || request.auth.token.email == "et.horil@gmail.com" );
    }
  }
}
```

**Pourquoi `email_verified` n'est pas exigé du compte technique** : un compte créé en
e-mail/mot de passe depuis la console n'est pas vérifié, la condition le rejetterait donc et les
deux tests e2e Firebase échoueraient.

**Limite connue et assumée** : la tablette est un appareil partagé, connecté avec le compte du
mainteneur (CdC §3), donc deux adresses suffisent. En revanche l'« URL joueur autonome » du §216
— un joueur ouvrant la vue sur son propre téléphone — serait refusée. À rouvrir si cet usage
devient réel.

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
