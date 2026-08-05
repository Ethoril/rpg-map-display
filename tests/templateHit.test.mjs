// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findHitTemplate,
  getTemplateHandleRadiusMap,
  isPointInCone,
  normalizeAngleDeg,
} from '../js/input/templateHit.js';
import { createLevel } from '../js/core/schema.js';

test('normalizeAngleDeg ramène les angles dans [-180, 180]', () => {
  assert.equal(normalizeAngleDeg(0), 0);
  assert.equal(normalizeAngleDeg(90), 90);
  assert.equal(Math.abs(normalizeAngleDeg(180)), 180);
  assert.equal(normalizeAngleDeg(270), -90);
  assert.equal(normalizeAngleDeg(360), 0);
  assert.equal(normalizeAngleDeg(-90), -90);
});

test('getTemplateHandleRadiusMap borne la taille de la poignée de pointe sur cône dézoomé', () => {
  // Portée 140 px (1 case à 140 px/case)
  // À zoom 1, la poignée de 24 px écran a un rayon de 12 px carte
  const r1 = getTemplateHandleRadiusMap(140, 1.0);
  assert.equal(r1, 12);

  // À la vue « carte entière » (zoom 0.1, 1 case = 14 px écran)
  // Rayon écran = 14 px. 40 % = 5.6 px écran => rayon carte = 56 px carte
  const r2 = getTemplateHandleRadiusMap(140, 0.1);
  assert.equal(r2, 56);
  // Vérification que le rayon écran résultant r2 * 0.1 est environ 5.6 px < 12 px
  assert.equal(Math.abs(r2 * 0.1 - 5.6) < 1e-6, true);
});

test('isPointInCone teste correctement l\'appartenance au secteur du cône', () => {
  const origin = { x: 100, y: 100 };
  const radiusPx = 100;

  // Cône orienté vers l'Est (directionDeg = 0), ouverture 60° ([-30°, 30°])
  // Point droit devant (150, 100) -> 0° -> dedans
  assert.equal(isPointInCone(origin, 0, radiusPx, { x: 150, y: 100 }), true);

  // Point à 20° Nord (vers le haut) -> dedans
  const rad20 = (20 * Math.PI) / 180;
  assert.equal(
    isPointInCone(origin, 0, radiusPx, {
      x: 100 + 50 * Math.cos(rad20),
      y: 100 + 50 * Math.sin(rad20),
    }),
    true
  );

  // Point à 45° -> hors secteur (angle > 30°)
  const rad45 = (45 * Math.PI) / 180;
  assert.equal(
    isPointInCone(origin, 0, radiusPx, {
      x: 100 + 50 * Math.cos(rad45),
      y: 100 + 50 * Math.sin(rad45),
    }),
    false
  );

  // Point au-delà du rayon (> 100 px) -> hors secteur
  assert.equal(isPointInCone(origin, 0, radiusPx, { x: 250, y: 100 }), false);
});

test('findHitTemplate distingue pointe (move) et corps (rotate) sur un cône et respecte visibleToPlayers', () => {
  const level = createLevel({ id: 'lvl1', pxPerCell: 140 });
  const templates = [
    {
      id: 'tpl-circle',
      levelId: 'lvl1',
      shape: /** @type {const} */ ('circle'),
      origin: { x: 200, y: 200 },
      radiusCells: 2, // 280 px
      directionDeg: 0,
      widthCells: 1,
      color: '#ef4444',
      visibleToPlayers: true,
    },
    {
      id: 'tpl-cone',
      levelId: 'lvl1',
      shape: /** @type {const} */ ('cone'),
      origin: { x: 500, y: 500 },
      radiusCells: 3, // 420 px
      directionDeg: 0, // Vers l'Est
      widthCells: 1,
      color: '#3b82f6',
      visibleToPlayers: false,
    },
  ];

  // 1. Sur le cercle : tap n'importe où dans la portée donne mode 'move'
  const hitCircle = findHitTemplate(level, templates, { x: 250, y: 200 }, 1.0, 140, false);
  assert.notEqual(hitCircle, null);
  assert.equal(hitCircle?.template.id, 'tpl-circle');
  assert.equal(hitCircle?.mode, 'move');

  // 2. Sur la pointe du cône (dans la poignée de 12 px autour de 500,500) -> mode 'move'
  const hitConeVertex = findHitTemplate(level, templates, { x: 505, y: 500 }, 1.0, 140, false);
  assert.notEqual(hitConeVertex, null);
  assert.equal(hitConeVertex?.template.id, 'tpl-cone');
  assert.equal(hitConeVertex?.mode, 'move');

  // 3. Dans le corps du cône (à 100 px de la pointe, vers l'Est) -> mode 'rotate'
  const hitConeBody = findHitTemplate(level, templates, { x: 600, y: 500 }, 1.0, 140, false);
  assert.notEqual(hitConeBody, null);
  assert.equal(hitConeBody?.template.id, 'tpl-cone');
  assert.equal(hitConeBody?.mode, 'rotate');

  // 4. Vue joueurs (isPlayerView = true) : le cône invisible aux joueurs est ignoré
  const hitPlayerCone = findHitTemplate(level, templates, { x: 600, y: 500 }, 1.0, 140, true);
  assert.equal(hitPlayerCone, null, 'Un gabarit visibleToPlayers: false doit être ignoré côté joueurs');

  // 5. Vue joueurs : le cercle visible aux joueurs est détecté
  const hitPlayerCircle = findHitTemplate(level, templates, { x: 250, y: 200 }, 1.0, 140, true);
  assert.notEqual(hitPlayerCircle, null);
  assert.equal(hitPlayerCircle?.template.id, 'tpl-circle');
});
