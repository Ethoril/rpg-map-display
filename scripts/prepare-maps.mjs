// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseUvtt } from '../js/import/uvtt.js';
import { createCampaign, validateCampaign } from '../js/core/schema.js';
import { resample } from './resample.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Dérive un nom affichable depuis le slug du fichier source.
 *
 * `manoir-rdc` → `Manoir — RDC`, `crypte` → `Crypte`.
 * Les segments courts (≤ 3 lettres) sont traités comme des sigles et mis en
 * capitales, ce qui couvre les usages courants (rdc, r1, sud…).
 *
 * @param {string} slug
 * @returns {string}
 */
export function displayNameFromSlug(slug) {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) =>
      segment.length <= 3
        ? segment.toUpperCase()
        : segment.charAt(0).toUpperCase() + segment.slice(1)
    )
    .join(' — ');
}

/**
 * Prépare une seule carte UVTT.
 * Fonction pure : retourne résultats sans appeler process.exit.
 *
 * @param {string} uvttPath - chemin absolu au fichier .uvtt
 * @param {string} outputDir - dossier cible pour les fichiers générés
 * @param {number} [targetPxPerCell=140] - pixels par case pour le resampling
 * @returns {Promise<{
 *   mapId: string,
 *   name: string,
 *   sourceHash: string,
 *   sceneFile: string,
 *   imageFile: string,
 *   catalogEntry: any,
 *   warnings: string[]
 * }>}
 */
