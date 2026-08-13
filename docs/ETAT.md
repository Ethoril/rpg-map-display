# ÉTAT D’AVANCEMENT ET REPRISE

> Dernière mise à jour : 12 août 2026 — ✅ **le lot 3 est fermé à 6/6 et le décompte passe à 36 sur
> 41.** Deux acquis le même jour : le **ping** du MJ (chantier X) et le **critère 1 du lot 3**, ce
> dernier étant satisfait depuis un moment par `test_village_complet` — je l'avais mal lu et j'en
> avais fait une question de licence. ⛔ **La licence est le domaine du mainteneur et ne conditionne
> aucun travail technique** : consigne donnée quatre fois, à ne plus rouvrir. Le **chantier Y** rend
> par ailleurs importable n'importe quelle image comme fond de carte, ce qui débloque une
> bibliothèque de 1 774 cartes.
>
> Avant cela, le 11 août 2026 — **campagne de diagnostics passée sur la Tab S9 FE, aucun
> problème de performance constaté** ; le chantier O est clos et l'arbitrage A7 a sa mesure. Deux
> sondes de `diag.html` rendaient des chiffres faux : **7bis est corrigée et son calcul est désormais
> éprouvé**, celle du décodage froid reste un piège connu. Un défaut latent du produit a été trouvé
> en écrivant ce test — un fond animé de moins de 2,5 s était rabattu à tort sur l'affiche fixe — et
> **corrigé le jour même** : la période d'échantillonnage du contrôle de cadence est désormais dérivée
> de la durée du flux.
> Lire « Campagne de diagnostics sur la tablette — 11 août 2026 » avant de citer un chiffre de cette
> page. Avant cela,
> le 8 août 2026 : **premier run CI complet vert, émulateurs Firebase compris**
> (voir « Premier run CI complet »). **Le lot 2 du CdC est fermé à 13 critères sur 13.** L-01 arêtes bloquées, L-02 sweep de visibilité et sa mesure sur la tablette,
> L-03 union des champs de vision, L-04 fog persistant, L-05 portes à trois états, L-06 outils
> de fog du MJ, L-07 éditeur de murs, L-10 gabarits libres, L-09 marqueurs d'état. Le mainteneur
> confirme le 07/08/2026 les trois derniers critères matériels : marqueurs lisibles sur les trois
> écrans, réponse des portes sous 300 ms et ouverture tactile du premier coup.
>
> **Phase R0 de la feuille de route complémentaire fermée le 7 août 2026.** La zone morte entre
> tap et appui long est supprimée ; une destination refusée ou occupée reçoit un retour Canvas
> transitoire ; le mode local ne charge plus Firebase ; le panneau MJ tient à 1024 et 1280 px avec
> une navigation d'onglets accessible ; les textes issus des imports sont rendus sans interprétation
> HTML ; les séparateurs NUL/SOH de `panel.js` ont disparu. Vérification d'intégration : **289 tests
> unitaires, 142 tests navigateur et 3 gestes diagnostiques réussis** ; 2 scénarios Firebase réels
> restent ignorés localement faute de secret.
>
> **Phase R1 implantée dans le dépôt le 7 août 2026 ; porte d'exploitation encore ouverte.**
> Le canal RTDB possède une rétention transactionnelle protégée par leases et curseurs ACK ; le
> ménage est explicite, borné et en dry-run par défaut ; les règles Firebase sont versionnées et
> testées par émulateurs dans la CI ; Firestore avertit à 750 Kio et refuse à 900 Kio ; l'ADR-012
> impose un schéma v3 réparti avant la campagne réelle à trois étages. GitHub Pages publie désormais
> `_site` par liste blanche. Faute de droits documentés, aucune carte ni aucun portrait n'y entre ;
> les quatorze icônes CC BY 3.0 portent sources, auteurs et modifications dans la page d'attribution.
> **Le premier run CI complet est constaté vert le 8 août 2026** — `verify` en 2 min 28 s, puis
> `build` et `deploy`. `test:firebase-rules` a donc exercé pour la première fois les refus et les
> autorisations contre les **vrais** moteurs Firestore et RTDB, et les trois gestes rapatriés par
> R1-08 tiennent sur le runner, là précisément où ils étaient rouges aux runs 69 à 76. **Les règles
> versionnées sont déployées le même jour** sur le projet `rpg-map-display`, Firestore et RTDB : ce
> qui tourne en production est désormais ce que le dépôt décrit et ce que la CI éprouve. La porte R1
> ne sera fermée qu'après **un seul constat restant** : la validation de la rétention sur deux vrais
> clients, greffée sur la phase 8 de la séance tablette, où la tablette et le poste MJ sont
> précisément ces deux clients. R1-09 est **tranché le 08/08** — domaines nettoyés et clé restreinte
> de 25 à 6 APIs ; restriction d'origine et plafonds de quota écartés sciemment, la protection
> venant des règles et une origine restreinte casserait les séances servies en local
> (`FIREBASE-CONSOLE-RESTRICTIONS.md` §5).
>
> **Phase R2 automatisable implantée le 7 août 2026 ; porte matérielle encore ouverte.** Les
> images de rendu lisent désormais un snapshot stable et immuable au lieu de cloner toute la
> campagne ; sur `testbig150`, la passe complète mesure 0,0002 ms/image en médiane et 0,0005 ms au
> pire, pour un seuil de 2 ms. La sonde passive sépare store, vision, fond, grille, portes, pions,
> fog, autres couches et résidu sur les vues MJ et joueurs. La sonde multipage écoute la vraie
> boucle applicative et classe un onglet masqué comme présentation non mesurable, au lieu de faire
> passer le throttling `requestAnimationFrame` pour un coût Canvas. Les protocoles et le rapport
> remplissable couvrent 120 s d'inactivité, 45 min de cast et 4 h de session. ✅ **R2-05 (cast) et
> R2-06 (longue durée) sont validés le 12/08/2026** sur confirmation du mainteneur — ses propres
> essais Mac + tablette + cast n'ont montré aucune difficulté, aucun ralentissement, aucune dérive.
> ⚠ **R2-03 reste ouvert, mais l'obstacle a changé de nature.** La sonde était fausse — elle
> chronométrait une file d'attente GPU sur un bitmap réchauffé juste avant la mesure. **Elle est
> réparée depuis le 12/08/2026** : le `drawImage` est chronométré sur le bitmap armé sans
> préchauffage, un `getImageData(0,0,1,1)` vide le pipeline, et le coût de cette relecture est mesuré
> à part puis retranché. Le verdict porte désormais sur le **coût net**. Ce qui reste n'est plus du
> développement mais **un relevé sur la tablette**, et il appartient au mainteneur — interdiction
> n°14, aucun verdict de performance sans la tablette.
>
> **Phase R3 automatisable implantée le 7 août 2026 ; lot 3 à 5 critères sur 6.** Le MJ dispose
> d'un éditeur de liaisons utilisable sans JSON ; la traversée, le suivi de vue, le cadenas et le
> fog indépendant sont réunis dans un même scénario multi-pages. Firestore persiste désormais la
> campagne en v3 distribuée, avec transaction optimiste, révision monotone et lecture v2 conservée.
> L'ambiante, les lumières fixes, les torches mobiles et `baked_lighting` alimentent le même sweep
> borné, sans calcul dans `requestAnimationFrame`. **La porte R3 reste ouverte** : aucune campagne
> réelle et licenciée à trois étages n'est disponible dans le dépôt, et le profil lumière doit
> encore être confirmé sur la tablette cible sous cast.
>
> ✅ **Moitié quantitative de R3-05 mesurée le 11/08/2026, section 10 de `diag.html`, sur le
> poste MJ.** Pire des trois essais, mutation lumineuse réelle avec 6 PJ et une torche mobile :
> **11,5 ms** sur `test_village_complet_00` et ses **94 sources**, contre **0,1 ms** sur
> `manoir-rdc` qui n'en a aucune. Le coût imputable aux lumières est donc de **11,4 ms**, pour
> un budget de 300 ms. ⭐ L'hypothèse écrite était de 200 à 280 ms : la mesure est **douze à
> dix-sept fois meilleure**.
>
> ✅ **Confirmé sur la tablette le 11/08/2026, même section : 2,6 ms**, soit 1 % du budget de 300 ms
> et mieux encore que le poste MJ. **Cast actif, confirmé par le mainteneur : la porte matérielle de
> R3-05 est donc entièrement fermée.** Il ne reste au lot 3 que le critère 1, qui attend du contenu
> — trois cartes réelles licenciées à trois étages — et non du code.
>
> ⭐ Le chiffre a **baissé** de 16,4 à 11,5 ms le même jour, en corrigeant une règle de
> visibilité : une source que personne ne voit n'est plus balayée du tout. La correction de
> conception a rendu le calcul plus juste **et** plus rapide.
>
> **Chantier Q, 6 août 2026 — code livré, trois vérifications de table ouvertes.** Points de vie,
> hors CdC et demandé par le mainteneur : compteur `courant/max` saisi par le MJ, **anneau
> proportionnel bleu `#2563eb` sur les PJ seulement**, **anneau d'état à trois crans manuels sur les
> PNJ** (rien quand indemne, `#c2410c` blessé, `#ef4444` mal en point, épaisseur doublée). Chez le PJ
> la longueur parle et la couleur se tait ; chez le PNJ l'inverse — c'est ce qui empêche de confondre
> un PJ à plein et un PNJ à l'agonie, qui tracent tous deux un tour complet. Les joueurs ne voient
> **jamais** le chiffre d'un PNJ, et `health` n'est **jamais** dérivé de `hp` : c'est un acte manuel,
> pour qu'un boss à 12/140 puisse rester annoncé « Indemne ». Couverture : 12 tests unitaires
> (`tests/hp.test.mjs`) et 4 tests navigateur (`tests/hp.spec.mjs`), dont une **sonde de pixels sur
> les deux canvas** — la non-fuite du chiffre est mesurée, pas relue. Brief et arbitrages :
> `CHANTIER-Q-POINTS-DE-VIE.md`.
>
> **Ce que la table doit constater, et que rien ne remplace en machine** : (1) les PV d'un PNJ ne
> fuient sur aucun des trois écrans, TV sous cast comprise ; (2) l'anneau se distingue à la vue
> « carte entière », orange brique contre rouge ; (3) les pastilles chiffrées du MJ restent lisibles
> en gros combat — sinon le repli écrit est de ne les dessiner que sur le pion sélectionné
> (`CHANTIER-Q-POINTS-DE-VIE.md` §5.5).
>
> **Régression corrigée en passant, et elle ne venait pas des PV** : une campagne enregistrée avant
> le 04/08/2026 ne se chargeait plus du tout. `validateCampaign` exigeait `markers` qu'aucune
> normalisation ne comblait — il n'existait pas de `normalizeToken`, contrairement à ce que le
> commentaire de `store.js` promettait (« un document hérité doit être converti, jamais refusé »).
> `normalizeToken` existe désormais et comble `markers`, `hp` et `health`.
>
> **Chantier P, 5 août 2026 — code écrit, mesure de confirmation à faire.** Le décodage du fond sort
> du chemin critique : doublure de 1024 px retenue en `ImageBitmap` (deux au plus, ~7,8 Mio), décodage
> asynchrone par `image.decode()`, et une frame floue au lieu d'un gel d'une demi-seconde. Le plafond
> de préparation reste à 8192, aucune carte n'est à réexporter. **Rien n'est validé tant que la sonde
> du chantier N ne l'a pas constaté** : après 2 min d'inactivité, la colonne « Fond » doit passer sous
> 5 ms, et la tablette doit cesser de saccader.
>
> **Chantiers N et O, 5 août 2026, retours de la première séance réelle.** O — tolérance de
> désignation des pions au doigt : marge de 24 px **écran** plafonnée à 0,75 case, mesurée au
> rectangle du pion, le plus proche gagne, départage par identifiant. Le code est écrit et couvert
> en unitaire ; le geste réel au doigt, lui, n'est couvert par aucun test de la porte et attend la
> table. N — la sonde de la première image après inactivité : **posée et lue le jour même, elle a
> désigné une cause.** Après 88 à 124 s d'inactivité, un cran de zoom coûte ≈ 500 ms dont **490 ms
> dans le seul `drawImage` du fond**, fog à 0,3 ms, résidu à 3 ms : c'est le redécodage synchrone du
> bitmap, ni GC ni compositing. Deux surprises : le bitmap est encore chaud à 5,6 s et froid à 88 s
> — la bascule est donc **entre 6 s et 88 s**, pas au-delà de 30 s —, et la frame froide de
> chargement est la n°4 et non la n°1. **Le correctif est le chantier P**
> (`CHANTIER-P-DECODAGE-DU-FOND.md`), tranché sur cette mesure : doublure basse résolution retenue
> en `ImageBitmap` et décodage asynchrone, **sans toucher au plafond de préparation ni à la densité
> des cartes**. La sonde reste en place jusqu'à ce qu'elle constate que le correctif tient.
>
> **L-09 est livrée le 5 août 2026.** Le jeu de marqueurs (Q7) comporte quatorze états, liste close,
> les trois paliers d'affichage (icônes à 3 emplacements, points de catégorie, point unique) et la correction
> de géométrie d'écran pour l'élévation (rayon de 8 à 14 px écran, seuil bas D < 40 px) et les
> marqueurs sous tout zoom. Resté ouvert à la livraison du code, le critère 4 est **validé sur les
> trois écrans le 07/08/2026** par confirmation du mainteneur.
>
> Les lots 1a et 1b sont complets côté code — chantiers H (révélation d'image), I et M
> (bibliothèque de pions), J (page d'accueil et vue MJ sur `gm.html`), K (badge d'élévation) et
> L (outil local de préparation des cartes), après la bibliothèque UVTT (U-00 à U-06 de
> `PLAN-BIBLIOTHEQUE-UVTT.md`). Les validations de longue durée encore ouvertes sont suivies
> séparément dans « Ce qui reste à vérifier manuellement ». Les critères 10 et 11 de L-05 sont
> **fermés le 07/08/2026** : réponse sous 300 ms et ouverture tactile du premier coup.
>
> **C'est la table « Suite produit », en fin de document, qui fait foi sur l'avancement** ; ce
> chapeau ne la résume que pour la reprise. En cas de désaccord entre les deux, croire la table
> et corriger le chapeau — il a déjà annoncé « lot 2 pas commencé » trois jours après le début
> du lot 2.
>
> ⚠️ **Attention à la numérotation.** Le « lot 2 » de `PLAN-BIBLIOTHEQUE-UVTT.md` désigne la
> bibliothèque UVTT et n'a rien à voir avec le **Lot 2 du cahier des charges §11** (lignes
> de vue, portes, fog, éditeur de murs, gabarits, marqueurs). Ne pas confondre les deux : la
> bibliothèque est une tranche du Lot 1b du CdC. De même, le « chantier L » est l'outil de
> préparation des cartes, tandis que `L-01`…`L-10` sont les tranches du Lot 2.
>
> Les autres mesures physiques de longue durée sur tablette et les scénarios Firebase réels
> restent à valider dans leur environnement.

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
pnpm run verify        # typecheck + cohérence CDN + unit + e2e + gestes, arrêt à la première erreur
pnpm run check-deps
```

`pnpm run verify` est la commande de référence : c'est celle que le CI exécute et
dont dépend le déploiement GitHub Pages. Lancer seulement `test:unit` a déjà
laissé passer un lot entier dont les 4 tests navigateur étaient rouges.

> ✅ **Intermittence de `fogTrajet.spec.mjs` — diagnostiquée et corrigée le 5 août 2026.**
> Défaut du test, pas de l'application. Les deux cases arrivent dans **deux publications de fog
> distinctes** : la vision de la case d'arrivée part dès le commit du déplacement (relevé entre
> 336 ms et 2,4 s), le trajet marché ne suit qu'à la fin de l'animation, `TOKEN_MOVE_STEP_MS`
> × 24 pas, soit 3 840 ms (relevé entre 3,3 s et 4,4 s). Le `poll` portait sur l'arrivée et une
> assertion **sèche** suivait sur le milieu : satisfaite par la première publication, elle
> lisait un masque où le trajet n'existait pas encore. Sur machine au repos les deux
> publications se coalescent, d'où un test vert ; sous la charge des workers parallèles l'écart
> de 3,5 s s'ouvre.
>
> Reproduit à volonté par `--repeat-each=8 --workers=6` : **2 échecs sur 16** avant correction,
> **16 sur 16** après. La grave hypothèse est écartée par la mesure : le milieu finit **toujours**
> par être révélé et le masque exploré ne régresse **jamais** — vérifié sur 10 s de relevé
> continu.
>
> ⚠ **Le même diagnostic a révélé un faux vert dans la seconde moitié du fichier**, plus gênant
> que le flake : le glisser MJ y vérifiait l'**absence** du couloir à un instant où aucune
> publication de trajet n'avait pu partir. L'assertion passait donc quoi qu'il arrive, y compris
> si l'application avait révélé le couloir à tort. Elle attend désormais la fenêtre d'animation,
> dérivée de la constante et non choisie. L'absence est réelle — sonde à l'appui, le couloir
> reste noir sur 10 s — elle est maintenant aussi **prouvée**.

Depuis R1-08, `test:e2e` garde le projet `chromium` et les trois scénarios de geste réel sont
exécutés ensuite via le projet `manuel` (`pnpm run test:gestes`) dans `pnpm run verify`. Leur
cause d'instabilité avait été trouvée et corrigée le 4 août 2026 — défaut du test, pas de
l'application — ; leur succès est désormais requis avant tout déploiement. Les traces restent
publiées en artefact en cas d'échec, sans second job qui rejouerait les mêmes scénarios.

> ✅ **`pnpm run test:mesures` est hors de `verify`, et c'est voulu.** Consigné le 11/08/2026 après
> que la question a été reposée — signe qu'elle se reposera. Les deux fichiers de `tests/mesures/`
> (`fogReadback`, `latenceAllerRetour`) portent la mention « Aucun seuil : ce fichier mesure, il ne
> juge pas » et n'ont d'assertion que « le relevé n'est pas vide ». **Les mettre dans la porte
> n'attraperait donc rien** et ajouterait deux scénarios multi-pages lents à chaque `verify`.
>
> ⛔ Le critère qui décide, et il ne se devine pas depuis le nom du script : un fichier entre dans la
> porte quand il porte un **jugement reproductible**, pas quand il produit un chiffre. `test:gestes`
> y est entré par R1-08 pour cette raison précise — il juge un geste, et son instabilité était un
> défaut de test, corrigé. Une mesure, elle, dépend de la machine : la mettre sous seuil dans un CI
> revient à faire dépendre le déploiement du runner du jour. C'est le même raisonnement qui interdit
> d'asserter le verdict de la section 7bis de `diag.html` (voir la campagne du 11/08).

La cohérence des import maps et de la version Firebase reste bloquante à chaque `verify`.
La disponibilité des CDN et le signalement des versions npm récentes passent dans un contrôle
hebdomadaire séparé : une indisponibilité extérieure ponctuelle ne bloque donc pas un push.

Résultat de la passe d'intégration R3 du 7 août 2026 sur le poste Windows de reprise :

- typage, cohérence des import maps et `git diff --check` : verts ;
- tests unitaires : **324 réussis**, 1 test de règles ignoré hors émulateurs ;
- tests navigateur : **148 réussis**, 2 scénarios Firebase réels ignorés faute de secret ;
- gestes bloquants : **3 réussis** ;
- Firestore v3 : split/join, migration v2, révisions, concurrence, plafond par document et fixture
  synthétique trois étages couverts ; l'émulateur réel reste à la CI, Java 21 étant absent du poste ;
- lumière sur `testbig150`, six PJ, huit sources fixes et trois torches : environ **28 à 49 ms**
  suivant la passe de bureau, 17 polygones ; cette plage n'est pas un verdict tablette ;
- le premier passage navigateur a mis au jour quatre fixtures anciennes devenues ambiguës : trois
  sondes de fog déclaraient une ambiance pleine tout en supposant l'obscurité, et le panneau comptait
  encore neuf onglets. Après correction explicite, les **16 scénarios ciblés concernés réussissent** ;
- Playwright imprime encore les verdicts puis garde son processus ouvert sous Windows. Les suites
  complètes et ciblées ont atteint la limite du wrapper après leurs résultats, sans scénario restant
  en échec. **Propre au poste Windows** — voir la passe R1 ci-dessous, tranchée le 08/08/2026.

Résultat de la passe d'intégration R2 du 7 août 2026 sur le poste Windows de reprise :

- typage, cohérence des import maps et `git diff --check` : verts ;
- tests unitaires : **304 réussis**, 1 test de règles ignoré hors émulateurs ;
- tests navigateur : **144 réussis**, 2 scénarios Firebase réels ignorés faute de secret ;
- gestes bloquants : **3 réussis** ;
- `testbig150` : snapshot de rendu à 0,0002 ms/image en médiane, pire lot 0,0005 ms
  (`9 × 1 000` lectures, seuil 2 ms) ;
- la sonde multipage modifiée est comprise dans les 144 tests navigateur et qualifie bien le cas
  masqué comme non mesurable ; la sonde joueurs `?probe=1` est également montée dans ce scénario ;
- comme lors de R1, Playwright imprime tous les succès puis garde son processus ouvert sous
  Windows ; les commandes ont donc atteint leur limite après verdict complet, sans échec de test.
  **Propre au poste Windows** — voir la passe R1 ci-dessous, tranchée le 08/08/2026.

Résultat de la passe d'intégration R1 du 7 août 2026 sur le poste Windows de reprise :

- typage et cohérence des import maps : verts ;
- tests unitaires : **299 réussis**, 1 test de règles ignoré hors émulateurs ;
- tests navigateur : **143 réussis**, 2 scénarios Firebase réels ignorés faute de secret ;
- gestes bloquants : **3 réussis** ;
- paquet `_site` : **82 fichiers**, déterministe, plus un smoke test navigateur MJ/joueurs ;
- mesure Firestore : 302 918 octets prudents sur `testbig150`, 904 038 sur trois étages ;
- le lanceur Playwright local Windows imprime tous les succès puis garde son processus ouvert ;
  les commandes ont donc atteint leur limite après verdict. ✅ **Tranché le 08/08/2026 : le défaut
  est propre au poste Windows.** Sur le runner Ubuntu, le job `verify` se termine normalement en
  2 min 28 s. Ce n'est donc pas un doute sur la suite, et les trois passes ci-dessous portent la
  même note pour la même raison ;
- la cible `test:firebase-rules` est prête et bloquante en CI avec Java 21. Elle ne peut pas être
  exécutée sur ce poste tant que Java 21 n'est pas installé. ✅ **Exécutée et verte en CI le
  08/08/2026.**

Résultat de la passe d’intégration du 4 août 2026 (après L-08 et le correctif de désarmement
des outils MJ), mesuré sur le poste Windows de reprise :

- typage : vert ;
- tests unitaires : **227 tests, 226 réussis, 1 ignoré** en 5 s ;
- tests navigateur : **100 réussis**, 2 Firebase ignorés faute de configuration externe, en 41 s ;
- `pnpm run check-deps` : vert, import maps identiques entre `gm.html`, `player.html` et
  `diag.html`, avec version Firebase cohérente. La disponibilité CDN et les versions npm récentes
  sont relevées séparément chaque semaine ; l'épinglage de `STACK.md` reste la référence ;
- les scénarios couvrent rendu, imports, bibliothèque de cartes, bibliothèque de pions,
  pions, gestes, élévation, révélation d'image, page d'accueil, plusieurs pages,
  reconnexion, remplacement de scène synchronisé, et depuis le lot 2 : arêtes bloquées, fog
  (temps réel, voile, trajet, outils MJ), portails, éditeur de murs, gabarits de zone d'effet
  et mécanisme de désarmement des outils MJ.

> **L'unique test unitaire ignoré localement est désormais celui des règles Firebase réelles.**
> `firebaseRules.emulator.test.mjs` exige les émulateurs Firestore et RTDB ; la CI les démarre avec
> Java 21 dans un projet `demo-*`. `realUvtt.test.mjs`, lui, ne s'ignore plus sur un dépôt intact :
> il utilise aussi les exports Dungeondraft versionnés dans `maps/`, tandis que `fixtures/real/`
> reste le complément privé du mainteneur (`docs/FIXTURES.md` §1).

Historique, pour situer : la passe du 30 juillet 2026 (fin du lot 1b) donnait 103 tests
unitaires et 64 navigateur. Le lot 2 a donc doublé la couverture.

La suite unitaire était passée d’environ 30 s à moins de 2 s : la préparation de cartes est
désormais exercée sur `fixtures/synthetic/minimal.uvtt` dans un dossier temporaire, et
`maps/` n’est plus muté par les tests. Elle est remontée à ~5 s depuis, sciemment : les
fixtures synthétiques portent maintenant une vraie image plutôt qu’un pixel unique (voir
« Conséquence sur les fixtures » plus bas), et le lot 2 a doublé le nombre de tests.

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

### Amendement du 30 juillet 2026 — plafond de préparation à 8192, et anti-agrandissement

Trois défauts liés, découverts en tentant de préparer un export Dungeondraft à 150 px/case
(65 × 71 cases, 9750 × 10650 px, 22 Mo).

**1. Un export au-delà de 100 MP était refusé, et le message désignait la mauvaise cause.**
`jpeg-js` plafonne par défaut à 100 MP **et** à 512 Mio de mémoire — deux plafonds, dont le
message n’en nomme qu’un. Lever le seul plafond de résolution laisse échouer sur la mémoire,
mesurée entre 1024 et 1536 Mio pour cette image.

Le piège qui a coûté le plus de temps : **`Jimp.read(buffer, options)` jette les options en
silence.** Sur une entrée `Buffer` il délègue à `fromBuffer(url)` sans les transmettre. Passer
les bons plafonds au code existant n’aurait donc rien changé, sans le moindre message. Le
décodage passe désormais par `Jimp.fromBuffer`. Le repli WebP, lui, rapporte les **deux**
causes : ne garder que la première faisait passer un vrai défaut de décodage WebP pour un
échec Jimp.

**2. Le plafond de préparation passe de 4096 à 8192**, dans `MAX_PREPARED_TEXTURE_PX`
(`scripts/resample.mjs`) — **et non** dans `MAX_TEXTURE_FALLBACK`, qui reste à 4096. Les deux
ne disent pas la même chose : le second est le repli du runtime quand la limite WebGL ne peut
pas être interrogée, donc une hypothèse prudente ; le premier est un budget de préparation
côté Node, adossé à une mesure. Même partage qu’au chantier E pour le plafond de décodage.
La règle qui les lie : **le plafond de préparation ne doit jamais dépasser la limite du plus
faible appareil du parc**, 8192 étant la valeur mesurée sur la Tab S9 FE.

Le gain n’est pas théorique : `manoir-rdc` est exportée nativement en 6720 × 6300, et le
plafond de 4096 en jetait **39 %**. Elle sort maintenant à sa taille native, sans
interpolation, sans réexport.

**3. Rien n’empêchait d’agrandir une source moins dense que la cible.** La chaîne visait
`cases × 140` sans jamais comparer à la taille de la source : une carte fournie en dessous
était interpolée vers le haut, payée au poids d’une grande image pour une netteté
**inférieure** à celle du fichier d’origine. Le défaut était inerte tant que le plafond valait
4096 ; il devenait actif à 8192. La sortie est désormais bornée par la source, avec un
avertissement qui nomme la densité à réexporter.

> **Une seule consigne d’export à retenir : 140 px/case ou plus.** C’est exactement le seuil
> au-dessus duquel aucun agrandissement n’est possible, quel que soit le plafond et quelle que
> soit la taille de la carte — la cible ne dépasse jamais `cases × 140`. En dessous, le seuil
> dépend de la carte : une grande carte tape dans le plafond et exige donc *moins* de densité
> qu’une petite. Contre-intuitif, d’où l’intérêt de ne retenir que 140.

Le garde-fou est dans le code et non dans la consigne, parce qu’une règle que rien n’applique
n’est pas un mécanisme — leçon déjà payée sur l’image de pion à déposer à la main, qui
affichait des ronds gris sans le moindre message.

**Deux détails d’implémentation qui ont chacun produit un défaut :**

- Les deux contraintes se combinent en **un seul** facteur d’échelle. Appliquées l’une après
  l’autre, leurs arrondis vers le bas se composaient : une source au rapport exact
  (4680 × 5112 pour une cible 9100 × 9940, soit 72/140 des deux côtés) sortait en 4679 × 5111.
- L’encodeur WebP prend **quality 100 par défaut**, et `encode` était appelé sans options —
  ce n’était donc pas un choix. `manoir-rdc` pesait 10,01 Mio en q100 contre **4,87 en q90**,
  pour une carte qui pesait déjà 4,96 Mio à l’ancien plafond. **q90 finance intégralement le
  passage à 8192** : même poids qu’avant, 64 % de résolution linéaire en plus.

**Conséquence sur les fixtures, à connaître.** Les quatre fixtures synthétiques portaient un
PNG de **1 × 1 pixel** tout en déclarant 10 × 8 cases à 64 px/case. La suite « vérifiait »
donc une sortie 1400 × 1120 obtenue en interpolant un unique pixel — elle ne vérifiait rien.
`scripts/make-fixture.mjs` produit maintenant une vraie image 640 × 512 (damier à la maille de
la case, plus une diagonale d’un pixel de large comme détail fin), cohérente avec ce que la
fixture annonce. Les fixtures passent de 1 à 8,8 Kio, et la suite unitaire de 2,8 à 5,3 s.

La publication du catalogue est **transactionnelle** : `pnpm maps:prepare` n’écrit
`catalog.json` que si toutes les cartes ont été préparées. Une seule carte fautive fait
sortir le CLI en code non nul et laisse le catalogue précédent intact, octet pour octet.
Les artefacts de `maps/generated/` devenus orphelins sont signalés, jamais supprimés : une
campagne enregistrée côté navigateur peut encore les référencer.

## Chantier M — la bibliothèque de pions persiste enfin, et pourquoi elle ne le faisait pas

Relevé le 31 juillet 2026 par le mainteneur, en deux symptômes : « quand j'ouvre une nouvelle
session ma bibliothèque de pions est vide de mes créations alors que l'éclaireur goblinoïde
est bien là », et « je ne peux pas éditer/supprimer l'éclaireur dans la bibliothèque ».

**Une seule cause, et ce n'était pas un bug.** Le chantier I §3.2 avait arrêté que la
bibliothèque est **en lecture seule** : catalogue commité, pas de LocalStorage — « le
mainteneur travaille depuis plusieurs machines, une bibliothèque locale au navigateur serait
perdue au changement de poste » — et pas d'écriture depuis le navigateur, « impossible sans
chaîne d'upload, hors périmètre ». Les pions générés partaient donc dans la **campagne**, qui
est propre à la session. L'éclaireur survivait parce qu'il est un fichier du dépôt.

**Mais le mécanisme de compensation était devenu inopérant, et c'est le vrai défaut.** Le
bouton « Copier l'entrée JSON » produit `imageUrl: "maps/tokens/<slug>.webp"` — un fichier
qui n'existe pas, puisque le générateur ne dépose le WebP que dans le dossier de
téléchargement. Or l'amendement du 30/07 a résolu ce problème pour la table en embarquant
l'image en `data:` bornée… et le catalogue de pions **refuse les `data:`**
(`js/import/tokenCatalog.js`). Les deux mécanismes étaient donc devenus incompatibles : un
pion généré s'affichait bien, mais ne pouvait plus **jamais** entrer dans la bibliothèque.
Le CdC §5.7 exige la « persistance de ce que produit le générateur » : ce n'était pas tenu,
et `ETAT.md` l'annonçait pourtant comme complet. Même classe d'erreur que le « U-00 à U-06
complète » de la semaine précédente.

**Ce qui change.** La prémisse « écrire depuis le navigateur est impossible » est tombée avec
le chantier L : le serveur local écrit dans le dépôt. L'outil gagne donc une section
bibliothèque de pions, qui écrit le WebP dans `maps/tokens/` **et** l'entrée dans
`catalog.json`, d'un seul geste. Éditer et supprimer n'importe quelle entrée devient possible,
y compris les entrées de démonstration.

**La décision de refuser LocalStorage tient toujours**, et c'est elle qui a guidé
l'implantation : on écrit le fichier commité, pour que la bibliothèque voyage par git d'une
machine à l'autre. Une bibliothèque de navigateur ne l'aurait pas fait.

Parcours : générer le pion dans la vue MJ → « Télécharger pion » → choisir le fichier obtenu
dans l'outil. Le recadrage reste au générateur, il n'est pas réimplémenté.

**Deux défauts trouvés en éprouvant les gardes, et corrigés :**

- un identifiant tentant un chemin (`../../evil`) était **silencieusement assaini** en
  `evil` : le fichier restait bien dans `tokens/`, mais l'entrée gardait l'identifiant tordu
  pendant que le fichier en portait un autre. Un identifiant de pion sert aussi de nom de
  fichier, il est donc désormais **refusé** s'il n'est pas un slug, plutôt que réécrit ;
- une entrée refusée **écrivait quand même son image**, l'écriture précédant la validation.
  Contrôle et écriture sont séparés : rien n'est écrit tant que le catalogue complet n'est pas
  valide, et l'image est commitée avant le catalogue — un catalogue qui référencerait une
  image absente serait pire que l'inverse.

**Le bouton « Copier l'entrée JSON » a été retiré**, sur décision du mainteneur : il ne
servait plus à rien puisqu'il produisait une entrée inutilisable. À noter pour la leçon —
**aucun test ne l'exerçait**, ce qui explique qu'il ait pu devenir inopérant en silence après
l'amendement du 30/07. Un bouton sans test est un bouton dont personne ne saura qu'il a cessé
de fonctionner.

## Lot 2 — la vision est mesurée, et le verdict est large

Relevé le 31 juillet 2026 **sur la tablette cible**, `diag.html` bouton 6bis, sur la
géométrie réellement publiée — aucune extrapolation, aucun segment synthétique.

`Testbig150`, la carte la plus dense du corpus (65 × 71 cases, 1396 segments) :

| Portée | Segments à portée (méd/pire) | 1 sweep (méd/pire) | Geste 6 cases (pire) |
|---|---|---|---|
| 5 cases | 11 / 153 | 0,1 / 1,8 ms | 10,8 ms |
| 10 cases | 68 / 279 | 0,4 / 5,6 ms | 33,6 ms |
| **15 cases** | 175 / 313 | **2,4 / 6,9 ms** | **41,4 ms** |
| 20 cases | 274 / 422 | 4,7 / 11,1 ms | 66,6 ms |

`Manoir — RDC` est trivial partout : 1,1 ms au pire, même à portée 20.

**Ce que ça établit.** Le coût suit le carré du nombre de segments **à portée** — exposant
mesuré entre 1,5 et 1,9 — et ce nombre suit le carré de la portée. Il faudrait environ
**trois fois la densité locale** ou **1,7 fois la portée** pour qu'un seul sweep approche le
budget d'une image. Aucune limite de portée ni de taille de carte n'est à imposer : le coût
est indépendant de la surface, seule la densité locale compte. Le CdC §9 porte l'amendement.

> **Deux corrections d'estimations que j'avais faites, à ne pas reproduire.**
>
> **La tablette n'est pas plus lente que le poste de bureau** sur cette charge : 2,4 ms
> contre 2,1 ms en médiane, même carte, même code. Toutes les extrapolations « ×3 à ×5 sur
> tablette » de ce document étaient donc pessimistes d'un facteur 4 — dont celle qui
> concluait qu'une carte à 3000 segments ne tiendrait pas. Elle tiendrait. Sur une boucle
> numérique serrée, le Tab S9 FE tient tête à un Mac.
>
> **Le premier relevé était faux, et il s'est dénoncé tout seul** : la portée 5 y ressortait
> plus lente que la portée 10 avec deux fois moins de segments à portée. Moins de travail et
> plus de temps est impossible pour un même algorithme — c'était la chauffe du moteur
> JavaScript, captée par un maximum. Retenir la leçon : **une mesure qui viole une monotonie
> attendue est fausse, et il n'est pas nécessaire de la relancer pour le savoir.**

### Question ouverte qui décide de tout le résultat ci-dessus : qu'est-ce qui borne la vision ?

**Aujourd'hui, la portée n'est utilisée nulle part.** `visionBright` et `visionDim` existent
sur `Token` depuis le lot 1a, sont validés, voyagent par la bibliothèque de pions et
s'éditent dans l'outil — mais **aucun code ne les consomme**. `sweep()` reçoit une portée en
pixels, et seul le banc de `diag.html` l'appelle.

Le CdC les définit comme la **vision dans le noir** (§5.3, ligne 291), pas comme la portée de
vue générale : un pion voit net jusqu'à `visionBright`, faiblement jusqu'à `visionDim`,
`0 = aucune vision`. Ce qui laisse une question sans réponse : **dans une zone éclairée, que
vaut la portée ?**

Elle n'est pas théorique. `Testbig150` déclare `ambient.level = 1` — entièrement éclairée —
et `manoir-rdc` déclare `0`, noir complet. Si « éclairé » signifiait « voir jusqu'aux murs
sans borne », le rayon du sweep deviendrait la carte entière. Mesuré sur `Testbig150` :

| Portée | Segments à portée | 1 sweep | 6 pions |
|---|---|---|---|
| 15 cases | 45 | 0,3 ms | 2 ms |
| **non bornée** | **1338** | **57,9 ms** | **347 ms** |

**Un facteur 190**, et l'ensemble du résultat de performance ci-dessus s'effondre : 347 ms
par geste, du même ordre que la latence du cast.

> **Conclusion portée dans les briefs L-03 et L-04 : il faut un plafond de vision dur,
> quelle que soit la lumière.** Ce n'est pas une optimisation, c'est ce qui rend le fog
> jouable — et c'est aussi souhaitable en jeu, personne ne veut que ses joueurs découvrent
> tout le donjon depuis une salle éclairée. **Plafond arrêté par le mainteneur le 31/07 :
> 20 cases.**

### Le plafond est une borne TECHNIQUE, pas une limite de jeu

Distinction relevée par le mainteneur, et elle est juste : **un pion ne voit jamais 1338
murs.** La ligne de vue est coupée bien avant. Mesuré depuis le centre de `Testbig150`, sans
aucune borne de portée :

| | |
|---|---|
| Segments sur la carte | 1338 |
| Segments **réellement visibles** | **284** (21 %) |
| Segments **traités par le sweep** | **1338** |

Le sweep teste tout ce qui est **à portée**, sans savoir d'avance ce qui sera masqué — c'est
précisément le calcul qui le détermine. Le coût suit donc l'encombrement, pas la visibilité.

C'est le prix assumé de l'algorithme naïf retenu en L-02. **Le plafond de 20 cases corrige
une faiblesse de l'implantation, pas une réalité du jeu**, et il faut l'écrire ainsi : le
jour où les rayons seront accélérés, il redeviendra un pur choix de jeu.

### Historique avant le lot 3 — vision dans le noir par pion

Besoin exprimé par le mainteneur le 31/07 : **certains PJ voient dans le noir, à une distance
propre** — 5 cases en première intention. C'est un vrai besoin de sa table.

**Le modèle le couvre déjà.** `visionBright` / `visionDim` existent sur `Token` depuis le lot
1a et sont définis par le CdC §5.3 comme « rayon de vision par pion **(vision dans le noir)** »,
en cases, `0 = aucune vision`. Ils sont validés, voyagent par la bibliothèque de pions et
s'éditent dans l'outil. Rien à ajouter au schéma.

Ce qui manquait alors était **la couche d'éclairage du lot 3** : `ambient.level` de l'étage,
`emitsLight` des pions et `lights` de la carte. Ce manque est désormais comblé par le chantier S :
un étage éclairé donne la portée plafonnée commune, tandis qu'un étage sombre emploie la portée
`visionDim` propre au pion ; les sources fixes et mobiles utilisent le même calcul d'occlusion.

> **Note historique.** Pendant le lot 2, `visionDim` servait de rayon plat à tout le monde et
> une valeur à `0` retirait donc entièrement le PJ de l'union de vision. Cette précaution n'est
> plus d'actualité sur un étage éclairé. Sur un étage sombre, `0` conserve volontairement son
> sens : aucune vision nocturne propre, hors zone couverte par une source de lumière.

### La piste d'accélération, pour ne pas la redécouvrir de travers

**Ne pas partir sur un balayage angulaire à ensemble actif.** C'est l'algorithme « propre »
en O(n log n), mais l'ordre de son ensemble actif change pendant la rotation et sa
maintenance est un nid à cas dégénérés — segments partageant une extrémité, colinéaires,
événements au même angle. Ses bugs ne plantent pas : ils font **fuir la vision dans les
angles**, soit exactement le critère 12, soit le défaut le plus coûteux à détecter.

**La bonne piste est ailleurs.** Le coût quadratique ne vient pas de la logique de
visibilité mais d'une chose bête : chaque rayon est testé contre tous les segments. Il
suffit d'indexer les segments par case et de ne tester que celles que le rayon traverse —
la logique de visibilité ne bouge pas d'une ligne.

**Et c'est ce qui rend la piste sûre : le polygone produit doit être rigoureusement
identique.** Le test s'écrit tout seul — comparer l'ancienne et la nouvelle implantation sur
des centaines de configurations et exiger l'égalité. Aucun risque de fuite, la sémantique
étant inchangée. Gain estimé, non mesuré : ×10 environ à portée bornée, ×5 à ×10 sans borne.

**À ne pas faire avant L-04.** La marge actuelle est de 10 à 100×, et L-04 révélera la part
réelle du sweep dans la boucle complète — sweep, union, rastérisation, rendu. Optimiser
avant de connaître cette part, c'est optimiser à l'aveugle : la décision n°2 a déjà coûté
cette leçon.

## Démarrage d’une séance

1. Servir le dépôt avec `pnpm run serve`.
2. Ouvrir `gm.html?session=<id>` côté MJ (ou passer par l'accueil `/`).
3. Ouvrir `player.html?session=<même-id>` côté tablette.
4. En mode Firebase, se connecter avec Google lorsque la page le demande.
5. Vérifier le badge réseau : `Firebase connecté` ou `Mode local`.

La configuration runtime peut être injectée par `window.RPG_FIREBASE_CONFIG` ou par
`localStorage["rpg-firebase-config"]`. Elle ne doit contenir aucun mot de passe.

## Ce qui reste à vérifier manuellement

> **Pour une séance de mesure, suivre `docs/SEANCE-TABLETTE.md`** : il reprend les points
> ci-dessous **dans un ordre exécutable**, avec le geste exact et le critère de chacun. ⭐ **Refondu
> le 08/08/2026** : il absorbe `PROTOCOLE-ENDURANCE.md` et couvre désormais **sept critères ouverts
> sur trois lots et deux portes** en une seule séance — dont R3-05 et la rétention R1-01, qui
> n'étaient dans aucun protocole. Trois d'entre
> eux en conditionnent d'autres — la largeur du viewport avant le critère 11, la grosse carte avant
> le jeu réel, et la tenue thermique qui court *pendant* le reste et non après. La liste ci-dessous
> reste la référence de **ce qui est ouvert** ; l'autre document dit **dans quel ordre le fermer**.

- **chantier N — la sonde. ✅ Lue le 5 août 2026, elle a désigné une cause** : 490 ms des 500 ms
  d'une frame post-inactivité sont dans le `drawImage` du fond, résidu à 3 ms donc ni GC ni
  compositing, bitmap encore chaud à 5,6 s et froid à 88 s. Correctif au **chantier P**. Ce qui
  reste ouvert est la **lecture d'après** : une fois P livré, remesurer au même endroit et sur la
  même carte — après 2 min d'inactivité, la colonne « Fond » doit passer sous 5 ms —, constater à
  la main que la tablette ne saccade plus, puis retirer la sonde en un commit.
  **État au 11/08/2026 : la moitié qui se constate à la main est acquise, la moitié qui se mesure ne
  l'est pas.** La tablette ne saccade plus — endurance sans remarque, aucun problème de performance
  sur toute la campagne du 11/08 — mais le chiffre qui devait le prouver est produit par une sonde
  fausse : la section « décodage froid » chronomètre une file d'attente GPU sur un bitmap déjà chaud,
  d'où 0,2 ms puis 1 146 ms pour le même travail. ⛔ **Ne pas déclarer R2-03 validé sur ces chiffres.**
  Ce que la séance donne de solide est le `Image.decode()` à froid : **1 118 ms sur la carte à 8192 px,
  contre ~490 ms sur le Mac**, soit 2,3× — la prédiction de ce chantier, confirmée. Détail et cause
  exacte : « Campagne de diagnostics sur la tablette — 11 août 2026 » ;
- **chantier O — le tap au doigt sur un pion. ✅ Clos le 11 août 2026.** Le geste était donné pour
  satisfaisant à la table le 5 août ; la question du §8 du brief — **la capsule des portes peut-elle
  remonter de 0,25 vers 0,4 maintenant que le pion a sa tolérance ?** — est désormais **tranchée par
  la mesure, et la réponse est non** : le banc de visée rend **100 % de réussite dès 0,25 case** sur
  vingt gestes réels (erreur p50 2,9 px, p95 7,1 px). Élargir ne gagnerait rien et coûterait de la
  précision là où deux portes se touchent ;
- **la vision directe après une vraie mise en veille de la tablette** — le correctif du 6 août
  2026 (voir « Retour de table du 6 août ») est couvert par un **vrai F5** dans
  `tests/visionRecovery.spec.mjs`, ce qui reproduit la perte de contexte mais **pas** la mise en
  veille d'Android. Le geste qui vaut preuve : laisser la tablette de côté assez longtemps pour que
  Chrome abandonne l'onglet, y revenir, et constater que la vision directe est là **sans rien
  déplacer**. Si elle manque encore, la piste n'est plus la rediffusion mais le moment où la
  tablette la réclame — `visibilitychange` peut ne pas suffire si le système restaure la page par
  un autre chemin ;
- **tenue d’une carte préparée à 8192 px sur la tablette** — le passage du plafond de 4096 à
  8192 n’est validé par aucune mesure d’affichage : 7499 × 8192 en RGBA fait **245 Mio décodés**
  dans le navigateur, et 8192 est exactement la limite *mesurée* de la dalle, donc sans marge.
  La carte `testbig150` est au catalogue pour ça (65 × 71 cases, 1338 murs, 141 portes,
  185 lumières, 13,7 Mio de WebP). Si elle ne tient pas, le pas suivant est de redescendre
  `MAX_PREPARED_TEXTURE_PX`, pas de bricoler le rendu ;
- **`pnpm run test:gestes` — le glisser réel du désarmement des outils MJ. ✅ Cause trouvée le
  4 août 2026, correctif livré ; R1-08 l'a rapatrié dans la porte de vérification.**
  `tests/manuel/gmToolDisarmGeste.spec.mjs` était vert en local et rouge sur le runner GitHub, sur
  le seul scénario des gabarits, des runs 69 à 76. **C'était un défaut du test, et de lui seul :**
  `camera.mapToScreen` rend des coordonnées relatives au canvas, `page.mouse` en attend du viewport,
  et les deux ne coïncident que si `#board` commence en `(0, 0)`. Le panneau des gabarits déborde
  horizontalement sur le runner — pas sur Windows, les métriques de police diffèrent —, le document
  défile de 66 px, `#board` passe à `left: -66`, et le test pressait 66 px à côté : la case visée
  n'avait pas de pion, `canStartTokenDrag` rendait `null`, et le glisser devenait un **pan**.
  L'application est innocente, `getScreenPoint` faisant `clientX - rect.left`. Corrigé par une
  conversion explicite **et une précondition exprimée** — le point de pression doit tomber sur la
  case de départ, vérifié par le calcul même de l'application —, avec preuve par mutation des deux
  côtés. Détail complet et les deux erreurs de méthode qui ont coûté quatre tours :
  `docs/DIAGNOSTIC-GESTE-GABARITS.md` §10 à §12. Un `verify` vert couvre désormais ces trois
  scénarios ;
