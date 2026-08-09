# CHANTIER V — refonte de l'outil de préparation

> Ouvert le 9 août 2026, à la demande du mainteneur, après la préparation des trois niveaux du
> village.
>
> ⚠ **Pourquoi « V » et pas « U »** : `PLAN-BIBLIOTHEQUE-UVTT.md` numérote déjà ses tranches
> `U-00` à `U-06`. Ce dépôt a déjà payé deux collisions de numérotation — le « lot 2 » de la
> bibliothèque contre le **Lot 2 du CdC**, et le « chantier L » contre les tranches `L-01`…`L-10`.
> La lettre est sautée exprès.

---

## 1. Ce qui déclenche le chantier

Trois niveaux du même village viennent d'être préparés : 42 × 42 cases chacun, 140 px/case,
253 murs, 147 portes, 114 lumières au total. Ils ferment le critère 1 du lot 3 dès qu'ils sont
importés — mais ils ne sont **pas jouables comme campagne**, et le constat est net :

⛔ **Le format `dd2vtt` ne peut pas porter de liaison entre étages.** Ses `portals` sont des portes
dans les murs, pas des escaliers entre niveaux. Ce n'est pas une limite de l'outil de cartographie
du mainteneur : c'est une absence du format. **Il faut cesser d'en attendre des liaisons.**

Elles doivent donc être créées à la main. Deux endroits possibles, et le précédent tranche :

- **en jeu**, par l'éditeur livré en R3-01 : les liaisons vivent dans la campagne, donc dans le
  `localStorage` ou Firestore, et un `scene.load` les remplace ;
- **dans l'outil de préparation** : elles sont écrites dans le document de scène du dépôt et
  **voyagent par git**, d'une machine à l'autre.

⭐ Le chantier M a tranché exactement la même question pour la bibliothèque de pions, et sa raison
vaut ici mot pour mot : « on écrit le fichier commité, pour que la bibliothèque voyage par git d'une
machine à l'autre. Une bibliothèque de navigateur ne l'aurait pas fait. »

---

## 2. La contrainte structurelle qui décide de la forme

