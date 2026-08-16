# Questions en attente — au 16 août 2026

> **À quoi sert ce document.** Rassembler, en un seul endroit, tout ce qui attend une décision du
> mainteneur ou une mesure qu'il est seul à pouvoir prendre. Il est écrit pour être dépouillé en
> **séance de choix multiples** : chaque question porte un numéro, la raison pour laquelle elle est
> ouverte, ce qui la ferme, et les options quand elles sont connues.
>
> ⚠ **Ce document n'est pas une feuille de route.** Il ne dit pas quoi faire ensuite, il dit ce qui
> n'est pas tranché. La suite du travail se lit dans `ETAT.md`, table « Suite produit ».
>
> ⛔ **Une question fermée sort d'ici et va dans le document qui fait foi** — `CAHIER-DES-CHARGES.md`
> §11/§12 pour les critères et les questions produit, `ETAT.md` pour l'avancement. Laisser une
> décision ici après l'avoir prise, c'est fabriquer une seconde source de vérité.

---

## A. Mesures qui appartiennent au mainteneur

Aucune de ces trois ne se ferme par du code. Interdiction n°14 : aucun verdict de performance sans
la tablette.

### A-1 ⛔ R2-03 — l'étape 5, sur la vraie vue joueurs

**Où on en est.** L'instrument est réparé le 12/08 et le relevé tablette est fait le 13/08 :
brut **1 206,1 ms**, relecture **68,5 ms**, **net 1 137,6 ms**, doublure 1024 px **2,2 ms**.

Les trois chiffres se recoupent avec l'historique — 1 146 ms mal imputés par l'ancienne sonde,
1 118 ms d'`Image.decode()` le 11/08 — et le rapport au Mac est de **2,3×**, exactement le facteur
déjà consigné. L'instrument dit donc vrai.

**Ce qui reste.** Le seuil de 5 ms porte sur ce qui est payé **dans une frame**. Le plein format
coûte 1,14 s à froid et ne repassera jamais sous 5 ms ; c'est la raison d'être de la doublure
1024 px du chantier P, qui mesure 2,2 ms. Le critère est donc tenu **par le mécanisme de la
doublure**, à condition qu'elle soit réellement ce que la vue joueurs peint en premier.

**Ce qui ferme la question** : refaire le scénario sur la vraie vue joueurs après 2 minutes de
silence et décrire la première image. Carte immédiate → R2-03 tenu. Une seconde de gel → le plein
format tombe dans une frame quelque part, et c'est un vrai défaut.

⚠ Le mainteneur a indiqué le 13/08 que « normalement c'est ok », sans avoir encore fait l'essai.

### A-2 Le hit-test hexagonal « au doigt du premier coup »

Critère du lot 4. L'arrondi cubique est **exact sur 16 287 points balayés**, mais « au doigt » est un
geste, pas un calcul. Les portes ont eu leur banc de visée — erreur p50 2,9 px, réussite 100 % dès
0,25 case ; l'hexagone n'a pas d'équivalent.

**Options** : (a) constat à la tablette sur `marais-hex_16x16` ; (b) un `tests/manuel/` sur le modèle
du banc de visée des portes ; (c) cocher sur lecture, l'exactitude géométrique étant prouvée.

### A-3 Le décompte du lot 4 — trois critères à cocher sur lecture

`HexGrid`, `MeasureLayer` et le sélecteur de pavage sont livrés et éprouvés. Trois critères sur
quatre ne demandent plus que la lecture du mainteneur : coexistence hex/carré, cases atteignables à
coût uniforme respectant les murs, mesure de distance sans quitter le Zero-UI.

⛔ Le décompte fait foi dans le §11 du CdC, pas dans `ETAT.md`.

---

## B. Décisions d'interface

> ✅ **Les trois sont tranchées le 16 août 2026.** Elles ont été dépouillées avec le mainteneur dans
> le cadre de l'audit d'ergonomie du panneau MJ : **`docs/AUDIT-UX-MJ.md` fait foi** sur ce qui a
> été décidé et pourquoi. Ce qui reste ci-dessous est la **description des défauts**, conservée
> parce qu'elle est mesurée et qu'elle servira à qui les corrigera. ⛔ Ne pas y relire les options :
> elles sont périmées, le choix est fait.
>
> - **B-1 Ambiance** → bascule jour / nuit ; la pénombre graduée est écartée.
> - **B-2 onglet Image** → le faire marcher ; c'était l'onglet le plus ouvert de la séance.
> - **B-3 trois onglets à zéro** → absorbée par la décision C-1 de l'audit : deux modes de panneau,
>   « Préparer » et « Jouer ». Aucun onglet n'est supprimé.

