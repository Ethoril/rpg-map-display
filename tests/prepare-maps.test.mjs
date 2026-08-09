// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  prepareMaps,
  planSources,
  isSupportedSource,
  SUPPORTED_EXTENSIONS,
} from '../scripts/prepare-maps.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const MINIMAL_UVTT = path.join(rootDir, 'fixtures', 'synthetic', 'minimal.uvtt');

// Chaque cas travaille dans son propre dossier temporaire, sur une fixture de
// 1 Ko. Le dossier `maps/` du dépôt n'est ni lu ni muté : la suite ne peut plus
// abîmer le catalogue réel, et ne repasse plus 4,8 Mo dans le resampler à
// chaque assertion (une dizaine de secondes par test auparavant).

/**
 * Crée un dossier `maps/` temporaire, supprimé à la fin du test.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function makeTempMapsDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-maps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Dépose la fixture minimale sous le slug et l'extension demandés.
 * @param {string} mapsDir
 * @param {string} slug
 * @param {string} [ext='.uvtt']
 */
function addMap(mapsDir, slug, ext = '.uvtt') {
  fs.copyFileSync(MINIMAL_UVTT, path.join(mapsDir, `${slug}${ext}`));
}

/**
 * Dépose un UVTT syntaxiquement correct dont l'image est illisible : le
 * resampler échoue, ce qui est exactement la défaillance à rendre bloquante.
 * @param {string} mapsDir
 * @param {string} slug
 */
function addBrokenMap(mapsDir, slug) {
  fs.writeFileSync(
    path.join(mapsDir, `${slug}.uvtt`),
    JSON.stringify({
      resolution: { pixels_per_grid: 64, map_size: { x: 10, y: 10 } },
      image: '',
    }),
    'utf-8'
  );
}

test('U-00 succès : catalogue publié avec des compteurs exacts', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'minimal');

  const result = await prepareMaps({ mapsDir });

  assert.equal(result.mapsCount, 1);
  assert.equal(result.totalWalls, 1);
  assert.equal(result.totalPortals, 1);
  assert.equal(result.totalLights, 1);

  const catalogPath = path.join(mapsDir, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  assert.equal(catalog.version, 1);
  assert.equal(catalog.maps.length, 1);

  const [entry] = catalog.maps;
  assert.equal(entry.id, 'minimal');
  assert.equal(entry.name, 'Minimal');
  assert.equal(entry.levelCount, 1);
  assert.deepEqual(entry.features, {
    walls: 1,
    portals: 1,
    lights: 1,
    bakedLighting: false,
  });
  assert.match(entry.sourceHash, /^sha256-[0-9a-f]{64}$/);

  // Les artefacts que le catalogue référence doivent exister pour de vrai.
  assert.ok(fs.existsSync(path.join(mapsDir, 'generated', 'minimal.scene.json')));
  assert.ok(fs.existsSync(path.join(mapsDir, 'generated', 'minimal.webp')));

  assert.ok(!fs.existsSync(`${catalogPath}.tmp`), 'aucun .tmp ne doit subsister');
});

test('U-00 scène générée : aucune URL data: ni blob:', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'minimal');

  await prepareMaps({ mapsDir });

  const scene = fs.readFileSync(
    path.join(mapsDir, 'generated', 'minimal.scene.json'),
    'utf-8'
  );
  assert.ok(!scene.includes('data:'), 'la scène ne doit pas contenir data:');
  assert.ok(!scene.includes('blob:'), 'la scène ne doit pas contenir blob:');
});

test('U-00 identifiants stables : deux préparations, mêmes id et mêmes empreintes', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'minimal');
  const catalogPath = path.join(mapsDir, 'catalog.json');

  await prepareMaps({ mapsDir });
  const first = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  await prepareMaps({ mapsDir });
  const second = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  assert.deepEqual(
    second.maps.map((/** @type {any} */ m) => m.id),
    first.maps.map((/** @type {any} */ m) => m.id),
    'les identifiants doivent être stables entre deux préparations'
  );
  assert.deepEqual(
    second.maps.map((/** @type {any} */ m) => m.sourceHash),
    first.maps.map((/** @type {any} */ m) => m.sourceHash),
    'les empreintes de source doivent être stables entre deux préparations'
  );
});

