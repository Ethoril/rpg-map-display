// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';
import webpFormat from '@jimp/wasm-webp';

/**
 * Plafond de dimension des images préparées, en pixels.
 *
 * **À ne pas confondre avec `MAX_TEXTURE_FALLBACK` de `js/core/constants.js`**, qui
 * est le repli du runtime quand la limite WebGL du GPU ne peut pas être interrogée.
 * Celui-ci est un budget de préparation côté Node — même raisonnement que le plafond
 * de décodage du chantier E, qui n'a délibérément pas sa place dans le modèle partagé.
 *
 * **La règle qui les lie** : ce plafond ne doit jamais dépasser la limite du plus
 * faible appareil du parc, sans quoi on prépare des cartes qu'un écran ne peut pas
 * afficher. 8192 est la valeur **mesurée** sur la Samsung Galaxy Tab S9 FE, seul
 * appareil joueur. Le relever encore exige une nouvelle mesure, pas une estimation.
 */
export const MAX_PREPARED_TEXTURE_PX = 8192;

/**
 * Plafonds de décodage JPEG, relevés au-delà des défauts de `jpeg-js`.
 *
 * Les défauts (100 MP, 512 Mio) refusent un export Dungeondraft à 150 px/case d'à
 * peine 65x71 cases : 9750x10650 fait 103,8 MP. Les deux plafonds comptent — lever
 * le seul plafond de résolution laisse échouer sur la mémoire, mesuré entre 1024 et
 * 1536 Mio pour cette image.
 */
const JPEG_DECODE_OPTIONS = {
  'image/jpeg': { maxResolutionInMP: 512, maxMemoryUsageInMB: 4096 },
};

/**
 * Qualité d'encodage WebP des cartes préparées.
 *
 * L'encodeur `@jimp/wasm-webp` **prend 100 par défaut**, ce qui n'était pas un
 * choix : `encode` était appelé sans options. Mesuré sur `manoir-rdc` en 6720x6300,
 * q100 pèse 10,01 Mio contre 4,87 en q90 — pour une carte qui pesait déjà 4,96 Mio
 * à l'ancien plafond de 4096. Autrement dit, q90 finance intégralement le passage à
 * 8192 : même poids qu'avant, 64 % de résolution linéaire en plus.
 *
 * Un cran plus bas (q80, 3,01 Mio) reste possible, mais les aplats et les dégradés
 * d'eau sont le premier endroit où ça se verrait — à juger sur la tablette, pas ici.
 */
