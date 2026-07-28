// @ts-check
// Page de diagnostic matériel. Sert à répondre aux décisions d'`ETAT.md` §6 qui exigent
// l'appareil physique et qu'aucun test ne peut cocher (interdiction n°14) : limite de
// texture, tenue à 30 fps, comportement thermique, coût de lecture du store, latence
// Firebase à table.
//
// Ce n'est pas une vue de l'application : ni la vue MJ, ni la vue joueurs. Les interdictions
// d'interface de la vue joueurs ne s'y appliquent pas.

import { initStage } from '../render/stage.js';
import { FrameLoop } from '../render/frame.js';
import { Camera } from '../render/camera.js';
import { VERSION } from '../core/version.js';
import { MAX_TEXTURE_FALLBACK, RENDER_RESOLUTION_CAP } from '../core/constants.js';
import { createCampaign, createLevel, createToken } from '../core/schema.js';
import { loadCampaign, getState, getActiveLevel, resetStore } from '../state/store.js';

const sortie = /** @type {HTMLPreElement} */ (document.getElementById('sortie'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));

/** @param {string} texte */
function ecrire(texte) {
  sortie.textContent = texte;
}
/** @param {string} texte */
function ajouter(texte) {
  sortie.textContent += `\n${texte}`;
}

/** @param {number} n @param {number} [d] */
const arrondi = (n, d = 2) => Number(n.toFixed(d));

// --- 1. Environnement & limites GPU -----------------------------------------

function diagnosticEnvironnement() {
  const lignes = [`Build ${VERSION.label} (${VERSION.commit})`, ''];

  lignes.push(`Écran            ${screen.width} × ${screen.height} px (CSS)`);
  lignes.push(`Fenêtre          ${innerWidth} × ${innerHeight} px`);
  lignes.push(`devicePixelRatio ${devicePixelRatio}`);
  lignes.push(`Plafond appliqué ${Math.min(devicePixelRatio || 1, RENDER_RESOLUTION_CAP)} (cap ${RENDER_RESOLUTION_CAP})`);
  lignes.push(`Orientation      ${screen.orientation?.type ?? 'inconnue'}`);
  lignes.push(`WebGPU           ${'gpu' in navigator ? 'disponible' : 'absent'}`);
  lignes.push('');

  const sonde = document.createElement('canvas');
  const gl = /** @type {WebGL2RenderingContext|WebGLRenderingContext|null} */ (
    sonde.getContext('webgl2') || sonde.getContext('webgl')
  );

  if (!gl) {
    lignes.push('WebGL indisponible : mesure de MAX_TEXTURE_SIZE impossible.');
  } else {
    const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    lignes.push(`Contexte         ${gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'}`);
    lignes.push(`MAX_TEXTURE_SIZE ${maxTexture} px   (repli codé : ${MAX_TEXTURE_FALLBACK})`);
    lignes.push(
      maxTexture >= MAX_TEXTURE_FALLBACK
        ? '  → le repli est prudent, on peut viser plus grand.'
        : '  → ATTENTION : le repli dépasse la limite réelle de cet appareil.'
    );
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) {
      lignes.push(`GPU              ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}`);
    }
    lignes.push(`Taille de carte  ${maxTexture} px ÷ 140 px/case ≈ ${Math.floor(maxTexture / 140)} cases de côté`);
  }

  ecrire(lignes.join('\n'));
}

// --- 2. Coût de lecture du store ---------------------------------------------

