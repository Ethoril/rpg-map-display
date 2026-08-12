# ARCHITECTURE — manifeste de fichiers & interfaces

> **Document normatif et fermé.** Aucun fichier ne doit être créé s'il n'est pas listé ici.
> Un besoin non couvert se signale, il ne s'improvise pas.
>
> À lire après `docs/STACK.md` et `docs/CONVENTIONS.md`.

---

## 1. Arborescence

Les fichiers marqués `[1a]` `[1b]` `[2]` `[3]` `[4]` indiquent le lot qui les crée.
Ceux marqués `[stub]` existent dès le lot 1a mais ne contiennent qu'une interface ou une
implémentation qui lève.

```
F:\rpg-map-display\
│
├─ index.html                     [1b] page d'accueil : choix MJ / joueurs et saisie de la
│                                      session. Aucun module chargé, donc AUCUNE import map
├─ gm.html                        [1a] vue MJ. Import map créée en T-03b (domicile unique
│                                      des versions), reste de la page construit en T-22
├─ player.html                    [1a] vue joueurs — URL autonome, zéro UI. Import map
│                                      IDENTIQUE à gm.html (T-23)
├─ attributions.html               [R1] attribution des assets tiers et statut de publication
│                                      des cartes ; liée depuis l'accueil et la vue MJ
├─ firebase-config.js            [1b] configuration Firebase Web publique. Script CLASSIQUE,
│                                      pas un module : chargé par gm/player/diag AVANT les
│                                      modules différés. Ne s'applique pas sous navigateur
│                                      piloté (navigator.webdriver)
├─ jsconfig.json                  [1a] checkJs strict, noEmit
├─ package.json                   [1a] scripts Node uniquement
├─ diag.html                      [1a] diagnostic matériel — limites GPU, fps, thermique,
│                                      coût du store, latence Firebase. Hors application :
│                                      ni vue MJ, ni vue joueurs. Import map IDENTIQUE
├─ outil-cartes.cmd               [L]  lanceur Windows de l'outil de cartes, prévu pour le
│                                      double-clic : démarre le serveur et ouvre la page.
│                                      CRLF et ASCII pur imposés (cf. .gitattributes)
├─ prepare.html                   [L]  outil LOCAL de préparation des cartes. Hors
│                                      application, et inerte sans scripts/prepare-server.mjs
│                                      — elle le détecte et le dit. Import map IDENTIQUE bien
│                                      qu'inutile ici : check-deps l'exige de toute page de la
│                                      racine chargeant un module
├─ playwright.config.mjs          [1a] tests navigateur : testMatch *.spec.mjs, webServer
├─ pnpm-workspace.yaml            [1a] allowBuilds deterministes pour pnpm
├─ .gitattributes                 [1a] * text=auto eol=lf
├─ .gitignore                     [1a]
├─ .nojekyll                      [1a] désactive Jekyll sur GitHub Pages : le site est du
│                                      statique pur, rien n'est à transformer
│
├─ css/
│   ├─ gm.css                     [1a] vue MJ
│   └─ player.css                 [1a] Zero-UI, overscroll/touch-action
│
├─ js/
│   ├─ core/
│   │   ├─ types.js               [1a] tous les @typedef partagés — AUCUN code exécutable
│   │   ├─ constants.js           [1a] FOG_MASK_PX_PER_CELL, seuils, limites
│   │   ├─ cellKey.js             [1a] cellKey, parseCellKey, edgeKey
│   │   ├─ version.js             [1a] ⚙ GÉNÉRÉ par scripts/stamp-version.mjs
│   │   └─ schema.js              [1a] fabriques + validation du document de campagne
│   │
│   ├─ grid/
│   │   ├─ GridAdapter.js         [1a] interface documentée (JSDoc) — aucune implémentation
│   │   ├─ SquareGrid.js          [1a] implémentation carrée
│   │   ├─ HexGrid.js             [4]  implémentation hexagonale
│   │   └─ index.js               [1a] gridFor(level) → GridAdapter
│   │
│   ├─ transport/
│   │   ├─ Transport.js           [1a] interface documentée
│   │   ├─ FirebaseTransport.js   [1a] SEUL fichier autorisé à importer firebase/*
│   │   └─ LocalSocketTransport.js [stub] lève « non implémenté » jusqu'au besoin réel
│   │
│   ├─ state/
│   │   ├─ store.js               [1a, R2-01] source de vérité + signal de changement + snapshot de rendu partagé
│   │   ├─ selection.js           [1a] pion sélectionné, cases atteignables courantes
│   │   └─ presence.js            [1a] clients connectés + détection d'écart de build
│   │
│   ├─ import/
│   │   ├─ uvtt.js                [1a] parsing UVTT pur (aucune I/O, aucun DOM)
│   │   ├─ catalog.js             [2]  chargeur et validateur de catalogue pur
│   │   ├─ tokenCatalog.js        [1b] chargeur et validateur du catalogue de pions, pur
│   │   ├─ imageCalibrate.js      [1a] image simple → grille (source B)
│   │   ├─ gridPitch.js           [4]  topologie de la grille PEINTE, par autocorrélation d'un
│   │                                  profil d'encre. Le format UVTT ne déclare jamais
│   │                                  l'hexagone (ANALYSE-DD2VTT-GRILLES §4.3) : une carte hex
│   │                                  s'importait donc en carré, en silence, contre l'exigence
│   │                                  d'universalité. Pur, sans DOM ni I/O — il reçoit des
│   │                                  pixels, il rend un verdict. ⚠ Il AVERTIT et ne corrige
│   │                                  rien : l'adaptateur hexagonal est le lot 4.
│   │   └─ blockedEdges.js        [2]  segments UVTT → Set<edgeKey>, par croisement
│                                      centre-à-centre. Porte une MÉMOÏSATION par étage,
│                                      indexée sur levelId + empreinte géométrique : c'est
│                                      déterministe et sans I/O, donc compatible avec la
│                                      pureté exigée de import/* — ne pas la lire comme une
│                                      violation (cf. TRANCHE-L01 §5)
│   │
│   ├─ movement/
│   │   ├─ reachable.js           [1a] Dijkstra pondéré → Map<cellKey, coût>
│   │   └─ path.js                [1a] chaîne de prédécesseurs → chemin de cases
│   │
│   ├─ vision/
│   │   ├─ sweep.js               [2]  visibilité 2D → polygone
│   │   └─ fog.js                 [2]  masque raster, OR, encodage PNG
│   │
│   ├─ render/
│   │   ├─ stage.js               [1a] contexte Canvas 2D + ordre des couches
│   │   ├─ camera.js              [1a] SEUL fichier convertissant carte ⇄ écran
│   │   ├─ frame.js               [1a] boucle à la demande (coalescence rAF)
│   │   ├─ probe.js               [N]  sonde passive : mesure la première image après inactivité
│   │   ├─ statusBadges.js        [2]  paliers d'affichage des marqueurs, mise en page de la
│   │   │                              rangée, cache de rastérisation des 14 icônes. Séparé de
│   │   │                              `tokens.js` parce que le choix du palier et la
│   │   │                              troncature sont de l'arithmétique pure, donc
│   │   │                              vérifiables sous node:test — cf. TRANCHE-L09 §5.1
│   │   ├─ tokenSocket.js         [R]  géométrie et contrat de zones de la châsse des pions.
│   │   │                              Module pur sans dépendance au DOM, vérifiable sous
│   │   │                              node:test — cf. CHANTIER-R §3
│   │   ├─ videoBackdrop.js       [W]  fond animé : pilote un <video> posé SOUS le canvas.
│   │   │                              ⚠ SEUL fichier de render/ qui touche au DOM hors
│   │   │                              canvas, et c'est le point : la vidéo est décodée par
│   │   │                              le compositeur, jamais par drawImage, donc le rendu
│   │   │                              reste à la demande — cf. CHANTIER-W §2

│   │   └─ layers/
│   │       ├─ background.js      [1a] image de fond
│   │       ├─ gridLayer.js       [1a] délègue le tracé à GridAdapter.renderGrid
│   │       ├─ walls.js           [2]  tracé des murs de l'étage (vue MJ seule)
│   │       ├─ portals.js         [2]  indicateur d'état des trois états
│   │       ├─ links.js           [3]  marqueurs de liaisons MJ/joueurs
│   │       ├─ moveZone.js        [1a] cases atteignables — NON interactif
│   │       ├─ tokens.js          [1a] pions, badges élévation/marqueurs
│   │       ├─ fogLayer.js        [2]  masque + trois états de rendu
│   │       ├─ templates.js       [2]  gabarits de zone d'effet
│   │       ├─ measure.js         [4]  mesure de distance au geste (MJ local)
│   │       └─ pings.js           [4]  marqueur « regarde ici », transitoire — ⚠ ne lit
│   │                                  PAS le store : un ping est un geste, pas une donnée,
│   │                                  et son âge se compte depuis la réception LOCALE
│   │
│   ├─ input/
│   │   ├─ pointer.js             [1a] pointerdown/move/up → intentions abstraites
│   │   ├─ gestures.js            [1a] pan, pinch, tap, appui long
│   │   ├─ portalHit.js           [2]  désignation d'une porte sous le tap (MJ et joueurs)
│   │   ├─ templateHit.js         [2]  désignation d'un gabarit sous le tap (MJ et joueurs)
│   │   └─ tokenHit.js            [O]  désignation d'un pion sous le tap et glisser (MJ et joueurs)
│   │
│   ├─ ui/
│   │   ├─ versionBadge.js        [1a] affichage MJ (permanent) / joueurs (transitoire) + mise à jour forcée
│   │   ├─ gm/
│   │   │   ├─ panel.js           [1a] panneau latéral (conteneur)
│   │   │   ├─ importPanel.js     [1a] import UVTT + image, calibration
│   │   │   ├─ tokenMaker.js      [1a] générateur de pions (recadrage canvas)
│   │   │   ├─ sceneLibrary.js    [2]  bibliothèque de cartes
│   │   │   ├─ tokenLibrary.js    [1b] bibliothèque de pions
│   │   │   ├─ handouts.js        [1b] révélation d'image
│   │   │   ├─ fogTools.js        [2]  pinceaux révéler/masquer, reset
│   │   │   ├─ wallEditor.js      [2]  éditeur minimal de murs
│   │   │   ├─ linkEditor.js      [3]  pose, association et suppression de liaisons
│   │   │   ├─ templateTools.js   [2]  gabarits de zone d'effet (choix forme/rayon, armement, effacement)
│   │   │   └─ levelSelector.js   [3]  sélecteur d'étage MJ
│   │   └─ player/
│   │       ├─ bootstrap.js       [1a] montage de la vue joueurs
│   │       ├─ handoutOverlay.js  [1b] plein écran d'image révélée
│   │       └─ levelSelector.js   [3]  sélecteur d'étage joueurs
│   │
│   └─ app/
│       ├─ runtimeConfig.js       [1a] résolution de la configuration Firebase Web publique
│       ├─ session.js             [1a] authentification et connexion d'une page
│       ├─ networkEvents.js       [1a] application idempotente des NetEvent au store
│       ├─ gm.js                  [1a] point d'entrée vue MJ
│       ├─ player.js              [1a] point d'entrée vue joueurs (+ verrous mobiles, bouton plein écran)
│       ├─ diag.js                [1a] point d'entrée de diag.html (mesures matérielles)
│       ├─ endurance.js           [R2] protocole passif : décodage post-inactivité et journal
│       │                              manuel cast/endurance, sans sondage ni minuterie
│       ├─ sondeLatence.js       [—]  sonde de latence à charger DEPUIS LA CONSOLE de la vue
│                                     MJ : `import('./js/app/sondeLatence.js')`. Aucun module
│                                     ne l'importe, elle ne coûte rien tant qu'on ne la
│                                     réclame pas. Mode d'emploi : `docs/SONDE-LATENCE.md`,
│                                     dont un test vérifie qu'il ne diverge pas de ce fichier
│       └─ prepare.js             [L]  point d'entrée de prepare.html. Ne parle qu'à l'API
│                                      locale : il ne décode ni ne rééchantillonne aucune
│                                      image, le pipeline n'ayant qu'une implantation, en Node
│
├─ scripts/
│   ├─ import-uvtt.mjs            [1a] CLI Node : .uvtt → maps/ + document de scène
│   ├─ prepare-maps.mjs           [2]  CLI Node : scanne maps/*.uvtt, génère catalog.json
│   ├─ resample.mjs               [1a] rééchantillonnage d'image (Node)
│   ├─ make-fixture.mjs           [1a] génère les fixtures de test
│   ├─ stamp-version.mjs          [1a] écrit js/core/version.js
│   ├─ serve.mjs                  [1a] serveur statique sans dépendance (tests + dev local).
│                                      N'écrit JAMAIS : c'est le serveur des tests Playwright,
│                                      lui ajouter une surface d'écriture l'ajouterait aux tests
│   ├─ prepare-server.mjs         [L]  serveur LOCAL de l'outil de cartes (127.0.0.1 seul) :
│                                      sert prepare.html et expose l'API qui appelle
│                                      prepareMap(). Distinct de serve.mjs à dessein
│   ├─ check-deps.mjs             [1a] vérifie la cohérence import map/devDependencies à chaque
│   │                                  porte, et la disponibilité CDN/versions lors du contrôle
│   │                                  hebdomadaire séparé
│   └─ build-site.mjs             [R1] paquet GitHub Pages déterministe dans `_site`, par
│                                      liste blanche ; ne bundle ni ne transforme le runtime
│
├─ fixtures/                      [1a] cf. docs/FIXTURES.md
├─ maps/                          [1a] images traitées, commitées
├─ assets/
│   └─ icons/status/              [2]  les 14 icônes d'états, une par valeur de
│                                      `token.markers`. Le nom de fichier EST l'identifiant.
│                                      Provenance, licence et normalisation : SOURCES.md du
│                                      dossier. Contenu clos — cf. CdC §12 Q7
├─ tests/                         [1a] deux familles, deux exécuteurs :
│                                      *.test.mjs → node:test (logique pure)
│                                      *.spec.mjs → Playwright (navigateur, vrai Canvas)
│                                      mountStage.mjs, mountTransport.mjs → sondes chargées
│                                      dans la page, typées comme le reste du dépôt
└─ docs/
    ├─ CAHIER-DES-CHARGES.md      spécification fonctionnelle (source de vérité du « quoi »)
    ├─ STACK.md                   versions & idiomes
    ├─ CONVENTIONS.md             conventions & interdictions
    ├─ ARCHITECTURE.md            ce document
    ├─ TASKS-lot1a.md             découpage en tâches
    ├─ FIXTURES.md                jeux de données de test
    ├─ MAPS-UVTT.md               mode d'emploi simple pour préparer et publier les cartes
    ├─ PLAN-BIBLIOTHEQUE-UVTT.md plan d'intégration de la bibliothèque de scènes préparées
    ├─ PLAN-STABILISATION-CANVAS.md plan détaillé de remise à plat Canvas, persistance
    │                              et synchronisation
    ├─ PLAN-LOT2.md               [2] découpage du lot 2 en tranches, décisions arrêtées
    │                              (portes à trois états, autorité vision/fog) et amendements
    │                              du CdC à faire
    ├─ FEUILLE-DE-ROUTE-COMPLEMENTAIRE.md
    │                              travaux transverses issus de l'audit du 07/08/2026 :
    │                              fiabilité, exploitation, performance et préparation 1.0
    ├─ PROTOCOLE-ENDURANCE.md     [R2] procédure reproductible tablette : décodage froid,
    │                                  essai cast 45 min et session 4 h
    ├─ RAPPORT-ENDURANCE.md       [R2] relevé manuel remplissable des observations physiques
    ├─ CHANTIER-L-OUTIL-CARTES.md [L] outil local de préparation : la règle « une seule
    │                              implantation du pipeline », et pourquoi on compare avec des
    │                              réglages mais publie avec les constantes
    ├─ TRANCHE-L09-MARQUEURS.md   [2] brief de la 9e tranche : marqueurs d'état. Trois paliers
    │                              d'affichage sur le diamètre du pion à l'écran — jamais sur le
    │                              zoom. Contient la mesure qui montre les garde-fous de badge
    │                              actuels écrits dans le mauvais espace
    ├─ TRANCHE-L03-UNION-VISION.md [2] brief de la 3e tranche : union des PJ rendue côté MJ.
    │                              L'union se fait par sous-chemins Canvas, aucune géométrie
    │                              booléenne. Plafond de vision à 20 cases, borne technique
    ├─ TRANCHE-L02-SWEEP-VISIBILITE.md [2] brief de la 2e tranche : polygone de visibilité,
    │                              et la mesure du critère 13. Le tri par portée n'est pas une
    │                              optimisation, c'est ce qui rend la tranche faisable
    ├─ TRANCHE-L01-ARETES-BLOQUEES.md [2] brief de la 1re tranche du lot 2 : test de
    │                              croisement centre-à-centre plutôt qu'accrochage à la grille,
    │                              mesures à l'appui. « Tranche L-01 » ≠ « chantier L »
    ├─ TRAVAIL-2907SOIR.md        [2] reprise du 29/07 au soir : état réel du lot 2 et
    │                              spécifications des trois chantiers restants
    └─ ETAT.md                    avancement, reprise, corrections du plan
```

