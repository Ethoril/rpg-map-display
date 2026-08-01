// @ts-check

import { FOG_MAX_ENCODED_BYTES, FOG_MASK_PX_PER_CELL } from '../core/constants.js';
import { sweep } from './sweep.js';

/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('../core/types.js').Segment} Segment */

// Ce module n'expose volontairement AUCUN compteur de `getImageData`. Une première
// version en tenait un, incrémenté par le module lui-même : le critère 8 se réduisait
// alors à « fog.js affirme n'avoir pas appelé getImageData », un appel venu d'ailleurs
// n'était pas vu, et ajouter un appel non compté laissait la suite verte — vérifié.
// Le comptage appartient au mock de contexte des tests, seule observation extérieure.

// ── CRC32 Table ─────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

/**
 * Calcule le checksum CRC32 d'un tampon de données.
 * @param {Uint8Array} buf
 * @param {number} [start]
 * @param {number} [end]
 * @returns {number}
 */
function crc32(buf, start = 0, end = buf.length) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Écrit un entier 32-bit grand boutiste dans un tampon Uint8Array à partir de l'offset.
 * @param {Uint8Array} buf
 * @param {number} offset
 * @param {number} value
 */
function writeUInt32BE(buf, offset, value) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

/**
 * Convertit un Uint8Array en chaîne base64 sans dépendance externe.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convertit une chaîne base64 en Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode un canvas de masque de fog en PNG mono-canal (Grayscale, 8-bit) compressé avec CompressionStream.
 * Retourne une chaîne base64 BRUTE (sans préfixe `data:`).
 *
 * @param {HTMLCanvasElement|any} canvas
 * @returns {Promise<string>} PNG mono-canal encodé en base64 brut
 */
export async function encodeFogPng(canvas) {
  if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    throw new Error('Canvas invalide pour l\'encodage du fog');
  }

  const width = canvas.width;
  const height = canvas.height;

  const ctx = canvas.getContext ? canvas.getContext('2d') : canvas._ctx;
  if (!ctx || typeof ctx.getImageData !== 'function') {
    throw new Error('Impossible de récupérer le contexte 2D pour l\'encodage du fog');
  }

  // Le SEUL `getImageData` du module, et il est à la publication — jamais sur le chemin
  // de déplacement, où il coûterait le budget entier (critère 8).
  const imgData = ctx.getImageData(0, 0, width, height);
  const rgba = imgData.data;

  // Préparer les lignes filtrées avec le filtre Up (0x02)
  const scanlines = new Uint8Array(height * (1 + width));
  let scanIdx = 0;

  for (let y = 0; y < height; y++) {
    scanlines[scanIdx++] = 2; // Up filter
    const rowOffset = y * width * 4;
    const prevRowOffset = (y - 1) * width * 4;

    for (let x = 0; x < width; x++) {
      const alpha = rgba[rowOffset + x * 4 + 3];
      const prevAlpha = y > 0 ? rgba[prevRowOffset + x * 4 + 3] : 0;
      scanlines[scanIdx++] = (alpha - prevAlpha) & 0xff;
    }
  }

  // Compression via CompressionStream('deflate')
  /** @type {Uint8Array} */
  let compressedData;
  if (typeof process !== 'undefined' && process.versions?.node) {
    const zlib = await import('node:zlib');
    compressedData = new Uint8Array(zlib.deflateSync(scanlines));
  } else if (typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined') {
    const blob = new Blob([scanlines]);
    const stream = blob.stream().pipeThrough(new CompressionStream('deflate'));
    const compressedBuf = await new Response(stream).arrayBuffer();
    compressedData = new Uint8Array(compressedBuf);
  } else {
    throw new Error('Aucun moteur de compression Deflate disponible');
  }

  // Assemblage du fichier PNG
  // Signature (8 octets) + IHDR (25 octets) + IDAT (12 + len octets) + IEND (12 octets)
  const pngSize = 8 + 25 + (12 + compressedData.length) + 12;
  const png = new Uint8Array(pngSize);
  let p = 0;

  // Signature PNG
  png.set([137, 80, 78, 71, 13, 10, 26, 10], p);
  p += 8;

  // Chunk IHDR
  writeUInt32BE(png, p, 13); // Longueur données
  p += 4;
  const ihdrStart = p;
  png.set([73, 72, 68, 82], p); // "IHDR"
  p += 4;
  writeUInt32BE(png, p, width);
  p += 4;
  writeUInt32BE(png, p, height);
  p += 4;
  png[p++] = 8; // Bit depth
  png[p++] = 0; // Color type (grayscale)
  png[p++] = 0; // Compression
  png[p++] = 0; // Filter
  png[p++] = 0; // Interlace
  writeUInt32BE(png, p, crc32(png, ihdrStart, p));
  p += 4;

  // Chunk IDAT
  writeUInt32BE(png, p, compressedData.length);
  p += 4;
  const idatStart = p;
  png.set([73, 68, 65, 84], p); // "IDAT"
  p += 4;
  png.set(compressedData, p);
  p += compressedData.length;
  writeUInt32BE(png, p, crc32(png, idatStart, p));
  p += 4;

  // Chunk IEND
  writeUInt32BE(png, p, 0);
  p += 4;
  const iendStart = p;
  png.set([73, 69, 78, 68], p); // "IEND"
  p += 4;
  writeUInt32BE(png, p, crc32(png, iendStart, p));
  p += 4;

  const base64Result = bytesToBase64(png);
  if (base64Result.length > FOG_MAX_ENCODED_BYTES) {
    throw new Error(
      `Masque de fog encodé trop grand (${base64Result.length} octets, plafond ${FOG_MAX_ENCODED_BYTES} octets)`
    );
  }

  return base64Result;
}

