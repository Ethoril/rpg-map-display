// @ts-check
import { createImportPanel } from './importPanel.js';
import { createTokenMaker, mountBorderSwatches } from './tokenMaker.js';
import { createSceneLibrary } from './sceneLibrary.js';
import { createTokenLibrary } from './tokenLibrary.js';
import { createImageShare } from './imageShare.js';
import { createFogTools } from './fogTools.js';
import { createWallEditor } from './wallEditor.js';
import { createLinkEditor } from './linkEditor.js';
import { createTemplateTools } from './templateTools.js';
import { createLevelSelector } from './levelSelector.js';
import { VERSION } from '../../core/version.js';
import {
  GM_SESSION_STORAGE_KEY,
  STATUS_MARKER_IDS,
  STATUS_MARKER_LABEL_FR,
  TOKEN_TORCH_DEFAULT,
} from '../../core/constants.js';
import { isStatusMarker } from '../../core/schema.js';
import { cellDimensionsForGridType } from '../../grid/index.js';
import { mountGMVersionBadge } from '../versionBadge.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 */

/**
 * Options d'initialisation du panneau MJ.
 * @typedef {Object} GMPanelOptions
 * @property {Transport} [transport] Transport réseau optionnel pour la synchronisation
 * @property {string} [sessionId] Code de session, affiché pour être dicté à la tablette
 * @property {(levelId: string) => import('../../vision/fog.js').ExploredFog|null} [getExploredFog]
 * @property {() => void} [scheduleFogPublish]
 * @property {() => void} [requestRender]
 * @property {(levelId: string, wall: import('../../core/types.js').CellPoint[]) => void} [onAddWall]
 * @property {(levelId: string, wall: import('../../core/types.js').CellPoint[]) => void} [onRemoveWall]
 * @property {(link: import('../../core/types.js').Link) => void} [onAddLink]
 * @property {(linkId: string) => void} [onRemoveLink]
 * @property {() => import('../../state/presence.js').ClientPresence[]} [getOtherGmSessions]
 * @property {() => boolean} [onEvictOtherGms]
 */

/**
 * Dimensions naturelles de l'image d'un étage, ou `null` sans image lisible (C-16).
 *
 * ⚠ `load` et non `decode()` : seules les dimensions servent, et décoder une carte de
 * 7 000 px coûte des centaines de millisecondes pour rien (Chantier N). L'image est d'ordinaire
 * déjà dans le cache du navigateur, puisque le fond l'affiche.
 *
 * @param {string|null|undefined} url
 * @returns {Promise<{width: number, height: number}|null>}
 */
