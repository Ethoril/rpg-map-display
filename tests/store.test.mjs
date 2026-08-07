// @ts-check

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

import {
  loadCampaign,
  selectLevel,
  setSelection,
  moveTokenToCell,
  resetStore,
  subscribe,
  getState,
  getRenderSnapshot,
  getCampaign,
  getActiveLevel,
  getSelectedToken,
  setSessionId,
  saveToLocalStorage,
  loadFromLocalStorage,
  restoreFromSnapshot,
  addToken,
  addLevel,
  updateActiveLevel,
  updateLevel,
  updateToken,
  removeToken,
  setSessionFog,
  getSessionFog,
  getLastPersistenceError,
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

test('getRenderSnapshot partage une version figée, puis la remplace après mutation', () => {
  loadCampaign(makeValidCampaign());
  setSelection('hero-1');

  const first = getRenderSnapshot();
  const sameFrameData = getRenderSnapshot();
  assert.strictEqual(first, sameFrameData, 'une animation relit le même instantané');
  const firstCampaign = first.campaign;
  assert.ok(firstCampaign);
  assert.strictEqual(first.activeLevel, firstCampaign.levels[0]);
  assert.strictEqual(first.selectedToken, firstCampaign.tokens[0]);

  assert.throws(() => {
    firstCampaign.tokens[0].cell.a = 99;
  }, TypeError, 'le renderer ne peut pas muter la campagne partagée');
  assert.throws(() => {
    first.reachableCells.set('99,99', 1);
  }, TypeError, 'le renderer ne peut pas muter la Map partagée');

  moveTokenToCell('hero-1', { a: 3, b: 3 });
  const next = getRenderSnapshot();
  assert.notStrictEqual(next, first, 'une mutation publie une nouvelle version au rendu');
  assert.notStrictEqual(next.campaign, first.campaign, 'la campagne est partagée par version');
  assert.deepStrictEqual(next.selectedToken?.cell, { a: 3, b: 3 });
  assert.deepStrictEqual(first.selectedToken?.cell, { a: 2, b: 2 });
});

test('MESURE R2-01 — le snapshot de rendu testbig150 reste sous 2 ms par image', () => {
  const scene = JSON.parse(fs.readFileSync('maps/generated/testbig150.scene.json', 'utf8'));
  loadCampaign(scene);

  // Chauffe la construction du premier instantané et les accès aux propriétés réellement lues
  // par `renderAll`. Le banc mesure ensuite l'accès stable, pas l'import ou la validation qui
  // sont hors du chemin d'une image.
  let checksum = 0;
  for (let i = 0; i < 100; i++) {
    const snapshot = getRenderSnapshot();
    checksum +=
      (snapshot.activeLevel?.walls.length ?? 0) +
      (snapshot.campaign?.tokens.length ?? 0) +
      snapshot.reachableCells.size;
  }

  const batchMeans = [];
  const batches = 9;
  const framesPerBatch = 1_000;
  for (let batch = 0; batch < batches; batch++) {
    const start = performance.now();
    for (let frame = 0; frame < framesPerBatch; frame++) {
      const snapshot = getRenderSnapshot();
      checksum +=
        (snapshot.activeLevel?.walls.length ?? 0) +
        (snapshot.campaign?.tokens.length ?? 0) +
        snapshot.reachableCells.size;
    }
    batchMeans.push((performance.now() - start) / framesPerBatch);
  }
  batchMeans.sort((a, b) => a - b);
  const medianMs = batchMeans[Math.floor(batchMeans.length / 2)];
  const worstMs = batchMeans[batchMeans.length - 1];

  assert.ok(checksum > 0, 'empêche une mesure sans lecture effective des données de rendu');
  assert.ok(
    worstMs < 2,
    `snapshot de rendu trop lent sur testbig150 : médiane ${medianMs.toFixed(4)} ms, pire ${worstMs.toFixed(4)} ms`
  );
  console.log(
    `[R2-01] testbig150 — accès snapshot: médiane ${medianMs.toFixed(4)} ms/image, pire ${worstMs.toFixed(4)} ms/image (${batches}×${framesPerBatch})`
  );
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

test('restoreFromSnapshot et persistance LocalStorage (T-24)', () => {
  const camp = makeValidCampaign();
  camp.levels[0].imageUrl = 'maps/rdc.webp';
  camp.tokens[0].imageUrl = 'https://cdn.example.test/hero.webp';

  // 1. Restauration d'un snapshot direct
  restoreFromSnapshot(camp, { sessionId: 'test-session-1', activeLevelId: 'et1' });
  const state = getState();
  assert.strictEqual(state.campaign?.campaignId, 'camp-test');
  assert.strictEqual(state.activeLevelId, 'et1');

  // 2. Restauration à partir d'un conteneur avec session
  restoreFromSnapshot(
    {
      campaign: camp,
      activeLevelId: 'rdc',
    },
    { sessionId: 'test-session-1' }
  );

  assert.strictEqual(getState().activeLevelId, 'rdc');

  // 3. Charger depuis LocalStorage
  const loaded = loadFromLocalStorage('test-session-1');
  assert.strictEqual(loaded, true);
  assert.strictEqual(getState().campaign?.campaignId, 'camp-test');
  assert.strictEqual(getState().activeLevelId, 'rdc');
  assert.strictEqual(getState().campaign?.levels[0].imageUrl, 'maps/rdc.webp');
  assert.strictEqual(
    getState().campaign?.tokens[0].imageUrl,
    'https://cdn.example.test/hero.webp'
  );
});

test('addToken valide toute la campagne et ne modifie pas l’état en cas de refus', () => {
  loadCampaign(makeValidCampaign());
  const before = getCampaign();

  assert.throws(
    () =>
      addToken(
        createToken({
          id: 'orphelin',
          levelId: 'niveau-inconnu',
          cell: { a: 0, b: 0 },
        })
      ),
    /levelId inconnu/
  );
  assert.deepStrictEqual(getCampaign(), before);

  assert.throws(
    () =>
      addToken(
        /** @type {any} */ ({
          id: 'incomplet',
          levelId: 'rdc',
          cell: { a: 0, b: 0 },
          sizeCells: 1,
          kind: 'pc',
          imageUrl: '',
        })
      ),
    /objet non conforme au schéma Token/
  );
  assert.deepStrictEqual(getCampaign(), before);

  assert.throws(
    () =>
      addToken(
        createToken({
          id: 'hero-1',
          levelId: 'rdc',
          cell: { a: 0, b: 0 },
        })
      ),
    /Identifiant de pion dupliqué/
  );
  assert.deepStrictEqual(getCampaign(), before);

  assert.throws(
    () =>
      addToken(
        createToken({
          id: 'hors-limites',
          levelId: 'rdc',
          cell: { a: 39, b: 29 },
          sizeCells: 2,
        })
      ),
    /position hors limites/
  );
  assert.deepStrictEqual(getCampaign(), before);
});

test('addLevel et updateActiveLevel valident avant mutation', () => {
  loadCampaign(makeValidCampaign());
  const before = getCampaign();

  assert.throws(
    () =>
      addLevel(
        createLevel({
          id: 'asset-temporaire',
          imageUrl: 'data:image/png;base64,AAAA',
        })
      ),
    /imageUrl non persistable/
  );
  assert.deepStrictEqual(getCampaign(), before);

  assert.throws(
    () => updateActiveLevel({ widthCells: 1 }),
    /position hors limites/
  );
  assert.deepStrictEqual(getCampaign(), before);
});

test('updateLevel cible un étage non actif de façon transactionnelle', () => {
  loadCampaign(makeValidCampaign());
  assert.strictEqual(getState().activeLevelId, 'rdc');

  updateLevel('et1', { name: 'Étage distant', grid: { color: '#123456' } });
  const state = getState();
  assert.strictEqual(state.activeLevelId, 'rdc');
  assert.strictEqual(state.campaign?.levels.find((level) => level.id === 'et1')?.name, 'Étage distant');
  assert.strictEqual(
    state.campaign?.levels.find((level) => level.id === 'et1')?.grid.color,
    '#123456'
  );

  const before = getCampaign();
  assert.throws(() => updateLevel('inconnu', { name: 'Impossible' }), /Étage inconnu/);
  assert.deepStrictEqual(getCampaign(), before);
  assert.throws(() => updateLevel('et1', { id: 'renommé' }), /identifiant ne peut pas être modifié/);
  assert.deepStrictEqual(getCampaign(), before);
});

test('moveTokenToCell refuse une destination hors limites sans altérer le pion', () => {
  loadCampaign(makeValidCampaign());
  const before = getCampaign();

  assert.throws(
    () => moveTokenToCell('hero-1', { a: -1, b: 0 }),
    /position hors limites/
  );
  assert.deepStrictEqual(getCampaign(), before);
});

test('une campagne contenant une data URL est refusée avant chargement ou sauvegarde', () => {
  const valid = makeValidCampaign();
  loadCampaign(valid);
  const before = getCampaign();

  const invalid = makeValidCampaign();
  invalid.levels[0].imageUrl = 'data:image/png;base64,AAAA';
  assert.throws(() => loadCampaign(invalid), /imageUrl non persistable/);
  assert.deepStrictEqual(getCampaign(), before);

  // L’état valide précédent reste sauvegardable sans transformation silencieuse.
  setSessionId('persistable-assets');
  assert.doesNotThrow(() => saveToLocalStorage());
});

test('Une campagne héritée contenant un ARGB est chargée après conversion et pas refusée', () => {
  const camp = makeValidCampaign();
  // Couleurs volontairement au format ARGB hérité, non conforme au modèle : le point du
  // test est que le chargement les convertisse au lieu de refuser la campagne. Aucun
  // `@ts-ignore` n'est nécessaire ici — `color` est typé `string` — et il serait interdit
  // (`CONVENTIONS.md` §8 n°16).
  camp.levels[0].lights.push({
    id: 'legacy-light',
    at: { cellX: 1, cellY: 1 },
    range: 5,
    intensity: 2.5,
    color: 'ffffffff',
    shadows: true,
  });
  camp.levels[0].ambient.color = 'ffF7EAE4';

  assert.doesNotThrow(() => {
    loadCampaign(camp);
  });

  const state = getState();
  const loadedLight = state.campaign?.levels[0].lights.find((l) => l.id === 'legacy-light');
  assert.equal(loadedLight?.color, '#ffffff');
  assert.equal(state.campaign?.levels[0].ambient.color, '#F7EAE4');
});

test('updateToken modifie l elevation et valide la campagne entiere', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);

  updateToken('hero-1', { elevation: 5 });

  const state = getState();
  const token = state.campaign?.tokens.find((t) => t.id === 'hero-1');
  assert.strictEqual(token?.elevation, 5);
});

test('updateToken refuse un pion inconnu et laisse le store intact', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);
  const stateBefore = getState();

  assert.throws(() => {
    updateToken('inconnu-99', { elevation: 3 });
  }, /Pion inconnu/);

  assert.deepStrictEqual(getState(), stateBefore);
});

