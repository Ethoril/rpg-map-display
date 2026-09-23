# PLAN DE CORRECTION — audit du 22/09/2026

Audit en lecture seule de tout `js/`, des tests et de l'outillage, en six relectures parallèles,
les constats graves recoupés à la main. Ce document est le **plan de reprise** : si le travail
s'interrompt, on reprend à la première case non cochée de l'ordre du §2.

## 1. Méthode, pour chaque correctif

1. **Reproduire d'abord** : un test qui échoue sur le code actuel, et qui mute l'**effet**, pas un
   drapeau. Sans rouge observé, le correctif n'est pas commencé.
2. Corriger au plus petit. Aucun fichier hors manifeste (`ARCHITECTURE.md` §1).
3. **Muter** : casser le correctif, voir le test rougir, restaurer.
4. `pnpm run verify` vert, puis commit et push par groupe cohérent.
5. Cocher ici, avec le hash du commit.

⚠ **Jamais deux e2e Playwright en même temps** : ils se battent pour le port 4173, et c'est
ce qui a produit les « échecs intermittents » pendant l'audit. Un verifier qui mute travaille
en `worktree`, jamais dans l'arbre partagé.

⛔ **Points d'arrêt** : les lignes marquées **[DÉCISION]** ne se codent pas avant l'arbitrage
du mainteneur. Elles sont reportées dans `QUESTIONS-EN-ATTENTE.md` au moment de les atteindre.

Légende : ✅ confirmé à la lecture · ❔ plausible, à reproduire avant de corriger.

## 2. Ordre de priorité

### P0 — ce que la table voit de faux, ou des données perdues

- [x] **A1** `26dc8d1` ✅ Fog et lumière décalés quand la grille a un décalage. Le masque couvre
  `widthCells` cases depuis l'origine de la grille, mais il est posé en `(0,0)` et étiré sur
  `mapExtent()`, décalage compris. Les joueurs voient jusqu'à une demi-case au-delà d'un mur.
  `fogLayer.js:630`, `light.js:745,756,769`. Test : un étage à `offsetX: 70`.
- [x] **A2** `23e8fd9` ✅ Le repli localStorage efface la sauvegarde. Le transport écrit l'enveloppe
  `{campaign, activeLevelId…}` sous `rpg_campaign_<id>` (`FirebaseTransport.js:1609`), là où le
  store écrit la campagne nue (`store.js:315`). Au F5 sans Firestore, rien n'est restauré,
  puis `removeItem`. Correctif : une seule forme sous cette clé, et une lecture qui tolère
  les deux formes déjà écrites chez les utilisateurs.
- [x] **A3** `44c1ae1` ✅ Au réveil, la tablette rebascule sur l'étage du MJ. `player.js:904` omet
  `activeLevelId: lireEtageMemorise()`, contrairement au démarrage (`:837`).
- [x] **A4** `c7b18cc` ✅ Zone de déplacement périmée. `updateToken` (vitesse, taille), `updateLevel`
  (grille) et `addLevel` en remplacement ne rappellent pas `setSelectionState`
  (`store.js:1485`, `:1051`, `:927`). La tablette accepte un coup à 6 cases pour un pion
  passé à 3.
- [x] **A5** `44c1ae1` ✅ La tablette écrit toute la campagne dans Firestore à chaque mutation locale,
  avec son `activeLevelId` et son `selectedTokenId` (`player.js:691-703`, `:773-775`). Au F5
  du MJ, celui-ci atterrit sur l'étage de la table : violation de la règle 4. Le dernier qui
  écrit le document gagne. Direction : le MJ est seul à persister (CdC §114). ⚠ Vérifier
  d'abord dans l'historique git si l'écriture tablette sert un cas voulu (MJ absent ?).
  Si c'est le cas → **[DÉCISION]**.
- [x] **A6** `48a1907` ❔ L'aperçu UVTT de diagnostic écrit dans la campagne (`importPanel.js:275-283`,
  alors que le commentaire dit le contraire). L'identifiant est dérivé du nom de fichier :
  glisser l'UVTT d'une carte déjà préparée **remplace le vrai étage** par un étage sans
  image, sans aucun `level.add` publié. Pas de borne de taille sur `readAsText`.

### P1 — gestes MJ et tablette