### B-1 ✅ tranchée — Le curseur « Ambiance » est un interrupteur déguisé en variateur

**Le fait, mesuré dans le code.** Le curseur offre 21 positions de 0 à 1 par pas de 0,05. Le moteur
en lit **une seule chose**, dans `js/render/layers/fogLayer.js` :

```js
return Boolean(level?.ambient?.baked) || Number(level?.ambient?.level) > 0;
```

Ambiante non nulle → chaque PJ voit jusqu'au plafond technique dans sa ligne de vue. Ambiante nulle →
chaque PJ ne voit que sa portée propre (`visionDim`) et les zones éclairées. **0,05 et 1,00 sont
rigoureusement indistinguables.** Le seul cran qui change quoi que ce soit est le passage par zéro.

`ambient.color` est importé, validé, persisté, et **lu par aucun rendu** — même profil que
`settings.ambientLevel`, supprimé en q.4 pour cette raison.

**Options** :
- **(a) Bascule jour/nuit.** L'interface dit ce que le moteur fait. Aucune ligne de rendu à écrire.
  *Recommandé.*
- **(b) Implémenter la pénombre graduée.** Un voile proportionnel dans le chemin du fog — celui où
  une erreur fait voir aux joueurs ce qu'ils ne devraient pas.
- **(c) Garder le curseur** en marquant le seuil sur l'étiquette. Le moins de travail, et le
  mensonge subsiste.

À trancher aussi : `ambient.color` — le supprimer, ou l'implémenter avec (b).

### B-2 ✅ tranchée — L'onglet « Image » du panneau MJ : aperçu ou import ?

**Le bug rapporté** — « un fond gris quadrillé, pas l'image » — n'est pas un bug de rendu. L'onglet
Image construit l'étage **sans `imageUrl`** (`js/ui/gm/importPanel.js:392`) : l'image décodée ne sert
qu'à l'aperçu de calibration 300×180 et n'est jamais remise au moteur. Le gris est la couleur neutre
`#34383f` de `background.js`, la grille est peinte par-dessus. Le petit aperçu, lui, montre bien
l'image — c'est le piège.

`BackgroundLayer.setImage()` existe précisément pour ce cas et **n'est appelé de nulle part**. Et
`tests/gmPanel.spec.mjs:227` asserte `imageUrl === ''` : **le test certifie le bug**.

**Options** :
- **(a) Le faire afficher.** Câbler `setImage`, et empêcher `renderAll` de l'écraser — il rappelle
  `load(activeLevel.imageUrl)` à **chaque frame**, donc une image locale posée naïvement
  disparaîtrait à la frame suivante.
- **(b) Le rendre honnête.** Le panneau annonce un succès qu'il ne livre pas, ce que le critère
  d'acceptation de `PLAN-STABILISATION-CANVAS.md` interdit déjà. Reformuler comme le fait la branche
  UVTT : grille calibrée, fond vide jusqu'à publication par `maps:prepare`.
- **(c) Le fondre dans le chantier bibliothèque** (C-1) : importer une image devient la publier.

Dans tous les cas, `tests/gmPanel.spec.mjs:227` est à reprendre.

### B-3 ✅ absorbée — Trois onglets MJ ne servent pas

Relevé du 11/08 : UVTT, Liaisons et Grille à **zéro ouverture** sur la séance. La section 15 de
`diag.html` cherche explicitement ça. ⚠ Un relevé, une séance — à confirmer sur une seconde avant de
retirer quoi que ce soit de la barre.

⚠ **Ce relevé est antérieur au 13/08** : l'onglet Grille porte désormais le sélecteur de pavage, donc
sa fréquentation va changer.

---

## C. Chantiers à cadrer

Aucun n'est commencé. Chacun demande un arbitrage avant d'écrire la première ligne.

### C-1 Bibliothèque ++ — naviguer, supprimer, modifier, créer

**L'existant est asymétrique.** Les **pions** ont déjà un CRUD complet côté outil de préparation :
`/api/tokens/save`, `/api/tokens/delete`, édition par repopulation du formulaire, image bornée à
256 Kio, écriture atomique par renommage. Les **cartes** n'ont **rien** : pas de renommage, pas de
suppression, pas de vignette. Le catalogue est régénéré en bloc par `maps:prepare`, et les artefacts
orphelins sont seulement **signalés**, jamais supprimés.

