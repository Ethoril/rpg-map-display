# FEUILLE DE ROUTE COMPLÉMENTAIRE

> Créée le 7 août 2026 à partir de l'audit complet du dépôt.
>
> Ce document complète le cahier des charges et les plans de lots. Il ne remplace ni la
> spécification fonctionnelle du « quoi » (`CAHIER-DES-CHARGES.md`), ni l'état factuel de ce qui
> est livré (`ETAT.md`). Il ordonne les travaux transverses découverts par l'audit : fiabilité,
> exploitation, performance, sécurité, ergonomie et préparation de la 1.0.

## 1. Point de départ

État retenu au 7 août 2026 :

| Périmètre | État de départ |
|---|---|
| Lot 1a — plateau | Code complet ; les validations de longue durée restent des contrôles d'exploitation |
| Lot 1b — préparation MJ | 4 critères sur 4 |
| Lot 2 — lignes de vue, portes et tactique | **13 critères sur 13** ; les critères 4, 10 et 11 ont été confirmés par le mainteneur le 07/08/2026 |
| Lot 3 — étages et lumière | **5 critères sur 6** ; éditeur et parcours multi-étages livrés, lumières exploitées ; la campagne réelle à trois étages reste à fournir |
| Lot 4 — hexagone et confort | 1 critère sur 6 ; seul l'undo du fog est acquis |
| Vérification automatisée | 324 tests unitaires réussis ; 148 tests navigateur réussis ; 2 scénarios Firebase réels conditionnés par le secret CI ; 3 gestes bloquants réussis |

Le projet est jouable, mais la 1.0 reste bloquée principalement par la persistance Firebase,
le fonctionnement local réellement hors ligne, les performances du store sur les campagnes
denses et la validation de longue durée sur la tablette cible.

## 2. Règles de priorité

- **P0 séance** : une défaillance peut gêner ou interrompre la prochaine partie.
- **P0 1.0** : la fonction peut marcher en séance, mais son exploitation durable n'est pas sûre.
- **P1** : nécessaire avant d'ajouter une charge importante au moteur, notamment les lumières.
- **P2** : amélioration produit ou lot futur, à traiter après les fondations.

Chaque phase possède une porte de sortie. Une phase n'est pas « terminée » parce que son code est
écrit : ses critères de sortie doivent être constatés par les tests ou sur le matériel désigné.

## 3. Phase 0 — fiabilisation immédiate

**Priorité : P0 séance.** Cette phase constitue le prochain chantier de développement.

| ID | Travail | Critère de sortie | État |
|---|---|---|---|
| R0-01 | Supprimer la zone morte des pressions immobiles entre le tap court et l'appui long | Aucune pression immobile de 150 à 500 ms n'est ignorée ; un tap joueur reste un tap et l'appui long MJ conserve sa protection contre les faux contacts | **Fait le 07/08/2026** |
| R0-02 | Donner un retour aux destinations refusées ou occupées | Un geste valide ne semble plus être perdu ; le retour reste transitoire et ne crée pas d'interface permanente côté joueurs | **Fait le 07/08/2026** |
| R0-03 | Rendre le mode local indépendant du CDN Firebase | Firebase est chargé dynamiquement uniquement quand il est requis ; un test navigateur démarre et joue une session locale avec les requêtes CDN bloquées | **Fait le 07/08/2026** |
| R0-04 | Corriger la navigation du panneau MJ | Aucun débordement horizontal à 1280 px et 1024 px ; les outils restent accessibles ; les onglets exposent `tablist`, `tab`, `aria-selected` et un focus visible | **Fait le 07/08/2026** |
| R0-05 | Retirer les interpolations HTML non fiables | Les noms de niveau, avertissements, erreurs d'import et libellés distants sont rendus par nœuds DOM ou `textContent` | **Fait le 07/08/2026** |
| R0-06 | Retirer les caractères de contrôle de `panel.js` | Le fichier ne contient plus de NUL/SOH littéraux et reste correctement parcouru par les outils de recherche | **Fait le 07/08/2026** |
| R0-07 | Réconcilier le statut du lot 2 et créer cette feuille de route | Le CdC, `ETAT.md`, `PLAN-LOT2.md` et les briefs concernés indiquent 13/13 | **Fait le 07/08/2026** |