- [x] **B1** `5f1faaa + 896421e` ✅ Un pion lâché sur une case occupée : l'exception de `moveTokenToCell`
  (`gm.js:1762`) sort de `handlePointerUp` avant `activePointers.delete`
  (`pointer.js:491-546`). L'automate reste en `gmTokenDrag` et un pion fantôme suit la
  souris. Deux correctifs : refuser proprement dans `gm.js` (comme `bootstrap.js` avec
  `findStackingConflict`), et nettoyer le pointeur dans un `finally`.
- [x] **B2** `5f1faaa` ✅ Pas de `setPointerCapture` sur le canvas (`pointer.js:125-132`). Relâcher
  au-dessus du panneau laisse le glisser ou le pan actif au survol.
- [x] **B3** `5f1faaa` ✅ `pointercancel` n'émet `end` que pour le pinceau et le gabarit, et le blur
  n'émet rien (`pointer.js:564-604`). Les aperçus pion et lampe restent dessinés, et un
  gabarit déplacé n'est jamais publié.
- [x] **B4** `896421e` ✅ Glisser de gabarit, MJ (`gm.js:1847-1866`) et tablette
  (`bootstrap.js:54-101`) :
  - il mute le store à chaque `pointermove` (clone, validation, localStorage, panneau,
    instantané Firebase avant le `pointerup`) ;
  - la phase `end` publie l'avant-dernière position ;
  - sur la tablette, un second doigt pendant le glisser n'émet jamais `end`
    (`pointer.js:283-298`).
  Direction : un aperçu comme pour les pions, une seule mutation et une seule publication
  au `end`.
- [x] **B5** `5f1faaa` ✅ Passer de deux doigts à un fait sauter la carte : le doigt restant repart
  avec l'origine du premier (`pointer.js:320-342`, `548-557`).
- [x] **B6** `896421e` ✅ `view.change` part sans limite de fréquence (`gm.js:1384-1405`), avec un
  `persistCamera` à chaque événement. `VIEW_PUBLISH_HZ = 10` n'est lu nulle part.
  ⚠ L'audit rapporte que le CdC §7 désigne la tablette comme émettrice : vérifier qui doit
  émettre avant de limiter. En cas de contradiction → **[DÉCISION]**.
- [x] **B7** `2b61fa5` ✅ L'éditeur de murs convertit lui-même, avec une origine forcée à `(0,0)` et
  l'échelle X seule (`gm.js:1556-1565`, `wallEditor.js:52-55`, `126-133`). Sur un étage
  décalé ou hexagonal, l'accrochage tombe à côté du mur dessiné. Passer par `grid.*`.
- [x] **B8** `375f93a` ❔ Le panneau entier se reconstruit à chaque notification, y compris fog et
  vision, soit environ 1 Hz (`panel.js:1954-1965`). Les statuts de `tokenMaker` sont effacés,
  et un clic tombé entre une reconstruction et la suivante est perdu (`templateTools.js:167`,
  `panel.js:1219`). À l'inverse, `linkEditor.refresh` n'est jamais appelé sur une mutation.
- [x] **B9** `ceafc11` ✅ Le bandeau « Connexion impossible » ne s'efface jamais : `transportError`
  n'est jamais remis à `null` (`versionBadge.js:92/103/116`, `413/424/437`). Il masque aussi
  l'alerte de version.
- [x] **B10** `ceafc11` ❔ Chaque `resize` de la vue joueurs recadre la caméra sur la carte entière
  (`player.js:974`), y compris le passage en plein écran au premier geste. Le zoom de la
  table est perdu. Intention non documentée : par la règle 4, on garde la caméra.

### P2 — réseau et persistance

- [ ] **C1** ✅ La purge automatique des événements ne supprime jamais rien : le callback de
  la transaction rend `undefined` sur un cache local nul, ce qui l'annule
  (`FirebaseTransport.js:1408`). `events` grossit sans fin. ⚠ Deux conséquences :
  - la cause notée dans `ETAT.md` pour la désynchro du 16/08 ne tient plus ;
  - le correctif naïf (rendre `current`) retélécharge la session entière.
  → **conception d'abord** : purger `session/{id}/events` seul, par requête bornée. Si cela
  change le protocole → **[DÉCISION]**.
