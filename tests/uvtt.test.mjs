import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseUvtt } from '../js/import/uvtt.js';

test('parseUvtt sur minimal.uvtt (unités de case et absence d’effet de pixels)', () => {
  const minimalPath = path.resolve('fixtures/synthetic/minimal.uvtt');
  const jsonStr = fs.readFileSync(minimalPath, 'utf-8');
  const res = parseUvtt(jsonStr);

  assert.ok(res.level);
  assert.equal(res.level.pxPerCell, 64);
  assert.equal(res.level.widthCells, 10);
  assert.equal(res.level.heightCells, 8);
  assert.equal(res.level.grid.type, 'square');
  assert.equal(res.level.ambient.baked, false);

  // Vérifier que les coordonnées de murs sont en unités de case (cellX, cellY) et non en pixels
  assert.equal(res.walls.length, 1);
  const poly = res.walls[0];
  assert.deepEqual(poly[0], { cellX: 2, cellY: 2 });
  assert.deepEqual(poly[1], { cellX: 8, cellY: 2 });

  // Portails en unités de case
  assert.equal(res.portals.length, 1);
  assert.deepEqual(res.portals[0].a, { cellX: 4.5, cellY: 2 });
  assert.deepEqual(res.portals[0].b, { cellX: 5.5, cellY: 2 });
  assert.equal(res.portals[0].closed, true);

  // Lumière en unités de case
  assert.equal(res.lights.length, 1);
  assert.deepEqual(res.lights[0].at, { cellX: 5, cellY: 4 });
  assert.equal(res.lights[0].range, 3);
});

test('parseUvtt avec map_origin non nul (offset-origin.uvtt et valeurs négatives/décimales)', () => {
  const offsetPath = path.resolve('fixtures/synthetic/offset-origin.uvtt');
  const jsonStr = fs.readFileSync(offsetPath, 'utf-8');
  const res = parseUvtt(jsonStr);

  // origin: { x: 1.5, y: 0.5 }, pxPerCell: 64 -> offsetX = 1.5 * 64 = 96, offsetY = 0.5 * 64 = 32
  assert.equal(res.grid.offsetX, 96);
  assert.equal(res.grid.offsetY, 32);

  // Test avec coordonnées négatives dans map_origin
  const negativeOriginUvtt = {
    resolution: {
      map_origin: { x: -2, y: -1.5 },
      map_size: { x: 10, y: 8 },
      pixels_per_grid: 100,
    },
    line_of_sight: [[{ x: -1, y: -0.5 }, { x: 5, y: 5 }]],
  };

  const resNeg = parseUvtt(negativeOriginUvtt);
  assert.equal(resNeg.grid.offsetX, -200);
  assert.equal(resNeg.grid.offsetY, -150);
  assert.deepEqual(resNeg.walls[0][0], { cellX: -1, cellY: -0.5 });
});

test('parseUvtt détecte baked_lighting', () => {
  const bakedPath = path.resolve('fixtures/synthetic/baked-lighting.uvtt');
  const jsonStr = fs.readFileSync(bakedPath, 'utf-8');
  const res = parseUvtt(jsonStr);

  assert.equal(res.level.ambient.baked, true);
  assert.ok(res.warnings.some((w) => w.includes('baked_lighting')));
});

test('parseUvtt refuse le type hex', () => {
  const hexUvtt = {
    grid_type: 'hex',
    resolution: { pixels_per_grid: 64, map_size: { x: 10, y: 8 } },
  };
  assert.throws(() => parseUvtt(hexUvtt), /Grille hexagonale non supportée/);
});

// --- Universalité : ne jamais rien perdre en silence ------------------------------
//
// L'outil doit accepter n'importe quel UVTT « ou équivalent », quelle que soit sa source.
// La difficulté n'est pas d'accepter plus de formes : c'est de ne jamais en écarter une
// sans le dire. Une carte dont les 141 portes ont été jetées ne doit pas ressembler à une
// carte sans porte.

test('universalité : une géométrie absente est repliée mais signalée', () => {
  const { level, warnings } = parseUvtt({ image: '' });

  // Les replis restent : refuser reproduirait la perte de campagne d'ETAT.md.
  assert.equal(level.widthCells, 40);
  assert.equal(level.heightCells, 30);
  assert.equal(level.pxPerCell, 140);

  // Mais ils ne sont plus muets.
  assert.ok(
    warnings.some((w) => w.includes('pixels_per_grid')),
    'la densité inventée doit être signalée'
  );
  assert.ok(
    warnings.some((w) => w.includes('map_size')),
    'les dimensions inventées doivent être signalées'
  );
});

test('universalité : des portes de forme inconnue sont comptées, pas escamotées', () => {
  const { level, warnings } = parseUvtt({
    resolution: { map_size: { x: 10, y: 8 }, pixels_per_grid: 64 },
    portals: [
      // Forme reconnue.
      { bounds: [{ x: 1, y: 1 }, { x: 2, y: 1 }] },
      // Formes d'un exportateur imaginaire : rien ne doit disparaître en silence.
      { position: { x: 3, y: 3 }, rotation: 0 },
      { bounds: [{ x: 4, y: 4 }] },
      { bounds: [{ x: 'a', y: 4 }, { x: 5, y: 4 }] },
    ],
    image: '',
  });

  assert.equal(level.portals.length, 1, 'seule la porte exploitable est retenue');
  const avert = warnings.find((w) => w.includes('porte'));
  assert.ok(avert, 'les portes écartées doivent être signalées');
  assert.match(avert, /3 porte\(s\) ignorée\(s\) sur 4/);
});

test('universalité : lumières et murs inexploitables sont comptés', () => {
  const { level, warnings } = parseUvtt({
    resolution: { map_size: { x: 10, y: 8 }, pixels_per_grid: 64 },
    line_of_sight: [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      [{ x: 0, y: 0 }],
      'pas une polyligne',
      [{ x: 0, y: 0 }, { u: 1, v: 2 }],
    ],
    lights: [
      { position: { x: 1, y: 1 }, range: 3 },
      { at: { x: 2, y: 2 } },
      { position: { x: 'trois', y: 1 } },
    ],
    image: '',
  });

  assert.equal(level.walls.length, 1);
  assert.equal(level.lights.length, 1);
  assert.match(
    warnings.find((w) => w.includes('polyligne')) ?? '',
    /3 polyligne\(s\) de mur ignorée\(s\) sur 4/
  );
  assert.ok(warnings.some((w) => w.includes('point(s) de mur ignoré')));
  assert.match(
    warnings.find((w) => w.includes('lumière')) ?? '',
    /2 lumière\(s\) ignorée\(s\) sur 3/
  );
});

test('universalité : un fichier entièrement exploitable n’émet aucun avertissement de perte', () => {
  const { warnings } = parseUvtt({
    resolution: { map_size: { x: 10, y: 8 }, pixels_per_grid: 64, map_origin: { x: 0, y: 0 } },
    line_of_sight: [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
    portals: [{ bounds: [{ x: 1, y: 1 }, { x: 2, y: 1 }] }],
    lights: [{ position: { x: 1, y: 1 }, color: 'ffFFEBBF' }],
    environment: { baked_lighting: false, ambient_light: 'ffffffff' },
    image: '',
  });

  // Aucun faux positif : un avertissement qui crie pour rien finit ignoré.
  const pertes = warnings.filter((w) => w.includes('ignoré') || w.includes('replié'));
  assert.deepEqual(pertes, [], `avertissements inattendus : ${warnings.join(' | ')}`);
});
