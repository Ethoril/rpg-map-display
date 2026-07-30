// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    FirebaseTransport,
    assertNoNestedArrays,
    assertNoTransientAssetUrls,
    decodeSnapshotFromFirestore,
    encodeSnapshotForFirestore,
} from '../js/transport/FirebaseTransport.js';
import { LocalSocketTransport } from '../js/transport/LocalSocketTransport.js';
import {
    checkBuildMismatch,
    clearPresence,
    getPresenceList,
    setPresenceMap,
} from '../js/state/presence.js';

const validConfig = {
    apiKey: 'mock-key',
    authDomain: 'mock.firebaseapp.com',
    databaseURL: 'https://mock.firebaseio.com',
    projectId: 'mock-project',
    appId: 'mock-app',
};

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

test('la garde transport refuse data: et blob: à toute profondeur', async () => {
    const transport = new FirebaseTransport(validConfig);
    const circular = /** @type {any} */ ({ imageUrl: 'https://assets.example/map.webp' });
    circular.self = circular;
    assert.doesNotThrow(() => assertNoTransientAssetUrls(circular));

    assert.throws(
        () => assertNoTransientAssetUrls({ levels: [{ tokens: [{ imageUrl: 'data:image/png;base64,x' }] }] }),
        /data:.*levels.*tokens.*imageUrl/
    );
    assert.throws(
        () => assertNoTransientAssetUrls({ nested: ['BLOB:https://example.invalid/id'] }),
        /BLOB:|blob:/i
    );

    // La garde est bien placée sur les deux frontières, avant tout appel SDK.
    transport._db = /** @type {any} */ ({});
    transport._sessionId = 'session-test';
    assert.throws(
        () => transport.publish({
            type: 'level.add',
            payload: { level: { imageUrl: 'data:image/webp;base64,x' } },
            at: Date.now(),
            by: 'gm',
        }),
        /URL transitoire interdite/
    );
    await assert.rejects(
        transport.saveSnapshot({ tokens: [{ imageUrl: 'blob:https://example.invalid/id' }] }),
        /URL transitoire interdite/
    );
});

test('les murs traversent Firestore enrobés, et reviennent identiques', () => {
    const walls = [
        [{ cellX: 0, cellY: 0 }, { cellX: 1, cellY: 0 }],
        [{ cellX: 1, cellY: 0 }, { cellX: 1.5, cellY: 2 }],
    ];
    const snapshot = {
        campaign: {
            schemaVersion: 2,
            levels: [
                { id: 'rdc', walls, portals: [], lights: [] },
                { id: 'etage', walls: [] },
            ],
            tokens: [{ id: 'pion-1', markers: ['poison'] }],
        },
        activeLevelId: 'rdc',
    };
    const original = structuredClone(snapshot);

    const encode = encodeSnapshotForFirestore(snapshot);

    // Ce que Firestore reçoit : plus aucun tableau dans un tableau.
    assert.deepEqual(encode.campaign.levels[0].walls, [
        { points: walls[0] },
        { points: walls[1] },
    ]);
    assert.deepEqual(encode.campaign.levels[1].walls, []);
    assert.doesNotThrow(() => assertNoNestedArrays(encode, 'snapshot'));

    // Un tableau de chaînes dans un objet reste licite : ne pas enrober au-delà du besoin.
    assert.deepEqual(encode.campaign.tokens[0].markers, ['poison']);

    // L'instantané de l'appelant n'est pas muté : ce sont les objets vivants du store.
    assert.deepEqual(snapshot, original);

    // Aller-retour complet, et tolérance à la forme native d'un document antérieur.
    assert.deepEqual(decodeSnapshotFromFirestore(encode), original);
    assert.deepEqual(decodeSnapshotFromFirestore(structuredClone(original)), original);

    // Campagne nue, sans enveloppe : les deux formes acceptées par restoreFromSnapshot.
    const nue = encodeSnapshotForFirestore({ levels: [{ id: 'rdc', walls }] });
    assert.deepEqual(nue.levels[0].walls, [{ points: walls[0] }, { points: walls[1] }]);
    assert.deepEqual(decodeSnapshotFromFirestore(nue), { levels: [{ id: 'rdc', walls }] });
});

test('la garde Firestore nomme le chemin du tableau imbriqué', () => {
    const circulaire = /** @type {any} */ ({ levels: [{ id: 'rdc' }] });
    circulaire.self = circulaire;
    assert.doesNotThrow(() => assertNoNestedArrays(circulaire));

    assert.throws(
        () => assertNoNestedArrays({ campaign: { levels: [{ walls: [[{ cellX: 0, cellY: 0 }]] }] } }),
        /tableau imbriqué.*campaign.*levels.*\[0\].*walls.*\[0\]/
    );
    assert.throws(() => assertNoNestedArrays([[1]], 'payload'), /^Error: payload contient/);
});

test('saveSnapshot refuse un tableau imbriqué et accepte des murs de carte réelle', async () => {
    const transport = new FirebaseTransport(validConfig);
    transport._sessionId = 'session-murs';

    // La garde est placée avant toute écriture, donc observable sans Firestore : un champ
    // que Firestore refuserait est refusé ici, avec son chemin.
    await assert.rejects(
        transport.saveSnapshot({ campaign: { levels: [{ id: 'rdc', walls: [[[1]]] }] } }),
        /tableau imbriqué.*walls/
    );

    // Un instantané de carte ordinaire, lui, franchit la garde : c'est précisément le cas
    // qui échouait — « Nested arrays are not supported » à la pose d'une carte.
    const walls = [[{ cellX: 0, cellY: 0 }, { cellX: 2, cellY: 0 }]];
    await transport.saveSnapshot({ campaign: { levels: [{ id: 'rdc', walls }] } });
});

test('isOwnEvent identifie un écho sans casser les anciens NetEvent', () => {
    const transport = new FirebaseTransport(validConfig);
    transport._clientId = 'client-local';
    assert.equal(transport.isOwnEvent(/** @type {any} */ ({ clientId: 'client-local' })), true);
    assert.equal(transport.isOwnEvent(/** @type {any} */ ({ clientId: 'autre-client' })), false);
    assert.equal(transport.isOwnEvent(/** @type {any} */ ({ type: 'ancien-format' })), false);
});

test('le store de présence ignore les entrées invalides, expirées et le client local', () => {
    clearPresence();
    const now = Date.now();
    setPresenceMap({
        self: { role: 'gm', at: now, build: 34, label: '0.1.0+34' },
        tablet: { role: 'players', at: now, build: 35, label: '0.1.0+35' },
        expired: { role: 'players', at: now - 120_000, build: 99, label: 'ancienne' },
        malformed: /** @type {any} */ ({ role: 'admin', at: now, build: '35', label: 'x' }),
    });

    assert.deepEqual(getPresenceList().map((presence) => presence.clientId).sort(), ['self', 'tablet']);
    assert.equal(checkBuildMismatch(34, 'self').remoteBuild, 35);
    clearPresence();
});

test('LocalSocketTransport lève systématiquement "non implémenté"', async () => {
    const local = new LocalSocketTransport();

    await assert.rejects(async () => await local.connect('s1', 'gm'), /LocalSocketTransport non implémenté/);
    assert.throws(() => local.publish({ type: 'test', payload: {}, at: Date.now(), by: 'gm' }), /LocalSocketTransport non implémenté/);
    assert.throws(() => local.subscribe(() => {}), /LocalSocketTransport non implémenté/);
    await assert.rejects(async () => await local.snapshot(), /LocalSocketTransport non implémenté/);
    assert.throws(() => local.disconnect(), /LocalSocketTransport non implémenté/);
});