### Porte de sortie R0

- [x] Typecheck, 289 tests unitaires et 142 tests navigateur réussissent ; seuls les 2 scénarios
      Firebase réels restent conditionnés par le secret CI.
- [x] `pnpm run test:manuel` réussit ses 3 gestes.
- [x] Un test avec CDN bloqué prouve le démarrage et un déplacement en session locale.
- [x] Le panneau MJ ne déborde plus aux deux largeurs de référence.
- [x] Les scénarios tactiles existants ne régressent pas, en particulier les portes déjà validées.

**Phase R0 fermée le 07/08/2026.** Le retour Canvas des destinations refusées dure 650 ms ; sa
durée et son contraste rouge/ambre restent à observer lors de la prochaine séance, sans rouvrir la
phase sauf si l'usage réel montre une ambiguïté.

## 4. Phase 1 — exploitation et sécurité avant la 1.0

**Priorité : P0 1.0.** Cette phase peut commencer en parallèle des validations matérielles, mais
doit être terminée avant d'étiqueter une 1.0.

| ID | Travail | Critère de sortie | État au 07/08/2026 |
|---|---|---|---|
| R1-01 | Ajouter une rétention automatique au canal RTDB `events` | Une session active conserve seulement la fenêtre utile ; les événements expirés ne s'accumulent plus sans limite | **Code fait** — barrière `joining`, curseurs ACK et suppression transactionnelle par lots de 32 ; validation Firebase réelle à constater |
| R1-02 | Ajouter le ménage des anciennes sessions | Un outil borné liste puis purge explicitement une session choisie ; aucune suppression globale implicite | **Fait** — inspection de 1 à 20 identifiants explicites, dry-run par défaut, confirmation et purge transactionnelle ; aucune énumération globale |
| R1-03 | Versionner les règles Firebase | Les règles RTDB et Firestore vivent dans le dépôt et des tests négatifs prouvent les refus d'accès | **Fait le 08/08/2026** — cible émulateurs verte contre les vrais moteurs, puis règles déployées sur le projet `rpg-map-display` ; `.firebaserc` versionné rend la commande reproductible |
| R1-04 | Mesurer la taille persistée d'une campagne | L'interface ou le store avertit avant la limite Firestore ; la taille encodée réelle est testée, pas seulement estimée | **Fait** — JSON UTF-8 mesuré, taille logique Firestore calculée, avertissement 750 Kio et refus 900 Kio |
| R1-05 | Décider le schéma de persistance multi-étages | Si trois scènes denses approchent 1 Mio, un schéma v3 sépare les métadonnées et les étages avant la fin du lot 3 | **Décision faite** — ADR-012 impose v3 avant R3-02 ; implémentation rattachée au lot 3 |
| R1-06 | Publier une arborescence contrôlée | GitHub Pages reçoit un dossier `_site` construit par liste blanche, sans tests, briefs, scripts ni sources UVTT | **Fait** — paquet déterministe de 82 fichiers et smoke test navigateur depuis `_site` |
| R1-07 | Fermer le sujet des licences | Les cartes publiées sont autorisées et les attributions requises sont accessibles depuis l'application | **Fait pour le paquet actuel** — icônes, sources, auteurs, licence et modifications publiés ; cartes/portraits exclus faute de droits documentés |
| R1-08 | Renforcer la CI | Les gestes manuels deviennent bloquants après stabilisation ; la cohérence des modules CDN est vérifiée régulièrement | **Fait, constaté le 08/08/2026** — premier run GitHub complet vert : `verify` en 2 min 28 s puis `build` et `deploy` |
| R1-09 | Protéger les quotas Firebase | Les restrictions d'origine et d'API sont vérifiées dans la console du projet | **Tranché le 08/08/2026** — domaines d'authentification nettoyés, clé restreinte de 25 à 6 APIs ; origine et plafonds de quota **écartés sciemment**, raison et conditions de réouverture ci-dessous |

### Détails et limites R1

