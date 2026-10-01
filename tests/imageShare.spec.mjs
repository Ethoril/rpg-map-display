// @ts-check
import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Chantier C-13 — « Partage d'image ». Le MJ choisit un fichier local, l'image réduite au format
 * TV transite par le nœud d'état de la session, la vue joueurs l'affiche en grand, et une croix la
 * ferme pour tous. ⛔ Rien n'est enregistré nulle part.
 *
 * Les images sont fabriquées ici (`pngNoir`) : aucun test ne lit le pool `maps/`.
 */

const LEVEL = {
  id: 'lvl',
  name: 'Carte',
  order: 0,
  imageUrl: '',
  videoUrl: null,
  animatedOverlays: [],
  pxPerCell: 100,
  widthCells: 10,
  heightCells: 10,
  grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
  terrainCost: null,
  walls: [],
  portals: [],
  lights: [],
  ambient: { level: 1, baked: false },
};

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'c-partage-image',
    name: 'Session partage d\'image',
    levels: [LEVEL],
    links: [],
    tokens: [],
    templates: [],
    settings: {},
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
};

/**
 * Fabrique un PNG en niveaux de gris de dimensions exactes, entièrement noir. Les dimensions sont
 * réelles — c'est ce que la réduction lit —, le poids reste de quelques kilo-octets.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
function pngNoir(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  /** @param {Buffer} buf */
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  /**
   * @param {string} type
   * @param {Buffer} data
   */
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 0; // niveaux de gris
  const raw = Buffer.alloc((width + 1) * height); // octet de filtre 0 + pixels noirs

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Ouvre un MJ et une vue joueurs sur la même session.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} prefixe
 */
async function ouvrir(context, prefixe) {
  const sessionId = `${prefixe}-${Date.now()}`;
  const pageGM = await context.newPage();
  const pagePlayer = await context.newPage();
  await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
  await installBrowserTransport(pagePlayer, sessionId, SNAPSHOT);
  await pageGM.goto(`/gm.html?session=${sessionId}`);
  await pagePlayer.goto(`/player.html?session=${sessionId}`);
  await waitForApp(pageGM);
  await waitForApp(pagePlayer);
  await pageGM.click('.gm-tab-btn[data-tab="image-share"]');
  await expect(pageGM.locator('#image-share-choose')).toBeVisible();
  return { sessionId, pageGM, pagePlayer };
}

/**
 * Choisit une image dans le sélecteur de fichier du MJ.
 * @param {import('@playwright/test').Page} pageGM
 * @param {number} width
 * @param {number} height
 */
async function choisir(pageGM, width, height) {
  await pageGM.setInputFiles('#image-share-file', {
    name: `monstre-${width}x${height}.png`,
    mimeType: 'image/png',
    buffer: pngNoir(width, height),
  });
}

/**
 * Largeur réellement décodée de l'image de l'overlay joueurs (0 si absente).
 * @param {import('@playwright/test').Page} pagePlayer
 */
const largeurDecodee = (pagePlayer) =>
  pagePlayer.evaluate(() => {
    const img = document.querySelector('#image-share-overlay img');
    return img instanceof HTMLImageElement ? img.naturalWidth : 0;
  });

const overlay = (/** @type {import('@playwright/test').Page} */ p) => p.locator('#image-share-overlay');
const croix = (/** @type {import('@playwright/test').Page} */ p) =>
  p.locator('#image-share-overlay button[aria-label="Fermer l\'image"]');

