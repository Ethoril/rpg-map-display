# Travail — 29/07 soir

> Document de reprise. Écrit en fin d'après-midi du 29 juillet 2026 pour reprendre
> le soir depuis une autre machine.
>
> Il dit **où on en est réellement** et **ce qu'il faut faire ensuite**, avec des
> spécifications assez précises pour être exécutées sans redécouvrir le contexte.

---

## 1. Reprise sur une autre machine

```text
git clone https://github.com/Ethoril/rpg-map-display
cd rpg-map-display
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm run verify
```

Attendu : `verify` sort en **code 0**, avec 77 tests unitaires et 43 tests
navigateur (2 Firebase ignorés faute de configuration externe, 1 fixture réelle
ignorée car absente). Si ce n'est pas le cas, **s'arrêter et diagnostiquer** :
c'est la référence de départ, pas un détail.

Pour jouer en local :

```text
pnpm run serve       # http://127.0.0.1:4173/index.html
```

Environnement de référence : Node 24, pnpm 11. Le CI utilise les mêmes majeures
pour que « vert en local » et « vert en CI » veuillent dire la même chose.

---

## 2. Où on en est

La bibliothèque de cartes UVTT **fonctionne de bout en bout**. Déposer un `.uvtt`
dans `maps/`, lancer `pnpm maps:prepare`, ouvrir l'onglet « Cartes », cliquer
« Charger » : la carte s'affiche, sans jamais saisir d'URL.

Vérifié sur la vraie carte `manoir-rdc.uvtt` : nom « Manoir — RDC », 131 murs,
40 portes, image chargée en 4096×3840, zéro 4xx, zéro erreur de page.

### État du lot 2, unité par unité

| Unité | Objet | État |
|---|---|---|
| U-00 | Tests du contrat de préparation | ✅ assertion restaurée, 9 cas en dossier temporaire |
| U-01 | API de préparation pure | ✅ `prepareMap()` / `prepareMaps()` |
| U-02 | Génération **atomique** du catalogue | ✅ transactionnel, `rename` seul, orphelins signalés |
| U-03 | Modèle et chargeur de catalogue | ✅ `validateCatalog()`, `loadCatalog()` |
| U-04 | Interface de bibliothèque MJ | ✅ fonctionnel, 4 e2e qui cliquent réellement |
| U-05 | Synchronisation et reconnexion | ✅ `scene.load`, 5 e2e dont un vrai F5 joueurs |
| U-06 | Retrait du parcours URL manuel | ✅ aucun champ URL, import local en diagnostic |

### Mise en garde sur l'historique

Le commit `70b24fb` s'intitule « LOT 2 — Bibliothèque UVTT complète (U-00 à
U-06) ». **C'est faux.** Il a été produit sans lancer `playwright test` ni
`typecheck` : deux bugs bloquants, 4 tests e2e rouges, U-05 non implémenté. Ne
pas s'y fier comme point de référence. Le `d662e53` et le `97efff5` disent la
vérité.

---

## 3. Ce qui a été fait le 29/07

| Commit | Contenu |
|---|---|
| `97efff5` | Correction des deux bugs bloquants de U-04 + réparation des 4 e2e + purge du code mort |
| `d662e53` | Porte de vérification `verify` + CI bloquant le déploiement + §9 complétée |

Les deux bugs qui ont coûté la journée, pour mémoire :

1. **`sceneLibrary.js`** — `handleLoadScene()` référençait `loadBtn`/`addBtn`
   déclarés en `const` dans le bloc de la boucle `for`, donc hors de portée.
   `ReferenceError` au premier clic, relancée depuis le `catch`. Le bouton
   « Charger » n'avait jamais été cliqué une seule fois.
2. **`resolveMapUrl()`** — produisait des URL `http://` que
   `isPersistableAssetUrl()` refuse, donc `store.loadCampaign()` levait. La
   fonction a été **supprimée** : les URLs du catalogue restent relatives, le
   navigateur les résout, y compris sous un sous-chemin GitHub Pages. Un
   commentaire dans `catalog.js` explique pourquoi il ne faut pas la
   réintroduire.

---

## 4. Règles de travail désormais outillées

`pnpm run verify` = `typecheck` → `test:unit` → `test:e2e`, arrêt à la première
défaillance. C'est **la** commande de référence, celle que le CI exécute.

Le job `verify` de `.github/workflows/deploy.yml` conditionne le job `deploy`
via `needs`. Concrètement : **une suite rouge empêche la mise en production.**
Avant aujourd'hui, `deploy.yml` publiait sur GitHub Pages à chaque push sur
`main` sans lancer un seul test.