- [x] **C2** `fada46f` ✅ `setSessionFog` et `setSessionVision` notifient les abonnés, et chaque
  notification réécrit toute la campagne dans localStorage, validation comprise
  (`store.js:2187`, `:2211`). Séparer la notification « session » de la persistance.
- [ ] **C3** ❔ Deux déplacements concurrents vers la même case : `moveTokenToCell`,
  `token.add` et `level.grid` lèvent sans `try` (`networkEvents.js:113`, `313`, `319`).
  L'erreur est avalée, et MJ et tablette divergent jusqu'au F5. Règle proposée : le MJ fait
  autorité, la tablette se recale sur l'état du MJ.
  ⏳ **Conception d'abord** (22/09) : un `try` seul ne suffit pas. Un refus côté MJ laisse la
  tablette sur sa position, et une correction exige une règle de recalage entre les postes.
- [ ] **C4** ❔ Démarrage hors ligne figé : `await onDisconnect().remove()`
  (`FirebaseTransport.js:1285`) ne rejette jamais, et aucun appelant ne pose d'échéance. Le
  repli local n'est jamais atteint.
  ⏳ **Conception d'abord** (22/09) : une échéance seule est dangereuse. Si la connexion
  aboutit après l'échéance, sur un Wi-Fi lent, le MJ passe en local sans le savoir, et ses gestes
  ne sont plus publiés. Il faut afficher l'état local, **puis adopter** le transport quand il
  répond.
- [ ] **C5** ❔ Une resynchro qui lève laisse le client sans écoute et sans nouvel essai
  (`:1132-1143`, `:1307`). La tablette castée ne se masque jamais, donc elle reste figée.
- [ ] **C6** ✅ Course sur `onDisconnect` : le `cancel()` de l'ancien filet, non attendu,
  annule le nouveau (`:1244`, `:2060`). Rien n'écoute `.info/connected` pour réarmer après
  une coupure : des présences fantômes restent.
- [ ] **C7** ✅ Chaque sauvegarde réécrit tous les documents Firestore (2 + étages + pions)
  et réencode la campagne environ six fois (`:1595-1661`). N'écrire que les documents qui
  ont changé. Supprimer le `measureFirestoreSnapshot` dont le résultat est jeté.
- [ ] **C8** ✅ Un accusé de réception RTDB par événement reçu, écho compris (`:1357-1361`).
  À regrouper sur le battement, une fois C1 réglé.
- [x] **C9** — **sans objet** : le transport ramène déjà les `at` à l'horloge locale à sa frontière (`FirebaseTransport.js:1881`). ❔ `presence.js:85` compare `Date.now()` local à des horodatages serveur : une
  horloge décalée de plus de 90 s rend toutes les présences périmées. Utiliser
  `serverTimeOffset`.
- [x] **C10** `fada46f` ❔ Les caches `sessionFogMap` et `sessionVisionMap` survivent à `resetStore`,
  `loadCampaign` et `setSessionId` (`store.js:2073-2075`). Le masque d'un étage de même
  identifiant peut revenir.

> ⏳ **État de P2 au 22/09.** C1, C5, C6 et C8 touchent au comportement du vrai SDK en cas de
> coupure, de reconnexion et de transaction. Aucun ne se prouve par un rouge sans une base
> Firebase réelle. Or les seuls tests de ce type (`firebaseTransport.spec.mjs`) ne tournent
> qu'en CI, avec le secret. Avant de les corriger, il faut un scénario rouge dans ce fichier,
> **sur une branche**, pour ne pas figer Pages (un `verify` rouge bloque le déploiement).
> - **C1** : on ne sait pas trancher à la lecture. Une écoute active sous `session/{id}` peut
>   remplir le cache local ; dans ce cas, la purge télécharge toute la session au lieu de ne rien
>   faire. Le test doit mesurer les deux.
> - **C6** : le défaut d'ordre est certain (`resync` n'attend pas le `cancel()`, qui annule le
>   nouveau filet). Le correctif proposé : ne pas annuler le filet lors d'une resynchro, puisque
>   la nouvelle inscription porte sur le même chemin. Plus un réarmement sur `.info/connected`.
> - **C7** : n'écrire que les documents Firestore modifiés. Faisable sans réseau (diff pur), mais
>   il faut garder la transaction de révision : à concevoir avec ADR-012.

### P3 — la porte, là où elle ment

