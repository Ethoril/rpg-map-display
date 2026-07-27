// @ts-check

/**
 * @typedef {Object} CalibrationParams
 * @property {{ x?: number, y?: number, w: number, h?: number }} rectPx Rectangle de sélection en pixels carte
 * @property {number} cellsWide Nombre de cases en largeur
 * @property {number} [cellsHigh] Nombre de cases en hauteur (optionnel)
 * @property {{ w: number, h: number }} [imageSize] Dimensions totales de l'image
 */

/**
 * Calibre une image simple (source B) à partir d'un rectangle de sélection.
 *
 * @param {CalibrationParams} params
 * @returns {{ pxPerCell: number, offsetX: number, offsetY: number, widthCells: number, heightCells: number }}
 */
export function calibrateFromRect(params) {
  const { rectPx, cellsWide, cellsHigh, imageSize } = params;
  if (!rectPx || !cellsWide || cellsWide <= 0) {
    throw new Error('Paramètres de calibration invalides');
  }

  const pxPerCell = rectPx.w / cellsWide;
  const offsetX = rectPx.x ?? 0;
  const offsetY = rectPx.y ?? 0;

  let widthCells = 0;
  let heightCells = 0;
  if (imageSize) {
    widthCells = Math.round(imageSize.w / pxPerCell);
    heightCells = Math.round(imageSize.h / pxPerCell);
  } else if (cellsHigh) {
    widthCells = cellsWide;
    heightCells = cellsHigh;
  }

  return {
    pxPerCell,
    offsetX,
    offsetY,
    widthCells,
    heightCells,
  };
}

/**
 * Calibre une image simple à partir de clics / rectangle de sélection (source B).
 *
 * @param {any} arg1 Premier point/rectangle ou objet de paramètres
 * @param {any} [arg2] Deuxième point ou nombre de cases
 * @param {number} [cellsCount] Nombre de cases
 * @param {number} [imageWidth] Largeur totale image
 * @param {number} [imageHeight] Hauteur totale image
 */
export function calibrateImage(arg1, arg2, cellsCount, imageWidth, imageHeight) {
  if (typeof arg1 === 'object' && arg1 !== null) {
    if ('rectPx' in arg1 || ('w' in arg1 && !('x' in arg1 && 'y' in arg1))) {
      const rectPx = 'rectPx' in arg1 ? arg1.rectPx : arg1;
      const cellsWide = 'cellsWide' in arg1 ? arg1.cellsWide : cellsCount ?? 1;
      const imageSize = 'imageSize' in arg1 ? arg1.imageSize : (imageWidth && imageHeight ? { w: imageWidth, h: imageHeight } : undefined);
      return calibrateFromRect({ rectPx, cellsWide, imageSize });
    }
  }

  // Clics 2 points: arg1={x,y}, arg2={x,y}
  const p1 = arg1;
  const p2 = arg2;
  if (!p1 || !p2 || typeof p1.x !== 'number' || typeof p2.x !== 'number' || !cellsCount || cellsCount <= 0) {
    throw new Error('Points de clics ou nombre de cases invalides');
  }

  const dx = Math.abs(p2.x - p1.x);
  const dy = Math.abs(p2.y - p1.y);
  const distPx = Math.hypot(dx, dy);
  const pxPerCell = distPx / cellsCount;

  const minX = Math.min(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const offsetX = minX % pxPerCell;
  const offsetY = minY % pxPerCell;

  const widthCells = imageWidth ? Math.round(imageWidth / pxPerCell) : 0;
  const heightCells = imageHeight ? Math.round(imageHeight / pxPerCell) : 0;

  return {
    pxPerCell,
    offsetX,
    offsetY,
    widthCells,
    heightCells,
  };
}
