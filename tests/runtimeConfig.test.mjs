// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFirebaseConfig, saveFirebaseConfig } from '../js/app/runtimeConfig.js';

/**
 * Résolution et persistance de la configuration Firebase publique.
 *
 * Deux raisons de couvrir ce module, et aucune n'est visible depuis le reste de la suite :
 *
 * 1. **Un défaut ici ne fait rougir aucun test, il casse un démarrage de séance.** La
 *    configuration est lue avant tout le reste ; mal résolue, l'application ne se connecte
 *    pas, et le symptôme à la table est « ça ne marche plus » sans autre indice.
 * 2. ⭐ **Le module a un devoir de confidentialité.** `testEmail` et `testPassword` sont les
 *    identifiants du compte technique de la CI. Le mainteneur colle parfois le JSON complet
 *    dans `diag.html` : ils ne doivent alors ni entrer dans le runtime, ni être réécrits dans
 *    le stockage local de la tablette. Rien ne le vérifiait.
 */

const COMPLETE = {
  apiKey: 'AIzaSyFAUX',
  authDomain: 'exemple.firebaseapp.com',
  databaseURL: 'https://exemple.firebaseio.com',
  projectId: 'exemple',
  appId: '1:2:web:3',
};

const CHAMPS_REQUIS = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];

/** Stockage local factice, avec le minimum que le module utilise. */
function fakeStorage(initial = {}) {
  /** @type {Record<string, string>} */
  const data = { ...initial };
  return {
    data,
    getItem: (/** @type {string} */ k) => (k in data ? data[k] : null),
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => { data[k] = v; },
  };
}

/**
 * Installe un environnement navigateur factice pour la durée d'un appel.
 *
 * ⚠ `globalThis.localStorage` peut exister nativement selon la version de Node : on restaure
 * le descripteur d'origine plutôt que de supposer qu'il était absent.
 *
 * @template T
 * @param {{ window?: any, storage?: any }} env
 * @param {() => T} fn
 * @returns {T}
 */
function avecEnvironnement(env, fn) {
  const avant = {
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };
  const poser = (/** @type {string} */ nom, /** @type {any} */ valeur) => {
    if (valeur === undefined) delete /** @type {any} */ (globalThis)[nom];
    else Object.defineProperty(globalThis, nom, { value: valeur, configurable: true, writable: true });
  };
  poser('window', env.window);
  poser('localStorage', env.storage);
  try {
    return fn();
  } finally {
    for (const [nom, desc] of Object.entries(avant)) {
      delete /** @type {any} */ (globalThis)[nom];
      if (desc) Object.defineProperty(globalThis, nom, desc);
    }
  }
}

