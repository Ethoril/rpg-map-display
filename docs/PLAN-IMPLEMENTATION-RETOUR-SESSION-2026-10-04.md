# Plan d’implémentation des améliorations après session

Date : 4 octobre 2026. Statut : implantation réalisée dans le dépôt ; recette matérielle restante. Les résultats exécutés sont consignés dans [ETAT.md](ETAT.md).

Validation finale locale : `pnpm run verify` réussi (737 unitaires, 309 Chromium, 4 gestes diagnostiques ; 2 unitaires et 6 Chromium ignorés), émulateurs Firebase réussis et `git diff --check` réussi. Le matériel de session n’a pas été essayé pour ce chantier.

Ce plan met en œuvre le [cahier des charges du retour de session](CAHIER-DES-CHARGES-RETOUR-SESSION-2026-10-04.md), avec les douze choix confirmés. Il organise les travaux en lots vérifiables : manipulation des gabarits, rendu de portée, préparation du mouvement, partage des aperçus et ping joueurs.

Le socle reste celui du projet : JavaScript avec JSDoc et vérification TypeScript, modules natifs, Canvas 2D, Firebase dans son transport dédié. Aucune nouvelle dépendance ni migration de campagne n’est prévue. Les règles de mouvement et le glisser libre du MJ sont conservés.

## 1. Points de départ vérifiés dans le code

| Fonctionnement actuel | Conséquence pour l’implémentation |
|---|---|
| `js/ui/player/bootstrap.js` traite les taps joueurs et déplace immédiatement vers la destination. | Remplacer cette branche par préparation, prolongement, annulation et validation. |
| `js/app/gm.js` sélectionne les pions au clic mais ne comporte pas ce parcours de déplacement par destination. | Ajouter le parcours au clic MJ, hors outils armés, en préservant les arbitrages de cible et le glisser libre. |
| `movementRulesFor` dans `js/state/selection.js` centralise budget, terrain et arêtes bloquées, y compris les règles à cheval. | Le nouveau moteur doit utiliser cette source, aussi bien pour la portée que pour le trajet. |
| `computeReachable` renvoie distances et prédécesseurs ; `reconstructPath` reconstruit le chemin. | Réutiliser le même résultat pour la portée restante et le segment choisi, sans seconde recherche inutile. |
| `store.moveTokenToCell` accepte déjà un chemin animé et contrôle l’occupation de la destination. | Conserver cette mutation pour le mouvement validé ; ne jamais l’utiliser pour l’aperçu. |
| Le tap sur son propre pion peut franchir une liaison d’étage. | Conserver cette branche ; l’annulation de préparation passe désormais par un clic sur le fond hors zone. |
| Les gabarits ont déjà une translation, une rotation et un aperçu ; un outil MJ armé empêche le glisser. | Diagnostiquer le geste réel puis ajouter sélection dans la liste et poignée prioritaire. |
| Le ping est déjà rendu et reçu côté joueurs ; son émission est actuellement MJ. | Ajouter le double tap et l’émission joueurs en réutilisant le marqueur. |
| `Transport.publish` retourne un résultat `{ok: true}` ou `{ok: false, error}` ; sa promesse ne rejette pas. | Examiner le résultat d’écriture, sans compter uniquement sur un `catch`. |
| Les tests distinguent logique pure, navigateur, gestes et mesures matérielles. | Conserver ces familles et le worker unique local. |

Ces constats sont issus d’une lecture du dépôt ; ils ne constituent pas une recette exécutée sur la tablette ou le vidéoprojecteur.

## 2. Organisation du code

### Modules communs à ajouter

L’architecture du dépôt impose un manifeste de fichiers. Avant toute création de module applicatif, inscrire dans `docs/ARCHITECTURE.md` les trois responsabilités suivantes, ainsi que leurs tests :

