# TÂCHES — Lot 1a « Le plateau »

> **Objectif du lot :** une première séance réellement jouable à table. Une carte
> s'importe, des pions se déplacent en tap-tap, les trois écrans sont synchronisés, l'état
> survit à un rafraîchissement. **Pas de lignes de vue, pas de fog, pas d'étages.**
>
> À lire après `STACK.md`, `CONVENTIONS.md` et `ARCHITECTURE.md`.

---

## Mode opératoire

**Une tâche à la fois, dans l'ordre.** Chaque tâche indique ses fichiers, son contrat, sa
vérification et ses dépendances.

À la fin de chaque tâche, produire un rapport de **trois lignes** :

```
T-xx : terminé | partiel | bloqué
Vérification : <résultat exact de la commande ou du test>
Écarts : <ce qui manque, ou "aucun">
```

**S'arrêter à chaque point de contrôle** (⛔) et attendre la relecture. Ne jamais enchaîner
au-delà.

### Ne jamais commiter

**Laisser les modifications dans l'arbre de travail.** Ne pas exécuter `git commit`, ni
`git add`, ni `git push`, ni `git stash`, ni aucune commande qui modifie l'historique ou
l'index.

La raison est pratique : un commit intervient **après** relecture. Une tâche rejetée dont le
code est déjà dans l'historique demande un revert ou un fixup, là qu'une simple correction
de l'arbre de travail suffirait. Le mainteneur commite lui-même les tâches validées.

Corollaire : laisser l'arbre **propre de tout artefact** en fin de tâche. Les fichiers de
test jetables sont supprimés, et `git status` ne doit montrer que les fichiers du contrat de
la tâche.

Rappels permanents :
- `pnpm run typecheck` doit être propre à chaque tâche (cf. `CONVENTIONS.md` §9 pour
  l'unique exception, à la T-01).
- **Un critère de vérification qui ne peut pas être atteint est un défaut du plan, pas de
  l'implémentation.** Le signaler dans la ligne « Écarts » et demander l'arbitrage. Ne
  jamais le contourner ni le déclarer satisfait.
- Aucun fichier hors du manifeste de `ARCHITECTURE.md`.
- Les 15 interdictions de `CONVENTIONS.md` §8 s'appliquent en continu.
- **Ne jamais cocher un critère de performance** — ils exigent la tablette physique.

---

## Étape 1 — Fondations (aucun rendu, aucun réseau)

### T-01 — Squelette de projet
**Fichiers :** `package.json`, `jsconfig.json`, `.gitignore`, `.gitattributes`
**Contrat :** pnpm, scripts Node uniquement. `jsconfig.json` en `checkJs: true`,
`strict: true`, `noEmit: true`, `allowJs: true`, cible `ES2022`, `moduleResolution: bundler`.
Dépendances de dev seulement : `typescript`, `@playwright/test`.
Scripts `package.json` : `test`, et **`typecheck`** valant
`tsc --noEmit -p jsconfig.json` — pour que la vérification de chaque tâche soit une
commande unique, non retapable de travers.
**Vérification :** `pnpm run typecheck` produit **TS18003 et rien d'autre** (« No inputs
were found »), avec un code de sortie 2. C'est le résultat **attendu** à ce stade : aucun
fichier source n'existe encore. Toute autre erreur est un défaut.
**Dépend de :** —

> ⚠️ **TS18003 est toléré à la T-01 uniquement.** Dès la T-02, un fichier source existe et
> `pnpm run typecheck` doit être totalement propre, code de sortie 0.

### T-02 — Types partagés
**Fichiers :** `js/core/types.js`
**Contrat :** transcrire le schéma du cahier des charges §6 en `@typedef`, plus les types
de `ARCHITECTURE.md` §3. **Aucun code exécutable** — uniquement des commentaires JSDoc et
un `export {}`. `Token.cell` est un `Cell`, jamais `x`/`y`.
**Vérification :** `tsc` propre ; un fichier de test important un `Token` et omettant un
champ obligatoire produit bien une erreur `tsc`.
**Dépend de :** T-01

