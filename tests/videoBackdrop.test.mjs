// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VideoBackdrop,
  cssTransformFor,
  HAVE_CURRENT_DATA,
  STALL_CHECK_MS,
  MIN_PLAYBACK_RATIO,
  STALL_CHECK_FLOOR_MS,
  stallPeriodFor,
  advanceBetween,
  LoopingPlaybackProgress,
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

/**
 * Rejoue une lecture par échantillons et rend ce que la mesure conclut.
 *
 * @param {{ duree: number, fenetreMs: number, periodeMs: number, vitesse: number|((t: number) => number) }} scenario
 *   `vitesse` est la fraction du temps réel que le flux parcourt — 1 pour une lecture
 *   normale, 0,3 pour un flux qui rampe, ou une fonction du temps mural pour un flux qui
 *   change de régime en cours de route.
 */
function rejouerLecture({ duree, fenetreMs, periodeMs, vitesse }) {
  const vitesseA = typeof vitesse === 'function' ? vitesse : () => vitesse;
  const progression = new LoopingPlaybackProgress(duree);
  let media = 0;
  progression.sample(media, 0);
  /** @type {number[]} */
  const ratiosIntervalle = [];
  for (let t = periodeMs; t <= fenetreMs; t += periodeMs) {
    // Le flux avance de `vitesse` × la période, et repasse par zéro à chaque tour : c'est
    // exactement ce que `video.currentTime` fait sous `loop`.
    media = (media + (periodeMs / 1000) * vitesseA(t)) % duree;
    const r = progression.sample(media, t);
    if (r !== null) ratiosIntervalle.push(r);
  }
  return { ratio: progression.ratio, avance: progression.avanceTotale, ratiosIntervalle };
}

test('advanceBetween : sans passage par zéro, c’est une simple différence', () => {
  assert.equal(advanceBetween(4, 6.5, 30), 2.5);
});

test('advanceBetween : un passage par zéro n’est pas un blocage', () => {
  // 29,5 s → 2 s sur un flux de 30 s : 2,5 s parcourues, pas −27,5.
  assert.equal(advanceBetween(29.5, 2, 30), 2.5);
});

test('⭐ 60 s de lecture parfaite sur un flux de 30 s valent 100 %, pas 49,8 %', () => {
  // Le test qui aurait attrapé le faux verdict de la campagne du 11/08/2026. L'ancien calcul
  // comparait `currentTime` au début de la fenêtre avec une correction d'un seul tour : deux
  // tours parfaits rendaient 29,9 s pour 60,0 s, soit 49,8 % — juste sous le seuil.
  const { ratio, avance } = rejouerLecture({
    duree: 30,
    fenetreMs: 60000,
    periodeMs: STALL_CHECK_MS,
    vitesse: 1,
  });
  assert.ok(ratio !== null && Math.abs(ratio - 1) < 0.001, `ratio attendu ≈ 1, obtenu ${ratio}`);
  assert.ok(Math.abs(avance - 60) < 0.001, `avance attendue ≈ 60 s, obtenue ${avance}`);
  // Et la borne qui compte : le verdict du produit ne doit pas se déclencher.
  assert.ok(/** @type {number} */ (ratio) >= MIN_PLAYBACK_RATIO);
  // La valeur exacte du défaut, pour que la régression soit nommée et non seulement évitée.
  assert.ok(/** @type {number} */ (ratio) > 0.5, 'le défaut rendait 0,498 — un cheveu sous le seuil');
});

test('la mesure ne dépend pas du nombre de tours de boucle parcourus', () => {
  // Des flux de durées très différentes, tous lus normalement : même verdict. C'est
  // précisément ce que le défaut ne faisait pas — il rendait duree/fenetre.
  //
  // ⛔ Toutes ces durées dépassent la période d'échantillonnage, comme `advanceBetween`
  // l'exige. En dessous, la mesure est faussée par construction : voir le test suivant, qui
  // épingle la limite au lieu de la contourner.
  for (const duree of [3, 7.5, 30, 300]) {
    const { ratio } = rejouerLecture({
      duree,
      fenetreMs: 60000,
      periodeMs: STALL_CHECK_MS,
      vitesse: 1,
    });
    assert.ok(
      ratio !== null && Math.abs(ratio - 1) < 0.001,
      `flux de ${duree} s : ratio attendu ≈ 1, obtenu ${ratio}`
    );
  }
});

