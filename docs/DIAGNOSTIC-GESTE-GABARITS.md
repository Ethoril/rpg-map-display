# DIAGNOSTIC — le glisser réel des gabarits, rouge en CI et vert partout ailleurs

> Écrit le 4 août 2026. **Ce brief ne corrige rien.** Il installe de quoi observer, parce que
> quatre diagnostics ont été réfutés par la mesure et que le cinquième ne peut pas se deviner.
>
> Objet unique : `tests/manuel/gmToolDisarmGeste.spec.mjs`, scénario des gabarits. Vert en local,
> y compris avec `CI=1` et six répétitions ; rouge sur le runner GitHub, de façon reproductible
> sur quatre runs (69 à 72 du 4 août 2026, vérifiés par l'API publique : l'étape `pnpm run verify`
> échoue aux quatre, en 62 à 65 s, contre 58 s au run 73 vert — la suite va au bout, ce n'est pas
> un dépassement de délai).
>
> **Ne pas rapatrier le test dans la porte de vérification.** Tant que la cause est inconnue, un
> test instable dans une porte bloquante retient des correctifs vérifiés par ailleurs — c'est
> exactement la décision du 4 août (commit `525a9aa`), et elle tient.

---

## 1. Ce qui est déjà réfuté, et qu'il ne faut pas refaire

Quatre hypothèses, quatre mesures, quatre réfutations. Elles sont dans l'en-tête du fichier de
test et dans le message de `525a9aa`. **Aucune ne doit être rejouée** :

1. **Course d'ajustement de la caméra** — la trace du run 69 montre des coordonnées justes,
   `(406, 306)` tombait bien sur le pion. `waitForCameraOn` exprime la précondition.
2. **État accumulé entre les étapes** — le découpage en trois tests indépendants, chacun sur une
   page neuve, n'a rien changé. *Voir cependant le §3 : ce découpage n'a supprimé que l'état de la
   page, pas la position dans le processus de test.*
3. **Déclenchement du minuteur d'appui long** — démontré comme *pouvant* casser le glisser, en
   portant l'attente entre `down` et `move` à 700 ms ; mais le retrait de cette attente n'a pas
   suffi à faire verdir la CI.
4. **Défilement du panneau décalant le canvas** — mesuré : canvas à `(0, 0)`, `scrollY` nul,
   `scrollHeight === clientHeight` sur les trois panneaux.

## 2. Le fait central, et pourquoi l'observation de l'état est épuisée

L'état joint au message d'échec est **normal à chaque échec** : `outilActif: "none"`, les trois
outils désarmés, `ongletVisible: "token-maker"`, pion en `(4, 4)`, et `caseSousLePoint` égale
`(4, 4)`. Donc `canStartTokenDrag` (`js/app/gm.js:921-929`) rend bien l'identifiant du pion, et le
blocage est **après le `pointerdown`**.

Or `js/input/pointer.js` compte **cinq chemins qui abandonnent le glisser sans lever, sans
journaliser, et sans laisser de trace dans l'état final**. Chacun rend un état d'après-coup
identique à celui d'un glisser réussi, puisque `handlePointerUp` remet tout à `idle` :

| # | Chemin | Ce qui se passe | Signature dans le journal demandé |
|---|---|---|---|
| A | `handleWindowBlur` → `resetInteraction()` (`pointer.js:482`, `137-153`) | `activePointers.clear()`, `mode = 'idle'`, `dragTokenId = null`. Les `pointermove` et le `pointerup` suivants sortent en première ligne sur `!this.activePointers.has(e.pointerId)` | un `blur` de fenêtre entre le `down` et le premier `move` ; puis des `pointermove` reçus mais **aucune** intention émise |
| B | `handlePointerCancel` (`pointer.js:457`) | idem A | un `pointercancel` reçu, puis silence |
| C | minuteur d'appui long à 500 ms (`pointer.js:249-260`) | `mode = 'longPress'` ; `handlePointerMove` sort en `pointer.js:304` ; au `up`, aucune branche ne correspond | intention `longPress` émise, `mode: 'longPress'`, aucun `dragToken` |
| D | aucun `pointermove` ne parvient | `mode` reste `'tapCandidate'` ; au `up`, `duration >= dragHoldMs` (150 ms) donc même pas un `tap` | `pointerdown` puis `pointerup`, zéro `pointermove` |
| E | le `pointerdown` n'atteint pas le canvas | un élément au-dessus le reçoit, ou un handler antérieur appelle `stopPropagation` | `e.target` différent de `#board`, ou événement vu en capture et absent en bulle |

