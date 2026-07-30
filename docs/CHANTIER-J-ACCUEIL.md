# Chantier J — page d'accueil et déplacement de la vue MJ

> Brief d'exécution **court**, écrit le 30 juillet 2026. Autonome : tout ce qui suit a été
> vérifié dans le dépôt, il n'y a rien à redécouvrir.
>
> **Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la fin du
> chantier. Aucun critère d'acceptation ne peut être affaibli ni réécrit pour coller au
> comportement obtenu.
>
> **Chantier mécanique, à faible invention.** L'essentiel est un renommage cohérent. Le
> risque n'est pas la difficulté, c'est l'oubli : une référence laissée sur `index.html`
> donnera un test vert qui teste la mauvaise page, ou une page blanche en production.

---

## 1. Pourquoi

`index.html` **est** la vue MJ. Ouvrir une séance demande donc de connaître deux URL et de
se rappeler laquelle sert à quoi, sur trois écrans dont une tablette. La racine devient une
page d'accueil qui aiguille vers l'un des deux rôles.

---

## 2. Faits établis — ne pas les redécouvrir

1. **Les deux fichiers sont déjà au manifeste**, avec la justification en note sous
   l'arborescence du §1 d'`ARCHITECTURE.md` : `index.html` `[1b]` devient la page d'accueil,
   `gm.html` `[1a]` reçoit la vue MJ. **Aucun autre fichier de la racine ne doit être créé.**
2. **`check-deps.mjs` impose que toute page `.html` de la racine porte une import map
   identique à celle d'`index.html`** (lignes 45-57), et lit `index.html` comme référence
   (ligne 43). C'est « la seule garantie mécanique contre une dérive de version entre deux
   vues ». Deux conséquences, toutes deux à traiter :
   - la page de référence devient **`gm.html`** ;
   - la page d'accueil **ne charge aucun module**, donc n'a aucune import map. Une page sans
     module n'a aucune version dont dériver : elle est **exemptée** de la comparaison, et
     l'exemption doit être **narrowly scoped** — l'absence de `<script type="module">` en est
     le seul critère.
3. **Le serveur de développement et GitHub Pages servent déjà `/` → `index.html`**
   (`scripts/serve.mjs:49`). Rien à changer : la page d'accueil sera à la racine par le seul
   fait de s'appeler `index.html`.
4. **`playwright.config.mjs:32`** utilise `${BASE_URL}/index.html` comme sonde de démarrage
   du serveur. L'URL reste valide (ce sera la page d'accueil), donc **rien à changer** —
   c'est une sonde de disponibilité, pas un test de contenu.
5. **La session MJ se résout ainsi** (`js/app/gm.js:161-162`) :
   `options.sessionId || urlParams.get('session') || defaultGmSessionId()`, ce dernier
   générant un identifiant et le mémorisant dans `sessionStorage` sous `rpg-gm-session-id`
   (lignes 41-50). **Le MJ peut donc ouvrir sa vue sans paramètre** et obtenir une session
   valide. La vue joueurs, elle, doit rejoindre une session existante : elle a besoin de
   l'identifiant.
6. **43 occurrences d'`index.html` dans 23 fichiers** au moment d'écrire ce brief. Dans
   `tests/`, **toutes** désignent la vue MJ et deviennent `gm.html`.
7. **Zero-UI ne concerne que `player.html`** (`tests/player.spec.mjs:341`). Des `button` et
   `input` sur la page d'accueil ne posent aucun problème.

---

## 3. Décisions arrêtées par le mainteneur

1. **La page d'accueil est du HTML statique, sans aucun JavaScript.** Un formulaire
   `method="get"` suffit à produire `gm.html?session=…` ou `player.html?session=…`. C'est ce
   qui la rend exempte d'import map, et ça supprime une surface de bug entière.
2. **Le champ session est unique et partagé par les deux rôles.** Côté MJ il est
   **facultatif** — le laisser vide ouvre `gm.html` sans paramètre, et `gm.js` génère la
   session (§2.5). Côté joueurs il est **obligatoire** : sans identifiant, rejoindre n'a pas
   de sens. Utiliser l'attribut `required` du formulaire joueurs, pas une validation en JS.
3. **Les documents historiques ne sont pas réécrits.** `docs/TASKS-lot1a.md`,
   `docs/PLAN-STABILISATION-CANVAS.md` et `docs/TRAVAIL-2907SOIR.md` sont des relevés datés :
   y remplacer `index.html` falsifierait le compte rendu. Seuls les documents **normatifs ou
   courants** sont mis à jour : `README.md` (ligne 39) et `docs/ETAT.md`.
   `ARCHITECTURE.md` est déjà fait.

