# REVUE DU CODE — chantier V

> Écrite le 9 août 2026 sur la livraison du chantier V, après vérification par **mutation** et non
> par lecture du compte rendu.
>
> **Verdict : le point bloquant de la revue de plan est réellement corrigé, et quatre des cinq trous
> le sont aussi.** Restent **deux défauts**, dont un est une régression sur un critère du cahier des
> charges déjà validé.

---

## 1. Ce que j'ai vérifié moi-même

Le compte rendu annonce « toutes les suites au vert ». C'est exact — 327 tests unitaires passent,
1 ignoré, typecheck propre. ⚠ Mais un test vert ne prouve rien tant qu'on n'a pas cassé ce qu'il
prétend garder. Quatre mutations, dont trois demandées par la revue de plan :

| Mutation | Test attendu rouge | Résultat |
|---|---|---|
| Retirer `js/app/prepare.js` de la liste d'exceptions de `architecture.test.mjs` | garde `pxPerCell` | ✅ **rouge** — l'exception est porteuse |
| `links: linksData` → `links: []` dans `prepare-maps.mjs` | « une passe préserve les liaisons » | ✅ **rouge** |
| Décaler `pixelToCell` d'une demi-case | conversion aux 4 coins | ✅ **rouge** |
| Conversion écran → carte de `prepare.js:601` | *aucun* | ⚠ **aucun test ne la couvre** |

Les deux premiers résultats sont les plus instructifs, et ils disent l'inverse l'un de l'autre : le
mécanisme des liaisons est réellement gardé, tandis que la garde d'architecture n'a pas été
satisfaite mais **désarmée**.

---

## 2. Ce qui est réellement corrigé, et bien

- ⛔ **Le bloquant est traité.** Les liaisons vivent dans `maps/<sceneId>.links.json`, sont lues et
  fusionnées par `prepareMap` (`prepare-maps.mjs:618-625` et `:702`), et `validateCampaign` appelle
  `validateLinks` (`js/core/schema.js:1145`). La mutation le confirme.
- **Le manifeste est explicite.** `maps/scenes.json` déclare les assemblages ; la convention par
  suffixe `_00`/`_01` a disparu. Une source non listée reste une scène à un étage.
- **`order` est enfin consommé.** `getLevelSummaries` trie dessus (`js/state/store.js:566`), sur une
  copie — l'ordre du tableau du store n'est pas muté. La fabrication trie aussi (`:696`).
- ⭐ **Le cache de recettes est correctement étendu**, et je m'étais trompé en le suspectant :
  `sourceHash` a été **sorti** de la comparaison par `===` et reçoit une comparaison de tableaux
  explicite (`prepare-maps.mjs:364-372`), avec `linksHash` ajouté à la clé. La vérification de
  présence parcourt désormais tous les étages. C'était le piège évident et il a été évité.
- **Le catalogue est consolidé** : une entrée `test_village_complet`, `levelCount: 3`, trois
  sources. Les trois entrées à un étage ont disparu.

---

## 3. ⛔ Défaut 1 — une garde du lot 1a a été désarmée

`tests/architecture.test.mjs` porte le **critère 11 du lot 1a** : « un grep de `pxPerCell` hors du
fichier `GridAdapter` revient vide (test automatisé) ». Ce critère a été coché comme acquis le
08/08/2026.

`js/app/prepare.js` a été ajouté à sa liste d'exceptions. Or le commentaire situé **trois lignes
au-dessus** de l'ajout dit ceci :

> ⛔ Ne pas « régler » ce genre de conflit en renommant le paramètre : la garde serait contournée au
> lieu d'être respectée, et l'interdiction n°16 vise exactement ce geste.

Ajouter une exception est le même geste que renommer le paramètre : la règle n'est pas respectée,
elle est écartée. La mutation le prouve — retirer la ligne fait rougir le test, donc `prepare.js`
convertit bien des positions hors de `js/grid/`.

⚠ **Une garde qui gêne est un signal, pas un obstacle.** Ici elle disait vrai, et elle désignait le
défaut suivant.

---

## 4. ⛔ Défaut 2 — `pixelToCell` réimplémente `SquareGrid.cellFromPoint`

