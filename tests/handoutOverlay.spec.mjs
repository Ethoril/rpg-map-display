// @ts-check
import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';
import { HANDOUT_LARGE_DIMENSION_PX } from '../js/core/constants.js';

/** PNG 1×1 opaque, servi à la place de toute requête vers Drive. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Étage minimal : la bibliothèque de handouts est de la DONNÉE DE CAMPAGNE, donc une campagne
 * doit être chargée pour qu'il y ait un endroit où l'écrire.
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
    campaignId: 'c-handouts',
    name: 'Session handouts',
    levels: [LEVEL],
    links: [],
    tokens: [],
    templates: [],
    settings: {},
  },
  activeLevelId: 'lvl',
  selectedTokenId: null,
  activeHandout: null,
};

/**
 * Fabrique un PNG en niveaux de gris de dimensions exactes, entièrement noir.
 *
 * Sert à déclencher l'avertissement de dimensions **sur une vraie image décodée** : le seuil porte
 * sur `naturalWidth`/`naturalHeight`, pas sur une taille déclarée quelque part. Un PNG de 5000 × 8
 * pèse quelques centaines d'octets une fois compressé — la largeur est réelle, le poids ne l'est
 * pas, et c'est exactement ce que le brief demande de distinguer.
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
 * Ouvre l'onglet Handouts du MJ.
 * @param {import('@playwright/test').Page} pageGM
 */
async function ouvrirOngletHandouts(pageGM) {
  await pageGM.click('.gm-tab-btn[data-tab="handouts"]');
  await pageGM.waitForSelector('#handout-image-url');
}

/**
 * Ajoute une image à la bibliothèque — sans la révéler.
 * @param {import('@playwright/test').Page} pageGM
 * @param {string} url
 * @param {string} nom
 */
async function ajouter(pageGM, url, nom) {
  await pageGM.fill('#handout-image-url', url);
  await pageGM.fill('#handout-title', nom);
  await pageGM.click('#handout-add-btn');
  await expect(entree(pageGM, nom)).toBeVisible();
}

/**
 * L'entrée de bibliothèque portant ce nom.
 * @param {import('@playwright/test').Page} pageGM
 * @param {string} nom
 */
const entree = (pageGM, nom) =>
  pageGM.locator('.handout-entry').filter({ hasText: nom });

/**
 * Révèle l'entrée portant ce nom.
 * @param {import('@playwright/test').Page} pageGM
 * @param {string} nom
 */
const reveler = (pageGM, nom) => entree(pageGM, nom).locator('.handout-reveal-btn').click();