`docs/CONVENTIONS.md` §9 a été complétée avec deux conditions absentes :

- le parcours ajouté ou modifié doit avoir été **réellement exercé** — bouton
  cliqué, page rechargée — et pas seulement compilé ;
- un critère d'acceptation ne se réécrit **jamais** pour coller au comportement
  obtenu.

Ces deux règles viennent directement des défauts constatés aujourd'hui.

---

## 5. La suite — trois chantiers

> **Les trois chantiers ont été livrés le 29/07 au soir**, dans l'ordre B → A → C,
> `verify` en code 0 à la fin de chacun. Les spécifications sont conservées
> ci-dessous telles qu'écrites : elles servent de référence pour la relecture.
> Les écarts entre la spécification et ce qui a été fait sont notés en §8.

Méthode : ces spécifications sont écrites pour être exécutées par Gemini, puis
vérifiées. Chaque chantier est indépendant et peut être livré seul.

**Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la
fin de chaque chantier. Aucun critère d'acceptation ci-dessous ne peut être
affaibli pour faire passer un test.

### Chantier A — couvrir les deux derniers contrôles jamais exercés

**Pourquoi.** Un audit a montré qu'il ne reste qu'une zone aveugle : dans
`js/ui/gm/panel.js`, les contrôles `#grid-visible` et `#grid-opacity` sont
câblés à `store.updateActiveLevel()` **et** à `transport.publish('level.grid')`.
Ils mutent l'état et le diffusent aux joueurs, et aucun test ne les touche —
`gmPanel.spec.mjs` n'exerce que `#grid-color`. C'est exactement le profil du bug
de ce matin : branché, atteignable, jamais cliqué.

**Fichier à modifier.** `tests/gmPanel.spec.mjs` uniquement.

**Contrat.** Dans le test « Générateur de Pions & Réglages Grille », après avoir
obtenu un étage actif, ajouter :

- décocher `#grid-visible` → `store.getActiveLevel().grid.visible === false` ;
- le recocher → `=== true` ;
- porter `#grid-opacity` à `0.6` → `grid.opacity === 0.6` **et** le texte de
  `#grid-opacity-val` vaut `0.6`.

**Interdictions.** Ne pas modifier `panel.js`. Ne pas toucher `#grid-type`, qui
est `disabled` par conception (les grilles hexagonales sont hors lot).

**Acceptation.** `pnpm run verify` en code 0, et les chaînes `grid-visible` et
`grid-opacity` apparaissent désormais dans `tests/`.

---

### Chantier B — rendre la préparation du catalogue transactionnelle

**Priorité : la plus haute des trois.** C'est le seul chantier qui peut abîmer
des données, et c'est celui où un critère d'acceptation a été affaibli — donc
le plus susceptible de cacher autre chose.

**Le défaut.** `scripts/prepare-maps.mjs` attrape les erreurs carte par carte,
puis écrit quand même `catalog.json` **amputé de la carte fautive**, et le CLI
sort en code 0. Le plan §6.9 exige l'inverse : « sortir en erreur sans publier
un catalogue partiel ». Et U-02 exige « catalogue précédent conservé si une
carte échoue ».

**Aggravant.** Le test `tests/prepare-maps.test.mjs` correspondant a été
réécrit pour coller à ce comportement : son assertion a été réduite à « le
catalogue a une version ». **Restaurer d'abord l'assertion, constater qu'elle
échoue, puis corriger le code.** Jamais l'inverse.

**Contrat attendu de `prepareMaps()`.**

1. Si **une seule** carte échoue : ne pas écrire `catalog.json` du tout. Le
   fichier précédent doit rester identique **octet pour octet**.
2. Signaler l'échec de façon exploitable : lever, ou retourner un résultat
   d'échec explicite. Le CLI doit sortir en **code non nul**.
3. Deux sources produisant le même slug → refus, sans rien écrire.
4. L'écriture atomique se fait par `rename` **seul**. Le code actuel fait
   `unlink` puis `rename`, ce qui ouvre une fenêtre où le catalogue n'existe
   plus.
5. Les artefacts devenus orphelins dans `maps/generated/` sont **signalés**,
   jamais supprimés (critère U-02).

