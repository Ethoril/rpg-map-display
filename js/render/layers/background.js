// @ts-check

const BACKGROUND_CACHE_LIMIT = 8;
const THUMBNAIL_MAX_DIM = 1024;
const WARM_THRESHOLD_MS = 4000;

/**
 * Nombre de doublures conservées, et c'est une contrainte de **mémoire**, pas de cache.
 *
 * Une doublure de 1024 px fait ~3,9 Mio décodés. Le cache d'images en garde huit entrées : y
 * attacher une doublure par entrée retiendrait ~31 Mio, alors que le critère 5 du chantier P plafonne
 * à 8 Mio. Deux doublures font 7,8 Mio, et deux suffisent — l'étage courant et celui d'où l'on
 * vient. Au-delà, l'`ImageBitmap` est **fermé** : il tient de la mémoire hors tas que le ramasse-
 * miettes ne rendra pas de lui-même.
 */
const THUMBNAIL_KEEP = 2;

/**
 * Sentinelles de `decodedAt`, et le choix de `-Infinity` n'est pas une coquetterie.
 *
 * `0` semblait dire « jamais décodée », mais l'horloge est **monotone** : `performance.now()` vaut
 * quelques centaines de millisecondes juste après le chargement de la page, donc `now - 0` reste
 * sous le seuil de chaleur pendant les quatre premières secondes de vie de l'onglet. Une carte
 * ouverte tôt était donc présumée chaude et repayait le décodage synchrone de 484 ms — le défaut
 * qu'on corrige, revenu par la sentinelle, et de façon non déterministe puisqu'il dépend de la
 * vitesse de démarrage. `-Infinity` ne peut être récent sous aucune horloge.
 */
const JAMAIS_DECODEE = -Infinity;
/** Chaude en permanence : image locale déjà en mémoire, il n'y a rien à redécoder. */
const TOUJOURS_CHAUDE = Infinity;

/**
 * @typedef {'idle'|'loading'|'ready'|'error'} BackgroundStatus
 * @typedef {{
 *   status: 'loading'|'ready'|'error',
 *   image: HTMLImageElement|null,
 *   thumbnail: ImageBitmap|null,
 *   decodedAt: number,
 *   decodePending: boolean,
 *   decodeUnusable: boolean,
 *   error: Error|null,
 *   promise: Promise<HTMLImageElement>
 * }} CacheEntry
 */

/** @type {Map<string, CacheEntry>} */
const imageCache = new Map();

/** @param {CacheEntry|null|undefined} entry */
function releaseThumbnail(entry) {
  if (!entry || !entry.thumbnail) return;
  if (typeof entry.thumbnail.close === 'function') entry.thumbnail.close();
  entry.thumbnail = null;
}

/** @param {string} url @param {CacheEntry} entry */
function remember(url, entry) {
  imageCache.delete(url);
  imageCache.set(url, entry);
  while (imageCache.size > BACKGROUND_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    // Garde-fou et non chemin d'exécution : tant que `THUMBNAIL_KEEP` est inférieur à
    // `BACKGROUND_CACHE_LIMIT`, l'élagage ci-dessous a déjà fermé la doublure d'une entrée bien
    // avant qu'elle puisse être évincée. Cette ligne n'existe que pour le jour où l'un des deux
    // plafonds bougera — aucun test ne l'atteint, et c'est normal.
    releaseThumbnail(imageCache.get(oldest));
    imageCache.delete(oldest);
  }

  // Les doublures des entrées les plus anciennes sont libérées même quand l'entrée reste en cache :
  // c'est le budget mémoire de `THUMBNAIL_KEEP`, pas la taille du cache, qui décide. Une entrée sans
  // doublure reste parfaitement utilisable — elle repasse simplement par le fond neutre le temps
  // d'un décodage.
  const urls = [...imageCache.keys()];
  for (let i = 0; i < urls.length - THUMBNAIL_KEEP; i++) {
    releaseThumbnail(imageCache.get(urls[i]));
  }
}

/** @param {unknown} value @returns {Error} */
function asError(value) {
  return value instanceof Error ? value : new Error('Impossible de charger l’image de fond');
}

/**
 * Génère de manière asynchrone une doublure basse résolution (ImageBitmap <= 1024px)
 * stockée à côté de l'entrée de cache partagée.
 *
 * @param {HTMLImageElement} image
 * @param {CacheEntry} entry
 */
