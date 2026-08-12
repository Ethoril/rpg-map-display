// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLevel, createCampaign } from '../js/core/schema.js';
import { gridFor } from '../js/grid/index.js';
import { computeBlockedEdges } from '../js/import/blockedEdges.js';
import { cellKey } from '../js/core/cellKey.js';

test('G-04 Critère 1 : Coexistence d’un étage hex et carré dans la même campagne', () => {
  const levelSquare = createLevel({
    id: 'lvl-square',
    name: 'Étage Carré',
    grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 10,
    heightCells: 10,
  });

  const levelHex = createLevel({
    id: 'lvl-hex',
    name: 'Étage Hexagonal',
    grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 10,
    heightCells: 10,
  });

  const campaign = createCampaign({ levels: [levelSquare, levelHex] });
  assert.equal(campaign.levels.length, 2);

  const gridSquare = gridFor(levelSquare);
  const gridHex = gridFor(levelHex);

  assert.equal(gridSquare.type, 'square');
  assert.equal(gridHex.type, 'hex');
});

test('G-04 Critère 2 : Hit-test exhaustif — sélectionne l’hexagone le plus proche par l’arrondi cubique', () => {
  const levelHex = createLevel({
    id: 'lvl-hex',
    grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 10,
    heightCells: 10,
    pxPerCell: 140,
  });
  const grid = gridFor(levelHex);
  const allCells = grid.allCells(10, 10);
  const centers = allCells.map(c => ({ cell: c, pt: grid.pointFromCell(c) }));

  let totalTested = 0;
  let mismatches = 0;

  const maxX = 10 * 140;
  const maxY = 10 * 121.2435565298214;

  for (let x = 5; x < maxX; x += 10) {
    for (let y = 5; y < maxY; y += 10) {
      const p = { x, y };
      const hit = grid.cellFromPoint(p);
      if (!hit) continue;

      totalTested++;

      let closestCell = centers[0].cell;
      let minDistance = Infinity;

      for (let i = 0; i < centers.length; i++) {
        const d = Math.hypot(p.x - centers[i].pt.x, p.y - centers[i].pt.y);
        if (d < minDistance) {
          minDistance = d;
          closestCell = centers[i].cell;
        }
      }

      if (hit.a !== closestCell.a || hit.b !== closestCell.b) {
        mismatches++;
      }
    }
  }

  assert.ok(totalTested > 1000, `au moins 1000 points balayés (mesuré: ${totalTested})`);
  assert.equal(mismatches, 0, `0 point mal attribué par cellFromPoint sur ${totalTested} points balayés (obtenu: ${mismatches})`);
});

test('G-04 Critère 3 : cellsInRange avec 6 voisines et respect d’un mur (blockedEdges)', () => {
  const levelHex = createLevel({
    id: 'lvl-hex-wall',
    grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 5,
    heightCells: 5,
    pxPerCell: 140,
    walls: [
      // Mur bloquant l'arête entre (1,1) et sa voisine de droite (2,1)
      [{ cellX: 2.0, cellY: 1.0 }, { cellX: 2.0, cellY: 1.6 }],
    ],
  });

  const grid = gridFor(levelHex);
  const blockedEdges = computeBlockedEdges(levelHex, grid);

  const start = { a: 1, b: 1 };
  const range = grid.cellsInRange(start, 1, blockedEdges);

  // Le mur bloque le passage vers (2,1)
  const neighborBlockedKey = cellKey({ a: 2, b: 1 });

  // hand-written expected set of reachable cells at budget 1 (5 voisines atteignables + pas la case de départ)
  const expectedKeys = new Set(
    grid.neighbors(start)
      .filter(n => !(n.a === 2 && n.b === 1))
      .map(n => cellKey(n))
  );

  assert.equal(range.has(neighborBlockedKey), false, 'la case derrière le mur est bloquée');
  assert.equal(range.size, expectedKeys.size, 'le nombre de cases atteignables correspond exactement au calcul à la main');

  for (const k of expectedKeys) {
    assert.ok(range.has(k), `la case ${k} doit être atteignable`);
  }
});

