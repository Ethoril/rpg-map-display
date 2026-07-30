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

// Deux modes, un seul fichier généré.
//
// Sans `RPG_BUILD` : mode local historique — le compteur de `package.json` est
// incrémenté et réécrit. C'est un geste manuel, et c'est précisément ce qui a laissé
// l'estampille périmée pendant plusieurs déploiements : le numéro de build ne changeant
// plus, `checkBuildMismatch` (js/state/presence.js) comparait deux fois la même valeur
// et l'avertissement d'écart de build ne pouvait plus se déclencher.
//
// Avec `RPG_BUILD` : le numéro est imposé par l'appelant (la CI le dérive du nombre de
// commits, monotone par construction) et **`package.json` n'est pas touché** — rien à
// commiter en retour, donc aucune boucle de déploiement.
const buildOverride = process.env.RPG_BUILD;
let nextBuild;

if (buildOverride !== undefined && buildOverride !== '') {
  nextBuild = Number(buildOverride);
  // Échec bruyant volontaire : un repli silencieux sur le compteur de package.json
  // ramènerait exactement le défaut que ce mode corrige.
  if (!Number.isSafeInteger(nextBuild) || nextBuild < 0) {
    console.error(`[ERREUR] RPG_BUILD invalide : "${buildOverride}" (entier positif attendu)`);
    process.exit(1);
  }
} else {
  const currentBuild = typeof pkg.build === 'number' ? pkg.build : 0;
  nextBuild = currentBuild + 1;
  pkg.build = nextBuild;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

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
