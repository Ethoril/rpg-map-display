// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resample } from '../scripts/resample.mjs';
import { main as importUvttMain } from '../scripts/import-uvtt.mjs';
import { validateCampaign } from '../js/core/schema.js';

test('resample rééchantillonne une image vers WebP', async () => {
  const minimalPath = path.resolve('fixtures/synthetic/minimal.uvtt');
  const jsonStr = fs.readFileSync(minimalPath, 'utf-8');
  const uvttData = JSON.parse(jsonStr);

  const result = await resample(uvttData.image, 140, {
    sourcePxPerCell: uvttData.resolution.pixels_per_grid,
    widthCells: uvttData.resolution.map_size.x,
    heightCells: uvttData.resolution.map_size.y,
  });

  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.width, 1400); // 10 * 140
  assert.equal(result.height, 1120); // 8 * 140
  assert.equal(result.pxPerCell, 140);
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
    assert.equal(campaign.levels[0].pxPerCell, 140);
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

