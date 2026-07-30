// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTokenCatalog, createTokenFromLibraryEntry } from '../js/import/tokenCatalog.js';

/** @type {import('../js/core/types.js').TokenLibraryEntry} */
const validEntry = {
  id: 'goblin-scout',
  name: 'Éclaireur Goblinoïde',
  imageUrl: 'maps/tokens/goblin.webp',
  kind: 'npc',
  sizeCells: 1,
  speedCells: 3,
  visionBright: 5,
  visionDim: 10,
  emitsLight: { range: 3, intensity: 0.5, color: '#ffaa00' },
  borderColor: '#e74c3c',
};

test('1. Validation du catalogue : entrée valide acceptée', () => {
  const catalog = {
    version: 1,
    tokens: [validEntry],
  };
  const errors = validateTokenCatalog(catalog);
  assert.deepEqual(errors, []);
});

test('2. Validation du catalogue : version manquante ou invalide refusée', () => {
  const missingVer = { tokens: [validEntry] };
  const badVer = { version: 2, tokens: [validEntry] };

  assert.ok(validateTokenCatalog(missingVer).some((e) => e.includes('version manquante')));
  assert.ok(validateTokenCatalog(badVer).some((e) => e.includes('version invalide')));
});

test('3. Validation du catalogue : imageUrl en data: ou blob: refusée', () => {
  const dataUrlCatalog = {
    version: 1,
    tokens: [{ ...validEntry, imageUrl: 'data:image/webp;base64,AAAA' }],
  };
  const blobUrlCatalog = {
    version: 1,
    tokens: [{ ...validEntry, imageUrl: 'blob:http://localhost/1234' }],
  };

  const dataErrors = validateTokenCatalog(dataUrlCatalog);
  assert.ok(dataErrors.some((e) => e.includes('ne doit pas être une data: URL')));

  const blobErrors = validateTokenCatalog(blobUrlCatalog);
  assert.ok(blobErrors.some((e) => e.includes('ne doit pas être une blob: URL')));
});

test('4. Validation du catalogue : doublon d’id refusé', () => {
  const duplicateIdCatalog = {
    version: 1,
    tokens: [validEntry, { ...validEntry, name: 'Autre Goblin' }],
  };
  const errors = validateTokenCatalog(duplicateIdCatalog);
  assert.ok(errors.some((e) => e.includes('id dupliqué "goblin-scout"')));
});

test('5. Projection TokenLibraryEntry -> Token : les 9 champs sont reportés et name alimente label', () => {
  const token = createTokenFromLibraryEntry(validEntry, { levelId: 'rdc-level' });

  assert.equal(token.label, validEntry.name); // name -> label
  assert.equal(token.imageUrl, validEntry.imageUrl);
  assert.equal(token.kind, validEntry.kind);
  assert.equal(token.sizeCells, validEntry.sizeCells);
  assert.equal(token.speedCells, validEntry.speedCells);
  assert.equal(token.visionBright, validEntry.visionBright);
  assert.equal(token.visionDim, validEntry.visionDim);
  assert.deepEqual(token.emitsLight, validEntry.emitsLight);
  assert.equal(token.borderColor, validEntry.borderColor);

  // Champs d'instanciation
  assert.equal(token.levelId, 'rdc-level');
  assert.deepEqual(token.cell, { a: 0, b: 0 });
  assert.equal(token.hidden, false);
  assert.equal(token.playerMovable, false); // kind === 'npc'
  assert.equal(token.locked, false);
  assert.equal(token.elevation, 0);
  assert.deepEqual(token.markers, []);
});
