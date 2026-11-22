# Pour le chantier outil MJ — ce que le tour de jeu de la carte attend de lui

> Écrit le 22/11/2026, après la livraison côté carte (`rpg-map-display`, commit `3256bd9`, en
> production). **Rien n'est cassé si l'outil MJ ne change pas** : il n'y a **aucune** modification
> du protocole, la version reste `MAP_LINK_VERSION = MJ_LINK_VERSION = 1`. Mais `mj.turn` vient de
> changer de poids, et une ligne de contrat doit être recopiée. Lire les trois sections dans
> l'ordre : **à faire**, **à savoir**, **à décider**.

---

## 1. À faire — une phrase à recopier

Dans **`Outil MJ Warhammer/docs/CONTRAT_LIAISON_MAP_DISPLAY.md`**, au **§10**, dernier paragraphe
(celui de `mj.turn`), la fin de phrase change :

- **avant** : « … une monture fusionnée (§8.1) se trouve par `rider.ref`. Le tour n'est ni persisté
  ni republié. »
- **après** : « … une monture fusionnée (§8.1) se trouve par `rider.ref`. Le tour n'est pas
  persisté, **republié vers la tablette** (`turn.select`, révision du 22/11/2026). »

C'est tout. `turn.select` est un événement **interne à Map Display** (poste MJ → tablette, par
RTDB), pas un message du canal `wfrp-map-link` : l'outil MJ ne l'émet ni ne le reçoit jamais. La
phrase est amendée parce qu'elle promettait l'inverse, et que les deux copies du contrat doivent
rester identiques — c'est la règle de son en-tête.

La révision est déjà écrite dans la copie de `rpg-map-display`. Aucun code de l'outil MJ n'est
touché, et la version du protocole **ne bouge pas** (même profil que les révisions des 08/11,
11/11, 13/11, 16/11 et 21/11).

---

## 2. À savoir — `mj.turn` n'est plus décoratif

Jusqu'au 21/11, `mj.turn { ref }` ne servait qu'à **cerner d'un halo** le pion du participant actif
**sur l'écran MJ**. Depuis le 22/11, il **commande la tablette** :

| Ce que l'outil MJ envoie | Ce que la table peut faire |
|---|---|
| `mj.turn { ref: "pj:untel" }` | **Seul ce PJ** se sélectionne et se déplace. Les autres PJ liés s'ouvrent en consultation lecture seule ; leurs boutons d'ouverture de porte s'affichent **grisés** et sans effet. |
| `mj.turn { ref: "<un ennemi>" }` | **Aucun PJ ne bouge** : c'est le tour de quelqu'un d'autre. |
| `mj.turn { ref: null }` | **Tout redevient libre** : tous les PJ déplaçables bougent, comme sans outil MJ. |
| plus rien pendant 15 s (`delaiDeconnexionMs`) | La liaison passe à « déconnectée », la carte **oublie le tour** et la table retrouve sa liberté entière. |

Trois conséquences pratiques :

1. **Envoyer le tour à chaque changement, et toujours dans l'instantané**, comme le §10 le demande
   déjà. Un `ref` périmé ne gêne plus seulement l'œil du MJ : il désigne le seul PJ que la table
   peut jouer.
2. **Envoyer `mj.turn { ref: null }` à la fin d'un combat.** Sans ça, le dernier participant reste
   le seul à pouvoir bouger jusqu'à ce que la liaison tombe. Ce n'est pas bloquant — le MJ ferme
   l'outil et tout se libère — mais c'est une minute perdue à la table.
3. **Un outil MJ qui plante ne gèle pas la partie.** Le battement est de 5 s, la péremption de
   15 s : passé ce délai la carte libère la table d'elle-même. C'est voulu, et c'est le garde-fou
   qui rend le bridage acceptable.

### Ce que la carte compte toute seule, et que l'outil MJ n'a pas à tenir

La carte mémorise, **pour la durée du tour**, le nombre de cases que le pion actif a déjà
parcourues, afin qu'un mouvement interrompu — typiquement pour ouvrir une porte — reprenne avec le
reste du droit de déplacement et pas avec le budget entier. Ce compteur :

- vit **dans Map Display**, pas dans l'outil MJ, et n'est **jamais persisté** ;
- repart de zéro **à chaque changement** de `ref`. Réannoncer **le même** `ref` — un instantané de
  reconnexion, par exemple — ne le remet **pas** à zéro : l'outil MJ peut renvoyer son instantané
  autant de fois qu'il veut sans rendre du mouvement au joueur ;