---

## 4. Contrat

1. **`gm.html`** — la vue MJ actuelle, déplacée telle quelle depuis `index.html`, import map
   inchangée. Aucun changement de comportement.
2. **`index.html`** — page d'accueil : deux chemins clairement identifiés (« MJ » et
   « Joueurs »), un champ de session partagé, aucun module, aucune import map. Lisible sur
   une tablette.
3. **`scripts/check-deps.mjs`** — page de référence sur `gm.html` ; exemption des pages de la
   racine sans `<script type="module">`, avec un commentaire disant **pourquoi** (une page
   sans module n'a pas de version dont dériver). Le script doit continuer à échouer si
   `player.html` et `gm.html` divergent : c'est sa raison d'être.
4. **`tests/`** — toutes les navigations vers la vue MJ passent à `gm.html`.
5. **`README.md` et `docs/ETAT.md`** — l'URL d'entrée devient la racine, et la vue MJ
   `gm.html`.

---

## 5. Interdictions

- Ne pas créer de fichier à la racine hors des deux déjà inscrits au manifeste.
- **Ne pas mettre de JavaScript dans la page d'accueil**, ni d'import map : c'est ce qui
  justifie l'exemption de `check-deps`.
- **Ne pas élargir l'exemption de `check-deps` au-delà de l'absence de module.** Exempter par
  nom de fichier, ou désactiver la comparaison, détruirait la garantie contre deux clients
  de versions différentes sur une même session.
- Ne pas fusionner les rôles : `player.html` reste une page distincte et zéro-UI.
- Ne pas toucher au contenu de la vue MJ : ce chantier la **déplace**, il ne la modifie pas.
- Ne pas réécrire les documents historiques du §3.3.
- Ne pas modifier `playwright.config.mjs` (§2.4) ni `scripts/serve.mjs` (§2.3).
- Ne pas commiter : le mainteneur relit puis commite.

---

## 6. Tests

- **Navigateur** — la page d'accueil expose les deux chemins, et **ne charge aucun module**
  (aucun `script[type="module"]` dans le DOM).
- **Navigateur** — depuis l'accueil avec une session saisie, le chemin MJ arrive sur
  `gm.html` avec le bon `?session=`, et le chemin joueurs sur `player.html` avec le même.
- **Navigateur** — le chemin joueurs **sans** session saisie ne navigue pas (champ requis).
- **Navigateur** — le chemin MJ **sans** session saisie arrive sur `gm.html` et obtient une
  session valide malgré tout (§2.5).
- **Navigateur** — toute la suite existante reste verte après renommage, en particulier T-23
  et T-24b, qui font converger deux pages.
- **Node** — `pnpm run check-deps` sort en 0 ; et il sort **non nul** si l'on fait diverger
  artificiellement l'import map de `player.html` de celle de `gm.html`.

---

## 7. Acceptation

1. `pnpm run verify` en code 0.
2. `pnpm run check-deps` en code 0.
3. Ouvrir `/` propose les deux rôles ; ouvrir `/gm.html` donne la vue MJ d'avant, à
   l'identique ; ouvrir `/player.html?session=…` est inchangé.
4. **Aucune occurrence d'`index.html` ne subsiste dans `tests/`.**
5. La suite unitaire reste sous 3 s.
6. `ARCHITECTURE.md` §1 n'est **pas modifié par l'exécution** : les deux pages y sont déjà
   inscrites, l'amendement a été fait en amont avec sa justification.

---

## 8. Ce qui sera contrôlé à la relecture

Indépendamment de ce que le rapport d'exécution affirmera :

- **`grep -r "index\.html" tests/` doit ne rien retourner.** Un test resté sur `index.html`
  chargerait la page d'accueil, n'y trouverait pas ce qu'il attend, et son échec — ou son
  succès par accident — serait trompeur.
- **Test de mutation sur `check-deps`** : en faisant diverger l'import map de `player.html`,
  le script doit échouer. S'il passe, l'exemption a été élargie trop loin et la garantie est
  perdue.
- Que la page d'accueil ne contient **réellement** ni `<script>` ni import map, vérifié par
  un test et non affirmé.
- Que la vue MJ n'a pas été modifiée au passage : le diff de `gm.html` par rapport à l'ancien
  `index.html` doit être vide ou limité au strict nécessaire.
- Que les trois documents historiques du §3.3 sont **intacts**.
- Qu'aucun critère ci-dessus n'a été réécrit pour coller au résultat obtenu.
