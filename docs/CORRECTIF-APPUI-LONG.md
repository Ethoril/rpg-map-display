# CORRECTIF — un appui long ne doit pas voler le geste qui le suit

> Écrit le 4 août 2026. Défaut **applicatif**, reproduit en conditions réelles par la mutation du
> §9.2 de `docs/DIAGNOSTIC-GESTE-GABARITS.md` : il a été trouvé en cherchant autre chose, et signalé
> depuis le commit `189a6c1` sans être traité.
>
> **À faire avant la séance de tablette**, et c'est la seule raison de son urgence : le symptôme le
> plus grave est tactile et concerne la vue joueurs. Le critère 11 du lot 2 est lui aussi tactile et
> attend la même séance — autant valider les deux d'un coup.

---

## 1. Le défaut

`handlePointerDown` arme un minuteur de 500 ms (`js/input/pointer.js:249-260`). À son échéance, s'il
reste un seul pointeur, il **applique son effet au milieu du geste** : `mode = 'longPress'`, et
l'intention `longPress` part.

Or `handlePointerMove` commence par `if (this.mode === 'longPress') return;` (`pointer.js:304`).
**Tout ce qui suit est donc perdu**, en silence, sans erreur.

### 1.1 Le symptôme grave : la carte ne se déplace plus, vue joueurs

`js/ui/player/bootstrap.js:39` ne traite que `tap`, `js/app/player.js:511` que `panBy` : **la vue
joueurs ignore `longPress`**. Conséquence sur la tablette :

> Un doigt touche la carte, hésite une demi-seconde, puis glisse pour déplacer la vue.
> **La carte ne bouge pas.** Aucun `panBy` n'est émis, et rien ne se passe au relâchement non plus —
> la branche du `tap` est bloquée par `longPressTriggered` et la durée dépasse de toute façon
> `dragHoldMs`.

C'est le geste principal de la vue joueurs, celui qu'on fait toute la séance, et il échoue sans rien
dire. Le doigt hésitant n'est pas un cas limite : c'est la façon normale de toucher une carte qu'on
regarde.

### 1.2 Le symptôme signalé : le MJ verrouille une porte au lieu de déplacer son pion

Côté MJ, `longPress` **est** traité (`js/app/gm.js:848-868`) : il bascule le verrou d'une porte
trouvée sous le point de pression. Donc un MJ qui presse un pion, hésite une demi-seconde puis
glisse obtient deux effets pour le prix d'un :

- le pion ne bouge pas — le glisser est abandonné comme ci-dessus ;
- **si une porte se trouve sous le point pressé, elle est verrouillée.** Ce qui arrive précisément
  quand un pion se tient dans une embrasure, c'est-à-dire tout le temps.

### 1.3 Reproduction, déjà faite

Mutation du glisser réel à 700 ms entre la pression et le déplacement, exécutée le 4 août 2026 :
intention `longPress` émise à `down + 505 ms`, les cinq `pointermove` reçus avec `mode: 'longPress'`,
**aucune** intention `dragToken`, aucun `end` au `pointerup`. Journal complet au §9.2 de
`DIAGNOSTIC-GESTE-GABARITS.md`.

## 2. La cause, en une phrase

**Un appui long est aujourd'hui décidé par un minuteur, alors qu'un geste ne se décide qu'une fois
terminé.** À 500 ms, l'utilisateur n'a encore rien fini : il peut immobiliser son doigt *ou* partir.
Appliquer l'effet à l'échéance revient à parier sur la suite, et à interdire l'autre branche.

Le reste du fichier respecte pourtant cette règle : `tap`, `panBy` et `dragToken` sont tous décidés
par un franchissement de seuil **observé**, pas par une horloge. L'appui long est la seule exception.

## 3. Ce qu'il faut écrire

**Décision : l'appui long devient un geste achevé, émis au `pointerup`.** Le minuteur ne fait plus
qu'armer une *candidature*, que le mouvement annule.

Dans `js/input/pointer.js`, et nulle part ailleurs :

1. **Le minuteur n'applique plus rien.** Il pose `longPressTriggered = true` et **c'est tout** : ni
   `mode = 'longPress'`, ni `emit`.
2. **Le mouvement annule la candidature.** Là où `handlePointerMove` appelle déjà
   `clearLongPressTimer()` au franchissement du seuil spatial, ajouter `longPressTriggered = false`.
   C'est le cœur du correctif : un appui long ne survit pas au mouvement.
3. **Retirer `if (this.mode === 'longPress') return;`** — la garde devient inatteignable, et c'est
   elle qui perdait le geste.