- ne compte que les **trajets marchés** (validés depuis une préparation, sur la tablette comme sur
  l'écran MJ). Le **glisser libre du MJ** sur la carte ne consomme rien : c'est resté l'outil de
  correction et de mise en place.

### `map.ran` peut arriver sur la seconde moitié d'un déplacement

`map.ran { ref }` part quand un trajet dépasse la **Marche restante**, et non plus la Marche
entière. Un PJ de Marche 4 qui avance de 2 cases, ouvre une porte, puis repart de 3 cases reçoit
donc son `map.ran` au **second** déplacement — le cumul, 5, dépasse 4. Côté outil MJ, « l'Action du
Tour est utilisée » doit donc rester **idempotent** : un second `map.ran` dans le même tour ne doit
pas coûter une seconde Action.

---

## 3. À décider — deux trous connus, aucun comblé

Les deux ont été arbitrés le 22/11/2026 **en l'état**, c'est-à-dire sans toucher au protocole. Les
rouvrir demande un amendement du contrat **dans les deux dépôts** et une **incrémentation de la
version** (§2.3 : les deux outils la vérifient à la connexion).

### 3.1 `ref: null` dit deux choses à la fois

Le §10 fait porter à `null` deux sens différents : « aucun tour en cours » et « le participant
actif n'est pas dans la scène ». La carte a dû choisir, et elle a choisi **la liberté** : `null`
rend la table libre. C'est le bon défaut, parce que l'exploration se joue souvent avec l'outil MJ
ouvert et qu'un `null` bloquant figerait la table pour rien.

Le trou résiduel, assumé : pendant le tour d'un **ennemi non posé sur la carte**, les PJ peuvent
bouger. Étroit, et le MJ le voit.

> **Si on veut le fermer**, c'est un champ de plus sur `mj.turn` — par exemple
> `{ ref: null, inCombat: true }`, ou un numéro de round — qui distingue « pas de combat » de
> « tour de quelqu'un hors scène ». Compatible en lecture (une carte qui l'ignore se comporte comme
> aujourd'hui), mais c'est un **changement de protocole** : les deux copies du contrat et la
> version. **Non fait.**

### 3.2 L'annulation du mouvement ne remonte pas à l'outil MJ

La tablette porte désormais un bouton qui **annule le mouvement du tour** : le pion revient à sa
case et à son étage de début de tour, et son déplacement lui est intégralement rendu.

Cette annulation **ne traverse pas** le canal `wfrp-map-link`. Donc si le PJ avait **couru** avant
d'annuler — `map.ran` déjà parti — **l'Action du Tour reste cochée dans l'outil MJ**, et le MJ la
rend à la main.

> **Si on veut l'automatiser**, il faut un message de la carte vers l'outil MJ, par exemple
> `map.turnReset { ref }` au §10, émis à chaque annulation, que l'outil MJ traduirait par « rendre
> l'Action du Tour et remettre le mouvement à zéro ». Là encore : les deux copies, et la version.
> **Non fait**, et c'est la décision la plus probable à prendre si la table trouve le rattrapage
> manuel pénible.

---

## 4. Recette à faire ensemble

La vue tablette seule est éprouvée. **La liaison avec l'outil MJ ne l'est pas encore.** À jouer sur
une vraie session, outil MJ connecté :

1. Donner le tour à un PJ : lui seul se sélectionne et se déplace sur la tablette ; toucher un
   autre PJ ouvre un encart en lecture seule, sans rien publier.
2. Avancer de deux cases, ouvrir une porte par son bouton, repartir : la zone disponible doit
   valoir le **reste** du mouvement, pas le budget entier, et le palier de Course doit avoir reculé
   d'autant.
3. Vérifier qu'un PJ **non lié** à l'outil MJ n'est jamais bridé par le tour.
4. Passer le tour à un ennemi : plus aucun PJ ne bouge, et les boutons de porte des PJ sont grisés.
5. Annuler le mouvement du tour : le pion revient à sa case de départ sur **les deux écrans**, le
   brouillard déjà exploré **ne régresse pas**, et une porte ouverte en route **reste ouverte**.
6. Fermer l'outil MJ : au bout de 15 s, la table retrouve sa liberté entière.
7. Recharger la tablette (F5) **en cours de tour** : elle doit retrouver le tour et le mouvement
   déjà consommé — le poste MJ les lui republie sur sa demande de vision.
