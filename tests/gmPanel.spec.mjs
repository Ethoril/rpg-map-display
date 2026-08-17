// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';

// Image PNG 100x100 valide pour les tests d'import
const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwvjb3YAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVHic7cExAQAAAMKg9U9tCj8gAAAAAAB4BhVMAAFxPbfKAAAAAElFTkSuQmCC';
const TEST_PNG_BUFFER = Buffer.from(TEST_PNG_BASE64, 'base64');

// Charge le fichier fixture minimal.uvtt
const MINIMAL_UVTT_PATH = path.resolve('fixtures/synthetic/minimal.uvtt');
const MINIMAL_UVTT_CONTENT = fs.readFileSync(MINIMAL_UVTT_PATH, 'utf-8');

/**
 * Monte la vue MJ (gm.html) et initialise l'application GM.
 * @param {import('@playwright/test').Page} page
 */
async function setupGMView(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => {
    console.error('Page error in Playwright test:', err.message);
    errors.push(err.message);
  });

  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('firebaseio.com') || url.includes('firestore.googleapis.com')) {
      throw new Error(`Trafic réseau Firebase détecté pendant le test : ${url}`);
    }
  });

  await page.goto('/gm.html');
  await page.waitForSelector('.gm-tab-btn[data-tab="token-maker"]');

  expect(errors).toEqual([]);
}

