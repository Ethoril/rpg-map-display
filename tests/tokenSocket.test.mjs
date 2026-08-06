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

/**
 * Bornage de la châsse en part du rayon — décision du mainteneur, 06/08/2026.
 *
 * Le défaut borné : `CHASSE_BAND_SCREEN_PX` est une épaisseur **absolue**, donc elle mange une part
 * d'autant plus grande que le pion est petit. Sur un pion de 24 px d'écran — la borne basse du
 * palier `reduced` — une bande de 6 px laissait un portrait de 6 px de rayon, **un quart de la
 * surface**.
 *
 * ⚠ Ce test ne se contente pas de constater que le plafond existe : il vérifie les **deux
 * propriétés** qui font que sa valeur est dérivée et non choisie. Un plafond écrit à la main
 * satisferait le premier constat et raterait les deux autres.
 */
test('7. Bornage de la châsse : inopérant au palier full, resserré en dessous, sans discontinuité', () => {
  /** Épaisseur de bande obtenue, en pixels ÉCRAN, pour un diamètre écran visé.
   * @param {number} diametreEcranPx
   * @param {number} [zoom]
   */
  const bandeEcran = (diametreEcranPx, zoom = 1) => {
    const widthMap = diametreEcranPx / zoom;
    const l = computeSocketLayout(widthMap, zoom, { kind: 'pc' });
    return (widthMap / 2 - l.imageRadius) * zoom;
  };

  // (1) Au-dessus du seuil `full`, le plafond ne mord pas : la bande vaut sa valeur nominale.
  //     C'est ce qui garantit que le bornage ne peut pas invalider les mesures des critères 2 et 7,
  //     toutes prises au palier `full`.
  assert.ok(
    Math.abs(bandeEcran(280) - CHASSE_BAND_SCREEN_PX) < 1e-9,
    `à 280 px la bande doit valoir ${CHASSE_BAND_SCREEN_PX} px, obtenu ${bandeEcran(280)}`
  );
  assert.ok(
    Math.abs(bandeEcran(80) - CHASSE_BAND_SCREEN_PX) < 1e-9,
    `à 80 px la bande doit valoir ${CHASSE_BAND_SCREEN_PX} px, obtenu ${bandeEcran(80)}`
  );

  // (2) Au seuil exact du palier `full`, le plafond vaut exactement la bande nominale : aucune
  //     discontinuité. La châsse s'amincit continûment au dézoom au lieu de sauter.
  const auSeuil = bandeEcran(CHASSE_TIER_FULL_SCREEN_PX);
  assert.ok(
    Math.abs(auSeuil - CHASSE_BAND_SCREEN_PX) < 1e-9,
    `au seuil ${CHASSE_TIER_FULL_SCREEN_PX} px la bande doit encore valoir ${CHASSE_BAND_SCREEN_PX} px, obtenu ${auSeuil}`
  );

  // (3) Sous le seuil, le plafond mord, et il mord d'autant plus que le pion est petit.
  const a24 = bandeEcran(CHASSE_TIER_REDUCED_SCREEN_PX);
  assert.ok(
    a24 < CHASSE_BAND_SCREEN_PX,
    `à ${CHASSE_TIER_REDUCED_SCREEN_PX} px la bande doit être bornée sous ${CHASSE_BAND_SCREEN_PX} px, obtenu ${a24}`
  );
  assert.ok(
    a24 < bandeEcran(34) && bandeEcran(34) <= CHASSE_BAND_SCREEN_PX,
    'la bande doit décroître continûment entre le seuil et la borne basse du palier reduced'
  );

  // (4) Le portrait garde plus de 70 % de son rayon partout où la châsse existe. C'est la garantie
  //     de jeu : un pion reste une illustration châssée, jamais un cadre avec un point au milieu.
  //     Avant bornage, ce rapport tombait à 50 % à 24 px.
  for (const d of [CHASSE_TIER_REDUCED_SCREEN_PX, 30, 34, 44, 80, 280]) {
    const part = 1 - bandeEcran(d) / (d / 2);
    assert.ok(
      part > 0.7,
      `à ${d} px le portrait ne garde que ${(part * 100).toFixed(1)} % du rayon`
    );
  }

  // (5) Le bornage n'invente pas de châsse là où il n'y en a pas : sous le palier `reduced`,
  //     `imageRadius` vaut le rayon plein.
  const sousLeSeuil = computeSocketLayout(140, 0.1, { kind: 'pc' });
  assert.equal(sousLeSeuil.tier, 'none');
  assert.equal(sousLeSeuil.imageRadius, 70);
});
