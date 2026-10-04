# Cahier des charges des améliorations après session

Date : 4 octobre 2026. Statut : choix fonctionnels confirmés par le mainteneur, avant implémentation.

Ce complément décrit quatre améliorations demandées après une partie : déplacer les gabarits de façon fiable côté MJ, permettre aux joueurs de pinguer, renforcer la visibilité des cases accessibles en projection et préparer un déplacement avant de le valider. Les règles et possibilités de mouvement existantes sont conservées ; leur utilisation dans l’interface change.

Le document complète le [cahier des charges principal](CAHIER-DES-CHARGES.md). Le nouveau parcours de déplacement remplace sa validation immédiate par tap sur une destination. L’émission de pings par les joueurs remplace la restriction au MJ décrite dans le [chantier ping](CHANTIER-X-PING.md). Ces amendements seront reportés dans les documents de référence lors de l’implémentation.

## 1. Périmètre et choix confirmés

Les quatre améliorations ci-dessous et les choix suivants ont été confirmés par le mainteneur :

- Le nouveau parcours s’applique au déplacement par clic ou tap des personnages côté joueurs et côté MJ. Le déplacement libre par glisser du MJ est conservé.
- Chaque nouvelle case choisie prolonge le trajet depuis la dernière arrivée préparée. Elle devient la nouvelle arrivée à recliquer pour valider tout le trajet.
- Le chemin préparé est visible sur tous les postes affichant le même étage, y compris le MJ, avant validation. La position réelle du personnage reste inchangée.
- Après validation, le personnage est désélectionné. La portée d’une nouvelle préparation suit les règles actuelles : ce chantier ne crée ni compteur de tour ni nouvelle consommation persistante de mouvement.
- Sélectionner un autre personnage annule la préparation précédente. Une préparation devenue invalide après un changement de porte, d’obstacle ou de capacité est annulée avec une explication.
- Les cases accessibles ont un remplissage renforcé et un contour opaque par case. Le rendu est fixe, ajusté après essai au vidéoprojecteur.
- Le MJ peut sélectionner un gabarit dans sa liste pour afficher une poignée permettant de le déplacer.
- Un petit nombre près de l’arrivée préparée affiche la capacité restante.
- Avec un trajet préparé, un tap sur le fond hors de la zone accessible annule le trajet en gardant le personnage sélectionné. Un second clic au même endroit désélectionne. Sans trajet préparé, un tap hors zone désélectionne directement et rend le ping disponible.

**Choix confirmé pour le ping :** double tap à un doigt quand aucun personnage n’est sélectionné, partout sur la carte, y compris sur un pion ou une porte. L’action du tap simple attend la distinction entre tap et double tap. Avec un personnage sélectionné, le déplacement est prioritaire ; les taps restent dédiés à sa préparation, sa validation, son annulation et à la désélection dans le cas défini ci-dessus.

## 2. Déplacement des gabarits par le MJ

### Constat et objectif

Le code comporte déjà un glisser de gabarit, un aperçu local et une publication de la pose finale. Son déclenchement exige qu’aucun outil MJ ne soit armé. Un cercle se déplace par son corps ; les cônes et les lignes se déplacent par leur poignée d’origine, tandis que leur corps sert à la rotation.

Ces constats proviennent de la lecture de `js/app/gm.js` et `js/input/templateHit.js`. Ils ne prouvent pas le bon fonctionnement sur le matériel utilisé en session. Le problème à résoudre comprend donc la fiabilité du geste et la compréhension de sa zone de prise, sans présumer sa cause.

### Comportement attendu

1. Le MJ peut reprendre et déplacer un gabarit existant sans le supprimer ni le recréer.
2. La zone permettant sa translation est identifiable. Pour les cônes et les lignes, la poignée d’origine se distingue de la zone de rotation et reste utilisable aux niveaux de zoom habituels.
3. Pendant le glisser, un aperçu suit le pointeur. Au relâchement, la pose finale est enregistrée et synchronisée.
4. La translation conserve forme, dimensions, couleur, visibilité joueurs et orientation. La rotation conserve l’origine.
5. Un geste interrompu annule l’aperçu et conserve la dernière pose validée.
6. Le panneau Gabarits explique brièvement où saisir chaque forme. Un outil de pose armé doit être identifiable et facile à désarmer ; il ne doit pas donner l’impression que le déplacement est disponible alors qu’il intercepte le geste.
7. Si un pion, une porte ou un autre gabarit masque la poignée, le MJ peut sélectionner précisément le gabarit depuis la liste. Sa poignée de manipulation devient visible et prioritaire pour le glisser de ce gabarit.

