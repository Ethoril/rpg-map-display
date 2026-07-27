// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pkgPath = path.join(rootDir, 'package.json');
const versionJsPath = path.join(rootDir, 'js', 'core', 'version.js');

const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgRaw);

const version = pkg.version || '0.1.0';
const currentBuild = typeof pkg.build === 'number' ? pkg.build : 0;
const nextBuild = currentBuild + 1;

pkg.build = nextBuild;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[WARN] git rev-parse a échoué: ${msg}`);
}

const builtAt = new Date().toISOString();
const label = `${version}+${nextBuild}`;

const versionJsContent = `// @ts-check
// FICHIER GÉNÉRÉ par scripts/stamp-version.mjs — toute édition manuelle sera écrasée.
export const VERSION = {
  version: '${version}',
  build: ${nextBuild},
  builtAt: '${builtAt}',
  commit: '${commit}',
  label: '${label}',
};
`;

fs.mkdirSync(path.dirname(versionJsPath), { recursive: true });
fs.writeFileSync(versionJsPath, versionJsContent, 'utf8');

console.log(`Version stamped: ${label} (${commit}) at ${builtAt}`);