> `firebase-config.js` a été **ajouté après la première mise en service de Firebase**. La
> configuration devait auparavant être collée dans `diag.html` sur chaque appareil **et**
> chaque origine, `localStorage` étant cloisonné par les deux — et l'oubli était silencieux,
> « Mode local » laissant l'application fonctionner sans synchronisation. Ces cinq champs sont
> publics par nature : la protection d'un projet Firebase vient de ses règles de sécurité, pas
> de la confidentialité de sa configuration Web. Le fichier n'est **pas** un module, pour être
> exécuté avant les modules différés ; il est donc hors de la table du §2, qui ne régit que
> `js/`. Il ne s'applique pas sous `navigator.webdriver` : sans cette garde, les tests e2e qui
> n'injectent pas de transport attendraient une connexion Google au lieu de rester en mode
> local (`app/session.js:196-201`).

> `index.html` et `gm.html` ont été **redistribués au chantier J**. `index.html` était la vue
> MJ : il fallait donc connaître deux URL distinctes et retenir laquelle ouvrir. La racine
> devient une page d'accueil qui aiguille vers l'un des deux rôles et porte la saisie de la
> session, et la vue MJ prend `gm.html`. Le rôle de chaque page reste unique — la séparation
> qui vaut déjà pour `player.html` et `diag.html`. Conséquence sur `check-deps.mjs` : la page
> de référence de l'import map devient `gm.html`, et une page de la racine ne chargeant aucun
> module est exemptée de la comparaison, n'ayant aucune version dont dériver.