- [x] **D1** `5f1faaa` ✅ Faux vert sur l'interdiction n°1 (pas de drag joueur) : c'est le mock
  `mountStage.mjs:110-111` qui porte la garde `role === 'gm'`. Le mock doit répondre
  « oui » et laisser `pointer.js` refuser. Muter `pointer.js:259` pour prouver le rouge.
- [x] **D2** `6dec21d` ✅ `// @ts-nocheck` dans `js/app/sondeLatence.js:1`. Le typer, et ajouter un
  test d'architecture qui interdit `@ts-nocheck` et `@ts-ignore` dans `js/`.
- [x] **D3** `0f4eca3` ✅ `'px' + 'PerCell'` dans `templateHit.js:109` contourne le test : passer par la
  grille. Le test 1 doit attraper aussi la propriété calculée et les alias (`pxCell` dans
  `importPanel.js:415`). Aligner sa liste d'exceptions sur `ARCHITECTURE.md` §4.1
  (`gridPitch.js` et `importPanel.js` n'y figurent pas) → **[DÉCISION]** si l'un des deux
  doit rester en exception.
- [x] **D4** `6dec21d` ✅ Test 6 des imports (`architecture.test.mjs:142-190`) :
  - aucune branche pour `ui/*` ;
  - ré-exports non lus, chemins absolus et `import( '…')` ignorés ;
  - liste d'interdits au lieu d'une liste d'autorisés.
  Passer à la liste d'autorisés de `ARCHITECTURE.md` §2. Cela fera rougir
  `grid/* → movement/*` (voir H1).
- [x] **D5** `6dec21d` ✅ Test 5 du manifeste : le nom de base est cherché n'importe où, et seul
  `js/` est lu. Comparer le chemin complet, et lire aussi `scripts/` et `tests/`. Rougira
  sur quatre scripts et `tests/browserTestTransport.mjs` : les inscrire au manifeste ou les
  retirer → **[DÉCISION]** fichier par fichier si leur rôle n'est pas évident.
- [x] **D6** `6dec21d` ✅ Test 7 (CDN) : il ne cherche que jsdelivr et gstatic. Chercher toute URL
  `https://` dans un `import`.
- [x] **D7** `6dec21d` ✅ `check-deps` écrase la version de Firebase URL après URL
  (`check-deps.mjs:130-133`). Comparer chaque URL. Accepter aussi `type=module` sans
  guillemets (`:61`).
- [x] **D8** `6dec21d` ❔ En CI, les tests du vrai Firebase passent en `skip` silencieux si le secret
  manque ou si les variables d'émulateur changent de nom (`firebaseTransport.spec.mjs:106`,
  `144`, `firebaseRules.emulator.test.mjs:20`). Si `CI` est défini, échouer.
- [x] **D9** `6dec21d` ✅ `playerMaskPerformance.spec.mjs` « 2. Mesure » est une mesure sans
  assertion, dans la porte. La déplacer dans `tests/mesures/`.
- [x] **D10** `6dec21d` ✅ Test 9 contournable (`architecture.test.mjs:222-227`) : motif trop étroit,
  et `indexOf === -1` rend le test toujours vrai.
- [x] **D11** `6dec21d` ❔ `sondeLatence.js` n'est pas publié par `build-site.mjs:30-34`, alors que
  `docs/SONDE-LATENCE.md` le fait charger sur Pages : même famille qu'E-15.

### P4 — hexagonal et lumière

- [x] **E1** `d80b9f2` ✅ Caches de `LightLayer` périmés entre deux étages de tailles différentes : le
  compteur de révision repart à 2 et `invalidate()` n'est jamais appelé
  (`light.js:333-336`, `471`, `532`, `794`).
- [x] **E2** `6eb9516` ✅ Le halo d'une lampe part du coin de la case (`mapFromCellPoint`), alors que
  son marqueur et sa zone de tap sont au centre (`lightMarkers.js:69`, `lightHit.js:59`).
  Une lampe posée au tap (`gm.js:1590`) éclaire depuis le coin.
- [x] **E3** `792e367` ✅ Hexagonal : la visibilité d'un pion est testée sans le décalage de rangée
  (`fog.js:459-460`). Sur les rangées impaires, le point tombe sur l'arête : un PNJ visible
  disparaît côté joueurs.
