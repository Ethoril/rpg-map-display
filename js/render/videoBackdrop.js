// @ts-check

/**
 * Fond animé : un élément `<video>` posé **sous** le canvas, jamais dessiné dedans.
 *
 * ## Pourquoi hors du canvas
 *
 * Faire passer la vidéo par `drawImage` obligerait à redessiner 30 fois par seconde,
 * indéfiniment. Or `FrameScheduler` planifie **une** frame par invalidation et s'arrête
 * (`js/render/frame.js`) : tout le moteur est bâti sur un rendu à la demande, et le
 * chantier N a existé précisément pour ne plus redécoder le fond à chaque frame.
 *
 * Sous le canvas, la vidéo est décodée par le compositeur du navigateur, sur son propre
 * fil, avec l'accélération matérielle. La boucle `requestAnimationFrame` ne la voit
 * jamais : elle reste à la demande, et les mesures de la phase R2 continuent de porter
 * sur exactement ce qu'elles mesuraient.
 *
 * Le CdC §9 supposait qu'un `videoUrl` « désactive le rendu à la demande ». Ce n'est
 * vrai que d'une vidéo passée par le canvas. Ici le rendu à la demande est conservé.
 *
 * ## Ce qui rend le repli gratuit
 *
 * `active` n'est vrai que lorsque le flux a **réellement** des pixels décodés. Tant que
 * ce n'est pas le cas — chargement, erreur réseau, codec refusé, appareil trop faible —
 * la couche de fond continue de peindre `imageUrl`, c'est-à-dire l'affiche. Il n'y a
 * donc pas de code de secours : le secours est le comportement par défaut, et le fond
 * animé est ce qui s'y substitue quand il le peut.
 */

/** `HTMLMediaElement.HAVE_CURRENT_DATA` : au moins l'image courante est décodée. */
export const HAVE_CURRENT_DATA = 2;

/** Période d'échantillonnage du contrôle de cadence, en millisecondes. */
export const STALL_CHECK_MS = 2500;

/**
 * Fraction du temps réel qu'un flux doit parcourir pour être jugé lisible.
 *
 * ⭐ **Ce seuil existe parce que le repli, sans lui, ne pouvait pas se déclencher dans le
 * mode de panne le plus probable.** Un flux dont la résolution dépasse ce que le décodeur
 * matériel accepte n'échoue pas : Chromium bascule en logiciel et le lit *lentement*.
 * `readyState` reste à 4, aucun événement `error` n'est émis, donc `active` restait vrai —
 * et l'affiche, parfaitement nette, n'était jamais reprise. On préférait un diaporama à
 * trois images par seconde à une carte fixe correcte.
 *
 * `testvideo-3` est précisément dans ce cas : 4200 × 2850 = 11,97 M échantillons contre
 * 8 912 896 au plafond VP9 niveau 5.2 (voir `scripts/videoProbe.mjs`).
 *
 * 0,5 est délibérément permissif : il ne s'agit pas de juger de la fluidité mais de
 * distinguer « ça joue » de « ça rampe ». Une lecture à moitié vitesse est déjà cassée.
 */
export const MIN_PLAYBACK_RATIO = 0.5;

/**
 * Avancement d'un flux entre deux échantillons, passage par zéro compris.
 *
 * ⛔ **Valable pour un seul tour de boucle, donc à n'appeler que sur des échantillons plus
 * rapprochés que la durée du flux.** Au-delà, un tour entier est indiscernable d'un flux
 * immobile : l'information est perdue et aucune arithmétique ne la rattrape. C'est une
 * contrainte sur l'appelant, et elle a déjà été violée — voir `LoopingPlaybackProgress`.
 *
 * @param {number} precedent - `currentTime` de l'échantillon précédent
 * @param {number} courant - `currentTime` de l'échantillon courant
 * @param {number} duree - durée du flux, `video.duration`
 * @returns {number} secondes de flux parcourues depuis l'échantillon précédent
 */
export function advanceBetween(precedent, courant, duree) {
  const avance = courant - precedent;
  return avance < 0 ? avance + (duree || 0) : avance;
}

