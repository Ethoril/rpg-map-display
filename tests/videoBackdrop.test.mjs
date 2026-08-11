// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VideoBackdrop,
  cssTransformFor,
  HAVE_CURRENT_DATA,
  STALL_CHECK_MS,
} from '../js/render/videoBackdrop.js';
import { BackgroundLayer } from '../js/render/layers/background.js';
import { Camera } from '../js/render/camera.js';

/** Élément vidéo factice : reproduit ce que la couche lit et écrit, rien de plus. */
function fakeVideo() {
  /** @type {Record<string, Array<() => void>>} */
  const listeners = {};
  return {
    style: /** @type {Record<string, string>} */ ({}),
    attributes: /** @type {Record<string, string>} */ ({}),
    readyState: 0,
    src: '',
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 0,
    muted: false,
    autoplay: false,
    loop: false,
    playsInline: false,
    preload: '',
    className: '',
    loadCount: 0,
    playCount: 0,
    /** @type {null | (() => Promise<void>)} */
    playImpl: null,
    removed: false,
    addEventListener(/** @type {string} */ type, /** @type {() => void} */ fn) {
      (listeners[type] ??= []).push(fn);
    },
    emit(/** @type {string} */ type) {
      for (const fn of listeners[type] ?? []) fn();
    },
    setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attributes[k] = v; },
    removeAttribute(/** @type {string} */ k) { if (k === 'src') this.src = ''; delete this.attributes[k]; },
    load() { this.loadCount++; },
    play() { this.playCount++; return this.playImpl ? this.playImpl() : Promise.resolve(); },
    remove() { this.removed = true; },
  };
}

function harness(options = {}) {
  const video = fakeVideo();
  /** @type {any[]} */
  const inserted = [];
  const container = /** @type {any} */ ({
    insertBefore(/** @type {any} */ node, /** @type {any} */ ref) { inserted.push([node, ref]); },
    firstChild: null,
  });
  const canvas = /** @type {any} */ ({});
  let invalidations = 0;
  /** @type {string[]} */
  const warnings = [];
  const backdrop = new VideoBackdrop({
    documentRef: /** @type {any} */ ({ createElement: () => video }),
    invalidate: () => { invalidations++; },
    onWarning: (m) => warnings.push(m),
    ...options,
  });
  backdrop.attach(container, canvas);
  return {
    backdrop, video, container, canvas, warnings, inserted,
    get invalidations() { return invalidations; },
  };
}

test('la vidéo est insérée avant le canvas, muette, bouclée et en lecture en ligne', () => {
  const h = harness();
  assert.equal(h.inserted.length, 1);
  assert.equal(h.inserted[0][0], h.video, 'la vidéo est le nœud inséré');
  assert.equal(h.inserted[0][1], h.canvas, 'elle est insérée AVANT le canvas');
  assert.equal(h.video.muted, true, 'sans muted, la lecture automatique est refusée');
  assert.equal(h.video.loop, true);
  assert.equal(h.video.playsInline, true);
  assert.equal(h.video.className, 'video-backdrop');
});

test('le seuil de lisibilité est HAVE_CURRENT_DATA, pas HAVE_METADATA', () => {
  // ⛔ Épinglé sur la valeur du DOM, pas sur elle-même. Un test qui écrit ses seuils avec
  // `HAVE_CURRENT_DATA - 1` et `HAVE_CURRENT_DATA` reste vert si la constante passe à 1 —
  // or 1 est `HAVE_METADATA`, où **aucune image n'est décodée** : la couche de fond se
  // tairait sur un flux vide et la carte disparaîtrait pendant toute la mise en tampon.
  assert.equal(HAVE_CURRENT_DATA, 2, 'HTMLMediaElement.HAVE_CURRENT_DATA vaut 2');
});

test('active reste faux tant que le flux n’a pas d’image décodée', () => {
  const h = harness();
  assert.equal(h.backdrop.active, false, 'sans source');

  h.backdrop.sync({ videoUrl: 'maps/generated/x.webm' });
  assert.equal(h.video.src, 'maps/generated/x.webm');
  assert.equal(h.video.style.display, 'block', 'l’élément doit être affiché à l’aller');
  assert.equal(h.backdrop.active, false, 'source posée mais rien de décodé');

  h.video.readyState = 1; // HAVE_METADATA — dimensions connues, aucune image
  assert.equal(h.backdrop.active, false, 'métadonnées seules ne suffisent pas');

  h.video.readyState = 2; // HAVE_CURRENT_DATA
  assert.equal(h.backdrop.active, true, 'image courante décodée');
});

