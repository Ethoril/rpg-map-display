// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Liaison RÉELLE entre la page MJ de la carte et l'application Outil MJ Warhammer, servies sur une
 * même origine (audit du 08/11, A3 A5 A6). Hors CI : il faut le dépôt de l'outil sur ce poste.
 *   $env:RPG_AUDIT_MJ_ROOT = 'E:\Outil MJ Warhammer'   (PowerShell)
 *   pnpm exec playwright test tests/liaisonReelle.spec.mjs --project=chromium
 * Sans cette variable, les trois scénarios sont ignorés.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/** @param {import('@playwright/test').BrowserContext} context @param {string} mjRoot */
async function openMj(context, mjRoot) {
  const mj = await context.newPage();
  await mj.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/outil-mj/')) return route.continue();
    const root = path.resolve(mjRoot);
    const filename = path.resolve(root, decodeURIComponent(url.pathname.slice('/outil-mj/'.length)) || 'index.html');
    if (!filename.startsWith(root + path.sep)) return route.abort();
    const ext = path.extname(filename);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    try { await route.fulfill({ body: await fs.readFile(filename), contentType: /** @type {Record<string,string>} */ (types)[ext] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  await mj.goto('/outil-mj/index.html');
  await mj.waitForFunction(() => /** @type {HTMLElement|null} */ (document.querySelector('#app-content'))?.style.display === 'block', null, { timeout: 20000 });
  await expect(mj.locator('#map-link-indicator')).toHaveAttribute('data-state', 'connected', { timeout: 15000 });
  return mj;
}

test('liaison réelle : les deux applications échangent un participant sans altérer un pion autonome', async ({ browser }) => {
  const mjRoot = process.env.RPG_AUDIT_MJ_ROOT;
  test.skip(!mjRoot, 'Chemin de l’outil MJ requis dans RPG_AUDIT_MJ_ROOT');
  const sid = `liaison-reelle-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const ordinary = createToken({ id: 'ordinary', levelId: 'a', kind: 'pc', cell: { a: 2, b: 2 }, label: 'Autonome' });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level], tokens: [ordinary] }), activeLevelId: 'a' };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const gm = await context.newPage();
    await installBrowserTransport(gm, sid, snapshot);
    await gm.goto(`/gm.html?session=${sid}`);
    await waitForApp(gm);
    const mj = await openMj(context, mjRoot || '');
    await mj.evaluate(async () => {
      const modulePath = '/outil-mj/js/main.js';
      const { Store } = await import(modulePath);
      await Store.ready;
      await Store.addProfile({ id: 'audit-profile', name: 'Garde audit', kind: 'PNJ', hp: 20, maxHp: 20, movement: 4, caracs: {} });
      await Store.addParticipant({ id: 'audit-participant', profileId: 'audit-profile', name: 'Garde audit', kind: 'PNJ', camp: 'ennemi', zone: 'active', hp: 10, maxHp: 10, movement: 4, states: [] });
    });
    const participant = await mj.evaluate(async () => {
      const modulePath = '/outil-mj/js/main.js';
      const { Store } = await import(modulePath);
      const found = Store.listParticipants().find((/** @type {any} */ row) => row.id === 'audit-participant');
      return { hp: found.hp, maxHp: found.maxHp };
    });
    expect(participant).toEqual({ hp: 10, maxHp: 10 });
    await expect.poll(() => gm.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.reserve?.find(token => /** @type {any} */ (token).link?.ref === 'p:audit-participant')?.label), { timeout: 10000 }).toBe('Garde audit');
    const result = await gm.evaluate(async () => {
      const campaign = (await import('../js/state/store.js')).getCampaign();
      return { linked: campaign?.reserve?.find(token => /** @type {any} */ (token).link?.ref === 'p:audit-participant'), ordinary: campaign?.tokens.find(token => token.id === 'ordinary') };
    });
    expect(result.ordinary?.label).toBe('Autonome');
    expect(result.ordinary?.cell).toEqual({ a: 2, b: 2 });
    expect(result.linked?.hp).toEqual({ current: 10, max: 10 });
  } finally {
    await context.close();
  }
});

test('liaison réelle : le changement de carte réinitialise les pions posés connus par l’outil MJ', async ({ browser }) => {
  const mjRoot = process.env.RPG_AUDIT_MJ_ROOT;
  test.skip(!mjRoot, 'Chemin de l’outil MJ requis dans RPG_AUDIT_MJ_ROOT');
  const sid = `audit-map-a-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level] }), activeLevelId: 'a' };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const first = await context.newPage();
    await installBrowserTransport(first, sid, snapshot);
    await first.goto(`/gm.html?session=${sid}`);
    await waitForApp(first);
    const mj = await openMj(context, mjRoot || '');
    await mj.evaluate(async () => {
      const modulePath = '/outil-mj/js/main.js';
      const { Store } = await import(modulePath);
      await Store.ready;
      await Store.addParticipant({ id: 'audit-change', name: 'Garde à poser', kind: 'PNJ', camp: 'ennemi', zone: 'active', hp: 10, maxHp: 10, movement: 4, states: [] });
    });
    await expect(mj.locator('#map-link-pending')).toBeVisible();
    const tokenId = await first.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getCampaign()?.reserve?.find(token => /** @type {any} */ (token).link?.ref === 'p:audit-change')?.id;
    });
    expect(tokenId).toBeTruthy();
    await first.evaluate(async id => (await import('../js/state/store.js')).placeTokenFromReserve(id || '', 'a', { a: 3, b: 3 }), tokenId);
    await expect(mj.locator('#map-link-pending')).toBeHidden();
    await first.close();
    const second = await context.newPage();
    const sid2 = `${sid}-b`;
    await installBrowserTransport(second, sid2, snapshot);
    await second.goto(`/gm.html?session=${sid2}`);
    await waitForApp(second);
    await expect.poll(() => second.evaluate(async () => (await import('../js/state/store.js')).getCampaign()?.reserve?.some(token => /** @type {any} */ (token).link?.ref === 'p:audit-change')), { timeout: 10000 }).toBe(true);
    await expect(mj.locator('#map-link-pending')).toBeVisible({ timeout: 2000 });
  } finally {
    await context.close();
  }
});

