# REVUE — plan de mise en œuvre du chantier V

> Écrite le 9 août 2026, sur le plan d'implémentation proposé pour
> `CHANTIER-V-OUTIL-PREPARATION-V2.md`.
>
> **Verdict : le plan est fidèle au brief sur les trois décisions et identifie correctement les
> points de câblage. Un défaut détruit des données ; cinq trous restent à combler ; quatre
> précisions sont à corriger.** Le reste tient et n'a pas à être rediscuté.

---

## 1. Ce qui est juste, et qu'il ne faut pas rouvrir

- Les trois décisions du §7 sont respectées : entrée de catalogue unique, vue de carte cliquable,
  plafond distinct pour la bibliothèque.
- `maxBytes` en option de `createTokenMaker`, défaut inchangé, et `defaultLevelId` rendu facultatif.
- `sourceUrl` et `sourceHash` acceptant un tableau.
- Réutilisation de `createLinkEditor` et `createTokenMaker` **sans réécriture**.
- Les trois WebP réutilisés sans réencodage.

---

## 2. ⛔ Bloquant — les liaisons seront effacées à la prochaine préparation

**Le plan écrit les liaisons dans `maps/generated/<id>.scene.json`**, via `POST /api/scene/links`.

Or ce fichier est réécrit **en entier** à chaque préparation, `scripts/prepare-maps.mjs:158` :

```js
fs.writeFileSync(scenePath, JSON.stringify(campaign, null, 2), 'utf-8');
```

`maps/generated/` est de la **sortie dérivée**. Les liaisons sont de la **saisie à la main**. Ranger
la seconde dans la première, c'est programmer sa perte.

⚠ **Le cache de recettes ne protège pas.** `scripts/prepare-maps.mjs:331` pose explicitement qu'un
`rm` sur `generated/` doit provoquer une reconstruction, et le §3.4 du chantier L fait dépendre la
clé du hachage du pipeline : tout changement de code, de qualité ou de plafond régénère. Le scénario
n'est donc pas théorique — poser les escaliers, régénérer trois semaines plus tard, tout perdre sans
un message.

### Correctif attendu

Les liaisons vivent **côté source**, dans un fichier commité, et `prepareMap` les fusionne dans la
scène produite :

```
maps/<id>.links.json        ← saisi par l'outil, commité, voyage par git
maps/generated/<id>.scene.json   ← dérivé, régénérable, jamais édité à la main
```

⭐ C'est exactement le précédent du chantier M, et sa phrase vaut ici mot pour mot : « on écrit le
fichier commité, pour que la bibliothèque voyage par git d'une machine à l'autre. Une bibliothèque
de navigateur ne l'aurait pas fait. »

Le `.gitignore` n'ignore que `maps/*.dd2vtt` et `maps/*.df2vtt` : un `maps/<id>.links.json` est donc
suivi sans rien changer.

**Critère de recette :** poser une liaison dans l'outil, lancer une passe complète de préparation,
et constater que la liaison est **toujours là**. Ce test doit exister ; sans lui, le défaut
reviendra.

---

## 3. Sérieux — cinq trous à combler

### 3.1 Le regroupement par suffixe de nom est une convention implicite

Le plan groupe `test_village_complet_00/01/02` sous `test_village_complet` en lisant le suffixe.

⛔ **Le brief demandait explicitement de ne pas coder la facilité du village actuel** (§3, « ce que
la fusion ne doit pas supposer »). Deux cartes sans rapport nommées `foret_00` et `foret_01`
fusionneraient en silence ; un `donjon_01` seul deviendrait une scène `donjon` ; et le mainteneur ne
pourrait modifier un regroupement qu'en renommant des fichiers.

**Correctif :** un manifeste explicite déclare les sources d'une scène et leur ordre. Une source non
mentionnée reste une scène à un étage, comme aujourd'hui. L'explicite se relit dans un diff, la
convention de nommage non.

### 3.2 `order` reste inerte, et c'est l'option que le brief nommait comme la pire

Le plan attribue `order: 0, 1, 2`. Mais **rien ne consomme ce champ** : `getLevelSummaries`
(`js/state/store.js:566`) rend le tableau tel quel, et aucun tri n'existe ailleurs. `schema.js` ne
fait que le défausser à `0` et le valider.

Peupler un champ que personne ne lit crée un mensonge en attente : le jour où l'ordre du tableau et
`order` divergeront — un étage ajouté, une fusion rejouée — l'affichage suivra le tableau et
personne ne saura pourquoi.

**Correctif :** soit le sélecteur trie sur `order`, soit le champ disparaît du modèle. Le brief le
disait : ⛔ le laisser inerte est le pire des trois.

### 3.3 Rien ne valide les liaisons avant l'écriture

`POST /api/scene/links` enregistre la liste sans contrôle annoncé. Or le fait structurel central du
brief est que `validateLinks` (`js/core/schema.js:414`) traite une liaison vers un étage absent
comme une **erreur**, pas un avertissement — « un pion téléporté vers un étage inconnu disparaîtrait
de la table sans que rien ne le dise ».

Une écriture non validée produit un document que l'application **refuse de charger**. Le défaut se
découvrirait donc à table, pas dans l'outil.

**Correctif :** le serveur valide et **refuse**, avec un message qui nomme l'étage manquant. Un test
négatif doit prouver le refus.