`js/grid/pixelToCell.js` :

```js
const cellX = Math.floor((pixelX - offsetX) / pxPerCell);
const cellY = Math.floor((pixelY - offsetY) / pxPerCell);
if (cellX < 0 || cellY < 0 || cellX >= widthCells || cellY >= heightCells) return null;
```

`js/grid/SquareGrid.js:38-43` :

```js
const a = Math.floor((p.x - this.offsetX) / this.pxPerCell);
const b = Math.floor((p.y - this.offsetY) / this.pxPerCell);
if (a < 0 || a >= this.widthCells || b < 0 || b >= this.heightCells) return null;
```

Même formule, mêmes bornes, même `null`. **Deux implantations d'une seule règle** — précisément ce
que le chantier L §2 interdit, et ce que ce dépôt a déjà payé deux fois.

Trois conséquences, dans l'ordre de gravité :

1. ⭐ **C'est la cause du défaut 1.** `gridFor(level).cellFromPoint({ x, y })` n'aurait jamais fait
   apparaître `pxPerCell` dans `prepare.js`, et aucune exception n'aurait été nécessaire. Corriger
   celui-ci fait disparaître l'autre.
2. **La fonction contourne `GridAdapter`**, qui existe pour que l'hexagone soit une seconde
   implantation. La vue de carte de l'outil sera donc silencieusement fausse sur un étage hexagonal
   — c'est-à-dire au premier critère du lot 4.
3. Le fichier a été inscrit au manifeste (`ARCHITECTURE.md`), ce qui légitime le doublon.

**Correctif :** supprimer `js/grid/pixelToCell.js`, appeler `gridFor(level).cellFromPoint(...)`,
retirer l'exception de `architecture.test.mjs` et l'entrée d'`ARCHITECTURE.md`. Le test des quatre
coins se réécrit contre `SquareGrid`, où il a d'ailleurs plus de valeur.

---

## 5. ⚠ La moitié testée est la moitié sans risque

Le test « conversion aux 4 coins et sous différents zooms/offsets » est réel — la mutation le
confirme. Mais il teste une division entière, et **la conversion dangereuse n'est pas là**. Elle est
dans `js/app/prepare.js:601` :

```js
const clickX = (e.clientX - rect.left - mapPanX) / mapZoom;
```

C'est le passage **écran → pixels carte**, avec déplacement et facteur d'échelle. Aucun test ne le
touche : rien dans `tests/` ne mentionne `mapZoom`, `api/scene` ni la vue de l'outil.

⚠ Et le test ne couvre pas le zoom malgré son titre : son sixième cas change `pxPerCell`, c'est-à-dire
**la densité de la carte**, pas `mapZoom`, qui est l'échelle d'affichage. Ce sont deux grandeurs
différentes dans deux espaces différents.

C'est exactement la forme du défaut du glisser des gabarits — `camera.mapToScreen` rendait des
coordonnées relatives au canvas quand `page.mouse` en attendait du viewport, et le test était vert
en local et rouge sur le runner. Et de celui de la grandeur calculée dans le mauvais espace, fausse
d'un facteur 3.

**Correctif :** un test sur la composée complète, écran → case, à zoom et déplacement non triviaux,
et pas seulement au centre de la vue.

---

## 6. ⚠ Deux points plus petits

### 6.1 Aucun test négatif du refus serveur

`POST /api/scene/links` est censé répondre 400 sur une liaison vers un étage inconnu. Le câblage
existe, mais **rien ne le prouve** : aucun test ne mentionne `validateLinks` ni ce refus. La revue de
plan le demandait explicitement (§3.3). Un refus non testé est un refus qui cessera un jour sans
bruit — la leçon du bouton « Copier l'entrée JSON ».

### 6.2 Les trois anciennes scènes sont toujours là

`maps/generated/` contient encore `test_village_complet_00/01/02.scene.json` à côté de
`test_village_complet.scene.json`. Elles ne sont plus référencées par le catalogue, donc orphelines.
C'est le comportement voulu — `findOrphanArtifacts` conserve et signale, ne supprime jamais — mais
la revue de plan (§3.5) demandait que ce sort soit **décidé et écrit**, pas laissé en suspens.

