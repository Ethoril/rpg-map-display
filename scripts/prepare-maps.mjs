// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseUvtt } from '../js/import/uvtt.js';
import { createCampaign, validateCampaign } from '../js/core/schema.js';
import { resample, MAX_PREPARED_TEXTURE_PX, WEBP_QUALITY } from './resample.mjs';

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
 * @param {{ maxTexturePx?: number, quality?: number }} [options] - réglages de fabrication.
 *   **Réservés à la comparaison** de l'outil local : la publication passe toujours par les
 *   constantes du dépôt (`docs/CHANTIER-L-OUTIL-CARTES.md` §3.3).
 * @returns {Promise<{
 *   mapId: string,
 *   name: string,
 *   sourceHash: string,
 *   sceneFile: string,
 *   imageFile: string,
 *   width: number,
 *   height: number,
 *   catalogEntry: any,
 *   warnings: string[]
 * }>}
 */
export async function prepareMap(uvttPath, outputDir, targetPxPerCell = 140, options = {}) {
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

  // ⛔ **L'identifiant d'étage vient du nom de fichier, jamais du défaut de `parseUvtt`.**
  //
  // Un export Dungeondraft ne porte pas d'`id` : `parseUvtt` retombe donc sur `'uvtt-level'`, le
  // même pour **toutes** les cartes. Trois conséquences, mesurées en séance le 7 août 2026 :
  //
  //  1. `store.addLevel` remplace en place quand l'identifiant existe déjà — importer une seconde
  //     carte **écrasait la première, en silence**. Il n'y avait jamais deux étages, et le
  //     sélecteur d'étage du lot 3 ne pouvait pas apparaître.
  //  2. Les masques de fog et de vision sont indexés par `levelId`, **clé `localStorage`
  //     comprise** : deux cartes se partageaient leurs masques.
  //  3. Et un masque relu aux mauvaises dimensions faisait **disparaître tous les pions** de la
  //     vue joueurs, la zone de vision restant dessinée — le MJ voyait ses pions, la table non.
  //
  // Le nom de fichier est le bon choix : stable, lisible, et il conserve l'intention de
  // `addLevel` — réimporter la même carte la remplace, en importer une autre l'ajoute. Un
  // identifiant tiré au hasard casserait ce remplacement.
  level.id = baseName;

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
    maxTexturePx: options.maxTexturePx,
    quality: options.quality,
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
    // Dimensions **réelles** de l'image écrite. Les recalculer depuis `pxPerCell`, qui est
    // fractionnaire dès que le plafond mord, donne des hauteurs à virgule : 4096,15 px.
    width: resampleResult.width,
    height: resampleResult.height,
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
 * Chemin du sidecar qui mémorise **comment** chaque carte a été fabriquée.
 *
 * Sidecar et non entrée de catalogue : `catalog.json` est publié sur le web, et des
 * métadonnées de fabrication n'y ont rien à faire. Le point initial le fait ignorer par
 * `findOrphanArtifacts`, qui filtre déjà les fichiers cachés.
 *
 * @param {string} mapsDir
 */
function recipesPath(mapsDir) {
  return path.join(mapsDir, 'generated', '.recipes.json');
}

/**
 * Empreinte du **code** qui fabrique les artefacts, calculée une fois par processus.
 *
 * Sans elle, le cache serait faux dès qu'on corrige le pipeline sans toucher aux
 * constantes — et ce n'est pas une hypothèse : le 30/07, remplacer un `floor` par un
 * `round` borné a changé les dimensions de sortie de 4679 à 4680 px, à constantes
 * rigoureusement identiques. Un cache aveugle au code aurait affirmé « rien à faire ».
 *
 * Les trois fichiers comptent : `resample.mjs` détermine l'image, `prepare-maps.mjs` et
 * `js/import/uvtt.js` déterminent ensemble le document de scène. Bumper une version à la
 * main serait une consigne, pas un mécanisme.
 *
 * ⚠ **`uvtt.js` a été ajouté le 03/08/2026, et son absence était un trou réel.** C'est lui
 * qui convertit la géométrie UVTT vers le modèle : la tranche L-05 l'a modifié pour émettre
 * `state` sur les portails, et le cache aurait sauté toutes les cartes en les déclarant à
 * jour. Le document de scène n'aurait jamais acquis le champ. Sans effet visible cette
 * fois-ci — la normalisation à la lecture rattrape les documents hérités — mais le prochain
 * changement de sémantique du parseur ne se serait pas propagé davantage, et rien ne
 * l'aurait signalé. C'est exactement le défaut que cette empreinte existe pour fermer.
 */
const PIPELINE_HASH = (() => {
  const hash = crypto.createHash('sha256');
  for (const f of [
    path.join(__dirname, 'resample.mjs'),
    path.join(__dirname, 'prepare-maps.mjs'),
    path.join(__dirname, '..', 'js', 'import', 'uvtt.js'),
  ]) {
    hash.update(fs.readFileSync(f));
  }
  return hash.digest('hex').slice(0, 16);
})();

/**
 * Recette d'une carte : ce qui doit être identique pour pouvoir sauter sa préparation.
 *
 * **`sourceHash` seul ne suffit pas**, et c'est le piège que cette fonction existe pour
 * fermer : changer le plafond, la qualité ou le code ne change pas un octet du `.dd2vtt`.
 * Un cache indexé sur la seule source sauterait la carte en affirmant qu'elle est à jour,
 * et l'écart ne se verrait qu'à l'œil, bien plus tard.
 *
 * @param {string} sourceHash
 * @param {number} targetPxPerCell
 * @param {{ maxTexturePx?: number, quality?: number }} options
 */
function recipeOf(sourceHash, targetPxPerCell, options) {
  return {
    sourceHash,
    targetPxPerCell,
    maxTexturePx: options.maxTexturePx ?? MAX_PREPARED_TEXTURE_PX,
    quality: options.quality ?? WEBP_QUALITY,
    pipelineHash: PIPELINE_HASH,
  };
}

/** @param {string} mapsDir */
function readRecipes(mapsDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recipesPath(mapsDir), 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Sidecar absent ou illisible : on repart de zéro. Il n'est qu'un cache, jamais une
    // source de vérité — le perdre coûte du temps, jamais une carte.
    return {};
  }
}