export const WEBP_QUALITY = 90;

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
 * @param {number} [options.maxTexturePx] Plafond de dimension. **Réservé à la comparaison**
 *   de l'outil local : la publication utilise toujours `MAX_PREPARED_TEXTURE_PX`. Un réglage
 *   qu'on peut publier au coup par coup est un réglage qu'un `maps:prepare` ultérieur
 *   écraserait en silence — cf. `docs/CHANTIER-L-OUTIL-CARTES.md` §3.3.
 * @param {number} [options.quality] Qualité WebP, même réserve que `maxTexturePx`.
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
  let jimpError;
  try {
    // `Jimp.read(buffer, options)` **jette les options en silence** : sur une entrée
    // Buffer il délègue à `fromBuffer(url)` sans les transmettre (@jimp/core). Passer
    // par `fromBuffer` est donc obligatoire, sans quoi les plafonds ci-dessus n'ont
    // aucun effet et un export à 150 px/case reste refusé.
    img = await Jimp.fromBuffer(inputBuffer, JPEG_DECODE_OPTIONS);
  } catch (err) {
    jimpError = err;
    try {
      const format = webpFormat();
      const decoded = await format.decode(inputBuffer);
      img = new Jimp({ data: decoded.data, width: decoded.width, height: decoded.height });
    } catch (webpErr) {
      // Les deux causes sont rapportées : ne garder que la première faisait passer
      // un vrai défaut de décodage WebP pour un échec Jimp, et inversement.
      const first = jimpError instanceof Error ? jimpError.message : String(jimpError);
      const second = webpErr instanceof Error ? webpErr.message : String(webpErr);
      throw new Error(
        `Impossible de lire l'image source. Jimp : ${first} — repli WebP : ${second}`
      );
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

  // Deux contraintes réduisent la cible, et elles se combinent en **un seul**
  // facteur d'échelle. Les appliquer l'une après l'autre composerait deux
  // arrondis vers le bas : sur une cible de 20000x16000 ramenée à une source de
  // 640x512, la hauteur sortait à 511 au lieu de 512, et le rapport d'aspect
  // dérivait d'autant. Un seul `floor`, donc.

  // 1. Limite de texture des appareils du parc.
  const maxTexturePx = options.maxTexturePx ?? MAX_PREPARED_TEXTURE_PX;
  const capScale = Math.min(1, maxTexturePx / Math.max(targetWidth, targetHeight));

  // 2. Garde-fou anti-agrandissement : la sortie ne dépasse jamais la source.
  //
  // Sans lui, une source moins dense que la cible est interpolée vers le haut : on
  // paie le poids d'une grande image pour une netteté **inférieure** à celle du
  // fichier d'origine, et rien ne le signale. Le défaut était inerte tant que le
  // plafond valait 4096 ; il devient actif à 8192.
  //
  // Il est ici plutôt que dans une consigne d'export parce qu'une règle que rien
  // n'applique n'est pas un mécanisme — leçon déjà payée sur l'image de pion à
  // déposer à la main, qui affichait des ronds gris sans le moindre message.
  const sourceScale = Math.min(1, srcWidth / targetWidth, srcHeight / targetHeight);

  // `round` puis bornage par la source, plutôt que `floor`. Une source au rapport
  // exact — 4680x5112 pour une cible 9100x9940, soit 72/140 des deux côtés —
  // sortait à 4679x5111 : le facteur d'échelle ne retombe pas sur l'entier en
  // binaire, et `floor` transforme 4679,9999 en un pixel perdu. Le bornage par
  // `srcWidth`/`srcHeight` garde l'invariant « jamais au-delà de la source » que
  // `round` seul ne garantirait pas.
  const scale = Math.min(capScale, sourceScale);
  const finalWidth = Math.max(1, Math.min(srcWidth, Math.round(targetWidth * scale)));
  const finalHeight = Math.max(1, Math.min(srcHeight, Math.round(targetHeight * scale)));

  if (capScale < 1) {
    warnings.push(
      `Image rééchantillonnée (${targetWidth}x${targetHeight}) dépasse la limite de texture (${maxTexturePx}px). Redimensionnement à ${Math.floor(targetWidth * capScale)}x${Math.floor(targetHeight * capScale)}.`
    );
  }

  // N'avertir que si la source est la contrainte **dominante** : sous le plafond,
  // une source plus petite que la cible brute ne prive de rien.
  if (sourceScale < capScale) {
    const sourceDensity =
      widthCells && widthCells > 0 ? (srcWidth / widthCells).toFixed(1) : '?';
    warnings.push(
      `Source moins dense que la cible : ${srcWidth}x${srcHeight} (${sourceDensity} px/case) ` +
        `pour une cible de ${targetWidth}x${targetHeight}. Sortie ramenée à ` +
        `${finalWidth}x${finalHeight} plutôt qu'agrandie — agrandir ajoute du poids, ` +
        `jamais du détail. Réexporter la carte à ${targetPxPerCell} px/case ou plus.`
    );
  }

  let effectivePxPerCell = targetPxPerCell;
  if (widthCells && widthCells > 0) {
    effectivePxPerCell = finalWidth / widthCells;
  }

  img.resize({ w: finalWidth, h: finalHeight });

  const format = webpFormat();
  const outputBuffer = await format.encode(img.bitmap, {
    quality: options.quality ?? WEBP_QUALITY,
  });

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
