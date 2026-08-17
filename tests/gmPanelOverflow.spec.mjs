// @ts-check
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { installBrowserTransport, waitForApp } from './browserTestTransport.mjs';

/**
 * Le panneau MJ ne doit rien laisser dépasser à droite.
 *
 * Constaté en séance le 11/08/2026 : « l'interface disparaît en partie à droite de l'écran,
 * et ça s'est corrigé quand j'ai commencé à entrer des valeurs pour créer un pion ».
 *
 * Cause trouvée : le formulaire du créateur de pions est une grille
 * `grid-template-columns: 140px 1fr`, et **un champ de saisie ne descend pas sous sa largeur
 * intrinsèque** — environ vingt caractères — tant qu'on ne lui donne pas `min-width: 0`. La
 * colonne `1fr` refusait donc de rétrécir, `#token-id` sortait de 26 px, et `#gm-app` étant
 * en `overflow: hidden`, la partie droite était coupée net.
 *
 * ⚠ Pourquoi une garde générale plutôt qu'un test sur ce champ : le piège est structurel. Tout
 * champ ajouté demain dans une grille ou un flex le reproduira, et personne ne s'en souviendra.
 * On vérifie donc l'invariant — rien ne dépasse — onglet par onglet.
 */

const scene = JSON.parse(fs.readFileSync('maps/generated/testvideo-3.scene.json', 'utf8'));
const niveau = scene.levels[0];

const SNAPSHOT = {
  campaign: {
    schemaVersion: 2,
    campaignId: 'panneau-debordement',
    name: 'Panneau',
    levels: [niveau],
    links: [],
    tokens: [],
    templates: [],
    settings: {},
  },
  activeLevelId: niveau.id,
  selectedTokenId: null,
  activeHandout: null,
};

const ONGLETS_JOUER = ['Pions', 'Handouts', '🌫️ Fog', '📐 Gabarits'];
const ONGLETS_PREPARER = ['📂 Cartes', 'UVTT', 'Image', '🧱 Murs', '↕ Liaisons', 'Grille'];

// 1024 est la largeur basse annoncée tenue par la phase R0 ; 1440 est le poste du MJ.
for (const largeur of [1024, 1440]) {
  test(`panneau MJ : aucun débordement à droite, tous onglets, ${largeur} px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: largeur, height: 900 } });
    const page = await context.newPage();
    /** @type {string[]} */
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));
    // ⚠ Un code de session **réaliste** : `createSessionCode` en produit un de 5 caractères,
    // fait pour être dicté. Un identifiant long et bavard poussait le bouton « Quitter la
    // session » hors du panneau et faisait échouer ce test pour une raison qui n'arrive
    // jamais en séance. La fragilité de l'en-tête aux noms longs est réelle mais distincte,
    // et elle ne doit pas masquer l'invariant qu'on cherche à tenir ici.
    await installBrowserTransport(page, `T${largeur}A`.slice(0, 5).toUpperCase(), SNAPSHOT);
    await page.goto('/gm.html');
    await waitForApp(page);

    /** @returns {Promise<{ debordement: number, coupable: string }>} */
    const mesure = () =>
      page.evaluate(() => {
        const panel = /** @type {HTMLElement} */ (document.getElementById('gm-panel'));
        const rp = panel.getBoundingClientRect();
        let pire = 0;
        let coupable = '';
        for (const el of panel.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const depassement = r.right - rp.right;
          if (depassement > pire) {
            pire = depassement;
            coupable = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`;
          }
        }
        return { debordement: pire, coupable };
      });

    /** @type {string[]} */
    const vus = [];

    // 1. Parcours du mode Jouer (mode par défaut)
    await page.click('#gm-mode-play');
    for (const nom of ONGLETS_JOUER) {
      const bouton = page.locator('.gm-tabs-header button', { hasText: nom }).first();
      await bouton.click();
      await page.waitForTimeout(250);
      const { debordement, coupable } = await mesure();
      vus.push(nom);
      // 1 px de tolérance : les rectangles sont fractionnaires.
      expect(debordement, `mode Jouer — onglet « ${nom} » — ${coupable} dépasse de ${Math.round(debordement)} px`)
        .toBeLessThan(1);
    }

    // 2. Parcours du mode Préparer
    await page.click('#gm-mode-prep');
    for (const nom of ONGLETS_PREPARER) {
      const bouton = page.locator('.gm-tabs-header button', { hasText: nom }).first();
      await bouton.click();
      await page.waitForTimeout(250);
      const { debordement, coupable } = await mesure();
      vus.push(nom);
      // 1 px de tolérance : les rectangles sont fractionnaires.
      expect(debordement, `mode Préparer — onglet « ${nom} » — ${coupable} dépasse de ${Math.round(debordement)} px`)
        .toBeLessThan(1);
    }

    // ⛔ Contrôle des 10 onglets réellement visités sur les 2 modes
    expect(vus.length, `onglets réellement visités : ${vus.join(', ')}`).toBe(10);

    // 3. UX-04 — la barre de vitalité, VISIBLE, dans ses deux formes.
    //
    // ⚠ Sans ce bloc, ce test mesurait la barre **masquée** : elle ne s'affiche qu'avec un pion
    // sélectionné, et rien plus haut n'en sélectionne. Or sa forme PNJ aligne trois boutons —
    // « Indemne », « Blessé », « Critique » — dans un panneau qui ne fait que 360 px à 1024, et
    // c'est exactement la forme du débordement qui a déjà rougi en CI sur des fontes plus larges
    // (voir la leçon du 13/08 dans QUESTIONS-EN-ATTENTE.md §F). Le mesurer masqué revenait à ne
    // rien mesurer.
    for (const [id, kind] of /** @type {[string, 'pc'|'npc'][]} */ ([
      ['pj-overflow', 'pc'],
      ['pnj-overflow', 'npc'],
    ])) {
      await page.evaluate(
        async ({ id: identifiant, kind: espece }) => {
          const [store, schema] = await Promise.all([
            import('../js/state/store.js'),
            import('../js/core/schema.js'),
          ]);
          // ⚠ L'étage vient d'une fixture de scène : son identifiant se lit, il ne se suppose pas.
          const levelId = store.getActiveLevelId() ?? undefined;
          store.addToken(
            schema.createToken({
              id: identifiant,
              // Un nom long exprès : la barre doit le tronquer, pas pousser le reste dehors.
              label: espece === 'pc' ? 'Aldric de Montcorbeau l’Ancien' : 'Gobelin sanguinaire',
              kind: espece,
              levelId,
              cell: { a: 1, b: 1 },
              hp: { current: 12, max: 20 },
            })
          );
          store.selectToken(identifiant);
        },
        { id, kind }
      );
      await expect(page.locator('#gm-vitals-bar')).toBeVisible();
      await page.waitForTimeout(250);
      const { debordement, coupable } = await mesure();
      expect(
        debordement,
        `barre de vitalité — ${kind} — ${coupable} dépasse de ${Math.round(debordement)} px`
      ).toBeLessThan(1);
    }

    expect(erreurs).toEqual([]);
    await context.close();
  });
}
