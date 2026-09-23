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
    // ⛔ Le nom RECONSTITUÉ contourne le `includes` ci-dessus : `level['px' + 'PerCell']` a vécu
    // dans `js/input/templateHit.js` jusqu'à l'audit du 22/09 (D3). Interdit partout, exceptions
    // comprises — une exception mentionne le nom, elle n'a aucune raison de le cacher.
    if (/(['"`])px\1\s*\+\s*(['"`])PerCell\2/.test(content)) {
      assert.fail(`Nom pxPerCell reconstitué pour échapper à ce test : ${rel}`);
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

test('5. Manifeste respecté (tout fichier de js/ et scripts/ figure dans ARCHITECTURE.md §1)', () => {
  // ⛔ Audit du 22/09, D5 : le test cherchait le NOM DE BASE n'importe où dans le document. Un
  // `js/ui/gm/stage.js` passait parce que `stage.js` est listé sous `render/`, et `scripts/`
  // n'était pas lu du tout. On reconstruit désormais les CHEMINS COMPLETS depuis l'arbre du §1.
  const archContent = fs.readFileSync(path.join(rootDir, 'docs', 'ARCHITECTURE.md'), 'utf8');
  const section = archContent.slice(archContent.indexOf('## 1.'), archContent.indexOf('## 2.'));
  const bloc = section.slice(section.indexOf('```') + 3, section.indexOf('```', section.indexOf('```') + 3));

  /** @type {Set<string>} */
  const listes = new Set();
  /** @type {string[]} */
  const pile = [];
  for (const ligne of bloc.split('\n')) {
    const m = /[├└]─ (\S+)/.exec(ligne);
    if (!m) continue;
    // Chaque niveau de l'arbre est indenté de 4 colonnes (`│   `).
    const profondeur = Math.round(m.index / 4);
    pile.length = profondeur;
    pile.push(m[1]);
    listes.add(pile.join(''));
  }
  assert.ok(listes.has('js/app/gm.js'), 'lecture de l’arbre du §1 : js/app/gm.js introuvable, le format a dérivé');

  /** @param {string} dir @returns {string[]} */
  const fichiers = (dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? fichiers(path.join(dir, e.name)) : [path.join(dir, e.name)]
        )
      : [];
  const hors = [...fichiers(jsDir), ...fichiers(path.join(rootDir, 'scripts'))]
    .map(toRelativeJsPath)
    .filter((rel) => /\.(?:js|mjs)$/.test(rel))
    .filter((rel) => !listes.has(rel));
  assert.deepEqual(hors, [], `Fichiers hors du manifeste ARCHITECTURE.md §1 : ${hors.join(', ')}`);
});

test("6. Règles d'importation (tableau §2 d'ARCHITECTURE.md vérifié fichier par fichier)", () => {
  // ⛔ Audit du 22/09, D4 — ce test était contournable de quatre façons : aucune branche pour
  // `ui/*` ni pour `input/*` au-delà de deux interdits ; les ré-exports `export … from` n'étaient
  // pas lus ; les chemins absolus `/js/…` étaient sautés ; `import( '…')` avec une espace
  // échappait au motif. Et il vérifiait des INTERDITS, là où la table dit ce qui est PERMIS :
  // `vision → movement → grid` contournait la règle portante n°1 par transitivité.
  //
  // Il lit désormais les imports d'EXÉCUTION seuls, commentaires retirés : un `@typedef
  // {import('…')}` n'ajoute aucune dépendance au chargement — c'est ainsi que `ui/*` nomme
  // l'interface `Transport` sans l'importer.
  /** Ce que chaque module a le droit d'importer, colonne « Peut importer » de la table §2. */
  const permis = /** @type {Record<string, string[]|null>} */ ({
    core: [],
    grid: ['core', 'movement'],
    transport: ['core'],
    state: ['core', 'grid', 'import'],
    import: ['core', 'grid'],
    movement: ['core', 'grid'],
    vision: ['core'],
    input: ['core'],
    render: ['core', 'grid', 'state', 'vision', 'input'],
    ui: null,
    app: null,
  });
  /** Interdits explicites, pour les modules sans liste d'autorisations. */
  const interdits = /** @type {Record<string, string[]>} */ ({
    ui: ['transport', 'app'],
    app: [],
  });

  const importRegex =
    /(?:\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?|\bexport\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

  for (const filePath of getAllJsFiles(jsDir)) {
    const rel = toRelativeJsPath(filePath);
    const module = rel.split('/')[1];
    const code = fs
      .readFileSync(filePath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

    for (const match of code.matchAll(importRegex)) {
      const importPath = match[1];
      let resolvedAbs;
      if (importPath.startsWith('.')) resolvedAbs = path.resolve(path.dirname(filePath), importPath);
      else if (importPath.startsWith('/')) resolvedAbs = path.join(rootDir, importPath);
      else continue; // spécificateur nu : l'import map, vérifiée par le test 2 et check-deps
      const importedRel = toRelativeJsPath(resolvedAbs);
      if (!importedRel.startsWith('js/')) continue;
      const cible = importedRel.split('/')[1];
      if (cible === module) continue;

      const liste = permis[module];
      if (liste) {
        assert.ok(
          liste.includes(cible),
          `Violation règle d'importation : ${rel} (${module}/*) ne peut importer que ${liste.map((m) => m + '/*').join(', ') || 'son propre module'}, mais importe ${importedRel}`
        );
      } else {
        assert.ok(
          !(interdits[module] ?? []).includes(cible),
          `Violation règle d'importation : ${rel} ne doit pas importer ${importedRel}`
        );
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
    // ⛔ Audit du 22/09, D6 : seuls jsdelivr et gstatic étaient cherchés — unpkg, esm.sh ou
    // skypack passaient. Toute URL dans un spécificateur d'import est interdite : les versions
    // n'ont qu'un domicile, l'import map (STACK.md).
    const importUrl = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"`](?:https?:)?\/\/[^'"`]+['"`]/;
    if (importUrl.test(content)) {
      assert.fail(`Import par URL dans le fichier JS : ${rel}`);
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
    // ⛔ `indexOf` vaut -1 si l'appel disparaît, et `slice(-1)` rend alors un caractère : la
    // garde `appel.length > 0` ne pouvait pas échouer (audit du 22/09, D10).
    const debut = contenu.indexOf('renderLayerStack({');
    assert.ok(debut >= 0, `${fichier} doit appeler renderLayerStack`);
    // L'objet littéral seul, jusqu'à sa fermeture à l'indentation de l'appel.
    const fin = contenu.indexOf('\n    });', debut);
    assert.ok(fin > debut, `${fichier} : fin de l'appel à renderLayerStack introuvable`);
    const appel = contenu.slice(debut, fin);

    // Les clés de premier niveau de l'objet littéral, à leur indentation propre, sous TOUTES
    // leurs formes : `cle: () => {`, `cle: fonction,`, `cle() {`. Le motif n'acceptait que la
    // première, et une couche écrite autrement échappait au contrôle.
    const cles = [...appel.matchAll(/^ {6}([a-zA-Z]+)\s*(?::|\()/gm)].map((m) => m[1]);
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

test('10. Aucune directive @ts-nocheck ni @ts-ignore (règle 1)', () => {
  // ⛔ Audit du 22/09, D2 : `js/app/sondeLatence.js` portait `@ts-nocheck`, et trois tests
  // `@ts-ignore`, sans qu'aucun test ne le voie. On cherche la DIRECTIVE — un commentaire qui
  // commence par elle — et non sa mention dans une phrase.
  const directive = /^\s*(?:\/\/|\/\*+|\*)\s*@ts-(?:nocheck|ignore)\b/m;
  /** @param {string} dir @returns {string[]} */
  const fichiers = (dir) => {
    if (!fs.existsSync(dir)) return [];
    /** @type {string[]} */
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const plein = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...fichiers(plein));
      else if (/\.(?:js|mjs)$/.test(e.name)) out.push(plein);
    }
    return out;
  };
  const fautifs = ['js', 'scripts', 'tests']
    .flatMap((r) => fichiers(path.join(rootDir, r)))
    .filter((f) => directive.test(fs.readFileSync(f, 'utf8')))
    .map(toRelativeJsPath);
  assert.deepEqual(fautifs, [], `directive de typage interdite dans : ${fautifs.join(', ')}`);
});
