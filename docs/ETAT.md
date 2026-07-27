# ÉTAT D'AVANCEMENT & REPRISE

> Dernière mise à jour : **27 juillet 2026**, après T-03c.
> Document vivant : à réactualiser à chaque fin de séance de travail.

---

## 1. Reprise sur une nouvelle machine — à faire dans cet ordre

### ⚠️ Étape 1 : l'identité git, AVANT tout commit

**La configuration d'identité est locale au dépôt et ne survit pas à un clone.** La
configuration globale de la machine d'origine était vide : rien ne protège par défaut.
Sans ce geste, un commit peut publier une identité nominative sur un dépôt public.

```
git clone https://github.com/Ethoril/rpg-map-display.git
cd rpg-map-display
git config user.name 'ethoril'
git config user.email 'ethoril@gmail.com'
git config user.name && git config user.email     # vérifier avant de continuer
```

### Étape 2 : dépendances et contrôles

```
pnpm install
pnpm run typecheck      # doit sortir en 0, sans aucune erreur
pnpm run check-deps     # doit sortir en 0, 5 URLs en 200
pnpm stamp              # incrémente le build et régénère js/core/version.js
```

Si `typecheck` ou `check-deps` échoue sur un dépôt fraîchement cloné, **ne pas commencer
une tâche** : quelque chose a changé côté CDN ou côté outillage, et c'est à diagnostiquer
d'abord.

### Étape 3 : ce qui ne voyage pas avec le dépôt

- `node_modules/` — reconstruit par `pnpm install`.
- `fixtures/real/` — **ignoré par git**. Les exports UVTT réels sont à redéposer à la main
  (cf. `FIXTURES.md` §1). Tant que ce dossier est vide, le parsing UVTT n'est validé qu'en
  théorie.
- Aucune clé ni configuration Firebase n'existe encore dans le dépôt. Elle arrivera à T-14.

---

## 2. Où on en est

### Fait

| Tâche | Objet | Commit |
|---|---|---|
| T-01 | Squelette : `package.json`, `jsconfig.json`, `.gitignore`, `.gitattributes` | `4cea42a` |
| T-02 | `js/core/types.js` — schéma du CdC §6 en JSDoc | `bb4198e` |
| T-02b | `CellPoint`, `ScreenPoint`, `Presence` ; `offsetX/Y` obligatoires | `2131870` |
| T-03 | `js/core/constants.js` — 5 constantes commentées | `cfdb211` |
| T-03b | `stamp-version.mjs`, `check-deps.mjs`, `index.html` (import map seule) | `6f36b97` |
| T-03c | `@types/node`, typage réel des scripts, registre npm non bloquant | `6f36b97` |

État courant : **build 4**, versions figées `pixi.js@8.19.0` et `firebase@12.16.0`,
typecheck propre, aucun `@ts-nocheck` dans le dépôt.

### Prochaine étape

**T-04 — clés canoniques** (`js/core/cellKey.js` + tests).

Piège du contrat à surveiller : `edgeKey` doit être **commutatif**
(`edgeKey(A,B) === edgeKey(B,A)`) et sans collision entre `{a:1,b:23}` et `{a:12,b:3}`.

Puis **T-05** (interfaces), **T-06** (schéma & validation), et le **point de contrôle 1**
qui clôt les fondations. Reste 21 tâches sur 27 pour le lot 1a.

---

## 3. Comment relancer l'implémenteur

Message d'ouverture à donner tel quel :

> Lis `README.md`, puis dans l'ordre `docs/CAHIER-DES-CHARGES.md`, `docs/STACK.md`,
> `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`, `docs/TASKS-lot1a.md`, `docs/FIXTURES.md`
> et `docs/ETAT.md`. Ne code rien avant d'avoir tout lu.
> Puis réalise **uniquement la tâche T-04**, et arrête-toi. Rapport de trois lignes,
> terminé par la ligne « Écarts » même si elle est vide.

**Le « uniquement T-04 » est la partie qui compte.** Un modèle à qui l'on donne la liste
entière en enchaîne plusieurs et le contrôle point à point est perdu.

Après chaque correction apportée aux documents, **lui faire relire `CONVENTIONS.md`**. Les
écarts constatés jusqu'ici venaient tous d'une lecture périmée, pas d'une désobéissance.

---

## 4. Corrections du plan apportées en cours de route

Trois défauts ont été trouvés pendant les six premières tâches, et **les trois venaient des
documents de spécification**, pas de l'implémentation. Ils sont consignés ici parce qu'ils
expliquent des règles qui paraîtraient sinon arbitraires.

**Critère de vérification contradictoire (T-01).** Le critère exigeait que `tsc` s'exécute
sans erreur avec zéro fichier source — or `TS18003` sort en code 2 par construction. D'où
la règle : *un critère inatteignable est un défaut du plan, à signaler et arbitrer, jamais
à contourner ni à déclarer satisfait.* Commit `0a124d0`.