test('U-00 une carte fautive parmi deux valides : catalogue précédent intact', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');
  addMap(mapsDir, 'beta');
  const catalogPath = path.join(mapsDir, 'catalog.json');

  await prepareMaps({ mapsDir });
  const bytesBefore = fs.readFileSync(catalogPath);
  assert.equal(JSON.parse(bytesBefore.toString('utf-8')).maps.length, 2);

  addBrokenMap(mapsDir, 'cassee');

  // U-02 / plan §6.9 : sortir en erreur sans publier un catalogue partiel.
  await assert.rejects(
    () => prepareMaps({ mapsDir }),
    /aucun catalogue publié/,
    'une carte fautive doit faire échouer la préparation'
  );

  assert.deepEqual(
    fs.readFileSync(catalogPath),
    bytesBefore,
    'le catalogue précédent doit rester identique octet pour octet'
  );
  assert.ok(!fs.existsSync(`${catalogPath}.tmp`), 'aucun .tmp ne doit subsister');
});

test('U-00 première préparation fautive : aucun catalogue créé', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');
  addBrokenMap(mapsDir, 'cassee');

  await assert.rejects(() => prepareMaps({ mapsDir }), /aucun catalogue publié/);

  assert.ok(
    !fs.existsSync(path.join(mapsDir, 'catalog.json')),
    'aucun catalogue ne doit être écrit quand une carte échoue'
  );
});

test('U-00 dossier sans UVTT : aucun catalogue écrit', async (t) => {
  const mapsDir = makeTempMapsDir(t);

  const result = await prepareMaps({ mapsDir });

  assert.equal(result.mapsCount, 0);
  assert.ok(
    !fs.existsSync(path.join(mapsDir, 'catalog.json')),
    'un dossier vide ne doit pas produire de catalogue vide'
  );
});

test('U-00 slugs en collision : refus avant toute écriture', () => {
  assert.throws(
    () => planSources(['minimal.uvtt', 'minimal.dd2vtt']),
    /Slugs en collision/,
    'deux sources de même slug doivent être refusées'
  );

  assert.deepEqual(
    planSources(['beta.uvtt', 'alpha.uvtt']),
    [
      { file: 'beta.uvtt', slug: 'beta' },
      { file: 'alpha.uvtt', slug: 'alpha' },
    ],
    'un jeu sans collision passe et conserve l’ordre reçu'
  );
});

test('U-00 artefacts orphelins : signalés et jamais supprimés', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'minimal');

  await prepareMaps({ mapsDir });

  const orphanPath = path.join(mapsDir, 'generated', 'carte-retiree.webp');
  fs.writeFileSync(orphanPath, 'artefact laissé par une préparation précédente');

  const result = await prepareMaps({ mapsDir });

  assert.ok(
    result.warnings.some((w) => w.includes('carte-retiree.webp')),
    'un artefact devenu orphelin doit être signalé'
  );
  assert.ok(
    fs.existsSync(orphanPath),
    'un artefact orphelin ne doit jamais être supprimé (critère U-02)'
  );
});

test('U-00 dryRun : rien n’est publié', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'minimal');

  const result = await prepareMaps({ mapsDir, dryRun: true });

  assert.equal(result.mapsCount, 1);
  assert.ok(
    !fs.existsSync(path.join(mapsDir, 'catalog.json')),
    'dryRun ne doit écrire aucun catalogue'
  );
});

test('U-00 support .dd2vtt et .df2vtt : catalogue publié et sourceUrl préserve l’extension', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'minimal-dd', '.dd2vtt');
  addMap(mapsDir, 'minimal-df', '.df2vtt');

  const result = await prepareMaps({ mapsDir });

  assert.equal(result.mapsCount, 2);
  const catalogPath = path.join(mapsDir, 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  assert.equal(catalog.maps.length, 2);
  const ddEntry = catalog.maps.find((/** @type {any} */ m) => m.id === 'minimal-dd');
  const dfEntry = catalog.maps.find((/** @type {any} */ m) => m.id === 'minimal-df');

  assert.ok(ddEntry, 'l’entrée minimal-dd doit être présente');
  assert.ok(dfEntry, 'l’entrée minimal-df doit être présente');

  assert.equal(ddEntry.sourceUrl, 'maps/minimal-dd.dd2vtt');
  assert.equal(dfEntry.sourceUrl, 'maps/minimal-df.df2vtt');
});

test('U-00 reconnaissance des sources : insensible à la casse, une seule règle', () => {
  for (const ext of SUPPORTED_EXTENSIONS) {
    assert.ok(isSupportedSource(`carte${ext}`), `${ext} en minuscules`);
    assert.ok(isSupportedSource(`CARTE${ext.toUpperCase()}`), `${ext} en capitales`);
  }

  // Sans cette insensibilité, un `CARTE.DD2VTT` était validé par les tests de
  // fixtures mais invisible à la préparation : carte absente, aucun message.
  assert.ok(isSupportedSource('Carte.Dd2Vtt'), 'casse mélangée');

  assert.ok(!isSupportedSource('.cachee.uvtt'), 'les fichiers cachés sont ignorés');
  assert.ok(!isSupportedSource('notes.txt'), 'extension non reconnue');
  assert.ok(!isSupportedSource('carte.uvtt.bak'), "l'extension doit terminer le nom");
});