**Le chantier est donc double** : côté pions, *exposer* l'existant ; côté cartes, *écrire* le CRUD.

**À trancher** :
- **Où ?** Dans l'outil de préparation (qui écrit sur disque) ou dans le panneau MJ (qui lit un
  catalogue statique) ? ⚠ L'appli déployée ne peut pas écrire dans `maps/` ; le CRUD des cartes
  suppose l'outil local. Le mainteneur ne veut pas de terminal — l'outil se lance au double-clic.
- Renommer une scène est aujourd'hui une édition à la main de `maps/scenes.json`, sans interface ni
  validateur. Le CRUD doit-il le couvrir ?
- Vignettes de scènes : le typedef `SceneLibraryEntry` (`js/core/types.js:220`) porte un `thumbUrl`
  et **n'est référencé par rien**. À implémenter ou à supprimer.
- `features.animated` est écrit par le générateur et **absent du typedef et du validateur** du
  catalogue : dérive à corriger avant d'écrire quoi que ce soit dessus.

### C-2 Lumières cliquables comme les portes

**Ce qui aide** : les portes donnent le patron complet — modèle à états, hit-test partagé entre les
deux vues, événement réseau idempotent, mutation validée avant remplacement, et invalidation de cache
**par signature** plutôt que par appel explicite.

**Ce qui ne se recopie pas** :
- Un `Light` n'a **aucun champ d'état** aujourd'hui. Il faut le champ, sa valeur par défaut à
  l'import, sa normalisation pour les scènes déjà sur disque, et sa validation.
- Il n'existe **aucune couche de rendu des lumières**. Onze couches, aucune pour elles : les lumières
  ne contribuent aujourd'hui que des polygones au masque de fog, elles ne sont jamais dessinées. Le
  MJ ne voit pas où elles sont.
- ⛔ Une porte fermée **ne se dessine pas**, le décor la montre déjà. Une lumière éteinte n'a aucun
  indice dans le dessin : vos cercles rouge/vert doivent être peints **dans les deux états**. C'est
  un écart assumé au patron des portes.
- Le champ doit entrer dans la **signature de vision** de `fogLayer`, sans quoi la bascule ne change
  rien à l'écran — le cache court-circuite.

**À trancher** :
- État **booléen** (allumée/éteinte) ou **à trois valeurs** comme les portes ?
- Cercles visibles **côté joueurs aussi**, ou MJ seulement ? Un marqueur rouge/vert sur la vue
  joueurs révèle une information de MJ. La couche `links` a déjà le précédent d'un rendu par rôle.
- Les **torches portées par les pions** sont un second système de lumière (`Token.emitsLight`). Si le
  MJ clique une lumière fixe, il voudra cliquer une torche — or ce chemin passe aujourd'hui par la
  sélection du pion, pas par un hit-test de lumière.
- Les joueurs peuvent-ils éteindre une lumière ? Les portes, oui, sauf le verrouillage.
- ⛔ Le nom de l'événement doit entrer dans la table du §7 du CdC **avant** d'être implémenté :
  `CONVENTIONS.md` interdit d'inventer un nom d'événement.

### C-3 Handouts — envoi de fichier et bibliothèque de session

**L'existant est minimal.** Un `Handout` a **trois champs** : `id`, `name`, `imageUrl`. Il y a **un
seul emplacement actif**, pas de liste, pas d'historique, aucun regroupement par session ni par
campagne. L'`id` est fabriqué à chaque révélation et **n'adresse rien**.

L'image est fournie en **collant une URL**. Les `data:` sont refusés partout sauf pour les pions
(bornés à 24 Kio). La conversion Google Drive existe mais s'appuie sur des **points d'entrée non
documentés qui peuvent casser**, et elle ne s'applique **qu'aux handouts** — un fond de carte ou une
image de pion collés depuis Drive restent cassés.

⭐ **Le vrai manque est un chemin d'envoi de fichier.** `maps/tokens/` en a un ; il n'existe aucun
équivalent pour les handouts. C'est exactement pourquoi le mainteneur colle encore des liens Drive.

**À trancher** :
- Où vivent les fichiers ? Un `maps/handouts/` avec un `/api/handouts/save` sur le modèle des pions,
  ou un stockage Firebase ? ⚠ Le premier suppose l'outil local ; le second sort de « zéro build » et
  demande une décision de coût.
- « Bibliothèque **spécifique à une session** » : le handout est aujourd'hui de l'**état de session**,
  pas de la donnée de campagne. Une bibliothèque par session la rendrait persistante — est-ce
  toujours de l'état de session, ou de la donnée de campagne ?
