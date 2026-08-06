// @ts-check

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeToken,
  normalizeCampaign,
  createCampaign,
  createLevel,
  createToken,
  validateCampaign,
} from '../js/core/schema.js';

import {
  HEALTH_STATE_IDS,
  HEALTH_STATE_LABEL_FR,
  HEALTH_STATE_COLOR,
  TOKEN_HP_PJ_RING_COLOR,
  TOKEN_HP_RING_THICKNESS_PX,
} from '../js/core/constants.js';

import {
  computeProportionalRing,
  computeStateRing,
  computeHpBadgeLayout,
} from '../js/render/statusBadges.js';

import {
  validateTokenCatalog,
  createTokenFromLibraryEntry,
} from '../js/import/tokenCatalog.js';

import {
  loadCampaign,
  updateToken,
  getSelectedToken,
  setSelection,
} from '../js/state/store.js';

// ── 1. Étape Q-a : Normalisation des pions hérités ─────────────────────────

test('Q-a 1. normalizeToken initialise markers à [], hp à null et health à "unharmed"', () => {
  const legacyToken = { id: 't1', kind: 'pc' };
  const normalized = normalizeToken(legacyToken);
  assert.deepEqual(normalized.markers, []);
  assert.equal(normalized.hp, null);
  assert.equal(normalized.health, 'unharmed');
});

test('Q-a 2. normalizeCampaign normalise les pions d\'une campagne antérieure sans markers', () => {
  const level = createLevel();
  // Simuler un pion hérité où markers, hp et health sont absents
  const rawToken = /** @type {any} */ ({
    id: 't1',
    levelId: level.id,
    cell: { a: 0, b: 0 },
    sizeCells: 1,
    kind: 'pc',
    imageUrl: '',
    borderColor: '#ffffff',
    label: 'T1',
    hidden: false,
    visionBright: 6,
    visionDim: 12,
    speedCells: 6,
    playerMovable: true,
    locked: false,
    elevation: 0,
  });

  const legacyCampaign = createCampaign({
    levels: [level],
    tokens: [rawToken],
  });

  const normalized = normalizeCampaign(legacyCampaign);
  assert.deepEqual(validateCampaign(normalized), [], 'La campagne normalisée doit être valide');
  assert.deepEqual(normalized.tokens[0].markers, []);
  assert.equal(normalized.tokens[0].hp, null);
  assert.equal(normalized.tokens[0].health, 'unharmed');
});

// ── 2. Étape Q-b : Modèle & Schéma ──────────────────────────────────────────

test('Q-b 1. validateCampaign accepte hp: null et valide hp: { current, max } avec message nommant le pion', () => {
  const level = createLevel();
  const validToken = createToken({ id: 'hero', levelId: level.id, hp: { current: 14, max: 28 } });
  const campaign = createCampaign({ levels: [level], tokens: [validToken] });
  assert.equal(validateCampaign(campaign).length, 0);

  // hp invalides (current > max)
  const invalidToken1 = createToken({ id: 'hero', levelId: level.id, hp: { current: 30, max: 28 } });
  const campaignBad1 = createCampaign({ levels: [level], tokens: [invalidToken1] });
  const errs1 = validateCampaign(campaignBad1);
  assert.ok(errs1.length > 0);
  assert.ok(errs1[0].includes('Pion "hero"'), 'Le message d\'erreur doit nommer le pion');

  // hp invalides (max <= 0)
  const invalidToken2 = createToken({ id: 'boss', levelId: level.id, hp: { current: 0, max: 0 } });
  const campaignBad2 = createCampaign({ levels: [level], tokens: [invalidToken2] });
  const errs2 = validateCampaign(campaignBad2);
  assert.ok(errs2.length > 0);
  assert.ok(errs2[0].includes('Pion "boss"'));
});

test('Q-b 2. validateCampaign valide le champ health', () => {
  const level = createLevel();
  const token = createToken({ id: 'gob', levelId: level.id, kind: 'npc', health: 'wounded' });
  const campaign = createCampaign({ levels: [level], tokens: [token] });
  assert.equal(validateCampaign(campaign).length, 0);

  // health invalide
  // @ts-ignore
  const badToken = createToken({ id: 'gob', levelId: level.id, health: 'invalid_state' });
  const badCampaign = createCampaign({ levels: [level], tokens: [badToken] });
  const errs = validateCampaign(badCampaign);
  assert.ok(errs.length > 0);
  assert.ok(errs[0].includes('Pion "gob"'));
  assert.ok(errs[0].includes('health invalide'));
});