4. **Retirer `'longPress'` de l'union de `mode`.** L'état en attente est désormais porté par
   `longPressTriggered` ; laisser un membre d'union mort invite à le réutiliser.
5. **Émettre au `pointerup`**, dans la chaîne de branches existante, **après** `brushing` et
   `gmTokenDrag` et **avant** le `tap` : si `mode === 'tapCandidate'`, `longPressTriggered` est vrai
   et `dist < dragDistanceThreshold`, émettre `longPress` avec `startScreenPos`. L'ordre importe :
   un glisser de pion qui a commencé doit rester un glisser.

La branche du `tap` n'a **pas** à changer : elle teste déjà `!this.longPressTriggered`.

**Point de cohérence à traiter au passage, pas un défaut :** `handlePointerCancel` ne remet pas
`longPressTriggered` à `false`. C'est aujourd'hui sans effet, `handlePointerDown` le remettant à
`false`, mais après ce correctif l'état devient porteur de sens — le remettre à `false` là aussi.

### 3.1 Ce qu'il ne faut pas faire

- **Ne pas désarmer le minuteur quand un pion est sous la pression.** C'était l'autre correctif
  possible, et il est plus étroit : il ne répare pas le pan de la vue joueurs, qui est le symptôme
  grave, et il interdirait de verrouiller une porte occupée par un pion.
- **Ne pas toucher à `js/app/gm.js` ni à la vue joueurs.** Le contrat de l'intention `longPress` ne
  change pas : même type, même `screenPos`, même `mapPos`. Seul son **instant d'émission** change.
- **Ne pas ajouter de retour visuel pendant le maintien.** Ce serait une bonne idée et c'est une
  autre tâche : la vue joueurs n'accepte aucun élément d'interface (interdiction n°2), donc cela se
  demande, cela ne se décide pas.

## 4. Ce qu'il faut mesurer

**L'interdiction est explicite : ne pas toucher à `js/input/` sans en mesurer l'effet.** Le
mécanisme des gestes est la couche la plus dense en régressions silencieuses du dépôt.

1. **Les six tests de `tests/input.spec.mjs` passent inchangés.** Le test d'appui long est déjà
   compatible : il presse, attend 600 ms, **relâche**, et n'attend l'intention qu'après le
   `mouse.up()` (`input.spec.mjs:261-288`). Il n'assertait donc jamais l'émission à l'échéance. **Si
   une assertion doit être modifiée, s'arrêter et le dire** — ce serait le signe que le contrat
   change plus que prévu.
2. **Deux tests nouveaux dans `tests/input.spec.mjs`**, qui sont le défaut lui-même :
   - *presser, attendre 700 ms, glisser de 70 px, relâcher* → l'intention de déplacement est émise
     (`panBy` en rôle joueurs, `dragToken` en rôle MJ) et **aucun `longPress`** ne l'est ;
   - *presser, attendre 700 ms, relâcher sans bouger* → **exactement un** `longPress`, et aucun
     `panBy` ni `dragToken`. C'est la non-régression du geste qu'on répare.
3. **Les trois scénarios de `pnpm run test:manuel` restent verts**, en local et sur le runner. Le
   deuxième est le plus parlant : il exerce le glisser réel de bout en bout.
4. **`pnpm run verify` sort 0.**
5. **Preuve par mutation**, et elle est fournie : réinsérer les 700 ms dans
   `tests/manuel/gmToolDisarmGeste.spec.mjs` comme la recette en commentaire l'explique, **en local
   et sans le commiter**. Avant le correctif le pion reste immobile ; après, il doit se déplacer, et
   le journal ne doit contenir **aucune** intention `longPress`. Joindre les deux journaux.

## 5. Ce que ce correctif ne fait pas

- **Le seuil de 500 ms n'est pas discuté.** Il reste `longPressMs`, réglable, et sa valeur n'est pas
  l'objet ici.
- **La priorité entre un pion et une porte au même point n'est pas revue.** Un appui long immobile
  sur un pion posé dans une embrasure verrouillera toujours la porte. C'est le comportement actuel,
  antérieur à ce défaut, et il se discute séparément.
- **Le ressenti tactile ne sera pas coché.** Interdiction n°14 : le mécanisme se vérifie en
  Chromium, l'impression au doigt exige la Tab S9 FE. À signaler « à vérifier par le mainteneur »,
  avec une phrase précise à mettre dans sa liste : *toucher la carte, attendre une demi-seconde,
  glisser — la carte doit suivre le doigt.*

## 6. Définition de terminé

Les cinq conditions de `CONVENTIONS.md` §9, plus les cinq mesures du §4 ci-dessus, plus la ligne
« Écarts ». Y déclarer notamment tout test existant qu'il a fallu modifier, et pourquoi.
