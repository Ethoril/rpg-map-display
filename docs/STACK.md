# STACK — versions épinglées et idiomes autorisés

> Document normatif. Toute nouvelle dépendance ou évolution de moteur doit être proposée
> explicitement et validée avant implémentation.

## 1. Principes

| Principe | Règle |
|---|---|
| Déploiement | Site statique, sans bundler ni étape de compilation |
| Modules | ES Modules natifs uniquement |
| Langage | JavaScript avec `// @ts-check` et JSDoc strict |
| Rendu | Canvas 2D natif |
| Synchronisation | Firebase 12 modulaire |
| Assets partagés | fichiers WebP publiés dans `maps/` |
| Outillage | Node et pnpm, scripts cross-platform |

Canvas 2D est le moteur officiel du lot 1a. Il n’existe ni moteur de rendu tiers ni
viewport tiers dans le runtime ou les dépendances de développement.

## 2. Dépendances runtime

Les trois pages racine possèdent la même import map Firebase :

```html
<script type="importmap">
{
  "imports": {
    "firebase/app":       "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js",
    "firebase/auth":      "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js",
    "firebase/database":  "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js",
    "firebase/firestore": "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js"
  }
}
</script>
```

`firebase` est fixé à la version exacte `12.16.0` dans `package.json`. Aucun fichier
JavaScript ne contient d’URL CDN ni de version. `scripts/check-deps.mjs` vérifie les URLs,
l’identité des import maps et l’alignement des versions.

Firebase Storage reste hors périmètre : les cartes et portraits partagés sont publiés avec
le site statique. Une référence persistante est vide, relative au site ou HTTPS ; `data:`,
`blob:`, HTTP non chiffré et chemins locaux sont refusés.

## 3. Rendu Canvas 2D

`initStage(canvas)` configure un contexte 2D avec une résolution plafonnée. Les couches sont
des modules de dessin sans état global :

1. fond ;
2. grille ;
3. zone de mouvement ;
4. pions ;
5. futures couches de fog et de gabarits.

Les coordonnées suivent une chaîne unique :

```text
Cell / CellPoint → GridAdapter → MapPoint → Camera → ScreenPoint
```

Seul `grid/*` connaît `pxPerCell`. Seul `render/camera.js` convertit carte et écran.

La boucle est strictement à la demande :

```js
const frameLoop = new FrameLoop(renderAll)
frameLoop.requestFrame()
```

Plusieurs invalidations au cours du même tour sont coalescées. Une animation peut demander
la frame suivante ; sinon aucune nouvelle frame n’est planifiée. Le chargement asynchrone
d’une image invalide une seule fois lorsque son état devient `ready` ou `error`.

Les images sont recadrées avec `drawImage`. Une image absente ou en erreur affiche un
placeholder et ne rend pas la campagne invalide.

## 4. Firebase 12 modulaire

Le SDK Firebase ne peut être importé que par `js/transport/FirebaseTransport.js`.

- Realtime Database : événements de séance et présence.
- Firestore : snapshot durable.
- Google popup : authentification humaine.
- Email/mot de passe : compte technique des tests.
- `onAuthStateChanged` est attendu avant de conclure qu’une session est absente.
- Le snapshot est appliqué avant les deltas mis en tampon.
- L’écoute RTDB est bornée à la dernière clé connue afin de ne pas rejouer l’historique.
- Chaque événement porte `eventId` et `clientId`; un client ignore son propre écho.
- Toute erreur asynchrone remonte via `onError`.

Une configuration Web Firebase n’est pas un secret. En revanche, mot de passe, jeton
administratif et compte technique n’entrent jamais dans le dépôt ni dans le stockage
runtime de l’application.

## 5. Typage

Chaque fichier JavaScript commence par `// @ts-check`. Les types partagés résident dans
`js/core/types.js`, sans code exécutable.

`@ts-ignore` et `@ts-nocheck` sont interdits. La commande de référence est :

```text
pnpm run typecheck
```

Les dépendances de développement autorisées sont celles de `package.json` :
TypeScript, types Node, Playwright, Firebase pour ses types, et Jimp pour les outils image.

## 6. Tests

| Suffixe | Exécuteur | Portée |
|---|---|---|
| `*.test.mjs` | `node:test` | schéma, store, grille, import et transport pur |
| `*.spec.mjs` | Playwright Chromium | DOM, Canvas, entrées, F5, plusieurs pages |

Les tests navigateur utilisent le vrai Canvas et les vraies pages. Un double de transport
est acceptable pour simuler le canal, mais pas un faux moteur de rendu. Les tests Firebase
de bout en bout s’ignorent avec une raison explicite lorsque leur configuration externe est
absente.

## 7. Mise à jour des dépendances

Une montée de version est une tâche dédiée :

1. mettre à jour les import maps et `package.json` ;
2. régénérer le lockfile ;
3. lancer `check-deps`, le typage et les deux suites ;
4. documenter le résultat.

Les URLs CDN utilisent toujours une version complète et exacte.
