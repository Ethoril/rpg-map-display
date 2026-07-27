// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUvtt } from '../js/import/uvtt.js';
import { createCampaign, validateCampaign } from '../js/core/schema.js';
import { resample } from './resample.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * CLI principal d'import UVTT.
 * Usage : node scripts/import-uvtt.mjs <uvttPath> [targetPxPerCell]
 */
export async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage : node scripts/import-uvtt.mjs <uvttPath> [targetPxPerCell]');
    process.exit(1);
  }

  const uvttPath = path.resolve(args[0]);
  const targetPxPerCell = args[1] ? Number(args[1]) : 140;

  if (!fs.existsSync(uvttPath)) {
    console.error(`Fichier introuvable : ${uvttPath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(uvttPath, 'utf-8');
  const uvttData = JSON.parse(fileContent);

  const { level, imageBase64, warnings: parseWarnings } = parseUvtt(uvttData);

  const baseName = path.basename(uvttPath, path.extname(uvttPath));
  const mapsDir = path.join(rootDir, 'maps');
  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }

  const webpFileName = `${baseName}.webp`;
  const webpPath = path.join(mapsDir, webpFileName);

  const resampleResult = await resample(imageBase64, targetPxPerCell, {
    sourcePxPerCell: uvttData.resolution?.pixels_per_grid,
    widthCells: level.widthCells,
    heightCells: level.heightCells,
    outputPath: webpPath,
  });

  const originX = uvttData.resolution?.map_origin?.x ?? 0;
  const originY = uvttData.resolution?.map_origin?.y ?? 0;

  level.pxPerCell = resampleResult.pxPerCell;
  level.imageUrl = `maps/${webpFileName}`;
  level.grid.offsetX = originX * resampleResult.pxPerCell;
  level.grid.offsetY = originY * resampleResult.pxPerCell;

  const campaign = createCampaign({
    campaignId: `campaign-${baseName}`,
    name: level.name || baseName,
    levels: [level],
  });

  const errors = validateCampaign(campaign);
  if (errors.length > 0) {
    console.error('Erreur de validation de la campagne :', errors.join('\n'));
    process.exit(1);
  }

  const jsonFileName = `${baseName}.json`;
  const jsonPath = path.join(mapsDir, jsonFileName);
  fs.writeFileSync(jsonPath, JSON.stringify(campaign, null, 2), 'utf-8');

  const allWarnings = [...parseWarnings, ...resampleResult.warnings];
  if (allWarnings.length > 0) {
    console.log('Avertissements :');
    for (const w of allWarnings) {
      console.log(` - ${w}`);
    }
  }

  console.log(`Import réussi pour "${baseName}" :`);
  console.log(` - Image WebP : maps/${webpFileName} (${resampleResult.width}x${resampleResult.height}px, ${resampleResult.pxPerCell}px/case)`);
  console.log(` - Document de scène : maps/${jsonFileName}`);

  return { campaign, webpPath, jsonPath, warnings: allWarnings };
}

// Si le script est exécuté directement depuis la ligne de commande
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error('Erreur lors de l\'import UVTT :', err);
    process.exit(1);
  });
}