- Une lease RTDB `joining` est créée avant la lecture initiale du flux. La rétention automatique
  et la purge explicite utilisent une transaction au niveau de la session : une arrivée ou un ACK
  concurrent force une nouvelle évaluation, sans fenêtre « contrôler puis supprimer ».
- L'outil de ménage n'invente pas une liste globale que les règles actuelles ne permettent pas de
  lire. Il inspecte au plus 20 identifiants connus ; une console d'administration globale serait
  un chantier distinct avec des droits distincts.
- La mesure reproductible donne 302 918 octets prudents pour `testbig150` et 904 038 octets pour
  trois étages synthétiques. La migration v3 est donc requise avant la campagne réelle R3-02.
- `pnpm run test:firebase-rules` utilise les vrais émulateurs dans un projet `demo-*`. Le poste
  courant n'a pas Java 21 ; la CI l'installe et rend cette cible bloquante. **Elle a tourné pour la
  première fois le 08/08/2026 et elle est verte** : les refus et autorisations sont désormais
  exercés contre les moteurs de règles réels, et non plus seulement contre des tests statiques.
- ⚠ **Le premier run a d'abord échoué, et sur une cause qu'aucune vérification locale ne pouvait
  attraper.** `pnpm install --frozen-lockfile` sortait en code 1 sur `ERR_PNPM_IGNORED_BUILDS`
  pour `re2@1.26.1`, dépendance **optionnelle** de `superstatic` tirée par le `firebase-tools`
  ajouté ici. Son `engines` l'exclut du poste Windows et l'inclut sur le runner Node 24 : la même
  commande était donc verte en local et rouge en CI. `re2` est désormais **explicitement refusé**
  dans `allowBuilds` — `superstatic/lib/utils/patterns.js` le charge dans un `try/catch` et se
  replie sur la `RegExp` native, et ces motifs ne servent qu'à l'émulateur *hosting*, que cette
  cible ne démarre pas. Construire un module natif dont rien ne dépend, pour faire taire une
  erreur d'installation, aurait été le mauvais sens.
- Le paquet public ne contient provisoirement aucune carte ni aucun portrait. Un contenu ne pourra
  entrer dans la liste blanche qu'avec provenance, droit de diffusion et attribution documentés.

### Porte de sortie R1

- Une session ne peut plus faire grossir son historique indéfiniment.
- Une campagne trop grande est refusée ou répartie avant l'écriture Firestore.
- Les règles et leurs tests appartiennent au même changement que le code qui les requiert.
- Le contenu du site publié est explicite et licencié.

### Arbitrage R1-09 — ce qui a été écarté, et pourquoi

Décidé par le mainteneur le 08/08/2026, après avoir séparé ce que chaque mesure protège vraiment.

**Fait :** domaines autorisés nettoyés dans Firebase Authentication — `localhost` retiré ; clé Web
restreinte de **25 APIs à 6** dans Google Cloud Console : Cloud Datastore, Cloud Firestore, Cloud
Logging, Firebase Management, Identity Toolkit, Token Service. La liste se déduit des imports réels :
les trois pages ne chargent que `firebase/app`, `auth`, `database` et `firestore`, sans Analytics —
la configuration ne porte aucun `measurementId` — ni Storage, ni Messaging, ni App Check.

**Écarté sciemment :** la restriction d'origine et les plafonds de quota. Trois raisons, dans
l'ordre de poids :

1. ⭐ **La restriction d'origine n'a jamais gardé les données.** La clé Web *identifie* le projet,
   elle n'*autorise* rien : la barrière est la liste blanche des règles, déployée le même jour. Le
   seul scénario qu'une restriction d'origine empêche est qu'un tiers consomme le quota
   d'authentification depuis son propre site — un déni de service, pas une fuite.
2. ⚠ **Elle casserait les séances.** Le paquet publié ne contient aucune carte, faute de droits
   documentés (R1-07). Une vraie séance se sert donc en local par `pnpm run serve`, et la tablette
   rejoint le poste par une adresse `http://192.168.x.x:port` qui ne correspond à aucun motif
   HTTPS. Restreindre l'origine aujourd'hui reviendrait à refuser la connexion Google à la table.
