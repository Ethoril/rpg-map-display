# ÉTAT D'AVANCEMENT & REPRISE

> Dernière mise à jour : **28 juillet 2026** — T-15b (vrai PixiJS, deux exécuteurs de tests),
> T-13 (store) et T-14 (transport Firebase), les deux dernières corrigées en relecture.
> **Point de contrôle 4 atteint.**
> Document vivant : à réactualiser à chaque fin de séance de travail.

---

## 1. Reprise sur une nouvelle machine — à faire dans cet ordre

### ⚠️ Étape 1 : l'identité git, AVANT tout commit

**La configuration d'identité est locale au dépôt et ne survit pas à un clone.** La
configuration globale de la machine d'origine était vide : rien ne protège par défaut.
Sans ce geste, un commit peut publier une identité nominative sur un dépôt public.

```
git clone https://github.com/Ethoril/rpg-map-display.git
cd rpg-map-display
git config user.name 'ethoril'
git config user.email 'ethoril@gmail.com'
git config user.name && git config user.email     # vérifier avant de continuer
```

### Étape 2 : dépendances et contrôles

```
pnpm install
pnpm exec playwright install chromium   # une fois par machine, ~115 Mo
pnpm run typecheck      # doit sortir en 0, sans aucune erreur
pnpm run check-deps     # 5 URLs en 200 + versions devDependencies alignées
pnpm run test:unit      # node:test — logique pure
pnpm run test:e2e       # Playwright — navigateur, vrai Pixi (réseau requis : CDN)
pnpm stamp              # incrémente le build et régénère js/core/version.js
```

Les deux tests Firebase de `test:e2e` s'**auto-ignorent** sans configuration. Pour les exécuter,
exporter la configuration du projet **avant** de lancer la suite — jamais dans un fichier du
dépôt (cf. §7) :

```
$env:RPG_FIREBASE_CONFIG = (Get-Content <chemin hors dépôt> -Raw).Trim()   # PowerShell
pnpm run test:e2e
```

Le JSON doit contenir `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`, plus
`testEmail` et `testPassword` (compte technique). Sans les deux derniers, les tests s'ignorent
avec la raison affichée.

Si `pnpm` n'est pas dans le PATH, `corepack pnpm …` fonctionne sans installation (corepack est
livré avec Node). C'était le cas de la machine de développement Windows.

Si `typecheck` ou `check-deps` échoue sur un dépôt fraîchement cloné, **ne pas commencer
une tâche** : quelque chose a changé côté CDN ou côté outillage, et c'est à diagnostiquer
d'abord.

`test:e2e` charge Pixi depuis le CDN, comme la vraie application : sans réseau, il échoue — et
c'est voulu. Un test de rendu qui passe hors ligne ne teste pas le chargement réel.

### Servir l'application

Zéro build : GitHub Pages sert la racine de `main` telle quelle, aucun workflow d'Actions
n'est nécessaire. Réglage unique, côté GitHub : *Settings → Pages → Source : Deploy from a
branch → `main` / `/ (root)`*. Les pages sont alors à
`https://ethoril.github.io/rpg-map-display/` — et `…/diag.html` pour les mesures matérielles.

En local, `pnpm run serve` sert la même chose sur `http://127.0.0.1:4173`.

### Étape 3 : ce qui ne voyage pas avec le dépôt

- `node_modules/` — reconstruit par `pnpm install`.
- `fixtures/real/` — **ignoré par git**. Les exports UVTT réels sont à redéposer à la main
  (cf. `FIXTURES.md` §1). `tests/realUvtt.test.mjs` parse tout ce qui s'y trouve et
  **s'auto-ignore avec sa raison** quand le dossier est vide : tant qu'il s'ignore, le parsing
  UVTT n'est validé qu'en théorie.

  Un export réel a été déposé et **parsé avec succès le 28/07/2026** : 48 × 45 cases à
  140 px/case, 124 polylignes de murs (toutes à coordonnées entières, aucune dégénérée),
  37 portails tous fermés, **aucune lumière**, `grid_type` **absent** (d'où le carré par
  défaut), `map_origin` nul, image PNG de 4,6 Mo en base64 pour 6720 × 6300 px. Ces chiffres
  servent de profil de référence à `diag.html`.
- Aucune clé ni configuration Firebase n'existe encore dans le dépôt. Elle arrivera à T-14.