### Recette

- Déplacer séparément un cercle, un cône et une ligne à la souris, puis sur un écran tactile si le MJ l’utilise.
- Tester plusieurs zooms, un gabarit sous un pion et deux gabarits superposés.
- Vérifier la pose finale sur la vue joueurs et après rechargement.
- Vérifier qu’un glisser ne déplace pas la carte et qu’une interruption ne sauvegarde pas l’aperçu.
- Tester les gestes réels de pointeur, en complément des tests qui injectent directement une intention de glisser.

## 3. Ping côté joueurs

### Comportement attendu

Le joueur peut attirer l’attention sur un point de la carte par un geste direct, sans bouton ni menu supplémentaire. Le ping est visible sur le poste émetteur, le poste MJ et les vues joueurs affichant le même étage.

- Le marqueur apparaît au point désigné sur la carte, indépendamment du zoom et du déplacement de caméra de chaque client.
- Il utilise le mécanisme de ping existant et disparaît automatiquement après environ deux secondes.
- Il reste visible au-dessus du brouillard sans révéler de contenu de la carte.
- Il ne modifie ni les pions, ni la vision, ni le brouillard, ni les positions de caméra.
- Il reste éphémère : aucune sauvegarde en campagne et aucun rejeu à la reconnexion.
- Chaque client démarre l’animation à la réception sur son horloge locale, comme pour le ping actuel.

### Reconnaissance du geste

Le double tap à un doigt est disponible sans personnage sélectionné sur toute la carte, y compris sur un pion ou une porte. L’action du premier tap est différée pendant la fenêtre de reconnaissance : un second tap admissible déclenche uniquement le ping et supprime l’action simple en attente. Si aucun second tap admissible n’arrive, l’action simple est exécutée une seule fois à la fin du délai, après vérification de sa cible dans l’état courant.

Ce délai concerne les taps simples sans sélection active côté joueurs. Avec un personnage sélectionné, les taps de déplacement sont traités immédiatement. Les seuils sont ajustés pour garder la sélection réactive tout en reconnaissant correctement le double tap.

Lorsque le personnage est sélectionné, deux taps sur une destination préparent puis valident le déplacement, même s’ils sont rapides. Ils ne déclenchent jamais un ping. Les clics hors zone annulent puis désélectionnent conformément à la section 5 ; ces deux clics, même rapides, ne produisent pas de ping.

Les seuils de temps et de distance du double tap seront ajustés sur la tablette. Ils doivent distinguer deux taps volontaires d’un pan, d’un pincement ou d’un appui long. Le double tap ne doit pas déclencher le zoom natif du navigateur.

### Recette

- Un double tap admissible produit un seul ping au bon point, visible sur les clients du même étage.
- Objectif de propagation conservé : affichage distant en moins de 500 ms dans les conditions normales du réseau de session.
- Un tap simple, un pan, un pincement et un appui long ne produisent aucun ping.
- Un ping ne bascule pas une porte et ne sélectionne ni ne déplace un pion.
- Sans sélection active, un double tap sur un pion ou une porte produit uniquement un ping ; un tap simple exécute une seule fois l’action habituelle après le délai de reconnaissance.
- Une validation rapide du mouvement produit un déplacement unique et aucun ping.
- Une reconnexion ne fait pas réapparaître les anciens pings.

## 4. Lisibilité de la zone accessible en projection

### Comportement attendu

Les cases accessibles sont identifiables sur une carte claire comme sur une carte sombre, lorsque la tablette est projetée par vidéoprojecteur. Le rendu actuel utilise un remplissage à 30 % d’opacité, sans contour dédié dans `js/render/layers/moveZone.js`.