- **le débordement horizontal du panneau des gabarits, non corrigé** — sous-produit du diagnostic
  ci-dessus, et sans rapport avec la justesse du hit-test. Un panneau MJ qui provoque un défilement
  horizontal du document à 1280 px de large est un défaut d'ergonomie en soi, mesuré sur le runner
  (66 px). À arbitrer séparément, et à ne pas confondre avec le défaut de test corrigé ;
- **l'appui long qui volait le geste suivant — ✅ corrigé le 4 août 2026**, et il était plus grave
  que signalé. Le symptôme relevé était le MJ qui verrouille une porte au lieu de déplacer son pion ;
  mais la vue joueurs ne traite que `tap` et `panBy` et **ignore `longPress`**, donc un doigt qui
  touchait la carte, hésitait une demi-seconde puis glissait n'obtenait **aucun `panBy`** — le geste
  principal de la séance échouait en silence. L'appui long est désormais un **geste achevé, émis au
  `pointerup`** : le minuteur ne pose qu'une candidature, que le mouvement annule. Contrat de
  l'intention inchangé, donc ni `gm.js` ni la vue joueurs touchés. Trois tests dans la porte, aux
  seuils réels de 500 ms, vérifiés par mutation — le correctif annulé, les trois rougissent. **Reste
  à vérifier au doigt** (interdiction n°14) : voir `docs/SEANCE-TABLETTE.md` points 2.1 et 2.2, le
  verrou tombant désormais au relèvement et non à 500 ms. Détail : `docs/CORRECTIF-APPUI-LONG.md` ;
