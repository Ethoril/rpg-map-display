# rpg-map-display

VTT (table de jeu de rôle virtuel) minimaliste pour **table physique hybride** : le MJ sur
un Mac, les joueurs sur une tablette tactile, et l'écran de la tablette casté vers une TV.

Manipulation de carte, pions, brouillard de guerre et éclairage dynamique. Rien d'autre :
ni fiches de personnage, ni jets de dés, ni tchat.

---

## Pour une IA qui vient écrire du code ici

**Lire ces documents dans cet ordre, en entier, avant d'écrire la moindre ligne :**

| Ordre | Document | Rôle |
|---|---|---|
| 1 | [docs/CAHIER-DES-CHARGES.md](docs/CAHIER-DES-CHARGES.md) | Le **quoi** et le **pourquoi**. Décisions arbitrées, schéma de données, protocole. |
| 2 | [docs/STACK.md](docs/STACK.md) | Versions épinglées et idiomes autorisés. **Normatif.** |
| 3 | [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Conventions et **17 interdictions**. **Normatif.** |
| 4 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Manifeste de fichiers **fermé**, règles d'import, interfaces. **Normatif.** |
| 5 | [docs/TASKS-lot1a.md](docs/TASKS-lot1a.md) | Le travail à faire, tâche par tâche. |
| 6 | [docs/FIXTURES.md](docs/FIXTURES.md) | Jeux de données de test. |
| 7 | [docs/ETAT.md](docs/ETAT.md) | Où en est le projet, quelle tâche suit, et pourquoi certaines règles existent. |

### Les cinq règles qui comptent le plus

1. **Une tâche à la fois**, dans l'ordre de `TASKS-lot1a.md`, avec un rapport de trois
   lignes à chaque fois. **S'arrêter à chaque point de contrôle** (⛔) et attendre.
   **Ne jamais commiter** : les modifications restent dans l'arbre de travail, le
   mainteneur commite après relecture.
2. **Ne jamais créer un fichier absent du manifeste**, ni ajouter une dépendance absente de
   la stack. Proposer, ne pas décider. Et **ne jamais remplacer une dépendance réelle par un
   faux** pour qu'un test passe : une vérification satisfaite contre une imitation coûte plus
   cher qu'une vérification absente, parce qu'elle ferme la question.
3. **Ne jamais ajouter de drag & drop de pion à la vue joueurs.** Le déplacement se fait en
   tap pion → tap case de destination. Le drag tactile a été testé puis abandonné ; le
   remettre est une régression, pas une amélioration.
4. **Ne jamais cocher un critère de performance** (30 fps, tenue thermique, limite de
   texture). Ils exigent la tablette physique : les signaler « à vérifier par le
   mainteneur ».
5. **En cas de doute, s'arrêter et demander.** Un blocage signalé coûte une question. Une
   tâche déclarée terminée à tort coûte une session de débogage.

### En cas de blocage

Livrer ce qui fonctionne, dire explicitement ce qui manque et pourquoi, et **ne pas cocher
la tâche**. Un rapport honnête d'échec partiel est utile.

---

## État

**Lot 1a « Le plateau » — 15 tâches sur 28.** Fondations, grille, déplacement et import
terminés ; scène Pixi en place, intégration en attente. Prochaine tâche : **T-13** (store).

👉 **[docs/ETAT.md](docs/ETAT.md)** — état détaillé, procédure de reprise, points de
vigilance et décisions en attente. **À lire en premier après une interruption ou un
changement de machine.**

## Développement

### ⚠️ Après un clone, avant tout commit

La configuration d'identité git est **locale au dépôt** et ne survit pas à un clone :

```
git config user.name 'ethoril'
git config user.email 'ethoril@gmail.com'
```

### Commandes

```
pnpm install
pnpm exec playwright install chromium   # une fois par machine
pnpm run typecheck                   # doit être propre, code de sortie 0
pnpm run check-deps                  # URLs de l'import map + versions devDependencies
pnpm stamp                           # incrémente le build, régénère js/core/version.js
node scripts/make-fixture.mjs        # génère les fixtures de test (dès T-10)
pnpm run test:unit                   # node:test — logique pure, aucun navigateur
pnpm run test:e2e                    # Playwright — navigateur, vrai Pixi (réseau requis)
pnpm test                            # les deux, dans cet ordre
pnpm run serve                       # serveur statique local (http://127.0.0.1:4173)
```

**Deux familles de tests, deux exécuteurs** (`docs/STACK.md` §5) : `tests/*.test.mjs` sous
`node:test` pour la logique pure, `tests/*.spec.mjs` sous Playwright pour tout ce qui touche au
navigateur. Un module qui importe `pixi.js` se teste en `*.spec.mjs` — le tester sous Node
exigerait un faux Pixi, ce qui est interdit.

Si `pnpm` manque au PATH, `corepack pnpm …` fonctionne sans rien installer.

Développement sous **Windows**, table de jeu sur **Mac** : tout script d'outillage est en
Node et reste cross-platform. Aucun `.sh`, aucun `.bat`, aucun chemin construit à la main.

## Licence

Projet personnel. Les cartes déposées dans `maps/` et `fixtures/real/` peuvent être soumises
à des licences tierces — vérifier avant publication.