test('une erreur de flux rend la main à l’image fixe, définitivement pour cette URL', () => {
  const h = harness();
  h.backdrop.sync({ videoUrl: 'maps/generated/x.webm' });
  h.video.readyState = HAVE_CURRENT_DATA;
  assert.equal(h.backdrop.active, true);

  h.video.emit('error');
  assert.equal(h.backdrop.active, false, 'même readyState élevé, une erreur reprend la main');
  assert.equal(h.video.style.display, 'none',
    'un <video> en échec peut dessiner un cadre ou une icône selon la plateforme');
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /repli sur l'image fixe/);
});

test('un échec vaut pour CETTE URL, et pas pour la suivante', () => {
  // Le titre du test voisin promet « définitivement pour cette URL » : la portée doit être
  // vérifiée des deux côtés. Sans réarmement de `failed` dans `sync`, une seule vidéo
  // illisible éteignait le fond animé pour **toute la séance**, sur tous les étages.
  const h = harness();
  h.backdrop.sync({ videoUrl: 'casse.webm' });
  h.video.readyState = 2;
  h.video.emit('error');
  assert.equal(h.backdrop.active, false);

  // Même URL : l'échec tient.
  h.backdrop.sync({ videoUrl: 'casse.webm' });
  assert.equal(h.backdrop.active, false, 'resynchroniser la même URL ne doit pas réarmer');

  // Autre URL : on repart.
  h.backdrop.sync({ videoUrl: 'bonne.webm' });
  h.video.readyState = 2;
  assert.equal(h.backdrop.active, true, 'l’échec précédent ne condamne pas l’étage suivant');
  assert.equal(h.video.style.display, 'block');
});

