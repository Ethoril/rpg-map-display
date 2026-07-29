# Chantier G — couleurs ARGB des lumières et validation du format

> Brief d'exécution, écrit le 29 juillet 2026 au soir. Autonome : tout ce qui suit a été
> mesuré sur le corpus réel et sur les données du dépôt.
>
> Référence : `docs/ANALYSE-DD2VTT-GRILLES.md` §8.
>
> **Règle commune, non négociable :** `pnpm run verify` doit sortir en code 0 à la fin du
> chantier. Aucun critère d'acceptation ne peut être affaibli ni réécrit pour coller au
> comportement obtenu.

---

## 1. Pourquoi

`js/import/uvtt.js:114` fait `color: l.color ?? '#ffffff'` : il recopie la chaîne source
telle quelle. Or le format UVTT porte les couleurs en **ARGB, alpha en tête, sans `#`** —
`"ffF7EAE4"`. Ce n'est pas une couleur CSS valide.

Ce n'est plus théorique. **`maps/minimal.json` est un document du modèle** (schemaVersion 2,
`campaignId`, `levels`…) commité depuis le lot 1a avec `"color": "ffffffff"` dans
`levels[0].lights[0]`. Et **`validateCampaign()` l'accepte sans une seule erreur** —
vérifié. Le bug est donc entré dans les données du dépôt sans que rien ne le signale.

C'est la classe de défaut la plus coûteuse du projet : atteignable, franchi, silencieux.

---

## 2. Faits établis — ne pas les redécouvrir

Mesuré sur les 13 lumières des exports réels de `fixtures/real/` :

| Grandeur | Relevé |
|---|---|
| Format de couleur | ARGB 8 chiffres sur les 13, sans `#` |
| Alpha | **`ff` sur les 13** — aucune information portée aujourd'hui |
| `intensity` | 2,5 / 2,52 / 3 — **au-dessus de 1** |
| `environment.ambient_light` | `"ffffffff"` sur les 13 fichiers |

1. `validateCampaign(maps/minimal.json)` renvoie `[]`. Aucun contrôle de format de couleur
   n'existe dans le modèle.
2. Le parseur **ignore** `environment.ambient_light` : il code en dur
   `ambient.color = '#ffffff'` et `level = 1.0`. Pour ce corpus le résultat est
   accidentellement juste (`ffffffff` → `#ffffff`), mais la donnée réelle n'est pas lue.
3. `intensity` n'a **aucune échelle documentée**, ni dans `js/core/types.js`
   (`@property {number} intensity`, sans borne) ni au CdC §6.
4. **`fixtures/synthetic/*.uvtt` contiennent aussi `"color": "ffffffff"`, et c'est
   correct** : ce sont des *sources* UVTT, l'ARGB y est le format légitime. La correction
   porte sur le modèle, jamais sur les sources. Ne pas y toucher.
5. Le CdC §6 (ligne 536) spécifie `lights: [{ id, at, range, intensity, color, shadows }]` :
   **aucun champ alpha**. La convention du modèle est « couleur `#RRGGBB` + un scalaire
   séparé » — `grid` porte color + opacity, `ambient` porte color + level.
6. Aucun script ne génère `maps/minimal.json` : c'est de la donnée commitée, à corriger
   directement.

**Les huit chemins portant une couleur**, relevés dans `js/core/types.js` :

| Type | Champ | Ligne |
|---|---|---|
| `GridConfig` | `color` (optionnel) | 27 |
| `Light` | `color` | 58 |
| `AmbientLight` | `color` | 64 |
| `Token` | `borderColor` | 123 |
| `Token` | `emitsLight.color` | 128 |
| `Template` | `color` | 148 |
| `TokenLibraryEntry` | `emitsLight.color` | 179 |
| `TokenLibraryEntry` | `borderColor` | 180 |

---

## 3. Décisions arrêtées par le mainteneur

1. **L'alpha est jeté, mais un avertissement est émis s'il vaut autre chose que `ff`.**
   Respecte le CdC §6 sans étendre le modèle, et l'alpha ne porte rien aujourd'hui. Le CdC
   §11 prévient qu'ajouter un champ au modèle après le lot 1a est un refactor transverse :
   on ne le fait pas pour un octet constant.
2. **`validateCampaign` contrôle le format des couleurs, avec normalisation à la lecture.**
   Un ARGB hérité est **converti** au chargement, jamais refusé. Refuser reproduirait la
   « disparition après F5 » que `ETAT.md` documente comme la cause historique de perte de
   campagne : le remède ne doit pas être pire que le mal.

