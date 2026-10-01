// @ts-check

import { identifiantAleatoire } from '../../core/schema.js';
import { SHARED_IMAGE_MAX_PX, SHARED_IMAGE_MAX_BYTES } from '../../core/constants.js';

/** @typedef {import('../../transport/Transport.js').Transport} Transport */
/** @typedef {import('../../core/types.js').SharedImage} SharedImage */

/**
 * Options d'initialisation du partage d'image MJ.
 * @typedef {Object} ImageShareOptions
 * @property {Transport} [transport]
 */

/** Qualités essayées, dans l'ordre, avant de réduire de moitié. */
const QUALITES = [0.82, 0.7, 0.6, 0.5];

/**
 * Décode un fichier image local. ⚠ L'URL `blob:` ne sert qu'au décodage, sur ce poste : elle est
 * révoquée aussitôt et ne part jamais sur le réseau.
 *
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
async function decoderFichier(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new Error('dimensions illisibles');
    }
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Encode un canevas en WebP. Un navigateur qui ne sait pas encoder le WebP rend du PNG à la place,
 * sans qualité réglable — il passe alors au JPEG, qui en a une.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} qualite
 * @returns {string}
 */
function encoder(canvas, qualite) {
  const webp = canvas.toDataURL('image/webp', qualite);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', qualite);
}

/**
 * Réduit une image au format TV, sous `SHARED_IMAGE_MAX_BYTES` : le plus grand côté ramené à
 * `SHARED_IMAGE_MAX_PX` (jamais agrandi), puis la qualité baissée, puis la taille divisée par deux —
 * même démarche que `encodeWithinBudget` de `ui/gm/tokenMaker.js`.
 *
 * @param {File} file
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function reduireImage(file) {
  const img = await decoderFichier(file);
  const echelle = Math.min(1, SHARED_IMAGE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));

  let canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * echelle));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * echelle));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canevas indisponible');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (;;) {
    for (const qualite of QUALITES) {
      const dataUrl = encoder(canvas, qualite);
      if (dataUrl.length <= SHARED_IMAGE_MAX_BYTES) {
        return { dataUrl, width: canvas.width, height: canvas.height };
      }
    }
    if (canvas.width < 32 || canvas.height < 32) {
      throw new Error('impossible de la réduire sous le plafond de transfert');
    }
    const moitie = document.createElement('canvas');
    moitie.width = Math.floor(canvas.width / 2);
    moitie.height = Math.floor(canvas.height / 2);
    const moitieCtx = moitie.getContext('2d');
    if (!moitieCtx) throw new Error('canevas indisponible');
    moitieCtx.drawImage(canvas, 0, 0, moitie.width, moitie.height);
    canvas = moitie;
  }
}

/**
 * Crée et monte le partage d'image du MJ — chantier C-13.
 *
 * Le MJ choisit un fichier sur son poste ; l'image est réduite au format TV puis écrite dans le nœud
 * d'état de la session, d'où la vue joueurs l'affiche en grand. ⛔ **Rien n'est enregistré** : ni
 * campagne, ni Firestore, ni localStorage. Une image fermée — par le MJ ou par la croix des
 * joueurs — n'existe plus nulle part.
 *
 * ⭐ Ce panneau ne suppose rien : il **affiche ce que dit le nœud**. C'est ce qui lui fait voir une
 * fermeture par les joueurs, et retrouver l'image affichée après un F5 du MJ.
 *
 * @param {HTMLElement} mount Élément DOM d'ancrage
 * @param {ImageShareOptions} [options]
 * @returns {{ destroy: () => void }}
 */