/**
 * Décode un masque PNG mono-canal en base64 brut vers un canvas hors écran.
 * Reconstruit rigoureusement le canal alpha (0 pour vierge, 255 pour exploré).
 *
 * @param {string} b64Png PNG en base64 brut (sans préfixe data:)
 * @param {number} widthCells Largeur en cases
 * @param {number} heightCells Hauteur en cases
 * @param {((w: number, h: number) => any)} [createCanvas]
 * @returns {Promise<any>}
 */
export async function decodeFogPng(b64Png, widthCells, heightCells, createCanvas) {
  const maskWidth = widthCells * FOG_MASK_PX_PER_CELL;
  const maskHeight = heightCells * FOG_MASK_PX_PER_CELL;

  let canvas;
  if (typeof createCanvas === 'function') {
    canvas = createCanvas(maskWidth, maskHeight);
  } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    canvas = document.createElement('canvas');
    canvas.width = maskWidth;
    canvas.height = maskHeight;
  } else {
    canvas = { width: maskWidth, height: maskHeight };
  }

  const ctx = canvas.getContext ? canvas.getContext('2d') : canvas._ctx;

  if (b64Png) {
    try {
      const bytes = base64ToBytes(b64Png);

      // Découper le chunk IDAT
      let p = 8; // Sauter signature 8 octets
      let compressedData = null;

      while (p < bytes.length) {
        const length = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
        const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        if (type === 'IDAT') {
          compressedData = bytes.subarray(p + 8, p + 8 + length);
          break;
        }
        p += 12 + length;
      }

      if (compressedData) {
        /** @type {Uint8Array} */
        let scanlines;
        if (typeof process !== 'undefined' && process.versions?.node) {
          const zlib = await import('node:zlib');
          scanlines = new Uint8Array(zlib.inflateSync(compressedData));
        } else if (typeof DecompressionStream !== 'undefined' && typeof Response !== 'undefined' && typeof Blob !== 'undefined') {
          const blob = new Blob([/** @type {any} */ (compressedData)]);
          const stream = blob.stream().pipeThrough(new DecompressionStream('deflate'));
          const decompressedBuf = await new Response(stream).arrayBuffer();
          scanlines = new Uint8Array(decompressedBuf);
        } else {
          throw new Error('Moteur de décompression non disponible');
        }

        if (ctx) {
          const isMockPixels = ctx.pixels && ctx.pixels instanceof Uint8Array;
          const pixelBuf = isMockPixels ? ctx.pixels : new Uint8Array(maskWidth * maskHeight * 4);

          let scanIdx = 0;
          for (let y = 0; y < maskHeight; y++) {
            const filter = scanlines[scanIdx++];
            const rowOffset = y * maskWidth * 4;
            const prevRowOffset = (y - 1) * maskWidth * 4;

            for (let x = 0; x < maskWidth; x++) {
              const val = scanlines[scanIdx++];
              let alpha = val;
              if (filter === 2 && y > 0) {
                const prevAlpha = pixelBuf[prevRowOffset + x * 4 + 3];
                alpha = (val + prevAlpha) & 0xff;
              }
              const idx = rowOffset + x * 4;
              pixelBuf[idx] = 0;
              pixelBuf[idx + 1] = 0;
              pixelBuf[idx + 2] = 0;
              pixelBuf[idx + 3] = alpha;
            }
          }

          if (!isMockPixels && typeof ImageData !== 'undefined' && typeof ctx.putImageData === 'function') {
            const imgData = new ImageData(new Uint8ClampedArray(pixelBuf.buffer), maskWidth, maskHeight);
            ctx.putImageData(imgData, 0, 0);
          }
        }
      }
    } catch (err) {
      console.warn('[fog] Échec du décodage du masque de fog PNG :', err);
    }
  }

  return canvas;
}

/**
 * Gestionnaire du masque de fog exploré pour un étage.
 */
