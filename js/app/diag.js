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
import { gridFor } from '../grid/index.js';
import { extractBlockedSegments } from '../import/blockedEdges.js';
import { ColdDecodeTrial, EnduranceJournal } from './endurance.js';

const sortie = /** @type {HTMLPreElement} */ (document.getElementById('sortie'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
const coldDecodeTrial = new ColdDecodeTrial();
const enduranceJournal = new EnduranceJournal();

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
      state: 'closed',
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

// --- 2bis. Décodage froid, sans activité pendant l'attente -----------------

async function armerDecodageFroid() {
  const field = /** @type {HTMLInputElement} */ (document.getElementById('cold-image-url'));
  const url = field.value.trim();
  ecrire('Chargement et chauffe initiale de l’image…');
  await coldDecodeTrial.arm(url);
  ecrire(
    [
      'Décodage froid armé.',
      '',
      'Ne touchez plus la page pendant 2 minutes complètes : la sonde ne programme ni minuterie,',
      'ni frame, ni mise à jour DOM pendant cette attente. Après ce délai, pressez « Mesurer ».',
      '',
      'Le résultat mesure le second Image.decode() réellement payé après l’inactivité. Il ne peut',
      'pas prouver que le navigateur a évincé physiquement le bitmap, ni remplacer la première',
      'frame réelle de la vue joueurs : noter les deux observations dans le rapport R2.',
    ].join('\n')
  );
}

async function mesurerDecodageFroid() {
  const result = await coldDecodeTrial.measure();

  // ⭐ `Image.decode()` n'est PAS la grandeur du critère R2-03. Le chiffre de 490 ms relevé
  // avant le correctif du chantier P était le coût du **`drawImage` du fond**, et le seuil
  // de 5 ms porte sur lui. Mesurer le seul `decode()` répondait donc à côté — c'est
  // exactement le travers déjà commis une fois sur ce projet : « la sonde ne mesurait pas
  // la bonne grandeur ».
  const field = /** @type {HTMLInputElement} */ (document.getElementById('cold-image-url'));
  const url = field.value.trim();
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();

  const t0 = performance.now();
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const plein = performance.now() - t0;

  // La doublure du chantier P : un bitmap réduit à 1024 px, peint à la place du plein
  // format tant que celui-ci est froid.
  const cote = Math.max(image.naturalWidth, image.naturalHeight) || 1;
  const facteur = Math.min(1, 1024 / cote);
  const doublure = await createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(image.naturalWidth * facteur)),
    resizeHeight: Math.max(1, Math.round(image.naturalHeight * facteur)),
  });
  const t1 = performance.now();
  ctx.drawImage(doublure, 0, 0, canvas.width, canvas.height);
  const reduite = performance.now() - t1;
  doublure.close();

  const verdict = plein < 5
    ? 'Fond < 5 ms : OUI — critère R2-03 tenu sur cette mesure.'
    : `Fond ≥ 5 ms (${arrondi(plein, 1)} ms) : le seuil R2-03 n'est PAS tenu.`;

  ecrire(
    [
      'Décodage post-inactivité terminé.',
      '',
      `Inactivité observée :        ${arrondi(result.idleMs / 1000, 1)} s`,
      `Image.decode() :             ${arrondi(result.decodeMs, 1)} ms`,
      `drawImage plein format :     ${arrondi(plein, 1)} ms   ← la grandeur du critère`,
      `drawImage doublure 1024 px : ${arrondi(reduite, 1)} ms`,
      `Source : ${image.naturalWidth}×${image.naturalHeight}`,
      '',
      verdict,
      'Repère : 490 ms relevés avant le correctif du chantier P, seuil < 5 ms.',
      '',
      'Le navigateur n’expose aucune API d’éviction : ce test ne peut pas prouver que le bitmap',
      'avait réellement été évincé, seulement mesurer ce qui a été payé après le silence.',
    ].join('\n')
  );
}

// --- 7. Fond animé : décodage matériel ou logiciel ? -----------------------

