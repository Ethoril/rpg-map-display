// @ts-check
//
// V-03 — le formulaire de pion de l'outil écrit-il vraiment ce qu'il affiche ?
//
// Écrit le 9 août 2026 après une revue par mutation. L'éditeur de pions avait gagné les champs
// `id`, `visionBright`, `visionDim` et `maxHp`, et 660 lignes de changement n'apportaient aucun
// test : forcer `visionBright: 0, visionDim: 0, hp: null` sur tout pion généré laissait les 330
// tests unitaires et les 8 scénarios de pion au vert.
//
// ⚠ Ce n'est pas un défaut théorique. Sur un étage sombre, un pion à `visionDim: 0` ne contribue
// **rien** à l'union de vision : le PJ n'éclairerait plus rien à table, et la bibliothèque
// distribuerait le défaut à chaque réinstanciation.
//
// La leçon est déjà consignée dans `ETAT.md` : le bouton « Copier l'entrée JSON » est devenu
// inopérant en silence parce qu'aucun test ne l'exerçait. Un formulaire sans test est un
// formulaire dont personne ne saura qu'il a cessé de remplir un champ.
//
// ⛔ Le test est hermétique et n'écrit **rien** dans `maps/` : il intercepte `/api/tokens/save`
// et vérifie la charge utile. Écrire pour de vrai ferait muter le dépôt à chaque exécution, ce
// que la suite s'interdit depuis que la préparation de cartes a été sortie de `maps/`.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Réponse minimale de `/api/sources` : elle ne sert qu'à faire apparaître l'outil. */
const SOURCES = {
  defaults: { targetPxPerCell: 140, maxTexturePx: 8192, quality: 90 },
  sources: [
    {
      file: 'fixture.dd2vtt',
      name: 'Fixture',
      bytes: 100,
      cellsX: 10,
      cellsY: 8,
      densiteSource: 64,
      sourceWidth: 640,
      sourceHeight: 512,
      walls: 0,
      portals: 0,
      lights: 0,
      declares: { walls: 0, portals: 0, lights: 0 },
      bakedLighting: false,
      warnings: [],
    },
  ],
  illisibles: [],
};

test('V-03 — les champs du formulaire arrivent intacts dans l’entrée de bibliothèque', async ({
  page,
}) => {
  /** @type {any} */
  let charge = null;

  await page.route('**/api/sources', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SOURCES) })
  );
  await page.route('**/api/tokens', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tokens: [], errors: [] }),
    })
  );
  // La section des liaisons interroge une scène au démarrage. Sans cette route elle échouerait
  // dans le journal — sans conséquence ici, mais un journal en erreur masque les vrais messages.
  await page.route('**/api/scene?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: 'fixture', levels: [], links: [] }),
    })
  );

  await page.route('**/api/tokens/save', (route) => {
    charge = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        imageUrl: 'maps/tokens/sonde-vision.webp',
        tokens: [
          {
            id: charge?.entry?.id,
            name: charge?.entry?.name,
            imageUrl: 'maps/tokens/sonde-vision.webp',
            kind: charge?.entry?.kind,
            sizeCells: charge?.entry?.sizeCells,
            speedCells: charge?.entry?.speedCells,
            visionBright: charge?.entry?.visionBright,
            visionDim: charge?.entry?.visionDim,
            emitsLight: null,
            borderColor: charge?.entry?.borderColor,
            maxHp: charge?.entry?.maxHp,
          },
        ],
      }),
    });
  });

  await page.goto('/prepare.html');
  await expect(page.locator('#outil')).not.toHaveClass(/cache/);

  // Une vraie image du dépôt plutôt qu'un pixel inventé : le générateur la décode, la recadre et
  // la réencode réellement. Une fixture d'un seul pixel « vérifierait » un redimensionnement qui
  // n'a jamais eu lieu — c'est l'erreur déjà corrigée sur les fixtures de cartes.
  await page.setInputFiles('#token-file-input', {
    name: 'goblin.webp',
    mimeType: 'image/webp',
    buffer: fs.readFileSync(path.join(rootDir, 'maps/tokens/goblin.webp')),
  });

  // Le bouton reste désarmé tant qu'aucune image n'est chargée : son activation est le signal
  // que le décodage a abouti, et il évite d'attendre une durée choisie au hasard.
  await expect(page.locator('#btn-generate-token')).toBeEnabled();

  await page.fill('#token-id', 'sonde-vision');
  await page.fill('#token-label', 'Sonde de vision');
  await page.selectOption('#token-kind', 'pc');
  await page.fill('#token-size-cells', '1');
  await page.fill('#token-speed-cells', '4');
  await page.fill('#token-vision-bright', '7');
  await page.fill('#token-vision-dim', '12');
  await page.fill('#token-max-hp', '23');

  await page.click('#btn-generate-token');

  await expect.poll(() => charge, { timeout: 5000 }).not.toBeNull();

  // ⭐ Le cœur du test : des valeurs **distinctes des défauts** du formulaire (5 et 10 pour la
  // vision, 3 pour la vitesse). Réutiliser les défauts laisserait passer un champ ignoré.
  expect(charge.entry.visionBright).toBe(7);
  expect(charge.entry.visionDim).toBe(12);
  expect(charge.entry.maxHp).toBe(23);
  expect(charge.entry.speedCells).toBe(4);
  expect(charge.entry.kind).toBe('pc');
  expect(charge.entry.id).toBe('sonde-vision');
  expect(charge.entry.name).toBe('Sonde de vision');

  // L'image part bien avec l'entrée, et sous le plafond de bibliothèque de 256 Kio — celui de la
  // campagne, à 24 Kio, ne s'applique pas à un fichier posé sur disque et référencé par URL.
  expect(charge.imageDataUrl.startsWith('data:image/webp')).toBe(true);
  expect(charge.imageDataUrl.length).toBeLessThanOrEqual(256 * 1024);

  // Et la bibliothèque affichée se rafraîchit avec ce que le serveur a répondu : sans cela, le
  // mainteneur ne saurait pas si son enregistrement a abouti.
  await expect(page.locator('#tokens-liste')).toContainText('Sonde de vision');
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// V-02 — l'identifiant de scène envoyé au serveur est-il le bon ?
//
// Trouvé au premier vrai clic sur « Créer la liaison », le 9 août 2026 : le bouton se grisait et
// rien ne se passait. `POST /api/scene/links` répondait **400 — Identifiant de scène manquant**.
//
// ⭐ La cause tient à une confusion de document. `GET /api/scene` renvoie le document de scène tel
// quel, c'est-à-dire une **campagne**, dont les clés racine sont `schemaVersion`, `campaignId`,
// `name`, `levels`, `links`, `tokens`, `templates` et `settings`. **Il n'existe pas de champ
// `id`**, et `campaignId` vaut `campaign-<sceneId>` : ni l'un ni l'autre n'est la clé attendue par
// le serveur, qui écrit `maps/<sceneId>.links.json`.
//
// ⚠ Le mécanisme des liaisons était pourtant couvert : un test unitaire prouve que `prepareMaps`
// fusionne `maps/<id>.links.json` dans la scène produite. Mais **rien ne couvrait l'aller-retour
// navigateur → serveur**, et c'est exactement là que le défaut vivait. Un maillon prouvé de chaque
// côté d'une soudure non testée.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const SCENE_ID = 'village-test';