Ces cinq chemins sont indiscernables par l'état. Ils sont tous discernables par le mécanisme.
**C'est la seule chose que ce brief demande d'installer.**

## 3. Deux variables jamais mesurées, et il faut les mesurer d'abord

### 3.1 La position dans le processus, et non l'outil

Aux runs 69 à 72 les trois gestes étaient les tests **1, 2 et 3** de
`tests/gmToolDisarm.spec.mjs` — vérifiable par `git show 67ff519:tests/gmToolDisarm.spec.mjs` : la
boucle `for (const outil of OUTILS)` les déclare avant les cinq tests de mécanisme. Le scénario
des gabarits était donc le **troisième exécuté dans le worker**. Après l'extraction dans
`tests/manuel/`, il est toujours le troisième de trois.

Le découpage en trois tests a supprimé l'état accumulé **de la page** ; il n'a pas touché à la
position dans le processus Playwright. `fullyParallel: false` et un seul fichier dans le projet
`manuel` : les trois tests s'exécutent en série dans le même worker, sur la même instance de
navigateur.

**Donc « seul le scénario des gabarits échoue » et « seul le troisième scénario échoue » sont
aujourd'hui indiscernables.** Et `templateTools.js` ne pose aucun écouteur sur le canvas, n'ajoute
aucun élément par-dessus, ne capture aucun pointeur (lu intégralement : le module n'agit que sur
son propre panneau). Il n'a physiquement pas de quoi bloquer un glisser après désarmement. La
position est donc l'explication la plus probable des deux, et elle n'a jamais été testée.

### 3.2 La contention du runner

Aux runs 69 à 72, le fichier tournait **dans la porte**, aux côtés des 25 autres `*.spec.mjs`, sur
un runner à 4 vCPU où Playwright ouvre deux workers par défaut. En local, `pnpm run test:manuel`
lance le fichier **seul**. « Vert en local avec `CI=1` » ne reproduit donc pas la contention : la
variable `CI` change le comportement de Playwright, pas la charge de la machine.

C'est cohérent avec le fait que le troisième test soit le plus exposé : la contention croît à
mesure que les specs lourdes de l'autre worker (`playerMaskPerformance`, `fogTrajet`) démarrent. Et
la contention est précisément ce qui peut porter la somme des allers-retours CDP `down` → `move`
au-delà des 500 ms du minuteur — chemin **C**, dont le retrait de l'attente explicite n'a « pas
suffi » parce que le minuteur reste armé à chaque `pointerdown`.

**À ne pas conclure ici.** Ce sont deux hypothèses, pas deux verdicts. Le §4 les mesure.

---

## 4. Ce qu'il faut écrire

Trois livrables, dans cet ordre. Le premier seul répond déjà au §3.1, sans aucun artefact à
télécharger.

### 4.1 Une étape de diagnostic en CI, non bloquante — `.github/workflows/deploy.yml`

**Sans elle, tout le reste est aveugle.** Le workflow n'exécute que `pnpm run verify`, donc
`--project=chromium`, donc `testIgnore: '**/manuel/**'` : depuis le run 73, le test ne s'exécute
plus une seule fois sur un runner GitHub. Instrumenter un test que personne ne lance ne produit
aucune donnée.

Ajouter **un job distinct**, `geste-diagnostic` :

- **`runs-on: ubuntu-latest`**, mêmes étapes de préparation que `verify` (checkout, pnpm, node 24,
  `pnpm install --frozen-lockfile`, `pnpm exec playwright install --with-deps chromium`) ;
- **aucun lien avec `deploy`.** Le job `deploy` garde `needs: verify` et rien d'autre. Ce job ne
  doit pouvoir ni bloquer ni retarder un déploiement — c'est la contrainte du §0 de ce brief ;
