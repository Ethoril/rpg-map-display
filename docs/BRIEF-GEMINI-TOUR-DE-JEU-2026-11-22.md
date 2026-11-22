# Brief Gemini — tour de jeu, portes et liaisons côté joueurs

> Chantier arbitré par le mainteneur le 22/11/2026, sept décisions prises par sélecteurs. Le
> **quoi** et ses 27 critères d'acceptation sont dans `docs/CADRAGE-TOUR-DE-JEU-2026-11-22.md`,
> le **comment** dans `docs/PLAN-TOUR-DE-JEU-2026-11-22.md`, le découpage dans
> `docs/TACHES-TOUR-DE-JEU-2026-11-22.md`. Ce brief est le document d'exécution : il porte, pour
> chaque tâche, la décision déjà prise, l'endroit exact où elle se branche et la preuve attendue.
> **Rien de ce qui est écrit ici n'est à redécider.**

Point de référence : `8b37de2` sur `main`. Vérifie le `HEAD` de ta copie avant de commencer et
conserve les changements déjà présents. Le chantier porte sur la **vue joueurs** ; la vue MJ ne
change que là où c'est dit explicitement.

## Règles de travail, non négociables

Les règles permanentes de `docs/BRIEF-GEMINI-CODE.md` §« Règles de travail » s'appliquent telles
quelles : une tâche à la fois dans l'ordre, rapport de trois lignes en fin de tâche, **zéro
commit** (tout reste en arbre de travail), arrêt obligatoire à chaque ⛔, `pnpm run verify` vert
avant le rapport — jamais `test:unit` seul —, et **preuve par mutation** sur toute assertion qui
porte un risque.

⚠ **Mute l'effet, pas l'étiquette.** Un test qui relève un drapeau au lieu du comportement passe
au vert sur une panne réelle. Ce dépôt a déjà attrapé douze faux verts de cette forme.

Les interdictions de `docs/CONVENTIONS.md` §8 qui mordront ici :

- **Aucun drag & drop de pion sur la vue joueurs.** Un doigt qui glisse est un pan de carte. Le
  drag tactile a été testé puis aboli ; le remettre est une régression.
- **Quatre espaces de coordonnées jamais mélangés**, et **aucune arithmétique `pxPerCell` hors
  `js/grid/*`**. Les conversions vers l'écran passent par `js/render/camera.js` et par lui seul.
- **Sur le réseau et en persistance ne circulent que des coordonnées de cellule.**
- **Rien n'est publié pendant un glisser MJ avant `pointerup`.**
- **Manifeste fermé** : aucun fichier créé s'il n'est pas listé au §1 d'`ARCHITECTURE.md`. Ce
  chantier n'ajoute **aucun fichier sous `js/`** — si tu crois en avoir besoin, c'est un ⛔.

## Les sept décisions du mainteneur, déjà prises

1. **Une liaison se prend par un bouton**, jamais automatiquement en fin de mouvement. Une case
   d'escalier est aussi une case marchable : on s'y poste, on la traverse, on y finit un tour
   faute de cases. Basculer d'étage sans l'avoir demandé est exactement ce qu'interdit la règle 4
   du projet.
2. **Une porte s'ouvre par un bouton d'adjacence**, posé de l'autre côté de la porte par rapport
   au PJ. Le toucher de la porte elle-même disparaît de la vue joueurs.
3. **Deux PJ de part et d'autre de la même porte : un seul bouton**, légèrement déporté.
4. **Porte verrouillée : aucun bouton.** L'indicateur d'état le dit déjà, et un bouton grisé
   voudrait dire deux choses différentes.
5. **En session liée avec un tour actif, seul le pion actif se déplace** depuis la tablette ; les
   boutons de porte des autres PJ sont **grisés**. `ref` à `null` ou liaison déconnectée : la
   table retrouve sa liberté entière.
6. **Le glisser libre du MJ ne consomme pas le mouvement du tour.** Seul un trajet marché le
   consomme.
7. **L'annulation rend tout le mouvement du tour**, et n'existe qu'en session liée.

---

# T1 — Inscrire les arbitrages

Fichier : `docs/QUESTIONS-EN-ATTENTE.md`, nouvelle section **TJ**, sept entrées « ✅ TRANCHÉ »
datées du 22/11/2026, reprenant les sept décisions ci-dessus **mot pour mot**, plus les deux noms
d'événement `turn.select` et `turn.undo`.

**Acceptation.** Les sept décisions s'y retrouvent ; aucune n'est reformulée en « on pourrait ».

---

# T2 — Les tests avant le code

