# rpg-map-display

VTT minimaliste pour une table de jeu de rôle hybride : le MJ pilote depuis un ordinateur,
les joueurs utilisent une tablette tactile dont l’écran peut être casté vers une TV.

Le lot actuel fournit le plateau Canvas 2D, les cartes calibrées, les pions, le déplacement,
la persistance locale et la synchronisation Firebase. En développement local, les images
partagées sont des fichiers servis depuis `maps/` : une URL `data:` ou `blob:` n’entre jamais
dans la campagne durable. Le paquet public Pages exclut provisoirement les cartes et portraits
du dépôt, faute de droits de diffusion documentés.

## Documents de référence

Lire avant une modification importante :

1. [Cahier des charges](docs/CAHIER-DES-CHARGES.md)
2. [Stack](docs/STACK.md)
3. [Conventions](docs/CONVENTIONS.md)
4. [Architecture](docs/ARCHITECTURE.md)
5. [Plan de stabilisation Canvas](docs/PLAN-STABILISATION-CANVAS.md)
6. [État courant](docs/ETAT.md)
7. [Feuille de route complémentaire](docs/FEUILLE-DE-ROUTE-COMPLEMENTAIRE.md)

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

L’application est servie sur `http://127.0.0.1:4173/` (page d'accueil). La vue MJ est sur
`gm.html` (ou `gm.html?session=<identifiant>`) et la vue joueurs sur `player.html?session=<identifiant>`.

Sans configuration Firebase, les pages annoncent explicitement le mode local. La
configuration Firebase Web, publique par nature, peut être injectée via
`window.RPG_FIREBASE_CONFIG` ou `localStorage["rpg-firebase-config"]`. Aucun mot de passe
ni compte de test ne doit y figurer.

## Préparer une carte locale

Le fichier image doit être copié ou généré dans `maps/`, puis l’étage référence son chemin
canonique, par exemple `maps/manoir-rdc.webp`. L’aperçu local d’un fichier choisi dans le
navigateur peut utiliser une URL temporaire, mais l’interface refuse de l’enregistrer.

Pour un export UVTT :

```text
node scripts/import-uvtt.mjs chemin/vers/carte.uvtt
```

Pour rendre ensuite cette carte publique, il faut documenter son auteur, sa provenance, sa
licence ou son autorisation de diffusion, ajouter ses fichiers à la liste blanche de
`scripts/build-site.mjs`, conserver son entrée de catalogue dans le paquet construit et compléter
`attributions.html`. Tant que ces étapes ne sont pas faites, `pnpm run build:site` publie des
catalogues de cartes et de portraits vides.

## Créer un pion

Le générateur de pions **embarque** l’image recadrée dans le pion : elle s’affiche
immédiatement côté MJ et côté joueurs, sans fichier à déposer ni commit. L’image est
ré-encodée pour tenir sous 24 KiB, et le cumul par campagne est plafonné à 512 KiB — le
document Firestore d’une campagne est limité à 1 MiB.

Renseigner le champ « URL publiée » change ce comportement : le pion référence alors ce
chemin, et le fichier doit exister sous `maps/tokens/`. C’est la voie à préférer pour un PNJ
récurrent, que la bibliothèque de pions (`maps/tokens/catalog.json`) sert ensuite sans
dupliquer ses octets dans chaque campagne.

Un fond d’étage, lui, n’accepte **jamais** d’image embarquée : voir
`docs/ETAT.md` § « Persistance et assets ».

## Modifier ou supprimer un pion

Sélectionner un pion sur la carte, puis ouvrir l’onglet **Pions** du panneau MJ. La section
« Pion sélectionné » permet d’en changer le nom, le type, la couleur de bordure, la taille,
la vitesse, l’élévation, et les trois drapeaux (masqué aux joueurs, déplaçable par les
joueurs, verrouillé). La suppression demande une confirmation ; elle est irréversible.

Restent volontairement hors de portée d’une modification : la **position** (elle passe par le
déplacement, qui porte l’animation), l’**étage**, l’**identifiant**, et l’**image**. Changer
d’image, c’est repasser par le générateur.

Un patch refusé par la validation — agrandir un pion au point de le sortir de l’étage, par
exemple — ne mute rien et le champ revient à la valeur du store, avec la raison affichée.

## Vérifications

```text
pnpm run typecheck
pnpm run test:unit
pnpm run test:firebase-rules  # exige Java 21 ; obligatoire dans la CI
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

## Licence et publication

Le code est un projet personnel : aucune licence générale de redistribution n’est déclarée.
Les icônes d’état sont attribuées sous CC BY 3.0 dans
[`attributions.html`](attributions.html). Les cartes et portraits présents dans le dépôt ne
portent pas de provenance ou d’autorisation de diffusion vérifiable ; ils sont donc exclus du
paquet GitHub Pages jusqu’à documentation de leurs droits.