test('updateToken refuse les champs hors liste blanche (cell, levelId, id, imageUrl, etc.) en nommant le champ', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);
  const stateBefore = getState();

  // Ces champs sont bien du type `Partial<Token>`, donc le typage les accepte : c'est le
  // refus **à l'exécution** qui est vérifié, la liste blanche vivant dans le store et non
  // dans le type. D'où aucune suppression de vérification, interdite par §8 n°16.
  assert.throws(() => {
    updateToken('hero-1', { cell: { a: 9, b: 9 } });
  }, /champ non autorisé "cell"/);

  assert.throws(() => {
    updateToken('hero-1', { levelId: 'et1' });
  }, /champ non autorisé "levelId"/);

  assert.throws(() => {
    updateToken('hero-1', { id: 'autre-id' });
  }, /champ non autorisé "id"/);

  assert.throws(() => {
    updateToken('hero-1', { imageUrl: 'https://example.com/img.png' });
  }, /champ non autorisé "imageUrl"/);

  assert.deepStrictEqual(getState(), stateBefore);
});

test('updateToken ne mute rien si la campagne candidate est invalide (elevation NaN / non finie)', () => {
  const camp = makeValidCampaign();
  loadCampaign(camp);
  const stateBefore = getState();

  assert.throws(() => {
    updateToken('hero-1', { elevation: Infinity });
  });

  assert.deepStrictEqual(getState(), stateBefore);
});

