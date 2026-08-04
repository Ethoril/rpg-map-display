# Icônes d'états — provenance et attribution

Les quatorze icônes de ce dossier viennent de **[game-icons.net](https://game-icons.net)**,
sous licence **[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)**.

> Icônes par Carl Olsen, Delapouite, Lorc, Sbed, Skoll — game-icons.net — CC BY 3.0

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

| id (`token.markers`) | Libellé | Source | Auteur |
|---|---|---|---|
| `prone` | À terre | [`sbed/falling`](https://game-icons.net/1x1/sbed/falling.html) | Sbed |
| `deafened` | Assourdi | [`skoll/hearing-disabled`](https://game-icons.net/1x1/skoll/hearing-disabled.html) | Skoll |
| `blinded` | Aveuglé | [`skoll/sight-disabled`](https://game-icons.net/1x1/skoll/sight-disabled.html) | Skoll |
| `broken` | Brisé | [`lorc/despair`](https://game-icons.net/1x1/lorc/despair.html) | Lorc |
| `entangled` | Empêtré | [`lorc/spider-web`](https://game-icons.net/1x1/lorc/spider-web.html) | Lorc |
| `poisoned` | Empoisonné | [`lorc/poison-bottle`](https://game-icons.net/1x1/lorc/poison-bottle.html) | Lorc |
| `ablaze` | En flammes | [`carl-olsen/flame`](https://game-icons.net/1x1/carl-olsen/flame.html) | Carl Olsen |
| `bleeding` | Hémorragique | [`lorc/bleeding-wound`](https://game-icons.net/1x1/lorc/bleeding-wound.html) | Lorc |
| `unconscious` | Inconscient | [`delapouite/night-sleep`](https://game-icons.net/1x1/delapouite/night-sleep.html) | Delapouite |
| `stunned` | Sonné | [`delapouite/knocked-out-stars`](https://game-icons.net/1x1/delapouite/knocked-out-stars.html) | Delapouite |
| `surprised` | Surpris | [`lorc/hazard-sign`](https://game-icons.net/1x1/lorc/hazard-sign.html) | Lorc |
| `frenzy` | Frénésie | [`lorc/crossed-axes`](https://game-icons.net/1x1/lorc/crossed-axes.html) | Lorc |
| `fear` | Peur | [`lorc/screaming`](https://game-icons.net/1x1/lorc/screaming.html) | Lorc |
| `terror` | Terreur | [`lorc/terror`](https://game-icons.net/1x1/lorc/terror.html) | Lorc |

## Normalisation appliquée aux fichiers d'origine

Les SVG de game-icons sont livrés en blanc sur fond noir. Trois corrections, aucune
cosmétique :

1. **Rect de fond retiré** — `<path d="M0 0h512v512H0z"/>` est un carré noir pleine page.
   Conservé, il masquerait le pion sous le badge.
2. **`width="512" height="512"` ajoutés** — le `viewBox` seul suffit en CSS, mais un SVG
   sans dimension intrinsèque ne se dessine pas de façon fiable via `drawImage` sur un
   canvas. Le rendu du projet est Canvas 2D natif : l'omission serait un piège.
3. **`fill="#fff"` conservé, et unique** — vérifié fichier par fichier avant écriture. La
   recoloration au rendu est donc une substitution de chaîne unique, sans parsing XML.

Le script d'installation refait ces trois vérifications et échoue plutôt que d'écrire un
fichier douteux. Pour remplacer une icône, reprendre le fichier d'origine et repasser par
lui — ne pas éditer à la main.

## Réserve ouverte

`entangled` (`lorc/spider-web`) est de loin le tracé le plus chargé des quatorze : 4,4 ko
contre 0,6 ko pour `unconscious`. Sa lisibilité au plus petit palier d'affichage est le
point à surveiller en premier sur la Tab S9 FE.
