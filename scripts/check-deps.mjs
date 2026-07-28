// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Extrait l'import map d'une page HTML de la racine.
 *
 * @param {string} fichier nom du fichier, relatif à la racine
 * @returns {Record<string, string>}
 */
function lireImportMap(fichier) {
  const chemin = path.join(rootDir, fichier);
  if (!fs.existsSync(chemin)) {
    console.error(`Error: ${fichier} not found.`);
    process.exit(1);
  }
  const html = fs.readFileSync(chemin, 'utf8');
  const bloc = html.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/i);
  if (!bloc) {
    console.error(`Error: importmap script block not found in ${fichier}.`);
    process.exit(1);
  }
  try {
    /** @type {{ imports?: Record<string, string> }} */
    const parsed = JSON.parse(bloc[1]);
    return parsed.imports || {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error parsing importmap JSON in ${fichier}:`, msg);
    process.exit(1);
  }
}

/** Empreinte stable, insensible à l'ordre de déclaration des clés. */
const empreinte = (/** @type {Record<string, string>} */ map) =>
  JSON.stringify(map, Object.keys(map).sort());

const imports = lireImportMap('index.html');

// TOUTES les pages de la racine doivent porter la MÊME import map. C'est la seule garantie
// mécanique contre une dérive de version entre deux vues, qui produirait deux clients
// incompatibles sur la même session (exigence de T-23, appliquée dès maintenant à toute page).
const autresPages = fs
  .readdirSync(rootDir)
  .filter((f) => f.toLowerCase().endsWith('.html') && f !== 'index.html');

for (const page of autresPages) {
  if (empreinte(lireImportMap(page)) !== empreinte(imports)) {
    console.error(`[FAIL] L'import map de ${page} diffère de celle d'index.html.`);
    console.error('Les versions n\'ont qu\'un seul domicile : toutes les pages la partagent.');
    process.exit(1);
  }
  console.log(`[MAP OK] ${page} : import map identique à index.html.`);
}
/** @type {string[]} */
const urls = Object.values(imports);

if (urls.length === 0) {
  console.error('Error: No import URLs found in importmap.');
  process.exit(1);
}

let hasError = false;

for (const url of urls) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.status === 200) {
      console.log(`[OK 200] ${url}`);
    } else {
      console.error(`[FAIL ${res.status}] ${url}`);
      hasError = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] ${url}: ${msg}`);
    hasError = true;
  }
}

if (hasError) {
  console.error('Dependency check failed: one or more URLs did not respond with 200 OK.');
  process.exit(1);
}

console.log('All dependencies verified successfully (HTTP 200).');

/** @type {Map<string, string>} */
const pkgVersions = new Map();

for (const url of urls) {
  const jsdelivrMatch = url.match(/cdn\.jsdelivr\.net\/npm\/((?:@[^\/]+\/)?[^\/@]+)@([^\/]+)/);
  if (jsdelivrMatch) {
    pkgVersions.set(jsdelivrMatch[1], jsdelivrMatch[2]);
    continue;
  }

  const gstaticMatch = url.match(/gstatic\.com\/firebasejs\/([^\/]+)\//);
  if (gstaticMatch) {
    pkgVersions.set('firebase', gstaticMatch[1]);
  }
}

// Cohérence import map ⇄ devDependencies. Un paquet peut être installé en devDependency
// pour ses seuls types (pixi.js) alors que le navigateur le charge depuis le CDN. Si les
// deux versions divergent, `tsc` vérifie le code contre une API qui n'est pas celle
// exécutée à table : la vérification devient un mensonge silencieux. C'est bloquant.
const pkgJsonPath = path.join(rootDir, 'package.json');
/** @type {{ devDependencies?: Record<string, string> }} */
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
const devDeps = pkgJson.devDependencies ?? {};

let versionMismatch = false;

for (const [pkgName, importMapVersion] of pkgVersions.entries()) {
  const declared = devDeps[pkgName];
  if (!declared) continue;

  if (declared !== importMapVersion) {
    console.error(
      `[FAIL] ${pkgName} : import map en ${importMapVersion}, devDependency en ${declared}. ` +
        `Les types vérifiés ne sont pas ceux chargés à l'exécution.`
    );
    versionMismatch = true;
  } else {
    console.log(`[TYPES OK] ${pkgName}: devDependency ${declared} = import map.`);
  }
}

if (versionMismatch) {
  console.error('Dependency check failed: version figée incohérente entre import map et package.json.');
  process.exit(1);
}

for (const [pkgName, currentVersion] of pkgVersions.entries()) {
  try {
    const npmRes = await fetch(`https://registry.npmjs.org/${pkgName}/latest`);
    if (npmRes.ok) {
      const data = /** @type {{ version?: string }} */ (await npmRes.json());
      const latestVersion = data.version;
      if (latestVersion && currentVersion !== latestVersion) {
        console.warn(`[WARN] ${pkgName}: version figée ${currentVersion} (version npm récente: ${latestVersion})`);
      } else {
        console.log(`[NPM OK] ${pkgName}: version ${currentVersion} à jour.`);
      }
    } else {
      console.warn(`[WARN] Impossible d'interroger le registre npm pour ${pkgName} (status ${npmRes.status})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[WARN] Erreur lors de la vérification du registre npm pour ${pkgName}: ${msg}`);
  }
}

process.exit(0);
