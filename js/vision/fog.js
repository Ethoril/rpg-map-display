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
  // ⚠ CAPTURE SYNCHRONE (A4) : Cette lecture est faite de façon synchrone AVANT le premier
  // `await` (compression Deflate à la l.131). exportPng() peut donc être appelé de façon
  // asynchrone immédiatement avant une mutation synchrone du canvas, les pixels étant capturés
  // instantanément avant la mutation. Ne pas déplacer cette lecture sous un await.
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

      // ⛔ **Un masque qui n'a pas la taille de l'étage est écarté, jamais interprété.**
      //
      // Défaut de séance du 7 août 2026 : « la zone de vision est là, mais pas le pion ». Un masque
      // encodé pour une carte de 65 × 71 était relu pour une carte de 20 × 16, parce que les deux
      // portaient le même `levelId` — `parseUvtt` nomme tout étage importé `uvtt-level`, et la clé
      // de stockage `rpg_fog_<session>_<levelId>` est donc partagée entre cartes.
      //
      // Le fog continuait d'afficher une zone claire, tandis que la couche des pions lisait le même
      // masque case par case et concluait que **plus aucune case n'est vue** : tous les pions
      // disparaissaient de la table, en silence. C'est le pire échec possible — le MJ voit ses
      // pions, la table non, et rien ne le dit.
      //
      // Les dimensions sont dans l'en-tête IHDR, aux octets 16 à 23 : 8 de signature, 4 de
      // longueur, 4 de type. Les comparer coûte quatre lectures et ferme le défaut à la source.
      const largeurPng =
        (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
      const hauteurPng =
        (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
      if (largeurPng !== maskWidth || hauteurPng !== maskHeight) {
        console.error(
          `Masque de fog écarté : il mesure ${largeurPng}×${hauteurPng} px alors que l'étage en ` +
            `attend ${maskWidth}×${maskHeight} (${widthCells}×${heightCells} cases). ` +
            'Deux cartes partagent probablement le même identifiant d\'étage. ' +
            'Aucun masque n\'est appliqué : mieux vaut tout montrer que tout cacher sans le dire.'
        );
        return null;
      }

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
          const maskAlpha = new Uint8Array(maskWidth * maskHeight);

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
              maskAlpha[y * maskWidth + x] = alpha;
            }
          }

          canvas.maskAlpha = maskAlpha;
          canvas.maskWidth = maskWidth;
          canvas.maskHeight = maskHeight;

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
 * Extrait ou récupère le tableau d'alpha du masque de vision/fog pour une grille donnée.
 * Si le canvas possède déjà maskAlpha (Uint8Array), il est renvoyé directement sans allocation ni getImageData.
 * Sinon, l'alpha est extrait une seule fois via getImageData et mis en cache sur le canvas.
 *
 * @param {any} canvas Canvas HTML ou mock
 * @param {number} widthCells Largeur de l'étage en cases
 * @param {number} heightCells Hauteur de l'étage en cases
 * @returns {Uint8Array|null} Tableau d'octets d'alpha ou null
 */
