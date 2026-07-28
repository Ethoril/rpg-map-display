// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FirebaseTransport } from '../js/transport/FirebaseTransport.js';
import { LocalSocketTransport } from '../js/transport/LocalSocketTransport.js';

test('FirebaseTransport exige une configuration valide à la construction', () => {
    // Config absente
    const invalidConfigNull = /** @type {any} */ (null);
    assert.throws(() => new FirebaseTransport(invalidConfigNull), /Configuration Firebase absente/);

    const invalidConfigStr = /** @type {any} */ ('invalide');
    assert.throws(() => new FirebaseTransport(invalidConfigStr), /Configuration Firebase absente/);

    // Config incomplète
    const configIncomplete = /** @type {any} */ ({
        apiKey: 'key',
        authDomain: 'domain',
        databaseURL: 'url',
        // projectId manquant
        appId: 'app',
    });
    assert.throws(() => new FirebaseTransport(configIncomplete), /champ projectId manquant/);
});

test('FirebaseTransport valide les arguments de connect et le statut de connexion', async () => {
    const validConfig = {
        apiKey: 'mock-key',
        authDomain: 'mock.firebaseapp.com',
        databaseURL: 'https://mock.firebaseio.com',
        projectId: 'mock-project',
        appId: 'mock-app',
    };
    const transport = new FirebaseTransport(validConfig);

    // Tentatives d'opérations avant connect
    assert.throws(() => transport.publish({ type: 'token.move', payload: {}, at: Date.now(), by: 'gm' }), /Transport non connecté/);
    await assert.rejects(async () => await transport.snapshot(), /Transport non connecté/);
    await assert.rejects(async () => await transport.saveSnapshot({}), /Transport non connecté/);

    // Arguments invalides pour connect
    const emptySession = /** @type {any} */ ('');
    await assert.rejects(async () => await transport.connect(emptySession, 'gm'), /sessionId manquant/);

    const invalidRole = /** @type {any} */ ('admin');
    await assert.rejects(async () => await transport.connect('session-1', invalidRole), /role invalide/);
});

test('LocalSocketTransport lève systématiquement "non implémenté"', async () => {
    const local = new LocalSocketTransport();

    await assert.rejects(async () => await local.connect('s1', 'gm'), /LocalSocketTransport non implémenté/);
    assert.throws(() => local.publish({ type: 'test', payload: {}, at: Date.now(), by: 'gm' }), /LocalSocketTransport non implémenté/);
    assert.throws(() => local.subscribe(() => {}), /LocalSocketTransport non implémenté/);
    await assert.rejects(async () => await local.snapshot(), /LocalSocketTransport non implémenté/);
    assert.throws(() => local.disconnect(), /LocalSocketTransport non implémenté/);
});
