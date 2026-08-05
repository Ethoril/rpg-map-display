import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaign,
  createLevel,
  createToken,
  isPersistableAssetUrl,
  isUnusableGoogleDriveUrl,
  normalizeImageUrl,
  isBoundedImageDataUrl,
  isTokenImageUrl,
  TOKEN_IMAGE_MAX_BYTES,
  TOKEN_IMAGE_TOTAL_MAX_BYTES,
  validateCampaign,
  normalizeCampaign,
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

test('Un lien de partage Google Drive devient une URL d’image directe', () => {
  // Le lien que Drive propose par défaut : une page HTML de 75 Ko, que `<img>` ne peut pas
  // afficher. C'est le geste naturel du MJ, donc c'est le cas à corriger, pas à refuser.
  assert.equal(
    normalizeImageUrl('https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view?usp=drive_link'),
    'https://drive.google.com/thumbnail?id=1tnBho2PcsZFcJyuLcuciW&sz=w2000'
  );
  // Les autres formes que Drive distribue selon l'endroit où l'on clique.
  assert.equal(
    normalizeImageUrl('https://drive.google.com/open?id=1tnBho2PcsZFcJyuLcuciW'),
    'https://drive.google.com/thumbnail?id=1tnBho2PcsZFcJyuLcuciW&sz=w2000'
  );
  assert.equal(
    normalizeImageUrl('https://drive.usercontent.google.com/download?id=1tnBho2PcsZFcJyuLcuciW&export=view'),
    'https://drive.google.com/thumbnail?id=1tnBho2PcsZFcJyuLcuciW&sz=w2000'
  );
  // Le résultat de la conversion est persistable : sans quoi le panneau le refuserait juste après.
  assert.equal(
    isPersistableAssetUrl(normalizeImageUrl('https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view')),
    true
  );
});

