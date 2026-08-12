# Brief — ce qui reste, hors §12

> Écrit le 12 août 2026, à la demande du mainteneur. **Le §12 est traité séparément**, par
> arbitrages successifs. Ce document couvre tout le reste.

## 0. Où en est le produit

**37 critères acquis sur 41.** Lots 1a, 1b, 2 et 3 fermés, spike vidéo fermé. ⭐ **Il n'y a plus aucun
critère en attente d'un essai** : les quatre restants sont tous du développement, tous dans le lot 4.

Et c'est le fait qui commande ce brief : **rien de ce qui reste ne presse.** Le produit est jouable,
mesuré, et sa bibliothèque de cartes est débloquée depuis le chantier Y. Ce qui suit est classé par
valeur réelle, pas par ordre de numérotation.

---

## 1. Les quatre critères du lot 4

### 1a. `HexGrid` — trois critères, le plus gros bloc de code restant

- Un étage `grid.type: 'hex'` coexiste avec des étages carrés importés d'UVTT.
- Le hit-test pixel→hexagone sélectionne la bonne case au doigt du premier coup.
- Les cases atteignables en hexagone sont à coût uniforme 1 et respectent les murs.

**Ce qui est déjà prêt, et c'est beaucoup.** `js/core/types.js` porte `GridType = 'square'|'hex'`,
`HexOrientation` et le champ `hexOrientation`. Le contrat de `GridAdapter` anticipe l'hexagone à chaque
méthode — arrondi cubique, six voisines, distance uniforme. `CellPoint` est un **couple opaque** :
carré = (colonne, ligne), hex = axial (q, r). Le troisième test d'architecture **interdit** les
coordonnées nommées hors de `js/grid/`, donc aucune hypothèse carrée n'a fui ailleurs — vérifié à
chaque `verify`. Le blocage tient en une ligne : `js/grid/index.js:18` lève `Grille hexagonale non
supportée`. **Il y a une couture, pas une refonte.**

Les deux décisions qui manquaient sont prises le 12/08 (§12 q.5 et q.6) : image calibrée plus étage
vierge, et rosette centrée à 1/7/19 cases. La convention géométrique est mesurée, pas à inventer —
pointe en haut, largeur plat-à-plat = `pixels_per_grid`, pas de rangée = ×√3/2.

⚠ **Le point qui devrait décider, et qui n'est pas technique : tu n'as aucune carte hexagonale.** Les
1 774 images du corpus sont carrées. Écrire `HexGrid` maintenant, c'est livrer un adaptateur que rien
n'alimentera avant que tu dessines des cartes hex ou que tu en trouves. Le travail est propre et bien
préparé ; sa **valeur d'usage est nulle à court terme**.

### 1b. Mesure au geste — un critère, et son propre CdC le déprécie

« Mesurer une distance sans quitter le Zero-UI ». Le §5.5 dit lui-même :

> « Priorité abaissée : les cases atteignables (§5.3bis) répondent déjà à “est-ce que j'y arrive ?”.
> Reste utile pour les portées de tir, d'un point arbitraire à un autre. »

⚠ Le geste prévu est **appui long + glisser**, donc `js/input/pointer.js` — le fichier le plus délicat
du dépôt, où l'appui long et le glisser se disputent déjà le doigt. La marge mesurée le 11/08 y est de
**10,8 ms** entre le p95 d'un tap réel (139,2 ms) et `DRAG_HOLD_MS` (150 ms). Un troisième geste dans
cette zone demande de la prudence, et la mesure de la séance est la donnée qui doit le cadrer.

⭐ **Piste moins risquée, à arbitrer** : le chantier X a montré qu'un **bouton armé hors onglets** évite
entièrement `pointer.js`, réutilise l'exclusivité mutuelle et ne coûte rien à la sensation. « Armer la
mesure, cliquer deux points » satisfait le critère sans toucher à la couche de gestes. Le Zero-UI n'est
pas violé : le bouton vit dans le panneau MJ, pas sur la carte.

---

## 2. R2-03 — la sonde de décodage froid est fausse

**C'est le seul reste qui soit un vrai défaut**, et il porte sur un critère qu'on croit fermé.

`mesurerDecodageFroid` refabrique une `Image` et fait `await image.decode()` **juste avant** de démarrer
le chronomètre : le bitmap est chaud par construction, et les deux minutes de silence sont annulées à la
ligne d'avant. Rien ne vide ensuite le pipeline GPU, donc on chronomètre la mise en file d'une commande.
D'où **0,2 ms pour 12 Mpx** — 60 Gpx/s, impossible — puis **1 146 ms sur la doublure**, qui est le coût
du premier tracé payé en retard.

⛔ **Conséquence : le « OUI — critère R2-03 tenu » qu'imprime la page est un faux vert.** Le seuil de
5 ms n'est pas mesuré.

**Le correctif** : chronométrer le `drawImage` sur le bitmap **armé**, sans le préchauffer, avec un
`getImageData(0,0,1,1)` derrière pour forcer le vidage — et mesurer d'abord le coût de cette relecture
seule pour le retrancher, sinon la sonde pollue son propre résultat. Une heure, tests compris.

Le seul chiffre exploitable aujourd'hui reste le `Image.decode()` à froid : **1 118 ms sur la tablette**
contre ~490 ms sur le Mac, ce qui confirme la prédiction du chantier N.

---

## 3. R1-01 — la rétention, à constater dans la console

Le code est fait — barrière `joining`, curseurs ACK, suppression transactionnelle par lots de 32. Ce
qui reste est une **observation** : ouvrir la console Firebase après une séance à deux clients et
constater que `session/<id>/events` ne grossit plus sans limite.

Tes essais Mac + tablette ne le couvrent pas : ils prouvent que ça marche, pas que le canal se purge.
C'est le dernier point qui ferme la porte R1.

---

## 4. Trois écarts mineurs, relevés le 11/08 et laissés en place

Aucun n'est urgent ; tous sont petits.

| | Où | Correctif |
|---|---|---|
| Le champ de rayon des gabarits déclare `max="20"` mais le composant borne à **50** | `templateTools.js` | choisir laquelle des deux bornes est la bonne — c'est un arbitrage de jeu, pas de code |
| `onPlaceTemplate` est déclaré dans le typedef et **jamais appelé** | `templateTools.js` | le supprimer du typedef, ou le câbler |
| `currentTemplateId` vient de `Date.now()` | `templateTools.js` | deux armements dans la même milliseconde produiraient le même identifiant |

---

## 5. Ce que je recommande, et dans quel ordre

1. **R2-03**, parce que c'est le seul vrai défaut de la liste et qu'il fait passer un faux vert pour
   une validation. Une heure.
2. **Les trois écarts des gabarits**, tant qu'on y est — le typedef mort surtout, qui piégerait un
   appelant en silence.
3. **R1-01**, quand tu ouvriras la console pour autre chose.
4. **La mesure au geste**, si et seulement si tu la veux à la table — et alors par bouton armé, pas par
   `pointer.js`.
5. **`HexGrid` en dernier**, et seulement le jour où tu as une carte hexagonale. Le code est prêt à être
   écrit, il n'a simplement rien à afficher.

⭐ **Et l'option qu'il faut nommer : ne rien faire de tout ça.** Le produit est à 37/41, les quatre
manquants sont dans le lot le moins pressant, et la dette d'exploitation Firebase (rétention
automatique, ménage des sessions) est écrite comme « à faire avant la 1.0 » — pas avant la prochaine
séance. Jouer, et laisser l'usage désigner le prochain chantier, est un choix défendable.
