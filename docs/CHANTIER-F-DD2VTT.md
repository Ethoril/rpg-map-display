# Chantier F — `.dd2vtt` et `.df2vtt` au même plan que `.uvtt`

> Brief d'exécution, écrit le 29 juillet 2026 au soir. Autonome : tout ce qui suit a été
> vérifié sur le corpus réel, il n'y a rien à redécouvrir.
>
> Référence : `docs/ANALYSE-DD2VTT-GRILLES.md` §0, §7.1 et §7.3.
>
> **Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la fin du
> chantier. Aucun critère d'acceptation ne peut être affaibli ni réécrit pour coller au
> comportement obtenu.

---

## 1. Pourquoi

Le logiciel de cartographie du MJ **ne sait pas** exporter en `.uvtt`. Le `.dd2vtt` est donc
le format d'entrée principal, pas un cas exotique à tolérer. Le cahier des charges §5.1
l'annonçait déjà — « Source A — UVTT / DD2VTT / DF2VTT ». C'est un alignement, pas une
extension de périmètre.

Deux conséquences aujourd'hui :

1. Les exports du MJ sont **invisibles** de la chaîne de préparation.
2. Quand ils sont préparés en forçant l'appel, le catalogue déclare une provenance
   **fausse**.

---

## 2. Faits établis — ne pas les redécouvrir

Vérifié sur `fixtures/real/testvtt150dpi.dd2vtt` en appelant `prepareMap()` directement :

```text
métrologie : 21x14 cases, 150 ppg, origine 0,0
image      : 3150x2100 = 6,6 Mpx, cohérente avec map_size × pixels_per_grid
résultat   : SUCCÈS — 10 murs, 6 portails, 3 lumières, WebP 2,79 Mo
sourceUrl  : maps/testvtt150dpi.uvtt        <-- FAUX, le fichier est un .dd2vtt
```

1. **Le parseur et le rééchantillonneur n'ont besoin d'aucune modification.** Un `.dd2vtt`
   traverse déjà toute la chaîne sans erreur. Seuls le filtre d'extension et la provenance
   sont en cause.
2. `sourceUrl` sort en `.uvtt` pour un fichier `.dd2vtt` : le catalogue référencerait un
   fichier inexistant, et `sourceHash` devient **invérifiable** puisqu'on ne peut plus
   retrouver la source. C'est plus grave que ce que « métadonnées de provenance » laisse
   entendre.
3. Le filtre de préparation est à `scripts/prepare-maps.mjs:290`. *(L'analyse cite `:184` :
   elle a été écrite avant le passage de `prepareMaps()` en transactionnel.)*
4. `sourceUrl` est codé en dur à `scripts/prepare-maps.mjs:131`.
5. La dérivation du slug est **déjà agnostique à l'extension** :
   `path.basename(p, path.extname(p))` donne `x` pour `x.dd2vtt`. Rien à y changer.
6. `planSources()` (`scripts/prepare-maps.mjs:170`) refuse déjà les collisions de slug
   **avant toute écriture**. Élargir le filtre la rend *atteignable* : `x.uvtt` et
   `x.dd2vtt` produisent le même slug. C'est ce qui referme la réserve de couverture notée
   au §8 de `docs/TRAVAIL-2907SOIR.md`.
7. `validateCatalog` refuse aussi les `id` dupliqués au chargement
   (`js/import/catalog.js:72`). Défense en profondeur : la conserver, mais le refus doit
   intervenir à la préparation, avant publication.
8. **Le même angle mort existe à `tests/realUvtt.test.mjs:19`**, que l'analyse ne signale
   pas. Ce test est le seul garde-fou du projet sur « un export réel se parse » ; son
   propre commentaire reconnaît que le parsing n'est « validé qu'en théorie » tant qu'il
   s'ignore. Le corpus réel étant désormais en `.dd2vtt`, il resterait ignoré
   indéfiniment — en affichant « `fixtures/real/` est vide » alors que le dossier contient
   13 fichiers. Motif mensonger, faux vert.
9. **Les 13 exports réels passent déjà toutes les assertions de ce test** (vérifié une par
   une). L'activer ne demande aucune correction annexe. Les compteurs obtenus recoupent le
   §9 de l'analyse : lot 1 → 10 murs / 5 portails ; lot 2 `_00` → 10/6/3, `_01` → 10/4/2,
   `_02` → 0/0/0.