/**
 * Cumul de l'avancement d'un flux qui boucle, échantillon par échantillon.
 *
 * ⭐ **Existe parce qu'une mesure fausse a survécu à une campagne entière.** La section 7bis
 * de `diag.html` comparait `currentTime` au **début** d'une fenêtre de 60 s, avec la
 * correction d'un seul tour d'`advanceBetween`, sur une vidéo de 30 s. Soixante secondes de
 * lecture *parfaite* font deux tours : `currentTime` revient à son point de départ, la
 * correction en rend un seul, et le résultat annoncé était **29,9 s pour 60,0 s — 49,8 %,
 * juste sous le seuil de 50 %**. Le verdict « la lecture rampe » était donc déterministe et
 * indépendant du matériel, ce qui l'a rendu crédible : la tablette et un PC puissant
 * rendaient exactement le même chiffre.
 *
 * Cumuler par intervalle respecte la contrainte d'`advanceBetween` par construction, et
 * donne en plus la grandeur que le produit juge réellement — le ratio **de l'intervalle**,
 * et non celui depuis le début, `VideoBackdrop._checkPlayback` ne regardant jamais plus loin
 * que l'échantillon précédent.
 */
export class LoopingPlaybackProgress {
  /** @param {number} duree - durée du flux, `video.duration` */
  constructor(duree) {
    this.duree = duree;
    /** Total des avancements par intervalle, en secondes de flux. */
    this.avanceTotale = 0;
    /** Temps mural couvert par les intervalles mesurés, en millisecondes. */
    this.ecouleTotal = 0;
    /** @type {{ at: number, media: number }|null} */
    this._precedent = null;
  }

  /**
   * Enregistre un échantillon et rend le ratio **de cet intervalle**.
   *
   * @param {number} media - `video.currentTime`
   * @param {number} at - horloge murale, en millisecondes
   * @returns {number|null} ratio de l'intervalle, ou `null` pour le premier échantillon —
   *   qui ne sert que de référence, comme dans le contrôle de cadence du produit.
   */
  sample(media, at) {
    const precedent = this._precedent;
    this._precedent = { at, media };
    if (!precedent) return null;

    const ecoule = at - precedent.at;
    if (ecoule <= 0) return null;
    const avance = advanceBetween(precedent.media, media, this.duree);
    this.avanceTotale += avance;
    this.ecouleTotal += ecoule;
    return (avance * 1000) / ecoule;
  }

  /**
   * Ratio cumulé sur tous les intervalles mesurés.
   *
   * ⚠ Rapporté au temps mural **couvert par les échantillons**, pas à la durée totale de la
   * fenêtre : un échantillon manqué ne doit pas se lire comme un flux en retard.
   */
  get ratio() {
    if (this.ecouleTotal <= 0) return null;
    return (this.avanceTotale * 1000) / this.ecouleTotal;
  }
}

/**
 * Transformation CSS reproduisant exactement `Camera.applyToContext`.
 *
 * ⛔ **Sans le `scale(resolution)` du stage.** `renderAll` applique d'abord
 * `ctx.scale(stage.resolution, stage.resolution)` pour passer en pixels physiques ; une
 * transformation CSS travaille déjà en pixels CSS. Reprendre le facteur ici doublerait
 * le zoom sur tout écran à densité > 1 — donc sur la tablette cible, et nulle part sur
 * un poste de développement en densité 1. Exactement le genre d'écart qui ne se voit
 * qu'à table.
 *
 * @param {{ x: number, y: number, zoom: number }} camera
 * @param {number} screenWidth - largeur du stage en pixels CSS
 * @param {number} screenHeight - hauteur du stage en pixels CSS
 * @returns {string}
 */
