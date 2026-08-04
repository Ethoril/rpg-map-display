# Prompts pour Icônes d'États & Altérations de Conditions

> **Statut au 04/08/2026 — ce document a rempli deux rôles sur trois.**
>
> Il a **fixé le vocabulaire** : ses quatorze états sont désormais la liste close des valeurs
> de `token.markers`, ce qui **tranche la question Q7** du CdC §12, laissée ouverte depuis le
> lot 1a. C'est son apport durable.
>
> Il n'a en revanche **pas fourni les dessins**. Les quatorze icônes en service viennent de
> [game-icons.net](https://game-icons.net) et sont dans `assets/icons/status/` ; leur
> provenance, leur licence et leur normalisation sont dans le `SOURCES.md` de ce dossier,
> **qui fait autorité**. Trois raisons, dans l'ordre de poids :
>
> 1. **Ces icônes-là sont dessinées par des humains pour être vues petites**, ce qu'un
>    générateur ne garantit pas. C'est le seul argument qui compte : à 14 px de badge, un
>    tracé chargé devient une tache, et c'est le cas d'usage réel (cf.
>    `TRANCHE-L09-MARQUEURS.md` §1).
> 2. **La cohérence est acquise par construction** — deux états voisins peuvent venir du même
>    auteur, `deafened` et `blinded` étant la même idée déclinée. Quatorze générations
>    indépendantes ne l'auraient jamais donnée, quel que soit le préfixe de style.
> 3. **Le format** : les prompts ci-dessous produisent du raster, pas du SVG. Ce n'est pas
>    rédhibitoire — il existe des générateurs vectoriels — mais il fallait alors compter une
>    vectorisation et un détourage, le `plain white background` demandé étant l'inverse de ce
>    qu'exige un badge posé sur un pion.
>
> **Ce document reste utile pour un cas précis** : si un quinzième état est un jour ajouté et
> qu'aucune icône de game-icons.net ne lui correspond, le style global et le prompt de l'état
> voisin sont ici, et la cohérence avec l'existant sera à obtenir à la main.

Les prompts sont en anglais (langue de référence pour les modèles) et s'appuient sur un style visuel cohérent. Cible : lisible sur un pion, de 16×16 à 32×32 pixels.

---

## 🎨 Style Global à appliquer à vos prompts (Prefix / Negative Prompt)

Pour assurer la cohérence visuelle sur l'ensemble de votre UI, vous pouvez ajouter ce préfixe ou ce style global :

> **Style Prefix à inclure :**  
> `Minimalist flat vector icon, game UI badge status condition, bold high-contrast silhouette, clean lines, isolated on plain white background, sharp geometric design, readable at small size, vector art style`

---

## 📜 Prompts pour chaque état

### 1. À terre (Prone)
- **Concept visuel :** Une figurine/silhouette humaine allongée au sol ou une flèche courbée pointant vers le bas avec un sol strié.
- **Prompt :**
  ```text
  Flat vector icon of a fallen human silhouette prone on the ground, flat horizontal line underneath, game UI token status, minimalist, bold lines, isolated white background
  ```

### 2. Assourdi (Deafened)
- **Concept visuel :** Une oreille barrée d'une croix nette ou traversée par des ondes cassées.
- **Prompt :**
  ```text
  Flat vector icon of a human ear with a bold diagonal prohibition cross strike-through, high contrast game UI icon, simple graphic symbol, isolated white background
  ```

### 3. Aveuglé (Blinded)
- **Concept visuel :** Un œil ouvert barré ou un œil avec une prunelle occultée par une croix.
- **Prompt :**
  ```text
  Flat vector icon of an open human eye with a large bold X mark over it, game UI status condition badge, sharp geometric lines, isolated white background
  ```

### 4. Brisé (Broken)
- **Concept visuel :** Une silhouette effondrée, prostrée, tête entre les mains — l'abattement.
  **Corrigé le 04/08/2026** : la version initiale décrivait un bouclier de chevalier fendu,
  donc une armure qui cède. Or la table des couleurs de ce document range `broken.svg` dans
  Psychologie / Mental, et le bouclier disait l'inverse. C'est bien l'état mental qui est
  visé ; le cœur brisé a été écarté au passage, il se lit « chagrin d'amour ».
- **Prompt :**
  ```text
  Flat vector icon of a collapsed despairing human silhouette, head buried in hands, hunched shoulders, mental break status badge, bold silhouette, high contrast, isolated white background
  ```

### 5. Empêtré (Entangled)
- **Concept visuel :** Des cordes entremêlées, une toile d'araignée serrée ou des lianes autour d'un membre.
- **Prompt :**
  ```text
  Flat vector icon of a manacle or thick ropes tied tightly around wrists, web mesh motif, game status condition badge, bold vector shape, isolated white background
  ```

### 6. Empoisonné (Poisoned)
- **Concept visuel :** Une fiole avec une tête de mort ou des gouttes de venin bubbling avec un crâne.
- **Prompt :**
  ```text
  Flat vector icon of a potion bottle with a skull symbol inside and toxic dripping bubbles, poison status badge, sharp vector style, isolated white background
  ```

### 7. En Flammes (Ablaze)
- **Concept visuel :** Une flamme vive et stylisée à 3 branches.
- **Prompt :**
  ```text
  Flat vector icon of a stylized roaring fire flame, sharp geometric fire element, burning status badge, high contrast, isolated white background
  ```

### 8. Hémorragique (Bleeding)
- **Concept visuel :** Deux ou trois gouttes de sang épaisses alignées ou une goutte principale entaillée.
- **Prompt :**
  ```text
  Flat vector icon of three sharp blood droplets falling, bleeding status condition, bold clean graphic symbol, game UI badge, isolated white background
  ```

### 9. Inconscient (Unconscious)
- **Concept visuel :** Une tête de profil fermant les yeux avec trois "Z" stylisés au-dessus.
- **Prompt :**
  ```text
  Flat vector icon of a sleeping head silhouette profile with ZZZ symbols floating above, unconscious status marker, minimalist UI style, isolated white background
  ```

### 10. Sonné (Stunned)
- **Concept visuel :** Une étoile de choc tournoyante ou plusieurs petites étoiles en spirale/halo.
- **Prompt :**
  ```text
  Flat vector icon of a dizzy impact starburst with swirling motion trail lines, stunned status condition badge, bold vector graphic, isolated white background
  ```

### 11. Surpris (Surprised)
- **Concept visuel :** Un point d'exclamation géant et dynamique !.
- **Prompt :**
  ```text
  Flat vector icon of a bold dynamic exclamation mark !, surprise alert icon, sharp edges, game UI status marker, high contrast, isolated white background
  ```

### 12. Frénésie (Frenzy)
- **Concept visuel :** Des haches croisées ou des griffes/éclairs de rage avec un œil injecté.
- **Prompt :**
  ```text
  Flat vector icon of crossed berserker battle axes with rage aura sparks, frenzy status condition badge, aggressive sharp silhouette, isolated white background
  ```

### 13. Peur (Fear)
- **Concept visuel :** Un masque ou visage stylisé effrayé aux yeux grands ouverts et bouche béante.
- **Prompt :**
  ```text
  Flat vector icon of a stylized screaming fear mask face with wide open eyes, fear psychology status badge, sharp vector shape, isolated white background
  ```

### 14. Terreur (Terror)
- **Concept visuel :** Un crâne monstrueux avec une ombre démoniaque ou un visage hurlant entouré de griffes (plus intense que la Peur).
- **Prompt :**
  ```text
  Flat vector icon of a monstrous roaring skull with sharp horns and shadowy aura, terror psychology status badge, aggressive bold silhouette, isolated white background
  ```

---

## 📁 Emplacement & Organisation des Fichiers SVG

> **Ce dossier est désormais peuplé, et c'est `assets/icons/status/SOURCES.md` qui fait
> autorité** sur ce qu'il contient. L'arborescence ci-dessous reste juste — les noms de
> fichiers sont ceux retenus — mais elle décrit un état atteint, plus une cible.
>
> Le point à ne pas perdre : **le nom de fichier est l'identifiant** attendu dans
> `token.markers`. `prone.svg` n'est pas la décoration de l'état « à terre », c'est la
> définition de sa valeur, et le schéma refusera tout ce qui n'est pas dans cette liste.

```text
assets/icons/status/
```

### Arborescence recommandée :

```text
rpg-map-display/
└── assets/
    └── icons/
        └── status/
            ├── prone.svg         # 1. À terre
            ├── deafened.svg      # 2. Assourdi
            ├── blinded.svg       # 3. Aveuglé
            ├── broken.svg        # 4. Brisé
            ├── entangled.svg     # 5. Empêtré
            ├── poisoned.svg      # 6. Empoisonné
            ├── ablaze.svg        # 7. En Flammes
            ├── bleeding.svg      # 8. Hémorragique
            ├── unconscious.svg   # 9. Inconscient
            ├── stunned.svg       # 10. Sonné
            ├── surprised.svg     # 11. Surpris
            ├── frenzy.svg        # 12. Frénésie
            ├── fear.svg          # 13. Peur
            └── terror.svg        # 14. Terreur
```

---

## 💡 Conseils d'intégration pour l'application

### Bordures / Formes de fond (Tokens)
Pour votre application, vous pouvez intégrer ces icônes SVG dans des cercles ou octogones colorés selon la catégorie d'état :

- 🔴 **Rouge** : Dégâts / Altérations physiques (`ablaze.svg`, `bleeding.svg`, `poisoned.svg`)
- 🟡 **Jaune / Orange** : Contrôle de foule / Mouvement (`prone.svg`, `entangled.svg`, `stunned.svg`, `surprised.svg`)
- 🔵 **Bleu / Gris** : Sens / Perception (`blinded.svg`, `deafened.svg`, `unconscious.svg`)
- 🟣 **Violet / Noir** : Psychologie / Mental (`broken.svg`, `fear.svg`, `terror.svg`, `frenzy.svg`)