- Renforcer la densité du remplissage en conservant la lecture du décor.
- Ajouter un contour de couleur pleine autour de chaque case accessible pour que la portée reste identifiable même lorsque le remplissage est atténué par la projection.
- Maintenir une épaisseur de contour lisible à l’écran lors des changements de zoom, sur grilles carrées et hexagonales.
- Distinguer la zone accessible, le chemin préparé et la dernière case choisie par leur forme ou leur tracé, en plus de la couleur.
- Conserver les informations de porte, les pions et les gabarits lisibles.

Le rendu est fixe, sans réglage supplémentaire dans l’interface MJ. Valeurs de départ proposées pour les essais : remplissage à 50–60 % d’opacité, contour opaque de 2–3 pixels écran. Les valeurs définitives seront choisies sur le vidéoprojecteur utilisé en partie, avec plusieurs couleurs de pions. Ces paramètres de réalisation restent à calibrer sur le matériel.

### Recette

Le MJ et les joueurs doivent pouvoir repérer la frontière de la zone accessible, le chemin et son arrivée depuis leur place habituelle, sur deux cartes au minimum, l’une claire et l’autre sombre. La recette comprend une projection réelle ; une capture d’écran seule ne suffit pas à valider ce point.

## 5. Préparation puis validation du déplacement

### Parcours demandé

| Action | Résultat attendu |
|---|---|
| Premier clic sur un personnage déplaçable | Le personnage est sélectionné ; sa zone accessible apparaît. |
| Clic sur une première case accessible | Cette case devient l’arrivée préparée ; un chemin visible la relie au personnage. Le personnage reste à sa position réelle. |
| Clic sur une autre case accessible depuis l’arrivée préparée | Le trajet est prolongé vers cette case, qui devient la nouvelle arrivée. |
| Nouveau clic sur la dernière arrivée choisie | Tout le trajet préparé est validé, le déplacement est exécuté et le personnage est désélectionné. |
| Tap sur le fond hors de la zone accessible, avec un trajet préparé | Tout le trajet non validé est annulé ; le personnage reste sélectionné et sa portée initiale réapparaît. |
| Second clic au même endroit après cette annulation | Le personnage est désélectionné. |
| Tap sur le fond hors de la zone accessible, sans trajet préparé | Le personnage est désélectionné ; le double tap de ping redevient disponible. |
| Nouveau clic sur le personnage sélectionné, à sa position réelle | Conserver le comportement actuel, notamment le franchissement d’une liaison utilisable. Ce clic ne sert pas à annuler le trajet. |

La validation n’exige pas un double clic rapide : le second clic sur l’arrivée fonctionne après un délai quelconque, tant que la préparation est encore valide.

### Chemin et capacité restante

Le chemin passe par les cases réellement empruntables. Le calcul reprend les règles existantes : coûts, diagonales, obstacles, portes, occupation, taille du pion, états affectant son mouvement et type de grille.

Après chaque étape, le système soustrait le coût cumulé du chemin préparé à la capacité disponible au début de la préparation. La nouvelle zone accessible est calculée depuis la dernière arrivée avec cette capacité restante. Le personnage sélectionné doit être considéré à son origine virtuelle pour ce calcul, sans déplacer sa position réelle ni compter sa propre emprise comme un nouvel obstacle.

Les étapes précédentes restent dans le trajet : choisir une nouvelle case ne recalcule pas un raccourci qui effacerait les détours déjà demandés. Si les règles portent un état de calcul entre étapes, il doit être conservé pour que segmenter le trajet ne change pas son coût.

Quand la capacité restante est nulle, aucun prolongement n’est autorisé. La dernière arrivée reste visible et recliquable pour valider, même si aucune zone restante n’est dessinée.

**Exemple illustratif**, avec un coût uniforme d’une unité par case et une capacité de six : le joueur prépare trois unités jusqu’à A. La portée restante autour de A vaut trois. Il choisit ensuite B, à deux unités de A : le trajet total coûte cinq et il reste une unité autour de B. Reclique sur B : validation de tout le chemin. Clic sur le fond hors de la zone restante avant validation : annulation complète, capacité initiale de six pour la préparation suivante. Nouveau clic au même endroit : désélection.