test('Q-b 3. updateToken dans le Store accepte hp et health et refuse un patch invalide sans muter', () => {
  const level = createLevel();
  const token = createToken({ id: 'p1', levelId: level.id, hp: { current: 10, max: 20 }, health: 'unharmed' });
  const campaign = createCampaign({ levels: [level], tokens: [token] });

  loadCampaign(campaign);
  setSelection('p1');

  // Patch valide hp
  updateToken('p1', { hp: { current: 5, max: 20 } });
  assert.deepEqual(getSelectedToken()?.hp, { current: 5, max: 20 });

  // Patch valide health
  updateToken('p1', { health: 'wounded' });
  assert.equal(getSelectedToken()?.health, 'wounded');

  // Patch invalide (current > max) : doit lever et ne rien muter
  assert.throws(() => {
    updateToken('p1', { hp: { current: 25, max: 20 } });
  });
  assert.deepEqual(getSelectedToken()?.hp, { current: 5, max: 20 });
});

// ── 3. Étape Q-c : Géométrie des Anneaux de santé ───────────────────────────

test('Q-c 1. computeProportionalRing pour PJ (longueur variable, couleur fixe #2563eb)', () => {
  const tokenWidthMap = 140;
  const zoom = 1.0;

  // PJ à 14/28 (50% de vie)
  const ringHalf = computeProportionalRing(tokenWidthMap, zoom, { current: 14, max: 28 });
  assert.equal(ringHalf.visible, true);
  assert.equal(ringHalf.color, TOKEN_HP_PJ_RING_COLOR);
  assert.equal(ringHalf.startAngle, -Math.PI / 2, 'Départ à midi (-Math.PI/2)');
  assert.equal(ringHalf.endAngle, +Math.PI / 2, 'Fin à 6h (+Math.PI/2) pour 50%');

  // PJ à 0/28 (current === 0) -> aucun arc (visible: false)
  const ringZero = computeProportionalRing(tokenWidthMap, zoom, { current: 0, max: 28 });
  assert.equal(ringZero.visible, false, 'PJ à 0 PV ne trace aucun arc (Critère 3 & §5.2)');
});

test('Q-c 2. computeStateRing pour PNJ (360°, couleur et épaisseur variables)', () => {
  const tokenWidthMap = 140;
  const zoom = 1.0;

  // unharmed -> ne trace rien
  const ringUnharmed = computeStateRing(tokenWidthMap, zoom, 'unharmed');
  assert.equal(ringUnharmed.visible, false, 'unharmed ne trace aucun anneau (Critère 4)');

  // wounded -> couleur #c2410c, épaisseur 1x (3px sur carte à zoom 1)
  const ringWounded = computeStateRing(tokenWidthMap, zoom, 'wounded');
  assert.equal(ringWounded.visible, true);
  assert.equal(ringWounded.color, HEALTH_STATE_COLOR.wounded);
  assert.equal(ringWounded.color, '#c2410c');
  assert.equal(ringWounded.lineWidthMap, 3 / zoom);
  assert.equal(ringWounded.endAngle - ringWounded.startAngle, Math.PI * 2, 'Tour complet 360°');

  // critical -> couleur #ef4444, épaisseur 2x (6px sur carte à zoom 1)
  const ringCritical = computeStateRing(tokenWidthMap, zoom, 'critical');
  assert.equal(ringCritical.visible, true);
  assert.equal(ringCritical.color, HEALTH_STATE_COLOR.critical);
  assert.equal(ringCritical.color, '#ef4444');
  assert.equal(ringCritical.lineWidthMap, 6 / zoom, 'Épaisseur doublée pour critical');
});