test('updateToken accepte les champs d’édition du pion, et les applique ensemble', () => {
  loadCampaign(makeValidCampaign());

  updateToken('hero-1', {
    label: 'Ranger',
    kind: 'npc',
    borderColor: '#00ff00',
    sizeCells: 2,
    speedCells: 5,
    hidden: true,
    playerMovable: false,
    locked: true,
    visionBright: 7,
    visionDim: 14,
    markers: ['prone'],
  });

  const token = getCampaign()?.tokens.find((t) => t.id === 'hero-1');
  assert.equal(token?.label, 'Ranger');
  assert.equal(token?.kind, 'npc');
  assert.equal(token?.borderColor, '#00ff00');
  assert.equal(token?.sizeCells, 2);
  assert.equal(token?.speedCells, 5);
  assert.equal(token?.hidden, true);
  assert.equal(token?.playerMovable, false);
  assert.equal(token?.locked, true);
  assert.equal(token?.visionBright, 7);
  assert.equal(token?.visionDim, 14);
  assert.deepEqual(token?.markers, ['prone']);

  // La position et l'identité restent hors d'atteinte d'un patch.
  assert.deepEqual(token?.cell, { a: 2, b: 2 });
  assert.equal(token?.levelId, 'rdc');
});

test('updateToken refuse un agrandissement qui sort le pion de l’étage, sans rien muter', () => {
  const camp = makeValidCampaign();
  // 40x30 cases : un pion 4x4 posé en (38,28) dépasserait la bordure.
  camp.tokens[0].cell = { a: 38, b: 28 };
  loadCampaign(camp);
  const stateBefore = getState();

  assert.throws(() => updateToken('hero-1', { sizeCells: 4 }), /hors limites/);
  assert.deepStrictEqual(getState(), stateBefore);
});

