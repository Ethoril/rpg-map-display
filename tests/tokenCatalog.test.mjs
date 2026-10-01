// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTokenCatalog,
  createTokenFromLibraryEntry,
  upsertTokenEntry,
  removeTokenEntry,
  normalizeFolder,
  groupByFolder,
  numberLibraryCopy,
} from '../js/import/tokenCatalog.js';

/** @type {import('../js/core/types.js').TokenLibraryEntry} */
const validEntry = {
  id: 'goblin-scout',
  name: 'Éclaireur Goblinoïde',
  imageUrl: 'maps/tokens/goblin.webp',
  kind: 'npc',
  sizeCells: 1,
  speedCells: 3,
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

test('C-11 — un dossier est accepté, une valeur non normalisée refusée', () => {
  /** @param {unknown} folder */
  const avec = (folder) => validateTokenCatalog({ version: 1, tokens: [{ ...validEntry, folder }] });
  assert.deepEqual(avec('Monstres'), []);
  assert.deepEqual(validateTokenCatalog({ version: 1, tokens: [validEntry] }), [], 'absent = sans dossier');
  for (const mauvais of ['', '  ', ' Monstres', 'Monstres ', 'a'.repeat(61), 3, null]) {
    assert.equal(avec(mauvais).length, 1, `refusé : ${JSON.stringify(mauvais)}`);
  }
});

test('C-11 — normalizeFolder resserre les espaces et rend undefined pour « sans dossier »', () => {
  assert.equal(normalizeFolder('  PNJ   de  Valombre '), 'PNJ de Valombre');
  assert.equal(normalizeFolder(''), undefined);
  assert.equal(normalizeFolder('   '), undefined);
  assert.equal(normalizeFolder(undefined), undefined);
});

test('C-11 — groupByFolder : sans dossier en tête, puis dossiers et pions par ordre alphabétique', () => {
  const e = [
    { name: 'Zombie', folder: 'Morts-vivants' },
    { name: 'Elysia' },
    { name: 'Gobelin', folder: 'monstres' },
    { name: 'Squelette', folder: 'Morts-vivants' },
    { name: 'Bhelgi' },
    { name: 'Hydre', folder: 'Monstres 10' },
    { name: 'Ogre', folder: 'Monstres 2' },
  ];
  const groupes = groupByFolder(e);
  assert.deepEqual(
    groupes.map((g) => g.folder),
    [null, 'monstres', 'Monstres 2', 'Monstres 10', 'Morts-vivants']
  );
  assert.deepEqual(groupes[0].entries.map((x) => x.name), ['Bhelgi', 'Elysia']);
  assert.deepEqual(groupes[4].entries.map((x) => x.name), ['Squelette', 'Zombie']);
  assert.equal(e[0].name, 'Zombie', 'les entrées reçues ne sont pas réordonnées');
});

// ── C-15 — exemplaires numérotés ───────────────────────────────────────────────────────────────

/**
 * @param {string} id
 * @param {Record<string, any>} [extra]
 */
const gob = (id, extra = {}) => ({ id, libraryId: 'gobelin', label: 'Gobelin', ...extra });

test('C-15 — un exemplaire seul ne porte pas de numéro', () => {
  const r = numberLibraryCopy({ tokens: [] }, /** @type {any} */ (gob('a')));
  assert.equal(r.token.copyNumber, undefined);
  assert.equal(r.token.label, 'Gobelin');
  assert.deepEqual(r.patches, []);
  assert.equal(r.counter, null);
});

test('C-15 — le deuxième numérote le premier (1) et prend le 2 ; le troisième prend le 3', () => {
  const r2 = numberLibraryCopy({ tokens: [/** @type {any} */ (gob('a'))] }, /** @type {any} */ (gob('b')));
  assert.deepEqual(r2.patches, [{ tokenId: 'a', patch: { copyNumber: 1, label: 'Gobelin 1' } }]);
  assert.equal(r2.token.copyNumber, 2);
  assert.equal(r2.token.label, 'Gobelin 2');
  assert.equal(r2.counter, 2);

  const plateau = [gob('a', { copyNumber: 1, label: 'Gobelin 1' }), gob('b', { copyNumber: 2, label: 'Gobelin 2' })];
  const r3 = numberLibraryCopy({ tokens: /** @type {any} */ (plateau), settings: { copyCounters: { gobelin: 2 } } }, /** @type {any} */ (gob('c')));
  assert.deepEqual(r3.patches, []);
  assert.equal(r3.token.copyNumber, 3);
});

test('C-15 — un numéro n’est jamais réattribué, même quand le plus haut a disparu', () => {
  // Le 3 a été retiré : il ne reste que 1, et le compteur dit 3.
  const r = numberLibraryCopy(
    { tokens: /** @type {any} */ ([gob('a', { copyNumber: 1 })]), settings: { copyCounters: { gobelin: 3 } } },
    /** @type {any} */ (gob('d'))
  );
  assert.equal(r.token.copyNumber, 4);
  assert.equal(r.counter, 4);

  // Tous retirés : le suivant est seul, donc sans numéro — puis l'autre numérote les deux au-delà.
  const seul = numberLibraryCopy({ tokens: [], settings: { copyCounters: { gobelin: 4 } } }, /** @type {any} */ (gob('e')));
  assert.equal(seul.token.copyNumber, undefined);
  const deux = numberLibraryCopy(
    { tokens: /** @type {any} */ ([gob('e')]), settings: { copyCounters: { gobelin: 4 } } },
    /** @type {any} */ (gob('f'))
  );
  assert.deepEqual(deux.patches.map((p) => p.patch.copyNumber), [5]);
  assert.equal(deux.token.copyNumber, 6);
});

test('C-15 — la réserve compte, un pion renommé garde son nom, une autre entrée ne compte pas', () => {
  const r = numberLibraryCopy(
    {
      tokens: /** @type {any} */ ([{ id: 'o', libraryId: 'ogre', label: 'Ogre' }]),
      reserve: /** @type {any} */ ([gob('a', { label: 'Chef gobelin' })]),
    },
    /** @type {any} */ (gob('b'))
  );
  assert.deepEqual(r.patches, [{ tokenId: 'a', patch: { copyNumber: 1 } }]);
  assert.equal(r.token.copyNumber, 2);
  // Un pion fait à la main n'a pas de provenance : il ne se numérote pas.
  assert.deepEqual(numberLibraryCopy({ tokens: [] }, /** @type {any} */ ({ id: 'x', label: 'X' })).patches, []);
});