- Plafond de taille ? Il n'y en a aucun aujourd'hui : un JPEG de 20 Mo en HTTPS passe toutes les
  vérifications.
- Plusieurs handouts affichables à la fois, ou toujours un seul ?

### C-4 Un skill de projet pour les passes UI/UX

**Réponse à la question posée** : aucun skill dédié à l'UI/UX n'est installé ici. Ce qui existe est
`artifact-design`, qui porte sur des pages web publiées, et `dataviz`, qui porte sur les graphiques —
ni l'un ni l'autre ne fait une passe d'ergonomie sur une application.

Mais un skill n'est qu'un fichier : `.claude/skills/<nom>/SKILL.md`, dans le dépôt ou dans
`~/.claude/skills/`. Ce dépôt n'en a **aucun** aujourd'hui. En écrire un aurait de la valeur
précisément parce qu'il porterait les contraintes **de ce projet**, qu'aucun skill générique ne
connaît : le Zero-UI côté joueurs, l'exclusivité mutuelle des outils MJ et leur désarmement au
changement d'onglet, le refus du terminal, la tablette et sa lisibilité à trois écrans, le
débordement du panneau MJ à 1024 px.

⭐ **Second candidat, indépendant** : un skill `revue-mutation` qui porterait le protocole de revue —
muter le code et exiger le rouge, vérifier que le patch touche du code et non une JSDoc, ne jamais
lire un nom de test comme une preuve. Ce savoir-faire a attrapé une vingtaine de faux verts ; il vit
aujourd'hui dans la mémoire de l'assistant et dans `docs/`, pas dans un outil invocable.

**À trancher** : en écrire un, les deux, ou aucun.

> ⚠ **Une moitié de la question est répondue le 16/08/2026.** Le mainteneur a demandé s'il existait
> un skill à *récupérer* pour une passe UX. Réponse vérifiée : **non**. Les skills ne se téléchargent
> pas en session — ils se chargent de `.claude/skills/`, de `~/.claude/skills/` ou d'un plugin — et
> **aucun plugin officiel Anthropic ne porte sur la revue d'ergonomie ou d'accessibilité d'une
> interface**. Les marketplaces existent (`/plugin marketplace add anthropics/claude-plugins-official`
> puis `/plugin install <nom>@<marketplace>`) mais n'offrent rien sur ce sujet.
>
> ⭐ Et l'audit du 16/08 a montré que le skill n'était pas le besoin : ce qui manquait n'était pas
> une méthode, c'étaient **trois faits d'usage** que seul le mainteneur détient (voir le tableau en
> tête de `AUDIT-UX-MJ.md`). Si un skill s'écrit un jour, ce sera **en aval** d'une passe réussie,
> pour figer ce qui a marché — pas en amont pour la guider.

### C-5 ⛔ `mapFromCellPoint` ne veut pas dire la même chose selon le pavage — les pions sont faux en hexagonal

**Trouvé le 16/08/2026** par la relecture du chantier des liaisons, hors de son périmètre. Ce n'est
pas une dette dormante : c'est un **défaut actif**, dès qu'une carte hexagonale porte un pion.

Le contrat `GridAdapter.js` dit « unité de case fractionnaire → pixels carte » sans dire *quel* point
de la case. Les deux implantations ont répondu différemment :

- `SquareGrid.mapFromCellPoint` rend le **coin** : `offset + cellX * pxPerCell` ;
- `HexGrid.mapFromCellPoint` rend le **centre** : `offset + px * (cellX + 0.5*(ligne&1) + 0.5)`,
  c'est-à-dire la formule de `pointFromCell` à l'entier près.

`TokensLayer._drawToken` calcule sa boîte par deux appels — coin haut-gauche et coin bas-droit — ce
qui n'est juste que pour la première convention. Vérifié par le calcul, `pxPerCell` 140, pion 1×1 :

| ligne | largeur dessinée | attendu |
|---|---|---|
| paire | `1,5 × px` = **210 px** | 140 |
| impaire | `0,5 × px` = **70 px** | 140 |

La hauteur est fausse aussi : `√3/2 × px` = 121,2 px au lieu des 161,7 px d'un hexagone pointe en
haut. Le centre dessiné est décalé de 105 px en ligne paire, 35 px en ligne impaire.

