// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { sweep, getLastEvalSegmentCount } from '../js/vision/sweep.js';

/** @typedef {import('../js/core/types.js').MapPoint} MapPoint */
/** @typedef {import('../js/core/types.js').Segment} Segment */

test('sweep() rend un polygone fermé et non vide sur une pièce simple', () => {
  const origin = { x: 500, y: 500 };
  const rangePx = 1000;
  const segments = [
    { p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 } },
    { p1: { x: 1000, y: 0 }, p2: { x: 1000, y: 1000 } },
    { p1: { x: 1000, y: 1000 }, p2: { x: 0, y: 1000 } },
    { p1: { x: 0, y: 1000 }, p2: { x: 0, y: 0 } },
  ];

  const polygon = sweep(origin, segments, rangePx);

  assert.ok(Array.isArray(polygon));
  assert.ok(polygon.length >= 4, 'Le polygone doit avoir au moins 4 sommets');
  polygon.forEach((pt) => {
    assert.equal(typeof pt.x, 'number');
    assert.equal(typeof pt.y, 'number');
  });
});

test('Un mur occulte : un point situé derrière le mur n\'est pas atteint', () => {
  const origin = { x: 100, y: 100 };
  const rangePx = 500;
  // Mur vertical à x = 200
  const segments = [
    { p1: { x: 200, y: 0 }, p2: { x: 200, y: 300 } },
  ];

  const polygon = sweep(origin, segments, rangePx);

  // Aucun sommet le long du rayon horizontal (y ≈ 100) ne doit dépasser x = 200
  const rayHitsOnHorizontal = polygon.filter((pt) => Math.abs(pt.y - 100) < 1e-3);
  assert.ok(rayHitsOnHorizontal.length > 0);
  rayHitsOnHorizontal.forEach((pt) => {
    assert.ok(pt.x <= 200 + 1e-5, `Le point x=${pt.x} dépasse le mur à x=200`);
  });
});

test('Aucune fuite d\'angle (critère 12) : œil dans pièce A, aucun sommet dans pièce B', () => {
  const origin = { x: 100, y: 100 }; // Pièce A
  const rangePx = 1000;

  // Mur de séparation à x = 200 avec coin à y = 0 et y = 200, pièce B est pour x > 200
  const segments = [
    { p1: { x: 200, y: 0 }, p2: { x: 200, y: 200 } },
    { p1: { x: 200, y: 200 }, p2: { x: 400, y: 200 } },
    { p1: { x: 200, y: 0 }, p2: { x: 400, y: 0 } },
  ];

  const polygon = sweep(origin, segments, rangePx);

  // Dans la zone x > 200 et 0 <= y <= 200 (pièce B fermée par le mur de séparation), aucun sommet ne doit entrer
  const verticesInRoomB = polygon.filter((pt) => pt.x > 200 + 1e-4 && pt.y > 0 - 1e-4 && pt.y < 200 + 1e-4);
  assert.equal(verticesInRoomB.length, 0, 'Aucun sommet ne doit fuir dans la pièce B derrière le mur');
});

test('La portée borne le polygone : sans mur, inscrit dans le cercle de portée (critère 4)', () => {
  const origin = { x: 300, y: 300 };
  const rangePx = 250;
  const polygon = sweep(origin, [], rangePx);

  assert.ok(polygon.length >= 60, 'Sans mur, le polygone comporte la discrétisation angulaire de base');

  polygon.forEach((pt) => {
    const dist = Math.hypot(pt.x - origin.x, pt.y - origin.y);
    assert.ok(
      Math.abs(dist - rangePx) < 1e-3,
      `La distance du sommet (${dist}) doit correspondre à la portée (${rangePx})`
    );
  });
});

test('Le tri par portée est interne : seuls les segments à portée sont retenus', () => {
  const origin = { x: 100, y: 100 };
  const rangePx = 50;

  /** @type {Segment[]} */
  const segments = [];
  // 5 segments proches (< 50 px)
  for (let i = 0; i < 5; i++) {
    segments.push({
      p1: { x: 110 + i * 2, y: 90 },
      p2: { x: 110 + i * 2, y: 110 },
    });
  }
  // 3000 segments lointains (> 500 px)
  for (let i = 0; i < 3000; i++) {
    segments.push({
      p1: { x: 1000 + i, y: 1000 },
      p2: { x: 1000 + i, y: 1010 },
    });
  }

  sweep(origin, segments, rangePx);

  const evalCount = getLastEvalSegmentCount();
  assert.equal(evalCount, 5, `Seuls 5 segments devaient être retenus à portée, obtenu ${evalCount}`);
});

test('Un mur oblique occulte comme un mur aligné (aucune préférence d\'axe)', () => {
  const origin = { x: 0, y: 0 };
  const rangePx = 500;
  // Mur oblique à 45 degrés
  const segments = [
    { p1: { x: 100, y: 0 }, p2: { x: 0, y: 100 } },
  ];

  const polygon = sweep(origin, segments, rangePx);

  // Le rayon vers (50, 50) doit butter sur la droite oblique (x + y = 100)
  const rayHit = polygon.find((pt) => Math.abs(pt.x - pt.y) < 1e-2 && pt.x > 0);
  assert.ok(rayHit, 'Un rayon doit frapper le mur oblique');
  if (rayHit) {
    const sum = rayHit.x + rayHit.y;
    assert.ok(Math.abs(sum - 100) < 1e-3, `Le point (${rayHit.x}, ${rayHit.y}) doit toucher le mur à x+y=100`);
  }
});

test('Couverture EPSILON_ANGLE aux extrémités de mur', () => {
  const origin = { x: 100, y: 100 };
  const segments = [{ p1: { x: 200, y: 50 }, p2: { x: 200, y: 150 } }];
  const rangePx = 400;

  const theta = Math.atan2(50 - 100, 200 - 100);

  const polygon = sweep(origin, segments, rangePx);

  const hitsNearTheta = polygon
    .map((pt) => {
      const angle = Math.atan2(pt.y - origin.y, pt.x - origin.x);
      let diff = Math.abs(angle - theta);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      const dist = Math.hypot(pt.x - origin.x, pt.y - origin.y);
      return { pt, angle, diff, dist };
    })
    .filter((h) => h.diff < 1e-3);

  const hitCorner = hitsNearTheta.some((h) => Math.abs(h.dist - Math.hypot(100, 50)) < 1e-1);
  const hitRange = hitsNearTheta.some((h) => Math.abs(h.dist - rangePx) < 1e-1);

  assert.ok(hitCorner, 'Doit contenir un sommet touchant l\'extrémité du mur (≈ 111.8 px)');
  assert.ok(hitRange, 'Doit contenir un sommet passant le coin et atteignant la portée (≈ 400 px)');
});

