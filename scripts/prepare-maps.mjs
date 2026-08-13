// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { parseUvtt } from '../js/import/uvtt.js';
import { createCampaign, createLevel, validateCampaign } from '../js/core/schema.js';
import { resample, imageDimensions, MAX_PREPARED_TEXTURE_PX, WEBP_QUALITY } from './resample.mjs';
import { videoWarnings } from './videoProbe.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
export const SUPPORTED_EXTENSIONS = ['.uvtt', '.dd2vtt', '.df2vtt'];

/**
 * Images acceptées comme **carte-décor** : un fond de carte sans géométrie.
 *
 * ⭐ Existe parce que la bibliothèque réelle du mainteneur — 1 774 images — était **entièrement
 * inutilisable par sa propre chaîne**, qui n'avalait que de l'UVTT. Aucun critère ne mesurait ça,
 * et c'était pourtant le plus grand écart entre l'outil et un outil dont on se sert.
 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Bornes de plausibilité d'une densité, en pixels par case.
 *
 * ⛔ Elles ne servent pas à juger du goût mais à **valider une lecture de nom de fichier**. Un nom
 * peut contenir plusieurs couples de nombres — `Ambush Site_37x28_High res` en a un utile, mais
 * `carte_5180x3920` porterait les pixels et donnerait 1 px/case. Confronter chaque couple aux
 * dimensions réelles de l'image et écarter l'invraisemblable est ce qui distingue une mesure d'une
 * devinette.
 */
export const MIN_PLAUSIBLE_PX_PER_CELL = 20;
export const MAX_PLAUSIBLE_PX_PER_CELL = 600;

/**
 * Écart relatif toléré entre la densité déduite de la largeur et celle déduite de la hauteur.
 *
 * Un `37x28` juste donne exactement la même densité sur les deux axes. Un écart signifie que le nom
 * est faux, ou que l'image a été recadrée : dans les deux cas il faut le dire, pas choisir un axe.
 */
export const CELL_DIMENSION_TOLERANCE = 0.02;

/**
 * Lit les dimensions en cases écrites dans un nom de fichier, validées contre l'image.
 *
 * Convention du corpus réel : `Ambush Site_37x28_High res.jpg` fait 5180 × 3920 px, donc
 * 5180 / 37 = **exactement 140 px/case**. La densité se déduit du nom sans rien saisir et sans
 * rien mesurer — c'est la source la plus fiable dont on dispose, quand elle est là.
 *
 * ⛔ **Aucune valeur par défaut n'est renvoyée.** Ce corpus est à 140 px/case, mais un autre ne le
 * sera pas : coder cette densité en dur ferait d'une propriété du fournisseur une règle du produit.
 * Sans lecture valide, cette fonction rend `null` et c'est à l'appelant de mesurer ou de refuser.
 *
 * @param {string} fileName - nom de fichier, avec ou sans chemin
 * @param {number} imageWidth - largeur réelle de l'image, en pixels
 * @param {number} imageHeight - hauteur réelle de l'image, en pixels
 * @returns {{ widthCells: number, heightCells: number, pxPerCell: number, warnings: string[] }|null}
 */
export function cellDimensionsFromName(fileName, imageWidth, imageHeight) {
  const base = path.basename(String(fileName ?? ''), path.extname(String(fileName ?? '')));
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;

  // Tous les couples du nom, dans l'ordre. `×` compris : les noms d'éditeurs en emploient.
  const couples = [...base.matchAll(/(\d{1,4})\s*[x×X]\s*(\d{1,4})/g)];
  for (const m of couples) {
    const widthCells = Number(m[1]);
    const heightCells = Number(m[2]);
    if (!(widthCells > 0) || !(heightCells > 0)) continue;

    const parLargeur = imageWidth / widthCells;
    const parHauteur = imageHeight / heightCells;
    if (parLargeur < MIN_PLAUSIBLE_PX_PER_CELL || parLargeur > MAX_PLAUSIBLE_PX_PER_CELL) continue;

    const ecart = Math.abs(parLargeur - parHauteur) / parLargeur;
    /** @type {string[]} */
    const warnings = [];
    if (ecart > CELL_DIMENSION_TOLERANCE) {
      // On garde la largeur comme référence — c'est l'axe le plus souvent juste sur un recadrage
      // bas de page — mais on le DIT. Choisir en silence serait exactement ce que l'exigence
      // d'universalité de l'import interdit.
      warnings.push(
        `Dimensions du nom incohérentes : ${widthCells}×${heightCells} cases donne ` +
          `${parLargeur.toFixed(1)} px/case en largeur mais ${parHauteur.toFixed(1)} en hauteur ` +
          `(écart ${(ecart * 100).toFixed(1)} %). Densité retenue : celle de la largeur. ` +
          `Vérifier le nom ou un éventuel recadrage.`
      );
    }
    return { widthCells, heightCells, pxPerCell: parLargeur, warnings };
  }
  return null;
}

