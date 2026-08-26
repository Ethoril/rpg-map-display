// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLevel } from '../js/core/schema.js';
import { SquareGrid } from '../js/grid/SquareGrid.js';
import { HexGrid } from '../js/grid/HexGrid.js';

const SQRT3 = Math.sqrt(3);

// ── SquareGrid ────────────────────────────────────────────────────────────────────────

test('SquareGrid.cellCenter rend le même point que pointFromCell (centre de la case)', () => {
  const level = createLevel({ pxPerCell: 100, widthCells: 10, heightCells: 10, grid: { type: 'square', offsetX: 15, offsetY: 25 } });
  const grid = new SquareGrid(level);

  // Preuve par mutation n°3 : décaler `cellCenter` d'une demi-case en carré doit faire
  // rougir CE test — il compare à une valeur attendue calculée à la main, pas seulement
  // à `pointFromCell` (une mutation identique aux deux méthodes passerait sinon inaperçue).
  assert.deepEqual(grid.cellCenter({ a: 2, b: 3 }), { x: 15 + 2.5 * 100, y: 25 + 3.5 * 100 });
  assert.deepEqual(grid.cellCenter({ a: 2, b: 3 }), grid.pointFromCell({ a: 2, b: 3 }));
});

test('SquareGrid.cellBounds : identique à l’ancien calcul par différence de mapFromCellPoint', () => {
  const level = createLevel({ pxPerCell: 140, widthCells: 10, heightCells: 10, grid: { type: 'square', offsetX: 10, offsetY: 20 } });
  const grid = new SquareGrid(level);

  const cp = { cellX: 3, cellY: 4 };
  const bounds1 = grid.cellBounds(cp, 1);
  const bounds3 = grid.cellBounds(cp, 3);

  // Valeur de référence : ce que rendait l'ancien code de TokensLayer, coin + diff de deux
  // mapFromCellPoint. Le critère ⭐ du brief exige un résultat carré strictement inchangé.
  const p0 = grid.mapFromCellPoint(cp);
  const p1size1 = grid.mapFromCellPoint({ cellX: cp.cellX + 1, cellY: cp.cellY + 1 });
  const p1size3 = grid.mapFromCellPoint({ cellX: cp.cellX + 3, cellY: cp.cellY + 3 });

  assert.deepEqual(bounds1, { x: p0.x, y: p0.y, width: p1size1.x - p0.x, height: p1size1.y - p0.y });
  assert.deepEqual(bounds3, { x: p0.x, y: p0.y, width: p1size3.x - p0.x, height: p1size3.y - p0.y });
  assert.equal(bounds1.width, 140);
  assert.equal(bounds3.width, 420);
});

// ── HexGrid ───────────────────────────────────────────────────────────────────────────

test('HexGrid.cellBounds : largeur et hauteur correctes d’un pion 1×1, identiques en rangée paire et impaire', () => {
  const level = createLevel({ pxPerCell: 140, widthCells: 10, heightCells: 10, grid: { type: 'hex', offsetX: 0, offsetY: 0 } });
  const grid = new HexGrid(level);

  // Preuve par mutation n°1 : si `cellBounds` était réécrit comme la différence de deux
  // `mapFromCellPoint` (le défaut d'origine, C-5), la largeur vaudrait 210 en rangée paire
  // et 70 en rangée impaire au lieu de 140 dans les deux cas — CE test rougirait.
  const evenRow = grid.cellBounds({ cellX: 5, cellY: 4 }, 1); // rangée paire
  const oddRow = grid.cellBounds({ cellX: 5, cellY: 5 }, 1); // rangée impaire

  const expectedWidth = 140;
  const expectedHeight = 140 * (2 / SQRT3); // 161,658...

  assert.ok(Math.abs(evenRow.width - expectedWidth) < 1e-9, `largeur rangée paire = ${evenRow.width}`);
  assert.ok(Math.abs(oddRow.width - expectedWidth) < 1e-9, `largeur rangée impaire = ${oddRow.width}`);
  assert.ok(Math.abs(evenRow.height - expectedHeight) < 1e-9, `hauteur rangée paire = ${evenRow.height}`);
  assert.ok(Math.abs(oddRow.height - expectedHeight) < 1e-9, `hauteur rangée impaire = ${oddRow.height}`);
  assert.ok(Math.abs(expectedHeight - 161.66) < 0.01, 'la hauteur attendue est bien ~161,7 px, pas 121,2');
});

