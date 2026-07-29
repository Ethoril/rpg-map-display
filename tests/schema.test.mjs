import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaign,
  createLevel,
  createToken,
  isPersistableAssetUrl,
  validateCampaign,
  terrainCostRecordToMap,
  terrainCostMapToRecord,
} from '../js/core/schema.js';

test('Fabriques et validation de campagne valide', () => {
  const level = createLevel({ id: 'level-1', name: 'Niveau 1' });
  const token = createToken({ id: 'token-1', levelId: 'level-1', cell: { a: 2, b: 5 }, sizeCells: 1 });
  const campaign = createCampaign({
    levels: [level],
    tokens: [token],
  });

  const errors = validateCampaign(campaign);
  assert.deepEqual(errors, [], 'Une campagne créée par fabriques valides ne doit avoir aucune erreur');
});

test('Validation refuse schemaVersion différent de 2', () => {
  const campaign = createCampaign({ schemaVersion: 1 });
  const errors = validateCampaign(campaign);
  assert.ok(errors.some((err) => err.includes('schemaVersion')), 'Doit signaler schemaVersion invalide');
});

test('Validation refuse des coordonnées de pion non entières', () => {
  const level = createLevel({ id: 'rdc' });
  const tokenFloatA = createToken({ id: 't1', levelId: 'rdc', cell: { a: 1.5, b: 2 } });
  const tokenFloatB = createToken({ id: 't2', levelId: 'rdc', cell: { a: 3, b: 4.8 } });

  const campaign = createCampaign({
    levels: [level],
    tokens: [tokenFloatA, tokenFloatB],
  });

  const errors = validateCampaign(campaign);
  assert.ok(errors.length >= 2, 'Doit avoir au moins 2 erreurs de coordonnées');
  assert.ok(errors.some((err) => err.includes('coordonnées de pion non entières') && err.includes('t1')));
  assert.ok(errors.some((err) => err.includes('coordonnées de pion non entières') && err.includes('t2')));
});

test('Validation refuse un levelId de pion inconnu', () => {
  const level = createLevel({ id: 'rdc' });
  const tokenUnknownLevel = createToken({ id: 't1', levelId: 'etage-fantome', cell: { a: 0, b: 0 } });

  const campaign = createCampaign({
    levels: [level],
    tokens: [tokenUnknownLevel],
  });

  const errors = validateCampaign(campaign);
  assert.ok(errors.some((err) => err.includes('levelId inconnu') && err.includes('etage-fantome')));
});

test('Validation refuse sizeCells < 1', () => {
  const level = createLevel({ id: 'rdc' });
  const tokenZeroSize = createToken({ id: 't1', levelId: 'rdc', cell: { a: 0, b: 0 }, sizeCells: 0 });
  const tokenNegativeSize = createToken({ id: 't2', levelId: 'rdc', cell: { a: 0, b: 0 }, sizeCells: -1 });

  const campaign = createCampaign({
    levels: [level],
    tokens: [tokenZeroSize, tokenNegativeSize],
  });

  const errors = validateCampaign(campaign);
  assert.ok(errors.length >= 2, 'Doit avoir au moins 2 erreurs de sizeCells');
  assert.ok(errors.some((err) => err.includes('sizeCells doit être >= 1') && err.includes('t1')));
  assert.ok(errors.some((err) => err.includes('sizeCells doit être >= 1') && err.includes('t2')));
});

test('Les assets persistants acceptent les URLs relatives/HTTPS et refusent les URLs temporaires', () => {
  assert.equal(isPersistableAssetUrl(''), true);
  assert.equal(isPersistableAssetUrl('maps/ruines.webp'), true);
  assert.equal(isPersistableAssetUrl('/maps/ruines.webp?v=2'), true);
  assert.equal(isPersistableAssetUrl('https://cdn.example.test/ruines.webp'), true);

  assert.equal(isPersistableAssetUrl('data:image/png;base64,AAAA'), false);
  assert.equal(isPersistableAssetUrl('blob:https://example.test/id'), false);
  assert.equal(isPersistableAssetUrl('http://example.test/insecure.webp'), false);
  assert.equal(isPersistableAssetUrl('//example.test/ambiguous.webp'), false);
  assert.equal(isPersistableAssetUrl('javascript:alert(1)'), false);
});

test('Validation refuse les imageUrl temporaires des étages et des pions', () => {
  const level = createLevel({
    id: 'rdc',
    imageUrl: 'data:image/webp;base64,AAAA',
  });
  const token = createToken({
    id: 't1',
    levelId: 'rdc',
    imageUrl: 'blob:https://example.test/token',
  });
  const errors = validateCampaign(createCampaign({ levels: [level], tokens: [token] }));

  assert.ok(errors.some((err) => err.includes('Étage "rdc"') && err.includes('imageUrl non persistable')));
  assert.ok(errors.some((err) => err.includes('Pion "t1"') && err.includes('imageUrl non persistable')));
});

test('createToken rend les PJ déplaçables et les PNJ non déplaçables par défaut', () => {
  assert.equal(createToken({ kind: 'pc' }).playerMovable, true);
  assert.equal(createToken({ kind: 'npc' }).playerMovable, false);
  assert.equal(createToken({ kind: 'npc', playerMovable: true }).playerMovable, true);
});

test('Validation refuse identifiants dupliqués et pions hors limites', () => {
  const level = createLevel({ id: 'rdc', widthCells: 5, heightCells: 5 });
  const token = createToken({
    id: 'doublon',
    levelId: 'rdc',
    cell: { a: 4, b: 4 },
    sizeCells: 2,
  });
  const errors = validateCampaign(
    createCampaign({
      levels: [level, createLevel({ id: 'rdc' })],
      tokens: [token, createToken({ ...token })],
    })
  );

  assert.ok(errors.some((err) => err.includes("Identifiant d'étage dupliqué")));
  assert.ok(errors.some((err) => err.includes('Identifiant de pion dupliqué')));
  assert.ok(errors.some((err) => err.includes('position hors limites')));
});

test('Conversion terrainCost Record <-> Map', () => {
  const record = { '1,2': 2, '3,4': 1.5 };
  const map = terrainCostRecordToMap(record);
  assert.equal(map.get('1,2'), 2);
  assert.equal(map.get('3,4'), 1.5);

  const backToRecord = terrainCostMapToRecord(map);
  assert.deepEqual(backToRecord, record);

  assert.equal(terrainCostMapToRecord(null), null);
  assert.equal(terrainCostRecordToMap(null).size, 0);
});