| Nouveau fichier proposé | Responsabilité |
|---|---|
| `js/state/movePlan.js` | État temporaire et fonctions pures de construction, coût et validation d’une préparation. Aucun DOM, aucune écriture de campagne, aucun import Firebase. |
| `js/app/movePlanning.js` | Contrôleur commun aux deux vues : transitions, lecture de l’état courant, invalidations, validation locale, publication et gestion des aperçus reçus. |
| `js/render/layers/movePlan.js` | Dessin du chemin, de l’arrivée et du nombre restant, sans gestion de clic ni mutation. |

Les vues continuent de résoudre leurs propres cibles et permissions. Elles transmettent au contrôleur une sélection ou une destination déjà identifiée ; le contrôleur ne réimplémente pas les hit-tests de porte, lampe, pion ou gabarit.

### État de préparation

Définir les types partagés dans `js/core/types.js`. Une préparation locale contient au minimum : identifiant de préparation, pion, étage, position réelle de départ, étapes choisies, chemin complet, budget initial, coût cumulé, capacité restante et révision. Le résultat courant de portée comprend distances et prédécesseurs ; il reste local et n’est pas envoyé sur le réseau.

Le contrôleur expose des transitions explicites : sélectionner, préparer une étape, annuler en gardant la sélection, désélectionner, valider, invalider et terminer. Un état de validation en cours empêche une deuxième validation du même trajet. La cible du clic hors zone ayant annulé une préparation est retenue pour le clic suivant, afin qu’un second clic au même endroit désélectionne même après agrandissement de la portée affichée ; une autre interaction efface ce rappel.

La position et le déplacement animé du pion dans la campagne restent les données de référence. La préparation n’entre ni dans `campaign`, ni dans `token.move`, ni dans `createSnapshotPayload`, ni dans la sauvegarde locale.

### Portée et coût

Réutiliser `movementRulesFor`, `computeReachable` et `reconstructPath`. Pour chaque arrivée préparée, calculer la portée depuis cette arrivée avec le budget restant. Quand une nouvelle case est choisie, reconstruire son segment depuis les prédécesseurs courants, puis concaténer ce segment au chemin existant sans dupliquer sa case de jonction.

Le coût du segment vient du résultat de portée. La revérification du chemin complet utilise la même fonction de coût de pas que Dijkstra : extraire au besoin cette fonction dans le module de mouvement existant, sans changer sa formule. Les diagonales carrées ont actuellement un coût octile ; conserver les fractions et utiliser une tolérance numérique documentée pour les comparaisons de budget.

Reprendre exactement les contrôles actuels de murs, portes, terrain, limites et occupation. Distinguer les contrôles portant sur une étape et ceux portant sur la destination ; ne pas ajouter à l’occasion du chantier une interdiction de traverser des cases qui était absente des règles actuelles. Le pion ne doit pas entrer en conflit avec sa propre emprise pendant la préparation virtuelle.

## 3. Partage des aperçus de mouvement

### Transport proposé

Utiliser un état RTDB temporaire par client sous `session/<sessionId>/movePreviews/<clientId>`, séparé du canal des événements de campagne. Ce choix permet de remplacer un aperçu plutôt que d’empiler son historique, et d’enregistrer sa suppression par `onDisconnect`.

Étendre `js/transport/Transport.js` avec des méthodes de publication, retrait conditionnel et abonnement aux aperçus, suivant le contrat de résultat des écritures existantes. Leur implémentation Firebase reste exclusivement dans `js/transport/FirebaseTransport.js`. Étendre également le transport de test dans `tests/browserTestTransport.mjs`.

Le message comporte : identifiant de préparation, révision croissante, étage, pion, départ réel, chemin, arrivée et capacité restante. L’identité du propriétaire est déterminée par le transport. Valider les coordonnées entières, les nombres finis, les identifiants et la longueur du chemin avant écriture et à la réception. La limite de taille doit être cohérente avec les trajets admis par le moteur et les plafonds existants ; ne pas tronquer silencieusement un chemin.

### Ordre et nettoyage