---

## 2. Où on en est

### Fait

**Fondations (T-01 à T-09, PC1 validé)** :
| Tâche | Objet |
|---|---|
| T-04 | Clés canoniques (`cellKey`, `parseCellKey`, `edgeKey` commutatif) |
| T-05 | Interfaces abstraites (`GridAdapter`, `Transport` — JSDoc pur) |
| T-06 | Schéma + validation (`createCampaign`, `createLevel`, `createToken`) |
| T-07 | Grille carrée : 8 voisines, distance octile, occupation n×n |
| T-08 | Masque d'arêtes (stub lot 1a) |
| T-09 | Cases atteignables : Dijkstra + **anti-corner-cutting** (4 arêtes bloquées) |

**Import & Calibration (T-10, T-12, T-11 refacto)** :
| Tâche | Objet |
|---|---|
| T-10 | Parsing UVTT pur (unités de case, détection baked_lighting, refus hex) |
| T-12 | Calibration image simple (`calibrateFromRect`, `calibrateImage`) |
| T-11 refacto | Rééchantillonnage avec Jimp + CLI d'import (maps/*.webp) |

**Rendu (T-15 puis T-15b — hors ordre, intégration en attente)** :
| Tâche | Objet |
|---|---|
| T-15 | Application Pixi v8 async, caméra MapPoint↔ScreenPoint, boucle rAF à la demande |
| T-15b | Vrai PixiJS rétabli (types + runtime), deux exécuteurs de tests séparés |

**État & transport (T-13, T-14 — point de contrôle 4 franchi)** :
| Tâche | Objet |
|---|---|
| T-13 | Store : état privé par fermeture, mutations nommées, signal unique, `selection.js` |
| T-14 | Transport Firebase : authentification explicite, tampon avant `snapshot()`, écoute bornée |

**État courant** : **build 9**, 17/28 tâches lot 1a complètes.

| Vérification | Résultat |
|---|---|
| `pnpm run typecheck` | propre, code 0 — **contre les vrais types Pixi 8.19.0** |
| `pnpm run test:unit` | **45 tests**, 45 passés (node:test) |
| `pnpm run test:e2e` | **5 tests**, 5 passés — dont 2 contre le **vrai projet Firebase**, en deux contextes de navigateur isolés |
| `pnpm run check-deps` | 5 URLs en 200, `pixi.js` devDependency alignée sur l'import map |

**À vérifier par le mainteneur** (interdiction n°14, aucun test ne peut les cocher) : tenue à
30 fps sous cast, comportement thermique sur 45 min, `MAX_TEXTURE_SIZE` réel de la Tab S9 FE,
latence Firebase à table. `antialias: false` et le plafond de résolution sont posés dans
`stage.js` et le plafond est vérifié par `test:e2e` ; leur **effet** à table ne l'est pas.

### Prochaine étape

**T-16 — Couches fond & grille**, puis T-17, T-18 et le **point de contrôle 5**.

Le transport et le store existent mais **ne sont pas encore reliés** : c'est `app/*` qui les
reliera (T-22, T-23). `state/*` n'importe pas `transport/*` et n'a jamais à le faire — c'est ce
qui rend le mode LAN possible sans refactor.

À trancher avant d'écrire T-16 : la décision n°10 ci-dessous (coût de lecture du store).

---

## 3. Comment relancer l'implémenteur

Message d'ouverture à donner tel quel :

> Lis `README.md`, puis dans l'ordre `docs/CAHIER-DES-CHARGES.md`, `docs/STACK.md`,
> `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`, `docs/TASKS-lot1a.md`, `docs/FIXTURES.md`
> et `docs/ETAT.md`. Ne code rien avant d'avoir tout lu.
> Puis réalise **uniquement la tâche T-16**, et arrête-toi. Rapport de trois lignes,
> terminé par la ligne « Écarts » même si elle est vide.

**Le « uniquement T-13 » est la partie qui compte.** Un modèle à qui l'on donne la liste
entière en enchaîne plusieurs et le contrôle point à point est perdu.

Après chaque correction apportée aux documents, **lui faire relire `CONVENTIONS.md`**. Les
écarts constatés jusqu'ici venaient tous d'une lecture périmée, pas d'une désobéissance.

---

## 4. Corrections du plan apportées en cours de route

