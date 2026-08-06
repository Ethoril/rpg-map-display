# Journal de la séance autonome du 6 août 2026 (soir)

> **À lire au réveil.** Le mainteneur est parti se coucher en demandant de continuer en autonomie,
> de trancher sans attendre ses arbitrages, et de consigner **chaque décision avec les alternatives
> écartées**. C'est ce document.
>
> Tout est commité et poussé. La porte de vérification complète est passée **verte** en local :
> typecheck 0 erreur, **287 tests unitaires sur 287** (zéro ignoré), **122 tests de bout en bout**
> (2 ignorés, faute d'identifiants Firebase).

---

## 0. Ce qui a été livré

| # | Travail | Commit |
|---|---|---|
| 1 | Le parsing UVTT réel ne s'ignore plus nulle part | `2014f30` |
| 2 | Le masque de vision doit **diminuer**, et du bon côté | `811dcb0` |
| 3 | La redondance des deux `syncVision()` : relue, conservée, mise en garde périmée corrigée | `6f4deaa` |
| 4 | Une carte hexagonale ne s'importe plus en silence | `bd7b8ce` |

---

## 1. Décisions prises, et ce qui aurait pu l'être

### 1.1 Le test des UVTT réels — le brancher sur `maps/`

**Décidé.** Le test lisait `fixtures/real/`, dossier ignoré par git, donc il s'ignorait sur tout
dépôt cloné **et en CI**. Il lit désormais aussi les exports **versionnés** de `maps/`.

| alternative | pourquoi écartée |
|---|---|
| Laisser en l'état | `FIXTURES.md` écrivait déjà « le parsing UVTT n'est validé qu'en théorie ». Le laisser aurait été garder un trou documenté et connu. |
| Commiter un export dans `fixtures/real/` | Le dossier est ignoré **pour une raison** — licence tierce possible. Et le dépôt avait déjà de vrais exports ailleurs. |
| Générer une fixture synthétique de plus | `FIXTURES.md` §1 dit précisément qu'une fixture synthétique ne reproduit pas les irrégularités d'un vrai export. |

**Et un garde-fou ajouté** : un second test, qui ne s'ignore **jamais**, échoue si aucun export
versionné n'est trouvé. ⛔ Parce qu'un `skip` n'est pas un échec, et c'est ce qui a permis au trou
de durer dix jours.

### 1.2 La direction de la vision — trois assertions au lieu d'une

**Décidé.** Le test affirmait que le masque **diffère** après l'ajout d'un mur ; il affirme
maintenant qu'il **diminue**, que le pion voit toujours sa case, et que la perte tombe **derrière
le mur**.

| alternative | pourquoi écartée |
|---|---|
| S'en tenir à « diminue » | Un masque intégralement vierge satisferait aussi « diminue ». |
| Mesurer la longueur du base64 | `ETAT.md` l'avait déjà écartée avec la bonne raison : la taille d'un PNG dépend de la complexité du contour autant que de l'aire. |
| Laisser la dette | Le fog décide de ce que la table a le droit de savoir. Un bug qui *ouvrirait* la vision passait la porte. |

⚠ **Réserve honnête** : l'assertion « le pion voit sa case » n'est pas prouvée isolément. La
mutation qui vide le masque échoue par expiration en amont, pas sur elle. Conservée pour sa
fonction logique, pas sur la foi d'un rouge.

### 1.3 Les deux `syncVision()` — ne pas y toucher

**Décidé : statu quo**, et la mise en garde d'`ETAT.md` corrigée car **périmée** (`gmPanel` est créé
avant les deux appels ; la zone morte invoquée n'existe plus).

| alternative | pourquoi écartée |
|---|---|
| Retirer l'appel redondant | Gain nul — il se solde en no-op —, risque non nul, et **aucun test ne couvre l'ordre d'initialisation**. « Les tests passent après suppression » n'aurait rien prouvé : le vert n'aurait mesuré que l'absence de test. |
| Écrire un test d'ordonnancement puis nettoyer | Disproportionné pour un gain nul. |

### 1.4 Détecter la grille hexagonale — le faire, et n'avertir que

**Décidé.** Une carte hexagonale s'importait en carré **sans rien dire**, alors que l'exigence
d'universalité dit de ne jamais rien écarter en silence.

| alternative | pourquoi écartée |
|---|---|
| Ne rien faire jusqu'au lot 4 | Le silence est le défaut lui-même. |
| Régler `grid.type = 'hex'` automatiquement | `ANALYSE-DD2VTT-GRILLES.md` §4.3 le dit : on obtiendrait un hexagone techniquement correct et **toujours désaligné**. |
| Refuser l'import d'une carte suspecte | Contredirait l'universalité aussi sûrement que le silence. |
| Implémenter l'adaptateur hexagonal maintenant | C'est le lot 4, et il demande des arbitrages de jeu (métrique de distance, coordonnées) qui ne sont pas les miens. |

**Où c'est branché** : `scripts/resample.mjs`, sur l'image **source**, avant rééchantillonnage.

| alternative | pourquoi écartée |
|---|---|
| Après rééchantillonnage | Le trait a bavé, et le pas n'est plus celui des données. |
| Dans `js/import/uvtt.js` | Le parseur est **pur** et ne voit jamais les pixels décodés. |
| Côté navigateur | Vérifié : `prepare.html` délègue à Node par `prepare-server.mjs`. Il n'y a qu'un chemin de préparation. |

### 1.5 La méthode de détection — pic dominant, pas deux décalages fixes

**Décidé après deux échecs mesurés**, et c'est le point le plus instructif de la nuit.

1. **Première version** : comparer `r(w)` à `r(w × √3/2)` et trancher sur le plus grand. Balayée sur
   neuf pas de grille, elle décrochait à 60 px et 300 px — les **deux** autocorrélations tombaient
   négatives (−0,23 et −0,21), un décalage entier arrondi pouvant atterrir sur un lobe négatif. Le
   rythme était là ; la sonde regardait à côté.
2. **Deuxième version** : chercher le maximum, mais seulement jusqu'à 1,6 fois le pas. Aux mêmes
   deux pas, le pic sortait **sur la borne** — 1,60 et 1,59. ⚠ Un maximum trouvé à la borne de sa
   plage doit toujours faire soupçonner que le vrai pic est dehors. Il l'était : un réseau
   hexagonal a **deux** signatures, ses rangées alternées ne se répétant qu'après **deux** pas, soit
   un rapport de 1,732.
3. **Version retenue** : maximum sur `[0,6 ; 1,85]`, verdict par le **rapport** du pic — 1,000
   carré, 0,866 hexagone, 1,732 hexagone. **27 verdicts sur 27**, neuf pas, trois cas.

| alternative | pourquoi écartée |
|---|---|
| FFT | Plus lourd, et une dépendance nouvelle pour un gain nul à cette échelle. |
| Détecter les lignes horizontales | Un hexagone pointe en haut n'a **aucune** arête horizontale. |
| Seuils choisis à l'intuition | Ils viennent des balayages : `MIN_AUTOCORRELATION` 0,3 quand les réseaux nets donnent 0,79 à 0,90 ; tolérance de rapport 0,04 pour laisser un fossé de 5,4 % entre deux fenêtres distantes de 13,4 %. |

**Un troisième défaut, même famille** : le module renvoyait ses autocorrélations **à zéro** dès qu'il
déclinait — il **jetait sa propre mesure**, et un « indéterminé » devenait indiagnosticable. Trouvé
en balayant les pas avec le module lui-même, qui affichait `0,000` là où il avait pourtant calculé.
Le pic est désormais **toujours** rapporté.

### 1.6 Se conformer à la garde d'architecture, pas la contourner

**Décidé.** `js/import/gridPitch.js` mentionne `pxPerCell`, ce qu'une garde du projet interdit hors
de `js/grid/`. Il est inscrit à l'allowlist **avec sa raison** — il mesure un *pas* et ne convertit
aucune position, comme `uvtt.js` et `imageCalibrate.js` déjà présents.

| alternative | pourquoi écartée |
|---|---|
| Renommer le paramètre | ⛔ La garde serait **contournée** au lieu d'être respectée. L'interdiction n°16 vise exactement ce geste. |

### 1.7 Choix de test assumés

- **Réseaux tracés dans le test** plutôt que profils écrits à la main : un peigne analytique n'aurait
  mesuré `rowInkProfile` que contre lui-même, et n'aurait pas reproduit le rythme réel d'un hexagone
  pointe en haut, qui vient de ses sommets.
- **Pas de 300 px exclu du balayage** : l'image ferait 43 Mo. Le régime de la fondamentale est déjà
  couvert par 60 px.
- **PNG et non WebP** dans le test de branchement : le décodeur WebP est en WASM et exige un accès
  réseau, ce qui rendrait le test dépendant d'Internet.
- **Le branchement est testé séparément du module pur**, et vérifié par mutation. Sans quoi
  `gridPitch.js` pourrait être parfait et `resample.mjs` ne jamais l'appeler — l'absence
  d'avertissement étant indistinguable d'une carte carrée.

---

## 2. Ce qui n'est pas validé, et qu'il faut savoir

- ⚠ **Le cas hexagonal positif n'est pas validé sur données réelles.** Le dépôt ne versionne aucun
  export hexagonal, et l'image de `manoir-rdc.uvtt` est en WebP, dont le décodeur exige le réseau.
  Le faux positif, lui, **est** contrôlé sur `testbig150.dd2vtt` : verdict « indéterminé », aucun
  avertissement — le bon résultat, cette carte n'ayant pas de quadrillage peint.
- ⚠ **Le critère 9 du chantier R** — ton jugement esthétique de la châsse sur la Tab S9 FE — reste
  décoché, et il lui faut GitHub Pages.
- ⚠ **Le correctif du fog** n'est toujours pas vérifiable sur tablette, pour la même raison.

## 3. Une faute de ma part

**J'ai poussé `bd7b8ce` avant d'avoir passé la porte complète en local**, ce que l'interdiction 17
telle qu'amendée ce matin interdit explicitement. Je l'ai passée juste après — elle est verte, donc
sans conséquence —, mais l'ordre était fautif et le dire vaut mieux que l'enterrer.

## 4. État de GitHub

En panne majeure depuis 15:22 UTC. `Actions` et `Pages` en `major_outage`, et les webhooks bridés à
~15 % : les pushes ne déclenchent **aucune** course. `Git Operations` fonctionne, donc tout est bien
poussé.

Quand les services reviendront, une seule commande relance la porte **et** le déploiement, grâce au
`workflow_dispatch` ajouté ce soir :

```
gh workflow run deploy.yml --ref main
```
