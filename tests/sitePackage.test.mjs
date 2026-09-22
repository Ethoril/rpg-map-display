// @ts-check
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildSite,
  publishedMapAssets,
  publishedMapEntries,
  publishedTokenAssets,
  publishedTokenEntries,
  rootDir,
  runtimeModuleFiles,
  SITE_MANIFEST,
  siteDir,
} from '../scripts/build-site.mjs';

/** @param {string} directory @param {string} [root] @returns {string[]} */
function filesBelow(directory, root = directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(file, root) : [path.relative(root, file).replaceAll(path.sep, '/')];
    })
    .sort();
}

function expectedManifest() {
  const expected = [
    ...SITE_MANIFEST.rootFiles,
    ...SITE_MANIFEST.generatedFiles,
    ...runtimeModuleFiles(),
    ...publishedMapAssets(),
    ...publishedTokenAssets(),
  ];
  for (const rule of SITE_MANIFEST.directories) {
    const sourceDir = path.join(rootDir, rule.source);
    for (const file of filesBelow(sourceDir)) {
      if (path.extname(file) === rule.extension) expected.push(`${rule.source}/${file}`);
    }
  }
  return expected.sort();
}

function packageHashes() {
  return filesBelow(siteDir).map((relative) => {
    const contents = fs.readFileSync(path.join(siteDir, relative));
    return `${relative}:${crypto.createHash('sha256').update(contents).digest('hex')}`;
  });
}

test('R1-06 : le paquet Pages suit exactement la liste blanche et est déterministe', () => {
  const firstManifest = buildSite();
  assert.deepEqual(firstManifest, expectedManifest());
  assert.deepEqual(filesBelow(siteDir), expectedManifest());

  const firstHashes = packageHashes();
  const secondManifest = buildSite();
  assert.deepEqual(secondManifest, firstManifest);
  assert.deepEqual(packageHashes(), firstHashes);

  for (const forbidden of ['tests', 'scripts', 'docs', 'fixtures', 'node_modules']) {
    assert.equal(fs.existsSync(path.join(siteDir, forbidden)), false, `${forbidden} ne doit pas être publié`);
  }
  assert.equal(filesBelow(siteDir).some((file) => /\.(?:uvtt|dd2vtt|df2vtt)$/i.test(file)), false);
  // La page de diagnostic matériel EST publiée : c'est le seul outil conçu pour être
  // utilisé sur la tablette, et les portes qui restent ouvertes ne se ferment que là.
  assert.equal(fs.existsSync(path.join(siteDir, 'diag.html')), true);
  assert.equal(fs.existsSync(path.join(siteDir, 'js/app/diag.js')), true);
  // D11 (audit du 22/09/2026) : `docs/SONDE-LATENCE.md` fait taper `import('./js/app/sondeLatence.js')`
  // dans la vraie fenêtre MJ. Aucun module ne l'importe, donc il n'entrait pas dans le paquet :
  // sur Pages, la ligne rendait une 404. Même famille que E-15, les vignettes.
  assert.equal(fs.existsSync(path.join(siteDir, 'js/app/sondeLatence.js')), true);
  // `prepare.html` reste dehors, et pour une raison qui n'est pas la même : il parle à
  // `scripts/prepare-server.mjs`, qui n'existe pas sur Pages. Publié, il serait inerte
  // et mentirait sur ce qu'il sait faire.
  assert.equal(fs.existsSync(path.join(siteDir, 'js/app/prepare.js')), false);
  assert.equal(fs.existsSync(path.join(siteDir, 'prepare.html')), false);
  assert.equal(fs.existsSync(path.join(siteDir, 'js/transport/FirebaseTransport.js')), true,
    'le transport chargé par import() reste disponible dans le paquet Pages');
  assert.match(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), /href="\.\/attributions\.html"/);
  assert.match(fs.readFileSync(path.join(siteDir, 'js/ui/gm/panel.js'), 'utf8'), /href="\.\/attributions\.html"/);
  const attributions = fs.readFileSync(path.join(siteDir, 'attributions.html'), 'utf8');
  assert.match(attributions, /CC BY 3\.0/);
  assert.match(attributions, /fichiers distribués ont été adaptés/);
  assert.match(attributions, /game-icons\.net\/1x1\/sbed\/falling\.html/);

  const publie = JSON.parse(fs.readFileSync(path.join(siteDir, 'maps/catalog.json'), 'utf8'));
  // Le catalogue publié est **exactement** le catalogue préparé : plus de filtre par
  // carte. Les droits de diffusion sont assumés en amont par le mainteneur, la
  // construction ne rejoue pas cette décision.
  assert.deepEqual(
    publie.maps.map((/** @type {any} */ m) => m.id),
    publishedMapEntries().map((m) => m.id)
  );
  assert.ok(publie.maps.length > 0, 'un catalogue publié vide serait une bibliothèque morte');

  // Les actifs référencés par le catalogue publié doivent exister DANS le paquet. Une
  // entrée de catalogue dont l'image ou la vidéo n'est pas copiée donne une carte au
  // fond noir sur la tablette, et le catalogue seul ne le dit pas.
  for (const entry of publie.maps) {
    assert.ok(fs.existsSync(path.join(siteDir, entry.sceneUrl)), `scène absente : ${entry.sceneUrl}`);
    assert.ok(fs.existsSync(path.join(siteDir, entry.imageUrl)), `image absente : ${entry.imageUrl}`);
    const scene = JSON.parse(fs.readFileSync(path.join(siteDir, entry.sceneUrl), 'utf8'));
    for (const level of scene.levels) {
      if (level.videoUrl) {
        assert.ok(
          fs.existsSync(path.join(siteDir, level.videoUrl)),
          `fond animé absent du paquet : ${level.videoUrl}`
        );
      }
    }
  }
  // Les pions partent aussi, avec leurs images. ⚠ Le contrôle qui compte n'est pas le
  // catalogue mais les **fichiers** : un catalogue publié sans ses images donnerait une
  // bibliothèque pleine de cadres vides, et l'échec serait silencieux.
  const pions = JSON.parse(fs.readFileSync(path.join(siteDir, 'maps/tokens/catalog.json'), 'utf8'));
  assert.deepEqual(
    pions.tokens.map((/** @type {any} */ t) => t.id),
    publishedTokenEntries().map((t) => t.id)
  );
  for (const t of pions.tokens) {
    if (!t.imageUrl || /^(?:https?:)?\/\//i.test(t.imageUrl)) continue;
    assert.ok(
      fs.existsSync(path.join(siteDir, t.imageUrl)),
      `image du pion « ${t.id} » absente du paquet : ${t.imageUrl}`
    );
  }
});