/**
 * Répond, sans lire un octet de vidéo, à la question ouverte du chantier W : la tablette
 * décode-t-elle `testvideo-3.webm` **en matériel** ?
 *
 * `mediaCapabilities.decodingInfo` rend `powerEfficient`, qui est précisément cette
 * réponse-là — et non « est-ce que ça joue », que tout décodeur logiciel sait faire, en
 * rampant.
 */
async function diagnosticVideoCapacite() {
  const LARGEUR = 4200;
  const HAUTEUR = 2850;
  const luma = LARGEUR * HAUTEUR;
  const PLAFOND_VP9_52 = 8912896;

  const lignes = [
    'Capacité de décodage du fond animé',
    '',
    `Cible : testvideo-3.webm — ${LARGEUR}×${HAUTEUR}, VP9, 30 img/s`,
    `Échantillons de luminance : ${luma.toLocaleString('fr-FR')}`,
    `Plafond VP9 niveau 5.2 :    ${PLAFOND_VP9_52.toLocaleString('fr-FR')}`,
    luma > PLAFOND_VP9_52
      ? '→ au-delà du niveau 5.2 : le niveau 6.0 est requis, rarement géré en matériel sur mobile.'
      : '→ sous le plafond 5.2 : aucun problème de niveau attendu.',
    '',
  ];

  if (typeof navigator !== 'undefined' && navigator.mediaCapabilities?.decodingInfo) {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: {
        contentType: 'video/webm; codecs="vp09.00.61.08"',
        width: LARGEUR,
        height: HAUTEUR,
        bitrate: 5_600_000,
        framerate: 30,
      },
    });
    lignes.push(
      'mediaCapabilities.decodingInfo :',
      `  supporté        : ${info.supported}`,
      `  fluide (smooth) : ${info.smooth}`,
      `  économe en énergie : ${info.powerEfficient}   ← vrai = décodage matériel`,
      '',
      info.powerEfficient
        ? 'VERDICT : décodage MATÉRIEL annoncé. Le fond animé devrait tenir.'
        : 'VERDICT : décodage LOGICIEL annoncé. Le repli sur l’affiche est le comportement attendu.',
    );
  } else {
    lignes.push('mediaCapabilities indisponible sur ce navigateur : verdict impossible ici.');
  }

  if (typeof VideoDecoder !== 'undefined' && VideoDecoder.isConfigSupported) {
    try {
      const dur = await VideoDecoder.isConfigSupported({
        codec: 'vp09.00.61.08',
        codedWidth: LARGEUR,
        codedHeight: HAUTEUR,
        hardwareAcceleration: 'prefer-hardware',
      });
      lignes.push('', `WebCodecs, matériel préféré : ${dur.supported}`);
    } catch (err) {
      lignes.push('', `WebCodecs : configuration refusée (${/** @type {any} */ (err)?.message || err})`);
    }
  }

  ecrire(lignes.join('\n'));
}

/**
 * Lecture réelle de 60 s, jugée **par le même critère que le produit** : l'avancement du
 * flux comparé à l'horloge murale, seuil 50 % (`js/render/videoBackdrop.js`).
 */