- Publier après chaque modification effective d’étape, jamais à chaque frame ou déplacement du pointeur.
- Sérialiser les écritures d’un propriétaire et rejeter les révisions périmées. Une fermeture conditionnelle ne retire que la préparation désignée ; elle ne doit pas effacer la suivante.
- À validation, annulation, invalidation, changement d’étage ou remplacement de scène, retirer l’entrée correspondante.
- À la déconnexion, le retrait serveur prévu par `onDisconnect` nettoie l’entrée. À la reconnexion, rétablir ce mécanisme avant d’émettre un nouvel aperçu et abandonner la préparation locale précédente.
- À la réception d’un mouvement réel ou d’une modification invalidante, retirer immédiatement les aperçus concernés et mémoriser les préparations terminées pour ignorer leurs mises à jour tardives.
- À l’abonnement, n’afficher que les préparations actives dont le propriétaire est présent, le pion existe, le départ correspond encore à sa position réelle et l’étage correspond. Un aperçu d’un propriétaire absent ou périmé ne doit pas ressurgir au rechargement.
- Réutiliser la présence existante pour filtrer les propriétaires disparus. Prévoir une vérification ponctuelle à l’échéance de présence, sans entretenir une boucle Canvas permanente.

Les clients peuvent recevoir une préparation encore active d’un autre poste ; ils ne restaurent jamais leur propre ancien trajet depuis le réseau. Une réception ne sélectionne pas le pion localement et ne déplace pas la caméra. Le transport ne crée aucun verrou : la résolution des mouvements réellement validés reste celle du projet.

Les vues joueurs appliquent leurs règles existantes de visibilité des pions avant de dessiner un aperçu MJ, notamment pour ne pas afficher le trajet d’un pion masqué. Les aperçus restent soumis au brouillard courant : préparer un trajet ne révèle aucune zone.

La vision du pion reste attachée à sa position réelle jusqu’à la validation. Vérifier dans le navigateur que les masques de vision courante et de brouillard exploré sont identiques avant et pendant les étapes de préparation, sur les deux vues. Seul le mouvement exécuté après validation peut faire évoluer ces masques selon les règles existantes.

### Échec d’écriture

Un aperçu refusé à la publication laisse la campagne intacte et utilise le diagnostic réseau existant. Les entrées distantes obsolètes sont filtrées grâce à leur propriétaire, leur génération et la position réelle du pion. Ne pas introduire une restauration globale de campagne en réponse à un échec d’aperçu.

Le mouvement validé conserve le comportement réseau existant. Traiter séparément refus local, correction distante pour conflit d’occupation et échec de publication ; une écriture distante refusée ne doit pas être présentée comme une synchronisation réussie. Le diagnostic hors ligne actuel est conservé.

## 4. Lots de réalisation

### Lot 0 — Contrats et base de vérification

Relire les conventions applicables, inscrire les modules dans le manifeste et définir les types, transitions et contrats de transport. Relever le résultat des contrôles existants pour distinguer un échec antérieur d’une régression du chantier.

Fichiers : `docs/ARCHITECTURE.md`, `js/core/types.js`, `js/core/constants.js`, `js/transport/Transport.js` et tests d’architecture.

**Sortie attendue :** responsabilités et contrats écrits ; conservation des gestes de liaison et annulation hors zone consignées ; aucun changement visible de geste à ce stade.

### Lot 1 — Gabarits manipulables et identifiables

Reproduire le glisser avec les vrais événements de pointeur. Vérifier en premier l’outil armé, l’ordre d’arbitrage au début du glisser et la zone de translation des cônes et lignes.

Ajouter une action de sélection distincte de « Retirer » dans la liste MJ. Cette sélection désarme l’outil de pose, identifie le gabarit choisi et rend sa poignée de translation visible. Sur cette poignée uniquement, donner priorité au gabarit sélectionné devant un pion ou une autre cible ; conserver les arbitrages ordinaires ailleurs.

Conserver `templateDragPose`, l’aperçu local et la mutation unique au relâchement. Nettoyer la sélection si le gabarit est retiré ou si l’étage change. Éviter la reconstruction de la liste à chaque notification étrangère aux gabarits, conformément à la protection existante.

