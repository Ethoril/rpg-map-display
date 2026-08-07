# ADR-012 — notes d'implémentation Firestore v3

## Sécurité de la migration

Le parent v3 reste léger pour toute nouvelle sauvegarde. Le gros champ `campaign` v2 n'est conservé
que lorsqu'il existe réellement dans le parent lu par la transaction. Cette copie de secours survit
à la bascule v3, puis une seconde transaction ne la retire que si la révision attendue est toujours
courante. Une sauvegarde concurrente ne peut donc pas supprimer le secours d'une révision plus récente.

## Cohérence des révisions et concurrence

La sauvegarde lit d'abord le parent dans une transaction Firestore, dérive une révision monotone de
la valeur courante, puis écrit niveaux, pions, état global et parent dans cette même transaction.
Firestore rejoue le callback si le parent change : deux tablettes ne peuvent plus publier un parent
d'une révision avec les sous-documents d'une autre.

Chaque document `levels/{levelId}`, `tokens/{tokenId}` et `state/current` porte la révision du parent.
Le lecteur charge uniquement les identifiants déclarés, refuse toute partie manquante ou mélangée,
confirme encore la révision du parent et réessaie une fois en cas d'écriture concurrente. Les
sous-documents obsolètes ne peuvent jamais entrer dans la campagne reconstruite.

## Limites assumées

Chaque document est prévolé avec le plafond applicatif de 900 Kio. Une transaction dépassant 500
écritures, suppressions comprises, est refusée explicitement. Le poids global de l'ancien document
v2 reste un diagnostic : une campagne plus grande que ce format est acceptée dès lors que chaque
document v3 tient sous son plafond.

Une transaction Firestore peut échouer hors connexion ou après épuisement de ses tentatives ; l'erreur
remonte alors à l'interface, tandis que le repli local a déjà conservé le snapshot. Les documents
orphelins qui ne figurent plus dans le parent sont ignorés à la lecture. Ils ne sont supprimés que
lorsqu'ils appartiennent aux listes d'identifiants du parent transactionnel précédent : aucune
énumération de collection potentiellement périmée ne décide d'une suppression.
