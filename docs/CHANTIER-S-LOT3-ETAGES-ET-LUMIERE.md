# Chantier S — Lot 3 : étages & lumière

> **Statut : brief écrit puis mis en œuvre dans la même séance**, nuit du 6 au 7 août 2026, en
> autonomie. Le mainteneur a demandé de trancher sans attendre ses arbitrages et de consigner
> chaque choix avec ses alternatives — c'est le §0, et le rapport final reprend les mêmes.
>
> Lot 3 du CdC §11, **0 sur 6** à l'ouverture.

---

## 1. Ce qui existe déjà — mesuré avant d'écrire quoi que ce soit

Le lot est à 0 sur 6 **en comportement**, mais les emplacements de données sont largement en place.
Distinguer les deux évite d'écrire une liste de vœux.

| élément | état mesuré |
|---|---|
| Plusieurs étages dans la campagne | ✅ `campaign.levels[]`, `store.selectLevel()` avec validation |
| Fog par étage | ✅ `sessionFogMap` indexé par `levelId`, persisté par étage dans `localStorage` |
| `links` (liaisons) | ⚠ **Emplacement vide** : créé à `[]` par le schéma, lu par personne |
| `token.emitsLight` | ⚠ **Emplacement vide** : normalisé par le schéma, consommé par personne |
| `level.lights` | ⚠ **Parsé puis jeté** : `uvtt.js` les lit, aucun module ne les consomme |
| `level.ambient.level` | ⚠ **Parsé puis jeté**, en 0..1 |
| `baked_lighting` | ⚠ Signalé **à la préparation** seulement ; rien en séance |
| Sélecteur d'étage MJ | ⛔ **Inexistant** — aucune interface, `selectLevel` n'est appelé qu'au démarrage |
| Événement réseau de bascule | ⛔ **Inexistant** — `level.add` et `level.grid` existent, pas `level.select` |

⭐ **Le manque central des critères 1 et 2 est là** : changer d'étage côté MJ ne déplace pas la
tablette, faute d'événement. Tout le reste du lot s'appuie dessus.

⚠ **Le critère 3 est peut-être déjà satisfait** — le fog est indexé et persisté par étage — mais
**aucun test n'utilise deux étages**. « Probablement juste, jamais vérifié » n'est pas « acquis » :
c'est la première chose à éprouver, et si ça marche, c'est un critère gagné pour le prix d'un test.

---

## 0. Les arbitrages

**(1) Un pion ne voit jamais d'un étage à l'autre.** Chaque étage est un monde clos : vision, fog,
lumières, déplacement. Les mezzanines, balcons et puits de lumière sont hors lot.

> Alternative écartée — des ouvertures verticales déclarées entre étages. Elle demanderait un
> modèle de visibilité 3D que ni le format UVTT ni le sweep 2D ne portent, pour un cas que le
> mainteneur n'a pas demandé.

**(2) Une liaison est un point à point, bidirectionnelle par défaut.** `{ id, a: {levelId, cell},
b: {levelId, cell}, oneWay }`. Taper la case d'une extrémité téléporte à l'autre.

> Alternative écartée — des **zones** de liaison (plusieurs cases par escalier). Plus fidèle à un
> escalier réel, mais on peut poser deux liaisons côte à côte pour le même effet, et une zone
> demande une géométrie de plus à éditer, à synchroniser et à tester.

**(3) La bascule automatique suit le pion téléporté, et le cadenas la suspend.** Quand un pion
franchit une liaison, la vue joueurs bascule sur l'étage d'arrivée. Le cadenas est une bascule du
MJ, par session : armé, plus aucune bascule automatique, le MJ choisit l'étage à la main.

> C'est la lecture littérale du critère 4 — « le cadenas empêche la bascule auto quand le groupe
> est séparé ». Alternative écartée : basculer **seulement si tous les PJ** sont arrivés, ce qui
> automatise le jugement au lieu de le laisser au MJ. Un groupe peut être séparé volontairement,
> et c'est le MJ qui sait sur quel étage la table doit regarder.