test('U-00 collision bout-en-bout : minimal.uvtt et minimal.dd2vtt refusés avant écriture', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha', '.uvtt');
  const catalogPath = path.join(mapsDir, 'catalog.json');

  await prepareMaps({ mapsDir });
  const bytesBefore = fs.readFileSync(catalogPath);

  addMap(mapsDir, 'minimal', '.uvtt');
  addMap(mapsDir, 'minimal', '.dd2vtt');

  await assert.rejects(
    () => prepareMaps({ mapsDir }),
    /Slugs en collision/,
    'la collision entre minimal.uvtt et minimal.dd2vtt doit être refusée'
  );

  assert.deepEqual(
    fs.readFileSync(catalogPath),
    bytesBefore,
    'le catalogue précédent doit rester identique octet pour octet'
  );
  assert.ok(!fs.existsSync(`${catalogPath}.tmp`), 'aucun .tmp ne doit subsister');
});


// --- Chantier L : saut incrémental -------------------------------------------------
//
// La garde qui compte ici n'est pas « ça va plus vite », c'est « ça ne saute jamais à
// tort ». Un cache qui affirme qu'une carte est à jour alors que la recette a changé
// produit une divergence muette, visible des semaines plus tard et seulement à l'œil.

test('L : une seconde passe sans changement réutilise au lieu de refabriquer', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');

  const premiere = await prepareMaps({ mapsDir });
  assert.equal(premiere.preparedCount, 1);
  assert.equal(premiere.skippedCount, 0);

  const imagePath = path.join(mapsDir, 'generated', 'alpha.webp');
  const empreinte = fs.statSync(imagePath).mtimeMs;

  const seconde = await prepareMaps({ mapsDir });
  assert.equal(seconde.preparedCount, 0, 'rien ne doit être refabriqué');
  assert.equal(seconde.skippedCount, 1);
  assert.equal(seconde.mapsCount, 1, 'le catalogue reste complet malgré le saut');
  assert.equal(
    fs.statSync(imagePath).mtimeMs,
    empreinte,
    'le WebP ne doit pas avoir été réécrit'
  );
});

test('L : changer la qualité ou le plafond invalide le cache', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');

  await prepareMaps({ mapsDir });

  // La source n'a pas bougé d'un octet : seule la recette change. Un cache indexé sur
  // `sourceHash` seul sauterait la carte ici, et c'est exactement le défaut à empêcher.
  const autreQualite = await prepareMaps({ mapsDir, quality: 60 });
  assert.equal(autreQualite.preparedCount, 1, 'une qualité différente doit refabriquer');
  assert.equal(autreQualite.skippedCount, 0);

  const autrePlafond = await prepareMaps({ mapsDir, quality: 60, maxTexturePx: 512 });
  assert.equal(autrePlafond.preparedCount, 1, 'un plafond différent doit refabriquer');

  // Et la même recette que la passe précédente redevient réutilisable.
  const identique = await prepareMaps({ mapsDir, quality: 60, maxTexturePx: 512 });
  assert.equal(identique.skippedCount, 1);
});

test('L : un artefact effacé force la refabrication malgré un sidecar intact', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');
  await prepareMaps({ mapsDir });

  // Le sidecar survit à la disparition des fichiers. S'y fier seul publierait un
  // catalogue qui référence une image absente.
  fs.rmSync(path.join(mapsDir, 'generated', 'alpha.webp'));

  const apres = await prepareMaps({ mapsDir });
  assert.equal(apres.preparedCount, 1, 'l’artefact manquant doit être reconstruit');
  assert.ok(fs.existsSync(path.join(mapsDir, 'generated', 'alpha.webp')));
});

test('L : force refabrique tout, et le sidecar reste hors du catalogue', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');
  await prepareMaps({ mapsDir });

  const forcee = await prepareMaps({ mapsDir, force: true });
  assert.equal(forcee.preparedCount, 1);
  assert.equal(forcee.skippedCount, 0);

  // Le sidecar est caché, donc invisible au relevé d'orphelins, et absent du catalogue
  // publié — c'est une métadonnée de fabrication, pas une donnée de l'application.
  assert.ok(fs.existsSync(path.join(mapsDir, 'generated', '.recipes.json')));
  const catalogue = JSON.parse(fs.readFileSync(path.join(mapsDir, 'catalog.json'), 'utf-8'));
  assert.equal(catalogue.maps.length, 1);
  assert.ok(!JSON.stringify(catalogue).includes('recipe'));
  assert.ok(
    !forcee.warnings.some((/** @type {string} */ w) => w.includes('.recipes.json')),
    'le sidecar ne doit jamais être signalé comme orphelin'
  );
});

