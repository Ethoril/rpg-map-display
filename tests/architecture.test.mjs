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
    // Mesure un **pas** en pixels et le compare à un autre pas ; ne convertit aucune position.
    // La règle interdit la conversion case <-> pixel positionnelle hors de `js/grid/`, pas la
    // mention d'une densité — d'où les deux entrées d'import ci-dessus, de la même famille.
    // ⛔ Ne pas « régler » ce genre de conflit en renommant le paramètre : la garde serait
    // contournée au lieu d'être respectée, et l'interdiction n°16 vise exactement ce geste.
    'js/import/gridPitch.js',
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

test("9. Toute couche branchée dans gm.js / player.js figure dans CANVAS_LAYER_ORDER", async () => {
  // ⛔ **Le défaut que ce test existe pour empêcher, payé le 26/08/2026.** `renderLayerStack`
  // parcourt `CANVAS_LAYER_ORDER` et JAMAIS les clés qu'on lui passe : une couche branchée
  // dans `gm.js` mais absente de cette liste n'est jamais appelée — **sans erreur, sans
  // avertissement, sans rouge**. La couche d'éclairage a vécu ainsi une porte verte entière
  // et deux jeux de captures d'écran avant que la comparaison témoin/nuit ne la démasque :
  // les deux images étaient identiques au pixel près.
  //
  // Le typage ne l'attrape pas non plus : `Partial<Record<…>>` accepte l'objet littéral sans
  // signaler la clé surnuméraire.
  const { CANVAS_LAYER_ORDER } = await import('../js/render/stage.js');
  const connues = new Set(CANVAS_LAYER_ORDER);

  for (const fichier of ['js/app/gm.js', 'js/app/player.js']) {
    const contenu = fs.readFileSync(path.join(rootDir, fichier), 'utf8');
    const appel = contenu.slice(contenu.indexOf('renderLayerStack({'));
    assert.ok(appel.length > 0, `${fichier} doit appeler renderLayerStack`);

    // Les clés de premier niveau de l'objet littéral, à leur indentation propre.
    const cles = [...appel.matchAll(/^ {6}([a-zA-Z]+): \(\) => \{/gm)].map((m) => m[1]);
    assert.ok(cles.length >= 8, `${fichier} : ${cles.length} couches lues, c'est trop peu — le motif a dérivé`);

    for (const cle of cles) {
      assert.ok(
        connues.has(cle),
        `${fichier} branche la couche « ${cle} », absente de CANVAS_LAYER_ORDER : elle ne sera JAMAIS appelée`
      );
    }
  }

  // Et le rang de la lumière est celui qu'a tranché le mainteneur : au-dessus du décor,
  // sous tout ce qui doit rester lisible.
  assert.equal(CANVAS_LAYER_ORDER.indexOf('light'), CANVAS_LAYER_ORDER.indexOf('grid') + 1);
  assert.ok(CANVAS_LAYER_ORDER.indexOf('light') < CANVAS_LAYER_ORDER.indexOf('tokens'));
  assert.ok(CANVAS_LAYER_ORDER.indexOf('light') < CANVAS_LAYER_ORDER.indexOf('fog'));
});
