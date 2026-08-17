// @ts-check
import { test, expect } from '@playwright/test';
import { waitForApp, installBrowserTransport } from './browserTestTransport.mjs';

test.describe('CORRECTIF — Désarmement des outils MJ & Indicateur d\'outil actif', () => {
  test.beforeEach(async ({ page }) => {
    const sessionId = `test-disarm-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);

    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);

      const level = schema.createLevel({
        id: 'level-disarm-1',
        name: 'Étage Test Disarm',
        widthCells: 20,
        heightCells: 20,
      });

      const token = schema.createToken({
        id: 'hero-disarm-1',
        label: 'Héro',
        levelId: 'level-disarm-1',
        cell: { a: 4, b: 4 },
        speedCells: 5,
      });

      const campaign = schema.createCampaign({ levels: [level], tokens: [token] });
      store.loadCampaign(campaign);
    });
  });

  test('2. Touche Échap (Escape) désarme l\'outil actif et rend la saisie de pion', async ({ page }) => {
    // Armer le pinceau de fog
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');

    const activeBeforeEsc = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.getActiveToolName();
    });
    expect(activeBeforeEsc).toBe('fog-reveal');

    // Presser la touche Échap
    await page.keyboard.press('Escape');

    const activeAfterEsc = await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      return w.__RPG_APP__?.gmPanel?.getActiveToolName();
    });
    expect(activeAfterEsc).toBe('none');
  });

  test('3. Exclusion mutuelle des 3 paires d\'outils', async ({ page }) => {
    // Armer Fog
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    let tool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('fog-reveal');

    // Armer Murs via programmatic call (ou via onglet)
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__RPG_APP__?.gmPanel?.setActiveTool('wall-draw');
    });
    tool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('wall-draw');

    // Armer Gabarits
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__RPG_APP__?.gmPanel?.setActiveTool('template-place');
    });
    tool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(tool).toBe('template-place');
  });

  test('4. La marque .gm-tab-active-tool apparaît sur l\'onglet de l\'outil armé et disparaît au désarmement', async ({ page }) => {
    // Armer Fog
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');

    const hasMarkArmed = await page.evaluate(() => {
      const btn = document.querySelector('button[data-tab="fog-tools"]');
      return btn ? btn.classList.contains('gm-tab-active-tool') : false;
    });
    expect(hasMarkArmed).toBe(true);

    // Changer d'onglet vers Pions (ce qui désarme l'outil)
    await page.click('button[data-tab="token-maker"]');

    const hasMarkDisarmed = await page.evaluate(() => {
      const btn = document.querySelector('button[data-tab="fog-tools"]');
      return btn ? btn.classList.contains('gm-tab-active-tool') : false;
    });
    expect(hasMarkDisarmed).toBe(false);
  });

  test('5. Abandon du tracé de mur au changement d\'onglet', async ({ page }) => {
    // Initialiser le nombre de murs
    const initialWallCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const lvl = store.getActiveLevel();
      return lvl?.walls?.length ?? 0;
    });

    // Aller sur l'onglet Murs et armer
    await page.click('#gm-mode-prep');
    await page.click('button[data-tab="wall-editor"]');
    await page.click('#wall-btn-arm');

    // Cliquer sur le canvas pour ajouter un premier sommet
    const board = page.locator('#board');
    const box = await board.boundingBox();
    if (!box) throw new Error('canvas boundingBox est null');
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);

    // Changer d'onglet vers Liaisons
    await page.click('button[data-tab="link-editor"]');

    // Vérifier qu'aucun mur n'a été créé
    const finalWallCount = await page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      const lvl = store.getActiveLevel();
      return lvl?.walls?.length ?? 0;
    });

    expect(finalWallCount).toBe(initialWallCount);
  });

  test('UX-03 — un outil survit à la bascule de mode, agit encore, et le bandeau le dit', async ({ page }) => {
    // ⭐ Ce test lève deux réserves de la relecture d'UX-03, et il n'existait pas.
    //
    // 1. La survie de l'outil n'était prouvée que sur `getActiveToolName()`, c'est-à-dire sur
    //    l'ÉTIQUETTE. Ce dépôt a déjà attrapé un mock qui implémentait l'inverse du mécanisme
    //    testé : un outil peut se déclarer armé pendant que le prédicat qui le fait agir est
    //    cassé. On mesure donc ici son EFFET — le pinceau peint-il encore ?
    // 2. La séquence réellement dangereuse n'était jouée par aucun test : armer dans un mode,
    //    basculer de mode, et toucher la carte SANS passer par un onglet. C'est celle-là qui se
    //    produira en séance, et c'est la seule que le bandeau protège.
    //
    // ⛔ Le comportement figé ici est VOULU, pas subi : le mainteneur a explicitement demandé que
    // l'outil survive à la bascule, parce qu'il prépare parfois en cours de partie. Le bandeau est
    // la contrepartie. Ne pas « corriger » ce test en faisant désarmer la bascule.
    // ⚠ Deux libellés, pas un : `fogTools.updateUI` écrit « Annuler (n) » quand la pile porte
    // quelque chose et « Annuler » tout court quand elle est vide. Une sonde qui n'attend que la
    // forme parenthésée rend −1 sur une pile vide et ne distingue plus « pile à zéro » de « bouton
    // introuvable ». On garde −1 pour le seul cas aveugle, celui qui doit faire échouer la sonde
    // elle-même plutôt que le correctif.
    const undoCount = () =>
      page.evaluate(() => {
        const texte = document.querySelector('#fog-btn-undo')?.textContent ?? '';
        const found = /Annuler \((\d+)\)/.exec(texte);
        if (found) return Number(found[1]);
        return /Annuler/.test(texte) ? 0 : -1;
      });
    const toolName = () =>
      page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());

    // Mode Jouer, l'onglet Fog lui appartient : on arme, et le bandeau n'a rien à dire.
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    expect(await toolName()).toBe('fog-reveal');
    await expect(page.locator('#gm-active-tool-banner')).toBeHidden();
    const avant = await undoCount();
    expect(avant, 'la pile d’undo du fog doit être lisible').toBeGreaterThanOrEqual(0);

    // Bascule vers Préparer : l'onglet Fog disparaît, l'outil reste armé, le bandeau prend le
    // relais de l'indicateur d'onglet — qui n'est plus visible.
    await page.click('#gm-mode-prep');
    expect(await toolName()).toBe('fog-reveal');
    await expect(page.locator('#gm-active-tool-banner')).toBeVisible();

    // ⭐ L'EFFET, et non l'étiquette : un coup de pinceau sur la carte empile bien un undo.
    const board = page.locator('#board');
    const box = await board.boundingBox();
    if (!box) throw new Error('canvas boundingBox est null');
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
    await expect.poll(undoCount, { timeout: 8000 }).toBeGreaterThan(avant);

    // Le bouton du bandeau est la porte de sortie : elle doit marcher depuis l'autre mode.
    await page.click('#gm-disarm-active-tool');
    expect(await toolName()).toBe('none');
    await expect(page.locator('#gm-active-tool-banner')).toBeHidden();

    // Et l'amendement A3 tient toujours par-dessus toute cette plomberie : un clic d'ONGLET
    // désarme, même quand l'outil vient d'un autre mode que celui affiché.
    await page.click('#gm-mode-play');
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    await page.click('#gm-mode-prep');
    expect(await toolName()).toBe('fog-reveal');
    await page.click('button[data-tab="wall-editor"]');
    expect(await toolName()).toBe('none');
    await expect(page.locator('#gm-active-tool-banner')).toBeHidden();
  });

  test('UX-04 — la barre de vitalité : chiffres pour un PJ, crans pour un PNJ, sans désarmer', async ({ page }) => {
    /**
     * Pose un pion et le sélectionne. L'identifiant est explicite : `addToken` refuse un doublon,
     * et le dernier cas de ce test repose un PJ après en avoir déjà posé un.
     *
     * @param {string} id
     * @param {'pc'|'npc'} kind
     * @param {{current: number, max: number}|null} hp
     */
    const poserPion = (id, kind, hp) =>
      page.evaluate(
        async ({ id: identifiant, kind: k, hp: points }) => {
          const [store, schema] = await Promise.all([
            import('../js/state/store.js'),
            import('../js/core/schema.js'),
          ]);
          store.addToken(
            schema.createToken({
              id: identifiant,
              label: k === 'pc' ? 'Aldric' : 'Gobelin',
              kind: k,
              levelId: 'level-disarm-1',
              cell: { a: 8, b: 8 },
              hp: points,
            })
          );
          store.selectToken(identifiant);
        },
        { id, kind, hp }
      );

    const barre = page.locator('#gm-vitals-bar');
    const groupePv = page.locator('#gm-vitals-hp');
    const groupeSante = page.locator('#gm-vitals-health');
    const outilArme = () =>
      page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    const pionLu = () =>
      page.evaluate(async () => {
        const store = await import('../js/state/store.js');
        const pion = store.getSelectedToken();
        return { health: pion?.health, current: pion?.hp?.current };
      });

    // Aucun pion sélectionné : la barre n'est pas à l'écran, comme la barre d'étage sur une
    // campagne à un seul étage. Rien ne s'ajoute au bandeau du cas courant.
    await expect(barre).toBeHidden();

    // ── Un PJ : des PV chiffrés, et AUCUN cran de santé ────────────────────────────────────
    await poserPion('pj-vital', 'pc', { current: 12, max: 20 });
    await expect(barre).toBeVisible();
    await expect(groupePv).toBeVisible();
    await expect(groupeSante).toBeHidden();
    await expect(page.locator('#gm-vitals-hp-max')).toHaveText('/ 20');
    await expect(page.locator('#gm-vitals-hp-current')).toHaveValue('12');

    // La saisie atteint le store.
    await page.fill('#gm-vitals-hp-current', '7');
    await page.locator('#gm-vitals-hp-current').blur();
    await expect.poll(pionLu).toMatchObject({ current: 7 });

    // ⛔ Un dépassement se borne au maximum et ne se publie pas tel quel : l'anneau du pion se
    // dessine en proportion, et un courant au-dessus du maximum le ferait déborder.
    await page.fill('#gm-vitals-hp-current', '999');
    await page.locator('#gm-vitals-hp-current').blur();
    await expect(page.locator('#gm-vitals-hp-current')).toHaveValue('20');
    await expect.poll(pionLu).toMatchObject({ current: 20 });

    // ── Un PNJ : des crans, et AUCUN chiffre ──────────────────────────────────────────────
    await poserPion('pnj-vital', 'npc', { current: 5, max: 5 });
    await expect(groupePv).toBeHidden();
    await expect(groupeSante).toBeVisible();
    await expect(page.locator('#gm-vitals-health-unharmed')).toHaveAttribute('aria-pressed', 'true');

    await page.click('#gm-vitals-health-critical');
    // ⛔ L'état de santé ne dérive JAMAIS des points de vie, ni l'inverse (chantier Q,
    // interdiction n°4) : passer en critique laisse `current` intact, et c'est vérifié ici.
    await expect.poll(pionLu).toEqual({ health: 'critical', current: 5 });
    await expect(page.locator('#gm-vitals-health-critical')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#gm-vitals-health-unharmed')).toHaveAttribute('aria-pressed', 'false');

    // ── Et surtout : la barre ne désarme aucun outil ──────────────────────────────────────
    // C'est la raison pour laquelle la bascule automatique vers l'onglet Pions a été écartée :
    // elle passerait par `activateTab`, donc par `disarmActiveTool`.
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    expect(await outilArme()).toBe('fog-reveal');
    await page.click('#gm-vitals-health-wounded');
    await expect.poll(pionLu).toMatchObject({ health: 'wounded' });
    expect(await outilArme()).toBe('fog-reveal');

    // Un pion sans points de vie : la barre reste et dit pourquoi elle est vide, plutôt que
    // d'offrir des contrôles qui ne mèneraient à rien.
    await poserPion('pj-sans-pv', 'pc', null);
    await expect(barre).toBeVisible();
    await expect(groupePv).toBeHidden();
    await expect(groupeSante).toBeHidden();
    await expect(page.locator('#gm-vitals-hint')).toContainText('Aucun point de vie');
  });

  test('6. Recliquer le bouton d\'outil actif le désarme (Critère 7 & Amendement A4)', async ({ page }) => {
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');

    let activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('fog-reveal');

    // Recliquer Révéler
    await page.click('#fog-btn-tool-reveal');

    activeTool = await page.evaluate(() => (/** @type {any} */ (window)).__RPG_APP__?.gmPanel?.getActiveToolName());
    expect(activeTool).toBe('none');
  });
});

/**
 * UX-08 — « Générer » arme la pose, et le pion se pose là où l'on tape.
 *
 * `tokenMaker` créait le pion en `cell: { a: 0, b: 0 }`, **en dur** : un PNJ créé en cours de
 * séance apparaissait à l'angle de la carte, souvent hors écran, souvent sous le brouillard, et
 * il fallait le glisser jusqu'à sa place sous les yeux de la table.
 */
test.describe('UX-08 — Un pion créé se pose là où l\'on tape', () => {
  const PNG_1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwvjb3YAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAXSURBVHic7cExAQAAAMKg9U9tCj8gAAAAAAB4BhVMAAFxPbfKAAAAAElFTkSuQmCC';

  test.beforeEach(async ({ page }) => {
    const sessionId = `test-ux08-${Date.now()}`;
    await installBrowserTransport(page, sessionId, null);
    await page.goto(`/gm.html?session=${sessionId}`);
    await waitForApp(page);
    await page.evaluate(async () => {
      const [store, schema] = await Promise.all([
        import('../js/state/store.js'),
        import('../js/core/schema.js'),
      ]);
      const level = schema.createLevel({
        id: 'lvl-ux08', name: 'Étage UX-08', widthCells: 20, heightCells: 20, pxPerCell: 140,
      });
      store.loadCampaign(schema.createCampaign({ levels: [level] }));
    });
  });

  /** @param {import('@playwright/test').Page} page */
  async function genererUnPion(page) {
    await page.click('button[data-tab="token-maker"]');
    await page.setInputFiles('#token-file-input', {
      name: 'pnj.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_1x1, 'base64'),
    });
    await expect(page.locator('#btn-generate-token')).toBeEnabled();
    await page.click('#btn-generate-token');
  }

  /** @param {import('@playwright/test').Page} page */
  const outilActif = (page) =>
    page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.getActiveToolName());

  /** @param {import('@playwright/test').Page} page */
  const pions = (page) =>
    page.evaluate(async () => {
      const store = await import('../js/state/store.js');
      return (store.getState().campaign?.tokens ?? []).map((t) => ({ id: t.id, cell: t.cell }));
    });

  test('Critères 1 et 3 : le pion se pose sur la case tapée, jamais en (0,0), et l\'outil se désarme seul', async ({ page }) => {
    await genererUnPion(page);

    // ⭐ Générer n'ajoute plus rien : il ARME. C'est la moitié du critère que le test doit voir,
    // sinon un code qui ajoute ET arme passerait au vert.
    expect(await outilActif(page), 'générer doit armer la pose').toBe('token-place');
    expect(await pions(page), 'générer ne doit ajouter aucun pion à lui seul').toEqual([]);

    // Tap au centre de la case (7, 5) : (7,5 × 140 ; 5,5 × 140).
    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 7.5 * 140, y: 5.5 * 140 },
        screenPos: { x: 300, y: 300 },
      });
    });

    const poses = await pions(page);
    expect(poses.length, 'le tap doit avoir posé le pion').toBe(1);
    expect(poses[0].cell, 'le pion se pose sur la case tapée, jamais en (0,0)').toEqual({ a: 7, b: 5 });
    expect(await outilActif(page), 'l\'outil se désarme seul après la pose').toBe('none');

    // Le pion part sur le réseau par l'événement qui existait déjà, pas un nouveau.
    const publies = await page.evaluate(() =>
      /** @type {any} */ (window).__RPG_TEST_WIRE__.published
        .filter((/** @type {any} */ e) => e.type === 'token.add')
        .map((/** @type {any} */ e) => e.payload.token.cell)
    );
    expect(publies).toEqual([{ a: 7, b: 5 }]);

    // Un second tap ne doit pas coller un deuxième exemplaire.
    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 2.5 * 140, y: 2.5 * 140 },
        screenPos: { x: 100, y: 100 },
      });
    });
    expect((await pions(page)).length, 'l\'outil désarmé ne pose plus rien').toBe(1);
  });

  test('Critère 2 : armer la pose d\'un pion désarme l\'outil précédent, et réciproquement', async ({ page }) => {
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    expect(await outilActif(page)).toBe('fog-reveal');

    await genererUnPion(page);
    expect(await outilActif(page), 'la pose de pion prend la main').toBe('token-place');
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.fogTools?.getActiveTool()),
      'le pinceau de fog doit avoir été désarmé'
    ).toBe('none');

    // Réciproquement : armer le fog abandonne la pose du pion.
    await page.click('button[data-tab="fog-tools"]');
    await page.click('#fog-btn-tool-reveal');
    expect(await outilActif(page)).toBe('fog-reveal');
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.hasPendingToken()),
      'le pion en attente ne doit pas survivre au désarmement'
    ).toBe(false);
  });

  test('Critère 4 : un changement d\'onglet en cours d\'armement désarme, comme pour les autres outils', async ({ page }) => {
    await genererUnPion(page);
    expect(await outilActif(page)).toBe('token-place');

    await page.click('button[data-tab="handouts"]');
    expect(await outilActif(page), 'changer d\'onglet désarme (amendement A3)').toBe('none');
    expect(
      await page.evaluate(() => /** @type {any} */ (window).__RPG_APP__?.gmPanel?.hasPendingToken())
    ).toBe(false);

    // Et le tap qui suit ne pose rien : c'est la panne que le désarmement doit empêcher.
    await page.evaluate(() => {
      /** @type {any} */ (window).__RPG_APP__.pointerInput.onIntention({
        type: 'tap',
        mapPos: { x: 7.5 * 140, y: 5.5 * 140 },
        screenPos: { x: 300, y: 300 },
      });
    });
    expect(await pions(page)).toEqual([]);
  });
});
