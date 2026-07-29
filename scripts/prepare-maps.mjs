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
export const SUPPORTED_EXTENSIONS = ['.uvtt', '.dd2vtt', '.df2vtt'];

/**
 * Un nom de fichier désigne-t-il un export VTT reconnu ?
 *
 * Point d'entrée **unique** de cette décision. La constante seule n'unifiait que
 * la liste, pas la comparaison : la préparation globait en respectant la casse
 * pendant que les tests de fixtures l'ignoraient. Un `CARTE.DD2VTT` était donc
 * validé par les tests mais invisible à la préparation — une carte simplement
 * absente de la bibliothèque, sans le moindre message.
 *
 * @param {string} fileName - nom de fichier, sans chemin
 * @returns {boolean}
 */
export function isSupportedSource(fileName) {
  if (fileName.startsWith('.')) return false;
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

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
    sourceUrl: `maps/${path.basename(uvttPath)}`,
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
 * Associe chaque fichier source à son slug et refuse toute collision.
 *
 * Appelée **avant** toute préparation : un catalogue ne peut pas contenir deux
 * entrées de même identifiant, et le refus doit intervenir avant le moindre
 * octet écrit (critère U-02).
 *
 * Atteignable en pratique depuis que le filtre reconnaît `.uvtt`, `.dd2vtt` et
 * `.df2vtt` : `x.uvtt` et `x.dd2vtt` produisent le même slug. C'est le cas que
 * couvre le test « collision bout-en-bout ».
 *
 * @param {string[]} fileNames - noms de fichiers, sans chemin
 * @returns {{ file: string, slug: string }[]}
 */
export function planSources(fileNames) {
  /** @type {Map<string, string[]>} */
  const bySlug = new Map();

  for (const file of fileNames) {
    const slug = path.basename(file, path.extname(file));
    const known = bySlug.get(slug);
    if (known) {
      known.push(file);
    } else {
      bySlug.set(slug, [file]);
    }
  }

  const collisions = [...bySlug.entries()].filter(([, files]) => files.length > 1);
  if (collisions.length > 0) {
    const detail = collisions
      .map(([slug, files]) => `${slug} ← ${files.join(', ')}`)
      .join(' ; ');
    throw new Error(
      `Slugs en collision, aucun catalogue publié : ${detail}`
    );
  }

  return fileNames.map((file) => ({
    file,
    slug: path.basename(file, path.extname(file)),
  }));
}

/**
 * Relève les artefacts de `generated/` que le nouveau catalogue ne référence
 * plus.
 *
 * Ils sont **signalés et conservés** : U-02 interdit la suppression. Un
 * artefact orphelin est peut-être encore référencé par une campagne enregistrée
 * côté navigateur.
 *
 * @param {string} mapsDir
 * @param {any[]} catalogEntries
 * @returns {string[]} avertissements
 */
function findOrphanArtifacts(mapsDir, catalogEntries) {
  const generatedDir = path.join(mapsDir, 'generated');
  if (!fs.existsSync(generatedDir)) return [];

  const referenced = new Set();
  for (const entry of catalogEntries) {
    referenced.add(path.basename(entry.sceneUrl));
    referenced.add(path.basename(entry.imageUrl));
  }

  return fs
    .readdirSync(generatedDir)
    .filter((name) => !name.startsWith('.') && !referenced.has(name))
    .sort()
    .map(
      (name) =>
        `Artefact orphelin conservé : maps/generated/${name} — plus référencé par le catalogue, à supprimer à la main après vérification`
    );
}

/**
 * Publie le catalogue par `rename` seul.
 *
 * `rename` remplace la cible de façon atomique. Un `unlink` préalable ouvrirait
 * une fenêtre pendant laquelle le catalogue n'existe plus : ne pas le
 * réintroduire.
 *
 * @param {string} catalogPath
 * @param {unknown} catalog
 */
function publishCatalog(catalogPath, catalog) {
  const tempCatalogPath = `${catalogPath}.tmp`;
  fs.writeFileSync(tempCatalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
  try {
    fs.renameSync(tempCatalogPath, catalogPath);
  } catch (err) {
    // Ne pas laisser un .tmp derrière soi : il serait pris pour un catalogue
    // en attente à la préparation suivante.
    fs.rmSync(tempCatalogPath, { force: true });
    throw err;
  }
}

/**
 * Prépare tous les fichiers UVTT du répertoire maps/.
 *
 * Transactionnel : le catalogue n'est publié que si **toutes** les cartes ont
 * été préparées. Une seule carte fautive fait échouer l'appel sans écrire
 * `catalog.json`, et le catalogue précédent reste intact octet pour octet
 * (U-02, plan §6.9). Les artefacts déjà produits par les cartes valides sont
 * conservés et signalés comme orphelins, jamais supprimés.
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
 * @throws {Error} si une carte échoue ou si deux sources partagent un slug
 */
export async function prepareMaps(options = {}) {
  const mapsDir = options.mapsDir || path.join(rootDir, 'maps');
  const targetPxPerCell = options.targetPxPerCell || 140;
  const dryRun = options.dryRun || false;

  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }

  // Trouver tous les fichiers VTT reconnus directement sous maps/
  const uvttFiles = fs.readdirSync(mapsDir).filter(isSupportedSource).sort();

  if (uvttFiles.length === 0) {
    console.log(
      `Aucun fichier VTT (${SUPPORTED_EXTENSIONS.join(', ')}) trouvé dans ${mapsDir}`
    );
    return {
      mapsCount: 0,
      totalWalls: 0,
      totalPortals: 0,
      totalLights: 0,
      warnings: [],
    };
  }

  // Refuser les collisions de slug avant d'écrire quoi que ce soit.
  const sources = planSources(uvttFiles);

  const catalogEntries = [];
  const allWarnings = [];
  let totalWalls = 0;
  let totalPortals = 0;
  let totalLights = 0;

  // Toutes les cartes sont tentées, même après une première défaillance : le
  // mainteneur voit l'ensemble des causes en une seule passe. Rien n'est publié
  // pour autant, la décision se prend après la boucle.
  const failures = [];
  for (const { file } of sources) {
    const uvttPath = path.join(mapsDir, file);
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
      console.error(`✗ Erreur en préparant ${file} : ${errMsg}`);
      failures.push({ file, error: errMsg });
    }
  }

  // Une seule carte fautive interdit la publication. Le catalogue précédent
  // reste en place : mieux vaut un catalogue daté qu'un catalogue amputé.
  if (failures.length > 0) {
    const detail = failures.map((f) => ` - ${f.file} : ${f.error}`).join('\n');
    throw new Error(
      `${failures.length} carte(s) en échec sur ${sources.length}, aucun catalogue publié ` +
        `(le précédent est conservé tel quel) :\n${detail}`
    );
  }

  const catalog = {
    version: 1,
    maps: catalogEntries,
  };

  allWarnings.push(...findOrphanArtifacts(mapsDir, catalogEntries));

  if (!dryRun) {
    publishCatalog(path.join(mapsDir, 'catalog.json'), catalog);
  }

  return {
    mapsCount: catalogEntries.length,
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
      // Sortie non nulle : aucun catalogue n'a été publié, et le CI doit le voir.
      console.error(`\n✗ Préparation abandonnée.\n${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