async function diagnosticVideoLecture() {
  const URL_VIDEO = 'maps/generated/testvideo-3.webm';
  // Réglable par `?duree=10` : la mesure de séance dure une minute, mais la couverture
  // automatique n'a pas à payer une minute à chaque passage de CI pour vérifier que le
  // bouton répond. La valeur par défaut reste celle du protocole.
  const demande = Number(new URLSearchParams(location.search).get('duree'));
  const DUREE_MS = Number.isFinite(demande) && demande > 0 ? demande * 1000 : 60000;
  ecrire(`Lecture du fond animé pendant ${DUREE_MS / 1000} s…`);

  const video = document.createElement('video');
  video.src = URL_VIDEO;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-10000px;width:640px;height:434px;';
  document.body.appendChild(video);

  try {
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(undefined), { once: true });
      video.addEventListener('error', () => reject(new Error(`média illisible (code ${video.error?.code})`)), { once: true });
      setTimeout(() => reject(new Error('timeout de chargement (60 s)')), 60000);
    });
    await video.play();

    const debutMur = performance.now();
    const debutFlux = video.currentTime;
    /** @type {number|null} */
    let premierRepli = null;
    // Un seul échantillonnage à 2,5 s, comme le détecteur du produit, puis on laisse jouer.
    await new Promise((resolve) => {
      const t = setInterval(() => {
        const ecoule = performance.now() - debutMur;
        let avance = video.currentTime - debutFlux;
        if (avance < 0) avance += video.duration || 0;
        if (premierRepli === null && ecoule > 2500 && (avance * 1000) / ecoule < 0.5) premierRepli = ecoule;
        if (ecoule >= DUREE_MS) { clearInterval(t); resolve(undefined); }
      }, 2500);
    });

    const ecoule = performance.now() - debutMur;
    let avance = video.currentTime - debutFlux;
    while (avance < 0) avance += video.duration || 0;
    const ratio = (avance * 1000) / ecoule;
    const q = video.getVideoPlaybackQuality?.() ?? null;
    const perdues = q ? q.droppedVideoFrames : null;
    const totales = q ? q.totalVideoFrames : null;

    ecrire(
      [
        'Lecture réelle du fond animé — 60 s',
        '',
        `Résolution décodée : ${video.videoWidth}×${video.videoHeight}`,
        `Temps réel écoulé :  ${arrondi(ecoule / 1000, 1)} s`,
        `Flux parcouru :      ${arrondi(avance, 1)} s`,
        `Cadence relative :   ${arrondi(ratio * 100, 0)} % du temps réel   (seuil produit : 50 %)`,
        totales !== null ? `Images décodées :    ${totales}, dont ${perdues} perdues` : 'getVideoPlaybackQuality indisponible.',
        totales ? `Images par seconde : ${arrondi(totales / (ecoule / 1000), 1)}` : '',
        '',
        ratio >= 0.5
          ? 'VERDICT : la lecture tient. Le détecteur de cadence ne se déclencherait pas.'
          : `VERDICT : la lecture rampe. Le produit basculerait sur l’affiche fixe${premierRepli !== null ? ` vers ${arrondi(premierRepli / 1000, 1)} s` : ''}.`,
        '',
        'Si le verdict est « rampe », réexporter la carte sous le plafond VP9 5.2 :',
        '3920 × 2800 au plus, soit 28 × 20 cases à 140 px/case.',
      ].filter(Boolean).join('\n')
    );
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

// --- 12. Horloge et aller-retour serveur réel ------------------------------

/**
 * L'écart d'horloge est la donnée qui a coûté le plus cher à ce projet : une tablette
 * **5,3 s en avance**, invisible à deux campagnes de mesure. Elle est à un appel de
 * distance, et aucune section ne la relevait.
 */
// --- 2ter. Journal cast et endurance : uniquement sur action explicite -----

/** @param {string} id */
function valeurObservation(id) {
  return /** @type {import('./endurance.js').ObservationState} */ (
    /** @type {HTMLSelectElement} */ (document.getElementById(id)).value
  );
}

/**
 * Prend le Wake Lock et le plein écran, puis **surveille leur perte**.
 *
 * `ETAT.md` demande de constater que l'écran ne s'éteint pas de toute la séance et que le
 * plein écran survit aux gestes système. Jusqu'ici c'était une case à cocher à la main,
 * c'est-à-dire un souvenir. Un relâchement survenu à la 37ᵉ minute pendant qu'on regardait
 * ailleurs n'était consigné nulle part.
 *
 * @type {any}
 */
let verrouEcran = null;