Fichier : `tests/tourDeJeu.test.mjs` (nouveau ; il entre au manifeste en T12).

Écris les cas **avant** toute implémentation. Ils doivent échouer aujourd'hui, et échouer en
nommant la fonction manquante — pas sur un `TypeError` opaque.

| Cas | Attendu |
|---|---|
| `isPlayerManipulableToken(pj, null)` | `true` — aucun tour, comportement d'aujourd'hui |
| `isPlayerManipulableToken(pj, { tokenId: 'autre' })` | `false` |
| `isPlayerManipulableToken(pj, { tokenId: pj.id })` | `true` |
| Pion **sans** `link`, tour sur un autre | `true` — un PJ hors outil MJ n'est jamais bridé |
| `movementRulesFor(token, level, 3)` | `budget − 3` et `walkBudget − 3`, plancher 0, jamais négatif |
| `movementRulesFor(token, level, 0)` | identique à l'appel à deux arguments d'aujourd'hui |
| `setTurn(id)` deux fois de suite | `spentCells` **inchangé** la seconde fois |
| `setTurn(autre)` | `spentCells` remis à 0, `startCell` relu sur le pion |
| `undoTurnMove(id)` | rend la case **et l'étage** de début de tour |
| `undoTurnMove(id)`, case de départ occupée | lève ; aucune mutation |

⛔ **N'invente aucun autre nom de fonction ni aucun autre champ.** Les signatures sont celles du
plan, elles sont arrêtées.

---

# T3 — L'état de tour dans le store *(après T2)*

Fichiers : `js/state/store.js`, `js/core/types.js` (typedef `Turn`).

Le précédent à suivre est **`getSessionVision` / `setSessionVision`** : un état **de session, hors
campagne, non persisté**. C'est ce qui tient l'exigence du contrat §10 (« le tour n'est pas
persisté ») pour ce qu'elle protégeait : l'instantané Firestore.

```js
export function getTurn()                        // → { tokenId, startCell, startLevelId, spentCells } | null
export function setTurn(tokenId, spentCells = 0) // null efface ; MÊME tokenId → ne remet pas à zéro
export function addTurnSpent(tokenId, cells)
export function getTurnSpent(tokenId)            // 0 si ce n'est pas lui l'actif
export function undoTurnMove(tokenId)            // → Cell de départ ; lève si la case est prise
```

- `setTurn` relit `startCell` et `startLevelId` **sur le pion**, au moment du changement de tour.
- `undoTurnMove` contrôle l'occupation avec `findMoveConflict` avant de muter, replace le pion sur
  sa case **et son étage** de départ, et remet `spentCells` à 0.
- `resetStore` efface le tour.
- ⛔ **Rien n'entre dans `createSnapshotPayload`.** Si l'état du tour y apparaît, c'est une faute,
  pas un choix.

**Acceptation.** Les cas de store de T2 passent. Mutation : rends `setTurn` amnésique (remise à
zéro sur le même `tokenId`) et vois rougir le test nommé.

---

# T4 — Le budget retranche les cases parcourues *(après T3)*

Fichiers : `js/state/selection.js`, `js/app/movePlanning.js`.

`movementRulesFor(token, level)` est le **goulot unique** du budget, dix appelants. Étends-le en
`movementRulesFor(token, level, spentCells = 0)` : retranche de `budget` **et** de `walkBudget`,
plancher 0. La Marche recule d'autant, donc la Course commence après `Marche − n` : c'est
exactement ce que le mainteneur demande pour un mouvement interrompu puis reprisi.

`js/app/movePlanning.js` lit `store.getTurn()` pour ses propres appels (il est dans `js/app/`, il
a le droit).

⛔ **Ne lis pas le store depuis `selection.js`.** Le paramètre reste explicite, et pour une raison
nommée : `js/ui/player/gameHelp.js` calcule la zone d'une **carte fictive** de tutoriel et ne doit
jamais être bridé. Une lecture en douce le briderait aussi. Ne touche pas à `gameHelp.js`.

**Acceptation.** Les cas de budget de T2 passent, les tests du tutoriel restent verts. Mutation :
retranche de `budget` sans retrancher de `walkBudget`, et vois rougir le test du palier de Course.

---

# T5 — Le tour bride la manipulation *(après T3)*

Fichiers : `js/input/tokenHit.js`, `js/ui/player/bootstrap.js`, `js/app/player.js`.

