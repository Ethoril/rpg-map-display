// @ts-check
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { waitForApp, waitForPlayerVision } from './browserTestTransport.mjs';

/**
 * Les vrais SDK et le vrai `FirebaseTransport`, contre les émulateurs RTDB et Firestore (audit
 * du 08/11 : A4, A8, A9, A14, A15). Identité simulée, aucune donnée de production. Hors porte et
 * hors CI — ignorés sans émulateurs. Pour les rejouer :
 *   pnpm exec firebase emulators:exec --project demo-rpg-map-display-rules --only firestore,database "pnpm exec playwright test tests/firebaseReel.emulator.spec.mjs --project=chromium"
 * ⚠ Un vert e2e sur le transport de test ne dit rien de ce chemin-là (QUESTIONS-EN-ATTENTE.md).
 */

/** @param {import('@playwright/test').Browser} browser @param {string} sid @param {import('@playwright/test').BrowserContext[]} contexts @param {'gm'|'players'} role */
async function openEmulatedPage(browser, sid, contexts, role) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.route('https://www.gstatic.com/firebasejs/12.16.0/*.js', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1);
      if (!name || !/^firebase-[a-z-]+\.js$/.test(name)) return route.abort();
      await route.fulfill({ path: path.resolve('node_modules/firebase', name), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
    });
    await page.addInitScript(({ sessionId, firestoreHost, databaseHost }) => {
      /** @type {any} */
      let real = null;
      const [dbHost, dbPort] = databaseHost.split(':');
      const [fsHost, fsPort] = firestoreHost.split(':');
      const proxy = new Proxy({}, {
        get(_target, key) {
          if (key === 'connect') return async (/** @type {string} */ id, /** @type {'gm'|'players'} */ clientRole) => {
            const [{ FirebaseTransport }, database, firestore] = await Promise.all([
              import('../js/transport/FirebaseTransport.js'), import('firebase/database'), import('firebase/firestore'),
            ]);
            real = new FirebaseTransport({ apiKey: 'test', authDomain: 'test.invalid', databaseURL: `http://${dbHost}:${dbPort}?ns=demo-rpg-map-display-rules`, projectId: 'demo-rpg-map-display-rules', appId: 'test' });
            real._ensureAuth();
            const claims = { sub: `audit-${clientRole}`, user_id: `audit-${clientRole}`, email: 'ethoril@gmail.com', email_verified: true };
            database.connectDatabaseEmulator(database.getDatabase(real._app), dbHost, Number(dbPort), { mockUserToken: claims });
            firestore.connectFirestoreEmulator(firestore.getFirestore(real._app), fsHost, Number(fsPort), { mockUserToken: claims });
            real.currentUser = async () => ({ uid: claims.sub });
            await real.connect(id, clientRole);
          };
          if (key === 'real') return real;
          const value = real?.[key];
          return typeof value === 'function' ? value.bind(real) : value;
        },
      });
      /** @type {any} */ (window).__RPG_APP_OPTIONS__ = { sessionId, transport: proxy };
    }, { sessionId: sid, firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || '', databaseHost: process.env.FIREBASE_DATABASE_EMULATOR_HOST || '' });
    await page.goto(`/${role === 'gm' ? 'gm' : 'player'}.html?session=${sid}`);
    await waitForApp(page);
    return page;
}