### T-02b — Amendement des types : `CellPoint` et `ScreenPoint`
**Fichiers :** `js/core/types.js`
**Contexte :** T-02 a transcrit fidèlement le CdC, mais celui-ci typait la géométrie en
unités de case avec la même forme `{x, y}` que les pixels. Le typage étant structurel, les
deux étaient interchangeables — le **piège n°1 du projet était invisible au typechecker**.
Défaut du plan, corrigé dans `CONVENTIONS.md` §1.

**Contrat :**
- Ajouter `/** @typedef {{cellX:number,cellY:number}} CellPoint */` et
  `/** @typedef {{screenX:number,screenY:number}} ScreenPoint */`.
- Remplacer par `CellPoint` **toutes** les coordonnées en unités de case :
  `Level.walls` → `CellPoint[][]` ; `Portal.a` / `Portal.b` → `CellPoint` ;
  `Light` → remplacer `x`/`y` par `at: CellPoint` ; `LinkEndpoint` → remplacer `x`/`y` par
  `at: CellPoint`.
- `MapPoint` reste `{x, y}` et désigne **exclusivement** des pixels.
- Ajouter `Presence` : `{ role: 'gm'|'players', at: number, build: number, label: string }`.
- Rendre `GridConfig.offsetX` et `offsetY` **obligatoires** — un offset absent fait
  silencieusement échouer l'alignement `map_origin`, alors qu'un `0` explicite est vérifiable.

**Vérification :** `pnpm run typecheck` propre. Puis un test d'incompatibilité jetable :
affecter un `MapPoint` à un `CellPoint` doit produire une erreur `tsc`. **Supprimer le
fichier de test après vérification** — il n'est pas au manifeste ; en reporter la sortie
dans le rapport.
**Dépend de :** T-02

### T-03 — Constantes
**Fichiers :** `js/core/constants.js`
**Contrat :** `FOG_PX_PER_CELL = 8`, `MAX_TEXTURE_FALLBACK = 4096`,
`RENDER_RESOLUTION_CAP = 1.5`, `DRAG_HOLD_MS = 150`, `VIEW_PUBLISH_HZ = 10`.
Chaque constante commentée en français avec sa justification.
**Vérification :** `tsc` propre.
**Dépend de :** T-01

### T-03b — Version estampillée & vérification des dépendances
**Fichiers :** `scripts/stamp-version.mjs`, `scripts/check-deps.mjs`, `js/core/version.js`
**Contrat :** cf. `STACK.md` §5bis.
- `stamp-version.mjs` lit `package.json`, incrémente le compteur de build, relève
  `git rev-parse --short HEAD`, écrit `js/core/version.js`. Node pur, cross-platform.
  Le fichier généré porte un en-tête « ne pas éditer à la main ».
- `check-deps.mjs` lit l'import map de `index.html`, requête chaque URL en `HEAD`, et
  **sort en code non nul** si l'une ne répond pas 200.
- **Créer `index.html` réduit à son import map** (doctype, `<head>`, bloc `importmap`,
  `<body>` vide). C'est une dépendance réelle de `check-deps.mjs` : sans lui, les versions
  n'ont pas de domicile. T-22 construira le reste de la page **par-dessus**, sans jamais
  dupliquer l'import map ailleurs. `player.html` recevra le **même** import map à T-23.
- Comparaison au registre npm : **avertissement informatif uniquement**, jamais bloquant.
  Une version en retard n'est pas une erreur, un 404 en est une.
- Ajouter les scripts `stamp` et `check-deps` dans `package.json`.

**Placée tôt à dessein :** la version doit être disponible dès les premiers tests, pas
ajoutée à la fin.
**Vérification :** `node scripts/stamp-version.mjs` deux fois de suite incrémente bien le
build et laisse le fichier valide pour `tsc` ; `node scripts/check-deps.mjs` sort en 0 sur
l'import map figée, et en non-nul si on y introduit une version inexistante.
**Dépend de :** T-01

