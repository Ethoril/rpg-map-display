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
import { TOKEN_IMAGE_MAX_BYTES } from '../js/core/schema.js';
import {
    checkBuildMismatch,
    listBuildMismatches,
    listOtherGmClients,
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

test('la garde transport refuse blob: et les images embarquées non bornées, à toute profondeur', async () => {
    const transport = new FirebaseTransport(validConfig);
    const circular = /** @type {any} */ ({ imageUrl: 'https://assets.example/map.webp' });
    circular.self = circular;
    assert.doesNotThrow(() => assertNoTransientAssetUrls(circular));

    // `blob:` est refusé sans condition : il est lié au document qui l'a créé et ne
    // survit ni au rechargement ni au voyage vers un autre navigateur.
    assert.throws(
        () => assertNoTransientAssetUrls({ nested: ['BLOB:https://example.invalid/id'] }),
        /BLOB:|blob:/i
    );

    // Une image embarquée BORNÉE passe la garde. C'est l'amendement délibéré qui permet
    // à un pion de naître en séance : elle porte ses octets, donc elle survit, et son
    // plafond protège le document Firestore.
    assert.doesNotThrow(
        () => assertNoTransientAssetUrls({ tokens: [{ imageUrl: 'data:image/webp;base64,AAAA' }] })
    );

    // Non bornée : refusée, et la garde nomme la taille et le chemin.
    const enorme = `data:image/png;base64,${'A'.repeat(TOKEN_IMAGE_MAX_BYTES)}`;
    assert.throws(
        () => assertNoTransientAssetUrls({ levels: [{ tokens: [{ imageUrl: enorme }] }] }),
        /image embarquée non bornée.*levels.*tokens.*imageUrl/s
    );

    // Un format hors liste reste refusé même court : `data:` n'est pas un blanc-seing.
    assert.throws(
        () => assertNoTransientAssetUrls({ imageUrl: 'data:text/html;base64,AAAA' }),
        /image embarquée non bornée/
    );

    // La garde est bien placée sur les deux frontières, avant tout appel SDK.
    transport._db = /** @type {any} */ ({});
    transport._sessionId = 'session-test';
    assert.throws(
        () => transport.publish({
            type: 'level.add',
            payload: { level: { imageUrl: enorme } },
            at: Date.now(),
            by: 'gm',
        }),
        /image embarquée non bornée/
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

test('une présence datée dans le futur se périme au lieu de survivre indéfiniment', () => {
    clearPresence();
    const now = Date.now();
    // Le cas réel : `at` était écrit avec l'horloge du client. Une tablette en avance de
    // dix minutes produisait un âge négatif, la borne `now - at <= 90 s` était satisfaite,
    // et l'écran éteint continuait d'annoncer sa build — alerte d'écart inextinguible.
    setPresenceMap({
        fantome: { role: 'players', at: now + 600_000, build: 90, label: '0.1.0+90' },
        vivant: { role: 'players', at: now, build: 93, label: '0.1.0+93' },
    });

    assert.deepEqual(getPresenceList().map((presence) => presence.clientId), ['vivant']);
    clearPresence();
});

test('listBuildMismatches les rend tous, du plus en retard au plus avancé', () => {
    clearPresence();
    const now = Date.now();
    // Plusieurs écrans divergents : `checkBuildMismatch` n'en renvoyait qu'un, au gré de
    // l'ordre d'itération — d'où un numéro de build qui sautait de 91 à 90 sans raison
    // apparente, et un diagnostic qu'on ne pouvait pas suivre.
    setPresenceMap({
        self: { role: 'gm', at: now, build: 93, label: '0.1.0+93' },
        vieux: { role: 'players', at: now, build: 90, label: '0.1.0+90' },
        moins_vieux: { role: 'gm', at: now, build: 91, label: '0.1.0+91' },
        aligne: { role: 'players', at: now, build: 93, label: '0.1.0+93' },
    });

    const ecarts = listBuildMismatches(93, 'self');
    assert.deepEqual(ecarts.map((client) => client.build), [90, 91]);
    assert.deepEqual(ecarts.map((client) => client.role), ['players', 'gm']);
    clearPresence();
});

test('listOtherGmClients ne rend que les MJ concurrents, ni soi ni la table ni les périmés', () => {
    clearPresence();
    const now = Date.now();
    setPresenceMap({
        self: { role: 'gm', at: now, build: 35, label: 'portable du MJ' },
        salon: { role: 'gm', at: now - 30_000, build: 35, label: 'tablette du salon' },
        vieil_onglet: { role: 'gm', at: now - 5_000, build: 35, label: 'onglet oublié' },
        table: { role: 'players', at: now, build: 35, label: 'écran de la table' },
        ferme: { role: 'gm', at: now - 120_000, build: 35, label: 'fermé brutalement' },
    });

    const autres = listOtherGmClients('self');
    // La table n'est pas un MJ : la congédier reviendrait à éteindre l'écran des joueurs.
    // Et `ferme` a dépassé PRESENCE_STALE_AFTER_MS : compter un concurrent qui n'est plus là
    // ferait paraître le bouton cassé, puisqu'il ne se déconnecterait jamais.
    assert.deepEqual(autres.map((client) => client.clientId), ['salon', 'vieil_onglet']);

    // Sans clientId local — transport non connecté — on ne se retire pas de sa propre liste,
    // et c'est le comportement voulu : mieux vaut un bouton qui propose une éviction de trop
    // qu'un bouton qui masque un concurrent réel.
    assert.equal(listOtherGmClients().length, 3);
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
