// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const indexPath = path.join(rootDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('Error: index.html not found.');
  process.exit(1);
}

const htmlContent = fs.readFileSync(indexPath, 'utf8');
const importMapMatch = htmlContent.match(/<script\s+type="importmap">\s*([\s\S]*?)\s*<\/script>/i);

if (!importMapMatch) {
  console.error('Error: importmap script block not found in index.html.');
  process.exit(1);
}

/** @type {{ imports?: Record<string, string> }} */
let importMap;
try {
  importMap = JSON.parse(importMapMatch[1]);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Error parsing importmap JSON:', msg);
  process.exit(1);
}

const imports = importMap.imports || {};
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