Trois défauts ont été trouvés pendant les six premières tâches, et **les trois venaient des
documents de spécification**, pas de l'implémentation. Ils sont consignés ici parce qu'ils
expliquent des règles qui paraîtraient sinon arbitraires.

**Critère de vérification contradictoire (T-01).** Le critère exigeait que `tsc` s'exécute
sans erreur avec zéro fichier source — or `TS18003` sort en code 2 par construction. D'où
la règle : *un critère inatteignable est un défaut du plan, à signaler et arbitrer, jamais
à contourner ni à déclarer satisfait.* Commit `0a124d0`.

**Unités indistinguables par le compilateur (T-02).** Le CdC typait la géométrie en unités
de case avec la même forme `{x, y}` que les pixels. Le typage JavaScript étant structurel,
les deux étaient interchangeables : **le piège n°1 du projet échappait au typechecker.**
D'où les quatre formes à noms de propriétés distincts — `Cell {a,b}`,
`CellPoint {cellX,cellY}`, `MapPoint {x,y}`, `ScreenPoint {screenX,screenY}`. Elles ne sont
pas une coquetterie : elles rendent un mélange d'unités **impossible à compiler**.
Commits `aa9dec4`, `2131870`.

**Vérification impossible, donc désactivée (T-03b).** `@ts-check` était imposé partout et
`scripts/**/*` inclus dans `jsconfig.json`, sans que `@types/node` soit autorisé — les
modules `node:*` étaient intypables. Le contournement par `@ts-nocheck` était la seule issue
laissée par le plan. D'où l'autorisation de `@types/node` et l'**interdiction 16** : ne
jamais désactiver une vérification pour la faire passer. Commits `6f36b97`, `0ccdab6`.

**Dépendance réelle remplacée par un faux (T-15 → T-15b).** La plus instructive des quatre,
parce qu'elle était **verte**. Pour rendre `stage.js` testable sous Node, trois gestes ont été
posés : deux classes Pixi factices ajoutées à `js/core/types.js`, un alias
`"pixi.js": ["./js/core/types.js"]` dans `jsconfig.json`, et un `try/catch` muet dans
`stage.js` basculant sur le faux. Résultat : typecheck propre, 33 tests verts — et **toute
l'API PixiJS v8 devenue `any`**, donc les pièges v7→v8 de `STACK.md` §3 redevenus
indétectables par machine. Le critère du contrat disait « test Playwright » ; il a été coché
par un test unitaire contre l'imitation.

Ni `@ts-nocheck` ni test commenté : l'interdiction 16 ne couvrait que les *coupures* de
vérification, pas les *contournements*. Elle couvre les deux depuis. D'où aussi le 8ᵉ test
d'architecture (`types.js` sans code exécutable — rien ne surveillait cette règle), la
séparation normative `*.test.mjs` / `*.spec.mjs`, et l'échec bloquant de `check-deps.mjs` sur
un désalignement de version entre l'import map et les devDependencies. Cf. T-15b.

**Test d'architecture n°1 infaisable tel qu'écrit (constaté avant T-25).** Le test confinait
toute occurrence de `pxPerCell` à `js/grid/` avec deux exceptions, alors que `js/import/uvtt.js`
et `js/import/imageCalibrate.js` en produisent par contrat (T-10, T-12) et convertissent
`map_origin` en offset pixel. Reformulé en « application case ⇄ pixel confinée », l'import
définissant le repère et `grid/` seul l'appliquant. Corrigé dans `ARCHITECTURE.md` §4 avant
d'écrire le test, pas en le contournant après.

**Consommateur privé du droit d'atteindre sa dépendance (T-13).** T-08 gèle la signature de
`computeBlockedEdges` « pour que `cellsInRange` la consomme dès le départ », mais la fonction
vit dans `js/import/` et la table d'importation n'autorisait `state/*` qu'à voir `core/*` et
`grid/*` : le consommateur désigné ne pouvait pas légalement l'appeler. `selection.js` a donc
été livrée avec un `new Set()` recréé sur place — un contournement qui aurait rendu les murs du
lot 2 **sans effet sur les déplacements**, avec un symptôme très éloigné de sa cause.
`state/* → import/*` est désormais autorisé (`ARCHITECTURE.md` §2) : `import/*` est de la
logique pure, et au lot 2 les arêtes bloquées seront un état vivant — une porte qui s'ouvre les
change en pleine partie — donc leur place est dans le store.

