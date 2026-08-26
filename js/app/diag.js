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
import { MAX_TEXTURE_FALLBACK, RENDER_RESOLUTION_CAP, FOG_MASK_PX_PER_CELL } from '../core/constants.js';
import { createCampaign, createLevel, createToken } from '../core/schema.js';
import { loadCampaign, getState, getActiveLevel, resetStore } from '../state/store.js';
import { saveFirebaseConfig } from './runtimeConfig.js';
import { sweep, getLastEvalSegmentCount } from '../vision/sweep.js';
import { gridFor } from '../grid/index.js';
import { extractBlockedSegments } from '../import/blockedEdges.js';
import { ColdDecodeTrial, EnduranceJournal, resumeDecodageFroid } from './endurance.js';
import {
  LoopingPlaybackProgress,
  MIN_PLAYBACK_RATIO,
  STALL_CHECK_MS,
} from '../render/videoBackdrop.js';

// Gardé nullable : les fonctions pures exportées plus bas (section 16) doivent rester
// importables par `tests/*.test.mjs` sous node:test, sans DOM — comme `resumeDecodageFroid`
// l'est déjà depuis `endurance.js`. Le reste de la page n'appelle `ecrire`/`ajouter` que sur
// des gestes utilisateur, jamais à l'import du module.
const sortie = typeof document !== 'undefined'
  ? /** @type {HTMLPreElement} */ (document.getElementById('sortie'))
  : /** @type {any} */ (null);
const canvas = typeof document !== 'undefined'
  ? /** @type {HTMLCanvasElement} */ (document.getElementById('board'))
  : /** @type {any} */ (null);
const coldDecodeTrial = new ColdDecodeTrial();
if (typeof window !== 'undefined') /** @type {any} */ (window).__coldDecodeTrial = coldDecodeTrial;
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
      'Le résultat mesure le coût du premier drawImage() réellement payé après l’inactivité —',
      'pas un Image.decode(), qui réchaufferait le bitmap avant le tracé. Il ne peut pas prouver que',
      'le navigateur a évincé physiquement le bitmap, ni remplacer la première frame réelle de la',
      'vue joueurs : noter les deux observations dans le rapport R2.',
    ].join('\n')
  );
}