async function prendreVerrouEtPleinEcran() {
  const lignes = [];

  try {
    verrouEcran = await /** @type {any} */ (navigator).wakeLock?.request('screen');
    if (verrouEcran) {
      lignes.push('Wake Lock pris.');
      enduranceJournal.recordEvent('Wake Lock pris');
      verrouEcran.addEventListener?.('release', () => {
        enduranceJournal.recordEvent('⚠ Wake Lock RELÂCHÉ');
        ecrire(enduranceJournal.toText());
      });
    } else {
      lignes.push('API Wake Lock absente de ce navigateur.');
    }
  } catch (err) {
    lignes.push(`Wake Lock refusé : ${/** @type {any} */ (err)?.message || err}`);
  }

  try {
    await document.documentElement.requestFullscreen?.();
    lignes.push('Plein écran demandé.');
    enduranceJournal.recordEvent('Plein écran pris');
  } catch (err) {
    lignes.push(`Plein écran refusé : ${/** @type {any} */ (err)?.message || err}`);
  }

  lignes.push('', 'La page consignera d’elle-même toute perte, sans rien échantillonner.');
  ecrire(lignes.join('\n'));
}

/**
 * Branche les témoins de cycle de vie.
 *
 * ⭐ Répond à une inconnue nommée dans `ETAT.md` : « `visibilitychange` peut ne pas suffire
 * si le système restaure la page par un autre chemin ». On journalise donc **par quel
 * chemin** la reprise s'est faite — c'est la donnée qui manquait.
 *
 * ⛔ Aucun `setInterval` : ces lignes ne naissent que d'un événement du navigateur. La page
 * doit rester inerte pendant les silences, sinon elle fausse sa propre mesure.
 */
function brancherTemoinsCycleDeVie() {
  const noter = (/** @type {string} */ label) => {
    if (enduranceJournal.recordEvent(label)) ecrire(enduranceJournal.toText());
  };
  document.addEventListener('visibilitychange', () =>
    noter(`visibilitychange → ${document.visibilityState}`)
  );
  document.addEventListener('fullscreenchange', () =>
    noter(document.fullscreenElement ? 'plein écran repris' : '⚠ plein écran QUITTÉ')
  );
  window.addEventListener('pagehide', (e) => noter(`pagehide (persisted=${e.persisted})`));
  window.addEventListener('pageshow', (e) => noter(`pageshow (persisted=${e.persisted})`));
  document.addEventListener('freeze', () => noter('onglet GELÉ par le système'));
  document.addEventListener('resume', () => noter('onglet REPRIS par le système'));
}

async function copierJournal() {
  const md = enduranceJournal.toMarkdown();
  try {
    await navigator.clipboard.writeText(md);
    ecrire(`Journal copié dans le presse-papier, au format du tableau de RAPPORT-ENDURANCE.md.\n\n${md}`);
  } catch {
    // Le presse-papier peut être refusé hors geste utilisateur ou hors HTTPS : on affiche,
    // ce qui reste copiable à la main. Un échec silencieux ferait perdre la séance.
    ecrire(`Presse-papier indisponible — copier depuis ici :\n\n${md}`);
  }
}

function demarrerJournalEndurance() {
  enduranceJournal.start();
  ecrire(
    [
      'Journal endurance démarré.',
      '',
      'Le journal ne déclenche aucun timer, rendu, accès thermique ou accès Cast. À 0, 15, 30,',
      '45 minutes puis chaque heure jusqu’à 4 h, exécutez au besoin le test FPS 20 s, observez',
      'manuellement température/cast/Wake Lock/plein écran/reprise et ajoutez un relevé.',
    ].join('\n')
  );
}