/** Document de scène **réaliste** : une campagne, donc sans champ `id`. */
const SCENE = {
  schemaVersion: 2,
  campaignId: `campaign-${SCENE_ID}`,
  name: 'Village de test',
  levels: [
    {
      id: 'rdc',
      name: 'Rez-de-chaussée',
      order: 0,
      imageUrl: 'maps/tokens/goblin.webp',
      pxPerCell: 10,
      widthCells: 100,
      heightCells: 100,
      grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
      walls: [],
      portals: [],
      lights: [],
      ambient: { level: 1, baked: false },
    },
    {
      id: 'etage',
      name: 'Étage',
      order: 1,
      imageUrl: 'maps/tokens/goblin.webp',
      pxPerCell: 10,
      widthCells: 100,
      heightCells: 100,
      grid: { type: 'square', offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.25, visible: true },
      walls: [],
      portals: [],
      lights: [],
      ambient: { level: 1, baked: false },
    },
  ],
  links: [],
  tokens: [],
  templates: [],
  settings: {},
};

test('V-02 — la liaison enregistrée porte l’identifiant de scène du catalogue', async ({ page }) => {
  /** @type {any} */
  let charge = null;

  await page.route('**/api/sources', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SOURCES) })
  );
  await page.route('**/api/tokens', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tokens: [], errors: [] }),
    })
  );
  await page.route('**/maps/catalog.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ maps: [{ id: SCENE_ID, name: 'Village de test' }] }),
    })
  );
  await page.route('**/api/scene?*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(SCENE) })
  );
  await page.route('**/api/scene/links', (route) => {
    charge = route.request().postDataJSON();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/prepare.html');
  await expect(page.locator('#outil')).not.toHaveClass(/cache/);

  // La scène du catalogue est sélectionnée et ses deux étages remontent dans l'éditeur.
  await expect(page.locator('#link-scene-select')).toHaveValue(SCENE_ID);
  await expect(page.locator('#link-level-select option')).toHaveCount(2);

  // Extrémité A : armer, puis désigner une case sur la carte. Un clic sans déplacement — même
  // position pour la pression et le relèvement — sinon le geste est interprété comme un glisser.
  await page.click('#link-arm');
  const viewport = page.locator('#prep-map-viewport');
  const boite = await viewport.boundingBox();
  if (!boite) throw new Error('Vue de carte absente');
  const cx = boite.x + boite.width / 2;
  const cy = boite.y + boite.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();

  // Extrémité B : l'autre étage, à une case explicite.
  await page.selectOption('#link-level-b', 'etage');
  await page.fill('#link-cell-x', '4');
  await page.fill('#link-cell-y', '6');
  await page.fill('#link-label', 'Escalier nord');

  await expect(page.locator('#link-create')).toBeEnabled();
  await page.click('#link-create');

  await expect.poll(() => charge, { timeout: 5000 }).not.toBeNull();

  // ⭐ Le cœur du test. Avant correctif, `sceneId` partait `undefined` : le serveur refusait, et
  // un message de succès aurait annoncé `maps/undefined.links.json`.
  expect(charge.sceneId).toBe(SCENE_ID);
  expect(charge.sceneId).not.toBe(SCENE.campaignId);
  expect(Array.isArray(charge.links)).toBe(true);
  expect(charge.links).toHaveLength(1);
  expect(charge.links[0].a.levelId).toBe('rdc');
  expect(charge.links[0].b.levelId).toBe('etage');

  // ⚠ Une extrémité de liaison porte un `CellPoint` — `{ cellX, cellY }` — et non une `Cell`
  // `{ a, b }`. La vue de carte rend une `Cell` ; c'est `setEndpointA` qui convertit. Les deux
  // formes se ressemblent assez pour qu'une confusion passe inaperçue jusqu'à ce qu'un pion
  // téléporté atterrisse ailleurs, d'où l'assertion sur la forme des deux extrémités.
  expect(charge.links[0].b.at).toEqual({ cellX: 4, cellY: 6 });
  expect(Object.keys(charge.links[0].a.at).sort()).toEqual(['cellX', 'cellY']);
});
