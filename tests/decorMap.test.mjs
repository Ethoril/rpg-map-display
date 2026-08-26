// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cellDimensionsFromName,
  filterSidecarImages,
  isImageSource,
  isSupportedSource,
  buildDecorLevel,
  IMAGE_EXTENSIONS,
  MIN_PLAUSIBLE_PX_PER_CELL,
  MAX_PLAUSIBLE_PX_PER_CELL,
} from '../scripts/prepare-maps.mjs';

/**
 * Carte-décor — importer une simple image comme fond de carte.
 *
 * ⭐ **Pourquoi ce chantier existe** : la bibliothèque réelle du mainteneur compte **1 774 images**
 * et la chaîne n'avalait que de l'UVTT. Aucun critère ne mesurait cet écart, et c'était pourtant ce
 * qui séparait le plus l'outil d'un outil dont on se sert.
 *
 * ⛔ **Aucune image sous licence dans ces tests.** Le corpus Stained Karbon est autorisé en usage
 * privé, pas en republication, et `maps/` est publié sur GitHub Pages. Les fixtures sont donc
 * générées ici, en PNG minimal, et écrites dans un dossier temporaire.
 */

/**
 * Écrit un PNG uni de la taille voulue, sans dépendance.
 *
 * @param {string} filePath
 * @param {number} width
 * @param {number} height
 */
