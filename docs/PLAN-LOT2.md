# PLAN DU LOT 2 — lignes de vue, portes & tactique

> Écrit le 30 juillet 2026, après la clôture du lot 1b côté code.
>
> Découpage en tranches, **pas** un brief d'exécution : chaque tranche recevra le sien, sur le
> modèle des chantiers F à K. Ce document fixe l'ordre, les dépendances, et les décisions qui
> ne doivent pas être reprises à chaque tranche.
>
> Référence : CdC §5.4, §6, §7, §11 lot 2, et `ANALYSE-DD2VTT-GRILLES.md` §9.

---

## 1. L'état de départ est meilleur que le tableau d'`ETAT.md` ne le dit

Le tableau annonce « 0 sur 13 ». C'est vrai des livrables, mais pas du terrain :

1. **Le critère 8 est déjà implémenté côté consommateur.** `movement/reachable.js` honore un
   `Set` d'arêtes bloquées, et deux tests unitaires couvrent déjà le blocage d'arête et
   l'anti-corner-cutting strict. Seul le **producteur** manque :
   `js/import/blockedEdges.js` est un stub qui retourne un `Set` vide.
2. **La géométrie est déjà là.** 131 murs et 40 portails arrivent intacts dans le store pour
   `manoir-rdc`. Rien ne les lit.
3. **Les six fichiers du lot sont déjà au manifeste** : `vision/sweep.js`, `vision/fog.js`,
   `render/layers/fogLayer.js`, `render/layers/templates.js`, `ui/gm/fogTools.js`,
   `ui/gm/wallEditor.js`. Aucun n'existe.
4. **`updateToken` a été conçu au chantier K pour accueillir `markers`** : sa liste blanche est
   prête, seule la valeur du champ reste à définir.

---

## 2. Décisions arrêtées par le mainteneur

### 2.1 Les portes ont trois états, pas deux

`ouverte` / `fermée` / `verrouillée`. Une porte **fermée** s'ouvre par les joueurs. Une porte
**verrouillée** doit être déverrouillée par le MJ avant que les joueurs puissent l'ouvrir.

**Conséquence sur le modèle, à ne pas contourner.** `Portal.closed` est aujourd'hui un
**booléen** (`js/core/types.js:48`, CdC §6 ligne 535). Il devient un état à trois valeurs :

```js
/** @property {'open'|'closed'|'locked'} state */
```

**Pourquoi remplacer plutôt qu'ajouter un `locked: boolean` à côté de `closed`** : la seconde
forme rend représentable `{closed: false, locked: true}`, qui ne veut rien dire. Un état unique
rend l'état illégal **impossible à écrire**, ce qui vaut mieux qu'un contrôle qui l'attrape.

**41 portails sont déjà commités** au format booléen — 40 dans
`maps/generated/manoir-rdc.scene.json`, 1 dans `maps/minimal.json`. Ils doivent être
**normalisés à la lecture, jamais refusés** : `closed: true → 'closed'`,
`closed: false → 'open'`. C'est exactement le traitement retenu au chantier G pour les couleurs
ARGB, et pour la même raison — refuser reproduirait la « disparition après F5 » qu'`ETAT.md`
documente comme la cause historique de perte de campagne.

**Et le schéma ne valide aujourd'hui aucun champ de portail** : `validateCampaign` se contente
de `Array.isArray(level.portals)` (`js/core/schema.js:413`). Introduire `state` sans le valider
laisserait entrer n'importe quelle valeur en silence — le défaut « atteignable, franchi,
silencieux » que le chantier G a corrigé sur les couleurs. La validation du portail fait donc
partie de la tranche.

### 2.2 `portal.toggle` porte l'état absolu, malgré son nom

Le nom vient du CdC §7 et `CONVENTIONS.md:149` interdit d'en inventer un autre. Mais avec trois
états, « basculer » n'a plus de sens — basculer depuis `locked` mènerait où ? Le payload porte
donc l'**état cible** : `{ portalId, state }`. C'est aussi ce qu'exige l'idempotence
(`CONVENTIONS.md:156`), et la leçon déjà apprise deux fois : `handout.hide` au chantier H,
`token.elevation` au chantier K.