test('la configuration injectée gagne sur tout le reste', () => {
  const injectee = { ...COMPLETE, projectId: 'injecte' };
  const resolue = avecEnvironnement(
    {
      window: { RPG_FIREBASE_CONFIG: { ...COMPLETE, projectId: 'global' } },
      storage: fakeStorage({ 'rpg-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'stocke' }) }),
    },
    () => resolveFirebaseConfig(injectee)
  );
  assert.equal(resolue?.projectId, 'injecte');
});

test('à défaut d’injection, `window.RPG_FIREBASE_CONFIG` passe avant le stockage local', () => {
  const resolue = avecEnvironnement(
    {
      window: { RPG_FIREBASE_CONFIG: { ...COMPLETE, projectId: 'global' } },
      storage: fakeStorage({ 'rpg-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'stocke' }) }),
    },
    () => resolveFirebaseConfig(null)
  );
  assert.equal(resolue?.projectId, 'global');
});

test('la clé du diagnostic est un recours, pas la source principale', () => {
  // Les deux clés existent : `rpg-firebase-config` doit l'emporter. L'ordre compte, parce que
  // la clé du diagnostic peut porter une configuration collée à la main pour un essai ponctuel.
  const resolue = avecEnvironnement(
    {
      window: {},
      storage: fakeStorage({
        'rpg-diag-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'diag' }),
        'rpg-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'principal' }),
      }),
    },
    () => resolveFirebaseConfig(null)
  );
  assert.equal(resolue?.projectId, 'principal');

  const seulementDiag = avecEnvironnement(
    {
      window: {},
      storage: fakeStorage({
        'rpg-diag-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'diag' }),
      }),
    },
    () => resolveFirebaseConfig(null)
  );
  assert.equal(seulementDiag?.projectId, 'diag', 'la clé du diagnostic doit tout de même servir');
});

test('⭐ les identifiants du compte technique n’entrent jamais dans le runtime', () => {
  const avecSecrets = { ...COMPLETE, testEmail: 'ci@exemple.test', testPassword: 'motdepasse' };
  const resolue = avecEnvironnement({ window: {}, storage: undefined }, () =>
    resolveFirebaseConfig(avecSecrets)
  );
  assert.ok(resolue);
  assert.equal('testEmail' in resolue, false, 'testEmail a fui dans la configuration résolue');
  assert.equal('testPassword' in resolue, false, 'testPassword a fui dans la configuration résolue');
  // Le reste doit passer intact, y compris les champs optionnels que le module ne connaît pas.
  assert.equal(resolue.projectId, COMPLETE.projectId);
});

test('⭐ les identifiants du compte technique ne sont jamais écrits dans le stockage', () => {
  // Le cas réel : le mainteneur colle dans `diag.html` le JSON destiné à la CI. Ce qui atterrit
  // sur la tablette ne doit pas contenir de mot de passe — un stockage local se lit.
  const storage = fakeStorage();
  const persistee = avecEnvironnement({ window: {}, storage }, () =>
    saveFirebaseConfig({ ...COMPLETE, testEmail: 'ci@exemple.test', testPassword: 'motdepasse' })
  );

  const brut = storage.data['rpg-firebase-config'];
  assert.ok(brut, 'rien n’a été persisté');
  assert.equal(brut.includes('motdepasse'), false, 'le mot de passe a été écrit sur l’appareil');
  assert.equal(brut.includes('ci@exemple.test'), false, 'l’adresse technique a été écrite sur l’appareil');
  assert.equal('testPassword' in persistee, false);
  // La valeur rendue est réutilisable telle quelle, sans que l'appelant retouche son objet.
  assert.deepEqual(JSON.parse(brut), persistee);
});

test('l’objet de l’appelant n’est pas modifié par la persistance', () => {
  const source = { ...COMPLETE, testPassword: 'motdepasse' };
  avecEnvironnement({ window: {}, storage: fakeStorage() }, () => saveFirebaseConfig(source));
  assert.equal(source.testPassword, 'motdepasse', 'la source a été mutée');
});

test('un champ requis manquant ou vide rend la configuration inutilisable', () => {
  for (const champ of CHAMPS_REQUIS) {
    const sansLeChamp = { ...COMPLETE };
    delete /** @type {any} */ (sansLeChamp)[champ];
    const vide = { ...COMPLETE, [champ]: '' };
    // ⛔ Une configuration partielle doit être refusée, pas complétée : Firebase échouerait
    // plus tard, ailleurs, avec un message qui ne désigne pas la cause.
    avecEnvironnement({ window: {}, storage: undefined }, () => {
      assert.equal(resolveFirebaseConfig(sansLeChamp), null, `${champ} manquant accepté`);
      assert.equal(resolveFirebaseConfig(vide), null, `${champ} vide accepté`);
    });
    avecEnvironnement({ window: {}, storage: fakeStorage() }, () => {
      assert.throws(() => saveFirebaseConfig(vide), /Configuration Firebase invalide/);
    });
  }
});

test('une valeur locale illisible est ignorée, et la clé suivante est tout de même lue', () => {
  // Un stockage corrompu — onglet tué en pleine écriture, quota atteint — ne doit pas faire
  // échouer le démarrage : c'est une absence de configuration, pas une erreur fatale.
  const resolue = avecEnvironnement(
    {
      window: {},
      storage: fakeStorage({
        'rpg-firebase-config': '{ceci n’est pas du JSON',
        'rpg-diag-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'recours' }),
      }),
    },
    () => resolveFirebaseConfig(null)
  );
  assert.equal(resolue?.projectId, 'recours');
});

test('du JSON valide mais incomplet ne bloque pas la clé suivante', () => {
  const resolue = avecEnvironnement(
    {
      window: {},
      storage: fakeStorage({
        'rpg-firebase-config': JSON.stringify({ apiKey: 'seul' }),
        'rpg-diag-firebase-config': JSON.stringify({ ...COMPLETE, projectId: 'recours' }),
      }),
    },
    () => resolveFirebaseConfig(null)
  );
  assert.equal(resolue?.projectId, 'recours');
});

test('aucune source : la résolution rend null sans jeter', () => {
  assert.equal(
    avecEnvironnement({ window: undefined, storage: undefined }, () => resolveFirebaseConfig(null)),
    null
  );
  assert.equal(
    avecEnvironnement({ window: {}, storage: fakeStorage() }, () => resolveFirebaseConfig(undefined)),
    null
  );
});

test('une valeur qui n’est pas un objet est refusée sans jeter', () => {
  avecEnvironnement({ window: {}, storage: undefined }, () => {
    for (const candidat of ['une chaîne', 42, true, [], null]) {
      assert.equal(resolveFirebaseConfig(/** @type {any} */ (candidat)), null, `accepté : ${candidat}`);
    }
  });
});

test('sans stockage local, la persistance échoue en le disant', () => {
  // Navigation privée ou stockage refusé : le message doit nommer la cause, sinon le
  // diagnostic à la table part sur le réseau.
  avecEnvironnement({ window: {}, storage: undefined }, () => {
    assert.throws(() => saveFirebaseConfig(COMPLETE), /LocalStorage indisponible/);
  });
});