### T-03c — Rétablir le typage réel des scripts
**Fichiers :** `package.json`, `scripts/stamp-version.mjs`, `scripts/check-deps.mjs`
**Contexte :** T-03b a livré les deux scripts en `// @ts-nocheck`. Le critère « typecheck
propre » était donc satisfait **en désactivant la vérification**, pas en la passant. La cause
est un manque du plan : `@ts-check` était imposé partout et `scripts/**/*` inclus dans
`jsconfig.json`, sans que `@types/node` soit autorisé — les modules `node:*` ne pouvaient
pas être typés. Corrigé dans `STACK.md` §4.

**Contrat :**
- Ajouter `@types/node` en `devDependencies` (désormais autorisé).
- **Supprimer `// @ts-nocheck`** des deux scripts et le remplacer par `// @ts-check`.
  Corriger les erreurs de type qui apparaissent — sans jamais réintroduire de suppression.
- `check-deps.mjs` : ajouter la comparaison au registre npm en **avertissement non
  bloquant** (une version en retard n'échoue pas ; un statut ≠ 200 échoue).
- `stamp-version.mjs` : le `catch` autour de `git rev-parse` avale l'erreur en silence.
  Émettre un avertissement sur `stderr` avant de retomber sur `commit: 'unknown'`
  (cf. `CONVENTIONS.md` §6 — échouer bruyamment).

**Vérification :** `pnpm run typecheck` propre **sans aucun `@ts-nocheck` ni `@ts-ignore`
dans le dépôt** — le vérifier par recherche explicite et reporter le résultat.
`node scripts/check-deps.mjs` sort toujours en 0 sur l'import map figée.
**Dépend de :** T-03b

### T-04 — Clés canoniques
**Fichiers :** `js/core/cellKey.js`, `tests/cellKey.test.mjs`
**Contrat :** `cellKey`, `parseCellKey`, `edgeKey` conformes à `CONVENTIONS.md` §2.
`edgeKey` **doit** être commutatif (tri lexicographique des deux clés).
**Vérification :** test unitaire — aller-retour `cellKey`/`parseCellKey` sur valeurs
négatives et nulles ; `edgeKey(A,B) === edgeKey(B,A)` sur 20 paires ; collision impossible
entre `{a:1,b:23}` et `{a:12,b:3}`.
**Dépend de :** T-01

### T-05 — Interfaces
**Fichiers :** `js/grid/GridAdapter.js`, `js/transport/Transport.js`
**Contrat :** copier les interfaces de `ARCHITECTURE.md` §3 **à l'identique**. Aucune
implémentation. C'est le contrat que le reste du lot respecte.
**Vérification :** `tsc` propre ; les deux fichiers ne contiennent aucune fonction.
**Dépend de :** T-02

### T-06 — Schéma & validation
**Fichiers :** `js/core/schema.js`, `tests/schema.test.mjs`
**Contrat :** fabriques (`createCampaign`, `createLevel`, `createToken`) avec valeurs par
défaut du cahier des charges §6, plus `validateCampaign(obj)` retournant une liste
d'erreurs explicites. `schemaVersion: 2`. Validation refusant : coordonnées de pion non
entières, `levelId` inconnu, `sizeCells < 1`.
**Vérification :** test unitaire couvrant les trois refus ci-dessus.
**Dépend de :** T-02, T-04

### ⛔ POINT DE CONTRÔLE 1
Les fondations sont-elles conformes ? On relit les types, les clés, les interfaces.
**Ne pas commencer T-07 avant validation.**

---

## Étape 2 — Grille & déplacement (pure logique, testable sans navigateur)

### T-07 — Grille carrée
**Fichiers :** `js/grid/SquareGrid.js`, `js/grid/index.js`, `tests/squareGrid.test.mjs`
**Contrat :** implémenter toute l'interface `GridAdapter` sauf `cellsInRange` (T-09) et
`renderGrid` (T-14) — les laisser lever `new Error('non implémenté')`.
`neighbors` retourne 8 voisines. `distance` en octile. `cellsOccupied` en bloc n×n.
`gridFor(level)` retourne l'adaptateur selon `level.grid.type` et lève sur `'hex'`.
**Vérification :** test unitaire — `cellFromPoint(pointFromCell(c)) === c` sur 100 cases,
y compris aux bords ; `distance` conforme à l'octile sur 10 paires connues.
**Dépend de :** T-05

### T-08 — Masque d'arêtes (stub)
**Fichiers :** `js/import/blockedEdges.js`
**Contrat :** exporter `computeBlockedEdges(level, grid)` retournant un `Set<string>`
**vide** au lot 1a, avec un commentaire renvoyant au lot 2. La signature est figée
maintenant pour que `cellsInRange` la consomme dès le départ.
**Vérification :** `tsc` propre.
**Dépend de :** T-04

### T-09 — Cases atteignables
**Fichiers :** `js/movement/reachable.js`, `js/movement/path.js`,
`tests/reachable.test.mjs`
**Contrat :** Dijkstra pondéré, exposé via `SquareGrid.cellsInRange`. Coût octile
(orthogonal 1, diagonale 1.5). **Corner-cutting interdit** : une diagonale n'est
franchissable que si les deux arêtes orthogonales adjacentes le sont. `path.js` reconstruit
un chemin depuis la chaîne de prédécesseurs.
> Le projet `shadowrunbank` contient une implémentation qui fonctionne
> (`reachableCells` dans `js/map.js`). **La transposer plutôt que la réinventer** — même
> logique de coût et d'anti-corner-cutting, adaptée à l'interface `GridAdapter` et aux clés
> d'arête de `CONVENTIONS.md` §2.

**Vérification :** test unitaire sur une grille 10×10 — budget 1 donne 8 cases ; budget 2
en donne 24 ; une arête bloquée retire les cases attendues ; une diagonale entre deux
arêtes bloquées est refusée.
**Dépend de :** T-07, T-08

### ⛔ POINT DE CONTRÔLE 2
Le cœur logique est-il correct ? C'est la brique la plus facile à casser subtilement.

---

## Étape 3 — Import (Node, sans navigateur)

### T-10 — Parsing UVTT
**Fichiers :** `js/import/uvtt.js`, `tests/uvtt.test.mjs`
**Contrat :** `parseUvtt(json)` → `{ level, imageBase64 }`. Fonction **pure** : aucune
I/O, aucun DOM, donc testable sous Node comme dans le navigateur.
Pièges du cahier des charges §8 à traiter explicitement :
- `line_of_sight`, `objects_line_of_sight`, `portals`, `lights` sont en **unités de case** —
  ne pas convertir en pixels, le modèle reste en cases.
- L'alignement vient de `resolution.map_origin`. Il n'existe **aucun** champ d'offset.
- `environment.baked_lighting: true` → renseigner `level.ambient.baked` et le signaler.
- `grid.type` vaut `'square'` par défaut.
**Vérification :** test contre les fixtures (`docs/FIXTURES.md`) — les coordonnées de murs
attendues sont en cases, `map_origin` est appliqué, `baked` est détecté.
**Dépend de :** T-06

### T-11 — Rééchantillonnage & CLI d'import
**Fichiers :** `scripts/resample.mjs`, `scripts/import-uvtt.mjs`
**Contrat :** CLI Node — lit un `.uvtt`, décode l'image, rééchantillonne à un `pxPerCell`
cible (défaut 140, plafond `MAX_TEXTURE_FALLBACK`), écrit un WebP dans `maps/`, émet le
document de scène en JSON. **Cross-platform strict** : `node:path` uniquement, aucun appel
shell. Signale si l'image source dépasse la limite de texture.
**Vérification :** exécution sur la fixture produisant un fichier dans `maps/` et un JSON
valide selon `validateCampaign`. Doit fonctionner sous Windows.
**Dépend de :** T-10

### T-12 — Calibration d'image simple
**Fichiers :** `js/import/imageCalibrate.js`, `tests/imageCalibrate.test.mjs`
**Contrat :** `calibrateFromRect({rectPx, cellsWide, cellsHigh, imageSize})` →
`{pxPerCell, offsetX, offsetY, widthCells, heightCells}`. Logique pure, sans DOM.
Un étage ainsi créé n'a **ni murs ni lumières** — c'est attendu et jouable.
**Vérification :** test unitaire — un rectangle de 700 px sur 5 cases donne
`pxPerCell = 140` ; l'offset se déduit correctement d'un rectangle non aligné sur 0,0.
**Dépend de :** T-06

### ⛔ POINT DE CONTRÔLE 3
L'import produit-il des données conformes ? C'est ici que se joue le piège des unités.

---

## Étape 4 — État & transport

### T-13 — Store
**Fichiers :** `js/state/store.js`, `js/state/selection.js`
**Contrat :** source de vérité unique + signal de changement. Mutations par fonctions
nommées uniquement (`moveToken`, `setSelection`, `loadCampaign`…). Aucune affectation
directe depuis l'extérieur. `selection.js` conserve le pion sélectionné et le résultat
courant de `cellsInRange`.
**Vérification :** test unitaire — muter hors des fonctions exposées est impossible ; le
signal se déclenche une seule fois par mutation.
**Dépend de :** T-06

### T-14 — Transport Firebase
**Fichiers :** `js/transport/FirebaseTransport.js`, `js/transport/LocalSocketTransport.js`
**Contrat :** implémenter `Transport`. **Seul fichier du projet important `firebase/*`.**
Realtime Database pour les événements, Firestore pour le document de campagne.
`snapshot()` retourne l'état complet et est **toujours** appelé avant le premier delta.
`LocalSocketTransport` est un stub qui lève.
**Vérification :** test d'intégration — deux clients, l'un publie `token.move`, l'autre le
reçoit ; une reconnexion appelle bien `snapshot()` en premier.
**Dépend de :** T-13

### ⛔ POINT DE CONTRÔLE 4
Le confinement de Firebase tient-il ? Le test d'architecture n°2 doit passer.

---

## Étape 5 — Rendu

### T-15 — Scène Pixi & boucle à la demande
**Fichiers :** `js/render/stage.js`, `js/render/camera.js`, `js/render/frame.js`
**Contrat :** `await app.init()` en idiome v8, `resolution` plafonnée à
`RENDER_RESOLUTION_CAP`, `antialias: false`. Couches créées dans l'ordre de
`ARCHITECTURE.md` §5. `camera.js` est le **seul** convertisseur carte ⇄ écran.
`frame.js` coalesce les demandes sur rAF et **arrête le ticker** quand rien n'est animé.
**Vérification :** test Playwright — après 2 s d'inactivité, le compteur de frames rendues
n'augmente plus. *(La tenue à 30 fps sous cast n'est pas vérifiable ici : à signaler comme
« à vérifier par le mainteneur ».)*
**Dépend de :** T-13