- **la zone morte entre 150 et 500 ms, préexistante et non corrigée** — un appui immobile relâché
  entre `DRAG_HOLD_MS` (150 ms) et `longPressMs` (500 ms) ne produit **ni `tap` ni `longPress`** :
  la branche du tap exige `duration < dragHoldMs`, et le seuil d'appui long n'est pas atteint. Sur la
  vue joueurs, où le déplacement tap-tap est *le* geste de la séance, **un tap un peu lent reste donc
  sans effet**. Antérieur au correctif ci-dessus et sans rapport avec lui. L'arbitrage est de
  découpler la brièveté du `tap` de la constante de glisser, qui n'a pas de raison d'être la même
  valeur ; à décider après la séance, l'usage réel disant si le cas se présente
  (`CORRECTIF-APPUI-LONG.md` §7 A7). **La donnée que A7 attendait est arrivée le 11/08/2026** : sur
  vingt appuis réels au doigt, la durée est de **83 ms en p50 et 139,2 ms en p95**, donc **sous les
  150 ms de `DRAG_HOLD_MS`** — les taps ordinaires ne basculent pas en glisser, et rien n'oblige à
  découpler dans l'urgence. ⚠ La marge n'est que de **10,8 ms** : si le découplage est fait un jour,
  c'est de ce p95 qu'il faut partir, et non d'une valeur choisie au jugé ;