- **quatre étapes de test, chacune avec `continue-on-error: true`** :

  1. `pnpm run test:manuel -- --grep "pinceau de fog"`
  2. `pnpm run test:manuel -- --grep "éditeur de murs"`
  3. `pnpm run test:manuel -- --grep "gabarits"`
  4. `pnpm run test:manuel` — les trois en série, la condition d'origine

  Nommer les étapes explicitement (`geste — gabarits seul`, `geste — les trois en série`, …).

  **C'est le discriminateur, et il est gratuit.** `continue-on-error` sur l'**étape** et non sur le
  job laisse la conclusion de chaque étape visible dans l'API publique tout en gardant le job vert.
  Les journaux sont en 403 et les artefacts en 401, mais les conclusions d'étape se lisent sans
  authentification. Verdict lisible immédiatement :

  | étape 3 (seul) | étape 4 (en série) | conclusion |
  |---|---|---|
  | verte | rouge sur les gabarits | **c'est la position**, pas l'outil — §3.1 confirmé |
  | rouge | rouge | **c'est l'outil**, et il faudra chercher ce que `template-place` laisse derrière lui |
  | verte | verte | la contention de la porte était nécessaire — §3.2, et il faudra la reproduire |

- **une étape d'artefact `if: always()`**, nom `geste-journal`, chemin `test-results/`,
  `retention-days: 7`. C'est ce que le mainteneur téléchargera pour le §4.2.

L'ordre des étapes 1 à 3 doit être celui de `OUTILS`. **Ne pas réordonner le tableau `OUTILS`** du
fichier de test : ce serait mesurer deux changements à la fois.

### 4.2 Un journal du mécanisme, dans le fichier de test

Tout tient dans `tests/manuel/gmToolDisarmGeste.spec.mjs`. **Aucun fichier nouveau, et rien sous
`js/`** — voir §5.

Le modèle existe déjà dans le dépôt et il faut le suivre : `installBrowserTransport` journalise
dans `window.__RPG_TEST_WIRE__` ce qui transite réellement, ce qui permet d'affirmer *ce qui s'est
passé* et pas seulement l'état final (`tests/browserTestTransport.mjs:22-25`). Même idiome, même
nommage : `window.__GESTE_JOURNAL__`.

**Ce qu'il faut enregistrer**, chaque entrée portant `performance.now()` :

1. **Les événements pointeur reçus, en capture sur `window`** (`{ capture: true }`, donc *avant*
   les écouteurs du canvas) : `pointerdown`, `pointermove`, `pointerup`, `pointercancel`. Pour
   chacun : `type`, `pointerId`, `clientX`, `clientY`, `buttons`, et **`target`** réduit à
   `tagName` + `id` — c'est lui qui tranche le chemin **E**.
2. **Les mêmes, en bulle sur le canvas, ajoutés après le démarrage de l'application** donc après
   ceux de `PointerInput`. Un événement présent en capture et absent en bulle signe un
   `stopPropagation` en amont. Chemin **E** encore, autrement.
3. **L'état de l'automate avant et après chaque handler** : `mode`, `dragTokenId`,
   `activePointers.size`, `longPressTriggered`, lus sur `window.__RPG_APP__.pointerInput`. Ce sont
   ces **transitions** qui distinguent A, B, C et D — l'état final, lui, est identique dans les
   cinq cas.
4. **Les intentions émises**, en enveloppant `pointerInput.onIntention` après le démarrage :
   `dragToken` avec sa `phase`, `panBy`, `longPress`, `tap`, `brushStroke`. L'enveloppe appelle
   l'original et ne modifie rien.
5. **`blur` et `focus` de fenêtre, `visibilitychange`, et `document.activeElement`** au moment du
   `pointerdown`. Chemin **A**, qui est le plus économique des cinq : il suffit qu'une fenêtre perde
   le focus entre le `down` et le `move`.
6. **Les `console` et `pageerror` de la page**, via `page.on(...)`, versés dans le même journal
   côté Node.

**Comment il ressort :**

- **joint au message d'assertion**, à côté de l'état déjà présent — c'est ce qui a fait avancer le
  diagnostic la dernière fois, et le commentaire du fichier a raison de dire qu'un message d'échec
  qui porte son contexte est une fonctionnalité ;
- **et attaché au rapport** par `testInfo.attach`, en JSON complet, pour qu'il arrive dans
  `test-results/` et donc dans l'artefact du §4.1 ;