Deux défauts mineurs sont sortis avec : le plan nommait la même mutation `moveToken` (T-13) et
`moveTokenToCell` (T-20, `CONVENTIONS.md` §5), ce qui a produit un alias — un seul nom
désormais, `moveTokenToCell` ; et T-13 exigeait un test unitaire sans lister de fichier de
test, comme T-12 avant elle. `tests/store.test.mjs` est maintenant au contrat.

**Troisième vert obtenu par neutralisation (T-13).** Quatre `@ts-ignore` masquaient un
`TS2540` (propriété en lecture seule) et deux `TS18047` (`possibly null`) — le quatrième ne
masquait rien du tout, pur réflexe. Remplacés par un transtypage ciblé et deux `assert.ok`.
Le motif se répète assez pour être nommé : **quand le typage résiste, il est mis de côté au
lieu d'être écouté.** C'est la première chose à vérifier en relecture, avant même la
fonctionnalité — `pnpm run typecheck` en code 0 ne prouve rien tant qu'on n'a pas cherché ce
qui a été fait taire.

**Échec bruyant, deuxième leçon (T-14).** Le transport livré appelait `signInAnonymously` et
**avalait l'échec dans un `console.warn`** avant de continuer. Une fois le fournisseur anonyme
désactivé, la séquence réelle observée fut : `auth/admin-restricted-operation` (message parfait,
ignoré) → `permission_denied` sur l'écriture (message trompeur, qui ne parle pas
d'authentification) → test rouge sans cause lisible. Le diagnostic exact était disponible à la
première ligne et avait été jeté.

Pire : `publish()` n'attendait pas le résultat de `push()`. L'erreur n'est ressortie que parce
que Playwright signale les rejets non gérés — **dans le navigateur, à table, un pion déplacé
n'aurait tout simplement pas bougé sur les autres écrans, sans le moindre message.** D'où
`onError()` sur le transport, et la relance hors pile en l'absence d'abonné : une écriture
refusée doit toujours finir par se voir.

**Rejeu d'historique à la reconnexion (T-14).** `onChildAdded` sur une référence nue rejoue
**tous** les enfants déjà présents. Le canal d'événements étant en ajout pur, un client
reconnecté se voyait resservir la séance entière. Corrigé en relevant la dernière clé puis en
n'écoutant qu'au-delà (`orderByKey()` + `startAfter`). Deux pièges rencontrés en le faisant :
la sentinelle `startAfter('')` ne livre **plus rien** — RTDB exige une clé valide, il faut donc
brancher explicitement sur le cas « canal vide » ; et les règles n'autorisant que
`session/$id/events`, toute écriture au niveau `session/$id` est refusée, y compris une
suppression de branche.

**Deux clients qui n'en font qu'un (T-14).** Le test livré instanciait deux transports dans le
même processus Node. Or `getApps().length === 0 ? initializeApp() : getApp()` fait réutiliser
l'application par le second : une seule session, une seule connexion, aucun navigateur. Il ne
prouvait rien. Deux clients, ici, ce sont **deux contextes de navigateur**. Et son assertion ne
vérifiait que l'arrivée de l'événement, jamais qu'aucun n'avait été livré *avant* `snapshot()` —
le tampon pouvait être absent, le test restait vert. La règle qui en sort : **un test dont
l'intitulé énonce un ordre doit asserter l'ordre**, c'est-à-dire vérifier aussi le silence.

**Enseignement transposable :** un plan précis ne garantit pas un plan correct — il rend ses
propres défauts détectables vite. Et le défaut le plus coûteux n'est pas une vérification
absente, c'est une vérification **satisfaite contre une imitation** : elle ferme la question.
Les deux tâches où une ambiguïté coûtera le plus cher sont **T-09** (Dijkstra,
anti-corner-cutting) et **T-10** (parsing UVTT, unités de case) : ce sont celles reposant sur
les spécifications les plus denses, à relire lentement.

---

## 5. Points de vigilance pour les tâches à venir

