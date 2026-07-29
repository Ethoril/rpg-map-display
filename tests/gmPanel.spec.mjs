// @ts-check
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Image PNG 100x100 valide pour les tests d'import
const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwvjb3YAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVHic7cExAQAAAMKg9U9tCj8gAAAAAAB4BhVMAAFxPbfKAAAAAElFTkSuQmCC';
const TEST_PNG_BUFFER = Buffer.from(TEST_PNG_BASE64, 'base64');

// Charge le fichier fixture minimal.uvtt
const MINIMAL_UVTT_PATH = path.resolve('fixtures/synthetic/minimal.uvtt');
const MINIMAL_UVTT_CONTENT = fs.readFileSync(MINIMAL_UVTT_PATH, 'utf-8');

/**
 * Monte la vue MJ (index.html) et initialise l'application GM.
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

  await page.goto('/index.html');
  await page.waitForSelector('.gm-tab-btn[data-tab="import-uvtt"]');

  expect(errors).toEqual([]);
}

test.describe('T-22 — Panneau MJ & Import (Fin Lot 1a)', () => {
  test('Importation UVTT : charge minimal.uvtt et crée l étage dans le store', async ({ page }) => {
    await setupGMView(page);

    // Basculer sur l'onglet UVTT
    await page.click('.gm-tab-btn[data-tab="import-uvtt"]');

    // Importer le fichier minimal.uvtt
    await page.setInputFiles('#uvtt-file-input', {
      name: 'minimal.uvtt',
      mimeType: 'application/json',
      buffer: Buffer.from(MINIMAL_UVTT_CONTENT, 'utf-8'),
    });

    // Vérifier l'affichage du message de succès dans l'interface
    const statusText = page.locator('#uvtt-status');
    await expect(statusText).toBeVisible();
    await expect(statusText).toContainText('importé avec succès');

    // Vérifier que le store contient l'étage UVTT importé
    const activeLevel = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return store.getActiveLevel();
    });

    expect(activeLevel).not.toBeNull();
    expect(activeLevel?.widthCells).toBe(10);
    expect(activeLevel?.heightCells).toBe(8);
    expect(activeLevel?.pxPerCell).toBe(64);
  });

  test('Importation Image Calibrée : importe une image 10x8 cases x 140px', async ({ page }) => {
    await setupGMView(page);

    // Basculer sur l'onglet Image
    await page.click('.gm-tab-btn[data-tab="import-image"]');

    // Charger l'image de test (100x100 px)
    await page.setInputFiles('#image-file-input', {
      name: 'map-test.png',
      mimeType: 'image/png',
      buffer: TEST_PNG_BUFFER,
    });

    // Attendre que le bouton soit activé (image chargée)
    await expect(page.locator('#btn-validate-image-import')).toBeEnabled();

    // Remplir les paramètres de calibration : 10 cases large, 8 cases haut, 140 px/case
    await page.fill('#img-cells-wide', '10');
    await page.fill('#img-cells-tall', '8');
    await page.fill('#img-px-per-cell', '140');

    // Valider l'importation
    await page.click('#btn-validate-image-import');

    const statusText = page.locator('#image-status');
    await expect(statusText).toBeVisible();
    await expect(statusText).toContainText('importée et calibrée avec succès');

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

    // 3. Aller dans l'onglet Grille et modifier les réglages
    await page.click('.gm-tab-btn[data-tab="grid-settings"]');
    await page.fill('#grid-color', '#0000ff');

    const updatedGrid = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const lvl = store.getActiveLevel();
      return lvl?.grid;
    });

    expect(updatedGrid?.color).toBe('#0000ff');
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
  });
});