> `import/tokenCatalog.js` a été **ajouté au chantier I**. Le premier brief logeait le
> chargement et la validation du catalogue de pions dans `ui/gm/tokenLibrary.js`, au motif
> que ce document est fermé. C'était privilégier la lettre du manifeste sur sa raison
> d'être : une validation qui touche le DOM n'est testable qu'au navigateur, et surtout
> elle est **inutilisable depuis Node**. Or les couches pures sont déjà le substrat partagé
> entre le navigateur et les CLI — `import/uvtt.js` est importé par `scripts/import-uvtt.mjs`
> **et** `scripts/prepare-maps.mjs`, aux côtés de `core/schema.js` et `core/constants.js`.
> Enfermer la validation dans `ui/*` interdisait donc une vérification CI du catalogue
> commité et tout futur `prepare-tokens.mjs`. Aucune règle du §2 n'est touchée : `import/*`
> n'importe que `core/*`, et `ui/*` peut déjà importer `import/*`.

---

## 2. Règles d'importation

C'est **le mécanisme d'application** des abstractions. Chaque règle est vérifiable
mécaniquement (§4).

| Module | Peut importer | Ne doit JAMAIS importer |
|---|---|---|
| `core/*` | rien (sauf `core/*`) | tout le reste |
| `grid/*` | `core/*` | `render/*`, `state/*`, `transport/*`, `ui/*` |
| `transport/*` | `core/*` | `render/*`, `grid/*`, `ui/*` |
| `state/*` | `core/*`, `grid/*`, `import/*` | `render/*`, `ui/*`, `transport/*` |
| `import/*` | `core/*`, `grid/*` | `render/*`, `ui/*`, `transport/*`, `state/*` |
| `movement/*` | `core/*`, `grid/*` | tout le reste |
| `vision/*` | `core/*` | `grid/*`, `render/*`, `ui/*`, `state/*` |
| `render/*` | `core/*`, `grid/*`, `state/*` | `transport/*`, `ui/*`, `import/*` |
| `input/*` | `core/*` | `render/*`, `state/*` |
| `ui/*` | tout sauf `transport/*` en direct | `firebase/*` |
| `app/*` | tout | — |

