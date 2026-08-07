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

  // Géométrie. Les replis restent en place — refuser un fichier reproduirait la perte de
  // campagne documentée dans ETAT.md — mais ils ne doivent plus être **muets** : une carte
  // venue d'un outil inconnu se retrouvait sinon avec 40x30 cases à 140 px/case inventées
  // de toutes pièces, désalignées de sa propre image, sans un mot. C'est la forme la plus
  // coûteuse de l'échec : atteignable, franchi, silencieux.
  const resolution = data.resolution || {};
  const ppgSource = resolution.pixels_per_grid;
  const sizeSource = resolution.map_size;

  const pxPerCell = typeof ppgSource === 'number' && ppgSource > 0 ? ppgSource : 140;
  if (pxPerCell !== ppgSource) {
    warnings.push(
      `resolution.pixels_per_grid absent ou invalide (${JSON.stringify(ppgSource)}) : ` +
        `replié sur ${pxPerCell} px/case. La grille ne s'alignera sur l'image que par chance.`
    );
  }

  const widthCells = typeof sizeSource?.x === 'number' && sizeSource.x > 0 ? sizeSource.x : 40;
  const heightCells = typeof sizeSource?.y === 'number' && sizeSource.y > 0 ? sizeSource.y : 30;
  if (widthCells !== sizeSource?.x || heightCells !== sizeSource?.y) {
    warnings.push(
      `resolution.map_size absent ou invalide (${JSON.stringify(sizeSource)}) : ` +
        `dimensions repliées sur ${widthCells}x${heightCells} cases, valeurs inventées.`
    );
  }

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

  // Tout rejet est **compté**. Un fichier d'un exportateur inconnu peut nommer ses points
  // autrement : sans ce décompte, ses murs disparaissaient et la carte semblait simplement
  // ne pas en avoir. Le silence est le pire mode de défaillance d'un import universel.
  let polysRejetees = 0;
  let pointsRejetes = 0;

  for (const poly of losList) {
    if (!Array.isArray(poly)) {
      polysRejetees++;
      continue;
    }
    /** @type {CellPoint[]} */
    const points = [];
    for (const pt of poly) {
      if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
        points.push({ cellX: pt.x, cellY: pt.y });
      } else {
        pointsRejetes++;
      }
    }
    if (points.length >= 2) {
      walls.push(points);
    } else {
      polysRejetees++;
    }
  }

  if (polysRejetees > 0) {
    warnings.push(
      `${polysRejetees} polyligne(s) de mur ignorée(s) sur ${losList.length} : ` +
        `moins de deux points exploitables (attendu des objets {x, y} numériques).`
    );
  }
  if (pointsRejetes > 0) {
    warnings.push(
      `${pointsRejetes} point(s) de mur ignoré(s) : coordonnées x/y absentes ou non numériques.`
    );
  }

  // Extraction des portails
  /** @type {Portal[]} */
  const portals = [];
  if (Array.isArray(data.portals)) {
    let portalIdx = 1;
    let portesRejetees = 0;
    for (const p of data.portals) {
      // Seule la forme `bounds: [a, b]` est reconnue. Un exportateur qui décrit ses portes
      // autrement les perdait toutes en silence, et la carte s'affichait sans porte comme
      // si elle n'en avait pas — indistinguable d'une carte réellement sans porte.
      if (!p || !Array.isArray(p.bounds) || p.bounds.length < 2) {
        portesRejetees++;
        continue;
      }
      const ptA = p.bounds[0];
      const ptB = p.bounds[1];
      if (
        !ptA || !ptB ||
        typeof ptA.x !== 'number' || typeof ptA.y !== 'number' ||
        typeof ptB.x !== 'number' || typeof ptB.y !== 'number'
      ) {
        portesRejetees++;
        continue;
      }
      portals.push({
        id: p.id || `portal-${portalIdx++}`,
        a: { cellX: ptA.x, cellY: ptA.y },
        b: { cellX: ptB.x, cellY: ptB.y },
        state: p.closed === false ? 'open' : 'closed',
        closed: p.closed ?? true,
        freestanding: p.freestanding ?? false,
      });
    }
    if (portesRejetees > 0) {
      warnings.push(
        `${portesRejetees} porte(s) ignorée(s) sur ${data.portals.length} : ` +
          `forme non reconnue (attendu bounds: [{x, y}, {x, y}]).`
      );
    }
  }

  // Extraction des lumières
  /** @type {Light[]} */
  const lights = [];
  if (Array.isArray(data.lights)) {
    let lightIdx = 1;
    let lumieresRejetees = 0;
    let lumieresNormalisees = 0;
    for (const l of data.lights) {
      if (
        !l || !l.position ||
        typeof l.position.x !== 'number' ||
        typeof l.position.y !== 'number'
      ) {
        lumieresRejetees++;
        continue;
      }
      const lightId = l.id || `light-${lightIdx++}`;
      const parsedColor = parseUvttColor(l.color);
      if (parsedColor.warning) {
        warnings.push(`Lumière "${lightId}" : ${parsedColor.warning}`);
      }
      const rawRange = l.range ?? 5;
      const rawIntensity = l.intensity ?? 1;
      const range = Number.isFinite(rawRange) ? Math.min(Math.max(rawRange, 0), 20) : 5;
      const intensity = Number.isFinite(rawIntensity) ? Math.min(Math.max(rawIntensity, 0), 1) : 1;
      if (range !== rawRange || intensity !== rawIntensity) lumieresNormalisees++;
      lights.push({
        id: lightId,
        at: { cellX: l.position.x, cellY: l.position.y },
        range,
        intensity,
        color: parsedColor.color,
        shadows: l.shadows ?? true,
      });
    }
    if (lumieresRejetees > 0) {
      warnings.push(
        `${lumieresRejetees} lumière(s) ignorée(s) sur ${data.lights.length} : ` +
        `position absente ou non numérique (attendu position: {x, y}).`
      );
    }
    if (lumieresNormalisees > 0) {
      warnings.push(
        `${lumieresNormalisees} lumière(s) normalisée(s) vers les bornes du moteur ` +
          '(portée 0..20 cases, intensité 0..1).'
      );
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