Fichiers : `js/ui/gm/templateTools.js`, `js/ui/gm/panel.js`, `js/app/gm.js`, `js/input/templateHit.js`, `js/render/layers/templates.js`, `css/gm.css`.

Tests : `templateTools.test.mjs`, `templateHit.test.mjs`, `templates.spec.mjs`, gestes de gabarits dans `tests/manuel/`.

**Sortie attendue :** les trois formes se déplacent réellement, y compris depuis une poignée superposée ; translation et rotation restent distinctes ; interruption et synchronisation sont correctes.

### Lot 2 — Portée lisible en projection

Renforcer le remplissage et dessiner les contours opaques par case. Ajouter le zoom aux paramètres de rendu pour exprimer l’épaisseur en pixels écran. Conserver le remplissage groupé qui évite les coutures d’opacité ; tracer les contours séparément pour éviter de renforcer deux fois un bord partagé.

Centraliser les valeurs fixes dans les constantes. Commencer les essais dans les plages du cahier des charges, puis ajuster sur le vidéoprojecteur. Aucun réglage utilisateur supplémentaire.

Fichiers : `js/render/layers/moveZone.js`, `js/core/constants.js`, appels dans `js/app/gm.js` et `js/app/player.js`, `tests/mountStage.mjs`.

Tests : `moveZone.spec.mjs`, cases carrées et hexagonales, plusieurs zooms et fonds. Les tests vérifient la couverture et les contours ; la projection réelle valide la lisibilité.

**Sortie attendue :** le surlignage gagne en contraste sans modifier les cases calculées ni masquer les informations de jeu.

### Lot 3 — Moteur et rendu de préparation locale

Implémenter les fonctions pures de préparation puis le contrôleur commun. Ajouter la couche de chemin à l’ordre de rendu : trajet sous le brouillard courant ; marqueur d’arrivée et compteur lisibles sans découvrir le décor masqué. Le chemin est statique et ne demande une frame qu’à sa modification ou à celle de la caméra.

Brancher le rendu sur la portée virtuelle quand une préparation existe, et sur la portée initiale sinon. Le marqueur d’arrivée reste affiché à budget nul. Ajouter une observation ciblée des changements de pion, règles, occupation et étage ; ne pas relancer Dijkstra lors de chaque publication de vision ou de brouillard.

Fichiers : les trois nouveaux modules, `js/movement/reachable.js`, `js/movement/path.js`, `js/state/selection.js`, `js/core/types.js`, `js/core/constants.js` et assemblage des couches dans les deux vues.

Tests proposés : `movePlan.test.mjs` pour les coûts, segments, annulations et revérifications ; `movePlan.spec.mjs` pour le dessin et le budget nul. Enregistrer ces fichiers dans le manifeste.

**Sortie attendue :** une préparation peut être construite, dessinée, annulée et revérifiée sans aucune mutation de position, de vision ou de sauvegarde.

### Lot 4 — Gestes de déplacement joueurs et MJ

Remplacer le mouvement immédiat dans `js/ui/player/bootstrap.js`. Intégrer le même contrôleur dans le traitement des taps de `js/app/gm.js` lorsque le MJ n’utilise aucun outil armé.

Ordre de traitement : outils et cibles selon les arbitrages existants, notamment le clic sur son personnage pour franchir une liaison ; clic sur la dernière arrivée pour valider ; autre personnage pour changer la sélection ; second clic sur la cible d’annulation pour désélectionner ; nouvelle destination accessible pour prolonger ; fond hors portée pour annuler si un trajet existe, sinon désélectionner. Identifier les cases exactes avant d’appliquer la tolérance de désignation, pour qu’un clic sur l’arrivée près du pion reste une validation.

Conserver le franchissement existant, ses contrôles et ses refus, sans lui ajouter un geste d’annulation. Après un franchissement réussi, nettoyer la préparation et son aperçu parce que le départ réel du pion a changé. Tester le second clic d’annulation sur une case redevenue accessible après restauration de la portée initiale.

