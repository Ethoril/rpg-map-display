# Rapport remplissable — séance tablette

> Ne remplir une ligne que sur l’appareil réel. Les températures, le mirroring Cast et l’état
> effectif d’un Wake Lock sont des observations manuelles, jamais des valeurs automatiques.
>
> Ordre d’exécution : `SEANCE-TABLETTE.md`. Méthode et limites de R2-03/05/06 :
> `PROTOCOLE-ENDURANCE.md`. **Étendu le 8 août 2026** à R3-05 et R1-01, que la même séance ferme.

## Contexte

- Date / version / commit :
- Tablette, version Android et Chrome :
- Alimentation (chargeur, puissance connue) :
- Réseau et récepteur Google Cast :
- Carte, nombre de pions et charge représentative :
- Plein écran demandé : oui / non ; Wake Lock observé au départ : oui / non / inconnu.

## R2-03 — décodage après inactivité

- URL image :
- Inactivité réellement constatée (≥ 120 s) :
- `Image.decode()` post-inactivité :
- Première frame réelle de la vue joueurs (durée/perception) :
- Limite : cette mesure ne prouve pas l’éviction ou la conservation du bitmap par le navigateur.

## R2-05/R2-06 — journal manuel

| Minute | FPS (20 s si relevé) | Température au toucher | Cast TV | Wake Lock/écran | Plein écran | Veille/reprise | Notes |
|---:|---:|---|---|---|---|---|---|
| 0 | | | | | | | |
| 15 | | | | | | | |
| 30 | | | | | | | |
| 45 | | | | | | | |
| 60 | | | | | | | |
| 120 | | | | | | | |
| 180 | | | | | | | |
| 240 | | | | | | | |

## Lot 1a — limite de texture réelle (phase 3)

- Largeur du viewport CSS / `devicePixelRatio` :
- Limite de texture rapportée (attendu 8192, sans marge) :
- `testbig150` s’affiche entièrement : oui / non — si non, redescendre `MAX_PREPARED_TEXTURE_PX`.
- FPS sur `testbig150` / FPS de référence carte légère :

## R3-05 — coût d’une mutation lumineuse (phase 6)

⚠ La vue joueurs ne calcule aucune vision : elle décode un masque publié. Le sweep se paie sur la
machine qui porte la vue MJ, et c’est là qu’il se mesure.

- Machine portant la vue MJ pendant la mesure :
- Colonne **Vision**, déplacement d’un pion **sans** `emitsLight` :
- Colonne **Vision**, déplacement du pion **lumineux** :
- Écart, soit le coût propre de la lumière (bureau indicatif : 28 à 49 ms, 17 polygones) :
- Tablette — colonnes **Fond / Fog / Pions** au même geste :
- Mise à jour perçue sans délai de bout en bout : oui / non / doute —

## R1-01 — rétention sur deux vrais clients (phase 8)

- `retentionClients` : nombre d’entrées (attendu 2) :
- `presence` : nombre d’entrées (attendu 2) :
- Enfants de `events` avant / après plus de 32 événements et 30 s d’attente :
- ⭐ Client mis en veille moins de 120 s : les événements **non lus** ont-ils été préservés ?
- Au réveil, la tablette rattrape sans trou : oui / non —

## Verdict humain

- R2-03 (décodage froid, critère `< 5 ms`) : concluant / non concluant / incomplet — raison :
- R2-05 (45 min) : concluant / non concluant / incomplet — raison :
- R2-06 (4 h) : concluant / non concluant / incomplet — raison :
- R3-05 (lumière) : concluant / non concluant / incomplet — raison :
- R1-01 (rétention) : concluant / non concluant / incomplet — raison :
- Anomalies et action suivante :