**Unités indistinguables par le compilateur (T-02).** Le CdC typait la géométrie en unités
de case avec la même forme `{x, y}` que les pixels. Le typage JavaScript étant structurel,
les deux étaient interchangeables : **le piège n°1 du projet échappait au typechecker.**
D'où les quatre formes à noms de propriétés distincts — `Cell {a,b}`,
`CellPoint {cellX,cellY}`, `MapPoint {x,y}`, `ScreenPoint {screenX,screenY}`. Elles ne sont
pas une coquetterie : elles rendent un mélange d'unités **impossible à compiler**.
Commits `aa9dec4`, `2131870`.

**Vérification impossible, donc désactivée (T-03b).** `@ts-check` était imposé partout et
`scripts/**/*` inclus dans `jsconfig.json`, sans que `@types/node` soit autorisé — les
modules `node:*` étaient intypables. Le contournement par `@ts-nocheck` était la seule issue
laissée par le plan. D'où l'autorisation de `@types/node` et l'**interdiction 16** : ne
jamais désactiver une vérification pour la faire passer. Commits `6f36b97`, `0ccdab6`.

**Enseignement transposable :** un plan précis ne garantit pas un plan correct — il rend ses
propres défauts détectables vite. Les deux tâches où une ambiguïté coûtera le plus cher sont
**T-09** (Dijkstra, anti-corner-cutting) et **T-10** (parsing UVTT, unités de case) : ce sont
celles reposant sur les spécifications les plus denses, à relire lentement.

---

## 5. Points de vigilance pour les tâches à venir

| Tâche | Ce qui peut déraper |
|---|---|
| T-05 | Les interfaces sont un **contrat** : les copier à l'identique depuis `ARCHITECTURE.md` §3, sans implémentation. |
| T-07 | Renommer `{a, b}` en `{col, row}` « pour la lisibilité » tue la compatibilité hexagonale de tout le projet. Violation la plus probable, et bien intentionnée. |
| T-09 | Transposer le `reachableCells` existant de `shadowrunbank` plutôt que réinventer le Dijkstra. Anti-corner-cutting : une diagonale exige les deux arêtes orthogonales libres. |
| T-10 | Coordonnées UVTT en **unités de case**, jamais en pixels. Aucun champ d'offset : l'alignement vient de `map_origin`. `baked_lighting` à détecter. |
| T-19 | Le drag tactile en vue joueurs est **interdit** (interdiction n°1) — le drag à un doigt est le pan de la carte. |
| T-22 | `index.html` existe déjà avec son import map : construire **par-dessus**, ne jamais dupliquer l'import map. |
| T-23 | L'import map de `player.html` doit être identique à celle d'`index.html`, et `check-deps.mjs` doit le vérifier. |
| T-25 | Un test d'architecture qui échoue révèle une dérive : il se corrige, il ne se contourne pas. |

**Jamais délégable :** les critères de performance (30 fps sous cast, arrêt de la boucle
rAF, tenue thermique sur 45 min, `MAX_TEXTURE_SIZE` réel de la Tab S9 FE, latence Firebase à
table). Ils exigent le matériel physique. Aucun modèle ne peut les cocher.

---

## 6. Décisions à trancher, en attente

Reprises de `CAHIER-DES-CHARGES.md` §12, plus celles apparues depuis :

1. `MAX_TEXTURE_SIZE` réel de la tablette → conditionne la résolution des cartes.
2. Latence Firebase mesurée à table → si le p95 dépasse ~250 ms, basculer
   `LocalSocketTransport`. À mesurer au lot 1a, avant de construire dessus.
3. Portes ouvrables par les joueurs, ou MJ seul ?
4. Ambiance lumineuse globale ou par étage ?
5. D'où viennent les cartes hexagonales ? Aucun outil UVTT n'en produit.
6. Forme des grandes créatures en hexagone (`sizeCells > 1`).
7. Jeu de marqueurs d'état — à arbitrer **après** une séance réelle, pas avant.
8. Gabarits manipulables par les joueurs ?
9. Ancrage des `animatedOverlays` : coin haut-gauche (actuel) ou centre ?

---

## 7. Ce qui n'est pas dans le dépôt

Deux éléments de contexte vivent hors du code et sont à rappeler à un assistant qui
reprendrait le projet sans historique de conversation :

- **L'identité git** doit être `ethoril <ethoril@gmail.com>`, jamais le nom réel du
  mainteneur, sur ce dépôt comme sur `shadowrunbank`.
- **L'abandon du drag & drop** est une décision prise après test réel, qui a supprimé trois
  sous-systèmes (throttling réseau, rendu optimiste, verrou de saisie). Un assistant qui
  proposerait de « remettre » du drag tactile régresse le projet.

Le reste est autosuffisant : les six documents normatifs permettent de reprendre le projet
sans aucun historique de conversation. C'était une propriété recherchée.
