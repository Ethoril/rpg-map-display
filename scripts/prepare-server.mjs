// @ts-check
// Serveur LOCAL de l'outil de préparation des cartes (chantier L).
//
// Distinct de `scripts/serve.mjs` à dessein : celui-ci écrit sur le disque, alors que
// `serve.mjs` porte le contrat inverse — « ce serveur ne fait rien d'autre que servir des
// fichiers du dépôt » — et sert de socle aux tests Playwright. Lui ajouter une surface
// d'écriture l'ajouterait aux tests.
//
// Écoute sur 127.0.0.1 uniquement : il modifie le dépôt, il n'a rien à faire sur une
// interface réseau.
//
// Démarrage prévu par double-clic sur `outil-cartes.cmd`, pas par une commande tapée : le
// navigateur n'a pas le droit de lancer un processus, mais rien n'oblige le mainteneur à
// ouvrir un terminal pour autant. Ce script ouvre donc lui-même la page.
//
//   node scripts/prepare-server.mjs [--port 4180] [--no-open]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  prepareMap,
  prepareMaps,
  isSupportedSource,
  displayNameFromSlug,
} from './prepare-maps.mjs';
import { MAX_PREPARED_TEXTURE_PX, WEBP_QUALITY } from './resample.mjs';
import { parseUvtt } from '../js/import/uvtt.js';
import { validateLinks } from '../js/core/schema.js';
import {
  validateTokenCatalog,
  upsertTokenEntry,
  removeTokenEntry,
} from '../js/import/tokenCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mapsDir = path.join(repoRoot, 'maps');

/** Dossier jetable des variantes de comparaison. Ignoré par git, jamais publié. */
const previewDir = path.join(mapsDir, '.preview');

/**
 * Lit une option `--nom valeur` sur la ligne de commande.
 *
 * Le test `i !== -1` n'est pas défensif, il est **nécessaire** : `indexOf` rend `-1` quand
 * l'option est absente, et `process.argv[-1 + 1]` vaut `argv[0]`, soit le chemin de
 * l'exécutable Node. Comme ce n'est pas `undefined`, un `??` ne se déclenche pas et le
 * défaut est ignoré — d'où un `Number(...)` à `NaN` et un `ERR_SOCKET_BAD_PORT` au
 * démarrage sans argument. Défaut d'origine : ce test avait été retiré par simplification,
 * et aucun essai ne passait par le chemin sans `--port`.
 *
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i !== -1 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

const port = Number(arg('port', '4180'));
const ouvrirNavigateur = !process.argv.includes('--no-open');

/**
 * Ouvre l'adresse dans le navigateur par défaut du système.
 *
 * Échec silencieux **assumé** : si l'ouverture ne marche pas, le serveur tourne quand même
 * et l'adresse est affichée juste au-dessus. Faire tomber l'outil parce qu'un navigateur
 * n'a pas démarré serait absurde.
 *
 * @param {string} url
 */
function ouvrir(url) {
  try {
    if (process.platform === 'win32') {
      // `start` est une commande interne de cmd.exe, d'où le passage par `cmd /c`. Le
      // premier argument vide est le titre de fenêtre : sans lui, `start` prendrait l'URL
      // pour un titre et n'ouvrirait rien.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* adresse affichée dans la console, c'est suffisant */
  }
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
]);

/**
 * Lit une source **par le parseur du projet**, jamais en relisant les champs à sa façon.
 *
 * C'est la même règle que pour l'image : le format UVTT n'a qu'un lecteur,
 * `js/import/uvtt.js`. Une première version de cette fonction inspectait `data.resolution`
 * et comptait `data.portals.length` elle-même — donc elle rapportait ce que le fichier
 * *déclare*, pas ce que la chaîne en *retient*. Sur un export d'un outil inconnu, l'écart
 * entre les deux est précisément l'information qui compte : 141 portes déclarées et 0
 * exploitables doit se voir ici, avant toute fabrication.
 *
 * Les avertissements du parseur sont donc remontés tels quels.
 *
 * @param {string} file nom de fichier sous maps/
 */
