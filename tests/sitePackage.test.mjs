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
  PUBLISHABLE_MAPS,
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

  // La porte n'a pas changé de nature : ce n'est pas « aucune carte », c'est « aucune
  // carte dont la provenance n'est pas écrite ». On vérifie donc l'égalité stricte avec
  // la liste blanche, pas une simple présence — sinon une carte tierce préparée sur le
  // poste du mainteneur partirait avec le reste sans que rien ne l'arrête.
  const publie = JSON.parse(fs.readFileSync(path.join(siteDir, 'maps/catalog.json'), 'utf8'));
  assert.deepEqual(
    publie.maps.map((/** @type {any} */ m) => m.id),
    PUBLISHABLE_MAPS.map((m) => m.id),
    'le catalogue public contient exactement les cartes de la liste blanche'
  );
  // ⭐ **La liste est épinglée ici, nommément.** Avant ce chantier l'invariant était
  // mécanique — `maps: []` — et aucune erreur humaine ne pouvait le franchir. Il est
  // désormais déclaratif, et une garde qui se contente de compter les caractères d'une
  // chaîne de provenance laisse passer n'importe quel remplissage. Épingler les
  // identifiants oblige à modifier CE test pour publier une carte de plus : la décision
  // de licence apparaît alors dans un diff, là où quelqu'un la relit.
  assert.deepEqual(
    PUBLISHABLE_MAPS.map((m) => m.id),
    ['testvideo-3'],
    'ajouter une carte au web public est un acte de licence : il doit se voir ici'
  );
  for (const { id, provenance } of PUBLISHABLE_MAPS) {
    assert.ok(provenance && provenance.length > 40, `provenance de « ${id} » non documentée`);
    assert.match(
      fs.readFileSync(path.join(rootDir, 'attributions.html'), 'utf8'),
      new RegExp(id),
      `« ${id} » est publiée mais absente de la page d'attributions`
    );
  }

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
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(siteDir, 'maps/tokens/catalog.json'), 'utf8')),
    { version: 1, tokens: [] },
    'aucun portrait sans provenance ne peut être référencé par le site public'
  );
});