10. **Les espaces internes dans un nom de fichier ne sont pas bloquants** : vérifié,
    `isPersistableAssetUrl('maps/generated/test multi layer_00.webp')` renvoie `true`.
    Seuls les espaces en début ou fin sont refusés. L'encodage d'URL est du soin, pas un
    prérequis — ne pas surinvestir.

---

## 3. Fichiers à modifier

- `scripts/prepare-maps.mjs`
- `tests/prepare-maps.test.mjs`
- `tests/realUvtt.test.mjs`

---

## 4. Contrat

1. **Une seule constante exportée** depuis `scripts/prepare-maps.mjs` porte la liste des
   extensions reconnues : `.uvtt`, `.dd2vtt`, `.df2vtt`. Même format, même traitement.
2. `tests/realUvtt.test.mjs` **importe cette constante** au lieu de redéfinir sa propre
   liste. La cause racine de cette classe de bug est que la liste est dupliquée
   implicitement ; une source unique empêche les deux globs de rediverger.
3. `sourceUrl` porte l'**extension réelle** du fichier source.
4. Les artefacts générés continuent de porter le slug sans extension source : rien à
   changer de ce côté.
5. Une collision de slug reste refusée **avant toute écriture**, avec un message nommant
   les fichiers en cause.
6. Le motif d'ignorance de `realUvtt.test.mjs` cesse de mentir : distinguer « dossier
   absent ou vide » de « aucun fichier reconnu ».

---

## 5. Tests

- Un `.dd2vtt` préparé exactement comme un `.uvtt` : catalogue écrit, `sourceUrl`
  terminant en `.dd2vtt`. Idem pour `.df2vtt`.
- **Collision de bout en bout** : `minimal.uvtt` **et** `minimal.dd2vtt` dans le même
  dossier temporaire → `prepareMaps()` refuse, rien n'est écrit, et le catalogue précédent
  reste identique **octet pour octet**.
- Conserver la discipline en place : chaque cas travaille dans un dossier temporaire sur
  `fixtures/synthetic/minimal.uvtt`, `maps/` n'est jamais lu ni muté, et les cas restent
  sous 250 ms.
- Pour obtenir un `.dd2vtt` de test, **copier `fixtures/synthetic/minimal.uvtt` sous un nom
  en `.dd2vtt`** : le contenu est identique en format. Ne **pas** utiliser les fichiers de
  `fixtures/real/` — ils ne sont pas suivis par git et pèsent de 1,6 à 9 Mo.

---

## 6. Interdictions

- Ne pas toucher `js/import/uvtt.js` : il traite déjà ces fichiers, c'est prouvé au §2.1.
- Ne pas toucher `scripts/resample.mjs` ni le plafond de décodage JPEG. C'est un chantier
  distinct, devenu optionnel depuis la convention d'export à 150 ppg.
- Ne pas affaiblir `planSources()` ni retirer le contrôle d'`id` dupliqué de
  `validateCatalog`.
- Ne pas déplacer, renommer ni supprimer le contenu de `fixtures/real/` : c'est un corpus
  réel **non reconstituable**.
- Ne pas supprimer `maps/minimal.json` ni `maps/minimal.webp` : les tests navigateur en
  dépendent.
- Ne pas commiter : le mainteneur relit puis commite.

---

## 7. Acceptation

1. `pnpm run verify` en code 0.
2. `pnpm maps:prepare` produit toujours un `catalog.json` **identique octet pour octet**
   pour `manoir-rdc` — 131 murs, 40 portes. C'est le garde-fou de non-régression posé le
   29/07 au soir.
3. Le test de fixtures réelles **s'exécute** et passe sur les 13 fichiers de
   `fixtures/real/`. Sur un clone frais le dossier est vide et ignoré par git : le test
   s'ignore alors légitimement, donc le CI reste vert.
4. `maps/` n'est pas muté par la suite de tests — comparer une empreinte du dossier avant
   et après `pnpm run test:unit`.
5. La suite unitaire reste sous 3 s.

---

## 8. Ce qui sera contrôlé à la relecture

Indépendamment de ce que le rapport d'exécution affirmera :

- `verify` relancé plusieurs fois, pas une seule ;
- **test de mutation** sur le nouveau cas de collision : en neutralisant `planSources()`,
  le test doit échouer. Un test qui passe dans les deux cas ne prouve rien ;
- `catalog.json` de `manoir-rdc` inchangé, vérifié par comparaison d'octets ;
- le test de fixtures réelles effectivement **exécuté**, et non ignoré sous un nouveau
  prétexte ;
- aucun critère ci-dessus réécrit pour coller au résultat obtenu.
