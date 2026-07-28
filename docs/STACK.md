# STACK — versions épinglées & idiomes autorisés

> **Document normatif.** Toute dépendance, version ou idiome non listé ici est interdit.
> En cas de besoin non couvert : **s'arrêter et demander**, ne pas choisir seul.

---

## 1. Principes non négociables

| Principe | Raison |
|---|---|
| **Zéro build** | L'app est servie telle quelle par GitHub Pages. Pas de bundler, pas de transpileur, pas d'étape de compilation. |
| **ES Modules natifs** | `<script type="module">` + `import`. Aucun `require`, aucun UMD, aucun `<script>` global. |
| **JavaScript, pas TypeScript** | Cohérent avec l'existant, et compatible zéro build. Le typage passe par JSDoc (§4). |
| **Versions centralisées dans un import map** | Aucun fichier `.js` ne contient de numéro de version. Un seul endroit à modifier. |
| **Outillage cross-platform** | Le développement se fait sous **Windows**, la table de jeu tourne sur **Mac**. Aucun script ne peut supposer un OS. |

---

## 2. Dépendances runtime

Déclarées **exclusivement** dans l'import map de `index.html` et `player.html`.
Aucun `import` ne cite d'URL complète ni de numéro de version.

```html
<script type="importmap">
{
  "imports": {
    "pixi.js":            "https://cdn.jsdelivr.net/npm/pixi.js@8.19.0/dist/pixi.min.mjs",
    "firebase/app":       "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js",
    "firebase/auth":      "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js",
    "firebase/database":  "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js",
    "firebase/firestore": "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js"
  }
}
</script>
```

**Versions figées le 27/07/2026**, relevées sur le registre npm et dont les cinq URLs ont
été vérifiées en HTTP 200 :

| Paquet | Version figée |
|---|---|
| `pixi.js` | **8.19.0** |
| `firebase` | **12.16.0** |

> ⚠️ `firebase` est en **12.x**. Beaucoup d'exemples en circulation ciblent la 9, 10 ou 11 —
> les ignorer et s'en tenir aux idiomes de la §3. Le CDN `gstatic` reflète les versions du
> paquet npm `firebase`, d'où le numéro identique dans les deux colonnes.

Dans le code, **toujours** la forme nue :

```js
import { Application, Container, Sprite } from 'pixi.js'      // ✅
import { getDatabase, ref, onValue } from 'firebase/database'  // ✅

import * as PIXI from 'https://cdn.../pixi.min.mjs'            // ❌ URL en dur
import { getDatabase } from 'firebase/database?v=11'           // ❌ version dans l'import
```

### Comment « figer » une version — procédure

Figer ne veut pas dire écrire un numéro dans un fichier et espérer. C'est trois gestes :
**relever**, **vérifier**, **verrouiller**.

**1. Relever la version stable courante** (fonctionne sous Windows sans dépendance) :

```
npm view pixi.js version
npm view firebase version
```

Ne jamais utiliser une plage (`@8`, `@latest`, `^8.19.0`) dans une URL de CDN : la version
résolue changerait sans prévenir, et un import map n'a pas de fichier de verrouillage.
**Toujours la version complète et exacte.**

**2. Vérifier que les URLs existent réellement.** Une URL `gstatic` inexistante peut
renvoyer une page d'erreur au lieu d'un 404 franc, et l'échec se manifeste alors par un
module vide plutôt que par une erreur claire.

```
node scripts/check-deps.mjs
```

Ce script lit l'import map de `index.html`, requête chaque URL en `HEAD`, et compare la
version figée à celle du registre npm. Il sort en code non nul si une URL ne répond pas 200.

**3. Verrouiller.** La version n'existe qu'à un seul endroit : l'import map de `index.html`
et `player.html`, qui doivent rester **identiques**. Le test d'architecture n°7 vérifie
qu'aucun numéro de version ni URL de CDN n'apparaît dans un fichier `.js`.

### Quand mettre à jour

**Jamais en cours de lot.** Une montée de version se traite comme une tâche à part :
relever, vérifier, lancer la suite de tests, et relire les idiomes de la §3 — une majeure
de PixiJS ou du SDK Firebase les casse. Une mise à jour opportuniste au milieu d'une tâche
fonctionnelle rend le diagnostic impossible.

### Interdit

- Toute bibliothèque non listée ici. Pas de lodash, pas de date-fns, pas de framework UI,
  **pas de bibliothèque de pathfinding, de géométrie ou de hex** — les algorithmes sont
  écrits à la main (voir `docs/ARCHITECTURE.md`).