export function cssTransformFor(camera, screenWidth, screenHeight) {
  const tx = screenWidth / 2;
  const ty = screenHeight / 2;
  return `translate(${tx}px, ${ty}px) scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
}

export class VideoBackdrop {
  /**
   * @param {{
   *   documentRef?: Document,
   *   invalidate?: () => void,
   *   onWarning?: (message: string) => void,
   *   clock?: () => number,
   *   setTimer?: (fn: () => void, ms: number) => any,
   *   clearTimer?: (id: any) => void
   * }} [options] `clock`/`setTimer`/`clearTimer` sont injectés par les tests : le
   *   contrôle de cadence se mesure, il ne s'attend pas.
   */
  constructor(options = {}) {
    this.documentRef = options.documentRef ?? (typeof document !== 'undefined' ? document : null);
    this.invalidate = options.invalidate ?? (() => {});
    this.onWarning = options.onWarning ?? (() => {});
    this.clock = options.clock ?? (() => Date.now());
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const id = setInterval(fn, ms);
        // `unref` n'existe que sous Node, où un intervalle actif empêche le processus de
        // sortir : sans cette ligne, `node --test` se bloquait indéfiniment. Sous
        // navigateur, `setInterval` rend un nombre et l'appel optionnel ne fait rien.
        /** @type {any} */ (id)?.unref?.();
        return id;
      });
    this.clearTimer = options.clearTimer ?? ((id) => clearInterval(id));
    /** @type {any} */
    this._stallTimer = null;
    /** @type {{ at: number, media: number }|null} */
    this._lastSample = null;
    /** @type {any} */
    this.element = null;
    /** @type {string|null} */
    this.currentUrl = null;
    /** @type {boolean} */
    this.failed = false;
    /** @type {HTMLElement|null} */
    this.container = null;
    this._autoplayWarned = false;
  }

  /**
   * Insère l'élément vidéo dans le conteneur, **avant** le canvas.
   *
   * L'ordre du DOM ne suffit pas : un canvas non positionné peint sous tout élément
   * positionné. C'est la feuille de style qui donne `z-index: 1` au canvas et `0` à la
   * vidéo (`css/gm.css`, `css/player.css`).
   *
   * @param {HTMLElement|null} container - absent en test hors DOM : on ne fait rien
   * @param {HTMLCanvasElement} canvas
   */
  attach(container, canvas) {
    if (!this.documentRef || !container) return;
    if (this.element) return;

    const video = this.documentRef.createElement('video');
    video.className = 'video-backdrop';
    // `muted` **avant** `autoplay` : c'est la condition de la politique de lecture
    // automatique. Un flux non muet est refusé sans geste utilisateur, et la carte
    // resterait figée sur l'affiche sans que rien ne l'explique.
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');

    video.addEventListener('loadeddata', () => this.invalidate());
    video.addEventListener('canplay', () => this.invalidate());
    video.addEventListener('error', () => {
      this.failed = true;
      // Masquer l'élément en échec : la couche de fond reprend la main et peint l'affiche
      // par-dessus de toute façon, mais un `<video>` cassé peut dessiner un cadre ou une
      // icône selon la plateforme, et il apparaîtrait dans les marges de la carte.
      video.style.display = 'none';
      this.onWarning(
        `Fond animé illisible (${this.currentUrl}) : repli sur l'image fixe. ` +
          `Cause probable — codec refusé ou résolution au-delà du décodeur.`
      );
      this.invalidate();
    });

    this.element = video;
    this.container = container;
    container.insertBefore(video, canvas ?? container.firstChild);
  }

  /**
   * Aligne la source vidéo sur l'étage actif.
   *
   * @param {{ videoUrl?: string|null }|null|undefined} level
   */
  sync(level) {
    const url = level?.videoUrl ?? null;
    if (url === this.currentUrl) return;

    this.currentUrl = url;
    this.failed = false;
    const video = this.element;
    if (!video) return;

    if (!url) {
      // ⚠ Vider `src` ne suffit pas à arrêter le décodage : sans `load()`, Chromium
      // garde le flux et continue de consommer batterie et mémoire vidéo après un
      // changement d'étage. Sur une séance de 4 h à plusieurs étages, c'est cumulatif.
      video.removeAttribute('src');
      if (typeof video.load === 'function') video.load();
      video.style.display = 'none';
      this._disarmStallCheck();
      this.invalidate();
      return;
    }

    video.style.display = 'block';
    video.src = url;
    if (typeof video.load === 'function') video.load();
    this._armStallCheck();
    const played = typeof video.play === 'function' ? video.play() : null;
    if (played && typeof played.catch === 'function') {
      played.catch(() => {
        // Lecture automatique refusée : l'élément affiche tout de même son image
        // courante, donc la carte reste juste — simplement fixe. On le dit une fois.
        if (this._autoplayWarned) return;
        this._autoplayWarned = true;
        this.onWarning('Lecture automatique refusée : le fond reste sur sa première image.');
      });
    }
    this.invalidate();
  }

  /**
   * Positionne et dimensionne la vidéo dans l'espace carte.
   *
   * `object-fit: contain` sur une boîte aux dimensions exactes de la carte reproduit le
   * cadrage de `BackgroundLayer.render`, qui met l'image à l'échelle par
   * `Math.min(w/sw, h/sh)` puis la centre. Laisser le navigateur le faire évite d'avoir
   * deux implantations d'une même règle de cadrage, qui divergeraient.
   *
   * @param {{ x: number, y: number, zoom: number }} camera
   * @param {number} mapWidth - largeur de la carte en pixels carte
   * @param {number} mapHeight - hauteur de la carte en pixels carte
   * @param {number} screenWidth - largeur du stage en pixels CSS
   * @param {number} screenHeight - hauteur du stage en pixels CSS
   */
  place(camera, mapWidth, mapHeight, screenWidth, screenHeight) {
    const video = this.element;
    if (!video || !this.currentUrl) return;
    const style = video.style;
    style.width = `${mapWidth}px`;
    style.height = `${mapHeight}px`;
    style.transform = cssTransformFor(camera, screenWidth, screenHeight);
  }

  /**
   * La vidéo peint-elle réellement des pixels en ce moment ?
   *
   * C'est **la** question qui décide si la couche de fond doit se taire. Répondre
   * « oui » trop tôt laisserait un trou transparent à la place de la carte.
   *
   * @returns {boolean}
   */
  get active() {
    const video = this.element;
    if (!video || !this.currentUrl || this.failed) return false;
    return (video.readyState ?? 0) >= HAVE_CURRENT_DATA;
  }

  /**
   * Arme le contrôle de cadence pour la source courante.
   *
   * Un `setInterval` à 2,5 s, pas une boucle de rendu : le coût est nul et il ne
   * réveille aucune frame tant que rien ne change.
   * @private
   */
  _armStallCheck() {
    this._disarmStallCheck();
    this._lastSample = null;
    this._stallTimer = this.setTimer(() => this._checkPlayback(), STALL_CHECK_MS);
  }

  /** @private */
  _disarmStallCheck() {
    if (this._stallTimer === null) return;
    this.clearTimer(this._stallTimer);
    this._stallTimer = null;
    this._lastSample = null;
  }

  /**
   * Compare l'avancement du flux à celui de l'horloge murale.
   *
   * ⛔ Ne jamais conclure sur un seul échantillon : le premier sert de référence. Et ne
   * rien conclure d'un flux en pause — une lecture automatique refusée est un autre cas,
   * déjà traité, et l'affiche y reste juste.
   * @private
   */
  _checkPlayback() {
    const video = this.element;
    if (!video || !this.currentUrl || this.failed) return;
    if (video.paused || video.ended) return;
    if ((video.readyState ?? 0) < HAVE_CURRENT_DATA) return;

    const now = this.clock();
    const media = video.currentTime ?? 0;
    const precedent = this._lastSample;
    this._lastSample = { at: now, media };
    if (!precedent) return;

    const ecoule = now - precedent.at;
    if (ecoule < STALL_CHECK_MS * 0.8) return;

    // La boucle repasse par zéro : `currentTime` recule. Ce n'est pas un blocage. La
    // correction est partagée avec le diagnostic, qui prétend juger par ce même critère —
    // et qui en avait recopié une version fausse.
    const avance = advanceBetween(precedent.media, media, video.duration);

    const ratio = (avance * 1000) / ecoule;
    if (ratio >= MIN_PLAYBACK_RATIO) return;

    this.failed = true;
    video.style.display = 'none';
    this._disarmStallCheck();
    this.onWarning(
      `Fond animé trop lent (${(ratio * 100).toFixed(0)} % du temps réel) : repli sur ` +
        `l'image fixe. Cause probable — résolution au-delà du décodeur matériel, donc ` +
        `décodage logiciel. Une carte nette vaut mieux qu'une animation qui rampe.`
    );
    this.invalidate();
  }

  /** Retire l'élément et libère le flux. */
  detach() {
    this._disarmStallCheck();
    const video = this.element;
    if (!video) return;
    video.removeAttribute('src');
    if (typeof video.load === 'function') video.load();
    video.remove?.();
    this.element = null;
    this.container = null;
    this.currentUrl = null;
  }
}