⚠ Les trois `.webp`, eux, restent nécessaires : la scène assemblée les référence, un par étage.

---

## 7. Un point de vigilance pour la suite, sans correctif demandé

`prepare-maps.mjs:665` dérive le nom du WebP de l'identifiant d'étage déclaré dans `scenes.json` :

```js
const webpFileName = `${lvlSpec.id}.webp`;
```

Renommer un identifiant dans le manifeste change donc le nom du fichier produit : 7 Mio deviennent
orphelins et 7 Mio entrent dans git, sans que rien ne le signale au moment du renommage. Ce n'est
pas un défaut aujourd'hui — les identifiants correspondent aux fichiers déjà commités — mais c'est
un piège à connaître avant de renommer « Sous-sol » ou « Rez-de-chaussée ».

Et puisque `order` **signifie** désormais quelque chose : le manifeste actuel place le sous-sol en
`order: 2`, donc au-dessus du premier étage dans le sélecteur. À arbitrer, ce n'est pas une question
technique.

---

## 8. Ce qu'il faut faire

1. **Défauts 1 et 2 ensemble** — ils n'en font qu'un. Supprimer `pixelToCell.js`, passer par
   `gridFor(level).cellFromPoint(...)`, restaurer la garde d'architecture et le manifeste.
2. **§5** — un test de la composée écran → case, à zoom et déplacement réels.
3. **§6.1** — le test négatif du refus 400.
4. **§6.2** — écrire ce qui advient des trois scènes orphelines.

Le reste de la livraison tient, et la partie la plus délicate — la persistance des liaisons et le
cache de recettes multi-sources — est correcte.

---

## 9. Seconde passe — 9 août 2026, après corrections

**Trois des quatre points sont corrigés, et je l'ai vérifié par mutation. Le quatrième ne l'est
pas** : il a reçu un test qui ne teste pas le code livré.

### Ce qui est réellement corrigé

| Point | Preuve |
|---|---|
| §3 et §4 — doublon et garde désarmée | `js/grid/pixelToCell.js` supprimé ; `prepare.js:587` appelle `gridFor(currentLevel).cellFromPoint(...)` ; `architecture.test.mjs` et `ARCHITECTURE.md` sont **revenus à leur état d'origine** — plus aucune exception. Le test passe donc authentiquement : 8 sur 8. |
| §6.1 — refus serveur | Neutraliser `validateCampaign` dans `prepare-maps.mjs` fait **rougir** le test négatif. |
| §6.2 — scènes orphelines | Les trois `test_village_complet_0X.scene.json` sont supprimés ; la scène assemblée et les trois `.webp` restent. |

⭐ Le §4 était la vraie correction : en passant par `GridAdapter`, la vue de l'outil fonctionnera
aussi sur un étage hexagonal, et la garde du critère 11 du lot 1a n'a plus besoin d'être écartée.

### ⛔ §5 n'est pas corrigé — le test réimplémente ce qu'il prétend vérifier

Le test ajouté dans `tests/squareGrid.test.mjs` construit sa propre conversion **à l'intérieur du
fichier de test** :

```js
const screenToCell = (clientX, clientY) => {
  const mapX = (clientX - rect.left - mapPanX) / mapZoom;
  const mapY = (clientY - rect.top - mapPanY) / mapZoom;
  return grid.cellFromPoint({ x: mapX, y: mapY });
};
```

Le code livré, lui, écrit la même expression à la main dans un écouteur (`js/app/prepare.js:583`).
**Ce sont deux copies indépendantes.** Le test prouve que l'arithmétique écrite dans le test est
cohérente avec elle-même, et rien du chemin réel.

**Preuve par mutation.** J'ai inversé le signe **et** remplacé la division par une multiplication
dans le code livré :

```js
const clickX = (e.clientX - rect.left + mapPanX) * mapZoom;   // faux de deux façons
```

Résultat : **330 tests, 0 échec.** Une vue de carte qui désignerait n'importe quelle case passerait
la porte de vérification sans un mot.

