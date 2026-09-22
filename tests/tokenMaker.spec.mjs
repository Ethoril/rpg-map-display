// @ts-check
import { test, expect } from '@playwright/test';

// Image PNG 100x100 valide encodée en base64 pour les tests de chargement de fichier
const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwvjb3YAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVHic7cExAQAAAMKg9U9tCj8gAAAAAAB4BhVMAAFxPbfKAAAAAElFTkSuQmCC';

const TEST_PNG_BUFFER = Buffer.from(TEST_PNG_BASE64, 'base64');

/**
 * Prépare la page gm.html et monte le composant TokenMaker dans le DOM.
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

  await page.goto('/gm.html');

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
    // Sans URL publiée renseignée, l'image est EMBARQUÉE dans le pion : c'est ce qui la
    // rend visible tout de suite sur le Mac et sur la tablette, sans dépôt de fichier.
    expect(token.imageUrl).toMatch(/^data:image\/(webp|png);base64,/);
    expect(token.imageUrl).toBe(dataUrl);
    expect(token.imageUrl.length).toBeLessThanOrEqual(24 * 1024);
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

  test('D-3 : la vision dans le noir saisie à ZÉRO passe, et le défaut du formulaire est 1', async ({ page }) => {
    // ⛔ `Math.max(0, parseInt(v, 10) || 10)` avalait le zéro : un pion qu'on voulait AVEUGLE dans
    // le noir ressortait à 10 cases, en silence. C'est exactement le réglage que la décision D-3
    // du 21/09/2026 rend utile — le défaut passe de 12 à 1 pour que l'obscurité coûte quelque
    // chose — donc un zéro explicite doit atteindre le pion.
    await setupTokenMaker(page);

    // Le formulaire s'ouvre sur 1, pas sur 10.
    expect(await page.inputValue('#token-maker-root #token-vision-dim')).toBe('1');
    // Et il ne propose plus une valeur que le moteur rognerait : le plafond est à 40.
    expect(await page.getAttribute('#token-maker-root #token-vision-dim', 'max')).toBe('40');

    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'aveugle.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });
    await page.fill('#token-maker-root #token-label', 'Aveugle');
    await page.fill('#token-maker-root #token-vision-dim', '0');
    await page.click('#token-maker-root #btn-generate-token');

    const zero = await page.evaluate(
      () => /** @type {any} */ (window).__tokenMakerInstance.getCurrentToken().visionDim
    );
    expect(zero).toBe(0);

    // Et le contrôle symétrique : une saisie ordinaire n'est pas écrasée par le défaut.
    await page.fill('#token-maker-root #token-vision-dim', '7');
    await page.click('#token-maker-root #btn-generate-token');
    const sept = await page.evaluate(
      () => /** @type {any} */ (window).__tokenMakerInstance.getCurrentToken().visionDim
    );
    expect(sept).toBe(7);
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

  test('Convertit un lien de partage Google Drive collé dans l’URL canonique', async ({ page }) => {
    await setupTokenMaker(page);

    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'drive.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await page.fill(
      '#token-maker-root #token-canonical-url',
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnO/view?usp=sharing'
    );

    // Le champ reflète la conversion : le MJ voit l'URL réellement enregistrée.
    await expect(page.locator('#token-maker-root #token-canonical-url')).toHaveValue(
      'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnO&sz=w2000'
    );

    await expect(page.locator('#token-maker-root #btn-generate-token')).toBeEnabled();
    await page.click('#token-maker-root #btn-generate-token');

    // ⭐ C'est le pion RÉELLEMENT produit qu'on interroge, pas l'état du formulaire.
    const token = await page.evaluate(
      () => /** @type {any} */ (window).__tokenMakerInstance.getCurrentToken()
    );
    expect(token.imageUrl).toBe('https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnO&sz=w2000');
  });

  test('Refuse un lien Google Drive qui ne désigne aucun fichier', async ({ page }) => {
    await setupTokenMaker(page);

    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'dossier.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await page.fill(
      '#token-maker-root #token-canonical-url',
      'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnO?usp=sharing'
    );

    await expect(page.locator('#token-maker-root #token-maker-status')).toContainText(
      'ne désigne pas un fichier'
    );
    await expect(page.locator('#token-maker-root #btn-generate-token')).toBeDisabled();

    // ⭐ Et si le bouton grisé sautait, la génération forcée refuse quand même : ce qu'on vérifie
    // est l'absence de pion produit, pas la couleur d'une ligne d'état.
    const refus = await page.evaluate(() => {
      try {
        /** @type {any} */ (window).__tokenMakerInstance.generateToken();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    });
    expect(refus).toContain('ne désigne pas un fichier');

    const token = await page.evaluate(
      () => /** @type {any} */ (window).__tokenMakerInstance.getCurrentToken()
    );
    expect(token).toBeNull();
  });

  test('Laisse passer inchangée une URL relative ordinaire', async ({ page }) => {
    await setupTokenMaker(page);

    await page.setInputFiles('#token-maker-root #token-file-input', {
      name: 'ordinaire.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await page.fill('#token-maker-root #token-canonical-url', 'maps/tokens/x.webp');
    await expect(page.locator('#token-maker-root #token-canonical-url')).toHaveValue(
      'maps/tokens/x.webp'
    );

    await page.click('#token-maker-root #btn-generate-token');
    const token = await page.evaluate(
      () => /** @type {any} */ (window).__tokenMakerInstance.getCurrentToken()
    );
    expect(token.imageUrl).toBe('maps/tokens/x.webp');
  });
});

// F5 (audit du 22/09/2026) — deux silences du créateur de pions.
test('F5 : une image illisible est signalée, et une URL https n’est pas racinée en /https://', async ({ page }) => {
  await setupTokenMaker(page);

  // 1. Un fichier annoncé image mais que le navigateur ne décode pas (HEIC d'un iPhone).
  await page.setInputFiles('#token-maker-root #token-file-input', {
    name: 'photo.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('pas une image décodable'),
  });
  await expect(page.locator('#token-maker-root #token-maker-status')).toContainText('illisible');

  // 2. Rééditer un pion dont l'image est une URL https : l'aperçu la charge telle quelle.
  const demandees = /** @type {string[]} */ ([]);
  page.on('request', (req) => demandees.push(req.url()));
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG_BUFFER })
  );
  await page.evaluate(() =>
    /** @type {any} */ (window).__tokenMakerInstance.populateFromToken({
      id: 'p1', label: 'Héros', imageUrl: 'https://images.example.test/heros.png',
    })
  );
  await expect.poll(() => demandees.some((u) => u === 'https://images.example.test/heros.png')).toBe(true);
  expect(demandees.some((u) => u.includes('/https://'))).toBe(false);
});
