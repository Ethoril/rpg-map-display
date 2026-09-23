# ADR-012 — persistance Firestore multi-étages v3

**Décision : adopter le schéma v3 réparti avant de livrer une campagne réelle à trois étages.**
Le lecteur v2 et le garde-fou du document unique restent en place pendant la migration ; il ne faut
pas écrire une v3 partielle dans cette tranche.

## Mesure qui motive la décision

La commande `node scripts/measure-firestore-snapshots.mjs` — retirée le 23/09/2026 (D-7), l'historique
git la garde — mesurait le snapshot après
l'encodage des murs exigé par Firestore. Elle produit les valeurs suivantes le 07/08/2026 :

| Jeu de données | JSON UTF-8 encodé | Taille Firestore documentée | Estimation prudente appliquée |
|---|---:|---:|---:|
| `testbig150` | 164 960 octets | 273 518 octets | 302 918 octets |
| `testbig150` répété sur 3 étages | 494 492 octets | 819 990 octets | 904 038 octets |

La taille Firestore documentée additionne nom de document, noms de champs, valeurs et surcoût de
map ; la documentation fixe bien la limite à 1 048 576 octets. L'application retient une marge de
10 % + 2 Kio et refuse dès 900 Kio. Les caractères UTF-8 et la forme effectivement envoyée au SDK
sont mesurés, plutôt qu'une longueur JavaScript ou un poids du fichier source.

Trois étages denses atteignent 98,1 % du plafond applicatif (86,2 % de la limite Firestore brute).
Ajouter du fog, des pions à image embarquée ou un quatrième étage rendrait le document unique trop
fragile : v3 est donc décidée, non optionnelle.

Sources de calcul : [taille des documents Firestore](https://firebase.google.com/docs/firestore/storage-size)
et [quota de 1 Mio](https://firebase.google.com/docs/firestore/quotas?hl=en).

## Schéma v3 ciblé

```text
campaigns/{sessionId}                         métadonnées légères, schemaVersion: 3,
                                               revision, levelIds, activeLevelId,
                                               selectedTokenId, activeHandout
campaigns/{sessionId}/levels/{levelId}        un étage complet (walls déjà encodés,
                                               grid, fog, portals, lights, etc.)
campaigns/{sessionId}/tokens/{tokenId}        un pion, y compris une image embarquée bornée
campaigns/{sessionId}/state/current           templates et autres état global mutable
```

Les sous-collections ne comptent pas dans la limite de 1 Mio de leur parent. Tous les documents
v3 gardent la même règle d'accès que `campaigns/{sessionId}` : les règles devront donc être étendues
aux sous-chemins au moment de l'implémentation v3.

> **Amendement du 23/09/2026 (audit C7, arbitrage D-10) — seuls les documents modifiés sont
> réécrits.** Chaque sauvegarde réécrivait le parent, l'état global, CHAQUE étage et CHAQUE pion :
> un déplacement coûtait `2 + étages + pions` écritures, environ 40 sur une campagne ordinaire.
> Le parent porte désormais quatre tables : `levelDigests` et `tokenDigests` (empreinte du
> contenu de chaque document), `levelRevisions` et `tokenRevisions` (révision à laquelle chacun
> a été écrit). Un document dont l'empreinte n'a pas changé n'est pas réécrit et garde sa
> révision. Le lecteur exige de chaque document la révision que le parent annonce POUR LUI, et la
> garde d'incohérence reste donc entière : un document d'une autre révision est toujours refusé.
> Un parent antérieur, sans ces tables, se lit comme avant (tout porte sa révision) et fait tout
> réécrire une fois. Logique pure : `planFirestoreV3Write` (`js/transport/FirebaseTransport.js`).

## Chemin de migration précis

1. Lire v2 comme aujourd'hui et reconstituer le modèle en mémoire ; détecter v3 par
   `schemaVersion === 3` et charger ses sous-documents.
2. Pré-voler chaque document v3 avec le même mesureur et refuser toute partie au-dessus de 900 Kio.
3. Écrire `levels/*`, `tokens/*`, `state/current` et le parent v3 dans un `writeBatch`; le parent
   contient une `revision` nouvelle et n'est visible qu'au commit atomique. Limiter un lot à 500
   écritures ; au-delà, faire des lots de données puis basculer le parent dans un dernier lot avec
   un marqueur de migration reprenable.
4. Après relecture complète de la révision v3, supprimer les gros champs v2 du parent. Conserver
   la lecture v2 au moins une version applicative, sans jamais réécrire le document v2 averti ou
   refusé.

## Conséquence immédiate

La v2 n'échoue plus silencieusement : `saveSnapshot` refuse avant `setDoc` au-dessus de 900 Kio et
le badge réseau avertit dès 750 Kio. Cette protection ferme R1-04 ; l'implémentation v3 elle-même
reste une dépendance explicite de R3-02.
