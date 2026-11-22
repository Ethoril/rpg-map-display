# Tour de jeu, portes et liaisons — tâches

Spec : `CADRAGE-TOUR-DE-JEU-2026-11-22.md`. Plan : `PLAN-TOUR-DE-JEU-2026-11-22.md`.
Chaque tâche est un brief autonome. `[P]` = parallélisable (aucun fichier commun).

- [ ] **T1 [P] — Inscrire les sept arbitrages du 22/11/2026.**
  Objectif : qu'aucune décision de cette séance ne vive seulement dans une conversation.
  Fichiers : `docs/QUESTIONS-EN-ATTENTE.md` (nouvelle section TJ, sept entrées « ✅ TRANCHÉ »).
  Couvre : rien de fonctionnel. Acceptation : les sept arbitrages de la spec s'y retrouvent mot
  pour mot (bouton plutôt qu'automatique, `ref` null = libre, libération à la déconnexion, bouton
  d'adjacence et bouton unique déporté, porte verrouillée sans bouton, glisser MJ qui ne consomme
  pas, annulation du tour entier en session liée seulement, noms `turn.select` / `turn.undo`).

- [ ] **T2 — Écrire les tests unitaires du tour et du budget, rouges aujourd'hui.**
  Objectif : figer les signatures de la spec avant d'écrire le code qui les tient.
  Fichiers : `tests/tourDeJeu.test.mjs` (nouveau).
  Couvre : CA14–CA21. Acceptation : `pnpm run test:unit` échoue sur ce fichier et sur lui seul,
  avec des messages qui nomment la fonction manquante.
  Cas : `isPlayerManipulableToken` sans tour / avec tour sur un autre pion / sur un pion sans
  `link` ; `movementRulesFor(token, level, 3)` qui rend `budget − 3` et `walkBudget − 3`
  (plancher 0) ; `setTurn` du même pion deux fois qui ne remet pas `spentCells` à zéro ;
  `setTurn` d'un autre pion qui le remet ; `undoTurnMove` qui rend la case de départ et lève sur
  une case occupée.

- [ ] **T3 — État de tour dans le store, non persisté.** après : T2
  Objectif : `getTurn` / `setTurn` / `addTurnSpent` / `undoTurnMove`, sur le modèle de
  `getSessionVision`.
  Fichiers : `js/state/store.js`, `js/core/types.js` (typedef `Turn`).
  Couvre : CA19, CA23, CA26. Acceptation : les cas de store de `tests/tourDeJeu.test.mjs`
  passent ; `resetStore` efface le tour ; rien n'entre dans `createSnapshotPayload`.

- [ ] **T4 — Le budget retranche les cases déjà parcourues.** après : T3
  Objectif : `movementRulesFor(token, level, spentCells = 0)` et sa lecture dans le contrôleur.
  Fichiers : `js/state/selection.js`, `js/app/movePlanning.js`.
  Couvre : CA18, CA21. Acceptation : les cas de budget de `tests/tourDeJeu.test.mjs` passent ;
  `js/ui/player/gameHelp.js` n'est pas touché et ses tests restent verts.

- [ ] **T5 — Le tour bride la manipulation côté joueurs.** après : T3
  Objectif : `isPlayerManipulableToken(token, turn)`, et le tour lu aux six appels de la vue
  joueurs.
  Fichiers : `js/input/tokenHit.js`, `js/ui/player/bootstrap.js`, `js/app/player.js`.
  Couvre : CA14–CA17. Acceptation : les cas de bridage de `tests/tourDeJeu.test.mjs` passent ; un
  PJ bridé touché ouvre la consultation existante, sans nouvelle interface.

- [ ] **T6 — `turn.select` et `turn.undo`.** après : T3
  Objectif : les deux événements du §7, publiés par le MJ et appliqués par la tablette.
  Fichiers : `js/app/networkEvents.js`, `js/app/gm.js`, `js/app/mjLink.js`, `js/app/player.js`.
  Couvre : CA19, CA20, CA24. Acceptation : un test de réducteur par événement (payload malformé
  refusé bruyamment, rejeu inoffensif) ; le compteur s'incrémente dans `reportMove` et **pas** au
  glisser libre ; `turn.select` repart à l'arrivée d'une présence joueurs.