test('Q-c 3. Invariance de l\'épaisseur des anneaux à l\'écran à 3 zooms ET 3 tailles de pions (Critère 7)', () => {
  const zooms = [0.5, 1.0, 2.0];
  const tokenSizesMap = [140, 280, 420]; // 1x1, 2x2, 3x3

  for (const zoom of zooms) {
    for (const tokenWidthMap of tokenSizesMap) {
      const ringPj = computeProportionalRing(tokenWidthMap, zoom, { current: 10, max: 20 });
      const ringPnj = computeStateRing(tokenWidthMap, zoom, 'wounded');

      // L'épaisseur à l'écran = lineWidthMap * zoom = TOKEN_HP_RING_THICKNESS_PX (3px)
      const pjThicknessScreen = ringPj.lineWidthMap * zoom;
      const pnjThicknessScreen = ringPnj.lineWidthMap * zoom;

      assert.equal(Math.round(pjThicknessScreen), TOKEN_HP_RING_THICKNESS_PX);
      assert.equal(Math.round(pnjThicknessScreen), TOKEN_HP_RING_THICKNESS_PX);
    }
  }
});

// ── 4. Étape Q-d : Compteur chiffré ─────────────────────────────────────────

test('Q-d 1. computeHpBadgeLayout reste toujours visible sans seuil de disparition (Critère 8)', () => {
  const zooms = [0.1, 0.5, 1.0, 2.5];
  for (const zoom of zooms) {
    const layout = computeHpBadgeLayout(140, zoom, 12, 28);
    assert.equal(layout.visible, true, 'Le compteur chiffré ne disparaît à aucun zoom');
    assert.equal(layout.text, '12/28');
  }
});

// ── 5. Étape Q-f : Bibliothèque de pions & tokenCatalog ───────────────────

test('Q-f 1. validateTokenCatalog valide maxHp', () => {
  const validCatalog = {
    version: 1,
    tokens: [
      { id: 'gob', name: 'Gobelin', imageUrl: 'maps/tokens/gob.webp', kind: 'npc', sizeCells: 1, speedCells: 3, visionBright: 5, visionDim: 10, emitsLight: null, borderColor: '#ff0000', maxHp: 7 }
    ]
  };
  assert.equal(validateTokenCatalog(validCatalog).length, 0);

  // maxHp invalide (0 ou négatif)
  const invalidCatalog = {
    version: 1,
    tokens: [
      { id: 'gob', name: 'Gobelin', imageUrl: 'maps/tokens/gob.webp', kind: 'npc', sizeCells: 1, speedCells: 3, visionBright: 5, visionDim: 10, emitsLight: null, borderColor: '#ff0000', maxHp: 0 }
    ]
  };
  assert.ok(validateTokenCatalog(invalidCatalog).length > 0);
});

test('Q-f 2. createTokenFromLibraryEntry projette maxHp vers hp: { current: maxHp, max: maxHp } et health: "unharmed"', () => {
  const entry = {
    id: 'orc',
    name: 'Orc',
    imageUrl: 'maps/tokens/orc.webp',
    kind: /** @type {'npc'} */ ('npc'),
    sizeCells: 1,
    speedCells: 3,
    visionBright: 5,
    visionDim: 10,
    emitsLight: null,
    borderColor: '#ff0000',
    maxHp: 15,
  };

  const token = createTokenFromLibraryEntry(entry, { levelId: 'rdc' });
  assert.deepEqual(token.hp, { current: 15, max: 15 });
  assert.equal(token.health, 'unharmed');
});

// ── 6. Critère 13 : Absence de dérivation automatique de health depuis hp ────

test('Critère 13. Aucun code du chantier ne dérive health depuis hp', () => {
  const files = [
    'js/core/schema.js',
    'js/state/store.js',
    'js/render/statusBadges.js',
    'js/render/layers/tokens.js',
    'js/ui/gm/panel.js',
  ];

  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
      if (/\bhealth\b/i.test(line) && /\bhp\b/i.test(line)) {
        const isAssignmentFromHp =
          /\bhealth\b\s*[:=].*\bhp\b/i.test(line) ||
          /\bhp\b\s*[:=].*\bhealth\b/i.test(line) ||
          /\bhealth\b.*[<>].*\bhp\b/i.test(line) ||
          /\bhp\b.*[<>].*\bhealth\b/i.test(line);
        assert.equal(isAssignmentFromHp, false, `Dérivation détectée dans ${file}:${i + 1}: ${line}`);
      }
    }
  }
});
