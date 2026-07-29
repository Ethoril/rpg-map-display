// @ts-check
import { parseUvtt } from '../../import/uvtt.js';
import { calibrateFromRect } from '../../import/imageCalibrate.js';
import { createLevel, isPersistableAssetUrl } from '../../core/schema.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../core/types.js').Level} Level
 */

/**
 * Options d'initialisation du panneau d'importation.
 * @typedef {Object} ImportPanelOptions
 * @property {'uvtt'|'image'|'both'} [mode='both']
 * @property {(result: ReturnType<typeof parseUvtt>) => void} [onImportUvtt]
 * @property {(level: Level) => void} [onImportImage]
 */

/**
 * Crée les assistants d'importation (UVTT et Image calibrée).
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {ImportPanelOptions} [options]
 */
export function createImportPanel(container, options = {}) {
  if (!container) {
    throw new Error('createImportPanel : conteneur HTML requis');
  }

  const mode = options.mode || 'both';

  const showUvtt = mode === 'uvtt' || mode === 'both';
  const showImage = mode === 'image' || mode === 'both';

  container.className = 'import-panel-container';
  container.innerHTML = `
    <div class="import-panel-ui" style="display: flex; flex-direction: column; gap: 1.5rem; font-family: system-ui, sans-serif;">
      ${
        showUvtt
          ? `
      <!-- Section 1 : Importation UVTT -->
      <div class="import-uvtt-section" style="background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Importation UVTT (.uvtt / .json)</h3>
        <p style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: #aaa;">
          Charge une carte exportée depuis Dungeondraft avec murs, portails et lumières.
        </p>

        <label style="display: inline-block; padding: 0.5rem 1rem; background: #333; color: #fff; border-radius: 4px; cursor: pointer; text-align: center;">
          <span>Choisir un fichier .uvtt</span>
          <input type="file" id="uvtt-file-input" accept=".uvtt,.json" style="display: none;" />
        </label>

        <div id="uvtt-preview-wrap" style="display: none; margin-top: 0.75rem;">
          <img id="uvtt-local-preview" alt="Aperçu local de la carte UVTT" style="display: block; width: 100%; max-height: 180px; object-fit: contain; background: #111; border-radius: 4px;" />
        </div>

        <label for="uvtt-canonical-url" style="display: block; margin-top: 0.75rem; font-size: 0.85rem;">
          URL publiée de l'image :
        </label>
        <input id="uvtt-canonical-url" type="text" placeholder="maps/ma-carte.webp" style="box-sizing: border-box; width: 100%; margin-top: 0.25rem;" />
        <p style="margin: 0.35rem 0 0.75rem; font-size: 0.75rem; color: #aaa;">
          L'image intégrée sert uniquement d'aperçu local. Préparez le WebP avec le CLI,
          publiez-le dans maps/, puis indiquez son URL ici.
        </p>
        <button id="btn-validate-uvtt-import" style="width: 100%; padding: 0.5rem; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;" disabled>
          Ajouter l'étage publié
        </button>

        <div id="uvtt-status" style="margin-top: 0.75rem; font-size: 0.85rem; display: none;"></div>
      </div>
      `
          : ''
      }

      ${
        showImage
          ? `
      <!-- Section 2 : Importation Image avec Calibration -->
      <div class="import-image-section" style="background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Importation Image + Calibration</h3>
        <p style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: #aaa;">
          Charge une image classique (JPG/PNG) et définis ses dimensions en cases.
        </p>

        <label style="display: inline-block; padding: 0.5rem 1rem; background: #333; color: #fff; border-radius: 4px; cursor: pointer; text-align: center; margin-bottom: 0.75rem;">
          <span>Choisir une image (JPG / PNG)</span>
          <input type="file" id="image-file-input" accept="image/*" style="display: none;" />
        </label>

        <div class="calibration-controls" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.75rem; align-items: center;">
          <label for="img-cells-wide">Cases (largeur) :</label>
          <input type="number" id="img-cells-wide" min="1" max="200" value="20" />

          <label for="img-cells-tall">Cases (hauteur) :</label>
          <input type="number" id="img-cells-tall" min="1" max="200" value="15" />

          <label for="img-px-per-cell">Pixels / case :</label>
          <input type="number" id="img-px-per-cell" min="10" max="500" value="140" />
        </div>

        <div class="image-preview-wrap" style="position: relative; width: 100%; height: 180px; background: #111; border-radius: 4px; overflow: hidden; margin-bottom: 0.75rem;">
          <canvas id="image-calibration-canvas" width="300" height="180" style="width: 100%; height: 100%; display: block;"></canvas>
        </div>

        <label for="image-canonical-url" style="display: block; font-size: 0.85rem;">
          URL publiée de l'image :
        </label>
        <input id="image-canonical-url" type="text" placeholder="maps/ma-carte.webp" style="box-sizing: border-box; width: 100%; margin: 0.25rem 0 0.35rem;" />
        <p style="margin: 0 0 0.75rem; font-size: 0.75rem; color: #aaa;">
          Le fichier choisi reste un aperçu local. Placez l'image dans maps/ et indiquez
          son URL publiée avant de créer l'étage partagé.
        </p>

        <button id="btn-validate-image-import" style="width: 100%; padding: 0.5rem; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;" disabled>
          Valider l'importation d'image
        </button>

        <div id="image-status" style="margin-top: 0.75rem; font-size: 0.85rem; display: none;"></div>
      </div>
      `
          : ''
      }
    </div>
  `;

  // --- Éléments du DOM ---
  const uvttInput = /** @type {HTMLInputElement|null} */ (container.querySelector('#uvtt-file-input'));
  const uvttStatus = /** @type {HTMLElement|null} */ (container.querySelector('#uvtt-status'));
  const uvttCanonicalUrl = /** @type {HTMLInputElement|null} */ (
    container.querySelector('#uvtt-canonical-url')
  );
  const uvttPreviewWrap = /** @type {HTMLElement|null} */ (
    container.querySelector('#uvtt-preview-wrap')
  );
  const uvttPreview = /** @type {HTMLImageElement|null} */ (
    container.querySelector('#uvtt-local-preview')
  );
  const btnValidateUvtt = /** @type {HTMLButtonElement|null} */ (
    container.querySelector('#btn-validate-uvtt-import')
  );

  const imageInput = /** @type {HTMLInputElement|null} */ (container.querySelector('#image-file-input'));
  const imageCanonicalUrl = /** @type {HTMLInputElement|null} */ (
    container.querySelector('#image-canonical-url')
  );
  const cellsWideInput = /** @type {HTMLInputElement|null} */ (container.querySelector('#img-cells-wide'));
  const cellsTallInput = /** @type {HTMLInputElement|null} */ (container.querySelector('#img-cells-tall'));
  const pxPerCellInput = /** @type {HTMLInputElement|null} */ (container.querySelector('#img-px-per-cell'));
  const calibCanvas = /** @type {HTMLCanvasElement|null} */ (container.querySelector('#image-calibration-canvas'));
  const calibCtx = calibCanvas ? calibCanvas.getContext('2d') : null;
  const btnValidateImage = /** @type {HTMLButtonElement|null} */ (container.querySelector('#btn-validate-image-import'));
  const imageStatus = /** @type {HTMLElement|null} */ (container.querySelector('#image-status'));

  /** @type {HTMLImageElement|null} */
  let loadedCalibImage = null;
  /** @type {string|null} */
  let loadedImageDataUrl = null;
  /** @type {ReturnType<typeof parseUvtt>|null} */
  let pendingUvtt = null;

  /**
   * @param {HTMLInputElement|null} input
   */
  function hasCanonicalUrl(input) {
    const value = input?.value.trim() ?? '';
    return value !== '' && isPersistableAssetUrl(value);
  }

  function refreshUvttButton() {
    if (btnValidateUvtt) {
      btnValidateUvtt.disabled = !pendingUvtt || !hasCanonicalUrl(uvttCanonicalUrl);
    }
  }

  function refreshImageButton() {
    if (btnValidateImage) {
      btnValidateImage.disabled = !loadedCalibImage || !hasCanonicalUrl(imageCanonicalUrl);
    }
  }

  // --- Logique Import UVTT ---
  if (uvttInput) {
    uvttInput.addEventListener('change', () => {
      const file = uvttInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = /** @type {string} */ (e.target?.result);
          const parsed = parseUvtt(text);
          pendingUvtt = parsed;

          // La base64 du fichier UVTT est réservée à cet aperçu DOM et ne
          // franchit jamais la frontière du store ou du transport.
          if (uvttPreview && uvttPreviewWrap && parsed.imageBase64) {
            uvttPreview.src = parsed.imageBase64.startsWith('data:')
              ? parsed.imageBase64
              : `data:image/png;base64,${parsed.imageBase64}`;
            uvttPreviewWrap.style.display = 'block';
          }
          refreshUvttButton();

          if (uvttStatus) {
            uvttStatus.style.display = 'block';
            uvttStatus.style.color = '#f1c40f';
            let statusHtml = `<strong>Aperçu UVTT local chargé.</strong><br>Dimensions : ${parsed.level.widthCells}×${parsed.level.heightCells} cases (${parsed.level.pxPerCell} px/case). Indiquez l'URL publiée pour ajouter cet étage à la campagne.`;

            if (parsed.warnings && parsed.warnings.length > 0) {
              statusHtml += `<br><span style="color: #f1c40f;">Avertissement : ${parsed.warnings.join(' ; ')}</span>`;
            }
            uvttStatus.innerHTML = statusHtml;
          }
        } catch (err) {
          pendingUvtt = null;
          refreshUvttButton();
          if (uvttStatus) {
            uvttStatus.style.display = 'block';
            uvttStatus.style.color = '#e74c3c';
            uvttStatus.innerHTML = `<strong>Erreur d'importation UVTT :</strong> ${err instanceof Error ? err.message : String(err)}`;
          }
        }
      };
      reader.readAsText(file);
    });
  }

  uvttCanonicalUrl?.addEventListener('input', refreshUvttButton);
  btnValidateUvtt?.addEventListener('click', () => {
    if (!pendingUvtt || !uvttCanonicalUrl || !hasCanonicalUrl(uvttCanonicalUrl)) return;

    const level = {
      ...pendingUvtt.level,
      imageUrl: uvttCanonicalUrl.value.trim(),
    };
    store.addLevel(level);
    const publishedResult = { ...pendingUvtt, level };

    if (uvttStatus) {
      uvttStatus.style.display = 'block';
      uvttStatus.style.color = '#2ecc71';
      uvttStatus.innerHTML = `<strong>Étage "${level.name}" ajouté avec son asset publié.</strong><br>URL : ${level.imageUrl}`;
    }
    options.onImportUvtt?.(publishedResult);
  });

  // --- Logique Import Image & Calibration ---
  function drawCalibrationPreview() {
    if (!calibCtx || !calibCanvas || !cellsWideInput || !cellsTallInput) return;
    calibCtx.clearRect(0, 0, calibCanvas.width, calibCanvas.height);

    if (!loadedCalibImage) {
      calibCtx.fillStyle = '#666';
      calibCtx.font = '12px system-ui, sans-serif';
      calibCtx.textAlign = 'center';
      calibCtx.fillText('Aucune image chargée', calibCanvas.width / 2, calibCanvas.height / 2);
      return;
    }

    // Dessin de l'image ajustée au canvas
    const imgW = loadedCalibImage.width;
    const imgH = loadedCalibImage.height;
    const scale = Math.min(calibCanvas.width / imgW, calibCanvas.height / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const drawX = (calibCanvas.width - drawW) / 2;
    const drawY = (calibCanvas.height - drawH) / 2;

    calibCtx.drawImage(loadedCalibImage, drawX, drawY, drawW, drawH);

    // Tracé de la grille d'aperçu
    const cellsW = Math.max(1, parseInt(cellsWideInput.value, 10) || 20);
    const cellsH = Math.max(1, parseInt(cellsTallInput.value, 10) || 15);

    calibCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    calibCtx.lineWidth = 1;

    for (let c = 0; c <= cellsW; c++) {
      const x = drawX + (c / cellsW) * drawW;
      calibCtx.beginPath();
      calibCtx.moveTo(x, drawY);
      calibCtx.lineTo(x, drawY + drawH);
      calibCtx.stroke();
    }

    for (let r = 0; r <= cellsH; r++) {
      const y = drawY + (r / cellsH) * drawH;
      calibCtx.beginPath();
      calibCtx.moveTo(drawX, y);
      calibCtx.lineTo(drawX + drawW, y);
      calibCtx.stroke();
    }
  }

  if (imageInput) {
    imageInput.addEventListener('change', () => {
      const file = imageInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = /** @type {string} */ (e.target?.result);
        const img = new Image();
        img.onload = () => {
          loadedCalibImage = img;
          loadedImageDataUrl = dataUrl;

          // Calcul suggéré des dimensions en cases si pxPerCell est fourni
          const pxCell = (pxPerCellInput ? parseInt(pxPerCellInput.value, 10) : 140) || 140;
          const suggestedW = Math.round(img.width / pxCell);
          const suggestedH = Math.round(img.height / pxCell);

          if (suggestedW > 0 && cellsWideInput) cellsWideInput.value = String(suggestedW);
          if (suggestedH > 0 && cellsTallInput) cellsTallInput.value = String(suggestedH);

          drawCalibrationPreview();
          refreshImageButton();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  if (cellsWideInput) cellsWideInput.addEventListener('input', drawCalibrationPreview);
  if (cellsTallInput) cellsTallInput.addEventListener('input', drawCalibrationPreview);
  if (pxPerCellInput) {
    pxPerCellInput.addEventListener('input', drawCalibrationPreview);
  }
  imageCanonicalUrl?.addEventListener('input', refreshImageButton);

  if (btnValidateImage) {
    btnValidateImage.addEventListener('click', () => {
      if (
        !loadedCalibImage ||
        !loadedImageDataUrl ||
        !imageCanonicalUrl ||
        !hasCanonicalUrl(imageCanonicalUrl) ||
        !cellsWideInput ||
        !cellsTallInput ||
        !pxPerCellInput
      ) {
        return;
      }

      const cellsWide = Math.max(1, parseInt(cellsWideInput.value, 10) || 20);
      const cellsTall = Math.max(1, parseInt(cellsTallInput.value, 10) || 15);
      const pxPerCell = Math.max(10, parseInt(pxPerCellInput.value, 10) || 140);

      const calibration = calibrateFromRect({
        rectPx: { w: loadedCalibImage.width, h: loadedCalibImage.height },
        cellsWide,
        cellsHigh: cellsTall,
        imageSize: { w: loadedCalibImage.width, h: loadedCalibImage.height },
      });

      const level = createLevel({
        id: `level-${Date.now()}`,
        name: 'Carte Image Calibrée',
        imageUrl: imageCanonicalUrl.value.trim(),
        pxPerCell: pxPerCell,
        widthCells: cellsWide,
        heightCells: cellsTall,
        grid: {
          type: 'square',
          offsetX: calibration.offsetX || 0,
          offsetY: calibration.offsetY || 0,
          color: '#000000',
          opacity: 0.25,
          visible: true,
        },
      });

      store.addLevel(level);

      if (imageStatus) {
        imageStatus.style.display = 'block';
        imageStatus.style.color = '#2ecc71';
        imageStatus.innerHTML = `<strong>Image publiée ajoutée et calibrée avec succès !</strong><br>Dimensions : ${level.widthCells}×${level.heightCells} cases (${Math.round(level.pxPerCell)} px/case). URL : ${level.imageUrl}`;
      }

      if (options.onImportImage) {
        options.onImportImage(level);
      }
    });
  }

  drawCalibrationPreview();

  return {
    drawCalibrationPreview,
  };
}
