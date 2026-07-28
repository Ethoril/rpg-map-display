// @ts-check

/**
 * Couple opaque. Carré : (colonne, ligne). Hexagone : axial (q, r).
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
 * @property {boolean} closed
 * @property {boolean} freestanding
 */

/**
 * @typedef {Object} Light
 * @property {string} id
 * @property {CellPoint} at
 * @property {number} range
 * @property {number} intensity
 * @property {string} color
 * @property {boolean} shadows
 */

/**
 * @typedef {Object} AmbientLight
 * @property {string} color
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
 * @property {string} imageUrl
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
 * @property {string[]} markers
 * @property {TokenMove} [move]
 */

/** @typedef {'circle'|'cone'|'line'} TemplateShape */

/**
 * @typedef {Object} Template
 * @property {string} id
 * @property {string} levelId
 * @property {TemplateShape} shape
 * @property {Cell} origin
 * @property {number} radiusCells
 * @property {number} directionDeg
 * @property {number} widthCells
 * @property {string} color
 * @property {boolean} visibleToPlayers
 */

/**
 * @typedef {Object} CampaignSettings
 * @property {number} ambientLevel
 */

/**
 * @typedef {Object} Campaign
 * @property {number} schemaVersion
 * @property {string} campaignId
 * @property {string} name
 * @property {Level[]} levels
 * @property {Link[]} links
 * @property {Token[]} tokens
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
// ci-dessous (ARCHITECTURE.md §1 et §3). Les types PixiJS se réfèrent directement au
// paquet — `import('pixi.js').Graphics` — jamais à un alias déclaré ici.

export {}