- [ ] **E4** ✅ Hexagonal : le masque couvre `W` cases alors que les rangées impaires vont
  jusqu'à `W + 0,5`. Des bandes restent sans brouillard (`HexGrid.js:116-121` combiné avec
  `fogLayer.js:630`). À traiter avec A1.
  ⏳ Partiel (A1, `26dc8d1`) : la bande d'offset reçoit le voile. Les demi-cases hexagonales
  situées au-delà de `mapExtent` restent sans voile ; pour les couvrir, il faudrait élargir le
  masque d'une demi-case, ce qui touche sa taille (exception de CONVENTIONS §1).
- [ ] **E5** ✅ Hexagonal : l'aperçu de glisser soustrait `taille/2`, la convention du carré
  (`tokens.js:256-259`). L'interpolation en coordonnées décalées saute d'une demi-case
  (`:62-68`, `100`).
  ⏳ Reporté (22/09) : défaut cosmétique. Le corriger proprement exige une méthode de grille
  « ancrage dont le centre est ici », à ajouter à `GridAdapter`.
- [x] **E6** `792e367` ✅ La poignée de gabarit est dessinée 1,5 fois plus petite que sa zone de tap
  sur la tablette : `ctx.getTransform()` inclut `stage.resolution` (`templates.js:88`).
- [x] **E7** `62e4c08` (D-8 : ancrage seul en hexagonal) ✅ Les bornes d'un pion sont vérifiées en carré même en hexagonal
  (`schema.js:1133-1136`). Passer par `grid.cellsOccupied`.
  ⏳ **[DÉCISION]** : D-8.
- [ ] **E8** ✅ La migration L-10 convertit case → pixel dans `schema.js:208-212`, sans le
  décalage et en supposant le carré. Elle est masquée par la liste blanche du test 1. La
  faire passer par la grille.

  ⏳ Reporté (22/09) : cette migration ne touche que les documents antérieurs au 05/08, déjà
  migrés. La corriger demande de la sortir de `core/`, qui n'a pas accès à la grille.
### P5 — import et serveurs locaux

- [x] **F1** `dfbf365` ✅ UVTT (`uvtt.js`) :
  - portes (`:317`) et lumières (`:357`) testées avec `typeof`, donc `Infinity` passe ;
  - `map_origin` n'est pas validé (`:192-195`) et donne `NaN` ;
  - un `map_size` non entier (`:150`) passe en silence.
  Règle d'universalité : **avertir, jamais écarter en silence**.
- [x] **F2** `341157c` ✅ `decodeURIComponent` hors `try` dans `serve.mjs:63` et
  `prepare-server.mjs:651` : `GET /%E0` fait tomber le serveur.
- [x] **F3** `341157c` ❔ `prepare-server` n'a aucune protection contre les requêtes venues d'un autre
  site (`:164-181`, `603-650`) : il faut vérifier `Origin` et `Host`, et exiger
  `Content-Type: application/json`. Une requête rejetée pour sa taille doit aussi être
  détruite.
- [x] **F4** `dfbf365` ❔ `levelSelector.js:94` injecte un identifiant dans un sélecteur CSS sans
  l'échapper : utiliser `CSS.escape`.
- [ ] **F5** ❔ `tokenMaker.js:611` ajoute `/` devant une URL `https://`. Il n'y a pas
  d'`onerror` en `:300` (une image HEIC est ignorée sans message). `sceneLibrary.js:152`
  publie les étages bruts, et une boucle interrompue laisse un ajout partiel.

  ⏳ Partiel (`dfbf365`) : l'URL et l'`onerror` sont corrigés. Reste `sceneLibrary.js:152`, qui
  publie les étages bruts et laisse un ajout partiel si un `addLevel` lève en cours de boucle.
### P6 — coûts évitables

Aucun critère de performance n'est coché sans mesure sur la tablette. Ces lignes suppriment
un travail inutile, sans rien promettre de chiffré.

- [x] **G1** `cc5c668` `networkEvents.js:36` fait un `getCampaign()` (clone profond, 2,5 ms sur Mac) à
  chaque événement réseau.