test('⭐ échantillonner plus lentement que le flux le rend illisible — la raison d’être de stallPeriodFor', () => {
  // Découvert en écrivant le test précédent, et **ce n'était pas un défaut du diagnostic** :
  // `_checkPlayback` échantillonnait à `STALL_CHECK_MS` fixe, donc une carte dont la vidéo
  // durait moins de 2,5 s voyait son fond animé rabattu sur l'affiche fixe, avec un
  // avertissement accusant à tort le décodeur. Corrigé le 11/08/2026 en dérivant la période
  // de la durée du flux.
  //
  // Ce test garde l'arithmétique du défaut, parce que c'est elle qui justifie la dérivation :
  // à période fixe, une lecture PARFAITE d'un flux de 2 s se lit 0,2. Le supprimer laisserait
  // `stallPeriodFor` sans raison écrite, et quelqu'un rétablirait la constante.
  const aPeriodeFixe = rejouerLecture({
    duree: 2,
    fenetreMs: 60000,
    periodeMs: STALL_CHECK_MS,
    vitesse: 1,
  });
  assert.ok(
    /** @type {number} */ (aPeriodeFixe.ratio) < MIN_PLAYBACK_RATIO,
    'l’arithmétique du défaut a changé — relire le commentaire ci-dessus'
  );
  assert.ok(Math.abs(/** @type {number} */ (aPeriodeFixe.ratio) - 0.2) < 0.001);

  // Et la même lecture, à la période que le produit choisit désormais pour ce flux.
  const aPeriodeDerivee = rejouerLecture({
    duree: 2,
    fenetreMs: 60000,
    periodeMs: stallPeriodFor(2),
    vitesse: 1,
  });
  assert.ok(
    Math.abs(/** @type {number} */ (aPeriodeDerivee.ratio) - 1) < 0.001,
    `ratio attendu ≈ 1, obtenu ${aPeriodeDerivee.ratio}`
  );
});

test('stallPeriodFor : nominale pour un flux long, dérivée pour un flux court, jamais sous le plancher', () => {
  assert.equal(stallPeriodFor(30), STALL_CHECK_MS, 'un flux long garde la période nominale');
  assert.equal(stallPeriodFor(5), STALL_CHECK_MS, 'à 5 s, la moitié vaut déjà la nominale');
  assert.equal(stallPeriodFor(2), 1000, 'la moitié de la durée');
  assert.equal(stallPeriodFor(1.2), 600);
  assert.equal(stallPeriodFor(0.4), STALL_CHECK_FLOOR_MS, 'le plancher protège de la gigue');
  // Durée inconnue à l'armement, flux continu, valeur absurde : période nominale, et c'est le
  // refus de conclure de `_checkPlayback` qui sert alors de garde-fou.
  for (const d of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(stallPeriodFor(/** @type {any} */ (d)), STALL_CHECK_MS, `durée ${d}`);
  }
  // La période reste toujours strictement sous la durée dès que la durée dépasse le plancher :
  // c'est la précondition d'`advanceBetween`, et elle doit tenir sur tout l'intervalle utile.
  for (const d of [0.6, 1, 2, 4.9, 5, 30, 600]) {
    assert.ok(stallPeriodFor(d) < d * 1000, `période ≥ durée pour un flux de ${d} s`);
  }
});

test('un flux qui rampe à 30 % est bien vu comme rampant', () => {
  const { ratio } = rejouerLecture({
    duree: 30,
    fenetreMs: 60000,
    periodeMs: STALL_CHECK_MS,
    vitesse: 0.3,
  });
  assert.ok(ratio !== null && Math.abs(ratio - 0.3) < 0.001, `ratio attendu ≈ 0,3, obtenu ${ratio}`);
  assert.ok(/** @type {number} */ (ratio) < MIN_PLAYBACK_RATIO);
});

test('le ratio d’intervalle attrape un blocage tardif que le cumul dilue', () => {
  // 50 s de lecture normale puis un arrêt franc : le cumul reste au-dessus du seuil, donc un
  // verdict global déclarerait « ça tient ». C'est pour ça que le premier repli se juge sur
  // l'intervalle — comme `_checkPlayback`, qui ne regarde jamais plus loin que l'échantillon
  // précédent.
  const { ratio, ratiosIntervalle } = rejouerLecture({
    duree: 30,
    fenetreMs: 60000,
    periodeMs: STALL_CHECK_MS,
    vitesse: (t) => (t <= 50000 ? 1 : 0),
  });
  assert.ok(/** @type {number} */ (ratio) >= MIN_PLAYBACK_RATIO, 'le cumul dilue le blocage');
  assert.ok(
    ratiosIntervalle.some((r) => r < MIN_PLAYBACK_RATIO),
    'aucun intervalle n’a été vu sous le seuil, le blocage passerait inaperçu'
  );
});

test('le premier échantillon ne conclut rien : il sert de référence', () => {
  const progression = new LoopingPlaybackProgress(30);
  assert.equal(progression.sample(0, 0), null);
  assert.equal(progression.ratio, null, 'aucun intervalle mesuré, donc aucun ratio à rendre');
  assert.equal(progression.sample(2.5, 2500), 1);
});

test('deux échantillons à la même horloge ne fabriquent pas un ratio infini', () => {
  const progression = new LoopingPlaybackProgress(30);
  progression.sample(0, 1000);
  assert.equal(progression.sample(1, 1000), null);
  assert.equal(progression.ratio, null);
});

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

