# Contrat de liaison Outil MJ Warhammer ↔ RPG Map Display

Version du contrat : **1** (04/11/2026). Statut : implémenté et publié des deux côtés (06/11/2026).
Révision du 08/11/2026 : précisions au §10 (remise à zéro des pions posés à chaque instantané, liste d'engagements vide). Elle décrit un comportement existant, sans rien changer aux messages : la version du protocole (`MAP_LINK_VERSION` = `MJ_LINK_VERSION` = 1) ne bouge pas.
Révision du 11/11/2026 : `campaignName` retiré de `map.hello` (§2.3). Aucun côté ne l'a jamais envoyé ni lu : le texte rejoint le comportement existant, la version du protocole ne bouge pas.
Copie identique dans les deux dépôts :
- `Outil MJ Warhammer/docs/CONTRAT_LIAISON_MAP_DISPLAY.md` ;
- `rpg-map-display/docs/CONTRAT-LIAISON-OUTIL-MJ.md`.

Toute modification se fait dans les deux copies et incrémente la version. Les deux outils vérifient la version à la connexion (§2.3).

**Valeur du document.** La validation de ce contrat par le mainteneur vaut feu vert pour chaque amendement de Map Display listé au §11 : manifeste, champs de pion, événements du §7, réouverture de Q7. Un amendement absent de cette liste reste soumis à la règle « se signale, ne s'improvise pas ».

---

## 1. Principe

Pendant un combat joué avec l'outil MJ, l'outil MJ est la **source de vérité** de ce qu'est un pion : image, nom, PV, états, taille, portées, monté ou à pied, mort.

Map Display reste la source de vérité de **où il est et ce qui se voit** : case, trajet, étage, élévation, caché, lumière portée, verrou.

Sans outil MJ, Map Display fonctionne exactement comme aujourd'hui : pions du fabricant et du catalogue, réglages manuels, ×2 monté.

| Champ du pion | Propriétaire pour un pion lié | Remarque |
|---|---|---|
| `imageUrl`, `label`, `kind`, `sizeCells`, `speedCells`, `runCells`*, `visionDim`, `visionSource`*, `hp`, `health`, `markers`, `markerLevels`*, `mounted`, `rider`*, `dead`*, `camp`* | **Outil MJ** | Contrôles grisés dans Map Display, panneau MJ et tablette, avec la mention « géré par l'outil MJ ». |
| `cell`, `move`, `levelId`, `elevation`, `hidden`, `emitsLight`, `locked`, `playerMovable`, `borderColor` | **Map Display** | L'outil MJ ne les écrit jamais. |
| `link`* | Map Display, à la liaison | Voir §3. |

\* nouveau champ, voir §11.

## 2. Transport

### 2.1 Canal

`BroadcastChannel('wfrp-map-link')`, ouvert entre l'onglet **outil MJ** et l'onglet **gm.html** de Map Display, dans le même navigateur.

BroadcastChannel exige la même origine :
- **Production** : `https://ethoril.github.io/Outil-MJ-Warhammer/` et `https://ethoril.github.io/rpg-map-display/` sont de la même origine.
- **Local** : un seul serveur local sert les deux dépôts sous ces mêmes chemins, par exemple `http://localhost:8770/Outil-MJ-Warhammer/` et `http://localhost:8770/rpg-map-display/`. Deux ports différents ne fonctionnent pas.

La tablette n'écoute jamais le canal. Elle reçoit tout par le transport Firebase existant, republié par l'onglet MJ, qui reste le nœud autoritaire.

### 2.2 Enveloppe

```js
{ v: 1, type: 'token.state', seq: 42, at: 1730700000000, from: 'outil-mj' | 'map', payload: {…} }
```

- `seq` croît de 1 à chaque message, pour chaque émetteur.
- Les messages d'état sont **absolus et rejouables** : le dernier reçu fait foi.
- Les messages d'effet (`fx.*`) sont éphémères et ne sont jamais rejoués.
- Un message dont la version `v` est inconnue est ignoré. Les deux outils affichent alors « versions de liaison différentes ».

### 2.3 Appairage et resynchronisation

Le MJ est le seul utilisateur. **L'onglet gm.html ouvert fait foi.**

1. À l'ouverture et à chaque rechargement, la carte émet `map.hello { v, sessionId }`.
2. L'outil MJ répond `mj.snapshot`, l'état complet de tous les pions liés (§4). Il émet aussi `mj.hello` à son propre démarrage, et la carte répond par un `map.hello`.
3. Les deux côtés affichent un indicateur « carte connectée » ou « outil MJ connecté ». Un battement toutes les 5 s (`*.ping`) détecte la fermeture de l'autre onglet. Après 15 s sans battement, l'indicateur passe à « déconnecté ». Un onglet caché voit ses minuteries ralenties par le navigateur (une par minute après 5 min) : chaque côté **répond au battement reçu par le sien** s'il n'a pas battu depuis 4 s. L'onglet visible entretient ainsi la liaison, sans boucle (amendement du 05/11, constaté en recette).
   - Si la carte reçoit un message alors qu'aucune campagne n'est chargée, elle réémet `map.hello` dès qu'une campagne l'est, pour recevoir l'instantané (amendement du 05/11).
4. Rien n'est rejoué à la reconnexion, sauf l'état. Les effets manqués sont perdus, et c'est voulu.

## 3. Identité et liaison

Nouveau champ de pion `link` :

```js
link: { source: 'outil-mj', ref: 'pj:<persistentCharacterId>' | 'p:<participantId>' } | null
```

- **PJ** : la liaison est **durable**, attachée au personnage persistant et non à une rencontre. Le pion PJ existant sur la carte est lié une fois pour toutes.
  - Le MJ lie le pion depuis le panneau MJ de Map Display (« Lier à un PJ de l'outil MJ »). Il choisit dans la liste des PJ que l'outil MJ envoie (`mj.roster`).
    - `mj.roster { characters: [{ ref: 'pj:<id>', label }] }`, trié par nom, part avec chaque `mj.snapshot` et à chaque changement de la liste (05/11).
    - La carte publie `token.link { tokenId, ref? }` vers la tablette, puis réémet `map.hello` pour recevoir l'état du PJ.
  - Le lien vaut aussi **hors combat** : PV, états, monté et mort restent pilotés par l'outil MJ en exploration. L'outil MJ lit alors le personnage persistant (réserve).
- **PNJ, créatures, alliés, participants improvisés** : liaison par rencontre (`p:<participantId>`). Map Display crée le pion à la réception de `token.add`.
- **Montures des PJ** : liaison par rencontre (`p:<participantId>`) comme les autres participants. Leur `kind` est `pc` (§4).

## 4. État d'un pion lié : `token.state`

Payload :

```js
{
  ref, label, camp: 'pj'|'allie'|'ennemi'|'neutre',
  kind: 'pc'|'npc', visionSource: boolean,
  imageUrl: string|null,            // data: ≤ 24 Kio ou null (§6)
  color: string|null,               // PJ et monture d'un PJ : '#rrggbb' ; null sinon (06/11, lot P2)
  sizeCells, speedCells, runCells,
  visionDim,
  hp: { current, max }, health: 'unharmed'|'wounded'|'critical',
  markers: StatusMarker[], markerLevels: { [marker]: number },
  mounted: boolean, rider: RiderOverlay|null,   // §8
  dead: boolean, deathCause: DeathCause|null    // §9
}
```

Les champs se calculent ainsi côté outil MJ :

| Champ | Règle |
|---|---|
| `label` | `participant.name` tel quel (« Gobelin 2 »). Le `copyNumber` de Map Display n'est pas utilisé. |
| `kind` | `pc` pour un PJ **et pour la monture d'un PJ** ; `npc` pour tout le reste. |
| `visionSource` | `true` pour un PJ seulement. Une monture de PJ ne révèle pas le brouillard. |
| `sizeCells` | Taille (`creatureSizeOf`) : Petite 1, Moyenne 1, Grande 2, Énorme 3, Monstrueuse 4. Un cavalier monté prend la taille de sa monture. |
| Échelle | Une seule grille, deux conversions faites par l'outil MJ (les yards valent des mètres). **Déplacements et armes à distance : 1 case = 2 m**, y compris les sorts et talents qui modifient un Mouvement. **Sorts, prières et effets de talents (portées, zones) : 1 m = 1 case**, donc « Bonus de FM mètres » = BFM cases. Seule exception : la vision (`visionDim`, ci-dessous), comptée à 2 m par case. |
| `speedCells` / `runCells` | Marche et Course **effectives**, en cases : Marche = M×2 m, donc M cases ; Course = M×4 m, donc 2M cases. Elles tiennent compte des Traits de déplacement, des états (Enchevêtré = 0…) et du reste, via `creature-movement.js`. Un cavalier monté reçoit les portées de sa monture. Map Display n'applique **pas** son ×2 monté à un pion lié. |
| `visionDim` | 1 case par défaut ; **10 cases** avec Vision nocturne (20 m) ; **20 cases** avec Vision dans le noir ou Infravision. Les sens sont détectés par `creature-senses.js`. |
| `hp` | `hp` et `maxHp` du participant. Si `maxHp` vaut `null` (PJ persistant), il est recalculé depuis la fiche avant l'envoi. Jamais `null` sur un pion lié. |
| `health` | `unharmed` si PV = max ; `critical` si PV ≤ ¼ du max ou PV = 0 ; `wounded` sinon. |
| `markers` | Table du §5. `markerLevels` porte le niveau de chaque marqueur, dès 2. |
| `dead` | `extensions.v5.dead`. |
| `color` | `tokenColor` du profil, `#rrggbb` en minuscules, **pour un PJ ou la monture d'un PJ** ; une monture sans couleur propre prend celle de son cavalier (décision du MJ du 06/11). `null` dans tous les autres cas, et quand le profil n'en a pas : la carte efface alors la teinte (monture démontée). Toute `color` reçue teinte un cerclage bronze ; `null` rend le cerclage et la teinte du camp. |

Affichage côté Map Display, sans changement sauf ce qui est indiqué :
- les chiffres de PV sont visibles des joueurs pour `kind: 'pc'`, donc aussi pour les montures des PJ ;
- les autres pions montrent leur santé ;
- tous les états sont visibles des joueurs, y compris ceux des ennemis ;
- un niveau ≥ 2 s'affiche en chiffre dans le coin du badge.

## 5. États → marqueurs

Les états de l'outil MJ sont reconnus par leur clé repliée (sans accents, en minuscules).

| Outil MJ | Marqueur |
|---|---|
| À terre | `prone` |
| Sonné | `stunned` |
| Inconscient | `unconscious` |
| Aveuglé | `blinded` |
| Assourdi | `deafened` |
| Hémorragique | `bleeding` |
| Surpris | `surprised` |
| Enchevêtré / Empêtré | `entangled` |
| Enflammé | `ablaze` |
| Brisé | `broken` |
| Empoisonné | `poisoned` |
| **Exténué** | `fatigued` (**nouveau**) |
| **Souillé** | `tainted` (**nouveau**) |
| Peur (test raté, en cours) | `fear` |
| Terreur (en cours) | `terror` |
| Frénésie active | `frenzy` |

Les états de talents, de sorts ou d'origine maison, ainsi que « Blessé », **ne partent pas** vers la carte : la santé couvre déjà la blessure.

## 6. Images

- **PNJ et créatures** : nouveau champ image sur le **profil** de l'outil MJ. À l'import, l'image est recadrée en rond et réduite à **24 Kio au plus**, au format `data:` (WebP ou JPEG), ce qui respecte les plafonds de Map Display (24 Kio par image, 512 Kio au total). Toutes les copies d'un profil partagent cette image.
- **PJ** : l'outil MJ **n'envoie pas d'image**. Le pion PJ garde l'image choisie dans Map Display (`imageUrl: null` dans `token.state` signifie « ne pas toucher »).
- **Sans image** : Map Display dessine un disque à la couleur du `camp`, avec les initiales du `label`.
- `imageUrl` devient modifiable sur un pion lié (amendement de `ALLOWED_TOKEN_PATCH_KEYS`), sans recréer le pion.

## 7. Cycle de vie

| Moment | Outil MJ | Carte |
|---|---|---|
| Lancement d'une rencontre | `token.add` pour chaque participant non PJ | Pion créé **dans la réserve**. Le MJ le pose case par case. Les pions PJ déjà liés passent en combat sans bouger. |
| Ajout d'un participant en cours de combat | `token.add` | Réserve. |
| Changement d'état, de PV, de taille… | `token.state` | Mise à jour. |
| Passage au banc (Hors combat) | `token.state` (inchangé côté carte) | **Rien ne bouge.** |
| Mort | `token.state { dead: true, deathCause }` + `fx.death` | Le pion **reste** sur sa case, avec le rendu « mort » (désaturé, croix discrète). |
| Fin de la rencontre, ou participant retiré | `token.remove { ref }` pour chaque `ref` non PJ disparu de la scène | Les pions PJ restent, liés. **Tous les autres pions liés de la rencontre sont retirés**, y compris les morts et les montures de PJ démontées. |

L'outil MJ déduit ce cycle de vie de ses instantanés successifs (`js/core/map-link.js`) : un `ref` qui apparaît part en `token.add`, un `ref` qui change en `token.state`, un `ref` non PJ qui disparaît en `token.remove`. Un `ref` PJ (`pj:…`) n'est jamais retiré.

## 8. Montures

Sur la carte, la paire cavalier-monture s'affiche **en un seul pion** quand le cavalier est monté, et en **deux pions** quand il est à pied. C'est le même contrat que `mountedStateForMap` (`js/core/mounts.js`).

### 8.1 Pion monté

- Il garde l'identité (`ref`) du cavalier, prend la case de la monture et la taille (`sizeCells`) de la monture.
- Le pion de la monture sort du plateau tant que la paire est fusionnée. Il est conservé hors plateau, sans être supprimé.
- Image : celle de la **monture**, avec un **médaillon** du portrait du cavalier.
- `rider` (RiderOverlay) : `{ ref: <ref de la monture>, label, imageUrl, hp, health, markers, markerLevels }`.
  - Le pion porte **deux anneaux** : l'extérieur pour la monture, l'intérieur pour le cavalier.
  - Les badges d'états réunissent ceux des deux.
  - Une blessure de l'un ou de l'autre déclenche la gerbe de sang sur ce pion.
- Portées : celles de la monture (§4). Le ×2 de Map Display est désactivé.
- Les portails restent **tous bloqués** pour un pion monté (règle actuelle de Map Display).

### 8.2 Bascules

La bascule ne se fait **que depuis l'outil MJ**. Les boutons « monté » de Map Display, sur le panneau MJ et sur la tablette, sont grisés sur un pion lié.

**Démontage** (volontaire, chute, ou monture tuée) :
1. L'outil MJ envoie `mount.split { riderRef, mountRef }`.
2. La monture **reste sur la case** du pion fusionné.
3. Le cavalier passe en **pose armée** : le MJ touche une case adjacente libre. Rien ne bouge seul.
4. Si la monture est morte, elle reste sur sa case avec le rendu « mort ».

**Remonte** :
1. L'outil MJ envoie d'abord `mount.request { riderRef, mountRef }`.
2. Si les deux pions sont posés, la carte vérifie qu'ils sont **adjacents** :
   - si oui, elle répond `mount.accepted`, puis fusionne le pion sur la case de la monture à la réception de `token.state` ;
   - sinon, elle répond `mount.refused { reason: 'not-adjacent' }`. L'outil MJ n'applique pas la bascule et affiche « Rapprochez le cavalier de sa monture sur la carte ».
3. Si la carte est déconnectée, ou si un des pions n'est pas posé, l'outil MJ applique la bascule sans vérification.

## 9. Effets de blessure et de mort

Les effets sont des événements **éphémères**, joués sur l'écran MJ et sur la tablette. La carte les republie vers la tablette par son transport, sans les persister. **Un pion caché (`hidden`) ne joue aucun effet sur la tablette.**

### 9.1 Blessure

`fx.wound { ref, hpLost, maxHp, target: 'self'|'mount' }`.

- Elle est émise à **chaque baisse de PV**, quelle qu'en soit la source : coup, critique, état ou sort.
- L'intensité de la gerbe dépend de `hpLost / maxHp` : petite gerbe sous ¼ du max, grosse gerbe au-delà.
- Après l'effet, une **tache de sang au sol** reste sur la case et s'estompe en 1 à 2 minutes. Elle n'est pas persistée : un rechargement l'efface.

### 9.2 Mort

`fx.death { ref, cause }`, avec `DeathCause` = `'blood' | 'fire' | 'magic' | 'poison' | 'decapitation' | 'dismemberment'`.

| Cause | Animation | Déduite côté outil MJ de… |
|---|---|---|
| `blood` (par défaut) | Effondrement et flaque qui s'étend | Coup ou critique ordinaire, Hémorragique |
| `fire` | Calcination, cendres | Enflammé, sort de feu |
| `magic` | Dissipation lumineuse | Sort sans élément identifié |
| `poison` | Affaissement verdâtre, sans sang | Empoisonné, poison, maladie |
| `decapitation` | Décapitation | Résultat de critique mortel de ce type |
| `dismemberment` | Démembrement | Résultat de critique mortel de ce type |

Après l'animation, le rendu durable est le même pour toutes les causes : pion désaturé et croix discrète (§7). La correspondance exacte entre résultats de critiques et `decapitation` ou `dismemberment` se fixe au lot 4, à partir de `js/core/criticals.js`.

## 10. Retours de la carte vers l'outil MJ

| Message | Payload | Effet dans l'outil MJ |
|---|---|---|
| `map.placed` / `map.unplaced` | `{ ref, levelId }` | Indicateur « posé » sur le participant, et liste « à poser ». |
| `map.adjacency` | `{ pairs: [[refA, refB], …] }` (camps opposés seulement : PJ et alliés contre ennemis, un neutre n'est engagé avec personne ; pions morts exclus) : liste **complète** du plateau, envoyée à chaque fin de déplacement | **Suggestion** d'engagement, jamais automatique : le MJ accepte ou ignore. |
| `map.distance` | Réponse à `mj.distanceQuery { fromRef, toRef, queryId }` : `{ queryId, cells }` (la carte ne connaît pas les mètres ; diagonale = 1,5 case, voir §14 ; distance entre les cases les plus proches des deux emprises ; `cells: null` si un des pions n'est pas posé ou s'ils sont sur des étages différents, l'outil MJ laisse alors la saisie au MJ) | Portée préremplie : l'outil MJ convertit les cases selon le §4 (×2 m pour un tir, 1 m par case pour un sort, une prière ou un talent). |
| `map.ran` | `{ ref }` quand un pion lié termine un déplacement dont le trajet dépasse sa Marche (`speedCells`), donc a couru, une fois par déplacement | Le participant a utilisé son Action du Tour pour courir. Jamais envoyé pour un déplacement à la Marche ni pour un pion non lié. |

À chaque `mj.snapshot` reçu, Map Display remet à zéro ce qu'elle a annoncé, puis renvoie un `map.placed` pour chaque pion réellement posé. L'outil MJ vide donc sa liste des pions posés quand il envoie un instantané (réponse à `map.hello`) et quand la liaison passe à « déconnectée » : la liste se remplit aussitôt avec les placements exacts, sans indicateur « posé » périmé.

L'outil MJ envoie aussi `mj.engagements { pairs }`, à chaque changement et à chaque instantané, même avec `pairs: []` quand il n'y a aucun engagement, pour que la carte efface les traits périmés. Map Display les affiche en traits fins **sur l'écran MJ seulement**, jamais sur la tablette.

Le tour de jeu, c'est-à-dire le personnage actif, **n'est pas affiché** sur la carte.

## 11. Amendements de Map Display couverts par ce contrat

1. **Manifeste** (`ARCHITECTURE.md` §1) :
   - module de liaison côté app MJ, par exemple `js/app/mjLink.js` ;
   - rendu des effets : `js/render/layers/fx.js` (calque `fx`, entre `tokens` et `fog`) et les images `assets/fx/*.webp` (lot L4, 05/11) ;
   - icônes `fatigued` et `tainted` ;
   - copie de ce contrat dans `docs/`.
2. **Type `Token`** : `link`, `runCells`, `visionSource`, `markerLevels`, `rider`, `dead`, `deathCause`, `camp`, avec leur validation dans `schema.js` et leur normalisation.
3. **`ALLOWED_TOKEN_PATCH_KEYS`** : `imageUrl` devient modifiable pour un pion lié ; `mounted` reste à écrivain unique (`setTokenMounted`), désormais appelé par la liaison.
4. **Vision** : la source de vision devient `visionSource`. Pour un pion non lié, elle vaut par défaut `kind === 'pc'`, donc sans changement de comportement.
5. **Q7 rouverte** : ajout de `fatigued` (Exténué) et `tainted` (Souillé) aux marqueurs, avec leurs libellés, catégories et icônes ; chiffre de niveau sur le badge.
6. **Rendu** :
   - deux anneaux et médaillon pour le pion monté ;
   - médaillon des pions liés (lot P2, 06/11, étude E1 variante B) : personnage sur fond émaillé dans un cerclage, fenêtre à 69 % et dans la case ; PJ et monture d'un PJ en bronze teinté de `color` (à défaut, teinte du camp), allié étain à laurier, ennemi fer à pointes, neutre bronze ; mort en cerclage gris ; sous 36 px à l'écran, repli sur le disque simple. Le liseré choisi à la main (`borderColor`) ne compte plus sur un pion lié. Images `assets/medaillons/*.webp`, module `js/render/medallion.js` ;
   - disque de camp avec initiales pour un pion sans image ;
   - rendu « mort » ;
   - second palier (Course) dans la zone de trajet préparé : la Marche en aplat, la Course en anneau extérieur hachuré à bordure pointillée ; au-delà de la Marche le trajet change de style et l'étiquette « Course : Action utilisée » s'affiche à l'arrivée, sur les deux écrans ; le budget d'un pion lié va jusqu'à `runCells` ;
   - effets `fx.*` et tache de sang ;
   - traits d'engagement sur l'écran MJ seulement.
7. **Événements réseau** (CdC §7) : republication vers la tablette des états liés et des effets éphémères, et fusion et séparation des pions de monture.
8. **Verrous d'interface** : sur un pion lié, les contrôles des champs détenus par l'outil MJ sont grisés, sur le panneau MJ comme sur la tablette.
9. **Pose armée** du cavalier au démontage, et contrôle d'adjacence à la remonte.

## 12. Changements côté outil MJ

- Module de liaison qui écoute `Bus.on('combat')`, relit le store, calcule les `token.state` qui ont changé et les émet. Il gère aussi l'appairage, le battement et l'instantané complet.
- Champ image sur le profil, avec import, recadrage et compression à 24 Kio au plus.
- Calcul des portées effectives en cases, de `visionDim`, de `health` et du `maxHp` des PJ persistants.
- Détection des blessures (baisse de PV) et de la cause de mort.
- Montures : `mount.request`, `mount.split`, et le message « rapprochez… ».
- Interface :
  - indicateur « carte connectée » ;
  - indicateur « posé » et liste « à poser » ;
  - suggestions d'engagement ;
  - distance préremplie ;
  - liste des PJ (`mj.roster`) pour la liaison durable.

## 13. Ordre de construction

1. **Socle** : transport, appairage, resynchronisation, identité et liaison des PJ, `token.add` et `token.state` (PV, santé, états, niveaux, taille, portées, vision, mort sans animation), cycle de vie (§7), verrous.
2. **Images** : champ du profil, compression, disque de camp et initiales.
3. **Montures** : fusion et séparation, deux anneaux, médaillon, pose armée, adjacence.
4. **Effets** : gerbe, tache, six morts, déduction des causes.
5. **Retours de la carte** : posé et à poser, adjacences, distance, traits d'engagement.

## 14. Points laissés ouverts (à trancher au lot concerné)

- **Mesure des distances** (lot 5) : **tranché le 05/11 (D4)**. On reprend la géométrie de Map Display (`SquareGrid.distance`, coût octile) : orthogonale 1 case, diagonale 1,5 case, comme la règle de mesure et la zone de déplacement. `cells` peut donc valoir une demi-case (3 cases en diagonale = 4,5 cases = 9 m pour un tir, 4,5 m pour un sort). En hexagone, la distance hexagonale. Adjacence (`map.adjacency`, montures) : les 8 cases voisines, diagonales comprises.
- **Machine de jeu** : Map Display se joue côté MJ sur le Mac. L'outil MJ doit être ouvert **dans le même navigateur de la même machine**.
- **Interface d'import d'image** (lot 2) : emplacement dans l'éditeur de profil, et possibilité d'importer en masse pour le bestiaire.