**(4) La lumière est une seconde source de vision, unie à celle des pions, et bornée par les mêmes
murs.** Une source éclaire un disque, découpé par le sweep existant. L'ambiante décide si un pion
voit **sans** lumière.

> Alternative écartée — un modèle d'éclairage continu, avec atténuation et couleurs mélangées. Le
> CdC ne demande pas de dégradé, la vue joueurs est binaire (vu / pas vu), et une atténuation
> continue coûterait un rendu par pixel là où le projet tient par le sweep polygonal.

**(5) `baked_lighting: true` force l'ambiante à pleine lumière, et le dit.** Une carte dont
l'éclairage est déjà peint dans l'image ne doit pas recevoir une seconde couche.

> C'est la lecture littérale du critère 6 — « signalée et n'est pas double-éclairée ». Alternative
> écartée : ignorer les sources de lumière sur ces cartes. Mais une torche portée par un pion reste
> une information de **jeu**, pas seulement un effet ; on garde la vision qu'elle donne, on retire
> l'assombrissement ambiant.

---

## 2. Les tranches, dans l'ordre où elles se débloquent

> **État au 7 août 2026.** S-01 à S-06 **livrées et éprouvées par mutation**. Les limites
> de contenu réel et de mesure matérielle restent nommées au §4.
>
> Critères du lot : **6 sur 6, lot fermé le 12/08/2026.** Les critères 2 à 6 sont couverts par les
> tranches livrées ; le critère 1 l'était par `test_village_complet` sans que la case soit cochée —
> voir la note en fin de document.

### S-01 — Le fog par étage est indépendant *(critère 3)*

Éprouver ce qui existe. Deux étages, révéler sur l'un, vérifier que l'autre est intact, revenir,
vérifier que le premier est restauré. Si c'est vert, le critère est gagné pour le prix d'un test.

### S-02 — Sélecteur d'étage et bascule synchronisée *(critères 1 et 2, socle)*

- Un événement `level.select` porté au réseau.
- Un sélecteur d'étage dans le panneau MJ.
- La vue joueurs suit.

⚠ **La bascule doit republier la vision**, sinon la tablette arrive sur un étage sans masque — c'est
exactement le défaut de vision corrigé le 06/08 au matin, qui reviendrait par une autre porte.

### S-03 — Liaisons et téléportation *(critère 2)*

Poser une liaison côté MJ, taper la case côté joueurs, le pion se téléporte et la vue bascule.

### S-04 — Le cadenas *(critère 4)*

Bascule du MJ qui suspend la bascule automatique.

### S-05 — Lumières et ambiante *(critères 5 et 6)*

**Livré le 07/08/2026 — modèle volontairement binaire.** `ambient.level > 0` rend l'étage éclairé :
chaque PJ voit alors jusqu'au plafond technique de 20 cases, découpé par les murs et portes. À
`ambient.level === 0`, un PJ ne contribue que par son `visionDim` (vision dans le noir), également
plafonné à 20. Les valeurs intermédiaires ne créent ni dégradé ni coût par pixel.

`level.lights[]` et tout pion dont `emitsLight.range > 0` ajoutent chacun un polygone de sweep à la
vision courante, même dans le noir. Les sources sont bornées à 20 cases et occultées par exactement
les mêmes segments que les PJ. Déplacer une torche modifie la signature, recalcule depuis la mutation
du store et republie la vision sans attendre `requestAnimationFrame`; aucun `getImageData` n'est lu
sur ce chemin.

`baked_lighting: true` force l'état éclairé, sans réécrire la valeur importée de `ambient.level`, et
affiche un avertissement persistant dans le bandeau MJ. Le curseur Ambiance est alors désactivé : il
ne peut donc pas assombrir une image déjà éclairée. Les couleurs et intensités restent conservées et
signées, mais ne produisent pas encore de rendu coloré — la visibilité joueurs demeure binaire.
Les intensités UVTT historiques, dont l'échelle dépassait 1, sont rabattues à l'import vers 0..1 ;
les mutations partagées hors de ces bornes sont refusées avec un message précis.

