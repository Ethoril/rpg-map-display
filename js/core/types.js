// @ts-check

/**
 * Couple opaque. Carré : (colonne, ligne). **Hexagone : décalé `odd-r` (colonne, rangée).**
 *
 * ⛔ **Corrigé le 12/08/2026, et c'était une erreur de MA documentation.** Cette ligne disait
 * « Hexagone : axial (q, r) ». L'axial est juste pour le **calcul** — distance, voisines — mais faux
 * pour le **stockage** sur une carte rectangulaire, parce que le décalage d'une demi-case par rangée
 * s'y **accumule**. Mesuré sur l'implémentation qui suivait fidèlement cette ligne : un étage
 * hexagonal de 12 × 12 voyait sa case (0, 11) décalée de **6 cases** vers la droite, **5 cases
 * débordaient hors de l'image**, et un tiers de la hauteur restait vide. Sur 65 × 71 : **34,5 cases
 * hors image, 153 % de la largeur**. C'est exactement le mode de panne dont
 * `ANALYSE-DD2VTT-GRILLES` §4.3 prévenait — « un hexagone techniquement correct et toujours
 * désaligné ».
 *
 * **Donc : `a` = colonne, `b` = rangée, en décalé `odd-r`** — les rangées impaires décalées d'une
 * demi-case, sans accumulation. `widthCells` × `heightCells` retrouve son sens de rectangle, et
 * l'énumération d'un étage redevient un rectangle.
 *
 * ⭐ L'axial reste **interne à `HexGrid`** : conversion décalé → cubique en entrée des calculs de
 * distance et de voisinage, retour en décalé en sortie. Rien de tout cela ne franchit le contrat de
 * `GridAdapter`, qui ne connaît que `Cell`.
 *
 * @typedef {{ a: number, b: number }} Cell
 */

/** @typedef {{ cellX: number, cellY: number }} CellPoint */

/** @typedef {{ screenX: number, screenY: number }} ScreenPoint */

/** @typedef {'square'|'hex'} GridType */

/** @typedef {'flat'|'pointy'} HexOrientation */

/**
 * Pixels de l'image de fond.
 * @typedef {{ x: number, y: number }} MapPoint
 */

/**
 * Segment de géométrie en coordonnées carte (pixels).
 * @typedef {{ p1: MapPoint, p2: MapPoint }} Segment
 */

/**
 * @typedef {Object} GridConfig
 * @property {GridType} type
 * @property {HexOrientation} [hexOrientation]
 * @property {number} offsetX
 * @property {number} offsetY
 * @property {string} [color]
 * @property {number} [opacity]
 * @property {boolean} [visible]
 */

/**
 * Surcouche animée en boucle (eau, feu, brume, torches). Positionnée en unités de case
 * comme tout le reste du modèle — jamais en pixels.
 * @typedef {Object} AnimatedOverlay
 * @property {string} url
 * @property {CellPoint} at coin haut-gauche
 * @property {number} widthCells
 * @property {number} heightCells
 * @property {number} fps
 */

/**
 * @typedef {Object} Portal
 * @property {string} id
 * @property {CellPoint} a
 * @property {CellPoint} b
 * @property {'open' | 'closed' | 'locked'} state
 * @property {boolean} [closed] HÉRITAGE — lu par la normalisation, jamais écrit.
 * @property {boolean} freestanding
 */

/**
 * @typedef {Object} Light
 * @property {string} id
 * @property {CellPoint} at
 * @property {number} range
 * @property {number} intensity Intensité normalisée entre 0 et 1
 * @property {string} color
 * @property {boolean} shadows
 */

/**
 * Éclairage ambiant d'un étage.
 *
 * ⛔ **Portait `color`, retiré le 17/08/2026 (UX-07).** Il était importé, validé, persisté, et
 * **lu par aucun rendu** : il n'attendait que la pénombre graduée, qui est écartée. Même profil
 * que `settings.ambientLevel`, supprimé à la question §12 q.4 du cahier des charges.
 *
 * ⚠ Les campagnes enregistrées en portent un. La lecture doit continuer de les accepter : un
 * `color` présent est **ignoré**, jamais refusé — un import qui rejetterait une campagne
 * existante serait une régression bien plus chère que le défaut corrigé.
 *
 * `level` reste un nombre de 0 à 1 **en lecture** pour cette raison ; l'interface, elle,
 * n'écrit plus que 0 ou 1, parce que `fogLayer` ne distingue que `baked || level > 0`.
 *
 * @typedef {Object} AmbientLight
 * @property {number} level
 * @property {boolean} baked
 */

/**
 * @typedef {Object} Level
 * @property {string} id
 * @property {string} name
 * @property {number} order
 * @property {string} imageUrl
 * @property {string|null} videoUrl
 * @property {AnimatedOverlay[]} animatedOverlays
 * @property {number} pxPerCell
 * @property {number} widthCells
 * @property {number} heightCells
 * @property {GridConfig} grid
 * @property {Record<string, number>|null} terrainCost
 * @property {CellPoint[][]} walls
 * @property {Portal[]} portals
 * @property {Light[]} lights
 * @property {AmbientLight} ambient
 */

/** @typedef {'stairs'|'elevator'|'ladder'|'hatch'|'passage'} LinkKind */

/**
 * @typedef {Object} LinkEndpoint
 * @property {string} levelId
 * @property {CellPoint} at
 */

/**
 * @typedef {Object} Link
 * @property {string} id
 * @property {LinkKind} kind
 * @property {string} label
 * @property {LinkEndpoint} a
 * @property {LinkEndpoint} b
 * @property {boolean} bidirectional
 * @property {boolean} gmOnly
 */

/**
 * @typedef {Object} TokenMove
 * @property {Cell} from
 * @property {Cell} to
 * @property {Cell[]} path
 * @property {number} startedAt
 */

