import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const syntheticDir = path.join(rootDir, 'fixtures', 'synthetic');
const expectedDir = path.join(rootDir, 'fixtures', 'expected');
const imagesDir = path.join(rootDir, 'fixtures', 'images');
const realDir = path.join(rootDir, 'fixtures', 'real');

for (const dir of [syntheticDir, expectedDir, imagesDir, realDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const CELLS_X = 10;
const CELLS_Y = 8;
const PX_PER_CELL = 64;

/**
 * Fabrique une image aux dimensions que la fixture **déclare**.
 *
 * Les fixtures portaient jusqu'ici un PNG de 1×1 pixel tout en annonçant
 * 10×8 cases à 64 px/case. Ça tenait tant que le rééchantillonnage agrandissait
 * sans rien dire : la suite « vérifiait » une sortie 1400×1120 obtenue par
 * interpolation d'un unique pixel, donc ne vérifiait rien du tout. Le garde-fou
 * anti-agrandissement de `scripts/resample.mjs` rend ce mensonge visible, et le
 * bon correctif est de le supprimer plutôt que d'exempter les fixtures.
 *
 * Le damier à la maille de la case donne une image dont le rééchantillonnage a un
 * résultat prévisible, et la diagonale fournit du détail fin qui ne survivrait pas
 * à une réduction fautive. Le tout compresse en quelques kilo-octets.
 *
 * @returns {Promise<string>} PNG encodé en base64, sans préfixe `data:`
 */
async function makeCalibrationImage() {
  const width = CELLS_X * PX_PER_CELL;
  const height = CELLS_Y * PX_PER_CELL;
  const img = new Jimp({ width, height, color: 0x1e1e28ff });

  for (let cy = 0; cy < CELLS_Y; cy++) {
    for (let cx = 0; cx < CELLS_X; cx++) {
      if ((cx + cy) % 2 !== 0) continue;
      const color = 0xc8b48cff;
      for (let y = 0; y < PX_PER_CELL; y++) {
        for (let x = 0; x < PX_PER_CELL; x++) {
          img.setPixelColor(color, cx * PX_PER_CELL + x, cy * PX_PER_CELL + y);
        }
      }
    }
  }

  // Diagonale d'un pixel de large : le détail le plus fin que l'image contienne.
  for (let x = 0; x < Math.min(width, height); x++) {
    img.setPixelColor(0xff3c3cff, x, x);
  }

  const buffer = await img.getBuffer('image/png');
  return buffer.toString('base64');
}

const mockBase64Image = await makeCalibrationImage();

const baseMinimal = {
  format: 0.3,
  resolution: {
    map_origin: { x: 0, y: 0 },
    map_size: { x: 10, y: 8 },
    pixels_per_grid: 64,
  },
  line_of_sight: [
    [
      { x: 2, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6 },
      { x: 2, y: 6 },
      { x: 2, y: 2 },
    ],
  ],
  objects_line_of_sight: [],
  portals: [
    {
      position: { x: 5, y: 2 },
      bounds: [
        { x: 4.5, y: 2 },
        { x: 5.5, y: 2 },
      ],
      rotation: 0,
      closed: true,
      freestanding: false,
    },
  ],
  environment: { baked_lighting: false, ambient_light: 'ffffffff' },
  lights: [
    {
      position: { x: 5, y: 4 },
      range: 3,
      intensity: 1,
      color: 'ffffffff',
      shadows: true,
    },
  ],
  image: mockBase64Image,
};

const bakedLighting = {
  ...baseMinimal,
  environment: { baked_lighting: true, ambient_light: 'ffffffff' },
};

const offsetOrigin = {
  ...baseMinimal,
  resolution: {
    map_origin: { x: 1.5, y: 0.5 },
    map_size: { x: 10, y: 8 },
    pixels_per_grid: 64,
  },
};

const noGeometry = {
  ...baseMinimal,
  line_of_sight: [],
  portals: [],
  lights: [],
};

const fixtures = [
  { name: 'minimal', data: baseMinimal },
  { name: 'baked-lighting', data: bakedLighting },
  { name: 'offset-origin', data: offsetOrigin },
  { name: 'no-geometry', data: noGeometry },
];

for (const { name, data } of fixtures) {
  const uvttPath = path.join(syntheticDir, `${name}.uvtt`);
  fs.writeFileSync(uvttPath, JSON.stringify(data, null, 2), 'utf-8');
}

console.log('Fixtures générées avec succès dans fixtures/synthetic/');