- `firebase/compat/*` et le SDK namespacé v8. **Modulaire uniquement.**
- Firebase **Storage** : interdit par décision d'architecture (plan payant requis).
  Les images vont dans `maps/` du dépôt.
- Deux versions différentes du même paquet dans l'import map.

---

## 3. Idiomes imposés

### PixiJS 8 — les pièges v7 → v8

PixiJS 8 a changé des API centrales. Les idiomes v7 sont **interdits** car ils échouent
silencieusement ou lèvent à l'exécution.

```js
// ✅ v8 — initialisation asynchrone obligatoire
const app = new Application()
await app.init({
  canvas: document.getElementById('board'),
  resolution: Math.min(window.devicePixelRatio, 1.5),  // cf. cahier des charges §3
  autoDensity: true,
  antialias: false,          // coût GPU inutile sur Mali-G68
  powerPreference: 'high-performance',
})

// ❌ v7 — options au constructeur : ne fonctionne pas en v8
const app = new Application({ view: canvas, resolution: 2 })
```

```js
// ✅ v8 — Graphics : chaînage géométrie → style
g.rect(0, 0, 100, 50).fill({ color: 0x000000, alpha: 0.25 })
g.moveTo(0, 0).lineTo(100, 0).stroke({ width: 1, color: 0x000000 })

// ❌ v7 — beginFill / drawRect / endFill : supprimés en v8
g.beginFill(0x000000, 0.25); g.drawRect(0, 0, 100, 50); g.endFill()
```

```js
// ✅ v8
app.canvas                          // l'élément <canvas>
await Assets.load('maps/rdc.webp')  // chargement d'asset
sprite.tint = 0xff0000

// ❌ v7
app.view                            // renommé
PIXI.Loader.shared.add(...)         // supprimé
```

**Boucle de rendu à la demande** (exigence du cahier des charges §9) :

```js
app.ticker.autoStart = false
app.ticker.stop()
// Rendre une seule frame après un changement d'état :
function requestFrame() { /* coalescer sur requestAnimationFrame, puis app.render() */ }
```

Ne **jamais** laisser le ticker tourner en continu si rien n'est animé.

### Firebase 11 — SDK modulaire

```js
// ✅ modulaire : fonctions libres, l'instance passe en premier argument
import { getDatabase, ref, onValue, update } from 'firebase/database'
const db = getDatabase(app)
onValue(ref(db, `session/${sid}/tokens`), snap => { … })

// ❌ namespacé v8 / compat : méthodes chaînées sur l'instance
firebase.database().ref('session/x/tokens').on('value', …)
```

Séparation imposée par le cahier des charges §4 :
- **Realtime Database** → canal temps réel (positions, portes, caméra, pings, présence).
- **Firestore** → documents durables (scènes, liaisons, bibliothèques, masques de fog).
- Ne jamais écrire de position de pion dans Firestore pendant une séance.

---

## 4. Typage par JSDoc + `ts-check`

Le typage est **obligatoire** et vérifié en CI, sans produire de build. C'est ce qui rend
les erreurs détectables par machine plutôt qu'à la lecture.

Chaque fichier `.js` commence par :

```js
// @ts-check
```

Les types partagés sont déclarés une seule fois dans `js/core/types.js` en `@typedef`, et
importés par référence :

```js
/**
 * Déplace un pion vers une case.
 * @param {import('../core/types.js').Token} token
 * @param {import('../core/types.js').Cell} cell
 * @returns {void}
 */
export function moveTokenToCell(token, cell) { … }
```

**`@ts-nocheck` et `@ts-ignore` sont interdits.** Ils font passer la vérification en la
désactivant, ce qui vide toute la stratégie de typage de son sens. Un type qui résiste est
un signal : soit le type est faux, soit il manque une déclaration — dans les deux cas on
corrige, on ne muselle pas.

> `@types/node` est **autorisé** en dépendance de développement, et nécessaire : les
> scripts de `scripts/` importent `node:fs`, `node:path` et `node:child_process`, qui sans
> lui ne peuvent pas être typés. C'est un paquet de types uniquement, sans code à
> l'exécution.

