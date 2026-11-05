# Effets de blessure et de mort — provenance

Sept images carrées WebP, vues de dessus, pour `js/render/layers/fx.js` (contrat de liaison §9).

**Générées avec Magnific (modèle Nano Banana 2.1)** à la demande du mainteneur : les six premières le
04/11/2026, les flammes le 05/11/2026. Recadrées à 512 × 512 et compressées en WebP (qualité 0,6,
encodeur du navigateur) le 05/11/2026. Sources PNG 1024 × 1024 : `tmp/effets-sang/` du dépôt de
l'outil MJ (hors de ce dépôt). Aucune attribution requise.

Variantes retenues par le MJ le 05/11/2026 : gerbe 2, flaque 1, poison 2, magie 1, feu 1 (brûlure).

| Fichier | Usage | Fond | Fusion |
|---|---|---|---|
| `gerbe.webp` | gerbe de blessure, puis tache au sol ; décapitation et démembrement | blanc | `multiply` |
| `flaque.webp` | mort par le sang ; fin de décapitation et de démembrement | blanc | `multiply` |
| `feu.webp` | mort par le feu : brûlure au sol | blanc | `multiply` |
| `flammes-1/2.webp` | mort par le feu : flammes vues de dessus, vacillantes | noir | `screen` |
| `poison.webp` | mort par le poison | blanc | `multiply` |
| `magie.webp` | mort par la magie (dissipation) | noir | `screen` |

⚠ Décapitation et démembrement n'ont pas d'image propre : ils recomposent la grosse gerbe et la
flaque du sang. À remplacer si le MJ fait générer des images dédiées.