test('vrai SDK : le déplacement de la tablette est écrit par le MJ', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `auditfirebase${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 2, b: 2 } });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [token] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ initial, sessionId }) => {
      const store = await import('../js/state/store.js');
      store.restoreFromSnapshot(initial, { sessionId });
      await /** @type {any} */ (window).__RPG_APP__.transport.saveSnapshot(initial);
    }, { initial: snapshot, sessionId: sid });
    await gm.waitForTimeout(800);
    const player = await openEmulatedPage(browser, sid, contexts, 'players');
    await expect.poll(() => player.evaluate(async () => (await import('../js/state/presence.js')).listOtherGmClients().length), { timeout: 10000 }).toBeGreaterThan(0);
    await player.waitForTimeout(800);
    await player.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      /** @param {number} x @param {number} y */
      const tap = (x, y) => app.pointerInput.onIntention({ type: 'tap', mapPos: { x, y }, screenPos: app.camera.mapToScreen({ x, y }) });
      tap(250, 250); tap(350, 250); tap(350, 250);
    });
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell), { timeout: 10000 }).toEqual({ a: 3, b: 2 });
    await player.waitForTimeout(1200);
    const saved = await gm.evaluate(async sessionId => {
      const firestore = await import('firebase/firestore');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      const doc = await firestore.getDocFromServer(firestore.doc(transport._firestore, 'campaigns', sessionId, 'tokens', 'hero'));
      return doc.data()?.token?.cell;
    }, sid);
    const fresh = await openEmulatedPage(browser, sid, contexts, 'players');
    const reloaded = await fresh.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell);
    expect({ saved, reloaded }).toEqual({ saved: { a: 3, b: 2 }, reloaded: { a: 3, b: 2 } });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : une coupure RTDB est visible sur la page MJ', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, `auditoffline${Date.now()}`, contexts, 'gm');
    await expect(gm.locator('#network-status-gm')).toHaveAttribute('data-status', 'connected');
    await gm.evaluate(async () => {
      const database = await import('firebase/database');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      database.goOffline(transport._db);
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.transport.real._movePreviewWasConnected)).toBe(false);
    await gm.waitForTimeout(500);
    await expect(gm.locator('#network-status-gm')).toHaveAttribute('data-status', 'offline', { timeout: 2000 });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : un instantané retardé ne remplace pas une action récente du MJ', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `auditresync${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 2, b: 2 } });
  const initial = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [token] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ snapshot, sessionId }) => {
      const store = await import('../js/state/store.js');
      store.restoreFromSnapshot(snapshot, { sessionId });
      await /** @type {any} */ (window).__RPG_APP__.transport.saveSnapshot(snapshot);
    }, { snapshot: initial, sessionId: sid });
    await gm.waitForTimeout(800);
    await gm.evaluate(() => {
      const w = /** @type {any} */ (window);
      const transport = w.__RPG_APP__.transport.real;
      const snapshot = transport.snapshot.bind(transport);
      transport.mayHaveMissedEvents = () => true;
      transport.snapshot = async () => {
        const result = await snapshot();
        await new Promise(resolve => { w.__auditSnapshotReady = true; w.__auditReleaseSnapshot = resolve; });
        return result;
      };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__auditSnapshotReady), { timeout: 10000 }).toBe(true);
    await gm.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      /** @param {number} x @param {number} y */
      const tap = (x, y) => app.pointerInput.onIntention({ type: 'tap', mapPos: { x, y }, screenPos: app.camera.mapToScreen({ x, y }) });
      tap(250, 250); tap(350, 250); tap(350, 250);
    });
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell)).toEqual({ a: 3, b: 2 });
    await expect.poll(() => gm.evaluate(async sessionId => {
      const firestore = await import('firebase/firestore');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      return (await firestore.getDocFromServer(firestore.doc(transport._firestore, 'campaigns', sessionId, 'tokens', 'hero'))).data()?.token?.cell;
    }, sid), { timeout: 10000 }).toEqual({ a: 3, b: 2 });
    await gm.evaluate(() => /** @type {any} */ (window).__auditReleaseSnapshot());
    await gm.waitForTimeout(500);
    const shown = await gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell);
    const persisted = await gm.evaluate(async sessionId => {
      const firestore = await import('firebase/firestore');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      return (await firestore.getDocFromServer(firestore.doc(transport._firestore, 'campaigns', sessionId, 'tokens', 'hero'))).data()?.token?.cell;
    }, sid);
    expect({ shown, persisted }).toEqual({ shown: { a: 3, b: 2 }, persisted: { a: 3, b: 2 } });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : une préparation est abandonnée lors de la reconnexion', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `auditpreview${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 2, b: 2 }, speedCells: 4 });
  const initial = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [token] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ snapshot, sessionId }) => {
      const store = await import('../js/state/store.js');
      store.restoreFromSnapshot(snapshot, { sessionId });
      await /** @type {any} */ (window).__RPG_APP__.transport.saveSnapshot(snapshot);
    }, { snapshot: initial, sessionId: sid });
    await gm.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      /** @param {number} x @param {number} y */
      const tap = (x, y) => app.pointerInput.onIntention({ type: 'tap', mapPos: { x, y }, screenPos: app.camera.mapToScreen({ x, y }) });
      tap(250, 250); tap(350, 250);
    });
    await expect.poll(() => gm.evaluate(async sessionId => {
      const db = await import('firebase/database');
      const t = /** @type {any} */ (window).__RPG_APP__.transport.real;
      return (await db.get(db.ref(t._db, `session/${sessionId}/movePreviews/${t.getClientId()}`))).exists();
    }, sid), { timeout: 10000 }).toBe(true);
    await gm.evaluate(async () => {
      const db = await import('firebase/database');
      const t = /** @type {any} */ (window).__RPG_APP__.transport.real;
      db.goOffline(t._db);
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.transport.real._movePreviewWasConnected)).toBe(false);
    await gm.evaluate(async () => {
      const db = await import('firebase/database');
      const t = /** @type {any} */ (window).__RPG_APP__.transport.real;
      db.goOnline(t._db);
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.transport.real._movePreviewWasConnected), { timeout: 10000 }).toBe(true);
    await gm.evaluate(() => /** @type {any} */ (window).__RPG_APP__.transport.real._movePreviewWriteQueue);
    await expect.poll(() => gm.evaluate(async sessionId => {
      const db = await import('firebase/database');
      const t = /** @type {any} */ (window).__RPG_APP__.transport.real;
      return (await db.get(db.ref(t._db, `session/${sessionId}/movePreviews/${t.getClientId()}`))).exists();
    }, sid), { timeout: 10000 }).toBe(false);
    await gm.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      const point = { x: 350, y: 250 };
      app.pointerInput.onIntention({ type: 'tap', mapPos: point, screenPos: app.camera.mapToScreen(point) });
    });
    const position = await gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell);
    expect(position).toEqual({ a: 2, b: 2 });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : une sauvegarde ancienne ne remplace pas la plus récente', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `auditsaveorder${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 2, b: 2 } });
  const initial = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [token] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ snapshot, sessionId }) => {
      const store = await import('../js/state/store.js');
      store.restoreFromSnapshot(snapshot, { sessionId });
      await /** @type {any} */ (window).__RPG_APP__.transport.saveSnapshot(snapshot);
    }, { snapshot: initial, sessionId: sid });
    await gm.waitForTimeout(800);
    await gm.evaluate(() => {
      const w = /** @type {any} */ (window);
      const transport = w.__RPG_APP__.transport.real;
      const original = transport.saveSnapshot.bind(transport);
      let calls = 0;
      transport.saveSnapshot = async (/** @type {any} */ data) => {
        const call = ++calls;
        if (call === 1) await new Promise(resolve => { w.__auditOldSaveWaiting = true; w.__auditReleaseOldSave = resolve; });
        await original(data);
        if (call === 1) w.__auditOldSaveCompleted = true;
      };
    });
    await gm.evaluate(async () => (await import('../js/state/store.js')).moveTokenToCell('hero', { a: 3, b: 2 }));
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__auditOldSaveWaiting)).toBe(true);
    await gm.evaluate(async () => (await import('../js/state/store.js')).moveTokenToCell('hero', { a: 4, b: 2 }));
    const serverCell = () => gm.evaluate(async sessionId => {
      const firestore = await import('firebase/firestore');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      return (await firestore.getDocFromServer(firestore.doc(transport._firestore, 'campaigns', sessionId, 'tokens', 'hero'))).data()?.token?.cell;
    }, sid);
    // A15 corrigé : la seconde sauvegarde attend la fin de la première, Firestore n'a donc pas
    // encore (4,2) ici ; ce qui compte est l'état FINAL.
    await gm.evaluate(() => /** @type {any} */ (window).__auditReleaseOldSave());
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__auditOldSaveCompleted), { timeout: 10000 }).toBe(true);
    await expect.poll(serverCell, { timeout: 10000 }).toEqual({ a: 4, b: 2 });
    const persisted = await serverCell();
    const shown = await gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell);
    expect({ persisted, shown }).toEqual({ persisted: { a: 4, b: 2 }, shown: { a: 4, b: 2 } });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : une reprise tardive ne désynchronise pas la tablette', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `auditplayerresync${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'hero', levelId: 'a', kind: 'pc', cell: { a: 2, b: 2 } });
  const initial = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [token] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ snapshot, sessionId }) => {
      const store = await import('../js/state/store.js');
      store.restoreFromSnapshot(snapshot, { sessionId });
      await /** @type {any} */ (window).__RPG_APP__.transport.saveSnapshot(snapshot);
    }, { snapshot: initial, sessionId: sid });
    await gm.waitForTimeout(800);
    const player = await openEmulatedPage(browser, sid, contexts, 'players');
    await waitForPlayerVision(player);
    await player.evaluate(() => {
      const w = /** @type {any} */ (window);
      const transport = w.__RPG_APP__.transport.real;
      const snapshot = transport.snapshot.bind(transport);
      transport.mayHaveMissedEvents = () => true;
      transport.snapshot = async () => {
        const result = await snapshot();
        await new Promise(resolve => { w.__auditSnapshotReady = true; w.__auditReleaseSnapshot = resolve; });
        return result;
      };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => player.evaluate(() => /** @type {any} */ (window).__auditSnapshotReady), { timeout: 10000 }).toBe(true);
    await player.evaluate(() => {
      const app = /** @type {any} */ (window).__RPG_APP__;
      /** @param {number} x @param {number} y */
      const tap = (x, y) => app.pointerInput.onIntention({ type: 'tap', mapPos: { x, y }, screenPos: app.camera.mapToScreen({ x, y }) });
      tap(250, 250); tap(350, 250); tap(350, 250);
    });
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell), { timeout: 10000 }).toEqual({ a: 3, b: 2 });
    // Force la sauvegarde de l'état courant du MJ pour isoler ce scénario d'A4.
    await gm.evaluate(async () => {
      const network = await import('../js/app/networkEvents.js');
      await /** @type {any} */ (window).__RPG_APP__.transport.saveSnapshot(network.createSnapshotPayload());
    });
    await player.evaluate(() => /** @type {any} */ (window).__auditReleaseSnapshot());
    await player.waitForTimeout(500);
    const positions = await Promise.all([gm, player].map(page => page.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.tokens[0]?.cell)));
    expect(positions).toEqual([{ a: 3, b: 2 }, { a: 3, b: 2 }]);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : la tablette rattrape un déplacement publié avant la sauvegarde, sans rejouer son animation', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `jonction${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const token = createToken({ id: 'hero', levelId: 'a', cell: { a: 2, b: 2 }, visionDim: 4 });
  const initial = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [token] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ initial, sid }) => {
      const store = await import('../js/state/store.js');
      const w = /** @type {any} */ (window);
      const transport = w.__RPG_APP__.transport.real;
      store.restoreFromSnapshot(initial, { sessionId: sid });
      await transport.saveSnapshot(initial);
      const save = transport.saveSnapshot.bind(transport);
      const gate = new Promise(resolve => { w.__libererSauvegarde = resolve; });
      transport.saveSnapshot = async (/** @type {object} */ snapshot) => { await gate; return save(snapshot); };
      const to = { a: 3, b: 2 };
      const from = { a: 2, b: 2 };
      store.moveTokenToCell('hero', to, { from, to, path: [from, to], startedAt: Date.now() });
      const outcome = await transport.publish({ type: 'token.move', payload: { tokenId: 'hero', from, to, path: [from, to] }, at: Date.now(), by: 'gm' });
      if (!outcome.ok) throw outcome.error;
    }, { initial, sid });

    const durableCell = () => gm.evaluate(async sessionId => {
      const fs = await import('firebase/firestore');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      return (await fs.getDocFromServer(fs.doc(transport._firestore, 'campaigns', sessionId, 'tokens', 'hero'))).data()?.token?.cell;
    }, sid);
    expect(await durableCell()).toEqual({ a: 2, b: 2 });
    const movesAfterPruning = await gm.evaluate(async sessionId => {
      const db = await import('firebase/database');
      const t = /** @type {any} */ (window).__RPG_APP__.transport.real;
      await t._pruneAcknowledgedEvents(t._sessionEpoch);
      const events = (await db.get(db.ref(t._db, `session/${sessionId}/events`))).val();
      return Object.values(events ?? {}).filter((/** @type {any} */ event) => event.type === 'token.move').length;
    }, sid);
    expect(movesAfterPruning).toBe(1);

    const player = await openEmulatedPage(browser, sid, contexts, 'players');
    const actual = () => player.evaluate(async () => {
      const token = (await import('../js/state/store.js')).getCampaign()?.tokens[0];
      return { cell: token?.cell, animated: !!token?.move };
    });
    await expect.poll(actual).toEqual({ cell: { a: 3, b: 2 }, animated: false });
    await gm.evaluate(() => /** @type {any} */ (window).__libererSauvegarde());
    await expect.poll(durableCell, { timeout: 8000 }).toEqual({ a: 3, b: 2 });

    await player.evaluate(() => {
      const t = /** @type {any} */ (window).__RPG_APP__.transport.real;
      const snapshot = t.snapshot.bind(t);
      t.mayHaveMissedEvents = () => true;
      t.snapshot = async () => {
        const result = await snapshot();
        /** @type {any} */ (window).__repriseLue = true;
        return result;
      };
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await player.waitForFunction(() => /** @type {any} */ (window).__repriseLue);
    await expect.poll(actual).toEqual({ cell: { a: 3, b: 2 }, animated: false });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('vrai SDK : le MJ retrouve les échecs RTDB et Firestore, et seule une écriture réussie rétablit la sauvegarde', async ({ browser }) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_DATABASE_EMULATOR_HOST, 'Émulateurs Firebase requis');
  const sid = `diagnostic${Date.now()}`;
  const level = createLevel({ id: 'a', widthCells: 8, heightCells: 8 });
  const hero = createToken({ id: 'hero', levelId: 'a', cell: { a: 2, b: 2 } });
  const initial = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [hero] }), activeLevelId: 'a' };
  /** @type {import('@playwright/test').BrowserContext[]} */
  const contexts = [];
  try {
    const gm = await openEmulatedPage(browser, sid, contexts, 'gm');
    await gm.evaluate(async ({ initial, sid }) => {
      const store = await import('../js/state/store.js');
      const transport = /** @type {any} */ (window).__RPG_APP__.transport.real;
      store.restoreFromSnapshot(initial, { sessionId: sid });
      await transport.saveSnapshot(initial);
    }, { initial, sid });
    const player = await openEmulatedPage(browser, sid, contexts, 'players');
    await player.evaluate(async () => {
      const w = /** @type {any} */ (window);
      const t = w.__RPG_APP__.transport.real;
      const push = t._pushEvent;
      const sendDiagnostics = t.saveTabletDiagnostics;
      t.saveTabletDiagnostics = async () => { throw new Error('Envoi du diagnostic suspendu'); };
      t._pushEvent = async () => { throw new Error('Envoi RTDB refusé'); };
      await t.publish({ type: 'token.move', payload: {}, by: 'players', at: Date.now() });
      t._pushEvent = push;
      w.__reprendreDiagnostic = () => {
        t.saveTabletDiagnostics = sendDiagnostics;
        t._emitConnectivity(true);
      };
    });
    const incidents = gm.locator('#gm-sync-incidents');
    expect(await player.evaluate(sid => localStorage.getItem(`rpg_sync_incidents_${sid}_players`), sid)).toContain('token.move');
    await expect(incidents).toBeHidden();
    await player.evaluate(() => /** @type {any} */ (window).__reprendreDiagnostic());
    await expect(incidents).toBeVisible();
    await incidents.locator('summary').click();
    await expect(incidents).toContainText('Tablette · Temps réel (RTDB) · publication de "token.move" · Échec constaté');

    await gm.evaluate(async (emulator) => {
      const [fs, firebase] = await Promise.all([import('firebase/firestore'), import('firebase/app')]);
      const w = /** @type {any} */ (window);
      const t = w.__RPG_APP__.transport.real;
      const store = await import('../js/state/store.js');
      const authorized = t._firestore;
      const [host, port] = emulator.split(':');
      const denied = fs.getFirestore(firebase.initializeApp(t._config, 'diagnostic-refuse'));
      fs.connectFirestoreEmulator(denied, host, Number(port), { mockUserToken: { sub: 'audit-refuse' } });
      t._firestore = denied;
      w.__retablirFirestore = () => { t._firestore = authorized; };
      store.updateToken('hero', { label: 'Échec voulu' });
    }, process.env.FIRESTORE_EMULATOR_HOST || '');
    await expect(incidents).toContainText('Poste MJ · Firestore · Sauvegarde · Échec constaté', { timeout: 8000 });
    await gm.evaluate(() => /** @type {any} */ (window).__retablirFirestore());
    await expect(incidents).not.toContainText('Sauvegarde rétablie');
    await gm.evaluate(async () => (await import('../js/state/store.js')).updateToken('hero', { label: 'Écriture réussie' }));
    await expect(incidents).toContainText('Sauvegarde rétablie', { timeout: 8000 });
  } finally {
    for (const context of contexts) await context.close();
  }
});