function ajouterReleveEndurance() {
  const fpsField = /** @type {HTMLInputElement} */ (document.getElementById('endurance-fps'));
  const fpsText = fpsField.value.trim();
  const fps = fpsText === '' ? null : Number(fpsText);
  enduranceJournal.record({
    fps,
    temperature: /** @type {HTMLInputElement} */ (document.getElementById('endurance-temperature')).value,
    wakeLock: valeurObservation('endurance-wakelock'),
    fullscreen: valeurObservation('endurance-fullscreen'),
    cast: valeurObservation('endurance-cast'),
    resumed: valeurObservation('endurance-resume'),
    notes: /** @type {HTMLInputElement} */ (document.getElementById('endurance-notes')).value,
  });
  ecrire(enduranceJournal.toText());
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

// --- 6bis. Sweep sur les cartes réellement publiées --------------------------
//
// La section 6 tire ses segments UNIFORMÉMENT au hasard. Les vraies cartes groupent
// leurs murs le long des pièces, donc le banc synthétique surestime le nombre de
// segments à portée — mesuré, d'un facteur ~2 sur la carte de test. Comme le coût est
// presque quadratique en ce nombre, l'écart est bien plus grand encore sur le temps.
//
// Cette section supprime l'extrapolation : elle mesure sur la géométrie publiée.

/**
 * Longueur en pixels carte d'une distance exprimée en cases, obtenue par l'adaptateur.
 *
 * @param {import('../grid/GridAdapter.js').GridAdapter} grid
 * @param {number} cases
 * @returns {number}
 */
function longueurEnPx(grid, cases) {
  const a = grid.mapFromCellPoint({ cellX: 0, cellY: 0 });
  const b = grid.mapFromCellPoint({ cellX: cases, cellY: 0 });
  return Math.hypot(b.x - a.x, b.y - a.y);
}

async function diagnosticSweepReel() {
  ecrire('Mesure du sweep sur les cartes publiées — chargement du catalogue…');

  const reponse = await fetch('maps/catalog.json');
  if (!reponse.ok) throw new Error(`catalog.json : ${reponse.status}`);
  const catalogue = await reponse.json();

  const lignes = [
    'Sweep sur les cartes RÉELLEMENT publiées (aucune extrapolation)',
    'Médiane de 3 mesures par position, après 3 passes de chauffe.',
    '',
  ];

  // Chauffe globale : la toute première carte payait les optimisations du moteur, ce qui
  // faisait ressortir sa première portée comme la plus lente. On l'absorbe ici.
  {
    const bidon = [{ p1: { x: 0, y: 0 }, p2: { x: 100, y: 100 } }];
    for (let i = 0; i < 50; i++) sweep({ x: 50, y: 50 }, bidon, 500);
  }

  for (const entree of catalogue.maps ?? []) {
    const rep = await fetch(entree.sceneUrl);
    if (!rep.ok) {
      lignes.push(`${entree.name} : scène illisible (${rep.status})`);
      continue;
    }
    const scene = await rep.json();
    const level = scene.levels[0];
    const grid = gridFor(level);
    const segments = extractBlockedSegments(level, grid);

    lignes.push(
      `=== ${entree.name} — ${level.widthCells}×${level.heightCells} cases, ` +
        `${segments.length} segments, ${arrondi(longueurEnPx(grid, 1), 1)} px/case`
    );
    lignes.push('  portée | à portée (méd/pire) | 1 sweep (méd/pire) | geste 6 cases (pire)');

    for (const porteeCases of [5, 10, 15, 20]) {
      const maxRangePx = longueurEnPx(grid, porteeCases);
      /** @type {number[]} */
      const temps = [];
      /** @type {number[]} */
      const comptes = [];

      // Balayage régulier de l'étage : la médiane seule masquerait les recoins encombrés,
      // et c'est le pire cas qui décide du ressenti.
      const pas = Math.max(1, Math.floor(Math.min(level.widthCells, level.heightCells) / 6));
      for (let a = 1; a < level.widthCells - 1; a += pas) {
        for (let b = 1; b < level.heightCells - 1; b += pas) {
          // Centre de la case par l'adaptateur : aucun calcul de centre à la main.
          const origin = grid.pointFromCell({ a, b });

          // Une seule passe de chauffe ne suffisait pas, et le défaut était trompeur :
          // le relevé du 31/07 sur tablette donnait la portée 5 — mesurée en premier —
          // PLUS lente que la portée 10, avec pourtant deux fois moins de segments à
          // portée. Moins de travail et plus de temps : c'était la chauffe du moteur
          // captée par un `max`, pas un coût. Trois passes, puis la MÉDIANE de trois
          // mesures par position : le bruit disparaît sans masquer la position la plus
          // encombrée, qui reste le pire cas cherché.
          for (let c = 0; c < 3; c++) sweep(origin, segments, maxRangePx);

          /** @type {number[]} */
          const mesures = [];
          for (let m = 0; m < 3; m++) {
            const t0 = performance.now();
            sweep(origin, segments, maxRangePx);
            mesures.push(performance.now() - t0);
          }
          mesures.sort((x, y) => x - y);
          temps.push(mesures[1]);
          comptes.push(getLastEvalSegmentCount());
        }
      }

      temps.sort((x, y) => x - y);
      comptes.sort((x, y) => x - y);
      const tMed = temps[Math.floor(temps.length / 2)];
      const tPire = temps[temps.length - 1];
      const cMed = comptes[Math.floor(comptes.length / 2)];
      const cPire = comptes[comptes.length - 1];

      lignes.push(
        `  ${String(porteeCases).padStart(2)} cases | ${String(cMed).padStart(7)} / ${String(cPire).padStart(4)} ` +
          `| ${String(arrondi(tMed, 2)).padStart(6)} / ${String(arrondi(tPire, 2)).padStart(6)} ms ` +
          `| ${arrondi(tPire * 6, 1)} ms`
      );
    }
    lignes.push(`  (${temoinPositions(level)} positions échantillonnées)`);
    lignes.push('');
  }

  lignes.push('Le « geste 6 cases » reprend le pire cas : c\'est lui qui décide du ressenti.');
  lignes.push('La colonne « pire » est un maximum sur 49 positions : elle reste bruitée par');
  lignes.push('construction. Se fier à la médiane pour comparer deux portées entre elles.');
  lignes.push('');
  lignes.push('⚠ CE QUE CE BANC NE MESURE PAS : le rendu, la rastérisation du fog (L-04),');
  lignes.push('  et les 150 à 400 ms ajoutées par le cast (CdC §3).');
  lignes.push('→ VERDICT PERFORMANCE : à apprécier par le mainteneur (interdiction n°14).');

  ecrire(lignes.join('\n'));
}

/** @param {any} level */
function temoinPositions(level) {
  const pas = Math.max(1, Math.floor(Math.min(level.widthCells, level.heightCells) / 6));
  let n = 0;
  for (let a = 1; a < level.widthCells - 1; a += pas) {
    for (let b = 1; b < level.heightCells - 1; b += pas) n++;
  }
  return n;
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
brancher('btn-cold-arm', armerDecodageFroid);
brancher('btn-cold-measure', mesurerDecodageFroid);
brancher('btn-endurance-start', demarrerJournalEndurance);
brancher('btn-endurance-note', ajouterReleveEndurance);
brancher('btn-fps', () => diagnosticImages(20000, 5000, 'Images par seconde (20 s)'));
brancher('btn-thermique', () => diagnosticImages(300000, 30000, 'Tenue thermique (5 min)'));
brancher('btn-firebase', diagnosticFirebase);
brancher('btn-sweep', diagnosticSweep);
brancher('btn-sweep-reel', diagnosticSweepReel);
brancher('btn-video-capacite', diagnosticVideoCapacite);
brancher('btn-video-lecture', diagnosticVideoLecture);
brancher('btn-journal-lock', prendreVerrouEtPleinEcran);
brancher('btn-journal-copier', copierJournal);

brancherTemoinsCycleDeVie();

// Un journal interrompu par un rechargement d'onglet est repris, pas perdu.
if (enduranceJournal.restore()) {
  ecrire(`Journal endurance repris après rechargement.\n\n${enduranceJournal.toText()}`);
}

const champConfig = /** @type {HTMLInputElement} */ (document.getElementById('config'));
if (localStorage.getItem(CLE_CONFIG)) champConfig.placeholder = 'Configuration déjà enregistrée sur cet appareil';