async function mesurerDecodageFroid() {
  const { image, idleMs } = coldDecodeTrial.takeArmedImage();
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  // 1. Coût de la relecture seule pour vider le pipeline GPU
  const dummy = document.createElement('canvas');
  dummy.width = 1;
  dummy.height = 1;
  const tr0 = performance.now();
  ctx.drawImage(dummy, 0, 0, canvas.width, canvas.height);
  ctx.getImageData(0, 0, 1, 1);
  const relecture = performance.now() - tr0;

  // 2. Coût brut du premier tracé avec vidage du pipeline
  const t0 = performance.now();
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.getImageData(0, 0, 1, 1);
  const brut = performance.now() - t0;
  // L'arithmétique du critère vit dans `endurance.js`, pure et éprouvée sans navigateur : la
  // soustraction de la relecture décide du verdict à elle seule, elle ne doit pas être un calcul
  // en ligne dans une page que seul un test de navigateur peut regarder.
  const { netMs: net, verdict, tenu } = resumeDecodageFroid(brut, relecture);
  // Les trois durées non arrondies, pour que le scénario de navigateur puisse vérifier le câblage
  // sans relire des nombres déjà quantifiés à 0,1 ms par l'affichage — la différence de deux
  // arrondis contre l'arrondi d'une différence vaut jusqu'à 0,15 ms, soit une fausse rougeur.
  /** @type {any} */ (window).__coldDecodeDernier = { brut, relecture, net, tenu };

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
  ctx.getImageData(0, 0, 1, 1);
  const reduite = performance.now() - t1;
  doublure.close();

  ecrire(
    [
      'Décodage post-inactivité terminé.',
      '',
      `Inactivité observée :        ${arrondi(idleMs / 1000, 1)} s`,
      `Coût brut (drawImage+flush): ${arrondi(brut, 1)} ms`,
      `Coût relecture (1×1) :       ${arrondi(relecture, 1)} ms (retranché)`,
      `Coût net du premier tracé :  ${arrondi(net, 1)} ms   ← la grandeur du critère`,
      `drawImage doublure 1024 px : ${arrondi(reduite, 1)} ms`,
      `Source : ${image.naturalWidth}×${image.naturalHeight}`,
      '',
      verdict,
      'Repère : 490 ms relevés avant le correctif du chantier P, seuil < 5 ms.',
      '',
      'Image.decode() a été retiré de l’affichage : mesurer decode() d’abord réchauffe le bitmap avant drawImage().',
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
    // ⭐ Cumul par intervalle, et non écart depuis le début de la fenêtre. La version
    // précédente comparait `currentTime` à `debutFlux` avec une correction d'un seul tour :
    // sur une vidéo de 30 s mesurée pendant 60 s, deux tours parfaits donnaient 29,9 s pour
    // 60,0 s, soit 49,8 % — « rampe » à un cheveu du seuil, sur du matériel sain, et de façon
    // identique sur n'importe quelle machine. Voir `LoopingPlaybackProgress`.
    const progression = new LoopingPlaybackProgress(video.duration);
    progression.sample(video.currentTime, debutMur);
    /** @type {number|null} */
    let premierRepli = null;
    await new Promise((resolve) => {
      const t = setInterval(() => {
        const maintenant = performance.now();
        // Le ratio de l'**intervalle** : c'est celui que `_checkPlayback` juge, donc le seul
        // qui prédise le basculement du produit. Le ratio depuis le début ne le prédit pas.
        const intervalle = progression.sample(video.currentTime, maintenant);
        const ecoule = maintenant - debutMur;
        if (premierRepli === null && intervalle !== null && intervalle < MIN_PLAYBACK_RATIO) {
          premierRepli = ecoule;
        }
        if (ecoule >= DUREE_MS) { clearInterval(t); resolve(undefined); }
      }, STALL_CHECK_MS);
    });

    const ecoule = performance.now() - debutMur;
    const avance = progression.avanceTotale;
    const ratio = progression.ratio ?? 0;
    const q = video.getVideoPlaybackQuality?.() ?? null;
    const perdues = q ? q.droppedVideoFrames : null;
    const totales = q ? q.totalVideoFrames : null;

    ecrire(
      [
        'Lecture réelle du fond animé — 60 s',
        '',
        `Résolution décodée : ${video.videoWidth}×${video.videoHeight}`,
        `Temps réel écoulé :  ${arrondi(ecoule / 1000, 1)} s`,
        `Flux parcouru :      ${arrondi(avance, 1)} s   (cumulé par intervalle, boucles comprises)`,
        `Cadence relative :   ${arrondi(ratio * 100, 0)} % du temps réel   (seuil produit : ${arrondi(MIN_PLAYBACK_RATIO * 100, 0)} %)`,
        totales !== null ? `Images décodées :    ${totales}, dont ${perdues} perdues` : 'getVideoPlaybackQuality indisponible.',
        totales ? `Images par seconde : ${arrondi(totales / (ecoule / 1000), 1)}` : '',
        '',
        ratio >= MIN_PLAYBACK_RATIO
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
// --- 12 & 14. Horloge, aller-retour serveur et rétention du canal ----------

/**
 * Résout la configuration Firebase comme la section 5, sans la redemander.
 * @returns {Record<string, any>|null}
 */
function configFirebaseEnregistree() {
  const champ = /** @type {HTMLInputElement} */ (document.getElementById('config'));
  const brut = champ.value.trim() || localStorage.getItem(CLE_CONFIG);
  if (!brut) return null;
  try {
    const config = saveFirebaseConfig(JSON.parse(brut));
    localStorage.setItem(CLE_CONFIG, JSON.stringify(config));
    return config;
  } catch {
    return null;
  }
}

/**
 * Écart d'horloge appareil ↔ serveur, et comptage des nœuds de la session.
 *
 * ⭐ L'écart d'horloge est la donnée qui a coûté le plus cher à ce projet : une tablette
 * **5,3 s en avance**, invisible à deux campagnes de mesure entières. Elle est à un appel
 * de distance, et aucune section ne la relevait.
 */
async function diagnosticHorlogeEtCanal() {
  const config = configFirebaseEnregistree();
  if (!config) {
    ecrire('Coller d’abord la configuration Firebase dans le champ de la section 5.');
    return;
  }
  ecrire('Connexion Google…');
  const { FirebaseTransport } = await import('../transport/FirebaseTransport.js');
  const transport = new FirebaseTransport(config);
  const sessionId = /** @type {HTMLInputElement} */ (document.getElementById('canal-session')).value.trim();

  try {
    await ((await transport.currentUser()) ?? transport.signInWithGoogle());
    const lignes = ['Horloge et canal', ''];

    if (sessionId) {
      await transport.connect(sessionId, 'gm');
      // Laisser le transport recevoir `.info/serverTimeOffset`, qui arrive de façon asynchrone.
      await new Promise((r) => setTimeout(r, 1200));
    }

    const ecart = /** @type {any} */ (transport)._serverTimeOffset;
    if (typeof ecart === 'number') {
      lignes.push(
        `Écart horloge appareil ↔ serveur : ${ecart > 0 ? '+' : ''}${arrondi(ecart, 0)} ms`,
        Math.abs(ecart) > 1000
          ? '⚠ Au-delà d’une seconde : tout horodatage relatif de cette séance est suspect,'
          : 'Écart négligeable.',
        Math.abs(ecart) > 1000 ? '  et c’est exactement le défaut qui a coûté deux campagnes le 7 août.' : ''
      );
    } else {
      lignes.push('Écart d’horloge non reçu : se connecter à une session pour l’obtenir.');
    }

    if (sessionId) {
      const etat = await /** @type {any} */ (transport).diagnosticCanal?.();
      lignes.push(
        '',
        `Session « ${sessionId} »`,
        etat
          ? `  événements ${etat.events ?? '?'} · clients de rétention ${etat.retentionClients ?? '?'} · présences ${etat.presence ?? '?'}`
          : '  le transport n’expose pas de comptage : à lire dans la console Firebase.'
      );
    }
    ecrire(lignes.filter(Boolean).join('\n'));
  } finally {
    await transport.disconnect?.();
  }
}

// --- 10. Coût d'une mutation lumineuse (R3-05) -----------------------------

/**
 * Mesure `FogLayer.updateVision` sur une carte à lumières et sur une carte sans, et rend
 * **l'écart** — qui est le coût des lumières, la grandeur du critère R3-05.
 *
 * ⚠ **À lancer sur la machine qui porte la vue MJ, pas sur la tablette.** Le calcul de
 * vision est autoritaire côté MJ ; le mesurer ailleurs répondrait pour un appareil qui ne
 * le fait jamais. C'est le piège du « mauvais monde », et il a déjà coûté une campagne.
 */
async function diagnosticLumieres() {
  const { FogLayer } = await import('../render/layers/fogLayer.js');
  const catalogue = await (await fetch('maps/catalog.json')).json();
  const lignes = ['Coût d’une mutation lumineuse — R3-05', '', 'À lancer sur le poste MJ.', ''];

  /** @type {Array<{ nom: string, sources: number, pire: number }>} */
  const releves = [];

  for (const entree of catalogue.maps ?? []) {
    const scene = await (await fetch(entree.sceneUrl)).json();
    for (const level of scene.levels ?? []) {
      const grid = gridFor(level);
      const sources =
        (Array.isArray(level.lights) ? level.lights.length : 0) + (level.ambient?.baked ? 1 : 0);

      // Six PJ et une torche mobile : le profil de table décrit par le protocole.
      const tokens = [];
      for (let i = 0; i < 6; i++) {
        tokens.push(
          createToken({
            id: `pj-${i}`,
            levelId: level.id,
            kind: 'pc',
            cell: { a: 2 + i * 2, b: 2 + i },
            visionDim: 12,
          })
        );
      }
      tokens.push(
        createToken({
          id: 'torche',
          levelId: level.id,
          kind: 'npc',
          cell: { a: 4, b: 4 },
          emitsLight: { range: 6, intensity: 1, color: '#ffdca8' },
        })
      );

      const couche = new FogLayer();
      let pire = 0;
      for (let essai = 0; essai < 3; essai++) {
        // Déplacer d'une case : sans mutation réelle, la mémoïsation par signature rendrait
        // la mesure gratuite et donc fausse.
        tokens[0].cell = { a: 2 + essai, b: 2 + essai };
        couche.invalidate?.();
        const t0 = performance.now();
        couche.updateVision(grid, level, tokens, {});
        pire = Math.max(pire, performance.now() - t0);
      }
      releves.push({ nom: `${entree.id} / ${level.id}`, sources, pire: arrondi(pire, 1) });
    }
  }

  releves.sort((a, b) => b.pire - a.pire);
  for (const r of releves) {
    lignes.push(`${String(r.pire).padStart(8)} ms   ${String(r.sources).padStart(4)} sources   ${r.nom}`);
  }

  const avec = releves.filter((r) => r.sources > 0);
  const sans = releves.filter((r) => r.sources === 0);
  const pireAvec = avec.length ? Math.max(...avec.map((r) => r.pire)) : 0;
  const pireSans = sans.length ? Math.max(...sans.map((r) => r.pire)) : 0;

  lignes.push(
    '',
    `Pire avec lumières : ${arrondi(pireAvec, 1)} ms`,
    `Pire sans lumière  : ${arrondi(pireSans, 1)} ms`,
    `Écart, donc coût des lumières : ${arrondi(pireAvec - pireSans, 1)} ms`,
    '',
    pireAvec < 300
      ? 'Dans le budget de 300 ms : OUI.'
      : 'HORS budget de 300 ms — R3-05 n’est pas tenu sur cette machine.',
    '',
    'Le pire des trois essais est retenu, jamais la moyenne. Rappel : les extrapolations de',
    'ce projet se sont déjà trompées d’un facteur 4.'
  );
  ecrire(lignes.join('\n'));
}

// --- 11. Motifs à juger : anneaux, pastilles, marqueurs --------------------

/**
 * Affiche côte à côte les motifs que le chantier Q demande de juger **à la vue « carte
 * entière »**, c'est-à-dire vers 33 px la case.
 *
 * Ces motifs ne sont pas composables à la demande dans la vue MJ : il faudrait fabriquer
 * les pions et leurs états à la main, en pleine séance. Ici ils s'affichent en un tap, y
 * compris sur le téléviseur sous cast — qui est justement l'écran où le doute porte.
 *
 * La page ne juge rien : elle montre, et enregistre le verdict humain dans le journal.
 */
async function afficherMotifs() {
  const { computeProportionalRing, computeStateRing } = await import('../render/statusBadges.js');
  const champ = /** @type {HTMLInputElement} */ (document.getElementById('motif-px-case'));
  const pxCase = Math.max(12, Number(champ.value) || 33);

  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  canvas.width = 640;
  canvas.height = 480;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  /**
   * @param {number} cx @param {number} cy @param {string} legende
   * @param {{ hp?: {current:number,max:number}|null, health?: string }} etat
   */
  function pion(cx, cy, legende, etat) {
    const d = pxCase;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, d * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#6b5a3e';
    ctx.fill();

    if (etat.hp) {
      const anneau = computeProportionalRing(d, 1, etat.hp);
      if (anneau) {
        ctx.beginPath();
        ctx.arc(cx, cy, d * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (etat.hp.current / etat.hp.max));
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = Math.max(2, d * 0.08);
        ctx.stroke();
      }
    }
    if (etat.health && etat.health !== 'unharmed') {
      const anneau = computeStateRing(d, 1, /** @type {any} */ (etat.health));
      const couleur = etat.health === 'wounded' ? '#c2410c' : '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, d * 0.46, 0, Math.PI * 2);
      ctx.strokeStyle = couleur;
      ctx.lineWidth = Math.max(3, d * (anneau ? 0.16 : 0.16));
      ctx.stroke();
    }
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(legende, cx, cy + d * 0.42 + 16);
    ctx.restore();
  }

  const y1 = 90;
  ctx.fillStyle = '#cfcfcf';
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Motifs à ${pxCase} px la case — le cas nommé au §5.4 du chantier Q`, 12, 24);
  ctx.fillText('Les deux tracent un tour complet : c’est là que la confusion se joue.', 12, 44);

  pion(90, y1, 'PJ 28/28 (bleu)', { hp: { current: 28, max: 28 } });
  pion(230, y1, 'PNJ critical', { health: 'critical' });
  pion(370, y1, 'PNJ wounded', { health: 'wounded' });
  pion(510, y1, 'PNJ indemne', { health: 'unharmed' });

  ctx.fillStyle = '#cfcfcf';
  ctx.fillText('Orange brique contre rouge : distinguables à cette taille ?', 12, y1 + 70);

  // Grappe de gros combat : huit pions serrés avec leurs pastilles chiffrées.
  const y2 = 300;
  ctx.fillText('Gros combat — les pastilles chiffrées restent-elles lisibles ?', 12, y2 - 50);
  for (let i = 0; i < 8; i++) {
    const cx = 60 + i * Math.max(pxCase * 1.15, 34);
    pion(cx, y2, '', { hp: { current: 7 + i, max: 20 } });
    ctx.fillStyle = '#101010';
    ctx.beginPath();
    ctx.arc(cx + pxCase * 0.34, y2 - pxCase * 0.34, Math.max(7, pxCase * 0.26), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(8, Math.round(pxCase * 0.28))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${7 + i}`, cx + pxCase * 0.34, y2 - pxCase * 0.34 + Math.max(3, pxCase * 0.1));
  }

  ecrire(
    [
      `Motifs affichés à ${pxCase} px la case.`,
      '',
      'À juger, dans l’ordre du chantier Q :',
      '  1. un PJ à plein se distingue-t-il d’un PNJ « mal en point » ?',
      '  2. « blessé » orange brique se distingue-t-il de « mal en point » rouge ?',
      '  3. les pastilles chiffrées restent-elles lisibles en gros combat ?',
      '',
      'Régler le curseur sur 33 px pour la vue « carte entière », puis juger sur la TV castée.',
      'Enregistrer le verdict par les boutons : il rejoint le journal, et s’exporte avec lui.',
    ].join('\n')
  );
}

/** @param {string} verdict */
function noterVerdictMotif(verdict) {
  const ligne = enduranceJournal.recordEvent(`verdict motifs : ${verdict}`);
  ecrire(
    ligne
      ? `Verdict enregistré : ${verdict}\n\n${enduranceJournal.toText()}`
      : 'Démarrer d’abord le journal d’endurance : c’est lui qui garde les verdicts.'
  );
}

// --- 13. Banc de visée : la capsule des portes -----------------------------

/**
 * Mesure la **distribution réelle** de l'erreur du doigt, puis rejoue les taps enregistrés
 * contre plusieurs valeurs de `PORTAL_HIT_CELL_RATIO`.
 *
 * Le chantier O demande de « constater à la table » si la capsule peut monter de 0,25 à
 * 0,4. Un banc calcule la réponse au lieu de la deviner, et un seul jeu de vingt gestes
 * éprouve les trois valeurs à la fois.
 */
/** @type {{ down: () => void }|null} */
let bancEnCours = null;

async function bancDeVisee() {
  const CIBLES = 20;
  const PX_CASE = 33;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  canvas.width = 640;
  canvas.height = 480;

  /** @type {Array<{ distancePx: number, dureeMs: number }>} */
  const taps = [];
  let porte = { x: 0, y: 0, angle: 0 };

  function poser() {
    porte = {
      x: 60 + Math.random() * (canvas.width - 120),
      y: 60 + Math.random() * (canvas.height - 120),
      angle: Math.random() * Math.PI,
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#7cc47c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const dx = Math.cos(porte.angle) * PX_CASE * 0.5;
    const dy = Math.sin(porte.angle) * PX_CASE * 0.5;
    ctx.moveTo(porte.x - dx, porte.y - dy);
    ctx.lineTo(porte.x + dx, porte.y + dy);
    ctx.stroke();
    ctx.fillStyle = '#cfcfcf';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Viser la porte — ${taps.length + 1} / ${CIBLES}`, 12, 24);
  }

  if (bancEnCours) canvas.removeEventListener('pointerdown', bancEnCours.down);

  let debutAppui = 0;
  const down = () => { debutAppui = performance.now(); };
  /** @param {PointerEvent} e */
  const up = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const dx = Math.cos(porte.angle);
    const dy = Math.sin(porte.angle);
    const demi = PX_CASE * 0.5;
    const t = Math.max(-demi, Math.min(demi, (x - porte.x) * dx + (y - porte.y) * dy));
    const distance = Math.hypot(x - (porte.x + t * dx), y - (porte.y + t * dy));
    taps.push({ distancePx: distance, dureeMs: performance.now() - debutAppui });

    if (taps.length >= CIBLES) {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      bancEnCours = null;
      const distances = taps.map((t2) => t2.distancePx).sort((a, b) => a - b);
      const durees = taps.map((t2) => t2.dureeMs).sort((a, b) => a - b);
      const pc = (/** @type {number[]} */ a, /** @type {number} */ q) => arrondi(a[Math.floor(a.length * q)], 1);
      const reussite = (/** @type {number} */ ratio) =>
        Math.round((distances.filter((d) => d <= ratio * PX_CASE).length / distances.length) * 100);
      ecrire(
        [
          `Banc de visée — ${CIBLES} taps à ${PX_CASE} px la case`,
          '',
          `Erreur : p50 ${pc(distances, 0.5)} px · p95 ${pc(distances, 0.95)} px · max ${arrondi(distances[distances.length - 1], 1)} px`,
          '',
          'Taux de réussite simulé, sur les MÊMES gestes :',
          `  capsule 0,25 case (valeur actuelle) : ${reussite(0.25)} %`,
          `  capsule 0,30 case                   : ${reussite(0.3)} %`,
          `  capsule 0,40 case (proposée §8)     : ${reussite(0.4)} %`,
          '',
          `Durée d’appui : p50 ${pc(durees, 0.5)} ms · p95 ${pc(durees, 0.95)} ms`,
          `Repère : DRAG_HOLD_MS = 150 ms. Un p95 au-dessus signifie que des taps ordinaires`,
          'sont pris pour des appuis longs — c’est la donnée que l’arbitrage A7 attendait.',
        ].join('\n')
      );
      return;
    }
    poser();
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  bancEnCours = { down };
  poser();
  ecrire(`Banc de visée armé : viser ${CIBLES} portes en tapant dessus, au doigt.`);
}

// --- 15. Grille de relevé des onglets MJ -----------------------------------

/** @type {Record<string, number>} */
const compteursOnglets = {};

/** @param {string} nom */
function compterOnglet(nom) {
  compteursOnglets[nom] = (compteursOnglets[nom] ?? 0) + 1;
  const lignes = ['Onglets MJ réellement ouverts en cours de partie', ''];
  for (const [k, v] of Object.entries(compteursOnglets).sort((a, b) => b[1] - a[1])) {
    lignes.push(`${String(v).padStart(4)} × ${k}`);
  }
  lignes.push('', 'Un zéro est une information, et c’est même la plus utile ici :');
  lignes.push('un onglet jamais ouvert en séance n’a pas à occuper la barre.');
  ecrire(lignes.join('\n'));
}

// --- 16. Champ lumineux à la résolution du masque de fog (M2) --------------
//
// Question de BRIEF-PHASE-0-MESURES.md — M2 : 93 sources composées À LA RÉSOLUTION DU
// MASQUE (8 px/case) puis agrandies une seule fois, est-ce que ça tient dans le budget de
// la tablette ? Cette section mesure UNIQUEMENT le coût par pixel nouveau : composition
// additive des disques et agrandissement. Elle ne mesure PAS l'occlusion par les murs — le
// coût des sweeps est déjà mesuré section 10 (2,6 ms sous cast actif, budget 300 ms) — et
// le verdict des deux ne s'additionne jamais à la main : ils se lisent côte à côte.

/**
 * Position et rayon d'une source lumineuse **dans l'espace du masque de fog** (8 px/case).
 *
 * ⚠ Piège n°5 (`CONVENTIONS.md` §3) : le facteur d'échelle est TOUJOURS
 * `FOG_MASK_PX_PER_CELL`, jamais l'échelle de la carte (140 px/case sur les cartes de test).
 * Confondre les deux donne un disque 17,5 fois trop grand à cette échelle — l'erreur
 * « grandeur dans le mauvais espace » qui a déjà coûté un facteur 3 sur ce projet. La
 * position d'une source est déjà en `CellPoint` (`{cellX, cellY}`, relative à l'origine de
 * l'étage) : aucune conversion par `GridAdapter` n'est nécessaire ici, contrairement à un
 * point en pixels de carte.
 *
 * @param {{ at: { cellX: number, cellY: number }, range: number }} source
 * @returns {{ mx: number, my: number, rayon: number }}
 */
export function discSourceEnEspaceMasque(source) {
  return {
    mx: source.at.cellX * FOG_MASK_PX_PER_CELL,
    my: source.at.cellY * FOG_MASK_PX_PER_CELL,
    rayon: Math.max(0, source.range * FOG_MASK_PX_PER_CELL),
  };
}

/**
 * Géométrie complète du champ lumineux d'un étage, dans l'espace du masque : dimensions du
 * masque, disque de chaque source **réellement déclarée** (jamais un compte extrapolé), et
 * surface totale peinte — la somme des aires, en px² de masque.
 *
 * @param {{ widthCells: number, heightCells: number, lights?: Array<{ at: { cellX: number, cellY: number }, range: number }> }} level
 * @returns {{
 *   maskWidth: number, maskHeight: number, sourceCount: number,
 *   disques: Array<{ mx: number, my: number, rayon: number, aire: number }>,
 *   surfaceTotale: number,
 * }}
 */
export function champLumineuxEnEspaceMasque(level) {
  const sources = Array.isArray(level.lights) ? level.lights : [];
  const disques = sources.map((source) => {
    const { mx, my, rayon } = discSourceEnEspaceMasque(source);
    return { mx, my, rayon, aire: Math.PI * rayon * rayon };
  });
  return {
    maskWidth: level.widthCells * FOG_MASK_PX_PER_CELL,
    maskHeight: level.heightCells * FOG_MASK_PX_PER_CELL,
    sourceCount: sources.length,
    disques,
    surfaceTotale: disques.reduce((somme, d) => somme + d.aire, 0),
  };
}

// Même budget que R3-05 (section 10) : c'est la question posée par le brief — « tient dans
// le budget de la tablette ? ». Cette section ne mesure pas le sweep : le verdict qu'elle
// rend porte donc sur la composition et l'agrandissement SEULS, jamais sur leur somme avec
// le coût des sweeps affiché par ailleurs.
export const LIGHT_FIELD_COMPOSE_BUDGET_MS = 300;

/**
 * Coûts nets (relecture de vidage retranchée) de la composition et de l'agrandissement du
 * champ lumineux, et verdict associé.
 *
 * ⛔ La soustraction n'est pas cosmétique : comme au correctif G-01 du 12/08 (voir
 * `resumeDecodageFroid`), le chronomètre encadre l'opération PLUS un `getImageData(0,0,1,1)`
 * qui vide le pipeline — sans ce vidage on mesure une mise en file, pas une peinture. Cette
 * relecture coûte elle-même plusieurs millisecondes ; la garder dans le total suffit à faire
 * basculer le verdict à elle seule.
 *
 * @param {{ compositionBrutMs: number, agrandissementBrutMs: number, relectureMs: number, sourceCount: number }} mesure
 * @returns {{
 *   compositionNetMs: number, agrandissementNetMs: number, totalNetMs: number,
 *   tenu: boolean, budgetMs: number, verdict: string,
 * }}
 */
export function resumeCompositionChampLumineux({ compositionBrutMs, agrandissementBrutMs, relectureMs, sourceCount }) {
  for (const [nom, valeur] of /** @type {Array<[string, number]>} */ ([
    ['compositionBrutMs', compositionBrutMs],
    ['agrandissementBrutMs', agrandissementBrutMs],
    ['relectureMs', relectureMs],
  ])) {
    if (!Number.isFinite(valeur)) throw new TypeError(`${nom} doit être une durée finie.`);
    if (valeur < 0) throw new RangeError(`${nom} négatif n'est pas une mesure.`);
  }
  if (!Number.isInteger(sourceCount) || sourceCount < 0) {
    throw new RangeError('sourceCount doit être un entier positif ou nul.');
  }

  const compositionNetMs = Math.max(0, compositionBrutMs - relectureMs);
  const agrandissementNetMs = Math.max(0, agrandissementBrutMs - relectureMs);
  const totalNetMs = compositionNetMs + agrandissementNetMs;

  if (sourceCount === 0) {
    return {
      compositionNetMs,
      agrandissementNetMs,
      totalNetMs,
      tenu: false,
      budgetMs: LIGHT_FIELD_COMPOSE_BUDGET_MS,
      verdict: 'Aucune source lue : la carte visée est absente ou vide, la mesure n\'a pas eu lieu.',
    };
  }

  const tenu = totalNetMs < LIGHT_FIELD_COMPOSE_BUDGET_MS;
  return {
    compositionNetMs,
    agrandissementNetMs,
    totalNetMs,
    tenu,
    budgetMs: LIGHT_FIELD_COMPOSE_BUDGET_MS,
    verdict: tenu
      ? `${sourceCount} sources, ${totalNetMs.toFixed(1)} ms net < ${LIGHT_FIELD_COMPOSE_BUDGET_MS} ms : la composition tient.`
      : `${sourceCount} sources, ${totalNetMs.toFixed(1)} ms net ≥ ${LIGHT_FIELD_COMPOSE_BUDGET_MS} ms : la composition NE tient PAS.`,
  };
}

/**
 * Lit une carte réellement publiée (même principe que la section 6bis, sans extrapolation),
 * compose ses sources lumineuses à la résolution du masque, l'agrandit une fois, et
 * chronomètre les deux séparément.
 *
 * ⚠ À lancer sur le poste MJ ou la tablette selon ce qu'on veut juger — cette sonde ne
 * touche pas au chemin de rendu du produit et n'écrit aucun `LightLayer` : elle décide
 * seulement s'il faut l'écrire.
 */
async function diagnosticChampLumineuxMasque() {
  ecrire('Champ lumineux à la résolution du masque — chargement du catalogue…');

  const reponseCatalogue = await fetch('maps/catalog.json');
  if (!reponseCatalogue.ok) {
    ecrire(`catalog.json illisible (${reponseCatalogue.status}) : la mesure n'a pas eu lieu.`);
    return;
  }
  const catalogue = await reponseCatalogue.json();
  const entree = (catalogue.maps ?? []).find(
    (/** @type {any} */ m) => m.name === 'Village' || m.id === 'test_village_complet'
  );
  if (!entree) {
    ecrire('Carte « Village » absente du catalogue publié : la mesure n\'a pas eu lieu, aucun chiffre inventé à la place.');
    return;
  }

  const reponseScene = await fetch(entree.sceneUrl);
  if (!reponseScene.ok) {
    ecrire(`Scène du village illisible (${reponseScene.status}) : la mesure n'a pas eu lieu.`);
    return;
  }
  const scene = await reponseScene.json();
  const level = (scene.levels ?? []).find((/** @type {any} */ l) => String(l.id).endsWith('_00')) ?? scene.levels?.[0];
  if (!level) {
    ecrire('Aucun étage dans la scène du village : la mesure n\'a pas eu lieu.');
    return;
  }

  const champ = champLumineuxEnEspaceMasque(level);
  if (champ.sourceCount === 0) {
    ecrire(`Étage « ${level.id} » : 0 source déclarée. La mesure n'a pas eu lieu — rien à composer.`);
    return;
  }

  ecrire(
    `${champ.sourceCount} sources trouvées sur « ${level.id} », masque ${champ.maskWidth}×${champ.maskHeight} px — chauffe…`
  );

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = champ.maskWidth;
  maskCanvas.height = champ.maskHeight;
  const maskCtx = /** @type {CanvasRenderingContext2D} */ (maskCanvas.getContext('2d'));

  const cible = /** @type {HTMLCanvasElement} */ (document.getElementById('board'));
  cible.width = 640;
  cible.height = 480;
  const cibleCtx = /** @type {CanvasRenderingContext2D} */ (cible.getContext('2d'));

  // Une composition : un dégradé radial additif par source, dans l'espace du masque.
  function composer() {
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.globalCompositeOperation = 'lighter';
    for (const d of champ.disques) {
      const degrade = maskCtx.createRadialGradient(d.mx, d.my, 0, d.mx, d.my, Math.max(1, d.rayon));
      degrade.addColorStop(0, 'rgba(255, 220, 168, 0.9)');
      degrade.addColorStop(1, 'rgba(255, 220, 168, 0)');
      maskCtx.fillStyle = degrade;
      maskCtx.beginPath();
      maskCtx.arc(d.mx, d.my, Math.max(1, d.rayon), 0, Math.PI * 2);
      maskCtx.fill();
    }
    maskCtx.globalCompositeOperation = 'source-over';
  }
  // Un agrandissement : une seule fois, aux dimensions du viewport de mesure.
  function agrandir() {
    cibleCtx.clearRect(0, 0, cible.width, cible.height);
    cibleCtx.drawImage(maskCanvas, 0, 0, maskCanvas.width, maskCanvas.height, 0, 0, cible.width, cible.height);
  }

  // Chauffe explicite, hors chronomètre : le premier tracé d'un canvas coûte plus cher que
  // les suivants (piège n°3). Trois passes, comme au banc du sweep réel (section 6bis).
  for (let i = 0; i < 3; i++) { composer(); agrandir(); }

  // Coût de la relecture seule, sur un bitmap déjà chaud (technique du correctif G-01,
  // reprise de `mesurerDecodageFroid`) : `performance.now()` autour d'une opération canvas
  // seule mesure une mise en file, pas une peinture (piège n°1). On chronomètre donc
  // l'opération SUIVIE d'un `getImageData(0,0,1,1)` qui vide le pipeline, et on isole ici le
  // coût de cette relecture pour le retrancher plus bas.
  const dummy = document.createElement('canvas');
  dummy.width = 1;
  dummy.height = 1;
  const tr0 = performance.now();
  cibleCtx.drawImage(dummy, 0, 0, cible.width, cible.height);
  cibleCtx.getImageData(0, 0, 1, 1);
  const relecture = performance.now() - tr0;

  const tc0 = performance.now();
  composer();
  maskCtx.getImageData(0, 0, 1, 1);
  const compositionBrut = performance.now() - tc0;

  const ta0 = performance.now();
  agrandir();
  cibleCtx.getImageData(0, 0, 1, 1);
  const agrandissementBrut = performance.now() - ta0;

  // L'arithmétique du verdict vit dans `resumeCompositionChampLumineux`, pure et éprouvée
  // sans navigateur : la soustraction de la relecture ne doit pas être un calcul en ligne
  // dans une page que seul un test de navigateur pourrait regarder.
  const resume = resumeCompositionChampLumineux({
    compositionBrutMs: compositionBrut,
    agrandissementBrutMs: agrandissementBrut,
    relectureMs: relecture,
    sourceCount: champ.sourceCount,
  });

  ecrire(
    [
      'Champ lumineux à la résolution du masque — M2',
      '',
      `Carte : ${entree.name} / étage « ${level.id} »`,
      `Sources RÉELLEMENT lues : ${champ.sourceCount}   (aucune extrapolation)`,
      `Masque : ${champ.maskWidth} × ${champ.maskHeight} px  (${level.widthCells} × ${level.heightCells} cases à ${FOG_MASK_PX_PER_CELL} px/case)`,
      `Surface peinte (somme des disques, px² de masque) : ${Math.round(champ.surfaceTotale).toLocaleString('fr-FR')}`,
      '',
      'Chauffe : 3 passes de composition + agrandissement, hors chronomètre (piège n°3).',
      '',
      `Relecture seule (1×1, vidage de pipeline)     : ${arrondi(relecture, 2)} ms`,
      `Composition à la résolution du masque — brut  : ${arrondi(compositionBrut, 2)} ms   net : ${arrondi(resume.compositionNetMs, 2)} ms`,
      `Agrandissement au viewport (640×480)  — brut  : ${arrondi(agrandissementBrut, 2)} ms   net : ${arrondi(resume.agrandissementNetMs, 2)} ms`,
      `Total net                                     : ${arrondi(resume.totalNetMs, 2)} ms   (budget ${resume.budgetMs} ms, R3-05)`,
      '',
      resume.verdict,
      '',
      '⚠ Fenêtre de mesure (piège n°4) : une SEULE composition et un SEUL agrandissement sont',
      'chronométrés ici — cela établit le coût par image de cette opération précise, pas une',
      'dérive sur la durée d\'une séance (voir section 4 pour la tenue thermique dans le temps).',
      '',
      '⚠ Ce que cette section NE mesure PAS :',
      '  — l\'occlusion par les murs (les sweeps) : DÉJÀ mesurée section 10, 2,6 ms sous cast',
      '    actif pour un budget de 300 ms. Le coût total d\'un éclairage réel serait',
      '    sweep + composition, mais ce calcul ne se fait pas ici : lire les deux séparément.',
      '  — le comportement de la tablette elle-même si cette page tourne ailleurs (mauvais monde).',
    ].join('\n')
  );
}

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

// Câblage effectif : gardé derrière `typeof document`, pour la même raison que `sortie` et
// `canvas` plus haut — importer ce module depuis `tests/*.test.mjs` (sans DOM) pour éprouver
// les fonctions pures de la section 16 ne doit pas faire planter le module à l'import. En
// page réelle, `document` existe toujours : ce garde-fou ne change rien au comportement.
if (typeof document !== 'undefined') {
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
  brancher('btn-lumieres', diagnosticLumieres);
  brancher('btn-motifs', afficherMotifs);
  brancher('btn-motif-lisible', () => noterVerdictMotif('lisible'));
  brancher('btn-motif-illisible', () => noterVerdictMotif('ILLISIBLE'));
  brancher('btn-visee', bancDeVisee);
  brancher('btn-horloge', diagnosticHorlogeEtCanal);
  brancher('btn-lumieres-masque', diagnosticChampLumineuxMasque);

  for (const nom of ['Cartes', 'UVTT', 'Image', 'Pions', 'Handouts', 'Fog', 'Murs', 'Liaisons', 'Gabarits', 'Grille']) {
    const bouton = document.getElementById(`btn-onglet-${nom.toLowerCase()}`);
    bouton?.addEventListener('click', () => compterOnglet(nom));
  }

  brancherTemoinsCycleDeVie();

  // Un journal interrompu par un rechargement d'onglet est repris, pas perdu.
  if (enduranceJournal.restore()) {
    ecrire(`Journal endurance repris après rechargement.\n\n${enduranceJournal.toText()}`);
  }

  const champConfig = /** @type {HTMLInputElement} */ (document.getElementById('config'));
  if (localStorage.getItem(CLE_CONFIG)) champConfig.placeholder = 'Configuration déjà enregistrée sur cet appareil';
}