- [ ] **T7 [P] — Boutons de porte : géométrie pure et rendu.**
  Objectif : `boutonsPorte(grid, level, tokens, options)` et son dessin, au-dessus du brouillard.
  Fichiers : `js/render/layers/portals.js`, `tests/tourDeJeu.test.mjs` (cas de géométrie).
  Couvre : CA6–CA10. Acceptation : côté opposé au PJ vérifié sur les quatre orientations de porte
  en carré et en hexagonal ; deux PJ encadrant la même porte rendent **un** bouton déporté ; porte
  `locked` n'en rend aucun ; `enabled: false` hors tour. `rect` en unités carte, côté `44 / zoom`.

- [ ] **T8 [P] — Bouton de liaison : géométrie pure et rendu.**
  Objectif : `boutonLiaison(grid, level, links, token, options)`, et `renderPrompt` réduit à la
  seule mention « Descendre de cheval ».
  Fichiers : `js/render/layers/links.js`, `tests/tourDeJeu.test.mjs` (cas de géométrie).
  Couvre : CA1, CA4. Acceptation : un bouton sur une extrémité franchissable par les joueurs,
  aucun sur une liaison MJ seule ni sur l'entrée B d'un sens unique (la règle d'`extremiteJoueur`
  reste la seule) ; aucun bouton si le pion est monté, la mention restant affichée.

- [ ] **T9 — Le tap des boutons remplace le toucher de la porte et le re-tap de l'escalier.**
  après : T7, T8
  Objectif : brancher les deux boutons sur le tap, et retirer les deux gestes qu'ils remplacent.
  Fichiers : `js/ui/player/bootstrap.js`.
  Couvre : CA2, CA3, CA11, CA12. Acceptation : le bloc `portalIsCloser` disparaît de la vue
  joueurs ; retaper la case du pion ne publie plus `link.traverse` ; un tap dans le `rect` d'un
  bouton publie l'événement correspondant ; aucun bouton n'est testé si une préparation est en
  cours. La vue MJ (`js/app/gm.js`) garde son `findHitPortal` : CA13.

- [ ] **T10 — Dessin des boutons et bouton d'annulation.** après : T6, T7, T8
  Objectif : les boutons dans le rang `feedback`, et le bouton d'annulation en haut à droite.
  Fichiers : `js/app/player.js`.
  Couvre : CA8, CA22, CA25, CA27. Acceptation : les boutons se redessinent au changement d'état
  sans boucle active au repos (rendu à la demande conservé) ; le bouton d'annulation n'existe que
  si `getTurn()` désigne un PJ de la tablette avec `spentCells > 0`, à `right: 116px`, 44 × 44 px ;
  il publie `turn.undo` et disparaît.

- [ ] **T11 — Scénarios e2e.** après : T9, T10
  Objectif : prouver les gestes réels sur un vrai Canvas.
  Fichiers : `tests/tourDeJeu.spec.mjs` (nouveau).
  Couvre : CA1–CA13, CA22–CA27. Acceptation : `pnpm run test:e2e` vert sur les six scénarios —
  ouvrir une porte par le bouton, la refermer, toucher la porte sans effet, franchir par le bouton,
  annuler un mouvement interrompu et retrouver sa zone entière, brouillard non régressé après
  l'annulation.

- [ ] **T12 — Amender les documents normatifs.** après : T11
  Objectif : qu'aucun écart ne reste entre le code et les documents qui font foi.
  Fichiers : `docs/CAHIER-DES-CHARGES.md` (§5.3, §5.3bis, §7), `docs/CONVENTIONS.md` (règle 1
  amendée, trois dérogations à la règle 2), `docs/CONTRAT-LIAISON-OUTIL-MJ.md` (§10),
  `docs/ARCHITECTURE.md` (§1 : les deux fichiers de test), `docs/ETAT.md` (table « Suite produit »).
  Acceptation : `pnpm run test:unit` vert (le test d'architecture lit ces documents) ; la phrase du
  §10 porte la mention « à reporter dans la copie du dépôt outil MJ ».

- [ ] **T13 — La porte, puis la mutation.** après : T12
  Objectif : ne rien annoncer de vert sans l'avoir vu rouge d'abord.
  Acceptation : `pnpm run verify` code 0, puis **mutation de l'effet** de chacun des sept
  mécanismes — côté opposé du bouton de porte, grisé hors tour, retranchement du budget, remise à
  zéro au changement de tour, non-consommation du glisser, replacement à l'annulation, absence de
  bouton pendant une préparation. Chaque mutation doit faire rougir un test nommé ; celles qui
  n'en font rougir aucun deviennent des tâches.
