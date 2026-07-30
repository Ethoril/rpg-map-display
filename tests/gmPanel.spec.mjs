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
  await page.waitForSelector('.gm-tab-btn[data-tab="import-uvtt"]');

  expect(errors).toEqual([]);
}

test.describe('T-22 — Panneau MJ & Import (Fin Lot 1a)', () => {
  test('Diagnostic UVTT : aucun champ URL, la base64 reste en aperçu et n entre pas dans le store', async ({
    page,
  }) => {
    await setupGMView(page);

    // Basculer sur l'onglet UVTT
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

  test('Diagnostic Image : calibration 10x8 cases x 140px sans URL ni base64 persistée', async ({
    page,
  }) => {
    await setupGMView(page);

    // Basculer sur l'onglet Image
    await page.click('.gm-tab-btn[data-tab="import-image"]');

    // U-06 : plus aucune URL à saisir dans ce parcours
    await expect(page.locator('#image-canonical-url')).toHaveCount(0);
    await expect(page.locator('#btn-validate-image-import')).toBeDisabled();

    // Charger l'image de test (100x100 px)
    await page.setInputFiles('#image-file-input', {
      name: 'map-test.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    await expect(page.locator('#btn-validate-image-import')).toBeEnabled();

    // Remplir les paramètres de calibration : 10 cases large, 8 cases haut, 140 px/case
    await page.fill('#img-cells-wide', '10');
    await page.fill('#img-cells-tall', '8');
    await page.fill('#img-px-per-cell', '140');

    // Valider l'importation
    await page.click('#btn-validate-image-import');

    const statusText = page.locator('#image-status');
    await expect(statusText).toBeVisible();
    await expect(statusText).toContainText('aperçu local');

    // Vérifier les propriétés de l'étage dans le store
    const activeLevel = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel();
    });

    expect(activeLevel).not.toBeNull();
    expect(activeLevel?.widthCells).toBe(10);
    expect(activeLevel?.heightCells).toBe(8);
    expect(activeLevel?.pxPerCell).toBe(140);
    expect(activeLevel?.grid.type).toBe('square');
    expect(activeLevel?.imageUrl).toBe('');
  });

  test('Générateur de Pions & Réglages Grille : pion créé et grille modifiée', async ({ page }) => {
    await setupGMView(page);

    // 1. D'abord importer un étage pour avoir un niveau actif
    await page.click('.gm-tab-btn[data-tab="import-image"]');
    await page.setInputFiles('#image-file-input', {
      name: 'map-test.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    // Attendre la fin du chargement de l'image avant de calibrer : son `onload`
    // écrase les cases suggérées (importPanel.js), et écraserait donc 10×8 s'il
    // arrivait après ces `fill`. Un étage 1×1 refuserait ensuite le pion 2×2.
    await expect(page.locator('#btn-validate-image-import')).toBeEnabled();

    await page.fill('#img-cells-wide', '10');
    await page.fill('#img-cells-tall', '8');
    await page.click('#btn-validate-image-import');

    // 2. Aller dans l'onglet Pions et générer un pion
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
    expect(addedToken?.imageUrl.startsWith('data:')).toBe(false);

    // 3. Aller dans l'onglet Grille et modifier les réglages
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
  });

  test('PC6 Validation : synchronisation du pion créé et déplacé vers le store', async ({ page }) => {
    await setupGMView(page);

    // Importer étage et ajouter un pion
    await page.click('.gm-tab-btn[data-tab="import-image"]');
    await page.setInputFiles('#image-file-input', {
      name: 'dungeon.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });
    await page.click('#btn-validate-image-import');

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
    expect(state.token?.imageUrl.startsWith('data:')).toBe(false);
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
});
