// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const jsDir = path.join(rootDir, 'js');

/**
 * Récupère récursivement tous les fichiers JS sous un dossier.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function getAllJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  /** @type {string[]} */
  const results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Convertit un chemin absolu en chemin relatif normalisé (ex: js/core/types.js).
 *
 * @param {string} absPath
 * @returns {string}
 */
function toRelativeJsPath(absPath) {
  return path.relative(rootDir, absPath).replace(/\\/g, '/');
}

test('1. Application case <-> pixel confinée (hors js/grid/, pas de conversion positionnelle)', () => {
  const allJs = getAllJsFiles(jsDir);
  // Exceptions autorisées pour la mention du nom pxPerCell :
  const allowedMentionPaths = new Set([
    'js/core/types.js',
    'js/core/schema.js',
    'js/import/uvtt.js',
    'js/import/imageCalibrate.js',
    'js/ui/gm/importPanel.js',
  ]);

  for (const filePath of allJs) {
    const rel = toRelativeJsPath(filePath);
    if (rel.startsWith('js/grid/')) continue;

    const content = fs.readFileSync(filePath, 'utf8');

    if (content.includes('pxPerCell') && !allowedMentionPaths.has(rel)) {
      assert.fail(`Fichier non autorisé utilisant pxPerCell : ${rel}`);
    }
  }
});

test("2. Firebase confiné (aucun import 'firebase/...' hors js/transport/FirebaseTransport.js)", () => {
  const allJs = getAllJsFiles(jsDir);
  const forbiddenImportRegex = /from\s+['"]firebase\//i;

  for (const filePath of allJs) {
    const rel = toRelativeJsPath(filePath);
    if (rel === 'js/transport/FirebaseTransport.js') continue;

    const content = fs.readFileSync(filePath, 'utf8');
    if (forbiddenImportRegex.test(content) || content.includes("import('firebase")) {
      assert.fail(`Import Firebase non autorisé dans : ${rel}`);
    }
  }
});

test('3. Pas de coordonnées nommées (.col, .row, .q, .r sur objet cellule dans js/)', () => {
  const allJs = getAllJsFiles(jsDir);
  const namedCoordRegex = /\.(col|row|q|r)\b/g;

  for (const filePath of allJs) {
    const rel = toRelativeJsPath(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    // Éliminer les commentaires pour ignorer JSDoc
    const codeOnly = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');

    const matches = Array.from(codeOnly.matchAll(namedCoordRegex));
    if (matches.length > 0) {
      assert.fail(`Accès à une coordonnée nommée illicite (${matches[0][0]}) dans : ${rel}`);
    }
  }
});

test('4. vision/ indépendant de la grille (aucun import de grid/ dans js/vision/)', () => {
  const visionDir = path.join(jsDir, 'vision');
  const visionJs = getAllJsFiles(visionDir);

  for (const filePath of visionJs) {
    const rel = toRelativeJsPath(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('grid/') || content.includes('/grid')) {
      assert.fail(`Import de grid/ détecté dans js/vision/ : ${rel}`);
    }
  }
});

test('5. Manifeste respecté (tout fichier de js/ figure dans ARCHITECTURE.md §1)', () => {
  const archDocPath = path.join(rootDir, 'docs', 'ARCHITECTURE.md');
  const archContent = fs.readFileSync(archDocPath, 'utf8');

  const allJs = getAllJsFiles(jsDir);

  for (const filePath of allJs) {
    const rel = toRelativeJsPath(filePath);
    const basename = path.basename(rel);

    if (!archContent.includes(basename) && !archContent.includes(rel)) {
      assert.fail(`Fichier non listé dans le manifeste ARCHITECTURE.md §1 : ${rel}`);
    }
  }
});

test("6. Règles d'importation (tableau §2 d'ARCHITECTURE.md vérifié fichier par fichier)", () => {
  const allJs = getAllJsFiles(jsDir);

  for (const filePath of allJs) {
    const rel = toRelativeJsPath(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    const importRegex = /(?:import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]|import\s*\(?['"]([^'"]+)['"]\)?)/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath || !importPath.startsWith('.')) continue;

      const resolvedAbs = path.resolve(path.dirname(filePath), importPath);
      const importedRel = toRelativeJsPath(resolvedAbs);

      if (rel.startsWith('js/core/')) {
        if (!importedRel.startsWith('js/core/')) {
          assert.fail(`Violation règle d'importation : ${rel} ne peut importer que core/*, mais importe ${importedRel}`);
        }
      } else if (rel.startsWith('js/grid/')) {
        if (['render/', 'state/', 'transport/', 'ui/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      } else if (rel.startsWith('js/transport/')) {
        if (['render/', 'grid/', 'ui/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      } else if (rel.startsWith('js/state/')) {
        if (['render/', 'ui/', 'transport/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      } else if (rel.startsWith('js/import/')) {
        if (['render/', 'ui/', 'transport/', 'state/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      } else if (rel.startsWith('js/movement/')) {
        if (!importedRel.startsWith('js/core/') && !importedRel.startsWith('js/grid/') && !importedRel.startsWith('js/movement/')) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit importer que core/*, grid/* ou movement/*, mais importe ${importedRel}`);
        }
      } else if (rel.startsWith('js/vision/')) {
        if (['grid/', 'render/', 'ui/', 'state/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      } else if (rel.startsWith('js/render/')) {
        if (['transport/', 'ui/', 'import/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      } else if (rel.startsWith('js/input/')) {
        if (['render/', 'state/'].some((d) => importedRel.startsWith('js/' + d))) {
          assert.fail(`Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`);
        }
      }
    }
  }
});

test('7. Versions centralisées (aucun numéro de version ni URL CDN dans un .js)', () => {
  const allJs = getAllJsFiles(jsDir);
  const cdnRegex = /(https?:\/\/cdn\.jsdelivr\.net|https?:\/\/www\.gstatic\.com\/firebasejs)/i;

  for (const filePath of allJs) {
    const rel = toRelativeJsPath(filePath);
    if (rel === 'js/core/version.js') continue;

    const content = fs.readFileSync(filePath, 'utf8');
    if (cdnRegex.test(content)) {
      assert.fail(`URL CDN détectée dans le fichier JS : ${rel}`);
    }
  }
});

test('8. js/core/types.js sans code exécutable (pas de class, pas de function, aucun export que export {})', () => {
  const typesPath = path.join(jsDir, 'core', 'types.js');
  const content = fs.readFileSync(typesPath, 'utf8');

  const codeOnly = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .trim();

  const cleanCode = codeOnly.replace(/export\s*\{\s*\};?/g, '').trim();

  if (cleanCode.length > 0) {
    assert.fail(`Du code exécutable non autorisé a été trouvé dans js/core/types.js : "${cleanCode}"`);
  }
});
