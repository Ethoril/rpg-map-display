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
    // Un code de session fait 5 caractères et le champ est borné à cette longueur : une
    // valeur plus longue serait tronquée, et le test mentirait sur ce qui a navigué.
    await page.fill('#gm-session', 'A7K2M');
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/gm.html') && url.searchParams.get('session') === 'A7K2M'),
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

  test('chemin Joueur : code saisi en minuscules, session normalisée en majuscules', async ({ page }) => {
    await page.goto('/');
    // Saisie en minuscules à dessein : le code est recopié à la main depuis le bandeau du
    // MJ, et la casse ne doit pas décider silencieusement d'une autre session — ce qui
    // donnerait un plateau vide sans le moindre message.
    await page.fill('#player-session', 'b4xq9');
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/player.html') && url.searchParams.get('session') === 'b4xq9'),
      page.click('#btn-player'),
    ]);

    await waitForApp(page);
    const sessionUtilisee = await page.getAttribute('#network-status-players', 'data-session-id');
    expect(sessionUtilisee).toBe('B4XQ9');
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