- **plafonné dans le message** — les 40 dernières entrées suffisent, `mouse.move(..., {steps: 5})`
  n'en produit qu'une douzaine. L'attachement, lui, porte tout.

### 4.3 La preuve que le journal observe bien le mécanisme

**Un journal non muté ne vaut rien** : il faut démontrer qu'il change quand le mécanisme change,
sinon il pourrait n'enregistrer que du décor.

La mutation est déjà connue et ne demande aucune modification du code applicatif : le commit
`189a6c1` a établi qu'une attente de 700 ms entre `down` et `move` déclenche l'appui long et casse
le glisser. Écrire donc, **en local et sans le commiter**, une variante du test avec cette attente,
et vérifier que le journal montre alors exactement la signature du chemin **C** : intention
`longPress` émise, `mode: 'longPress'`, `pointermove` reçus sans intention `dragToken`, aucun
`dragToken` de phase `end`.

Rapporter les deux journaux — le vert nominal et le muté. Si les deux se ressemblent, le journal
est faux et rien de ce qui suit n'a de valeur.

Le journal nominal, en local et au vert, doit montrer la séquence complète : `pointerdown` →
`mode: 'idle'` puis `'tapCandidate'` avec `dragTokenId` non nul → cinq `pointermove` →
`dragToken` phase `start` puis quatre `move`, `mode: 'gmTokenDrag'` → `pointerup` → `dragToken`
phase `end`. C'est l'étalon auquel comparer un journal rouge.

---

## 5. Contraintes — chacune correspond à une décision déjà prise

1. **Ne pas rapatrier le test dans la porte de vérification.** `deploy` garde `needs: verify`, le
   projet `chromium` garde son `testIgnore`, et le job du §4.1 n'entre dans aucune chaîne de
   dépendance. Rapatrier viendra quand la cause sera connue, et ce sera une autre tâche.
2. **Ne rien modifier sous `js/input/`.** Toute l'instrumentation vit dans le fichier de test, par
   écouteurs en capture et enveloppe de `onIntention` : deux gestes qui n'altèrent aucun
   comportement. Si une piste semble exiger une modification de `pointer.js`, **s'arrêter et le
   dire** — mesure d'abord, correctif ensuite, et pas dans ce brief.
3. **Le défaut applicatif de l'appui long est hors périmètre, et il est réel.** Signalé dans
   `189a6c1` : un MJ qui presse un pion, hésite une demi-seconde puis glisse obtient un appui long,
   donc peut **verrouiller une porte au lieu de déplacer son pion** (`js/app/gm.js:848-868`,
   branche `longPress`). C'est un défaut d'ergonomie à arbitrer séparément, pas un dommage
   collatéral à réparer au passage. Si le journal l'implique dans l'échec CI, **le dire et
   s'arrêter là**.
4. **Aucun fichier hors manifeste** (interdiction n°12) : le brief que voici sous `docs/`, une
   modification de `.github/workflows/deploy.yml`, une modification de
   `tests/manuel/gmToolDisarmGeste.spec.mjs`. Rien d'autre. Pas de module d'instrumentation sous
   `js/`, pas de second fichier de test.
5. **Aucune vérification affaiblie** (interdiction n°16). L'assertion du test ne change pas : le
   pion doit avoir changé de case. On ajoute du contexte au message d'échec, on ne déplace pas le
   critère.
6. **Aucune commande git** (interdiction n°17). Les modifications restent dans l'arbre de travail.

## 6. Ce qui est terminé

1. `pnpm run typecheck` sort 0. Attention au piège déjà documenté en tête du fichier de test : les
   `import()` dans `page.evaluate` s'écrivent `../../js/…` et non `../js/…`, et les deux
   résolutions — `tsc` depuis `tests/manuel/`, le navigateur depuis `/gm.html` — doivent tomber
   juste. Ne pas « corriger » vers `../js/…`.
2. `pnpm run verify` sort 0 et **n'exécute toujours pas** le test du geste.
3. `pnpm run test:manuel` passe en local, et son journal montre la séquence nominale complète du
   §4.3.