test('R-07 : la conversion odd-r ⇄ cubique de neighbors, distance et cellsInRange, hors rangées 0 et 1', () => {
  const levelHex = createLevel({
    id: 'lvl-hex-r07',
    grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 12,
    heightCells: 12,
    pxPerCell: 140,
  });
  const grid = gridFor(levelHex);
  /** @param {{a: number, b: number}[]} cells */
  const trier = (cells) => cells.map((c) => `${c.a},${c.b}`).sort();

  // ⭐ **Pourquoi les rangées ≥ 2, et pourquoi ce test existe.** Le 12/08/2026, retirer la
  // conversion `- (cell.b >> 1)` de `HexGrid.neighbors` laissait **428 tests sur 428 au vert**.
  // La mutation est un no-op en rangées 0 et 1, car `b >> 1` y vaut 0 ; le seul critère qui
  // exerçait `neighbors` partait de (1,1). Dès la rangée 2, le voisinage devient entièrement faux.
  //
  // Les six voisines ci-dessous sont **déduites du pavage**, pas relevées sur l'implémentation :
  // en odd-r pointe-en-haut, les rangées impaires sont décalées d'une demi-case vers la droite.
  // Une case de rangée **paire** a donc, au-dessus et au-dessous, les colonnes `a-1` et `a` ;
  // une case de rangée **impaire** a les colonnes `a` et `a+1`. Les deux voisines de même rangée
  // sont toujours `a-1` et `a+1`.

  // Rangée 4 (paire) : même rangée (4,4) (6,4) — au-dessus (4,3) (5,3) — au-dessous (4,5) (5,5)
  assert.deepEqual(
    trier(grid.neighbors({ a: 5, b: 4 })),
    trier([{ a: 4, b: 4 }, { a: 6, b: 4 }, { a: 4, b: 3 }, { a: 5, b: 3 }, { a: 4, b: 5 }, { a: 5, b: 5 }]),
    'rangée paire : les colonnes a-1 et a au-dessus comme au-dessous'
  );

  // Rangée 3 (impaire) : même rangée (4,3) (6,3) — au-dessus (5,2) (6,2) — au-dessous (5,4) (6,4)
  assert.deepEqual(
    trier(grid.neighbors({ a: 5, b: 3 })),
    trier([{ a: 4, b: 3 }, { a: 6, b: 3 }, { a: 5, b: 2 }, { a: 6, b: 2 }, { a: 5, b: 4 }, { a: 6, b: 4 }]),
    'rangée impaire : les colonnes a et a+1 au-dessus comme au-dessous'
  );

  // Bord gauche, rangée paire : le décalage des rangées impaires fait sortir la colonne -1, il
  // ne reste donc que trois voisines. C'est le sens qu'un voisinage « axial » rend faux sans bruit.
  assert.deepEqual(
    trier(grid.neighbors({ a: 0, b: 2 })),
    trier([{ a: 1, b: 2 }, { a: 0, b: 1 }, { a: 0, b: 3 }]),
    'bord gauche en rangée paire : trois voisines seulement'
  );

  // ⛔ **Les bords droit et bas aussi.** Ne garder que le bord gauche laissait passer un
  // `ncol <= this.widthCells` : le voisinage débordait d'une colonne, `n.b * width + n.a` se
  // repliait alors sur l'index d'une case légitime, et **rien** dans le dépôt ne rougissait —
  // ni R-06 ni R-01, parce que la force brute de référence emprunte le même `neighbors`.
  // (11,2), rangée paire au bord droit : pas de colonne 12, donc cinq voisines.
  assert.deepEqual(
    trier(grid.neighbors({ a: 11, b: 2 })),
    trier([{ a: 10, b: 2 }, { a: 10, b: 1 }, { a: 11, b: 1 }, { a: 10, b: 3 }, { a: 11, b: 3 }]),
    'bord droit en rangée paire : cinq voisines'
  );
  // (5,11), dernière rangée, impaire : rien en dessous, donc quatre voisines.
  assert.deepEqual(
    trier(grid.neighbors({ a: 5, b: 11 })),
    trier([{ a: 4, b: 11 }, { a: 6, b: 11 }, { a: 5, b: 10 }, { a: 6, b: 10 }]),
    'dernière rangée, impaire : quatre voisines'
  );

  // `distance` traverse la même conversion. Chemins vérifiés à la main sur le pavage :
  // (2,0) → (2,1) → (2,2), et (5,2) → (5,3) → (5,4).
  assert.equal(grid.distance({ a: 5, b: 4 }, { a: 6, b: 4 }), 1);
  assert.equal(grid.distance({ a: 2, b: 0 }, { a: 2, b: 2 }), 2);
  assert.equal(grid.distance({ a: 5, b: 2 }, { a: 5, b: 4 }), 2);
  assert.equal(grid.distance({ a: 5, b: 4 }, { a: 5, b: 4 }), 0);

  // ⛔ **Un cas où `dq` et `dr` sont de même signe, et il est obligatoire.** Les trois paires
  // ci-dessus sont des déplacements verticaux, où `dq` et `dr` sont toujours de signes opposés :
  // la troisième coordonnée cubique `|dq + dr|` n'y est jamais le maximum. Retirer ce terme —
  // *le* bug canonique de la distance hexagonale — les laissait toutes vertes, alors qu'il fausse
  // **28,5 % des paires** d'un étage 12 × 12 (mesuré), jusqu'à rendre 4 pour une vraie distance 8.
  // Chemin à la main : (5,4) → (5,5) → (6,6) → (7,6) → (8,6), soit 4 pas.
  assert.equal(grid.distance({ a: 5, b: 4 }, { a: 8, b: 6 }), 4, 'diagonale : |dq + dr| domine');
  assert.equal(
    grid.distance({ a: 5, b: 2 }, { a: 5, b: 4 }),
    grid.distance({ a: 5, b: 4 }, { a: 5, b: 2 }),
    'la distance hexagonale est symétrique'
  );

  // L'emprise d'un pion de taille 2 est la rosette de rayon 1 : la case et ses six voisines.
  // Même conversion, même piège — et c'est ce que le liseré d'un gros pion dessine réellement.
  assert.deepEqual(
    trier(grid.cellsOccupied({ a: 5, b: 4 }, 2)),
    trier([
      { a: 5, b: 4 },
      { a: 4, b: 4 }, { a: 6, b: 4 }, { a: 4, b: 3 }, { a: 5, b: 3 }, { a: 4, b: 5 }, { a: 5, b: 5 },
    ]),
    'cellsOccupied(taille 2) couvre la case et ses six voisines'
  );
  assert.deepEqual(
    trier(grid.cellsOccupied({ a: 5, b: 4 }, 1)),
    trier([{ a: 5, b: 4 }]),
    'cellsOccupied(taille 1) ne couvre que la case'
  );
  // Un gros pion dans un coin : l'emprise doit être **découpée** aux bornes de l'étage. Sans cette
  // assertion, supprimer le test de bornes de `cellsOccupied` restait vert, la rosette de (5,4)
  // étant entièrement intérieure.
  const coin = grid.cellsOccupied({ a: 0, b: 0 }, 3);
  assert.ok(coin.length > 0 && coin.length < 19, `un coin découpe la rosette de 19 cases (obtenu ${coin.length})`);
  assert.ok(
    coin.every((c) => c.a >= 0 && c.a < 12 && c.b >= 0 && c.b < 12),
    'aucune case de l’emprise ne sort de l’étage'
  );

  // Et le chemin réellement emprunté par le déplacement : sans mur, un budget de 1 depuis une
  // case de rangée paire atteint exactement ses six voisines. Sans cette assertion, `neighbors`
  // serait juste sans que `cellsInRange` l'utilise.
  const portee = grid.cellsInRange({ a: 5, b: 4 }, 1, new Set());
  assert.deepEqual(
    [...portee.keys()].sort(),
    trier([{ a: 4, b: 4 }, { a: 6, b: 4 }, { a: 4, b: 3 }, { a: 5, b: 3 }, { a: 4, b: 5 }, { a: 5, b: 5 }]),
    'cellsInRange à budget 1 atteint exactement les six voisines, la case de départ exclue'
  );
});

