# Fixture de transport Firestore v3

Ce fichier est une campagne **synthétique** à trois étages : sélection persistée, pion qui peut
suivre le lien d'escalier et portail verrouillé sont représentés sans dépendre d'un média sous licence.
Les URL `synthetic/*.webp` sont volontairement des références non distribuées ; elles ne constituent
ni une campagne réelle, ni une validation d'assets de production. Aucun droit de diffusion pour trois
assets réels n'a été fourni : une démonstration complète de campagne reste donc bloquée sur ces médias
et leurs licences, pas sur le schéma de transport.

Le fog reste local et par niveau dans l'interface : il n'est pas fusionné dans `state/current` par
la persistance Firestore v3. Les tests de transport vérifient à la place la conservation indépendante
des niveaux, des liens, de la sélection, du verrou et des métadonnées de session.