- **le correctif du masquage des pions, à confirmer sur la tablette** — c'est le point le plus
  concret de cette liste, parce qu'un défaut y a été mesuré puis corrigé sans que la mesure
  finale soit faite. Le masquage de L-04 allouait par image un canvas aux dimensions de la carte
  entière, 6720 × 6300 sur `manoir-rdc`, soit 161 Mio de RGBA : **542 ms par image sur un poste
  de bureau, seize fois le budget de 33 ms**. Relevé par le mainteneur en usage réel, sur la
  tablette, avant tout test. Le correctif filtre les pions case par case au lieu de masquer des
  pixels, et retombe à 0,44 ms de bureau. **Ce chiffre ne vaut pas validation** (interdiction
  n°14) : c'est la tablette qui dira si la vue joueurs tient désormais ses 30 fps ;
- **tenue à 30 fps sous cast sur la tablette cible — ✅ validée**, confirmation du mainteneur le
  05/08/2026 après la première séance réelle. Elle vaut aussi pour le correctif du masquage des
  pions du point précédent, qui n'avait jamais été revalidé ailleurs qu'au bureau ;
- **lisibilité du badge d'élévation (+N/−N) sous cast — ✅ validée** le 05/08/2026, même séance
  (miroir passif Google Cast) ;
- **température et stabilité pendant une séance de 45 minutes puis quatre heures — toujours
  ouvert.** ⚠ À ne pas déduire de la validation ci-dessus : c'est une mesure de **durée**, et la
  confirmation du 05/08 portait sur l'affichage ;
- limite de texture réelle et qualité du rééchantillonnage ;
- reprise du Wake Lock et du plein écran sur Android réel ;
- **règles de sécurité du projet Firebase — ✅ le mode test ne s'applique pas**, confirmé par le
  mainteneur le 4 août 2026 : les règles en liste blanche d'adresses sont en place, il n'y a donc
  ni accès anonyme ni expiration à 30 jours qui court. Ce qui reste à confirmer une fois, dans la
  console, est plus étroit : que la condition RTDB porte bien sur `$sessionId` et non sur `events`
  seul — sans quoi `presence` reste sans règle, donc refusé, et la détection d'écart de build ne se
  déclenche jamais en silence. Voir la section dédiée plus bas ;
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

## Trois points relevés au contrôle du lot 2, sciemment non traités

Consignés le 3 août 2026 à la clôture de L-05, L-06 et L-07. Aucun n'est un défaut ouvert :
chacun est un choix assumé ou une dette bornée, et chacun se perdrait s'il n'était écrit — il
ne vit dans aucun test et dans aucun commentaire de code.

**1. `getImageData` sans `willReadFrequently`. ✅ Mesuré le 7 août 2026 — l'attribut n'apporte
rien, et le point est clos.** Chromium émet un avertissement de performance au démarrage de la
vue MJ : c'est l'encodeur de fog qui relit son canvas à chaque publication (`js/vision/fog.js`,
le seul `getImageData` du module, délibérément placé à la publication et non sur le chemin de
déplacement — critère 8). Antérieur à L-06, sans effet fonctionnel.

Ce point demandait d'y revenir « le jour où le fog coûtera trop cher, pas avant ». Le jour est
venu par un autre chemin — la chasse à la latence joueur → MJ, ce `getImageData` étant sur le
chemin de publication, donc exactement là où le poste MJ travaille quand un joueur bouge. La
consigne a été tenue : **mesure d'abord**, `tests/manuel/fogReadback.spec.mjs`, sur un masque de
520 × 568 px — la taille réelle de `testbig150`, 65 × 71 cases à 8 px/case.

| | coût moyen d'une lecture |
|---|---|
| sans `willReadFrequently` | **0,730 ms** |
| avec `willReadFrequently` | **0,775 ms** |

⭐ **L'écart est négatif** : l'attribut est très légèrement plus lent, dans le bruit. Les deux
bancs sont alternés pour ne pas attribuer à l'attribut une dérive de la machine, et une écriture
s'intercale entre deux lectures pour reproduire le vrai régime plutôt qu'un cache.

Et surtout, **0,73 ms n'est un contributeur de rien** : une mutation complète du store en coûte
21. L'avertissement de Chromium est une heuristique déclenchée par la répétition des lectures,
pas un diagnostic de leur coût.

⛔ **Ne pas ajouter l'attribut pour faire taire la console.** Ce serait modifier le code sur la
foi d'un message, contre une mesure qui dit le contraire. Si le message gêne, c'est lui qu'on
documente — c'est fait ici.

**2. Deux `syncVision()` au démarrage de `js/app/gm.js`. Relu le 06/08/2026 : la redondance est
conservée sciemment, et la mise en garde ci-dessous était périmée.** Aujourd'hui lignes 846 et
1221. Le second est un no-op — la signature de vision n'a pas changé, les deux branches sont
sautées — et c'est lui qui porte sa raison en commentaire depuis L-04 : « une fenêtre MJ ouverte
déjà en arrière-plan n'obtiendrait aucune frame ».

Ce qui a été vérifié en relisant, comme la version précédente de ce point le demandait :

- **`gmPanel` est créé ligne 787, donc avant les deux appels.** La zone morte temporelle que ce
  paragraphe invoquait — `syncVision` appelant `gmPanel?.fogTools?.clearUndoStack` sur un panneau
  encore nul — **n'existe plus** à cet endroit. La mise en garde a survécu au défaut qu'elle
  décrivait ; c'est écrit ici pour qu'elle ne serve pas indéfiniment d'épouvantail.
- **Rien entre les deux appels ne lit la vision.** Les `requestRender()` qui s'y trouvent sont tous
  dans des corps de gestionnaires, non exécutés à l'initialisation. Les deux appels sont donc bien
  redondants, et en retirer un serait observablement équivalent à quelques millisecondes près — la
  publication du masque exploré étant de toute façon throttlée à 1 Hz avec traîne.

**Décision : ne pas y toucher.** Le gain est un appel redondant qui se solde en no-op ; le risque
est une régression d'ordonnancement au démarrage, qu'aucun test ne couvre. ⚠ Et « les tests passent
après suppression » ne prouverait rien ici : il n'existe aucun test de l'ordre d'initialisation, donc
le vert ne mesurerait que son absence. Écrire un tel test pour un gain nul serait disproportionné.

**3. Le test de vision de L-07 assurait un changement, pas une direction. ✅ Réglé le 06/08/2026.**
`tests/wallEditor.spec.mjs` ne vérifiait que la **différence** du masque publié après l'ajout d'un
mur, jamais sa **diminution** : un défaut qui *augmenterait* la zone visible passait la porte. Or
c'est le sens qui compte — le fog décide de ce que la table a le droit de savoir.

La difficulté annoncée — « pinner la direction demanderait de décoder le masque et de compter les
pixels » — s'est révélée moins coûteuse que prévu : le masque encode le vu dans le canal **alpha**,
et `decodeFogPng` attache déjà le tableau `maskAlpha` au canvas qu'il rend. Il n'y avait rien à
extraire. La piste écartée à l'époque, mesurer la longueur du base64, restait la mauvaise pour la
raison écrite alors.

Trois assertions désormais, et la troisième est la vraie :

1. la surface révélée **diminue** ;
2. le pion continue de voir **sa propre case** — sans ce garde-fou, un masque intégralement vierge
   satisferait aussi « diminue », et « moins » voudrait dire « plus rien » ;
3. la perte tombe **derrière le mur** : la case (4, 1), à trois cases du pion donc dans sa portée
   claire de 4, était visible et ne l'est plus.

⭐ **Deux leçons de la vérification, plus utiles que le correctif.** La mutation qui isole la
troisième assertion — échanger les coordonnées du mur, pour qu'il bloque perpendiculairement —
**passait avant** ce renforcement : le masque changeait bien, seulement du mauvais côté. Et le
premier essai de cette mutation a été un **no-op** : `extractBlockedSegments` a deux branches, et
elle avait été appliquée à celle **sans** grille alors que `syncVision` appelle celle **avec**. Son
vert ne valait rien. Une ancre qui existe ne prouve pas qu'elle soit sur le chemin emprunté.

⚠ L'assertion 2 n'est pas prouvée isolément : la mutation qui vide le masque échoue par expiration
en amont, pas sur elle. Elle est conservée pour sa fonction logique, pas sur la foi d'un rouge.

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
   promRealtime Database. **La condition est portée au niveau `$sessionId`, pas sur `events` seul** —
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

## Retour de table du 5 août 2026 — première séance réelle sur la Tab S9 FE

> **Clôture du 7 août 2026.** Les observations ci-dessous conservent l'état de la séance du 5 août.
> Depuis, le mainteneur a confirmé les trois validations qui restaient attachées au lot 2 : les
> critères 4, 10 et 11 sont acquis et le lot passe à 13/13.