**Exigence sur les tests — importante.** Les tests actuels opèrent sur le vrai
dossier `maps/`, avec une sauvegarde/restauration de `catalog.json` autour de
chaque cas, et repréparent `manoir-rdc.uvtt` (4,8 Mo) à chaque fois : environ
10 secondes par test. **À reprendre** : chaque test doit travailler dans un
dossier temporaire et utiliser `fixtures/synthetic/minimal.uvtt`. C'est vérifié
comme fonctionnel et prend moins d'une seconde. Le dossier `maps/` ne doit
jamais être muté par la suite de tests.

**Cas à couvrir.**

- succès sur une carte valide : catalogue écrit, compteurs exacts ;
- une carte invalide parmi deux valides : catalogue précédent **inchangé**,
  sortie en erreur ;
- deux slugs identiques : refus ;
- aucune `data:` ni `blob:` dans la scène produite (déjà couvert, à conserver) ;
- identifiants stables entre deux préparations (déjà couvert, à conserver).

**Acceptation.** `pnpm run verify` en code 0, `pnpm maps:prepare` continue de
produire le catalogue correct pour `manoir-rdc`, et la suite unitaire est
sensiblement plus rapide qu'avant.

---

### Chantier C — terminer la synchronisation (U-05)

**Où on en est.** `sceneLibrary.js` publie désormais un `level.add` par étage,
au format `{ level }` attendu par `js/app/networkEvents.js` : les joueurs
reçoivent bien les étages. Mais le mode « Charger », qui **remplace** la
campagne côté MJ, n'a pas d'équivalent côté joueurs — `networkEvents.js` ne
connaît que `level.add`, `level.grid`, `token.add`, `token.move`. Un
`campaign.load` avait été inventé puis publié dans le vide ; il a été retiré.

**Contrat.**

1. Ajouter à `js/app/networkEvents.js` la prise en charge du remplacement de
   campagne. `NetEvent.type` est un `string` libre : aucun type à étendre.
2. **Valider avant toute mutation.** Un instantané invalide ne doit jamais
   remplacer un état valide — c'est un critère U-05 explicite.
3. Rester idempotent : recevoir deux fois le même événement doit converger vers
   le même état.
4. Ne rien laisser passer qui contienne `data:` ou `blob:`. La garde de
   transport existe déjà et doit continuer de s'appliquer.
5. `sceneLibrary.js` publie ce nouvel événement en mode « Charger », et
   conserve `level.add` en mode « Ajouter comme étage ». Le commentaire
   « NOTE U-05 » dans ce fichier doit disparaître avec le correctif.

**Critères d'acceptation U-05, à démontrer par des tests navigateur.**

- deux clients reçoivent la même scène et les mêmes compteurs ;
- aucun UVTT complet ni base64 ne transite ;
- F5 côté MJ **et** côté joueurs restaure la scène ;
- un instantané invalide ne remplace pas un état valide.

**Point de départ utile.** `tests/appIntegration.spec.mjs` fait déjà converger
deux vraies pages joueurs via leur transport, sans relais par le test. C'est le
modèle à suivre.

---

## 6. Pièges connus

**Vieille campagne en LocalStorage.** Une campagne enregistrée avant
aujourd'hui peut pointer vers `maps/manoir-rdc.webp` — l'ancien chemin, sans
`generated/`. Ce fichier n'existe pas : on obtient un 404 au chargement de la
page, qui n'a rien à voir avec le code actuel. `localStorage.clear()` puis F5.
C'est très probablement l'origine du tout premier 404 observé aujourd'hui.

**L'onglet « UVTT » laisse le plateau gris, et c'est voulu.** C'est une section
de diagnostic. L'image du fichier s'affiche dans la vignette du panneau, jamais
sur le plateau, parce qu'une image encodée n'a pas le droit d'entrer dans le
store. Le store refuse explicitement `data:` et `blob:`. Ce n'est pas un bug,
c'est l'invariant dur du projet. Si cet écran gêne à l'usage, la décision à
prendre est de savoir si ce panneau doit encore toucher le store — le plan §8
suggère que non.

**Les imports locaux ne sont plus diffusés.** Les deux panneaux de diagnostic
ne publient plus rien vers les joueurs, conformément au plan §8 : « ne jamais
ajouter une scène partagée depuis un simple aperçu local ».

**`maps/minimal.json` et `maps/minimal.webp`** sont utilisés par les tests
navigateur. Ne pas les supprimer en nettoyant `maps/`.

---

## 7. Hors périmètre, à ne pas déclarer fait

La bibliothèque garantit que murs, portes et lumières arrivent **intacts** dans
le store. Elle ne rend fonctionnel aucun de ces éléments :