- [ ] **G2** Chaque mutation valide deux fois, et `deepFreeze` parcourt tout l'arbre, murs
  compris. `getRenderSnapshot` copie deux fois les cases atteignables (`store.js:1900`).
  `structuredClone` est appliqué au résultat de `normalizeCampaign`, déjà une copie (`:416`,
  `:528`).
  ⏳ Non fait : valider deux fois et geler tout l'arbre touchent le contrat transactionnel du
  store. À mesurer avant d'y toucher.
- [x] **G3** `cc5c668` La couche gabarits reconstruit les segments et relance un sweep par gabarit à
  chaque image, pan compris (`templates.js:89`, `119`). Mettre en cache sur la signature.
- [x] **G4** `cc5c668` Vue joueurs : décodage du masque lancé jusqu'à quatre fois par image tant que le
  premier n'a pas abouti (`player.js:352`, `380`). Mémoriser la promesse.
- [x] **G5** `cc5c668` `path.js:73` : le budget `max(100, 4×distance)` explore toute la carte, avec une
  file linéaire. Borner par `speedCells`.
- [ ] **G6** Signatures de murs recalculées à chaque image ; `gridFor()` réalloue la grille à
  chaque image ; `HexGrid.renderGrid` n'est pas limité à la vue (`HexGrid.js:333-349`).
  ⏳ Non fait : à mesurer sur la tablette d'abord.
- [x] **G7** `cc5c668` ❔ Fond animé trop lent : le repli fait `display:none` sans `pause()`
  (`videoBackdrop.js:433-435`).
- [ ] **G8** Mineurs :
  - `devicePixelRatio` n'est lu qu'une fois (`stage.js:280`) ;
  - `?v=${Date.now()}` contourne le cache des icônes (`statusBadges.js:309`) ;
  - des `ImageBitmap` ne sont jamais fermés (`background.js:127-130`).

  ⏳ Non fait : mineurs.
### P7 — conformité et nettoyage

- [x] **H1** `62e4c08` (D-7 : table §2 amendée) ✅ `grid/*` importe `movement/reachable.js` (`SquareGrid.js:3`, `HexGrid.js:3`),
  interdit par `ARCHITECTURE.md` §2. `reachable.js:64-68` lit `grid.type` et calcule sur
  `a`/`b`. Il faut déplacer la règle « ne pas couper les coins » dans la grille.
  ⏳ **[DÉCISION]** : D-7, point 2.
- [x] **H2** `68808ba` ✅ Les étiquettes de `measure.js` (`:155-216`) et les murs (`walls.js:265`)
  ignorent le zoom : illisibles au zoom 0,2.
- [x] **H3** `68808ba` ✅ Le `...overrides` final de `createLevel` et `createCampaign` écrase les
  fusions de `grid`, `ambient` et `settings` (`schema.js:552`, `:406`).
- [x] **H4** `68808ba` ✅ Le calcul `gridScaleX/Y` est copié quatre fois dans `gm.js` (376, 556, 1349,
  1556). Le remplacer par une fonction de la grille ; lié à B7.
- [ ] **H5** Code mort (vérifié par grep dans `js/` et `tests/`) :
  - `shortestPath`, l'import `normalizeCampaignColors`, `TEMPLATE_ORIGIN_EPS` ;
  - `removePresence`, `signOut`, `FIRESTORE_DOCUMENT_LIMIT_BYTES` ;
  - les branches `_liveQuery` inatteignables ;
  - `transport.diagnosticCanal`, appelé par `diag.js:481` mais inexistant ;
  - `tokenAtCell`, `setRole`, `cancelDraft`, et six setters de `tokenMaker` ;
  - `Camera.convergeTo` et `Camera.rotation`, `edgesOf` ;
  - l'option `visibleAlpha` de `tokens.js` et l'option `visiblePolygons` de `fogLayer.js` ;
  - le champ `image` de `parseUvtt`, et deux `undefined` orphelins dans `prepare-maps.mjs`.
  Ce qui n'est utilisé que par les tests reste, sauf si le test ne teste que ce code.
  ⏳ Partiel (`68808ba`). Gardés à dessein : `edgesOf`, qui appartient à l'interface normative
  du §3 ; `Camera.convergeTo`, testé et utile au suivi de caméra ; les branches `_liveQuery`,
  défensives ; l'appel à `diagnosticCanal` dans `diag.js`, dont le comptage aiderait à trancher C1.