3. **Les plafonds de quota ne valent rien sans compte de facturation** : le palier gratuit est déjà
   un plafond dur. Ce qui garde de la valeur dans cette section est l'alerte et le test de bout en
   bout, pas le réglage d'un plafond sous un plafond.

**Ce qui rouvrirait la question**, et il faut le relire avant d'y toucher : activer un compte de
facturation, ou publier des cartes licenciées qui feraient de GitHub Pages la voie de diffusion
réelle des séances. Tant que la table joue depuis un serveur local, la restriction d'origine coûte
plus qu'elle ne protège.

**Contrôle attaché à la partie faite** : le passage de 25 à 6 APIs est un changement qui peut casser
l'outil sans prévenir. Le signal est `API_KEY_SERVICE_BLOCKED` dans la console du navigateur, la
propagation prend jusqu'à 5 minutes, et le test est une connexion Google, une écriture Firestore et
un aller-retour RTDB depuis l'URL réelle. Les deux APIs les plus susceptibles de manquer sont
*Realtime Database Management* et *Firebase Rules* ; le document de procédure prescrit déjà de ne
les rajouter que sur un blocage constaté, jamais par précaution.

### Porte de sortie R1 — état au 08/08/2026

**Trois items sur quatre sont tombés.** Le premier run CI avec émulateurs est constaté et vert,
`build` et `deploy` compris ; les règles versionnées sont déployées sur le projet réel ; R1-09 est
tranché ci-dessus.

**Il reste un seul constat : valider la rétention sur deux vrais clients Firebase.** ⭐ Il se greffe
sur la séance tablette, phase 8, où la tablette et le poste MJ **sont** les deux clients demandés —
plutôt que d'en faire un rendez-vous séparé.

Le déploiement des règles le conditionnait : il fallait que les règles publiées soient celles du
dépôt pour que cette validation prouve quoi que ce soit. C'est fait.

## 5. Phase 2 — performance et endurance

**Priorité : P1, avant les lumières du lot 3.**

| ID | Travail | Critère de sortie | État au 07/08/2026 |
|---|---|---|---|
| R2-01 | Remplacer les clones complets par un snapshot de rendu stable | L'accès aux données nécessaires à une image reste sous 2 ms sur `testbig150` dans la mesure de référence | **Fait** — 0,0002 ms/image en médiane, pire lot 0,0005 ms dans la suite complète |
| R2-02 | Séparer les mesures par couche | Les coûts du store, de la vision, du fog, du fond et des pions sont rapportés séparément | **Fait** — sonde passive MJ et joueurs, accessible sur tablette par `?probe=1` |
| R2-03 | Revalider le décodage froid du fond | Après deux minutes d'inactivité sur la tablette, la couche de fond repasse sous le seuil fixé par le chantier P | **Outillé, mesure ouverte** — protocole sans timer et sonde tactile prêts ; constat tablette `< 5 ms` requis |
| R2-04 | Clarifier la mesure multipage | La sonde ne confond plus latence de rendu et throttling `requestAnimationFrame` d'un onglet en arrière-plan | **Fait** — mesure branchée sur la vraie `FrameLoop` ; présentation masquée qualifiée non mesurable |
| R2-05 | Réaliser l'essai cast de 45 minutes | Framerate, température, Wake Lock, plein écran et reprise après veille sont consignés | **Protocole fait, essai ouvert** — journal et rapport remplissable prêts |
| R2-06 | Réaliser l'essai longue durée | Une séance de quatre heures ne produit ni ralentissement bloquant ni dérive thermique dangereuse | **Protocole fait, essai ouvert** — relevés prévus jusqu'à 240 min |

### Porte de sortie R2

Le moteur dispose d'une marge mesurée avant l'ajout de nouvelles sources de vision. Aucun changement
de renderer, de framework ou de transport n'est entrepris sans un profil montrant qu'il répond au
goulot réellement observé.

### Relevé R2-01

`getRenderSnapshot()` est l'accès réservé à une image : il partage la campagne, l'étage actif et le
pion sélectionné gelés avec le store, et recrée seulement une `Map` de cases atteignables rendue non
mutable. L'instantané est mis en cache jusqu'à la prochaine notification du store. Les accesseurs
historiques (`getState()`, `getCampaign()` et `getActiveLevel()`) conservent leurs copies figées pour
leurs appelants existants.

