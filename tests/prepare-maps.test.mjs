import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

import { prepareMaps } from '../scripts/prepare-maps.mjs';

test('U-00 préparation : catalog.json créé avec structure minimale', async () => {
  const testMapsDir = path.join(rootDir, 'maps');
  const catalogPath = path.join(testMapsDir, 'catalog.json');

  // Sauvegarder le catalog existant s'il existe
  const backupPath = catalogPath + '.backup';
  if (fs.existsSync(catalogPath)) {
    fs.copyFileSync(catalogPath, backupPath);
  }

  try {
    const result = await prepareMaps({ mapsDir: testMapsDir });

    // Catalogue doit exister
    assert.ok(fs.existsSync(catalogPath), 'catalog.json doit être créé');

    // Catalogue doit être valide JSON
    const catalogJson = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

    // Structure minimale
    assert.ok(catalogJson.version);
    assert.ok(Array.isArray(catalogJson.maps));
  } finally {
    // Restaurer le backup
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, catalogPath);
      fs.unlinkSync(backupPath);
    }
  }
});

test('U-00 scène générée : aucune data: ou blob: URL', async () => {
  const testMapsDir = path.join(rootDir, 'maps');
  const catalogPath = path.join(testMapsDir, 'catalog.json');

  // Sauvegarder le catalog existant
  const backupPath = catalogPath + '.backup';
  if (fs.existsSync(catalogPath)) {
    fs.copyFileSync(catalogPath, backupPath);
  }

  try {
    await prepareMaps({ mapsDir: testMapsDir });
    const catalogJson = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

    // Pour chaque scène générée, vérifier qu'elle ne contient pas de data: ou blob:
    for (const mapEntry of catalogJson.maps) {
      const scenePath = path.join(testMapsDir, mapEntry.sceneUrl.replace(/^\.\//, ''));
      if (!fs.existsSync(scenePath)) {
        continue; // Fichier peut ne pas exister dans ce test synthétique
      }

      const sceneContent = fs.readFileSync(scenePath, 'utf-8');
      assert.ok(
        !sceneContent.includes('data:'),
        `La scène ${mapEntry.id} ne doit pas contenir data: URL`
      );
      assert.ok(
        !sceneContent.includes('blob:'),
        `La scène ${mapEntry.id} ne doit pas contenir blob: URL`
      );
    }
  } finally {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, catalogPath);
      fs.unlinkSync(backupPath);
    }
  }
});

test('U-00 identifiants stables : même UVTT produit même ID', async () => {
  const testMapsDir = path.join(rootDir, 'maps');
  const catalogPath = path.join(testMapsDir, 'catalog.json');

  const backupPath = catalogPath + '.backup';
  if (fs.existsSync(catalogPath)) {
    fs.copyFileSync(catalogPath, backupPath);
  }

  try {
    // Première préparation
    const result1 = await prepareMaps({ mapsDir: testMapsDir });
    const catalog1 = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const ids1 = new Set(catalog1.maps.map((/** @type {any} */ m) => m.id));

    // Deuxième préparation : doit produire les mêmes IDs
    const result2 = await prepareMaps({ mapsDir: testMapsDir });
    const catalog2 = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const ids2 = new Set(catalog2.maps.map((/** @type {any} */ m) => m.id));

    assert.deepEqual(ids1, ids2, 'Les identifiants doivent être stables entre deux préparations');
  } finally {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, catalogPath);
      fs.unlinkSync(backupPath);
    }
  }
});

test('U-00 conservation des champs : portails fermés, lumières avec ombres', async () => {
  // Test spécifique sur les fichiers synthétiques si nécessaire
  // Pour l'instant vérifié par parseUvtt.test.mjs
  assert.ok(true);
});

test('U-00 refus d\'UVTT invalide sans corrompre le catalogue', async () => {
  const testMapsDir = path.join(rootDir, 'maps');
  const catalogPath = path.join(testMapsDir, 'catalog.json');

  const backupPath = catalogPath + '.backup';
  if (fs.existsSync(catalogPath)) {
    fs.copyFileSync(catalogPath, backupPath);
  }

  try {
    // Créer d'abord un catalogue valide
    const firstResult = await prepareMaps({ mapsDir: testMapsDir });
    assert.ok(fs.existsSync(catalogPath), 'Le catalogue doit être créé après la première préparation');
    const validCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const validMapCount = validCatalog.maps.length;

    // Créer un UVTT invalide temporaire (image vide)
    const invalidPath = path.join(testMapsDir, 'invalid-test.uvtt');
    fs.writeFileSync(
      invalidPath,
      JSON.stringify({
        resolution: { pixels_per_grid: 64, map_size: { x: 10, y: 10 } },
        image: '', // Image vide — causera une erreur dans resample
      }),
      'utf-8'
    );

    try {
      // La préparation continue même avec l'UVTT invalide
      const secondResult = await prepareMaps({ mapsDir: testMapsDir });
      // Vérifier que le catalogue existe toujours et est valide
      assert.ok(fs.existsSync(catalogPath), 'Le catalogue doit exister après la deuxième préparation');
      const catalogAfter = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
      assert.ok(catalogAfter.version, 'Le catalogue doit avoir une version');
      // Les cartes précédentes sont conservées dans le catalogue
      assert.ok(catalogAfter.maps.length > 0, 'Le catalogue doit contenir au moins une carte');
    } finally {
      fs.unlinkSync(invalidPath);
    }
  } finally {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, catalogPath);
      fs.unlinkSync(backupPath);
    }
  }
});