test('liaison réelle : un instantané vide retire les anciens traits d’engagement', async ({ browser }) => {
  const mjRoot = process.env.RPG_AUDIT_MJ_ROOT;
  test.skip(!mjRoot, 'Chemin de l’outil MJ requis dans RPG_AUDIT_MJ_ROOT');
  const sid = `audit-engagement-${Date.now()}`;
  const level = createLevel({ id: 'a', pxPerCell: 100, widthCells: 10, heightCells: 8 });
  const snapshot = { campaign: createCampaign({ campaignId: sid, levels: [level] }), activeLevelId: 'a' };
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const gm = await context.newPage();
    await gm.addInitScript(() => {
      const Native = window.BroadcastChannel;
      /** @type {any} */ (window).BroadcastChannel = class extends Native {
        /** @param {string} name */
        constructor(name) { super(name); this.auditName = name; }
        /** @param {(event: MessageEvent) => void} handler */
        set onmessage(handler) {
          super.onmessage = event => {
            const w = /** @type {any} */ (window);
            if (this.auditName === 'wfrp-map-link' && event.data?.type === 'mj.snapshot') w.__auditSnapshotCount = (w.__auditSnapshotCount || 0) + 1;
            if (this.auditName === 'wfrp-map-link' && w.__auditDropEmpty && event.data?.type === 'mj.engagements' && event.data?.payload?.pairs?.length === 0) { w.__auditDroppedClear = true; return; }
            handler(event);
          };
        }
      };
    });
    await installBrowserTransport(gm, sid, snapshot);
    await gm.goto(`/gm.html?session=${sid}`);
    await waitForApp(gm);
    await gm.evaluate(async () => {
      const modulePath = '../js/render/layers/engagements.js';
      const { EngagementsLayer } = await import(modulePath);
      const original = EngagementsLayer.prototype.render;
      /** @param {any} ctx @param {any} grid @param {any} level @param {any} options */
      EngagementsLayer.prototype.render = function (ctx, grid, level, options) {
        /** @type {any} */ (window).__auditPairs = options?.pairs || [];
        return original.call(this, ctx, grid, level, options);
      };
    });
    const mj = await openMj(context, mjRoot || '');
    await mj.evaluate(async () => {
      const modulePath = '/outil-mj/js/main.js';
      const { Store } = await import(modulePath);
      await Store.ready;
      await Store.addParticipant({ id: 'audit-e1', name: 'Allié', kind: 'PNJ', camp: 'allie', zone: 'active', hp: 10, maxHp: 10, movement: 4, states: [] });
      await Store.addParticipant({ id: 'audit-e2', name: 'Ennemi', kind: 'PNJ', camp: 'ennemi', zone: 'active', hp: 10, maxHp: 10, movement: 4, states: [] });
      await Store.engageParticipants('audit-e1', 'audit-e2');
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__auditPairs?.length), { timeout: 10000 }).toBe(1);
    await gm.evaluate(() => { /** @type {any} */ (window).__auditDropEmpty = true; });
    await mj.evaluate(async () => {
      const modulePath = '/outil-mj/js/main.js';
      const { Store } = await import(modulePath);
      await Store.disengageParticipant('audit-e1');
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__auditDroppedClear), { timeout: 10000 }).toBe(true);
    const before = await gm.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__auditDropEmpty = false;
      const count = w.__auditSnapshotCount || 0;
      const channel = new BroadcastChannel('wfrp-map-link');
      channel.postMessage({ v: 1, type: 'map.hello', from: 'map', payload: {} });
      channel.close();
      return count;
    });
    await expect.poll(() => gm.evaluate(() => /** @type {any} */ (window).__auditSnapshotCount), { timeout: 10000 }).toBeGreaterThan(before);
    await gm.evaluate(async () => (await import('../js/state/store.js')).selectLevel('a'));
    await gm.waitForTimeout(300);
    const pairs = await gm.evaluate(() => /** @type {any} */ (window).__auditPairs);
    expect(pairs).toEqual([]);
  } finally {
    await context.close();
  }
});