### Retours visuels

- Le personnage réel garde une marque de sélection et demeure à son point de départ jusqu’à la validation.
- Le chemin complet reste visible, avec un sens de parcours identifiable.
- La dernière arrivée porte un marqueur distinct, y compris lorsque la capacité est épuisée.
- La zone restante se déplace autour de cette arrivée après chaque étape.
- Un petit nombre près de l’arrivée affiche la capacité restante dans l’unité utilisée par le calcul de mouvement. Il reste lisible en projection, y compris à zéro, sans ajouter de panneau ni de bouton.
- Un clic sur le fond hors de portée applique l’annulation ou la désélection ci-dessous. Une destination refusée pour une autre raison, par exemple une occupation alors que la case appartient à la portée affichée, reçoit le retour de refus existant sans détruire le trajet préparé.

### Annulation et changements de contexte

Sélectionner un autre personnage abandonne la préparation précédente. Changer d’étage ou recharger la page l’abandonne également. Un pan ou un zoom de carte la conserve.

Avec un trajet préparé, un tap sur le fond hors de la zone accessible annule toute la préparation, retire le chemin partagé, conserve la sélection et réaffiche la portée initiale. Un second clic au même endroit désélectionne ; aucun délai de double clic n’est exigé. Sans trajet préparé, un tap sur le fond hors zone désélectionne directement. Une porte ou un pion désigné n’est pas traité comme un tap sur le fond.

La portée initiale peut être plus grande que la zone restante qui était affichée avant l’annulation. Le second clic au même endroit doit néanmoins désélectionner, même si cet endroit appartient désormais à la portée initiale. Mémoriser temporairement la cible d’annulation pour ce seul clic suivant ; une autre interaction met fin à ce rappel.

Les gestes et règles des liaisons sont conservés. Cliquer sur le personnage sélectionné situé sur une extrémité utilisable continue de demander le franchissement, même si une préparation existe. Un franchissement réussi rend cette préparation obsolète et retire son aperçu ; un franchissement refusé ne la transforme pas en mouvement validé. Aucun nouveau geste de liaison ni chemin préparé entre étages n’est ajouté.

Si le pion est déplacé à distance, supprimé, masqué aux joueurs ou devient non déplaçable, sa préparation est annulée. La sélection n’est conservée que si elle reste autorisée. Si un obstacle, une porte ou un paramètre de mouvement change, le trajet et son coût doivent être revérifiés ; une préparation devenue invalide est annulée avec un retour compréhensible.

### Validation et synchronisation

La préparation ne déclenche aucun mouvement durable, aucune animation de déplacement réelle, aucune sauvegarde de position et aucune révélation de brouillard. Elle reste un état d’interface temporaire partagé entre les postes.

**Vision confirmée le 4 octobre 2026 :** tant que le mouvement n’est pas validé, la vision du pion reste calculée depuis sa position réelle. Ni les arrivées préparées ni le chemin partagé ne déplacent son champ de vision ou n’étendent le brouillard exploré. Après validation, la vision suit le mouvement exécuté selon les règles existantes.

Chaque modification du trajet diffuse un aperçu aux clients affichant le même étage. Cet aperçu représente le chemin et son arrivée sans sélectionner le pion sur les autres postes ni déplacer leur caméra. Seul le poste qui prépare peut prolonger ou valider sa préparation ; recevoir un aperçu ne constitue pas une sélection locale.

La validation, l’annulation et l’invalidation retirent l’aperçu partagé. Une déconnexion ou un changement d’étage du poste émetteur doit également permettre de nettoyer l’aperçu sur les autres postes. Les aperçus ne sont pas enregistrés dans la campagne et un rechargement ne restaure pas un ancien trajet. Les mises à jour doivent être ordonnées pour éviter qu’un aperçu tardif réapparaisse après son annulation ou sa validation. Les préparations simultanées ne changent pas la règle existante de résolution des mouvements validés ; elles ne créent aucun verrou sur un pion.

À la validation, le trajet complet est revérifié contre l’état courant. S’il reste valide, un mouvement unique est exécuté et synchronisé, avec l’animation suivant le chemin préparé plutôt qu’une ligne directe vers la destination. Les effets existants de vision et de brouillard s’appliquent alors selon leur fonctionnement actuel.