À validation, vérifier le départ réel, les permissions, chaque pas du chemin, le coût cumulé et l’occupation finale contre l’état courant. Appeler une seule fois `store.moveTokenToCell` avec le chemin complet et publier un seul `token.move`. Après acceptation locale du mouvement, désélectionner le personnage. Une validation locale refusée n’emprunte pas cette branche de réussite.

Un glisser libre du pion côté MJ abandonne sa préparation avant de démarrer et continue à utiliser le parcours actuel. Aucun glisser de pion n’est ajouté côté joueurs. Les outils MJ armés conservent leur priorité.

Tests : compléter `player.spec.mjs`, `appIntegration.spec.mjs`, `mountedToken.spec.mjs`, `multiLevelJourney.spec.mjs`, `conflitCase.spec.mjs`, `fogTrajet.spec.mjs` et les gestes pertinents. Mettre à jour les tests qui supposent une mutation après un unique tap destination, sans retirer leur assertion finale de mouvement ou de propagation.

**Sortie attendue :** le parcours complet fonctionne dans les deux vues, avec coût cumulé, budget nul, annulation et désélection ; le glisser libre MJ et les liaisons d’étage restent utilisables.

### Lot 5 — Aperçus entre postes

Implémenter le contrat temporaire RTDB décrit en section 3 et son équivalent dans le transport de test. Relier le contrôleur aux publications, suppressions et réceptions. Les aperçus locaux et reçus portent une identité pour éviter de dessiner deux fois celui du poste émetteur.

Vérifier les règles Firebase actuelles avec les nouvelles opérations. Leur modèle d’accès porte aujourd’hui sur la session ; aucune ouverture d’accès n’est nécessaire au seul motif de ce chantier. Adapter une règle uniquement si un test met en évidence un contrôle manquant, en conservant les autorisations existantes.

Fichiers : `js/transport/Transport.js`, `js/transport/FirebaseTransport.js`, `js/app/movePlanning.js`, les deux vues et `tests/browserTestTransport.mjs`. Le réducteur `js/app/networkEvents.js` continue de traiter les mouvements durables ; les aperçus restent hors de ce réducteur.

Tests : transport, rejeu tardif, fermeture conditionnelle, disparition du propriétaire, reconnexion, changement de scène et synchronisation sur plusieurs pages. Ajouter des tests d’émulateur pour les écritures et retraits d’aperçus autorisés et refusés. Conserver les corrections d’occupation du MJ.

**Sortie attendue :** préparer, prolonger, annuler et valider se voit sur les autres postes du même étage, sans mouvement anticipé, aperçu fantôme ni modification de sélection locale.

### Lot 6 — Double tap de ping joueurs

Ajouter au gestionnaire de pointeur une reconnaissance configurable du double tap, avec un prédicat injecté par la vue. L’input ne lit pas le store : la vue indique si aucune sélection active n’existe. Ajouter l’intention correspondante dans `js/input/gestures.js` et un rappel de contexte pour invalider une action différée devenue obsolète.

Sans sélection, différer le tap simple, même sur pion ou porte. Deux taps compatibles déclenchent un seul ping et consomment l’action simple en attente. Deux taps incompatibles ne doivent pas supprimer le premier : exécuter le tap simple arrivé à échéance, puis réévaluer le contexte avant de traiter le suivant. Avec sélection active, traiter immédiatement la préparation, la validation, l’annulation hors zone et la désélection ; aucune fenêtre de double tap de ping. Le clic qui termine une désélection est consommé et ne doit pas devenir rétroactivement le premier tap d’un ping.

Capturer le point carte à la réalisation du tap, sans le reconvertir plus tard avec une caméra ayant changé. Annuler les timers sur pan, pincement, appui long, interruption, perte de focus, changement de contexte et détachement. Préserver les glissers de gabarits visibles côté joueurs et les gestes multi-touch existants.

Afficher le ping local puis publier l’événement `ping` existant avec `by: 'players'`. Conserver l’horodatage local à la réception, la durée et le filtrage d’étage. Le bouton de ping MJ reste inchangé.

