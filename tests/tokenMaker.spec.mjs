// @ts-check
import { test, expect } from '@playwright/test';

// Image PNG 100x100 valide encodée en base64 pour les tests de chargement de fichier
const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwvjb3YAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVHic7cExAQAAAMKg9U9tCj8gAAAAAAB4BhVMAAFxPbfKAAAAAElFTkSuQmCC';

const TEST_PNG_BUFFER = Buffer.from(TEST_PNG_BASE64, 'base64');

/**
 * Prépare la page index.html et monte le composant TokenMaker dans le DOM.
 * @param {import('@playwright/test').Page} page
 */
async function setupTokenMaker(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // S'assurer qu'aucun réseau Firebase (backend DB/Firestore) n'est sollicité pendant le test
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('firebaseio.com') || url.includes('firestore.googleapis.com')) {
      throw new Error(`Trafic réseau Firebase détecté pendant le test : ${url}`);
    }
  });

  await page.goto('/index.html');

  // Injecter et créer le composant TokenMaker
  await page.evaluate(async () => {
    const container = document.createElement('div');
    container.id = 'token-maker-root';
    document.body.appendChild(container);

    const module = await import('../js/ui/gm/tokenMaker.js');
    /** @type {any} */ (window).__tokenMakerInstance = module.createTokenMaker(container, {
      defaultLevelId: 'level-test',
    });
  });

  expect(errors).toEqual([]);
}

test.describe('T-21 — Générateur de pions (tokenMaker)', () => {
  test('Charge une image, effectue du pan/zoom, génère un pion 2x2 carré et télécharge', async ({
    page,
  }) => {
    await setupTokenMaker(page);

    // 1. Déposer / sélectionner une image de test
    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'hero-avatar.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    // S'assurer que le bouton Générer devient actif après chargement
    await expect(page.locator('#token-maker-root #btn-generate-token')).toBeEnabled();

    // 2. Pan & Zoom interactifs sur le canvas
    const canvas = page.locator('#token-maker-root #token-preview-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    if (box) {
      // Simulation Pan (drag & drop à la souris)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20);
      await page.mouse.up();

      // Simulation Zoom (molette de la souris)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -150);
    }

    // 3. Remplir le formulaire pion
    // Forme: Carré, kind: pc, couleur: #ff0000, sizeCells: 2, speedCells: 3
    await page.selectOption('#token-maker-root #token-shape', 'square');
    await page.selectOption('#token-maker-root #token-kind', 'pc');
    await page.fill('#token-maker-root #token-border-color', '#ff0000');
    await page.fill('#token-maker-root #token-size-cells', '2');
    await page.fill('#token-maker-root #token-speed-cells', '3');
    await page.fill('#token-maker-root #token-label', 'Guerrier Rouge');

    // 4. Cliquer sur "Générer pion"
    await page.click('#token-maker-root #btn-generate-token');

    // 5. Récupérer le pion généré et valider sa conformité avec createToken
    const tokenResult = await page.evaluate(() => {
      const instance = /** @type {any} */ (window).__tokenMakerInstance;
      const token = instance.getCurrentToken();
      const dataUrl = instance.getCurrentDataUrl();
      return { token, dataUrl };
    });

    const { token, dataUrl } = tokenResult;

    expect(token).toBeDefined();
    expect(token.id).toBeTruthy();
    expect(typeof token.id).toBe('string');
    expect(token.kind).toBe('pc');
    expect(token.levelId).toBe('level-test');
    expect(token.sizeCells).toBe(2);
    expect(token.speedCells).toBe(3);
    expect(token.borderColor).toBe('#ff0000');
    expect(token.label).toBe('Guerrier Rouge');
    expect(token.hidden).toBe(false);
    expect(token.playerMovable).toBe(true);
    expect(token.imageUrl).toMatch(/^maps\/tokens\/token-.*\.webp$/);
    expect(token.imageUrl.startsWith('data:')).toBe(false);
    expect(token.locked).toBe(false);
    expect(token.elevation).toBe(0);
    expect(Array.isArray(token.markers)).toBe(true);

    // 6. Vérifier la validité du dataURL et les dimensions de l'image générée (280px pour sizeCells: 2)
    expect(dataUrl).toMatch(/^data:image\/(webp|png);base64,/);

    const dimensions = await page.evaluate(async (url) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = (err) => reject(err);
        img.src = url;
      });
    }, dataUrl);

    // 2 cases -> sizeCells * 140 = 280px
    expect(dimensions.width).toBe(280);
    expect(dimensions.height).toBe(280);

    // 7. Déclencher le téléchargement et vérifier qu'il est capturé par le navigateur
    const downloadPromise = page.waitForEvent('download');
    await page.click('#token-maker-root #btn-download-token');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^token-.*\.webp$/);
  });

  test('Génère un pion circulaire 1x1', async ({ page }) => {
    await setupTokenMaker(page);

    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'monster.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await page.selectOption('#token-maker-root #token-shape', 'circle');
    await page.selectOption('#token-maker-root #token-kind', 'npc');
    await page.fill('#token-maker-root #token-border-color', '#00ff00');
    await page.fill('#token-maker-root #token-size-cells', '1');
    await page.fill('#token-maker-root #token-speed-cells', '4');
    await page.fill('#token-maker-root #token-label', 'Gobelin');

    await page.click('#token-maker-root #btn-generate-token');

    const tokenResult = await page.evaluate(() => {
      const instance = /** @type {any} */ (window).__tokenMakerInstance;
      return {
        token: instance.getCurrentToken(),
        dataUrl: instance.getCurrentDataUrl(),
      };
    });

    expect(tokenResult.token.kind).toBe('npc');
    expect(tokenResult.token.levelId).toBe('level-test');
    expect(tokenResult.token.playerMovable).toBe(false);
    expect(tokenResult.token.sizeCells).toBe(1);
    expect(tokenResult.token.speedCells).toBe(4);
    expect(tokenResult.token.borderColor).toBe('#00ff00');

    // 1 case -> Math.max(200, 1 * 140) = 200px
    const dimensions = await page.evaluate(async (url) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.src = url;
      });
    }, tokenResult.dataUrl);

    expect(dimensions.width).toBe(200);
    expect(dimensions.height).toBe(200);
  });

  test('Désactive la génération sans étage actif et refuse une URL temporaire', async ({ page }) => {
    await setupTokenMaker(page);

    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'hero.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await page.evaluate(() => {
      /** @type {any} */ (window).__tokenMakerInstance.setDefaultLevelId(null);
    });
    await expect(page.locator('#token-maker-root #btn-generate-token')).toBeDisabled();
    await expect(page.locator('#token-maker-root #token-maker-status')).toContainText(
      'Ajoutez ou sélectionnez un étage'
    );

    await page.evaluate(() => {
      /** @type {any} */ (window).__tokenMakerInstance.setDefaultLevelId('level-actif');
    });
    await page.fill('#token-maker-root #token-canonical-url', 'data:image/png;base64,AAAA');
    await expect(page.locator('#token-maker-root #btn-generate-token')).toBeDisabled();

    await page.fill('#token-maker-root #token-canonical-url', 'maps/tokens/hero.webp');
    await expect(page.locator('#token-maker-root #btn-generate-token')).toBeEnabled();
    await page.click('#token-maker-root #btn-generate-token');

    const token = await page.evaluate(
      () => /** @type {any} */ (window).__tokenMakerInstance.getCurrentToken()
    );
    expect(token.levelId).toBe('level-actif');
    expect(token.imageUrl).toBe('maps/tokens/hero.webp');
  });
});