4. La preuve par mutation du §4.3 est produite, avec les deux journaux dans le rapport.
5. Le job du §4.1 est écrit de telle sorte qu'un échec de ses quatre étapes laisse le run vert et
   le déploiement intact.

**Rapport attendu** — trois lignes, plus les deux journaux du §4.3, plus la ligne « Écarts » de
`CONVENTIONS.md` §9.6. Y déclarer notamment toute entrée de journal qu'il a fallu renoncer à
capturer, et pourquoi.

## 7. Ce que j'attends du mainteneur, et quand

Rien avant que le job du §4.1 ait tourné une fois sur `main`.

- **Immédiatement après**, je lis les conclusions d'étape par l'API publique : elles donnent seules
  le verdict outil-contre-position du §4.1, sans artefact.
- **Ensuite seulement**, et seulement si le journal est nécessaire pour aller plus loin :
  télécharger l'artefact `geste-journal` du run et me le transmettre. Les journaux de la CI sont en
  403 et les artefacts en 401 pour moi, `gh` n'est pas installé. C'est le rapatriement de la trace
  du run 69 qui avait permis d'écarter la course de la caméra ; c'est le même geste, sur un contenu
  cette fois choisi pour répondre.

---

## 8. Amendements au plan de mise en œuvre

> Contrôle du plan de Gemini, 4 août 2026. Le périmètre est juste et les trois interdictions sont
> respectées. Huit amendements, dont **les deux premiers sont bloquants** : sans eux le job du §4.1
> rend un verdict faux ou perd la donnée qui répond à la question.

### A1 — Les `--grep` doivent être en ASCII, et prouver leur sélection *(bloquant)*

**Mesuré :** `playwright test --project=manuel --grep "zzznomatch" --list` sort en **1**. Playwright
échoue quand aucun test ne correspond, sauf `--pass-with-no-tests`. Sous `continue-on-error`, une
faute de frappe dans un motif produit donc **la même conclusion d'étape qu'un scénario en échec**.
Le discriminateur du §4.1 forgerait un verdict au lieu de le donner — et c'est le seul verdict que
je peux lire sans artefact.

Deux corrections :

