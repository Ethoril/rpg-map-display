// @ts-check
import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { createCampaign, createLevel, createToken } from '../js/core/schema.js';
import {
  installBrowserTransport,
  waitForApp,
  waitForPlayerVision,
  setPlayerTestVision,
} from './browserTestTransport.mjs';

/** @typedef {import('@playwright/test').Browser} Browser */
/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').CDPSession} CDPSession */

const EXPECTED_TOC = [
  { group: 'Se déplacer', items: [
    'Déplacer mon personnage',
    'Corriger mon trajet',
    'Cadrer et zoomer',
    'Voir ou rejoindre un étage',
  ] },
  { group: 'Lire la carte', items: [
    'Consulter un pion et ses états',
    'Montrer un point ou retrouver un ping',
    'Ouvrir ou fermer une porte',
  ] },
  { group: 'Interagir', items: [
    'Monter ou descendre de cheval',
    'Orienter ou déplacer un gabarit',
    'Fermer une image partagée',
  ] },
  { group: 'Accéder à la table', items: [
    'Rejoindre la table',
    'Passer en plein écran',
  ] },
];

/** @param {number} width @param {number} height @param {number} [shade] */
function makePngDataUrl(width, height, shade = 40) {
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
  /** @param {string} type @param {Buffer} data */
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
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.fill(shade, y * (width + 1) + 1, (y + 1) * (width + 1));
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeSnapshot() {
  const level = createLevel({
    id: 'rdc',
    name: 'Rez-de-chaussée',
    imageUrl: 'maps/minimal.webp',
    widthCells: 10,
    heightCells: 8,
    pxPerCell: 140,
    ambient: { level: 1, baked: false },
    portals: [{
      id: 'porte-bg',
      a: { cellX: 3, cellY: 2 },
      b: { cellX: 3, cellY: 3 },
      state: 'open',
      freestanding: true,
    }],
  });
  const tokens = [
    createToken({
      id: 'pj-reel',
      levelId: 'rdc',
      label: 'Ariane',
      cell: { a: 2, b: 2 },
      kind: 'pc',
      speedCells: 4,
      visionDim: 4,
      playerMovable: true,
    }),
    createToken({
      id: 'pnj-reel',
      levelId: 'rdc',
      label: 'Garde',
      cell: { a: 7, b: 5 },
      kind: 'npc',
      speedCells: 3,
      visionDim: 1,
    }),
  ];
  return {
    campaign: createCampaign({ campaignId: 'help-e2e', name: 'Recette aide', levels: [level], tokens }),
    activeLevelId: 'rdc',
    selectedTokenId: null,
  };
}

/** @param {Browser} browser @param {{ viewport?: { width: number, height: number }, reducedMotion?: 'reduce'|'no-preference' }} [opts] */
async function openPlayer(browser, opts = {}) {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: opts.viewport ?? { width: 1280, height: 720 },
    reducedMotion: opts.reducedMotion ?? 'no-preference',
  });
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const sessionId = `help-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await installBrowserTransport(page, sessionId, makeSnapshot());
  await page.goto(`/player.html?session=${sessionId}`);
  await waitForApp(page);
  await setPlayerTestVision(page);
  return { context, page, sessionId, errors };
}

/** @param {Page} page @param {string} lessonTitle */
async function openLessonFromToc(page, lessonTitle) {
  const guide = page.getByRole('dialog', { name: 'Aide de jeu' });
  if (!(await guide.isVisible())) {
    await page.getByRole('button', { name: 'Aide de jeu' }).click();
    await expect(guide).toBeVisible();
  }
  const tocBtn = guide.getByRole('button', { name: 'Toutes les fiches' });
  if (await tocBtn.isVisible()) {
    await tocBtn.click();
  }
  await guide.locator('.player-help-toc-item', { hasText: lessonTitle }).click();
  await expect(guide.locator('#player-help-lesson-title')).toHaveText(lessonTitle);
  return guide;
}

/** @param {CDPSession} cdp @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {{ steps?: number, holdBeforeMoveMs?: number }} [opts] */
async function cdpTouchDrag(cdp, x1, y1, x2, y2, opts = {}) {
  const steps = opts.steps ?? 6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(x1), y: Math.round(y1), id: 1 }] });
  if (opts.holdBeforeMoveMs) await new Promise((r) => setTimeout(r, opts.holdBeforeMoveMs));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(x1 + (x2 - x1) * t), y: Math.round(y1 + (y2 - y1) * t), id: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('Sommaire : 12 fiches dans l’ordre, cibles ≥ 44 px, navigation clavier, toutes démonstrations et arrêt de lecture', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const helpBtn = page.getByRole('button', { name: 'Aide de jeu' });
    await helpBtn.click();
    const guide = page.getByRole('dialog', { name: 'Aide de jeu' });
    await expect(guide).toBeVisible();

    // Ordre exact des 4 groupes et des 12 fiches, déplacement en premier
    const groups = await guide.locator('.player-help-toc-group').evaluateAll((nodes) =>
      nodes.map((node) => ({
        group: node.querySelector('h2')?.textContent?.trim() ?? '',
        items: [...node.querySelectorAll('.player-help-toc-item')].map((btn) =>
          btn.querySelector('span')?.textContent?.trim() ?? ''
        ),
      }))
    );
    expect(groups).toEqual(EXPECTED_TOC);

    // Toutes les cibles du sommaire font au moins 44×44 px, sans carrousel horizontal
    const tocMetrics = await guide.locator('.player-help-toc-item').evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { w: r.width, h: r.height, overflowX: b.scrollWidth > b.clientWidth + 1 };
      })
    );
    expect(tocMetrics).toHaveLength(12);
    for (const m of tocMetrics) {
      expect(m.w).toBeGreaterThanOrEqual(44);
      expect(m.h).toBeGreaterThanOrEqual(44);
      expect(m.overflowX).toBe(false);
    }

    // Parcourt les 12 fiches : chaque étape affiche une légende non vide et reste accessible
    for (const { items } of EXPECTED_TOC) {
      for (const title of items) {
        await openLessonFromToc(page, title);
        const stepBtns = guide.locator('button[data-example]');
        const count = await stepBtns.count();
        expect(count, `étapes pour « ${title} »`).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < count; i++) {
          await stepBtns.nth(i).click();
          await expect(stepBtns.nth(i)).toHaveAttribute('aria-pressed', 'true');
          const captionText = (await guide.locator('[data-help-caption]').textContent())?.trim() ?? '';
          expect(captionText.length, `légende étape ${i} de « ${title} »`).toBeGreaterThan(8);
        }
      }
    }

    // Rejouer + interruption immédiate par clic d'étape, retour au sommaire et fermeture Échap
    await openLessonFromToc(page, 'Corriger mon trajet');
    await guide.getByRole('button', { name: 'Rejouer la démonstration' }).click();
    await expect(guide.locator('button[data-example="0"]')).toHaveAttribute('aria-pressed', 'true');
    // Interruption manuelle sur l'étape 2
    await guide.locator('button[data-example="2"]').click();
    await expect(guide.locator('button[data-example="2"]')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(2100);
    await expect(guide.locator('button[data-example="2"]')).toHaveAttribute('aria-pressed', 'true');

    // Rejouer puis retour au sommaire : ne reprend pas la lecture interrompue
    await guide.getByRole('button', { name: 'Rejouer la démonstration' }).click();
    await guide.getByRole('button', { name: 'Toutes les fiches' }).click();
    await expect(guide.locator('.player-help-toc')).toBeVisible();
    await page.waitForTimeout(2100);
    await expect(guide.locator('.player-help-toc')).toBeVisible();

    // Fermeture par Échap : rend le focus au bouton « ? »
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await expect(helpBtn).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Corriger mon trajet : retrait (4→5→3 + Course), disparition du bouton, annulation hors zone et aller-retour sur B', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Corriger mon trajet');
    // Vérification des 3 étapes de démonstration et des portées 4, 5 et 3
    await expect(guide.locator('.player-help-prompt')).toContainText('4 de portée restante');
    await guide.locator('button[data-example="1"]').click();
    await expect(guide.locator('.player-help-prompt')).toContainText('5 de portée restante');
    // Contrôle visuel réel : la Marche (aplat vert) et la Course (hachures jaunes) sont peintes
    const zoneStyles = await guide.evaluate(() => {
      const walk = document.querySelector('#player-help-dialog .player-help-cell.is-reachable');
      const run = document.querySelector('#player-help-dialog .player-help-cell.is-run');
      return {
        walkBg: walk ? getComputedStyle(walk).backgroundColor : '',
        runBgImage: run ? getComputedStyle(run).backgroundImage : '',
      };
    });
    expect(zoneStyles.walkBg).toContain('34, 197, 94');
    expect(zoneStyles.runBgImage).toContain('repeating-linear-gradient');
    await guide.locator('button[data-example="2"]').click();
    await expect(guide.locator('.player-help-prompt')).toContainText('3 de portée restante');
    await expect(guide.locator('.player-help-prompt')).toContainText('Course : Action utilisée');

    // Essai 1 : retirer C, choisir D, confirmer D
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const undoBtn = guide.getByRole('button', { name: 'Retirer la dernière étape' });
    await expect(undoBtn).toBeVisible();
    const undoBox = await undoBtn.boundingBox();
    expect(undoBox?.width).toBeGreaterThanOrEqual(44);
    expect(undoBox?.height).toBeGreaterThanOrEqual(44);

    // Annulation hors zone (case 7, 5 hors portée restante 4 depuis C)
    await guide.getByRole('button', { name: 'Case 7, 5' }).click();
    await expect(undoBtn).toBeHidden();
    await expect(guide.locator('[data-help-caption]')).toContainText('annulée');

    // Recommencer Essai 1 et dérouler nominalement A→B→C -> undo -> A→B -> D -> confirmer D
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    await undoBtn.click();
    await expect(guide.locator('.player-help-prompt')).toContainText('5 de portée restante');
    // Vérifier qu'un retrait complet fait disparaître le bouton
    await undoBtn.click();
    await expect(undoBtn).toBeHidden();

    // Retour au début de l'essai 1 pour valider le parcours nominal complet
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    await undoBtn.click();
    await guide.getByRole('button', { name: 'Case D' }).click();
    await expect(guide.locator('.player-help-prompt')).toContainText('3 de portée restante');
    await expect(guide.locator('.player-help-prompt')).toContainText('Course : Action utilisée');
    await guide.getByRole('button', { name: 'Case D' }).click();
    await expect(guide.locator('[data-help-caption]')).toContainText('Parfait');

    // Essai 2 : toucher la case B en préparation sur C prolonge en aller-retour A→B→C→B
    await guide.getByRole('button', { name: /Aller-retour sur la case B/ }).click();
    await guide.getByRole('button', { name: 'Case B' }).click();
    await expect(guide.locator('.player-help-prompt')).toContainText('3 de portée restante');
    await expect(guide.locator('.player-help-prompt')).toContainText('Course : Action utilisée');
    await guide.getByRole('button', { name: 'Case B' }).click();
    await expect(guide.locator('[data-help-caption]')).toContainText('aller-retour');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Cadrer et zoomer : pan, pincement 2 doigts et relâchement 2→1 par vrais événements tactiles CDP', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Cadrer et zoomer');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const canvas = guide.locator('.player-help-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas absent');
    const cdp = await context.newCDPSession(page);

    // Une simple pression ne valide pas la phase de glisser
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(box.x + box.width * 0.5), y: Math.round(box.y + box.height * 0.5), id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'pan');

    // Glisser vers la gauche (deux coups pour amener le puits dans le cadre)
    await cdpTouchDrag(cdp, box.x + box.width * 0.85, box.y + box.height * 0.65, box.x + box.width * 0.12, box.y + box.height * 0.88, { steps: 6 });
    await cdpTouchDrag(cdp, box.x + box.width * 0.85, box.y + box.height * 0.5, box.x + box.width * 0.2, box.y + box.height * 0.72, { steps: 6 });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'zoomIn');

    // Pincement à deux doigts (agrandir) puis relâchement d'un doigt et poursuite du pan sans saut
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: Math.round(cx - 40), y: Math.round(cy), id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 40), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 40), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 90), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 90), y: Math.round(cy), id: 2 },
      ],
    });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'zoomOut');
    const zoomAfterIn = Number(await canvas.getAttribute('data-camera-zoom'));

    // Lève le 1er doigt, le 2e continue à glisser sans saut de zoom
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ x: Math.round(cx + 90), y: Math.round(cy), id: 2 }],
    });
    const xBeforeSingle = Number(await canvas.getAttribute('data-camera-x'));
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: Math.round(cx + 60), y: Math.round(cy), id: 2 }],
    });
    await page.waitForTimeout(40);
    const zoomAfterSingle = Number(await canvas.getAttribute('data-camera-zoom'));
    const xAfterSingle = Number(await canvas.getAttribute('data-camera-x'));
    expect(zoomAfterSingle).toBeCloseTo(zoomAfterIn, 2);
    expect(Math.abs(xAfterSingle - xBeforeSingle)).toBeLessThan(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // Pincement inverse (réduire)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: Math.round(cx - 110), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 110), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: Math.round(cx - 50), y: Math.round(cy), id: 1 },
        { x: Math.round(cx + 50), y: Math.round(cy), id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'done');
    // Le pion est resté à sa case
    await expect(canvas).toHaveAttribute('data-pawn-cell', '3,5');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Voir ou rejoindre un étage : onglets, escalier en deux temps, non-suivi automatique et renvoi monture', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Voir ou rejoindre un étage');
    await expect(guide.locator('.player-help-step-group h3')).toHaveText(['Regarder un étage', 'Prendre l’escalier']);

    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const tabRdc = guide.getByRole('tab', { name: 'Rez-de-chaussée' });
    const tabEtage = guide.getByRole('tab', { name: 'Étage' });

    await tabEtage.click();
    await expect(tabEtage).toHaveAttribute('aria-selected', 'true');
    await expect(guide.locator('.player-help-pawn')).toBeHidden();
    await tabRdc.click();
    await expect(guide.locator('.player-help-pawn')).toBeVisible();

    // Avancer jusqu'à l'escalier en deux taps puis resélectionner et franchir
    await guide.getByRole('button', { name: 'Ariane', exact: true }).click();
    const stairsBtn = guide.getByRole('button', { name: 'Escalier', exact: true });
    await stairsBtn.click();
    await expect(guide.locator('.player-help-prompt')).toHaveText('Retoucher ici pour déplacer');
    await stairsBtn.click();

    await guide.getByRole('button', { name: 'Ariane sur l’escalier' }).click();
    await expect(guide.locator('.player-help-prompt')).toHaveText('Retaper pour prendre l’escalier');
    await guide.getByRole('button', { name: 'Ariane sur l’escalier' }).click();

    // La vue reste au rez-de-chaussée ; choisir l'onglet Étage retrouve Ariane
    await expect(tabRdc).toHaveAttribute('aria-selected', 'true');
    await expect(guide.locator('.player-help-pawn')).toBeHidden();
    await tabEtage.click();
    await expect(guide.locator('.player-help-pawn')).toBeVisible();
    await expect(guide.locator('[data-help-caption]')).toContainText('Bravo');

    // Renvoi vers la fiche monture
    await guide.getByRole('button', { name: /Monter ou descendre de cheval/ }).click();
    await expect(guide.locator('#player-help-lesson-title')).toHaveText('Monter ou descendre de cheval');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Consulter un pion et ses états : hors vision ignoré, encart PNJ sans PV, badge et appui maintenu CDP', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Consulter un pion et ses états');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();

    const canvas = guide.locator('.player-help-canvas');
    const strip = guide.locator('.player-help-strip');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas consultation absent');

    // Positions des cases (grille 7×5 décalée à gauche de la bande de 116 px)
    const availW = box.width - 116;
    const zoom = Math.min(availW / (7 * 140), box.height / (5 * 140)) * 0.96;
    const camX = (7 * 140) / 2 + 55 / zoom;
    const camY = (5 * 140) / 2;
    /** @param {number} a @param {number} b */
    const cellClient = (a, b) => ({
      x: Math.round(box.x + ((a + 0.5) * 140 - camX) * zoom + box.width / 2),
      y: Math.round(box.y + ((b + 0.5) * 140 - camY) * zoom + box.height / 2),
    });

    // 1. Consultation sans vision (Sentinelle en 5,2) : la bande reste cachée
    const fogPt = cellClient(5, 2);
    await page.mouse.click(fogPt.x, fogPt.y);
    await expect(strip).toBeHidden();
    await expect(guide.locator('[data-help-caption]')).toContainText('hors de la vision');

    // 2. Consulter Garde visible en (3,2) sans sélection : Blessé, badge À terre, ni PV ni cheval
    const gardePt = cellClient(3, 2);
    await page.mouse.click(gardePt.x, gardePt.y);
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('data-mode', 'consultation');
    await expect(strip).toContainText('Garde');
    await expect(strip).toContainText('Blessé');
    await expect(strip).not.toContainText('PV');
    await expect(strip).not.toContainText('4/10');
    await expect(strip.locator('.player-selection-mount')).toHaveCount(0);

    // 3. Lire le badge À terre
    await strip.getByRole('button', { name: 'À terre' }).click();
    await expect(guide.locator('.player-help-strip-label')).toHaveText('À terre');

    // 4. Sélectionner Ariane (2,2) et préparer une arrivée à gauche (0,2)
    const arianePt = cellClient(2, 2);
    await page.mouse.click(arianePt.x, arianePt.y);
    await expect(strip).toHaveAttribute('data-mode', 'selection');
    const destPt = cellClient(0, 2);
    await page.mouse.click(destPt.x, destPt.y);
    await expect(canvas).toHaveAttribute('data-planned-arrival', '0,2');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'touchHold');

    // 5. Interruption d'appui maintenu par annulation : ne valide pas et préserve Ariane + trajet
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...gardePt, id: 1 }] });
    await expect(strip).toHaveAttribute('data-mode', 'consultation');
    await expect(strip).toContainText('À 1 case d’Ariane');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(strip).toHaveAttribute('data-mode', 'selection');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'touchHold');
    await expect(canvas).toHaveAttribute('data-planned-arrival', '0,2');

    // 6. Vrai appui maintenu + relâchement propre : affiche distance réelle (1 case) puis restaure Ariane et valide
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...gardePt, id: 2 }] });
    await expect(strip).toHaveAttribute('data-mode', 'consultation');
    await expect(strip).toContainText('À 1 case d’Ariane');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(strip).toHaveAttribute('data-mode', 'selection');
    await expect(strip).toContainText('Ariane');
    await expect(canvas).toHaveAttribute('data-planned-arrival', '0,2');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'done');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Montrer un point ou retrouver un ping : double tap CDP sans zoom, rejet tap simple, flèche MJ et autre étage', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Montrer un point ou retrouver un ping');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const canvas = guide.locator('.player-help-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas ping absent');
    const cdp = await context.newCDPSession(page);
    const zoomInitial = await canvas.getAttribute('data-camera-zoom');

    // Un seul tap ne lance pas de ping
    const tapPt = { x: Math.round(box.x + box.width * 0.42), y: Math.round(box.y + box.height * 0.5) };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...tapPt, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(360);
    await expect(canvas).toHaveAttribute('data-practice-phase', 'doubleTap');
    await expect(canvas).toHaveAttribute('data-ping-dot', 'false');

    // Deux taps éloignés ne lancent pas de ping
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...tapPt, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapPt.x + 80, y: tapPt.y, id: 3 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(360);
    await expect(canvas).toHaveAttribute('data-practice-phase', 'doubleTap');

    // Interruption pendant doubleTap par un ping d'un autre étage puis reprise sans tout recommencer
    await guide.getByRole('button', { name: /autre étage/ }).click();
    await expect(canvas).toHaveAttribute('data-other-floor-ping', 'true');
    await expect(canvas).toHaveAttribute('data-ping-arrow', 'false');
    await expect(canvas).toHaveAttribute('data-ping-dot', 'false');
    await expect(guide.getByRole('button', { name: /Aide clavier/ })).toHaveCount(0);
    await guide.getByRole('button', { name: 'Reprendre l’exercice' }).click();
    await expect(canvas).toHaveAttribute('data-other-floor-ping', 'false');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'doubleTap');
    await expect(guide.getByRole('button', { name: 'Aide clavier : Double tap sur le repère' })).toBeVisible();

    // Vrai double tap rapide au même point après retour -> ping sans zoom
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...tapPt, id: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...tapPt, id: 5 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'findGmPing');
    expect(await canvas.getAttribute('data-camera-zoom')).toBe(zoomInitial);

    // Flèche hors cadre du MJ à droite
    await expect(canvas).toHaveAttribute('data-ping-arrow', 'true', { timeout: 2500 });

    // Interruption pendant findGmPing par un ping d'un autre étage, puis reprise : la flèche revient
    await guide.getByRole('button', { name: /autre étage/ }).click();
    await expect(canvas).toHaveAttribute('data-other-floor-ping', 'true');
    await expect(canvas).toHaveAttribute('data-ping-arrow', 'false');
    await expect(canvas).toHaveAttribute('data-ping-dot', 'false');
    await expect(guide.getByRole('button', { name: /Aide clavier/ })).toHaveCount(0);
    await guide.getByRole('button', { name: 'Reprendre l’exercice' }).click();
    await expect(canvas).toHaveAttribute('data-other-floor-ping', 'false');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'findGmPing');
    await expect(canvas).toHaveAttribute('data-ping-arrow', 'true');
    await expect(guide.getByRole('button', { name: 'Aide clavier : Glisser vers la flèche du MJ' })).toBeVisible();

    // Glisser vers la gauche pour retrouver le point après reprise
    await cdpTouchDrag(cdp, box.x + box.width * 0.85, box.y + box.height * 0.5, box.x + box.width * 0.1, box.y + box.height * 0.5, { steps: 6 });
    await cdpTouchDrag(cdp, box.x + box.width * 0.85, box.y + box.height * 0.5, box.x + box.width * 0.1, box.y + box.height * 0.5, { steps: 6 });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'done');
    await expect(canvas).toHaveAttribute('data-ping-arrow', 'false');
    await expect(canvas).toHaveAttribute('data-ping-dot', 'true');

    // Vérifie aussi que les aides clavier fonctionnent immédiatement après retour sur chaque phase
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    await guide.getByRole('button', { name: /autre étage/ }).click();
    await guide.getByRole('button', { name: 'Reprendre l’exercice' }).click();
    await guide.getByRole('button', { name: 'Aide clavier : Double tap sur le repère' }).click();
    await expect(canvas).toHaveAttribute('data-practice-phase', 'findGmPing');
    await guide.getByRole('button', { name: /autre étage/ }).click();
    await guide.getByRole('button', { name: 'Reprendre l’exercice' }).click();
    await expect(canvas).toHaveAttribute('data-ping-arrow', 'true');
    await guide.getByRole('button', { name: 'Aide clavier : Glisser vers la flèche du MJ' }).click();
    await expect(canvas).toHaveAttribute('data-practice-phase', 'done');
    await expect(canvas).toHaveAttribute('data-ping-dot', 'true');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Ouvrir ou fermer une porte : ouverture/fermeture, tap invalide sur pion et porte verrouillée', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Ouvrir ou fermer une porte');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const canvas = guide.locator('.player-help-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas porte absent');

    // Tap sur le pion (à gauche) : n'ouvre pas la porte
    await page.mouse.click(box.x + box.width * 0.22, box.y + box.height * 0.5);
    await expect(canvas).toHaveAttribute('data-portal-state', 'closed');

    // Tap sur le milieu du seuil (colonne 3 / 7 ≈ 43 %, milieu vertical 50 %)
    const doorPt = { x: Math.round(box.x + box.width * (3 / 7)), y: Math.round(box.y + box.height * 0.5) };
    await page.mouse.click(doorPt.x, doorPt.y);
    await expect(canvas).toHaveAttribute('data-portal-state', 'open');
    await expect(canvas).toHaveAttribute('data-pawn-cell', '1,2');

    // Retap pour refermer
    await page.mouse.click(doorPt.x, doorPt.y);
    await expect(canvas).toHaveAttribute('data-portal-state', 'closed');
    await expect(guide.locator('[data-help-caption]')).toContainText('Parfait');

    // Essai 2 : porte verrouillée reste verrouillée sans bouton de déverrouillage
    await guide.getByRole('button', { name: /Porte verrouillée/ }).click();
    await expect(canvas).toHaveAttribute('data-portal-state', 'locked');
    await page.mouse.click(doorPt.x, doorPt.y);
    await expect(canvas).toHaveAttribute('data-portal-state', 'locked');
    await expect(guide.locator('[data-help-caption]')).toContainText('demande au MJ', { ignoreCase: true });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Monter ou descendre de cheval : cavalier autonome et cavalier lié géré par le MJ', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Monter ou descendre de cheval');
    await expect(guide.locator('.player-help-step-group h3')).toHaveText(['Monture à la tablette', 'Monture gérée par le MJ']);

    // Essai autonome
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const mountBtn = guide.locator('.player-help-strip .player-selection-mount');
    await expect(mountBtn).toBeEnabled();
    await expect(mountBtn).toHaveAttribute('aria-label', 'Monter à cheval');
    await mountBtn.click();
    await expect(mountBtn).toHaveAttribute('aria-label', 'Descendre de cheval');
    await expect(guide.locator('.player-help-prompt')).toHaveText('Descendre de cheval');

    // À cheval, taper l'escalier ne franchit pas
    await guide.getByRole('button', { name: 'Ariane sur l’escalier' }).click();
    await expect(guide.locator('.player-help-pawn')).toBeVisible();

    // Descendre puis franchir
    await mountBtn.click();
    await expect(guide.locator('.player-help-prompt')).toHaveText('Retaper pour prendre l’escalier');
    await guide.getByRole('button', { name: 'Ariane sur l’escalier' }).click();
    await expect(guide.locator('[data-help-caption]')).toContainText('Bravo');

    // Essai monture liée gérée par le MJ
    await guide.getByRole('button', { name: /monture gérée par le MJ/ }).click();
    await expect(mountBtn).toBeDisabled();
    await expect(guide.locator('.player-help-prompt')).toHaveText('Demander au MJ de vous faire descendre de cheval');
    await guide.getByRole('button', { name: 'Le MJ fait descendre le personnage' }).click();
    await expect(guide.locator('.player-help-prompt')).toHaveText('Retaper pour prendre l’escalier');
    await guide.getByRole('button', { name: 'Ariane sur l’escalier' }).click();
    await expect(guide.locator('[data-help-caption]')).toContainText('Bravo');
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Orienter ou déplacer un gabarit : cercle, annulation, poignée et pivot du cône via CDP', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    const guide = await openLessonFromToc(page, 'Orienter ou déplacer un gabarit');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const canvas = guide.locator('.player-help-canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas gabarit absent');
    const cdp = await context.newCDPSession(page);

    const zoom = Math.min(box.width / (9 * 140), box.height / (6 * 140)) * 0.96;
    const camX = (9 * 140) / 2;
    const camY = (6 * 140) / 2;
    /** @param {number} a @param {number} b */
    const pt = (a, b) => ({
      x: Math.round(box.x + ((a + 0.5) * 140 - camX) * zoom + box.width / 2),
      y: Math.round(box.y + ((b + 0.5) * 140 - camY) * zoom + box.height / 2),
    });

    const circleStart = pt(2, 3);
    const circleGoal = pt(6, 3);
    const initialX = await canvas.getAttribute('data-template-x');

    // Un tap immobile ne déplace pas le cercle
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...circleStart, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await canvas.getAttribute('data-template-x')).toBe(initialX);

    // Un glisser interrompu (touchCancel) restaure la pose précédente
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...circleStart, id: 2 }] });
    await page.waitForTimeout(170);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...circleGoal, id: 2 }] });
    await expect(canvas).toHaveAttribute('data-preview-active', 'true');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(canvas).toHaveAttribute('data-preview-active', 'false');
    expect(await canvas.getAttribute('data-template-x')).toBe(initialX);

    // Vrai glisser du cercle jusqu'au Repère 1
    await cdpTouchDrag(cdp, circleStart.x, circleStart.y, circleGoal.x, circleGoal.y, { holdBeforeMoveMs: 170 });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'rotateCone');
    await expect(canvas).toHaveAttribute('data-template-shape', 'cone');
    await expect(canvas).toHaveAttribute('data-template-dir', '85');

    // Translation par la pointe vers le haut du plateau (5.8, 0.2) : le cône à 85° couvre Repère 2
    // sans avoir pivoté — l'exercice doit continuer à attendre un vrai pivot depuis le corps.
    const coneStartHandle = pt(3, 3);
    const coneTranslatedHandle = pt(5.8, 0.2);
    await cdpTouchDrag(cdp, coneStartHandle.x, coneStartHandle.y, coneTranslatedHandle.x, coneTranslatedHandle.y, { holdBeforeMoveMs: 170 });
    await expect(canvas).toHaveAttribute('data-template-dir', '85');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'rotateCone');
    expect(Number(await canvas.getAttribute('data-template-y'))).toBeLessThan(200);

    // Replace la pointe vers (3, 3) puis vrai glisser depuis le corps du cône vers Repère 2 (6, 1)
    await cdpTouchDrag(cdp, coneTranslatedHandle.x, coneTranslatedHandle.y, coneStartHandle.x, coneStartHandle.y, { holdBeforeMoveMs: 170 });
    await expect(canvas).toHaveAttribute('data-template-dir', '85');
    await expect(canvas).toHaveAttribute('data-practice-phase', 'rotateCone');

    const coneOriginX = await canvas.getAttribute('data-template-x');
    const coneOriginY = await canvas.getAttribute('data-template-y');
    const coneBody = pt(3, 4.4);
    const coneTarget = pt(6, 1);
    await cdpTouchDrag(cdp, coneBody.x, coneBody.y, coneTarget.x, coneTarget.y, { holdBeforeMoveMs: 170 });
    await expect(canvas).toHaveAttribute('data-practice-phase', 'done');
    expect(await canvas.getAttribute('data-template-x')).toBe(coneOriginX);
    expect(await canvas.getAttribute('data-template-y')).toBe(coneOriginY);
    expect(Number(await canvas.getAttribute('data-template-dir'))).not.toBe(85);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Fermer une image partagée, Rejoindre la table et Passer en plein écran : isolation stricte', async ({ browser }) => {
  const { context, page, errors } = await openPlayer(browser);
  try {
    // 1. Fermer une image partagée (y compris avec une vraie image partagée ouverte dessous)
    await page.evaluate(async (imgUrl) => {
      await /** @type {any} */ (window).__RPG_APP__.transport.shareImage({ id: 'real-1', dataUrl: imgUrl, at: Date.now() });
    }, makePngDataUrl(640, 400, 30));
    await expect(page.locator('#image-share-overlay')).toBeVisible();

    const guide = await openLessonFromToc(page, 'Fermer une image partagée');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const fakeOverlay = guide.locator('.player-help-share-overlay');
    const fakeBox = await fakeOverlay.boundingBox();
    if (!fakeBox) throw new Error('Image fictive absente');
    // Appui au centre de l'image fictive : reste ouverte
    await page.mouse.click(fakeBox.x + fakeBox.width / 2, fakeBox.y + fakeBox.height / 2);
    await expect(fakeOverlay).toBeVisible();
    // Appui sur la croix fictive : ferme uniquement l'image de l'exercice
    await guide.getByRole('button', { name: 'Fermer l’image' }).click();
    await expect(fakeOverlay).toBeHidden();

    // Le MJ remplace la vraie image pendant que le guide est ouvert
    const secondUrl = makePngDataUrl(480, 320, 120);
    await page.evaluate(async (imgUrl) => {
      await /** @type {any} */ (window).__RPG_APP__.transport.shareImage({ id: 'real-2', dataUrl: imgUrl, at: Date.now() });
    }, secondUrl);

    // 2. Rejoindre la table : démonstration manuelle, lecture auto (bouton annelé puis carte) et exercice local
    const urlBefore = page.url();
    await openLessonFromToc(page, 'Rejoindre la table');
    const joinForm = guide.locator('.player-help-join-card');
    const joinSubmit = guide.locator('.player-help-join-submit');
    const joinTable = guide.locator('.player-help-join-table');

    // Avancement manuel : l'étape « Rejoindre » montre le bouton avec le contact du doigt,
    // puis l'étape « Vue joueurs » affiche la carte.
    await guide.locator('button[data-example="2"]').click();
    await expect(joinForm).toBeVisible();
    await expect(joinSubmit).toBeVisible();
    await expect(joinSubmit).toHaveClass(/is-ringed/);
    await expect(joinTable).toBeHidden();
    const joinRingStyle = await joinSubmit.evaluate((btn) => {
      const before = getComputedStyle(btn, '::before');
      return { width: before.width, borderRadius: before.borderRadius, borderTopColor: before.borderTopColor };
    });
    expect(joinRingStyle.width).toBe('34px');
    expect(joinRingStyle.borderRadius).toBe('50%');

    await guide.locator('button[data-example="3"]').click();
    await expect(joinForm).toBeHidden();
    await expect(joinTable).toBeVisible();

    // Lecture automatique : passe par le bouton annelé (« Rejoindre ») puis s'arrête sur la carte (« Vue joueurs »)
    await guide.getByRole('button', { name: 'Rejouer la démonstration' }).click();
    await expect(guide.locator('button[data-example="2"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 6000 });
    await expect(joinForm).toBeVisible();
    await expect(joinSubmit).toHaveClass(/is-ringed/);
    await expect(joinTable).toBeHidden();
    await expect(guide.locator('button[data-example="3"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 6000 });
    await expect(joinForm).toBeHidden();
    await expect(joinTable).toBeVisible();

    // Exercice local : champ vide refusé, code K7M4T réussi, URL intacte
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    await guide.getByRole('button', { name: 'Rejoindre la Table' }).click();
    await expect(guide.locator('[data-join-error]')).toBeVisible();
    await guide.getByLabel('Code de session (obligatoire)').fill('k7m4t');
    await guide.getByRole('button', { name: 'Rejoindre la Table' }).click();
    await expect(joinTable).toBeVisible();
    expect(page.url()).toBe(urlBefore);

    // 3. Passer en plein écran : deux taps dans la scène, sans toucher au vrai plein écran
    const fsBefore = await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.fullscreenRequests);
    await openLessonFromToc(page, 'Passer en plein écran');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    const fsBtn = guide.locator('.player-help-fs-btn');
    await expect(fsBtn).toHaveAttribute('aria-label', 'Plein écran');
    await fsBtn.click();
    await expect(fsBtn).toHaveAttribute('aria-label', 'Quitter le plein écran');
    await expect(guide.locator('.player-help-fs-frame')).toHaveAttribute('data-simulated-fullscreen', 'true');
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await fsBtn.click();
    await expect(fsBtn).toHaveAttribute('aria-label', 'Plein écran');
    await expect(guide.locator('.player-help-fs-frame')).toHaveAttribute('data-simulated-fullscreen', 'false');
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.fullscreenRequests)).toBe(fsBefore);

    // Fermeture du guide : la NOUVELLE vraie image partagée est toujours affichée dessous
    await guide.getByRole('button', { name: 'Revenir à la partie' }).click();
    await expect(guide).toBeHidden();
    await expect(page.locator('#image-share-overlay')).toBeVisible();
    await expect(page.locator('#image-share-overlay img')).toHaveAttribute('src', secondUrl);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Plein écran au premier geste : isolé du bouton ? et du dialogue (tap et clavier), conservé sur la carte et le bouton réel', async ({ browser }) => {
  const readFsCalls = (/** @type {Page} */ p) =>
    p.evaluate(() => /** @type {any} */ (window).__RPG_TEST_WIRE__.fullscreenRequests);

  // Chemin 1 : page fraîche -> premier tap tactile sur « ? », interactions dans le dialogue, fermeture, puis geste sur la carte
  {
    const { context, page, errors } = await openPlayer(browser);
    try {
      expect(await readFsCalls(page)).toBe(0);
      const helpBtn = page.getByRole('button', { name: 'Aide de jeu' });
      const guide = page.getByRole('dialog', { name: 'Aide de jeu' });

      await helpBtn.tap();
      await expect(guide).toBeVisible();
      await guide.locator('.player-help-toc-item', { hasText: 'Passer en plein écran' }).tap();
      await guide.getByRole('button', { name: 'À toi d’essayer' }).tap();
      await guide.locator('.player-help-fs-btn').tap();
      await guide.locator('.player-help-fs-btn').tap();
      await guide.getByRole('button', { name: 'Revenir à la partie' }).tap();
      await expect(guide).toBeHidden();
      await page.waitForTimeout(100);
      expect(await readFsCalls(page)).toBe(0);

      // Le premier geste sur la vraie carte active bien le plein écran
      const boardBox = await page.locator('#board').boundingBox();
      if (!boardBox) throw new Error('Canvas #board absent');
      await page.touchscreen.tap(Math.round(boardBox.x + 120), Math.round(boardBox.y + 120));
      await expect.poll(() => readFsCalls(page)).toBe(1);

      // Un second tap sur la carte ne redemande pas le plein écran, mais le vrai bouton reste actif
      await page.touchscreen.tap(Math.round(boardBox.x + 180), Math.round(boardBox.y + 120));
      await page.waitForTimeout(80);
      expect(await readFsCalls(page)).toBe(1);
      await page.locator('#player-fullscreen-btn').tap();
      await expect.poll(() => readFsCalls(page)).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }

  // Chemin 2 : page fraîche -> ouverture au clavier sur « ? », premier tap DANS le dialogue, puis bouton réel & geste carte
  {
    const { context, page, errors } = await openPlayer(browser);
    try {
      expect(await readFsCalls(page)).toBe(0);
      const helpBtn = page.getByRole('button', { name: 'Aide de jeu' });
      const guide = page.getByRole('dialog', { name: 'Aide de jeu' });

      await helpBtn.focus();
      await page.keyboard.press('Enter');
      await expect(guide).toBeVisible();
      await page.waitForTimeout(80);
      expect(await readFsCalls(page)).toBe(0);

      // Premier contact pointeur de la session : à l'intérieur du dialogue d'aide
      await guide.locator('.player-help-toc-item', { hasText: 'Rejoindre la table' }).tap();
      await guide.locator('button[data-example="2"]').tap();
      await guide.getByRole('button', { name: 'Revenir à la partie' }).tap();
      await expect(guide).toBeHidden();
      await page.waitForTimeout(100);
      expect(await readFsCalls(page)).toBe(0);

      // La commande réelle de plein écran fonctionne sans double déclenchement
      await page.locator('#player-fullscreen-btn').tap();
      await expect.poll(() => readFsCalls(page)).toBe(1);
      await page.waitForTimeout(80);
      expect(await readFsCalls(page)).toBe(1);

      // Le premier geste sur la vraie carte reste actif
      const boardBox = await page.locator('#board').boundingBox();
      if (!boardBox) throw new Error('Canvas #board absent');
      await page.touchscreen.tap(Math.round(boardBox.x + 120), Math.round(boardBox.y + 120));
      await expect.poll(() => readFsCalls(page)).toBe(2);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('Partie en arrière-plan : isolement complet, poursuite des événements MJ et invalidation du trajet', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 720 } });
  const gm = await context.newPage();
  const player = await context.newPage();
  const sessionId = `help-bg-${Date.now()}`;
  const snap = makeSnapshot();
  try {
    await Promise.all([
      installBrowserTransport(gm, sessionId, snap),
      installBrowserTransport(player, sessionId, snap),
    ]);
    await Promise.all([
      gm.goto(`/gm.html?session=${sessionId}`),
      player.goto(`/player.html?session=${sessionId}`),
    ]);
    await Promise.all([waitForApp(gm), waitForApp(player)]);
    await waitForPlayerVision(player);

    const tapCell = async (/** @type {{a:number,b:number}} */ cell) => {
      const pt = await player.evaluate(async (target) => {
        const [{ gridFor }, store] = await Promise.all([import('../js/grid/index.js'), import('../js/state/store.js')]);
        const level = store.getActiveLevel();
        if (!level) throw new Error('Étage absent');
        const app = /** @type {any} */ (window).__RPG_APP__;
        const p = app.camera.mapToScreen(gridFor(level).pointFromCell(target));
        const r = app.canvas.getBoundingClientRect();
        return { x: Math.round(r.left + p.screenX), y: Math.round(r.top + p.screenY) };
      }, cell);
      await player.touchscreen.tap(pt.x, pt.y);
    };

    // Préparer un trajet réel avant d'ouvrir le guide
    await tapCell({ a: 2, b: 2 });
    await tapCell({ a: 3, b: 2 });
    const readPreviews = () => player.evaluate((sid) =>
      /** @type {any} */ (window).__rpgTestMovePreviews('get', sid, 'reader', null), sessionId);
    await expect.poll(async () => Object.keys(await readPreviews())).toHaveLength(1);
    const beforeState = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      return {
        camera: { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom },
        levelId: store.getActiveLevelId(),
        publishedCount: /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length,
        tokenCell: store.getCampaign()?.tokens[0]?.cell,
      };
    });
    const beforePreviews = await readPreviews();

    // Ouvrir le guide et exercer plusieurs fiches
    const guide = await openLessonFromToc(player, 'Ouvrir ou fermer une porte');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    await guide.getByRole('button', { name: 'Aide clavier : Toucher la porte' }).click();
    await openLessonFromToc(player, 'Cadrer et zoomer');
    await guide.getByRole('button', { name: 'À toi d’essayer' }).click();
    await guide.getByRole('button', { name: 'Aide clavier : Glisser vers le puits' }).click();

    // Le MJ renomme un PNJ pendant l'ouverture : s'applique en direct
    await gm.evaluate(async () => {
      await /** @type {any} */ (window).__RPG_APP__.transport.publish({
        type: 'token.update',
        payload: { tokenId: 'pnj-reel', patch: { label: 'Capitaine' } },
        at: Date.now(),
        by: 'gm',
      });
    });
    await expect.poll(() => player.evaluate(async () =>
      (await import('../js/state/store.js')).getCampaign()?.tokens.find((t) => t.id === 'pnj-reel')?.label
    )).toBe('Capitaine');

    // Fermer : aucun événement joueur publié, même cadrage, même trajet toujours valide
    await guide.getByRole('button', { name: 'Revenir à la partie' }).click();
    const afterValid = await player.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const app = /** @type {any} */ (window).__RPG_APP__;
      return {
        camera: { x: app.camera.x, y: app.camera.y, zoom: app.camera.zoom },
        levelId: store.getActiveLevelId(),
        publishedCount: /** @type {any} */ (window).__RPG_TEST_WIRE__.published.length,
        tokenCell: store.getCampaign()?.tokens[0]?.cell,
      };
    });
    expect(afterValid).toEqual(beforeState);
    expect(await readPreviews()).toEqual(beforePreviews);

    // Scénario 2 : le MJ referme la porte qui bloquait le trajet pendant que le guide est ouvert
    await openLessonFromToc(player, 'Déplacer mon personnage');
    await gm.evaluate(async () => {
      const store = await import('../js/state/store.js');
      store.setPortalState('rdc', 'porte-bg', 'closed');
      await /** @type {any} */ (window).__RPG_APP__.transport.publish({
        type: 'portal.toggle',
        payload: { levelId: 'rdc', portalId: 'porte-bg', state: 'closed' },
        at: Date.now(),
        by: 'gm',
      });
    });
    await expect.poll(async () => Object.keys(await readPreviews())).toHaveLength(0);
    await guide.getByRole('button', { name: 'Revenir à la partie' }).click();
    // Le retour rend l'état courant (trajet invalidé, aucun ancien instantané restauré)
    expect(await readPreviews()).toEqual({});
    // Les gestes de la vraie carte redeviennent immédiatement disponibles
    await tapCell({ a: 2, b: 3 });
    await expect.poll(async () => Object.keys(await readPreviews())).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test('Rendu multi-résolutions (1024×768, 1280×720, 1920×1080, 390×844) et prefers-reduced-motion', async ({ browser }, testInfo) => {
  const viewports = [
    { name: '1024x768', width: 1024, height: 768 },
    { name: '1280x720', width: 1280, height: 720 },
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '390x844', width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    const { context, page, errors } = await openPlayer(browser, { viewport: { width: vp.width, height: vp.height } });
    try {
      const helpBtn = page.getByRole('button', { name: 'Aide de jeu' });
      await helpBtn.click();
      const guide = page.getByRole('dialog', { name: 'Aide de jeu' });
      await expect(guide).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`sommaire-${vp.name}.png`) });

      // L'en-tête « Revenir à la partie » reste visible même après défilement
      await guide.locator('.player-help-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const closeBox = await guide.getByRole('button', { name: 'Revenir à la partie' }).boundingBox();
      expect(closeBox?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect(closeBox?.height ?? 0).toBeGreaterThanOrEqual(44);

      if (vp.name === '1280x720' || vp.name === '390x844') {
        // Étape avec cartouche long (Corriger mon trajet étape 1 Marche+Course et étape 2 Course)
        await openLessonFromToc(page, 'Corriger mon trajet');
        await guide.locator('button[data-example="1"]').click();
        await page.screenshot({ path: testInfo.outputPath(`corriger-retrait-${vp.name}.png`) });
        await guide.locator('button[data-example="2"]').click();
        await page.screenshot({ path: testInfo.outputPath(`corriger-course-${vp.name}.png`) });

        // Étape cartouche long + bande droite (Monter ou descendre de cheval, monture liée)
        await openLessonFromToc(page, 'Monter ou descendre de cheval');
        await guide.locator('button[data-example="2"]').click();
        await page.screenshot({ path: testInfo.outputPath(`monture-liee-${vp.name}.png`) });

        // Phase à deux doigts (Cadrer et zoomer, Agrandir)
        await openLessonFromToc(page, 'Cadrer et zoomer');
        await guide.locator('button[data-example="1"]').click();
        await page.screenshot({ path: testInfo.outputPath(`cadrer-pincement-${vp.name}.png`) });

        // Étape « Rejoindre » (bouton avec contact du doigt) sur bureau et mobile
        await openLessonFromToc(page, 'Rejoindre la table');
        await guide.locator('button[data-example="2"]').click();
        await page.screenshot({ path: testInfo.outputPath(`rejoindre-bouton-${vp.name}.png`) });
      }

      if (vp.name === '1280x720') {
        await openLessonFromToc(page, 'Consulter un pion et ses états');
        await guide.locator('button[data-example="2"]').click();
        await page.screenshot({ path: testInfo.outputPath('consulter-maintien-1280x720.png') });

        await openLessonFromToc(page, 'Montrer un point ou retrouver un ping');
        await guide.locator('button[data-example="1"]').click();
        await page.screenshot({ path: testInfo.outputPath('ping-fleche-1280x720.png') });

        await openLessonFromToc(page, 'Ouvrir ou fermer une porte');
        await guide.locator('button[data-example="2"]').click();
        await page.screenshot({ path: testInfo.outputPath('porte-verrouillee-1280x720.png') });

        await openLessonFromToc(page, 'Orienter ou déplacer un gabarit');
        await guide.locator('button[data-example="2"]').click();
        await page.screenshot({ path: testInfo.outputPath('gabarit-pivot-1280x720.png') });

        await openLessonFromToc(page, 'Rejoindre la table');
        await guide.locator('button[data-example="1"]').click();
        await page.screenshot({ path: testInfo.outputPath('rejoindre-code-1280x720.png') });
        await guide.locator('button[data-example="3"]').click();
        await page.screenshot({ path: testInfo.outputPath('rejoindre-carte-1280x720.png') });

        await openLessonFromToc(page, 'Passer en plein écran');
        await guide.locator('button[data-example="0"]').click();
        await page.screenshot({ path: testInfo.outputPath('plein-ecran-1280x720.png') });
      }

      if (vp.name === '1024x768') {
        // Aide ouverte par-dessus une vraie image partagée
        await page.evaluate(async (imgUrl) => {
          await /** @type {any} */ (window).__RPG_APP__.transport.shareImage({ id: 'real-shot', dataUrl: imgUrl, at: Date.now() });
        }, makePngDataUrl(640, 400, 65));
        await expect(page.locator('#image-share-overlay')).toBeVisible();
        await openLessonFromToc(page, 'Fermer une image partagée');
        await page.screenshot({ path: testInfo.outputPath('aide-sur-image-partagee-1024x768.png') });
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }

  // Vérification prefers-reduced-motion: reduce (transition coupée, étapes et légendes utilisables)
  const { context, page, errors } = await openPlayer(browser, {
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
  });
  try {
    const guide = await openLessonFromToc(page, 'Déplacer mon personnage');
    const transitionDuration = await guide.locator('.player-help-pawn').evaluate((el) =>
      window.getComputedStyle(el).transitionDuration
    );
    expect(transitionDuration).toBe('0s');
    await guide.locator('button[data-example="2"]').click();
    await expect(guide.locator('[data-help-caption]')).toContainText('Ton personnage rejoint la case choisie.');
    await page.screenshot({ path: testInfo.outputPath('reduced-motion-1280x720.png') });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
