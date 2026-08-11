// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, '..');
export const siteDir = path.join(rootDir, '_site');

/**
 * Seuls ces fichiers entrent dans GitHub Pages. Ce n'est pas un bundler : les modules
 * restent tels quels, avec leurs URLs relatives d'origine. Toute nouvelle surface
 * publique doit être ajoutée ici explicitement puis couverte par le test du paquet.
 */
export const SITE_MANIFEST = Object.freeze({
  rootFiles: Object.freeze([
    '.nojekyll',
    'index.html',
    'gm.html',
    'player.html',
    'attributions.html',
    'firebase-config.js',
  ]),
  runtimeEntryModules: Object.freeze([
    'js/app/gm.js',
    'js/app/player.js',
  ]),
  directories: Object.freeze([
    Object.freeze({ source: 'css', extension: '.css' }),
    Object.freeze({ source: 'assets/icons/status', extension: '.svg' }),
  ]),
  generatedFiles: Object.freeze([
    'maps/catalog.json',
    'maps/tokens/catalog.json',
  ]),
});

/**
 * Cartes autorisées à partir sur le web public, **avec leur provenance**.
 *
 * La règle du dépôt n'a jamais été « aucune carte » : c'est « aucune carte dont la
 * provenance n'est pas documentée ». Le catalogue publié était vide parce qu'aucune
 * carte ne remplissait la condition, pas parce que la publication serait interdite.
 *
 * Ajouter une entrée ici est un **acte de licence**, pas un réglage technique. La
 * question à laquelle il faut pouvoir répondre est : « si l'ayant droit demande de
 * quel droit ceci est en ligne, qu'est-ce que je réponds ? » Un usage privé à table
 * et une republication sur le web ne relèvent pas de la même clause — détenir une
 * licence d'usage ne suffit donc pas, il faut le droit de rediffuser.
 *
 * @type {ReadonlyArray<{ id: string, provenance: string }>}
 */
export const PUBLISHABLE_MAPS = Object.freeze([
  Object.freeze({
    id: 'testvideo-3',
    provenance:
      "Créée par le mainteneur du dépôt avec Dungeon Alchemist, dont la licence " +
      "autorise la diffusion des cartes produites par l'utilisateur. Aucune œuvre " +
      "de tiers n'y figure. Sert de banc d'essai au fond animé.",
  }),
]);

/** @param {string} directory @returns {string[]} */
function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(file) : [file];
    })
    .sort();
}

/** @param {string} file */
function copyRelative(file) {
  const relative = path.relative(rootDir, file);
  const destination = path.join(siteDir, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}

/**
 * Énumère le graphe des modules réellement chargé par les deux pages de jeu. Les
 * imports CDN ne sont pas locaux et ne doivent donc pas entrer dans l'artefact.
 *
 * @returns {string[]} chemins relatifs au dépôt, triés
 */
export function runtimeModuleFiles() {
  const pending = [...SITE_MANIFEST.runtimeEntryModules];
  const seen = new Set();
  const importPattern = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  while (pending.length > 0) {
    const relative = pending.pop();
    if (!relative || seen.has(relative)) continue;
    if (!relative.startsWith('js/') || path.extname(relative) !== '.js') {
      throw new Error(`Module runtime hors liste blanche : ${relative}`);
    }
    const absolute = path.join(rootDir, relative);
    if (!fs.existsSync(absolute)) throw new Error(`Module runtime introuvable : ${relative}`);
    seen.add(relative);

    const source = fs.readFileSync(absolute, 'utf8');
    for (const match of [...source.matchAll(importPattern), ...source.matchAll(dynamicImportPattern)]) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const imported = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      pending.push(imported);
    }
  }

  return [...seen].sort();
}

/**
 * Entrées de catalogue effectivement publiées, dans l'ordre de `PUBLISHABLE_MAPS`.
 *
 * L'ordre vient de la liste blanche et non du catalogue local : le paquet doit être
 * identique d'une machine à l'autre, or `maps/catalog.json` reflète l'ordre de
 * préparation du poste qui l'a produit.
 *
 * @returns {any[]}
 */