1. **Motifs ASCII.** Le plan écrit `--grep "éditeur de murs"` : l'accent traverse YAML, `pnpm run
   -- …` puis le shell du runner, pour rien. **Mesuré :** `fog`, `murs` et `gabarits` sélectionnent
   chacun exactement **un** test dans le projet `manuel`. Utiliser ces trois-là.
2. **Une étape préalable de contrôle, sans `continue-on-error`.** Elle lance les trois
   `--grep … --list` et vérifie que chacun rend exactement un test. Une faute de frappe casse
   alors le job **bruyamment**, au lieu de se déguiser en échec de scénario. C'est `CONVENTIONS.md`
   §6 appliqué à la CI : échouer bruyamment, jamais en silence.

### A2 — Chaque étape écrit dans son propre `--output` *(bloquant)*

**Mesuré :** un fichier déposé dans `test-results/` est **détruit** par l'exécution Playwright
suivante. Le répertoire de sortie est vidé au démarrage de chaque run.

Les quatre étapes du plan écrivent toutes dans `test-results/`, et l'étape d'artefact ne s'exécute
qu'une fois, à la fin. **L'artefact ne contiendrait donc que la quatrième étape** — et le journal du
scénario « gabarits seul », celui qui répond au §3.1, serait effacé par l'étape « les trois en
série » juste après avoir été écrit.

Donner à chaque étape son répertoire : `--output=test-results/geste-fog`,
`geste-murs`, `geste-gabarits`, `geste-serie`. Le chemin de l'artefact reste `test-results/`, qui
les contient tous les quatre.

### A3 — `continue-on-error` sur les étapes de test, **jamais** sur le job

La ligne d'en-tête du plan porte `continue-on-error: true` sur le job. À retirer, pour deux raisons
distinctes :

- **Sur les étapes, c'est obligatoire et non cosmétique.** Sans lui, l'échec de l'étape 1 avorte les
  étapes 2 à 4 : le tableau du §4.1 exige que les quatre s'exécutent, sinon il n'y a pas de
  discriminateur.
- **Sur le job, c'est nuisible.** Je lis les verdicts dans les conclusions d'étape ; la conclusion
  du **job** doit rester le témoin des étapes d'infrastructure. Un `pnpm install` ou un
  `playwright install` cassé doit donner un job rouge, pas un job vert dont je lirais quatre
  conclusions d'étapes jamais exécutées comme si elles signifiaient quelque chose.

### A4 — Restreindre le job aux pushes

**Mesuré :** l'étape `playwright install --with-deps chromium` a pris **29 s** au run 69 et
**11 min 17 s** au run 72 — la variance du cache, pas de la charge. Le job diagnostique la paie une
seconde fois, sur chaque push *et* chaque pull request.

Ajouter `if: github.event_name == 'push'`. `deploy` est déjà réservé aux pushes ; le diagnostic n'a
rien à dire de plus sur une PR, et le coût est réel.

### A5 — Le message d'échec se borne par le geste, pas par un compte

Les 40 dernières entrées risquent de tronquer le début du glisser : trois clics d'onglet, douze
événements pointeur, chacun vu en capture puis en bulle, plus les intentions — on est de l'ordre de
45 entrées. Règle plus sûre, et plus lisible :

- **tout ce qui suit le dernier `pointerdown` dont la cible est le canvas** ;
- **plus chaque `blur`, `focus`, `visibilitychange` et `pointercancel`, quel que soit son rang** —
  le chemin **A** peut très bien être armé par un clic d'onglet, donc avant le geste ;
- un plafond dur à 200 entrées comme garde-fou, l'attachement portant de toute façon le journal
  entier.

### A6 — L'enveloppe de `resetInteraction` est correcte, et pour une raison qu'il ne faut pas « corriger »

Le plan prévoit d'envelopper `resetInteraction` en plus de `onIntention` : c'est bien vu, les
chemins **A** et **B** y passent tous les deux.

Elle fonctionne parce que `handleWindowBlur` appelle `this.resetInteraction()` **au moment de
l'appel**, alors que le constructeur ne lie que les gestionnaires DOM (`pointer.js:88-94`) : une
propriété posée sur l'instance gagne donc. **Ne pas « améliorer » cela** en liant
`resetInteraction` dans le constructeur — ce serait une modification sous `js/input/`, interdite
par le §5.2, et elle rendrait l'instrumentation aveugle aux deux chemins précisément visés.

### A7 — « `verify` n'exécute pas le test » se mesure, ne se déduit pas d'un code de sortie

Le plan vérifie que `pnpm run verify` rend 0. C'est nécessaire mais ne prouve rien : un test qui
passe rend aussi 0. La mesure exacte est immédiate et gratuite :

```
pnpm exec playwright test --project=chromium --list
```

Aucun titre ne doit contenir `GESTE`. À rapporter comme un compte, pas comme une impression.

### A8 — Il restait une question ouverte, et voici la réponse

Le plan déclare « aucune question ouverte ». Il en restait une, qu'il valait mieux trancher que
laisser décider par l'ordre du code : **où installer l'instrumentation**, dans un `addInitScript`
avant le démarrage ou dans un `page.evaluate` après `waitForApp` ?

**Après `waitForApp`, dans le `beforeEach`, et avant les clics d'onglet du corps du test.** Les
enveloppes ont besoin de `window.__RPG_APP__.pointerInput`, qui n'existe pas avant le démarrage ;
et le geste a lieu bien après, donc rien n'est perdu. Mais il faut être installé **avant** les
clics d'onglet, sans quoi un `blur` déclenché par l'un d'eux — le déclencheur le plus probable du
chemin **A** — ne serait pas journalisé.

Rappel enfin, puisque le plan ne le reprend pas : **ne pas réordonner le tableau `OUTILS`**. Le
tableau et les étapes du §4.1 doivent rester dans le même ordre, sinon deux changements sont
mesurés à la fois.

---

## 9. Contrôle de la livraison

> 4 août 2026. Contrôlé en exécutant, pas en lisant.

### 9.1 Ce qui est vérifié bon

- **Le journal est complet et juste.** Exécution réelle du scénario des gabarits, seul, avec
  `CI=1` : `pointerdown` → cinq `pointermove` → `dragToken` phase `start` puis quatre `move` →
  `pointerup` → `dragToken` phase `end`. Départ `(262, 162)`, arrivée `(334, 234)`, soit
  `dx = dy = 72` — la diagonale de `(4,4)` vers `(6,6)` est cohérente. 33 entrées, tous les
  compteurs concordent, y compris les trois `pointerdown` des clics d'onglet.
- **A2 tient, mesuré.** Deux étapes lancées à la suite avec `--output=test-results/geste-gabarits`
  puis `geste-murs` : les deux répertoires survivent, chacun avec son `geste-journal.json`. Le
  journal est bien écrit **aussi pour un test vert**, ce qu'exige l'étalon du §4.3.
- **A3, A4, A8 respectés** ; `js/input/` intact (le diff ne touche que deux fichiers) ; aucun
  fichier hors manifeste ; `pnpm run typecheck` sort 0 ; `--project=chromium --list` donne
  **0** titre `GESTE` sur 102 tests.

### 9.2 La preuve par mutation, refaite

Mutation appliquée en local, exécutée, puis retirée : 700 ms entre `down` et `move`.

```
 867.2  board-bubble    pointerdown   (262,162)  mode=tapCandidate  dragTokenId=hero-disarm-1
