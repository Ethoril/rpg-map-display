// @ts-check
import { createLevel } from '../core/schema.js';

/**
 * @typedef {import('../core/types.js').Level} Level
 * @typedef {import('../core/types.js').CellPoint} CellPoint
 * @typedef {import('../core/types.js').Portal} Portal
 * @typedef {import('../core/types.js').Light} Light
 */

/**
 * Parse un document JSON UVTT (Universal VTT / Dungeondraft).
 * Fonction pure : aucune I/O, aucun DOM.
 *
 * @param {string | object} jsonInput Chaîne JSON ou objet décodé
 * @returns {{
 *   level: Level,
 *   image: string,
 *   imageBase64: string,
 *   grid: import('../core/types.js').GridConfig,
 *   walls: CellPoint[][],
 *   portals: Portal[],
 *   lights: Light[],
 *   warnings: string[]
 * }}
 */
export function parseUvtt(jsonInput) {
  /** @type {any} */
  let data;
  if (typeof jsonInput === 'string') {
    try {
      data = JSON.parse(jsonInput);
    } catch (err) {
      throw new Error(`JSON UVTT invalide : ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (typeof jsonInput === 'object' && jsonInput !== null) {
    data = jsonInput;
  } else {
    throw new Error('Entrée UVTT invalide (string ou object attendu)');
  }

  // Refuser le type hex si spécifié explicitement dans le fichier
  if (data.grid_type === 'hex' || data.grid?.type === 'hex') {
    throw new Error('Grille hexagonale non supportée pour le format UVTT');
  }

  /** @type {string[]} */
  const warnings = [];

  const resolution = data.resolution || {};
  const pxPerCell = resolution.pixels_per_grid ?? 140;
  const widthCells = resolution.map_size?.x ?? 40;
  const heightCells = resolution.map_size?.y ?? 30;

  const originX = resolution.map_origin?.x ?? 0;
  const originY = resolution.map_origin?.y ?? 0;
  const offsetX = originX * pxPerCell;
  const offsetY = originY * pxPerCell;

  // Extraction des murs (line_of_sight + objects_line_of_sight) en unités de case (CellPoint)
  /** @type {CellPoint[][]} */
  const walls = [];

  const losList = [
    ...(Array.isArray(data.line_of_sight) ? data.line_of_sight : []),
    ...(Array.isArray(data.objects_line_of_sight) ? data.objects_line_of_sight : []),
  ];

  for (const poly of losList) {
    if (!Array.isArray(poly)) continue;
    /** @type {CellPoint[]} */
    const points = [];
    for (const pt of poly) {
      if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
        points.push({ cellX: pt.x, cellY: pt.y });
      }
    }
    if (points.length >= 2) {
      walls.push(points);
    }
  }

  // Extraction des portails
  /** @type {Portal[]} */
  const portals = [];
  if (Array.isArray(data.portals)) {
    let portalIdx = 1;
    for (const p of data.portals) {
      if (!p || !Array.isArray(p.bounds) || p.bounds.length < 2) continue;
      const ptA = p.bounds[0];
      const ptB = p.bounds[1];
      portals.push({
        id: p.id || `portal-${portalIdx++}`,
        a: { cellX: ptA.x, cellY: ptA.y },
        b: { cellX: ptB.x, cellY: ptB.y },
        closed: p.closed ?? true,
        freestanding: p.freestanding ?? false,
      });
    }
  }

  // Extraction des lumières
  /** @type {Light[]} */
  const lights = [];
  if (Array.isArray(data.lights)) {
    let lightIdx = 1;
    for (const l of data.lights) {
      if (!l || !l.position) continue;
      lights.push({
        id: l.id || `light-${lightIdx++}`,
        at: { cellX: l.position.x, cellY: l.position.y },
        range: l.range ?? 5,
        intensity: l.intensity ?? 1,
        color: l.color ?? '#ffffff',
        shadows: l.shadows ?? true,
      });
    }
  }

  // Éclairage cuit (baked_lighting)
  const baked = Boolean(data.environment?.baked_lighting);
  if (baked) {
    warnings.push('baked_lighting activé : l’éclairage ambiant est déjà cuit dans l’image.');
  }

  const imageBase64 = data.image ?? '';

  const level = createLevel({
    id: data.id || 'uvtt-level',
    name: data.name || 'Carte UVTT',
    pxPerCell,
    widthCells,
    heightCells,
    grid: {
      type: 'square',
      offsetX,
      offsetY,
      color: '#000000',
      opacity: 0.25,
      visible: true,
    },
    walls,
    portals,
    lights,
    ambient: {
      color: '#ffffff',
      level: 1.0,
      baked,
    },
  });

  return {
    level,
    image: imageBase64,
    imageBase64,
    grid: level.grid,
    walls: level.walls,
    portals: level.portals,
    lights: level.lights,
    warnings,
  };
}