function diagnosticStore() {
  // Profil relevé sur un export Dungeondraft réel (« Boiling Bolt Atrium ») : 48 × 45 cases,
  // 124 polylignes de murs de 2 points, 37 portails, aucune lumière. Mesurer sur des chiffres
  // inventés donnerait une conclusion inventée.
  const LARGEUR = 48;
  const HAUTEUR = 45;

  /** @type {import('../core/types.js').CellPoint[][]} */
  const murs = [];
  for (let i = 0; i < 124; i++) {
    murs.push([
      { cellX: i % LARGEUR, cellY: Math.floor(i / LARGEUR) },
      { cellX: (i % LARGEUR) + 1, cellY: Math.floor(i / LARGEUR) + 1 },
    ]);
  }

  /** @type {import('../core/types.js').Portal[]} */
  const portails = [];
  for (let i = 0; i < 37; i++) {
    portails.push({
      id: `porte-${i}`,
      a: { cellX: i % LARGEUR, cellY: i % HAUTEUR },
      b: { cellX: (i % LARGEUR) + 1, cellY: i % HAUTEUR },
      closed: true,
      freestanding: false,
    });
  }

  const level = createLevel({
    id: 'rdc',
    walls: murs,
    portals: portails,
    widthCells: LARGEUR,
    heightCells: HAUTEUR,
  });
  const tokens = [];
  for (let i = 0; i < 30; i++) {
    tokens.push(
      createToken({ id: `pion-${i}`, levelId: 'rdc', cell: { a: i % LARGEUR, b: i % HAUTEUR } })
    );
  }

  resetStore();
  loadCampaign(createCampaign({ levels: [level], tokens }));

  const N = 200;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) getState();
  const t1 = performance.now();
  for (let i = 0; i < N; i++) getActiveLevel();
  const t2 = performance.now();

  const parGetState = (t1 - t0) / N;
  const parGetLevel = (t2 - t1) / N;
  const budget = 1000 / 30; // 33,3 ms pour tenir 30 fps

  ecrire(
    [
      `Étage de contrôle : profil d'un UVTT réel — 48 × 45 cases,`,
      `124 polylignes de murs, 37 portails, 30 pions`,
      '',
      `getState()       ${arrondi(parGetState, 3)} ms par appel`,
      `getActiveLevel() ${arrondi(parGetLevel, 3)} ms par appel`,
      '',
      `Budget d'une image à 30 fps : ${arrondi(budget, 1)} ms`,
      `Une lecture des deux par image consommerait ${arrondi(((parGetState + parGetLevel) / budget) * 100, 1)} % du budget.`,
      '',
      parGetState + parGetLevel > budget * 0.1
        ? '→ Trop coûteux pour être appelé par image : décision n°12, prendre des sélecteurs étroits.'
        : '→ Coût négligeable : décision n°12 tranchée, on peut lire l\'état par image.',
    ].join('\n')
  );
}

// --- Scène de charge pour les mesures d'images ------------------------------

/** @returns {Promise<{ app: any, loop: FrameLoop, camera: Camera }>} */
async function preparerScene() {
  const { app, layers } = await initStage(canvas);
  const PIXI = await import('pixi.js');

  const fond = new PIXI.Graphics();
  fond.rect(0, 0, 6720, 6300).fill({ color: 0x1b2430 });
  layers.background.addChild(fond);

  // Quadrillage 48 × 45 cases à 140 px : les dimensions d'un export Dungeondraft réel.
  const grille = new PIXI.Graphics();
  for (let c = 0; c <= 48; c++) grille.moveTo(c * 140, 0).lineTo(c * 140, 6300);
  for (let r = 0; r <= 45; r++) grille.moveTo(0, r * 140).lineTo(6720, r * 140);
  grille.stroke({ width: 2, color: 0x000000, alpha: 0.25 });
  layers.gridLayer.addChild(grille);

  for (let i = 0; i < 30; i++) {
    const pion = new PIXI.Graphics();
    pion.circle(0, 0, 60).fill({ color: 0xc0392b }).stroke({ width: 6, color: 0xffffff });
    pion.position.set(200 + (i % 8) * 400, 200 + Math.floor(i / 8) * 400);
    layers.tokens.addChild(pion);
  }

  const camera = new Camera(app.renderer.width, app.renderer.height);
  camera.setZoom(0.4);
  camera.setPan(1400, 1050);

  const loop = new FrameLoop(app);
  return { app, loop, camera };
}