⚠ C'est exactement le défaut que la revue du lot 2 a documenté — « un mock qui implémentait
l'inverse du mécanisme testé » — et c'est la raison pour laquelle ce dépôt mute au lieu de croire.
Un test qui contient sa propre implantation ne garde rien.

### Le correctif

**Une seule fonction, appelée par les deux.** La composition ne peut pas vivre dans `js/grid/` —
elle mêle de l'état de vue, `rect`, déplacement et échelle d'affichage, à la géométrie de grille.
Mais elle peut être une fonction pure prenant des nombres :

```js
// signature indicative
screenToMapPoint({ clientX, clientY }, { rectLeft, rectTop, panX, panY, zoom }) -> { x, y }
```

L'écouteur l'appelle, le test l'appelle. La mutation ci-dessus devient alors rouge — c'est le seul
critère qui vaut.

⛔ **Ne pas répondre en ajoutant des cas au test existant** : dix cas de plus sur une copie prouvent
toujours la même chose, c'est-à-dire rien sur le code livré.

### État de la livraison

Un point ouvert sur quatre. Le reste tient, et la partie la plus délicate — persistance des
liaisons, cache multi-sources, retour à `GridAdapter` — est correcte et prouvée.

---

## 10. Troisième passe — 9 août 2026. Livraison acceptée

**Le dernier point est corrigé, et la correction est la bonne.**

`screenToMapPoint` est extraite dans `js/render/camera.js` — **un fichier existant**, désigné par
`ARCHITECTURE.md` pour les conversions carte ⇄ écran, donc aucun ajout au manifeste. Les deux
écouteurs de `js/app/prepare.js` l'appellent (`:584` au survol, `:620` au clic), et le test de
`tests/squareGrid.test.mjs` l'importe. **Une seule implantation, deux appelants.**

**Épreuve par mutation, la même qu'à la seconde passe :** signe inversé et division remplacée par
une multiplication dans `screenToMapPoint`.

| Passe | Résultat de la mutation |
|---|---|
| Seconde | 330 tests, **0 échec** — le test ne gardait rien |
| Troisième | 330 tests, **1 échec** — la garde existe |

### Récapitulatif des six mutations de cette revue

| Mécanisme cassé | Verdict |
|---|---|
| Exception de `architecture.test.mjs` retirée | 🔴 rouge — l'exception était porteuse, d'où le §3 |
| Fusion des liaisons désactivée | 🔴 rouge |
| `pixelToCell` décalé d'une demi-case | 🔴 rouge |
| `validateCampaign` neutralisée | 🔴 rouge |
| Conversion écran → carte inversée (2ᵉ passe) | ⚪ **verte — défaut trouvé** |
| `screenToMapPoint` cassée (3ᵉ passe) | 🔴 rouge |

Une seule mutation sur six est restée verte, et elle a désigné le seul défaut que la lecture du
compte rendu n'aurait pas trouvé.

### Vérification finale sur le poste

- typecheck : vert ;
- 330 tests unitaires, **329 réussis, 1 ignoré**, 0 échec ;
- `architecture.test.mjs` : **8 sur 8, sans exception** — la garde du critère 11 du lot 1a est
  intacte ;
- arbre de travail restauré à l'octet après chaque mutation, empreintes vérifiées.

### Ce qui reste à faire, et qui n'est pas du code

Le chantier V est livré côté machine. Deux constats lui manquent, et aucun ne se prend ici :

1. **Poser une vraie liaison dans l'outil**, sur les trois étages du village, et vérifier que le
   franchissement fonctionne en séance. Aucun `maps/*.links.json` n'existe encore : le mécanisme est
   prouvé par les tests, jamais exercé par un geste.
2. **Recadrer un pion dans l'outil** et constater que l'image écrite est nette — c'est le motif même
   de V-03, et le plafond de 256 Kio ne se juge qu'à l'œil.

⚠ Et un piège consigné au §7 reste vrai : renommer un identifiant d'étage dans `maps/scenes.json`
change le nom du WebP produit, orpheline l'ancien et fait entrer 7 Mio de plus dans git. À savoir
avant de rebaptiser « Sous-sol » ou « Rez-de-chaussée » — dont l'ordre, lui, est à arbitrer.