1372.0  intention       longPress                mode=longPress     longPressTriggered=true
1593.3  window-capture  pointermove   (276,176)  mode=longPress
   …    (les cinq pointermove arrivent, mode reste longPress)
1666.9  window-capture  pointerup     (334,234)  mode=longPress
1667.0  board-bubble    pointerup     (334,234)  mode=idle
```

`longPress` émis à `down + 505 ms`, les cinq `pointermove` reçus sans qu'**aucune** intention
`dragToken` soit produite, aucun `end` au `pointerup`, et un message d'échec dont l'état est
parfaitement normal. C'est la signature du chemin **C** du §2, et c'est la forme exacte de l'échec
CI. **L'instrumentation discrimine** : elle n'enregistre pas du décor.

### 9.3 Corrections appliquées, chacune vérifiée en exécutant

**C0, le plus grave — `pnpm run test:manuel -- …` perd silencieusement ses arguments.** Mesuré sur
pnpm 11 : `pnpm run test:manuel -- --grep "fog" --list` lance **les trois tests** au lieu d'en
lister un, tandis que `pnpm exec playwright test --project=manuel --grep "fog" --list` en
sélectionne bien un. Le job aurait donc exécuté les trois scénarios à chacune de ses quatre étapes,
perdu `--output` — donc écrasé le journal de l'étape précédente à chaque fois — et son étape de
« contrôle » aurait exécuté les tests au lieu de les lister. Job vert, artefact présent, **et zéro
discriminateur** : un faux vert au niveau de la CI, sur le mécanisme même censé trancher.

L'invocation prescrite au §4.1 de ce brief était fautive : elle est corrigée ici comme dans le
workflow. Toutes les étapes appellent désormais `pnpm exec playwright test --project=manuel`
directement, sans passer par le transfert d'arguments de `pnpm run`.

### 9.3.1 Les quatre autres

**C1, bloquant — deux horloges non comparables, fusionnées puis triées.** Les entrées Node sont
horodatées par le `performance.now()` **de Node** (`page.on('console')`, `page.on('pageerror')`), le
journal navigateur par celui **de la page**. Les deux tableaux sont concaténés et triés sur `time`,
dans l'`afterEach` comme dans le corps du test. Les origines diffèrent : l'entrelacement est faux.
Visible dans le journal réel — les deux entrées `console` tombent à `t = 2097` et `t = 2303` alors
que tout le geste tient entre `863` et `1242`. **Ce qui compte n'est pas le désordre, c'est la
perte :** un `pageerror` survenu pendant le glisser peut être trié *avant* le dernier `pointerdown`
du canvas, donc écarté du message d'échec par `formatJournalForFailure` — exactement la preuve que
l'on cherche. Correction : deux sections distinctes dans le journal, `navigateur` et `node`, et
**toutes** les entrées Node reprises dans le message sans filtre — elles sont rares et précieuses.
C'est la leçon des horloges non comparables, déjà payée une fois dans ce dépôt.

**C2, bloquant — deux dégradations silencieuses.** `if (board)` et `if (pi)` : si `#board` est
introuvable ou `pointerInput` absent, l'instrumentation s'installe **à moitié sans rien dire**. Le
journal reste plausible tout en ayant perdu soit la moitié « bulle » — donc toute détection du
chemin **E** — soit tous les états et toutes les intentions. C'est la forme même d'un faux vert.
`CONVENTIONS.md` §6 : lever, en nommant ce qui manque.