export async function prepareMap(uvttPath, outputDir, targetPxPerCell = 140) {
  if (!fs.existsSync(uvttPath)) {
    throw new Error(`Fichier UVTT introuvable : ${uvttPath}`);
  }

  const fileContent = fs.readFileSync(uvttPath, 'utf-8');
  const sourceHash = crypto
    .createHash('sha256')
    .update(fileContent)
    .digest('hex');

  const uvttData = JSON.parse(fileContent);
  const { level, imageBase64, warnings: parseWarnings } = parseUvtt(uvttData);

  const baseName = path.basename(uvttPath, path.extname(uvttPath));
  const generatedDir = path.join(outputDir, 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const webpFileName = `${baseName}.webp`;
  const webpPath = path.join(generatedDir, webpFileName);

  const resampleResult = await resample(imageBase64, targetPxPerCell, {
    sourcePxPerCell: uvttData.resolution?.pixels_per_grid,
    widthCells: level.widthCells,
    heightCells: level.heightCells,
    outputPath: webpPath,
  });

  const originX = uvttData.resolution?.map_origin?.x ?? 0;
  const originY = uvttData.resolution?.map_origin?.y ?? 0;

  // Le nom porté par l'UVTT prime ; sinon on le dérive du slug du fichier,
  // pour ne jamais afficher un « Carte UVTT » générique dans la bibliothèque.
  const displayName =
    typeof uvttData.name === 'string' && uvttData.name.trim() !== ''
      ? uvttData.name.trim()
      : displayNameFromSlug(baseName);

  level.name = displayName;
  level.pxPerCell = resampleResult.pxPerCell;
  // N'UTILISER PAS data: ou blob: en persistance
  level.imageUrl = `maps/generated/${webpFileName}`;
  level.grid.offsetX = originX * resampleResult.pxPerCell;
  level.grid.offsetY = originY * resampleResult.pxPerCell;

  const campaign = createCampaign({
    campaignId: `campaign-${baseName}`,
    name: displayName,
    levels: [level],
  });

  const errors = validateCampaign(campaign);
  if (errors.length > 0) {
    throw new Error(`Validation échouée pour ${baseName} : ${errors.join('; ')}`);
  }

  const sceneFileName = `${baseName}.scene.json`;
  const scenePath = path.join(generatedDir, sceneFileName);
  fs.writeFileSync(scenePath, JSON.stringify(campaign, null, 2), 'utf-8');

  // Vérifier qu'aucun data: ou blob: ne s'est infiltré
  const sceneContent = fs.readFileSync(scenePath, 'utf-8');
  if (sceneContent.includes('data:') || sceneContent.includes('blob:')) {
    throw new Error(`Scène ${baseName} contient des URLs temporaires (data: ou blob:)`);
  }

  const allWarnings = [...parseWarnings, ...resampleResult.warnings];

  // Les compteurs viennent du parseUvtt déjà fait
  const walls = level.walls;
  const portals = level.portals;
  const lights = level.lights;

  const catalogEntry = {
    id: baseName,
    name: displayName,
    sourceUrl: `maps/${baseName}.uvtt`,
    sceneUrl: `maps/generated/${sceneFileName}`,
    imageUrl: `maps/generated/${webpFileName}`,
    sourceHash: `sha256-${sourceHash}`,
    levelCount: 1,
    features: {
      walls: walls.length,
      portals: portals.length,
      lights: lights.length,
      bakedLighting: level.ambient.baked ?? false,
    },
  };

  return {
    mapId: baseName,
    name: displayName,
    sourceHash,
    sceneFile: scenePath,
    imageFile: webpPath,
    catalogEntry,
    warnings: allWarnings,
  };
}

/**
 * Prépare tous les fichiers UVTT du répertoire maps/.
 * Génère catalog.json de manière atomique.
 *
 * @param {{
 *   mapsDir?: string,
 *   targetPxPerCell?: number,
 *   dryRun?: boolean
 * }} [options={}]
 * @returns {Promise<{
 *   mapsCount: number,
 *   totalWalls: number,
 *   totalPortals: number,
 *   totalLights: number,
 *   warnings: string[]
 * }>}
 */
export async function prepareMaps(options = {}) {
  const mapsDir = options.mapsDir || path.join(rootDir, 'maps');
  const targetPxPerCell = options.targetPxPerCell || 140;
  const dryRun = options.dryRun || false;

  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }

  // Trouver tous les .uvtt directement sous maps/
  const uvttFiles = fs
    .readdirSync(mapsDir)
    .filter((f) => f.endsWith('.uvtt') && !f.startsWith('.'))
    .sort();

  if (uvttFiles.length === 0) {
    console.log('Aucun fichier .uvtt trouvé dans maps/');
    return {
      mapsCount: 0,
      totalWalls: 0,
      totalPortals: 0,
      totalLights: 0,
      warnings: [],
    };
  }

  const catalogEntries = [];
  const allWarnings = [];
  let totalWalls = 0;
  let totalPortals = 0;
  let totalLights = 0;

  // Préparer chaque carte — continuer même en cas d'erreur
  const errors = [];
  for (const uvttFile of uvttFiles) {
    const uvttPath = path.join(mapsDir, uvttFile);
    try {
      const result = await prepareMap(uvttPath, mapsDir, targetPxPerCell);
      catalogEntries.push(result.catalogEntry);
      allWarnings.push(...result.warnings);

      totalWalls += result.catalogEntry.features.walls;
      totalPortals += result.catalogEntry.features.portals;
      totalLights += result.catalogEntry.features.lights;

      console.log(`✓ ${result.mapId} préparée`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`✗ Erreur en préparant ${uvttFile} : ${errMsg}`);
      errors.push({ file: uvttFile, error: errMsg });
    }
  }

  if (errors.length > 0) {
    console.error(`\n⚠ ${errors.length} carte(s) rejetée(s) :`);
    for (const e of errors) {
      console.error(` - ${e.file} : ${e.error}`);
    }
  }

  // Écrire le catalogue de manière atomique
  const catalog = {
    version: 1,
    maps: catalogEntries,
  };

  const catalogPath = path.join(mapsDir, 'catalog.json');
  const tempCatalogPath = catalogPath + '.tmp';

  if (!dryRun) {
    fs.writeFileSync(tempCatalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
    // Atomic swap
    if (fs.existsSync(catalogPath)) {
      fs.unlinkSync(catalogPath);
    }
    fs.renameSync(tempCatalogPath, catalogPath);
  }

  return {
    mapsCount: uvttFiles.length,
    totalWalls,
    totalPortals,
    totalLights,
    warnings: allWarnings,
  };
}

// CLI principal
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  prepareMaps()
    .then((result) => {
      console.log(
        `\n✓ ${result.mapsCount} carte(s) préparée(s), ${result.totalWalls} murs, ${result.totalPortals} portes, ${result.totalLights} lumières`
      );
      if (result.warnings.length > 0) {
        console.log('\nAvertissements :');
        for (const w of result.warnings) {
          console.log(` - ${w}`);
        }
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Erreur fatale :', err);
      process.exit(1);
    });
}