> `state/* → import/*` a été **ajouté à T-13**. La table interdisait au consommateur désigné
> d'atteindre `computeBlockedEdges`, dont T-08 gèle pourtant la signature « pour que
> `cellsInRange` la consomme dès le départ » : contrat infaisable, donc défaut du plan.
> `import/*` est de la logique pure (aucune I/O, aucun DOM, par contrat de T-10), et au lot 2
> les arêtes bloquées deviendront un **état vivant** — une porte qui s'ouvre les change en
> cours de partie. Elles appartiennent donc au store, avec un cache par étage, et non à une
> couche d'import appelée une fois. Aucune des trois règles portantes n'est touchée.

**Trois règles portantes, à ne jamais assouplir :**

1. **`vision/*` n'importe pas `grid/*`.** La visibilité opère sur des segments et produit
   un polygone : elle ignore totalement la topologie de grille. C'est ce qui rend
   l'hexagone bon marché.
2. **Seul `transport/FirebaseTransport.js` importe `firebase/*`.** Le reste du code ne
   connaît que l'interface. C'est ce qui rend le mode LAN possible sans refactor.
3. **Seul `grid/*` fait de l'arithmétique `pxPerCell`, seul `render/camera.js` convertit
   vers l'écran.**

---

## 3. Interfaces — à écrire en premier, avant toute implémentation