/**
 * Fait tourner la boucle en continu et rend les images par tranche de temps.
 *
 * @param {number} dureeMs
 * @param {number} trancheMs
 * @param {(avancement: string) => void} progres
 * @returns {Promise<number[]>} images par seconde, une valeur par tranche
 */
async function mesurerImages(dureeMs, trancheMs, progres) {
  const { loop, camera, app } = await preparerScene();

  let continuer = true;
  let x = 1400;
  loop.addListener(() => {
    // Un panoramique léger à chaque image : sans mouvement, le compositeur pourrait
    // court-circuiter le rendu et la mesure ne vaudrait rien.
    x += 0.5;
    camera.setPan(x, 1050);
    camera.applyToContainer(app.stage);
    if (continuer) loop.requestFrame();
  });

  /** @type {number[]} */
  const tranches = [];
  const debut = performance.now();
  let derniereBorne = debut;
  let imagesBorne = loop.frameCount;

  loop.requestFrame();

  await new Promise((resolve) => {
    const surveiller = setInterval(() => {
      const maintenant = performance.now();
      if (maintenant - derniereBorne >= trancheMs) {
        const images = loop.frameCount - imagesBorne;
        tranches.push((images * 1000) / (maintenant - derniereBorne));
        derniereBorne = maintenant;
        imagesBorne = loop.frameCount;
        progres(`${tranches.length} tranche(s) — dernière : ${arrondi(tranches[tranches.length - 1], 1)} fps`);
      }
      if (maintenant - debut >= dureeMs) {
        clearInterval(surveiller);
        continuer = false;
        loop.stop();
        resolve(undefined);
      }
    }, 250);
  });

  return tranches;
}

/**
 * @param {number} dureeMs
 * @param {number} trancheMs
 * @param {string} titre
 */
async function diagnosticImages(dureeMs, trancheMs, titre) {
  ecrire(`${titre} — en cours, ne pas quitter la page…`);
  const tranches = await mesurerImages(dureeMs, trancheMs, (avancement) =>
    ecrire(`${titre} — ${avancement}`)
  );

  if (tranches.length === 0) {
    ajouter('Aucune tranche mesurée.');
    return;
  }
  const moyenne = tranches.reduce((a, b) => a + b, 0) / tranches.length;
  const pire = Math.min(...tranches);
  const premiere = tranches[0];
  const derniere = tranches[tranches.length - 1];
  const chute = ((premiere - derniere) / premiere) * 100;

  ecrire(
    [
      `${titre} — terminé`,
      '',
      `Tranches (fps) : ${tranches.map((t) => arrondi(t, 1)).join(' · ')}`,
      '',
      `Moyenne  ${arrondi(moyenne, 1)} fps`,
      `Minimum  ${arrondi(pire, 1)} fps`,
      `Dérive   ${arrondi(chute, 1)} % entre la première et la dernière tranche`,
      '',
      pire >= 30
        ? '→ 30 fps tenus sur toute la durée.'
        : '→ ATTENTION : 30 fps NON tenus. Réduire la résolution ou la charge de tracé.',
      chute > 15
        ? '→ Dérive marquée : bridage thermique probable, à confirmer sur une durée plus longue.'
        : '→ Pas de dérive significative.',
    ].join('\n')
  );
}

// --- 5. Latence Firebase -----------------------------------------------------

const CLE_CONFIG = 'rpg-diag-firebase-config';

