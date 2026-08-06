// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSocketLayout } from '../js/render/tokenSocket.js';
import {
  CHASSE_BAND_SCREEN_PX,
  CHASSE_TIER_FULL_SCREEN_PX,
  CHASSE_TIER_REDUCED_SCREEN_PX,
  TOKEN_HP_PJ_RING_COLOR,
  HEALTH_STATE_COLOR,
} from '../js/core/constants.js';

test('1. tokenSocket.js s\'importe sous Node sans dépendance au DOM', () => {
  assert.equal(typeof computeSocketLayout, 'function');
});

test('2. Critère 6 : Paliers d\'affichage (full, reduced, none) selon le diamètre écran D', () => {
  const widthMap = 140; // 1 case = 140px carte

  // D = 140 * 0.10 = 14 px < 24 px -> 'none'
  const layoutNone = computeSocketLayout(widthMap, 0.10, { kind: 'pc' });
  assert.equal(layoutNone.tier, 'none');
  assert.equal(layoutNone.band, null);
  assert.equal(layoutNone.imageRadius, 70);

  // D = 140 * 0.20 = 28 px (24 <= D < 44) -> 'reduced'
  const layoutReduced = computeSocketLayout(widthMap, 0.20, { kind: 'pc' });
  assert.equal(layoutReduced.tier, 'reduced');
  assert.notEqual(layoutReduced.band, null);
  assert.equal(layoutReduced.bevel, null); // Pas de biseau au palier reduced
  assert.equal(layoutReduced.stateMarks, null); // Pas d'encoches au palier reduced

  // D = 140 * 0.40 = 56 px >= 44 px -> 'full'
  const layoutFull = computeSocketLayout(widthMap, 0.40, { kind: 'pc' });
  assert.equal(layoutFull.tier, 'full');
  assert.notEqual(layoutFull.band, null);
  assert.notEqual(layoutFull.bevel, null); // Biseau présent au palier full

  // Pion 3 cases (420px carte) à zoom 0.10 -> D = 42 px -> 'reduced'
  const layout3cReduced = computeSocketLayout(420, 0.10, { kind: 'pc' });
  assert.equal(layout3cReduced.tier, 'reduced');
});

test('3. Réservation d\'espace vers l\'intérieur (Arbitrage 2)', () => {
  const widthMap = 140;
  const zoom = 1.0;
  const layout = computeSocketLayout(widthMap, zoom, { kind: 'pc' });

  // Empreinte extérieure inchangée (70px)
  assert.equal(layout.band?.outerRadius, 70);
  // Image en retrait de CHASSE_BAND_SCREEN_PX / zoom = 6px
  const expectedInnerRadius = 70 - CHASSE_BAND_SCREEN_PX / zoom;
  assert.equal(layout.imageRadius, expectedInnerRadius);
  assert.equal(layout.band?.innerRadius, expectedInnerRadius);
  assert.equal(layout.separator?.radius, expectedInnerRadius);
});

test('4. Critère 4 : Angle balayé de l\'arc de PV d\'un PJ (ratio * 2π)', () => {
  const widthMap = 140;
  const zoom = 1.0;

  // PJ à 50% de PV (10/20)
  const layout50 = computeSocketLayout(widthMap, zoom, {
    kind: 'pc',
    hp: { current: 10, max: 20 },
  });
  assert.notEqual(layout50.hpArc, null);
  if (layout50.hpArc) {
    const sweepAngle = layout50.hpArc.endAngle - layout50.hpArc.startAngle;
    const expectedSweep = 0.5 * Math.PI * 2;
    assert.ok(Math.abs(sweepAngle - expectedSweep) < 0.02, `Angle balayé ${sweepAngle} vs ${expectedSweep}`);
    assert.equal(layout50.hpArc.color, TOKEN_HP_PJ_RING_COLOR);
  }

  // PJ à 100% de PV (20/20)
  const layout100 = computeSocketLayout(widthMap, zoom, {
    kind: 'pc',
    hp: { current: 20, max: 20 },
  });
  assert.notEqual(layout100.hpArc, null);
  if (layout100.hpArc) {
    const sweepAngle = layout100.hpArc.endAngle - layout100.hpArc.startAngle;
    assert.ok(Math.abs(sweepAngle - Math.PI * 2) < 0.02);
  }

  // PJ à 0 PV -> pas d'arc
  const layout0 = computeSocketLayout(widthMap, zoom, {
    kind: 'pc',
    hp: { current: 0, max: 20 },
  });
  assert.equal(layout0.hpArc, null);
});

test('5. Arbitrage 5 : Un pion sans PV (hp: null) porte quand même la châsse', () => {
  const widthMap = 140;
  const zoom = 1.0;
  const layout = computeSocketLayout(widthMap, zoom, {
    kind: 'npc',
    hp: null,
    health: 'unharmed',
  });

  assert.equal(layout.tier, 'full');
  assert.notEqual(layout.band, null);
  assert.equal(layout.hpArc, null); // Pas de jauge de PV sans hp
});

test('6. PNJ et encoches d\'état (Arbitrages 3 & 6)', () => {
  const widthMap = 140;
  const zoom = 1.0;

  // PNJ 'unharmed' : bande neutre, pas d'anneau d'état, pas d'encoches
  const layoutUnharmed = computeSocketLayout(widthMap, zoom, {
    kind: 'npc',
    health: 'unharmed',
  });
  assert.notEqual(layoutUnharmed.band, null);
  assert.equal(layoutUnharmed.stateRing, null);
  assert.equal(layoutUnharmed.stateMarks, null);

  // PNJ 'wounded' : bande neutre + anneau d'état orange + 1 encoche
  const layoutWounded = computeSocketLayout(widthMap, zoom, {
    kind: 'npc',
    health: 'wounded',
  });
  assert.notEqual(layoutWounded.band, null);
  assert.equal(layoutWounded.stateRing?.color, HEALTH_STATE_COLOR.wounded);
  assert.equal(layoutWounded.stateMarks?.angles.length, 1);

  // PNJ 'critical' : bande neutre + anneau d'état rouge + 2 encoches
  const layoutCritical = computeSocketLayout(widthMap, zoom, {
    kind: 'npc',
    health: 'critical',
  });
  assert.notEqual(layoutCritical.band, null);
  assert.equal(layoutCritical.stateRing?.color, HEALTH_STATE_COLOR.critical);
  assert.equal(layoutCritical.stateMarks?.angles.length, 2);
});