test.describe('Chantier H — Révélation d\'image (Handouts)', () => {
  test('1. Ajout à la bibliothèque, révélation MJ -> Joueurs, image réellement décodée, et fermeture', async ({ context }) => {
    const sessionId = `test-handout-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    await installBrowserTransport(pagePlayer, sessionId, SNAPSHOT);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);

    // `maps/minimal.webp` est une image réellement présente et commitée. Une URL
    // inexistante laisserait ce test vert : `toBeVisible()` juge le conteneur plein
    // écran, dont la boîte fait 100vw×100vh quelle que soit l'image, et
    // `toHaveAttribute` ne compare qu'une chaîne. L'assertion sur `naturalWidth`
    // ci-dessous est la seule qui prouve un décodage réel.
    const testUrl = './maps/minimal.webp';
    await ajouter(pageGM, testUrl, 'Titre de test');

    // ⭐ **Ajouter n'est pas révéler** : tant que le MJ n'a pas cliqué l'entrée, la table ne voit
    // rien. C'est la moitié de la tranche A qui n'existait pas avant.
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();

    await reveler(pageGM, 'Titre de test');

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

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    await installBrowserTransport(pagePlayer, sessionId, SNAPSHOT);

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

    await ouvrirOngletHandouts(pageGM);

    // Exactement ce que Drive met dans le presse-papier quand on partage une image. Tel quel,
    // c'est une page HTML : la tablette affichait une icône de fichier cassé sur fond noir.
    await ajouter(
      pageGM,
      'https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view?usp=drive_link',
      'Lien Drive'
    );

    const attendu = 'https://drive.google.com/thumbnail?id=1tnBho2PcsZFcJyuLcuciW&sz=w2000';

    // La conversion a lieu **à l'ajout**, donc c'est déjà l'URL convertie qui est enregistrée
    // dans la bibliothèque — l'aperçu de l'entrée le montre au MJ.
    await expect(entree(pageGM, 'Lien Drive').locator('.handout-entry-thumb')).toHaveAttribute(
      'src',
      attendu
    );

    await reveler(pageGM, 'Lien Drive');

    // Ce qui compte : c'est l'URL convertie qui part sur le réseau et arrive à la tablette,
    // et non le lien de partage brut corrigé à l'affichage.
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveAttribute('src', attendu);

    // L'assertion qui tient la promesse du titre : le navigateur a bien demandé
    // l'URL convertie, et **jamais** le lien de partage brut — lequel sert une page
    // HTML de 75 Ko dont aucune balise `<img>` ne tirera une image.
    await expect.poll(() => requetesDrive.length).toBeGreaterThan(0);
    expect(requetesDrive).not.toContain(
      'https://drive.google.com/file/d/1tnBho2PcsZFcJyuLcuciW/view?usp=drive_link'
    );
    expect([...new Set(requetesDrive)]).toEqual([attendu]);

    // Un lien de dossier, lui, ne peut pas être converti : il est refusé côté MJ, rien n'entre
    // dans la bibliothèque, et rien n'est révélé aux joueurs.
    await pageGM.click('#handout-hide-btn');
    await pageGM.fill('#handout-image-url', 'https://drive.google.com/drive/folders/1tnBho2PcsZ');
    await pageGM.fill('#handout-title', 'Dossier');
    await pageGM.click('#handout-add-btn');
    await expect(pageGM.locator('#handout-error-msg')).toBeVisible();
    await expect(pageGM.locator('#handout-error-msg')).toContainText('dossier');
    await expect(entree(pageGM, 'Dossier')).toHaveCount(0);
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();

    await pageGM.close();
    await pagePlayer.close();
  });

  test('2. Persistance après F5 (rafraîchissement) sur la vue joueurs', async ({ context }) => {
    const sessionId = `test-handout-f5-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    // ⚠ Côté joueurs, **aucun** instantané injecté : c'est ce qui fait de ce test une épreuve de
    // la restauration locale. Un instantané injecté est resservi tel quel à chaque rechargement —
    // il écraserait ce que le F5 est censé retrouver tout seul.
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);
    await ajouter(pageGM, './maps/minimal.webp', 'Plan F5');
    await reveler(pageGM, 'Plan F5');

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

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    // ⚠ Aucune campagne côté joueurs : le sélecteur d'étage est une interface **autorisée** de la
    // vue joueurs (CONVENTIONS.md, interdiction 2), et il fausserait le compte ci-dessous. Ce test
    // cherche ce que le handout, lui, ajouterait — la réponse doit rester zéro.
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);
    await ajouter(pageGM, './maps/minimal.webp', 'Plan Zero-UI');
    await reveler(pageGM, 'Plan Zero-UI');

    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();

    // Vérifier Zero-UI strict — seul le bouton plein écran est toléré (dérogation du
    // 30 juillet 2026, cf. CONVENTIONS.md §8, interdiction 2). ⛔ La bibliothèque vit dans le
    // panneau MJ et **rien** ne doit en déborder ici : ni liste, ni miniature, ni bouton.
    //
    // ⚠ Le sélecteur d'étage est la seconde tolérance : `CONVENTIONS.md` le **liste** parmi ce qui
    // a le droit de s'afficher, et il apparaît dès que la vue joueurs connaît une campagne — ce
    // qui est le cas ici, le MJ la lui ayant publiée. Il est donc écarté du compte, comme le
    // bouton plein écran, et **rien d'autre** ne l'est.
    const forbiddenCount = await pagePlayer.evaluate(() => {
      return Array.from(document.querySelectorAll('button, nav, input')).filter(
        (el) => el.id !== 'player-fullscreen-btn' && !el.closest('#player-level-tabs')
      ).length;
    });
    expect(forbiddenCount).toBe(0);
    await expect(pagePlayer.locator('.handout-entry')).toHaveCount(0);

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

  test('5. Révéler une seconde image REMPLACE la première chez les joueurs — jamais deux', async ({
    context,
  }) => {
    const sessionId = `test-handout-remplace-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    await installBrowserTransport(pagePlayer, sessionId, SNAPSHOT);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);
    await ajouter(pageGM, './maps/minimal.webp', 'Première');
    await ajouter(pageGM, './maps/marais-hex_16x16.jpg', 'Seconde');

    await reveler(pageGM, 'Première');
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveAttribute(
      'src',
      './maps/minimal.webp'
    );

    await reveler(pageGM, 'Seconde');

    // L'effet observable côté joueurs : c'est la seconde qui est à l'écran, et la première n'y
    // est plus — pas deux images superposées, pas une image restée derrière.
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveAttribute(
      'src',
      './maps/marais-hex_16x16.jpg'
    );
    await expect(pagePlayer.locator('#handout-overlay')).toHaveCount(1);
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveCount(1);

    // Les deux entrées sont toujours dans la bibliothèque : révéler n'est pas retirer.
    await expect(pageGM.locator('.handout-entry')).toHaveCount(2);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('6. Retirer l\'entrée AFFICHÉE la masque chez les joueurs', async ({ context }) => {
    const sessionId = `test-handout-retrait-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    await installBrowserTransport(pagePlayer, sessionId, SNAPSHOT);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);
    await ajouter(pageGM, './maps/minimal.webp', 'Affichée');
    await ajouter(pageGM, './maps/marais-hex_16x16.jpg', 'Rangée');

    await reveler(pageGM, 'Affichée');
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();

    // Retirer une AUTRE entrée ne touche pas à l'écran de la table.
    await entree(pageGM, 'Rangée').locator('.handout-remove-btn').click();
    await expect(entree(pageGM, 'Rangée')).toHaveCount(0);
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();

    // Retirer celle qui est affichée la fait disparaître de la TV. Sans cela, le MJ croirait
    // l'avoir supprimée et les joueurs continueraient de la lire.
    await entree(pageGM, 'Affichée').locator('.handout-remove-btn').click();
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();
    await expect(pageGM.locator('.handout-entry')).toHaveCount(0);

    await pageGM.close();
    await pagePlayer.close();
  });

  test('8. Sans campagne chargée, le geste RÉVÈLE quand même — et dit que rien n\'est enregistré', async ({
    context,
  }) => {
    const sessionId = `test-handout-sans-campagne-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    // ⛔ Aucune campagne, nulle part. C'est le cas du chantier H — « un handout peut être affiché
    // avant tout chargement de carte » — et cette capacité ne doit pas avoir disparu au passage de
    // la bibliothèque.
    await installBrowserTransport(pageGM, sessionId, null);
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);
    await pageGM.fill('#handout-image-url', './maps/minimal.webp');
    await pageGM.fill('#handout-title', 'Sans campagne');
    await pageGM.click('#handout-add-btn');

    // ⭐ L'effet qui compte est chez les JOUEURS : l'image est à l'écran.
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible({ timeout: 2000 });
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveAttribute(
      'src',
      './maps/minimal.webp'
    );
    // Et réellement décodée, pas seulement référencée.
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

    // Le MJ obtient ce qu'il voulait, et sait exactement ce qu'il n'obtient pas.
    await expect(pageGM.locator('#handout-status')).toContainText('NON enregistrée');
    await expect(pageGM.locator('#handout-status')).toContainText('aucune n\'est chargée');
    await expect(pageGM.locator('#handout-status')).toContainText('Sans campagne');
    // Rien n'est entré dans une bibliothèque qui n'existe pas.
    await expect(pageGM.locator('.handout-entry')).toHaveCount(0);

    // ⚠ Le formulaire garde l'URL : elle n'est enregistrée nulle part ailleurs, donc la vider
    // interdirait de re-révéler l'image après un masquage.
    await expect(pageGM.locator('#handout-image-url')).toHaveValue('./maps/minimal.webp');

    // L'identifiant de cet affichage éphémère est un vrai identifiant, le même des deux côtés du
    // réseau — et un seul geste ne produit qu'une seule révélation.
    const shows = await pagePlayer.evaluate(() =>
      /** @type {any} */ (window)
        .__RPG_TEST_WIRE__.received.filter((/** @type {any} */ e) => e.type === 'handout.show')
        .map((/** @type {any} */ e) => e.payload.handout.id)
    );
    expect(shows).toHaveLength(1);
    expect(shows[0]).toMatch(/^handout-.+/);

    // Le masquage fonctionne aussi sur cet affichage-là.
    await pageGM.click('#handout-hide-btn');
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();
    await expect(pageGM.locator('#handout-status')).toContainText('Aucun handout affiché');

    await pageGM.close();
    await pagePlayer.close();
  });

  test('9. Une campagne étant chargée, le même geste ENREGISTRE au lieu de révéler', async ({
    context,
  }) => {
    const sessionId = `test-handout-avec-campagne-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    await installBrowserTransport(pagePlayer, sessionId, null);

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);
    await pageGM.fill('#handout-image-url', './maps/minimal.webp');
    await pageGM.fill('#handout-title', 'Avec campagne');
    await pageGM.click('#handout-add-btn');

    // Le même geste, avec une campagne : l'entrée entre dans la bibliothèque…
    await expect(entree(pageGM, 'Avec campagne')).toBeVisible();
    await expect(pageGM.locator('#handout-image-url')).toHaveValue('');
    // …et **rien** n'est révélé tant que le MJ n'a pas cliqué l'entrée.
    await expect(pagePlayer.locator('#handout-overlay')).toBeHidden();
    await expect(pageGM.locator('#handout-status')).toContainText('Aucun handout affiché');

    // Une fois révélée, elle est enregistrée : le statut ne porte plus l'avertissement.
    await reveler(pageGM, 'Avec campagne');
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();
    await expect(pageGM.locator('#handout-status')).toContainText('Affiché aux joueurs');
    await expect(pageGM.locator('#handout-status')).not.toContainText('NON enregistrée');

    await pageGM.close();
    await pagePlayer.close();
  });

  test('7. Une image aux dimensions démesurées AVERTIT le MJ, sans jamais bloquer', async ({
    context,
  }) => {
    const sessionId = `test-handout-avertissement-${Date.now()}`;

    const pageGM = await context.newPage();
    const pagePlayer = await context.newPage();

    await installBrowserTransport(pageGM, sessionId, SNAPSHOT);
    await installBrowserTransport(pagePlayer, sessionId, SNAPSHOT);

    // Deux images réelles, servies par le test : l'une au-dessus du seuil de dimensions, l'autre
    // en dessous. Le seuil est lu dans `core/constants.js` — il n'est pas recopié ici, pour que
    // le jour où le mainteneur le règle, ce test le suive au lieu de le contredire.
    const trop = pngNoir(HANDOUT_LARGE_DIMENSION_PX + 904, 8);
    const raisonnable = pngNoir(64, 8);
    for (const p of [pageGM, pagePlayer]) {
      await p.route('**/immense.png', (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: trop })
      );
      await p.route('**/modeste.png', (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: raisonnable })
      );
    }

    await pageGM.goto(`/gm.html?session=${sessionId}`);
    await pagePlayer.goto(`/player.html?session=${sessionId}`);

    await waitForApp(pageGM);
    await waitForApp(pagePlayer);

    await ouvrirOngletHandouts(pageGM);

    // Une image sage : aucun avertissement.
    await ajouter(pageGM, './modeste.png', 'Modeste');
    await expect(pageGM.locator('#handout-warning-msg')).toBeHidden();

    // Une image démesurée : l'avertissement se déclenche, et il parle de la table — pas d'un code.
    await ajouter(pageGM, './immense.png', 'Immense');
    await expect(pageGM.locator('#handout-warning-msg')).toBeVisible();
    await expect(pageGM.locator('#handout-warning-msg')).toContainText('tablette');
    await expect(pageGM.locator('#handout-warning-msg')).toContainText(
      `${HANDOUT_LARGE_DIMENSION_PX + 904} × 8 px`
    );

    // ⚠ Il n'a **aucun** droit de veto : l'entrée est dans la bibliothèque, et elle se révèle.
    await expect(entree(pageGM, 'Immense')).toBeVisible();
    await reveler(pageGM, 'Immense');
    await expect(pagePlayer.locator('#handout-overlay')).toBeVisible();
    await expect(pagePlayer.locator('#handout-overlay img')).toHaveAttribute(
      'src',
      './immense.png'
    );

    await pageGM.close();
    await pagePlayer.close();
  });
});