**Pourquoi ce n'est pas corrigé tout de suite** : le choix de convention ne concerne pas que les
pions. `mapFromCellPoint` sert aussi au rendu des murs, portails et lumières importés — voir son
commentaire dans `GridAdapter.js` — et l'import UVTT donne ses coordonnées en unités de case
fractionnaires depuis le **coin**. Changer `HexGrid` pour rendre le coin est probablement la bonne
réponse, mais elle traverse `portals.js`, `walls.js`, `blockedEdges.js` et l'import. C'est un
chantier, pas un correctif d'une ligne.

**Ce qui ferme la question** : trancher la convention dans `GridAdapter.js` — coin, et pas centre —
puis aligner `HexGrid` et vérifier les quatre consommateurs. ⚠ Aucun test ne défend aujourd'hui la
géométrie d'un pion hexagonal ; il en faudra un avant de toucher quoi que ce soit.

### C-6 ⛔ Deux fonctions de désignation en désaccord — avec deux PJ empilés, c'est le mauvais qui franchit

**Trouvé le 16/08/2026** par la relecture du chantier de l'invite de franchissement. Défaut
antérieur au chantier, mais rendu visible par lui : il se manifeste maintenant sur un escalier.

Deux fonctions désignent « le pion sur cette case » et ne répondent pas la même chose :

- `findHitToken` (`js/input/tokenHit.js`) départage par **identifiant croissant** ;
- `exactTokenAtCell` (`js/input/tokenHit.js`) rend **le premier du tableau**.

Rien n'interdit deux PJ sur la même case — `moveTokenToCell` n'empêche pas l'empilement. Avec
`tokens = [PC_zeta, PC_alpha]`, tous deux sur l'escalier :

1. le joueur tape : `findHitToken` sélectionne **alpha** (identifiant le plus petit), l'invite
   s'allume pour alpha ;
2. il retape : `exactTokenAtCell` rend **zeta**, la sélection saute silencieusement sur zeta et
   l'invite reste allumée — rien à l'écran ne signale le changement ;
3. il retape : c'est **zeta** qui monte à l'étage.

Le joueur lit « Retaper pour prendre l'escalier », retape, et c'est le personnage d'un autre qui
part. `PC_alpha` ne peut jamais franchir. ⛔ **Aucun ordre de branches ne répare ce cas** : l'ordre
inverse rendrait simplement zeta insélectionnable. C'est le désaccord entre les deux fonctions qui
le crée.

**Ce qui ferme la question** : leur donner le même départage — le plus simple étant de faire rendre
à `exactTokenAtCell` le même pion que `findHitToken` à distance nulle, c'est-à-dire l'identifiant le
plus petit plutôt que l'ordre du tableau. ⚠ `exactTokenAtCell` sert aussi au refus « case occupée » ;
vérifier les deux appelants. Le comportement actuel est figé par le test « deux PJ empilés » de
`tests/multiLevelJourney.spec.mjs`, qui devra bouger avec le correctif.

**Pourquoi ce n'est pas corrigé tout de suite** : il faut deux PJ exactement sur la même case, ce
qui ne s'est jamais produit en séance, et le correctif touche un départage dont dépendent la
désignation et le refus de destination — deux chemins que le chantier O a déjà réglés finement.

---

## D. Décisions produit encore ouvertes

### D-1 §12 q.9 — l'approximation de la lumière vue

La règle « une lumière n'est pas un œil » est tranchée et implantée. Ce qui reste ouvert est
l'**approximation** : le test porte sur le **centre** de la source, donc un PJ qui aperçoit une lampe
se voit révéler *tout son halo*.

⭐ **Le déclencheur est écrit** : voir en séance une pièce entière se dévoiler parce qu'un PJ aperçoit
une lampe par une porte.

**Deux non-déclenchements consignés** : le 11/08 sur `testvideo-3`, où les murs obliques bloquent la
ligne vers les lampes ; et le **13/08**, où le mainteneur a éprouvé les angles de vision sur porte
ouverte et juge le comportement « tout à fait adéquat ».

La version stricte coûterait 15 à 20 ms pour six PJ contre 300 de budget — le vrai prix est **une
centaine de lignes dans le chemin du fog**. Tant que le cas reste théorique, l'approximation tient.

### D-2 Le vrai nom dans l'historique public

L'identité git est corrigée pour l'avenir. ⚠ Le vrai nom du mainteneur reste dans l'historique public
de trois dépôts. Réécrire l'historique est une décision qui lui appartient, et elle n'a pas été prise.

### D-3 Vision dans le noir — la table de référence