test('HexGrid.cellBounds : preuve par mutation n°2 — la boîte est bien centrée sur le centre réel de la case, selon sa parité', () => {
  const level = createLevel({ pxPerCell: 140, widthCells: 10, heightCells: 10, grid: { type: 'hex', offsetX: 0, offsetY: 0 } });
  const grid = new HexGrid(level);

  // Si l'implémentation ignorait la parité de rangée (oubli du terme `0.5 * (rowInt & 1)`),
  // le centre de la boîte en rangée impaire coïnciderait avec celui de la rangée paire —
  // CE test rougirait, car les deux centres doivent différer d'exactement une demi-case en x.
  const evenCell = { a: 5, b: 4 };
  const oddCell = { a: 5, b: 5 };

  const evenBounds = grid.cellBounds({ cellX: evenCell.a, cellY: evenCell.b }, 1);
  const oddBounds = grid.cellBounds({ cellX: oddCell.a, cellY: oddCell.b }, 1);

  const evenCenter = grid.pointFromCell(evenCell);
  const oddCenter = grid.pointFromCell(oddCell);

  assert.ok(Math.abs((evenBounds.x + evenBounds.width / 2) - evenCenter.x) < 1e-9);
  assert.ok(Math.abs((evenBounds.y + evenBounds.height / 2) - evenCenter.y) < 1e-9);
  assert.ok(Math.abs((oddBounds.x + oddBounds.width / 2) - oddCenter.x) < 1e-9);
  assert.ok(Math.abs((oddBounds.y + oddBounds.height / 2) - oddCenter.y) < 1e-9);

  // La différence de centre attendue entre rangées consécutives : le décalage odd-r d'une
  // demi-case en x (0,5 × 140 = 70), la même distance verticale que pointFromCell.
  assert.ok(Math.abs((oddCenter.x - evenCenter.x) - 70) < 1e-9, 'décalage odd-r d’une demi-case en x');
});

test('HexGrid.cellBounds : pion multi-cases, la boîte suit la ROSETTE et non une échelle linéaire', () => {
  const level = createLevel({ pxPerCell: 140, widthCells: 10, heightCells: 10, grid: { type: 'hex', offsetX: 0, offsetY: 0 } });
  const grid = new HexGrid(level);

  const b1 = grid.cellBounds({ cellX: 4, cellY: 4 }, 1);
  const b2 = grid.cellBounds({ cellX: 4, cellY: 4 }, 2);

  // ⛔ **Pas une mise à l'échelle linéaire.** `cellsOccupied` occupe le disque hexagonal de rayon
  // `sizeCells - 1` : en taille 2, le pion couvre le centre PLUS ses six voisins, donc trois
  // colonnes de large et non deux. L'échelle linéaire rendait la boîte d'un tiers trop petite —
  // 280 px au lieu de 420 à 140 px/case — et le pion semblait laisser libres des hexagones qu'il
  // occupe. Ce test verrouillait cette erreur ; il a été corrigé le 19/08/2026, pas assoupli.
  assert.equal(b2.width, 3 * b1.width, 'taille 2 : trois colonnes de large, pas deux');
  const SQRT3 = Math.sqrt(3);
  assert.ok(
    Math.abs(b2.height - (140 * SQRT3 + 140 * (2 / SQRT3))) < 1e-9,
    `taille 2 : une rangée de voisins au-dessus et au-dessous, obtenu ${b2.height}`
  );
  // Toujours centrée sur le même point d'ancrage
  const center1 = { x: b1.x + b1.width / 2, y: b1.y + b1.height / 2 };
  const center2 = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 };
  assert.ok(Math.abs(center1.x - center2.x) < 1e-9);
  assert.ok(Math.abs(center1.y - center2.y) < 1e-9);
});

test('HexGrid.cellBounds : la boîte couvre exactement la rosette de cellsOccupied', () => {
  const level = createLevel({
    pxPerCell: 140,
    widthCells: 40,
    heightCells: 40,
    grid: { type: 'hex', offsetX: 0, offsetY: 0 },
  });
  const grid = new HexGrid(level);
  const SQRT3 = Math.sqrt(3);

  // ⭐ Le critère n'est pas un nombre choisi : c'est l'accord entre le dessin et l'occupation.
  // Pour chaque taille, la boîte doit contenir le CENTRE de chaque case occupée, et sa largeur
  // doit valoir l'étendue de la rosette — sinon un pion couvre des hexagones qu'il n'occupe pas.
  for (const size of [1, 2, 3]) {
    const cell = { a: 10, b: 10 };
    const boite = grid.cellBounds({ cellX: cell.a, cellY: cell.b }, size);
    const rayon = size - 1;

    assert.equal(boite.width, (2 * rayon + 1) * 140, `largeur, taille ${size}`);
    assert.ok(
      Math.abs(boite.height - (rayon * 140 * SQRT3 + 140 * (2 / SQRT3))) < 1e-9,
      `hauteur, taille ${size} : ${boite.height}`
    );

    // ⛔ La preuve qui compte : aucune case occupée ne tombe hors de la boîte.
    for (const occupee of grid.cellsOccupied(cell, size)) {
      const c = grid.pointFromCell(occupee);
      assert.ok(
        c.x >= boite.x - 1e-9 && c.x <= boite.x + boite.width + 1e-9 &&
        c.y >= boite.y - 1e-9 && c.y <= boite.y + boite.height + 1e-9,
        `taille ${size} : la case ${occupee.a},${occupee.b} tombe hors de la boîte`
      );
    }
  }
});