test('R1-06b : TOUT ce que le catalogue publié référence est réellement dans le paquet', () => {
  // ⛔ **Ce test existe parce que celui d'au-dessus ne pouvait pas voir l'oubli.** `expectedManifest`
  // construit sa liste attendue à partir de `publishedMapAssets()` : si cette fonction oublie un
  // fichier, l'attendu l'oublie aussi et les deux coïncident. C'est une tautologie, pas une
  // couverture — et elle a laissé passer les vignettes le 21/09/2026, huit images cassées sur un
  // site par ailleurs vert.
  //
  // ⭐ Celui-ci part du CATALOGUE, l'autre source, et n'a donc pas ce point aveugle.
  const catalogue = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'maps/catalog.json'), 'utf8')
  );
  const publies = new Set(publishedMapAssets());

  /** @type {string[]} */
  const manquants = [];
  /** @param {unknown} url @param {string} origine */
  const exiger = (url, origine) => {
    if (typeof url !== 'string' || url === '') return;
    if (/^(?:https?:)?\/\//i.test(url) || url.startsWith('data:')) return;
    if (!publies.has(url)) manquants.push(`${origine} → ${url}`);
  };

  let vignettesVues = 0;
  for (const entry of catalogue.maps ?? []) {
    exiger(entry.sceneUrl, `${entry.id}.sceneUrl`);
    exiger(entry.imageUrl, `${entry.id}.imageUrl`);
    exiger(entry.thumbUrl, `${entry.id}.thumbUrl`);
    if (entry.thumbUrl) vignettesVues++;
    for (const niveau of entry.levels ?? []) {
      exiger(niveau.thumbUrl, `${entry.id}.levels[${niveau.levelId}].thumbUrl`);
      if (niveau.thumbUrl) vignettesVues++;
    }
  }

  assert.deepEqual(manquants, [], `référencés par le catalogue mais absents du paquet :\n  ${manquants.join('\n  ')}`);

  // ⛔ Sans cette ligne, le test passerait aussi sur un catalogue SANS aucune vignette — donc sur
  // le défaut d'origine, où la tranche A avait livré le code sans jamais republier.
  assert.ok(vignettesVues > 0, 'le catalogue publié doit porter des vignettes ; relancer maps:prepare');
});
