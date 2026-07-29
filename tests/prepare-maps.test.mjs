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