La mesure reproductible est `node --test tests/store.test.mjs`, test `MESURE R2-01`. Elle charge
`maps/generated/testbig150.scene.json`, chauffe l'accès, puis mesure neuf lots de 1 000 lectures des
données utilisées par `renderAll`. Relevé du 07/08/2026 dans la suite complète : médiane
**0,0002 ms/image**, pire lot **0,0005 ms/image** (seuil : `< 2 ms`). C'est une mesure du chemin
d'accès au store, pas des couches Canvas, du fog, du fond, ni d'un essai d'endurance ; ceux-ci
restent respectivement R2-02 à R2-06.

### Instrumentation et validations physiques R2-02 à R2-06

La sonde de frame sépare désormais store/snapshot, vision, fond, grille, portes, pions, fog,
autres couches, total et résidu. Elle ne demande aucune frame et ne se rafraîchit jamais sur une
minuterie. Côté joueurs, `player.html?probe=1` l'ouvre après la première image ; toucher l'encart
actualise seulement les valeurs déjà enregistrées. La vision autoritaire reste mesurée côté MJ,
hors de `requestAnimationFrame`, puis rattachée une seule fois à l'image suivante.

La sonde multipage écoute la fin de la vraie `FrameLoop`. Elle rapporte séparément l'attente rAF
et qualifie toute présentation passée par un onglet masqué comme non mesurable, au lieu d'attribuer
le throttling du navigateur aux couches Canvas.

`docs/PROTOCOLE-ENDURANCE.md` et `docs/RAPPORT-ENDURANCE.md` encadrent le silence de 120 s, l'essai
cast de 45 min et la session de 4 h. L'outil n'invente ni température, ni état Google Cast, ni preuve
d'un Wake Lock : ces constats sont saisis manuellement sur l'appareil cible.

⭐ **Depuis le 08/08/2026, l'ordre exécutable est unique** : `docs/SEANCE-TABLETTE.md` fusionne ces
protocoles en une seule séance et y ajoute R3-05 et R1-01, absents des deux documents précédents.
Le découpage précédent coûtait trois soirées pour une, R2-06 contenant R2-05, qui contient le
silence de R2-03. `PROTOCOLE-ENDURANCE.md` garde la méthode et les limites de chaque mesure.

**Porte R2 non fermée au 07/08/2026.** R2-01, R2-02 et R2-04 sont acquis côté code et tests.
R2-03, R2-05 et R2-06 exigent encore les trois campagnes matérielles décrites ci-dessus ; leur
outillage ne vaut pas verdict physique.

## 6. Phase 3 — terminer le lot 3

| ID | Travail | Critère de sortie | État au 07/08/2026 |
|---|---|---|---|
| R3-01 | Créer l'éditeur de liaisons | Le MJ pose, associe, oriente et supprime deux extrémités sans éditer le JSON | **Fait** — extrémités sur deux étages distincts, sens unique, `gmOnly`, sélection, suppression et rendu MJ/joueurs |
| R3-02 | Créer une campagne réelle à trois étages | Les trois étages s'importent, se sélectionnent et persistent sans alignement manuel | **Partiel** — persistance Firestore v3 transactionnelle et fixture synthétique trois étages acquises ; trois cartes réelles licenciées manquent encore |
| R3-03 | Tester le parcours multi-étages de bout en bout | Téléportation, suivi de la vue, cadenas et fog indépendant sont vérifiés dans un même scénario | **Fait** — scénario deux pages, trois niveaux déclarés, traversée, suivi, cadenas, fog distinct et restauration après F5 |
| R3-04 | Implémenter l'ambiance et les lumières fixes | Les sources UVTT et l'ambiance de niveau alimentent la vision sans fuite aux angles | **Fait côté code et tests** — modèle binaire, sources bornées et occultées par le sweep commun |
| R3-05 | Implémenter `emitsLight` | Déplacer un pion lumineux met à jour la vision dans le budget accepté | **Code fait, mesure matérielle ouverte** — republication sans `rAF` prouvée ; ⚠ le cadrage « budget tablette » était faux, voir ci-dessous |
| R3-06 | Traiter `baked_lighting` | Une carte déjà éclairée est signalée et ne reçoit pas un second assombrissement incohérent | **Fait** — pleine ambiance forcée, avertissement MJ visible et réglage désactivé |

