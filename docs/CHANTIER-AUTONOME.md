# CHANTIER AUTONOME — 25 août au 8 septembre 2026

> Le mainteneur est absent du **25 août au 8 septembre 2026**. Ce document est la **charte** du
> travail mené sans lui : ce qui est permis, ce qui est interdit, et quand s'arrêter.
>
> ⭐ **L'état vit dans le dépôt, jamais dans une session.** Journal, file de travail et branche sont
> des fichiers : n'importe quelle session — reprise, planifiée, relancée depuis un téléphone — peut
> continuer là où la précédente s'est arrêtée. C'est ce qui rend le dispositif survivable.

---

## 1. Pourquoi ce sont des sous-agents Claude et pas Gemini

Question tranchée le 18/08/2026 par quatre sondes, toutes négatives : `antigravity-ide chat`
n'injecte pas de prompt ; le CLI Gemini a vu son tier gratuit individuel fermé par Google ;
Antigravity ne déclare pas la capacité MCP `sampling` ; et le SDK `google-antigravity` existe mais
exige `GEMINI_API_KEY` ou Vertex, tous deux facturés à l'acte.

**Rien ne peut faire démarrer un tour de Gemini depuis l'extérieur.** L'abonnement du mainteneur
n'atteint Gemini qu'à travers l'IDE, et l'IDE attend un humain.

Donc : `implementer` (Sonnet) écrit le code, Opus rédige les briefs et vérifie. Voir la mémoire
`canal_gemini_antigravity` — ⛔ **ne pas refaire ces sondes.**

---

## 2. Ce qui entre dans la file, et le critère qui l'a décidé

⭐ **Une tâche n'entre ici que si sa réussite est vérifiable sans œil humain.** Un agent qui doit
conclure sans pouvoir mesurer conclut toujours que ça va — c'est la mécanique même du faux vert.

| # | Tranche | Vérifiable sans humain parce que |
|---|---|---|
| **1** | **M2 — section 16 de `diag.html`** (`BRIEF-PHASE-0-MESURES.md`) | l'arithmétique du champ lumineux est pure et testable ; ⚠ **le relevé chiffré attend la tablette**, donc le retour du mainteneur |
| **2** | **G-1 — API de grille explicite** (`PLAN-SUITE.md` §2.1) | géométrie pure : largeur d'un pion hexagonal aux deux parités de ligne, résultats carrés inchangés |
| **3** | **G-2 — avertissement `map_origin` non nul** (§2.2) | un import déclenche l'avertissement ou non ; binaire |
| **4** | **Phase 4 — bornes de ressources à l'import** (§5) | un fichier au-delà du plafond est rejeté ou non ; binaire |

⛔ **Explicitement hors file :**

- **le fog à la résolution du masque** — son critère est « rendu visuellement identique », donc
  invérifiable sans écran. Il attend le retour ;
- **tout ce qui touche au rendu à l'œil** : opacités, lisibilité des marqueurs, tenue sous cast ;
- **toute décision produit** : le modèle de lumière, le sens de `map_origin`, les seuils de tuilage.
  Ces arbitrages appartiennent au mainteneur, et son absence n'en transfère aucun.

---

## 3. Les règles du travail non surveillé

### Git

- ✅ Travail sur la branche **`autonome/2026-08`**, commits et `push` autorisés dessus.
- ⛔ **Jamais `main`.** Jamais `--force`. Jamais de suppression de branche, de tag ou d'historique.
- ⛔ Aucune fusion vers `main` : au retour, le mainteneur lit, puis décide. Un `git branch -D`
  doit suffire à tout annuler.

### La porte

- ⛔ **Aucun commit sans `pnpm run verify` verte.** Sans exception, sans « je corrigerai après ».
- Si la porte rougit et que la cause **n'est pas comprise** : s'arrêter, consigner au journal,
  passer à la tranche suivante. ⛔ **Ne pas réparer à l'aveugle** — deux corrections spéculatives
  empilées sur un défaut mal compris coûtent plus cher que l'attente.
- Une tranche n'est « faite » qu'après **preuve par mutation** : casser le mécanisme, voir le rouge,
  restaurer. Voir `.claude/skills/muter/SKILL.md`.

### La relecture

- Chaque implémentation est relue par un **agent distinct, à contexte neuf**, jamais par celui qui
  l'a écrite.
- ⚠ La revue tourne sur **arbre propre ou en worktree**. Un relecteur qui mute et révoque par
  `git checkout` efface le travail non commité fait en parallèle — c'est arrivé le 17/08.
- On relit **le code**, jamais le compte rendu. Chaque livraison relue a révélé au moins un écart
  avec son walkthrough.

### Les bornes

- **Une tranche à la fois**, dans l'ordre du §2. Pas de travail en parallèle sur le même arbre.
- **Plafond : trois tentatives par tranche.** Au-delà, on s'arrête et on consigne : s'acharner sans
  compréhension neuve ne produit que du bruit à démêler au retour.
- ⛔ **La file est finie.** Quand elle est vide, **s'arrêter**. Ne pas inventer de travail, ne pas
  « améliorer en passant », ne pas ouvrir un chantier non listé.

---

## 4. Le journal

`docs/JOURNAL-AUTONOME.md`, tenu à jour **à chaque tranche** et à chaque arrêt.

Une entrée porte : la date, la tranche, ce qui a été fait, la mutation qui a prouvé le test, l'état
de la porte, et — le plus important — **ce qui a bloqué et pourquoi**, en cas d'arrêt.

⭐ Ce journal est écrit pour être lu par quelqu'un qui revient de deux semaines d'absence et n'a
aucun contexte frais. Un arrêt bien expliqué vaut mieux qu'une tranche mal finie.

---

## 5. Ce que le mainteneur doit faire avant de partir

1. ⭐ **Le relevé M1 sur la tablette** — cinq minutes, protocole dans `BRIEF-PHASE-0-MESURES.md`.
   Sans lui, la décision sur le fog reste en suspens deux semaines de plus.
2. **Machine allumée, mise en veille désactivée.** Rien ne tourne sur un poste endormi.
3. **Pousser `main`** pour que la branche autonome parte d'un état connu et partagé.

---

## 6. Ce qui l'attend au retour

Une branche à lire, un journal qui dit ce qui s'est passé et ce qui a bloqué, et **quatre décisions
intactes** — le modèle de lumière, le sens de `map_origin`, le fog, les seuils. Aucune n'aura été
prise en son absence.