/** Harnais dont le minuteur retient aussi la période demandée. */
function harnessMinute() {
  let maintenant = 0;
  /** @type {Array<{ fn: () => void, ms: number }>} */
  const timers = [];
  const h = harness({
    clock: () => maintenant,
    setTimer: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  return {
    ...h,
    timers,
    get maintenant() { return maintenant; },
    avancer: (/** @type {number} */ ms) => { maintenant += ms; },
    /** Déclenche le dernier contrôle armé — les précédents ont été désarmés. */
    controler: () => timers[timers.length - 1].fn(),
    get periode() { return timers[timers.length - 1].ms; },
  };
}

test('⭐ un fond animé de 2 s lu parfaitement n’est plus rabattu sur l’affiche', () => {
  // Le défaut, en un test. À période fixe de 2 500 ms, un flux de 2 s avançait de 0,5 s entre
  // deux échantillons — le reste étant deux tours de boucle invisibles — soit un ratio de 0,2,
  // et le fond animé de toute carte à boucle courte s'éteignait au bout de cinq secondes.
  const h = harnessMinute();
  h.backdrop.sync({ videoUrl: 'boucle-courte.webm' });
  h.video.readyState = 4;
  h.video.paused = false;
  h.video.currentTime = 0;

  // La durée n'existe qu'aux métadonnées : c'est là que la période se dérive.
  assert.equal(h.periode, STALL_CHECK_MS, 'avant les métadonnées, la période reste nominale');
  h.video.duration = 2;
  h.video.emit('loadedmetadata');
  assert.equal(h.periode, 1000, 'la période doit suivre la durée du flux');

  h.controler();                       // référence
  for (let tour = 1; tour <= 6; tour++) {
    h.avancer(h.periode);
    // Lecture parfaite : le flux avance d'une période et repasse par zéro tous les deux tours.
    h.video.currentTime = (tour * (h.periode / 1000)) % h.video.duration;
    h.controler();
  }

  assert.equal(h.backdrop.active, true, 'une lecture parfaite a été prise pour un blocage');
  assert.deepEqual(h.warnings.filter((w) => /trop lent/.test(w)), []);
  assert.notEqual(h.video.style.display, 'none');
});

test('un flux court qui rampe réellement est tout de même rattrapé', () => {
  // Le pendant du test précédent : dériver la période ne doit pas revenir à désarmer le
  // contrôle pour les flux courts, sinon on échange un faux positif contre un faux négatif.
  const h = harnessMinute();
  h.backdrop.sync({ videoUrl: 'boucle-courte-lente.webm' });
  h.video.readyState = 4;
  h.video.paused = false;
  h.video.duration = 2;
  h.video.emit('loadedmetadata');
  h.video.currentTime = 0;

  h.controler();
  h.avancer(h.periode);
  h.video.currentTime = 0.1;          // 0,1 s de flux pour 1 s de temps réel : 10 %
  h.controler();

  assert.equal(h.backdrop.active, false, 'le repli doit fonctionner aussi sur un flux court');
  assert.match(h.warnings.join(' '), /trop lent/);
});

test('⛔ sous le plancher, la mesure est indécidable et le contrôle refuse de conclure', () => {
  // Un flux de 0,4 s : aucune période ne peut être à la fois sous la durée et au-dessus du
  // plancher de gigue. Le contrôle doit alors **s'abstenir** — laisser jouer un fond animé
  // peut-être lent vaut infiniment mieux qu'éteindre une lecture saine.
  const h = harnessMinute();
  h.backdrop.sync({ videoUrl: 'tres-courte.webm' });
  h.video.readyState = 4;
  h.video.paused = false;
  h.video.duration = 0.4;
  h.video.emit('loadedmetadata');
  h.video.currentTime = 0;

  assert.equal(h.periode, STALL_CHECK_FLOOR_MS);
  h.controler();
  h.avancer(h.periode);
  h.video.currentTime = 0;            // parfaitement immobile, en apparence
  h.controler();

  assert.equal(h.backdrop.active, true, 'une mesure indécidable ne doit jamais conclure');
  assert.deepEqual(h.warnings.filter((w) => /trop lent/.test(w)), []);
});

test('changer d’étage réarme la période sur la durée du nouveau flux', () => {
  const h = harnessMinute();
  h.backdrop.sync({ videoUrl: 'courte.webm' });
  h.video.duration = 2;
  h.video.emit('loadedmetadata');
  assert.equal(h.periode, 1000);

  h.backdrop.sync({ videoUrl: 'longue.webm' });
  h.video.duration = 60;
  h.video.emit('loadedmetadata');
  assert.equal(h.periode, STALL_CHECK_MS, 'la période du flux précédent a survécu au changement');
});

test('les métadonnées d’un flux déjà en échec ne réarment rien', () => {
  // `loadedmetadata` peut arriver après un `error` selon la plateforme : réarmer relancerait un
  // contrôle sur une source abandonnée, et le repli est définitif pour cette URL.
  const h = harnessMinute();
  h.backdrop.sync({ videoUrl: 'cassee.webm' });
  const armes = h.timers.length;
  h.video.emit('error');
  h.video.duration = 2;
  h.video.emit('loadedmetadata');
  assert.equal(h.timers.length, armes, 'un flux en échec a été réarmé');
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
