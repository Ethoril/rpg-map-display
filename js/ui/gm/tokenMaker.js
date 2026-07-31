// @ts-check
import {
  createToken,
  isPersistableAssetUrl,
  isBoundedImageDataUrl,
  TOKEN_IMAGE_MAX_BYTES,
} from '../../core/schema.js';

/**
 * @typedef {import('../../core/types.js').Token} Token
 */

/**
 * @typedef {Object} TokenMakerOptions
 * @property {string|null} defaultLevelId LevelId actif à attribuer au pion généré
 * @property {(token: Token, dataUrl: string) => void} [onGenerate] Callback appelé lors de la génération
 * @property {(token: Token, dataUrl: string) => void} [onDownload] Callback appelé lors du téléchargement
 */

/**
 * Composant de création et recadrage de pion MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {TokenMakerOptions} options
 */
export function createTokenMaker(container, options) {
  if (!container) {
    throw new Error('createTokenMaker : conteneur HTML requis');
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'defaultLevelId')) {
    throw new Error('createTokenMaker : defaultLevelId est obligatoire');
  }

  // --- Structure DOM ---
  container.className = 'token-maker-container';
  container.innerHTML = `
    <div class="token-maker-ui" style="display: flex; flex-direction: column; gap: 1rem; max-width: 400px; font-family: system-ui, sans-serif;">
      <div class="token-maker-dropzone" style="border: 2px dashed #666; padding: 1rem; text-align: center; border-radius: 6px; cursor: pointer;">
        <label style="cursor: pointer; display: block;">
          <span>Déposer une image ou cliquer pour choisir</span>
          <input type="file" id="token-file-input" accept="image/*" style="display: none;" />
        </label>
      </div>

      <div class="token-maker-preview-wrap" style="position: relative; width: 300px; height: 300px; margin: 0 auto; background: #222; border-radius: 6px; overflow: hidden; touch-action: none;">
        <canvas id="token-preview-canvas" width="300" height="300" style="width: 300px; height: 300px; display: block; cursor: grab;"></canvas>
      </div>

      <div class="token-maker-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: center;">
        <label for="token-shape">Forme guide :</label>
        <select id="token-shape">
          <option value="circle">⭕ Cercle</option>
          <option value="square">▢ Carré</option>
        </select>

        <label for="token-kind">Type de pion :</label>
        <select id="token-kind">
          <option value="pc">PJ (Joueur)</option>
          <option value="npc">PNJ (Non-Joueur)</option>
        </select>

        <label for="token-border-color">Couleur bordure :</label>
        <input type="color" id="token-border-color" value="#ff0000" />

        <label for="token-size-cells">Taille (cases) :</label>
        <input type="number" id="token-size-cells" min="1" max="3" value="1" />

        <label for="token-speed-cells">Vitesse (cases) :</label>
        <input type="number" id="token-speed-cells" min="1" max="5" value="3" />

        <label for="token-label">Nom du pion :</label>
        <input type="text" id="token-label" value="Pion" />

        <label for="token-canonical-url">URL publiée :</label>
        <input type="text" id="token-canonical-url" placeholder="Vide : image embarquée dans la campagne" />
      </div>

      <p id="token-maker-status" style="margin: 0; font-size: 0.75rem; color: #aaa;">
        Sans URL publiée, l'image est embarquée dans la campagne et visible tout de suite sur la tablette.
      </p>

      <div class="token-maker-actions" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button id="btn-generate-token" style="flex: 1; min-width: 110px; padding: 0.5rem;" disabled>Générer pion</button>
        <button id="btn-download-token" style="flex: 1; min-width: 110px; padding: 0.5rem;" disabled>Télécharger pion</button>
      </div>
    </div>
  `;

  // --- Éléments du DOM ---
  const fileInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-file-input'));
  const dropzone = /** @type {HTMLElement} */ (container.querySelector('.token-maker-dropzone'));
  const previewCanvas = /** @type {HTMLCanvasElement} */ (container.querySelector('#token-preview-canvas'));
  const previewCtx = previewCanvas.getContext('2d');
  if (!previewCtx) {
    throw new Error('createTokenMaker : impossible d’obtenir le contexte 2d du canvas');
  }

  const shapeSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#token-shape'));
  const kindSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#token-kind'));
  const colorInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-border-color'));
  const sizeCellsInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-size-cells'));
  const speedCellsInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-speed-cells'));
  const labelInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-label'));
  const canonicalUrlInput = /** @type {HTMLInputElement} */ (
    container.querySelector('#token-canonical-url')
  );
  const status = /** @type {HTMLElement} */ (container.querySelector('#token-maker-status'));

  const btnGenerate = /** @type {HTMLButtonElement} */ (container.querySelector('#btn-generate-token'));
  const btnDownload = /** @type {HTMLButtonElement} */ (container.querySelector('#btn-download-token'));

  // --- État interne ---
  /** @type {HTMLImageElement|null} */
  let loadedImage = null;
  let offsetX = 0;
  let offsetY = 0;
  let scale = 1.0;

  const canvasWidth = 300;
  const canvasHeight = 300;
  const guideSize = 200; // Taille du guide de recadrage au centre du canvas
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialOffsetX = 0;
  let initialOffsetY = 0;

  // Touch pinch zoom state
  let touchPinchDist = 0;
  let initialScale = 1.0;

  /** @type {Token|null} */
  let currentToken = null;
  /** @type {string|null} */
  let currentDataUrl = null;
  /** @type {string|null} */
  let defaultLevelId = options.defaultLevelId ?? null;

  function refreshGenerateAvailability() {
    const explicitUrl = canonicalUrlInput.value.trim();
    const urlIsValid = explicitUrl === '' || isPersistableAssetUrl(explicitUrl);
    btnGenerate.disabled = !loadedImage || !defaultLevelId || !urlIsValid;

    if (!defaultLevelId) {
      status.style.color = '#f1c40f';
      status.textContent = 'Ajoutez ou sélectionnez un étage avant de générer un pion.';
    } else if (!urlIsValid) {
      status.style.color = '#e74c3c';
      status.textContent =
        'URL invalide : utilisez une URL relative ou HTTPS publiée, jamais data: ou blob:.';
    } else {
      status.style.color = '#aaa';
      status.textContent =
        "Sans URL publiée, l'image est embarquée dans la campagne et visible tout de suite " +
        'sur la tablette.';
    }
  }

  // --- Contraintes et redessin des guides ---
  function getMinScale() {
    if (!loadedImage) return 1.0;
    return guideSize / Math.min(loadedImage.width, loadedImage.height);
  }

  function clampState() {
    if (!loadedImage) return;

    const minScale = getMinScale();
    if (scale < minScale) {
      scale = minScale;
    }

    const maxScale = minScale * 10;
    if (scale > maxScale) {
      scale = maxScale;
    }

    const imgW = loadedImage.width * scale;
    const imgH = loadedImage.height * scale;

    const maxOffsetX = (imgW - guideSize) / 2;
    const maxOffsetY = (imgH - guideSize) / 2;

    offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetX));
    offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetY));
  }

  function drawPreview() {
    if (!previewCtx) return;
    previewCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (loadedImage) {
      const imgW = loadedImage.width * scale;
      const imgH = loadedImage.height * scale;
      const drawX = cx + offsetX - imgW / 2;
      const drawY = cy + offsetY - imgH / 2;

      previewCtx.drawImage(loadedImage, drawX, drawY, imgW, imgH);
    }

    // Affichage du masque et du guide au centre
    const shape = shapeSelect.value;
    const borderColor = colorInput.value;

    previewCtx.save();

    // Fond sombre semi-transparent hors du guide
    previewCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    previewCtx.beginPath();
    previewCtx.rect(0, 0, canvasWidth, canvasHeight);

    const gx = cx - guideSize / 2;
    const gy = cy - guideSize / 2;

    if (shape === 'circle') {
      previewCtx.arc(cx, cy, guideSize / 2, 0, Math.PI * 2, true);
    } else {
      // Découpe carrée sens antihoraire
      previewCtx.rect(gx + guideSize, gy, -guideSize, guideSize);
    }
    previewCtx.fill();

    // Contour du guide
    previewCtx.strokeStyle = borderColor;
    previewCtx.lineWidth = 3;
    previewCtx.beginPath();
    if (shape === 'circle') {
      previewCtx.arc(cx, cy, guideSize / 2, 0, Math.PI * 2);
    } else {
      previewCtx.rect(gx, gy, guideSize, guideSize);
    }
    previewCtx.stroke();

    previewCtx.restore();
  }

  // --- Chargement de l'image ---
  /**
   * @param {File} file
   */
  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        loadedImage = img;
        scale = getMinScale();
        offsetX = 0;
        offsetY = 0;
        clampState();
        drawPreview();
        refreshGenerateAvailability();
      };
      img.src = /** @type {string} */ (evt.target?.result);
    };
    reader.readAsDataURL(file);
  }

  // Événements d'importation
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) loadImageFile(file);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#4a90e2';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = '#666';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = '#666';
    const file = e.dataTransfer?.files[0];
    if (file) loadImageFile(file);
  });

  // --- Interaction Pan & Zoom sur le Canvas ---
  previewCanvas.addEventListener('pointerdown', (e) => {
    if (!loadedImage) return;
    previewCanvas.setPointerCapture(e.pointerId);
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialOffsetX = offsetX;
    initialOffsetY = offsetY;
    previewCanvas.style.cursor = 'grabbing';
  });

  previewCanvas.addEventListener('pointermove', (e) => {
    if (!isDragging || !loadedImage) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    offsetX = initialOffsetX + dx;
    offsetY = initialOffsetY + dy;
    clampState();
    drawPreview();
  });

  const stopDrag = (/** @type {PointerEvent} */ e) => {
    if (isDragging) {
      isDragging = false;
      try {
        previewCanvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        // Ignorer si déjà libéré
      }
      previewCanvas.style.cursor = 'grab';
    }
  };

  previewCanvas.addEventListener('pointerup', stopDrag);
  previewCanvas.addEventListener('pointercancel', stopDrag);

  previewCanvas.addEventListener('wheel', (e) => {
    if (!loadedImage) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    scale *= factor;
    clampState();
    drawPreview();
  }, { passive: false });

  // Touch gestures for pinch zoom
  previewCanvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2 && loadedImage) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchPinchDist = Math.hypot(dx, dy);
      initialScale = scale;
    }
  });

  previewCanvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && loadedImage && touchPinchDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.hypot(dx, dy);
      scale = initialScale * (newDist / touchPinchDist);
      clampState();
      drawPreview();
    }
  });

  // Changements dans le formulaire -> redessine le guide
  shapeSelect.addEventListener('change', drawPreview);
  colorInput.addEventListener('input', drawPreview);
  canonicalUrlInput.addEventListener('input', refreshGenerateAvailability);

  // Synchronisation suggestive kind <-> guide shape if desired
  kindSelect.addEventListener('change', () => {
    if (kindSelect.value === 'pc') {
      shapeSelect.value = 'circle';
    } else if (kindSelect.value === 'npc') {
      shapeSelect.value = 'square';
    }
    drawPreview();
  });

  /**
   * Encode le canevas du pion en tenant sous `TOKEN_IMAGE_MAX_BYTES`.
   *
   * Un plafond qui refuserait l'image du MJ serait une impasse en pleine séance : il
   * faut donc réduire, pas rejeter. La qualité baisse d'abord, la dimension ensuite —
   * l'ordre compte, une image un peu plus compressée reste préférable à une image
   * franchement plus petite. La réduction de dimension garantit aussi la terminaison
   * quand le navigateur ignore le paramètre de qualité, ce que fait tout repli PNG.
   *
   * @param {HTMLCanvasElement} canvas
   * @returns {{ dataUrl: string, size: number, reduced: boolean }}
   */
  function encodeWithinBudget(canvas) {
    /** @type {HTMLCanvasElement} */
    let source = canvas;
    let reduced = false;

    // 12 px est la borne basse : en dessous, l'image ne vaut plus rien comme pion, et
    // il faut s'arrêter plutôt que boucler.
    while (source.width >= 12) {
      for (const quality of [0.8, 0.7, 0.6, 0.5, 0.4]) {
        const dataUrl = source.toDataURL('image/webp', quality);
        if (dataUrl.length <= TOKEN_IMAGE_MAX_BYTES) {
          return { dataUrl, size: dataUrl.length, reduced };
        }
      }

      const half = document.createElement('canvas');
      half.width = Math.floor(source.width / 2);
      half.height = Math.floor(source.height / 2);
      const halfCtx = half.getContext('2d');
      if (!halfCtx || half.width < 12) break;
      halfCtx.drawImage(source, 0, 0, half.width, half.height);
      source = half;
      reduced = true;
    }

    const dataUrl = source.toDataURL('image/webp', 0.4);
    return { dataUrl, size: dataUrl.length, reduced };
  }

  // --- Génération du pion ---
  function generateToken() {
    if (!loadedImage) return null;
    if (!defaultLevelId) {
      throw new Error('Impossible de générer un pion sans étage actif');
    }

    const sizeCells = Math.max(1, parseInt(sizeCellsInput.value, 10) || 1);
    const speedCells = Math.max(1, parseInt(speedCellsInput.value, 10) || 3);
    const kind = /** @type {'pc'|'npc'} */ (kindSelect.value === 'npc' ? 'npc' : 'pc');
    const shape = shapeSelect.value;
    const borderColor = colorInput.value;
    const label = labelInput.value.trim() || 'Pion';

    // Dimension finale du pion : basé sur ~140px par case avec seuil minimal de 200px
    const targetSize = Math.max(200, sizeCells * 140);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetSize;
    outCanvas.height = targetSize;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;

    // Calcul de la région image source sous le guide (guideSize x guideSize)
    const srcSize = guideSize / scale;
    const srcCx = loadedImage.width / 2 - offsetX / scale;
    const srcCy = loadedImage.height / 2 - offsetY / scale;
    const srcX = srcCx - srcSize / 2;
    const srcY = srcCy - srcSize / 2;

    outCtx.save();

    // Masque de découpe selon la forme choisie
    if (shape === 'circle') {
      outCtx.beginPath();
      outCtx.arc(targetSize / 2, targetSize / 2, targetSize / 2, 0, Math.PI * 2);
      outCtx.clip();
    }

    // Dessin du morceau d'image
    outCtx.drawImage(loadedImage, srcX, srcY, srcSize, srcSize, 0, 0, targetSize, targetSize);

    // Dessin de la bordure colorée
    const borderWidth = Math.max(4, Math.round(targetSize * 0.04));
    outCtx.strokeStyle = borderColor;
    outCtx.lineWidth = borderWidth;
    outCtx.beginPath();

    if (shape === 'circle') {
      outCtx.arc(targetSize / 2, targetSize / 2, targetSize / 2 - borderWidth / 2, 0, Math.PI * 2);
    } else {
      outCtx.rect(borderWidth / 2, borderWidth / 2, targetSize - borderWidth, targetSize - borderWidth);
    }
    outCtx.stroke();

    outCtx.restore();

    // Export en WebP (ou PNG par repli du navigateur), réduit pour tenir sous le plafond
    const { dataUrl, size, reduced } = encodeWithinBudget(outCanvas);

    const tokenId = crypto.randomUUID();
    const explicitCanonicalUrl = canonicalUrlInput.value.trim();

    // Une URL explicite l'emporte : si le MJ a déjà publié le fichier, le référencer
    // vaut mieux que dupliquer ses octets dans chaque campagne. Sans URL explicite,
    // l'image est EMBARQUÉE — c'est ce qui permet au pion d'apparaître immédiatement
    // sur le Mac et sur la tablette, sans dépôt de fichier ni commit.
    let imageUrl;
    if (explicitCanonicalUrl) {
      if (!isPersistableAssetUrl(explicitCanonicalUrl)) {
        throw new Error(
          'URL du pion non persistable : utilisez une URL relative ou HTTPS publiée'
        );
      }
      imageUrl = explicitCanonicalUrl;
    } else {
      if (!isBoundedImageDataUrl(dataUrl)) {
        throw new Error(
          `Image du pion non embarquable après réduction (${size} octets pour un plafond ` +
            `de ${TOKEN_IMAGE_MAX_BYTES}). Publiez le fichier et renseignez son URL.`
        );
      }
      imageUrl = dataUrl;
    }

    const token = createToken({
      id: tokenId,
      levelId: defaultLevelId,
      cell: { a: 0, b: 0 },
      sizeCells,
      kind,
      imageUrl,
      borderColor,
      label,
      hidden: false,
      visionBright: 5,
      visionDim: 10,
      emitsLight: null,
      speedCells,
      playerMovable: kind === 'pc',
      locked: false,
      elevation: 0,
      markers: [],
    });

    currentToken = token;
    currentDataUrl = dataUrl;

    btnDownload.disabled = false;
    status.style.color = '#2ecc71';
    if (explicitCanonicalUrl) {
      status.textContent = `Pion ajouté. Il référence ${explicitCanonicalUrl} : publiez ce fichier.`;
    } else {
      const ko = (size / 1024).toFixed(1);
      status.textContent =
        `Pion ajouté, image embarquée (${ko} Ko` +
        `${reduced ? ', réduite pour tenir sous le plafond' : ''}). Visible immédiatement ` +
        'sur la tablette, aucun fichier à déposer.';
    }

    if (options.onGenerate) {
      options.onGenerate(token, dataUrl);
    }

    return { token, dataUrl };
  }

  btnGenerate.addEventListener('click', () => {
    generateToken();
  });

  // --- Téléchargement du pion ---
  function downloadToken() {
    if (!currentDataUrl || !currentToken) return;

    const link = document.createElement('a');
    link.download = `token-${currentToken.id}.webp`;
    link.href = currentDataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (options.onDownload) {
      options.onDownload(currentToken, currentDataUrl);
    }
  }

  btnDownload.addEventListener('click', () => {
    downloadToken();
  });

  // L'action « Copier l'entrée JSON » a été retirée au chantier M.
  //
  // Elle produisait une entrée portant `imageUrl: "maps/tokens/<slug>.webp"`, un fichier
  // qui n'existait pas : le générateur ne dépose le WebP que dans le dossier de
  // téléchargement du MJ. Le correctif du 30/07 a embarqué l'image dans le pion pour
  // régler le cas de la table — mais le catalogue de pions refuse les `data:`, donc
  // l'entrée copiée restait inutilisable. Les deux mécanismes s'excluaient.
  //
  // La bibliothèque se remplit désormais par l'outil local, qui écrit l'image ET
  // l'entrée : « Télécharger pion » ici, puis choisir le fichier dans `prepare.html`.
  // Aucun test n'exerçait ce bouton — d'où son passage à l'inopérant en silence.

  // Rendu initial (vide)
  drawPreview();
  refreshGenerateAvailability();

  return {
    loadImageFile,
    generateToken,
    downloadToken,
    getCurrentToken: () => currentToken,
    getCurrentDataUrl: () => currentDataUrl,
    /**
     * Met à jour l'étage cible. Une valeur null désactive la génération.
     * @param {string|null} levelId
     */
    setDefaultLevelId: (levelId) => {
      defaultLevelId = levelId;
      refreshGenerateAvailability();
    },
    setShape: (/** @type {string} */ shape) => {
      shapeSelect.value = shape;
      drawPreview();
    },
    setKind: (/** @type {string} */ kind) => {
      kindSelect.value = kind;
      drawPreview();
    },
    setBorderColor: (/** @type {string} */ color) => {
      colorInput.value = color;
      drawPreview();
    },
    setSizeCells: (/** @type {number} */ size) => {
      sizeCellsInput.value = String(size);
    },
    setSpeedCells: (/** @type {number} */ speed) => {
      speedCellsInput.value = String(speed);
    },
    setLabel: (/** @type {string} */ label) => {
      labelInput.value = label;
    },
  };
}