### ⚠ Correction de cadrage sur R3-05, relevée le 08/08/2026

Ce tableau demandait « le budget tablette » pour une mutation lumineuse. **C'est le mauvais monde.**
La vue joueurs ne calcule aucune vision : elle décode un masque PNG publié par le MJ
(`js/app/player.js`, aucun appel de sweep ; la vision autoritaire est chronométrée dans
`js/app/gm.js`). Le coût du sweep se paie donc sur la machine qui porte la vue MJ, pas sur la
tablette.

La mesure se sépare en deux, et les deux comptent :

- **le calcul**, sur le poste MJ — colonne `Vision` de la sonde, ouverte par la touche `P` sur
  `gm.html` ; l'écart entre un déplacement ordinaire et celui d'un pion `emitsLight` est le coût
  propre de la lumière ;
- **la réception**, sur la tablette — colonnes `Fond`, `Fog` et `Pions` de `player.html?probe=1`,
  la colonne `Vision` y restant vide par construction.

⭐ C'est la même classe d'erreur que la « grosse latence » du 7 août, mesurée sur un transport de
test au lieu du réseau réel : une mesure prise dans le mauvais monde ne se dénonce pas toute seule.
Le protocole corrigé est la phase 6 de `SEANCE-TABLETTE.md`.

**Dépendances obligatoires :** R1-04/R1-05 pour la taille Firestore, puis R2-01 pour la marge de
performance. Le schéma v3 décidé par l'ADR-012 est désormais implanté : parent léger, documents
par étage et pion, révisions cohérentes et écriture transactionnelle.

**Porte R3 non fermée au 07/08/2026.** Le comportement automatisable porte le lot à 5 critères sur
6. Il reste à importer trois vraies cartes autorisées, puis à relever sur la tablette cible le coût
d'une mutation lumineuse représentative. Une fixture synthétique et un profil de bureau ne valent
ni campagne jouée, ni verdict matériel.

## 7. Phase 4 — contenu et confort de table

| ID | Travail | Critère de sortie |
|---|---|---|
| R4-01 | Peupler la bibliothèque de pions | Un ensemble minimal de PJ et PNJ récurrents est disponible sans recréation manuelle |
| R4-02 | Livrer une campagne de référence | Une campagne multi-étages documentée sert à la fois de démonstration, de test et de partie réelle |
| R4-03 | Clarifier les cases occupées | Une destination occupée n'est plus présentée comme atteignable sans expliquer la règle appliquée |
| R4-04 | Regrouper les outils MJ par tâche | Contenu, terrain, visibilité, effets et réglages sont identifiables sans parcourir neuf onglets plats |
| R4-05 | Améliorer l'accessibilité MJ | Navigation clavier, focus, contrastes et libellés sont testés sur les contrôles hors canvas |

⭐ **R4-03, R4-04 et R4-05 sont briefés dans `docs/CHANTIER-T-ERGONOMIE-MJ.md` (08/08/2026).** Le
brief corrige deux intitulés de ce tableau : le panneau compte **dix** onglets et non neuf depuis
l'ajout des liaisons par le lot 3, et le regroupement en cinq familles laisserait **trois familles
à un seul membre** — donc un clic de plus sans rien regrouper. Il relève aussi que « expliquer la
règle appliquée » suppose une règle d'occupation qui **n'existe pas** : `computeReachable` ne reçoit
aucun pion. Trois décisions de table sont à trancher avant de coder.

Les marqueurs et les portes ne sont plus des critères ouverts : leur lisibilité, leur réponse sous
300 ms et l'ouverture tactile du premier coup sont des acquis à protéger contre les régressions,
pas des travaux à replanifier.

## 8. Phase 5 — lot 4, hexagone et outils de table

### Décisions préalables obligatoires