Le besoin d'une table est confirmé et le champ existe depuis le lot 1a. ⚠ Ne pas régler un PJ à 0
avant le lot 3.

### D-4 `tests/manuel` — rapatriement à décider

`verify` ne couvre pas le geste réel ; `pnpm run test:manuel` existe pour ça. La cause est corrigée
depuis le 04/08, mais le rapatriement des scénarios dans la porte n'est pas décidé.

---

## E. Dettes techniques consignées, non corrigées

Aucune n'est un défaut actif. Toutes sont des pièges pour qui viendra après.

| # | Dette | Où | Pourquoi elle est laissée |
|---|---|---|---|
| E-1 | `cellPointFromMap(pointFromCell(c))` n'est **pas** un aller-retour exact en hexagonal : erreur jusqu'à **une demi-case** quand l'erreur sur `cellY` fait basculer le plancher et change la parité | `js/grid/HexGrid.js` | Ne casse pas `computeBlockedEdges`, qui n'évalue que des points réels. Mais les tolérances à `1e-9` du fichier n'absorberaient jamais 0,5 : tout futur code qui supposerait cet aller-retour exact casserait en silence |
| E-2 | La clé d'arête `min * cellCount + max` dépasse 2⁵³ au-delà de ~9 741 × 9 741 cases | `js/import/blockedEdges.js` | `allCells()` allouerait 10⁸ objets bien avant. Aucun test ne défend la borne |
| E-3 | Une mutation reste verte : faire juger le verdict R2-03 par un second appel `resumeDecodageFroid(brut, 0)` tout en affichant le net correct | `js/app/diag.js` | Aucun scénario de navigateur ne peut la distinguer, les deux durées d'un Chromium sans charge tombant du même côté du seuil. Ce n'est pas une régression plausible |
| E-4 | `features.animated` écrit par le générateur, absent du typedef et du validateur du catalogue | `js/import/catalog.js` | À corriger avant d'écrire un CRUD de cartes (C-1) |
| E-5 | Le typedef `SceneLibraryEntry` n'est référencé par rien | `js/core/types.js:220` | Vestige d'une conception antérieure. À implémenter avec C-1 ou à supprimer |
| E-6 | `ambient.color` importé, validé, persisté, **lu par aucun rendu** | `js/core/schema.js` | Voir B-1 |
| E-7 | `if (!level \|\| !grid) return new Set()` — un adaptateur nul rend « aucun mur ne bloque », en silence | `js/import/blockedEdges.js:253` | Même forme que le défaut corrigé en R-04a, mais changer le comportement peut casser des appelants qui passent `null` pendant le chargement |
| E-8 | La marge de `DRAG_HOLD_MS` n'est que de **10,8 ms** — appui p95 mesuré à 139,2 ms pour un seuil à 150 | `js/core/constants.js` | C'est ce chiffre qu'il faudra reprendre si la zone morte 150–500 ms est un jour découplée |

---

## F. Leçons de méthode, pour ne pas les repayer

- ⛔ **`verify` vert en local ne vaut pas vert en CI.** Le 13/08, l'option « Hexagonale (pointe en
  haut) » a fait déborder le panneau MJ de 15 px sur le runner Linux, dont les fontes sont plus
  larges, et passait sur le poste du mainteneur. Un test de mise en page dépend des fontes de la
  machine : la contrainte doit être **structurelle** (`width: 100%; min-width: 0`) et non
  cosmétique — raccourcir le libellé n'aurait protégé que jusqu'au prochain libellé.
- ⛔ **Ne jamais mettre de backticks dans un commentaire situé à l'intérieur d'un template literal.**
  La chaîne se termine là, et l'application ne démarre plus. Le symptôme est un `waitForApp` qui
  expire, pas une erreur de syntaxe lisible.
- ⛔ **Toute exécution de `test:unit` recopie `js/` dans `_site/`** — `tests/sitePackage.test.mjs`
  appelle `buildSite()`. Muter un fichier, lancer la suite, puis restaurer `js/` laisse la mutation
  **figée dans `_site/`**, que `.gitignore` masque.
- ⭐ **Une revue adversariale par sous-agent trouve ce qu'une relecture rate.** Le 13/08, deux agents
  ont sorti un bug réel déjà déclaré correct et dix mutations survivantes dans des tests neufs.
- ⚠ **Un message de commit qui cache son contenu coûte un aller-retour complet.** G-01 avait été
  livrée dans un commit intitulé `docs(...)` qui transportait trois fichiers de code : le travail a
  été réclamé deux fois par écrit alors qu'il était fait.
