# Effets de blessure et de mort — provenance

Dix images carrées WebP, vues de dessus, pour `js/render/layers/fx.js` (contrat de liaison §9).

**Générées avec Magnific (modèle Nano Banana 2.1)** à la demande du mainteneur, le 04/11/2026, puis
recadrées à 512 × 512 et compressées en WebP (qualité 0,6, encodeur du navigateur) le 05/11/2026.
Sources PNG 1024 × 1024 : `tmp/effets-sang/` du dépôt de l'outil MJ (hors de ce dépôt). Aucune
attribution requise.

| Fichier | Usage | Fond | Fusion |
|---|---|---|---|
| `gerbe-1/2.webp` | gerbe de blessure, puis tache au sol ; décapitation et démembrement | blanc | `multiply` |
| `flaque-1/2.webp` | mort par le sang ; fin de décapitation et de démembrement | blanc | `multiply` |
| `feu-1/2.webp` | mort par le feu (cendres) | blanc | `multiply` |
| `poison-1/2.webp` | mort par le poison | blanc | `multiply` |
| `magie-1/2.webp` | mort par la magie (dissipation) | noir | `screen` |

Variante câblée par défaut : `-1` (`FX_VARIANT`). Le choix entre `-1` et `-2` appartient au MJ.

⚠ Décapitation et démembrement n'ont pas d'image propre : ils recomposent la grosse gerbe et la
flaque du sang. À remplacer si le MJ fait générer des images dédiées.