test.describe('R0 — navigation et rendu sûr du panneau MJ', () => {
  test('les dix onglets restent accessibles sans débordement à 1280 et 1024 px', async ({ page }) => {
    for (const width of [1280, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await setupGMView(page);

      // Mode Jouer (4 onglets visibles)
      const layoutPlay = await page.evaluate(() => {
        const header = /** @type {HTMLElement} */ (document.querySelector('.gm-tabs-header'));
        const panel = /** @type {HTMLElement} */ (document.querySelector('#gm-panel'));
        const headerRect = header.getBoundingClientRect();
        const tabs = [...header.querySelectorAll('.gm-tab-btn')]
          .filter((tab) => /** @type {HTMLElement} */ (tab).style.display !== 'none')
          .map((tab) => {
            const rect = tab.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
        return {
          documentFits: document.documentElement.scrollWidth <= window.innerWidth,
          panelFits: panel.scrollWidth <= panel.clientWidth,
          headerFits: header.scrollWidth <= header.clientWidth,
          allTabsVisible: tabs.length === 4 && tabs.every(
            (tab) =>
              tab.left >= headerRect.left &&
              tab.right <= headerRect.right &&
              tab.top >= headerRect.top &&
              tab.bottom <= headerRect.bottom
          ),
        };
      });
      expect(layoutPlay).toEqual({ documentFits: true, panelFits: true, headerFits: true, allTabsVisible: true });

      // Mode Préparer (6 onglets visibles)
      await page.click('#gm-mode-prep');
      const layoutPrep = await page.evaluate(() => {
        const header = /** @type {HTMLElement} */ (document.querySelector('.gm-tabs-header'));
        const panel = /** @type {HTMLElement} */ (document.querySelector('#gm-panel'));
        const headerRect = header.getBoundingClientRect();
        const tabs = [...header.querySelectorAll('.gm-tab-btn')]
          .filter((tab) => /** @type {HTMLElement} */ (tab).style.display !== 'none')
          .map((tab) => {
            const rect = tab.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          });
        return {
          documentFits: document.documentElement.scrollWidth <= window.innerWidth,
          panelFits: panel.scrollWidth <= panel.clientWidth,
          headerFits: header.scrollWidth <= header.clientWidth,
          allTabsVisible: tabs.length === 6 && tabs.every(
            (tab) =>
              tab.left >= headerRect.left &&
              tab.right <= headerRect.right &&
              tab.top >= headerRect.top &&
              tab.bottom <= headerRect.bottom
          ),
        };
      });
      expect(layoutPrep).toEqual({ documentFits: true, panelFits: true, headerFits: true, allTabsVisible: true });
    }
  });

  test('les onglets exposent leur relation aux panneaux et se pilotent au clavier', async ({ page }) => {
    await setupGMView(page);
    await expect(page.locator('.gm-tab-btn')).toHaveCount(10);
    const visibleTabs = page.getByRole('tab');
    await expect(visibleTabs).toHaveCount(4);
    await expect(page.locator('.gm-tabs-header')).toHaveAttribute('role', 'tablist');
    await expect(page.locator('#gm-tab-token-maker')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-content-token-maker')).toHaveAttribute(
      'aria-labelledby',
      'gm-tab-token-maker'
    );

    await page.locator('#gm-tab-token-maker').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#gm-tab-handouts')).toBeFocused();
    await expect(page.locator('#gm-tab-handouts')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-content-handouts')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#tab-content-token-maker')).toHaveAttribute('hidden', '');
  });

  test('un nom ou avertissement UVTT hostile reste du texte, y compris après chargement', async ({ page }) => {
    await setupGMView(page);
    await page.click('#gm-mode-prep');
    await page.click('.gm-tab-btn[data-tab="import-uvtt"]');
    const hostile = '<img data-r0-xss="uvtt" src=x>';
    const uvtt = JSON.stringify({
      name: hostile,
      resolution: { map_size: { x: 10, y: 8 }, pixels_per_grid: 64 },
      lights: [{ id: hostile, position: { x: 1, y: 1 }, color: hostile }],
    });

    await page.setInputFiles('#uvtt-file-input', {
      name: 'hostile.uvtt',
      mimeType: 'application/json',
      buffer: Buffer.from(uvtt, 'utf-8'),
    });
    await expect(page.locator('#uvtt-status')).toContainText(hostile);
    await expect(page.locator('#uvtt-status [data-r0-xss="uvtt"]')).toHaveCount(0);

    await page.click('#btn-validate-uvtt-import');
    await expect(page.locator('#uvtt-status')).toContainText(hostile);
    await expect(page.locator('#uvtt-status [data-r0-xss="uvtt"]')).toHaveCount(0);

    const overlay = await page.evaluate(async (label) => {
      const { showEvictionOverlay } = await import('../js/app/session.js');
      const result = showEvictionOverlay({ label, sessionId: label, onReconnect: () => {} });
      const element = result?.element;
      const proof = {
        text: element?.textContent ?? '',
        injected: Boolean(element?.querySelector('[data-r0-xss="uvtt"]')),
      };
      result?.remove();
      return proof;
    }, hostile);
    expect(overlay).toEqual({ text: expect.stringContaining(hostile), injected: false });
  });
});

test.describe('T-22 — Panneau MJ & Import (Fin Lot 1a)', () => {
  test('Diagnostic UVTT : aucun champ URL, la base64 reste en aperçu et n entre pas dans le store', async ({
    page,
  }) => {
    await setupGMView(page);

    // Basculer sur le mode Préparer puis sur l'onglet UVTT
    await page.click('#gm-mode-prep');
    await page.click('.gm-tab-btn[data-tab="import-uvtt"]');

    // U-06 : plus aucune URL à saisir dans ce parcours
    await expect(page.locator('#uvtt-canonical-url')).toHaveCount(0);

    // Tant qu'aucun fichier n'est parsé, rien n'est chargeable
    await expect(page.locator('#btn-validate-uvtt-import')).toBeDisabled();

    // Importer le fichier minimal.uvtt
    await page.setInputFiles('#uvtt-file-input', {
      name: 'minimal.uvtt',
      mimeType: 'application/json',
      buffer: Buffer.from(MINIMAL_UVTT_CONTENT, 'utf-8'),
    });

    // Le chargement du fichier seul reste un aperçu local et ne touche pas le store.
    const statusText = page.locator('#uvtt-status');
    await expect(statusText).toBeVisible();
    await expect(statusText).toContainText('Aperçu UVTT local chargé');

    const beforeLoad = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel();
    });
    expect(beforeLoad).toBeNull();

    // L'aperçu affiché dans le panneau, lui, utilise bien la base64
    await expect(page.locator('#uvtt-local-preview')).toHaveAttribute('src', /^data:/);

    await expect(page.locator('#btn-validate-uvtt-import')).toBeEnabled();
    await page.click('#btn-validate-uvtt-import');
    await expect(statusText).toContainText('aperçu local');

    // La géométrie parsée arrive dans le store…
    const activeLevel = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel();
    });

    expect(activeLevel).not.toBeNull();
    expect(activeLevel?.widthCells).toBe(10);
    expect(activeLevel?.heightCells).toBe(8);
    expect(activeLevel?.pxPerCell).toBe(64);

    // …mais JAMAIS l'image encodée : c'est l'invariant dur du projet.
    expect(activeLevel?.imageUrl).toBe('');
  });

  test('Diagnostic Image : import avec URL, calibration et publication vers le store et la vue joueurs', async ({
    context,
  }) => {
    const sessionId = `test-img-${Date.now()}`;
    const initialLevel = createLevel({
      id: 'lvl-initial',
      name: 'Rez-de-chaussée',
      imageUrl: '',
      widthCells: 20,
      heightCells: 15,
      pxPerCell: 140,
    });
    const snapshot = {
      campaign: createCampaign({
        campaignId: 'c-test-img',
        name: 'Test Image Sync',
        levels: [initialLevel],
      }),
      activeLevelId: 'lvl-initial',
      selectedTokenId: null,
    };

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, snapshot);
    await installBrowserTransport(pagePlayer, sessionId, snapshot);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    // Basculer sur le mode Préparer puis sur l'onglet Image
    await pageGM.click('#gm-mode-prep');
    await pageGM.click('.gm-tab-btn[data-tab="import-image"]');

    const btnValidate = pageGM.locator('#btn-validate-image-import');
    const urlInput = pageGM.locator('#image-url-input');
    const errorMsg = pageGM.locator('#image-error-msg');

    await expect(btnValidate).toBeDisabled();

    // 1. Lien Google Drive dossier inexploitable
    await urlInput.fill('https://drive.google.com/drive/folders/1234567890abcdef');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('Ce lien Google Drive ne désigne pas un fichier');
    await expect(btnValidate).toBeDisabled();

    // 2. URL non persistable (data: / blob:)
    await urlInput.fill('data:image/png;base64,AAAA');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText('URL non persistable');
    await expect(btnValidate).toBeDisabled();

    // 3. Lien Google Drive fichier : converti en URL CDN
    await urlInput.fill('https://drive.google.com/file/d/1234567890abcdef_xyz/view?usp=sharing');
    await expect(urlInput).toHaveValue(
      'https://drive.google.com/thumbnail?id=1234567890abcdef_xyz&sz=w2000'
    );

    // 4. URL inexistante / inaccessible
    await urlInput.fill('maps/fichier-inexistant-404.png');
    await expect(errorMsg).toBeVisible();
    await expect(errorMsg).toContainText("L'image n'a pas pu être chargée");
    await expect(btnValidate).toBeDisabled();

    // 5. URL valide
    await urlInput.fill('maps/minimal.webp');
    await expect(errorMsg).toBeHidden();
    await expect(btnValidate).toBeEnabled();

    // Remplir les paramètres de calibration : 10 cases large, 8 cases haut, 140 px/case
    await pageGM.fill('#img-cells-wide', '10');
    await pageGM.fill('#img-cells-tall', '8');
    await pageGM.fill('#img-px-per-cell', '140');

    // Valider l'importation
    await btnValidate.click();

    const statusText = pageGM.locator('#image-status');
    await expect(statusText).toBeVisible();
    await expect(statusText).toContainText('chargé et publié');

    // Récupérer les données du store GM après import
    const { initialId, gmActiveLevelId, newLevel } = await pageGM.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const levels = store.getCampaign()?.levels ?? [];
      const created = levels[levels.length - 1];
      return {
        initialId: levels[0]?.id,
        gmActiveLevelId: store.getActiveLevelId(),
        newLevel: created,
      };
    });

    expect(newLevel).not.toBeNull();
    expect(newLevel?.widthCells).toBe(10);
    expect(newLevel?.heightCells).toBe(8);
    expect(newLevel?.pxPerCell).toBe(140);
    expect(newLevel?.grid.type).toBe('square');
    expect(newLevel?.imageUrl).toBe('maps/minimal.webp');

    // Le MJ n'a PAS été déplacé par l'importation d'un nouvel étage
    expect(gmActiveLevelId).toBe(initialId);

    // ⭐ Temps 1 (Après import) : La vue joueurs reçoit l'étage dans sa campagne avec imageUrl,
    // mais ne bascule PAS dessus et n'affiche PAS la nouvelle image
    await pagePlayer.waitForFunction(async (expectedUrl) => {
      const store = await import('../js/state/store.js');
      const levels = store.getCampaign()?.levels ?? [];
      return levels.some((l) => l.imageUrl === expectedUrl);
    }, 'maps/minimal.webp');

    const playerStateBeforeSwitch = await pagePlayer.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      return {
        activeLevelId: store.getActiveLevelId(),
        bgUrl: app.backgroundLayer.currentUrl,
      };
    });
    expect(playerStateBeforeSwitch.activeLevelId).toBe(initialId);
    expect(playerStateBeforeSwitch.bgUrl).not.toBe('maps/minimal.webp');

    // ⭐ Temps 2 : Le MJ bascule d'étage par la barre, et alors seulement la tablette affiche la carte
    await pageGM.selectOption('#gm-level-select', newLevel.id);

    await pagePlayer.waitForFunction(async (targetId) => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevelId() === targetId;
    }, newLevel.id);

    // ⚠ `expect.poll`, et surtout PAS un relevé pris juste après le `waitForFunction` ci-dessus.
    // L'étage actif change **avant** le rendu, donc avant que `load()` soit seulement appelé, et le
    // décodage de l'image est asynchrone : un relevé immédiat attrape `status: 'loading'`. La
    // première version passait en local — un aller-retour Playwright coûte assez de millisecondes
    // pour décoder un webp minuscule — et c'est exactement la forme des rouges CI-seulement que ce
    // dépôt a déjà payés deux fois (`QUESTIONS-EN-ATTENTE.md` §F).
    await expect
      .poll(
        () =>
          pagePlayer.evaluate(() => {
            const app = /** @type {any} */ (window).__RPG_APP__;
            return {
              status: app.backgroundLayer.status,
              currentUrl: app.backgroundLayer.currentUrl,
            };
          }),
        { timeout: 8000 }
      )
      .toEqual({ status: 'ready', currentUrl: 'maps/minimal.webp' });
  });

  test('Générateur de Pions & Réglages Grille : pion créé et grille modifiée', async ({ page }) => {
    await setupGMView(page);

    // 1. D'abord importer un étage pour avoir un niveau actif
    await page.click('#gm-mode-prep');
    await page.click('.gm-tab-btn[data-tab="import-image"]');
    await page.fill('#image-url-input', 'maps/minimal.webp');
    await expect(page.locator('#btn-validate-image-import')).toBeEnabled();

    await page.fill('#img-cells-wide', '10');
    await page.fill('#img-cells-tall', '8');
    await page.click('#btn-validate-image-import');

    // 2. Aller dans l'onglet Pions et générer un pion
    await page.click('#gm-mode-play');
    await page.click('.gm-tab-btn[data-tab="token-maker"]');
    await page.setInputFiles('#token-file-input', {
      name: 'hero.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await page.fill('#token-label', 'Chevalier');
    await page.fill('#token-size-cells', '2');
    await page.click('#btn-generate-token');

    // Vérifier que le pion a été directement ajouté aux tokens du store
    const tokens = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const campaign = store.getCampaign();
      return campaign ? campaign.tokens : [];
    });

    expect(tokens.length).toBeGreaterThan(0);
    const addedToken = tokens.find((/** @type {any} */ t) => t.label === 'Chevalier');
    expect(addedToken).toBeDefined();
    expect(addedToken?.sizeCells).toBe(2);
    expect(addedToken?.levelId).toBe(
      await page.evaluate(async () => (await import('../js/state/store.js')).getActiveLevelId())
    );
    // Le pion généré embarque son image, bornée : c'est ce qui le rend visible
    // immédiatement des deux côtés. Le plafond est la garde qui protège le document
    // Firestore, et il doit tenir jusque dans le store.
    expect(addedToken?.imageUrl).toMatch(/^data:image\/(webp|png);base64,/);
    expect(addedToken?.imageUrl.length).toBeLessThanOrEqual(24 * 1024);

    // 3. Aller dans l'onglet Grille et modifier les réglages
    await page.click('#gm-mode-prep');
    await page.click('.gm-tab-btn[data-tab="grid-settings"]');

    /** Relit la grille de l'étage actif depuis le store. */
    const readGrid = () =>
      page.evaluate(async () => {
        const store = await import('../js/state/store.js');
        return store.getActiveLevel()?.grid;
      });

    await page.fill('#grid-color', '#0000ff');
    expect((await readGrid())?.color).toBe('#0000ff');

    // `#grid-visible` et `#grid-opacity` mutent l'étage *et* sont diffusés aux
    // joueurs via `level.grid`. Ils étaient atteignables et jamais cliqués :
    // exactement le profil du bug de U-04. On les exerce pour de vrai.
    // Précondition : sans elle, décocher pourrait passer à vide.
    expect((await readGrid())?.visible).toBe(true);

    await page.uncheck('#grid-visible');
    expect((await readGrid())?.visible).toBe(false);

    await page.check('#grid-visible');
    expect((await readGrid())?.visible).toBe(true);

    await page.fill('#grid-opacity', '0.6');
    expect((await readGrid())?.opacity).toBe(0.6);
    await expect(page.locator('#grid-opacity-val')).toHaveText('0.6');

    // ⭐ Le pavage, ouvert le 13/08/2026. La liste était `disabled` et n'offrait que « Carrée »
    // tant que `HexGrid` n'existait pas ; `updateGridFromUI` posait en plus `type = 'square'` **en
    // dur**. Les deux tenaient ensemble : rétablir la constante laisserait la liste changer à
    // l'écran sans que l'étage bouge, ce qu'aucune vérification d'affichage ne verrait.
    await expect(page.locator('#grid-type')).toBeEnabled();
    expect((await readGrid())?.type).toBe('square');

    await page.selectOption('#grid-type', 'hex');
    expect((await readGrid())?.type).toBe('hex');

    // Et le retour, sinon on ne prouve que le sens facile.
    await page.selectOption('#grid-type', 'square');
    expect((await readGrid())?.type).toBe('square');
  });

  test('PC6 Validation : synchronisation du pion créé et déplacé vers le store', async ({ page }) => {
    await setupGMView(page);

    // Importer étage et ajouter un pion
    await page.click('#gm-mode-prep');
    await page.click('.gm-tab-btn[data-tab="import-image"]');
    await page.fill('#image-url-input', 'maps/minimal.webp');
    await expect(page.locator('#btn-validate-image-import')).toBeEnabled();
    await page.click('#btn-validate-image-import');

    await page.click('#gm-mode-play');
    await page.click('.gm-tab-btn[data-tab="token-maker"]');
    await page.setInputFiles('#token-file-input', {
      name: 'dragon.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });
    await page.fill('#token-label', 'Dragon');
    await page.click('#btn-generate-token');

    // Vérifier que l'état du store contient l'étage et le pion
    const state = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return {
        level: store.getActiveLevel(),
        token: store.getCampaign()?.tokens.find((/** @type {any} */ t) => t.label === 'Dragon'),
      };
    });

    expect(state.level).not.toBeNull();
    expect(state.token).toBeDefined();
    expect(state.token?.label).toBe('Dragon');
    expect(state.token?.levelId).toBe(state.level?.id);
    expect(state.token?.imageUrl).toMatch(/^data:image\/(webp|png);base64,/);
    expect(state.token?.imageUrl.length).toBeLessThanOrEqual(24 * 1024);
  });

  test('Quitter la session : efface le code mémorisé et ramène à l accueil', async ({ page }) => {
    await page.goto('/gm.html?session=A7K2M');
    await waitForApp(page);

    // Le code est affiché dans la barre de session, pour être dicté à la tablette.
    await expect(page.locator('#gm-session-code')).toHaveText('A7K2M');

    await page.evaluate(() => {
      window.sessionStorage.setItem('rpg-gm-session-id', 'A7K2M');
    });

    page.on('dialog', (dialog) => dialog.accept());
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/index.html')),
      page.click('#gm-leave-session'),
    ]);

    // Le code mémorisé a disparu : sans cela, revenir sur gm.html rejoindrait la même
    // session, ce qui est précisément le symptôme que ce bouton corrige.
    const memorise = await page.evaluate(() =>
      window.sessionStorage.getItem('rpg-gm-session-id')
    );
    expect(memorise).toBeNull();
  });

  test('Quitter la session : refuser la confirmation ne change rien', async ({ page }) => {
    await page.goto('/gm.html?session=B4XQ9');
    await waitForApp(page);

    await page.evaluate(() => {
      window.sessionStorage.setItem('rpg-gm-session-id', 'B4XQ9');
    });

    page.on('dialog', (dialog) => dialog.dismiss());
    await page.click('#gm-leave-session');

    // Toujours sur la vue MJ, et le code toujours mémorisé.
    expect(new URL(page.url()).pathname).toMatch(/gm\.html$/);
    const memorise = await page.evaluate(() =>
      window.sessionStorage.getItem('rpg-gm-session-id')
    );
    expect(memorise).toBe('B4XQ9');
  });

  test('Contrôle d élévation MJ : désactivé sans sélection, actif avec pion sélectionné', async ({ page }) => {
    await setupGMView(page);

    await page.click('.gm-tab-btn[data-tab="token-maker"]');

    const elevationInput = page.locator('#token-elevation');
    await expect(elevationInput).toBeDisabled();
    await expect(page.locator('#token-elevation-label')).toHaveText('(aucun pion sélectionné)');

    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const schema = await import('../js/core/schema.js');
      const lvl = schema.createLevel({ id: 'l1', name: 'Niveau 1' });
      const tok = schema.createToken({ id: 't1', levelId: 'l1', label: 'Mage' });
      const camp = schema.createCampaign({
        campaignId: 'c1',
        name: 'Campagne',
        levels: [lvl],
        tokens: [tok],
      });
      store.loadCampaign(camp);
      store.setSelection('t1');
    });

    await expect(elevationInput).toBeEnabled();
    await expect(page.locator('#token-elevation-label')).toContainText('Mage');
    await expect(elevationInput).toHaveValue('0');

    await elevationInput.fill('4');
    await elevationInput.dispatchEvent('change');

    const elevation = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getSelectedToken()?.elevation;
    });
    expect(elevation).toBe(4);
  });

  test('Synchronisation 2 vraies pages : modification d élévation répercutée via token.elevation', async ({ context }) => {
    const sessionId = `test-elevation-sync-${Date.now()}`;
    const level = createLevel({ id: 'l1', name: 'Etage', imageUrl: 'maps/minimal.webp' });
    const token = createToken({ id: 't1', levelId: 'l1', cell: { a: 1, b: 1 }, label: 'Héros' });
    const snapshot = {
      campaign: createCampaign({
        campaignId: 'c-sync',
        name: 'Sync',
        levels: [level],
        tokens: [token],
      }),
      activeLevelId: 'l1',
      selectedTokenId: null,
    };

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, snapshot);
    await installBrowserTransport(pagePlayer, sessionId, snapshot);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await pageGM.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.setSelection('t1');
    });

    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');

    // Valider la valeur comme le fait un utilisateur : `change`, pas `input`. Les deux
    // opérations sont faites dans la même tâche à dessein — `updateElevationUIFromStore`
    // réécrit la valeur de l'input à chaque notification du store, et une notification
    // arrivant entre la saisie et la validation la ramènerait à 0.
    await pageGM.evaluate(() => {
      const input = /** @type {HTMLInputElement} */ (document.querySelector('#token-elevation'));
      input.value = '3';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect.poll(() =>
      pagePlayer.evaluate(async () => {
        const store = await import('../js/state/store.js');
        const tok = store.getCampaign()?.tokens.find((/** @type {any} */ t) => t.id === 't1');
        return tok?.elevation;
      })
    ).toBe(3);

    const published = await pageGM.evaluate(
      () => /** @type {any} */ (window).__RPG_TEST_WIRE__.published
    );
    const elevationEvents = published.filter((/** @type {any} */ e) => e.type === 'token.elevation');
    expect(elevationEvents).toHaveLength(1);
    expect(elevationEvents[0].payload).toEqual({ tokenId: 't1', elevation: 3 });

    await pageGM.close();
    await pagePlayer.close();
  });

  test('Édition du pion MJ : champs désactivés sans sélection, et un patch invalide ne mute rien', async ({
    page,
  }) => {
    await setupGMView(page);
    await page.click('.gm-tab-btn[data-tab="token-maker"]');

    await expect(page.locator('#token-edit-label')).toBeDisabled();
    await expect(page.locator('#btn-delete-token')).toBeDisabled();

    // Étage de 40x30 cases : un pion posé en (38,28) ne peut pas passer en 4x4.
    await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const schema = await import('../js/core/schema.js');
      store.loadCampaign(
        schema.createCampaign({
          campaignId: 'c-edit',
          name: 'Campagne',
          levels: [schema.createLevel({ id: 'l1', name: 'Niveau 1' })],
          tokens: [
            schema.createToken({ id: 't1', levelId: 'l1', cell: { a: 38, b: 28 }, label: 'Mage' }),
          ],
        })
      );
      store.setSelection('t1');
    });

    await expect(page.locator('#token-edit-label')).toBeEnabled();
    await expect(page.locator('#btn-delete-token')).toBeEnabled();
    await expect(page.locator('#token-edit-label')).toHaveValue('Mage');

    // Renommage nominal.
    await page.evaluate(() => {
      const input = /** @type {HTMLInputElement} */ (document.querySelector('#token-edit-label'));
      input.value = 'Archimage';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(
      await page.evaluate(async () =>
        (await import('../js/state/store.js')).getSelectedToken()?.label
      )
    ).toBe('Archimage');

    // Un nom vide est refusé, et le champ revient à la valeur du store — afficher encore
    // le vide laisserait croire à un renommage qui n'a pas eu lieu.
    await page.evaluate(() => {
      const input = /** @type {HTMLInputElement} */ (document.querySelector('#token-edit-label'));
      input.value = '   ';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#token-edit-label')).toHaveValue('Archimage');
    await expect(page.locator('#token-edit-status')).toContainText('ne peut pas être vide');

    // Agrandissement refusé par la validation de campagne : le store lève, l'interface se
    // remet d'accord avec lui plutôt que de garder 4 à l'écran.
    await page.evaluate(() => {
      const input = /** @type {HTMLInputElement} */ (document.querySelector('#token-edit-size-cells'));
      input.value = '4';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#token-edit-status')).toContainText('hors limites');
    await expect(page.locator('#token-edit-size-cells')).toHaveValue('1');
    expect(
      await page.evaluate(async () =>
        (await import('../js/state/store.js')).getSelectedToken()?.sizeCells
      )
    ).toBe(1);
  });

  test('Synchronisation 2 vraies pages : édition puis suppression du pion via token.update et token.delete', async ({
    context,
  }) => {
    const sessionId = `test-token-edit-sync-${Date.now()}`;
    const level = createLevel({ id: 'l1', name: 'Etage', imageUrl: 'maps/minimal.webp' });
    const token = createToken({ id: 't1', levelId: 'l1', cell: { a: 1, b: 1 }, label: 'Héros' });
    const snapshot = {
      campaign: createCampaign({
        campaignId: 'c-sync-edit',
        name: 'Sync',
        levels: [level],
        tokens: [token],
      }),
      activeLevelId: 'l1',
      selectedTokenId: null,
    };

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, snapshot);
    await installBrowserTransport(pagePlayer, sessionId, snapshot);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);
    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await pageGM.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.setSelection('t1');
    });
    await pageGM.click('.gm-tab-btn[data-tab="token-maker"]');

    // 1. Masquer le pion aux joueurs : la case à cocher voyage en `token.update`.
    await pageGM.click('#token-edit-hidden');
    await expect
      .poll(() =>
        pagePlayer.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getCampaign()?.tokens.find((/** @type {any} */ t) => t.id === 't1')?.hidden;
        })
      )
      .toBe(true);

    // 2. Supprimer le pion. La confirmation est acceptée : sans réponse au `confirm`, le
    // navigateur piloté la rejette par défaut et le test passerait pour une mauvaise raison.
    pageGM.once('dialog', (dialog) => dialog.accept());
    await pageGM.click('#btn-delete-token');

    await expect
      .poll(() =>
        pagePlayer.evaluate(async () => {
          const store = await import('../js/state/store.js');
          return store.getCampaign()?.tokens.length;
        })
      )
      .toBe(0);

    // Côté MJ, la suppression du pion sélectionné vide la sélection, donc désactive les
    // contrôles : ils ne doivent pas rester actifs sur un pion absent.
    await expect(pageGM.locator('#btn-delete-token')).toBeDisabled();
    await expect(pageGM.locator('#token-edit-label')).toBeDisabled();

    const published = await pageGM.evaluate(
      () => /** @type {any} */ (window).__RPG_TEST_WIRE__.published
    );
    const updates = published.filter((/** @type {any} */ e) => e.type === 'token.update');
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ tokenId: 't1', patch: { hidden: true } });

    const deletes = published.filter((/** @type {any} */ e) => e.type === 'token.delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].payload).toEqual({ tokenId: 't1' });

    await pageGM.close();
    await pagePlayer.close();
  });
});