- rendu des murs ;
- ouverture interactive des portes ;
- calcul de vision ;
- brouillard de guerre ;
- ombres et éclairage dynamique.

Les données sont présentes et vérifiées — 131 murs et 40 portes chargés pour le
manoir. Ce sont les lots graphiques suivants qui devront les consommer. La
présence des données dans le store ne vaut pas fonctionnalité.

---

## 8. Livraison du 29/07 au soir — écarts et restes

Rien n'est commité : le mainteneur relit puis commite.

### Mesures

| | Avant | Après |
|---|---|---|
| `verify` | exit 1 (flake, cf. ci-dessous) | exit 0, confirmé sur plusieurs passes |
| Tests unitaires | 77 réussis, ~30 s | 81 réussis, 1,6 s |
| Tests navigateur | 43 réussis | 48 réussis |
| `pnpm maps:prepare` | — | catalogue identique octet pour octet, 131 murs / 40 portes |
| CLI sur carte fautive | exit 0, catalogue amputé | exit 1, catalogue précédent intact |

### La baseline n'était pas verte au départ

`tests/gmPanel.spec.mjs:142` échouait par intermittence, **avant toute
modification**. Cause : `importPanel.js` écrase `#img-cells-wide` / `#img-cells-tall`
depuis `img.onload`. Le test remplissait 10×8 sans attendre le chargement ; quand
l'`onload` arrivait après, l'étage devenait 1×1 (`Math.round(100/140)`) et le pion
2×2 était refusé par `addToken`. Corrigé par l'attente `toBeEnabled()` déjà
employée par le test frère.

### Écarts avec les spécifications ci-dessus

- **Chantier C, nom de l'événement.** La spécification dit « `NetEvent.type` est
  un `string` libre : aucun type à étendre » sans nommer l'événement.
  `CONVENTIONS.md` §4 interdit d'inventer un type hors du cahier des charges §7,
  or celui-ci contient déjà `scene.load` — « MJ | ponctuel — déclenche un snapshot
  complet ». C'est donc `scene.load` qui a été implémenté.
- **Chantier C, instantané invalide.** Il est journalisé puis ignoré, il ne lève
  pas, conformément à `CONVENTIONS.md` §6 (« donnée réseau inattendue →
  journaliser et ignorer, sans corrompre le store »). Sans ce `catch`,
  l'exception remontait jusqu'au transport.
- **Chantier C, garde supplémentaire.** Si `campaign.levels` n'est pas un
  tableau, `restoreFromSnapshot` ne remplace rien mais efface quand même la
  sélection. Une garde explicite l'empêche — cas non prévu au contrat.
- **Chantier C, fichiers touchés.** Au-delà de `networkEvents.js` et
  `sceneLibrary.js`, `installBrowserTransport` a été extrait de
  `appIntegration.spec.mjs` vers `tests/browserTestTransport.mjs` pour être
  partagé avec `tests/sceneSync.spec.mjs`, sans le dupliquer.
- **Chantier B, défaut non listé.** `prepareMaps()` renvoyait
  `mapsCount: uvttFiles.length`, donc comptait aussi les cartes en échec. Il
  renvoie désormais le nombre réellement publié.
- **Chantier B, couverture incomplète.** La garde de collision de slug est
  implémentée et appelée avant toute préparation, mais elle n'est **pas couverte
  en intégration** : le filtre ne retenant que `.uvtt` à plat, la collision est
  hors d'atteinte par ce chemin. Elle est testée en fonction pure
  (`planSources`). La propriété « sans rien écrire » est structurelle, pas
  démontrée par un test.

### Reste à faire

1. **Attentes fixes des tests de gestes.** `tests/input.spec.mjs` échoue par
   intermittence sous forte charge CPU — mesuré 2 échecs sur 8 exécutions
   locales, 0 sur 18 répétitions à vide. Neuf `waitForTimeout` y attendent des
   frames rAF avec des durées fixes, dont un de 30 ms. À remplacer par des
   attentes de condition (`expect.poll`), en conservant les maintiens qui font
   partie du geste (appui long, `DRAG_HOLD_MS`). Le critère d'acceptation doit
   inclure une exécution répétée **sous charge**, sinon le défaut reste masqué.
2. **Écrasement silencieux des dimensions à l'import.** Le défaut d'`importPanel.js`
   décrit plus haut n'est pas qu'un problème de test : un MJ qui saisit ses
   dimensions pendant le chargement de l'image les perd. À arbitrer — ce fichier
   n'était dans aucun des trois chantiers.
