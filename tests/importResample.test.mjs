// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resample, MAX_PREPARED_TEXTURE_PX } from '../scripts/resample.mjs';
import { main as importUvttMain } from '../scripts/import-uvtt.mjs';
import { validateCampaign } from '../js/core/schema.js';

test('resample réduit vers la cible quand la source est plus dense', async () => {
  const minimalPath = path.resolve('fixtures/synthetic/minimal.uvtt');
  const uvttData = JSON.parse(fs.readFileSync(minimalPath, 'utf-8'));

  // La fixture fait 640x512 (64 px/case) : viser 32 px/case est une vraie réduction.
  const result = await resample(uvttData.image, 32, {
    sourcePxPerCell: uvttData.resolution.pixels_per_grid,
    widthCells: uvttData.resolution.map_size.x,
    heightCells: uvttData.resolution.map_size.y,
  });

  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.width, 320); // 10 * 32
  assert.equal(result.height, 256); // 8 * 32
  assert.equal(result.pxPerCell, 32);
  assert.deepEqual(result.warnings, []);
});

test('resample n’agrandit jamais au-delà de la source, et le dit', async () => {
  const minimalPath = path.resolve('fixtures/synthetic/minimal.uvtt');
  const uvttData = JSON.parse(fs.readFileSync(minimalPath, 'utf-8'));

  // Viser 140 px/case depuis une source à 64 : la cible 1400x1120 excède les
  // 640x512 disponibles. Agrandir ajouterait du poids sans un pixel de détail.
  const result = await resample(uvttData.image, 140, {
    sourcePxPerCell: uvttData.resolution.pixels_per_grid,
    widthCells: uvttData.resolution.map_size.x,
    heightCells: uvttData.resolution.map_size.y,
  });

  assert.equal(result.width, 640);
  assert.equal(result.height, 512);
  assert.equal(result.pxPerCell, 64);

  // L'avertissement doit nommer la densité à réexporter, sinon il est inactionnable.
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /moins dense/);
  assert.match(result.warnings[0], /140 px\/case/);
});

test('resample plafonne à MAX_PREPARED_TEXTURE_PX sans jamais agrandir', async () => {
  const minimalPath = path.resolve('fixtures/synthetic/minimal.uvtt');
  const uvttData = JSON.parse(fs.readFileSync(minimalPath, 'utf-8'));

  // Cible délibérément absurde : 10 cases x 2000 px = 20000 px, bien au-delà du
  // plafond. Les deux gardes s'appliquent dans l'ordre, et la source gagne.
  const result = await resample(uvttData.image, 2000, {
    widthCells: uvttData.resolution.map_size.x,
    heightCells: uvttData.resolution.map_size.y,
  });

  assert.ok(result.width <= MAX_PREPARED_TEXTURE_PX);
  assert.ok(result.height <= MAX_PREPARED_TEXTURE_PX);
  assert.equal(result.width, 640);
  assert.equal(result.height, 512);
  assert.equal(result.warnings.length, 2);
});

test('import-uvtt.mjs parse fixture synthétique et génère WebP + scène JSON valide', async () => {
  const fixturePath = path.resolve('fixtures/synthetic/minimal.uvtt');

  // Exécution programmatique de la fonction principale d'import
  const originalArgv = process.argv;
  process.argv = ['node', 'scripts/import-uvtt.mjs', fixturePath, '140'];

  try {
    const res = await importUvttMain();
    assert.ok(res);

    assert.ok(fs.existsSync(res.webpPath));
    assert.ok(fs.existsSync(res.jsonPath));

    const jsonContent = fs.readFileSync(res.jsonPath, 'utf-8');
    const campaign = JSON.parse(jsonContent);

    const errors = validateCampaign(campaign);
    assert.deepEqual(errors, []);

    assert.equal(campaign.levels[0].imageUrl, 'maps/minimal.webp');
    // 140 demandé, 64 obtenu : le garde-fou tient jusqu'au document de scène,
    // et `pxPerCell` décrit l'image réellement écrite, pas celle demandée.
    assert.equal(campaign.levels[0].pxPerCell, 64);
  } finally {
    process.argv = originalArgv;
  }
});

test('parseUvttColor convertit les 4 formes de couleur avec avertissements appropriés', async () => {
  const { parseUvttColor } = await import('../js/import/uvtt.js');

  // 1. ARGB 8 hex avec alpha ff
  const res1 = parseUvttColor('ffF7EAE4');
  assert.equal(res1.color, '#F7EAE4');
  assert.equal(res1.warning, undefined);

  // 2. ARGB 8 hex avec alpha != ff
  const res2 = parseUvttColor('80F7EAE4');
  assert.equal(res2.color, '#F7EAE4');
  assert.ok(res2.warning?.includes('80'));

  // 3. RGB 6 hex sans #
  const res3 = parseUvttColor('F7EAE4');
  assert.equal(res3.color, '#F7EAE4');
  assert.equal(res3.warning, undefined);

  // 4. #RRGGBB déjà valide
  const res4 = parseUvttColor('#F7EAE4');
  assert.equal(res4.color, '#F7EAE4');
  assert.equal(res4.warning, undefined);

  // 5. Entrée invalide -> repli #ffffff avec avertissement
  const res5 = parseUvttColor('invalide');
  assert.equal(res5.color, '#ffffff');
  assert.ok(res5.warning?.includes('invalide'));

  const res6 = parseUvttColor(null);
  assert.equal(res6.color, '#ffffff');
  assert.ok(res6.warning?.includes('null'));
});

test('parseUvtt convertit les lumières ARGB et lit environment.ambient_light', async () => {
  const { parseUvtt } = await import('../js/import/uvtt.js');
  const sampleUvtt = {
    resolution: { pixels_per_grid: 100, map_size: { x: 10, y: 10 } },
    lights: [
      {
        id: 'l1',
        position: { x: 2, y: 3 },
        range: 5,
        intensity: 2.5,
        color: 'ffF7EAE4',
        shadows: true,
      },
    ],
    environment: {
      ambient_light: 'ff112233',
    },
  };

  const parsed = parseUvtt(sampleUvtt);
  assert.equal(parsed.lights[0].color, '#F7EAE4');
  assert.equal(parsed.level.ambient.color, '#112233');
});

