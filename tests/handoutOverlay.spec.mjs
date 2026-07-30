// @ts-check
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/** PNG 1×1 opaque, servi à la place de toute requête vers Drive. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test.describe('Chantier H — Révélation d\'image (Handouts)', () => {
  test('1. Révélation d\'un handout MJ -> Joueurs, image réellement décodée, et fermeture', async ({ context }) => {
    const sessionId = `test-handout-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, null);
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    // Naviguer vers l'onglet Handouts du MJ
    await pageGM.click('.gm-tab-btn[data-tab="handouts"]');
    await pageGM.waitForSelector('#handout-image-url');

    // Remplir l'URL et révéler.
    //
    // `maps/minimal.webp` est une image réellement présente et commitée. Une URL
    // inexistante laisserait ce test vert : `toBeVisible()` juge le conteneur plein
    // écran, dont la boîte fait 100vw×100vh quelle que soit l'image, et
    // `toHaveAttribute` ne compare qu'une chaîne. L'assertion sur `naturalWidth`
    // ci-dessous est la seule qui prouve un décodage réel.
    const testUrl = './maps/minimal.webp';
    await pageGM.fill('#handout-image-url', testUrl);
    await pageGM.fill('#handout-title', 'Titre de test');

    await pageGM.click('#handout-show-btn');

    // Attendre l'apparition chez le joueur.
    //
    // Le `timeout: 2000` **est** la garde : il échouerait si la révélation cessait
    // d'être portée par un événement de transport pour dépendre d'un rafraîchissement
    // périodique. Il n'y a plus de mesure en horloge murale ici — cf. docs/ETAT.md,
    // « Budgets de latence dans les tests navigateur ».
    await pagePlayer.waitForSelector('#handout-overlay', { state: 'attached' });
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible({ timeout: 2000 });

    // Vérifier que l'image est affichée
    const imgElement = pagePlayer.locator('#handout-overlay img');
    await expect(imgElement).toHaveAttribute('src', testUrl);

    // Et qu'elle est réellement décodée, pas seulement référencée. Attente de
    // condition et non de durée : cf. la leçon consignée dans docs/ETAT.md.
    //
    // Le délai est explicite et large : décoder est une question de vivacité, pas de
    // performance. Le défaut de 5 s de `expect.poll` a déjà expiré une fois sous six
    // workers concurrents, ce qui ne prouvait rien sur le produit.
    await expect
      .poll(
        () =>
          pagePlayer.evaluate(() => {
            const img = document.querySelector('#handout-overlay img');
            return img instanceof HTMLImageElement ? img.naturalWidth : 0;
          }),
        { timeout: 15000 }
      )
      .toBeGreaterThan(0);

    // Fermeture par le MJ
    await pageGM.click('#handout-hide-btn');
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();

    // Vérifier que le canvas joueur est toujours en place
    await expect(pagePlayer.locator('#board')).toBeVisible();

    await pageGM.close();
    await pagePlayer.close();
  });

  test('1bis. Un lien de partage Google Drive est converti avant de partir sur le réseau', async ({
    context,
  }) => {
    const sessionId = `test-handout-drive-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, null);
    await installBrowserTransport(pagePlayer, sessionId, null);

    // Ce test touchait réellement drive.google.com : il dépendait donc d'une
    // connexion et de la disponibilité d'un tiers, et il a échoué de ce fait.
    // L'interception le rend hermétique **et** le renforce : son titre promet de
    // vérifier ce qui part sur le réseau, ce que la seule lecture d'un attribut
    // `src` ne prouvait pas.
    /** @type {string[]} */
    const requetesDrive = [];
    for (const p of [pageGM, pagePlayer]) {
      await p.route('https://drive.google.com/**', async (route) => {
        requetesDrive.push(route.request().url());
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
      });
    }

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await pageGM.click('.gm-tab-btn[data-tab="handouts"]');
    await pageGM.waitForSelector('#handout-image-url');

    // Exactement ce que Drive met dans le presse-papier quand on partage une image. Tel quel,
    // c'est une page HTML : la tablette affichait une icône de fichier cassé sur fond noir.
    await pageGM.fill(
      '#handout-image-url',
      'https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view?usp=drive_link'
    );
    await pageGM.click('#handout-show-btn');

    const attendu = 'https://drive.google.com/thumbnail?id=1tnBho2PcsZFcJyuLcuciW&sz=w2000';

    // Ce qui compte : c'est l'URL convertie qui part sur le réseau et arrive à la tablette,
    // et non le lien de partage brut corrigé à l'affichage.
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveAttribute('src', attendu);
    // Le champ MJ reflète la conversion, pour que le MJ la voie au lieu de la subir.
    await expect(pageGM.locator('#handout-image-url')).toHaveValue(attendu);

    // L'assertion qui tient la promesse du titre : le navigateur a bien demandé
    // l'URL convertie, et **jamais** le lien de partage brut — lequel sert une page
    // HTML de 75 Ko dont aucune balise `<img>` ne tirera une image.
    await expect.poll(() => requetesDrive.length).toBeGreaterThan(0);
    expect(requetesDrive).not.toContain(
      'https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view?usp=drive_link'
    );
    expect([...new Set(requetesDrive)]).toEqual([attendu]);

    // Un lien de dossier, lui, ne peut pas être converti : il est refusé côté MJ, et rien
    // n'est révélé aux joueurs.
    await pageGM.click('#handout-hide-btn');
    await pageGM.fill('#handout-image-url', 'https://drive.google.com/drive/folders/1tnBho2PcsZ');
    await pageGM.click('#handout-show-btn');
    await expect(pageGM.locator('#handout-error-msg')).toBeVisible();
    await expect(pageGM.locator('#handout-error-msg')).toContainText('dossier');
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();

    await pageGM.close();
    await pagePlayer.close();
  });

  test('2. Persistance après F5 (rafraîchissement) sur la vue joueurs', async ({ context }) => {
    const sessionId = `test-handout-f5-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, null);
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await pageGM.click('.gm-tab-btn[data-tab="handouts"]');
    await pageGM.fill('#handout-image-url', './maps/minimal.webp');
    await pageGM.click('#handout-show-btn');

    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();

    // F5 sur la vue joueurs
    await pagePlayer.reload();

    // Re-installer le transport car reload efface l'initScript dynamique si la page recharge complètement sans fixture persistante
    // Mais pour F5, LocalStorage est déjà écrit !
    await waitForApp(pagePlayer);

    // L'overlay doit réapparaître depuis LocalStorage / Snapshot
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible({ timeout: 3000 });

    await pageGM.close();
    await pagePlayer.close();
  });

  test('3. Zero-UI (T-23) conservé avec handout affiché', async ({ context }) => {
    const sessionId = `test-handout-zeroui-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, null);
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await pageGM.click('.gm-tab-btn[data-tab="handouts"]');
    await pageGM.fill('#handout-image-url', './maps/minimal.webp');
    await pageGM.click('#handout-show-btn');

    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();

    // Vérifier Zero-UI strict — seul le bouton plein écran est toléré (dérogation du
    // 30 juillet 2026, cf. CONVENTIONS.md §8, interdiction 2).
    const forbiddenCount = await pagePlayer.evaluate(() => {
      return Array.from(document.querySelectorAll('button, nav, input')).filter(
        (el) => el.id !== 'player-fullscreen-btn'
      ).length;
    });
    expect(forbiddenCount).toBe(0);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('4. Le z-index de l\'overlay handout est strictement inférieur à 9999 (versionBadge)', async ({ page }) => {
    await page.goto('/player.html?session=test-zindex');

    const handoutZIndex = await page.evaluate(() => {
      const el = document.getElementById('handout-overlay');
      return el ? parseInt(window.getComputedStyle(el).zIndex || '0', 10) : 0;
    });

    const versionZIndex = await page.evaluate(() => {
      const el = document.getElementById('player-version-overlay');
      return el ? parseInt(window.getComputedStyle(el).zIndex || '0', 10) : 0;
    });

    expect(handoutZIndex).toBeLessThan(9999);
    expect(versionZIndex).toBe(9999);
    expect(handoutZIndex).toBeLessThan(versionZIndex);
  });
});