| Tâche | Ce qui peut déraper |
|---|---|
| T-05 | Les interfaces sont un **contrat** : les copier à l'identique depuis `ARCHITECTURE.md` §3, sans implémentation. |
| T-07 | Renommer `{a, b}` en `{col, row}` « pour la lisibilité » tue la compatibilité hexagonale de tout le projet. Violation la plus probable, et bien intentionnée. |
| T-09 | Transposer le `reachableCells` existant de `shadowrunbank` plutôt que réinventer le Dijkstra. Anti-corner-cutting : une diagonale exige les deux arêtes orthogonales libres. |
| T-10 | Coordonnées UVTT en **unités de case**, jamais en pixels. Aucun champ d'offset : l'alignement vient de `map_origin`. `baked_lighting` à détecter. |
| T-14 | Le transport se branche **autour** du store : `state/*` n'importe pas `transport/*`. C'est `app/*` qui relie les deux. Un store qui publie lui-même traverserait tout le confinement Firebase. |
| T-16 | `SquareGrid.renderGrid` reçoit un **vrai** `Graphics` Pixi : la couche se vérifie en `tests/*.spec.mjs`, jamais en test unitaire. Le test « lève non implémenté » de `squareGrid.test.mjs` doit disparaître, pas être adapté. |
| T-19 | Le drag tactile en vue joueurs est **interdit** (interdiction n°1) — le drag à un doigt est le pan de la carte. |
| T-22 | `index.html` existe déjà avec son import map : construire **par-dessus**, ne jamais dupliquer l'import map. |
| T-23 | L'import map de `player.html` doit être identique à celle d'`index.html`, et `check-deps.mjs` doit le vérifier. |
| T-25 | Un test d'architecture qui échoue révèle une dérive : il se corrige, il ne se contourne pas. |

**Jamais délégable :** les critères de performance (30 fps sous cast, arrêt de la boucle
rAF, tenue thermique sur 45 min, `MAX_TEXTURE_SIZE` réel de la Tab S9 FE, latence Firebase à
table). Ils exigent le matériel physique. Aucun modèle ne peut les cocher.

**Mais ils sont mesurables, et l'outil existe :** `diag.html` (point d'entrée
`js/app/diag.js`). Cinq mesures, à lancer **depuis la tablette elle-même** :

| Bouton | Ce qu'il tranche |
|---|---|
| 1. Environnement & limites GPU | `MAX_TEXTURE_SIZE` réel, `devicePixelRatio`, WebGL/WebGPU, GPU → **décision n°1** |
| 2. Coût de lecture du store | `getState()` et `getActiveLevel()` en ms/appel sur 1000 segments de murs, comparés au budget d'une image à 30 fps → **décision n°12** |
| 3. Images par seconde (20 s) | fps moyen et minimum sur une scène de charge réaliste |
| 4. Tenue thermique (5 min) | dérive des fps par tranche de 30 s — révèle un bridage |
| 5. Latence Firebase | p50/p95 de l'aller-retour Realtime Database, seuil 250 ms → **décision n°2** |

