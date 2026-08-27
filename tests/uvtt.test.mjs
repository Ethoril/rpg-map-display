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

test('G-2 — un map_origin non nul est signalé bruyamment, et dit quoi vérifier', () => {
  // ⭐ Le critère n'est pas « un avertissement existe » mais « il dit quoi faire ». Un import qui
  // constate sans orienter laisse le mainteneur devant une carte décalée sans piste.
  const avecOrigine = parseUvtt({
    resolution: { map_origin: { x: 3, y: 2 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
    line_of_sight: [[{ x: 1, y: 1 }, { x: 5, y: 5 }]],
  });

  const avert = avecOrigine.warnings.find((w) => /map_origin/.test(w));
  assert.ok(avert, `un map_origin non nul doit avertir. Reçu : ${JSON.stringify(avecOrigine.warnings)}`);

  // Il nomme les valeurs en cause, le sens appliqué, et le symptôme à guetter.
  assert.match(avert, /3, 2/, 'les valeurs de l’origine doivent apparaître');
  assert.match(avert, /AJOUTÉE/, 'le sens appliqué doit être nommé, pas sous-entendu');
  assert.match(avert, /SOUSTRAIT/, 'la convention concurrente doit être nommée');
  assert.match(avert, /décalés du double/, 'le symptôme observable doit être décrit');

  // ⛔ Et le silence reste la règle quand il n'y a rien à dire : une origine nulle — le cas de
  // TOUS les exports réels du dépôt — ne doit produire aucun bruit, sinon l'avertissement se
  // banalise et personne ne le lit le jour où il compte.
  const sansOrigine = parseUvtt({
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
    line_of_sight: [[{ x: 1, y: 1 }, { x: 5, y: 5 }]],
  });
  assert.equal(
    sansOrigine.warnings.find((w) => /map_origin/.test(w)),
    undefined,
    `une origine nulle ne doit produire aucun avertissement. Reçu : ${JSON.stringify(sansOrigine.warnings)}`
  );
});

// ── Bornes de ressources ────────────────────────────────────────────────────────────────────────

test('bornes — ⭐ toute carte réelle PRÉSENTE passe les plafonds', (t) => {
  // ⭐ **C'est le test qui compte le plus de cette tranche, et il protège dans le sens qu'on
  // oublie.** Vérifier qu'un plafond refuse l'absurde est facile ; ce qui casse une séance, c'est
  // un plafond descendu sous le réel « pour être prudent ». `testbig150` — 103,8 Mpx, 4 615 cases,
  // 1 338 polylignes, 2 676 sommets, 141 portes, 185 lumières — doit passer, aujourd'hui et après
  // n'importe quel resserrage futur.
  //
  // ⚠ **Le corpus dépend de la machine, et ce test a cassé la CI pour l'avoir oublié.**
  // `maps/*.dd2vtt` est gitignoré — les exports pèsent des dizaines de mégaoctets — donc le runner
  // ne voit que `manoir-rdc.uvtt`, la seule carte versionnée. Exiger un compte minimum revenait à
  // asserter la présence de fichiers absents par construction. Même piège, et même remède, que
  // `realUvtt.test.mjs` qui s'ignore quand `fixtures/real/` est vide.
  //
  // ⛔ **Mais on ne se contente pas d'ignorer** : ce qui est là est vérifié, toujours. Sur le
  // runner c'est une carte, sur le poste du mainteneur c'est le corpus entier — et c'est là que le
  // resserrage d'un plafond se ferait attraper.
  const cartes = fs
    .readdirSync('maps')
    .filter((n) => /\.(dd2vtt|uvtt|df2vtt)$/i.test(n));

  if (cartes.length === 0) {
    t.skip('aucune carte réelle sur cette machine : les plafonds ne peuvent pas être éprouvés ici');
    return;
  }

  for (const nom of cartes) {
    assert.doesNotThrow(
      () => parseUvtt(fs.readFileSync(path.join('maps', nom), 'utf-8')),
      `« ${nom} » est une carte réelle du dépôt : un plafond qui la refuse est un plafond faux`
    );
  }
});

test('bornes — chaque plafond refuse ce qui le dépasse, et dit lequel', () => {
  const base = { map_size: { x: 10, y: 10 }, pixels_per_grid: 100 };

  // Image estimée : 3000×3000 cases à 100 px/case = 90 000 Mpx.
  assert.throws(
    () => parseUvtt({ resolution: { ...base, map_size: { x: 3000, y: 3000 } } }),
    /Image trop grande/,
    'une image démesurée doit être refusée AVANT tout décodage'
  );

  // Cases : 600×600 = 360 000, au-delà de 250 000 — mais à 1 px/case pour ne pas déclencher
  // d'abord le plafond d'image. ⭐ Deux plafonds distincts doivent rester distinguables : un seul
  // message pour deux causes rendrait le diagnostic impossible.
  assert.throws(
    () => parseUvtt({ resolution: { map_size: { x: 600, y: 600 }, pixels_per_grid: 1 } }),
    /Carte trop vaste/,
    'un nombre de cases démesuré doit être refusé, et nommé comme tel'
  );

  const poly = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  assert.throws(
    () => parseUvtt({ resolution: base, line_of_sight: Array.from({ length: 50001 }, poly) }),
    /Trop de polylignes/
  );
  assert.throws(
    () =>
      parseUvtt({
        resolution: base,
        line_of_sight: [Array.from({ length: 200001 }, (_, i) => ({ x: i, y: i }))],
      }),
    /Trop de sommets/
  );
  assert.throws(
    () =>
      parseUvtt({
        resolution: base,
        portals: Array.from({ length: 10001 }, () => ({ bounds: poly() })),
      }),
    /Trop de portes/
  );
  assert.throws(
    () =>
      parseUvtt({
        resolution: base,
        lights: Array.from({ length: 10001 }, () => ({ position: { x: 1, y: 1 }, range: 1 })),
      }),
    /Trop de lumières/
  );
});

test('bornes — NaN et Infinity sont rejetés, là où `typeof` les laissait passer', () => {
  // ⛔ `typeof NaN === 'number'` : l'ancien contrôle acceptait NaN et Infinity. Un NaN traverse
  // tout sans rien casser — toute comparaison avec lui est fausse, donc un segment devient
  // invisible au sweep sans la moindre erreur — puis ressort en `null` à la sérialisation.
  const res = parseUvtt({
    resolution: { map_size: { x: 10, y: 10 }, pixels_per_grid: 100 },
    line_of_sight: [
      [{ x: 0, y: 0 }, { x: NaN, y: 2 }, { x: 3, y: Infinity }, { x: 4, y: 4 }],
    ],
  });

  const sommets = res.walls.flat();
  assert.equal(sommets.length, 2, 'seuls les deux sommets finis doivent survivre');
  for (const s of sommets) {
    assert.ok(Number.isFinite(s.cellX) && Number.isFinite(s.cellY), `sommet non fini : ${JSON.stringify(s)}`);
  }
  assert.ok(
    res.warnings.some((w) => /point\(s\) de mur ignoré/.test(w)),
    'le rejet doit être compté et dit, jamais silencieux'
  );
});

test('⭐ Z-04 — une lumière `shadows: false` est conservée, mais son écart est DIT', () => {
  // ⛔ Le rendu occlut toutes les sources, `shadows: false` compris (décision §4.4b du
  // 26/08/2026) : le champ lumineux nourrit la vision, donc une source traversant un mur
  // ferait VOIR à travers. Mais un import n'écarte jamais rien en silence — c'est la règle
  // d'universalité. Le champ reste donc importé fidèlement, ET l'écart est signalé.
  const res = parseUvtt({
    resolution: { pixels_per_grid: 100, map_size: { x: 10, y: 10 } },
    lights: [
      { position: { x: 2, y: 2 }, range: 4, intensity: 1, color: '#ffffff', shadows: false },
      { position: { x: 5, y: 5 }, range: 4, intensity: 1, color: '#ffffff', shadows: false },
      { position: { x: 8, y: 8 }, range: 4, intensity: 1, color: '#ffffff', shadows: true },
    ],
    image: '',
  });

  // 1. Le champ survit à l'import, fidèlement. Le jeter serait perdre de l'information.
  assert.equal(res.level.lights.length, 3);
  assert.equal(res.level.lights[0].shadows, false);
  assert.equal(res.level.lights[2].shadows, true);

  // 2. Et l'écart est dit, avec son compte exact.
  const avert = res.warnings.find((w) => w.includes('shadows: false'));
  assert.ok(avert, 'l’écart doit être signalé');
  assert.ok(avert.includes('2 lumière'), `le compte doit être exact, obtenu : ${avert}`);
  assert.ok(avert.includes('AVEC ombres'), 'il doit dire ce que le moteur fait à la place');

  // ⭐ Preuve par mutation : sans le compteur, ou en le branchant sur `shadows === true`,
  // ce test rougit — 2 sources sur 3 sont concernées, jamais 1 ni 3.
  assert.ok(!avert.includes('3 lumière') && !avert.includes('1 lumière'));

  // 3. Un corpus entièrement `shadows: true` — celui du dépôt, 303 sources sur 303 — ne
  //    déclenche AUCUN avertissement. Un avertissement qui crie toujours ne se lit plus.
  const propre = parseUvtt({
    resolution: { pixels_per_grid: 100, map_size: { x: 10, y: 10 } },
    lights: [{ position: { x: 2, y: 2 }, range: 4, intensity: 1, color: '#fff', shadows: true }],
    image: '',
  });
  assert.equal(propre.warnings.filter((w) => w.includes('shadows')).length, 0);

  // 4. `shadows` absent vaut `true` : le silence de l'export n'est pas une demande.
  const absent = parseUvtt({
    resolution: { pixels_per_grid: 100, map_size: { x: 10, y: 10 } },
    lights: [{ position: { x: 2, y: 2 }, range: 4, intensity: 1, color: '#fff' }],
    image: '',
  });
  assert.equal(absent.level.lights[0].shadows, true);
  assert.equal(absent.warnings.filter((w) => w.includes('shadows')).length, 0);
});