Ce que la table a dit, et ce qu'il en reste. **Deux points sont corrigés, trois restent
ouverts**, et l'un des trois change une conception plutôt qu'un réglage.

**Fluide, sauf la première action après une pause — non corrigé, et pas à l'aveugle.** Aucun
problème de performance visible, sauf **systématiquement** au premier zoom ou déplacement après
un moment d'inactivité. Le rendu est **à la demande** (`FrameLoop`) : rien ne se repeint pendant
la pause, donc la première frame refait tout d'un coup. Hypothèse principale, à mesurer et non à
supposer : Chrome libère le bitmap décodé de l'image de fond, que plus personne ne peint, et la
première frame doit la **redécoder en synchrone** sur le fil principal — jusqu'à 8192 px de
côté. Si la mesure le confirme, le correctif est un `ImageBitmap` décodé une fois, que le
navigateur ne peut pas redécoder. ⚠ Cela se mesure **par couche, sur la tablette** : une sonde
posée sur la machine de développement ne reproduira pas l'éviction du cache.

**Le badge d'élévation est lisible, les marqueurs fonctionnent.** Le jugement visuel qui restait
ouvert le 05/08 a été confirmé par le mainteneur le 07/08 sur les trois écrans. Le critère 4 est
donc fermé. L'ordre de contrôle des icônes reste consigné dans `assets/icons/status/SOURCES.md`.

**Les mesures sous cast sont validées — confirmation du mainteneur, 05/08/2026.** Ce qui ferme
les points « tenue à 30 fps sous cast » et « lisibilité du badge d'élévation sous cast » de la
liste ci-dessus, ouverts depuis le lot 1a. La **tenue thermique** sur 45 minutes puis quatre heures
reste ouverte : c'est une mesure de durée et non d'affichage. Le jugement visuel des six icônes,
encore ouvert à cette date, a été confirmé le 07/08/2026.

**L'état verrouillé des portes : il l'était, on ne le voyait pas.** Le mainteneur a cru l'état
non implanté. Il l'était — appui long de 500 ms côté MJ, avec son test e2e — et **le geste est
conservé tel quel, décision du 05/08 : l'appui long protège des faux contacts**, ce qui est
exactement la qualité recherchée après le défaut des portes ci-dessus. Ce qui manquait était
ailleurs, et en deux points :

1. **L'indicateur était dessiné en pixels carte.** Mesuré sur le rendu réel, fog révélé : à la
   vue « carte entière » le trait de la porte verrouillée tombait à **1 px** d'épaisseur et son
   cadenas — le seul signe qui la distingue d'une porte fermée — à **2 px** d'encre, contre 4 et
   16 à zoom 1. Le pointillé vert de la porte ouverte n'atteignait plus **aucun** pixel saturé.
   ⭐ Même défaut que le chantier K et L-09, à un troisième endroit : une grandeur écrite dans le
   mauvais espace. Corrigé, constantes `PORTAL_*_SCREEN_PX`, et le rayon du cadenas est en outre
   borné par la longueur de la porte à l'écran pour ne jamais la recouvrir entièrement.
2. **Un tap sur une porte verrouillée ne signalait rien**, alors que `TRANCHE-L05-PORTES.md`
   §7.6 l'exigeait — « un tap ne fait rien **et le signale** ». Seule la première moitié avait
   été livrée : le code sortait en silence, et un geste sans effet ni explication est
   indiscernable d'une panne. C'est précisément ce qui a fait conclure à l'absence de l'état.
   Désormais un halo bat 600 ms autour du cadenas.

⭐ **Et le battement a révélé un défaut qui dormait dans la boucle de rendu.** La couche des
pions écrasait le drapeau `animationActive` par **affectation** au lieu de l'accumuler, alors
qu'elle se dessine *après* les portes : la boucle à la demande s'arrêtait après une seule frame
et le halo restait **figé à l'écran** au lieu de s'éteindre. Tant que les pions étaient la seule
couche animée, l'écriture était juste ; la deuxième couche animée l'a rendue fausse. Corrigé en
`||=` dans les deux vues — côté joueurs par symétrie, où rien ne s'anime encore avant les pions,
pour que ce ne soit pas un piège au lot 3.

> Le test qui a trouvé ce défaut est celui qui compte les frames, pas celui qui compte les
> pixels : **un halo figé est plus visible qu'un halo correct**, donc un seuil d'encre l'aurait
> déclaré réussi. Trois autres pièges de mesure ont été traversés au passage et sont documentés
> dans `tests/portalIndicator.spec.mjs` : le fog qui voile l'indicateur, la colonne d'un pixel
> qui tombe dans un creux de pointillé, et la ligne de base relevée sur une image peinte à un
> autre zoom.

**Les portes : capsule réduite de 0,5 à 0,25 case — corrigé.** Symptôme : un pion sur une case
adjacente à une porte, et c'est la porte qui bascule au lieu du pion. La cause n'était pas cette
seule valeur mais **son rapport à l'autre** : le pion se désigne sans aucune tolérance (la case
exacte, `tokenAtCell`), la porte avec une demi-case tout autour. À la vue « carte entière » une
case fait 33 px, donc la bande faisait 17 px là où un doigt en couvre une quarantaine. Le
raisonnement complet, la contrepartie assumée et le piège d'un test creux sont sur
`PORTAL_HIT_CELL_RATIO` dans `js/core/constants.js`. **Le fond du problème reste ouvert** : la
tolérance nulle sur le pion. Le désigner au plus proche, comme la porte, serait la correction de
principe — c'est un changement de sémantique de sélection, à arbitrer.
Au passage, `findHitPortal` et `distancePointToSegment` existaient **en double**, mot pour mot,
dans la vue MJ et la vue joueurs : deux valeurs à régler pour un seul réglage. Elles sont
désormais dans `js/input/portalHit.js`.

**Bouton de déconnexion des sessions MJ concurrentes — livré.** Dans la barre de session, il
porte le compte des autres postes MJ et les nomme avant de confirmer.
⚠ **L'éviction est coopérative, et ne peut pas ne pas l'être** : personne ne coupe la connexion
d'un autre appareil à distance ; le MJ congédié la coupe lui-même en recevant
`session.evictGm`. Un onglet en veille profonde ne se congédiera qu'à son réveil, un appareil
hors réseau jamais. Le congédié reçoit un écran bloquant qui **nomme le poste** qui a agi —
sans quoi son écran cesserait simplement de réagir, ce qui se lit comme un plantage, et il
rechargerait, donc reprendrait la main. ⛔ Ne pas « améliorer » en supprimant les présences des
autres : la liste se viderait, puis leur heartbeat les recréerait, toujours connectés.
Deux défauts de test relevés en cours de route, tous deux par mutation : muter le store en
direct ne publie rien (donc « le congédié ne reçoit plus » était vrai sans que personne n'ait
émis), et le désabonnement seul suffisait à satisfaire l'assertion — c'est le sens **inverse**,
« le congédié ne publie plus », qui mord sur la déconnexion réelle.

**Les gabarits : changement de paradigme demandé, non commencé.** Le symptôme rapporté est « il
rajoute une case à droite ». La sonde dit **l'inverse** : sans mur, l'empreinte est un losange
symétrique de 49 cases (rayon 4) ; dès qu'un mur existe **n'importe où sur l'étage**, il en reste
46 — les pointes haut, bas et gauche disparaissent, et **celle de droite est la seule correcte**.
Cause : le polygone de sweep approche le cercle de portée par des **cordes**, qui coupent en
deçà ; les cases à distance exactement égale au rayon tombent dehors, sauf à l'angle 0 où le
sweep émet un sommet et où l'`eps` de `isPointInPolygon` les fait basculer dedans.
Le brief de la refonte est écrit et **arbitré** : `TRANCHE-L10-GABARITS-LIBRES.md`. Trois décisions du mainteneur y sont consignées le 05/08 — la forme réelle **remplace** le surlignage des cases (le §5.9 est amendé sur sa raison d'être, l'arbitrage binaire est abandonné), la pointe du cône est l'ancre et le corps la poignée de rotation, et **les joueurs manipulent** comme pour les portes, ce qui rouvre le §12 Q8.

La demande, elle, est ailleurs : une **forme réelle** (rond, cône), dimensionnée en cases,
**non ancrée à la grille**, sélectionnable et déplaçable, qui épouse les murs si possible. Deux
choses à savoir avant de chiffrer : le défaut ci-dessus **disparaît avec la peinture par cases**,
et « épouser les murs » est la partie **déjà faite** — un `ctx.clip()` sur le polygone de sweep,
que `js/vision/sweep.js` produit déjà pour ce même calcul. Le coût réel est la sélection et le
glissement d'un objet non ancré, plus un `origin` qui devient un point carte : schéma, événement
réseau, vue joueurs et tests. La même cause survivra sous une autre forme — une forme découpée
par le polygone montrera des **cordes plates** sur son pourtour si la résolution angulaire du
sweep est trop grossière.

## Retour de table du 6 août 2026 — la vision directe disparaissait, et personne ne la renvoyait

**Corrigé.** Le symptôme rapporté : au retour sur la tablette après une longue inactivité, le fog
revenait en version « zone explorée mais non visible » là où les PJ devraient voir — autrement
dit la vision directe disparaissait — et ne revenait qu'au premier déplacement.

⭐ **La sonde a élargi le défaut au lieu de le confirmer.** Le MJ publiait bien
`fog.update, vision.update, fog.update`, et la tablette recevait une liste **vide**. Ce n'est
donc pas un défaut de reprise après inactivité : **toute vue joueurs qui arrive après la dernière
publication de vision n'a jamais la vision directe**. En séance ça passe inaperçu parce que le MJ
bouge vite quelque chose, ce qui change la signature et débloque une publication.

Trois mécanismes, **chacun correct isolément**, se refermaient ensemble :

1. **La vision n'est pas persistée, l'exploré si.** `getSessionFog` relit son masque depuis
   `localStorage` quand la mémoire est vide ; `getSessionVision` ne lit que la `Map`. C'est
   l'asymétrie exacte du symptôme — l'exploré revient, la vision non.
2. **Le canal ne rejoue rien, volontairement.** `FirebaseTransport._subscribeLive` borne son
   écoute strictement après la dernière clé connue, et l'instantané ne transporte que la
   campagne, l'étage actif et la sélection. Le dernier `vision.update` n'est jamais redélivré.
3. **Le MJ refusait de renvoyer.** `lastVisibleSignatureMap` dédoublonne par étage, et rien ne
   l'invalidait jamais : la `Map` était seulement écrite. De son point de vue, rien n'avait
   changé, donc rien à publier.

**Le correctif : la tablette réclame, l'autorité répond.** `VISION_REQUEST_EVENT`, émis au
démarrage **et** au retour au premier plan — les événements publiés pendant que la tablette
dormait ne sont pas rejoués non plus. Le MJ vide son cache de signature **en entier** et
recalcule : l'étage annoncé par le demandeur peut être en retard sur celui du MJ, qui est
l'autorité, et vider un cache de dédoublonnage ne coûte au pire qu'une publication de plus.
Coalescé à 250 ms — sans quoi dix tablettes qui reviennent ensemble déclencheraient autant de
rediffusions d'environ 13 Kio, exactement le régime que la garde anti-rebouclage de `syncVision`
existe pour éviter.

⛔ **Ne pas « simplifier » en persistant le masque de vision comme l'exploré.** C'est plus court
et ça a l'air de marcher. Mais un masque relu du disque est un masque **d'avant l'absence** : la
tablette afficherait de la vision directe là où les PJ ne voient plus. La vision est la seule
chose que le MJ recalcule ; elle doit venir de lui, pas d'une archive. Décision du mainteneur,
06/08/2026.

**Vérifié par mutation**, `tests/visionRecovery.spec.mjs`, deux tests — l'arrivée en cours de
session, et un **vrai F5** suivi d'**aucun geste** (avec un déplacement, l'ancien code passait).
Purge du cache retirée en gardant l'appel à `syncVision` → rouge. Demande au démarrage retirée en
gardant celle du premier plan → rouge. L'assertion écran ne suppose rien de la carte : le témoin
est pris dans le test en retirant le masque et en comparant les luminances.

⚠ **Reste à confirmer sur la tablette.** Le test reproduit la perte de contexte par un F5, pas la
mise en veille réelle d'Android. Voir la liste des vérifications manuelles.

**Les points de vie : mécanique acquise, esthétique refusée.** Le mainteneur juge le rendu du
chantier Q insatisfaisant — formes trop simples, superpositions de couleurs peu lisibles. La
cause est structurelle et non décorative : **aucune place n'est réservée**. L'anneau de PJ est
tracé *par-dessus* l'image du pion, sur une illustration dont on ne maîtrise ni les couleurs ni
le contraste puisqu'elle vient d'un UVTT quelconque — le contraste est donc accidentel. Enrichir
les formes au même endroit ne ferait qu'empiler. Direction tranchée le 06/08 : une **châsse**,
géométrie générée en Canvas 2D, dans laquelle l'image du pion entre **en retrait**, la jauge de
PV et l'état du PNJ vivant sur la châsse et jamais sur l'illustration. Générée et non dessinée,
parce que les pions arrivent à toute taille et en deux formes : une matrice d'assets laisserait
sans cadre le premier pion imprévu. Un **contrat de zones nommées** est prévu dès maintenant pour
qu'un cadre illustré puisse s'y substituer plus tard sans rien jeter. Second principe, tiré du
constat : encoder par la **forme et la position**, pas par la teinte seule — à bout de bras sur
une tablette, un arc qui se remplit se lit là où deux rouges voisins ne se distinguent pas.
Le brief est écrit et **entièrement arbitré** : `CHANTIER-R-CHASSE-DES-PIONS.md`. La dernière
décision, tranchée le 06/08 — la matière de la châsse est un **gris sombre unique et constant**,
jamais teintée par le `borderColor` du pion, l'identité restant portée par le liseré au bord de
l'illustration. Raison : le but même du chantier est un contraste qui ne dépende pas de données
venues du dehors, et teinter la châsse avec une couleur de pion rouvrirait le défaut par la porte
de service.
Le brief relève au passage une **quatrième occurrence** de la grandeur écrite dans le mauvais
espace — après le chantier K, L-09 et les portes — cette fois sur le liseré du pion et l'anneau de
sélection, tous deux en pixels carte, donc à 0,7 et 0,6 px écran à la vue « carte entière ». Ils
sont dans la zone de travail de la châsse et se corrigent au passage.

## Retour de table du 7 août 2026 — trois défauts, dont deux invisibles à toute mesure

Première séance après les déploiements du lot 3 et de la châsse. **La châsse est jugée lisible**
par le mainteneur — le critère 9 est donc atteint, avec l'envie d'explorer une vraie décoration
plus tard. Trois défauts sérieux ont été trouvés, tous corrigés le jour même.

### 1. Un masque de fog mal dimensionné faisait disparaître TOUS les pions

Rapporté ainsi : « la zone de vision est là, mais pas le pion ». Le MJ voyait ses pions, la table
non, et rien ne le disait.