test('un flux qui rampe rend la main à l’image fixe', () => {
  // ⭐ Le mode de panne le plus probable n'est PAS l'échec : c'est le décodage logiciel.
  // `readyState` reste à 4, aucun `error` n'est émis, et sans ce contrôle `active`
  // restait vrai — on affichait un diaporama au lieu d'une carte nette.
  let maintenant = 0;
  /** @type {Array<() => void>} */
  const timers = [];
  const h = harness({
    clock: () => maintenant,
    setTimer: (/** @type {() => void} */ fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  h.backdrop.sync({ videoUrl: 'lente.webm' });
  h.video.readyState = 4;
  h.video.paused = false;
  h.video.duration = 30;
  h.video.currentTime = 0;
  assert.equal(timers.length, 1, 'poser une source arme le contrôle de cadence');

  timers[0]();                       // premier échantillon : référence, aucune conclusion
  assert.equal(h.backdrop.active, true, 'un seul échantillon ne prouve rien');

  maintenant += STALL_CHECK_MS;      // 2,5 s de temps réel…
  h.video.currentTime = 0.2;         // …pour 0,2 s de flux : 8 %
  timers[0]();

  assert.equal(h.backdrop.active, false, 'le repli doit se déclencher');
  assert.equal(h.video.style.display, 'none');
  assert.match(h.warnings.join(' '), /trop lent/);
});

test('un flux à cadence normale n’est jamais repris, boucle comprise', () => {
  let maintenant = 0;
  /** @type {Array<() => void>} */
  const timers = [];
  const h = harness({
    clock: () => maintenant,
    setTimer: (/** @type {() => void} */ fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  h.backdrop.sync({ videoUrl: 'bonne.webm' });
  h.video.readyState = 4;
  h.video.paused = false;
  h.video.duration = 30;

  h.video.currentTime = 28.0;
  timers[0]();
  maintenant += STALL_CHECK_MS;
  // Passage par la boucle : currentTime RECULE. Un contrôle naïf conclurait au blocage
  // et éteindrait un fond parfaitement sain une fois toutes les 30 secondes.
  h.video.currentTime = 0.5;
  timers[0]();

  assert.equal(h.backdrop.active, true, 'le retour à zéro de la boucle n’est pas un blocage');
  assert.equal(h.warnings.filter((w) => /trop lent/.test(w)).length, 0);
});

test('un flux en pause n’est pas jugé trop lent', () => {
  let maintenant = 0;
  /** @type {Array<() => void>} */
  const timers = [];
  const h = harness({
    clock: () => maintenant,
    setTimer: (/** @type {() => void} */ fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });
  h.backdrop.sync({ videoUrl: 'pause.webm' });
  h.video.readyState = 4;
  h.video.paused = true;        // lecture automatique refusée : cas déjà traité ailleurs
  h.video.currentTime = 0;

  timers[0]();
  maintenant += STALL_CHECK_MS * 4;
  timers[0]();

  assert.equal(h.backdrop.active, true, 'une pause n’est pas une panne de décodage');
});

test('changer d’étage sans vidéo coupe réellement le décodage', () => {
  const h = harness();
  h.backdrop.sync({ videoUrl: 'maps/generated/x.webm' });
  const loadsApresSource = h.video.loadCount;

  h.backdrop.sync({ videoUrl: null });
  assert.equal(h.video.src, '', 'la source est retirée');
  assert.ok(h.video.loadCount > loadsApresSource,
    'load() doit être rappelé : sans lui Chromium garde le flux et continue de décoder');
  assert.equal(h.video.style.display, 'none');
  assert.equal(h.backdrop.active, false);
});

test('resynchroniser la même URL ne relance pas le flux', () => {
  const h = harness();
  h.backdrop.sync({ videoUrl: 'a.webm' });
  const loads = h.video.loadCount;
  const plays = h.video.playCount;
  h.backdrop.sync({ videoUrl: 'a.webm' });
  h.backdrop.sync({ videoUrl: 'a.webm' });
  assert.equal(h.video.loadCount, loads, 'un rendu par frame ne doit pas recharger la vidéo');
  assert.equal(h.video.playCount, plays);
});

test('un refus de lecture automatique est signalé une seule fois et ne casse rien', async () => {
  const h = harness();
  h.video.playImpl = () => Promise.reject(new Error('NotAllowedError'));
  h.backdrop.sync({ videoUrl: 'a.webm' });
  await Promise.resolve();
  await Promise.resolve();
  h.backdrop.sync({ videoUrl: 'b.webm' });
  await Promise.resolve();
  await Promise.resolve();
  const refus = h.warnings.filter((w) => /automatique/.test(w));
  assert.equal(refus.length, 1, 'un seul avertissement, pas un par étage');
});

test('la transformation CSS reproduit Camera.applyToContext, sans le facteur de densité', () => {
  // Camera.applyToContext fait : translate(sw/2, sh/2) · scale(zoom) · translate(-x, -y)
  const t = cssTransformFor({ x: 1000, y: 500, zoom: 0.25 }, 800, 600);
  assert.equal(t, 'translate(400px, 300px) scale(0.25) translate(-1000px, -500px)');

  // Le point carte (1000,500) doit atterrir au centre de l'écran.
  const applique = (/** @type {number} */ mx, /** @type {number} */ my) => ({
    x: 400 + 0.25 * (mx - 1000),
    y: 300 + 0.25 * (my - 500),
  });
  assert.deepEqual(applique(1000, 500), { x: 400, y: 300 });

  // ⛔ Le facteur `stage.resolution` ne doit PAS y figurer : une transformation CSS
  // travaille en pixels CSS. L'y remettre doublerait le zoom sur la tablette et
  // nulle part sur un poste en densité 1.
  assert.equal(t.includes('scale(0.25)'), true);
  assert.equal(/scale\([^)]*\).*scale\(/.test(t), false, 'une seule mise à l’échelle');
});

test('la transformation CSS est dérivée de la VRAIE Camera, pas d’une formule recopiée', () => {
  // ⛔ Le test ci-dessus compare une chaîne à une chaîne écrite en dur : il ne relie rien.
  // Le jour où `Camera.applyToContext` change d'ordre d'opérations, la vidéo dérive de
  // toute la carte et ce test-là reste vert. Ici on enregistre ce que la caméra fait
  // **réellement** à un contexte, et on vérifie que la chaîne CSS énonce la même chose.
  const camera = new Camera(800, 600);
  camera.setPan(1000, 500);
  camera.setZoom(0.25);

  /** @type {string[]} */
  const ordres = [];
  const ctx = /** @type {any} */ ({
    translate: (/** @type {number} */ x, /** @type {number} */ y) =>
      ordres.push(`translate(${x}px, ${y}px)`),
    scale: (/** @type {number} */ sx) => ordres.push(`scale(${sx})`),
  });
  camera.applyToContext(ctx);

  assert.equal(
    cssTransformFor(camera, 800, 600),
    ordres.join(' '),
    'la transformation CSS doit énoncer exactement la suite d’opérations de la caméra'
  );
});

test('place() dimensionne la boîte à la carte, pas à la vidéo', () => {
  const h = harness();
  h.backdrop.sync({ videoUrl: 'a.webm' });
  h.backdrop.place({ x: 100, y: 50, zoom: 2 }, 3920, 2660, 1024, 768);
  assert.equal(h.video.style.width, '3920px');
  assert.equal(h.video.style.height, '2660px');
  assert.equal(h.video.style.transform, 'translate(512px, 384px) scale(2) translate(-100px, -50px)');
});

test('place() ne touche à rien sans source : pas de boîte fantôme sur un étage fixe', () => {
  const h = harness();
  h.backdrop.place({ x: 0, y: 0, zoom: 1 }, 1000, 800, 800, 600);
  assert.equal(h.video.style.transform, undefined);
  assert.equal(h.video.style.width, undefined);
});

test('chaque changement d’état demande une nouvelle frame', () => {
  const h = harness();
  const avant = h.invalidations;
  h.backdrop.sync({ videoUrl: 'a.webm' });
  assert.ok(h.invalidations > avant, 'poser une source doit invalider');
  const apresSource = h.invalidations;
  h.video.emit('loadeddata');
  assert.ok(h.invalidations > apresSource,
    'sans invalidation sur loadeddata, la couche de fond ne se tairait jamais et la vidéo resterait cachée');
});

// ---------------------------------------------------------------------------
// La contrepartie côté canvas : quand la vidéo peint, le fond doit se taire.
// ---------------------------------------------------------------------------

/** Contexte 2D factice qui enregistre les ordres de peinture. */
function fakeCtx() {
  const calls = /** @type {string[]} */ ([]);
  return {
    calls,
    fillStyle: '',
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    fillRect() { calls.push('fillRect'); },
    drawImage() { calls.push('drawImage'); },
  };
}

/** Couche de fond prête à peindre, avec une image factice mesurable. */
function coucheDeFond() {
  const layer = new BackgroundLayer({ imageFactory: () => /** @type {any} */ ({}) });
  layer.status = 'ready';
  layer.image = /** @type {any} */ ({ naturalWidth: 100, naturalHeight: 80 });
  return layer;
}

test('à froid, la couche peint le fond neutre — et c’est lui qui masquerait la vidéo', () => {
  // Une image fraîche est **froide** (`JAMAIS_DECODEE`) : le chantier N interdit de la
  // décoder en synchrone, donc elle n'est pas dessinée à la première frame. Le fond
  // neutre, lui, l'est — et il est opaque. C'est précisément ce qu'il faut supprimer.
  const layer = coucheDeFond();
  const normal = fakeCtx();
  layer.render(/** @type {any} */ (normal), 100, 80, {});
  assert.ok(normal.calls.includes('fillRect'), 'le fond neutre est peint à froid');

  const supprime = fakeCtx();
  coucheDeFond().render(/** @type {any} */ (supprime), 100, 80, { suppressed: true });
  assert.deepEqual(supprime.calls, [],
    'aucun ordre de peinture : un seul fillRect suffirait à cacher la vidéo, le canvas étant au-dessus');
});

test('suppressed vaut aussi quand l’affiche n’est pas encore chargée', () => {
  // Le cas qui compte vraiment : la vidéo est décodée **avant** l'affiche. Les deux tests
  // voisins partent d'une couche `status: 'ready'` avec une image ; conditionner la
  // suppression à cet état les laissait verts, alors que c'est précisément ici que le
  // `fillRect` neutre opaque recouvrirait la vidéo.
  const layer = new BackgroundLayer({ imageFactory: () => /** @type {any} */ ({}) });
  layer.status = 'loading';
  layer.image = null;

  const ctx = fakeCtx();
  layer.render(/** @type {any} */ (ctx), 100, 80, { suppressed: true });
  assert.deepEqual(ctx.calls, [], 'aucune peinture, même sans image chargée');

  const sans = fakeCtx();
  const autre = new BackgroundLayer({ imageFactory: () => /** @type {any} */ ({}) });
  autre.status = 'loading';
  autre.image = null;
  autre.render(/** @type {any} */ (sans), 100, 80, {});
  assert.ok(sans.calls.includes('fillRect'), 'sans suppression, le fond neutre est bien peint');
});

test('à chaud, suppressed empêche aussi le dessin de l’image', () => {
  const layer = coucheDeFond();
  // `decodeUnusable` force la branche chaude sans avoir à simuler une horloge.
  const entry = /** @type {any} */ (layer)._warmthEntry();
  entry.decodeUnusable = true;

  const normal = fakeCtx();
  layer.render(/** @type {any} */ (normal), 100, 80, {});
  assert.ok(normal.calls.includes('drawImage'), 'à chaud, l’image est bien dessinée');

  const chaud = coucheDeFond();
  /** @type {any} */ (chaud)._warmthEntry().decodeUnusable = true;
  const supprime = fakeCtx();
  chaud.render(/** @type {any} */ (supprime), 100, 80, { suppressed: true });
  assert.deepEqual(supprime.calls, [], 'même chaude, la couche se tait quand la vidéo peint');
});
