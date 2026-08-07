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

  writeJson('maps/catalog.json', { version: 1, maps: [] });
  writeJson('maps/tokens/catalog.json', { version: 1, tokens: [] });

  return listFiles(siteDir)
    .map((file) => path.relative(siteDir, file).replaceAll(path.sep, '/'))
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const files = buildSite();
  console.log(`_site prêt : ${files.length} fichiers publiables.`);
}
