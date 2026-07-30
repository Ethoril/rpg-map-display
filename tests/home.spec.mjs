// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp } from './browserTestTransport.mjs';

test.describe('Chantier J — Page d\'accueil', () => {
  test('la page d\'accueil ne charge aucun script module et aucun script', async ({ page }) => {
    await page.goto('/');
    const moduleScripts = await page.locator('script[type="module"]').count();
    expect(moduleScripts).toBe(0);

    const allScripts = await page.locator('script').count();
    expect(allScripts).toBe(0);
  });

  test('chemin MJ avec session saisie navigue vers gm.html?session=...', async ({ page }) => {
    await page.goto('/');
    await page.fill('#gm-session', 'session-test-mj');
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/gm.html') && url.searchParams.get('session') === 'session-test-mj'),
      page.click('#btn-gm'),
    ]);
  });

  test('chemin MJ sans session saisie navigue vers gm.html et obtient une session valide', async ({ page }) => {
    await page.goto('/');
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/gm.html')),
      page.click('#btn-gm'),
    ]);
    await waitForApp(page);
    const hasSession = await page.evaluate(() => {
      return Boolean(window.sessionStorage.getItem('rpg-gm-session-id'));
    });
    expect(hasSession).toBe(true);
  });

  test('chemin Joueur avec session saisie navigue vers player.html?session=...', async ({ page }) => {
    await page.goto('/');
    await page.fill('#player-session', 'session-test-player');
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/player.html') && url.searchParams.get('session') === 'session-test-player'),
      page.click('#btn-player'),
    ]);
  });

  test('chemin Joueur sans session saisie ne navigue pas (champ required)', async ({ page }) => {
    await page.goto('/');
    const isRequired = await page.getAttribute('#player-session', 'required');
    expect(isRequired).not.toBeNull();

    const currentUrl = page.url();
    await page.click('#btn-player');
    expect(page.url()).toBe(currentUrl);
  });
});
