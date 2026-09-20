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

test('V-01 validateCatalog : accepte sourceUrl et sourceHash sous forme de tableaux pour multi-étages', () => {
  const multiCatalog = {
    version: 1,
    maps: [
      {
        id: 'test_village_complet',
        name: 'Village',
        sourceUrl: [
          'maps/test_village_complet_00.dd2vtt',
          'maps/test_village_complet_01.dd2vtt',
          'maps/test_village_complet_02.dd2vtt',
        ],
        sceneUrl: 'maps/generated/test_village_complet.scene.json',
        imageUrl: 'maps/generated/test_village_complet_00.webp',
        sourceHash: [
          'sha256-490ae7239ad9fa0f7f6248d015161927500c0b4294f00083acf415e08f999c55',
          'sha256-f31db0f11d85057cca4c46629ec18a39ee523a6d519970be9586fda956a7f29b',
          'sha256-61eb212d516d97f05926c24802ef4749a6eb758f80773885ed34c2d163a506c8',
        ],
        levelCount: 3,
        features: {
          walls: 253,
          portals: 147,
          lights: 114,
          bakedLighting: true,
        },
      },
    ],
  };

  const errors = validateCatalog(multiCatalog);
  assert.deepEqual(errors, [], 'Catalogue multi-étages valide ne doit pas produire d\'erreurs');
});

// E-4 : le générateur écrit `features.animated`, le contrat l'ignorait. Il est optionnel en
// lecture — les catalogues déjà publiés n'en ont pas et leur absence vaut `false`.
test('E-4 validateCatalog : features.animated est accepté et la valeur survit', () => {
  const catalogue = {
    version: 1,
    maps: [
      {
        id: 'cascade',
        name: 'Cascade',
        sourceUrl: 'maps/cascade.uvtt',
        sceneUrl: 'maps/generated/cascade.scene.json',
        imageUrl: 'maps/generated/cascade.webp',
        sourceHash: 'sha256-abc',
        levelCount: 1,
        features: { walls: 12, portals: 2, lights: 3, bakedLighting: false, animated: true },
      },
    ],
  };

  assert.deepEqual(validateCatalog(catalogue), []);
  // La valeur n'est pas seulement tolérée : elle traverse la validation sans être effacée.
  assert.equal(catalogue.maps[0].features.animated, true);

  // Et un type faux est bien refusé, sinon « accepté » ne prouverait qu'une absence de contrôle.
  const faux = {
    version: 1,
    maps: [
      {
        ...catalogue.maps[0],
        features: { ...catalogue.maps[0].features, animated: 'oui' },
      },
    ],
  };
  assert.ok(
    validateCatalog(faux).some((e) => e.includes('animated')),
    'un animated non-booléen doit être signalé'
  );
});

test('E-4 validateCatalog : un catalogue sans features.animated reste accepté', () => {
  const ancien = {
    version: 1,
    maps: [
      {
        id: 'manoir',
        name: 'Manoir',
        sourceUrl: 'maps/manoir.uvtt',
        sceneUrl: 'maps/generated/manoir.scene.json',
        imageUrl: 'maps/generated/manoir.webp',
        sourceHash: 'sha256-def',
        levelCount: 1,
        features: { walls: 131, portals: 40, lights: 0, bakedLighting: true },
      },
    ],
  };

  assert.deepEqual(
    validateCatalog(ancien),
    [],
    'un catalogue publié avant `animated` doit rester valide'
  );
});


// ── Tranche C-1 : la vignette ────────────────────────────────────────────────────────────
//
// ⚠ `thumbUrl` est **optionnel en lecture**. Les catalogues déjà publiés n'en portent pas, et
// un validateur qui l'exigerait rendrait illisible tout ce qui existe — panne totale de la
// bibliothèque de cartes pour un champ d'agrément.

test('C-1 validateCatalog : un catalogue SANS thumbUrl reste valide', () => {
  const sansVignette = {
    version: 1,
    maps: [
      {
        id: 'ancienne',
        name: 'Carte publiée avant les vignettes',
        sourceUrl: 'maps/ancienne.uvtt',
        sceneUrl: 'maps/generated/ancienne.scene.json',
        imageUrl: 'maps/generated/ancienne.webp',
        sourceHash: 'sha256-abc123',
        levelCount: 1,
        features: { walls: 0, portals: 0, lights: 0, bakedLighting: false },
      },
    ],
  };

  assert.deepEqual(validateCatalog(sansVignette), []);
});

test('C-1 validateCatalog : une thumbUrl présente est tenue au contrat des autres URL', () => {
  /** @param {unknown} thumbUrl */
  const avecVignette = (thumbUrl) => ({
    version: 1,
    maps: [
      {
        id: 'neuve',
        name: 'Carte avec vignette',
        sourceUrl: 'maps/neuve.uvtt',
        sceneUrl: 'maps/generated/neuve.scene.json',
        imageUrl: 'maps/generated/neuve.webp',
        thumbUrl,
        sourceHash: 'sha256-abc123',
        levelCount: 1,
        features: { walls: 0, portals: 0, lights: 0, bakedLighting: false },
      },
    ],
  });

  assert.deepEqual(validateCatalog(avecVignette('maps/generated/neuve.thumb.webp')), []);

  const errors = validateCatalog(avecVignette('data:image/webp;base64,AAAA'));
  assert.ok(
    errors.some((e) => e.includes('thumbUrl') && e.includes('data:')),
    `une vignette en data: doit être refusée, erreurs : ${JSON.stringify(errors)}`
  );
});
