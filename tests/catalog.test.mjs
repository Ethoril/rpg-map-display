import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '../js/import/catalog.js';

test('U-03 validateCatalog : structure minimale valide', () => {
  const validCatalog = {
    version: 1,
    maps: [
      {
        id: 'manoir-rdc',
        name: 'Manoir — RDC',
        sourceUrl: 'maps/manoir-rdc.uvtt',
        sceneUrl: 'maps/generated/manoir-rdc.scene.json',
        imageUrl: 'maps/generated/manoir-rdc.webp',
        sourceHash: 'sha256-abc123',
        levelCount: 1,
        features: {
          walls: 131,
          portals: 40,
          lights: 0,
          bakedLighting: false,
        },
      },
    ],
  };

  const errors = validateCatalog(validCatalog);
  assert.deepEqual(errors, [], 'Catalogue valide ne doit pas produire d\'erreurs');
});

test('U-03 validateCatalog : refuse data: et blob: URLs', () => {
  const badCatalog = {
    version: 1,
    maps: [
      {
        id: 'bad',
        name: 'Bad',
        sourceUrl: 'maps/bad.uvtt',
        sceneUrl: 'data:application/json;base64,eyJpZCI6IjEifQ==',
        imageUrl: 'maps/bad.webp',
        sourceHash: 'sha256-xxx',
        levelCount: 1,
        features: { walls: 0, portals: 0, lights: 0, bakedLighting: false },
      },
    ],
  };

  const errors = validateCatalog(badCatalog);
  assert.ok(
    errors.some((e) => e.includes('data:')),
    'Doit refuser data: URL'
  );
});

test('U-03 validateCatalog : refuse les doublons d\'ID', () => {
  const dupCatalog = {
    version: 1,
    maps: [
      {
        id: 'dup',
        name: 'First',
        sourceUrl: 'maps/dup.uvtt',
        sceneUrl: 'maps/generated/dup1.scene.json',
        imageUrl: 'maps/generated/dup1.webp',
        sourceHash: 'sha256-a',
        levelCount: 1,
        features: { walls: 0, portals: 0, lights: 0, bakedLighting: false },
      },
      {
        id: 'dup',
        name: 'Second',
        sourceUrl: 'maps/dup2.uvtt',
        sceneUrl: 'maps/generated/dup2.scene.json',
        imageUrl: 'maps/generated/dup2.webp',
        sourceHash: 'sha256-b',
        levelCount: 1,
        features: { walls: 0, portals: 0, lights: 0, bakedLighting: false },
      },
    ],
  };

  const errors = validateCatalog(dupCatalog);
  assert.ok(
    errors.some((e) => e.includes('dupliqué')),
    'Doit refuser les IDs dupliqués'
  );
});

test('U-03 validateCatalog : version manquante est invalide', () => {
  const noCatalog = {
    maps: [],
  };

  const errors = validateCatalog(noCatalog);
  assert.ok(
    errors.some((e) => e.includes('version')),
    'Doit refuser catalogue sans version'
  );
});

test('U-03 validateCatalog : maps invalide retourne une erreur claire', () => {
  const invalidMaps = {
    version: 1,
    maps: 'not-an-array',
  };

  const errors = validateCatalog(invalidMaps);
  assert.ok(
    errors.some((e) => e.includes('tableau')),
    'Doit refuser maps non-array'
  );
});