`isPlayerManipulableToken(token, turn)` : `turn` absent ou `null` = aucun bridage ; un pion sans
`link` n'est jamais bridé ; sinon seul `turn.tokenId` est manipulable. Six appels dans la vue
joueurs, tous à mettre à jour — `js/ui/player/bootstrap.js` lignes ~140, ~144, ~215, ~357 et
`js/app/player.js` lignes ~735, ~1023.

⚠ **N'ajoute aucune interface pour le PJ bridé.** Il retombe mécaniquement sur la branche
« consultation » déjà écrite pour un PJ non déplaçable : encart lecture seule, aucun bouton, rien
de publié. C'est l'idiome validé par le mainteneur le 21/11/2026, il suffit.

⛔ La vue MJ **ne connaît pas ce bridage**. `isPlayerManipulableToken` est la notion de la vue
joueurs et d'elle seule — son commentaire d'en-tête le dit déjà.

**Acceptation.** Les cas de bridage de T2 passent. Mutation : fais rendre `true` au pion non actif
et vois rougir.

---

# T6 — `turn.select` et `turn.undo` *(après T3)*

Fichiers : `js/app/networkEvents.js`, `js/app/gm.js`, `js/app/mjLink.js`, `js/app/player.js`.

| Événement | Sens | Payload |
|---|---|---|
| `turn.select` | MJ → tablette | `{ tokenId: string\|null, spentCells?: number }` |
| `turn.undo` | tablette → MJ | `{ tokenId: string }` |

- Dans le réducteur, calque-toi sur `level.select` : payload malformé **refusé bruyamment**
  (`console.error`), identifiant inconnu refusé de même, rejeu inoffensif.
- `turn.undo` ne porte **pas** la case de départ. Le MJ relit la sienne. Transmettre la case
  laisserait un client la contredire — c'est le raisonnement déjà écrit au-dessus de
  `link.traverse`, et il vaut ici mot pour mot.
- Le MJ publie `turn.select` : au changement de tour (`mjLink.activeTurn()`, qui existe déjà pour
  le halo), après chaque `reportMove`, après une annulation, et **à l'arrivée d'une présence
  joueurs** — c'est ce qui rend l'état à une tablette rechargée en cours de tour, puisque le tour
  n'entre pas dans l'instantané. L'idiome est celui de l'outil MJ répondant `mj.snapshot` à
  `map.hello`.