/**
 * Conteneurs vidéo acceptés comme **fond animé**, par ordre de préférence.
 *
 * WebM d'abord, et ce n'est pas une préférence de goût : le H.264 plafonne la taille
 * d'image par niveau, et les niveaux 5.1/5.2 — les seuls largement décodés en matériel —
 * s'arrêtent à 36 864 macroblocs. Une carte de 28×19 cases à 150 px/case fait 4200×2850,
 * soit 47 077 macroblocs : elle ne peut **pas** être encodée en H.264 lisible sur mobile.
 * Dungeon Alchemist conseille d'ailleurs le WebM pour les grandes cartes, et c'est
 * vraisemblablement la raison. Le MP4 reste accepté pour les petites.
 */
export const VIDEO_EXTENSIONS = ['.webm', '.mp4'];

/**
 * Suffixe du fichier d'affiche accompagnant une vidéo de fond.
 * Produit par `scripts/extract-poster.mjs`.
 */
export const POSTER_SUFFIX = '.poster.webp';

/**
 * Localise la vidéo jumelle d'un export VTT, si elle existe.
 *
 * Convention : même dossier, même nom de base. `testvideo-3.dd2vtt` va avec
 * `testvideo-3.webm`.
 *
 * @param {string} vttPath - chemin du fichier .uvtt/.dd2vtt/.df2vtt
 * @returns {string|null} chemin absolu de la vidéo, ou null
 */