> `pixi.js` est **autorisé en dépendance de développement, pour ses seuls types**, à la
> version **exactement identique** à celle de l'import map. À l'exécution, le navigateur
> charge Pixi depuis le CDN : la copie de `node_modules/` n'est jamais servie, jamais
> déployée. Elle existe pour que `tsc` vérifie le code de rendu contre l'API réelle.
>
> `scripts/check-deps.mjs` **échoue** si les deux versions divergent, et c'est bloquant : des
> types qui ne décrivent pas le code exécuté sont pires qu'une absence de types, parce qu'ils
> rendent la vérification verte.
>
> Contre-exemple à ne jamais reproduire : à T-15, `pixi.js` avait été aliasé dans
> `jsconfig.json` vers `js/core/types.js`, qui exportait deux fausses classes Pixi. Le
> typecheck passait, la suite passait, et **toute l'API v8 était devenue `any`** — les pièges
> v7→v8 de la §3 étaient redevenus indétectables. Cf. `ETAT.md` §4.

Vérification (aucun fichier émis) :

```
npx tsc --noEmit -p jsconfig.json
```

`jsconfig.json` impose `checkJs: true`, `strict: true`, `noEmit: true`, et `allowJs: true`.
**Une erreur `tsc` bloque la tâche** : elle n'est pas considérée terminée.

---

## 5. Outillage de développement

| Usage | Outil | Contrainte |
|---|---|---|
| Runtime des scripts | **Node.js 20 LTS ou plus** | ESM (`.mjs` ou `"type": "module"`) |
| Gestionnaire de paquets | **pnpm** | Cohérent avec l'existant |
| Vérification de types | `tsc --noEmit` + `@types/node` + `pixi.js` | Dépendances de dev uniquement |
| Tests navigateur | **Playwright (Chromium)** | `tests/*.spec.mjs` — vrai Pixi, vrai DOM |
| Tests de logique pure | **`node:test`** | `tests/*.test.mjs` — aucun navigateur, aucun faux |
| Traitement d'images (scripts) | **Jimp** (pure JS) | Dépendance de dev uniquement — rééchantillonnage UVTT en Node |
| Serveur local de dev | `scripts/serve.mjs` | Statique pur, sans dépendance. Jamais de serveur applicatif |

### Les deux familles de tests

La séparation est **normative**, parce que sa confusion a déjà coûté une vérification :

| Suffixe | Exécuteur | Commande | Pour quoi |
|---|---|---|---|
| `*.test.mjs` | `node:test` | `pnpm run test:unit` | Logique pure : grille, Dijkstra, schéma, parsing |
| `*.spec.mjs` | Playwright | `pnpm run test:e2e` | Rendu, gestes, deux onglets, persistance |

`pnpm test` enchaîne les deux. **Un module qui importe `pixi.js` ou touche au DOM se teste en
`*.spec.mjs`, jamais en `*.test.mjs`.** Le rendre testable sous Node exigerait un faux Pixi —
c'est-à-dire remplacer la dépendance vérifiée par une imitation qui ne prouve rien
(interdiction n°16). Playwright a besoin d'un `chromium` installé une fois par machine :
`pnpm exec playwright install chromium`.

### Règles cross-platform (développement Windows, jeu sur Mac)

Le développement se fait sous Windows. Tout script qui suppose un shell POSIX est un bug.

