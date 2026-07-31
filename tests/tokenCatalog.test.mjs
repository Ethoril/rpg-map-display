// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTokenCatalog,
  createTokenFromLibraryEntry,
  upsertTokenEntry,
  removeTokenEntry,
} from '../js/import/tokenCatalog.js';

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

// --- Mutations de la bibliothèque (chantier M) --------------------------------------
//
// Ces fonctions sont pures pour être testables sans serveur : c'est le serveur local qui
// fait l'écriture, et la forme du catalogue reste la responsabilité de ce module.

test('6. upsert ajoute une entrée absente et valide le résultat', () => {
  const { catalog, errors, replaced } = upsertTokenEntry({ version: 1, tokens: [] }, validEntry);

  assert.deepEqual(errors, []);
  assert.equal(replaced, false);
  assert.equal(catalog.tokens.length, 1);
  assert.equal(catalog.tokens[0].id, 'goblin-scout');
});

test('7. upsert remplace une entrée de même id, sans la dupliquer', () => {
  const avant = { version: 1, tokens: [validEntry] };
  const { catalog, errors, replaced } = upsertTokenEntry(avant, {
    ...validEntry,
    name: 'Éclaireur renommé',
  });

  assert.deepEqual(errors, []);
  assert.equal(replaced, true, 'un id déjà présent doit remplacer, pas ajouter');
  assert.equal(catalog.tokens.length, 1, 'aucun doublon ne doit apparaître');
  assert.equal(catalog.tokens[0].name, 'Éclaireur renommé');
});

test('8. upsert est pure : le catalogue et l’entrée reçus ne sont pas mutés', () => {
  const avant = { version: 1, tokens: [validEntry] };
  const entree = { ...validEntry, id: 'autre', name: 'Autre' };

  const { catalog } = upsertTokenEntry(avant, entree);
  catalog.tokens[1].name = 'modifié après coup';

  assert.equal(avant.tokens.length, 1, 'le catalogue d’origine ne doit pas grossir');
  assert.equal(entree.name, 'Autre', 'l’entrée reçue ne doit pas être touchée');
});

test('9. upsert refuse une entrée invalide et le dit, sans rien publier', () => {
  // L'appelant écrit le fichier seulement si `errors` est vide : c'est là que se joue la
  // conservation du catalogue précédent.
  const { errors } = upsertTokenEntry(
    { version: 1, tokens: [] },
    { ...validEntry, imageUrl: 'data:image/webp;base64,AAAA' }
  );

  assert.ok(errors.length > 0, 'une data: URL doit être refusée');
  assert.ok(errors.some((e) => e.includes('data:')));
});

test('10. remove retire l’entrée demandée et rend son image comme orpheline', () => {
  const autre = { ...validEntry, id: 'autre', name: 'Autre', imageUrl: 'maps/tokens/autre.webp' };
  const { catalog, errors, removed } = removeTokenEntry(
    { version: 1, tokens: [validEntry, autre] },
    'goblin-scout'
  );

  assert.deepEqual(errors, []);
  assert.equal(removed?.imageUrl, 'maps/tokens/goblin.webp');
  assert.equal(catalog.tokens.length, 1);
  assert.equal(catalog.tokens[0].id, 'autre');
});

test('11. remove sur un id inconnu ne rend rien et ne perd aucune entrée', () => {
  const { catalog, removed } = removeTokenEntry({ version: 1, tokens: [validEntry] }, 'fantome');

  assert.equal(removed, null, 'l’appelant doit pouvoir distinguer « rien fait » de « fait »');
  assert.equal(catalog.tokens.length, 1);
});

test('12. remove permet de vider la bibliothèque, y compris l’entrée de démonstration', () => {
  const { catalog, errors } = removeTokenEntry({ version: 1, tokens: [validEntry] }, 'goblin-scout');

  assert.deepEqual(errors, [], 'un catalogue vide reste un catalogue valide');
  assert.deepEqual(catalog, { version: 1, tokens: [] });
});