Ces trois fichiers constituent le contrat. Ils sont créés et validés **avant** que quoi que
ce soit ne les implémente.

### `js/core/types.js`

Aucun code exécutable, uniquement des `@typedef`. Reprend le schéma du cahier des charges
§6 sans le réinterpréter.

```js
// @ts-check

/** Couple opaque, ENTIER. Carré : (colonne, ligne). Hexagone : axial (q, r). @typedef {{a:number,b:number}} Cell */
/** Unité de case, FRACTIONNAIRE. Géométrie UVTT. @typedef {{cellX:number,cellY:number}} CellPoint */
/** Pixels de l'image de fond. @typedef {{x:number,y:number}} MapPoint */
/** Pixels du canvas. @typedef {{screenX:number,screenY:number}} ScreenPoint */
/** @typedef {'square'|'hex'} GridType */

// Noms de propriétés distincts à dessein : le typage étant structurel, c'est la seule
// façon de rendre un mélange d'unités impossible à compiler. Cf. CONVENTIONS.md §1.

/**
 * @typedef {Object} Token
 * @property {string} id
 * @property {string} levelId
 * @property {Cell} cell          position — TOUJOURS entière
 * @property {number} sizeCells
 * @property {'pc'|'npc'} kind
 * @property {string} imageUrl     URL publiée OU image data: bornée (seul champ d'asset qui l'autorise)
 * @property {string} borderColor
 * @property {string} label
 * @property {boolean} hidden
 * @property {number} visionBright
 * @property {number} visionDim
 * @property {{range:number,intensity:number,color:string}|null} emitsLight
 * @property {number} speedCells
 * @property {boolean} playerMovable
 * @property {boolean} locked
 * @property {number} elevation
 * @property {string[]} markers
 */

/** @typedef {Object} Level  … cf. cahier des charges §6 */
/** @typedef {Object} Campaign … */
/** @typedef {{type:string,payload:object,at:number,by:'gm'|'players'}} NetEvent */
```