### T-16 — Couches fond & grille
**Fichiers :** `js/render/layers/background.js`, `js/render/layers/gridLayer.js`, et
`SquareGrid.renderGrid`
**Contrat :** fond via `Assets.load`. `gridLayer` **délègue** entièrement le tracé à
`grid.renderGrid` — aucune géométrie de case dans la couche. Opacité, couleur et
visibilité réglables.
**Vérification :** test Playwright de capture — la grille s'aligne sur l'image de la
fixture ; le test d'architecture n°1 (`pxPerCell` confiné) passe toujours.
**Dépend de :** T-15, T-07

### T-17 — Pions
**Fichiers :** `js/render/layers/tokens.js`
**Contrat :** rendu des pions avec `sizeCells`, bordure colorée, anneau de sélection, badge
d'élévation si non nul, emplacement des marqueurs prévu mais vide. Les PNJ `hidden` sont
invisibles en vue joueurs, semi-transparents en vue MJ.
**Vérification :** Playwright — un pion `sizeCells: 2` couvre 2×2 cases ; un PNJ `hidden`
est absent du rendu joueurs et présent en MJ.
**Dépend de :** T-16

### T-18 — Zone de déplacement
**Fichiers :** `js/render/layers/moveZone.js`
**Contrat :** surligne les cases atteignables du pion sélectionné, à la couleur du pion.
**Couche non interactive** — le hit-test passe par `pointer.js`, jamais par cette couche.
**Vérification :** Playwright — sélectionner un pion `speedCells: 3` surligne exactement
les cases retournées par `cellsInRange`.
**Dépend de :** T-17, T-09

