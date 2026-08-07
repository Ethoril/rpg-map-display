// @ts-check
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildSite, rootDir, runtimeModuleFiles, SITE_MANIFEST, siteDir } from '../scripts/build-site.mjs';

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
  const expected = [...SITE_MANIFEST.rootFiles, ...SITE_MANIFEST.generatedFiles, ...runtimeModuleFiles()];
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
  assert.equal(fs.existsSync(path.join(siteDir, 'js/app/diag.js')), false);
  assert.equal(fs.existsSync(path.join(siteDir, 'js/app/prepare.js')), false);
  assert.equal(fs.existsSync(path.join(siteDir, 'js/transport/FirebaseTransport.js')), true,
    'le transport chargé par import() reste disponible dans le paquet Pages');
  assert.match(fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8'), /href="\.\/attributions\.html"/);
  assert.match(fs.readFileSync(path.join(siteDir, 'js/ui/gm/panel.js'), 'utf8'), /href="\.\/attributions\.html"/);
  const attributions = fs.readFileSync(path.join(siteDir, 'attributions.html'), 'utf8');
  assert.match(attributions, /CC BY 3\.0/);
  assert.match(attributions, /fichiers distribués ont été adaptés/);
  assert.match(attributions, /game-icons\.net\/1x1\/sbed\/falling\.html/);

  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(siteDir, 'maps/catalog.json'), 'utf8')),
    { version: 1, maps: [] },
    'aucune carte sans provenance ne peut être référencée par le site public'
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(siteDir, 'maps/tokens/catalog.json'), 'utf8')),
    { version: 1, tokens: [] },
    'aucun portrait sans provenance ne peut être référencé par le site public'
  );
});