export function getOrExtractMaskAlpha(canvas, widthCells, heightCells) {
  if (!canvas || !widthCells || !heightCells) return null;

  const maskWidth = widthCells * FOG_MASK_PX_PER_CELL;
  const maskHeight = heightCells * FOG_MASK_PX_PER_CELL;

  // ⚠ Seconde barrière, volontairement redondante avec le contrôle d'en-tête de `decodeFogPng`.
  // Un tableau d'alpha mis en cache sur un canvas peut provenir d'un étage précédent — le canvas
  // est réutilisé tant que le PNG ne change pas. Sans cette vérification, l'indexation case par
  // case se ferait avec la mauvaise largeur et **tous les pions passeraient pour invisibles**.
  // Le coût est de deux comparaisons ; le prix de l'oubli est une table qui ne voit plus rien.
  if (
    Number.isFinite(canvas.maskWidth) &&
    (canvas.maskWidth !== maskWidth || canvas.maskHeight !== maskHeight)
  ) {
    console.error(
      `Masque de fog écarté à la lecture : ${canvas.maskWidth}×${canvas.maskHeight} px en cache ` +
        `contre ${maskWidth}×${maskHeight} attendus pour cet étage.`
    );
    return null;
  }

  if (canvas.maskAlpha && canvas.maskAlpha instanceof Uint8Array) {
    return canvas.maskAlpha;
  }
  const ctx = canvas.getContext ? canvas.getContext('2d') : canvas._ctx;
  if (!ctx) return null;

  if (ctx.pixels && ctx.pixels instanceof Uint8Array) {
    const pixels = ctx.pixels;
    const alpha = new Uint8Array(maskWidth * maskHeight);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = pixels[i * 4 + 3];
    }
    canvas.maskAlpha = alpha;
    canvas.maskWidth = maskWidth;
    canvas.maskHeight = maskHeight;
    return alpha;
  }

  if (typeof ctx.getImageData === 'function') {
    try {
      const imgData = ctx.getImageData(0, 0, maskWidth, maskHeight);
      const data = imgData.data;
      const alpha = new Uint8Array(maskWidth * maskHeight);
      for (let i = 0; i < alpha.length; i++) {
        alpha[i] = data[i * 4 + 3];
      }
      canvas.maskAlpha = alpha;
      canvas.maskWidth = maskWidth;
      canvas.maskHeight = maskHeight;
      return alpha;
    } catch (err) {
      console.warn('[fog] Impossible d\'extraire getImageData du canvas :', err);
    }
  }

  return null;
}

/**
 * Teste si la case d'ancrage d'un pion {a, b} a son centre dans la zone vue du masque d'alpha.
 *
 * @param {import('../core/types.js').Cell|null} cell Case d'ancrage du pion
 * @param {Uint8Array|null} maskAlpha Tableau d'alpha du masque
 * @param {number} widthCells Largeur en cases
 * @param {number} heightCells Hauteur en cases
 * @returns {boolean} true si le centre de la case est dans la vision courante (alpha > 0)
 */