function readSourceHeader(file) {
  const slug = path.basename(file, path.extname(file));
  const raw = fs.readFileSync(path.join(mapsDir, file), 'utf-8');
  const data = JSON.parse(raw);
  const { level, warnings } = parseUvtt(data);

  // Ce que le fichier annonce, pour le confronter à ce qui est retenu.
  const declares = {
    walls:
      (Array.isArray(data.line_of_sight) ? data.line_of_sight.length : 0) +
      (Array.isArray(data.objects_line_of_sight) ? data.objects_line_of_sight.length : 0),
    portals: Array.isArray(data.portals) ? data.portals.length : 0,
    lights: Array.isArray(data.lights) ? data.lights.length : 0,
  };

  // La densité est nommée comme telle, jamais `pxPerCell` : `js/` a l'interdiction dure de
  // ce nom hors de `js/grid/`, et la page n'a aucune raison de s'en approcher.
  const densiteSource = level.pxPerCell;

  return {
    file,
    slug,
    name: level.name && level.name !== 'Carte UVTT' ? level.name : displayNameFromSlug(slug),
    bytes: Buffer.byteLength(raw),
    cellsX: level.widthCells,
    cellsY: level.heightCells,
    densiteSource,
    sourceWidth: level.widthCells * densiteSource,
    sourceHeight: level.heightCells * densiteSource,
    walls: level.walls.length,
    portals: level.portals.length,
    lights: level.lights.length,
    declares,
    bakedLighting: level.ambient.baked,
    warnings,
  };
}