1. Orientation des hexagones et système de coordonnées.
2. Convention des grandes créatures sur plusieurs hexagones.
3. Format source et accrochage des murs hexagonaux.
4. Comportement attendu lors de la coexistence d'étages carrés et hexagonaux.

Après seulement :

- implémenter `HexGrid` derrière `GridAdapter` ;
- ajouter hit-test, mouvement et murs hexagonaux ;
- ajouter mesure et ping sans casser le Zero-UI ;
- conserver l'undo du fog déjà acquis ;
- étendre les tests géométriques et tactiles aux deux types de grille.

## 9. Phase 6 optionnelle — vidéo

Le support vidéo n'est pas un préalable aux lots 3 ou 4.

1. Prototype 1080p représentatif avec cast actif pendant 45 minutes.
2. Mesure du framerate, de la mémoire et de la température.
3. Si le fond vidéo échoue, limiter le produit à des `animatedOverlays` bornés.
4. Ne concevoir l'API durable qu'après le verdict matériel.

## 10. Choix technologiques

### Choix conservés

- Canvas 2D et rendu à la demande.
- JavaScript natif, modules ES et vérification JSDoc/TypeScript.
- Firebase à court terme.
- Images WebP statiques publiées avec l'application.
- `node:test` et Playwright.
- Modèle de confiance de la table, sans moteur de règles ni propriété individuelle des PJ.

### Choix à trancher par une mesure

- Snapshot Firestore unique ou schéma v3 réparti : tranché par la taille d'une vraie campagne à
  trois étages.
- Ajustement du renderer : tranché uniquement si le snapshot stable et les profils montrent encore
  un dépassement du budget.
- Vidéo ou overlays : tranché par l'essai cast de 45 minutes.
- Grille hexagonale : tranchée après fixation de la convention géométrique et des sources.

### Choix explicitement écartés à ce stade

- Migration vers React ou un autre framework frontal.
- Retour à PixiJS ou passage WebGL sans profil démontrant le besoin.
- Remplacement de Firebase par un serveur local tant que la latence réelle reste dans les seuils.
- Ajout d'un bundler applicatif uniquement pour publier : une copie `_site` par liste blanche suffit.

## 11. Définition de « prêt pour la 1.0 »

La 1.0 peut être annoncée lorsque :

- R0 et R1 sont entièrement fermées ;
- la suite automatisée et les gestes critiques bloquent les régressions ;
- une session locale fonctionne sans CDN ;
- les événements ont une rétention automatique ;
- une campagne ne peut pas dépasser silencieusement la limite Firestore ;
- les règles Firebase sont versionnées et testées ;
- une campagne réelle à trois étages est jouable de bout en bout ;
- l'essai cast de 45 minutes est concluant ;
- le site publié ne contient que des fichiers nécessaires et correctement licenciés ;
- ✅ `ETAT.md` et le cahier des charges portent le même nombre de critères validés —
  **fait le 08/08/2026 : 34 sur 41**, après réconciliation des lots 1a et 1b, dont aucune case
  n'était cochée, et correction d'un « 10 sur 11 » qui nommait deux points ouverts sans appartenir
  au lot. Détail et règle de non-rechute dans `ETAT.md`, section « Réconciliation des décomptes ».

### Où en est cette liste au 08/08/2026

**Cinq conditions acquises, une partielle, quatre manquantes.** Acquises : régressions bloquées par
la CI, session locale sans CDN, plafond Firestore, règles versionnées et déployées, site licencié,
et désormais la concordance des décomptes. Partielle : la rétention existe en code, sa validation
sur deux vrais clients non. Manquantes : la fermeture de R1, la campagne réelle à trois étages et
l'essai cast de 45 minutes.

⭐ Les trois manquantes tombent avec **une soirée de séance** et **un sujet de droits d'image**.
Aucune n'attend du développement.

## 12. Ordre d'exécution recommandé

1. Phase 0 complète.
2. R1-04/R1-05 et R2-01, qui conditionnent directement le lot 3.
3. Reste de la phase 1, puis validations matérielles de la phase 2.
4. Lot 3.
5. Contenu et confort de table.
6. Lot 4.
7. Vidéo, seulement si elle reste souhaitée après le prototype.