test('normalizeImageUrl ne touche à rien d’autre, et le dossier Drive est signalé', () => {
  // La fonction corrige un piège nommé ; elle ne réécrit pas les adresses en général.
  for (const url of [
    './maps/minimal.webp',
    '/maps/ruines.webp?v=2',
    'https://cdn.example.test/ruines.webp',
    'https://lh3.googleusercontent.com/d/1tnBho2PcsZFcJyuLcuciW=w2000',
    '',
  ]) {
    assert.equal(normalizeImageUrl(url), url);
  }

  // Un dossier n'a pas d'octets d'image à servir : aucune conversion n'est possible, et le
  // dire au MJ vaut mieux que de révéler un cadre vide aux joueurs.
  assert.equal(isUnusableGoogleDriveUrl('https://drive.google.com/drive/folders/1tnBho2PcsZ'), true);
  assert.equal(
    normalizeImageUrl('https://drive.google.com/drive/folders/1tnBho2PcsZ'),
    'https://drive.google.com/drive/folders/1tnBho2PcsZ'
  );
  assert.equal(isUnusableGoogleDriveUrl('https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view'), false);
  assert.equal(isUnusableGoogleDriveUrl('https://cdn.example.test/ruines.webp'), false);
  assert.equal(isUnusableGoogleDriveUrl('./maps/minimal.webp'), false);
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

test('Une image embarquée est acceptée bornée, refusée hors format ou hors plafond', () => {
  assert.equal(isBoundedImageDataUrl('data:image/webp;base64,AAAA'), true);
  assert.equal(isBoundedImageDataUrl('data:image/png;base64,AAA='), true);

  // Hors liste de formats : `data:` n'est pas un blanc-seing.
  assert.equal(isBoundedImageDataUrl('data:text/html;base64,AAAA'), false);
  assert.equal(isBoundedImageDataUrl('data:image/svg+xml;base64,AAAA'), false);
  // Non base64, donc de taille non déductible de la chaîne.
  assert.equal(isBoundedImageDataUrl('data:image/png,AAAA'), false);
  assert.equal(isBoundedImageDataUrl('blob:https://example.test/id'), false);
  assert.equal(
    isBoundedImageDataUrl(`data:image/png;base64,${'A'.repeat(TOKEN_IMAGE_MAX_BYTES)}`),
    false
  );

  // La tolérance est portée par isTokenImageUrl, pas par isPersistableAssetUrl : un
  // fond d'étage ne doit pas en hériter.
  assert.equal(isTokenImageUrl('data:image/webp;base64,AAAA'), true);
  assert.equal(isTokenImageUrl('maps/tokens/goblin.webp'), true);
  assert.equal(isPersistableAssetUrl('data:image/webp;base64,AAAA'), false);
});

test('Un pion accepte une image embarquée bornée, un étage jamais', () => {
  const level = createLevel({ id: 'rdc' });
  const token = createToken({
    id: 't1',
    levelId: 'rdc',
    imageUrl: 'data:image/webp;base64,AAAA',
  });
  assert.deepEqual(validateCampaign(createCampaign({ levels: [level], tokens: [token] })), []);

  const levelEmbarque = createLevel({ id: 'rdc', imageUrl: 'data:image/webp;base64,AAAA' });
  const errors = validateCampaign(createCampaign({ levels: [levelEmbarque] }));
  assert.ok(errors.some((err) => err.includes('Étage "rdc"') && err.includes('non persistable')));
});

test('Validation refuse une image de pion au-delà du plafond, et nomme sa taille', () => {
  const enorme = `data:image/png;base64,${'A'.repeat(TOKEN_IMAGE_MAX_BYTES)}`;
  const errors = validateCampaign(
    createCampaign({
      levels: [createLevel({ id: 'rdc' })],
      tokens: [createToken({ id: 't1', levelId: 'rdc', imageUrl: enorme })],
    })
  );

  const erreur = errors.find((err) => err.includes('Pion "t1"'));
  assert.ok(erreur, 'Le pion fautif doit être nommé');
  assert.ok(erreur.includes(String(enorme.length)), 'La taille reçue doit apparaître');
  assert.ok(erreur.includes(String(TOKEN_IMAGE_MAX_BYTES)), 'Le plafond doit apparaître');
});

test('Validation refuse un cumul d’images de pions qui remplirait le document Firestore', () => {
  // Chaque pion tient sous le plafond individuel : seul le cumul est fautif. C'est
  // exactement le défaut qu'un plafond par pion laisse passer.
  const image = `data:image/png;base64,${'A'.repeat(TOKEN_IMAGE_MAX_BYTES - 100)}`;
  const nombre = Math.ceil(TOKEN_IMAGE_TOTAL_MAX_BYTES / image.length) + 1;
  const tokens = Array.from({ length: nombre }, (_, index) =>
    createToken({ id: `t${index}`, levelId: 'rdc', imageUrl: image })
  );

  const errors = validateCampaign(
    createCampaign({ levels: [createLevel({ id: 'rdc' })], tokens })
  );

  const erreur = errors.find((err) => err.includes('Images de pions embarquées'));
  assert.ok(erreur, 'Le cumul doit être signalé');
  assert.ok(erreur.includes(String(nombre)), 'Le nombre de pions concernés doit apparaître');
  assert.ok(
    errors.every((err) => !err.includes('Pion "t0"')),
    'Aucun pion ne doit être fautif individuellement'
  );
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

test('Validation refuse une couleur hors #RRGGBB sur au moins deux des 8 chemins du modèle', () => {
  const level = createLevel({ id: 'rdc' });
  level.lights.push({
    id: 'light-argb',
    at: { cellX: 1, cellY: 1 },
    range: 3,
    intensity: 1,
    color: 'ffffffff',
    shadows: true,
  });
  level.ambient.color = 'ffffffff';

  const token = createToken({
    id: 't1',
    levelId: 'rdc',
    cell: { a: 0, b: 0 },
    borderColor: '00ff00', // Manque le #
  });

  const campaign = createCampaign({
    levels: [level],
    tokens: [token],
    templates: [
      {
        id: 'tpl1',
        levelId: 'rdc',
        shape: 'circle',
        origin: { x: 70, y: 70 },
        radiusCells: 2,
        directionDeg: 0,
        widthCells: 1,
        color: 'invalid-color',
        visibleToPlayers: true,
      },
    ],
  });

  const errors = validateCampaign(campaign);
  assert.ok(errors.length >= 4, 'Doit trouver au moins 4 erreurs de format de couleur');
  assert.ok(errors.some((err) => err.includes('lumière "light-argb"') && err.includes('ffffffff')));
  assert.ok(errors.some((err) => err.includes('éclairage ambiant') && err.includes('ffffffff')));
  assert.ok(errors.some((err) => err.includes('Pion "t1"') && err.includes('borderColor invalide')));
  assert.ok(errors.some((err) => err.includes('Gabarit "tpl1"') && err.includes('color invalide')));
});

test('normalizeCampaign convertit les anciens gabarits origin {a, b} en centre de case {x, y} sans cells', () => {
  const level = createLevel({ id: 'rdc', pxPerCell: 140 });
  const oldCampaign = {
    schemaVersion: 2,
    campaignId: 'c1',
    name: 'Ancienne campagne',
    levels: [level],
    links: [],
    tokens: [],
    templates: [
      {
        id: 'tpl-old',
        levelId: 'rdc',
        shape: 'circle',
        origin: { a: 2, b: 3 },
        cells: ['2,3', '2,4'],
        radiusCells: 2,
        color: '#ef4444',
        visibleToPlayers: true,
      },
    ],
    settings: { ambientLevel: 1.0 },
  };

  const normalized = normalizeCampaign(oldCampaign);
  const tpl = normalized.templates[0];
  // (2 + 0.5) * 140 = 350, (3 + 0.5) * 140 = 490
  assert.deepEqual(tpl.origin, { x: 350, y: 490 });
  assert.equal(tpl.directionDeg, 0);
  assert.equal('cells' in tpl, false, 'Le champ cells doit être supprimé');

  const errors = validateCampaign(normalized);
  assert.equal(errors.length, 0, 'La campagne normalisée doit passer la validation');
});