test.describe('Chantier C-13 — Partage d\'image', () => {
  test('1-3. Choix d\'un fichier, réduction au format TV, retour au F5, croix des joueurs', async ({
    context,
  }) => {
    const { sessionId, pageGM, pagePlayer } = await ouvrir(context, 'test-partage');

    await choisir(pageGM, 3000, 2000);

    // (1) La vue joueurs reçoit une image WebP réduite à 1920 px — décodée, pas seulement
    // référencée : `naturalWidth` est la seule preuve d'un décodage réel.
    await expect(overlay(pagePlayer)).toBeVisible();
    const src = await pagePlayer.locator('#image-share-overlay img').getAttribute('src');
    expect(src?.startsWith('data:image/webp')).toBe(true);
    await expect.poll(() => largeurDecodee(pagePlayer), { timeout: 15000 }).toBe(1920);

    await expect(pageGM.locator('#image-share-size')).toHaveText('1920 × 1280');
    await expect(pageGM.locator('#image-share-preview')).toBeVisible();
    await expect(pageGM.locator('#tab-content-image-share')).toContainText(
      'Affichée sur l\'écran des joueurs'
    );

    // (2) F5 de la tablette : l'image revient tant qu'elle n'est pas fermée.
    await pagePlayer.reload();
    await waitForApp(pagePlayer);
    await expect(overlay(pagePlayer)).toBeVisible();
    await expect.poll(() => largeurDecodee(pagePlayer), { timeout: 15000 }).toBe(1920);

    // (3) La croix des joueurs ferme pour tous, et le MJ le voit.
    await croix(pagePlayer).click();
    await expect(overlay(pagePlayer)).toHaveCount(0);
    await expect(pageGM.locator('#image-share-preview')).toBeHidden();
    await expect(pageGM.locator('#image-share-status')).toHaveText('Fermée par les joueurs.');

    // Le nœud est effacé : un F5 ne la fait jamais revenir.
    expect(
      await pagePlayer.evaluate(
        (sid) => /** @type {any} */ (window).__rpgTestSharedImage('get', sid),
        sessionId
      )
    ).toBeNull();
    await pagePlayer.reload();
    await waitForApp(pagePlayer);
    await expect(overlay(pagePlayer)).toHaveCount(0);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('4. « Fermer l\'image » côté MJ la fait disparaître chez les joueurs', async ({ context }) => {
    const { pageGM, pagePlayer } = await ouvrir(context, 'test-partage-mj');

    await choisir(pageGM, 1200, 800);
    await expect(overlay(pagePlayer)).toBeVisible();

    await pageGM.click('#image-share-close');
    await expect(overlay(pagePlayer)).toHaveCount(0);
    await expect(pageGM.locator('#image-share-preview')).toBeHidden();
    // Fermée par le MJ lui-même : ce n'est pas une fermeture par les joueurs.
    await expect(pageGM.locator('#image-share-status')).not.toHaveText('Fermée par les joueurs.');

    await pageGM.close();
    await pagePlayer.close();
  });

  test('5. Une seconde image REMPLACE la première — un seul overlay, et jamais d\'agrandissement', async ({
    context,
  }) => {
    const { pageGM, pagePlayer } = await ouvrir(context, 'test-partage-remplace');

    await choisir(pageGM, 3000, 2000);
    await expect.poll(() => largeurDecodee(pagePlayer), { timeout: 15000 }).toBe(1920);

    // Plus petite que le format TV : elle part à sa taille.
    await choisir(pageGM, 800, 600);
    await expect(pageGM.locator('#image-share-size')).toHaveText('800 × 600');
    await expect.poll(() => largeurDecodee(pagePlayer), { timeout: 15000 }).toBe(800);
    await expect(overlay(pagePlayer)).toHaveCount(1);
    await expect(pagePlayer.locator('#image-share-overlay img')).toHaveCount(1);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('6-7. Zero-UI : rien sans image, la croix seule avec — et un z-index sous 9999', async ({
    context,
  }) => {
    const { pageGM, pagePlayer } = await ouvrir(context, 'test-partage-zeroui');

    // Ce que l'overlay ajouterait à la vue joueurs. Deux tolérances, et rien d'autre : le bouton
    // plein écran (dérogation du 30/07/2026) et le sélecteur d'étage (CONVENTIONS.md, interdiction 2).
    const controlesHorsTolerances = () =>
      pagePlayer.evaluate(() =>
        Array.from(document.querySelectorAll('button, nav, input')).filter(
          (el) => el.id !== 'player-fullscreen-btn' && !el.closest('#player-level-tabs')
        ).map((el) => el.getAttribute('aria-label') || el.tagName)
      );

    // (6) Sans image : aucun élément d'overlay.
    await expect(overlay(pagePlayer)).toHaveCount(0);
    expect(await controlesHorsTolerances()).toEqual([]);

    await choisir(pageGM, 1200, 800);
    await expect(overlay(pagePlayer)).toBeVisible();
    // Avec image : le seul contrôle est la croix.
    expect(await controlesHorsTolerances()).toEqual(['Fermer l\'image']);
    // Grande cible tactile.
    const boite = await croix(pagePlayer).boundingBox();
    expect(boite?.width).toBeGreaterThanOrEqual(56);
    expect(boite?.height).toBeGreaterThanOrEqual(56);
    // L'overlay capte les gestes : au centre de l'écran, c'est lui que touche le doigt, pas la carte.
    const auCentre = await pagePlayer.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return Boolean(el?.closest('#image-share-overlay'));
    });
    expect(auCentre).toBe(true);

    // (7) z-index strictement inférieur à l'avertissement de version.
    const zIndex = (/** @type {string} */ id) =>
      pagePlayer.evaluate((elId) => {
        const el = document.getElementById(elId);
        return el ? parseInt(window.getComputedStyle(el).zIndex || '0', 10) : 0;
      }, id);
    const overlayZ = await zIndex('image-share-overlay');
    const versionZ = await zIndex('player-version-overlay');
    expect(overlayZ).toBeGreaterThan(0);
    expect(overlayZ).toBeLessThan(9999);
    expect(versionZ).toBe(9999);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('8. Le panneau MJ n\'a ni champ URL ni bibliothèque', async ({ context }) => {
    const { pageGM, pagePlayer } = await ouvrir(context, 'test-partage-panneau');

    const onglet = pageGM.locator('.gm-tab-btn[data-tab="image-share"]');
    await expect(onglet).toHaveText('Image');
    await expect(onglet).toHaveAttribute('title', 'Partage d’image');

    const panneau = pageGM.locator('#tab-content-image-share');
    // Le seul champ est le sélecteur de fichier, et il n'accepte que des images.
    await expect(panneau.locator('input')).toHaveCount(1);
    await expect(panneau.locator('input[type="file"]')).toHaveAttribute('accept', 'image/*');
    await expect(panneau.locator('textarea, select')).toHaveCount(0);
    await expect(panneau).not.toContainText(/URL|bibliothèque/i);
    await expect(pageGM.locator('[data-tab="handouts"], #handout-image-url, .handout-entry')).toHaveCount(0);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('9. Rien du partage d\'image dans le localStorage ni dans l\'instantané sauvegardé', async ({
    context,
  }) => {
    const { pageGM, pagePlayer } = await ouvrir(context, 'test-partage-trace');

    await choisir(pageGM, 3000, 2000);
    await expect.poll(() => largeurDecodee(pagePlayer), { timeout: 15000 }).toBe(1920);

    // Une mutation de la campagne déclenche une sauvegarde : l'instantané écrit alors doit être
    // celui d'après le partage, et ne rien en contenir.
    // Même URL que celle qu'importe `js/app/gm.js` : c'est le même module, donc le store vivant.
    await pageGM.evaluate(async (chemin) => {
      const store = await import(chemin);
      store.updateLevel('lvl', { name: 'Carte renommée' });
    }, '/js/state/store.js');
    await expect
      .poll(() => pageGM.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.savedSnapshot ?? ''))
      .toContain('Carte renommée');
    const sauvegarde = await pageGM.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.savedSnapshot);
    expect(sauvegarde).not.toContain('data:image/webp');
    expect(sauvegarde).not.toContain('sharedImage');

    for (const page of [pageGM, pagePlayer]) {
      const stockage = await page.evaluate(() => JSON.stringify(localStorage));
      expect(stockage).not.toContain('data:image/webp');
    }

    await pageGM.close();
    await pagePlayer.close();
  });
});