/**
 * Le travail déjà fait est-il réutilisable tel quel ?
 *
 * Exige la recette **et** la présence effective des deux artefacts : un sidecar qui survit à
 * un `rm` sur `generated/` doit provoquer une reconstruction, pas un catalogue qui référence
 * des fichiers absents.
 *
 * @param {any} known entrée du sidecar
 * @param {ReturnType<typeof recipeOf>} recipe
 * @param {string} mapsDir
 */
function isReusable(known, recipe, mapsDir) {
  if (!known || !known.recipe || !known.catalogEntry) return false;
  const sameRecipe = /** @type {(keyof typeof recipe)[]} */ ([
    'sourceHash',
    'targetPxPerCell',
    'maxTexturePx',
    'quality',
    'pipelineHash',
  ]).every((k) => known.recipe[k] === recipe[k]);
  if (!sameRecipe) return false;

  // Chemins dérivés du dossier réel et du seul nom de fichier : les URL du catalogue
  // portent un préfixe `maps/` en dur, que les tests (dossier temporaire) ne respectent pas.
  return [known.catalogEntry.sceneUrl, known.catalogEntry.imageUrl].every((url) =>
    fs.existsSync(path.join(mapsDir, 'generated', path.basename(url)))
  );
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
 * Incrémental : une carte dont la **recette** est inchangée et dont les artefacts sont
 * toujours là n'est pas réencodée, son entrée de catalogue étant relue du sidecar. Le
 * catalogue publié est identique à celui qu'aurait produit une passe complète — c'est le
 * temps qui change, pas le résultat. `force` court-circuite le cache.
 *
 * @param {{
 *   mapsDir?: string,
 *   targetPxPerCell?: number,
 *   dryRun?: boolean,
 *   force?: boolean,
 *   maxTexturePx?: number,
 *   quality?: number
 * }} [options={}]
 * @returns {Promise<{
 *   mapsCount: number,
 *   preparedCount: number,
 *   skippedCount: number,
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
  const force = options.force || false;
  const fabrication = { maxTexturePx: options.maxTexturePx, quality: options.quality };

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
      preparedCount: 0,
      skippedCount: 0,
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

  const knownRecipes = force ? {} : readRecipes(mapsDir);
  /** @type {Record<string, any>} */
  const nextRecipes = {};
  let preparedCount = 0;
  let skippedCount = 0;

  // Toutes les cartes sont tentées, même après une première défaillance : le
  // mainteneur voit l'ensemble des causes en une seule passe. Rien n'est publié
  // pour autant, la décision se prend après la boucle.
  const failures = [];
  for (const { file, slug } of sources) {
    const uvttPath = path.join(mapsDir, file);
    try {
      const sourceHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(uvttPath, 'utf-8'))
        .digest('hex');
      const recipe = recipeOf(sourceHash, targetPxPerCell, fabrication);
      const known = knownRecipes[slug];

      // Réutiliser : lire et hacher 22 Mo coûte une fraction de seconde, réencoder
      // 60 MP en coûte soixante. C'est tout l'écart entre deux minutes et deux secondes.
      if (isReusable(known, recipe, mapsDir)) {
        catalogEntries.push(known.catalogEntry);
        nextRecipes[slug] = known;
        totalWalls += known.catalogEntry.features.walls;
        totalPortals += known.catalogEntry.features.portals;
        totalLights += known.catalogEntry.features.lights;
        skippedCount++;
        console.log(`· ${slug} inchangée, réutilisée`);
        continue;
      }

      const result = await prepareMap(uvttPath, mapsDir, targetPxPerCell, fabrication);
      catalogEntries.push(result.catalogEntry);
      allWarnings.push(...result.warnings);
      nextRecipes[slug] = { recipe, catalogEntry: result.catalogEntry };

      totalWalls += result.catalogEntry.features.walls;
      totalPortals += result.catalogEntry.features.portals;
      totalLights += result.catalogEntry.features.lights;
      preparedCount++;

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
    // Le sidecar n'est écrit **qu'après** la publication réussie. L'inverse laisserait un
    // cache affirmant qu'un travail est fait alors que le catalogue ne le référence pas.
    fs.writeFileSync(recipesPath(mapsDir), JSON.stringify(nextRecipes, null, 2), 'utf-8');
  }

  return {
    mapsCount: catalogEntries.length,
    preparedCount,
    skippedCount,
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
        `\n✓ ${result.mapsCount} carte(s) au catalogue ` +
          `(${result.preparedCount} préparée(s), ${result.skippedCount} réutilisée(s)), ` +
          `${result.totalWalls} murs, ${result.totalPortals} portes, ${result.totalLights} lumières`
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
