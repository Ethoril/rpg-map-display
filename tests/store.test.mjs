// @ts-check

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadCampaign,
  selectLevel,
  setSelection,
  moveTokenToCell,
  resetStore,
  subscribe,
  getState,
  getCampaign,
  getActiveLevel,
  getSelectedToken,
} from '../js/state/store.js';

import { setSelectionState } from '../js/state/selection.js';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';

/**
 * Génère une campagne valide de test.
 */
function makeValidCampaign() {
  const level1 = createLevel({ id: 'rdc', name: 'Rez-de-chaussée' });
  const level2 = createLevel({ id: 'et1', name: 'Étage 1' });
  const token1 = createToken({
    id: 'hero-1',
    levelId: 'rdc',
    cell: { a: 2, b: 2 },
    speedCells: 3,
  });
  const token2 = createToken({
    id: 'hero-2',
    levelId: 'et1',
    cell: { a: 5, b: 5 },
    speedCells: 4,
  });

  return createCampaign({
    campaignId: 'camp-test',
    name: 'Campagne de Test',
    levels: [level1, level2],
    tokens: [token1, token2],
  });
}

beforeEach(() => {
  resetStore();
});

test('loadCampaign valide et initialise l\'état du store', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);

  const state = getState();
  assert.strictEqual(state.campaign?.campaignId, 'camp-test');
  assert.strictEqual(state.activeLevelId, 'rdc');
  assert.strictEqual(state.selectedTokenId, null);
  assert.strictEqual(state.reachableCells.size, 0);
});

test('loadCampaign refuse un document invalide (validateCampaign) sans altérer le store', () => {
  const camp = makeValidCampaign();
  // Document invalide : coordonnées non entières sur un pion
  camp.tokens[0].cell = { a: 2.5, b: 2 };

  assert.throws(() => {
    loadCampaign(camp);
  }, /document invalide/);

  // L'état reste vide / non chargé
  assert.strictEqual(getState().campaign, null);
});

test('Prouve mécaniquement qu\'une mutation externe directe de l\'état est impossible', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);

  const state = getState();

  // 1. Propriété de premier niveau : `tsc` prouve déjà qu'elle est en lecture seule
  //    (TS2540). On vérifie ici le refus À L'EXÉCUTION, d'où un transtypage ciblé plutôt
  //    qu'un `@ts-ignore` — interdit (§8 n°16), et qui masquerait en plus toute autre
  //    erreur de la ligne.
  const etatMutable = /** @type {{ activeLevelId: string | null }} */ (
    /** @type {unknown} */ (state)
  );
  assert.throws(() => {
    etatMutable.activeLevelId = 'et1';
  }, TypeError);

  // 2. Champ imbriqué : le gel est récursif jusqu'aux coordonnées du pion.
  const campagneFigee = state.campaign;
  assert.ok(campagneFigee, 'la campagne doit être chargée');
  assert.throws(() => {
    campagneFigee.tokens[0].cell.a = 999;
  }, TypeError);

  // 3. La copie rendue par getCampaign() est gelée de la même façon.
  const campagneRecuperee = getCampaign();
  assert.ok(campagneRecuperee, 'getCampaign() doit rendre la campagne chargée');
  assert.throws(() => {
    campagneRecuperee.name = 'Piraté';
  }, TypeError);

  // 4. L'état interne du store doit rester strictement inchangé après les tentatives
  const freshState = getState();
  assert.strictEqual(freshState.activeLevelId, 'rdc');
  assert.strictEqual(freshState.campaign?.tokens[0].cell.a, 2);
  assert.strictEqual(freshState.campaign?.name, 'Campagne de Test');
});

