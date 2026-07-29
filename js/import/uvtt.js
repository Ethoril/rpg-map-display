// @ts-check
import { createLevel } from '../core/schema.js';

/**
 * @typedef {import('../core/types.js').Level} Level
 * @typedef {import('../core/types.js').CellPoint} CellPoint
 * @typedef {import('../core/types.js').Portal} Portal
 * @typedef {import('../core/types.js').Light} Light
 */

/**
 * Convertit et normalise une couleur UVTT au format CSS `#RRGGBB`.
 *
 * Traite les formats suivants :
 * - 8 hex sans `#` (ARGB ex: "ffF7EAE4") -> "#F7EAE4", avec avertissement si alpha ≠ "ff"
 * - 6 hex sans `#` (RGB ex: "F7EAE4") -> "#F7EAE4"
 * - 7 chars `#RRGGBB` valide -> inchangé
 * - Tout le reste -> repli "#ffffff" avec avertissement
 *
 * `alpha` est toujours rendu quand la source en porte un, normalisé en 0..1. Un
 * appelant qui sait où le ranger passe `alphaUsed: true` et n'obtient alors
 * aucun avertissement, puisque rien n'est perdu. C'est le cas de l'éclairage
 * ambiant, dont le modèle porte un `level` en 0..1 (CdC §6). Les `Light`, elles,
 * n'ont pas de champ pour l'accueillir — `intensity` a une échelle indéterminée —
 * donc l'alpha y est jeté avec avertissement.
 *
 * @param {unknown} rawColor
 * @param {{alphaUsed?: boolean}} [options]
 * @returns {{ color: string, alpha?: number, warning?: string }}
 */
export function parseUvttColor(rawColor, options = {}) {
  const alphaUsed = options.alphaUsed === true;

  if (typeof rawColor === 'string') {
    const trimmed = rawColor.trim();

    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return { color: trimmed };
    }

    if (/^[0-9a-fA-F]{8}$/.test(trimmed)) {
      const alphaHex = trimmed.slice(0, 2);
      const rgb = trimmed.slice(2);
      const color = `#${rgb}`;
      const alpha = parseInt(alphaHex, 16) / 255;

      if (!alphaUsed && alphaHex.toLowerCase() !== 'ff') {
        return {
          color,
          alpha,
          warning: `Canal alpha non supporté "${alphaHex}" dans la couleur UVTT "${trimmed}" : ignoré (couleur ramenée à "${color}")`,
        };
      }
      return { color, alpha };
    }

    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
      return { color: `#${trimmed}` };
    }
  }

  const displayVal = typeof rawColor === 'string' ? `"${rawColor}"` : String(rawColor);
  return {
    color: '#ffffff',
    warning: `Couleur UVTT invalide ${displayVal}, repli sur "#ffffff"`,
  };
}

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
      const lightId = l.id || `light-${lightIdx++}`;
      const parsedColor = parseUvttColor(l.color);
      if (parsedColor.warning) {
        warnings.push(`Lumière "${lightId}" : ${parsedColor.warning}`);
      }
      lights.push({
        id: lightId,
        at: { cellX: l.position.x, cellY: l.position.y },
        range: l.range ?? 5,
        intensity: l.intensity ?? 1,
        color: parsedColor.color,
        shadows: l.shadows ?? true,
      });
    }
  }

  // Extraction de l'éclairage ambiant (environment.ambient_light).
  //
  // L'alpha de la source est l'intensité de l'ambiante, et le modèle a
  // exactement le champ pour la recevoir : `ambient.level`, en 0..1 (CdC §6). On
  // ne le jette donc pas. Sans ça, `"00000000"` — alpha 00, soit *aucune*
  // ambiante — deviendrait `#000000` à `level: 1`, c'est-à-dire du noir plein :
  // l'inverse exact de ce que la source déclare.
  let ambientColor = '#ffffff';
  let ambientLevel = 1.0;
  if (data.environment && data.environment.ambient_light !== undefined) {
    const parsedAmbient = parseUvttColor(data.environment.ambient_light, { alphaUsed: true });
    ambientColor = parsedAmbient.color;
    if (typeof parsedAmbient.alpha === 'number') {
      ambientLevel = parsedAmbient.alpha;
    }
    if (parsedAmbient.warning) {
      warnings.push(`Éclairage ambiant : ${parsedAmbient.warning}`);
    }
    if (ambientLevel === 0) {
      warnings.push(
        `Éclairage ambiant nul : "${data.environment.ambient_light}" porte un alpha 00, l'ambiante ne contribue à rien (level 0).`
      );
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
      color: ambientColor,
      level: ambientLevel,
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