Fichiers : `js/input/pointer.js`, `js/input/gestures.js`, `js/core/constants.js`, `js/ui/player/bootstrap.js`, `js/app/player.js`, `css/player.css` si nécessaire pour le comportement natif du navigateur.

Tests : `ping.spec.mjs`, `pings.test.mjs`, `player.spec.mjs`, gestes tactiles dans `tests/manuel/`. Vérifier notamment double tap sur porte et pion, tap simple différé, deux taps éloignés, sélection modifiée pendant le délai, validation rapide, interruption et absence de zoom natif.

**Sortie attendue :** ping partout sans sélection, action simple exécutée une seule fois lorsque c’est le geste réalisé, et aucune interaction parasite avec le déplacement.

## 5. Dépendances et critères de passage

Ordre de réalisation : **lot 0 → lot 1 → lot 2 → lot 3 → lot 4 → lot 5 → lot 6 → recette matérielle**. Le moteur de préparation précède les gestes ; le partage précède la recette finale à plusieurs postes ; le ping arrive après stabilisation des états de sélection dont il dépend.

Chaque lot doit être relisible avec son objectif, ses fichiers modifiés et le résultat de ses contrôles. Il ne constitue pas à lui seul une livraison publique des quatre fonctionnalités. Aucun commit, push ou déploiement automatique n’est inclus dans ce plan.

### Vérification automatisée

Pendant la réalisation, exécuter les tests ciblés après chaque changement significatif, avec le typecheck. À la fin du chantier, exécuter `pnpm run verify` et `git diff --check`. Exécuter également `pnpm run test:firebase-rules` pour les modifications du transport temporaire ; le script nécessite Java 21 comme documenté dans le projet.

Les tests navigateur locaux gardent un seul worker. Les mesures de latence et de fluidité restent des relevés matériels, distincts des assertions déterministes. Une réussite sur le transport simulé ne prouve pas le délai Firebase de 500 ms en conditions de session.

### Recette sur le matériel de jeu

Réaliser une session courte avec le poste MJ, la tablette et le vidéoprojecteur :

1. Reprendre les trois formes de gabarits, dont un sous un pion et deux superposés ; vérifier la pose finale sur les deux vues.
2. Vérifier les cases accessibles, le chemin, l’arrivée et le compteur sur cartes claire et sombre depuis les places habituelles.
3. Préparer plusieurs étapes, épuiser la capacité, annuler puis valider ; vérifier le chemin réel de l’animation et le brouillard après mouvement.
4. Changer une porte pendant la préparation et constater l’invalidation avec explication.
5. Vérifier le partage des chemins, l’annulation, la déconnexion et le retour d’un poste.
6. Pinguer sur fond, pion et porte sans sélection ; sélectionner puis valider rapidement un mouvement sans ping parasite.
7. Contrôler pan, zoom, glisser libre MJ, gabarits joueurs, cheval, liaisons d’étage et retour au repos du rendu.

## 6. Documentation et suivi

À la fin du chantier, mettre en cohérence `docs/CAHIER-DES-CHARGES.md`, `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`, `docs/CHANTIER-X-PING.md`, `docs/ETAT.md` et `README.md`. Reporter dans le cahier des charges du retour de session les valeurs de rendu retenues après projection. Corriger la description ancienne des liaisons dans le cahier principal pour refléter le code existant, sans changer les gestes de franchissement.

Arbitrage confirmé : l’annulation utilise un clic hors de la zone de déplacement ; le second clic désélectionne. Sans préparation, un clic hors zone désélectionne directement. Le clic sur le personnage et le fonctionnement des escaliers et autres liaisons restent ceux du code actuel. Aucun arbitrage fonctionnel ne reste ouvert sur ce point.

La livraison est complète lorsque les recettes du cahier des charges passent, les contrôles requis sont satisfaits et les vérifications matérielles réellement effectuées sont consignées. Les éventuels essais encore absents doivent rester explicitement marqués comme non vérifiés.