function createThumbnailAsync(image, entry) {
  if (typeof createImageBitmap !== 'function') return;
  const srcW = image.naturalWidth || image.width || 0;
  const srcH = image.naturalHeight || image.height || 0;
  if (srcW <= 0 || srcH <= 0) return;

  let resizeW = srcW;
  let resizeH = srcH;
  if (Math.max(srcW, srcH) > THUMBNAIL_MAX_DIM) {
    if (srcW >= srcH) {
      resizeW = THUMBNAIL_MAX_DIM;
      resizeH = Math.round((srcH / srcW) * THUMBNAIL_MAX_DIM);
    } else {
      resizeH = THUMBNAIL_MAX_DIM;
      resizeW = Math.round((srcW / srcH) * THUMBNAIL_MAX_DIM);
    }
  }

  createImageBitmap(image, { resizeWidth: resizeW, resizeHeight: resizeH })
    .then((bitmap) => {
      entry.thumbnail = bitmap;
    })
    .catch(() => {
      entry.thumbnail = null;
    });
}

/**
 * Fond de carte Canvas avec état explicite, cache LRU par URL, doublure basse résolution
 * et décodage asynchrone hors du chemin critique de rendu (Chantier P).
 */
export class BackgroundLayer {
  /**
   * @param {{
   *   invalidate?: () => void,
   *   imageFactory?: () => HTMLImageElement,
   *   clock?: () => number
   * }} [options]
   */
  constructor(options = {}) {
    this.invalidate = options.invalidate ?? (() => {});
    this.imageFactory = options.imageFactory ?? (() => new Image());
    // ⛔ L'horloge appartient à la couche, et `render` n'en accepte AUCUNE en paramètre.
    //
    // La chaleur d'un bitmap est une **durée**, donc elle se mesure sur une horloge monotone.
    // `renderAll` passe déjà un `now: Date.now()` aux couches portes et pions — pour comparer avec
    // des horodatages venus du réseau, ce qui est un autre besoin. Accepter un `now` ici, en
    // écrivant `decodedAt` sur `performance.now()`, laissait une mine amorcée : un appelant qui
    // suivait la convention des autres couches injectait un écart de 1,7 × 10¹², l'état passait
    // froid en permanence, et la carte restait floue en bouclant à 60 fps. La seule façon de rendre
    // la faute impossible plutôt que déconseillée est de ne pas offrir le paramètre.
    // Les tests injectent l'horloge ici, une fois, ce qui garantit qu'elle est la même partout.
    this.clock =
      options.clock ??
      (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    /** @type {BackgroundStatus} */
    this.status = 'idle';
    /** @type {string|null} */
    this.currentUrl = null;
    /** @type {HTMLImageElement|null} */
    this.image = null;
    /** @type {Error|null} */
    this.error = null;
    /** @type {Promise<void>} */
    this.pending = Promise.resolve();
    this.loadVersion = 0;
    /** @type {CacheEntry|null} */
    this.localEntry = null;
  }

  /**
   * @param {string|null|undefined} imageUrl
   * @param {{ retry?: boolean }} [options]
   * @returns {Promise<void>}
   */
  load(imageUrl, options = {}) {
    const url = imageUrl?.trim() ?? '';
    if (!url) {
      this.loadVersion++;
      this.currentUrl = null;
      this.image = null;
      this.error = null;
      this.status = 'idle';
      this.localEntry = null;
      this.pending = Promise.resolve();
      return this.pending;
    }

    if (
      !options.retry &&
      this.currentUrl === url &&
      (this.status === 'loading' || this.status === 'ready' || this.status === 'error')
    ) {
      return this.pending;
    }

    const version = ++this.loadVersion;
    this.currentUrl = url;
    this.image = null;
    this.error = null;
    this.status = 'loading';
    this.localEntry = null;

    if (options.retry) imageCache.delete(url);
    let entry = imageCache.get(url);
    if (entry?.status === 'error' && !options.retry) {
      this.status = 'error';
      this.error = entry.error;
      this.pending = Promise.resolve();
      remember(url, entry);
      return this.pending;
    }
    if (!entry || entry.status === 'error') {
      const image = this.imageFactory();
      /** @type {CacheEntry} */
      const nextEntry = {
        status: 'loading',
        image: null,
        thumbnail: null,
        decodedAt: JAMAIS_DECODEE,
        decodePending: false,
        decodeUnusable: false,
        error: null,
        promise: Promise.resolve(image),
      };
      nextEntry.promise = new Promise((resolve, reject) => {
        image.onload = () => {
          nextEntry.status = 'ready';
          nextEntry.image = image;
          // ⛔ `decodedAt` reste à 0, donc l'image est FROIDE au premier rendu, et c'est le point.
          // `onload` dit que l'image est *chargée*, pas que ses pixels sont *décodés* — c'est le
          // mensonge dont tout le défaut découle. La mesure du chantier N l'a chiffré : la première
          // frame qui peint réellement la carte coûtait 484 ms, autant qu'une frame post-inactivité.
          // Déclarer l'image chaude ici conserverait ce gel-là intact.
          remember(url, nextEntry);
          createThumbnailAsync(image, nextEntry);
          resolve(image);
        };
        image.onerror = (event) => {
          const error = asError(event);
          nextEntry.status = 'error';
          nextEntry.error = error;
          remember(url, nextEntry);
          reject(error);
        };
        image.src = url;
      });
      // Évite un rejet non observé entre la création et l'abonnement ci-dessous.
      nextEntry.promise.catch(() => {});
      entry = nextEntry;
      remember(url, entry);
    } else {
      remember(url, entry);
    }

    if (entry.status === 'ready' && entry.image) {
      this.image = entry.image;
      this.status = 'ready';
      this.pending = Promise.resolve();
      return this.pending;
    }

    this.pending = entry.promise.then(
      (image) => {
        if (this.loadVersion !== version || this.currentUrl !== url) return;
        this.image = image;
        this.error = null;
        this.status = 'ready';
        this.invalidate();
      },
      (reason) => {
        if (this.loadVersion !== version || this.currentUrl !== url) return;
        this.image = null;
        this.error = asError(reason);
        this.status = 'error';
        this.invalidate();
      }
    );
    return this.pending;
  }

  /** @returns {Promise<void>} */
  retry() {
    if (!this.currentUrl) return Promise.resolve();
    return this.load(this.currentUrl, { retry: true });
  }

  /**
   * Installe une image locale transitoire sans la placer dans le cache partagé.
   *
   * Déclarée **chaude en permanence** et sans doublure : ce sont des images locales et petites,
   * déjà en mémoire, pour l'outil de préparation et la calibration. Aucun chemin ne doit y décoder
   * en synchrone, et il n'y a rien à redécoder.
   *
   * @param {HTMLImageElement} image
   * @param {string} [url]
   */
  setImage(image, url = '') {
    this.loadVersion++;
    this.currentUrl = url || image.currentSrc || image.src || null;
    this.image = image;
    this.error = null;
    this.status = 'ready';
    this.localEntry = {
      status: 'ready',
      image,
      thumbnail: null,
      decodedAt: TOUJOURS_CHAUDE,
      decodePending: false,
      decodeUnusable: true,
      error: null,
      promise: Promise.resolve(image),
    };
    this.pending = Promise.resolve();
    this.invalidate();
  }

  /**
   * Domicile de la chaleur pour l'image courante.
   *
   * L'état (`decodedAt`, `decodePending`, doublure) appartient à l'**image décodée**, donc à
   * l'entrée de cache : partagée par URL, elle fait qu'une vue qui garde le fond chaud le garde
   * chaud pour l'autre vue du même onglet.
   *
   * Il faut malgré tout un repli d'instance, et il n'est pas théorique : le cache n'a que huit
   * entrées, et l'entrée de l'image affichée peut en être évincée alors que l'instance tient encore
   * son `HTMLImageElement`. Sans domicile de repli, `render` n'aurait aucun endroit où retenir la
   * chaleur ; et présumer chaud faute d'entrée ramènerait le gel de 490 ms **en silence**.
   *
   * @returns {CacheEntry|null}
   * @private
   */
  _warmthEntry() {
    if (!this.image) return null;
    if (this.currentUrl) {
      const cached = imageCache.get(this.currentUrl);
      if (cached && cached.image === this.image) return cached;
    }
    if (!this.localEntry || this.localEntry.image !== this.image) {
      this.localEntry = {
        status: 'ready',
        image: this.image,
        thumbnail: null,
        decodedAt: JAMAIS_DECODEE,
        decodePending: false,
        decodeUnusable: false,
        error: null,
        promise: Promise.resolve(this.image),
      };
    }
    return this.localEntry;
  }

  /**
   * Rendu du fond avec machine à états pour le décodage asynchrone (Chantier P).
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width Largeur de la carte en pixels carte
   * @param {number} height Hauteur de la carte en pixels carte
   * @param {{
   *   role?: 'gm'|'players',
   *   neutralColor?: string,
   *   suppressed?: boolean
   * }} [options] `suppressed` : un fond animé peint sous le canvas, cette couche doit
   *   alors ne rien dessiner (voir `js/render/videoBackdrop.js`).
   */
  render(ctx, width, height, options = {}) {
    if (!ctx || width <= 0 || height <= 0) return;

    // ⭐ Un fond animé peint **sous** le canvas (`js/render/videoBackdrop.js`). Cette
    // couche doit alors ne rien dessiner du tout — **pas même le fond neutre**, qui
    // masquerait la vidéo puisque le canvas est au-dessus.
    //
    // L'appelant ne passe `suppressed` que lorsque la vidéo a des pixels décodés. Tant
    // qu'elle n'en a pas, on repasse ici et l'affiche est peinte : c'est ce qui rend le
    // repli automatique plutôt qu'écrit à la main.
    if (options.suppressed) return;

    const now = this.clock();

    ctx.save();
    ctx.fillStyle = options.neutralColor ?? '#34383f';
    ctx.fillRect(0, 0, width, height);

    if (this.status === 'ready' && this.image) {
      const sourceWidth = this.image.naturalWidth || this.image.width;
      const sourceHeight = this.image.naturalHeight || this.image.height;
      if (sourceWidth > 0 && sourceHeight > 0) {
        const scale = Math.min(width / sourceWidth, height / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        const drawX = (width - drawWidth) / 2;
        const drawY = (height - drawHeight) / 2;

        const entry = this._warmthEntry();
        // Pas d'entrée : impossible, `_warmthEntry` en fabrique une dès qu'il y a une image. Le test
        // reste pour que la lecture du type ne suggère pas un chemin « présumé chaud » — il n'y en a
        // aucun, parce qu'un tel chemin ramènerait le gel sans que rien ne le signale.
        const isWarm =
          !entry || entry.decodeUnusable || now - entry.decodedAt < WARM_THRESHOLD_MS;

        if (isWarm) {
          ctx.drawImage(this.image, drawX, drawY, drawWidth, drawHeight);
          // Une peinture pleine taille réussie repousse l'échéance : pendant l'interaction continue,
          // l'état ne redevient jamais froid, donc la doublure n'apparaît jamais.
          if (entry && entry.decodedAt !== TOUJOURS_CHAUDE) entry.decodedAt = now;
        } else {
          // Chemin froid. La doublure si elle existe, sinon le fond neutre déjà peint — jamais un
          // `drawImage` de l'image pleine taille, qui est précisément ce qui décode en synchrone.
          if (entry.thumbnail) {
            ctx.drawImage(entry.thumbnail, drawX, drawY, drawWidth, drawHeight);
          }

          if (!entry.decodePending) {
            entry.decodePending = true;
            const image = this.image;
            // ⭐ L'horloge est relue **à la résolution**, jamais celle de cette frame-ci. Avec le
            // `now` capturé, un décodage plus long que WARM_THRESHOLD_MS — 245 Mio sur la tablette,
            // ce n'est pas une hypothèse d'école — laissait l'état froid à la frame suivante, qui
            // relançait un décodage : la boucle infinie que le §4.4 du brief interdit.
            const settle = () => {
              entry.decodedAt = this.clock();
              entry.decodePending = false;
              this.invalidate();
            };
            if (typeof image.decode === 'function') {
              image.decode().then(settle, () => {
                // Un décodage en échec ne rend PAS l'image chaude — sinon la frame suivante la
                // repeindrait en pleine taille et en synchrone, ramenant le gel par le chemin
                // d'erreur. Mais il ne doit pas non plus être retenté à chaque frame : on renonce
                // à `decode()` pour cette image et on repasse au comportement d'avant le chantier,
                // qui est mauvais mais borné. Une seule invalidation, aucune boucle.
                entry.decodeUnusable = true;
                entry.decodePending = false;
                this.invalidate();
              });
            } else {
              // Navigateur sans `decode()`, ou objet-image de test : même renoncement explicite.
              entry.decodeUnusable = true;
              entry.decodePending = false;
              this.invalidate();
            }
          }
        }
      }
    } else if (this.status === 'error' && options.role === 'gm') {
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Carte indisponible — réessayez le chargement', width / 2, height / 2);
    }
    ctx.restore();
  }
}