/** @param {http.IncomingMessage} req */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1_000_000) reject(new Error('Corps de requête trop volumineux'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/** GET /api/sources — les cartes disponibles et les constantes en vigueur. */
function apiSources() {
  const files = fs.existsSync(mapsDir)
    ? fs.readdirSync(mapsDir).filter(isSupportedSource).sort()
    : [];

  /** @type {any[]} */
  const sources = [];
  /** @type {any[]} */
  const illisibles = [];
  for (const file of files) {
    try {
      sources.push(readSourceHeader(file));
    } catch (err) {
      // Une source illisible ne doit pas vider la liste : elle se signale et les autres
      // restent utilisables.
      illisibles.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    sources,
    illisibles,
    defaults: {
      targetPxPerCell: 140,
      maxTexturePx: MAX_PREPARED_TEXTURE_PX,
      quality: WEBP_QUALITY,
    },
  };
}

/**
 * POST /api/preview — fabrique une variante dans maps/.preview/, sans jamais toucher
 * à maps/generated/ ni au catalogue.
 *
 * @param {any} body
 */
async function apiPreview(body) {
  const file = String(body.file ?? '');
  if (!file || !isSupportedSource(file)) {
    throw new Error(`Source non reconnue : ${file || '(vide)'}`);
  }
  // La source est reprise du **nom de base** : une valeur venue de la page ne doit jamais
  // pouvoir désigner un chemin hors de maps/, même sur une machine où l'on est seul.
  const safeFile = path.basename(file);
  const sourcePath = path.join(mapsDir, safeFile);
  if (!fs.existsSync(sourcePath)) throw new Error(`Fichier absent : ${safeFile}`);

  const targetPxPerCell = Number(body.targetPxPerCell) || 140;
  const fabrication = {
    maxTexturePx: Number(body.maxTexturePx) || MAX_PREPARED_TEXTURE_PX,
    quality: Number(body.quality) || WEBP_QUALITY,
  };

  // Un dossier par recette : deux variantes coexistent, ce qui est tout l'objet du
  // comparateur. Le nom porte les réglages, donc il se relit sans index.
  const variant = `${targetPxPerCell}-${fabrication.maxTexturePx}-q${fabrication.quality}`;
  const outputDir = path.join(previewDir, variant);
  fs.mkdirSync(path.join(outputDir, 'generated'), { recursive: true });

  const started = Date.now();
  const result = await prepareMap(sourcePath, outputDir, targetPxPerCell, fabrication);
  const bytes = fs.statSync(result.imageFile).size;
  const scene = JSON.parse(fs.readFileSync(result.sceneFile, 'utf-8'));
  const level = scene.levels[0];

  return {
    variant,
    slug: result.mapId,
    name: result.name,
    // URL servie par ce serveur, relative à la racine du dépôt.
    imageUrl: `/maps/.preview/${variant}/generated/${path.basename(result.imageFile)}`,
    width: result.width,
    height: result.height,
    densiteSortie: level.pxPerCell,
    widthCells: level.widthCells,
    heightCells: level.heightCells,
    bytes,
    elapsedMs: Date.now() - started,
    settings: { targetPxPerCell, ...fabrication },
    warnings: result.warnings,
  };
}

// --- Bibliothèque de pions ---------------------------------------------------------
//
// Le chantier I avait tranché « lecture seule, écrire depuis le navigateur est impossible
// sans chaîne d'upload ». Cette prémisse est tombée : ce serveur écrit dans le dépôt.
//
// La décision de refuser LocalStorage, elle, tient toujours et guide l'implantation : on
// écrit le **fichier commité**, pour que la bibliothèque voyage par git d'une machine à
// l'autre. Une bibliothèque de navigateur ne l'aurait pas fait.

const tokensDir = path.join(mapsDir, 'tokens');
const tokenCatalogPath = path.join(tokensDir, 'catalog.json');

/** Plafond d'une image de pion sur disque. Un pion de 200 px pèse trois kilo-octets. */
const TOKEN_FILE_MAX_BYTES = 256 * 1024;

/** Formats acceptés pour une image de pion, et extension de fichier associée. */
const TOKEN_IMAGE_TYPES = new Map([
  ['image/webp', '.webp'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
]);

function readTokenCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenCatalogPath, 'utf-8'));
    return { catalog: parsed, errors: validateTokenCatalog(parsed) };
  } catch (err) {
    // Catalogue absent : c'est une bibliothèque vide, pas une erreur. Corrompu : on le dit
    // sans l'écraser, pour ne pas détruire un fichier que le mainteneur peut réparer.
    if (/** @type {any} */ (err)?.code === 'ENOENT') {
      return { catalog: { version: 1, tokens: [] }, errors: [] };
    }
    throw new Error(
      `maps/tokens/catalog.json illisible : ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Écrit le catalogue de pions par `rename`, comme celui des cartes.
 *
 * @param {unknown} catalog
 */
function writeTokenCatalog(catalog) {
  fs.mkdirSync(tokensDir, { recursive: true });
  const temp = `${tokenCatalogPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
  try {
    fs.renameSync(temp, tokenCatalogPath);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

/** GET /api/tokens — la bibliothèque telle qu'elle est sur le disque. */
function apiTokens() {
  const { catalog, errors } = readTokenCatalog();
  return {
    tokens: Array.isArray(catalog.tokens) ? catalog.tokens : [],
    errors,
    limits: { maxBytes: TOKEN_FILE_MAX_BYTES, types: [...TOKEN_IMAGE_TYPES.keys()] },
  };
}

/**
 * Un identifiant de pion doit pouvoir servir de nom de fichier, tel quel.
 *
 * **Refuser plutôt qu'assainir.** Un `path.basename('../../evil')` rendrait `evil` : le
 * fichier resterait bien dans `tokens/`, mais l'entrée garderait l'identifiant tordu
 * pendant que le fichier en porterait un autre. Réécrire en silence l'intention de
 * l'appelant est le défaut que ce projet paie à répétition ; un refus explicite coûte un
 * message et ne laisse aucune incohérence derrière lui.
 *
 * @param {string} id
 */
function assertTokenId(id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(
      `Identifiant de pion "${id}" refusé : minuscules, chiffres et tirets seulement, ` +
        `en commençant par un caractère alphanumérique. Il sert aussi de nom de fichier.`
    );
  }
}

/**
 * Décode et contrôle l'image d'un pion **sans rien écrire**.
 *
 * La séparation entre contrôle et écriture n'est pas cosmétique : la première version
 * écrivait l'image avant de valider l'entrée, donc une entrée refusée laissait son fichier
 * derrière elle. Ici, l'appelant valide le catalogue complet avant d'appeler `commit()`.
 *
 * @param {string} id
 * @param {string} dataUrl image en `data:` produite par le générateur de pions
 * @returns {{ imageUrl: string, commit: () => void }}
 */
function prepareTokenImage(id, dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Image de pion : data: URL en base64 attendue');

  const ext = TOKEN_IMAGE_TYPES.get(m[1]);
  if (!ext) {
    throw new Error(
      `Image de pion : type "${m[1]}" refusé (acceptés : ${[...TOKEN_IMAGE_TYPES.keys()].join(', ')})`
    );
  }

  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > TOKEN_FILE_MAX_BYTES) {
    throw new Error(
      `Image de pion : ${(bytes.length / 1024).toFixed(0)} Kio dépasse le plafond de ` +
        `${TOKEN_FILE_MAX_BYTES / 1024} Kio. Un pion de 200 px en pèse trois.`
    );
  }

  const fileName = `${id}${ext}`;
  return {
    imageUrl: `maps/tokens/${fileName}`,
    commit: () => {
      fs.mkdirSync(tokensDir, { recursive: true });
      fs.writeFileSync(path.join(tokensDir, fileName), bytes);
    },
  };
}

/**
 * POST /api/tokens/save — insère ou remplace une entrée, image comprise.
 *
 * @param {any} body
 */
function apiTokenSave(body) {
  const entry = body?.entry;
  if (!entry || typeof entry !== 'object') throw new Error('Entrée de pion manquante');
  if (!entry.id || typeof entry.id !== 'string') throw new Error('Identifiant de pion manquant');
  assertTokenId(entry.id);

  const { catalog } = readTokenCatalog();

  // L'image n'est contrôlée que si la page en fournit une neuve. Éditer les métadonnées
  // d'une entrée existante ne doit pas exiger de reposter son image.
  const fourni = typeof body.imageDataUrl === 'string' && body.imageDataUrl.startsWith('data:');
  const image = fourni ? prepareTokenImage(entry.id, body.imageDataUrl) : null;
  const imageUrl = image ? image.imageUrl : entry.imageUrl;

  const { catalog: next, errors, replaced } = upsertTokenEntry(catalog, { ...entry, imageUrl });
  if (errors.length > 0) {
    // Rien n'est écrit sur une entrée invalide — ni catalogue, ni image. Le catalogue
    // précédent reste intact, et aucun fichier orphelin ne subsiste.
    throw new Error(`Entrée refusée : ${errors.join(' ; ')}`);
  }

  // Ordre voulu : l'image d'abord, le catalogue ensuite. Un catalogue qui référencerait
  // une image encore absente serait pire que l'inverse.
  image?.commit();
  writeTokenCatalog(next);
  return { tokens: next.tokens, replaced, imageUrl };
}

/**
 * POST /api/tokens/delete — retire une entrée, y compris une entrée de démonstration.
 *
 * @param {any} body
 */
function apiTokenDelete(body) {
  const id = String(body?.id ?? '');
  if (!id) throw new Error('Identifiant de pion manquant');

  const { catalog } = readTokenCatalog();
  const { catalog: next, errors, removed } = removeTokenEntry(catalog, id);
  if (!removed) throw new Error(`Aucun pion "${id}" dans la bibliothèque`);
  if (errors.length > 0) throw new Error(`Catalogue refusé : ${errors.join(' ; ')}`);

  writeTokenCatalog(next);

  // L'image survit délibérément : une campagne enregistrée peut encore la référencer.
  return {
    tokens: next.tokens,
    removed,
    orphan: removed.imageUrl,
  };
}

/**
 * GET /api/scene?id=<sceneId> — renvoie le document de scène généré.
 * @param {string} sceneId
 */
function apiScene(sceneId) {
  if (!sceneId) throw new Error('Identifiant de scène manquant');
  const safeId = path.basename(sceneId);
  const scenePath = path.join(mapsDir, 'generated', `${safeId}.scene.json`);
  if (!fs.existsSync(scenePath)) {
    throw new Error(`Scène introuvable : ${safeId}`);
  }
  return JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
}

/**
 * POST /api/scene/links — valide et sauvegarde les liaisons d'une scène.
 *
 * Écrit dans `maps/<sceneId>.links.json` (commité) et met à jour `maps/generated/<sceneId>.scene.json`.
 * Refuse explicitement tout lien vers un étage manquant ou avec des coordonnées hors limites.
 *
 * @param {any} body
 */
function apiSceneLinksSave(body) {
  const sceneId = String(body?.sceneId ?? '');
  const links = body?.links;
  if (!sceneId) throw new Error('Identifiant de scène manquant');
  if (!Array.isArray(links)) throw new Error('Tableau links requis');

  const safeId = path.basename(sceneId);
  const scenePath = path.join(mapsDir, 'generated', `${safeId}.scene.json`);
  if (!fs.existsSync(scenePath)) {
    throw new Error(`Scène introuvable : ${safeId}`);
  }

  const sceneObj = JSON.parse(fs.readFileSync(scenePath, 'utf-8'));
  const candidate = { ...sceneObj, links };
  const errors = validateLinks(candidate);
  if (errors.length > 0) {
    throw new Error(`Liaisons refusées : ${errors.join(' ; ')}`);
  }

  // 1. Écrire le fichier source de liaisons commité maps/<sceneId>.links.json
  const linksFilePath = path.join(mapsDir, `${safeId}.links.json`);
  const tempLinksPath = `${linksFilePath}.tmp`;
  fs.writeFileSync(tempLinksPath, JSON.stringify(links, null, 2), 'utf-8');
  fs.renameSync(tempLinksPath, linksFilePath);

  // 2. Mettre à jour le fichier dérivé généré
  sceneObj.links = links;
  const tempScenePath = `${scenePath}.tmp`;
  fs.writeFileSync(tempScenePath, JSON.stringify(sceneObj, null, 2), 'utf-8');
  fs.renameSync(tempScenePath, scenePath);

  return { ok: true, sceneId: safeId, linksCount: links.length };
}

/**
 * POST /api/publish — passe transactionnelle complète, **avec les constantes du dépôt**.
 *
 * Aucun réglage n'est accepté ici, et c'est délibéré : un réglage publiable au coup par coup
 * serait écrasé sans un mot par le prochain `pnpm maps:prepare`. Le comparateur sert à
 * décider, le dépôt porte la décision (`docs/CHANTIER-L-OUTIL-CARTES.md` §3.3).
 *
 * @param {any} body
 */
async function apiPublish(body) {
  const started = Date.now();
  const result = await prepareMaps({ force: Boolean(body.force) });
  return { ...result, elapsedMs: Date.now() - started };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const route = url.pathname;

  try {
    if (req.method === 'GET' && route === '/api/sources') {
      return sendJson(res, 200, apiSources());
    }
    if (req.method === 'GET' && route === '/api/scene') {
      return sendJson(res, 200, apiScene(url.searchParams.get('id') ?? ''));
    }
    if (req.method === 'POST' && route === '/api/scene/links') {
      return sendJson(res, 200, apiSceneLinksSave(await readJsonBody(req)));
    }
    if (req.method === 'POST' && route === '/api/preview') {
      return sendJson(res, 200, await apiPreview(await readJsonBody(req)));
    }
    if (req.method === 'POST' && route === '/api/publish') {
      return sendJson(res, 200, await apiPublish(await readJsonBody(req)));
    }
    if (req.method === 'GET' && route === '/api/tokens') {
      return sendJson(res, 200, apiTokens());
    }
    if (req.method === 'POST' && route === '/api/tokens/save') {
      return sendJson(res, 200, apiTokenSave(await readJsonBody(req)));
    }
    if (req.method === 'POST' && route === '/api/tokens/delete') {
      return sendJson(res, 200, apiTokenDelete(await readJsonBody(req)));
    }
  } catch (err) {
    // L'erreur remonte telle quelle à la page : c'est un outil de mainteneur, masquer la
    // cause ne protégerait personne et coûterait un aller-retour dans les journaux.
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }

  // Reste : fichiers du dépôt, comme serve.mjs.
  const relative = route === '/' ? 'prepare.html' : decodeURIComponent(route).replace(/^\/+/, '');
  const filePath = path.resolve(repoRoot, relative);
  if (filePath !== repoRoot && !filePath.startsWith(repoRoot + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(`404 Not Found: ${relative}`);
    }
    res.writeHead(200, {
      'content-type':
        MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });
});

const adresse = `http://127.0.0.1:${port}/`;

// Un second double-clic ne doit pas produire une trace d'erreur incompréhensible. Le port
// occupé signifie presque toujours « l'outil tourne déjà » : on ouvre la page et on sort
// proprement, plutôt que de planter sur EADDRINUSE.
server.on('error', (/** @type {any} */ err) => {
  if (err?.code === 'EADDRINUSE') {
    console.log(`L'outil tourne déjà sur ${adresse} — ouverture de la page.`);
    if (ouvrirNavigateur) ouvrir(adresse);
    process.exit(0);
  }
  console.error(`Impossible de démarrer le serveur : ${err?.message ?? err}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Outil de préparation des cartes : ${adresse}`);
  console.log(`Constantes en vigueur : ${MAX_PREPARED_TEXTURE_PX} px max, qualité ${WEBP_QUALITY}.`);
  console.log('Fermer cette fenêtre arrête l’outil.');
  if (ouvrirNavigateur) ouvrir(adresse);
});