test('R-02 : Grille HexGrid odd-r — Bornes rectangulaires 12x12 et aller-retour cellFromPoint(pointFromCell(c))', () => {
  const levelHex = createLevel({
    id: 'lvl-hex-12x12',
    grid: { type: 'hex', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
    widthCells: 12,
    heightCells: 12,
    pxPerCell: 140,
  });
  const grid = gridFor(levelHex);
  const maxWidth = 12 * 140; // 1680 px
  const maxHeight = 12 * 140; // 1680 px

  const cells = grid.allCells(12, 12);
  assert.equal(cells.length, 144, 'allCells(12, 12) doit contenir exactement 144 cases');

  for (const c of cells) {
    const pt = grid.pointFromCell(c);
    assert.ok(pt.x >= 0 && pt.x <= maxWidth, `x=${pt.x} de la case (${c.a},${c.b}) doit rester dans [0, ${maxWidth}]`);
    assert.ok(pt.y >= 0 && pt.y <= maxHeight, `y=${pt.y} de la case (${c.a},${c.b}) doit rester dans [0, ${maxHeight}]`);

    const back = grid.cellFromPoint(pt);
    assert.notEqual(back, null, `cellFromPoint ne doit pas rendre null pour la case (${c.a},${c.b})`);
    if (back) {
      assert.equal(back.a, c.a, `colonne restaurée (${back.a}) doit égaler origine (${c.a})`);
      assert.equal(back.b, c.b, `rangée restaurée (${back.b}) doit égaler origine (${c.b})`);
    }
  }
});
