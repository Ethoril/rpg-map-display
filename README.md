# rpg-map-display

VTT minimaliste pour une table de jeu de rôle hybride : le MJ pilote depuis un ordinateur,
les joueurs utilisent une tablette tactile dont l’écran peut être casté vers une TV.

Le lot actuel fournit le plateau Canvas 2D, les cartes calibrées, les pions, le déplacement,
la persistance locale et la synchronisation Firebase. Les images partagées sont des fichiers
publiés dans `maps/` : une URL `data:` ou `blob:` n’entre jamais dans la campagne durable.

## Documents de référence

Lire avant une modification importante :

1. [Cahier des charges](docs/CAHIER-DES-CHARGES.md)
2. [Stack](docs/STACK.md)
3. [Conventions](docs/CONVENTIONS.md)
4. [Architecture](docs/ARCHITECTURE.md)
5. [Plan de stabilisation Canvas](docs/PLAN-STABILISATION-CANVAS.md)
6. [État courant](docs/ETAT.md)

Les règles essentielles :

- Canvas 2D est le moteur officiel. Ne pas réintroduire l’ancienne implantation Pixi.
- La boucle de rendu s’arrête complètement lorsque la scène est immobile.
- La vue joueurs utilise `tap pion → tap destination`; aucun drag de pion côté joueurs.
- Une image durable est une URL relative ou HTTPS publiée, jamais une URL temporaire.
- Toute mutation est validée avant de remplacer l’état courant.
- Les mesures de tenue thermique et de fluidité sous cast restent à valider sur la tablette.
- Ne pas commiter automatiquement : le mainteneur relit puis commite.

## Démarrage

```text
pnpm install
pnpm exec playwright install chromium
pnpm run serve
```

L’application MJ est servie sur `http://127.0.0.1:4173/index.html`. La vue joueurs est
`player.html?session=<identifiant>`.

Sans configuration Firebase, les pages annoncent explicitement le mode local. La
configuration Firebase Web, publique par nature, peut être injectée via
`window.RPG_FIREBASE_CONFIG` ou `localStorage["rpg-firebase-config"]`. Aucun mot de passe
ni compte de test ne doit y figurer.

## Publier une carte

Le fichier image doit être copié ou généré dans `maps/`, puis l’étage référence son chemin
canonique, par exemple `maps/manoir-rdc.webp`. L’aperçu local d’un fichier choisi dans le
navigateur peut utiliser une URL temporaire, mais l’interface refuse de l’enregistrer.

Pour un export UVTT :

```text
node scripts/import-uvtt.mjs chemin/vers/carte.uvtt
```

## Vérifications

```text
pnpm run typecheck
pnpm run test:unit
pnpm run test:e2e
pnpm run check-deps
pnpm test
```

Deux familles de tests sont conservées :

- `tests/*.test.mjs` : logique pure sous `node:test` ;
- `tests/*.spec.mjs` : DOM, Canvas, gestes, rechargement et plusieurs pages sous Playwright.

Les deux scénarios Firebase réels sont ignorés uniquement lorsque
`RPG_FIREBASE_CONFIG` ne contient pas la configuration et le compte technique requis.

## Contraintes de développement

Le projet reste sans build : ES Modules natifs, JavaScript vérifié par JSDoc/TypeScript,
et pages statiques compatibles GitHub Pages. Les scripts sont en Node et doivent fonctionner
sous Windows comme sous macOS.

## Licence

Projet personnel. Les cartes déposées dans `maps/` et `fixtures/real/` peuvent être soumises
à des licences tierces ; les vérifier avant publication.
