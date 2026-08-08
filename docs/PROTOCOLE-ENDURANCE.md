# Protocole R2 — décodage froid, cast et endurance

> ⚠ **Ce document dit la méthode et ses limites, plus l'ordre.** Depuis le 8 août 2026, l'ordre
> exécutable d'une séance vit dans `SEANCE-TABLETTE.md`, qui intègre ces trois mesures parmi les
> sept que la même séance peut fermer. Les faire isolément coûterait trois soirées au lieu d'une :
> R2-06 contient R2-05, qui contient le silence de R2-03. Venir ici pour comprendre **pourquoi** une
> mesure est faite ainsi et ce qu'elle ne prouve pas ; aller là-bas pour l'exécuter.

Ce protocole ferme les observations physiques de R2-03, R2-05 et R2-06. Il se réalise sur la
tablette joueuse Samsung Galaxy Tab S9 FE, branchée, avec la version et la carte notées dans le
rapport. Il ne remplace aucun test automatisé : il mesure précisément ce que le navigateur de
bureau ne peut pas connaître.

## R2-03 — premier décodage après deux minutes

1. Ouvrir `diag.html` sur la tablette, sans cast.
2. Entrer l’URL locale de l’image de référence, puis choisir « Armer décodage froid ».
   L’outil effectue une chauffe initiale ; cette étape est volontaire.
3. Ne plus toucher l’écran ni le navigateur pendant **au moins 120 s**. Ne pas ouvrir le panneau
   de la sonde de rendu et ne pas lancer de mesure FPS. L’outil ne lance ni timer, ni rAF, ni
   rafraîchissement DOM pendant ce silence.
4. Presser « Mesurer après inactivité » et reporter l’inactivité constatée et la durée de
   `Image.decode()`.
5. Refaire le scénario sur la vraie vue joueurs et décrire la première image visible. La durée
   `Image.decode()` n’est pas à elle seule le temps de cette frame.

Le navigateur ne fournit pas d’API disant qu’il a évincé le bitmap/décodeur. Un résultat bas ne
prouve donc pas que l’image est restée chaude, et un résultat haut ne dit pas quelle ressource a
été évincée. C’est une mesure post-inactivité reproductible, pas une télémétrie mémoire magique.

## R2-05 — essai cast de 45 minutes

Préconditions : tablette branchée, Google Cast actif vers la TV, carte et session représentatives,
plein écran demandé. Le mirroring reste le produit testé ; ne pas substituer une vidéo locale.

1. Démarrer le journal R2 dans `diag.html`, puis noter un relevé à 0 min.
2. Jouer et déplacer de vrais pions pendant 45 min. À 15, 30 et 45 min, relever les FPS avec le
   bouton 3 (20 s) si cela ne perturbe pas la séance, puis saisir le résultat manuellement.
3. À chaque relevé, noter au toucher la température et l’état réellement observé du cast, du plein
   écran et du Wake Lock. À 45 min, faire sortir/revenir la tablette ou attendre une reprise réelle
   si le système la provoque, puis constater que la vision et la diffusion reviennent.
4. Ne pas déclarer la température, la qualité Cast ou le Wake Lock « mesurés par le navigateur » :
   aucune API Web disponible ne les expose de façon fiable dans cette configuration.

Critère à consigner : pas de chute bloquante sous 30 fps pendant le mouvement, pas de coupure cast,
écran allumé, plein écran récupérable et reprise utilisable. Un doute reste un doute ; le noter.

## R2-06 — session longue de quatre heures

Reprendre le même protocole et la même charge à 60, 120, 180 et 240 min. Ne pas faire tourner la
sonde de façon continue : elle ne doit ni maintenir la page active ni masquer un éventuel bridage.
Le rapport comporte au moins un relevé à 45 min et 4 h, avec les conditions d’alimentation, réseau,
carte, cast et événements de veille/reprise.

Un essai interrompu n’est pas un succès ni un échec technique : l’indiquer comme incomplet, avec
l’heure et la cause. Seule une séance complète peut conclure sur l’endurance thermique.