**Le compteur s'incrémente dans `reportMove`, et nulle part ailleurs.** Regarde le code avant
d'écrire : `reportMove(tokenId, path)` est appelé à **exactement deux endroits** —
`js/app/gm.js` ligne ~1318 (réception d'un `token.move` venu de la tablette) et ligne ~2075
(validation d'une préparation sur l'écran MJ). Le **glisser libre ne l'appelle pas** (ligne
~2208, dont le commentaire dit « ce glisser n'est pas un trajet marché »). La décision 6 du
mainteneur est donc déjà dans la forme du code : il n'y a **aucun drapeau à inventer**. Le coût en
cases se recalcule depuis `path` avec `movementStepCost`, comme `mjLink` le fait déjà pour
`map.ran`.

⛔ **Aucun autre nom d'événement, aucun champ de plus.** Les noms sont arrêtés et vont au §7 du
cahier des charges en T12.
⛔ **Aucun changement au protocole outil MJ → carte.** `mj.turn` est utilisé tel qu'il existe.

**Acceptation.** Un test de réducteur par événement. Mutation : fais appeler le compteur depuis
`moveTokenToCell` au lieu de `reportMove` et vois rougir le test « le glisser MJ ne consomme
rien ».

---

# T7 [P] — Boutons de porte : géométrie pure et rendu

Fichiers : `js/render/layers/portals.js`, `tests/tourDeJeu.test.mjs`.

```js
export function boutonsPorte(grid, level, tokens, options) // → [{ portalId, tokenId, rect, enabled }]
```

- `rect` est en unités **CARTE**, côté `44 / zoom` — même repère que `intention.mapPos`, donc
  aucune conversion à écrire ailleurs. C'est exactement ce que fait déjà `findHitPortal` avec sa
  capsule, et pour la même raison : à la vue « carte entière » de la tablette (zoom 0,238),
  24 px d'écran couvrent presque une case entière en unités carte.
- Le bouton se pose sur la case **de l'autre côté du segment** par rapport à la case du PJ.
- Deux PJ de part et d'autre : les deux calculs tombent sur la même porte, on **n'en garde qu'un**
  et on le décale d'un demi-bouton.
- Porte `locked` : aucun bouton. Porte `open` : « Fermer ». Porte `closed` : « Ouvrir ».
- `enabled: false` quand un tour actif désigne un autre pion : le bouton se dessine **grisé**.
- La fonction est **pure et exportée** : le rendu et le test de tap l'appellent tous les deux.
  C'est la leçon de `js/input/portalHit.js`, dont l'en-tête raconte que deux copies promettaient
  « deux valeurs à régler pour un seul réglage ».

**Acceptation.** Côté opposé vérifié sur les quatre orientations de porte, **en carré et en
hexagonal**. Mutation : inverse le côté et vois rougir ; supprime la fusion des deux PJ et vois
rougir le test qui compte les boutons.

---

# T8 [P] — Bouton de liaison : géométrie pure et rendu

Fichiers : `js/render/layers/links.js`, `tests/tourDeJeu.test.mjs`.

```js
export function boutonLiaison(grid, level, links, token, options) // → { linkId, rect, label } | null
```

- `extremiteJoueur` **reste la seule règle** qui dit ce qu'un joueur peut prendre : liaison MJ
  seule et entrée B d'un sens unique restent écartées. Ne la duplique pas, ne la contourne pas —
  son commentaire dit qu'elle doit rester l'exact équivalent de `store.findLinkAtCell`.
- Le libellé vient de `LINK_PROMPT` comme aujourd'hui.
- **Pion monté : aucun bouton**, et la mention « Descendre de cheval » (ou « Demander au MJ de
  vous faire descendre de cheval » pour un pion lié) **reste affichée**, non tapable. C'est tout
  ce qu'il reste à `renderPrompt`, qui se réduit à ce cas.
- Une seule invite, la première liaison trouvée, dans le même ordre que le store : deux libellés
  l'un sur l'autre seraient illisibles pour un seul franchissement possible.

**Acceptation.** Un bouton sur une extrémité franchissable par les joueurs, aucun sur une liaison
MJ seule, aucun sur l'entrée B d'un sens unique, aucun si le pion est monté. Mutation : fais
accepter l'entrée B et vois rougir.

---

# T9 — Le tap des boutons remplace les deux anciens gestes *(après T7, T8)*

Fichier : `js/ui/player/bootstrap.js`.

- Branche les deux boutons sur le tap, **avant** l'arbitrage de distance pion/porte.
- **Retire le bloc `portalIsCloser`** de la vue joueurs : toucher la porte n'ouvre plus rien, le
  tap retombe sur le comportement normal de la case visée.
- **Retire le franchissement au re-tap** de la case du pion (bloc « Lot 3, S-03 »). Retaper sa
  case ne publie plus `link.traverse` ; seul le bouton le fait.
- **Aucun bouton n'est testé ni dessiné si une préparation de mouvement est en cours** ou si une
  animation de déplacement court. C'est ce qui permet au joueur d'interrompre son mouvement,
  d'ouvrir la porte, puis de reprendre.
- Le test de tap importe les deux fonctions depuis `js/render/layers/*`. ⚠ `js/ui/*` a le droit
  d'importer `js/render/*` (§2 d'`ARCHITECTURE.md`) ; **`js/input/*` ne l'a pas**. Ne mets donc
  pas cette géométrie dans `js/input/`.

⛔ **La vue MJ garde son `findHitPortal`** : le MJ continue d'ouvrir une porte en la touchant.

**Acceptation.** Mutation : laisse le bloc `portalIsCloser` en place et vois rougir l'e2e
« toucher la porte n'ouvre plus rien ».

---

# T10 — Dessin des boutons et bouton d'annulation *(après T6, T7, T8)*

Fichier : `js/app/player.js`.

- Les boutons se dessinent dans le rang **`feedback`**, et pas ailleurs. Ce rang est **déjà
  au-dessus du brouillard** — c'est là que flotte l'invite d'escalier aujourd'hui, avec le
  commentaire qui explique pourquoi : « l'invite s'écrit dans la case du VOISIN, que rien ne
  garantit explorée ». Une porte dont l'autre côté n'est pas exploré porte donc quand même son
  bouton.
- **Rendu à la demande conservé** : les boutons se redessinent au changement d'état, sans boucle
  active au repos. N'allume pas `animationActive` pour eux.
- **Bouton d'annulation** : même moule que `player-fullscreen-btn` (styles en ligne,
  `position: fixed`, 44 × 44 px, `top: 12px`, opacité 0,4 montant à 1 au contact), à
  `right: 116px`, à gauche de l'aide et du plein écran. Il n'existe que si `getTurn()` désigne un
  PJ de **cette** tablette avec `spentCells > 0`. Il publie `turn.undo` et disparaît.
