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
} from '../js/core/constants.js';

import {
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
  const badToken = createToken(/** @type {any} */ ({ id: 'gob', levelId: level.id, health: 'invalid_state' }));
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

// ── 4. Étape Q-d : Compteur chiffré ─────────────────────────────────────────

test('Q-d 1. computeHpBadgeLayout reste toujours visible sans seuil de disparition (Critère 8)', () => {
  const zooms = [0.1, 0.5, 1.0, 2.5];
  for (const zoom of zooms) {
    const layout = computeHpBadgeLayout(140, zoom, 12, 28);
    assert.equal(layout.visible, true, 'Le compteur chiffré ne disparaît à aucun zoom');
    assert.equal(layout.text, '12/28');
  }
});

test('Q-d 2. Le cartouche touche le pion : son coin bas-droit se pose sur le bord du portrait rond (01/10/2026)', () => {
  // Il était posé hors de la case, à (-padding, -padding) — « un peu trop éloigné » à l'usage.
  for (const largeur of [70, 140, 280]) {
    for (const zoom of [0.5, 1, 2]) {
      const { badgeX, badgeY } = computeHpBadgeLayout(largeur, zoom, 12, 28);
      // Coin bas-droit du cartouche, relatif au centre du pion.
      const dx = badgeX - largeur / 2;
      const dy = badgeY - largeur / 2;
      const distance = Math.hypot(dx, dy);
      assert.ok(badgeX > 0 && badgeY > 0, `dans la case (largeur ${largeur}, zoom ${zoom})`);
      // À moins d'un huitième de rayon du bord, côté intérieur : il mord le portrait sans le couvrir.
      assert.ok(distance <= largeur / 2 && distance >= (largeur / 2) * 0.875, `sur le bord : ${distance} pour un rayon ${largeur / 2}`);
    }
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
