// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import webpFormat from '@jimp/wasm-webp';
import { MAX_TEXTURE_FALLBACK } from '../js/core/constants.js';

// Patch fetch pour le chargement des modules WASM dans Node.js pour file://
const originalFetch = globalThis.fetch;
if (originalFetch) {
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.startsWith('file:')) {
      const filePath = fileURLToPath(urlStr);
      const buffer = fs.readFileSync(filePath);
      return new Response(buffer, { headers: { 'content-type': 'application/wasm' } });
    }
    return originalFetch(url, options);
  };
}

/**
 * Rééchantillonne une image (chemin de fichier, chaîne base64 ou Buffer) au format WebP avec Jimp.
 *
 * @param {string | Buffer} input Chemin de fichier, chaîne base64 ou Buffer d'image
 * @param {number} [targetPxPerCell=140] Résolution cible en pixels par case
 * @param {object} [options]
 * @param {number} [options.sourcePxPerCell] Résolution source en pixels par case (si connue)
 * @param {number} [options.widthCells] Largeur de la carte en cases
 * @param {number} [options.heightCells] Hauteur de la carte en cases
 * @param {string} [options.outputPath] Chemin optionnel pour enregistrer le fichier WebP
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, pxPerCell: number, warnings: string[] }>}
 */
export async function resample(input, targetPxPerCell = 140, options = {}) {
  /** @type {Buffer} */
  let inputBuffer;
  /** @type {string[]} */
  const warnings = [];

  if (typeof input === 'string') {
    if (fs.existsSync(input)) {
      inputBuffer = fs.readFileSync(input);
    } else {
      const cleanBase64 = input.replace(/^data:image\/\w+;base64,/, '');
      inputBuffer = Buffer.from(cleanBase64, 'base64');
    }
  } else if (Buffer.isBuffer(input)) {
    inputBuffer = input;
  } else {
    throw new Error('Entrée d\'image invalide : string ou Buffer attendu');
  }

  /** @type {any} */
  let img;
  try {
    img = await Jimp.read(inputBuffer);
  } catch (err) {
    try {
      const format = webpFormat();
      const decoded = await format.decode(inputBuffer);
      img = new Jimp({ data: decoded.data, width: decoded.width, height: decoded.height });
    } catch {
      throw new Error(`Impossible de lire l'image source avec Jimp : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const srcWidth = img.width;
  const srcHeight = img.height;

  const { sourcePxPerCell, widthCells, heightCells } = options;

  let targetWidth;
  let targetHeight;

  if (widthCells && heightCells) {
    targetWidth = Math.round(widthCells * targetPxPerCell);
    targetHeight = Math.round(heightCells * targetPxPerCell);
  } else if (sourcePxPerCell && sourcePxPerCell > 0) {
    const scale = targetPxPerCell / sourcePxPerCell;
    targetWidth = Math.round(srcWidth * scale);
    targetHeight = Math.round(srcHeight * scale);
  } else {
    targetWidth = srcWidth;
    targetHeight = srcHeight;
  }

  // Vérification et plafonnement à MAX_TEXTURE_FALLBACK (4096px)
  let finalWidth = targetWidth;
  let finalHeight = targetHeight;

  if (targetWidth > MAX_TEXTURE_FALLBACK || targetHeight > MAX_TEXTURE_FALLBACK) {
    const maxDim = Math.max(targetWidth, targetHeight);
    const scale = MAX_TEXTURE_FALLBACK / maxDim;
    finalWidth = Math.floor(targetWidth * scale);
    finalHeight = Math.floor(targetHeight * scale);
    warnings.push(
      `Image rééchantillonnée (${targetWidth}x${targetHeight}) dépasse la limite de texture (${MAX_TEXTURE_FALLBACK}px). Redimensionnement à ${finalWidth}x${finalHeight}.`
    );
  }

  let effectivePxPerCell = targetPxPerCell;
  if (widthCells && widthCells > 0) {
    effectivePxPerCell = finalWidth / widthCells;
  }

  img.resize({ w: finalWidth, h: finalHeight });

  const format = webpFormat();
  const outputBuffer = await format.encode(img.bitmap);

  if (options.outputPath) {
    const dir = path.dirname(options.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(options.outputPath, outputBuffer);
  }

  return {
    buffer: outputBuffer,
    width: finalWidth,
    height: finalHeight,
    pxPerCell: effectivePxPerCell,
    warnings,
  };
}

export default resample;