- L'annulation **ne fait basculer aucun écran** d'étage, même si elle rend le pion à un autre
  étage : c'est UX-10 et la règle 4, et le bloc de bascule automatique a déjà été retiré une fois
  pour cette raison.
- Si `undoTurnMove` lève (case de départ occupée entre-temps), montre le retour transitoire
  « refusé » **déjà en place** et ne publie rien.

**Acceptation.** Mutation : fais apparaître le bouton avec `spentCells === 0` et vois rougir ;
publie `turn.undo` sans appliquer localement et vois rougir l'e2e.

---

# T11 — Scénarios e2e *(après T9, T10)*

Fichier : `tests/tourDeJeu.spec.mjs` (nouveau ; il entre au manifeste en T12). Transport de test,
vrai Canvas.

Six scénarios : ouvrir une porte par le bouton ; la refermer ; toucher la porte sans effet ;
franchir une liaison par le bouton ; interrompre un mouvement, ouvrir une porte, reprendre avec le
**reste** du mouvement ; annuler et retrouver sa zone entière.

⚠ **Le brouillard exploré ne régresse pas après l'annulation** : il est cumulatif, c'est un
invariant du projet. Assure-le, et prouve-le. Une porte ouverte pendant le tour reste ouverte.

⚠ **Aucun test ne lit une carte de `maps/`** — le mainteneur peut toutes les supprimer. Fixtures
dédiées, comme le reste de `tests/`.

⚠ Attention aux assertions sèches sur un état qui arrive en **deux publications** : c'est la cause
de l'intermittence de `fogTrajet.spec.mjs` et du faux vert qui dormait dans sa seconde moitié.
Dérive tes attentes des constantes, ne choisis pas un délai.

---

# T12 — Amender les documents normatifs *(après T11)*

- `docs/CAHIER-DES-CHARGES.md` : §5.3 (vue joueurs), §5.3bis (bande de sélection, voisinage du
  nouveau bouton), **§7** (les deux événements `turn.select` et `turn.undo`).
- `docs/CONVENTIONS.md` § « Vue joueurs » : la règle 1 s'amende (le re-tap ne franchit plus), et
  la règle 2 reçoit **trois dérogations nouvelles** — bouton de porte, bouton de liaison, bouton
  d'annulation. Écris-les comme les précédentes : la date, la demande du mainteneur, la raison.
- `docs/CONTRAT-LIAISON-OUTIL-MJ.md` §10 : « le tour n'est ni persisté ni republié » devient
  « non persisté, **republié vers la tablette** ». ⛔ **Ajoute la mention « à reporter dans la
  copie du dépôt outil MJ ».** Aucun message du protocole ne change, la version ne bouge pas.
- `docs/ARCHITECTURE.md` §1 : les deux fichiers de test nouveaux. Le test d'architecture n°5 ne
  lit que `js/` et `scripts/`, mais le manifeste est fermé pour tout le dépôt.
- `docs/ETAT.md` : entrée de chantier dans la table « **Suite produit** », qui est ce qui fait foi
  sur l'avancement.

---

# T13 — La porte, puis la mutation *(après T12)*

`pnpm run verify` — typecheck, `check-deps`, unitaires, e2e Playwright **et gestes** : les gestes
sont dans la porte, `verify` les lance. Code de sortie 0 exigé.

Puis **mutation de l'effet** de chacun des sept mécanismes, chacune devant faire rougir un test
nommé :

1. côté opposé du bouton de porte ;
2. grisé du bouton hors tour ;
3. retranchement du budget par les cases parcourues ;
4. remise à zéro du compteur au changement de tour ;
5. non-consommation du glisser MJ ;
6. replacement du pion à l'annulation ;
7. absence de bouton pendant une préparation.

Une mutation qui ne fait rougir aucun test devient une tâche. **Ne rapporte « vérifié » que pour
ce que tu as vu rouge d'abord.**

---

## Ce qui est hors de ta main

⛔ Arrête-toi et demande, plutôt que de choisir :

- un fichier nouveau sous `js/` ;
- un nom d'événement autre que `turn.select` et `turn.undo`, ou un champ de plus dans leur
  payload ;
- un message nouveau du protocole outil MJ, dans un sens ou dans l'autre ;
- la copie du contrat dans le dépôt de l'outil MJ : elle n'est pas dans cet arbre, tu ne la
  touches pas ;
- rendre son Action du Tour à l'outil MJ après une annulation. C'est **hors périmètre** et c'est
  écrit : si le PJ avait couru, l'outil MJ garde son Action cochée et le MJ la rend à la main. Un
  message carte → outil MJ serait un amendement du contrat dans les deux dépôts.