export function publishedMapEntries() {
  const catalogPath = path.join(rootDir, 'maps', 'catalog.json');
  if (!fs.existsSync(catalogPath)) return [];
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const byId = new Map((catalog.maps ?? []).map((/** @type {any} */ m) => [m.id, m]));

  return PUBLISHABLE_MAPS.flatMap(({ id }) => {
    const entry = byId.get(id);
    if (!entry) {
      throw new Error(
        `Carte publiable « ${id} » absente de maps/catalog.json. Lancer d'abord ` +
          `\`pnpm maps:prepare\` sur le poste qui détient les sources.`
      );
    }
    return [entry];
  });
}

/**
 * Fichiers d'actifs à copier pour les cartes publiées : scène, image, et fond animé.
 *
 * ⚠ La vidéo se lit dans la **scène**, pas dans l'entrée de catalogue : `videoUrl` est
 * une propriété d'étage. Une carte à plusieurs étages a donc plusieurs vidéos possibles,
 * et n'en oublier aucune est la différence entre un étage animé et un étage au fond noir.
 *
 * @returns {string[]} chemins relatifs au dépôt, triés, sans doublon
 */
export function publishedMapAssets() {
  const assets = new Set();
  for (const entry of publishedMapEntries()) {
    if (entry.sceneUrl) assets.add(entry.sceneUrl);
    if (entry.imageUrl) assets.add(entry.imageUrl);

    const scenePath = path.join(rootDir, entry.sceneUrl);
    if (!fs.existsSync(scenePath)) {
      throw new Error(`Scène absente pour la carte publiable « ${entry.id} » : ${entry.sceneUrl}`);
    }
    const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    for (const level of scene.levels ?? []) {
      if (level.imageUrl) assets.add(level.imageUrl);
      if (level.videoUrl) assets.add(level.videoUrl);
    }
  }

  for (const relative of assets) {
    // ⛔ Un `..` dans un `imageUrl`/`videoUrl` de scène ferait copier un fichier situé
    // **hors du dépôt** dans le paquet public. Ces scènes sont produites localement, donc
    // le risque est théorique — mais c'est la porte de publication : c'est l'endroit où
    // l'on ne présume rien, et la garde coûte trois lignes.
    const absolu = path.resolve(rootDir, relative);
    if (absolu !== path.join(rootDir, relative) || !absolu.startsWith(rootDir + path.sep)) {
      throw new Error(`Actif de carte publiable hors du dépôt : ${relative}`);
    }
    if (!fs.existsSync(absolu)) {
      throw new Error(`Actif de carte publiable introuvable : ${relative}`);
    }
  }
  return [...assets].sort();
}

/** @param {string} relative @param {unknown} value */
function writeJson(relative, value) {
  const destination = path.join(siteDir, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Construit l'artefact Pages depuis la liste blanche. Les cartes et portraits dont la
 * provenance n'est pas documentée ne sont volontairement pas copiés : voir
 * attributions.html. Les catalogues vides maintiennent le runtime fonctionnel sans
 * exposer une URL vers un asset non autorisé.
 *
 * @returns {string[]} chemins relatifs écrits, triés
 */
export function buildSite() {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });

  for (const relative of SITE_MANIFEST.rootFiles) {
    copyRelative(path.join(rootDir, relative));
  }

  for (const relative of runtimeModuleFiles()) {
    copyRelative(path.join(rootDir, relative));
  }

  for (const rule of SITE_MANIFEST.directories) {
    const sourceDir = path.join(rootDir, rule.source);
    for (const file of listFiles(sourceDir)) {
      if (path.extname(file) === rule.extension) copyRelative(file);
    }
  }

  writeJson('maps/catalog.json', { version: 1, maps: publishedMapEntries() });
  writeJson('maps/tokens/catalog.json', { version: 1, tokens: [] });

  for (const relative of publishedMapAssets()) {
    copyRelative(path.join(rootDir, relative));
  }

  return listFiles(siteDir)
    .map((file) => path.relative(siteDir, file).replaceAll(path.sep, '/'))
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const files = buildSite();
  console.log(`_site prêt : ${files.length} fichiers publiables.`);
}