### 2.3 L'autorisation porte sur la transition, pas sur l'acteur

Le CdC §7 dit « MJ, joueurs si autorisé », ce qui suffisait à deux états. À trois, la règle est
plus fine :

| Transition | MJ | Joueurs |
|---|---|---|
| `closed` ↔ `open` | oui | **oui** |
| `locked` → `closed` | oui | non |
| `closed`/`open` → `locked` | oui | non |

**À dire franchement : c'est une règle de jeu, pas une frontière de sécurité.** Elle est
appliquée côté client, et un `by: 'players'` n'est pas une preuve d'identité. La vraie frontière
est la liste blanche d'adresses des règles Firebase (`ETAT.md`). Confondre les deux conduirait à
croire le modèle plus solide qu'il n'est.

### 2.4 Une porte verrouillée bloque exactement comme une porte fermée

Pour `computeBlockedEdges` comme pour le sweep, `closed` et `locked` sont **indiscernables** :
les deux bloquent passage et vision. Seules l'interface et l'autorisation les distinguent. Cette
simplification doit être écrite, sinon elle sera redécouverte trois fois.

### 2.5 Les gabarits ne sont pas manipulables par les joueurs

MJ seul pour l'instant. Le modèle l'autorisera plus tard sans refonte (`template.place` est
ouvert aux deux au §7), mais rien ne l'implémente au lot 2.

---

## 3. Le partage d'autorité, à répéter dans chaque brief

| Calcul | Où | Pourquoi |
|---|---|---|
| Arêtes bloquées | **partout, localement** | déterministe à partir des données d'étage ; c'est déjà le cas dans `ui/player/bootstrap.js:113` |
| Vision, fog | **Mac seul**, publiés | CdC §4 : le Mac est le nœud autoritaire |

Sans cette ligne dans chaque brief, on se retrouvera avec du calcul de vision sur la tablette.

**Contrainte du manifeste à ne pas violer** : `vision/*` ne peut importer que `core/*`, **jamais
`grid/*`**. Le sweep travaille donc en coordonnées carte, pas en cases. C'est voulu : la
visibilité est un problème géométrique, pas un problème de grille.

---

## 4. Les tranches

| Tranche | Contenu | Dépend de | Critères §11 fermés |
|---|---|---|---|
| **L-01** | `computeBlockedEdges` réel + cache par étage dans le store | — | **8** |
| **L-02** | `vision/sweep.js` : polygone de visibilité, pur | — | — |
| **L-03** | Union des PJ, rendue côté MJ | L-01, L-02 | — |
| **L-04** | `vision/fog.js`, `fogLayer.js`, trois états de rendu, persistance | L-03 | **5, 6, 7, 9, 12** |
| **L-05** | Portes à trois états, interactives | L-01, L-04 | **10, 11** |
| **L-06** | `fogTools.js` : tout révéler/masquer, pinceaux, undo | L-04 | — |
| **L-07** | `wallEditor.js` | L-01 | **1, 2** |
| **L-08** | `templates.js` : gabarits, MJ seul | L-02 | **3** |
| **L-09** | Marqueurs d'état | Q7 tranchée | **4** |
| **L-10** | Tenue 30 fps, 500 segments, 6 pions | mesure tablette | **13** |

### Notes par tranche

**L-01** — le cache n'est pas une optimisation prématurée : `bootstrap.js:113` appelle
`computeBlockedEdges` **à chaque tap**, ce qui devient intenable sur 500 segments. La note T-13
d'`ARCHITECTURE.md` l'annonçait déjà : « au lot 2 les arêtes bloquées deviennent un état vivant
[…] elles appartiennent donc au store, avec un cache par étage ». Invalidation limitée aux
arêtes voisines lors d'un `portal.toggle` (CdC ligne 381).