Le champ UVTT `shadows` est conservé et validé, mais n'ouvre pas deux modèles d'occlusion dans ce
lot : toutes les sources utilisent les murs et portes du sweep commun. Ce choix protège l'absence
de fuite aux angles ; un éclairage décoratif traversant les murs relèverait d'un rendu futur.

### S-06 — Éditeur de liaisons *(critère 2, usage en séance)*

**Livré le 07/08/2026.** Le MJ pose l'extrémité A sur la carte, choisit l'étage et la case B,
le type, le sens et la visibilité, puis sélectionne ou supprime la liaison sans éditer le JSON.
Les deux extrémités doivent appartenir à des étages distincts. Les joueurs voient un repère discret,
jamais une liaison `gmOnly`; l'entrée interdite d'un sens unique n'est pas affichée.

Les traversées réseau portent une destination absolue, la valident avant mutation et mémorisent un
nombre borné d'identifiants d'événements. Un rejeu ne renvoie donc plus le pion à son étage de départ.

---

## 3. Ce qu'il ne faut pas casser

- ⛔ **Aucun `getImageData` sur le chemin de déplacement** (critère 8 du lot 2).
- ⛔ **La vision reste calculée sur mutation du store, jamais dans `rAF`** — c'est ce qui la rend
  indépendante des frames que le navigateur accorde au MJ.
- ⚠ **Toute grandeur d'écran se divise par le zoom**, quatre occurrences déjà payées.
- ⚠ **Un `skip` n'est pas un échec**, et **un test vert sur du code juste ne prouve rien** : chaque
  tranche est éprouvée par mutation.

---

## 4. Ce qui n'est pas fait, et qu'il ne faut pas croire acquis

**S-05 — lumières et ambiante : livré avec une limite assumée.** Le modèle ne mélange pas les
couleurs, ne produit pas de pénombre et ne dessine pas de halo : il ne répond qu'à la visibilité
actuelle, qui est le contrat de ce lot. La performance sur tablette et endurance physique restent à
consigner sur matériel réel ; les tests couvrent la géométrie, les mutations et le transport local,
pas une mesure thermique.

⚠ C'est la tranche qui touche au **modèle de vision**, donc la plus risquée du lot : elle rouvre
le sweep, le masque publié et la question de la vision dans le noir — dont le champ existe depuis
le lot 1a, et qu'`ETAT.md` interdit de régler à 0 sur un PJ avant ce lot précisément.

**Le critère 1 — « trois étages importés indépendamment, sans alignement manuel » — ✅ coché le
12/08/2026.** `maps/test_village_complet_00/01/02.dd2vtt` sont trois exports réels au dépôt, importés
séparément, assemblés par `maps/scenes.json` : offsets à 0 sur les trois, deux liaisons inter-étages
et une géométrie propre à chaque niveau (200/37/16 murs).

⛔ **Le paragraphe qui figurait ici posait deux exigences que le critère n'écrit pas**, et il a
retardé la fermeture du lot :

- « **provenance et droit de diffusion documentés** » — la licence est le domaine du mainteneur, pas
  une condition technique. Les fichiers sont au dépôt, donc ils ont le droit d'y être.
- « **de provenances indépendantes** » — « importés indépendamment » veut dire les uns des autres.
  Trois étages d'un même bâtiment viennent naturellement d'un même export : c'est le cas normal, et
  le critère demande seulement que l'outil n'exige aucun lien entre les fichiers ni aucun recalage à
  la main.

**La mesure lumière sur matériel reste ouverte.** Le profil de bureau sur `testbig150`, six PJ,
huit sources fixes et trois torches prouve que le chemin est mesurable et qu'il ne dépend pas de la
boucle de rendu. Il ne prouve ni la marge de la tablette, ni l'endurance thermique sous cast.