function naturalImageSize(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(
        img.naturalWidth > 0 && img.naturalHeight > 0
          ? { width: img.naturalWidth, height: img.naturalHeight }
          : null
      );
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Monte le panneau latéral complet de la vue MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {GMPanelOptions} [options]
 * @returns {{hasPendingToken: () => boolean, placePendingTokenAt: (levelId: string, cell: import('../../core/types.js').Cell) => boolean, getMode: () => 'play'|'prep', setMode: (mode: 'play'|'prep') => void, tokenMaker: ReturnType<typeof createTokenMaker>, fogTools: ReturnType<typeof createFogTools>|null, wallEditor: ReturnType<typeof createWallEditor>|null, linkEditor: ReturnType<typeof createLinkEditor>|null, templateTools: ReturnType<typeof createTemplateTools>|null, getActiveToolName: () => string, setActiveTool: (toolName: 'none'|'fog-reveal'|'fog-hide'|'wall-draw'|'wall-delete'|'link-place'|'template-place'|'token-place'|'ping'|'measure'|'light-place'|'light-delete') => void, disarmActiveTool: () => void, destroy: () => void}}
 */
export function createGMPanel(container, options = {}) {
  if (!container) {
    throw new Error('createGMPanel : conteneur HTML requis');
  }

  const {
    transport,
    sessionId = '',
    getExploredFog = () => null,
    scheduleFogPublish = () => {},
    requestRender = () => {},
    getOtherGmSessions = () => [],
    onEvictOtherGms = () => false,
  } = options;
  const listeners = new AbortController();

  container.className = 'gm-panel-root';

  // ── Les trois zones de C-10 ──────────────────────────────────────────────────────────────
  //
  // Le panneau ne vit plus seulement dans son conteneur : la barre du haut, le rail d'outils et
  // la palette posée sur la carte sont des zones sœurs, que gm.html fournit. Elles se cherchent
  // dans le document du conteneur ; si l'une manque, elle est créée en tête du conteneur pour que
  // le panneau reste montable seul — mise en page dégradée, mais aucun identifiant perdu.
  const doc = container.ownerDocument;
  /** @type {HTMLElement[]} */
  const zonesCreees = [];

  /**
   * @param {string} id
   * @param {string} tag
   * @returns {HTMLElement}
   */
  function zone(id, tag) {
    const existante = doc.getElementById(id);
    if (existante) return existante;
    const creee = doc.createElement(tag);
    creee.id = id;
    zonesCreees.push(creee);
    return creee;
  }

  /**
   * Icône de trait, 24 unités, couleur du texte : elle suit l'état du bouton sans règle à part.
   * @param {string} traces
   */
  const icone = (traces) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${traces}</svg>`;

  const LAMPE = '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>';

  /**
   * @param {{id: string, label: string, title: string, traces: string, aria?: string, palette?: string}} b
   */
  const boutonDuRail = (b) => `
      <button id="${b.id}" type="button" class="gm-rail-btn" aria-pressed="false"${
        b.palette ? ` data-palette="${b.palette}" aria-controls="gm-tool-palette"` : ''
      } aria-label="${b.aria ?? b.label}" title="${b.title}">${icone(b.traces)}<span class="gm-rail-label">${b.label}</span></button>`;

  const SEPARATEUR_DU_RAIL = '<span class="gm-rail-sep" aria-hidden="true"></span>';

  const topbar = zone('gm-topbar', 'header');
  const rail = zone('gm-rail', 'nav');
  if (!rail.hasAttribute('aria-label')) rail.setAttribute('aria-label', 'Outils du meneur de jeu');
  const canvasContainer = zone('canvas-container', 'div');

  const BAKED_WARNING_TEXT = '⚠ Éclairage annoncé cuit — assombrir pourrait doubler';

  topbar.innerHTML = `
    <div class="gm-session-code-group">
      <span class="gm-h gm-h--inline">Table</span>
      <code id="gm-session-code"></code>
    </div>
    <span class="gm-vsep" aria-hidden="true"></span>
    <!--
      Barre d'étage — Lot 3, S-02.

      Hors des onglets, et c'est délibéré : changer d'étage est une action de séance, faite en
      cours de jeu et depuis n'importe quel outil. Elle est masquée tant que la campagne n'a qu'un
      seul étage, pour ne rien ajouter au bandeau du cas courant.
    -->
    <div id="gm-level-bar" hidden></div>
    <span class="gm-topbar-spacer"></span>
    <div id="gm-light-bar">
      <!-- ⛔ Bascule à DEUX états, pas un curseur (UX-07). Le curseur offrait 21 positions dont
           le moteur ne distinguait que deux : fogLayer ne lit que "baked ou level > 0", donc
           0,05 et 1,00 étaient rigoureusement indistinguables. L'interface dit désormais ce que
           le moteur fait. ⛔ La pénombre graduée est écartée : c'est le seul chemin de l'audit
           où une erreur ferait voir aux joueurs ce qu'ils ne devraient pas voir. -->
      <div id="gm-ambient-toggle" class="gm-seg" role="group" aria-label="Ambiance lumineuse">
        <button id="gm-ambient-day" type="button" aria-pressed="true">${icone(
          '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
        )}Jour</button>
        <button id="gm-ambient-night" type="button" aria-pressed="false">${icone(
          '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'
        )}Nuit</button>
      </div>
      <span id="gm-baked-warning" role="status" hidden title="${BAKED_WARNING_TEXT}">${BAKED_WARNING_TEXT}</span>
    </div>
    <!-- Sélecteur de mode : Jouer / Préparer (UX-03). Il ne gouverne plus que les onglets de
         l'inspecteur : les outils du rail sont là dans les deux modes. -->
    <div id="gm-mode-selector" class="gm-seg" role="group" aria-label="Mode du panneau">
      <button id="gm-mode-play" type="button" aria-pressed="true">Jouer</button>
      <button id="gm-mode-prep" type="button" aria-pressed="false">Préparer</button>
    </div>
    <div class="gm-topbar-actions">
      <button id="gm-evict-others" type="button" class="gm-btn--ghost gm-btn--sm" title="Déconnecte les autres écrans MJ de cette session">Autres MJ</button>
      <button id="gm-leave-session" type="button" class="gm-btn--ghost gm-btn--sm" title="Quitter la session : la campagne reste enregistrée">Quitter</button>
    </div>
  `;

  // ⛔ Aucun raccourci clavier ici (arbitrage C-10) : seuls Échap et P existent.
  rail.innerHTML = `${boutonDuRail({
    id: 'gm-rail-select',
    label: 'Choisir',
    title: 'Ranger l’outil armé et fermer la palette',
    traces: '<path d="M5 3l14 8-6.2 1.8L11 19z"/>',
  })}
    ${SEPARATEUR_DU_RAIL}
    ${boutonDuRail({
      id: 'gm-ping-arm',
      label: 'Ping',
      title: 'Armer le ping, puis cliquer sur la carte : un marqueur apparaît 2 s sur les trois écrans',
      traces: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="7"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    })}
    ${boutonDuRail({
      id: 'gm-measure-arm',
      label: 'Mesure',
      title: 'Armer la mesure, puis cliquer deux points sur la carte',
      traces: '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
    })}
    ${boutonDuRail({
      id: 'gm-light-place-arm',
      label: 'Lampe',
      aria: 'Poser une lampe',
      title: 'Armer la pose de lampe, puis taper une case : une lampe allumée y naît',
      traces: LAMPE,
    })}
    ${boutonDuRail({
      id: 'gm-light-delete-arm',
      label: 'Ôter lampe',
      aria: 'Ôter une lampe',
      title: 'Armer la suppression de lampe, puis taper une lampe pour la retirer',
      traces: `${LAMPE}<path d="M4 4l16 16"/>`,
    })}
    ${SEPARATEUR_DU_RAIL}
    ${boutonDuRail({
      id: 'gm-rail-fog-tools',
      palette: 'fog-tools',
      label: 'Fog',
      title: 'Ouvrir la palette du brouillard',
      traces: '<path d="M7 17h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 10.5 3.3 3.3 0 0 0 7 17z"/><path d="M4 21h16"/>',
    })}
    ${boutonDuRail({
      id: 'gm-rail-template-tools',
      palette: 'template-tools',
      label: 'Gabarits',
      title: 'Ouvrir la palette des gabarits',
      traces: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
    })}
    ${boutonDuRail({
      id: 'gm-rail-wall-editor',
      palette: 'wall-editor',
      label: 'Murs',
      title: 'Ouvrir la palette des murs',
      traces: '<path d="M3 6h18v12H3zM3 12h18M9 6v6M15 12v6"/>',
    })}
    ${boutonDuRail({
      id: 'gm-rail-link-editor',
      palette: 'link-editor',
      label: 'Liaisons',
      title: 'Ouvrir la palette des liaisons d’escalier',
      traces: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
    })}
  `;

  // La palette est l'ancien onglet d'outil, posé sur la carte : elle en hérite les règles de
  // désarmement (voir setPalette plus bas). Le rappel d'outil armé est posé sur la carte aussi.
  const paletteHost = doc.createElement('div');
  paletteHost.innerHTML = `
    <section id="gm-tool-palette" class="gm-palette" hidden aria-labelledby="gm-palette-title">
      <div class="gm-palette-head">
        <h2 id="gm-palette-title" class="gm-palette-title"></h2>
        <button id="gm-palette-close" type="button" class="gm-btn--ghost gm-btn--sm" aria-label="Fermer la palette">Fermer</button>
      </div>
      <div class="gm-palette-body">
        <div id="palette-fog-tools" class="gm-palette-pane" hidden><div id="fog-tools-mount"></div></div>
        <div id="palette-template-tools" class="gm-palette-pane" hidden><div id="template-tools-mount"></div></div>
        <div id="palette-wall-editor" class="gm-palette-pane" hidden><div id="wall-editor-mount"></div></div>
        <div id="palette-link-editor" class="gm-palette-pane" hidden><div id="link-editor-mount"></div></div>
      </div>
    </section>
    <div id="gm-active-tool-banner" class="gm-armed-chip" role="status">
      <span id="gm-active-tool-text" class="gm-armed-chip-text"></span>
      <span id="gm-ping-hint" class="gm-armed-chip-hint"></span>
      <button id="gm-disarm-active-tool" type="button" class="gm-btn--sm">Ranger · Échap</button>
    </div>
  `;
  const palette = /** @type {HTMLElement} */ (paletteHost.querySelector('#gm-tool-palette'));
  const armedChip = /** @type {HTMLElement} */ (paletteHost.querySelector('#gm-active-tool-banner'));
  canvasContainer.append(palette, armedChip);

  container.innerHTML = `
    <!--
      Barre de vitalité du pion sélectionné — UX-04.

      Hors des onglets, pour la raison exacte de la barre d'étage : c'est le geste le plus répété
      d'un combat, et il se paie à chaque coup porté. L'enfouir dans l'onglet Pions obligeait le MJ
      à quitter son pinceau de fog pour retirer trois points de vie. Masquée tant qu'aucun pion
      n'est sélectionné, pour ne rien ajouter au bandeau du cas courant.

      ⛔ Elle ne porte QUE ce qui bouge en combat. L'édition complète — nom, image, taille, vitesse,
      vision, marqueurs — reste dans l'onglet Pions, et il ne faut pas la dupliquer ici. Monter à
      cheval ou en descendre en fait partie (chantier C-9) : le bouton « À cheval » vaut pour un PJ
      comme pour un PNJ, et reste visible dès que la barre l'est.

      ⚠ L'interdiction n°4 de CONVENTIONS.md §8 — « ni barre de points de vie sur un PNJ » — porte
      sur le RENDU DU PION SUR LE CANVAS, pas sur le panneau MJ. C'est le chantier Q : anneau
      proportionnel réservé aux PJ, trois crans manuels pour les PNJ, et l'état de santé jamais
      dérivé des points de vie dans aucun sens. D'où les deux moitiés exclusives ci-dessous :
      chiffres pour un PJ, crans pour un PNJ. Ne jamais montrer les deux, ne jamais déduire l'une
      de l'autre.

      ⛔ Aucun backtick dans ce commentaire : il vit dans un template literal, et la chaîne se
      terminerait là. Le symptôme est un waitForApp qui expire, pas une erreur de syntaxe lisible.
    -->
    <div id="gm-vitals-bar" class="gm-section" hidden>
      <span id="gm-vitals-label"></span>
      <div id="gm-vitals-hp" hidden>
        <label for="gm-vitals-hp-current" class="gm-muted">PV</label>
        <input id="gm-vitals-hp-current" type="number" min="0" />
        <span id="gm-vitals-hp-max"></span>
      </div>
      <div id="gm-vitals-health" role="group" aria-label="État de santé du PNJ" hidden>
        <button id="gm-vitals-health-unharmed" type="button" class="gm-btn--sm" data-health="unharmed" aria-pressed="false">Indemne</button>
        <button id="gm-vitals-health-wounded" type="button" class="gm-btn--sm" data-health="wounded" aria-pressed="false">Blessé</button>
        <button id="gm-vitals-health-critical" type="button" class="gm-btn--sm" data-health="critical" aria-pressed="false">Critique</button>
      </div>
      <button id="gm-vitals-mounted" type="button" class="gm-btn--sm" aria-pressed="false">À cheval</button>
      <span id="gm-vitals-hint" class="gm-hint"></span>
    </div>

    <!-- Onglets de l'inspecteur : le mode n'en gouverne plus que la liste (C-10). -->
    <div class="gm-tabs-header" role="tablist" aria-label="Inspecteur du meneur de jeu">
      <!-- Mode Jouer (2 onglets) -->
      <button class="gm-tab-btn active" type="button" id="gm-tab-token-maker" role="tab" data-tab="token-maker" aria-controls="tab-content-token-maker" aria-selected="true" tabindex="0">Pions</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-image-share" role="tab" data-tab="image-share" aria-controls="tab-content-image-share" aria-selected="false" tabindex="-1" title="Partage d’image">Image</button>
      <!-- Mode Préparer (3 onglets) -->
      <button class="gm-tab-btn" type="button" id="gm-tab-scene-library" role="tab" data-tab="scene-library" aria-controls="tab-content-scene-library" aria-selected="false" tabindex="-1" hidden>Cartes</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-import-image" role="tab" data-tab="import-image" aria-controls="tab-content-import-image" aria-selected="false" tabindex="-1" hidden>Image</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-grid-settings" role="tab" data-tab="grid-settings" aria-controls="tab-content-grid-settings" aria-selected="false" tabindex="-1" hidden>Grille</button>
    </div>

    <!-- Conteneurs de contenu des onglets -->
    <div class="gm-tabs-content">
      <div id="tab-content-token-maker" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-token-maker">
        <!-- C-10, tranche 3 : sans sélection, la liste des pions de l'étage ; avec une sélection, sa
             fiche. Les deux ne sont jamais à l'écran ensemble. Un clic de ligne fait exactement ce
             que fait le clic sur la carte (store.selectToken) : aucun événement réseau de plus. -->
        <section id="gm-roster" class="gm-section">
          <div class="gm-roster-head">
            <h4 class="gm-h gm-h--inline">Sur la carte</h4>
            <span id="gm-roster-count" class="gm-muted"></span>
          </div>
          <div id="gm-roster-list" class="gm-roster-list"></div>
          <p id="gm-roster-empty" class="gm-hint" hidden>Aucun pion sur cet étage. Posez-en un depuis la bibliothèque ci-dessous.</p>
        </section>

        <div class="token-elevation-section gm-section" hidden>
          <button id="gm-roster-back" type="button" class="gm-btn--ghost gm-btn--sm">← Tous les pions</button>
          <h3 class="gm-title gm-token-sheet-title">Pion sélectionné</h3>

          <div id="token-edit-fields" class="gm-stack">
            <h4 class="gm-h gm-h--inline">Identité</h4>
            <div class="gm-field">
              <label for="token-edit-label">Nom</label>
              <input type="text" id="token-edit-label" disabled />
            </div>
            <div class="gm-field">
              <label for="token-edit-kind">Type</label>
              <select id="token-edit-kind" disabled>
                <option value="pc">PJ (Joueur)</option>
                <option value="npc">PNJ (Non-Joueur)</option>
              </select>
            </div>
            <div class="gm-field">
              <label for="token-edit-border-color">Bordure</label>
              <input type="color" id="token-edit-border-color" disabled />
            </div>
            <div class="gm-field">
              <label for="token-edit-size-cells">Taille (cases)</label>
              <input type="number" id="token-edit-size-cells" min="1" max="4" disabled />
            </div>
            <div class="gm-field">
              <label for="token-elevation">Élévation</label>
              <input type="number" id="token-elevation" class="token-elevation-input" value="0" disabled />
            </div>
            <p id="token-elevation-label" class="gm-muted">(aucun pion sélectionné)</p>

            <details id="gm-token-group-move" class="gm-disclosure" open>
              <summary><span>Déplacement</span><span id="gm-token-sum-move" class="gm-muted gm-disclosure-sum"></span></summary>
              <div class="gm-disclosure-body gm-stack">
                <div class="gm-field">
                  <label for="token-edit-speed-cells">Vitesse (cases)</label>
                  <input type="number" id="token-edit-speed-cells" min="1" disabled />
                </div>
                <div class="gm-field">
                  <label for="token-edit-player-movable">Déplaçable par les joueurs</label>
                  <input type="checkbox" id="token-edit-player-movable" disabled />
                </div>
                <div class="gm-field">
                  <label for="token-edit-locked">Verrouillé</label>
                  <input type="checkbox" id="token-edit-locked" disabled />
                </div>
              </div>
            </details>

            <details id="gm-token-group-vision" class="gm-disclosure">
              <summary><span>Vision et lumière</span><span id="gm-token-sum-vision" class="gm-muted gm-disclosure-sum"></span></summary>
              <div class="gm-disclosure-body gm-stack">
                <div class="gm-field">
                  <label for="token-edit-vision-dim">Vision dans le noir (cases)</label>
                  <input type="number" id="token-edit-vision-dim" min="0" max="60" disabled />
                </div>
                <div class="gm-field">
                  <label for="token-edit-torch">Porte une torche</label>
                  <input type="checkbox" id="token-edit-torch" disabled />
                </div>
                <div class="gm-field">
                  <label for="token-edit-torch-range">Portée (cases)</label>
                  <input type="number" id="token-edit-torch-range" min="1" max="20" disabled />
                </div>
              </div>
            </details>

            <details id="gm-token-group-visibility" class="gm-disclosure">
              <summary><span>Visibilité</span><span id="gm-token-sum-visibility" class="gm-muted gm-disclosure-sum"></span></summary>
              <div class="gm-disclosure-body gm-stack">
                <div class="gm-field">
                  <label for="token-edit-hidden">Masqué aux joueurs</label>
                  <input type="checkbox" id="token-edit-hidden" disabled />
                </div>
              </div>
            </details>

            <details id="gm-token-group-hp" class="gm-disclosure" open>
              <summary><span>Points de vie</span><span id="gm-token-sum-hp" class="gm-muted gm-disclosure-sum"></span></summary>
              <div class="gm-disclosure-body gm-stack">
                <div class="gm-field">
                  <label for="token-hp-current">PV (courant / max)</label>
                  <div class="gm-row gm-hp-pair">
                    <input type="number" id="token-hp-current" min="0" disabled placeholder="—" />
                    <span class="gm-muted">/</span>
                    <input type="number" id="token-hp-max" min="1" disabled placeholder="—" />
                  </div>
                </div>

                <div id="token-health-section" hidden>
                  <h4 class="gm-h">État de santé (PNJ)</h4>
                  <div id="token-health-radios" class="gm-row">
                    <label class="gm-check">
                      <input type="radio" name="token-health-group" id="token-health-unharmed" value="unharmed" disabled />
                      <span>Indemne</span>
                    </label>
                    <label class="gm-check">
                      <input type="radio" name="token-health-group" id="token-health-wounded" value="wounded" disabled />
                      <span>Blessé</span>
                    </label>
                    <label class="gm-check">
                      <input type="radio" name="token-health-group" id="token-health-critical" value="critical" disabled />
                      <span>Mal en point</span>
                    </label>
                  </div>
                </div>
              </div>
            </details>

            <details id="gm-token-group-markers" class="gm-disclosure" open>
              <summary><span>Marqueurs</span><span id="gm-token-sum-markers" class="gm-muted gm-disclosure-sum"></span></summary>
              <div id="token-markers-section" class="gm-disclosure-body">
                <div id="token-markers-grid" class="gm-marker-grid">
                  ${STATUS_MARKER_IDS.map(
                    (id) => `
                    <label class="gm-check">
                      <input type="checkbox" class="token-marker-checkbox" value="${id}" disabled />
                      <span>${STATUS_MARKER_LABEL_FR[id]}</span>
                    </label>
                  `
                  ).join('')}
                </div>
              </div>
            </details>
          </div>

          <p id="token-edit-status" class="gm-status"></p>

          <div class="gm-stack gm-subsection">
            <button id="btn-reserve-token" type="button" class="gm-btn--block" disabled title="Retire le pion du plateau sans le supprimer : il garde ses points de vie, ses marqueurs et son nom.">
              Ranger en réserve
            </button>
            <button id="btn-delete-token" type="button" class="gm-btn--danger gm-btn--block" disabled>
              Supprimer ce pion
            </button>
          </div>
        </div>

        <!-- Sous la liste quand rien n'est sélectionné (la fiche est alors masquée), sous la fiche sinon. -->
        <div id="gm-reserve-drawer" class="gm-section" hidden>
          <h4 class="gm-h">Réserve</h4>
          <p class="gm-hint">
            Pions retirés du plateau, avec leur état. « Poser » arme la pose : tapez ensuite la carte.
          </p>
          <p id="gm-reserve-stacking-notice" class="gm-hint gm-warn" hidden></p>
          <div id="gm-reserve-list" class="gm-stack"></div>
        </div>

        <details id="gm-token-library-group" class="gm-disclosure token-library-section" open>
          <summary>Bibliothèque de pions</summary>
          <div class="gm-disclosure-body"><div id="token-library-mount"></div></div>
        </details>
        <details id="gm-token-maker-group" class="gm-disclosure token-maker-section" open>
          <summary>Créer un pion</summary>
          <div class="gm-disclosure-body"><div id="token-maker-mount"></div></div>
        </details>
      </div>

      <div id="tab-content-image-share" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-image-share" hidden>
        <div id="image-share-mount"></div>
      </div>

      <div id="tab-content-scene-library" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-scene-library" hidden>
        <div id="scene-library-mount"></div>
        <!-- Le diagnostic UVTT n'est plus un onglet (C-10) : il ferme le volet Cartes. -->
        <details id="gm-uvtt-diag" class="gm-disclosure">
          <summary>Diagnostic d'import UVTT</summary>
          <div class="gm-disclosure-body"><div id="import-uvtt-mount"></div></div>
        </details>
      </div>

      <div id="tab-content-import-image" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-import-image" hidden>
        <div id="import-image-mount"></div>
      </div>

      <div id="tab-content-grid-settings" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-grid-settings" hidden>
        <div class="grid-settings-form gm-section gm-stack">
          <h3 class="gm-title">Réglages de la grille</h3>

          <label class="gm-check">
            <input type="checkbox" id="grid-visible" checked />
            <span>Grille visible</span>
          </label>

          <div class="gm-field">
            <label for="grid-type">Type de grille</label>
            <!-- min-width:0 (posé par .gm-field) n'est pas cosmétique. Un select se dimensionne sur
                 sa plus longue option et, dans une piste de grille, déborde au lieu de se réduire.
                 Le 13/08/2026 l'option « Hexagonale (pointe en haut) » a fait sortir le panneau de
                 15 px : invisible sur le poste du mainteneur, rouge sur le runner CI dont les
                 fontes sont plus larges. La contrainte tient quelle que soit la fonte, là où
                 raccourcir le libellé n'aurait protégé que jusqu'au prochain libellé. -->
            <select id="grid-type"
                    title="Le pavage de l’étage actif. Pointe en haut, rangées impaires décalées. Les imports UVTT sont carrés ; l’hexagone se pose sur une carte-décor.">
              <option value="square">Carrée</option>
              <option value="hex">Hexagonale</option>
            </select>
          </div>

          <div class="gm-field">
            <label for="grid-color">Couleur</label>
            <input type="color" id="grid-color" value="#000000" />
          </div>

          <div class="gm-field">
            <label for="grid-opacity">Opacité (<span id="grid-opacity-val">0.25</span>)</label>
            <input type="range" id="grid-opacity" min="0" max="1" step="0.05" value="0.25" />
          </div>
        </div>
      </div>
    </div>

    <!-- Pied de panneau : Affichage de la version -->
    <div class="gm-panel-footer"></div>
    <a class="gm-panel-attributions" href="./attributions.html">Attributions</a>
  `;

  // Après le gabarit du conteneur, qui les aurait effacées : voir zone().
  container.prepend(...zonesCreees);

  const sessionCode = /** @type {HTMLElement} */ (topbar.querySelector('#gm-session-code'));
  sessionCode.textContent = sessionId || '—';

  const footerEl = /** @type {HTMLElement} */ (container.querySelector('.gm-panel-footer'));
  /** @type {ReturnType<typeof mountGMVersionBadge>|null} */
  let versionBadge = null;
  if (footerEl) {
    versionBadge = mountGMVersionBadge(footerEl, { transport, role: 'gm' });
  }

  // --- Gestion des modes « Jouer » et « Préparer » (UX-03) ---
  const playModeBtn = /** @type {HTMLButtonElement|null} */ (topbar.querySelector('#gm-mode-play'));
  const prepModeBtn = /** @type {HTMLButtonElement|null} */ (topbar.querySelector('#gm-mode-prep'));
  const activeToolText = armedChip.querySelector('#gm-active-tool-text');
  const activeToolHint = armedChip.querySelector('#gm-ping-hint');
  const disarmActiveToolBtn = /** @type {HTMLButtonElement|null} */ (armedChip.querySelector('#gm-disarm-active-tool'));

  /** @type {Record<'play'|'prep', string[]>} */
  const MODE_TABS = {
    play: ['token-maker', 'image-share'],
    prep: ['scene-library', 'import-image', 'grid-settings'],
  };

  /** @type {Record<string, string>} */
  const TOOL_LABELS = {
    'fog-reveal': 'Brouillard (Révéler)',
    'fog-hide': 'Brouillard (Masquer)',
    'wall-draw': 'Murs (Tracer)',
    'wall-delete': 'Murs (Effacer)',
    'link-place': 'Liaisons (Poser)',
    'template-place': 'Gabarits (Poser)',
    'token-place': 'Pion (Poser)',
    ping: 'Ping',
    measure: 'Mesure',
    'light-place': 'Poser une lampe',
    'light-delete': 'Ôter une lampe',
  };

  /**
   * L'indice des gestes sans cible visible. Le pinceau de fog et l'éditeur de murs changent le
   * curseur sur la carte ; le ping, la mesure et les lampes ne changent rien tant qu'on n'a pas
   * cliqué, d'où cette ligne dans le rappel d'outil armé.
   *
   * @type {Record<string, string>}
   */
  const TOOL_HINTS = {
    ping: 'Cliquez sur la carte',
    measure: 'Cliquer 2 points sur la carte',
    'light-place': 'Taper une case pour y poser une lampe',
    'light-delete': 'Taper une lampe pour la supprimer',
  };

  /**
   * Le bouton du rail qui porte le liseré de laiton quand l'outil est armé. ⚠ Aucun pour
   * token-place : la pose d'un pion s'arme depuis l'inspecteur, pas depuis le rail.
   *
   * @type {Record<string, string>}
   */
  const TOOL_RAIL_BUTTON = {
    'fog-reveal': 'gm-rail-fog-tools',
    'fog-hide': 'gm-rail-fog-tools',
    'template-place': 'gm-rail-template-tools',
    'wall-draw': 'gm-rail-wall-editor',
    'wall-delete': 'gm-rail-wall-editor',
    'link-place': 'gm-rail-link-editor',
    ping: 'gm-ping-arm',
    measure: 'gm-measure-arm',
    'light-place': 'gm-light-place-arm',
    'light-delete': 'gm-light-delete-arm',
  };

  /** @type {Record<string, string>} */
  const PALETTE_TITLES = {
    'fog-tools': 'Fog',
    'template-tools': 'Gabarits',
    'wall-editor': 'Murs',
    'link-editor': 'Liaisons d’escalier',
  };

  const railButtons = /** @type {HTMLButtonElement[]} */ (Array.from(rail.querySelectorAll('.gm-rail-btn')));
  const paletteButtons = railButtons.filter((b) => b.dataset.palette);
  const paletteTitle = /** @type {HTMLElement} */ (palette.querySelector('#gm-palette-title'));
  const palettePanes = /** @type {HTMLElement[]} */ (Array.from(palette.querySelectorAll('.gm-palette-pane')));

  /** @type {'play'|'prep'} */
  let currentMode = 'play';

  /** @type {Record<'play'|'prep', string>} */
  const lastActiveTabByMode = {
    play: 'token-maker',
    prep: 'scene-library',
  };

  // --- Gestion de la navigation par onglets & outil actif centralisé (CORRECTIF DESARMEMENT §3.1) ---
  const tabButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    container.querySelectorAll('.gm-tab-btn')
  );
  const tabPanes = /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll('.gm-tab-pane'));

  /** @type {'none'|'fog-reveal'|'fog-hide'|'wall-draw'|'wall-delete'|'link-place'|'template-place'|'token-place'|'ping'|'measure'|'light-place'|'light-delete'} */
  let activeToolName = 'none';

  /**
   * Pion généré, en attente de la case où le MJ va taper (UX-08).
   *
   * ⚠ Il vit **ici** et non dans `tokenMaker` : le générateur sert aussi à `prepare.html`, qui
   * n'a ni carte ni geste de pose. Lui donner un état d'armement obligerait à le neutraliser
   * là-bas, et un état qu'on doit désactiver ailleurs finit toujours par s'y rallumer.
   *
   * @type {import('../../core/types.js').Token|null}
   */
  let pendingToken = null;

  /**
   * Le pion en attente vient-il de la réserve (UX-14) ou du générateur (UX-08) ?
   *
   * ⭐ **Le geste est le même, et c'est voulu** : sortir un pion de la réserve, c'est le poser
   * quelque part. Seule la mutation finale diffère — `placeTokenFromReserve` au lieu d'`addToken`
   * — parce qu'elle doit retirer le pion de la réserve dans la MÊME transaction. Deux gestes
   * distincts auraient demandé deux armements, donc deux exclusivités mutuelles à tenir.
   */
  let pendingFromReserve = false;

  function clearPendingToken() {
    if (!pendingToken) return;
    const venaitDeLaReserve = pendingFromReserve;
    pendingToken = null;
    pendingFromReserve = false;
    // Un pion de la réserve n'est pas perdu quand on annule : il y est resté tout du long, la
    // réserve n'ayant été touchée qu'à la pose. Le dire, sinon le MJ le croit égaré.
    tokenMaker?.setStatus(
      venaitDeLaReserve
        ? 'Pose annulée : le pion est resté en réserve.'
        : 'Pose annulée : le pion généré n’a pas été ajouté.',
      '#aaa'
    );
    updateReserveDrawer();
  }

  /** @type {ReturnType<typeof createWallEditor>|null} */
  let wallEditor = null;
  /** @type {ReturnType<typeof createLinkEditor>|null} */
  let linkEditor = null;
  /** @type {ReturnType<typeof createTemplateTools>|null} */
  let templateTools = null;
  /** @type {ReturnType<typeof createFogTools>|null} */
  let fogTools = null;

  /**
   * Le rappel d'outil armé (C-10) : visible dès qu'un outil est armé, quel que soit le mode, et
   * la carte prend son liseré de laiton en même temps. Les deux suivent la seule classe
   * gm-armed du conteneur de la carte (voir css/gm.css).
   */
  function updateActiveToolBanner() {
    const armed = activeToolName !== 'none';
    canvasContainer.classList.toggle('gm-armed', armed);
    if (activeToolText) activeToolText.textContent = armed ? TOOL_LABELS[activeToolName] || activeToolName : '';
    if (activeToolHint) activeToolHint.textContent = TOOL_HINTS[activeToolName] ?? '';
  }

  disarmActiveToolBtn?.addEventListener('click', () => {
    disarmActiveTool();
  }, { signal: listeners.signal });

  function updateRailToolIndicators() {
    const armedBtnId = TOOL_RAIL_BUTTON[activeToolName];
    for (const btn of railButtons) btn.classList.toggle('gm-tool-armed', btn.id === armedBtnId);
  }

  function getActiveToolName() {
    return activeToolName;
  }

  /** Reflète l'état d'armement du ping sur son bouton ; l'indice vit dans le rappel d'outil armé. */
  function updatePingButton() {
    const btn = /** @type {HTMLButtonElement|null} */ (rail.querySelector('#gm-ping-arm'));
    if (!btn) return;
    btn.setAttribute('aria-pressed', activeToolName === 'ping' ? 'true' : 'false');
  }

  function updateMeasureButton() {
    const btn = /** @type {HTMLButtonElement|null} */ (rail.querySelector('#gm-measure-arm'));
    if (!btn) return;
    btn.setAttribute('aria-pressed', activeToolName === 'measure' ? 'true' : 'false');
  }

  /**
   * Reflète l'armement des deux outils de l'éditeur de lampes (C-2, tranche 2) sur leurs
   * boutons — même patron que `updatePingButton`/`updateMeasureButton` : ce sont des gestes à
   * un seul tap, sans brouillon, donc pas de composant dédié — l'armement seul est ici, la
   * mutation vit dans `js/app/gm.js` (comme `wall-delete`).
   */
  function updateLightToolButtons() {
    const placeBtn = /** @type {HTMLButtonElement|null} */ (rail.querySelector('#gm-light-place-arm'));
    const deleteBtn = /** @type {HTMLButtonElement|null} */ (rail.querySelector('#gm-light-delete-arm'));
    placeBtn?.setAttribute('aria-pressed', activeToolName === 'light-place' ? 'true' : 'false');
    deleteBtn?.setAttribute('aria-pressed', activeToolName === 'light-delete' ? 'true' : 'false');
  }

  /**
   * Vrai pendant l'exécution de `setActiveTool`, pour détecter les rappels réentrants.
   * @type {boolean}
   */
  let settingActiveTool = false;

  /** @param {'none'|'fog-reveal'|'fog-hide'|'wall-draw'|'wall-delete'|'link-place'|'template-place'|'token-place'|'ping'|'measure'|'light-place'|'light-delete'} toolName */
  function setActiveTool(toolName) {
    if (activeToolName === toolName) return;

    if (settingActiveTool && toolName === 'none') return;

    const prevTool = activeToolName;
    activeToolName = toolName;
    settingActiveTool = true;
    try {
      applyToolTransition(prevTool, toolName);
    } finally {
      settingActiveTool = false;
    }
  }

  /**
   * @param {string} prevTool
   * @param {string} toolName
   */
  function applyToolTransition(prevTool, toolName) {
    if (prevTool === 'ping' || toolName === 'ping') updatePingButton();
    if (prevTool === 'measure' || toolName === 'measure') updateMeasureButton();
    if (prevTool.startsWith('light-') || toolName.startsWith('light-')) updateLightToolButtons();

    if (prevTool.startsWith('fog-') && !toolName.startsWith('fog-')) {
      fogTools?.disarm();
    }
    if (prevTool.startsWith('wall-') && !toolName.startsWith('wall-')) {
      wallEditor?.setArmed(false);
    }
    if (prevTool === 'link-place' && toolName !== 'link-place' && linkEditor?.isArmed()) {
      linkEditor.setArmed(false);
    }
    if (prevTool === 'template-place' && toolName !== 'template-place') {
      templateTools?.disarm();
    }
    // ⭐ Le pion en attente meurt avec l'armement, quelle qu'en soit la cause : changement
    // d'onglet, autre outil armé, Échap, ou pose effectuée. Le garder vivant après un
    // désarmement le ferait ressurgir au prochain armement, des minutes plus tard, avec un nom
    // et une image que le MJ ne relierait plus à rien.
    if (prevTool === 'token-place' && toolName !== 'token-place') {
      clearPendingToken();
    }

    if (toolName === 'none') {
      if (fogTools?.getActiveTool() !== 'none') fogTools?.disarm();
      if (wallEditor?.isArmed()) wallEditor?.setArmed(false);
      if (linkEditor?.isArmed()) linkEditor?.setArmed(false);
      if (templateTools?.isArmed()) templateTools?.disarm();
    }

    updateRailToolIndicators();
    updateActiveToolBanner();
    requestRender();
  }

  function disarmActiveTool() {
    setActiveTool('none');
  }

  // --- Palette d'outil (C-10) ---
  //
  // ⭐ La palette EST l'ancien onglet d'outil, et elle en hérite la règle du CdC : désarmement au
  // changement d'onglet. L'ouvrir, en ouvrir une autre ou la fermer désarme l'outil armé — c'est
  // ce désarmement qui abandonne un tracé de mur en cours, exactement comme le faisait le
  // changement d'onglet (wallEditor.setArmed(false) vide le brouillon). Une seule ouverte à la fois.
  //
  // ⛔ Ce qui ne la ferme PAS : Échap (il désarme seulement), la bascule de mode (qui ne désarme
  // jamais, C-1), un clic d'onglet de l'inspecteur (qui désarme, A3), ni l'armement d'un geste du
  // rail (l'exclusivité mutuelle reste celle de setActiveTool).

  /** @type {string|null} */
  let openPaletteName = null;

  /** @param {string|null} name */
  function showPalette(name) {
    openPaletteName = name;
    palette.hidden = name === null;
    paletteTitle.textContent = name ? PALETTE_TITLES[name] ?? '' : '';
    for (const pane of palettePanes) pane.hidden = pane.id !== `palette-${name}`;
    for (const btn of paletteButtons) {
      btn.setAttribute('aria-pressed', String(name !== null && btn.dataset.palette === name));
    }
  }

  /** @param {string|null} name La palette à ouvrir, ou `null` pour la fermer */
  function setPalette(name) {
    if (activeToolName !== 'none') disarmActiveTool();
    showPalette(name);
  }

  for (const btn of paletteButtons) {
    btn.addEventListener(
      'click',
      () => {
        const name = btn.dataset.palette ?? null;
        setPalette(openPaletteName === name ? null : name);
      },
      { signal: listeners.signal }
    );
  }
  palette
    .querySelector('#gm-palette-close')
    ?.addEventListener('click', () => setPalette(null), { signal: listeners.signal });
  rail
    .querySelector('#gm-rail-select')
    ?.addEventListener('click', () => setPalette(null), { signal: listeners.signal });

  /**
   * Routine privée de bascule visuelle d'onglet (inaccessible depuis l'extérieur).
   * Utilisée par activateTab (après désarmement A3) et par setMode (sans désarmer l'outil armé).
   *
   * @param {HTMLElement} btn
   */
  function applyTabSelection(btn) {
    const targetTab = btn.dataset.tab;
    if (!targetTab) return;

    for (const [modeName, tabs] of Object.entries(MODE_TABS)) {
      if (tabs.includes(targetTab)) {
        lastActiveTabByMode[/** @type {'play'|'prep'} */ (modeName)] = targetTab;
      }
    }

    tabButtons.forEach((button) => {
      const isTarget = button === btn;
      button.setAttribute('aria-selected', String(isTarget));
      /** @type {HTMLButtonElement} */ (button).tabIndex = isTarget ? 0 : -1;
      if (isTarget) button.classList.add('active');
      else button.classList.remove('active');
    });

    tabPanes.forEach((pane) => {
      const isTarget = pane.id === `tab-content-${targetTab}`;
      /** @type {HTMLElement} */ (pane).hidden = !isTarget;
    });
  }

  /**
   * Activation d'onglet par clic ou raccourci utilisateur (applique sans exception l'amendement A3).
   * @param {HTMLElement} btn
   */
  function activateTab(btn) {
    // Désarmer l'outil actif à tout changement d'onglet (Amendement A3)
    if (activeToolName !== 'none') {
      disarmActiveTool();
    }
    applyTabSelection(btn);
  }

  /**
   * Bascule entre les modes « Jouer » et « Préparer ».
   * ⛔ Ne désarme JAMAIS l'outil actif.
   *
   * @param {'play'|'prep'} mode
   */
  function setMode(mode) {
    if (mode !== 'play' && mode !== 'prep') return;
    currentMode = mode;

    playModeBtn?.setAttribute('aria-pressed', String(mode === 'play'));
    prepModeBtn?.setAttribute('aria-pressed', String(mode === 'prep'));

    const allowedTabs = MODE_TABS[mode];

    // Afficher ou masquer les boutons d'onglets
    tabButtons.forEach((btn) => {
      const tabName = btn.dataset.tab;
      btn.hidden = !(tabName && allowedTabs.includes(tabName));
    });

    // Vérifier si l'onglet actuellement sélectionné est visible dans le nouveau mode
    const currentActiveBtn = Array.from(tabButtons).find((b) => b.classList.contains('active'));
    const currentActiveTab = currentActiveBtn?.dataset.tab;

    if (!currentActiveTab || !allowedTabs.includes(currentActiveTab)) {
      // Activer l'onglet mémorisé pour ce mode (ou le premier onglet) via la routine privée sans désarmer
      let targetTab = lastActiveTabByMode[mode];
      if (!allowedTabs.includes(targetTab)) {
        targetTab = allowedTabs[0];
      }
      const targetBtn = Array.from(tabButtons).find((b) => b.dataset.tab === targetTab);
      if (targetBtn) {
        applyTabSelection(targetBtn);
      }
    } else {
      currentActiveBtn.tabIndex = 0;
    }
  }

  playModeBtn?.addEventListener('click', () => setMode('play'), { signal: listeners.signal });
  prepModeBtn?.addEventListener('click', () => setMode('prep'), { signal: listeners.signal });

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(/** @type {HTMLElement} */ (btn)), {
      signal: listeners.signal,
    });
    btn.addEventListener(
      'keydown',
      /** @param {KeyboardEvent} event */ (event) => {
        const visibleTabs = Array.from(tabButtons).filter((b) => !b.hidden);
        const currentIndex = visibleTabs.indexOf(/** @type {HTMLButtonElement} */ (btn));
        if (currentIndex === -1) return;
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % visibleTabs.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = visibleTabs.length - 1;
        } else {
          return;
        }
        event.preventDefault();
        const nextTab = /** @type {HTMLElement} */ (visibleTabs[nextIndex]);
        nextTab.focus();
        activateTab(nextTab);
      },
      { signal: listeners.signal }
    );
  });

  // --- Montage des sous-composants ---
  const sceneLibraryMount = /** @type {HTMLElement} */ (container.querySelector('#scene-library-mount'));
  const tokenLibraryMount = /** @type {HTMLElement} */ (container.querySelector('#token-library-mount'));
  const uvttMount = /** @type {HTMLElement} */ (container.querySelector('#import-uvtt-mount'));
  const imageMount = /** @type {HTMLElement} */ (container.querySelector('#import-image-mount'));
  const tokenMakerMount = /** @type {HTMLElement} */ (container.querySelector('#token-maker-mount'));
  const imageShareMount = /** @type {HTMLElement} */ (container.querySelector('#image-share-mount'));
  const fogToolsMount = /** @type {HTMLElement} */ (palette.querySelector('#fog-tools-mount'));

  createImportPanel(uvttMount, { mode: 'uvtt' });
  const importPanelImage = createImportPanel(imageMount, {
    mode: 'image',
    transport,
    onClearFog: () => fogTools?.clearFog(),
  });

  const imageShare = imageShareMount ? createImageShare(imageShareMount, { transport }) : null;

  const wallEditorMount = /** @type {HTMLElement} */ (palette.querySelector('#wall-editor-mount'));
  const linkEditorMount = /** @type {HTMLElement} */ (palette.querySelector('#link-editor-mount'));
  const templateToolsMount = /** @type {HTMLElement} */ (palette.querySelector('#template-tools-mount'));

  // Initialisation du composant FogTools
  fogTools = fogToolsMount
    ? createFogTools(fogToolsMount, {
        getActiveLevelId: () => store.getActiveLevelId(),
        getExploredFog,
        scheduleFogPublish,
        requestRender,
        onToolChange: (tool) => {
          if (tool === 'reveal') setActiveTool('fog-reveal');
          else if (tool === 'hide') setActiveTool('fog-hide');
          else setActiveTool('none');
        },
      })
    : null;

  // Initialisation du composant WallEditor
  if (wallEditorMount) {
    wallEditor = createWallEditor(wallEditorMount, {
      getActiveLevelId: () => store.getActiveLevelId(),
      onAddWall: (levelId, wall) => {
        store.addWall(levelId, wall);
        options.onAddWall?.(levelId, wall);
      },
      onRemoveWall: (levelId, wall) => {
        const removed = store.removeWall(levelId, wall);
        if (removed) {
          options.onRemoveWall?.(levelId, wall);
        }
        return removed;
      },
      onArmChange: (/** @type {boolean} */ armed, /** @type {'tracer'|'supprimer'|undefined} */ subMode = 'tracer') => {
        if (armed) {
          setActiveTool(subMode === 'supprimer' ? 'wall-delete' : 'wall-draw');
        } else {
          setActiveTool('none');
        }
      },
      requestRender,
    });
  }

  if (linkEditorMount) {
    linkEditor = createLinkEditor(linkEditorMount, {
      getLevels: () => store.getLevelSummaries(),
      getLinks: () => store.getLinks(),
      onAdd: (link) => { store.addLink(link); options.onAddLink?.(link); },
      onRemove: (linkId) => { if (store.removeLink(linkId)) options.onRemoveLink?.(linkId); },
      onArmChange: (armed) => setActiveTool(armed ? 'link-place' : 'none'),
      requestRender,
    });
  }

  // Initialisation du composant TemplateTools
  if (templateToolsMount) {
    templateTools = createTemplateTools(templateToolsMount, {
      getActiveLevelId: () => store.getActiveLevelId(),
      onClearTemplates: (levelId) => {
        store.clearTemplates(levelId);
        transport?.publish({
          type: 'template.clear',
          payload: { levelId },
          at: Date.now(),
          by: 'gm',
        });
      },
      // ⚠ `getRenderSnapshot` et **pas** `getState` : ce dernier fait un `structuredClone` puis un
      // `deepFreeze` de toute la campagne — murs et portails compris — à chaque notification du
      // store, y compris quand l'onglet Gabarits est fermé. Mesuré : 0,50 ms contre 0,002 ms.
      // C'est la faute déjà commise par la barre d'étage du lot 3, documentée sur `getCampaign`.
      getTemplates: () => store.getRenderSnapshot().campaign?.templates ?? [],
      // ⚠ Publier **seulement si le store a bien retiré quelque chose**, comme `onRemoveWall`
      // juste au-dessus. Un événement émis sur une absence ferait voyager un retrait qui n'a
      // pas eu lieu, et le rejeu d'un lot le rendrait indistinguable d'un vrai.
      onRemoveTemplate: (templateId) => {
        if (!store.removeTemplate(templateId)) return;
        transport?.publish({
          type: 'template.remove',
          payload: { templateId },
          at: Date.now(),
          by: 'gm',
        });
      },
      onArmChange: (armed) => {
        if (armed) {
          setActiveTool('template-place');
        } else {
          setActiveTool('none');
        }
      },
      requestRender,
    });
  }

  // ⭐ **Armer la pose d'un pion, un seul geste, trois entrées (UX-08).** Le pion partait en
  // `cell: {a: 0, b: 0}` codé en dur, donc un PNJ créé en séance apparaissait à l'angle de la
  // carte — souvent hors écran, souvent sous le brouillard — et il fallait le glisser jusqu'à sa
  // place sous les yeux de la table. C'est le comportement de tout le reste du panneau : le
  // gabarit, le ping, la pose d'extrémité A d'une liaison.
  //
  // ⛔ L'armement passe par `setActiveTool` et **pas par un mécanisme parallèle** : c'est lui qui
  // garantit l'exclusivité mutuelle, donc qu'armer la pose d'un pion désarme le pinceau de fog,
  // et réciproquement.
  //
  // ⚠ La bibliothèque de pions (« ➕ Instancier ») a été OUBLIÉE lors d'UX-08 : elle a continué à
  // ajouter le pion elle-même, en (0,0), jusqu'à ce que le mainteneur le signale le 09/09/2026.
  // D'où ce helper unique : une quatrième entrée ne pourra plus oublier la règle une troisième
  // fois sans le voir en un coup d'œil.
  /**
   * @param {import('../../core/types.js').Token} token
   * @param {{depuisLaReserve?: boolean}} [opts]
   */
  function armerPose(token, { depuisLaReserve = false } = {}) {
    pendingToken = token;
    pendingFromReserve = depuisLaReserve;
    setActiveTool('token-place');
    tokenMaker.setStatus(`« ${token.label} » prêt : tapez la carte pour le poser.`, '#f5a623');
  }

  const tokenMaker = createTokenMaker(tokenMakerMount, {
    defaultLevelId: store.getActiveLevelId(),
    onGenerate: (token, _dataUrl) => {
      armerPose(token);
    },
  });

  // Initialisation de la bibliothèque de pions
  /** @type {{destroy: () => void} | null} */
  let tokenLibrary = null;
  if (tokenLibraryMount) {
    createTokenLibrary(tokenLibraryMount, { onArmPlacement: (token) => armerPose(token) })
      .then((lib) => {
        tokenLibrary = lib;
      })
      .catch((err) => {
        console.error('Erreur lors du chargement de la bibliothèque de pions :', err);
        tokenLibraryMount.innerHTML = `
          <div class="gm-section gm-err">
            ✗ Erreur : Impossible de charger la bibliothèque de pions.
          </div>
        `;
      });
  }

  // Initialisation de la bibliothèque de cartes
  /** @type {{destroy: () => void} | null} */
  let sceneLibrary = null;
  createSceneLibrary(sceneLibraryMount, { transport })
    .then((lib) => {
      sceneLibrary = lib;
    })
    .catch((err) => {
      console.error('Erreur lors du chargement de la bibliothèque de cartes :', err);
      sceneLibraryMount.innerHTML = `
        <div class="gm-section gm-err">
          ✗ Erreur : Impossible de charger la bibliothèque de cartes.
        </div>
      `;
    });

  // --- Réglages de la grille ---
  const gridVisibleInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-visible'));
  const gridTypeSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#grid-type'));
  const gridColorInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-color'));
  const gridOpacityInput = /** @type {HTMLInputElement} */ (container.querySelector('#grid-opacity'));
  const gridOpacityVal = /** @type {HTMLElement} */ (container.querySelector('#grid-opacity-val'));

  /**
   * Configuration de grille lue dans les champs, au pavage donné.
   *
   * @param {import('../../core/types.js').GridType} type
   */
  function gridConfigFromUI(type) {
    const activeLvl = store.getActiveLevel();
    return {
      visible: gridVisibleInput.checked,
      type,
      color: gridColorInput.value,
      opacity: parseFloat(gridOpacityInput.value),
      offsetX: activeLvl?.grid?.offsetX ?? 0,
      offsetY: activeLvl?.grid?.offsetY ?? 0,
    };
  }

  /**
   * Couleur, opacité, visibilité : rien de tout cela ne touche aux dimensions (C-16).
   *
   * ⚠ Le pavage publié est celui de l'ÉTAGE, pas celui de la liste. Pendant qu'un changement de
   * pavage attend les dimensions de l'image, la liste annonce déjà le nouveau ; publier sa valeur
   * ici ferait passer le type sans les dimensions — exactement le défaut que C-16 corrige.
   */
  function updateGridFromUI() {
    const gridConfig = gridConfigFromUI(store.getActiveLevel()?.grid?.type ?? 'square');
    gridOpacityVal.textContent = String(gridConfig.opacity);

    store.updateActiveLevel({ grid: gridConfig });

    const activeLevel = store.getActiveLevel();
    if (transport && activeLevel) {
      transport.publish({
        type: 'level.grid',
        payload: {
          levelId: activeLevel.id,
          grid: gridConfig,
        },
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  /** Jeton du dernier changement de pavage demandé : seul le plus récent s'applique. */
  let jetonPavage = 0;

  /**
   * Change le pavage de l'étage actif sans toucher à la carte (C-16, `QUESTIONS-EN-ATTENTE.md`).
   *
   * Le nombre de rangées se recalcule depuis l'image au pas de la nouvelle grille ; les pions
   * gardent leur case, ceux que la grille ne contient plus partent en réserve, et le brouillard de
   * l'étage repart de zéro — son masque était calé sur l'ancien pavage. Même enchaînement que le
   * remplacement de carte de `importPanel.js` : l'étage, puis un `token.reserve` par pion rangé,
   * puis le brouillard.
   */
  async function updateGridTypeFromUI() {
    // ⛔ Lu depuis le champ, jamais figé. Cette ligne a valu `'square'` en dur pendant tout le
    // temps où `HexGrid` n'existait pas ; la rendre constante à nouveau ferait de la liste un
    // décor qui ne change rien, ce qu'aucune vérification d'affichage ne verrait.
    const type = /** @type {import('../../core/types.js').GridType} */ (
      gridTypeSelect.value === 'hex' ? 'hex' : 'square'
    );
    const levelId = store.getActiveLevelId();
    const avant = store.getActiveLevel();
    if (!levelId || !avant) return;

    const jeton = ++jetonPavage;
    const imageSize = await naturalImageSize(avant.imageUrl);
    // Un second changement, ou un changement d'étage, est arrivé pendant le chargement de
    // l'image : celui-ci est périmé, et l'appliquer écraserait le plus récent.
    if (jeton !== jetonPavage || store.getActiveLevelId() !== levelId) return;

    const level = store.getActiveLevel();
    if (!level) return;
    const { widthCells, heightCells } = cellDimensionsForGridType(level, type, imageSize);
    const gridConfig = gridConfigFromUI(type);

    /** @type {string[]} */
    let reservedTokenIds;
    try {
      reservedTokenIds = store.regridLevel(levelId, { grid: gridConfig, widthCells, heightCells });
    } catch (err) {
      // La liste revient au pavage réel : elle ne doit pas annoncer un changement refusé.
      gridTypeSelect.value = store.getActiveLevel()?.grid?.type ?? 'square';
      console.error(
        `Changement de pavage refusé : ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    if (transport) {
      await transport.publish({
        type: 'level.grid',
        payload: { levelId, grid: gridConfig, widthCells, heightCells },
        at: Date.now(),
        by: 'gm',
      });
      for (const tokenId of reservedTokenIds) {
        await transport.publish({
          type: 'token.reserve',
          payload: { tokenId },
          at: Date.now(),
          by: 'gm',
        });
      }
    }

    // Le changement local a eu lieu : le brouillard suit l'état d'ici, publié ou non.
    fogTools?.clearFog();
  }

  gridVisibleInput.addEventListener('change', updateGridFromUI, { signal: listeners.signal });
  gridTypeSelect.addEventListener('change', () => void updateGridTypeFromUI(), { signal: listeners.signal });
  gridColorInput.addEventListener('input', updateGridFromUI, { signal: listeners.signal });
  gridOpacityInput.addEventListener('input', updateGridFromUI, { signal: listeners.signal });

  // Synchronisation initiale des champs de grille depuis le store si un étage est présent
  const activeLvl = store.getActiveLevel();
  if (activeLvl && activeLvl.grid) {
    gridVisibleInput.checked = activeLvl.grid.visible ?? true;
    gridTypeSelect.value = activeLvl.grid.type || 'square';
    gridColorInput.value = activeLvl.grid.color || '#000000';
    gridOpacityInput.value = String(activeLvl.grid.opacity ?? 0.25);
    gridOpacityVal.textContent = String(activeLvl.grid.opacity ?? 0.25);
  }

  // --- Déconnecter les autres sessions MJ ---
  //
  // Le libellé porte le compte, et ce n'est pas décoratif : une éviction est irréversible pour
  // celui qui la subit, donc le MJ doit voir **combien** de postes il congédie avant de le
  // faire — et voir « aucun autre » lui évite de chercher un concurrent qui n'existe pas.
  // Le compte se relit à chaque affichage plutôt que de s'abonner à la présence : un bouton
  // dont l'état ne bouge qu'au moment où on le regarde suffit, là où un abonnement de plus
  // serait un abonnement de plus à défaire.
  const evictOthersBtn = /** @type {HTMLButtonElement} */ (
    topbar.querySelector('#gm-evict-others')
  );

  function refreshEvictButton() {
    if (!evictOthersBtn) return;
    const others = getOtherGmSessions();
    evictOthersBtn.textContent = others.length === 0 ? 'Aucun autre MJ' : `Autres MJ (${others.length})`;
    evictOthersBtn.disabled = others.length === 0;
  }

  evictOthersBtn?.addEventListener(
    'click',
    () => {
      const others = getOtherGmSessions();
      if (others.length === 0) {
        refreshEvictButton();
        return;
      }
      const liste = others.map((c) => `• ${c.label || c.clientId}`).join('\n');
      if (
        !window.confirm(
          `Déconnecter ${others.length} autre(s) session(s) MJ ?\n\n${liste}\n\n` +
            `Ces écrans cesseront de recevoir et de publier la partie. La vue joueurs n'est pas ` +
            `touchée.\n\nUn appareil en veille ou hors réseau ne se déconnectera qu'à son retour.`
        )
      ) {
        return;
      }
      onEvictOtherGms();
      refreshEvictButton();
    },
    { signal: listeners.signal }
  );

  // Rafraîchi à l'ouverture du panneau et quand la fenêtre reprend le focus — les présences
  // ont pu apparaître ou périmer pendant qu'on regardait ailleurs.
  refreshEvictButton();
  window.addEventListener('focus', refreshEvictButton, { signal: listeners.signal });

  // --- Quitter la session ---
  //
  // Trois gestes, et surtout PAS de `resetStore()` : celui-ci notifierait les abonnés, donc
  // déclencherait `saveToLocalStorage` avec une campagne nulle, laquelle **supprime**
  // `rpg_campaign_<session>` (js/state/store.js). Quitter une session effacerait alors la
  // campagne qu'on vient de quitter. La page est déchargée juste après de toute façon, et
  // les données restent en place pour qui retape le code.
  const leaveSessionBtn = /** @type {HTMLButtonElement} */ (
    topbar.querySelector('#gm-leave-session')
  );
  leaveSessionBtn?.addEventListener(
    'click',
    () => {
      const code = sessionId || 'en cours';
      if (!window.confirm(`Quitter la session ${code} ?\n\nLa campagne reste enregistrée : retaper ce code y revient.`)) {
        return;
      }
      try {
        transport?.disconnect();
      } catch (err) {
        // Un transport déjà tombé ne doit pas empêcher de partir.
        console.warn('Déconnexion du transport en quittant la session :', err);
      }
      sessionStorage.removeItem(GM_SESSION_STORAGE_KEY);
      window.location.href = 'index.html';
    },
    { signal: listeners.signal }
  );

  // --- Contrôle d'élévation du pion sélectionné ---
  const tokenElevationInput = /** @type {HTMLInputElement} */ (container.querySelector('#token-elevation'));
  const tokenElevationLabel = /** @type {HTMLElement} */ (container.querySelector('#token-elevation-label'));

  function updateElevationUIFromStore() {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken) {
      tokenElevationInput.disabled = true;
      tokenElevationInput.value = '0';
      tokenElevationLabel.textContent = '(aucun pion sélectionné)';
    } else {
      tokenElevationInput.disabled = false;
      tokenElevationInput.value = String(selectedToken.elevation ?? 0);
      tokenElevationLabel.textContent = selectedToken.label
        ? `Pion : ${selectedToken.label}`
        : `Pion ID : ${selectedToken.id}`;
    }
  }

  function handleElevationChange() {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken) return;
    const val = parseFloat(tokenElevationInput.value);
    if (!Number.isFinite(val)) return;

    if (selectedToken.elevation === val) return;

    store.updateToken(selectedToken.id, { elevation: val });

    if (transport) {
      transport.publish({
        type: 'token.elevation',
        payload: {
          tokenId: selectedToken.id,
          elevation: val,
        },
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  // `change` seul, jamais `input`. Sur `input`, chaque frappe publiait un
  // `token.elevation` : saisir « 12 » faisait passer le pion à +1 puis +12 sur les
  // trois écrans, et chaque frappe coûtait deux validations de la campagne entière
  // (celle d'`updateToken`, puis celle de `saveToLocalStorage`) plus une écriture
  // LocalStorage. Le CdC §7 classe cet événement « ponctuel », et CONVENTIONS.md
  // pose « aucune écriture haute fréquence ».
  tokenElevationInput.addEventListener('change', handleElevationChange, { signal: listeners.signal });

  updateElevationUIFromStore();

  // --- Édition et suppression du pion sélectionné ---
  const tokenEditLabel = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-label'));
  const tokenEditKind = /** @type {HTMLSelectElement} */ (container.querySelector('#token-edit-kind'));
  const tokenEditBorderColor = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-border-color'));
  const tokenEditBorderSwatches = mountBorderSwatches(tokenEditBorderColor);
  const tokenEditSizeCells = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-size-cells'));
  const tokenEditSpeedCells = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-speed-cells'));
  const tokenEditHidden = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-hidden'));
  const tokenEditPlayerMovable = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-player-movable'));
  const tokenEditLocked = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-locked'));
  const tokenEditVisionDim = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-vision-dim'));
  const tokenEditTorch = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-torch'));
  const tokenEditTorchRange = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-torch-range'));
  const tokenEditStatus = /** @type {HTMLElement} */ (container.querySelector('#token-edit-status'));
  const btnDeleteToken = /** @type {HTMLButtonElement} */ (container.querySelector('#btn-delete-token'));
  const btnReserveToken = /** @type {HTMLButtonElement} */ (container.querySelector('#btn-reserve-token'));
  const reserveDrawer = /** @type {HTMLElement|null} */ (container.querySelector('#gm-reserve-drawer'));
  const reserveList = /** @type {HTMLElement|null} */ (container.querySelector('#gm-reserve-list'));
  const reserveStackingNotice = /** @type {HTMLElement|null} */ (container.querySelector('#gm-reserve-stacking-notice'));

  /**
   * Les trois crans de santé, dans les mots du panneau (⛔ interdiction n°4 : un PNJ n'a jamais
   * de PV chiffrés, ni ici ni ailleurs — c'est le chantier Q).
   *
   * @type {Record<string, string>}
   */
  const SANTE_LABEL_FR = { unharmed: 'Indemne', wounded: 'Blessé', critical: 'Critique' };

  /**
   * Reconstruit le tiroir de la réserve (UX-14).
   *
   * ⛔ **La réserve tient des INSTANCES, pas des modèles.** Ne pas la confondre avec la
   * bibliothèque de pions, deux onglets plus loin : celle-ci tient des modèles dont on instancie
   * des copies ; la réserve tient *ces pions-là*, ceux qui étaient sur le plateau, avec leurs
   * points de vie, leurs marqueurs et leur histoire. La ligne les affiche pour cette raison —
   * un « Gobelin » sans ses 3 PV restants ne se reconnaît pas.
   */
  /** Signature de la dernière réserve rendue — voir `updateReserveDrawer`. */
  let signatureReserve = /** @type {string|null} */ (null);

  function updateReserveDrawer() {
    if (!reserveDrawer || !reserveList) return;
    const enReserve = store.getReserve();
    // ⛔ Même garde que la liste des gabarits (audit du 22/09, B8) : reconstruire la réserve
    // à chaque notification perdait un clic sur « Poser » tombé entre deux reconstructions.
    const signature = JSON.stringify([enReserve, store.getStackingNormalizationReport()]);
    if (signature === signatureReserve) return;
    signatureReserve = signature;
    reserveDrawer.hidden = enReserve.length === 0;

    // ⭐ Le chargement peut avoir envoyé des pions en réserve dans le dos du mainteneur (une
    // case, un pion — C-6) ; le `console.warn` de `resolveStackedTokens` est invisible sans les
    // outils de développement ouverts, donc c'est ici, là où ces pions apparaissent, qu'on le
    // dit. La ligne disparaît dès que le rapport est vide — sinon un avertissement d'une
    // campagne précédente resterait affiché après coup.
    if (reserveStackingNotice) {
      const normalises = store.getStackingNormalizationReport();
      if (normalises.length > 0) {
        const noms = normalises.map((p) => p.label).join(', ');
        reserveStackingNotice.textContent =
          normalises.length === 1
            ? `1 pion envoyé en réserve au chargement (${noms}) : une case ne porte plus qu'un pion.`
            : `${normalises.length} pions envoyés en réserve au chargement (${noms}) : une case ne porte plus qu'un pion.`;
        reserveStackingNotice.hidden = false;
      } else {
        reserveStackingNotice.hidden = true;
      }
    }

    if (enReserve.length === 0) {
      reserveList.replaceChildren();
      return;
    }

    reserveList.replaceChildren(
      ...enReserve.map((pion) => {
        const ligne = document.createElement('div');
        ligne.className = 'gm-reserve-row';
        ligne.dataset.tokenId = pion.id;

        const pastille = document.createElement('span');
        pastille.className = 'gm-reserve-swatch';
        // La couleur du pion est une donnée, pas un choix de thème : elle seule reste en ligne.
        pastille.style.background = pion.borderColor;

        const texte = document.createElement('span');
        texte.className = 'gm-reserve-text';
        // ⛔ **Interdiction n°4 : JAMAIS de PV chiffrés pour un PNJ**, et l'ordre des branches est
        // tout ce qui la tient. Un PNJ *porte* souvent des `hp` — le panneau les édite — mais ce
        // qu'on en montre est l'état de santé à trois crans, sans jamais dériver l'un de l'autre
        // (chantier Q). Tester `hp` en premier suffisait à trahir « 3/7 » dans le tiroir, et c'est
        // le test qui l'a attrapé, pas la relecture.
        const vitalite =
          pion.kind === 'npc'
            ? ` — ${SANTE_LABEL_FR[pion.health] ?? pion.health}`
            : pion.hp
            ? ` — ${pion.hp.current}/${pion.hp.max} PV`
            : '';
        texte.textContent = `${pion.label}${vitalite}`;
        texte.title = texte.textContent;

        const poser = document.createElement('button');
        poser.type = 'button';
        poser.className = 'gm-reserve-place gm-btn--sm';
        poser.dataset.tokenId = pion.id;
        poser.textContent = 'Poser';
        poser.addEventListener('click', () => {
          // ⭐ Exactement l'armement d'UX-08, avec la même exclusivité mutuelle : sortir un pion
          // de la réserve, c'est le poser quelque part.
          armerPose(pion, { depuisLaReserve: true });
        });

        ligne.append(pastille, texte, poser);
        return ligne;
      })
    );
  }

  // ── Liste des pions de l'étage (C-10, tranche 3) ─────────────────────────────────────────
  const tokenSheet = /** @type {HTMLElement} */ (container.querySelector('.token-elevation-section'));
  const roster = /** @type {HTMLElement} */ (container.querySelector('#gm-roster'));
  const rosterList = /** @type {HTMLElement} */ (container.querySelector('#gm-roster-list'));
  const rosterCount = /** @type {HTMLElement} */ (container.querySelector('#gm-roster-count'));
  const rosterEmpty = /** @type {HTMLElement} */ (container.querySelector('#gm-roster-empty'));
  const rosterBack = /** @type {HTMLButtonElement} */ (container.querySelector('#gm-roster-back'));

  /** Signature de la dernière liste rendue — même garde que la réserve, pour la même raison. */
  let signatureRoster = /** @type {string|null} */ (null);

  /**
   * Reconstruit la liste des pions de l'étage actif : PJ d'abord, puis PNJ, puis par libellé.
   *
   * ⛔ Tout texte passe par `textContent` : le libellé d'un pion est une donnée, et il peut
   * venir d'un autre poste.
   */
  function updateRoster() {
    const activeLevelId = store.getActiveLevelId();
    const pions = (store.getCampaign()?.tokens ?? [])
      .filter((t) => t.levelId === activeLevelId)
      .sort((p, q) => {
        if (p.kind !== q.kind) return p.kind === 'pc' ? -1 : 1;
        return (p.label ?? '').localeCompare(q.label ?? '', 'fr');
      });
    const signature = JSON.stringify(pions);
    if (signature === signatureRoster) return;
    signatureRoster = signature;

    rosterCount.textContent = String(pions.length);
    rosterEmpty.hidden = pions.length > 0;
    rosterList.replaceChildren(
      ...pions.map((pion) => {
        const ligne = document.createElement('button');
        ligne.type = 'button';
        ligne.className = 'gm-roster-row';
        ligne.dataset.tokenId = pion.id;

        const pastille = document.createElement('span');
        pastille.className = pion.hidden ? 'gm-roster-avatar gm-roster-avatar--hidden' : 'gm-roster-avatar';
        // La couleur du pion est une donnée, pas un choix de thème : elle seule reste en ligne.
        pastille.style.borderColor = pion.borderColor;
        if (pion.imageUrl) {
          const image = document.createElement('img');
          image.src = pion.imageUrl;
          image.alt = '';
          pastille.append(image);
        } else {
          pastille.textContent = initiales(pion.label ?? '');
        }

        const texte = document.createElement('span');
        texte.className = 'gm-roster-text';
        const nom = document.createElement('span');
        nom.className = 'gm-roster-name';
        nom.textContent = pion.label || 'Sans nom';
        const sous = document.createElement('span');
        sous.className = 'gm-roster-sub gm-muted';
        sous.textContent =
          (pion.kind === 'pc' ? 'PJ' : 'PNJ') +
          (pion.hidden ? ' · masqué' : '') +
          (pion.mounted === true ? ' · à cheval' : '') +
          (pion.locked ? ' · verrouillé' : '');
        texte.append(nom, sous);

        const valeur = document.createElement('span');
        valeur.className = 'gm-roster-value';
        // ⛔ Même ordre de branches que la réserve et la barre de vitalité : jamais de PV chiffrés
        // pour un PNJ (interdiction n°4), et son cran ne s'affiche que s'il a des PV, comme dans
        // la barre de vitalité.
        valeur.textContent =
          pion.kind === 'npc'
            ? pion.hp
              ? SANTE_LABEL_FR[pion.health] ?? pion.health
              : ''
            : pion.hp
            ? `${pion.hp.current} / ${pion.hp.max}`
            : '';

        ligne.append(pastille, texte, valeur);
        return ligne;
      })
    );
  }

  /**
   * Deux lettres pour la pastille d'un pion sans image.
   *
   * @param {string} label
   */
  function initiales(label) {
    const mots = label.trim().split(/\s+/).filter(Boolean);
    if (mots.length === 0) return '?';
    return mots
      .slice(0, 2)
      .map((mot) => Array.from(mot)[0])
      .join('')
      .toUpperCase();
  }

  // Un clic de ligne fait EXACTEMENT ce que fait le clic sur la carte : sélectionner, sans rien
  // publier. Délégué au conteneur, pour survivre aux reconstructions de la liste.
  rosterList.addEventListener(
    'click',
    (event) => {
      const cible = event.target instanceof Element ? event.target.closest('.gm-roster-row') : null;
      const tokenId = cible instanceof HTMLElement ? cible.dataset.tokenId : undefined;
      if (tokenId) store.selectToken(tokenId);
    },
    { signal: listeners.signal }
  );

  rosterBack.addEventListener('click', () => store.selectToken(null), { signal: listeners.signal });

  const sumMove = /** @type {HTMLElement} */ (container.querySelector('#gm-token-sum-move'));
  const sumVision = /** @type {HTMLElement} */ (container.querySelector('#gm-token-sum-vision'));
  const sumVisibility = /** @type {HTMLElement} */ (container.querySelector('#gm-token-sum-visibility'));
  const sumHp = /** @type {HTMLElement} */ (container.querySelector('#gm-token-sum-hp'));
  const sumMarkers = /** @type {HTMLElement} */ (container.querySelector('#gm-token-sum-markers'));

  /**
   * Les résumés des volets repliables de la fiche, lus du pion et de rien d'autre.
   *
   * @param {import('../../core/types.js').Token|null} pion
   */
  function updateSheetSummaries(pion) {
    if (!pion) {
      for (const el of [sumMove, sumVision, sumVisibility, sumHp, sumMarkers]) el.textContent = '';
      return;
    }
    sumMove.textContent = `${pion.speedCells ?? 1} cases · joueurs : ${pion.playerMovable ? 'oui' : 'non'}`;
    sumVision.textContent =
      `vision ${pion.visionDim ?? 0}` + (pion.emitsLight ? ` · torche ${pion.emitsLight.range}` : '');
    sumVisibility.textContent = pion.hidden ? 'masqué' : 'visible';
    sumHp.textContent = !pion.hp
      ? ''
      : pion.kind === 'npc'
      ? SANTE_LABEL_FR[pion.health] ?? pion.health
      : `${pion.hp.current} / ${pion.hp.max}`;
    const n = (pion.markers ?? []).length;
    sumMarkers.textContent = n === 0 ? 'aucun' : String(n);
  }

  const tokenHpCurrent = /** @type {HTMLInputElement} */ (container.querySelector('#token-hp-current'));
  const tokenHpMax = /** @type {HTMLInputElement} */ (container.querySelector('#token-hp-max'));
  const tokenHealthSection = /** @type {HTMLElement} */ (container.querySelector('#token-health-section'));
  const tokenHealthUnharmed = /** @type {HTMLInputElement} */ (container.querySelector('#token-health-unharmed'));
  const tokenHealthWounded = /** @type {HTMLInputElement} */ (container.querySelector('#token-health-wounded'));
  const tokenHealthCritical = /** @type {HTMLInputElement} */ (container.querySelector('#token-health-critical'));

  const healthRadios = [tokenHealthUnharmed, tokenHealthWounded, tokenHealthCritical];
  const markerCheckboxes = Array.from(
    container.querySelectorAll('.token-marker-checkbox')
  ).map((el) => /** @type {HTMLInputElement} */ (el));

  const tokenEditControls = [
    tokenEditLabel,
    tokenEditKind,
    tokenEditBorderColor,
    tokenEditSizeCells,
    tokenEditSpeedCells,
    tokenEditHidden,
    tokenEditPlayerMovable,
    tokenEditLocked,
    tokenEditVisionDim,
    tokenEditTorch,
    tokenEditTorchRange,
    tokenHpMax,
    ...markerCheckboxes,
  ];

  function updateTokenEditUIFromStore() {
    // ⚠ La barre de vitalité se rafraîchit ICI et nulle part ailleurs : elle lit le même pion
    // sélectionné que l'onglet, au même instant. Lui donner son propre abonnement au store
    // ouvrirait la porte à deux vues du même pion décalées d'une notification.
    updateVitalsBar();
    const selectedToken = store.getSelectedToken();
    const disabled = !selectedToken;
    // La liste sans sélection, la fiche avec : jamais les deux à l'écran.
    roster.hidden = !disabled;
    tokenSheet.hidden = disabled;
    updateSheetSummaries(selectedToken);
    for (const control of tokenEditControls) control.disabled = disabled;
    tokenEditBorderSwatches.refresh();
    btnDeleteToken.disabled = disabled;
    btnReserveToken.disabled = disabled;

    if (!selectedToken) {
      tokenEditLabel.value = '';
      tokenEditStatus.textContent = '';
      tokenHpCurrent.value = '';
      tokenHpMax.value = '';
      tokenHpCurrent.disabled = true;
      tokenHealthSection.hidden = true;
      for (const radio of healthRadios) {
        radio.checked = false;
        radio.disabled = true;
      }
      for (const cb of markerCheckboxes) {
        cb.checked = false;
      }
      return;
    }

    if (selectedToken.hp !== null && selectedToken.hp !== undefined) {
      if (document.activeElement !== tokenHpCurrent) tokenHpCurrent.value = String(selectedToken.hp.current);
      if (document.activeElement !== tokenHpMax) tokenHpMax.value = String(selectedToken.hp.max);
      tokenHpCurrent.disabled = false;
    } else {
      if (document.activeElement !== tokenHpCurrent) tokenHpCurrent.value = '';
      if (document.activeElement !== tokenHpMax) tokenHpMax.value = '';
      tokenHpCurrent.disabled = true;
    }

    if (selectedToken.kind === 'pc') {
      tokenHealthSection.hidden = true;
    } else {
      tokenHealthSection.hidden = false;
      const hpNull = selectedToken.hp === null || selectedToken.hp === undefined;
      const currentHealth = selectedToken.health || 'unharmed';
      for (const radio of healthRadios) {
        radio.disabled = hpNull;
        if (document.activeElement !== radio) {
          radio.checked = !hpNull && radio.value === currentHealth;
        }
      }
    }

    // Ne jamais réécrire le champ que le MJ est en train de remplir. Sans cette garde,
    // une mise à jour venue du réseau — ou notre propre notification de store — écraserait
    // la frappe en cours au caractère près.
    for (const [control, value] of /** @type {[HTMLInputElement|HTMLSelectElement, string][]} */ ([
      [tokenEditLabel, selectedToken.label ?? ''],
      [tokenEditKind, selectedToken.kind],
      [tokenEditBorderColor, selectedToken.borderColor || '#ffffff'],
      [tokenEditSizeCells, String(selectedToken.sizeCells ?? 1)],
      [tokenEditSpeedCells, String(selectedToken.speedCells ?? 1)],
      [tokenEditVisionDim, String(selectedToken.visionDim ?? 0)],
      [tokenEditTorchRange, String(selectedToken.emitsLight?.range ?? TOKEN_TORCH_DEFAULT.range)],
    ])) {
      if (document.activeElement !== control) control.value = value;
    }
    tokenEditBorderSwatches.refresh();
    tokenEditHidden.checked = Boolean(selectedToken.hidden);
    tokenEditPlayerMovable.checked = Boolean(selectedToken.playerMovable);
    tokenEditLocked.checked = Boolean(selectedToken.locked);
    if (document.activeElement !== tokenEditTorch) {
      tokenEditTorch.checked = selectedToken.emitsLight != null;
    }
    // La portée n'a de sens que torche allumée : au-delà du désactivé général (aucun pion
    // sélectionné), elle se redésactive quand la case est décochée — même motif que les PV
    // courants au-dessus, qui se ferment quand `hp` est `null`.
    tokenEditTorchRange.disabled = !tokenEditTorch.checked;

    const activeMarkers = new Set(selectedToken.markers ?? []);
    for (const cb of markerCheckboxes) {
      if (document.activeElement !== cb) {
        cb.checked = activeMarkers.has(/** @type {import('../../core/constants.js').StatusMarker} */ (cb.value));
      }
    }
  }

  /**
   * Applique un patch au pion sélectionné, puis le publie.
   *
   * Le store valide la campagne entière et **lève** si le patch la rend invalide — passer
   * un pion 1×1 en 4×4 au bord de la carte le sort de l'étage. Dans ce cas rien n'a muté,
   * et l'interface doit se remettre d'accord avec le store : afficher encore la valeur
   * refusée laisserait croire à un changement qui n'a pas eu lieu.
   *
   * @param {Partial<import('../../core/types.js').Token>} patch
   */
  function applyTokenPatch(patch) {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken) return;

    try {
      store.updateToken(selectedToken.id, patch);
    } catch (err) {
      tokenEditStatus.className = 'gm-status gm-err';
      tokenEditStatus.textContent = err instanceof Error ? err.message : String(err);
      updateTokenEditUIFromStore();
      return;
    }

    tokenEditStatus.className = 'gm-status gm-ok';
    tokenEditStatus.textContent = 'Modification appliquée.';

    transport?.publish({
      type: 'token.update',
      payload: { tokenId: selectedToken.id, patch },
      at: Date.now(),
      by: 'gm',
    });
  }

  // `change` et non `input`, pour la raison déjà écrite au-dessus pour l'élévation : le CdC
  // §7 classe `token.update` « ponctuel », et publier à chaque frappe ferait clignoter le
  // nom sur les trois écrans en revalidant la campagne à chaque caractère.
  tokenEditLabel.addEventListener(
    'change',
    () => {
      const value = tokenEditLabel.value.trim();
      if (!value) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = 'Le nom ne peut pas être vide.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.label) return;
      applyTokenPatch({ label: value });
    },
    { signal: listeners.signal }
  );

  /**
   * Applique une saisie de PV courants, d'où qu'elle vienne.
   *
   * ⛔ Partagée par l'onglet Pions et la barre de vitalité d'UX-04, et il faut qu'elle le reste.
   * Deux endroits qui bornent, comparent et publient chacun de leur côté finiraient par ne plus
   * borner pareil — et c'est la valeur que six personnes lisent à l'écran.
   *
   * @param {string} saisie
   * @returns {number|null} la valeur retenue, ou `null` si rien n'était applicable
   */
  function applyHpCurrent(saisie) {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken || selectedToken.hp === null || selectedToken.hp === undefined) return null;
    const raw = parseInt(saisie.trim(), 10);
    const current = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(raw, selectedToken.hp.max));
    if (current !== selectedToken.hp.current) {
      applyTokenPatch({ hp: { current, max: selectedToken.hp.max } });
    }
    return current;
  }

  /**
   * Applique un cran de santé de PNJ, d'où qu'il vienne. Même raison de partage que `applyHpCurrent`.
   *
   * ⛔ Refuse un PJ : son état de santé se lit de ses PV par un anneau proportionnel, et
   * `health` ne se dérive JAMAIS de `hp` ni l'inverse (chantier Q, interdiction n°4).
   *
   * @param {'unharmed'|'wounded'|'critical'} health
   */
  function applyHealth(health) {
    const selectedToken = store.getSelectedToken();
    if (!selectedToken || selectedToken.kind === 'pc' || selectedToken.hp === null) return;
    if (health === selectedToken.health) return;
    applyTokenPatch({ health });
  }

  tokenHpCurrent.addEventListener(
    'change',
    () => {
      const retenu = applyHpCurrent(tokenHpCurrent.value);
      if (retenu !== null) tokenHpCurrent.value = String(retenu);
    },
    { signal: listeners.signal }
  );

  tokenHpMax.addEventListener(
    'change',
    () => {
      const selectedToken = store.getSelectedToken();
      if (!selectedToken) return;
      const val = tokenHpMax.value.trim();
      if (val === '') {
        if (selectedToken.hp === null) return;
        applyTokenPatch({ hp: null });
        return;
      }
      const rawMax = parseInt(val, 10);
      const max = Number.isNaN(rawMax) ? 1 : Math.max(1, rawMax);
      tokenHpMax.value = String(max);
      const currentVal = selectedToken.hp ? selectedToken.hp.current : max;
      const current = Math.max(0, Math.min(currentVal, max));
      tokenHpCurrent.value = String(current);
      if (selectedToken.hp && current === selectedToken.hp.current && max === selectedToken.hp.max) return;
      applyTokenPatch({ hp: { current, max } });
    },
    { signal: listeners.signal }
  );

  for (const radio of healthRadios) {
    radio.addEventListener(
      'change',
      () => {
        if (!radio.checked) return;
        applyHealth(/** @type {'unharmed'|'wounded'|'critical'} */ (radio.value));
      },
      { signal: listeners.signal }
    );
  }

  // ── Barre de vitalité (UX-04) ────────────────────────────────────────────────────────────
  const vitalsBar = /** @type {HTMLElement|null} */ (container.querySelector('#gm-vitals-bar'));
  const vitalsLabel = /** @type {HTMLElement|null} */ (container.querySelector('#gm-vitals-label'));
  const vitalsHpGroup = /** @type {HTMLElement|null} */ (container.querySelector('#gm-vitals-hp'));
  const vitalsHpCurrent = /** @type {HTMLInputElement|null} */ (container.querySelector('#gm-vitals-hp-current'));
  const vitalsHpMax = /** @type {HTMLElement|null} */ (container.querySelector('#gm-vitals-hp-max'));
  const vitalsHealthGroup = /** @type {HTMLElement|null} */ (container.querySelector('#gm-vitals-health'));
  const vitalsHint = /** @type {HTMLElement|null} */ (container.querySelector('#gm-vitals-hint'));
  const vitalsHealthBtns = /** @type {HTMLButtonElement[]} */ (
    Array.from(container.querySelectorAll('#gm-vitals-health button[data-health]'))
  );
  const vitalsMountedBtn = /** @type {HTMLButtonElement|null} */ (container.querySelector('#gm-vitals-mounted'));

  /**
   * Reflète le pion sélectionné dans la barre de vitalité.
   *
   * ⚠ Appelée depuis `updateTokenEditUIFromStore`, donc à chaque mutation du store : la garde sur
   * `document.activeElement` n'est pas cosmétique. Sans elle, une mise à jour venue du réseau —
   * ou notre propre notification — réécrirait le champ que le MJ est en train de remplir, au
   * caractère près.
   */
  function updateVitalsBar() {
    if (!vitalsBar) return;
    const pion = store.getSelectedToken();
    if (!pion) {
      vitalsBar.hidden = true;
      return;
    }
    vitalsBar.hidden = false;
    if (vitalsLabel) vitalsLabel.textContent = pion.label || pion.id;

    // ⚠ Une variable locale, et pas un booléen `sansPv` : le typage ne suit pas le rétrécissement
    // à travers un booléen intermédiaire, et `pion.hp` resterait « possiblement nul » à l'usage.
    const pv = pion.hp ?? null;
    const estPj = pion.kind === 'pc';

    if (vitalsHpGroup) vitalsHpGroup.hidden = !(estPj && pv);
    if (vitalsHealthGroup) vitalsHealthGroup.hidden = !(!estPj && pv);
    if (vitalsHint) {
      vitalsHint.textContent = pv ? '' : 'Aucun point de vie défini — voir l’onglet Pions';
    }

    if (estPj && pv && vitalsHpCurrent && vitalsHpMax) {
      if (document.activeElement !== vitalsHpCurrent) {
        vitalsHpCurrent.value = String(pv.current);
      }
      vitalsHpCurrent.max = String(pv.max);
      vitalsHpMax.textContent = `/ ${pv.max}`;
    }

    if (!estPj && pv) {
      const courant = pion.health || 'unharmed';
      for (const btn of vitalsHealthBtns) {
        const actif = btn.dataset.health === courant;
        btn.setAttribute('aria-pressed', String(actif));
      }
    }

    if (vitalsMountedBtn) {
      const monte = pion.mounted === true;
      vitalsMountedBtn.setAttribute('aria-pressed', String(monte));
    }
  }

  vitalsHpCurrent?.addEventListener(
    'change',
    () => {
      const retenu = applyHpCurrent(vitalsHpCurrent.value);
      if (retenu !== null) vitalsHpCurrent.value = String(retenu);
    },
    { signal: listeners.signal }
  );

  for (const btn of vitalsHealthBtns) {
    btn.addEventListener(
      'click',
      () => {
        applyHealth(/** @type {'unharmed'|'wounded'|'critical'} */ (btn.dataset.health));
      },
      { signal: listeners.signal }
    );
  }

  // Chantier C-9 : monter ou descendre de cheval. État ABSOLU publié, jamais « inverse-le » :
  // `token.mounted` est rejouable, et c'est son seul écrivain.
  vitalsMountedBtn?.addEventListener(
    'click',
    () => {
      const pion = store.getSelectedToken();
      if (!pion) return;
      const suivant = !(pion.mounted === true);
      try {
        store.setTokenMounted(pion.id, suivant);
      } catch (err) {
        if (vitalsHint) vitalsHint.textContent = err instanceof Error ? err.message : String(err);
        return;
      }
      transport?.publish({
        type: 'token.mounted',
        payload: { tokenId: pion.id, mounted: suivant },
        at: Date.now(),
        by: 'gm',
      });
    },
    { signal: listeners.signal }
  );

  tokenEditKind.addEventListener(
    'change',
    () => {
      const kind = /** @type {'pc'|'npc'} */ (tokenEditKind.value === 'npc' ? 'npc' : 'pc');
      if (kind === store.getSelectedToken()?.kind) return;
      applyTokenPatch({ kind });
    },
    { signal: listeners.signal }
  );

  tokenEditBorderColor.addEventListener(
    'change',
    () => {
      const color = tokenEditBorderColor.value;
      if (color === store.getSelectedToken()?.borderColor) return;
      applyTokenPatch({ borderColor: color });
    },
    { signal: listeners.signal }
  );

  tokenEditSizeCells.addEventListener(
    'change',
    () => {
      const value = parseInt(tokenEditSizeCells.value, 10);
      if (!Number.isInteger(value) || value < 1) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = 'La taille doit être un entier au moins égal à 1.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.sizeCells) return;
      applyTokenPatch({ sizeCells: value });
    },
    { signal: listeners.signal }
  );

  tokenEditSpeedCells.addEventListener(
    'change',
    () => {
      const value = parseFloat(tokenEditSpeedCells.value);
      if (!Number.isFinite(value) || value < 1) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = 'La vitesse doit valoir au moins 1 case.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.speedCells) return;
      applyTokenPatch({ speedCells: value });
    },
    { signal: listeners.signal }
  );

  tokenEditHidden.addEventListener(
    'change',
    () => applyTokenPatch({ hidden: tokenEditHidden.checked }),
    { signal: listeners.signal }
  );

  tokenEditPlayerMovable.addEventListener(
    'change',
    () => applyTokenPatch({ playerMovable: tokenEditPlayerMovable.checked }),
    { signal: listeners.signal }
  );

  tokenEditLocked.addEventListener(
    'change',
    () => applyTokenPatch({ locked: tokenEditLocked.checked }),
    { signal: listeners.signal }
  );

  tokenEditVisionDim.addEventListener(
    'change',
    () => {
      const value = parseInt(tokenEditVisionDim.value, 10);
      if (!Number.isInteger(value) || value < 0 || value > 60) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = 'La vision dans le noir doit être un entier entre 0 et 60 cases.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.visionDim) return;
      applyTokenPatch({ visionDim: value });
    },
    { signal: listeners.signal }
  );

  // Cocher pose une torche par défaut (`TOKEN_TORCH_DEFAULT`), avec la portée déjà saisie si
  // le champ en montrait une ; décocher l'éteint (`emitsLight: null`). La portée se republie
  // séparément ci-dessous, y compris torche déjà allumée.
  tokenEditTorch.addEventListener(
    'change',
    () => {
      if (tokenEditTorch.checked) {
        const range = parseInt(tokenEditTorchRange.value, 10);
        applyTokenPatch({
          emitsLight: {
            range: Number.isInteger(range) && range >= 1 && range <= 20 ? range : TOKEN_TORCH_DEFAULT.range,
            intensity: TOKEN_TORCH_DEFAULT.intensity,
            color: TOKEN_TORCH_DEFAULT.color,
          },
        });
      } else {
        applyTokenPatch({ emitsLight: null });
      }
    },
    { signal: listeners.signal }
  );

  tokenEditTorchRange.addEventListener(
    'change',
    () => {
      const value = parseInt(tokenEditTorchRange.value, 10);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = 'La portée de la torche doit être un entier entre 1 et 20 cases.';
        updateTokenEditUIFromStore();
        return;
      }
      const current = store.getSelectedToken()?.emitsLight;
      if (current && value === current.range) return;
      applyTokenPatch({
        emitsLight: { range: value, intensity: TOKEN_TORCH_DEFAULT.intensity, color: TOKEN_TORCH_DEFAULT.color },
      });
    },
    { signal: listeners.signal }
  );

  for (const cb of markerCheckboxes) {
    cb.addEventListener(
      'change',
      () => {
        const selectedToken = store.getSelectedToken();
        if (!selectedToken) return;
        const selectedMarkers = markerCheckboxes
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value)
          .filter(isStatusMarker);
        applyTokenPatch({ markers: selectedMarkers });
      },
      { signal: listeners.signal }
    );
  }

  // La suppression est irréversible — il n'y a pas d'annulation dans le modèle — donc elle
  // se confirme, comme « quitter la session » plus haut.
  btnReserveToken.addEventListener(
    'click',
    () => {
      const selectedToken = store.getSelectedToken();
      if (!selectedToken) return;
      const tokenId = selectedToken.id;
      try {
        if (!store.reserveToken(tokenId)) return;
      } catch (err) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = err instanceof Error ? err.message : String(err);
        return;
      }
      transport?.publish({
        type: 'token.reserve',
        payload: { tokenId },
        at: Date.now(),
        by: 'gm',
      });
      tokenEditStatus.className = 'gm-status gm-ok';
      tokenEditStatus.textContent = 'Pion rangé en réserve, avec son état.';
    },
    { signal: listeners.signal }
  );

  btnDeleteToken.addEventListener(
    'click',
    () => {
      const selectedToken = store.getSelectedToken();
      if (!selectedToken) return;

      const nom = selectedToken.label || selectedToken.id;
      if (!window.confirm(`Supprimer le pion « ${nom} » ?\n\nCette action est irréversible.`)) {
        return;
      }

      const tokenId = selectedToken.id;
      try {
        store.removeToken(tokenId);
      } catch (err) {
        tokenEditStatus.className = 'gm-status gm-err';
        tokenEditStatus.textContent = err instanceof Error ? err.message : String(err);
        return;
      }

      transport?.publish({
        type: 'token.delete',
        payload: { tokenId },
        at: Date.now(),
        by: 'gm',
      });
    },
    { signal: listeners.signal }
  );

  updateTokenEditUIFromStore();
  updateReserveDrawer();
  updateRoster();

  // ── Ambiance lumineuse (Lot 3, S-05) ──────────────────────────────────────────────────
  const ambientDayBtn = /** @type {HTMLButtonElement} */ (topbar.querySelector('#gm-ambient-day'));
  const ambientNightBtn = /** @type {HTMLButtonElement} */ (topbar.querySelector('#gm-ambient-night'));
  const bakedWarning = /** @type {HTMLElement} */ (topbar.querySelector('#gm-baked-warning'));

  function updateLightBarFromStore() {
    const level = store.getRenderSnapshot().activeLevel;
    const baked = Boolean(level?.ambient?.baked);
    // ⛔ **Le prédicat du moteur, et pas un autre** : `fogLayer.isAmbientLit` rend
    // `baked || level > 0`. Une campagne enregistrée avec `ambient.level: 0.35` vaut donc
    // « jour », et c'est ce qu'il faut afficher — la lecture continue d'accepter les valeurs
    // fractionnaires, seule l'écriture devient binaire.
    // ⛔ Plus de `baked` dans ce prédicat : il vaut `true` en toutes circonstances chez
    // Dungeon Alchemist, et il faisait afficher « Jour » sur un étage que le MJ venait de
    // régler sur « Nuit ». Le store disait 0, la barre disait Jour, et rien ne s'assombrissait.
    const isDay = Number(level?.ambient?.level) > 0;
    // ⛔ **Le verrou sur `baked` est retiré le 27/08/2026, et c'est une correction, pas un
    // assouplissement.**
    //
    // Relevé sur les cinq exports réels du dépôt : Dungeon Alchemist écrit
    // `baked_lighting: true` **de jour comme de nuit**, et quel que soit le mode d'export —
    // « lumière partout », « dans l'image », « dans le VTT ». Le drapeau ne porte donc AUCUNE
    // information, et il verrouillait cette bascule sur la totalité des cartes du mainteneur :
    // il n'a jamais pu régler « Nuit » nulle part.
    //
    // ⚠ L'avertissement, lui, RESTE — mais comme un conseil, plus comme un veto. Régler
    // « Nuit » sur une carte dont l'image porte déjà sa lumière peinte l'assombrirait deux
    // fois ; c'est au MJ de le savoir, pas au code de le lui interdire sur la foi d'un
    // drapeau qui vaut `true` en toutes circonstances.
    const disabled = !level;

    for (const [btn, actif] of /** @type {[HTMLButtonElement, boolean][]} */ ([
      [ambientDayBtn, isDay],
      [ambientNightBtn, !isDay],
    ])) {
      btn.setAttribute('aria-pressed', String(actif));
      btn.disabled = disabled;
    }
    bakedWarning.hidden = !baked;
  }

  /** @param {boolean} day */
  function setAmbientDay(day) {
    const level = store.getRenderSnapshot().activeLevel;
    // ⛔ Plus de veto sur `baked` : voir `updateLightBarFromStore`. Le drapeau de Dungeon
    // Alchemist vaut `true` en toutes circonstances et ne distingue rien.
    if (!level) return;
    const ambient = { ...level.ambient, level: day ? 1 : 0 };
    try {
      store.updateLevel(level.id, { ambient });
      transport?.publish({
        type: 'level.ambient',
        payload: { levelId: level.id, ambient },
        at: Date.now(),
        by: 'gm',
      });
    } catch (err) {
      console.error('Mise à jour de l’ambiance refusée :', err);
    }
    updateLightBarFromStore();
  }

  ambientDayBtn.addEventListener('click', () => setAmbientDay(true), { signal: listeners.signal });
  ambientNightBtn.addEventListener('click', () => setAmbientDay(false), { signal: listeners.signal });

  // ── Barre d'étage (Lot 3, S-02) ──────────────────────────────────────────────────────────
  const levelBarMount = /** @type {HTMLElement|null} */ (topbar.querySelector('#gm-level-bar'));
  const levelSelector = levelBarMount
    ? createLevelSelector(levelBarMount, {
        getLevels: () => store.getLevelSummaries(),
        getActiveLevelId: () => store.getActiveLevelId(),
        onSelectLevel: (cible) => {
          store.selectLevel(cible);
          // ⚠ Publier APRÈS la mutation locale, et seulement si elle a réussi : annoncer un étage que
          // le MJ n'a pas pu adopter enverrait la table où lui-même n'est pas.
          transport?.publish({
            type: 'level.select',
            payload: { levelId: cible },
            at: Date.now(),
            by: 'gm',
          });
        },
        // UX-15 : emmener la table sur l'étage actif du MJ, par le même chemin de publication
        // que les autres événements du panneau — aucun accès au transport dans le composant.
        onShowLevel: (levelId) => {
          transport?.publish({
            type: 'level.show',
            payload: { levelId },
            at: Date.now(),
            by: 'gm',
          });
        },
        // UX-16 : ce qui serait perdu, pour que la confirmation du composant le dise en nombre.
        getDeleteImpact: (levelId) => {
          const camp = store.getCampaign();
          return {
            tokens: (camp?.tokens ?? []).filter((t) => t.levelId === levelId).length,
            links: (camp?.links ?? []).filter(
              (l) => l.a.levelId === levelId || l.b.levelId === levelId
            ).length,
            // ⚠ `removeLevel` emporte AUSSI les gabarits de l'étage : les compter ici,
            // sinon la confirmation annonce moins que ce qu'elle détruit.
            templates: (camp?.templates ?? []).filter((t) => t.levelId === levelId).length,
            hasFog: store.getSessionFog(levelId) !== null,
          };
        },
        // UX-16 : retirer l'étage, puis publier seulement si la mutation locale a réussi —
        // même principe qu'`onSelectLevel` ci-dessus : annoncer un retrait que le MJ n'a pas pu
        // faire enverrait les autres postes retirer un étage que lui-même a gardé.
        onDeleteLevel: (levelId) => {
          const retire = store.removeLevel(levelId);
          if (!retire) return;
          transport?.publish({
            type: 'level.delete',
            payload: { levelId },
            at: Date.now(),
            by: 'gm',
          });
        },
      })
    : null;

  // Le ping passe par `setActiveTool`, donc désarmer un autre outil est gratuit : c'est
  // l'exclusivité mutuelle existante qui s'en charge, pas un traitement particulier ici.
  const pingArmBtn = /** @type {HTMLButtonElement} */ (rail.querySelector('#gm-ping-arm'));
  pingArmBtn.addEventListener(
    'click',
    () => setActiveTool(activeToolName === 'ping' ? 'none' : 'ping'),
    { signal: listeners.signal }
  );
  const measureArmBtn = /** @type {HTMLButtonElement} */ (rail.querySelector('#gm-measure-arm'));
  measureArmBtn.addEventListener(
    'click',
    () => setActiveTool(activeToolName === 'measure' ? 'none' : 'measure'),
    { signal: listeners.signal }
  );
  updateMeasureButton();

  // Même patron que le ping/la mesure ci-dessus : l'armement passe par `setActiveTool`, qui
  // garantit à lui seul l'exclusivité mutuelle avec tout autre outil MJ (⛔ brief C-2 §2).
  const lightPlaceArmBtn = /** @type {HTMLButtonElement} */ (rail.querySelector('#gm-light-place-arm'));
  lightPlaceArmBtn.addEventListener(
    'click',
    () => setActiveTool(activeToolName === 'light-place' ? 'none' : 'light-place'),
    { signal: listeners.signal }
  );
  const lightDeleteArmBtn = /** @type {HTMLButtonElement} */ (rail.querySelector('#gm-light-delete-arm'));
  lightDeleteArmBtn.addEventListener(
    'click',
    () => setActiveTool(activeToolName === 'light-delete' ? 'none' : 'light-delete'),
    { signal: listeners.signal }
  );
  updateLightToolButtons();

  updateLightBarFromStore();

  /** @type {string|null} */
  let derniereSignatureLiaisons = null;
  // Écouter les changements dans le store pour mettre à jour les inputs de grille si besoin
  const unsubscribeStore = store.subscribe(() => {
    levelSelector?.update();
    importPanelImage?.refresh();
    // La liste des gabarits se rafraîchit sur **toute** mutation du store, et pas seulement
    // sur ses propres gestes : un gabarit retiré par appui long sur la carte, ou par un
    // événement réseau, doit disparaître de la liste sans qu'on rouvre l'onglet.
    templateTools?.refresh();
    // La liste des liaisons suit les étages et les liaisons (B8) : elle n'était rafraîchie que par
    // ses propres gestes, et restait périmée après un `removeLevel`, un `scene.load` ou un ajout
    // venu d'un autre poste MJ. Signature, pour ne pas reconstruire le menu sous le doigt.
    const campagne = store.getCampaign();
    const signatureLiaisons = JSON.stringify([
      campagne?.levels.map((l) => [l.id, l.name]) ?? [],
      campagne?.links ?? [],
    ]);
    if (signatureLiaisons !== derniereSignatureLiaisons) {
      derniereSignatureLiaisons = signatureLiaisons;
      linkEditor?.refresh();
    }
    updateReserveDrawer();
    updateRoster();
    updateLightBarFromStore();
    tokenMaker.setDefaultLevelId(store.getActiveLevelId());
    updateElevationUIFromStore();
    updateTokenEditUIFromStore();
    const currentLvl = store.getActiveLevel();
    if (currentLvl && currentLvl.grid) {
      gridVisibleInput.checked = currentLvl.grid.visible ?? true;
      gridTypeSelect.value = currentLvl.grid.type || 'square';
      gridColorInput.value = currentLvl.grid.color || '#000000';
      gridOpacityInput.value = String(currentLvl.grid.opacity ?? 0.25);
      gridOpacityVal.textContent = String(currentLvl.grid.opacity ?? 0.25);
    }
  });

  /**
   * Pose le pion en attente sur une case, l'ajoute à la campagne et le publie (UX-08).
   *
   * ⛔ Le désarmement est **automatique après la pose**, comme le gabarit et la pose de liaison —
   * pas comme le pinceau de fog, qui reste armé et dont l'exception est assumée ailleurs. Un
   * PNJ créé se pose une fois ; rester armé collerait un second exemplaire au clic suivant.
   *
   * ⚠ Le `levelId` est celui de l'étage **au moment de la pose**, pas celui du moment de la
   * génération : le MJ peut avoir changé d'étage entre les deux, et le pion doit atterrir là
   * où il regarde.
   *
   * @param {string} levelId
   * @param {import('../../core/types.js').Cell} cell
   * @returns {boolean} true si le pion a été posé
   */
  function placePendingTokenAt(levelId, cell) {
    if (!pendingToken || !levelId || !cell) return false;
    let token = { ...pendingToken, levelId, cell: { a: cell.a, b: cell.b } };
    /** @type {{ tokenId: string, patch: { copyNumber: number, label?: string } }[]} */
    let numerotes = [];
    try {
      // ⚠ Deux mutations pour un seul geste : un pion de la réserve doit en SORTIR dans la même
      // transaction où il entre sur le plateau, sinon il existe deux fois — et le schéma refuse
      // la campagne suivante, son jeu d'identifiants étant commun aux deux collections.
      if (pendingFromReserve) {
        if (!store.placeTokenFromReserve(token.id, levelId, cell)) return false;
      } else if (token.libraryId) {
        // Exemplaire de bibliothèque (C-15) : numéroté à la pose, à partir du deuxième.
        const pose = store.addLibraryCopy(token);
        token = pose.token;
        numerotes = pose.patches;
      } else {
        store.addToken(token);
      }
    } catch (err) {
      // Une case hors limites est le cas courant : on le dit et on **reste armé**, pour que le
      // MJ retape à l'intérieur sans avoir à régénérer son pion.
      tokenMaker.setStatus(err instanceof Error ? err.message : String(err), '#e74c3c');
      return false;
    }
    // Le numéro du premier exemplaire d'abord, le nouveau ensuite : la table voit les deux.
    for (const { tokenId, patch } of numerotes) {
      transport?.publish({ type: 'token.update', payload: { tokenId, patch }, at: Date.now(), by: 'gm' });
    }
    transport?.publish({
      type: 'token.add',
      payload: { token },
      at: Date.now(),
      by: 'gm',
    });
    pendingToken = null;
    pendingFromReserve = false;
    tokenMaker.setStatus(`Pion posé en ${cell.a}, ${cell.b}.`, '#2ecc71');
    setActiveTool('none');
    updateReserveDrawer();
    return true;
  }

  return {
    /** Y a-t-il un pion généré en attente de sa case ? */
    hasPendingToken: () => pendingToken !== null,
    placePendingTokenAt,
    /** Mode actuel du panneau ('play' | 'prep') */
    getMode: () => currentMode,
    /** Bascule le mode du panneau ('play' | 'prep') sans désarmer d'outil actif */
    setMode,
    tokenMaker,
    fogTools,
    wallEditor,
    linkEditor,
    templateTools,
    getActiveToolName,
    setActiveTool,
    disarmActiveTool,
    destroy: () => {
      listeners.abort();
      unsubscribeStore();
      levelSelector?.destroy();
      versionBadge?.detach();
      sceneLibrary?.destroy();
      tokenLibrary?.destroy();
      imageShare?.destroy();
      container.replaceChildren();
      topbar.replaceChildren();
      rail.replaceChildren();
      palette.remove();
      armedChip.remove();
      canvasContainer.classList.remove('gm-armed');
    },
  };
}