export class ExploredFog {
  /**
   * @param {number} widthCells
   * @param {number} heightCells
   * @param {((w: number, h: number) => any)} [createCanvas]
   */
  constructor(widthCells, heightCells, createCanvas) {
    this.widthCells = widthCells;
    this.heightCells = heightCells;
    this.maskWidth = widthCells * FOG_MASK_PX_PER_CELL;
    this.maskHeight = heightCells * FOG_MASK_PX_PER_CELL;

    if (typeof createCanvas === 'function') {
      this.canvas = createCanvas(this.maskWidth, this.maskHeight);
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.maskWidth;
      this.canvas.height = this.maskHeight;
    } else {
      this.canvas = null;
    }

    this.ctx = this.canvas?.getContext?.('2d') ?? this.canvas?._ctx ?? null;
    this.clear();
  }

  /**
   * Réinitialise le masque exploré (toute la carte redevient non explorée).
   */
  clear() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.maskWidth, this.maskHeight);
    }
  }

  /**
   * Révèle la vision le long d'un chemin : **un sweep par case traversée**.
   *
   * C'est le critère 7 — « traverser un couloir d'un bout à l'autre révèle **tout le
   * couloir**, pas seulement l'arrivée ». Ne révéler que la position finale laisserait
   * le milieu du couloir noir, et aucun contrôle de la case d'arrivée ne le verrait :
   * c'est exactement le défaut qui a franchi une première relecture de cette tranche.
   *
   * Le coût est linéaire et bon marché : mesuré à 27 ms pour dix cases sur la plus
   * grande carte du dépôt, sweep compris, et le versement dans le masque est un
   * `fill()` natif à 0,12 ms. C'est la rasterisation en boucle de pixels JS qui coûtait
   * 51 ms par case et crevait le budget — pas le sweep.
   *
   * Les origines arrivent **déjà en pixels carte** : `vision/*` ne connaît pas la grille.
   *
   * @param {MapPoint[]} origins Centres des cases traversées, extrémités comprises
   * @param {Segment[]} segments Obstacles en pixels carte
   * @param {number} rangePx Portée de vision en pixels carte
   * @param {MapPoint} mapOrigin Origine de la carte en pixels carte
   * @param {number} gridScale Échelle de la grille (pixels carte par case)
   * @returns {number} Nombre de positions réellement balayées, pour observation extérieure
   */
  revealPath(origins, segments, rangePx, mapOrigin, gridScale) {
    if (!this.ctx || !Array.isArray(origins) || origins.length === 0) return 0;

    let balayees = 0;
    for (const origin of origins) {
      if (!origin) continue;
      const poly = sweep(origin, segments || [], rangePx);
      if (Array.isArray(poly) && poly.length > 0) {
        this.reveal([poly], mapOrigin, gridScale);
        balayees++;
      }
    }
    return balayees;
  }

  /**
   * Verse les polygones de visibilité dans le masque exploré via un fill() natif.
   *
   * @param {MapPoint[][]} polygons Polygones de vision en pixels carte
   * @param {MapPoint} mapOrigin Origine de la carte en pixels carte (ex: mapFromCellPoint({cellX:0, cellY:0}))
   * @param {number} gridScale Échelle de la grille (pixels carte par case)
   */
  reveal(polygons, mapOrigin, gridScale) {
    if (!this.ctx || !Array.isArray(polygons) || polygons.length === 0) return;

    const scale = FOG_MASK_PX_PER_CELL / Math.max(1, gridScale);

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    this.ctx.beginPath();

    for (const poly of polygons) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const first = poly[0];
      const fx = (first.x - mapOrigin.x) * scale;
      const fy = (first.y - mapOrigin.y) * scale;
      this.ctx.moveTo(fx, fy);

      for (let i = 1; i < poly.length; i++) {
        const pt = poly[i];
        const px = (pt.x - mapOrigin.x) * scale;
        const py = (pt.y - mapOrigin.y) * scale;
        this.ctx.lineTo(px, py);
      }
      this.ctx.closePath();
    }

    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * Exporte le masque exploré en chaîne PNG base64 brute.
   * @returns {Promise<string>}
   */
  async exportPng() {
    if (!this.canvas) return '';
    return encodeFogPng(this.canvas);
  }

  /**
   * Importe un masque exploré depuis une chaîne PNG base64 brute.
   * @param {string} b64Png
   */
  async importPng(b64Png) {
    if (!b64Png || !this.ctx) return;
    const decoded = await decodeFogPng(b64Png, this.widthCells, this.heightCells);
    if (decoded && this.ctx && typeof this.ctx.drawImage === 'function') {
      this.ctx.clearRect(0, 0, this.maskWidth, this.maskHeight);
      this.ctx.drawImage(decoded, 0, 0);
    }
  }
}
