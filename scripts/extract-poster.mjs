// @ts-check
/**
 * Extrait la **première image** d'une vidéo de fond et l'encode en WebP par la même
 * chaîne que les cartes fixes (`resample`), donc au même plafond de texture et à la
 * même qualité.
 *
 * Pourquoi un navigateur : Node ne sait pas décoder du VP9, et aucune dépendance du
 * projet ne le sait non plus. Chromium, lui, le fait nativement — et Playwright est
 * déjà une dépendance de développement. On ne rajoute donc rien à l'arbre.
 *
 * Pourquoi un serveur HTTP local plutôt qu'un `file://` : une vidéo `file://` dessinée
 * sur un canvas le **contamine**, et `toDataURL` lève alors une SecurityError. Servir
 * depuis une origine unique supprime le problème à la racine plutôt que de le contourner.
 *
 * Cette étape est **volontairement séparée** de `prepare-maps.mjs` : la préparation ne
 * doit pas exiger un navigateur. Elle consomme un poster déjà présent, et le réclame
 * bruyamment sinon.
 *
 * Usage : node scripts/extract-poster.mjs <video> <sortie.webp> [--px-par-case N]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resample } from './resample.mjs';

/** @type {Readonly<Record<string, string>>} */
const MIME = Object.freeze({
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
});

/**
 * Sert un fichier unique sur 127.0.0.1, port éphémère.
 *
 * @param {string} filePath
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
async function serveOne(filePath) {
  const body = fs.readFileSync(filePath);
  const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8"><title>poster</title>');
      return;
    }
    if (req.url === '/media') {
      // `Accept-Ranges` absent volontairement : le fichier tient en mémoire et Chromium
      // se contente d'une réponse complète pour une lecture depuis le début.
      res.writeHead(200, { 'content-type': type, 'content-length': String(body.length) });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Serveur local sans port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

/**
 * Décode la première image de la vidéo et rend un PNG à sa résolution native.
 *
 * @param {string} videoPath
 * @returns {Promise<{ png: Buffer, width: number, height: number, duration: number }>}
 */
export async function firstFramePng(videoPath) {
  const { chromium } = await import('@playwright/test');
  const served = await serveOne(videoPath);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${served.url}/`);
    const result = await page.evaluate(async () => {
      /** @type {HTMLVideoElement} */
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = '/media';

      await new Promise((resolve, reject) => {
        video.addEventListener('error', () => reject(new Error(`media error ${video.error?.code}`)), { once: true });
        video.addEventListener('loadeddata', () => resolve(undefined), { once: true });
        setTimeout(() => reject(new Error('timeout loadeddata (60 s)')), 60000);
      });

      // `loadeddata` garantit une image décodée, mais pas forcément celle de t=0 après un
      // seek. On force explicitement le retour au début et on attend `seeked`, sans quoi
      // l'affiche pourrait provenir d'un instant arbitraire de la boucle.
      if (video.currentTime !== 0) {
        await new Promise((resolve, reject) => {
          video.addEventListener('seeked', () => resolve(undefined), { once: true });
          setTimeout(() => reject(new Error('timeout seeked (30 s)')), 30000);
          video.currentTime = 0;
        });
      }

      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) throw new Error('videoWidth/videoHeight nuls : flux non décodé');

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('contexte 2D indisponible');
      ctx.drawImage(video, 0, 0);

      return {
        dataUrl: canvas.toDataURL('image/png'),
        width,
        height,
        duration: video.duration,
      };
    });

    return {
      png: Buffer.from(result.dataUrl.slice('data:image/png;base64,'.length), 'base64'),
      width: result.width,
      height: result.height,
      duration: result.duration,
    };
  } finally {
    await browser.close();
    await served.close();
  }
}

/**
 * Extrait l'affiche et l'écrit en WebP.
 *
 * @param {string} videoPath
 * @param {string} outputPath
 * @param {{ sourcePxPerCell?: number, targetPxPerCell?: number }} [options]
 */
export async function extractPoster(videoPath, outputPath, options = {}) {
  if (!fs.existsSync(videoPath)) throw new Error(`Vidéo introuvable : ${videoPath}`);
  const frame = await firstFramePng(videoPath);

  const result = await resample(frame.png, options.targetPxPerCell ?? 140, {
    sourcePxPerCell: options.sourcePxPerCell,
    outputPath,
  });

  return {
    source: { width: frame.width, height: frame.height, duration: frame.duration },
    output: { width: result.width, height: result.height, pxPerCell: result.pxPerCell },
    warnings: result.warnings ?? [],
    bytes: fs.statSync(outputPath).size,
  };
}

// `URL.pathname` est percent-encodé : un dépôt dans un chemin contenant un espace ou un
// accent rendait la comparaison fausse, et le script devenait un no-op silencieux — exit 0,
// aucune sortie. `fileURLToPath` règle l'encodage et le cas Windows d'un seul coup.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [videoArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const ppcIndex = process.argv.indexOf('--px-par-case');
  const sourcePxPerCell = ppcIndex >= 0 ? Number(process.argv[ppcIndex + 1]) : undefined;

  if (!videoArg || !outArg) {
    console.error('Usage : node scripts/extract-poster.mjs <video> <sortie.webp> [--px-par-case N]');
    process.exit(2);
  }

  const report = await extractPoster(path.resolve(videoArg), path.resolve(outArg), { sourcePxPerCell });
  console.log(`source  : ${report.source.width}x${report.source.height}, ${report.source.duration.toFixed(2)} s`);
  console.log(`affiche : ${report.output.width}x${report.output.height} à ${report.output.pxPerCell} px/case`);
  console.log(`poids   : ${(report.bytes / 1048576).toFixed(2)} Mio`);
  for (const w of report.warnings) console.log(`  ! ${w}`);
}