La mesure 5 demande une connexion Google et la configuration collée une fois (conservée dans
le stockage local de l'appareil, jamais dans le dépôt). Elle exige que le domaine servant la
page figure dans **Firebase → Authentication → Settings → Authorized domains**.

Ce n'est ni la vue MJ ni la vue joueurs : les interdictions d'interface de la vue joueurs ne
s'y appliquent pas.

---

## 6. Décisions à trancher, en attente

Reprises de `CAHIER-DES-CHARGES.md` §12, plus celles apparues depuis :

1. `MAX_TEXTURE_SIZE` réel de la tablette → conditionne la résolution des cartes.
2. Latence Firebase mesurée à table → si le p95 dépasse ~250 ms, basculer
   `LocalSocketTransport`. À mesurer au lot 1a, avant de construire dessus.
3. Portes ouvrables par les joueurs, ou MJ seul ?
4. Ambiance lumineuse globale ou par étage ?
5. D'où viennent les cartes hexagonales ? Aucun outil UVTT n'en produit.
6. Forme des grandes créatures en hexagone (`sizeCells > 1`).
7. Jeu de marqueurs d'état — à arbitrer **après** une séance réelle, pas avant.
8. Gabarits manipulables par les joueurs ?
9. Ancrage des `animatedOverlays` : coin haut-gauche (actuel) ou centre ?
10. **Purge du canal d'événements.** Le canal `session/$id/events` est en ajout pur.
    `purgeEvents()` existe et les tests s'en servent, mais **rien ne l'appelle en séance** :
    quand purger — à la fermeture de session par le MJ, au bout de N événements, jamais ?
    À trancher quand une vraie séance aura montré le volume réel.
11. **Identifiants de session non devinables.** Les règles n'autorisent que deux identités, mais
    à l'intérieur de ces identités, tout `sessionId` est accessible. Le jour où l'application
    sera publique, la protection reposera sur l'imprévisibilité de l'identifiant : prévoir des
    identifiants aléatoires longs, pas `partie1`. À câbler à T-22/T-23.
12. **Coût de lecture du store, à trancher avant T-16.** `getState()` clone puis gèle
    profondément toute la campagne à chaque appel, et `getActiveLevel()` clone les `walls`
    d'un étage entier. T-16 et T-18 liront l'état à chaque redraw.

    **Mesuré** (bouton 2 de `diag.html`) sur le profil de l'export réel — 48 × 45 cases,
    124 polylignes de murs, 37 portails, 30 pions. Sur la machine de développement :
    `getState()` **0,75 ms**, `getActiveLevel()` **0,32 ms**, soit **3,2 %** du budget d'une
    image à 30 fps. Reste à mesurer sur la Tab S9 FE : un facteur 3 à 5 y est plausible, ce
    qui donnerait 10 à 15 % — supportable, mais plus du bruit.

    > Première mesure faite avec 1000 polylignes inventées : elle annonçait 21 % et concluait
    > « trop coûteux ». Le profil réel est huit fois plus léger. **Mesurer sur des chiffres
    > inventés produit une conclusion inventée** — c'est ce qui a justifié de déposer un export
    > réel avant de décider.

13. **`pxPerCell` fractionnaire après rééchantillonnage.** L'import réel a produit
    `pxPerCell = 85,333…` (4096 px ÷ 48 cases), parce que le rééchantillonnage vise la limite
    de texture et non un multiple du nombre de cases. Le total reste exact (48 × 85,333 = 4096,
    aucune dérive cumulée), mais les lignes du quadrillage ne tomberont pas sur des pixels
    entiers. À trancher quand T-16 tracera la grille, là où le symptôme se verra : plafonner à
    un `pxPerCell` entier (48 × 85 = 4080 px) coûte 16 px de large et rend l'alignement net.
14. **Publication des cartes sur un dépôt public.** `maps/` est commité par le manifeste, et
    GitHub Pages sert désormais la racine : **tout ce qui entre dans `maps/` est publié.**
    L'import de l'export réel y a écrit un WebP de 4,6 Mo — supprimé sans être commité, car la
    carte source peut être sous licence tierce. À trancher : ne commiter que des cartes dont on
    détient les droits, ou sortir `maps/` du dépôt. En attendant, **ne rien commiter dans
    `maps/` sans vérifier la licence**.

---

## 7. Ce qui n'est pas dans le dépôt

Deux éléments de contexte vivent hors du code et sont à rappeler à un assistant qui
reprendrait le projet sans historique de conversation :

- **La configuration Firebase et les deux comptes.** Le projet Firebase existe, avec Realtime
  Database, Firestore, et **deux fournisseurs seulement** : Google (restreint à
  `ethoril@gmail.com` par les règles) et e-mail/mot de passe pour **un** compte technique de
  test. **Le fournisseur anonyme est désactivé, et doit le rester.** Les règles n'ouvrent que
  `session/$id/events` (Realtime Database) et `campaigns/$id` (Firestore), et exigent
  `email_verified` pour le compte Google — mais **pas** pour le compte de test, où il vaut faux
  et le restera. La configuration ne vit **nulle part dans le dépôt** : elle est injectée au
  constructeur de `FirebaseTransport` par `app/*`, et fournie aux tests par
  `RPG_FIREBASE_CONFIG` (cf. §1). Une configuration Firebase web n'est pas un secret — elle
  part dans le navigateur — mais un dépôt public n'a aucune raison de la publier.
- **L'identité git** doit être `ethoril <ethoril@gmail.com>`, jamais le nom réel du
  mainteneur, sur ce dépôt comme sur `shadowrunbank`.
- **L'abandon du drag & drop** est une décision prise après test réel, qui a supprimé trois
  sous-systèmes (throttling réseau, rendu optimiste, verrou de saisie). Un assistant qui
  proposerait de « remettre » du drag tactile régresse le projet.

Le reste est autosuffisant : les six documents normatifs permettent de reprendre le projet
sans aucun historique de conversation. C'était une propriété recherchée.