function ecrirePng(filePath, width, height) {
  const zlib = require('node:zlib');
  const crc = (/** @type {Buffer} */ buf) => {
    let c = ~0;
    for (const octet of buf) {
      c ^= octet;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // RVB
  // Une ligne de filtre nul suivie de pixels gris : le contenu n'importe pas, la taille si.
  const brut = Buffer.concat(
    Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x60)]))
  );
  fs.writeFileSync(
    filePath,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(brut)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

/** @param {(dir: string) => Promise<void>|void} fn */
async function dansUnDossierTemporaire(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decor-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- Lecture des dimensions dans le nom -------------------------------------

test('la convention du corpus réel donne une densité exacte', () => {
  // `Ambush Site_37x28_High res.jpg` fait 5180 × 3920 px. 5180/37 = 140 tout rond, et c'est
  // pourquoi cette source est préférée à toute mesure : elle est exacte, pas approchée.
  const d = cellDimensionsFromName('Ambush Site_37x28_High res.jpg', 5180, 3920);
  assert.deepEqual(
    { w: d?.widthCells, h: d?.heightCells, px: d?.pxPerCell },
    { w: 37, h: 28, px: 140 }
  );
  assert.deepEqual(d?.warnings, []);
});

test('les séparateurs et espaces des noms d’éditeurs sont acceptés', () => {
  for (const nom of ['carte_20x15.png', 'carte 20 x 15.png', 'carte20X15.png', 'carte-20×15.png']) {
    const d = cellDimensionsFromName(nom, 2000, 1500);
    assert.equal(d?.widthCells, 20, `nom refusé : ${nom}`);
    assert.equal(d?.pxPerCell, 100);
  }
});

test('⭐ un couple de PIXELS dans le nom est écarté par la validation croisée', () => {
  // Le piège que la validation existe pour attraper : `carte_5180x3920` donnerait 1 px/case. Sans
  // borne de plausibilité, l'import produirait une carte de 5180 cases de large, silencieusement.
  assert.equal(cellDimensionsFromName('carte_5180x3920.jpg', 5180, 3920), null);
  // Et si les deux couples sont présents, c'est le plausible qui gagne, quel que soit l'ordre.
  assert.equal(cellDimensionsFromName('carte_5180x3920_37x28.jpg', 5180, 3920)?.widthCells, 37);
  assert.equal(cellDimensionsFromName('carte_37x28_5180x3920.jpg', 5180, 3920)?.widthCells, 37);
});

test('les bornes de plausibilité sont respectées aux deux extrémités', () => {
  // Juste sous le plancher : refusé. Juste au-dessus : accepté.
  const trop = MIN_PLAUSIBLE_PX_PER_CELL - 1;
  assert.equal(cellDimensionsFromName(`c_10x10.png`, 10 * trop, 10 * trop), null);
  const ok = MIN_PLAUSIBLE_PX_PER_CELL + 1;
  assert.equal(cellDimensionsFromName(`c_10x10.png`, 10 * ok, 10 * ok)?.pxPerCell, ok);
  // Au-delà du plafond : refusé aussi. Une case de 900 px n'est pas une case.
  const enorme = MAX_PLAUSIBLE_PX_PER_CELL + 100;
  assert.equal(cellDimensionsFromName('c_10x10.png', 10 * enorme, 10 * enorme), null);
});

test('une incohérence entre les deux axes est signalée, jamais tranchée en silence', () => {
  // 37×28 sur une image rognée en bas : la largeur donne 140, la hauteur 130. On garde la largeur,
  // mais on le DIT — choisir sans le dire est exactement ce que l'exigence d'universalité interdit.
  const d = cellDimensionsFromName('carte_37x28.jpg', 5180, 3640);
  assert.equal(d?.pxPerCell, 140);
  assert.equal(d?.warnings.length, 1);
  assert.match(/** @type {string} */ (d?.warnings[0]), /incohérentes/);
  assert.match(/** @type {string} */ (d?.warnings[0]), /140\.0 px\/case en largeur mais 130\.0/);
});

test('sans couple lisible, aucune densité n’est inventée', () => {
  // ⛔ Le point qui a fait l'objet d'un arbitrage explicite : le corpus est à 140 px/case, mais
  // coder cette valeur ferait d'une propriété de fournisseur une règle du produit.
  assert.equal(cellDimensionsFromName('Ambush Site High res.jpg', 5180, 3920), null);
  assert.equal(cellDimensionsFromName('', 100, 100), null);
  assert.equal(cellDimensionsFromName('c_10x10.png', 0, 0), null);
});

// --- Reconnaissance des sources --------------------------------------------

test('les extensions d’image sont des sources, les affiches de vidéo non', () => {
  for (const ext of IMAGE_EXTENSIONS) {
    assert.equal(isSupportedSource(`carte_10x10${ext}`), true, ext);
    assert.equal(isImageSource(`carte_10x10${ext}`), true, ext);
  }
  // Une affiche accompagne une vidéo : la préparer comme carte produirait un doublon.
  assert.equal(isSupportedSource('testvideo-3.poster.webp'), false);
  // Un export VTT reste une source, mais pas une image.
  assert.equal(isImageSource('manoir-rdc.uvtt'), false);
  assert.equal(isSupportedSource('manoir-rdc.uvtt'), true);
  // Les fichiers cachés restent exclus, comme avant.
  assert.equal(isSupportedSource('.DS_Store.png'), false);
});

test('⭐ une image accompagnant un autre fichier n’est pas une carte', () => {
  // Défaut attrapé au premier essai réel : `minimal.webp` est l'illustration de la scène de test
  // `minimal.json`, et l'accepter faisait échouer TOUTE la préparation.
  const dossier = ['minimal.json', 'minimal.webp', 'manoir-rdc.uvtt', 'carte_20x15.jpg'];
  const gardes = filterSidecarImages(dossier);
  assert.equal(gardes.includes('minimal.webp'), false, 'l’illustration d’une scène a été prise pour une carte');
  assert.equal(gardes.includes('carte_20x15.jpg'), true, 'une image orpheline reste une carte candidate');
  assert.equal(gardes.includes('minimal.json'), true);
  assert.equal(gardes.includes('manoir-rdc.uvtt'), true);
});

test('la règle du fichier accompagnant vaut aussi pour les vidéos et les exports VTT', () => {
  assert.deepEqual(filterSidecarImages(['testvideo-3.dd2vtt', 'testvideo-3.webp']), ['testvideo-3.dd2vtt']);
  assert.deepEqual(filterSidecarImages(['fond.webm', 'fond.jpg']), ['fond.webm']);
  // Casse indifférente : un dossier réel mélange les deux.
  assert.deepEqual(filterSidecarImages(['Scene.JSON', 'scene.PNG']), ['Scene.JSON']);
});

// --- Construction de l'étage ----------------------------------------------

test('un étage décor n’a ni murs, ni portes, ni lumières, et son ambiante est pleine', async () => {
  await dansUnDossierTemporaire(async (dir) => {
    const image = path.join(dir, 'clairiere_20x15.png');
    ecrirePng(image, 2000, 1500);

    const { level, warnings } = await buildDecorLevel(image, null, dir, 100);

    assert.equal(level.widthCells, 20);
    assert.equal(level.heightCells, 15);
    assert.deepEqual(level.walls, []);
    assert.deepEqual(level.portals, []);
    assert.deepEqual(level.lights, []);
    // ⭐ L'ambiante pleine n'est pas décorative : `fogLayer` fait voir chaque PJ jusqu'au plafond
    // technique quand elle est active, au lieu de sa seule portée nocturne. Sans elle, une
    // carte-décor s'afficherait comme une cave.
    assert.equal(level.ambient.level, 1);
    assert.equal(level.ambient.baked, false, 'baked signalerait un éclairage cuit, ce qu’on ignore');
    // La limite est écrite dans les avertissements, pas seulement dans un document.
    assert.ok(
      warnings.some((w) => /carte-décor/.test(w) && /pion PJ/.test(w)),
      'la limite « sans pion PJ, les joueurs ne voient rien » doit être dite'
    );
  });
});

test('une variante « Grid » éteint le quadrillage de l’application', async () => {
  await dansUnDossierTemporaire(async (dir) => {
    const avec = path.join(dir, 'ruines_10x10_Grid.png');
    const sans = path.join(dir, 'ruines_10x10.png');
    ecrirePng(avec, 1000, 1000);
    ecrirePng(sans, 1000, 1000);

    const grille = await buildDecorLevel(avec, null, dir, 100);
    const nue = await buildDecorLevel(sans, null, dir, 100);

    // Deux quadrillages superposés, l'un juste et l'autre décalé, seraient pires qu'aucun.
    assert.equal(grille.level.grid.visible, false, 'la grille peinte doit désactiver celle de l’appli');
    assert.equal(nue.level.grid.visible, true);
    assert.ok(grille.warnings.some((w) => /Grille peinte/.test(w)));
  });
});

test('un marqueur « hex » dans le nom pose une grille hexagonale sur la carte-décor', async () => {
  await dansUnDossierTemporaire(async (dir) => {
    const hex = path.join(dir, 'marais-hex_10x10.png');
    const carre = path.join(dir, 'marais_10x10.png');
    // Une variante quadrillée **et** hexagonale : le quadrillage peint est carré, donc il ne décrit
    // pas le pavage joué et ne doit pas éteindre celui de l'application.
    const hexQuadrille = path.join(dir, 'marais-hex_10x10_Grid.png');
    ecrirePng(hex, 1000, 1000);
    ecrirePng(carre, 1000, 1000);
    ecrirePng(hexQuadrille, 1000, 1000);

    const a = await buildDecorLevel(hex, null, dir, 100);
    const b = await buildDecorLevel(carre, null, dir, 100);
    const c = await buildDecorLevel(hexQuadrille, null, dir, 100);

    assert.equal(a.level.grid.type, 'hex', 'le marqueur « hex » doit donner un étage hexagonal');
    assert.equal(b.level.grid.type, 'square', 'sans marqueur, le pavage reste carré');
    assert.equal(c.level.grid.type, 'hex');
    assert.equal(
      c.level.grid.visible,
      true,
      'en hexagonal, le quadrillage peint est carré : il ne remplace pas celui de l’application'
    );

    // ⛔ Le marqueur ne touche ni les cases ni la densité. `pxPerCell` reste la largeur d'un
    // hexagone ; c'est `HexGrid` qui en déduit le pas vertical.
    assert.equal(a.level.widthCells, 10);
    assert.equal(a.level.heightCells, 10);
    assert.equal(a.level.pxPerCell, b.level.pxPerCell);

    // Et le mot ne doit pas être attrapé au milieu d'un autre : « Hexenwald » n'est pas « hex ».
    const piege = path.join(dir, 'hexenwald_10x10.png');
    ecrirePng(piege, 1000, 1000);
    const d = await buildDecorLevel(piege, null, dir, 100);
    assert.equal(d.level.grid.type, 'square', '« hexenwald » ne porte pas le marqueur');
  });
});

test('⛔ sans densité lisible, la préparation refuse et nomme le remède', async () => {
  await dansUnDossierTemporaire(async (dir) => {
    const image = path.join(dir, 'carte sans dimensions.png');
    ecrirePng(image, 800, 600);

    await assert.rejects(
      () => buildDecorLevel(image, null, dir, 100),
      (err) => {
        const m = /** @type {Error} */ (err).message;
        assert.match(m, /Densité inconnue/);
        // Un refus qui ne dit pas quoi faire est un cul-de-sac : le message doit porter l'exemple.
        assert.match(m, /renommer/i);
        assert.match(m, /_37x28|_NNxMM|\d+x\d+/);
        // Et il doit dire pourquoi aucune valeur par défaut n'est appliquée.
        assert.match(m, /par défaut/);
        return true;
      }
    );
  });
});

test('le manifeste garde la main sur l’identifiant, le nom et l’ordre de l’étage', async () => {
  // Ce qui permet de mêler une image et un export UVTT dans une même campagne à étages — ce que le
  // critère 1 du lot 3 demande, et qui serait impossible si le décor imposait son nom de fichier.
  await dansUnDossierTemporaire(async (dir) => {
    const image = path.join(dir, 'cave_10x10.png');
    ecrirePng(image, 1000, 1000);
    const { level } = await buildDecorLevel(
      image,
      { id: 'sous-sol', name: 'Sous-sol', order: 2 },
      dir,
      100
    );
    assert.equal(level.id, 'sous-sol');
    assert.equal(level.name, 'Sous-sol');
    assert.equal(level.order, 2);
    assert.equal(level.imageUrl, 'maps/generated/sous-sol.webp');
  });
});

test('une image introuvable échoue clairement', async () => {
  await assert.rejects(
    () => buildDecorLevel(path.join(os.tmpdir(), 'inexistante_10x10.png'), null, os.tmpdir(), 100),
    /Image introuvable/
  );
});

test('cellDimensionsFromName : en hexagonal, une hauteur plus dense n’est PAS une incohérence', () => {
  // La première carte de campagne du dépôt : 5320×3500 découpée en 38 colonnes × 28 rangées.
  // ⭐ 3500/28 = 125 px/rangée contre 140 px/colonne — et c'est EXACTEMENT ce qu'on attend, le pas
  // vertical d'une rangée pointe-en-haut valant `pxPerCell × √3/2` ≈ 121,2.
  const hex = cellDimensionsFromName('ferme-isolee_38x28_hex.jpg', 5320, 3500);
  assert.equal(hex?.widthCells, 38);
  assert.equal(hex?.heightCells, 28);
  assert.equal(hex?.pxPerCell, 140);
  assert.deepEqual(
    hex?.warnings,
    [],
    `un découpage hexagonal correct ne doit produire AUCUN avertissement. Reçu : ${JSON.stringify(hex?.warnings)}`
  );

  // ⛔ Et la vigilance ne doit pas disparaître pour autant : les MÊMES dimensions sans marqueur
  // `_hex` restent une vraie incohérence, puisqu'en carré les deux densités doivent coïncider.
  const carre = cellDimensionsFromName('ferme-isolee_38x28.jpg', 5320, 3500);
  assert.equal(carre?.warnings.length, 1, 'en carré, 140 contre 125 reste une incohérence');
  assert.match(carre?.warnings[0] ?? '', /incohérentes/);
});