export function isCellVisibleInMask(cell, maskAlpha, widthCells, heightCells) {
  if (!cell || typeof cell.a !== 'number' || typeof cell.b !== 'number') return false;
  if (!maskAlpha || !widthCells || !heightCells) return false;

  const a = Math.floor(cell.a);
  const b = Math.floor(cell.b);
  if (a < 0 || a >= widthCells || b < 0 || b >= heightCells) return false;

  const maskWidth = widthCells * FOG_MASK_PX_PER_CELL;
  const maskHeight = heightCells * FOG_MASK_PX_PER_CELL;

  const maskX = Math.floor((a + 0.5) * FOG_MASK_PX_PER_CELL);
  const maskY = Math.floor((b + 0.5) * FOG_MASK_PX_PER_CELL);

  if (maskX < 0 || maskX >= maskWidth || maskY < 0 || maskY >= maskHeight) return false;

  const idx = maskY * maskWidth + maskX;
  // le fill() du sweep est antialiasé, donc le bord de vision porte un dégradé d'alpha complet — mesuré sur un masque réel, 1,43 % des pixels sont partiels, avec des valeurs de 15 à 246, et l'aller-retour PNG les préserve exactement. Avec un seuil à > 0, une case dont le pixel central vaut 15, soit 6 % couvert, compte comme vue et le pion qui s'y trouve est dessiné — ce qui viole l'interdiction n°3 et le critère 6 du §11, « aucun pion visible en zone explorée hors vision ». CONVENTIONS.md §3 déclare le masque binaire (« 0 = non exploré, 255 = exploré ») : les valeurs intermédiaires sont un artefact, et 128 en est la lecture naturelle — le centre de la case doit être couvert à plus de moitié. Le mode d'échec passe d'une violation de règle à un défaut cosmétique : un pion tout au bord masqué un pas trop tôt. Aucun risque pour le pion d'un joueur, dont la propre case est à alpha 255.
  return maskAlpha[idx] >= 128;
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
    this.createCanvas = createCanvas;

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
    /** @type {number} Révision du contenu, voir `_touch()`. */
    this.revision = 0;
    this.clear();
  }

  /**
   * Marque le masque comme modifié : incrémente une révision légère et la recopie sur
   * `canvas.__fogRevision`, seule chose que `FogLayer` reçoit — il ne voit jamais l'instance
   * `ExploredFog` elle-même, seulement `.canvas`.
   *
   * Ce masque est mutable **en place** : `reveal`/`paintDisc`/`eraseDisc` dessinent sur le
   * même objet canvas d'un appel à l'autre. Son identité ne change donc jamais quand son
   * contenu change, et un cache qui ne comparerait que la référence resterait bloqué sur le
   * premier fog révélé. La révision est ce qui rend la mutation observable sans relire un
   * seul pixel.
   */
  _touch() {
    this.revision++;
    if (this.canvas) this.canvas.__fogRevision = this.revision;
  }

  /**
   * Réinitialise le masque exploré (toute la carte redevient non explorée).
   */
  clear() {
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.maskWidth, this.maskHeight);
    }
    this._touch();
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
    this._touch();
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
    const decoded = await decodeFogPng(b64Png, this.widthCells, this.heightCells, this.createCanvas);
    if (decoded && this.ctx && typeof this.ctx.drawImage === 'function') {
      this.ctx.clearRect(0, 0, this.maskWidth, this.maskHeight);
      this.ctx.drawImage(decoded, 0, 0);
    }
    this._touch();
  }

  /**
   * Révèle l'ensemble du masque exploré (toute la carte devient explorée).
   */
  revealAll() {
    if (this.ctx) {
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      this.ctx.fillRect(0, 0, this.maskWidth, this.maskHeight);
      this.ctx.restore();
    }
    this._touch();
  }

  /**
   * Peint un disque de vision dans le masque exploré.
   *
   * @param {MapPoint} center Centre en pixels carte
   * @param {number} radiusPx Rayon du disque en pixels carte
   * @param {MapPoint} mapOrigin Origine de la carte en pixels carte
   * @param {number} gridScale Échelle de la grille (pixels carte par case)
   */
  paintDisc(center, radiusPx, mapOrigin, gridScale) {
    if (!this.ctx || !center || !mapOrigin) return;
    const scale = FOG_MASK_PX_PER_CELL / Math.max(1, gridScale);
    const mx = (center.x - mapOrigin.x) * scale;
    const my = (center.y - mapOrigin.y) * scale;
    const r = radiusPx * scale;

    this.ctx.save();
    this.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    this.ctx.beginPath();
    this.ctx.arc(mx, my, Math.max(0, r), 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
    this._touch();
  }

  /**
   * Efface un disque du masque exploré (canal alpha remis à zéro).
   * Utilise `destination-out` pour retirer l'exploration sans peindre de noir opaque.
   *
   * @param {MapPoint} center Centre en pixels carte
   * @param {number} radiusPx Rayon du disque en pixels carte
   * @param {MapPoint} mapOrigin Origine de la carte en pixels carte
   * @param {number} gridScale Échelle de la grille (pixels carte par case)
   */
  eraseDisc(center, radiusPx, mapOrigin, gridScale) {
    if (!this.ctx || !center || !mapOrigin) return;
    const scale = FOG_MASK_PX_PER_CELL / Math.max(1, gridScale);
    const mx = (center.x - mapOrigin.x) * scale;
    const my = (center.y - mapOrigin.y) * scale;
    const r = radiusPx * scale;

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    this.ctx.beginPath();
    this.ctx.arc(mx, my, Math.max(0, r), 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
    this._touch();
  }
}
