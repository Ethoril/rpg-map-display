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
    "pixi.js":         "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs",
    "firebase/app":    "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js",
    "firebase/auth":   "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js",
    "firebase/database": "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js",
    "firebase/firestore": "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"
  }
}
</script>
```

Dans le code, **toujours** la forme nue :

```js
import { Application, Container, Sprite } from 'pixi.js'      // ✅
import { getDatabase, ref, onValue } from 'firebase/database'  // ✅

import * as PIXI from 'https://cdn.../pixi.min.mjs'            // ❌ URL en dur
import { getDatabase } from 'firebase/database?v=11'           // ❌ version dans l'import
```

> ⚠️ **Les numéros ci-dessus sont à confirmer au premier commit.** Vérifier la dernière
> version stable de chaque paquet, l'inscrire dans l'import map, puis **ne plus y toucher
> sans demander**. Une montée de version majeure de PixiJS ou du SDK Firebase casse les
> idiomes de la §3.

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
| Vérification de types | `tsc --noEmit` | Dépendance de dev uniquement |
| Tests | **Playwright (Chromium)** | Cohérent avec l'existant |
| Serveur local de dev | `npx serve` ou équivalent statique | Jamais de serveur applicatif : l'app doit fonctionner en statique pur |

### Règles cross-platform (développement Windows, jeu sur Mac)

Le développement se fait sous Windows. Tout script qui suppose un shell POSIX est un bug.

- Scripts d'outillage : **en Node** (`scripts/*.mjs`), jamais en `.sh` ni en `.bat`.
- Chemins : toujours via `node:path` (`path.join`, `path.resolve`). Jamais de `\` ni de `/`
  concaténé à la main.
- Jamais de `rm`, `cp`, `mkdir -p`, `NUL`, `/dev/null` dans un script.
- Scripts `package.json` : uniquement `node scripts/x.mjs`, sans enchaînement shell.
- Fins de ligne : `.gitattributes` avec `* text=auto eol=lf`.

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