- Scripts d'outillage : **en Node** (`scripts/*.mjs`), jamais en `.sh` ni en `.bat`.
- Chemins : toujours via `node:path` (`path.join`, `path.resolve`). Jamais de `\` ni de `/`
  concaténé à la main.
- Jamais de `rm`, `cp`, `mkdir -p`, `NUL`, `/dev/null` dans un script.
- Scripts `package.json` : uniquement `node scripts/x.mjs`, sans enchaînement shell.
- Fins de ligne : `.gitattributes` avec `* text=auto eol=lf`.

---

## 5bis. Version de l'application — obligatoire

Trois surfaces à vérifier (Mac MJ, tablette joueurs, TV castée) et **aucune étape de build
pour invalider les caches** : sans indicateur de version, on perd du temps de test à se
demander si le code exécuté est le bon. Le versioning n'est donc pas du confort.

### Le fichier généré

`js/core/version.js` est **généré, commité, et jamais édité à la main** :

```js
// @ts-check
// FICHIER GÉNÉRÉ par scripts/stamp-version.mjs — toute édition manuelle sera écrasée.
export const VERSION = {
  version: '0.1.0',                    // semver, depuis package.json
  build: 42,                           // entier monotone, incrémenté à chaque estampille
  builtAt: '2026-07-27T14:32:11Z',
  commit: 'a1b2c3d',                   // HEAD au moment de l'estampille
  label: '0.1.0+42',
}
```

**Le `build` est le comparateur qui compte.** C'est un entier : « 41 contre 42 » se lit d'un
coup d'œil entre deux écrans, là où deux SHA courts demandent un effort.

> Limite à connaître : `commit` est le HEAD **au moment de l'estampille**, donc le commit
> *précédent* celui qui embarque le fichier. C'est assumé — le `build` et `builtAt` sont les
> repères fiables. Ne pas tenter de corriger ça par un hook `post-commit` avec `--amend`.

`scripts/stamp-version.mjs` : lit `package.json`, incrémente le compteur de build, relève
`git rev-parse --short HEAD`, écrit le fichier. Node pur, cross-platform, idempotent hors
compteur. À exécuter **avant chaque commit destiné à être testé** :

```
node scripts/stamp-version.mjs
```

### Affichage

| Surface | Affichage |
|---|---|
| **Vue MJ** | Permanent et discret en pied de panneau : `0.1.0+42 · a1b2c3d · 27/07 14:32`. |
| **Vue joueurs** | Overlay **transitoire** au chargement : 4 s en bas à droite, puis disparition complète. `pointer-events: none`. Rappelable par un **tap à trois doigts** (ne collisionne ni avec le pan à un doigt ni avec le pinch à deux). |
| **TV castée** | Aucun code spécifique : la tablette étant miroir, l'overlay de chargement s'y affiche aussi. Les trois écrans se vérifient donc en une seule fois, au chargement. |

Cet overlay est une **exception explicite** à l'interdiction n°2 de `CONVENTIONS.md`
(aucun élément d'interface en vue joueurs). Elle est bornée : rien de persistant, rien de
tapable, rien qui ressemble à un menu.

### Détection de désynchronisation — la partie utile

Afficher un numéro laisse le travail de comparaison à l'humain. **L'outil doit le faire.**

Chaque client publie sa version dans son enregistrement de présence :

```
/session/{sid}/presence/{clientId} → { role, at, build, label }
```

- La **vue MJ** compare le `build` de chaque client connecté au sien. En cas d'écart, une
  bannière persistante et voyante : *« La tablette exécute la build 41, ce poste la 42.
  Recharge la tablette. »*
- La **vue joueurs** en cas d'écart : l'overlay transitoire devient **persistant et rouge**.
  C'est un état cassé, pas de l'habillage — la persistance est justifiée ici.

C'est ce mécanisme qui répond réellement au besoin : tu ne te demandes plus si tu as la
bonne version, l'outil te le dit.

### Invalidation de cache — position assumée

Le zéro build interdit le hachage des noms de fichiers. Un `?v=` sur le point d'entrée ne
sert à rien : les imports relatifs des sous-modules se résolvent et se cachent
indépendamment. GitHub Pages envoie un `max-age` court, donc l'obsolescence se résorbe
d'elle-même en quelques minutes — ce qui reste pénible en test actif.

**Décision : on ne construit pas de Service Worker maintenant.** La détection de
désynchronisation apporte l'essentiel de la valeur pour une fraction du coût : en test, on
recharge la tablette de force (`Ctrl+Maj+R`, ou « Update on reload » dans les devtools
Chrome). Si cela devient une gêne réelle et mesurée, un Service Worker dont le nom de cache
dérive du `build` est la solution — **à demander, pas à ajouter d'initiative.**

---

## 6. Conventions de langue

Reprise de la convention déjà en place sur `shadowrunbank` — à respecter strictement,
c'est ce qui rend le code homogène entre les deux projets.

| Élément | Langue |
|---|---|
| Identifiants (variables, fonctions, classes, fichiers) | **anglais** — `reachableCells`, `moveTokenToCell`, `blockedEdges` |
| Commentaires | **français** — `// Couche non interactive : le hit-test passe par cellFromEvent` |
| Clés de données et événements réseau | **anglais** — `token.move`, `levelId`, `speedCells` |
| Textes d'interface | **français** |
| Documentation (`docs/`) | **français** |
| Messages de commit | **français** |

---

## 7. Identité git

Le dépôt est configuré en local avec :

```
user.name  = ethoril
user.email = ethoril@gmail.com
```

**Ne jamais modifier ces valeurs, ne jamais utiliser `--author`, ne jamais ajouter de
`Co-Authored-By` nominatif.** La configuration globale de la machine est vide : c'est la
configuration locale du dépôt qui protège, et elle seule.