**L-01, deuxième cause du même symptôme — et elle survivra au cache.** Implémenter
`computeBlockedEdges` ne suffira **pas** à empêcher un pion de traverser un mur côté MJ, et il
faut le savoir avant de croire la tranche terminée. Le glisser MJ (`js/app/gm.js:344-351`) ne
consulte pas `state.reachableCells`, n'appelle pas `findPath`, et publie un chemin en ligne
droite `[from, targetCell]`. Seul le côté joueur passe par la zone atteignable et par `findPath`
(`js/ui/player/bootstrap.js:108-125`).

**Décision du mainteneur, 30 juillet 2026 : c'est un privilège MJ, à conserver.** Le MJ pose un
pion où il veut, mur ou pas — replacer une figurine à la main est un geste de table légitime, et
lui imposer les règles de déplacement des joueurs le gênerait sans rien protéger. À écrire dans
le brief L-01 : quand les 131 murs de `manoir-rdc` bloqueront enfin les joueurs, le MJ
continuera de les franchir, **et ce n'est pas une régression**. Sans cette ligne, quelqu'un
« corrigera » le contournement, ou pire, cherchera pourquoi le masque d'arêtes « ne marche
pas » côté MJ.

**L-04** — deux pièges nommés par le CdC, à traiter comme des critères et non comme des détails.
Les pions ne s'affichent **que** en vision courante : les montrer en zone explorée-hors-vision
permettrait aux joueurs de suivre les PNJ à travers les murs (CdC ligne 421). Et le critère 7
exige de recalculer le sweep **sur chaque case du chemin** (CdC ligne 384), sinon traverser un
couloir ne révèle que l'arrivée.

**L-05** — hitbox d'au moins une demi-case autour du segment, un segment de deux points étant
une cible minuscule au doigt, plus une règle explicite de désambiguïsation « tap sur porte »
contre « tap sur le vide ».

---

## 5. Deux ordres contre-intuitifs, à respecter

### 5.1 Mesurer le critère 13 dès L-02, pas à la fin

« 30 fps tenus avec 500 segments et 6 pions porteurs de vision » est une **mesure matérielle qui
peut invalider l'approche du sweep**. La découvrir après L-04 coûterait le fog entier.

Une section de `diag.html` mesurant le coût du sweep sur 500 segments doit donc arriver **avec
L-02**. C'est la leçon de la décision n°2, où l'on a bâti les lots 1a et 1b sur Firebase avant
de mesurer quoi que ce soit — et où la mesure obtenue ne mesurait même pas la bonne grandeur.

### 5.2 Spécifier la substitution des toits avant de coder le fog

`ANALYSE-DD2VTT-GRILLES.md` §9 abandonne les toits et confie leur fonction au fog, « d'une façon
**à déterminer au lot 2** ». C'est un trou de spécification, pas un détail d'implémentation.

**Hypothèse à valider avant L-04** : aucun mécanisme nouveau n'est nécessaire. Si le masque
initial est vide et que le sweep ne fuit pas aux angles (critère 12), l'intérieur d'un bâtiment
est noir jusqu'à ce qu'on y entre — ce qui *est* l'effet de jeu recherché. Mais cela doit être
écrit et recevoir un critère d'acceptation, sinon personne ne pourra dire si c'est satisfait.

---

## 6. Amendements requis avant L-05

- **CdC §6 ligne 535** : `closed: true` devient `state: 'open'|'closed'|'locked'`.
- **CdC §6 ligne 606** : le chemin `/session/{sid}/portals/{portalId} → { closed }` suit.
- **CdC §7** : préciser que `portal.toggle` porte l'état absolu, et la règle d'autorisation
  par transition du §2.3.
- **CdC §12** : Q3 et Q8 sont tranchées (§2.1, §2.3, §2.5) ; les marquer comme telles.

Ces amendements touchent le **cahier des charges**, donc la source de vérité du « quoi ». Ils se
font délibérément, avec justification écrite, pas au fil de l'eau.

---

## 7. Ce qui reste ouvert

**Q7 — le jeu de marqueurs d'état.** Le CdC la repousse « après une séance réelle, pas avant ».
L-09 attend donc une partie jouée, pas une décision de conception. C'est la seule tranche du lot
qui dépende d'un événement extérieur au code.