### `js/grid/GridAdapter.js`

Interface pure. Aucune implémentation dans ce fichier.

```js
// @ts-check
/** @typedef {import('../core/types.js').Cell} Cell */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */

/**
 * Abstraction de topologie de grille. SEUL endroit du projet autorisé à connaître
 * `pxPerCell` et la géométrie des cases.
 *
 * @typedef {Object} GridAdapter
 *
 * @property {GridType} type
 *
 * @property {(p: MapPoint) => Cell|null} cellFromPoint
 *   Pixels carte → cellule. `null` hors carte. En hexagone : arrondi cubique.
 *
 * @property {(cell: Cell) => MapPoint} pointFromCell
 *   Cellule → CENTRE de la case, en pixels carte.
 *
 * @property {(cp: CellPoint) => MapPoint} mapFromCellPoint
 *   Unité de case fractionnaire → pixels carte. Applique `pxPerCell` ET l'offset issu de
 *   `map_origin`. Sert au rendu des murs, portails et lumières importés.
 *
 * @property {(p: MapPoint) => CellPoint} cellPointFromMap
 *   Réciproque. Sert à l'éditeur de murs du lot 2.
 *
 * @property {(cell: Cell) => Cell[]} neighbors
 *   Voisines adjacentes. 8 en carré (diagonales incluses), 6 en hexagone.
 *
 * @property {(a: Cell, b: Cell) => number} distance
 *   Distance en cases. Octile en carré, uniforme en hexagone.
 *
 * @property {(cell: Cell) => Array<[Cell, Cell]>} edgesOf
 *   Paires (cell, voisine) définissant les arêtes franchissables de la case.
 *
 * @property {(cell: Cell, sizeCells: number) => Cell[]} cellsOccupied
 *   Cases couvertes par un pion. Bloc n×n en carré. Convention hexagonale à trancher.
 *
 * @property {(from: Cell, budget: number, blockedEdges: Set<string>,
 *             terrainCost?: Map<string,number>) => Map<string, number>} cellsInRange
 *   Dijkstra pondéré. Clé = cellKey, valeur = coût cumulé. Interdit le corner-cutting en
 *   carré : une diagonale exige les deux arêtes orthogonales adjacentes libres.
 *
 * @property {(context: CanvasRenderingContext2D) => void} renderGrid
 *   Trace le quadrillage sur le contexte déjà transformé par la caméra.
 */
export {}
```