test('L : modifier le code du pipeline invalide le cache, à constantes identiques', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'alpha');
  await prepareMaps({ mapsDir });

  const sidecar = path.join(mapsDir, 'generated', '.recipes.json');
  const recettes = JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
  assert.ok(recettes.alpha.recipe.pipelineHash, 'la recette doit porter une empreinte de code');

  // Simule une correction du pipeline sans changement de constante — le cas réel du
  // 30/07, où floor → round a déplacé une dimension de sortie d'un pixel.
  recettes.alpha.recipe.pipelineHash = 'codeprecedent000';
  fs.writeFileSync(sidecar, JSON.stringify(recettes, null, 2), 'utf-8');

  const apres = await prepareMaps({ mapsDir });
  assert.equal(apres.preparedCount, 1, 'un pipeline différent doit refabriquer');
  assert.equal(apres.skippedCount, 0);
});

// --- Chantier V : multi-étages et liaisons -----------------------------------------

test('Chantier V : assemblage multi-étages via scenes.json et fusion de maps/<sceneId>.links.json', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'test_village_complet_00');
  addMap(mapsDir, 'test_village_complet_01');

  // Manifeste multi-étages
  fs.writeFileSync(
    path.join(mapsDir, 'scenes.json'),
    JSON.stringify({
      version: 1,
      scenes: [
        {
          id: 'test_village_complet',
          name: 'Test Village',
          levels: [
            { source: 'test_village_complet_00.uvtt', id: 'ground', name: 'RDC', order: 0 },
            { source: 'test_village_complet_01.uvtt', id: 'floor1', name: 'Étage 1', order: 1 },
          ],
        },
      ],
    }),
    'utf-8'
  );

  // Fichier de liaisons commité
  fs.writeFileSync(
    path.join(mapsDir, 'test_village_complet.links.json'),
    JSON.stringify([
      {
        id: 'stairs-1',
        kind: 'stairs',
        label: 'Escalier',
        a: { levelId: 'ground', at: { cellX: 5, cellY: 5 } },
        b: { levelId: 'floor1', at: { cellX: 5, cellY: 5 } },
        bidirectional: true,
        gmOnly: false,
      },
    ]),
    'utf-8'
  );

  const res = await prepareMaps({ mapsDir });
  assert.equal(res.mapsCount, 1);

  const sceneFile = path.join(mapsDir, 'generated', 'test_village_complet.scene.json');
  assert.ok(fs.existsSync(sceneFile));

  const scene = JSON.parse(fs.readFileSync(sceneFile, 'utf-8'));
  assert.equal(scene.levels.length, 2);
  assert.equal(scene.levels[0].id, 'ground');
  assert.equal(scene.levels[1].id, 'floor1');
  assert.equal(scene.links.length, 1);
  assert.equal(scene.links[0].id, 'stairs-1');

  const catalog = JSON.parse(fs.readFileSync(path.join(mapsDir, 'catalog.json'), 'utf-8'));
  assert.equal(catalog.maps.length, 1);
  assert.equal(catalog.maps[0].id, 'test_village_complet');
  assert.equal(catalog.maps[0].levelCount, 2);
});

test('Chantier V : validation stricte des liaisons — refus des liaisons vers un étage inconnu ou hors limites', async (t) => {
  const mapsDir = makeTempMapsDir(t);
  addMap(mapsDir, 'test_village_complet_00');
  addMap(mapsDir, 'test_village_complet_01');

  fs.writeFileSync(
    path.join(mapsDir, 'scenes.json'),
    JSON.stringify({
      version: 1,
      scenes: [
        {
          id: 'test_village_complet',
          name: 'Test Village',
          levels: [
            { source: 'test_village_complet_00.uvtt', id: 'ground', name: 'RDC', order: 0 },
            { source: 'test_village_complet_01.uvtt', id: 'floor1', name: 'Étage 1', order: 1 },
          ],
        },
      ],
    }),
    'utf-8'
  );

  // Fichier de liaisons invalide (étage 'attic' inconnu)
  fs.writeFileSync(
    path.join(mapsDir, 'test_village_complet.links.json'),
    JSON.stringify([
      {
        id: 'stairs-invalid',
        kind: 'stairs',
        label: 'Escalier cassé',
        a: { levelId: 'ground', at: { cellX: 5, cellY: 5 } },
        b: { levelId: 'attic', at: { cellX: 5, cellY: 5 } },
        bidirectional: true,
        gmOnly: false,
      },
    ]),
    'utf-8'
  );

  await assert.rejects(
    () => prepareMaps({ mapsDir }),
    /Liaison "stairs-invalid" : étage inconnu "attic"/,
    'La préparation doit échouer si une liaison contient un étage inconnu'
  );
});