### ⛔ POINT DE CONTRÔLE 5
Le rendu est-il correct et la boucle s'arrête-t-elle bien à l'inactivité ?

---

## Étape 6 — Interaction

### T-19 — Gestes & pointeur
**Fichiers :** `js/input/pointer.js`, `js/input/gestures.js`
**Contrat :** traduire les événements pointeur en **intentions abstraites**
(`tapCell`, `tapToken`, `panBy`, `pinchZoom`, `longPress`) sans connaître le store.
- **Vue joueurs : le drag à un doigt est le pan de la carte, jamais un déplacement de
  pion.** Interdiction n°1.
- Vue MJ : drag de pion autorisé, seuil `DRAG_HOLD_MS` pour distinguer tap et drag, et
  **rien n'est publié avant le `pointerup`** (interdiction n°9).
**Vérification :** Playwright — un drag d'un doigt sur la vue joueurs déplace la caméra et
laisse tous les pions en place.
**Dépend de :** T-15

### T-20 — Déplacement type plateau
**Fichiers :** `js/ui/player/bootstrap.js`, complément de `js/state/store.js`
**Contrat :** enchaînement complet — tap pion PJ → sélection + `cellsInRange` ; tap case
atteignable → `moveTokenToCell` + publication de `token.move` avec `{from, to, path,
startedAt}` ; tap sur le vide → désélection. Respecter `playerMovable` et `locked`.
Animation déterministe : position = fonction pure de `(Date.now() - startedAt)`, aucune
position intermédiaire publiée.
**Vérification :** Playwright deux onglets — un déplacement sur la vue joueurs apparaît en
vue MJ ; une case hors portée est refusée ; les coordonnées restent entières.
**Dépend de :** T-19, T-14, T-18

