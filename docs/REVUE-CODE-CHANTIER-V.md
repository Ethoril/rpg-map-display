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
