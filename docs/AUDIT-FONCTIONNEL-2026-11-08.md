# Audit fonctionnel — 8 novembre 2026

> **Suivi (08/11, après l'audit).** Le checkout `E:/rpg-map-display` est revenu sur `main` (`817e22f`) et la copie périmée du contrat a été retirée : **A1 et A7 sont caducs**. Les huit reproductions navigateur côté Map Display (A2, A4, A8, A10 à A13) échouent encore sur `main`, sur leur assertion finale. Traitement décidé par le mainteneur : lot 1 d'abord (A4, A15, A8) ; chaque reproduction `tests/audit-*.spec.mjs` rejoint la spec de son domaine, sans `test.fail`, une fois son défaut corrigé et muté. A3, A5 et A6 se corrigent dans le dépôt de l'outil MJ.
>
> **Lot 1 corrigé (08/11).** A4 : le MJ écrit les coups reçus de la tablette (plus d'`applyingRemote` autour d'un événement). A15 : `createSnapshotSaver` (`js/app/session.js`) n'a qu'une écriture en vol, la suivante part à la fin de la précédente avec l'état capturé à son départ, au MJ comme à la tablette. A8 : une reprise dont la campagne a bougé pendant l'attente écarte son instantané ; le MJ, qui fait autorité, garde son état ; la tablette relit plus tard, seule. Limite assumée côté MJ : un coup de la table joué pendant l'absence du MJ **et** purgé du canal n'est alors pas rattrapé. Preuves : `tests/session.test.mjs` et `tests/reveilResync.spec.mjs` (A4, A8), chacune vue rouge par mutation ; les scénarios A4, A8 et A15 de `tests/audit-firebase-emulator.spec.mjs` passent sur émulateurs sans `test.fail` — celui d'A15 vérifie désormais l'état final, la sauvegarde récente attendant l'ancienne.
>
> **A3, A5, A6 corrigés côté outil MJ (3.43.0, `5db1628`).** Les trois scénarios entre applications, devenus `tests/liaisonReelle.spec.mjs`, passent sans `test.fail` contre cette version. Le §10 du contrat est précisé (`1e662eb`, protocole inchangé). Côté carte, du même rapport d'analyse de l'outil : **MAP-02** — `fx.wound` et `fx.death` d'une monture fusionnée se jouent sur le pion du cavalier ; **MAP-06** — `deathCause: null` efface la cause d'un pion relevé, jusqu'à la tablette, sans jamais entrer dans un pion neuf.

> **Rectification de périmètre.** La première passe ci-dessous a été menée sur le checkout `E:/rpg-map-display` à `4135c1f`, qui est **36 commits derrière `origin/main`**. Le worktree distinct `E:/rpg-map-display-liaison` est propre à `817e22f`, identique à `origin/main`, et comporte la liaison MJ. Les affirmations A1 et A7 décrivent donc **uniquement le checkout ancien** : elles ne sont pas vraies telles quelles pour `817e22f`. Les scénarios ont depuis été rejoués en servant les vraies pages de `817e22f` : A2, A4, A8 à A15 s'y reproduisent aussi. A3, A5 et A6 ont été reproduits entre les deux applications récentes. Les tests de navigateur et leur harnais sont ceux conservés dans le checkout ancien ; les pages et modules applicatifs chargés sont bien ceux de `817e22f`.

## Périmètre et état vérifié

RPG Map Display, branche `autonome/2026-08`, commit `4135c1f` ; l'outil MJ a été consulté en lecture sur `main`, commit `f0fab80`. Le contrat de liaison de ce dépôt et les questions en attente préexistaient à l'audit sous forme de modifications non commitées. Les tests automatisés ne constituent pas une recette complète sur tablette ou en séance.

## Anomalies et écarts

### A1 — Liaison absente du checkout ancien, présente dans la version récente — priorité de synchronisation locale

Dans le checkout ancien `4135c1f`, aucun consommateur du canal n'existe : les deux applications ne peuvent pas s'y appairer. **Rectification :** dans `817e22f`, `js/app/mjLink.js` existe et `js/app/gm.js` le démarre ; la liaison est donc implémentée dans cette version. Sa conformité fonctionnelle reste à auditer, sans déduire son bon fonctionnement de la seule présence du code.

Il faut comparer et tester les deux extrémités ensemble selon le contrat : appairage, instantané et reconnexion, identité, cycle de vie, propriété des champs et compatibilité avec les pions autonomes. Les tests multipages de la première passe injectaient `tests/browserTestTransport.mjs` ; ce transport de test est différent du canal de liaison MJ. Le checkout ancien doit être mis à jour seulement après prise en compte de ses modifications préexistantes ; aucune fusion ni écrasement n'a été effectué pendant l'audit.

### A2 — Un étage exploré puis quitté disparaît pour une nouvelle tablette après redémarrage du MJ — priorité haute

Reproduction : explorer l'étage A, déplacer le dernier PJ et la vue MJ à l'étage B, redémarrer la page MJ, puis connecter une tablette dont le stockage local ne contient pas le masque de A. Le masque de A est bien présent dans le stockage du MJ après redémarrage, mais la tablette ne le reçoit pas et ne peut pas retrouver normalement cet étage exploré.

`js/app/gm.js` recharge paresseusement les masques ; `syncVision` ne visite que les étages avec PJ, déjà publiés depuis ce démarrage ou affichés par le MJ. La réponse à `vision.request` ne parcourt que les masques déjà présents dans `exploredFogMap`. Le scénario C-8 existant vérifie la rediffusion avant redémarrage, lorsque les trois masques sont encore en mémoire. `tests/audit-fog-restart.spec.mjs` reproduit l'échec après redémarrage ; il est marqué en échec attendu afin de ne pas masquer la régression ni casser la suite. Le test simule le stockage séparé de la tablette en masquant sa lecture locale de A, tout en laissant intacte et accessible la copie du MJ, avec un transport de test entre les pages.

Corriger la restauration et la rediffusion des masques de tous les étages explorés, sans publier un masque vierge à la place d'un masque encore en cours de décodage ; retirer le marqueur d'échec attendu lorsque le test passe réellement. Vérifier aussi plusieurs étages, la reconnexion et une tablette disposant d'une copie ancienne.

### A3 — Le maximum de PV transmis peut ignorer celui du participant — priorité haute avant activation de la liaison

Dans l'outil MJ, `js/main.js` fournit `persistentMaxHpOf` à tous les participants, alors que `js/core/map-link-state.js` fait primer ce résultat sur `participant.maxHp`. Reproduction par appel du vrai calcul : un participant à 10 PV sur 10, issu d'un profil à 20 PV maximum, produit `{ current: 10, max: 20 }` et `health: 'wounded'` au lieu de 10/10 et `unharmed`. Le cas est atteignable lorsque le maximum est modifié pendant la rencontre, par exemple par Fléau des Démons (`js/core/v5-magic-arbitrations.js`).

**Vérification sur les versions récentes :** `tests/audit-cross-app.spec.mjs` ouvre la vraie page MJ de Map Display `817e22f` et la vraie application Outil MJ `f0fab80` sur une même origine locale, avec stockages de test. La liaison est annoncée connectée ; le participant vérifié à 10/10 dans l'outil MJ arrive bien dans la réserve de la carte à 10/20, tandis qu'un pion autonome existant reste inchangé. L'assertion finale a échoué sans marqueur. Cette reproduction confirme l'effet entre les applications récentes ; elle utilise un transport simulé entre la carte MJ et la tablette, et ne teste pas la propagation à une tablette.

Utiliser le maximum effectif du participant lorsqu'il existe ; réserver le calcul depuis le profil au PJ persistant dont le maximum est absent, et couvrir les variations puis la restauration en cours de rencontre. Vérifier les règles spécifiques des PJ liés à une fiche avant de modifier leur calcul.

### A4 — Les actions de la tablette ne sont pas enregistrées durablement en présence du MJ — priorité critique

Reproduction sur deux vraies pages avec le transport de test : en présence du MJ, la tablette déplace un PJ ; les deux stores affichent la nouvelle case, mais aucune des deux pages n'écrit un instantané après le déplacement. Le scénario `tests/audit-player-persistence.spec.mjs` vérifie d'abord la présence du MJ, la mutation locale, sa réception effective par le MJ et l'absence de sauvegarde côté tablette ; il échoue ensuite sur la sauvegarde attendue côté MJ. L'échec a été observé sans marqueur, puis marqué comme attendu pour conserver le scénario dans la suite.

La raison est visible dans `js/app/player.js` : la tablette ne sauvegarde pas tant qu'un MJ est présent, conformément à D-5. Dans `js/app/gm.js`, la réception d'un événement place `applyingRemote` à `true` pendant la mutation ; la notification synchrone appelle `scheduleSnapshot`, qui sort précisément pendant cet état. Aucune sauvegarde n'est ensuite programmée pour l'événement reçu. Les actions de la tablette restent visibles durant la session et peuvent être sauvegardées par une mutation ultérieure du MJ.

Confirmation supplémentaire avec `tests/audit-firebase-emulator.spec.mjs` : deux contextes Chromium séparés utilisent les vrais SDK et le vrai transport contre les émulateurs RTDB et Firestore, avec authentification simulée. Après déplacement de (2,2) à (3,2) sur les deux pages et attente, une lecture directement sur le serveur Firestore contient encore (2,2) ; une troisième page, dans un contexte neuf, démarre elle aussi à (2,2), alors que les deux premières sont à (3,2). L'assertion de convergence échoue sans marqueur ; le scénario est ensuite marqué en échec attendu. Aucune donnée de production ni connexion Google réelle n'est utilisée.

Faire sauvegarder par le MJ les mutations de campagne effectivement acceptées depuis la tablette, sans sauvegarder les masques éphémères ni écraser un instantané plus récent ; tester également portes, gabarits et franchissements, l'arbitrage de collision et l'arrivée d'un nouveau client après rétention.

### A5 — Les indicateurs de pose survivent à une déconnexion et à un changement de carte — priorité haute avant activation de la liaison

Reproduction avec le vrai contrôleur `createMapLink` de l'outil MJ et une horloge simulée : une première carte envoie `map.placed` pour `p:g1`, puis ne bat plus pendant plus de 15 secondes. Après `map.hello` d'une autre session de carte, sans nouveau `map.placed`, `placement()` indique toujours `connected: true`, `placed: ['p:g1']` et aucune entrée à poser. Le contrôleur conserve son ensemble `placed` à la déconnexion et n'exploite pas l'identifiant de session du nouveau `map.hello`.

Une carte qui ne renvoie que les pions réellement posés ne peut pas corriger les anciennes entrées absentes de sa propre scène. Cela peut masquer un pion à poser et déclencher des demandes de distance ou de mise en selle fondées sur l'ancienne carte. Prévoir une synchronisation complète et autoritaire de l'ensemble des placements à l'appairage ou à la reprise, avec les bons garde-fous contre les messages périmés ; tester aussi changement de session, rechargement rapide et délais sans battement.

**Vérification sur les versions récentes :** dans `tests/audit-cross-app.spec.mjs`, le pion lié est posé sur une première carte et l'indicateur « à poser » disparaît ; la première page est fermée et une nouvelle session de carte s'ouvre, où ce même pion est bien en réserve. L'indicateur de l'outil MJ reste pourtant masqué. Les deux vraies applications sont ouvertes sur une même origine locale, avec transport de test pour la synchronisation de la carte vers les joueurs. L'assertion a échoué sans marqueur, puis a été marquée en échec attendu.

### A6 — L'instantané de liaison n'annonce pas une liste d'engagements vide — priorité moyenne avant activation

Dans l'outil MJ, `sendEngagements(true)` n'envoie pas `mj.engagements` lorsque la liste est vide et déjà connue localement comme telle. Reproduction par appels directs : un engagement existe, puis disparaît pendant que la carte ne reçoit pas les messages ; à `map.hello`, la réponse contient `mj.snapshot` et `mj.roster`, mais aucun `mj.engagements { pairs: [] }`.

Le scénario `tests/audit-cross-app.spec.mjs` ouvre les deux applications récentes sur la même origine, crée un engagement et observe sa présence dans les données transmises au calque de la carte. Le message de suppression est volontairement filtré pour simuler sa perte ; après un nouvel appairage et réception de l'instantané, le calque reçoit encore l'ancienne paire. L'assertion a échoué sans marqueur puis a été marquée en échec attendu. Ce test vérifie l'état donné au rendu ; il ne mesure pas la probabilité de perte du message ni la visibilité réelle d'un trait lorsque les pions sont masqués ou en réserve. Envoyer systématiquement l'état absolu vide à l'appairage, ou définir une remise à zéro explicite dans le contrat et la tester des deux côtés.

### A7 — Contrat non suivi du checkout ancien périmé ; contrats récents identiques

La copie **non suivie et préexistante** du checkout ancien omet des amendements, dont la règle de distance diagonale ; elle n'a pas été écrasée. **Rectification :** les fichiers `E:/rpg-map-display-liaison/docs/CONTRAT-LIAISON-OUTIL-MJ.md` et `E:/Outil MJ Warhammer/docs/CONTRAT_LIAISON_MAP_DISPLAY.md` ont le même SHA-256 et sont donc identiques dans les worktrees récents vérifiés. Le risque de divergence concerne le document ancien local, pas ces deux copies récentes.

### A8 — Une resynchronisation tardive peut annuler une action faite pendant son attente — priorité haute

Reproduction sur la vraie page MJ avec un transport simulé : au réveil, déclencher une resynchronisation dont la réponse est retenue ; déplacer le pion de (2,2) à (3,2) pendant l'attente ; livrer ensuite un instantané antérieur. La page rétablit (2,2), alors que le déplacement avait été accepté. Le test `tests/audit-resync-inflight.spec.mjs` a été exécuté sans marqueur et a effectivement échoué sur cette position, puis l'échec a été marqué attendu. La mutation du pion est faite directement par le store pour maîtriser le moment de la course ; le délai et l'instantané proviennent d'un transport simulé, pas de Firebase réel.

Le mécanisme est dans `js/app/gm.js` : la reprise asynchrone réapplique l'instantané sans vérifier si la campagne a changé depuis son lancement. La vue joueurs utilise le même schéma dans `js/app/player.js`. Une reprise peut notamment continuer après l'échéance de dix secondes : l'interface reste utilisable, mais le résultat tardif peut remplacer une action ultérieure. Protéger la reprise contre les mutations concurrentes et tester les deux vues, la publication et l'état durable ; ne pas supposer que le résultat tardif est toujours sûr.

Confirmation avec les vrais SDK, la vraie page MJ et les émulateurs : la resynchronisation lit un ancien instantané dont la remise à l'application est artificiellement retenue ; le MJ déplace ensuite le pion et Firestore est vérifié à (3,2). Après libération de l'instantané, l'écran MJ revient à (2,2) alors que Firestore reste à (3,2). Le scénario `tests/audit-firebase-emulator.spec.mjs` a été exécuté sans marqueur puis marqué en échec attendu. Le délai est injecté après lecture de l'instantané : il prouve le défaut de traitement d'un résultat tardif, pas la fréquence de ce délai en production.

La variante tablette est aussi reproduite avec deux pages et les émulateurs : pendant que son ancien instantané est retenu, elle déplace le pion ; le MJ reçoit la nouvelle position et celle-ci est explicitement sauvegardée pour isoler le test d'A4. Quand l'instantané est libéré, la tablette revient à (2,2), tandis que le MJ reste à (3,2). Le scénario a échoué sans marqueur puis a été marqué en échec attendu.

### A9 — Une coupure réseau après connexion n'est pas remontée au badge — priorité haute

L'état `.info/connected` est observé par le transport Firebase pour les aperçus de déplacement, mais n'est pas relié au badge réseau des pages. Reproduction au niveau du vrai transport avec l'émulateur Realtime Database : après connexion effective, `goOffline` fait passer `_movePreviewWasConnected` à `false`, sans appeler aucun abonné `onError`. Reproduction complémentaire dans la vraie page MJ sous Chromium avec le vrai SDK et l'émulateur : après cette coupure RTDB, l'état interne vaut `false` mais le badge affiche toujours « Firebase connecté » pendant au moins 2,5 secondes. Côté tablette, le badge « connecté » est masqué par le code. Les écritures qui restent en attente hors ligne n'apportent pas nécessairement d'erreur immédiate. La coupure est provoquée par `goOffline` sur RTDB et non par une coupure physique de tout le réseau ; les éventuels messages dus à des actions ultérieures ou à d'autres erreurs ne sont pas exclus. Brancher un état de connectivité explicite sur les deux interfaces et vérifier la coupure physique, la reconnexion et les écritures en attente.

### A10 — Une action manuelle de brouillard peut être effacée par le chargement tardif du masque — priorité haute

La page MJ charge asynchronement le masque enregistré dans `getExploredFog`, mais le rend immédiatement manipulable. `importPng` remplace ensuite le canvas par le masque ancien ; la resynchronisation relance uniquement la vision courante et ne rejoue pas les gestes de brouillard manuel. Dans `tests/audit-fog-import-race.spec.mjs`, le décodage d'un masque vierge est volontairement retenu, puis le MJ clique « Tout révéler » : le masque publié est vérifié à 255. Lorsque le décodage ancien est libéré, le même pixel retombe à 0 et le masque ainsi régressé est publié. Le test utilise les vrais outils et la vraie page, avec un décodage artificiellement retardé et un transport simulé ; il a échoué sans marqueur, puis a été marqué en échec attendu. En conditions normales, la probabilité dépend du temps de décodage et du moment de l'action ; elle n'a pas été mesurée sur la tablette cible.

Attendre la restauration avant d'autoriser les gestes ou fusionner/rejouer de façon ordonnée les opérations intervenues pendant le chargement, y compris « masquer », « révéler » et annuler ; une simple union ne suffit pas pour les actions de masquage.

### A11 — Deux publications de brouillard peuvent être livrées dans l'ordre inverse — priorité haute

`scheduleFogPublish` lance une compression asynchrone par publication sans numéro de génération ni contrôle à son achèvement. Le scénario `tests/audit-fog-export-race.spec.mjs` retarde artificiellement la compression issue de « Tout révéler », exécute ensuite « Tout masquer » et attend la publication de ce second masque. Lorsque la première compression est libérée, elle remplace le masque le plus récent et le pixel relu devient 255 au lieu de 0. Le test utilise les vrais boutons et la vraie page MJ, avec un transport simulé et un délai artificiel ; il a échoué sans marqueur, puis a été marqué en échec attendu. La fréquence réelle de cette inversion n'est pas mesurée.

Sérialiser les publications par étage ou associer une génération à la capture pour ignorer tout achèvement dépassé, en vérifiant aussi le stockage local et les événements reçus par la tablette. Cette course est distincte d'A10 : elle concerne l'ordre de sortie de deux encodages, après les actions, pas l'import d'un ancien masque au démarrage.

### A12 — La portée et les murs ne prennent pas en compte toute l'emprise des grands pions — priorité haute

Deux scénarios dans `tests/audit-large-token-border.spec.mjs` utilisent les vrais gestionnaires de la vue joueurs, avec un transport de test :

- Sur une grille carrée 4×4, un pion 2×2 ancré en (1,1) peut préparer l'arrivée (3,1), alors que son emprise dépasserait la carte. La seconde sélection de l'arrivée ne déplace pas le pion, la validation du schéma refusant finalement cette position : l'aperçu promet donc une arrivée qui ne peut pas être validée.
- Sur une grille 5×5, un mur vertical en x=2 sépare les colonnes 1 et 2. Un pion 2×2 ancré en (0,1), entièrement à gauche du mur, peut préparer et valider l'ancrage (1,1) : sa nouvelle emprise couvre les colonnes 1 et 2 et traverse le mur. La case d'ancrage seule n'a pas franchi l'arête bloquée.

Le calcul `movementRulesFor` et le parcours `computeReachable` ne reçoivent que la case d'ancrage et ne vérifient pas la taille pendant les pas ; le contrôle final du store vérifie les limites et les collisions entre pions, pas le recouvrement des murs par l'emprise. Les deux assertions ont échoué sans marqueur, puis ont été marquées en échec attendu. Adapter la portée, la préparation et la revalidation à l'emprise complète, en tenant compte des géométries carrée et hexagonale et des règles de portes ; conserver les arbitrages existants pour la traversée d'autres pions : le plan de retour de session interdit expressément d'inventer une interdiction supplémentaire de traverser leurs cases.

### A13 — Un échec de chargement du SDK Firebase au démarrage laisse le mode local sans avertissement ni reprise — priorité haute

`firebase-config.js` active la configuration Firebase pour un navigateur ordinaire, mais la désactive lorsque `navigator.webdriver` est vrai. Le scénario `tests/audit-startup-cdn-offline.spec.mjs` simule le navigateur ordinaire, bloque les requêtes du CDN Firebase et démarre une campagne déjà enregistrée sur ce poste. La campagne s'ouvre localement, mais le badge réseau est vide, sans état « hors ligne » ni erreur ; l'assertion a échoué sans marqueur puis a été marquée en échec attendu.

Dans `connectSession`, l'import dynamique du SDK a lieu avant le bloc qui signale les erreurs. Son rejet est converti par `attendreConnexion` en absence de transport **sans** `delaiDepasse` ; le mécanisme de connexion tardive et de rechargement automatique n'est alors pas installé. En conséquence, un rétablissement ultérieur ne déclenche pas la reprise prévue par ce mécanisme. Le test reproduit l'échec d'accès au CDN avec un serveur local et une campagne locale, pas une coupure physique générale ; il ne prouve pas les autres causes possibles d'échec du SDK. Signaler l'échec et prévoir une reprise, en distinguant un refus d'authentification d'une connexion en attente.

### A14 — Un trajet préparé reste validable après reconnexion, sans aperçu partagé — priorité haute

Le plan de retour de session demande explicitement d'abandonner la préparation locale à la reconnexion. Avec la vraie page MJ, le vrai transport et les émulateurs Firebase, `tests/audit-firebase-emulator.spec.mjs` prépare un déplacement de (2,2) à (3,2) et vérifie la présence de l'aperçu dans RTDB. Après `goOffline` puis `goOnline`, il attend la reconnexion et vérifie que l'entrée d'aperçu est retirée. Un seul clic sur l'ancienne arrivée valide pourtant le mouvement vers (3,2) : la préparation locale n'a pas été abandonnée, alors que son aperçu n'existe plus sur le canal. L'assertion a échoué sans marqueur puis a été marquée en échec attendu. La coupure utilise le SDK RTDB et les émulateurs ; une coupure physique n'a pas été exercée.

Le transport ferme sa génération et nettoie l'aperçu, mais cette transition n'est pas communiquée au contrôleur `MovePlanningController`, qui conserve `plan`. Le reconnecteur doit invalider la préparation et en informer l'utilisateur ; vérifier les deux rôles, une coupure pendant une écriture et la validation immédiatement après reprise.

### A15 — Deux sauvegardes concurrentes peuvent rétablir un ancien état — priorité critique

`scheduleSnapshot` programme les écritures sans attendre la fin de la précédente. `FirebaseTransport.saveSnapshot` crée une transaction à partir de l'instantané reçu et avance la révision à partir du parent courant ; cette révision ordonne les transactions validées, mais ne vérifie pas l'ordre des mutations qui ont produit les instantanés.

Dans `tests/audit-firebase-emulator.spec.mjs`, la vraie page MJ et le vrai transport sont reliés aux émulateurs. Le test retient artificiellement la première sauvegarde **avant son entrée dans le transport**, déplace ensuite le pion de (3,2) à (4,2), puis vérifie que Firestore contient bien (4,2). La première sauvegarde est libérée : elle écrit (3,2) avec une révision plus récente, tandis que l'écran reste à (4,2). L'assertion de convergence a échoué sans marqueur, puis a été marquée en échec attendu. Ce test établit l'absence de protection contre cet ordre d'arrivée ; il ne démontre pas que le SDK ou le réseau réel inverse effectivement les requêtes, ni à quelle fréquence. La même règle d'ordonnancement doit être examinée pour les sauvegardes de plusieurs postes et les tentatives transactionnelles rejouées.

Sérialiser ou versionner les sauvegardes de manière à empêcher une ancienne capture de remplacer une plus récente, tout en traitant explicitement les écritures concurrentes de clients distincts et les échecs ; vérifier ensuite la relecture par un client neuf.

## Vérifications réalisées

Les résultats jusqu'à la ligne « Vérification complémentaire » concernent la première passe sur `4135c1f`, sauf indication contraire. Les résultats suivants concernent `817e22f`.

- Typage et cohérence des dépendances : réussis.
- Tests unitaires : 738 réussis, 2 ignorés sans émulateurs.
- Règles Firebase : scénario émulateurs réussi, un contrôle réservé à la CI ignoré, sur des ports temporaires.
- Gestes navigateur : 4 réussis.
- Tests unitaires ciblés sur la liaison côté outil MJ : 56 réussis ; ils ne couvrent pas A3 ni une liaison réelle avec les deux applications.
- Suite Chromium relancée avec serveur préexistant : commande terminée avec 312 scénarios comptés « passed », dont les deux reproductions A2 et A4 marquées en échec attendu, et 6 ignorés faute de configuration Firebase réelle. Le test A8, ajouté après le lancement de cette suite, a été exécuté séparément. Le premier lancement, dont le processus était resté bloqué à l'arrêt du serveur, avait été interrompu sans bilan final.
- Reproduction A2 : le test échoue sur le résultat attendu, puis passe en tant qu'échec attendu avec `test.fail`.
- Reproduction A4 : déplacement appliqué sur les deux pages ; sur les émulateurs Firebase avec les vrais SDK, Firestore et un client neuf restent sur l'ancienne case. L'authentification est simulée ; Firebase de production n'a pas été utilisé.
- Reproduction A5 : appels directs du contrôleur de liaison MJ avec canal et horloge simulés ; après déconnexion et nouvel appairage, un ancien placement reste présent sans annonce de la nouvelle carte.
- Reproduction A6 : engagement retiré avant `map.hello`, puis inspection des messages réellement émis ; aucun état d'engagement vide n'est renvoyé.
- Comparaison A7 : différences de contenu confirmées avec `git diff --no-index --ignore-space-at-eol` entre les deux contrats présents dans les worktrees.
- Reproduction A8 : vraie page MJ, transport réel et émulateurs ; la position passe de (2,2) à (3,2), elle est écrite dans Firestore, puis un instantané dont la remise est retardée ramène l'écran à (2,2) tandis que Firestore reste à (3,2).
- Reproduction A9 : transport Firebase réel connecté à l'émulateur RTDB, puis `goOffline` ; l'état de connexion interne passe à faux sans émission `onError`. Dans la vraie page MJ, le badge conserve « Firebase connecté » pendant l'observation.
- Reproduction A10 : vraie action « Tout révéler » sur la page MJ, contrôle des pixels avant et après libération du décodage ; le pixel passe de 255 à 0.
- Reproduction A11 : actions successives « Tout révéler » puis « Tout masquer », première compression retenue jusqu'après la seconde publication ; le masque final enregistré redevient révélé.
- Reproduction A12 : pion 2×2 sur les vraies pages joueurs, avec transport simulé ; aperçu d'une arrivée hors limites et déplacement effectif d'une partie de l'emprise au-delà d'un mur.
- Reproduction A13 : navigateur simulé comme non piloté, CDN Firebase bloqué au démarrage ; campagne locale chargée, badge réseau vide.
- Reproduction A14 : vraie page MJ et SDK Firebase sur émulateurs ; après reconnexion et retrait de l'aperçu RTDB, l'ancien trajet reste validable en un clic.
- Reproduction A15 : sauvegarde ancienne retenue avant son entrée dans le transport, sauvegarde récente confirmée dans Firestore, puis ancienne libérée ; l'écran reste à (4,2) et Firestore revient à (3,2).
- Vérification complémentaire sur `817e22f` : huit scénarios navigateur de la première passe (A2, A4, A8, A10 à A13) et les six scénarios Firebase/émulateurs (A4, A8, A9, A14, A15) ont reproduit leurs échecs attendus. Ils utilisent les pages du worktree récent et le harnais de test du checkout ancien ; les identités Firebase sont simulées. Les 48 tests unitaires ciblés de la liaison de `817e22f` passent.
- Liaison réelle sur une même origine locale : trois scénarios `tests/audit-cross-app.spec.mjs` connectent les applications récentes, reproduisent A3, A5 et A6 et vérifient la conservation d'un pion autonome ; ils sont marqués en échec attendu après leurs préconditions. Pour A6, la perte du message de suppression est injectée. Le serveur de test sert Map Display `817e22f` et route l'application MJ depuis son worktree `f0fab80` ; les données navigateur sont isolées.
- Sur `817e22f`, typage et cohérence des dépendances réussis ; 7 scénarios Chromium existants de brouillard et de propagation des pions réussis. La suite unitaire donne 793 réussites, 3 tests ignorés et un échec lié au refus d'écriture du bac à sable dans le worktree récent. Les 3 tests du paquet, dont celui concerné, réussissent ensuite sur une copie temporaire de `817e22f` complétée avec les cartes générées locales.

Les six scénarios navigateur avec émulateurs sont conservés dans `tests/audit-firebase-emulator.spec.mjs`, ignorés lorsque les variables des émulateurs sont absentes, et marqués en échec attendu après leurs préconditions. Pour les rejouer avec les ports disponibles :

```sh
pnpm exec firebase emulators:exec --project demo-rpg-map-display-rules --only firestore,database "pnpm exec playwright test tests/audit-firebase-emulator.spec.mjs --project=chromium"
```

Ils utilisent les SDK du `node_modules` local et une identité simulée ; aucun secret ni compte de production n'est requis. Un `passed` Playwright signifie ici que l'échec attendu a bien eu lieu : il ne signifie pas que l'anomalie est corrigée.

Pour reproduire les trois tests entre applications récentes, servir d'abord `E:/rpg-map-display-liaison` avec `node scripts/serve.mjs --port 4173`, puis, depuis `E:/rpg-map-display` dans un second terminal PowerShell :

```powershell
$env:RPG_AUDIT_MJ_ROOT = 'E:\Outil MJ Warhammer'
pnpm exec playwright test tests/audit-cross-app.spec.mjs --project=chromium
```

Le serveur sur 4173 doit impérativement servir le worktree récent : la configuration Playwright réutilise tout serveur déjà présent sur ce port. Les tests chargent l'outil MJ sur la même origine via une route locale et emploient des données navigateur de test.

## Limites et suites

La liaison a été exercée entre les deux applications pour l'appairage, l'arrivée d'un participant et les scénarios A3, A5 et A6 ; cela ne couvre pas tous les parcours ni les conditions réelles de séance. Firebase de production, la tablette physique et le cast n'ont pas été éprouvés ici. Le mode local sans Firebase est un mode propre à chaque appareil : `connectSession` retourne `null` en l'absence de configuration ; le transport LAN est un squelette non implémenté. Les écrans MJ et joueurs ne se synchronisent donc pas entre appareils dans ce mode. Ce comportement est à distinguer de l'autonomie vis-à-vis de l'outil MJ.

### Ordre de traitement proposé

1. **Préserver l'état de partie** : A4, A8 et A15, avec tests de convergence et de reprise sur émulateurs.
2. **Préserver le brouillard et rendre les coupures visibles** : A2, A9, A10, A11, A13 et A14, y compris tests multi-étages et actions rapides ; traiter aussi l'emprise des grands pions A12.
3. **Corriger la liaison récente** : traiter A3, A5 et A6 et étendre les scénarios entre les deux applications en conservant les parcours autonomes. Préserver le contrat non suivi ancien et les autres modifications locales avant toute mise à jour du checkout.
4. **Recette sur le matériel** : tablette, cast, coupure physique et reconnexion, puis vérification de l'intégration dans le navigateur et les conditions de même origine prévus. Ces observations ne sont pas déductibles des émulateurs.
