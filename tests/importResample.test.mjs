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
  // ⛔ UX-07 : seul l'alpha de `ambient_light` porte une information que le moteur exploite. La
  // teinte n'est plus importée — elle était validée, persistée, et lue par aucun rendu.
  assert.equal(parsed.level.ambient.level, 1, 'l\'alpha ff de "ff112233" donne une ambiante pleine');
  assert.equal(
    'color' in parsed.level.ambient,
    false,
    'la teinte ambiante ne doit plus entrer dans le modèle'
  );
});


/**
 * Branchement de la détection de topologie — et non le module pur, déjà couvert par
 * `tests/gridPitch.test.mjs`.
 *
 * ⭐ Ce test existe parce que le contraire serait exactement l'erreur relevée toute la journée du
 * 06/08/2026 : éprouver la calculette et croire que le dessin s'en sert. `gridPitch.js` peut être
 * parfait et `resample.mjs` ne jamais l'appeler — le mainteneur n'en saurait rien, puisque
 * l'absence d'avertissement est indistinguable d'une carte carrée.
 *
 * Le réseau est tracé ici en PNG, format que Jimp encode et décode nativement : le WebP passe par
 * un décodeur WASM qui exige un accès réseau, ce qui rendrait ce test dépendant d'Internet.
 */
test('resample avertit quand le réseau peint est hexagonal, et se taît quand il est carré', async () => {
  const { Jimp } = await import('jimp');
  const PAS = 60;
  const CASES_X = 12;
  const CASES_Y = 10;
  const W = PAS * CASES_X;
  const H = PAS * CASES_Y;

  /** @param {'square'|'hex'} reseau */
  const imagePng = async (reseau) => {
    const img = new Jimp({ width: W, height: H, color: 0xf2efe6ff });
    /** @param {number} x @param {number} y */
    const encre = (x, y) => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi >= 0 && xi < W && yi >= 0 && yi < H) img.setPixelColor(0x3c3c3cff, xi, yi);
    };
    /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
    const ligne = (x0, y0, x1, y1) => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const y = y0 + ((y1 - y0) * k) / n;
        encre(x, y);
        encre(x + 1, y);
      }
    };

    if (reseau === 'square') {
      for (let x = 0; x <= W; x += PAS) ligne(x, 0, x, H - 1);
      for (let y = 0; y <= H; y += PAS) ligne(0, y, W - 1, y);
    } else {
      const hauteur = (2 * PAS) / Math.sqrt(3);
      const pasRangee = (PAS * Math.sqrt(3)) / 2;
      for (let r = -1; r * pasRangee < H + hauteur; r++) {
        const cy = r * pasRangee;
        const decal = r % 2 === 0 ? 0 : PAS / 2;
        for (let c = -1; c * PAS + decal < W + PAS; c++) {
          const cx = c * PAS + decal;
          /** @type {[number, number][]} */
          const s = [];
          for (let k = 0; k < 6; k++) {
            const a = (Math.PI / 3) * k - Math.PI / 2;
            s.push([cx + (PAS / 2) * Math.cos(a), cy + (hauteur / 2) * Math.sin(a)]);
          }
          for (let k = 0; k < 6; k++) ligne(s[k][0], s[k][1], s[(k + 1) % 6][0], s[(k + 1) % 6][1]);
        }
      }
    }
    return img.getBuffer('image/png');
  };

  const options = { widthCells: CASES_X, heightCells: CASES_Y };

  const hex = await resample(await imagePng('hex'), PAS, options);
  const avertissementHex = hex.warnings.find((/** @type {string} */ w) => /HEXAGONAL/.test(w));
  assert.ok(
    avertissementHex,
    `un réseau hexagonal doit produire un avertissement. Reçu : ${JSON.stringify(hex.warnings)}`
  );
  // L'avertissement doit dire quoi faire, pas seulement constater.
  assert.match(avertissementHex, /lot 4/);

  const carre = await resample(await imagePng('square'), PAS, options);
  assert.equal(
    carre.warnings.find((/** @type {string} */ w) => /HEXAGONAL/.test(w)),
    undefined,
    `une grille carrée ne doit produire AUCUN avertissement de topologie. ` +
      `Reçu : ${JSON.stringify(carre.warnings)}`
  );
});

test('resample hexRows : le ratio du dessin est conservé, la grille ne le déforme jamais', async () => {
  const { Jimp } = await import('jimp');
  // 5320×3500 est le format réel de la première carte de campagne posée en hexagonal. Réduit ici
  // d'un facteur 10 pour que le test reste rapide, le ratio étant seul en cause.
  const SRC_W = 532;
  const SRC_H = 350;
  const img = new Jimp({ width: SRC_W, height: SRC_H, color: 0x336633ff });
  const png = await img.getBuffer('image/png');

  // 38 colonnes × 28 rangées : le découpage hexagonal qui couvre cette image. En carré, 28 rangées
  // de 14 px feraient 392 px de haut — l'image n'en fait que 350.
  const r = await resample(png, 14, { widthCells: 38, heightCells: 28, hexRows: true });

  const ratioSource = SRC_W / SRC_H;
  const ratioObtenu = r.width / r.height;

  // ⛔ **Le critère est le ratio, pas une dimension.** Avant correction, la hauteur cible valait
  // `heightCells × pxPerCell` : la sortie partait en 532×392, puis le plafond de texture la
  // ramenait en comprimant la LARGEUR. Sur la carte réelle, 5320×3500 sortait en 4750×3500 —
  // écrasée de 11 %, sans un mot. Une grille est une couche de jeu posée sur un dessin ; ce n'est
  // pas au dessin de s'y plier.
  assert.ok(
    Math.abs(ratioObtenu - ratioSource) < 0.005,
    `ratio déformé : source ${ratioSource.toFixed(4)}, obtenu ${ratioObtenu.toFixed(4)} ` +
      `(${r.width}×${r.height})`
  );

  // Et la densité reste celle des colonnes : en pointe-en-haut, `pxPerCell` est la LARGEUR d'un
  // hexagone. C'est ce que le rendu attend, et ce que `HexGrid` suppose.
  assert.ok(
    Math.abs(r.pxPerCell - r.width / 38) < 0.01,
    `pxPerCell doit rester la largeur d'une colonne, obtenu ${r.pxPerCell}`
  );
});
