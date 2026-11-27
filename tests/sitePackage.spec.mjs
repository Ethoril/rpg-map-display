// @ts-check

import { test, expect } from '@playwright/test';

import { buildSite } from '../scripts/build-site.mjs';

// ⚠ Le même port que `playwright.config.mjs`, qui lit `PW_PORT` — la variable prévue par le dépôt
// pour que deux worktrees ne se partagent pas le serveur du 4173. Codé en dur ici, ce test
// échouait sur toute porte lancée sur un autre port, et passait sur le `_site` d'un AUTRE arbre de
// travail quand un serveur traînait sur le 4173 : un faux vert, et le pire des deux.
const baseURL = `http://127.0.0.1:${Number(process.env.PW_PORT ?? 4173)}/_site`;

test.beforeAll(() => {
  buildSite();
});

test('le paquet Pages charge réellement les vues MJ et joueurs sans module ni asset manquant', async ({ page }) => {
  /** @type {string[]} */
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    failures.push(`requestfailed: ${request.url()} — ${request.failure()?.errorText || 'inconnu'}`)
  );
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()}: ${response.url()}`);
  });

  await page.goto(`${baseURL}/gm.html?session=PACKAGE-SMOKE`);
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('[data-status="local"]')).toBeVisible();

  await page.goto(`${baseURL}/player.html?session=PACKAGE-SMOKE`);
  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('[data-status="local"]')).toBeVisible();

  expect(failures).toEqual([]);
});