`links` n'est pas une propriété d'étage : c'est un tableau **au niveau de la campagne**, et chaque
extrémité nomme un `levelId`. Et [schema.js:414](../js/core/schema.js#L414) traite une liaison dont
l'étage n'existe pas comme une **erreur**, jamais un avertissement — « un pion téléporté vers un
étage inconnu disparaîtrait de la table sans que rien ne le dise ».

**Conséquence directe : un document de scène à un seul étage ne peut pas porter de liaison.** Les
deux extrémités doivent vivre dans le même fichier.

Le village doit donc devenir **une scène à trois étages**, et non trois scènes à un étage. Le format
le permet déjà : `levels` est un tableau, `links` existe à la racine, et `catalog.json` porte un
`levelCount`. Rien à inventer dans le schéma.

C'est ce qui impose l'ordre des tranches : **V-01 avant V-02**, sans alternative.

---

## 3. V-01 — la scène multi-étages

### État constaté

Une source `.dd2vtt` produit aujourd'hui une scène à un étage. Les trois villages sont donc trois
fichiers, chacun avec `levels[0]` et un `links: []` vide à la racine.

Deux détails relevés en préparant ce brief :

- les trois portent `order: 0`, et **`order` n'est lu nulle part** dans le code — ni tri, ni
  sélecteur : [schema.js](../js/core/schema.js) ne fait que le défausser à `0` et le valider. Le
  sélecteur d'étage affiche dans l'ordre du tableau. V-01 est le bon endroit pour décider : soit le
  champ sert enfin, soit il disparaît. ⛔ Le laisser inerte est le pire des trois.
- `catalog.json` porte un `sourceUrl` **unique** par entrée. Une scène assemblée à partir de trois
  `.dd2vtt` en a trois. Le champ doit devenir pluriel, et le `sourceHash` avec lui — sinon le saut
  incrémental du §3.4 du chantier L ne saura plus dire si la scène est à jour.

### Ce que la fusion ne doit pas supposer

Les trois villages ont la même taille et la même densité, donc leur assemblage est trivial. ⚠ **Il
ne faut surtout pas coder cette facilité** : le critère 1 du lot 3 dit « trois étages importés
indépendamment, **sans alignement manuel** », et un donjon réel aura des étages de tailles
différentes. Un assemblage qui suppose des grilles identiques passerait sur ce village et échouerait
sur le suivant, sans qu'aucun test ne le voie.

### Décision requise n°1 — que deviennent les scènes à un étage ?

La règle de publication transactionnelle du chantier L (§3.2) interdit un catalogue amputé : la
réponse doit être explicite, pas implicite.

---

## 4. V-02 — l'éditeur de liaisons hors jeu

### Bonne nouvelle : le composant est déjà réutilisable

[`createLinkEditor`](../js/ui/gm/linkEditor.js) n'importe que `core/schema.js` et communique
entièrement par rappels — `getLevels`, `getLinks`, `onAdd`, `onRemove`. **Aucune dépendance au
store, à la caméra ou au transport.** Il se monte donc dans `prepare.html` tel quel.

⛔ **Ne pas en écrire un second.** C'est le motif que le chantier L a nommé en §2 et que ce dépôt a
déjà payé deux fois : deux implantations d'une même règle divergent au premier réglage.

### Le vrai coût n'est pas le formulaire, c'est la carte

L'éditeur fonctionne en deux temps : armer, puis **taper la case A sur la carte**. L'outil de
préparation n'a aujourd'hui aucune vue de carte — il affiche les artefacts en `<img>`. Poser une
liaison y suppose donc une vue cliquable qui convertit un pixel en case, avec zoom et déplacement.

⚠ **Vérifier la compatibilité avec la règle du chantier L §2** : « le navigateur ne décode aucune
image source, il affiche des artefacts déjà produits par Node ». Afficher le WebP préparé et
convertir un clic en coordonnée de case **respecte** cette règle — c'est un artefact, pas une
source. Aucun rééchantillonnage ne doit apparaître côté navigateur.

### Décision requise n°2 — vue de carte, ou saisie de coordonnées ?

L'éditeur existant permet déjà de saisir l'extrémité B **au clavier**, en colonne et ligne. Une
version sans carte est donc réalisable à peu de frais — mais désigner un escalier en tapant deux
nombres est exactement l'expérience que R3-01 a été écrit pour supprimer.

---

## 5. V-03 — le recadrage des pions dans l'outil

### État constaté

La section bibliothèque de pions de l'outil est un **formulaire avec un champ fichier**
(`prepare.js`, champ `tk-image`). Le parcours actuel est : générer le pion dans la vue MJ →
« Télécharger pion » → retrouver le fichier → le choisir dans l'outil. Le recadrage n'existe que
côté MJ, et le chantier M l'avait assumé : « le recadrage reste au générateur, il n'est pas
réimplémenté ».

Le mainteneur juge ce parcours insatisfaisant, et il a raison : l'outil sert à préparer hors séance,
or la seule façon de cadrer une image passe par l'interface de séance.

### Là encore, le composant est déjà autonome

[`createTokenMaker`](../js/ui/gm/tokenMaker.js) n'importe que `core/schema.js`. Il porte le canvas
300 × 300, le guide de 200 px, le déplacement au doigt ou à la souris, le zoom, le pincement
tactile, et le bornage qui garantit que le guide reste couvert. Il rend un `Token` **et** une
`dataUrl` WebP par ses rappels `onGenerate` / `onDownload`.

Le câblage tient en une phrase : monter le composant dans `prepare.html`, et brancher le rappel sur
`POST /api/tokens/save` au lieu d'un téléchargement navigateur.

### ⭐ Mais il porte une contrainte qui n'a pas lieu d'être ici

`encodeWithinBudget` ([tokenMaker.js:379](../js/ui/gm/tokenMaker.js#L379)) écrase la qualité par
paliers — 0,8 puis 0,7, 0,6, 0,5, 0,4 — puis **divise la dimension par deux** autant de fois qu'il
faut, jusqu'à tenir sous `TOKEN_IMAGE_MAX_BYTES`, soit **24 Kio**.

Ce plafond existe pour une raison précise et bornée : un pion de campagne **embarque ses octets** en
`data:` dans le document Firestore, plafonné à 1 Mio, avec un cumul limité à 512 Kio pour toute la
campagne. Réduire plutôt que refuser était le bon arbitrage en pleine séance.

⛔ **Un pion de bibliothèque n'a rien à voir avec ce cas.** Il est écrit dans `maps/tokens/<slug>.webp`
et référencé par URL : il ne pèse sur aucun document Firestore. Lui appliquer le plafond de 24 Kio
dégraderait une image sans qu'aucune limite ne l'exige — une qualité perdue pour une contrainte
imaginaire.

**Le plafond doit donc devenir un paramètre du composant, défaut inchangé.** C'est la seule
modification de fond de V-03 ; tout le reste est du câblage.

### Deux frictions mineures à traiter

- `defaultLevelId` est **obligatoire** et le composant jette sans lui. Il n'a aucun sens dans
  l'outil de préparation, qui ne connaît pas de campagne. Il doit devenir facultatif quand
  l'appelant ne veut que l'image.
- Le nom de fichier dérive de l'identifiant, et le chantier M a déjà tranché que celui-ci est
  **refusé** s'il n'est pas un slug, jamais réécrit en silence. Le recadrage ne change rien à cette
  règle, mais l'outil doit la dire **avant** que le mainteneur ait cadré son image, pas après.

### Décision requise n°3 — quel plafond pour un pion de bibliothèque ?

---

## 6. Ordre et périmètre

| Tranche | Dépend de | Nature |
|---|---|---|
| **V-01** scène multi-étages | — | Schéma et chaîne de préparation |
| **V-02** éditeur de liaisons | V-01 | Vue de carte dans l'outil + montage d'un composant existant |
| **V-03** recadrage des pions | — | Câblage, plus un plafond à paramétrer |

⭐ **V-03 est indépendant des deux autres** et peut partir en premier : c'est le plus petit, le plus
sûr, et celui qui te rend service dès ce soir.

---

## 7. Les trois décisions — tranchées le 09/08/2026

| N° | Question | Décision |
|---|---|---|
| 1 | Sort des scènes à un étage après fusion | **Remplacées** — une seule entrée « Village » au catalogue |
| 2 | Désignation d'une case d'escalier | **Vue de carte cliquable** dans l'outil |
| 3 | Plafond d'une image de bibliothèque | **~256 Kio**, distinct des 24 Kio de campagne |

**n°1 — remplacées.** Le catalogue porte un lieu, pas ses morceaux : quatre entrées pour un même
village, c'est une occasion de charger la mauvaise en séance. ⚠ Deux conséquences à tenir : les
trois `.webp` **ne sont pas réencodés** — ils sont référencés par les trois étages de la scène
assemblée —, et le retrait des trois entrées passe par la **passe transactionnelle** du chantier L
§3.2, jamais par une écriture partielle du catalogue.

**n°2 — vue de carte.** C'est le vrai coût de V-02 et il est assumé : désigner un escalier en tapant
deux nombres est exactement l'expérience que R3-01 a supprimée, et l'outil existe pour préparer sans
lancer de séance. ⛔ La vue affiche le WebP **déjà préparé** et convertit un clic en case ; elle ne
décode aucune source et ne rééchantillonne rien, conformément au chantier L §2.

**n°3 — 256 Kio.** Le plafond de 24 Kio reste **inchangé pour les pions de campagne**, dont les
octets voyagent dans le document Firestore. Un pion de bibliothèque est un fichier référencé par
URL : la borne large ne se déclenche jamais en usage normal — 512 px de côté en qualité 0,9 pèsent
environ 40 Kio — et garde une protection contre l'accident, une photo de plusieurs mégaoctets entrée
dans git n'en ressortant plus. ⚠ Le paramètre doit porter son unité et sa raison à l'appel, sinon
les deux plafonds se confondront à la première relecture.

### Ce qui reste hors périmètre

- ⛔ Réimplémenter quoi que ce soit du pipeline d'image. La règle du chantier L §2 tient : le
  plafond, le garde-fou anti-agrandissement et la qualité WebP n'ont qu'un seul domicile.
- ⛔ Publier `catalog.json` autrement que par la passe transactionnelle complète (chantier L §3.2).
- La bascule du village en campagne de référence (R4-02) : elle suit V-01, elle ne le précède pas.
