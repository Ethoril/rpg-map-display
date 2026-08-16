// @ts-check
import { parseUvtt } from '../../import/uvtt.js';
import { calibrateFromRect } from '../../import/imageCalibrate.js';
import {
  createLevel,
  isPersistableAssetUrl,
  isUnusableGoogleDriveUrl,
  normalizeImageUrl,
} from '../../core/schema.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 */

/**
 * Options d'initialisation du panneau d'importation.
 * @typedef {Object} ImportPanelOptions
 * @property {'uvtt'|'image'|'both'} [mode='both']
 * @property {Transport} [transport]
 * @property {(result: ReturnType<typeof parseUvtt>) => void} [onImportUvtt]
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

  const { transport } = options;
  const mode = options.mode || 'both';

  const showUvtt = mode === 'uvtt' || mode === 'both';
  const showImage = mode === 'image' || mode === 'both';

  container.className = 'import-panel-container';
  container.innerHTML = `
    <div class="import-panel-ui" style="display: flex; flex-direction: column; gap: 1.5rem; font-family: system-ui, sans-serif;">
      ${
        showUvtt
          ? `
      <!-- Section 1 : Importation UVTT (Diagnostic) -->
      <div class="import-uvtt-section" style="background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333; opacity: 0.7;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #888;">⚙️ Diagnostic développeur — Import UVTT</h3>
        <p style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: #aaa;">
          Pour ajouter des cartes <strong>avant la séance</strong>, utilisez plutôt :
          <code style="background: #1a1a1a; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.75rem;">pnpm maps:prepare</code>
        </p>
        <p style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: #aaa;">
          Cette section permet d'importer et tester localement des fichiers UVTT sans passer par la préparation complète.
        </p>

        <label style="display: inline-block; padding: 0.5rem 1rem; background: #333; color: #fff; border-radius: 4px; cursor: pointer; text-align: center;">
          <span>Choisir un fichier .uvtt</span>
          <input type="file" id="uvtt-file-input" accept=".uvtt,.json" style="display: none;" />
        </label>

        <div id="uvtt-preview-wrap" style="display: none; margin-top: 0.75rem;">
          <img id="uvtt-local-preview" alt="Aperçu local de la carte UVTT" style="display: block; width: 100%; max-height: 180px; object-fit: contain; background: #111; border-radius: 4px;" />
        </div>

        <button id="btn-validate-uvtt-import" style="width: 100%; padding: 0.5rem; margin-top: 0.75rem; background: #4a5a5a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;" disabled>
          Charger (aperçu local)
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
        <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Import Image & Calibration</h3>
        <p style="margin: 0 0 0.75rem 0; font-size: 0.85rem; color: #aaa;">
          Indiquez l'URL de l'image (relative au dépôt, HTTPS ou lien Google Drive) pour ajouter et calibrer un étage dans la campagne.
        </p>

        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem;">
          <label for="image-url-input" style="font-size: 0.85rem; color: #ccc;">URL de l'image (relative ou https://) :</label>
          <input type="text" id="image-url-input" placeholder="maps/mon-image.webp ou lien Google Drive" style="padding: 0.5rem; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;" />
        </div>

        <div id="image-error-msg" style="display: none; padding: 0.5rem; background: #3a1a1a; color: #ff6b6b; border: 1px solid #662222; border-radius: 4px; font-size: 0.8rem; margin-bottom: 0.75rem;"></div>

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

        <button id="btn-validate-image-import" style="width: 100%; padding: 0.5rem; background: #4a5a5a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;" disabled>
          Charger et publier l'étage
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
  const uvttPreviewWrap = /** @type {HTMLElement|null} */ (
    container.querySelector('#uvtt-preview-wrap')
  );
  const uvttPreview = /** @type {HTMLImageElement|null} */ (
    container.querySelector('#uvtt-local-preview')
  );
  const btnValidateUvtt = /** @type {HTMLButtonElement|null} */ (
    container.querySelector('#btn-validate-uvtt-import')
  );

  const imageUrlInput = /** @type {HTMLInputElement|null} */ (container.querySelector('#image-url-input'));
  const imageErrorMsg = /** @type {HTMLElement|null} */ (container.querySelector('#image-error-msg'));
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
  let loadedNormalizedUrl = null;
  let activeImageProbeId = 0;
  /** @type {ReturnType<typeof parseUvtt>|null} */
  let pendingUvtt = null;

  /**
   * Affiche un statut d'import sans interpréter le contenu du fichier importé comme du HTML.
   *
   * @param {HTMLElement|null} status
   * @param {string} color
   * @param {Node[]} nodes
   */
  function setImportStatus(status, color, nodes) {
    if (!status) return;
    status.style.display = 'block';
    status.style.color = color;
    status.replaceChildren(...nodes);
  }

  /** @param {string} message */
  function statusText(message) {
    return document.createTextNode(message);
  }

  function refreshUvttButton() {
    if (btnValidateUvtt) {
      // Plus de champ URL : le bouton s'active dès qu'une UVTT est parsée.
      // C'est un aperçu de diagnostic, jamais une publication.
      btnValidateUvtt.disabled = !pendingUvtt;
    }
  }

  function refreshImageButton() {
    if (btnValidateImage) {
      btnValidateImage.disabled = !loadedCalibImage || !loadedNormalizedUrl;
    }
  }

  // --- Logique Import UVTT ---
  if (uvttInput) {
    uvttInput.addEventListener('change', () => {
      const file = uvttInput.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const content = String(reader.result || '');
          const parsed = parseUvtt(content);

          // ── Identifiant dérivé du nom de fichier ─────────────────────────────────────────
          //
          // Un export Dungeondraft ne porte pas d'`id` : le parseur retombe sur `'uvtt-level'`, le
          // même pour toutes les cartes. `store.addLevel` remplaçant en place à identifiant égal,
          // importer une seconde carte **écrasait la première en silence** — et les masques de fog,
          // indexés par `levelId`, se retrouvaient partagés entre cartes de tailles différentes,
          // ce qui faisait disparaître tous les pions de la vue joueurs (séance du 7 août 2026).
          //
          // Même règle que `scripts/prepare-maps.mjs` : réimporter le même fichier remplace,
          // en importer un autre ajoute.
          const base = (file.name || '')
            .replace(/\.[^.]+$/, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '');
          if (base) parsed.level.id = base;

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

          const title = document.createElement('strong');
          title.textContent = 'Aperçu UVTT local chargé.';
          const statusNodes = [
            title,
            document.createElement('br'),
            statusText(
              `Dimensions : ${parsed.level.widthCells}×${parsed.level.heightCells} cases (${parsed.level.pxPerCell} px/case). Indiquez l'URL publiée pour ajouter cet étage à la campagne.`
            ),
          ];
          if (parsed.warnings && parsed.warnings.length > 0) {
            const warning = document.createElement('span');
            warning.style.color = '#f1c40f';
            warning.textContent = `Avertissement : ${parsed.warnings.join(' ; ')}`;
            statusNodes.push(document.createElement('br'), warning);
          }
          setImportStatus(uvttStatus, '#f1c40f', statusNodes);
        } catch (err) {
          pendingUvtt = null;
          refreshUvttButton();
          const title = document.createElement('strong');
          title.textContent = "Erreur d'importation UVTT :";
          setImportStatus(uvttStatus, '#e74c3c', [
            title,
            statusText(` ${err instanceof Error ? err.message : String(err)}`),
          ]);
        }
      };
      reader.readAsText(file);
    });
  }

  btnValidateUvtt?.addEventListener('click', () => {
    if (!pendingUvtt) return;

    // En diagnostic : créer un niveau SANS imageUrl (aperçu local, ne passe pas par le store)
    // L'imageUrl vide empêche le chargement d'une ressource inexistante
    const level = {
      ...pendingUvtt.level,
      imageUrl: '', // Pas d'image persistée — diagnostic uniquement
    };

    try {
      store.addLevel(level);
      const publishedResult = { ...pendingUvtt, level };

      const title = document.createElement('strong');
      title.textContent = `✓ Étage "${level.name}" chargé (aperçu local — pas d'image).`;
      const help = document.createElement('span');
      help.style.cssText = 'font-size:0.8rem;color:#aaa';
      help.append('Pour publier avec image, utilisez : ');
      const command = document.createElement('code');
      command.style.cssText = 'background:#1a1a1a;padding:0.2rem 0.4rem;border-radius:3px';
      command.textContent = 'pnpm maps:prepare';
      help.appendChild(command);
      setImportStatus(uvttStatus, '#2ecc71', [title, document.createElement('br'), help]);
      options.onImportUvtt?.(publishedResult);
    } catch (err) {
      const title = document.createElement('strong');
      title.textContent = 'Erreur :';
      setImportStatus(uvttStatus, '#e07070', [
        title,
        statusText(` ${err instanceof Error ? err.message : String(err)}`),
      ]);
    }
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

  function handleUrlChange() {
    if (!imageUrlInput) return;
    if (imageErrorMsg) {
      imageErrorMsg.style.display = 'none';
      imageErrorMsg.textContent = '';
    }
    const saisie = imageUrlInput.value.trim();
    if (!saisie) {
      loadedCalibImage = null;
      loadedNormalizedUrl = null;
      drawCalibrationPreview();
      refreshImageButton();
      return;
    }

    if (isUnusableGoogleDriveUrl(saisie)) {
      if (imageErrorMsg) {
        imageErrorMsg.textContent =
          "Ce lien Google Drive ne désigne pas un fichier (un dossier ?). Ouvrez l'image dans Drive, puis copiez son lien de partage.";
        imageErrorMsg.style.display = 'block';
      }
      loadedCalibImage = null;
      loadedNormalizedUrl = null;
      drawCalibrationPreview();
      refreshImageButton();
      return;
    }

    const url = normalizeImageUrl(saisie);
    if (url !== saisie) {
      imageUrlInput.value = url;
    }

    if (!isPersistableAssetUrl(url)) {
      if (imageErrorMsg) {
        imageErrorMsg.textContent =
          'URL non persistable : les images data: et blob: ou absolues non-https sont interdites. Utilisez une URL HTTPS ou relative au dépôt.';
        imageErrorMsg.style.display = 'block';
      }
      loadedCalibImage = null;
      loadedNormalizedUrl = null;
      drawCalibrationPreview();
      refreshImageButton();
      return;
    }

    const probeId = ++activeImageProbeId;
    const probe = new Image();
    probe.onload = () => {
      if (probeId !== activeImageProbeId) return;
      loadedCalibImage = probe;
      loadedNormalizedUrl = url;
      if (imageErrorMsg) {
        imageErrorMsg.style.display = 'none';
        imageErrorMsg.textContent = '';
      }

      const pxCell = (pxPerCellInput ? parseInt(pxPerCellInput.value, 10) : 140) || 140;
      const suggestedW = Math.round(probe.width / pxCell);
      const suggestedH = Math.round(probe.height / pxCell);

      if (suggestedW > 0 && cellsWideInput) cellsWideInput.value = String(suggestedW);
      if (suggestedH > 0 && cellsTallInput) cellsTallInput.value = String(suggestedH);

      drawCalibrationPreview();
      refreshImageButton();
    };
    probe.onerror = () => {
      if (probeId !== activeImageProbeId) return;
      loadedCalibImage = null;
      loadedNormalizedUrl = null;
      if (imageErrorMsg) {
        imageErrorMsg.textContent = `L'image n'a pas pu être chargée depuis ${url} — vérifiez l'adresse et le partage.`;
        imageErrorMsg.style.display = 'block';
      }
      drawCalibrationPreview();
      refreshImageButton();
    };
    probe.src = url;
  }

  if (imageUrlInput) {
    imageUrlInput.addEventListener('input', handleUrlChange);
    imageUrlInput.addEventListener('change', handleUrlChange);
  }

  if (cellsWideInput) cellsWideInput.addEventListener('input', drawCalibrationPreview);
  if (cellsTallInput) cellsTallInput.addEventListener('input', drawCalibrationPreview);
  if (pxPerCellInput) {
    pxPerCellInput.addEventListener('input', drawCalibrationPreview);
  }

  if (btnValidateImage) {
    btnValidateImage.addEventListener('click', () => {
      if (
        !loadedCalibImage ||
        !loadedNormalizedUrl ||
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
        imageUrl: loadedNormalizedUrl,
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

      try {
        store.addLevel(level);

        if (transport) {
          transport.publish({
            type: 'level.add',
            payload: { level },
            at: Date.now(),
            by: 'gm',
          });
        }

        const title = document.createElement('strong');
        title.textContent = `✓ Étage "${level.name}" chargé et publié.`;
        setImportStatus(imageStatus, '#2ecc71', [
          title,
          document.createElement('br'),
          statusText(
            `Dimensions : ${level.widthCells}×${level.heightCells} cases (${Math.round(level.pxPerCell)} px/case)`
          ),
        ]);
      } catch (err) {
        const title = document.createElement('strong');
        title.textContent = 'Erreur :';
        setImportStatus(imageStatus, '#e07070', [
          title,
          statusText(` ${err instanceof Error ? err.message : String(err)}`),
        ]);
      }
    });
  }

  drawCalibrationPreview();

  return {
    drawCalibrationPreview,
  };
}