### 3.4 Le cache de recettes n'est pas traité

`sourceHash` devient un tableau dans le catalogue, mais le plan ne dit rien de
`maps/generated/.recipes.json`, dont la clé est `{ sourceHash, targetPxPerCell, maxTexturePx,
quality, pipelineHash }`.

C'est exactement ce que le chantier L §3.4 protège, et la raison y est écrite : une clé incohérente
fait dire « à jour » à une scène périmée, et la divergence n'apparaît qu'à l'œil, des semaines plus
tard.

**Correctif :** la clé de recette d'une scène assemblée couvre **toutes** ses sources. Le test du §5
du chantier L — changer la qualité invalide le cache — doit être étendu au cas multi-étages.

### 3.5 Personne ne supprime les trois anciennes scènes

La décision n°1 dit « remplacées ». Le plan produit la scène fusionnée et l'entrée consolidée, mais
ne dit pas ce qu'il advient des trois `test_village_complet_0X.scene.json`.

Or `findOrphanArtifacts` (`scripts/prepare-maps.mjs:384`) **conserve et signale**, sans jamais
supprimer — et c'est le comportement voulu : « une campagne enregistrée côté navigateur peut encore
les référencer ». Les trois fichiers resteront donc, et le dossier contredira le catalogue.

**Correctif :** décider et écrire ce qui se passe. Le retrait des entrées passe par la passe
transactionnelle, jamais par une écriture partielle du catalogue (chantier L §3.2). La suppression
des fichiers, si elle a lieu, est un geste explicite du mainteneur, pas un effet de bord.

⚠ Les trois WebP, eux, **restent** : la scène assemblée les référence, un par étage. Ils sont
commités depuis le 09/08.

---

## 4. Précisions à corriger

### 4.1 Le plafond de 256 Kio ne mesure pas ce qu'on croit

`encodeWithinBudget` (`js/ui/gm/tokenMaker.js:389`) compare `dataUrl.length` — la longueur de la
**chaîne base64**, pas la taille du fichier.

Pour un pion de campagne, c'est juste : c'est la chaîne elle-même qui part dans le document
Firestore. Pour un pion de bibliothèque, ce qui compte est le **fichier écrit sur disque**, et la
base64 gonfle d'environ un tiers : 256 Kio de chaîne valent à peu près 192 Kio de fichier.

**Correctif :** trancher lequel des deux le paramètre borne, et le nommer en conséquence. Le brief
demandait déjà que le paramètre porte son unité et sa raison à l'appel.

### 4.2 `node --test tests/tokenMaker.spec.mjs` ne fera rien d'utile

Les `.spec.mjs` sont des scénarios **Playwright**. `test:unit` ne glob que `tests/*.test.mjs`. Les
trois autres fichiers cités — `catalog.test.mjs`, `prepare-maps.test.mjs`, `tokenCatalog.test.mjs` —
existent bien et sont les bons.

### 4.3 Le dépôt est en `pnpm`, pas `npm`

La commande de référence est **`pnpm run verify`** : c'est celle du CI et celle dont dépend le
déploiement GitHub Pages. Elle enchaîne typecheck, cohérence des import maps, unitaires, navigateur
et les trois gestes bloquants.

### 4.4 Aucun test n'est prévu pour la conversion pixel → case

C'est le code le plus neuf et le plus risqué du chantier, et ce dépôt a une histoire documentée avec
cette classe exacte de défaut :

- une grandeur calculée dans le mauvais espace, fausse d'un facteur 3 ;
- le glisser des gabarits, vert en local et rouge sur le runner, parce que `camera.mapToScreen` rend
  des coordonnées relatives au canvas et `page.mouse` en attend du viewport
  (`DIAGNOSTIC-GESTE-GABARITS.md` §10 à §12).

**Correctif :** un test unitaire de la conversion, aux quatre coins et sous au moins deux niveaux de
zoom. Une vue qui « a l'air juste » au centre peut être fausse partout ailleurs.

---

## 5. Ordre de traitement suggéré

1. **§2** — l'architecture des liaisons. Elle change la forme de V-01 **et** de V-02 : à traiter
   avant d'écrire une ligne des deux.
2. **§3.1 et §3.2** — manifeste explicite et sort de `order`. Ce sont des décisions de modèle.
3. **V-03** peut partir en parallèle : il n'est concerné que par §4.1. C'est la tranche la plus
   sûre, et la seule qui rende service dès ce soir.
4. **§3.3 à §3.5 et §4.2 à §4.4** au fil de l'implantation.

---

## 6. À la relecture du code livré

⭐ **Muter, jamais croire.** La revue du lot 2 a attrapé douze faux verts par cette seule méthode :
casser volontairement le code que le test prétend garder, et vérifier que le test rougit. Elle avait
révélé un mock qui implémentait l'**inverse** du mécanisme testé, et un critère jamais implémenté
mais déclaré couvert.

Les trois mutations à faire ici, et elles suffisent à qualifier la livraison :

| Casser | Le test qui doit rougir |
|---|---|
| Faire écrire les liaisons dans `generated/` | Le test « une passe complète préserve les liaisons » |
| Faire pointer une liaison vers un étage inexistant | Le test négatif de refus du serveur |
| Décaler la conversion pixel → case d'une demi-case | Le test de conversion aux quatre coins |