---

## 4. Contrat

1. **Conversion à la frontière d'import**, dans `js/import/uvtt.js`. Une fonction dédiée,
   testable seule, traitant :
   - 8 chiffres (`ffF7EAE4`) → `#F7EAE4`, avec avertissement si l'alpha ≠ `ff` ;
   - 6 chiffres sans `#` (`F7EAE4`) → `#F7EAE4` ;
   - `#RRGGBB` déjà valide → inchangé ;
   - tout le reste → repli `#ffffff` **avec avertissement**, jamais en silence.
2. **Cesser d'ignorer `environment.ambient_light`** : même conversion vers `ambient.color`.
3. **`validateCampaign` refuse une couleur hors `#RRGGBB`** sur les huit chemins du §2, avec
   un message nommant le champ fautif et sa valeur.
4. **Normalisation avant validation sur les chemins de lecture**, pour qu'une campagne
   héritée soit convertie et non rejetée. Les chemins concernés : `loadCampaign()`,
   `restoreFromSnapshot()` et `loadFromLocalStorage()` dans `js/state/store.js`. La
   conversion doit être signalée, conformément à `CONVENTIONS.md` §6.
5. **Corriger `maps/minimal.json`** : `"ffffffff"` → `"#ffffff"`. Sans quoi le durcissement
   de la validation casserait les tests navigateur qui chargent ce document.
6. **Ne pas normaliser `intensity`.** Son échelle est indéterminée et c'est une décision de
   conception du lot éclairage. Documenter la question dans `js/core/types.js` (et non
   l'inventer), en relevant les valeurs mesurées : 2,5 à 3 sur le corpus réel.

---

## 5. Interdictions

- **Ne pas toucher `fixtures/synthetic/*.uvtt`** : l'ARGB y est le format source légitime.
  Les « corriger » invaliderait les fixtures de parsing.
- Ne pas ajouter de champ alpha au modèle.
- **Ne pas faire refuser par la validation une campagne qui était acceptée avant**, sans
  conversion : c'est le mode de défaillance à éviter absolument.
- Ne pas inventer une échelle pour `intensity`.
- Ne pas toucher aux 13 fichiers de `fixtures/real/` : corpus réel **non reconstituable**.
- Ne pas commiter : le mainteneur relit puis commite.

---

## 6. Tests

- La fonction de conversion, seule, sur les quatre formes du §4.1 — dont l'avertissement
  quand l'alpha ≠ `ff`, et le repli avertissant sur une entrée aberrante.
- `parseUvtt` sur une source à lumière ARGB : `level.lights[0].color` vaut `#RRGGBB`, et
  `level.ambient.color` provient réellement d'`ambient_light`.
- `validateCampaign` **refuse** une campagne dont une lumière porte `"ffffffff"`, avec un
  message nommant le champ. À faire pour au moins deux des huit chemins.
- Une campagne héritée contenant un ARGB est **chargée après conversion**, pas refusée, et
  la conversion est signalée.
- Le corpus réel continue de passer `realUvtt.test.mjs` — il contient 13 lumières ARGB,
  c'est le meilleur test de non-régression disponible.

---

## 7. Acceptation

1. `pnpm run verify` en code 0.
2. `pnpm maps:prepare` produit toujours un `catalog.json` identique octet pour octet pour
   `manoir-rdc`. *(Cette carte n'a aucune lumière : si le catalogue change, c'est un effet
   de bord non voulu.)*
3. `validateCampaign(maps/minimal.json)` renvoie `[]` **après** correction de la donnée, et
   renvoie une erreur nommant le champ **avant**.
4. `maps/` n'est pas muté par la suite de tests.
5. La suite unitaire reste sous 3 s.

---

## 8. Ce qui sera contrôlé à la relecture

Indépendamment de ce que le rapport d'exécution affirmera :

- `verify` relancé plusieurs fois ;
- **test de mutation** : en remettant `color: l.color ?? '#ffffff'` dans le parseur, les
  nouveaux tests doivent échouer. En retirant le contrôle de format de `validateCampaign`,
  le test de refus doit échouer ;
- qu'une campagne héritée avec ARGB se charge **et** soit convertie — pas silencieusement
  acceptée telle quelle, ce qui serait le bug d'origine déguisé ;
- que `fixtures/synthetic/*.uvtt` sont intacts ;
- qu'aucune échelle n'a été inventée pour `intensity` ;
- qu'aucun critère ci-dessus n'a été réécrit pour coller au résultat obtenu.