test.describe('UX-03 — Modes Jouer et Préparer', () => {
  test('1. Mode Jouer (défaut) affiche 4 onglets, mode Préparer affiche 6 onglets', async ({ page }) => {
    await setupGMView(page);

    // Par défaut : mode Jouer
    await expect(page.locator('#gm-mode-play')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#gm-mode-prep')).toHaveAttribute('aria-pressed', 'false');

    const playTabs = page.locator('.gm-tab-btn:visible');
    await expect(playTabs).toHaveCount(4);
    await expect(page.locator('#gm-tab-token-maker')).toBeVisible();
    await expect(page.locator('#gm-tab-handouts')).toBeVisible();
    await expect(page.locator('#gm-tab-fog-tools')).toBeVisible();
    await expect(page.locator('#gm-tab-template-tools')).toBeVisible();

    // Basculer en mode Préparer
    await page.click('#gm-mode-prep');
    await expect(page.locator('#gm-mode-play')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#gm-mode-prep')).toHaveAttribute('aria-pressed', 'true');

    const prepTabs = page.locator('.gm-tab-btn:visible');
    await expect(prepTabs).toHaveCount(6);
    await expect(page.locator('#gm-tab-scene-library')).toBeVisible();
    await expect(page.locator('#gm-tab-import-uvtt')).toBeVisible();
    await expect(page.locator('#gm-tab-import-image')).toBeVisible();
    await expect(page.locator('#gm-tab-wall-editor')).toBeVisible();
    await expect(page.locator('#gm-tab-link-editor')).toBeVisible();
    await expect(page.locator('#gm-tab-grid-settings')).toBeVisible();

    // Revenir en mode Jouer
    await page.click('#gm-mode-play');
    await expect(page.locator('.gm-tab-btn:visible')).toHaveCount(4);
  });

  test('2. Un outil armé en mode Jouer reste armé lors du passage en Préparer et du retour en Jouer (Critère 2 & 7)', async ({
    page,
  }) => {
    await setupGMView(page);

    // Armer le fog en mode Jouer
    await page.click('#gm-tab-fog-tools');
    await page.click('#fog-btn-tool-reveal');

    let activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('fog-reveal');

    // Basculer en mode Préparer : l'outil DOIT rester armé, et le bandeau d'alerte/rappel doit apparaître (Critère 7)
    await page.click('#gm-mode-prep');

    activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('fog-reveal');

    const banner = page.locator('#gm-active-tool-banner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#gm-active-tool-text')).toContainText('Brouillard');

    // Revenir en mode Jouer : l'outil est toujours armé, le bandeau disparaît et l'onglet porte .gm-tab-active-tool
    await page.click('#gm-mode-play');

    activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('fog-reveal');
    await expect(banner).not.toBeVisible();
    await expect(page.locator('#gm-tab-fog-tools')).toHaveClass(/gm-tab-active-tool/);
  });

  test('3. Désarmer un outil depuis le bandeau de rappel en mode Préparer (Critère 7)', async ({ page }) => {
    await setupGMView(page);

    // Armer le fog en mode Jouer
    await page.click('#gm-tab-fog-tools');
    await page.click('#fog-btn-tool-reveal');

    // Basculer en mode Préparer
    await page.click('#gm-mode-prep');
    await expect(page.locator('#gm-active-tool-banner')).toBeVisible();

    // Désarmer depuis le bouton du bandeau
    await page.click('#gm-disarm-active-tool');

    const activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('none');
    await expect(page.locator('#gm-active-tool-banner')).not.toBeVisible();
  });

  test('4. Une saisie en cours dans un formulaire survit à l\'aller-retour de mode (Critère 3)', async ({ page }) => {
    await setupGMView(page);

    // Remplir un champ dans le formulaire Pions (mode Jouer)
    await page.fill('#token-label', 'Gobelin Enragé');
    await expect(page.locator('#token-label')).toHaveValue('Gobelin Enragé');

    // Basculer en mode Préparer puis revenir en mode Jouer
    await page.click('#gm-mode-prep');
    await page.click('#gm-mode-play');

    // La valeur saisie est toujours intacte
    await expect(page.locator('#token-label')).toHaveValue('Gobelin Enragé');
  });
});
