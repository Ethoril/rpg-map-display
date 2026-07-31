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
import { saveFirebaseConfig } from './runtimeConfig.js';
import { sweep, getLastEvalSegmentCount } from '../vision/sweep.js';

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

/** @returns {Promise<{ canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, loop: FrameLoop, camera: Camera }>} */
async function preparerScene() {
  const stage = await initStage(canvas);
  const { canvas: cv, context, resolution } = stage;

  const camera = new Camera(stage.width, stage.height);
  camera.setZoom(0.4);
  camera.setPan(1400, 1050);

  const loop = new FrameLoop(() => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, cv.width, cv.height);
    context.restore();

    context.save();
    context.scale(resolution, resolution);
    camera.applyToContext(context);

    // Fond
    context.fillStyle = '#1b2430';
    context.fillRect(0, 0, 6720, 6300);

    // Quadrillage
    context.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    context.lineWidth = 2;
    context.beginPath();
    for (let c = 0; c <= 48; c++) {
      context.moveTo(c * 140, 0);
      context.lineTo(c * 140, 6300);
    }
    for (let r = 0; r <= 45; r++) {
      context.moveTo(0, r * 140);
      context.lineTo(6720, r * 140);
    }
    context.stroke();

    // Pions
    context.fillStyle = '#c0392b';
    context.strokeStyle = '#ffffff';
    context.lineWidth = 6;
    for (let i = 0; i < 30; i++) {
      const px = 200 + (i % 8) * 400;
      const py = 200 + Math.floor(i / 8) * 400;
      context.beginPath();
      context.arc(px, py, 60, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    context.restore();
  });

  return { canvas: cv, context, loop, camera };
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
  const { loop, camera } = await preparerScene();

  let continuer = true;
  let x = 1400;
  loop.addListener(() => {
    x += 0.5;
    camera.setPan(x, 1050);
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
  const brut = saisie || localStorage.getItem(CLE_CONFIG);

  if (!brut) {
    ecrire('Coller la configuration Firebase (JSON) dans le champ, puis relancer.');
    return;
  }

  // Ne jamais persister ni transmettre le JSON tel qu'il a été collé.
  //
  // `saveFirebaseConfig` retire `testEmail`/`testPassword` — c'est son rôle explicite.
  // L'ancien code le rappelait puis réécrivait le JSON **brut** sous `CLE_CONFIG`, une clé
  // que `resolveFirebaseConfig` lit également : coller ici le JSON destiné au secret CI
  // déposait donc le mot de passe du compte technique en clair dans le LocalStorage de la
  // tablette — un appareil partagé, posé sur la table (CdC §3). Seule la version
  // normalisée est désormais stockée, et c'est elle qui alimente le transport.
  /** @type {Record<string, any>} */
  let config;
  try {
    config = saveFirebaseConfig(JSON.parse(brut));
    localStorage.setItem(CLE_CONFIG, JSON.stringify(config));
  } catch {
    ecrire('Configuration Firebase illisible ou incomplète.');
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

  // Cette sonde ne filtre PAS les échos propres, et ne peut donc pas chronométrer un
  // aller-retour serveur : la Realtime Database applique la compensation de latence et
  // déclenche les écouteurs locaux sur la valeur optimiste, avant tout acquittement. Les
  // chiffres ci-dessous décrivent la boucle locale du SDK — un p50 de quelques
  // millisecondes est en dessous du temps de trajet physique vers europe-west1, ce qui le
  // rend impossible autrement.
  //
  // Le verdict automatique sur la décision n°2 a été retiré : il déclarait cette décision
  // « tranchée » sur la foi d'un nombre qui ne mesurait pas la grandeur en jeu. La décision
  // est tranchée, mais par choix d'architecture et non par mesure — cf. docs/ETAT.md.
  //
  // Ce que cette section prouve réellement, et qui est sa vraie valeur : la configuration
  // est bonne, l'authentification passe, les règles autorisent écriture, lecture et purge.
  ecrire(
    [
      `Boucle locale du SDK Realtime Database (${latences.length}/${N} mesures)`,
      '',
      `p50  ${arrondi(p50, 1)} ms`,
      `p95  ${arrondi(p95, 1)} ms`,
      `max  ${arrondi(triees[triees.length - 1], 1)} ms`,
      '',
      "→ Ce n'est PAS une latence aller-retour serveur : les échos propres ne sont pas",
      '  filtrés, et la compensation de latence les délivre avant tout acquittement.',
      '→ Ce qui est établi : configuration valide, authentification acceptée, et règles',
      '  autorisant écriture, lecture et purge sur la session.',
      '→ Décision n°2 (§12) : tranchée par choix d\'architecture, pas par cette mesure.',
      '  Le cast ajoute lui-même 150 à 400 ms (CdC §3), qui dominent le ressenti à table.',
    ].join('\n')
  );
}

// --- 6. Sweep & Critère 13 (visibilité 2D) -----------------------------------

function diagnosticSweep() {
  ecrire('Mesure du polygone de visibilité 2D (sweep) — en cours…');

  const CELL_PX = 140;
  const mapWidthPx = 7000; // 50 cases
  const mapHeightPx = 7000; // 50 cases

  const segmentCounts = [500, 1000, 1500, 2000, 3000];
  const rangesCells = [5, 10, 15, 20];

  // 5 positions d'origine réparties sur la carte
  const origins = [
    { x: 3500, y: 3500 },
    { x: 1400, y: 1400 },
    { x: 5600, y: 1400 },
    { x: 1400, y: 5600 },
    { x: 5600, y: 5600 },
  ];

  const lines = [
    '6. Sweep & Critère 13 (visibilité 2D)',
    `Configuration : échelle = ${CELL_PX} px/case, repère carte 50 × 50 cases (${mapWidthPx} × ${mapHeightPx} px)`,
    'Médiane relevée sur 5 origines distantes.',
    '',
    '| Segments | Portée (cases) | Portée (px) | Segments à portée | 1 sweep (ms) | 6 pions (ms) | Geste 6 cases (ms) |',
    '|---|---|---|---|---|---|---|',
  ];

  /** @param {number} seed */
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  for (const segCount of segmentCounts) {
    const rng = mulberry32(segCount);
    /** @type {import('../core/types.js').Segment[]} */
    const segments = [];
    for (let i = 0; i < segCount; i++) {
      const x1 = rng() * mapWidthPx;
      const y1 = rng() * mapHeightPx;
      const len = 70 + rng() * 210;
      const angle = rng() * Math.PI * 2;
      segments.push({
        p1: { x: x1, y: y1 },
        p2: { x: x1 + Math.cos(angle) * len, y: y1 + Math.sin(angle) * len },
      });
    }

    for (const rangeCells of rangesCells) {
      const maxRangePx = rangeCells * CELL_PX;

      /** @type {number[]} */
      const timesOneSweep = [];
      /** @type {number[]} */
      const inRangeCounts = [];
      /** @type {number[]} */
      const pathTimes = [];

      for (const origin of origins) {
        const N = 10;
        const t0 = performance.now();
        for (let k = 0; k < N; k++) {
          sweep(origin, segments, maxRangePx);
        }
        const t1 = performance.now();
        timesOneSweep.push((t1 - t0) / N);
        inRangeCounts.push(getLastEvalSegmentCount());

        const pathT0 = performance.now();
        for (let step = 0; step < 6; step++) {
          const stepOrigin = {
            x: origin.x + step * CELL_PX,
            y: origin.y + step * CELL_PX,
          };
          sweep(stepOrigin, segments, maxRangePx);
        }
        const pathT1 = performance.now();
        pathTimes.push(pathT1 - pathT0);
      }

      timesOneSweep.sort((a, b) => a - b);
      inRangeCounts.sort((a, b) => a - b);
      pathTimes.sort((a, b) => a - b);

      const medianSweep = timesOneSweep[Math.floor(timesOneSweep.length / 2)];
      const medianInRange = inRangeCounts[Math.floor(inRangeCounts.length / 2)];
      const medianPath = pathTimes[Math.floor(pathTimes.length / 2)];
      const sixTokens = medianSweep * 6;

      lines.push(
        `| ${segCount} | ${rangeCells} cases | ${maxRangePx} px | ${medianInRange} | ${arrondi(
          medianSweep,
          2
        )} ms | ${arrondi(sixTokens, 2)} ms | ${arrondi(medianPath, 2)} ms |`
      );
    }
  }

  lines.push('');
  lines.push('--- Équivalence taille de carte selon la densité des murs ---');
  lines.push('- Densité « manoir-rdc » (0,079 segment/case) :');
  lines.push('  • 500 segments   ≈ carte 80 × 80 cases');
  lines.push('  • 1500 segments  ≈ carte 138 × 138 cases');
  lines.push('  • 3000 segments  ≈ carte 195 × 195 cases');
  lines.push('- Densité « Dungeon Alchemist » (0,320 segment/case) :');
  lines.push('  • 500 segments   ≈ carte 40 × 40 cases');
  lines.push('  • 1500 segments  ≈ carte 68 × 68 cases');
  lines.push('  • 3000 segments  ≈ carte 97 × 97 cases');
  lines.push('');
  lines.push('⚠ CE QUE CE BANC NE MESURE PAS (À GARDER À L\'ESPRIT) :');
  lines.push('1. Le rendu Canvas 2D du polygone de vision.');
  lines.push('2. La rastérisation du masque de fog (L-04).');
  lines.push('3. Les 150 à 400 ms de latence d\'affichage ajoutées par le cast (CdC §3).');
  lines.push('');
  lines.push('→ VERDICT PERFORMANCE : À vérifier par le mainteneur sur la tablette physique (interdiction n°14).');

  ecrire(lines.join('\n'));
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
brancher('btn-sweep', diagnosticSweep);

const champConfig = /** @type {HTMLInputElement} */ (document.getElementById('config'));
if (localStorage.getItem(CLE_CONFIG)) champConfig.placeholder = 'Configuration déjà enregistrée sur cet appareil';