export function findSidecarVideo(vttPath) {
  const base = path.join(path.dirname(vttPath), path.basename(vttPath, path.extname(vttPath)));
  for (const ext of VIDEO_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** @param {string} vttPath @returns {string} */
export function posterPathFor(vttPath) {
  const dir = path.dirname(vttPath);
  const base = path.basename(vttPath, path.extname(vttPath));
  return path.join(dir, `${base}${POSTER_SUFFIX}`);
}

/**
 * Détermine ce qui sert de **pixels** à un étage : l'image embarquée dans l'UVTT, ou
 * l'affiche d'une vidéo de fond.
 *
 * Un export vidéo de Dungeon Alchemist porte `"image": ""` — la géométrie est là, les
 * pixels sont dans le fichier vidéo. Sans ce chemin, `resample('')` échouait sur
 * « Impossible de lire l'image source » : franc, mais sans issue.
 *
 * ⚠ **L'affiche repasse par `resample`** alors qu'elle en sort déjà. Un ré-encodage
 * WebP q90 sur une source q90 est mesurablement négligeable, et le prix est juste :
 * `resample` reste **le seul** producteur d'images préparées, donc le plafond de
 * texture, la qualité et les avertissements n'ont qu'une implantation. Un chemin qui
 * copierait l'affiche telle quelle contournerait le plafond en silence.
 *
 * @param {string} vttPath
 * @param {string} imageBase64 - contenu de `image` dans l'UVTT (souvent vide en mode vidéo)
 * @returns {{ imageSource: string|Buffer, videoPath: string|null }}
 */
export function resolveImageSource(vttPath, imageBase64) {
  if (imageBase64 && imageBase64.length > 0) {
    return { imageSource: imageBase64, videoPath: null };
  }

  const videoPath = findSidecarVideo(vttPath);
  if (!videoPath) {
    throw new Error(
      `${path.basename(vttPath)} ne contient aucune image (« image »: "") et aucune vidéo ` +
        `jumelle n'a été trouvée. Attendu : ` +
        `${path.basename(vttPath, path.extname(vttPath))}.webm ou .mp4 dans le même dossier.`
    );
  }

  const posterPath = posterPathFor(vttPath);
  if (!fs.existsSync(posterPath)) {
    throw new Error(
      `${path.basename(vttPath)} est un export vidéo, mais son affiche manque. ` +
        `Produire d'abord :\n` +
        `  node scripts/extract-poster.mjs "${videoPath}" "${posterPath}"\n` +
        `L'affiche n'est pas un confort : c'est le repli quand la vidéo ne peut pas jouer, ` +
        `et la vignette du catalogue.`
    );
  }

  return { imageSource: fs.readFileSync(posterPath), videoPath };
}

/**
 * Empreinte d'un étage, **vidéo et affiche comprises**.
 *
 * Hacher le seul `.dd2vtt` laissait un piège : réencoder la vidéo sans toucher au JSON
 * — exactement ce qu'on fait en ajustant la qualité d'export — laissait le cache déclarer
 * la carte à jour et republier l'ancienne vidéo.
 *
 * @param {string} vttPath
 * @returns {string} `sha256-…`
 */
export function sourceHashOf(vttPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(vttPath));
  const videoPath = findSidecarVideo(vttPath);
  if (videoPath) {
    hash.update('|video|');
    hash.update(fs.readFileSync(videoPath));
    const posterPath = posterPathFor(vttPath);
    if (fs.existsSync(posterPath)) {
      hash.update('|poster|');
      hash.update(fs.readFileSync(posterPath));
    }
  }
  return `sha256-${hash.digest('hex')}`;
}

/**
 * Copie la vidéo de fond dans `generated/` et rend l'URL publiable correspondante.
 *
 * @param {string} videoPath
 * @param {string} generatedDir
 * @param {string} levelId
 * @returns {string} URL relative au dépôt
 */
export function publishVideo(videoPath, generatedDir, levelId) {
  const ext = path.extname(videoPath).toLowerCase();
  const fileName = `${levelId}${ext}`;
  fs.copyFileSync(videoPath, path.join(generatedDir, fileName));
  return `maps/generated/${fileName}`;
}

/**
 * Prépare un fond animé : contrôle, copie, et avertissements.
 *
 * ⚠ Le contrôle de dimension **manquait**, et c'était un trou par symétrie : une image
 * dépassant `MAX_PREPARED_TEXTURE_PX` est réduite et signalée, alors qu'une vidéo était
 * copiée sans qu'on la regarde. Or son plafond est plus bas — voir `videoProbe.mjs`.
 *
 * @param {string} videoPath
 * @param {string} generatedDir
 * @param {string} levelId
 * @returns {{ url: string, warnings: string[] }}
 */
export function prepareVideo(videoPath, generatedDir, levelId) {
  return {
    url: publishVideo(videoPath, generatedDir, levelId),
    warnings: videoWarnings(videoPath),
  };
}

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
  if (SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  // ⛔ Une affiche de vidéo n'est pas une carte : `x.poster.webp` accompagne `x.dd2vtt` et serait
  // sinon préparée une seconde fois comme carte-décor, sous un slug qui collisionne presque.
  if (lower.endsWith(POSTER_SUFFIX)) return false;
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Le fichier est-il un **export VTT** — la question d'avant les cartes-décor ?
 *
 * ⚠ Existe parce qu'élargir `isSupportedSource` aux images a **changé le sens** de ce prédicat :
 * il répondait « est-ce un export VTT ? », il répond maintenant « est-ce préparable ? ». Un appelant
 * qui voulait le premier sens obtient désormais des images, et `tests/realUvtt.test.mjs` a
 * effectivement tenté de parser un binaire. Deux questions distinctes méritent deux noms.
 *
 * @param {string} fileName
 * @returns {boolean}
 */
export function isVttSource(fileName) {
  if (fileName.startsWith('.')) return false;
  const lower = fileName.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Le fichier est-il une **carte-décor** — une image, par opposition à un export VTT ?
 *
 * @param {string} fileName
 * @returns {boolean}
 */
export function isImageSource(fileName) {
  if (!isSupportedSource(fileName)) return false;
  const lower = fileName.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Extensions dont une image de même nom de base est **l'illustration**, donc pas une carte.
 *
 * `.json` couvre les scènes déjà construites du dépôt : `minimal.json` est une campagne de test et
 * `minimal.webp` est **son** image.
 */
const OWNING_EXTENSIONS = Object.freeze([...SUPPORTED_EXTENSIONS, ...VIDEO_EXTENSIONS, '.json']);

/**
 * Écarte les images qui accompagnent un autre fichier au lieu d'être des cartes.
 *
 * ⭐ **Défaut attrapé au premier essai réel, le 12/08/2026.** Accepter les extensions d'image a fait
 * prendre `maps/minimal.webp` — l'illustration de la scène de test `maps/minimal.json` — pour une
 * carte, et toute la préparation a échoué. La règle des affiches (`.poster.webp`) ne suffisait pas :
 * il faut la règle générale du fichier accompagnant.
 *
 * ⛔ Cette fonction **ne juge pas de la densité** : une image orpheline sans dimensions dans son nom
 * est bien une carte-décor candidate, et son refus doit être bruyant plutôt que silencieux. Ne rien
 * écarter en silence n'interdit pas de reconnaître ce qui n'a jamais prétendu être une carte.
 *
 * @param {string[]} fileNames - noms de fichiers du dossier, sans chemin
 * @returns {string[]} les mêmes, moins les images accompagnant un autre fichier
 */
export function filterSidecarImages(fileNames) {
  const bases = new Set(
    fileNames
      .filter((f) => OWNING_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)))
      .map((f) => path.basename(f, path.extname(f)).toLowerCase())
  );
  return fileNames.filter((f) => {
    if (!isImageSource(f)) return true;
    return !bases.has(path.basename(f, path.extname(f)).toLowerCase());
  });
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

  // ⭐ Bifurcation vers la carte-décor, et elle est **indispensable pour que la fonction serve** :
  // c'est `prepareMap` qu'appelle l'aperçu de l'outil au double-clic (`prepare-server.mjs`), et le
  // mainteneur ne passe pas par un terminal. Sans cette ligne, la carte-décor n'existerait que pour
  // la ligne de commande, donc pour personne.
  if (isImageSource(path.basename(uvttPath))) {
    return prepareDecorMap(uvttPath, outputDir, targetPxPerCell, options);
  }

  const fileContent = fs.readFileSync(uvttPath, 'utf-8');
  // Empreinte de **toutes** les sources de l'étage, vidéo et affiche comprises.
  const sourceHash = sourceHashOf(uvttPath).slice('sha256-'.length);

  const uvttData = JSON.parse(fileContent);
  const { level, imageBase64, warnings: parseWarnings } = parseUvtt(uvttData);
  const { imageSource, videoPath } = resolveImageSource(uvttPath, imageBase64);

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

  const resampleResult = await resample(imageSource, targetPxPerCell, {
    // En mode vidéo l'affiche ne vient pas de l'UVTT : annoncer son `pixels_per_grid`
    // serait faux. En pratique le paramètre ne décide de rien ici — `resample` ne le lit
    // qu'à défaut de `widthCells`/`heightCells`, que les deux appels fournissent toujours,
    // et c'est `widthCells × targetPxPerCell` qui fixe la largeur. On le renseigne
    // quand même juste, plutôt que de laisser une valeur fausse en attendant qu'elle serve.
    sourcePxPerCell: videoPath ? targetPxPerCell : uvttData.resolution?.pixels_per_grid,
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
  // Le fond animé est **en plus** de l'image, jamais à la place : `imageUrl` reste
  // l'affiche et le repli. Un étage dont la vidéo échoue retombe donc exactement sur
  // le comportement d'avant ce chantier, sans code de secours à écrire.
  const videoPrepare = videoPath ? prepareVideo(videoPath, generatedDir, baseName) : null;
  level.videoUrl = videoPrepare?.url ?? null;
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

  const allWarnings = [
    ...parseWarnings,
    ...resampleResult.warnings,
    ...(videoPrepare?.warnings ?? []),
  ];

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
      animated: level.videoUrl !== null,
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
 * Prépare une **carte-décor** : un fond de carte issu d'une simple image.
 *
 * ## Ce qu'une carte-décor est, et ce qu'elle n'est pas
 *
 * Une image ne porte **ni murs, ni portes, ni lumières** — elle ne porte que des pixels. L'étage
 * produit ici a donc une géométrie vide et une **ambiante pleine**, ce qui a une conséquence
 * heureuse : `fogLayer` fait voir chaque PJ jusqu'au plafond technique quand l'ambiante est active,
 * au lieu de sa portée nocturne. La carte s'affiche donc autour des pions sans réglage.
 *
 * ⚠ Deux limites à connaître, aucune n'est un défaut :
 *
 *  1. **Sans pion PJ sur l'étage, les joueurs ne voient rien.** Ce n'est pas propre aux
 *     cartes-décor — c'est la règle « une lumière n'est pas un œil » du lot 2 — mais elle surprend
 *     sur une carte sans fog attendu. Poser un pion suffit.
 *  2. `VISION_MAX_RANGE_CELLS` vaut 20, donc sur une carte de 37 × 28 les coins restent sombres
 *     tant que personne ne s'en approche. Acceptable pour un fond de combat ; si ça gêne un jour,
 *     le correctif est un drapeau « pas de fog » sur l'étage, pas un rattrapage ici.
 *
 * ## La densité ne se devine pas
 *
 * Elle est lue dans le nom (`cellDimensionsFromName`) ou la préparation **échoue avec un message
 * qui nomme le remède**. ⛔ Pas de valeur par défaut : le corpus du mainteneur est à 140 px/case,
 * un autre ne le sera pas, et coder cette densité ferait d'une propriété de fournisseur une règle
 * du produit.
 *
 * ## Pourquoi un constructeur d'étage et non un préparateur de carte
 *
 * Le préparateur ne traite pas les fichiers un par un : tout passe par des « scene jobs » qui
 * assemblent la campagne, y compris pour une carte seule. Rendre ici un **étage** plutôt qu'une
 * carte complète évite de dupliquer ce pipeline — et donne gratuitement la possibilité de **mêler
 * une image et un export UVTT dans la même campagne à plusieurs étages**, ce que le critère 1 du
 * lot 3 demande justement.
 *
 * @param {string} imagePath - chemin de l'image source
 * @param {{ id?: string, name?: string, order?: number }|null} lvlSpec - étage voulu par le
 *   manifeste ; à défaut, tout est dérivé du nom de fichier
 * @param {string} generatedDir - dossier `maps/generated/`, déjà créé par l'appelant
 * @param {number} [targetPxPerCell=140] - densité de sortie du rééchantillonnage
 * @param {object} [options]
 * @param {number} [options.maxTexturePx]
 * @param {number} [options.quality]
 * @returns {Promise<{ level: any, width: number, height: number, warnings: string[] }>}
 */
export async function buildDecorLevel(imagePath, lvlSpec, generatedDir, targetPxPerCell = 140, options = {}) {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image introuvable : ${imagePath}`);
  }

  const baseName = path.basename(imagePath, path.extname(imagePath));
  const { width: imageWidth, height: imageHeight } = await imageDimensions(imagePath);

  const dims = cellDimensionsFromName(baseName, imageWidth, imageHeight);
  if (!dims) {
    // ⛔ Refuser plutôt que supposer, et dire quoi faire. Un import qui devine une densité produit
    // une carte silencieusement fausse : les pions tombent entre les cases et rien ne le signale.
    throw new Error(
      `Densité inconnue pour « ${path.basename(imagePath)} » (${imageWidth}×${imageHeight} px).\n` +
        `  Une image ne déclare pas sa taille en cases, et elle ne se devine pas.\n` +
        `  Remède : renommer le fichier en y incluant les cases, par exemple\n` +
        `    « ${baseName}_37x28${path.extname(imagePath)} »\n` +
        `  Aucune densité par défaut n'est appliquée : ce serait produire une carte fausse sans le dire.`
    );
  }

  const levelId = lvlSpec?.id ?? baseName;
  const webpFileName = `${levelId}.webp`;
  const webpPath = path.join(generatedDir, webpFileName);
  const resampleResult = await resample(imagePath, targetPxPerCell, {
    sourcePxPerCell: dims.pxPerCell,
    widthCells: dims.widthCells,
    heightCells: dims.heightCells,
    outputPath: webpPath,
    maxTexturePx: options.maxTexturePx,
    quality: options.quality,
  });

  const displayName = lvlSpec?.name ?? displayNameFromSlug(baseName);
  // ⭐ Une variante « _Grid » porte déjà un quadrillage peint : en dessiner un second par-dessus
  // donnerait deux grilles décalées, l'une juste et l'autre pas. Le choix se lit dans le nom parce
  // que c'est là que le fournisseur l'a écrit, et il n'y a pas d'autre source.
  const grillePeinte = /grid/i.test(baseName);
  // ⭐ Le pavage se lit lui aussi dans le nom, par un `_hex`, et pour la même raison que le reste :
  // une image ne déclare rien, et le seul endroit où l'intention peut être écrite est le nom du
  // fichier. C'est le geste réel — on prend une carte-décor et on **pose** une grille hexagonale
  // dessus, aucun fournisseur ne livre d'hexagone.
  //
  // ⚠ Ce n'est pas la seule voie : le pavage se change aussi dans le panneau MJ, sur l'étage actif.
  // Le marqueur sert à ce qu'une carte **reste** hexagonale après régénération, sans quoi il
  // faudrait refaire le geste à chaque passage de l'outil.
  //
  // ⛔ `_hex` ne redimensionne rien. Les cases lues dans le nom restent des colonnes et des
  // rangées ; en pointe-en-haut, `pxPerCell` est la largeur d'un hexagone et le pas vertical vaut
  // `pxPerCell × √3/2`. Une carte dessinée pour du carré n'aura donc pas ses hexagones alignés sur
  // son décor — c'est attendu, et c'est le cas d'usage : le pavage est une couche de jeu, pas une
  // propriété du dessin.
  const pavageHex = /(^|[_\-\s])hex([_\-\s]|$)/i.test(baseName);

  const level = createLevel({
    id: levelId,
    name: displayName,
    order: lvlSpec?.order ?? 0,
    imageUrl: `maps/generated/${webpFileName}`,
    pxPerCell: resampleResult.pxPerCell,
    widthCells: dims.widthCells,
    heightCells: dims.heightCells,
    grid: {
      type: pavageHex ? 'hex' : 'square',
      // Une image n'a pas d'origine de carte déclarée : la grille part du coin, et la calibration
      // du nom de fichier suppose exactement ça. Un décalage se corrigerait à la main dans l'appli.
      offsetX: 0,
      offsetY: 0,
      color: '#000000',
      opacity: 0.25,
      // Une grille peinte dispense de la nôtre — sauf en hexagonal, où le quadrillage du dessin
      // est carré : il ne décrit alors plus le pavage joué, et le masquer laisserait le MJ sans
      // repère pour ses hexagones.
      visible: pavageHex ? true : !grillePeinte,
    },
    // Géométrie vide, assumée : c'est la définition d'une carte-décor.
    walls: [],
    portals: [],
    lights: [],
    // Ambiante pleine, non cuite : `baked` signalerait un éclairage déjà peint qu'on ne doit pas
    // doubler, ce qui n'est pas le cas ici — on ne sait simplement rien de l'éclairage.
    ambient: { color: '#ffffff', level: 1, baked: false },
  });

  return {
    level,
    width: resampleResult.width,
    height: resampleResult.height,
    warnings: [
      ...dims.warnings,
      ...resampleResult.warnings,
      `« ${displayName} » est une carte-décor : ni murs, ni portes, ni lumières. Les lignes de vue ` +
        `du lot 2 sont inertes sur cet étage, et sans pion PJ posé les joueurs ne verront rien.`,
      ...(grillePeinte
        ? ['Grille peinte détectée dans le nom : le quadrillage de l’application est désactivé.']
        : []),
    ],
  };
}

/**
 * Prépare une carte-décor **seule**, au même contrat de sortie que `prepareMap`.
 *
 * Ne fait qu'emballer `buildDecorLevel` dans la campagne, la scène et l'entrée de catalogue d'une
 * carte à un étage. Existe pour que l'aperçu de l'outil au double-clic — qui appelle `prepareMap` —
 * fonctionne sur une image sans que le pipeline à étages ait à changer.
 *
 * @param {string} imagePath
 * @param {string} outputDir
 * @param {number} [targetPxPerCell=140]
 * @param {object} [options]
 * @param {number} [options.maxTexturePx]
 * @param {number} [options.quality]
 */
export async function prepareDecorMap(imagePath, outputDir, targetPxPerCell = 140, options = {}) {
  const baseName = path.basename(imagePath, path.extname(imagePath));
  const generatedDir = path.join(outputDir, 'generated');
  if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });

  const decor = await buildDecorLevel(imagePath, null, generatedDir, targetPxPerCell, options);
  const level = decor.level;

  const campaign = createCampaign({
    campaignId: `campaign-${baseName}`,
    name: level.name,
    levels: [level],
  });
  const errors = validateCampaign(campaign);
  if (errors.length > 0) {
    throw new Error(`Validation échouée pour ${baseName} : ${errors.join('; ')}`);
  }

  const sceneFileName = `${baseName}.scene.json`;
  const scenePath = path.join(generatedDir, sceneFileName);
  fs.writeFileSync(scenePath, JSON.stringify(campaign, null, 2), 'utf-8');
  const sceneContent = fs.readFileSync(scenePath, 'utf-8');
  if (sceneContent.includes('data:') || sceneContent.includes('blob:')) {
    throw new Error(`Scène ${baseName} contient des URLs temporaires (data: ou blob:)`);
  }

  const sourceHash = sourceHashOf(imagePath).slice('sha256-'.length);

  return {
    mapId: baseName,
    name: level.name,
    sourceHash,
    sceneFile: scenePath,
    imageFile: path.join(generatedDir, `${baseName}.webp`),
    width: decor.width,
    height: decor.height,
    catalogEntry: {
      id: baseName,
      name: level.name,
      sourceUrl: `maps/${path.basename(imagePath)}`,
      sceneUrl: `maps/generated/${sceneFileName}`,
      imageUrl: `maps/generated/${baseName}.webp`,
      sourceHash: `sha256-${sourceHash}`,
      levelCount: 1,
      features: {
        walls: 0,
        portals: 0,
        lights: 0,
        bakedLighting: false,
        animated: false,
      },
    },
    warnings: decor.warnings,
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
/**
 * Recette d'une carte : ce qui doit être identique pour pouvoir sauter sa préparation.
 *
 * **`sourceHash` seul ne suffit pas**, et c'est le piège que cette fonction existe pour
 * fermer : changer le plafond, la qualité ou le code ne change pas un octet du `.dd2vtt`.
 * Un cache indexé sur la seule source sauterait la carte en affirmant qu'elle est à jour,
 * et l'écart ne se verrait qu'à l'œil, bien plus tard. Pour une scène multi-étages ou munie
 * de liaisons, `sourceHash` (tableau) et `linksHash` comptent aussi.
 *
 * @param {string|string[]} sourceHash
 * @param {number} targetPxPerCell
 * @param {{ maxTexturePx?: number, quality?: number }} options
 * @param {string} [linksHash='']
 */
function recipeOf(sourceHash, targetPxPerCell, options, linksHash = '') {
  return {
    sourceHash,
    linksHash,
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
 * Exige la recette **et** la présence effective des artefacts : un sidecar qui survit à
 * un `rm` sur `generated/` doit provoquer une reconstruction, pas un catalogue qui référence
 * des fichiers absents.
 *
 * @param {any} known entrée du sidecar
 * @param {ReturnType<typeof recipeOf>} recipe
 * @param {string} mapsDir
 */
export function isReusable(known, recipe, mapsDir) {
  if (!known || !known.recipe || !known.catalogEntry) return false;
  const sameRecipe = /** @type {(keyof typeof recipe)[]} */ ([
    'targetPxPerCell',
    'maxTexturePx',
    'quality',
    'pipelineHash',
    'linksHash',
  ]).every((k) => known.recipe[k] === recipe[k]);
  if (!sameRecipe) return false;

  // Comparer sourceHash (chaîne ou tableau de chaînes)
  const kHash = known.recipe.sourceHash;
  const rHash = recipe.sourceHash;
  if (Array.isArray(kHash) || Array.isArray(rHash)) {
    if (!Array.isArray(kHash) || !Array.isArray(rHash) || kHash.length !== rHash.length) return false;
    if (kHash.some((h, i) => h !== rHash[i])) return false;
  } else if (kHash !== rHash) {
    return false;
  }

  // Vérifier la présence effective du fichier de scène et des images WebP référencées
  const scenePath = path.join(mapsDir, 'generated', path.basename(known.catalogEntry.sceneUrl));
  if (!fs.existsSync(scenePath)) return false;

  try {
    const sceneObj = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
    if (Array.isArray(sceneObj.levels)) {
      for (const level of sceneObj.levels) {
        if (level.imageUrl) {
          const imgPath = path.join(mapsDir, 'generated', path.basename(level.imageUrl));
          if (!fs.existsSync(imgPath)) return false;
        }
        // ⚠ La vidéo compte autant que l'image. Sans ce contrôle, supprimer un `.webm`
        // de `generated/` laissait la recette valide : la carte était déclarée à jour
        // et publiée avec un `videoUrl` pointant dans le vide. Le fond serait resté noir
        // sur la tablette, sans que rien dans la préparation ne le signale.
        if (level.videoUrl) {
          const vidPath = path.join(mapsDir, 'generated', path.basename(level.videoUrl));
          if (!fs.existsSync(vidPath)) return false;
        }
      }
    }
  } catch {
    return false;
  }

  return true;
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
export function findOrphanArtifacts(mapsDir, catalogEntries) {
  const generatedDir = path.join(mapsDir, 'generated');
  if (!fs.existsSync(generatedDir)) return [];

  const referenced = new Set();
  for (const entry of catalogEntries) {
    referenced.add(path.basename(entry.sceneUrl));
    referenced.add(path.basename(entry.imageUrl));
    // Pour les scènes multi-étages, chaque image d'étage est aussi référencée
    const scenePath = path.join(generatedDir, path.basename(entry.sceneUrl));
    if (fs.existsSync(scenePath)) {
      try {
        const sceneObj = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
        if (Array.isArray(sceneObj.levels)) {
          for (const l of sceneObj.levels) {
            if (l.imageUrl) referenced.add(path.basename(l.imageUrl));
            // Sans cette ligne, chaque passe déclarait orpheline la vidéo qu'elle venait
            // de publier — aucune entrée de catalogue ne la nomme, seule la scène le fait.
            // U-02 interdisant la suppression, rien n'était perdu : le coût est un
            // avertissement faux à chaque préparation, ce qui apprend à ne plus les lire.
            if (l.videoUrl) referenced.add(path.basename(l.videoUrl));
          }
        }
      } catch {
        /* ignorer */
      }
    }
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
 * Lit le manifeste `maps/scenes.json` s'il existe et construit la liste des scènes.
 *
 * @param {string} mapsDir
 * @param {string[]} availableFiles Noms des fichiers VTT disponibles dans maps/
 * @returns {{
 *   id: string,
 *   name: string,
 *   levels: { id: string, name: string, source: string, order: number }[]
 * }[]}
 */
function readSceneManifest(mapsDir, availableFiles) {
  const manifestPath = path.join(mapsDir, 'scenes.json');
  const availableSet = new Set(availableFiles);
  const assignedFiles = new Set();
  /** @type {any[]} */
  const scenes = [];

  if (fs.existsSync(manifestPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (Array.isArray(data.scenes)) {
        for (const s of data.scenes) {
          if (!s || typeof s.id !== 'string' || !Array.isArray(s.levels)) continue;
          const levels = [];
          for (let i = 0; i < s.levels.length; i++) {
            const l = s.levels[i];
            if (!l || !l.source || !availableSet.has(l.source)) continue;
            levels.push({
              id: typeof l.id === 'string' && l.id ? l.id : path.basename(l.source, path.extname(l.source)),
              name: typeof l.name === 'string' && l.name ? l.name : displayNameFromSlug(path.basename(l.source, path.extname(l.source))),
              source: l.source,
              order: typeof l.order === 'number' ? l.order : i,
            });
            assignedFiles.add(l.source);
          }
          if (levels.length > 0) {
            scenes.push({
              id: s.id,
              name: s.name || displayNameFromSlug(s.id),
              levels,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[prepare-maps] Erreur à la lecture de scenes.json : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Fichiers restants non assignés : une scène à 1 étage par fichier
  for (const file of availableFiles) {
    if (!assignedFiles.has(file)) {
      const slug = path.basename(file, path.extname(file));
      scenes.push({
        id: slug,
        name: displayNameFromSlug(slug),
        levels: [
          {
            id: slug,
            name: displayNameFromSlug(slug),
            source: file,
            order: 0,
          },
        ],
      });
    }
  }

  return scenes;
}

/**
 * Prépare tous les fichiers UVTT du répertoire maps/.
 *
 * Transactionnel : le catalogue n'est publié que si **toutes** les cartes ont
 * été préparées. Une seule carte fautive fait échouer l'appel sans écrire
 * `catalog.json`, et le catalogue précédent reste intact octet pour octet.
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
 * @throws {Error} si une carte échoue ou si la validation des liaisons échoue
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

  // ⛔ `filterSidecarImages` a besoin de la liste **entière** du dossier, pas des seules sources :
  // c'est la présence de `minimal.json` qui disqualifie `minimal.webp`, et filtrer d'abord la ferait
  // disparaître avant qu'elle ait pu disqualifier quoi que ce soit.
  const uvttFiles = filterSidecarImages(fs.readdirSync(mapsDir)).filter(isSupportedSource).sort();

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

  // Vérifier les collisions basiques avant tout
  planSources(uvttFiles);

  const sceneJobs = readSceneManifest(mapsDir, uvttFiles);

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

  const failures = [];

  for (const sceneJob of sceneJobs) {
    try {
      // 1. Calcul des hashes des sources et du fichier de liaisons
      const sourceHashes = sceneJob.levels.map((lvl) =>
        sourceHashOf(path.join(mapsDir, lvl.source))
      );
      const sourceHashValue = sourceHashes.length === 1 ? sourceHashes[0] : sourceHashes;

      const linksFilePath = path.join(mapsDir, `${sceneJob.id}.links.json`);
      let linksHash = '';
      let linksData = [];
      if (fs.existsSync(linksFilePath)) {
        const rawLinks = fs.readFileSync(linksFilePath, 'utf-8');
        linksHash = crypto.createHash('sha256').update(rawLinks).digest('hex');
        linksData = JSON.parse(rawLinks);
      }

      const recipe = recipeOf(sourceHashValue, targetPxPerCell, fabrication, linksHash);
      const known = knownRecipes[sceneJob.id];

      if (isReusable(known, recipe, mapsDir)) {
        catalogEntries.push(known.catalogEntry);
        nextRecipes[sceneJob.id] = known;
        totalWalls += known.catalogEntry.features.walls;
        totalPortals += known.catalogEntry.features.portals;
        totalLights += known.catalogEntry.features.lights;
        skippedCount++;
        console.log(`· ${sceneJob.id} inchangée, réutilisée`);
        continue;
      }

      // 2. Fabrication de la scène
      const generatedDir = path.join(mapsDir, 'generated');
      if (!fs.existsSync(generatedDir)) {
        fs.mkdirSync(generatedDir, { recursive: true });
      }

      const preparedLevels = [];
      const parseWarningsAcc = [];
      let sceneWalls = 0;
      let scenePortals = 0;
      let sceneLights = 0;
      let bakedLighting = false;

      for (const lvlSpec of sceneJob.levels) {
        const uvttPath = path.join(mapsDir, lvlSpec.source);

        // Carte-décor : une image n'a rien à parser, seulement à mesurer et à rééchantillonner.
        // Le reste du pipeline — campagne, scène, catalogue, réutilisation par empreinte — ne fait
        // aucune différence, ce qui permet de mêler images et exports UVTT dans une même campagne.
        if (isImageSource(lvlSpec.source)) {
          const decor = await buildDecorLevel(uvttPath, lvlSpec, generatedDir, targetPxPerCell, {
            maxTexturePx: fabrication.maxTexturePx,
            quality: fabrication.quality,
          });
          parseWarningsAcc.push(...decor.warnings);
          preparedLevels.push(decor.level);
          continue;
        }

        const fileContent = fs.readFileSync(uvttPath, 'utf-8');
        const uvttData = JSON.parse(fileContent);
        const { level, imageBase64, warnings: parseWarnings } = parseUvtt(uvttData);

        parseWarningsAcc.push(...parseWarnings);
        level.id = lvlSpec.id;
        level.name = lvlSpec.name;
        level.order = lvlSpec.order;

        const webpFileName = `${lvlSpec.id}.webp`;
        const webpPath = path.join(generatedDir, webpFileName);

        const { imageSource, videoPath } = resolveImageSource(uvttPath, imageBase64);

        const resampleResult = await resample(imageSource, targetPxPerCell, {
          sourcePxPerCell: videoPath ? targetPxPerCell : uvttData.resolution?.pixels_per_grid,
          widthCells: level.widthCells,
          heightCells: level.heightCells,
          outputPath: webpPath,
          maxTexturePx: fabrication.maxTexturePx,
          quality: fabrication.quality,
        });

        parseWarningsAcc.push(...resampleResult.warnings);

        const originX = uvttData.resolution?.map_origin?.x ?? 0;
        const originY = uvttData.resolution?.map_origin?.y ?? 0;

        level.pxPerCell = resampleResult.pxPerCell;
        level.imageUrl = `maps/generated/${webpFileName}`;
        const videoPrepare = videoPath ? prepareVideo(videoPath, generatedDir, lvlSpec.id) : null;
        level.videoUrl = videoPrepare?.url ?? null;
        parseWarningsAcc.push(...(videoPrepare?.warnings ?? []));
        level.grid.offsetX = originX * resampleResult.pxPerCell;
        level.grid.offsetY = originY * resampleResult.pxPerCell;

        preparedLevels.push(level);

        sceneWalls += level.walls.length;
        scenePortals += level.portals.length;
        sceneLights += level.lights.length;
        if (level.ambient?.baked) bakedLighting = true;
      }

      // Trier les étages par `order` croissant
      preparedLevels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      const campaign = createCampaign({
        campaignId: `campaign-${sceneJob.id}`,
        name: sceneJob.name,
        levels: preparedLevels,
        links: linksData,
      });

      const errors = validateCampaign(campaign);
      if (errors.length > 0) {
        throw new Error(`Validation de la scène "${sceneJob.id}" échouée : ${errors.join('; ')}`);
      }

      const sceneFileName = `${sceneJob.id}.scene.json`;
      const scenePath = path.join(generatedDir, sceneFileName);
      fs.writeFileSync(scenePath, JSON.stringify(campaign, null, 2), 'utf-8');

      const sceneContent = fs.readFileSync(scenePath, 'utf-8');
      if (sceneContent.includes('data:') || sceneContent.includes('blob:')) {
        throw new Error(`Scène ${sceneJob.id} contient des URLs temporaires (data: ou blob:)`);
      }

      const catalogEntry = {
        id: sceneJob.id,
        name: sceneJob.name,
        sourceUrl: sceneJob.levels.length === 1 ? `maps/${sceneJob.levels[0].source}` : sceneJob.levels.map((l) => `maps/${l.source}`),
        sceneUrl: `maps/generated/${sceneFileName}`,
        imageUrl: `maps/generated/${preparedLevels[0].id}.webp`,
        sourceHash: sourceHashValue,
        levelCount: preparedLevels.length,
        features: {
          walls: sceneWalls,
          portals: scenePortals,
          lights: sceneLights,
          bakedLighting,
          animated: preparedLevels.some((l) => l.videoUrl !== null),
        },
      };

      catalogEntries.push(catalogEntry);
      allWarnings.push(...parseWarningsAcc);
      nextRecipes[sceneJob.id] = { recipe, catalogEntry };

      totalWalls += sceneWalls;
      totalPortals += scenePortals;
      totalLights += sceneLights;
      preparedCount++;

      console.log(`✓ Scène "${sceneJob.id}" (${preparedLevels.length} étage(s)) préparée`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`✗ Erreur en préparant la scène ${sceneJob.id} : ${errMsg}`);
      failures.push({ file: sceneJob.id, error: errMsg });
    }
  }

  if (failures.length > 0) {
    const detail = failures.map((f) => ` - ${f.file} : ${f.error}`).join('\n');
    throw new Error(
      `${failures.length} scène(s) en échec sur ${sceneJobs.length}, aucun catalogue publié ` +
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
  const force = process.argv.includes('--force');
  prepareMaps({ force })
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