### `js/transport/Transport.js`

```js
// @ts-check
/** @typedef {import('../core/types.js').NetEvent} NetEvent */

/**
 * Abstraction de synchronisation. L'hébergement devient un choix d'exécution.
 *
 * @typedef {Object} Transport
 * @property {(sessionId: string, role: 'gm'|'players') => Promise<void>} connect
 * @property {(event: NetEvent) => void} publish
 * @property {(handler: (e: NetEvent) => void) => () => void} subscribe  retourne un désabonnement
 * @property {() => Promise<object>} snapshot   état complet — TOUJOURS avant les deltas
 * @property {() => void} disconnect
 */
export {}
```

> **Amendements de T-14.** Trois membres s'ajoutent à l'implémentation Firebase, hors du
> contrat minimal ci-dessus :
> - `saveSnapshot(campaignData)` — persistance du document de campagne. T-24 en dépend.
> - `onError(handler)` — abonnement aux échecs **asynchrones**. `publish` ne rend rien par
>   contrat (l'appelant n'attend pas le réseau, l'animation est déterministe côté client) ;
>   sans ce canal, une écriture refusée serait invisible et l'écran ne suivrait pas, sans le
>   moindre indice. En l'absence d'abonné, l'erreur est relancée hors pile pour rester visible.
> - `purgeEvents()` — geste de fin de séance pour la session courante : il se refuse si un autre
>   consommateur actif est encore protégé.
> - `inspectSessions(sessionIds)` et `purgeSessionEvents(sessionId, options)` — ménage borné des
>   anciennes sessions. Les identifiants sont obligatoirement explicites (20 au plus), la purge
>   est un *dry-run* par défaut et exige `{ confirm: true, dryRun: false }` après inspection.
>   Il n'y a volontairement pas de liste globale : les règles RTDB autorisent les descendants
>   `session/$sessionId`, pas la lecture de `/session`. Une énumération globale exige donc une
>   règle et un outil d'administration distincts ; l'interface Web ne feint pas de la fournir.
>
> **Rétention des événements.** Chaque `FirebaseTransport` écrit d'abord une barrière éphémère
> `retentionClients/{clientId}` à l'état `joining`, avant de lire le dernier événement. Après le
> branchement de l'écoute, elle devient `active` avec le dernier curseur reçu ; elle est datée par
> `serverTimestamp()` et retirée avec `onDisconnect`. Au plus 32 événements sont effacés après 32
> publications et 30 s, seulement jusqu'au plus petit curseur de tous les clients actifs. Le
> contrôle des leases et la suppression sont une même transaction au niveau de la session : une
> arrivée ou un ACK concurrent force une réévaluation. Le temps serveur (offset RTDB) ne sert qu'à
> écarter une trace périmée après 120 s ; il ne date jamais les événements.
> Une `presence` active sans curseur homologue — notamment une ancienne version cliente — bloque
> intégralement le ménage. Cela privilégie une file qui reste trop longue à une suppression
> douteuse.
>
> **L'authentification n'est PAS dans l'interface**, à dessein : elle est propre à Firebase
> (un transport LAN n'a pas de compte Google). `FirebaseTransport` expose `signInWithGoogle()`,
> `signInWithPassword()` et `currentUser()` ; c'est `app/*` qui décide *quand* demander une
> identité. `connect()` **lève** si aucune n'est établie — l'accès anonyme est fermé par les
> règles de sécurité. Cf. `ETAT.md` §7.

---

## 4. Tests de conformité architecturale

Ces tests ne vérifient pas des fonctionnalités, ils **empêchent l'architecture de se
dégrader**. Ils sont écrits au lot 1a et ne doivent jamais être désactivés. Ce sont des tests
`node:test` (`tests/architecture.test.mjs`) : ils lisent des fichiers, aucun navigateur.

`tests/architecture.test.mjs` :

1. **Application case ⇄ pixel confinée** — hors de `js/grid/`, aucun fichier ne convertit
   une case en position pixel ni l'inverse. Occurrences de `pxPerCell` attendues et
   autorisées :
   - sa *déclaration* de champ dans `js/core/types.js` et sa valeur par défaut dans
     `js/core/schema.js` ;
   - la **définition du repère** dans `js/import/imageCalibrate.js` et `js/import/uvtt.js` :
     calibrer, c'est diviser une distance en pixels par un nombre de cases, puis convertir
     `map_origin` (unités de case) en `offsetX`/`offsetY` (pixels). C'est le seul endroit où
     une quantité en cases devient légitimement une quantité en pixels, parce qu'elle
     *constitue* le repère que `GridAdapter` appliquera ensuite ;
   - l'**application** dans `js/grid/*` — positionner quoi que ce soit passe par là.

   Le test cible l'application à des positions, pas la mention du nom. Ne jamais renommer le
   champ pour faire passer le test.

   > Formulation corrigée après coup : la version initiale n'autorisait que deux exceptions,
   > ce qui rendait le test infaisable sur les livrables de T-10 et T-12 — tous deux au
   > contrat. Défaut du plan, cf. `ETAT.md` §4.
2. **Firebase confiné** — aucun `import … 'firebase/…'` hors de
   `js/transport/FirebaseTransport.js`.
3. **Pas de coordonnées nommées** — aucune occurrence de `.col`, `.row`, `.q`, `.r` sur un
   objet cellule dans tout `js/`.
4. **`vision/` indépendant de la grille** — aucun import de `grid/` dans `js/vision/`.
5. **Manifeste respecté** — tout fichier de `js/` figure dans ce document.
6. **Règles d'importation** — le tableau §2 est vérifié fichier par fichier.
7. **Versions centralisées** — aucun numéro de version ni URL de CDN dans un `.js`.
8. **`js/core/types.js` sans code exécutable** — aucune `class`, aucune `function`, aucun
   `export` autre que `export {}`. Ajouté après coup : rien ne surveillait mécaniquement
   cette règle, et elle a déjà sauté lors d'une ancienne tentative de moteur tiers.
   Un faux exporté depuis le fichier de types est doublement nuisible — il rend la
   vérification verte et le typage aveugle.

Un échec de l'un de ces tests **bloque la tâche**, même si la fonctionnalité marche.

---

## 5. Ordre des couches de rendu

Du fond vers la surface. Ordre figé : il détermine la lisibilité à table.

```
1. background      image de fond (ou vidéo)
2. gridLayer       quadrillage
3. moveZone        cases atteignables        ← non interactif
4. templates       gabarits de zone d'effet
5. tokens          pions + badges
6. fogLayer        masque de fog             ← au-dessus des pions
7. (DOM)           overlays : révélation d'image, sélecteur d'étage
```

`fogLayer` **au-dessus** de `tokens` : c'est ce qui garantit mécaniquement l'interdiction
n°3 des conventions — un pion en zone non visible est masqué par le fog, pas par une
condition d'affichage qu'on peut oublier.

---

## 6. Vue joueurs — contraintes de montage

`player.html` est autonome et paramétrable par l'URL :

```
player.html?session=<id>&camera=follow
```

- Sans `camera=follow` : caméra locale libre.
- Avec : la caméra suit celle publiée par la tablette (repli si le cast déçoit).

CSS obligatoire dans `player.css` :

```css
html, body { overscroll-behavior: none; overflow: hidden; margin: 0; }
canvas     { touch-action: none; display: block; }
*          { user-select: none; -webkit-user-select: none; }
```

Et au montage : `screen.orientation.lock('landscape')` (échec toléré), Wake Lock si le
contexte est sécurisé, plein écran ou PWA `display: fullscreen`.
