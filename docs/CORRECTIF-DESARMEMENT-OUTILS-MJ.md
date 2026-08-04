# CORRECTIF — sortir d'un outil MJ, et savoir qu'on y est

> Écrit le 4 août 2026. **Défaut relevé par le mainteneur en usage réel**, pas par un test :
> « impossible de quitter le pinceau de fog côté MJ une fois que j'ai commencé à l'utiliser,
> donc je ne peux pas saisir un pion. »
>
> Ce n'est pas une tranche du lot 2 : aucun critère du §11 n'en dépend. C'est la réparation d'un
> défaut d'ergonomie introduit par L-06 et aggravé par L-07 et L-08, chacune ayant ajouté un
> outil au même moule.

---

## 1. Le mécanisme, diagnostiqué

**La bascule n'est pas cassée.** `js/ui/gm/fogTools.js:248` fait bien
`activeTool = activeTool === 'reveal' ? 'none' : 'reveal'`, et `disarm()` existe. Recliquer le
bouton actif désarme correctement.

**Ce qui manque, c'est la sortie.** Trois faits qui se combinent :

1. **Changer d'onglet ne désarme rien.** Le gestionnaire d'onglets
   (`js/ui/gm/panel.js:208-229`) ne fait que masquer et afficher des panneaux. Or cliquer un
   autre onglet — « Pions », pour aller chercher une figurine — est *le* geste naturel pour
   quitter un outil.
2. **Le seul bouton qui désarme est alors caché**, avec son onglet. Le MJ ne voit plus rien qui
   indique qu'un outil est armé.
3. **Aucune autre issue** : pas de touche Échap, aucun indicateur hors du panneau. Vérifié,
   aucun `keydown` dans `js/app/gm.js`.

Pendant ce temps, `canStartTokenDrag` continue de rendre `null`
(`js/app/gm.js:921-929`) : plus aucun pion n'est saisissable, et rien ne dit pourquoi.

**Le défaut vaut pour les trois outils.** Les murs et les gabarits neutralisent la saisie de pion
exactement comme le pinceau. Le mainteneur est tombé sur le fog ; il tomberait pareil sur les
deux autres.

## 2. Pourquoi le contrôle ne l'a pas vu

Mon brief de L-06 §9 exigeait : « le mode actif doit être **visible** — un pinceau armé change le
comportement du clic sur la carte, et un mode invisible qui change ce que fait un clic est un
piège à MJ. » L'indicateur a été mis **dans le panneau de l'outil**. Il satisfait la lettre et
manque le fond : caché avec son onglet, il ne prévient plus personne.

Et mon brief de L-08 §9.2 avait nommé la cause structurelle sans en tirer la conséquence :
« quatre modes exclusifs, c'est le seuil où la solution ad hoc devient une convention à nommer ;
au cinquième, il faudra un état *outil actif* unique. » Le défaut est arrivé au quatrième, pas au
cinquième.

---

## 3. Ce qu'il faut écrire

### 3.1 Un état « outil actif » unique, porté par le panneau

Aujourd'hui l'exclusion est énumérée deux à deux : chaque outil, en s'armant, appelle
`disarm()` sur les deux autres (`js/ui/gm/panel.js:266-320`). Trois outils font six appels ; un
quatrième en ferait douze, et chaque ajout multiplie les occasions d'en oublier un.

**`panel.js` détient `activeToolName`**, une seule valeur parmi `'none' | 'fog-reveal' |
'fog-hide' | 'wall-draw' | 'wall-delete' | 'template-place'`. Les modules d'outil ne se
connaissent plus entre eux : ils **demandent** l'armement au panneau, qui désarme ce qui l'était
et le leur notifie. L'état illégal « deux outils armés » cesse d'être représentable.

`js/app/gm.js` interroge alors **une** source au lieu de trois dans `canStartBrush`,
`canStartTokenDrag` et la branche `tap`.

### 3.2 Quitter l'onglet d'un outil le désarme

Le modèle mental devient « l'outil vit dans son onglet ». Aucun workflow n'en souffre : on arme
dans l'onglet Fog, on peint, on y est encore.

