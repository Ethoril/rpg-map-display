# Chantier E — plafond de décodage JPEG et message d'erreur

> **Priorité basse. Optionnel.** La convention d'export à 150 ppg
> (`ANALYSE-DD2VTT-GRILLES.md` §0) rend ce chantier inutile pour les cartes du mainteneur.
> Ce document existe pour ne pas perdre un diagnostic déjà fait et mesuré.
>
> Écrit le 29 juillet 2026 au soir. Rien n'a été modifié dans le code.

---

## 1. Ce qui se passe

`prepareMap()` sur un export à 300 ppg échoue :

```text
Impossible de lire l'image source avec Jimp : maxMemoryUsageInMB limit exceeded by at least 119MB
```

`jpeg-js@0.4.4` plafonne à **512 Mo** par défaut. Une image 8700×6600 fait 57,4 Mpx, soit
~230 Mo en RGBA plus les tampons intermédiaires du décodeur.

**Sans objet pour les cartes du MJ depuis la convention 150 ppg** : un export sous ~20 Mpx
décode avec le plafond par défaut, vérifié de bout en bout. Ce chantier ne concerne que le
cas d'une carte tierce, ou d'une carte du MJ sensiblement plus grande que 36×24 cases.

---

## 2. Faits établis — ne pas les redécouvrir

1. **L'option atteint le décodeur par l'API publique de Jimp**, vérifié fonctionnel :
   ```js
   await Jimp.fromBuffer(buf, { 'image/jpeg': { maxMemoryUsageInMB: N } })
   ```
   `Jimp.fromBuffer` accepte des options par type MIME
   (`Record<"image/jpeg", DecodeJpegOptions>`). **Aucune dépendance à ajouter** :
   `@jimp/js-jpeg` est déjà transitif, et `check-deps` n'est pas concerné.
2. **Piège mesuré.** Le « exceeded by at least N MB » n'est **pas** le besoin total, c'est
   le déficit à la première allocation bloquante. En portant le plafond de 512 à 640, le
   message réclame 155 Mo au lieu de 119. **Ne pas calculer la valeur depuis le message.**
   Mesure : **1024 Mo décodent** un 8700×6600.
3. `maxResolutionInMP` vaut **100** par défaut. Sans objet à 150 ppg — il faudrait une
   carte de 66×66 cases pour l'atteindre. À ne relever que si le plafond mémoire l'est.
4. Le `catch {}` nu de `scripts/resample.mjs:63` **avale** l'erreur du repli WebP, ce que
   `CONVENTIONS.md` §6 interdit. Ce repli s'applique à un buffer JPEG, où il ne peut jamais
   réussir, et le message final attribue à Jimp ce qui est un plafond de décodeur.

---

## 3. Ce qui vaut encore le détour

Par ordre de rentabilité :

1. **Le message d'erreur.** C'est le plus rentable et c'est indépendant du reste : il doit
   nommer les deux tentatives et leurs deux causes, sans `catch` muet. L'analyse `.dd2vtt`
   a dû rétro-ingénierer ce message pour comprendre ; le prochain paiera le même prix.
2. **Le plafond mémoire.** Trois lignes. Rend la convention 150 ppg confortable au lieu
   d'obligatoire : une carte plus grande n'échoue plus.

**Ne pas faire :** toucher à la logique de rééchantillonnage ou à `MAX_TEXTURE_FALLBACK` ;
retirer le repli WebP, qui sert les vraies entrées webp ; mettre le plafond dans
`js/core/constants.js` — c'est un budget de décodage côté Node, pas une donnée du modèle
partagé, et `js/` est régi par le manifeste `ARCHITECTURE.md` §1.

---

## 4. Test, si le chantier est fait

Un cas décodant un JPEG au-dessus de 512 Mo. **Ne pas** utiliser les fichiers de
`fixtures/real/` : non suivis par git, de 1,6 à 9 Mo. Générer une fixture dont l'image est
un JPEG de couleur unie en 8700×6600 — énorme en pixels, quelques centaines de kilo-octets
sur disque — et documenter la commande qui l'a produite. Ce cas sera plus lent que les
autres, environ 1 s : acceptable, à surveiller.

Acceptation : `pnpm run verify` en code 0 ; `pnpm maps:prepare` toujours identique octet
pour octet sur `manoir-rdc` ; et sur une entrée réellement indécodable, le message nomme
les deux tentatives.