test('removeToken supprime le pion, désélectionne, et refuse un identifiant inconnu', () => {
  loadCampaign(makeValidCampaign());
  setSelection('hero-1');
  assert.equal(getState().selectedTokenId, 'hero-1');

  let notifications = 0;
  const unsubscribe = subscribe(() => {
    notifications += 1;
  });

  removeToken('hero-1');

  assert.equal(notifications, 1, 'La suppression notifie exactement une fois');
  assert.equal(getCampaign()?.tokens.length, 1);
  assert.equal(getCampaign()?.tokens.some((t) => t.id === 'hero-1'), false);
  // Supprimer le pion sélectionné doit vider la sélection : la garder pointerait sur un
  // pion absent, et la zone de déplacement resterait affichée dans le vide.
  assert.equal(getState().selectedTokenId, null);

  unsubscribe();

  const stateBefore = getState();
  assert.throws(() => removeToken('hero-1'), /Pion inconnu/);
  assert.throws(() => removeToken('jamais-existé'), /Pion inconnu/);
  assert.deepStrictEqual(getState(), stateBefore);
});

test('une panne de stockage du masque de fog est consignée, jamais avalée (CONVENTIONS §6)', () => {
  const descripteurOrigine = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const warnOrigine = console.warn;
  /** @type {string[]} */
  const avertissements = [];

  setSessionId('sess-fog-quota');

  // Stockage qui refuse tout, comme un quota dépassé ou une navigation privée. C'est le seul
  // cas que les `catch` d'avant pouvaient attraper, `getStorage()` ne rendant jamais `null`.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        throw new Error('SecurityError simulee');
      },
      setItem() {
        throw new Error('QuotaExceededError simulee');
      },
      removeItem() {
        throw new Error('QuotaExceededError simulee');
      },
    },
  });
  console.warn = (/** @type {any[]} */ ...args) => {
    avertissements.push(args.join(' '));
  };

  try {
    // Écriture : la séance continue sur la carte mémoire — publier aux tablettes ne doit
    // jamais dépendre du stockage local — mais la panne est consignée et journalisée.
    assert.doesNotThrow(() => setSessionFog('etage-ecriture', 'QQAA'));
    assert.equal(getSessionFog('etage-ecriture'), 'QQAA');

    // Lecture : cet étage n'est pas en mémoire, donc le stockage est réellement interrogé.
    assert.equal(getSessionFog('etage-lecture'), null);

    assert.ok(getLastPersistenceError(), 'la panne doit être consignée pour la vue MJ');

    // Consignée ET bruyante : c'est ce que le §6 exige, et ce que les `catch` vides
    // supprimaient. On vérifie le **contenu** des journaux et non leur nombre : la
    // sauvegarde automatique de `notifySubscribers` échoue elle aussi sous ce stockage, et
    // `lastPersistenceError` n'a qu'une case — le dernier écrit gagne. C'est le journal, pas
    // cette case, qui prouve qu'aucune des deux pannes n'est passée sous silence.
    assert.ok(
      avertissements.some((m) => /écriture/.test(m) && /etage-ecriture/.test(m)),
      `panne d'écriture non journalisée. Journaux : ${JSON.stringify(avertissements)}`
    );
    assert.ok(
      avertissements.some((m) => /lecture/.test(m) && /etage-lecture/.test(m)),
      `panne de lecture non journalisée. Journaux : ${JSON.stringify(avertissements)}`
    );
  } finally {
    console.warn = warnOrigine;
    if (descripteurOrigine) {
      Object.defineProperty(globalThis, 'localStorage', descripteurOrigine);
    } else {
      delete (/** @type {any} */ (globalThis).localStorage);
    }
    // `resetStore()` ne remet pas l'identifiant de session à zéro : sans cette ligne, un test
    // ajouté après celui-ci hériterait d'une sauvegarde automatique active.
    setSessionId(null);
  }
});