`parseUvtt` donnait à **tout** étage importé l'identifiant `'uvtt-level'` — un export Dungeondraft
ne porte pas d'`id`. Or les masques sont indexés par `levelId`, **clé `localStorage` comprise** :
deux cartes de tailles différentes partageaient leurs masques, et celui d'une carte de 65 × 71
était relu pour une carte de 20 × 16. Le fog continuait d'afficher une zone claire — il dessine le
canvas mis à l'échelle — tandis que la couche des pions lisait le même masque **case par case** et
concluait qu'aucune case n'est vue.

⭐ Le même identifiant partagé expliquait deux autres symptômes du jour : importer une seconde
carte **écrasait la première en silence** (`addLevel` remplace à identifiant égal), d'où l'absence
de sélecteur d'étage et le « critère 1 non vérifié » du lot 3.

Deux barrières, volontairement redondantes : `decodeFogPng` compare les dimensions de l'en-tête
IHDR et **écarte** le masque si elles diffèrent ; le cache d'alpha refuse un tableau mal
dimensionné. ⛔ Mieux vaut tout montrer que tout cacher sans le dire. Cause racine corrigée : les
identifiants viennent du nom de fichier, et `maps/generated/` a été régénéré.

### 2. La « grosse latence » était une horloge, pas un réseau

⭐ **Le défaut le plus instructif de la journée**, parce qu'il était invisible à toute mesure du
réseau **et** du store, et que deux campagnes de mesure automatisées n'ont rien trouvé.

La sonde `docs/SONDE-LATENCE.md`, passée dans la vraie fenêtre MJ, a tout dit d'un coup :

```
traitement app  22,1 ms   vers le store  19,9 ms   vers le repaint  22,8 ms
réseau  −5311 ms
```

Le poste MJ encaissait et repeignait en **23 ms**. Et la colonne réseau **négative** révélait une
horloge de tablette **5,3 secondes en avance**.

`tokens.js` calcule `elapsed = Math.max(0, now - move.startedAt)` avec le `now` du **récepteur**,
alors que `startedAt` était daté par l'**émetteur** : on soustrayait deux horloges. Tablette → MJ,
la date était dans le futur et l'animation restait figée 5,3 s sur la case de **départ**. MJ →
tablette, elle était dans le passé et le pion **sautait** — ce que le mainteneur prenait pour de
l'instantané était l'animation escamotée. Deux symptômes opposés, une seule ligne.

⚠ **C'est l'observation du mainteneur qui a tranché, pas une mesure** : « une porte s'ouvre
instantanément, seul le déplacement a du retard ». Porte et déplacement empruntent le même canal —
Firebase était donc innocenté —, et `token.move` est le **seul** événement porteur d'un horodatage
d'animation. Le bon test était là, et aucune de mes deux campagnes ne l'avait imaginé.

L'instant de départ est désormais **local au récepteur** : l'animation est une affaire de
présentation, chaque poste la joue à partir du moment où il apprend le déplacement.

### 3. `willReadFrequently` — l'avertissement est un faux problème, et c'est mesuré

Voir le point 1 des « trois points sciemment non traités » : 0,730 ms sans l'attribut contre
0,775 ms avec, sur un masque de 520 × 568. ⛔ Ne pas l'ajouter pour faire taire la console.

### Ce que la journée dit de la méthode

**Deux sondes fausses ont été écrites et corrigées avant de conclure**, et la première aurait fait
écrire un correctif sur du vent : un écouteur de mesure abonné **après** celui de l'application
datait l'arrivée une fois le poste ayant déjà tout traité, et rapportait 613 ms de « réseau » qui
n'en étaient pas. ⚠ Une sonde se vérifie avant ce qu'elle mesure.

Et **la mesure automatisée a mesuré le mauvais monde** : elle tournait sur le transport de test,
un canal local du navigateur, et concluait « le réseau n'est pas en cause » sur la foi de 33 ms
qui ne représentaient rien du réseau réel.

## Premier run CI complet — 8 août 2026, et le défaut qu'aucune vérification locale ne voyait

Les quatre commits de phase R0 à R3 étaient restés **locaux** ; leur poussée a déclenché le premier
run GitHub qui exécute réellement `test:firebase-rules`. Résultat final : `verify` vert en 2 min
28 s, puis `build` et `deploy`.

**Trois choses tombent avec ce run, et elles n'étaient jusqu'ici que des espoirs :**

- les règles Firebase sont exercées contre les **vrais** moteurs Firestore et RTDB, dans un projet
  `demo-*` avec Java 21 — la cible ne peut pas tourner sur ce poste, Java 21 en étant absent ;
- les trois gestes rapatriés dans `verify` par R1-08 tiennent **sur le runner**, c'est-à-dire à
  l'endroit exact où ils étaient rouges aux runs 69 à 76 ;
- ⭐ le défaut de terminaison de Playwright, signalé trois fois plus haut dans ce document, est
  **propre au poste Windows**. Le job Ubuntu se termine normalement. Ce n'était pas un doute sur la
  suite de tests, et il ne faut plus le lire comme tel.

### Déploiement des règles, le même jour

`firebase deploy --only firestore:rules,database` a publié les deux jeux de règles sur
`rpg-map-display`. Deux vérifications ont précédé la publication, parce que des règles déployées
sont une porte qui se referme sur la table si elle est mal dimensionnée :

| Base | Chemins réellement écrits par le code | Couverture |
|---|---|---|
| RTDB | `session/<id>/{events, presence, retentionClients}` | `session/$sessionId` couvre les descendants |
| Firestore | `campaigns/<id>` + `/levels/<id>`, `/tokens/<id>`, `/state/current` | les quatre sont déclarés, sans règle récursive |

`.info/serverTimeOffset` est lu par le transport mais échappe aux règles par construction.

⚠ **La publication est un resserrement** : seuls `ethoril@gmail.com` (e-mail vérifié) et
`et.horil@gmail.com` sont autorisés. Un troisième compte Google sur la tablette serait refusé dès la
prochaine séance — à vérifier avec le compte réellement utilisé côté joueurs.

`.firebaserc` était **absent** du dépôt : `firebase.json` déclarait bien les deux fichiers de règles,
mais aucun projet n'y était associé et un `deploy` échouait sur « No project active ». Il est
désormais versionné, pour que la commande soit la même sur toutes les machines.

Note d'usage : `firebase-tools` est une devDependency, donc absente du `PATH`. La commande est
`pnpm exec firebase …`, jamais `firebase …`.

### Le premier run a d'abord échoué, et la cause mérite d'être retenue

`pnpm install --frozen-lockfile` installait ses 714 paquets, imprimait la liste des devDependencies,
puis sortait en **code 1** :

```text
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: re2@1.26.1
```

`re2` arrive par le `firebase-tools` ajouté en phase R1, comme dépendance **optionnelle** de
`superstatic`. Elle déclare `engines: node ^22.22.2 || ^24.15.0 || >=26.0.0` : elle n'est donc **pas
résolue sur ce poste Windows**, et l'est sur le runner Node 24.

⚠ **La même commande était verte en local et rouge en CI, et aucun `pnpm install` local ne pouvait
attraper ça.** C'est la leçon du jour : quand une dépendance est optionnelle et bornée par son
`engines`, un poste qui ne la résout pas ne prouve rien sur un runner qui la résout.

**Le correctif refuse la construction plutôt que de l'autoriser**, et ce choix est vérifié et non
supposé : `superstatic/lib/utils/patterns.js` charge `re2` dans un `try/catch`, met `RE2 = null` en
cas d'échec et se replie sur la `RegExp` native ; ces motifs ne servent qu'aux réécritures de
l'émulateur **hosting**, que `test:firebase-rules` ne démarre pas (`--only firestore,database`).
`re2: false` rejoint donc `@firebase/util` et `protobufjs` dans `allowBuilds` de
`pnpm-workspace.yaml`. ⛔ Compiler ou télécharger un module natif dont rien ne dépend, pour faire
taire une erreur d'installation, aurait été le mauvais sens.

## Réconciliation des décomptes — 8 août 2026

La définition du « prêt pour la 1.0 » comporte, mot pour mot, la condition *« ETAT.md et le cahier
des charges portent le même nombre de critères validés »*. Ils ne le portaient pas. C'est la seule
des conditions manquantes qui ne demandait ni matériel, ni décision, ni droits d'image.

**Trois écarts, dont un impossible :**

1. **Aucune** des 11 cases du lot 1a ni des 4 cases du lot 1b n'était cochée dans le CdC, alors que
   les deux lots étaient déclarés complets ici depuis le 5 août. Les lots 2, 3 et 4, eux, étaient
   à jour — l'écart tenait aux deux lots les plus anciens, cochés nulle part parce que personne
   n'était repassé dessus après leur clôture.
2. Le lot 1a annonçait **« 10 critères sur 11 »** tout en nommant **deux** points ouverts. Dix plus
   deux ne font pas onze : le décompte était faux par construction, et il l'était depuis assez
   longtemps pour avoir été recopié dans les résumés.
3. Les deux points en question — tenue thermique sur la durée, limite de texture réelle —
   **n'appartiennent pas au lot 1a**. Aucun des onze critères ne les mentionne. Ce sont **R2-06** de
   la feuille de route complémentaire et la **question ouverte n°1 du §12**.

⭐ **La règle qui manquait, et qui évite la rechute : un critère n'appartient qu'à une seule
liste.** Une mesure suivie par la feuille de route ou par le §12 ne se recompte pas dans un lot du
§11. Recompter donne l'illusion d'un lot incomplet et fait disparaître le vrai propriétaire de la
mesure — ici, la tenue thermique semblait retenir le lot 1a alors qu'elle attend la séance R2.

**État après réconciliation : 34 critères acquis sur 41.** Lot 1a 11/11, lot 1b 4/4, lot 2 13/13,
lot 3 5/6, lot 4 1/6, spike vidéo 0/1. Les sept restants tiennent en trois causes : trois cartes
réelles licenciées, la grille hexagonale entière, et un spike vidéo que rien ne bloque.

> ⚠ **Chiffres justes au 08/08, mais la première cause était fausse.** « Trois cartes réelles
> licenciées » n'a jamais été un obstacle : `test_village_complet` en fournit trois, au dépôt, et le
> critère 1 est coché le 12/08/2026. La licence est le domaine du mainteneur et ne conditionne aucun
> travail technique. Décompte à jour : voir « Suite produit ».

## Campagne de diagnostics sur la tablette — 11 août 2026

Passée par le mainteneur sur la Tab S9 FE avec `diag.html`. **Aucun problème de performance
constaté**, et la campagne est **close sur sa décision** — « nous n'avons pas de soucis de perf,
réjouissons-nous au lieu de tester sans fin ». Ce qui suit est le relevé complet, **y compris ce
qu'il n'autorise pas à conclure** : deux sondes de la page rendent des chiffres faux, et il vaut
mieux que ce soit écrit ici qu'oublié puis cité.

| Section de `diag.html` | Relevé sur la tablette |
|---|---|
| 6bis — sweep sur les cartes publiées | positif, résultats « exceptionnels » sur la carte vidéo |
| 7 — fond animé, matériel ou logiciel | **décodage matériel annoncé** (`powerEfficient` vrai) |
| 7bis — lecture réelle du fond animé | 29,9 i/s ; verdict « rampe » ⚠ **faux par construction**, voir plus bas |
| 10 — coût de la vision avec lumières | **2,6 ms**, pour un budget de 300 ms, **sous cast actif** |
| 11 — motifs à juger (chantier Q) | aucun souci de visibilité |
| 15 — onglets MJ réellement ouverts | image 5 · handout 5 · gabarits 4 · pions 3 · cartes 2 · fog 2 · murs 1 |
| R2 — décodage froid | `Image.decode()` **1 118 ms** sur `testbig150.webp` |
| R2 — endurance | rien à signaler |
| 13 — banc de visée, 20 portes | erreur p50 **2,9 px** · p95 **7,1 px** ; réussite **100 % dès 0,25 case** ; appui p50 **83 ms** · p95 **139,2 ms** |

### Trois arbitrages que ce relevé tranche sans écrire une ligne de code

- **La capsule des portes reste à 0,25 case.** La question du §8 du brief — remonter de 0,25 à 0,4
  maintenant que le pion a sa tolérance — est **répondue par la mesure et la réponse est non** : sur
  les mêmes vingt gestes, la capsule actuelle réussit déjà **100 %**. Élargir ne gagnerait rien et
  coûterait de la précision là où deux portes se touchent. Le chantier O est donc entièrement clos.
- **`DRAG_HOLD_MS` reste à 150 ms, et c'est la donnée que l'arbitrage A7 attendait.** L'appui p95
  mesuré est de **139,2 ms**, donc sous le seuil : les taps ordinaires ne sont pas pris pour des
  appuis longs. ⚠ **La marge n'est que de 10,8 ms** — si la zone morte 150–500 ms est un jour
  découplée (`CORRECTIF-APPUI-LONG.md` §7 A7), c'est ce chiffre qu'il faudra reprendre, pas un seuil
  choisi au hasard.
