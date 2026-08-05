# Icônes d'états — provenance et attribution

Les quatorze icônes de ce dossier viennent de **[game-icons.net](https://game-icons.net)**,
sous licence **[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)**.

> Icônes par Carl Olsen, Delapouite, Lorc, Sbed, Skoll — game-icons.net — CC BY 3.0

Treize sur quatorze sont attribuables à un auteur nommé ; la quatorzième (`surprised`) vient
du dossier `badges/` du dépôt, couvert par la même licence mais sans auteur individuel.

**L'attribution est due à la diffusion, pas à l'usage privé.** L'application n'est pas
destinée à être diffusée — décision du mainteneur, 04/08/2026 — et cette ligne suffit donc
tant qu'elle reste sur la table de jeu. **Si elle vient à être publiée**, sous quelque forme
que ce soit, il faudra alors la faire apparaître dans l'application elle-même, ce qui
suppose un écran « à propos » que rien ne prévoit aujourd'hui : ni le cahier des charges, ni
le manifeste, ni aucun lot. C'est une dette conditionnelle, consignée ici pour qu'elle ne se
découvre pas le jour de la mise en ligne.

Elle ne justifie pas d'ajouter un écran maintenant : l'interdiction n°2 ferme la vue joueurs,
et la vue MJ n'a pas à porter une mention pour un événement qui n'est pas prévu.

## Table

Le nom de fichier **est** l'identifiant attendu dans `token.markers`. Le jeu de valeurs est
clos : quatorze, et le schéma doit rejeter tout le reste (CdC Q7, tranchée le 04/08/2026).

Les dessins ont été revus le 05/08/2026 : **six cases sur quatorze ont changé de tracé** (★),
cinq sur l'avis de l'illustratrice consultée et la sixième (`bleeding`) après une seconde
recherche. Le vocabulaire, lui, n'a pas bougé d'un identifiant — c'est bien le propre d'une
liste close.

| id (`token.markers`) | Libellé | Source | Auteur |
|---|---|---|---|
| `prone` | À terre | [`sbed/falling`](https://game-icons.net/1x1/sbed/falling.html) | Sbed |
| `deafened` | Assourdi | [`skoll/hearing-disabled`](https://game-icons.net/1x1/skoll/hearing-disabled.html) | Skoll |
| `blinded` | Aveuglé | [`skoll/sight-disabled`](https://game-icons.net/1x1/skoll/sight-disabled.html) | Skoll |
| `broken` ★ | Brisé | [`delapouite/shattered-heart`](https://game-icons.net/1x1/delapouite/shattered-heart.html) | Delapouite |
| `entangled` | Empêtré | [`lorc/spider-web`](https://game-icons.net/1x1/lorc/spider-web.html) | Lorc |
| `poisoned` | Empoisonné | [`lorc/poison-bottle`](https://game-icons.net/1x1/lorc/poison-bottle.html) | Lorc |
| `ablaze` | En flammes | [`carl-olsen/flame`](https://game-icons.net/1x1/carl-olsen/flame.html) | Carl Olsen |
| `bleeding` ★ | Hémorragique | [`sbed/water-drop`](https://game-icons.net/1x1/sbed/water-drop.html) | Sbed |
| `unconscious` | Inconscient | [`delapouite/night-sleep`](https://game-icons.net/1x1/delapouite/night-sleep.html) | Delapouite |
| `stunned` ★ | Sonné | [`lorc/star-swirl`](https://game-icons.net/1x1/lorc/star-swirl.html) | Lorc |
| `surprised` ★ | Surpris | [`badges/exclamation`](https://github.com/game-icons/icons/blob/master/badges/exclamation.svg) | game-icons.net |
| `frenzy` | Frénésie | [`lorc/crossed-axes`](https://game-icons.net/1x1/lorc/crossed-axes.html) | Lorc |
| `fear` ★ | Peur | [`lorc/terror`](https://game-icons.net/1x1/lorc/terror.html) | Lorc |
| `terror` ★ | Terreur | [`skoll/burning-skull`](https://game-icons.net/1x1/skoll/burning-skull.html) | Skoll |

Trois lignes de cette table demandent une explication, sans quoi elles se liront comme des
erreurs :

- **`fear` est dessiné par `lorc/terror`, et `terror` par un crâne.** Ce n'est pas une
  permutation accidentelle : le tracé nommé « terror » chez Lorc est un visage hurlant, ce qui
  dit la peur ; la terreur, plus intense, passe au crâne enflammé. **Le nom de l'icône source
  ne dit rien de l'état auquel elle sert** — seul le nom de fichier le fait.
- **`surprised` ne vient pas du catalogue mais du dossier `badges/` du dépôt**, qui contient
  les pastilles du site lui-même. Elle n'a donc pas de page sur game-icons.net et **aucun
  auteur nommé** ; la licence du dépôt (CC BY) la couvre comme le reste, mais l'attribution ne
  peut citer personne. Sa forme d'origine est aussi la seule à contredire la normalisation
  ci-dessous — voir les deux exceptions.
- **`bleeding` est une goutte d'eau, et c'est assumé.** `lorc/bleeding-wound`, retenue le
  04/08, a été écartée par le mainteneur puis par la mesure : rastérisée à 14 px, elle était la
  **moins encrée des quatorze** (15 % d'opacité moyenne sur le disque du badge, contre 34 % de
  médiane) et se diluait là où toutes les autres tenaient. Quarante et une candidates ont été
  passées en revue aux tailles réelles du badge. La retenue est la plus lisible à 14 px, et son
  nom d'origine ne doit pas tromper : **c'est la couleur du badge qui dira le sang, la forme ne
  dit que la goutte.** Trois familles entières ont été écartées, et pour des raisons qui
  resserviront si la case se rouvre :
  - les **lacérations** (`quick-slash`, `crossed-slashes`, `saber-slash`, `tearing`…) sont
    dessinées **en négatif** — le blanc n'est qu'un mince éclat, le disque reste noir. À 14 px
    elles donnent toutes le même badge et deviennent indiscernables entre elles ;
    `quick-slash` retombe même à 15 %, le score exact de l'icône écartée ;
  - les **corps blessés** (`pierced-body`, `pummeled`…) se réduisent à une silhouette claire,
    or `prone` et `unconscious` en sont déjà deux ;
  - les **cœurs** (`heart-drop`, `bleeding-heart`, `pierced-heart`, `life-tap`), pourtant
    lisibles, **entrent en collision avec `broken`** depuis que celui-ci est un cœur en éclats.
    Deux catégories différentes ne doivent pas se ressembler à 14 px : c'est précisément ce que
    les paliers cherchent à éviter.

## Installation

```sh
node scripts/install-status-icons.mjs              # les quatorze
node scripts/install-status-icons.mjs broken fear  # seulement celles-là
```

La table du script fait autorité sur les sources ; celle ci-dessus la recopie pour être
lisible sans ouvrir le code. Un test du dépôt vérifie que les deux listes ne divergent pas
(`tests/statusBadges.test.mjs`, cas 7).

**Pour remplacer une icône, changer la source dans le script et le relancer — ne pas éditer
un SVG à la main.** Le script applique les normalisations ci-dessous *et les re-vérifie sur
son propre résultat* ; il échoue plutôt que d'écrire un fichier douteux. Relancé sur une
icône inchangée, il réécrit le fichier **au bit près** : c'est ce qui permet de le croire.

## Normalisation appliquée aux fichiers d'origine

Les SVG de game-icons sont livrés en blanc sur fond noir. Quatre corrections, aucune
cosmétique :

1. **Fond noir retiré** — `<path d="M0 0h512v512H0z"/>` est un carré noir pleine page.
   Conservé, il masquerait le pion sous le badge.
2. **`width`/`height` ajoutés** — le `viewBox` seul suffit en CSS, mais un SVG sans dimension
   intrinsèque ne se dessine pas de façon fiable via `drawImage` sur un canvas. Le rendu du
   projet est Canvas 2D natif : l'omission serait un piège.
3. **Contours sans `fill` passés en `fill="none"`** — `fill` absent ne veut pas dire « pas de
   remplissage », il vaut **noir**. Un anneau écrit `<circle stroke="#fff" …/>` contient bien
   la chaîne `#fff` et se dessinerait pourtant en disque noir opaque. Chercher `#fff` ne
   suffit donc pas à conclure, et c'est exactement le contrôle que le script fait.
4. **Aucune couleur sombre résiduelle, et au moins une claire** — chaque forme doit peindre en
   `#fff` explicitement, ou ne rien remplir. Vérifié forme par forme, pas au grep.

### Les deux exceptions de `surprised.svg`

Elles ne sont pas des tolérances : le script les traite nommément, et échouerait sur une
troisième forme de fond qu'il ne connaîtrait pas.

- **Son fond n'est pas un carré mais un disque** (`<circle cx="128" cy="128" r="128"/>`), et il
  reste un fond : retiré comme les autres. C'est le sens de la consigne « sans fond noir, donc
  en inversé » — le glyphe passe en clair sur transparent, comme les treize autres, et c'est le
  badge de l'application qui fournit le disque sombre.
- **Elle porte deux références à `#fff`** (`stroke` de l'anneau, `fill` du point
  d'exclamation) quand les treize autres n'en ont qu'une. Conséquence concrète : **une
  éventuelle recoloration au rendu doit être un remplacement global, pas une substitution
  unique.** L'ancienne rédaction de ce fichier promettait l'inverse ; elle ne vaut plus.

Accessoirement sa `viewBox` fait 256 et non 512. Sans effet : le rendu passe la taille de
destination à `drawImage` et ne lit pas la boîte.

## Réserve ouverte — lisibilité au plus petit palier

Les quatorze en service tiennent désormais entre **26 %** (`poisoned`) et **44 %** d'encre à
14 px, médiane **34 %**. Les deux extrêmes hauts sont `broken` et `bleeding`, à 44 % chacun, et
**c'est ce qui montre que l'encre seule ne décide de rien** : `bleeding` est une forme unique et
pleine, la plus lisible des quatorze, tandis que `broken` est un cœur **en éclats**. À poids
d'encre égal, c'est la fragmentation qui fait la tache, pas la quantité.

Donc, dans l'ordre à vérifier à l'œil sur la Tab S9 FE — et à l'œil, pas au chiffre :
`broken` (fragmenté et le plus encré), puis `entangled` (`lorc/spider-web`, une toile, et de
loin le tracé le plus chargé en octets : 4,4 ko contre 0,2 ko pour `bleeding`), puis `frenzy`
(deux haches croisées, donc des tiges fines).