**Un tracé de mur en cours est abandonné** au changement d'onglet, sans confirmation : une
polyligne de moins de deux points n'était de toute façon pas un mur, et une confirmation modale
pour un tracé jetable serait pire que la perte.

### 3.3 Échap désarme

Gratuit, standard, et c'est le réflexe de quiconque s'est déjà senti coincé dans un outil. Sur
`js/app/gm.js`, un `keydown` sur `document`, retiré au `destroy`.

⚠ **Vue MJ seulement.** Rien de ceci ne touche `js/app/player.js` : l'interdiction n°2 ferme la
vue joueurs, et de toute façon aucun outil n'y existe.

### 3.4 L'outil armé se voit depuis n'importe quel onglet

C'est la correction de fond du §2. **Le bouton d'onglet de l'outil armé porte une marque** —
bordure, point, changement de fond — visible quel que soit l'onglet affiché. Le MJ voit donc en
permanence « le pinceau est armé », et sait où cliquer pour en sortir.

Pas d'overlay sur le canvas : le panneau est déjà l'endroit où vit l'état des outils, et ajouter
une seconde surface d'information en créerait deux à maintenir.

---

## 4. Ce qui n'est PAS dans ce correctif

- Aucun changement de comportement des outils eux-mêmes : le pinceau peint pareil, l'éditeur
  trace pareil, le gabarit se pose pareil.
- Aucune modification de `js/input/` : rien ici ne touche aux intentions.
- Aucun changement côté joueurs.
- Pas de raccourci clavier pour **armer** un outil. Échap désarme, rien n'arme au clavier — ce
  serait une autre décision, et elle n'a pas été demandée.

---

## 5. Critères d'acceptation

1. **Le défaut d'origine est mort** : armer le pinceau de fog, peindre, cliquer l'onglet
   « Pions », **saisir un pion au glisser**. C'est le geste exact du mainteneur.
2. Même vérification pour l'éditeur de murs et pour les gabarits.
3. **Échap désarme** depuis n'importe quel onglet, et un pion redevient saisissable.
4. **Deux outils armés est impossible** : armer l'un désarme l'autre, vérifié sur les trois
   paires, et `panel.js` n'expose qu'une seule valeur d'outil actif.
5. **L'outil armé est visible depuis un autre onglet** — la marque sur son bouton d'onglet.
6. **Un tracé de mur en cours est abandonné** au changement d'onglet, sans mutation de la
   campagne : le nombre de murs de l'étage est inchangé.
7. Recliquer le bouton actif de l'outil continue de le désarmer, comme aujourd'hui.
8. `pnpm run verify` vert, `pnpm run check-deps` vert. `js/input/` et `js/app/player.js`
   intouchés, vérifié au diff.

---

## 6. Tests attendus

Navigateur (`*.spec.mjs`) — c'est là que ce défaut vit, un test unitaire ne l'aurait pas vu :

- **le scénario du mainteneur**, pour les trois outils : armer, changer d'onglet, glisser un
  pion et vérifier qu'il a bougé. Sans ce test, le défaut revient au prochain outil ajouté ;
- Échap désarme et rend la saisie ;
- armer un second outil désarme le premier, sur les trois paires ;
- la marque de l'onglet apparaît et disparaît avec l'armement ;
- changer d'onglet pendant un tracé de mur ne crée aucun mur.

Unitaire, si `panel.js` s'y prête sans DOM lourd : l'état `activeToolName` ne prend jamais deux
valeurs, et chaque demande d'armement en libère la précédente.

---

## 7. Ce que ce défaut apprend, et qui vaut plus que le correctif

Le contrôle par tranche vérifie ce que la tranche touche. Ce défaut n'était dans aucune tranche :
il est né de leur **accumulation** — trois outils au même moule, chacun correct seul. Aucun des
trois contrôles ne pouvait le voir, et c'est un usage réel de dix minutes qui l'a trouvé.

À en tirer pour la suite : quand une tranche ajoute le n-ième élément d'une famille, la
vérification utile n'est pas « cet élément marche » mais « les n éléments cohabitent ». Le test du
§6 est écrit dans cet esprit — il boucle sur les trois outils plutôt que d'en tester un.