- [x] **H6** — **tranché le 23/09 : laissé tel quel** (D-9). **[DÉCISION]** Les règles Firebase accordent tout au compte technique sans
  `email_verified`, et ne séparent pas MJ et tablette (`database.rules.json:5-6`,
  `firestore.rules:11`). Domaine console du mainteneur.
- [ ] **H7** Faible : aucune CSP ni SRI sur les pages ; les actions CI sont épinglées par tag
  et non par SHA ; il manque un champ `packageManager` ; `forbidOnly` n'est actif qu'en CI.
  ⏳ Non fait : priorité basse.
- [x] **H8** — **sans objet** : `validateCampaign` impose `#RRGGBB` à `borderColor` et à la couleur des gabarits (`schema.js:1068`, `:1237`). Les couleurs venues du réseau vont telles quelles dans `cssText`
  (`panel.js:1228`, `templateTools.js:193`) : les valider.

## 3. Tranché pendant l'audit

- ✅ Les extrémités de liaison sont des `Cell` (commit `9538230`, `CONVENTIONS.md` §1).
- ✅ `Template.origin` et `ping.mapPos` restent en pixels : exceptions écrites, et le
  glissement des gabarits après un recalage de grille est assumé.

## 4. Journal

| Date | Lignes | Commit | Note |
|---|---|---|---|
| 22/09 | — | `9538230` | deux écarts de convention tranchés |
| 22/09 | A1 | `26dc8d1` | `maskRect()` ajouté à `GridAdapter` ; la bande hors masque reçoit le voile non exploré. ⚠ E4 n'est que partiel : les demi-cases hexagonales hors de `mapExtent` restent sans voile |
| 22/09 | A2, A4 | `23e8fd9`, `c7b18cc` | les lecteurs déballent aussi l'enveloppe déjà écrite chez les utilisateurs |
| 22/09 | A3, A5 | `44c1ae1` | le MJ mémorise son étage (`rpg_gm_level_<id>`). Qui écrit l'instantané : **D-5** |
| 22/09 | A6 | `48a1907` | refus explicite ; `onImportUvtt` n'est câblé nulle part, l'aperçu n'est donc jamais publié |
| 22/09 | B1–B5, D1 | `5f1faaa` | nouvelle phase `cancel` des glissers ; le mock ne porte plus la garde de rôle |
| 22/09 | B1, B4, B6 | `896421e` | pose de gabarit pure (`templateDragPose`) ; `view.change` à 10 Hz. Qui émet : **D-6** |
| 22/09 | B7 | `2b61fa5` | `snapWallVertex` et `findWallAt` prennent la grille |
| 22/09 | B8 | `375f93a` | rafraîchissements du panneau gardés par signature ; la liste des liaisons suit les étages |
| 22/09 | B9, B10 | `ceafc11` | une présence reçue efface l'erreur ; la caméra choisie par la table survit au `resize` |
| 22/09 | C2, C10 | `fada46f` | notification `{ session: true }` : ni sauvegarde locale, ni instantané Firestore pour un masque |
| 22/09 | D2–D11 | `6dec21d` | les écarts tolérés sont dans des listes d'attente explicites du test ; décisions en **D-7** |
| 22/09 | D3 | `0f4eca3` | `GridAdapter.cellPitch()` |
| 22/09 | E2 | `6eb9516` | une lampe posée stocke le CENTRE de sa case ; les lampes déjà posées gardent leur lumière, leur marqueur rejoint leur halo |
| 22/09 | E1 | `d80b9f2` | compteur de révision partagé par tous les `LightField` |
| 22/09 | E3, E6 | `792e367` | `isCellVisibleInMask(…, pavage)` ; la couche gabarits reçoit `camera.zoom` |
| 22/09 | F2, F3 | `341157c` | `tests/serveursLocaux.test.mjs` lance les vrais serveurs |
| 22/09 | F1, F4, F5 | `dfbf365` | `map_size` non entier arrondi au-dessus ; décision E7 en **D-8** |
| 23/09 | G1, G3–G5, G7 | `cc5c668` | aucun gain chiffré revendiqué : pas de mesure tablette |
| 23/09 | H2–H5 | `68808ba` | `createLevel` étale ses overrides en premier |
| 23/09 | D-5 à D-8 | `62e4c08` | arbitrages du mainteneur appliqués ; suivi de caméra supprimé (D-6) |