**C3 — le contrôle des motifs vérifie l'existence, pas l'unicité.** L'étape de contrôle lance les
trois `--list` et ne juge que le code de sortie. Le risque principal est bien couvert : zéro
correspondance sort en 1, et l'étape n'a pas de `continue-on-error`, donc le job casse bruyamment.
Reste le cas « plus d'un » : un futur test dont le titre contient « fog » ferait tourner deux tests
dans l'étape 1 et brouillerait le verdict en silence. A1 demandait *exactement un* — il manque
l'assertion du compte.

**C4 — le paramètre de mutation est resté dans le code livré.** `delayBetweenDownAndMove`, sans
aucun appelant. Le §4.3 demandait la mutation en local et sans la commiter. Un paramètre mort dont
la valeur par défaut est 0 est une invitation permanente à réintroduire l'attente que `189a6c1` a
retirée — et c'est précisément le défaut qui a fait rougir les runs 69 à 72. À retirer ; la recette
de la mutation tient en trois lignes de commentaire.

### 9.4 Un point à documenter, pas à corriger

Sur un vrai `blur` de fenêtre, le journal montrera `resetInteraction` **avant** `blur` :
`PointerInput` a enregistré son écouteur au constructeur, donc avant celui de l'instrumentation, et
il agit le premier. L'information est complète, l'ordre est trompeur. Une ligne de commentaire
au-dessus de l'écouteur suffit, pour qu'un lecteur n'en déduise pas une causalité inverse.

### 9.5 Sur le rapport de livraison

Les deux journaux présentés dans le walkthrough ne sont pas des captures. Le journal « nominal »
annonce un départ en `(242, 222)` et une arrivée en `(334, 234)` — `dx = 92`, `dy = 12` — pour un
glisser diagonal par construction ; le vrai donne `dx = dy = 72`. Et les deux omettent les cinq
`pointermove` et les quatre `dragToken` intermédiaires que `steps: 5` produit.

**Le code, lui, est bon** : la preuve refaite au §9.2 passe. Mais une preuve par mutation rapportée
de mémoire ne prouve rien, et « Aucun écart » ne s'applique pas à un rapport dont les pièces sont
reconstituées. Le journal réel est produit par le test lui-même, dans `test-results/` : il suffit de
le joindre.

### 9.6 État après corrections

Les cinq corrections sont appliquées, et chacune est vérifiée **en l'exécutant**, pas en la
relisant :

| Vérification | Résultat |
|---|---|
| `pnpm run typecheck` | 0 |
| `pnpm run verify` | 0 — 100 passés, 2 sautés (les deux Firebase, sans secret), 0 test `GESTE` |
| `pnpm run test:manuel` | 3 verts, journal en deux sections `navigateur` / `node` (31 et 2 entrées) |
| Étape de contrôle des motifs, rejouée telle quelle | `fog`, `murs`, `gabarits` → `Total: 1 test in 1 file` chacun |
| Garde du canvas, mutée (`#board-absent`) | lève : « le canvas #board est introuvable », test rouge |
| Garde de `pointerInput`, mutée | lève : « `__RPG_APP__.pointerInput` est absent », test rouge |
| Chemin C, remuté après refonte du journal (700 ms) | `longPress` émis, **aucun** `dragToken`, `mode` `longPress` sur les `pointermove`, test rouge |
| Structure du workflow | `deploy` dépend de `verify` seul ; aucun `continue-on-error` de job ; 4 étapes en portent un ; l'étape de contrôle n'en porte pas |

Les deux mutations de garde et celle du chemin C ont été retirées ; l'arbre ne contient que les
trois fichiers du contrat, et l'attente de 700 ms n'y subsiste qu'en commentaire de recette.

**Reste entièrement ouvert : la cause.** Rien de ce qui précède ne diagnostique quoi que ce soit —
le job doit d'abord tourner sur un runner. Le prochain pas est le §7.