test('Le signal se déclenche exactement une fois par mutation', () => {
  const camp = makeValidCampaign();
  let signalCount = 0;

  const unsubscribe = subscribe(() => {
    signalCount++;
  });

  // Mutation 1 : chargement de campagne
  loadCampaign(camp);
  assert.strictEqual(signalCount, 1);

  // Mutation 2 : sélection d'un pion
  setSelection('hero-1');
  assert.strictEqual(signalCount, 2);

  // Mutation 3 : déplacement d'un pion sélectionné (mutation composite : pion + sélection)
  moveTokenToCell('hero-1', { a: 3, b: 3 });
  assert.strictEqual(signalCount, 3, 'Une mutation composite émet EXACTEMENT UN signal');

  // Test de désabonnement
  unsubscribe();
  setSelection(null);
  assert.strictEqual(signalCount, 3, 'Après désabonnement, aucun signal n\'est émis');
});

test('setSelection met à jour le pion sélectionné et calcule cellsInRange via GridAdapter', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);

  setSelection('hero-1');

  const state = getState();
  assert.strictEqual(state.selectedTokenId, 'hero-1');
  assert.strictEqual(state.selectedToken?.id, 'hero-1');
  // hero-1 est en {a:2, b:2} avec speedCells: 3. Doit trouver des cases atteignables
  assert.ok(state.reachableCells.size > 0);
  assert.ok(state.reachableCells.has('2,3'));

  // Désélection
  setSelection(null);
  const stateAfter = getState();
  assert.strictEqual(stateAfter.selectedTokenId, null);
  assert.strictEqual(stateAfter.reachableCells.size, 0);
});

test('moveToken déplace le pion et refuse des coordonnées non entières', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);

  // Déplacement valide
  moveTokenToCell('hero-1', { a: 4, b: 4 });
  const token = getState().campaign?.tokens.find((t) => t.id === 'hero-1');
  assert.deepStrictEqual(token?.cell, { a: 4, b: 4 });

  // Coordonnées non entières refusées. Rien à supprimer ici : `{ a: 4.5, b: 4 }` est un
  // `Cell` valide pour le typechecker, c'est bien un refus à l'exécution qu'on vérifie.
  assert.throws(() => {
    moveTokenToCell('hero-1', { a: 4.5, b: 4 });
  }, /cell doit être un Cell avec des coordonnées entières/);

  // Pion inconnu refusé
  assert.throws(() => {
    moveTokenToCell('inconnu', { a: 1, b: 1 });
  }, /Pion inconnu/);
});

test('selectLevel bascule l\'étage actif et désélectionne le pion s\'il n\'est pas sur le nouvel étage', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);

  setSelection('hero-1'); // hero-1 est sur 'rdc'
  assert.strictEqual(getState().selectedTokenId, 'hero-1');

  selectLevel('et1');
  assert.strictEqual(getActiveLevel()?.id, 'et1');
  // hero-1 n'est pas sur et1, il doit être désélectionné
  assert.strictEqual(getState().selectedTokenId, null);

  // Sélectionner hero-2 qui est sur et1
  setSelection('hero-2');
  assert.strictEqual(getSelectedToken()?.id, 'hero-2');

  // Étage inconnu refusé
  assert.throws(() => {
    selectLevel('inconnu');
  }, /Étage inconnu/);
});

test('resetStore vide l\'état, notifie, et conserve les abonnés', () => {
  loadCampaign(makeValidCampaign());

  let signalCount = 0;
  const unsubscribe = subscribe(() => {
    signalCount++;
  });

  resetStore();
  assert.strictEqual(signalCount, 1, 'vider le store est une mutation : elle notifie');
  assert.strictEqual(getState().campaign, null);

  // L'abonnement survit au reset : débrancher un abonné en silence serait un bug invisible.
  loadCampaign(makeValidCampaign());
  assert.strictEqual(signalCount, 2, 'l\'abonné doit encore être branché après un reset');

  unsubscribe();
});

test('setSelectionState refuse bruyamment une sélection sans étage actif', () => {
  const orphelin = createToken({ id: 'orphelin', levelId: 'rdc', cell: { a: 0, b: 0 } });

  // Incohérence d'état, pas cas limite : vider la sélection en silence masquerait la cause.
  assert.throws(() => setSelectionState(orphelin, null), /aucun étage actif/);

  // `null` reste la désélection explicite et légitime.
  setSelectionState(null, null);
  assert.strictEqual(getState().selectedTokenId, null);
});
