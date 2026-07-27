import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Mock base64 image (1x1 transparent PNG)
const mockBase64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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