export function createImageShare(mount, options = {}) {
  if (!mount) {
    throw new Error('createImageShare : élément d\'ancrage requis');
  }

  const { transport } = options;
  const listeners = new AbortController();

  mount.innerHTML = `
    <div class="image-share gm-stack">
      <h3 class="gm-h">Partage d'image</h3>
      <p class="gm-hint">Montre une image en grand sur l'écran des joueurs. Elle n'est enregistrée nulle part.</p>

      <input type="file" id="image-share-file" accept="image/*" hidden />
      <button type="button" id="image-share-choose" class="gm-btn--primary">Choisir une image…</button>

      <div id="image-share-error" class="gm-status gm-err" hidden></div>

      <div id="image-share-current" class="gm-stack" hidden>
        <img id="image-share-preview" class="image-share-preview" alt="Image partagée" />
        <span id="image-share-size" class="gm-muted"></span>
        <span class="gm-status gm-ok">Affichée sur l'écran des joueurs</span>
        <button type="button" id="image-share-close" class="gm-btn--danger gm-btn--sm">Fermer l'image</button>
      </div>

      <div id="image-share-status" class="gm-status gm-muted"></div>
    </div>
  `;

  const fileInput = /** @type {HTMLInputElement} */ (mount.querySelector('#image-share-file'));
  const chooseBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#image-share-choose'));
  const errorEl = /** @type {HTMLElement} */ (mount.querySelector('#image-share-error'));
  const currentEl = /** @type {HTMLElement} */ (mount.querySelector('#image-share-current'));
  const previewEl = /** @type {HTMLImageElement} */ (mount.querySelector('#image-share-preview'));
  const sizeEl = /** @type {HTMLElement} */ (mount.querySelector('#image-share-size'));
  const closeBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#image-share-close'));
  const statusEl = /** @type {HTMLElement} */ (mount.querySelector('#image-share-status'));

  /**
   * Dernière valeur lue dans le nœud.
   * @type {SharedImage|null}
   */
  let affichee = null;
  /**
   * Identifiant de la dernière image que **ce MJ** a fermée. Une image qui disparaît du nœud sans
   * porter cet identifiant a été fermée par quelqu'un d'autre : la croix des joueurs.
   * @type {string|null}
   */
  let fermeeParLeMJ = null;

  /** @param {string} message */
  function montrerErreur(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function effacerErreur() {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  /** @param {SharedImage|null} image */
  function surNoeud(image) {
    const precedente = affichee;
    affichee = image;

    if (image) {
      if (previewEl.getAttribute('src') !== image.dataUrl) previewEl.src = image.dataUrl;
      sizeEl.textContent = `${image.width} × ${image.height}`;
      currentEl.hidden = false;
      statusEl.textContent = '';
      return;
    }

    currentEl.hidden = true;
    previewEl.removeAttribute('src');
    sizeEl.textContent = '';
    statusEl.textContent =
      precedente && precedente.id !== fermeeParLeMJ ? 'Fermée par les joueurs.' : '';
  }

  /** @param {File} file */
  async function partager(file) {
    effacerErreur();
    if (!transport || typeof transport.shareImage !== 'function') {
      montrerErreur('Partage impossible : aucune session connectée.');
      return;
    }

    chooseBtn.disabled = true;
    statusEl.textContent = 'Préparation de l\'image…';
    try {
      /** @type {{dataUrl: string, width: number, height: number}} */
      let reduite;
      try {
        reduite = await reduireImage(file);
      } catch (err) {
        statusEl.textContent = '';
        montrerErreur(
          `« ${file.name} » n'a pas pu être lue comme une image (${
            err instanceof Error ? err.message : String(err)
          }). Rien n'a été envoyé aux joueurs.`
        );
        return;
      }

      const resultat = await transport.shareImage({
        id: `image-${identifiantAleatoire()}`,
        dataUrl: reduite.dataUrl,
        width: reduite.width,
        height: reduite.height,
        at: Date.now(),
      });
      if (!resultat.ok) {
        statusEl.textContent = '';
        montrerErreur(`Partage impossible : ${resultat.error.message}`);
        return;
      }
      // Le nœud rappelle `surNoeud`, qui efface cette ligne. Si le rappel est déjà passé, elle ne
      // doit pas rester affichée pour autant.
      if (statusEl.textContent === 'Préparation de l\'image…') statusEl.textContent = '';
    } finally {
      chooseBtn.disabled = false;
    }
  }

  chooseBtn.addEventListener('click', () => fileInput.click(), { signal: listeners.signal });

  fileInput.addEventListener(
    'change',
    () => {
      const file = fileInput.files?.[0];
      // Vidé tout de suite : choisir deux fois le même fichier doit le repartager.
      fileInput.value = '';
      if (file) void partager(file);
    },
    { signal: listeners.signal }
  );

  closeBtn.addEventListener(
    'click',
    async () => {
      effacerErreur();
      if (!affichee || !transport || typeof transport.closeSharedImage !== 'function') return;
      fermeeParLeMJ = affichee.id;
      const resultat = await transport.closeSharedImage(affichee.id);
      if (!resultat.ok) {
        montrerErreur(`Fermeture impossible : ${resultat.error.message}`);
      }
    },
    { signal: listeners.signal }
  );

  const unsubscribe =
    transport && typeof transport.subscribeSharedImage === 'function'
      ? transport.subscribeSharedImage(surNoeud)
      : () => {};

  return {
    destroy: () => {
      listeners.abort();
      unsubscribe();
      mount.replaceChildren();
    },
  };
}