/**
 * @typedef {Object} Token
 * @property {string} id
 * @property {string} levelId
 * @property {Cell} cell position — TOUJOURS entière
 * @property {number} sizeCells
 * @property {'pc'|'npc'} kind
 * @property {string} imageUrl URL publiée (relative ou HTTPS) **ou** image `data:` embarquée
 *   bornée — seul champ d'asset qui l'autorise. Validé par `isTokenImageUrl`, plafonné par
 *   `TOKEN_IMAGE_MAX_BYTES` et, cumulé, par `TOKEN_IMAGE_TOTAL_MAX_BYTES`. Voir
 *   `docs/ETAT.md` § « Persistance et assets ».
 * @property {string} borderColor
 * @property {string} label
 * @property {boolean} hidden
 * @property {number} visionBright
 * @property {number} visionDim
 * @property {{ range: number, intensity: number, color: string }|null} emitsLight
 * @property {number} speedCells
 * @property {boolean} playerMovable
 * @property {boolean} locked
 * @property {number} elevation
 * @property {import('./constants.js').StatusMarker[]} markers
 * @property {{ current: number, max: number }|null} hp
 * @property {'unharmed'|'wounded'|'critical'} health
 * @property {TokenMove} [move]
 */

/** @typedef {'circle'|'cone'|'line'} TemplateShape */

/**
 * @typedef {Object} Template
 * @property {string} id
 * @property {string} levelId
 * @property {TemplateShape} shape
 * @property {MapPoint} origin Position sur la carte (centre pour cercle, pointe pour cône,
 *   départ de l'axe pour la ligne)
 * @property {number} radiusCells Rayon, ou **longueur** pour la ligne
 * @property {number} directionDeg Orientation en degrés (0 = Est, sens horaire)
 * @property {number} [widthCells] Largeur de la ligne en cases. **Optionnel, et il doit le
 *   rester** : les gabarits enregistrés avant UX-06 ne le portent pas, leur absence vaut 1.
 *   Lu par le seul rendu de la ligne ; le cercle et le cône l'ignorent.
 * @property {string} color
 * @property {boolean} visibleToPlayers
 */

/**
 * Réglages de campagne — **conteneur réservé, aujourd'hui vide**.
 *
 * ⛔ Portait `ambientLevel`, retiré le 12/08/2026 avec la question n°4 du §12. L'ambiance est **par
 * étage** (`Level.ambient`) : c'est celle que `fogLayer` lit, et le champ global n'était relu par
 * aucun rendu ni aucune vision. Le §6 plaçait déjà l'ambiance par étage, et l'argument tenait — une
 * cave sombre sous un rez éclairé. Ne pas remettre de champ ici sans un lecteur en face.
 *
 * @typedef {Object} CampaignSettings
 */

/**
 * @typedef {Object} Campaign
 * @property {number} schemaVersion
 * @property {string} campaignId
 * @property {string} name
 * @property {Level[]} levels
 * @property {Link[]} links
 * @property {Token[]} tokens
 * @property {Token[]} [reserve] Pions **hors du plateau** (UX-14).
 *
 *   ⛔ Collection séparée, et non un `levelId` nul : l'invariant « un pion est toujours quelque
 *   part » reste vrai pour `tokens`, et **aucun balayage de pions ne change**. La vision, la
 *   lumière, `computeReachable` et `blockedEdges` parcourent `tokens` ; il est donc
 *   structurellement impossible qu'un pion rangé éclaire une pièce, au lieu d'être une garde
 *   qu'on peut oublier dans l'un des cinq endroits.
 *
 *   Les pions y conservent leur `levelId` et leur `cell` : ce n'est plus une position, c'est la
 *   trace de l'endroit d'où ils viennent. Le schéma ne les valide donc pas contre les étages.
 *
 *   ⚠ Ne pas confondre avec la **bibliothèque** de pions : celle-ci tient des *modèles* dont on
 *   instancie des copies ; la réserve tient *ces instances-là*, celles qui étaient sur le plateau,
 *   avec leurs PV, leurs marqueurs et leur histoire.
 *
 *   Optionnel dans le typedef, et il doit le rester : les campagnes enregistrées avant UX-14 ne
 *   le portent pas, et leur absence vaut réserve vide.
 * @property {Template[]} templates
 * @property {CampaignSettings} settings
 */

/**
 * @typedef {Object} TokenLibraryEntry
 * @property {string} id
 * @property {string} name
 * @property {string} imageUrl
 * @property {'pc'|'npc'} kind
 * @property {number} sizeCells
 * @property {number} speedCells
 * @property {number} visionBright
 * @property {number} visionDim
 * @property {{ range: number, intensity: number, color: string }|null} emitsLight
 * @property {string} borderColor
 * @property {number|null} [maxHp]
 */

/**
 * @typedef {Object} SceneLibraryEntry
 * @property {string} levelId
 * @property {string} name
 * @property {string} thumbUrl
 * @property {GridType} gridType
 * @property {'uvtt'|'image'} source
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Handout
 * @property {string} id
 * @property {string} name
 * @property {string} imageUrl
 */

/**
 * Présence d'un client connecté.
 * @typedef {Object} Presence
 * @property {'gm'|'players'} role
 * @property {number} at
 * @property {number} build
 * @property {string} label
 */

/**
 * Événement réseau sur le canal temps réel.
 * @typedef {Object} NetEvent
 * @property {string} type
 * @property {object} payload
 * @property {number} at
 * @property {'gm'|'players'} by
 */

// Ce fichier ne contient AUCUN code exécutable : uniquement des @typedef et l'export vide
// ci-dessous (ARCHITECTURE.md §1 et §3). Le rendu Canvas utilise les types DOM natifs.

export {}
