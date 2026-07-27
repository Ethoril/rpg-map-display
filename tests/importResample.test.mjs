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