async function diagnosticFirebase() {
  const champ = /** @type {HTMLInputElement} */ (document.getElementById('config'));
  const saisie = champ.value.trim();
  if (saisie) localStorage.setItem(CLE_CONFIG, saisie);
  const brut = localStorage.getItem(CLE_CONFIG);

  if (!brut) {
    ecrire('Coller la configuration Firebase (JSON) dans le champ, puis relancer.');
    return;
  }

  /** @type {Record<string, any>} */
  let config;
  try {
    config = JSON.parse(brut);
  } catch {
    ecrire('Configuration illisible : JSON attendu.');
    return;
  }

  ecrire('Connexion Google…');
  const { FirebaseTransport } = await import('../transport/FirebaseTransport.js');
  const transport = new FirebaseTransport(config);

  try {
    const utilisateur = (await transport.currentUser()) ?? (await transport.signInWithGoogle());
    ajouter(`Connecté : ${utilisateur.email ?? 'compte sans adresse'}`);
  } catch (err) {
    ecrire(`Échec de connexion : ${/** @type {any} */ (err)?.code || err}`);
    ajouter("Si le motif est « unauthorized-domain », ajouter ce domaine dans Firebase → Authentication → Settings → Authorized domains.");
    return;
  }

  const sessionId = `diag-${Date.now()}`;
  await transport.connect(sessionId, 'gm');
  await transport.snapshot();

  /** @type {number[]} */
  const latences = [];
  /** @type {Map<string, number>} */
  const envois = new Map();

  transport.subscribe((event) => {
    const marque = /** @type {any} */ (event.payload)?.marque;
    const envoi = typeof marque === 'string' ? envois.get(marque) : undefined;
    if (envoi !== undefined) latences.push(performance.now() - envoi);
  });

  const N = 30;
  for (let i = 0; i < N; i++) {
    const marque = `${sessionId}-${i}`;
    envois.set(marque, performance.now());
    transport.publish({ type: 'diag.ping', payload: { marque }, at: Date.now(), by: 'gm' });
    ecrire(`Mesure en cours : ${latences.length}/${N} aller-retours…`);
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 2000));

  await transport.purgeEvents();
  transport.disconnect();

  if (latences.length === 0) {
    ecrire('Aucun aller-retour mesuré : vérifier les règles de sécurité.');
    return;
  }
  const triees = [...latences].sort((a, b) => a - b);
  const p50 = triees[Math.floor(triees.length * 0.5)];
  const p95 = triees[Math.min(triees.length - 1, Math.floor(triees.length * 0.95))];

  ecrire(
    [
      `Latence aller-retour Realtime Database (${latences.length}/${N} mesures)`,
      '',
      `p50  ${arrondi(p50, 1)} ms`,
      `p95  ${arrondi(p95, 1)} ms`,
      `max  ${arrondi(triees[triees.length - 1], 1)} ms`,
      '',
      p95 <= 250
        ? '→ Sous les 250 ms : on reste sur Firebase (décision n°2 tranchée).'
        : '→ Au-dessus de 250 ms : envisager LocalSocketTransport (décision n°2).',
    ].join('\n')
  );
}

// --- Câblage ----------------------------------------------------------------

/** @param {string} id @param {() => void | Promise<void>} action */
function brancher(id, action) {
  const bouton = /** @type {HTMLButtonElement} */ (document.getElementById(id));
  bouton.addEventListener('click', async () => {
    bouton.disabled = true;
    try {
      await action();
    } catch (err) {
      ecrire(`Échec : ${/** @type {any} */ (err)?.message || err}`);
    } finally {
      bouton.disabled = false;
    }
  });
}

brancher('btn-env', diagnosticEnvironnement);
brancher('btn-store', diagnosticStore);
brancher('btn-fps', () => diagnosticImages(20000, 5000, 'Images par seconde (20 s)'));
brancher('btn-thermique', () => diagnosticImages(300000, 30000, 'Tenue thermique (5 min)'));
brancher('btn-firebase', diagnosticFirebase);

const champConfig = /** @type {HTMLInputElement} */ (document.getElementById('config'));
if (localStorage.getItem(CLE_CONFIG)) champConfig.placeholder = 'Configuration déjà enregistrée sur cet appareil';