- **Trois onglets MJ ne servent pas.** UVTT, Liaisons et Grille n'apparaissent pas au relevé, donc à
  zéro ouverture sur cette séance — ce que la section 15 dit explicitement chercher (« un onglet
  jamais ouvert n'a pas à occuper la barre »). Un relevé, une séance : à confirmer sur une seconde
  avant de retirer quoi que ce soit de la barre.

### Deux sondes de `diag.html` rendaient des chiffres faux — une corrigée, une consignée

Décision initiale du 11/08 : ne rien corriger, la campagne étant close et le produit sain.
**Révisée le même jour pour 7bis**, sur demande du mainteneur, une fois établi que le calcul
pouvait être éprouvé sans dépendre d'une machine. La seconde sonde reste en place, et reste donc un
**piège connu** : ne conclure de rien à partir de ses chiffres.

**1. La section 7bis disait « rampe » sur une lecture qui tient. ✅ Corrigée.** Elle mesurait l'avancement du flux
depuis le *début* de la fenêtre de 60 s, avec une correction de boucle qui ne rattrape qu'**un seul
tour** (`while (avance < 0) avance += video.duration`). Or `testvideo-3.webm` dure exactement 30 s
— lu dans l'en-tête EBML, `ffprobe` n'étant pas installé sur le poste. Soixante secondes de lecture
*parfaite* font donc deux tours complets : `currentTime` revient à son point de départ, `avance`
retombe à ~0, la correction en rend un seul, et le résultat est **29,9 s de flux pour 60,0 s
écoulées, soit 49,8 %** — un cheveu sous le seuil de 50 %. Le verdict est **déterministe et
indépendant du matériel**, ce que le mainteneur a vérifié de lui-même en repassant le test sur un PC
puissant : chiffres identiques. Ce n'était pas une coïncidence, c'était la signature du défaut.

⭐ **Le produit, lui, ne commet pas cette erreur** : `VideoBackdrop._checkPlayback` compare deux
échantillons **consécutifs** à 2,5 s d'écart, où corriger d'un tour est valide. Le seuil de 50 % et
la période de 2,5 s sont justes ; c'est la seule fenêtre de mesure du diagnostic qui est fausse.
**Conclusion réelle : la lecture du fond animé tient sur la tablette.** 29,9 i/s est la cadence du
fichier (30 i/s), pas un plafond de l'appareil — aucun décodeur ne rend plus d'images qu'il n'en
existe — et aucune fixité n'apparaît à l'œil.

Le test de couverture ne pouvait pas l'attraper : `tests/diagVideo.spec.mjs` tourne à `?duree=8`,
sous les 30 s de la vidéo, donc la boucle ne repasse **jamais** par zéro. Faux vert de plus, et de
la même famille que ceux du chantier W : le test exerce le bouton, pas la grandeur.

**Correctif livré le 11/08/2026.** Le calcul est cumulé par intervalle et vit désormais dans une
primitive partagée, `LoopingPlaybackProgress` de `js/render/videoBackdrop.js` : le produit et le
diagnostic jugent la même arithmétique, ce que la doc de 7bis prétendait déjà. `premierRepli` se
juge maintenant sur le ratio **de l'intervalle** — la grandeur que `_checkPlayback` regarde
réellement — et non sur le ratio depuis le début, qui ne prédit rien du basculement.

⭐ **La leçon de méthode est dans la répartition de la preuve.** Le verdict de 7bis ne sera jamais
asserté en CI : il exigerait qu'un headless décode 4200×2850 en temps réel, l'assertion serait
dépendante de la machine, donc instable, donc désactivée un jour. Le calcul, lui, est déterministe :
il est éprouvé dans `tests/videoBackdrop.test.mjs` avec une horloge et un flux synthétiques, boucles
comprises, et la mutation le confirme — remettre le défaut fait rougir quatre tests. **Un test
navigateur qui mesure une performance mesure aussi la machine ;** séparer le calcul de la lecture est
ce qui rend la moitié prouvable réellement prouvée.

### ✅ Un défaut du produit trouvé en écrivant ce test, corrigé le jour même

Trouvé le 11/08/2026 en écrivant les tests ci-dessus, et **ce n'en était pas un du diagnostic**.
`advanceBetween` ne corrige **qu'un seul** passage par zéro, ce qui exige d'échantillonner plus vite
que la durée du flux. Or `VideoBackdrop._checkPlayback` échantillonnait à `STALL_CHECK_MS = 2500` ms
fixe : **toute carte dont la vidéo durait moins de 2,5 s aurait vu son fond animé rabattu sur
l'affiche fixe**, avec un avertissement accusant à tort le décodeur. Une lecture parfaite d'un flux
de 2 s se lit 0,2 — vérifié par test.

L'exposition était **latente** : `testvideo-3.webm` dure 30 s et c'est la seule carte animée du
catalogue. Mais une boucle courte — feu de camp, clapotis, torche — est exactement le cas d'usage
naturel d'un fond animé. **Arbitré par le mainteneur pour un correctif immédiat**, sur le motif
décisif : « c'est très improbable une boucle si courte mais je pense que je ne le saurai jamais à
l'avance ». Un défaut qui ne se manifeste qu'à l'import d'une carte future ne se diagnostiquera pas
au moment où il frappera.

Le correctif tient en deux pièces, et la seconde est là parce que la première ne suffit pas :

- **`stallPeriodFor(duree)` dérive la période du flux** — la moitié de la durée, plafonnée à la
  nominale de 2 500 ms et plancherée à `STALL_CHECK_FLOOR_MS = 500` ms. Le plancher existe contre la
  gigue du minuteur : à 100 ms de période, 50 ms de retard suffiraient à faire tomber le ratio sous
  le seuil. La durée n'étant pas connue à l'armement, le contrôle se **réarme sur `loadedmetadata`**.
- **`_checkPlayback` refuse de conclure quand la mesure est indécidable** — si l'intervalle atteint la
  durée du flux, un tour entier a pu passer et aucune arithmétique ne distingue « ça boucle » de
  « c'est bloqué ». Nécessaire parce qu'en dessous du plancher, **aucune** période ne satisfait la
  précondition : un flux de 0,4 s n'est pas mesurable, et laisser jouer un fond peut-être lent vaut
  infiniment mieux qu'éteindre une lecture saine.

⭐ Le test qui gardait l'arithmétique du défaut a été conservé, pas supprimé : c'est lui qui écrit
**pourquoi** la période est dérivée. Sans lui, `stallPeriodFor` ressemble à une complication gratuite
et quelqu'un rétablit la constante. Preuve par mutation en deux passes séparées, pour que
l'attribution soit nette : période refixée → 6 tests rouges dont le régressif ; refus de conclure
retiré → exactement 1, le sien. Le fond animé réel conserve la période nominale, `testvideo-3` durant
30 s : **aucun changement de comportement pour le catalogue actuel**.

**2. La ligne `drawImage` du décodage froid mesure une file d'attente, pas un décodage.** La section
refabrique une `Image` et fait `await image.decode()` **juste avant** de démarrer le chronomètre :
le bitmap est chaud par construction, et les deux minutes de silence sont annulées à la ligne d'avant.
Rien ne vide ensuite le pipeline GPU, donc `performance.now()` encadre la mise en file d'une commande
et non sa peinture. D'où les deux chiffres impossibles du relevé : **0,2 ms pour 12 Mpx en plein
format** — 60 Gpx/s — puis **1 146 ms sur la doublure de 1024 px**, qui est le coût du premier tracé
payé en retard et imputé au mauvais poste. Les deux décrivent le même travail, mal découpé.

⛔ **Le « OUI — critère R2-03 tenu » qu'imprimait cette section était donc un faux vert.** C'est le
travers que `debugging_lessons` retient sous « une sonde fausse ferme la question », et le commentaire
de `js/app/diag.js` qui mettait en garde contre l'erreur de grandeur la commettait autrement, six
lignes plus bas.

✅ **Corrigé le 12/08/2026** (G-01). `mesurerDecodageFroid` prend l'image **armée sans être décodée**
via `ColdDecodeTrial.takeArmedImage()`, chronomètre `drawImage` suivi d'un `getImageData(0,0,1,1)` qui
vide le pipeline, mesure le coût de cette relecture seule sur un bitmap 1×1 et le **retranche**. La
page affiche les trois durées et le verdict porte sur le **net**. `Image.decode()` a été retiré de la
section, avec la raison écrite sur la page : un bitmap ne refroidit qu'une fois, donc mesurer
`decode()` d'abord réchaufferait le `drawImage` — et c'est le `drawImage` que porte R2-03.

⚠ **Ce qui reste n'est pas du code.** L'arithmétique du verdict vit dans
`resumeDecodageFroid()` (`js/app/endurance.js`), pure et éprouvée par mutation : la soustraction de la
relecture **fait basculer le verdict** sur le cas 6,4 / 2,1 ms, et la phrase affichée est rendue par
cette fonction — la composer dans la page laissait la faire porter sur le brut sans qu'aucun test
rougisse, les durées d'un Chromium sans charge étant trop petites pour distinguer les deux verdicts.
Le relevé tablette reste à faire, et il appartient au mainteneur.

**Seul le `Image.decode()` de cette section est exploitable, et il dit quelque chose.** 1 118 ms à
froid sur `testbig150.webp` contre ~490 ms relevés sur le Mac au chantier N : **2,3×**, exactement le
sens que le chantier annonçait sans le chiffrer (« la tablette paie plus cher »). Cela ne rouvre rien
— c'est précisément le rôle de la doublure 1024 px du chantier P que d'éviter que ce coût tombe dans
une frame — et l'endurance ne signale aucune saccade. À retenir comme **confirmation d'une prédiction**,
pas comme défaut.

## Chantier Y — la carte-décor, 12 août 2026

**Le préparateur avale désormais une simple image comme fond de carte** (`CHANTIER-Y-CARTE-DECOR.md`).

⚠ **Rectification du 12/08, le jour même.** J'ai d'abord écrit ici que le critère 1 du lot 3 « n'était
pas bloqué par du contenu ». C'est faux, et l'erreur venait d'avoir résumé le critère au lieu de le
lire : `CHANTIER-S` §169 exige « trois UVTT réels, avec provenance et **droit de diffusion**
documentés ». Le chantier Y lève le verrou technique — n'importe quelle image passe — mais le verrou
que le critère nomme est celui de la **licence**, et il tient. Les cartes Stained Karbon sont
autorisées en usage privé, pas en republication.

⭐ **Le constat qui l'a déclenché ne figurait dans aucun critère.** La chaîne n'acceptait que
`.uvtt`/`.dd2vtt`/`.df2vtt` ; or la bibliothèque réelle du mainteneur ne contient que du `.jpg` et du
`.pdf` — **1 774 images JPEG**, comptées en parcourant le dossier. Sa bibliothèque entière était donc
inutilisable par sa propre chaîne : le produit tournait sur cinq cartes de test. C'était le plus grand
écart entre l'outil et un outil dont on se sert, et rien ne le mesurait.

La densité vient du **nom de fichier** — `Ambush Site_37x28_High res.jpg` fait 5180 × 3920 px, donc
exactement 140 px/case — validée contre les dimensions réelles de l'image. ⛔ **Aucune valeur par
défaut**, sur arbitrage du mainteneur : « ce corpus est à 140 px/case mais peut-être qu'un jour j'aurai
d'autres images, il ne faut pas tout baser là-dessus ». Sans couple lisible, la préparation refuse et
nomme le remède.

⚠ **Trois choses à retenir pour la suite :**

- **L'essai sur une vraie carte valait tous les tests.** Elle est passée du premier coup, mais elle a
  fait tomber deux défauts qu'aucun test n'aurait révélés : `maps/minimal.webp` — l'illustration d'une
  scène de test — était pris pour une carte, et `Jimp.read` ne décode pas le WebP sans son greffon.
- **Élargir `isSupportedSource` a changé son sens** : il répondait « est-ce un export VTT ? », il
  répond « est-ce préparable ? ». Un test existant a tenté de parser un binaire. `isVttSource` a été
  ajouté pour que deux questions distinctes portent deux noms.
- ⛔ **La carte d'essai a été retirée du dépôt avant tout commit**, artefacts et catalogue compris. Le
  corpus Stained Karbon est autorisé en **usage privé**, pas en republication, et `maps/` est publié
  sur GitHub Pages. Les fixtures de test sont des PNG générés dans un dossier temporaire.

## ✅ Lot 3 fermé — le critère 1 était satisfait, je l'avais mal lu

Coché le 12/08/2026. **Le lot 3 passe à 6 sur 6**, et le décompte global à 36 sur 41.

`maps/test_village_complet_00/01/02.dd2vtt` sont trois exports réels de ~9 Mo, présents au dépôt,
importés séparément et assemblés en une campagne à trois étages par `maps/scenes.json` :

| | Constat |
|---|---|
| Trois étages en une passe | ✅ `Village`, 3 étages de 42 × 42 |
| Alignement manuel | **aucun** — les trois `grid.offsetX/offsetY` valent 0 |
| Liaisons inter-étages | 2, fonctionnelles |
| Géométrie propre à chaque niveau | 200, 37 et 16 murs ; 123, 17 et 7 portes |

### ⛔ Deux erreurs de ma part, et la seconde est un travers à ne pas répéter

**1. J'ai lu « importés indépendamment » comme « de provenances indépendantes ».** C'est une exigence
que le critère n'écrit pas. Trois étages d'un même bâtiment viennent naturellement d'un même export,
et c'est le cas **normal** — le critère demande que l'outil n'exige aucun lien entre les fichiers ni
aucun recalage à la main. Sur ce fondement inventé, j'ai disqualifié `test_village_complet`, qui
satisfaisait le critère depuis le début.

**2. J'ai transformé une question de licence en blocage technique.** J'ai écrit que la case « attendait
du contenu diffusable ». Le mainteneur a dû le corriger pour la quatrième fois :

> « le respect des licences d'usage est de mon côté, le technique ne doit jamais être bloquant. Et je
> n'utilise que des assets que j'ai le droit d'utiliser dans ce contexte, il n'y a aucun débat. »

⛔ **Consigne, valable partout dans ce dépôt** : ne jamais conditionner un travail technique à une
question de droits, ne pas ajouter de garde ni de « ⚠ à vérifier » sur ce thème. Si un fichier est au
dépôt, il a le droit d'y être. Reste seule légitime la retenue de ne pas **ajouter** d'assets tiers de
ma propre initiative — c'est une action sortante, pas un jugement sur ses droits.

*Ce que l'excursion a produit de bon* : le trou de couverture ci-dessous, trouvé en important trois
cartes de packs différents. Elles ont servi à l'essai puis ont été retirées — non pas par prudence
juridique, mais parce que je n'avais pas à ajouter des assets au dépôt sans qu'on me le demande.

### ⚠ Un trou de couverture trouvé en le faisant, et comblé

`multiLevelJourney.spec.mjs` construit **tous** ses étages aux mêmes dimensions — `pxPerCell: 80`,
10 × 8. Le parcours à étages n'avait donc jamais été éprouvé sur des étages de **tailles
différentes**, alors que c'est exactement ce que produit un import de provenances indépendantes. Et
c'est la forme à laquelle le fog est sensible : un masque relu aux mauvaises dimensions **fait
disparaître tous les pions** en laissant la zone de vision dessinée — défaut payé en séance le
07/08/2026. `maskDimensionMismatch.spec.mjs` couvre le cas voisin de la **collision d'identifiants**,
pas celui-ci.

`tests/heterogeneousLevels.spec.mjs` le comble, sur fixture **synthétique** — trois étages de tailles,
proportions et densités toutes différentes, parcourus deux fois. Mutation : figer les dimensions de
décodage du masque le fait rougir dès le deuxième étage.

⛔ **Et la leçon de méthode, pour la troisième fois de la journée : la sonde était fausse, pas le
produit.** Ce test a accusé le produit à trois reprises avant d'être juste. (1) Au zoom ajusté par
`fitActiveLevel`, une case de 45 × 80 tombe à **10,2 px** et le liseré d'un pion ne couvre plus aucun
pixel d'une signature de couleur franche. (2) Basculer le joueur sans attendre le MJ laisse un masque
**à 0 octet** : le MJ est l'autorité de vision et ne calcule que pour son étage actif. (3) Le masque
peut exister avant que le canvas soit redessiné, donc un prélèvement sec précède le dessin d'une
frame. **Aucun défaut du produit dans cette affaire** — il était juste depuis le début.

## Revue de couverture des tests — 11 août 2026

Menée sur question du mainteneur (« il nous manque quoi en tests ? »), après la campagne de
diagnostics. Le maillage était dense — 289 unitaires, 142 navigateur, huit invariants d'architecture
vérifiés à la machine — et il manquait peu. Mais un trou était sérieux, et deux leçons de méthode
sont sorties de la recherche elle-même.

### Le trou : l'invariant du chantier W n'était vérifié par personne

**Deux moitiés existaient sans jamais se rencontrer.** `appIntegration.spec.mjs` prouve que
`frameCount` se fige quand la scène est immobile — mais sur une scène vide, **sans vidéo**.
`videoBackdrop.spec.mjs` prouve que la couche de fond se tait quand la vidéo peint — mais **en
pixels**, ce qui dit qu'elle ne dessine pas l'image, pas que la boucle de rendu dort.

⭐ Un `invalidate()` par image vidéo passait donc les deux : la vidéo jouerait, la couche se tairait,
les pixels seraient justes. **Le seul symptôme aurait été une tablette qui se vide sur une séance de
4 h** — et il aurait été mis sur le compte du matériel, R2-06 étant précisément ouvert sur la tenue
de longue durée. Fermé par un test qui lit `frameCount` sur 1 s de lecture réelle, sur les deux vues,
après avoir attendu que la boucle se taise d'elle-même plutôt que de deviner un délai.

### Trois modules sans test, et pourquoi le compte était de trois et non de quatre

`js/grid/GridAdapter.js` était dans la liste des modules qu'aucun test n'importe : c'est un fichier
de contrat (`export {}`), correctement sans test, comme `js/core/types.js`. Les trois autres sont
couverts depuis le 11/08 :

- **`js/render/layers/walls.js`** — `tests/walls.test.mjs`, 9 tests. Ce qui s'y joue n'est pas
  l'aspect des traits, qui se voit à l'œil, mais **l'hygiène d'état du contexte** : une couche qui
  laisse fuir un `strokeStyle` ou un tiret de pointillé contamine toutes les couches suivantes de
  l'ordre canonique, et le défaut se manifeste alors **ailleurs** que dans son propre code. Deux
  comportements sont épinglés sans être approuvés : la couche hérite du pointillé de son appelant, et
  chaque mur doit ouvrir son propre chemin sous peine d'être relié au suivant par un trait inexistant.
- **`js/app/runtimeConfig.js`** — `tests/runtimeConfig.test.mjs`, 12 tests. Deux raisons, dont une
  qui n'était visible de nulle part : ⭐ le module a un **devoir de confidentialité**. `testEmail` et
  `testPassword` sont les identifiants du compte technique de la CI, et le mainteneur colle parfois
  le JSON complet dans `diag.html` : ils ne doivent ni entrer dans le runtime, ni être réécrits dans
  le stockage local de la tablette — qui se lit. Rien ne le vérifiait. Mutation : contourner le
  filtrage fait rougir les deux tests concernés.
- **`js/ui/gm/templateTools.js`** — ⚠ **et ici mon signal de départ était un faux positif.** « Aucun
  test ne l'importe » ne veut pas dire « non couvert » : c'est un composant DOM, il n'y a pas de jsdom
  au dépôt, et `templates.spec.mjs` le pilote déjà par l'interface réelle — forme, armement,
  effacement, exclusivité mutuelle — ce qui est la **meilleure** couverture pour ce genre de code.
  Le vrai trou était plus étroit et plus intéressant : **rien ne touchait `#tpl-radius`,
  `.tpl-rad-preset`, `#tpl-color` ni `#tpl-visible`**. Deux scénarios les couvrent désormais.

⭐ **`#tpl-visible` était un risque de fuite, pas un confort.** La vue joueurs filtre correctement sur
`visibleToPlayers` — c'est couvert par `templates.test.mjs` et `templateHit.test.mjs`. Ce qui ne
l'était pas, c'est que **décocher la case produise réellement `false`** : un filtre juste alimenté par
un drapeau toujours vrai montre tout aux joueurs. Mutation : figer les trois champs à leur valeur par
défaut dans `gm.js` fait rougir le scénario.

### Deux écarts mineurs relevés, non corrigés

- **Le champ de rayon déclare `max="20"` mais le composant borne à 50**, et `max` n'empêche rien hors
  validation de formulaire : le maximum effectif est 50. Un test fixe le comportement réel pour que
  l'écart soit vu ; il ne dit pas laquelle des deux bornes est la bonne — c'est un arbitrage de jeu.
- **`onPlaceTemplate` est déclaré dans le typedef de `TemplateToolsOptions` et n'est jamais
  destructuré ni appelé.** Un appelant qui le passerait n'obtiendrait rien, en silence. La pose passe
  en réalité par `gm.js`, qui lit `getConfig()`. À supprimer du typedef, ou à câbler.
- **`currentTemplateId` vient de `Date.now()`** : deux armements dans la même milliseconde
  produiraient le même identifiant. Improbable au doigt, atteignable par un test rapide — c'est
  d'ailleurs pourquoi les nouveaux scénarios ne posent qu'un gabarit chacun.

## À faire avant la 1.0 — dette d'exploitation Firebase

Relevé le 7 août 2026 sur question du mainteneur : « il me faudra un truc pour détruire toutes
les sessions passées, sauf si ça prend tellement peu de place qu'on s'en fout ». **Ni l'un ni
l'autre n'est critique aujourd'hui ; les deux doivent être faits avant la 1.0.**

La réponse mesurée sépare deux coûts très inégaux :

- **Les documents de campagne sont négligeables.** Une scène complète pèse 352 Kio
  (`testbig150.scene.json`), et Firestore plafonne de toute façon à 1 Mio par document. Le palier
  gratuit offre 1 Gio : des milliers de sessions tiennent sans qu'on s'en aperçoive. ⛔ Ne pas
  écrire d'outil pour ça, ce serait du travail contre un problème qui n'existe pas.
- **Le canal d'événements grossit sans limite, et c'est lui le sujet.** Chaque événement est
  empilé dans `session/<id>/events` et **rien ne l'efface jamais**. Or `fog.update` et
  `vision.update` transportent des masques PNG en base64 — **13,4 Kio mesurés** sur la plus grande
  carte, plafond à 50 Kio (`FOG_MAX_ENCODED_BYTES`). Le fog est throttlé à 1 Hz ; la vision ne
  l'est **pas**, le critère 10 exigeant moins de 300 ms pour l'ouverture d'une porte.

⚠ Ces chiffres viennent des tailles mesurées dans le code, **pas d'un relevé de la console
Firebase** : personne n'a encore regardé la consommation réelle du projet.

**1. Rétention automatique du canal d'événements** — la vraie correction, et elle est à la source.
Les événements passés ne servent à **personne** : `FirebaseTransport` borne son écoute strictement
après la dernière clé connue à la connexion, et ne relit donc jamais l'histoire. Ne garder qu'une
fenêtre récente supprime le problème au lieu de le rattraper.

**2. Outil de ménage des sessions passées** — utile en complément, jamais en remplacement.
`transport.purgeEvents()` **existe déjà** mais n'est câblé que dans `js/app/diag.js`, et ne vide
que la session **courante**. Rien ne permet aujourd'hui de faire le ménage sur les anciennes.

## Suite produit

Avancement mesuré contre les lots du cahier des charges §11, au **12 août 2026** :
**37 critères acquis sur 41.** Relevé pour éviter de confondre « le plateau est solide » et
« le produit est proche ». Trois acquis le 12/08 : le **ping** du lot 4 (chantier X) ; le **critère 1
du lot 3**, qui **ferme le lot 3 à 6/6** — il était satisfait depuis un moment, je l'avais mal lu ; et
le **spike vidéo**, fermé par la validation du cast.

⭐ **Les quatre critères restants sont tous dans le lot 4** : trois pour l'hexagone, un pour la
mesure au geste.

> **Mise à jour du 13/08/2026 — le développement des quatre est fait, le décompte ne bouge pas
> encore.** `HexGrid`, `MeasureLayer` et le sélecteur de pavage du panneau MJ sont livrés et
> éprouvés. Ce qui manquait au 12/08 n'était pas le code mais **la porte d'entrée** : la liste
> « Type de grille » était `disabled` et n'offrait que « Carrée », et `updateGridFromUI` posait
> `type = 'square'` en dur. Les deux sont levés.
>
> Reste, avant de cocher :
> - **le hit-test « au doigt du premier coup »** est un geste, pas un calcul. L'arrondi cubique est
>   exact sur 16 287 points balayés, mais « au doigt » se constate à la tablette ou dans un
>   `tests/manuel/`, comme le banc de visée des portes l'a fait pour les portes ;
> - **les trois autres se cochent sur lecture du mainteneur**, le code et les tests étant là.
>
> ⭐ Une **vraie carte hexagonale** est entrée au dépôt le 13/08 pour que le pavage cesse de ne
> tourner que sur des fixtures : `marais-hex_16x16`, une image de la bibliothèque du mainteneur
> posée sous grille hexagonale. Le marqueur `_hex` dans le nom de fichier la rend reproductible par
> `maps:prepare`, au même titre que `_Grid` et que `37x28`.

> ⚠ **Le décompte fait foi dans le §11 du CdC, pas ici.** Cette table le reprend ; en cas de
> désaccord, corriger cette table sur le §11. C'est l'inverse du réflexe naturel, et c'est
> précisément l'erreur qui a produit le « 10 sur 11 » du lot 1a.

| Lot du CdC §11 | État |
|---|---|
| **1a — Le plateau** | **11 critères sur 11, fermé le 08/08/2026 par réconciliation.** Les onze étaient acquis, le dernier — 30 fps sous cast — depuis le 05/08/2026 ; aucune case du CdC ne le disait. ⚠ **Ce lot annonçait « 10 sur 11 » en citant deux points ouverts**, ce qui est un décompte impossible : la tenue thermique est **R2-06** et la limite de texture réelle la **question n°1 du §12**. Elles restent ouvertes, mais **ailleurs** |
| **1b — La prépa MJ** | **4 critères sur 4**, fermé depuis le chantier M et la séance du 05/08/2026 ; cases du CdC cochées le 08/08. Bibliothèque de scènes (U-00 à U-06), révélation d’image (§5.8, chantier H), bibliothèque de pions (§5.7, chantiers I **et M**), badge d’élévation (chantier K) |
| **2 — Lignes de vue, portes & tactique** | **13 sur 13 validés ; lot fermé le 07/08/2026.** L-01 ferme les arêtes bloquées ; L-02 mesure et implémente le sweep ; L-03 réunit les champs de vision ; L-04 livre le fog persistant et ses trois rendus ; L-05 apporte les portes à trois états ; L-06 les outils de fog et l'undo ; L-07 l'éditeur de murs ; L-10 remplace L-08 par des formes réelles découpées par les murs ; L-09 livre les quatorze marqueurs et leurs trois paliers d'affichage. Les trois critères réservés au dispositif réel sont confirmés par le mainteneur le 07/08 : **marqueurs lisibles sur les trois écrans, réponse des portes sous 300 ms et ouverture tactile du premier coup**. Le test e2e d'occlusion des gabarits protège désormais explicitement le `ctx.clip()` du rendu. |
| **3 — Étages & lumière** | ✅ **6 sur 6, lot fermé le 12/08/2026** — `CHANTIER-S-LOT3-ETAGES-ET-LUMIERE.md`. Le sélecteur et `level.select` synchronisent les vues ; l'éditeur MJ crée des liaisons inter-étages bidirectionnelles ou à sens unique, publiques ou `gmOnly`, sans JSON. Le franchissement reste volontairement en deux temps et sur la case exacte. Un scénario multi-pages couvre téléportation, suivi automatique, cadenas, fog distinct et restauration après F5. L'ambiante, les lumières UVTT et `emitsLight` alimentent le sweep commun ; `baked_lighting` force la pleine ambiance et affiche un avertissement MJ. Firestore v3 répartit parent, niveaux, pions et état global dans une transaction révisionnée tout en lisant encore v2. La porte matérielle est fermée le 11/08 — mesure lumière sur la tablette **sous cast actif, 2,6 ms pour 300 ms de budget**. ⛔ **Le critère 1 était satisfait par `test_village_complet` depuis un moment** : trois exports réels de 9 Mo au dépôt, importés séparément, offsets à 0, deux liaisons. Il est resté ouvert parce que je l'avais mal lu et que j'en avais fait une question de licence — voir « Lot 3 fermé » plus bas |
| **4 — Hexagone & confort de table** | **2 sur 6 au 12/08/2026.** L-06 avait fermé « Undo restaure l’état fog précédent » ; **le chantier X ferme le ping** (`CHANTIER-X-PING.md`). ⭐ **Ce lot est en réalité deux lots indépendants** : trois critères hexagonaux, et trois de confort de table qui ne dépendent d’aucune décision. Ordre retenu : le confort d’abord — il reste **la mesure au geste**. ⭐ Les deux décisions qui interdisaient d’écrire `HexGrid` sont prises (§12 q.5 et q.6), donc la moitié hexagonale est débloquée quand on voudra. **13/08/2026 : le développement des quatre critères est livré** — `HexGrid` odd-r et son index de murs valable pour tout pavage, `MeasureLayer`, et le sélecteur de pavage ouvert dans le panneau MJ. Le décompte attend la lecture du mainteneur, et le hit-test « au doigt » attend un geste réel. Carte hexagonale réelle au dépôt : `marais-hex_16x16` |
| Spike vidéo 1080p sous cast | ✅ **1/1, fermé le 12/08/2026.** Fond animé constaté fluide sur la Tab S9 FE le 11/08 — 4200×2850 VP9, zoom et dézoom compris, **décodage matériel confirmé** (`powerEfficient` vrai) et cadence nominale à 29,9 i/s pour un fichier à 30 i/s. Le volet **cast** est validé le 12/08 sur confirmation du mainteneur : ses essais Mac + tablette + cast n'ont montré aucune difficulté. `videoUrl` est retenu, `animatedOverlays` n'a pas à le remplacer. Le verdict « rampe » de la section 7bis était un défaut d'arithmétique de boucle, **corrigé le 11/08** : la lecture tenait |
| §12 Questions ouvertes | ⭐ **1 seule au 12/08/2026, et elle dort par choix.** Cinq tranchées ce jour-là : q.5 et q.6 (provenance des cartes hex, forme des grandes créatures) qui bloquaient `HexGrid` ; q.1 (plafond de texture à 8192, validé par l'usage) ; q.2 (rester sur Firebase — décision du 07/08 qui n'était consignée que dans ce fichier alors que le §12 fait foi) ; q.4 (ambiance **par étage**, et `settings.ambientLevel` supprimé, car relu par aucun rendu). ⚠ Le décompte annoncé plus haut disait « 6 » : c'était **faux**, j'avais fait 8 − 2 alors que q.3, q.7 et q.8 étaient déjà tranchées. Reste **q.9** — l'approximation de la lumière vue, laissée dormante avec son déclencheur écrit |

Le substrat est en place : plateau, grille, pions, gestes, transport, persistance, import.
Le lot 2 est le plus gros du projet, et la géométrie que la chaîne se contentait de
**transporter** est désormais **lue** : les 131 murs et 40 portes de `manoir-rdc` bloquent le
passage (L-01), obstruent la vision (L-02, L-03), alimentent le fog (L-04) et s’ouvrent au
doigt (L-05). Ce qui reste du lot ne consomme plus cette géométrie, il l’**édite** —
pinceaux de fog, éditeur de murs, gabarits, marqueurs.

Toute optimisation GPU future devra passer par un nouveau contrat de renderer et des
mesures tablette ; elle ne justifie pas de restaurer l’ancienne implantation.