Après une validation réussie, la sélection locale est retirée et la zone de portée disparaît. Une validation refusée ne doit pas être traitée comme une réussite.

Une validation refusée ne doit laisser aucune position partielle ni publier un mouvement invalide. Les taps répétés pendant l’exécution ne doivent pas déclencher plusieurs fois le même trajet.

### Recette

1. Une destination choisie une fois ne déplace pas le personnage.
2. Deux destinations successives construisent un chemin passant par les deux, avec le bon coût cumulé et la bonne portée restante.
3. Un second clic sur la dernière destination valide le trajet complet une seule fois, sans limite de délai entre les deux clics.
4. Un clic sur le fond hors zone annule le trajet sans désélectionner le personnage ni changer sa position ; un second clic au même endroit désélectionne, même si la portée initiale restaurée inclut cet endroit.
5. Un trajet consommant toute la capacité reste validable.
6. Une destination refusée pour une autre raison qu’un clic sur le fond hors zone ne détruit pas la préparation valide.
7. Un obstacle changé pendant la préparation interdit la validation d’un chemin devenu illégal.
8. Pendant toutes les étapes de préparation, le champ de vision et le brouillard exploré restent inchangés sur les postes locaux et distants ; aucune position distante n’est modifiée. La validation applique le mouvement et ses effets de vision, atteint les autres clients et survit au rechargement.
9. Les mêmes cas sont vérifiés sur grilles carrées et hexagonales, avec les règles et les états de mouvement existants.
10. Sur tablette, préparer puis valider rapidement un mouvement ne déclenche ni ping ni zoom du navigateur.
11. Les autres postes voient le chemin avant validation, sans déplacement réel, sélection locale imposée ni déplacement de caméra ; l’annulation ou la validation le retire partout.
12. Après validation, le personnage est désélectionné. Après annulation par clic hors zone, il reste sélectionné ; sans trajet préparé, un clic hors zone désélectionne directement. Deux clics rapides d’annulation puis désélection ne produisent aucun ping.
13. Le nombre affiché près de l’arrivée correspond à la capacité restante calculée, y compris zéro.
14. Les liaisons conservent leur geste actuel, leurs contrôles de franchissement et leur fonctionnement à cheval. Le clic sur le personnage ne sert plus à annuler une préparation.

## 6. Réalisation et validation finale

Implantation réalisée le 4 octobre 2026, selon le [plan d’implémentation](PLAN-IMPLEMENTATION-RETOUR-SESSION-2026-10-04.md). Le [compte rendu dans ETAT.md](ETAT.md) distingue les contrôles automatisés exécutés de la recette matérielle restante. Le rendu initial utilise un remplissage d’opacité 0,55 et un contour opaque de 2,5 pixels à l’écran, à confirmer au vidéoprojecteur. Le champ de vision reste calculé depuis la position réelle jusqu’à validation du mouvement ; les aperçus ne révèlent aucune zone explorée.

Ordre proposé : vérifier et fiabiliser la manipulation des gabarits ; renforcer le rendu de portée ; implémenter l’état de préparation et sa validation ; ajouter le ping joueurs avec l’arbitrage des gestes retenu ; effectuer la recette complète en projection.

La réalisation devra couvrir la logique de chemin et de coût par des tests unitaires, puis les clics, taps, glissers et échanges entre clients par des tests de navigateur. Elle réutilisera le rendu Canvas 2D et les adaptateurs de grille, et complétera le protocole existant pour les aperçus partagés. À l’arrêt des gestes et des animations, la boucle de rendu doit retrouver son fonctionnement au repos.

Avant livraison, mettre en cohérence le cahier des charges principal, les conventions, la description du ping et le README avec les nouveaux gestes. Consigner les essais réellement exécutés et les points restant à vérifier sur le matériel de session.

La fonctionnalité sera considérée terminée lorsque les quatre recettes sont satisfaites, y compris la manipulation réelle des gabarits, l’absence de conflit ping/déplacement et la lisibilité sur vidéoprojecteur.