### T-21 — Générateur de pions
**Fichiers :** `js/ui/gm/tokenMaker.js`
**Contrat :** import d'image par glisser-déposer ou sélecteur, recadrage circulaire ou
carré au canvas natif (zoom + déplacement), choix PJ/PNJ, couleur de bordure, `sizeCells`,
`speedCells`. Produit un dataURL **écrit sur disque dans `maps/`** — jamais transmis sur le
réseau (interdiction : pas d'image sur le transport).
**Vérification :** manuel + Playwright sur la génération d'un pion valide selon `createToken`.
**Dépend de :** T-13

### T-22 — Panneau MJ & import
**Fichiers :** `js/ui/gm/panel.js`, `js/ui/gm/importPanel.js`, `js/app/gm.js`,
`index.html`, `css/gm.css`
**Contrat :** panneau latéral assemblant import (UVTT + image avec assistant de
calibration), générateur de pions, réglages de grille. Import UVTT **en vue MJ
uniquement** (interdiction n°11).
**Vérification :** Playwright — importer la fixture UVTT et un JPG calibré aboutit dans les
deux cas à une carte jouable.
**Dépend de :** T-21, T-11, T-12

### T-23 — Vue joueurs autonome
**Fichiers :** `player.html`, `css/player.css`, `js/app/player.js`
**Contrat :** URL autonome avec `?session=` et `?camera=follow`. CSS Zero-UI de
`ARCHITECTURE.md` §6. Verrouillage d'orientation, Wake Lock si contexte sécurisé, plein
écran. **Aucun élément d'interface** (interdiction n°2).

L'import map de `player.html` doit être **strictement identique** à celle d'`index.html`.
Étendre `scripts/check-deps.mjs` pour vérifier les deux fichiers et **échouer si leurs
import maps diffèrent** — c'est la seule garantie mécanique contre une dérive de version
entre les deux vues, qui produirait deux clients incompatibles sur la même session.
**Vérification :** Playwright — le DOM de `player.html` ne contient ni `<button>`, ni
`<nav>`, ni `<input>` hors du canvas ; `overscroll-behavior` et `touch-action` sont bien
appliqués. *(L'overlay de version de T-24b est la seule exception tolérée, et il n'est ni
interactif ni persistant.)*
**Dépend de :** T-20

### T-24 — Persistance & reconnexion
**Fichiers :** complément de `js/state/store.js` et `js/transport/FirebaseTransport.js`
**Contrat :** document de campagne persisté dans Firestore, repli LocalStorage. À la
connexion, `snapshot()` complet **avant** tout delta. Un F5 en cours de partie restaure
l'état intégral.
**Vérification :** Playwright — recharger la vue joueurs pendant une séance restaure
positions, sélection d'étage et caméra en moins de 3 s.
**Dépend de :** T-23

### T-24b — Badge de version & détection de désynchronisation
**Fichiers :** `js/ui/versionBadge.js`, `js/state/presence.js`, compléments de
`js/transport/FirebaseTransport.js`
**Contrat :** cf. `STACK.md` §5bis.
- Chaque client publie `{role, at, build, label}` dans son enregistrement de présence.
- **Vue MJ :** badge permanent discret en pied de panneau. En cas d'écart de `build` avec un
  client connecté, **bannière persistante et voyante** nommant les deux builds et l'action à
  faire.
- **Vue joueurs :** overlay 4 s au chargement puis disparition totale,
  `pointer-events: none`, rappelable par **tap à trois doigts**. En cas d'écart, l'overlay
  devient persistant et rouge.
- Ce sont les **deux seules dérogations** à l'interdiction n°2. Ne rien ajouter d'autre.

**Vérification :** Playwright deux onglets — forcer un `build` différent sur l'un fait
apparaître la bannière MJ **et** l'overlay rouge côté joueurs ; sans écart, l'overlay joueurs
a bien disparu du DOM (ou est en `opacity: 0` et non interactif) après 5 s ; le tap à trois
doigts le rappelle.
**Dépend de :** T-24, T-03b

### T-25 — Tests de conformité architecturale
**Fichiers :** `tests/architecture.test.mjs`
**Contrat :** les 7 tests de `ARCHITECTURE.md` §4.
> À écrire **en dernier mais à faire passer sur tout l'existant**. Un échec révèle une
> dérive introduite en chemin : il se corrige, il ne se contourne pas.

**Vérification :** les 7 tests passent sur l'intégralité de `js/`.
**Dépend de :** T-24

### ⛔ POINT DE CONTRÔLE 6 — fin de lot
Revue complète, puis **une vraie séance de jeu** avant d'écrire le lot 1b.

---

## Récapitulatif des dépendances

```
T-01 ─┬─ T-02 ─┬─ T-05 ── T-07 ─┬─ T-09 ── (T-18, T-20)
      │        │                │
      ├─ T-03  ├─ T-06 ─┬─ T-10 ── T-11 ─┐
      │        │        ├─ T-12 ─────────┤
      └─ T-04 ─┴─ T-08 ─┘                │
               └─ T-13 ─┬─ T-14 ─────────┤
                        └─ T-15 ── T-16 ── T-17 ── T-18
                                            │
                        T-19 ───────────────┴── T-20 ── T-23 ── T-24 ── T-25
                        T-21 ── T-22 ───────────────────┘
```

## Ce que le lot 1a ne contient pas

Sans lignes de vue, sans fog, sans portes, sans étages multiples, sans lumière, sans
gabarits, sans marqueurs affichés, sans bibliothèques, sans révélation d'image, sans
hexagone. **C'est volontaire.** Toute tentative d'anticiper ces lots est un écart à
signaler, pas une initiative.
