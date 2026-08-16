// @ts-check
import { createImportPanel } from './importPanel.js';
import { createTokenMaker } from './tokenMaker.js';
import { createSceneLibrary } from './sceneLibrary.js';
import { createTokenLibrary } from './tokenLibrary.js';
import { createHandouts } from './handouts.js';
import { createFogTools } from './fogTools.js';
import { createWallEditor } from './wallEditor.js';
import { createLinkEditor } from './linkEditor.js';
import { createTemplateTools } from './templateTools.js';
import { VERSION } from '../../core/version.js';
import { GM_SESSION_STORAGE_KEY, STATUS_MARKER_IDS, STATUS_MARKER_LABEL_FR } from '../../core/constants.js';
import { isStatusMarker } from '../../core/schema.js';
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
 * Monte le panneau latéral complet de la vue MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {GMPanelOptions} [options]
 * @returns {{isLevelFollowLocked: () => boolean, tokenMaker: ReturnType<typeof createTokenMaker>, fogTools: ReturnType<typeof createFogTools>|null, wallEditor: ReturnType<typeof createWallEditor>|null, linkEditor: ReturnType<typeof createLinkEditor>|null, templateTools: ReturnType<typeof createTemplateTools>|null, getActiveToolName: () => string, setActiveTool: (toolName: 'none'|'fog-reveal'|'fog-hide'|'wall-draw'|'wall-delete'|'link-place'|'template-place'|'ping'|'measure') => void, disarmActiveTool: () => void, destroy: () => void}}
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
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';
  container.style.background = '#1e1e1e';
  container.style.color = '#eee';
  container.style.fontFamily = 'system-ui, sans-serif';

  container.innerHTML = `
    <!-- Barre de session : le code à dicter, et le seul geste qui permette d'en changer.
         sessionStorage survivant à la restauration d'onglets, une session peut coller
         après un redémarrage complet ; sans ce bouton il n'existait aucun moyen de la
         quitter depuis l'interface. -->
    <div class="gm-session-bar" style="display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; background: #232323; border-bottom: 1px solid #333;">
      <span style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Session</span>
      <code id="gm-session-code" style="font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 1.15rem; letter-spacing: 0.2em; color: #4a90e2;"></code>
      <button id="gm-evict-others" style="margin-left: auto; padding: 0.35rem 0.7rem; font-size: 0.75rem; background: #2a3242; color: #a8c0e0; border: 1px solid #3d4a60; border-radius: 4px; cursor: pointer;" title="Déconnecte les autres écrans MJ de cette session">Autres MJ</button>
      <button id="gm-leave-session" style="padding: 0.35rem 0.7rem; font-size: 0.75rem; background: #3a2a2a; color: #e0a0a0; border: 1px solid #5a3a3a; border-radius: 4px; cursor: pointer;">Quitter la session</button>
    </div>

    <div id="gm-light-bar" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.75rem; background: #2a2518; border-bottom: 1px solid #4d4224;">
      <label for="gm-ambient-level" style="font-size: 0.78rem; color: #ead59a; white-space: nowrap;">Ambiance</label>
      <input id="gm-ambient-level" type="range" min="0" max="1" step="0.05" value="1" style="flex: 1; accent-color: #e0ad32;" />
      <output id="gm-ambient-value" for="gm-ambient-level" style="min-width: 2.4rem; font: 0.75rem ui-monospace, monospace; color: #ead59a;">1.00</output>
      <span id="gm-baked-warning" role="status" style="display: none; font-size: 0.75rem; color: #ffd166;">⚠ Éclairage déjà cuit : ambiante forcée</span>
    </div>

    <!--
      Barre d'étage — Lot 3, S-02.

      Hors des onglets, et c'est délibéré : changer d'étage est une action de séance, faite en
      cours de jeu et depuis n'importe quel outil. L'enfouir dans un onglet obligerait le MJ à
      quitter son pinceau de fog ou son éditeur de murs pour monter d'un niveau. Elle est masquée
      tant que la campagne n'a qu'un seul étage, pour ne rien ajouter au bandeau du cas courant.
    -->
    <div id="gm-level-bar" style="display: none; align-items: center; gap: 0.6rem; padding: 0.5rem 0.75rem; background: #202832; border-bottom: 1px solid #333;">
      <span style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Étage</span>
      <select id="gm-level-select" style="flex: 1; padding: 0.35rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;"></select>
      <button id="gm-level-lock" type="button" aria-pressed="false" title="Cadenas : suspend la bascule automatique quand un pion change d'étage. Les pions montent quand même." style="padding: 0.3rem 0.55rem; font-size: 0.9rem; background: #1a1a1a; color: #888; border: 1px solid #444; border-radius: 4px; cursor: pointer;">🔓</button>
      <span id="gm-level-status" style="font-size: 0.7rem; color: #888;"></span>
    </div>

    <!--
      Barre des gestes de séance — Lot 4, le ping (CdC §5.5) et la mesure (G-03).
    -->
    <div class="gm-session-tools-bar" style="display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.75rem; background: #2a2a20; border-bottom: 1px solid #444;">
      <span style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Séance</span>
      <button id="gm-ping-arm" type="button" aria-pressed="false" title="Armer le ping, puis cliquer sur la carte : un marqueur apparaît 2 s sur les trois écrans" style="padding: 0.35rem 0.7rem; font-size: 0.78rem; background: #1a1a1a; color: #facc15; border: 1px solid #6b5a12; border-radius: 4px; cursor: pointer;">📍 Ping</button>
      <button id="gm-measure-arm" type="button" aria-pressed="false" title="Armer la mesure, puis cliquer deux points sur la carte" style="padding: 0.35rem 0.7rem; font-size: 0.78rem; background: #1a1a1a; color: #60a5fa; border: 1px solid #1e3a8a; border-radius: 4px; cursor: pointer;">📏 Mesurer</button>
      <span id="gm-ping-hint" style="font-size: 0.7rem; color: #888;"></span>
    </div>

    <!-- Barre d'onglets du panneau MJ -->
    <div class="gm-tabs-header" role="tablist" aria-label="Outils du meneur de jeu">
      <button class="gm-tab-btn" type="button" id="gm-tab-scene-library" role="tab" data-tab="scene-library" aria-controls="tab-content-scene-library" aria-selected="false" tabindex="-1">📂 Cartes</button>
      <button class="gm-tab-btn active" type="button" id="gm-tab-import-uvtt" role="tab" data-tab="import-uvtt" aria-controls="tab-content-import-uvtt" aria-selected="true" tabindex="0">UVTT</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-import-image" role="tab" data-tab="import-image" aria-controls="tab-content-import-image" aria-selected="false" tabindex="-1">Image</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-token-maker" role="tab" data-tab="token-maker" aria-controls="tab-content-token-maker" aria-selected="false" tabindex="-1">Pions</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-handouts" role="tab" data-tab="handouts" aria-controls="tab-content-handouts" aria-selected="false" tabindex="-1">Handouts</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-fog-tools" role="tab" data-tab="fog-tools" aria-controls="tab-content-fog-tools" aria-selected="false" tabindex="-1">🌫️ Fog</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-wall-editor" role="tab" data-tab="wall-editor" aria-controls="tab-content-wall-editor" aria-selected="false" tabindex="-1">🧱 Murs</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-link-editor" role="tab" data-tab="link-editor" aria-controls="tab-content-link-editor" aria-selected="false" tabindex="-1">↕ Liaisons</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-template-tools" role="tab" data-tab="template-tools" aria-controls="tab-content-template-tools" aria-selected="false" tabindex="-1">📐 Gabarits</button>
      <button class="gm-tab-btn" type="button" id="gm-tab-grid-settings" role="tab" data-tab="grid-settings" aria-controls="tab-content-grid-settings" aria-selected="false" tabindex="-1">Grille</button>
    </div>

    <!-- Conteneurs de contenu des onglets -->
    <div class="gm-tabs-content" style="flex: 1; overflow-y: auto; padding: 1rem;">
      <div id="tab-content-scene-library" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-scene-library" hidden>
        <div id="scene-library-mount"></div>
      </div>

      <div id="tab-content-fog-tools" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-fog-tools" hidden>
        <div id="fog-tools-mount"></div>
      </div>

      <div id="tab-content-wall-editor" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-wall-editor" hidden>
        <div id="wall-editor-mount"></div>
      </div>
      <div id="tab-content-link-editor" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-link-editor" hidden>
        <div id="link-editor-mount"></div>
      </div>

      <div id="tab-content-template-tools" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-template-tools" hidden>
        <div id="template-tools-mount"></div>
      </div>

      <div id="tab-content-import-uvtt" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-import-uvtt">
        <div id="import-uvtt-mount"></div>
      </div>

      <div id="tab-content-import-image" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-import-image" hidden>
        <div id="import-image-mount"></div>
      </div>

      <div id="tab-content-token-maker" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-token-maker" hidden>
        <div class="token-elevation-section" style="margin-bottom: 1.5rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Pion sélectionné</h3>
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <label for="token-elevation" style="font-size: 0.85rem; color: #aaa;">Élévation :</label>
            <input type="number" id="token-elevation" class="token-elevation-input" value="0" disabled style="width: 80px; padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />
            <span id="token-elevation-label" style="font-size: 0.8rem; color: #888;">(aucun pion sélectionné)</span>
          </div>

          <div id="token-edit-fields" style="display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 0.75rem; align-items: center; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #333;">
            <label for="token-edit-label" style="font-size: 0.85rem; color: #aaa;">Nom :</label>
            <input type="text" id="token-edit-label" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />

            <label for="token-edit-kind" style="font-size: 0.85rem; color: #aaa;">Type :</label>
            <select id="token-edit-kind" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;">
              <option value="pc">PJ (Joueur)</option>
              <option value="npc">PNJ (Non-Joueur)</option>
            </select>

            <label for="token-edit-border-color" style="font-size: 0.85rem; color: #aaa;">Bordure :</label>
            <input type="color" id="token-edit-border-color" disabled style="padding: 0; background: #1a1a1a; border: 1px solid #444; border-radius: 4px; height: 2rem;" />

            <label for="token-edit-size-cells" style="font-size: 0.85rem; color: #aaa;">Taille (cases) :</label>
            <input type="number" id="token-edit-size-cells" min="1" max="4" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />

            <label for="token-edit-speed-cells" style="font-size: 0.85rem; color: #aaa;">Vitesse (cases) :</label>
            <input type="number" id="token-edit-speed-cells" min="1" disabled style="padding: 0.4rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />

            <label for="token-edit-hidden" style="font-size: 0.85rem; color: #aaa;">Masqué aux joueurs :</label>
            <input type="checkbox" id="token-edit-hidden" disabled style="justify-self: start; width: 1.1rem; height: 1.1rem;" />

            <label for="token-edit-player-movable" style="font-size: 0.85rem; color: #aaa;">Déplaçable par les joueurs :</label>
            <input type="checkbox" id="token-edit-player-movable" disabled style="justify-self: start; width: 1.1rem; height: 1.1rem;" />

            <label for="token-edit-locked" style="font-size: 0.85rem; color: #aaa;">Verrouillé :</label>
            <input type="checkbox" id="token-edit-locked" disabled style="justify-self: start; width: 1.1rem; height: 1.1rem;" />

            <label for="token-hp-current" style="font-size: 0.85rem; color: #aaa;">PV (courant / max) :</label>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <input type="number" id="token-hp-current" min="0" disabled placeholder="—" style="width: 55px; padding: 0.35rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />
              <span style="color: #888;">/</span>
              <input type="number" id="token-hp-max" min="1" disabled placeholder="—" style="width: 55px; padding: 0.35rem; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px;" />
            </div>
          </div>

          <div id="token-health-section" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #333; display: none;">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #4a90e2;">État de santé (PNJ)</h4>
            <div id="token-health-radios" style="display: flex; gap: 0.75rem; font-size: 0.8rem; color: #ccc;">
              <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                <input type="radio" name="token-health-group" id="token-health-unharmed" value="unharmed" disabled />
                <span>Indemne</span>
              </label>
              <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                <input type="radio" name="token-health-group" id="token-health-wounded" value="wounded" disabled />
                <span>Blessé</span>
              </label>
              <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer;">
                <input type="radio" name="token-health-group" id="token-health-critical" value="critical" disabled />
                <span>Mal en point</span>
              </label>
            </div>
          </div>

          <div id="token-markers-section" style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #333;">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: #4a90e2;">Marqueurs d'état</h4>
            <div id="token-markers-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem 0.5rem; font-size: 0.8rem;">
              ${STATUS_MARKER_IDS.map(
                (id) => `
                <label style="display: flex; align-items: center; gap: 0.35rem; cursor: pointer; color: #ccc;">
                  <input type="checkbox" class="token-marker-checkbox" value="${id}" disabled />
                  <span>${STATUS_MARKER_LABEL_FR[id]}</span>
                </label>
              `
              ).join('')}
            </div>
          </div>

          <p id="token-edit-status" style="margin: 0.5rem 0 0 0; font-size: 0.75rem; color: #888; min-height: 1rem;"></p>

          <button id="btn-delete-token" disabled style="margin-top: 0.5rem; width: 100%; padding: 0.5rem; background: #5f2530; color: #fff; border: 1px solid #7a2f3c; border-radius: 4px; cursor: pointer;">
            Supprimer ce pion
          </button>
        </div>
        <div class="token-library-section" style="margin-bottom: 1.5rem;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Bibliothèque de pions</h3>
          <div id="token-library-mount"></div>
        </div>
        <div class="token-maker-section" style="border-top: 1px solid #333; padding-top: 1rem;">
          <h3 style="margin: 0 0 0.75rem 0; font-size: 1rem; color: #4a90e2;">Créer un pion</h3>
          <div id="token-maker-mount"></div>
        </div>
      </div>

      <div id="tab-content-handouts" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-handouts" hidden>
        <div id="handouts-mount"></div>
      </div>

      <div id="tab-content-grid-settings" class="gm-tab-pane" role="tabpanel" aria-labelledby="gm-tab-grid-settings" hidden>
        <div class="grid-settings-form" style="display: flex; flex-direction: column; gap: 1rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Réglages de la Grille</h3>

          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" id="grid-visible" checked />
            <span>Grille visible</span>
          </label>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; align-items: center;">
            <label for="grid-type">Type de grille :</label>
            <!-- width:100% et min-width:0 ne sont pas cosmétiques. Un select se dimensionne sur sa
                 plus longue option et, dans une piste de grille, déborde au lieu de se réduire. Le
                 13/08/2026 l'option « Hexagonale (pointe en haut) » a fait sortir le panneau de
                 15 px : invisible sur le poste du mainteneur, rouge sur le runner CI dont les
                 fontes sont plus larges. La contrainte tient quelle que soit la fonte, là où
                 raccourcir le libellé n'aurait protégé que jusqu'au prochain libellé. -->
            <select id="grid-type" style="width: 100%; min-width: 0;"
                    title="Le pavage de l’étage actif. Pointe en haut, rangées impaires décalées. Les imports UVTT sont carrés ; l’hexagone se pose sur une carte-décor.">
              <option value="square">Carrée</option>
              <option value="hex">Hexagonale</option>
            </select>

            <label for="grid-color">Couleur :</label>
            <input type="color" id="grid-color" value="#000000" />

            <label for="grid-opacity">Opacité (<span id="grid-opacity-val">0.25</span>) :</label>
            <input type="range" id="grid-opacity" min="0" max="1" step="0.05" value="0.25" />
          </div>
        </div>
      </div>
    </div>

    <!-- Pied de panneau : Affichage de la version -->
    <div class="gm-panel-footer" style="padding: 0.5rem 1rem; background: #181818; border-top: 1px solid #333; font-size: 0.75rem; color: #777; text-align: center;"></div>
    <a href="./attributions.html" style="padding: 0 1rem 0.55rem; background: #181818; color: #8bbdf0; font-size: 0.75rem; text-align: center;">Attributions</a>
  `;

  const sessionCode = /** @type {HTMLElement} */ (container.querySelector('#gm-session-code'));
  sessionCode.textContent = sessionId || '—';

  const footerEl = /** @type {HTMLElement} */ (container.querySelector('.gm-panel-footer'));
  /** @type {ReturnType<typeof mountGMVersionBadge>|null} */
  let versionBadge = null;
  if (footerEl) {
    versionBadge = mountGMVersionBadge(footerEl, { transport, role: 'gm' });
  }

  // --- Gestion de la navigation par onglets & outil actif centralisé (CORRECTIF DESARMEMENT §3.1) ---
  const tabButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    container.querySelectorAll('.gm-tab-btn')
  );
  const tabPanes = /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll('.gm-tab-pane'));

  /** @type {'none'|'fog-reveal'|'fog-hide'|'wall-draw'|'wall-delete'|'link-place'|'template-place'|'ping'|'measure'} */
  let activeToolName = 'none';

  /** @type {ReturnType<typeof createWallEditor>|null} */
  let wallEditor = null;
  /** @type {ReturnType<typeof createLinkEditor>|null} */
  let linkEditor = null;
  /** @type {ReturnType<typeof createTemplateTools>|null} */
  let templateTools = null;
  /** @type {ReturnType<typeof createFogTools>|null} */
  let fogTools = null;

  function updateTabToolIndicators() {
    tabButtons.forEach((btn) => {
      const tabName = btn.getAttribute('data-tab');
      let isToolTabArmed = false;

      if (tabName === 'fog-tools' && (activeToolName === 'fog-reveal' || activeToolName === 'fog-hide')) {
        isToolTabArmed = true;
      } else if (tabName === 'wall-editor' && (activeToolName === 'wall-draw' || activeToolName === 'wall-delete')) {
        isToolTabArmed = true;
      } else if (tabName === 'link-editor' && activeToolName === 'link-place') {
        isToolTabArmed = true;
      } else if (tabName === 'template-tools' && activeToolName === 'template-place') {
        isToolTabArmed = true;
      }

      if (isToolTabArmed) {
        btn.classList.add('gm-tab-active-tool');
        /** @type {HTMLElement} */ (btn).style.boxShadow = 'inset 0 -3px 0 #f5a623';
      } else {
        btn.classList.remove('gm-tab-active-tool');
        /** @type {HTMLElement} */ (btn).style.boxShadow = 'none';
      }
    });
  }

  function getActiveToolName() {
    return activeToolName;
  }

  /**
   * Reflète l'état d'armement du ping sur son bouton.
   *
   * L'indice textuel est là parce que l'armement d'un outil sans cible visible est invisible : le
   * pinceau de fog et l'éditeur de murs changent le curseur sur la carte, le ping ne change rien
   * tant qu'on n'a pas cliqué.
   */
  function updatePingButton() {
    const btn = /** @type {HTMLButtonElement|null} */ (container.querySelector('#gm-ping-arm'));
    const hint = container.querySelector('#gm-ping-hint');
    if (!btn) return;
    const armed = activeToolName === 'ping';
    btn.setAttribute('aria-pressed', armed ? 'true' : 'false');
    btn.style.background = armed ? '#facc15' : '#1a1a1a';
    btn.style.color = armed ? '#1a1a1a' : '#facc15';
    if (hint) hint.textContent = armed ? 'Cliquez sur la carte' : '';
  }

  function updateMeasureButton() {
    const btn = /** @type {HTMLButtonElement|null} */ (container.querySelector('#gm-measure-arm'));
    const hint = container.querySelector('#gm-ping-hint');
    if (!btn) return;
    const armed = activeToolName === 'measure';
    btn.setAttribute('aria-pressed', armed ? 'true' : 'false');
    btn.style.background = armed ? '#3b82f6' : '#1a1a1a';
    btn.style.color = armed ? '#ffffff' : '#60a5fa';
    if (hint) hint.textContent = armed ? 'Cliquer 2 points sur la carte' : '';
  }

  /**
   * Vrai pendant l'exécution de `setActiveTool`, pour détecter les rappels réentrants.
   * @type {boolean}
   */
  let settingActiveTool = false;

  /** @param {'none'|'fog-reveal'|'fog-hide'|'wall-draw'|'wall-delete'|'link-place'|'template-place'|'ping'|'measure'} toolName */
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

    if (toolName === 'none') {
      if (fogTools?.getActiveTool() !== 'none') fogTools?.disarm();
      if (wallEditor?.isArmed()) wallEditor?.setArmed(false);
      if (linkEditor?.isArmed()) linkEditor?.setArmed(false);
      if (templateTools?.isArmed()) templateTools?.disarm();
    }

    updateTabToolIndicators();
    requestRender();
  }

  function disarmActiveTool() {
    setActiveTool('none');
  }

  /** @param {HTMLElement} btn */
  function activateTab(btn) {
    // Désarmer l'outil actif à tout changement d'onglet (Amendement A3)
    if (activeToolName !== 'none') {
      disarmActiveTool();
    }

    const targetTab = btn.dataset.tab;
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

  const tabList = Array.from(tabButtons);
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(/** @type {HTMLElement} */ (btn)), {
      signal: listeners.signal,
    });
    btn.addEventListener(
      'keydown',
      /** @param {KeyboardEvent} event */ (event) => {
        const currentIndex = tabList.indexOf(btn);
        let nextIndex = currentIndex;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % tabList.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (currentIndex - 1 + tabList.length) % tabList.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = tabList.length - 1;
        } else {
          return;
        }
        event.preventDefault();
        const nextTab = /** @type {HTMLElement} */ (tabList[nextIndex]);
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
  const handoutsMount = /** @type {HTMLElement} */ (container.querySelector('#handouts-mount'));
  const fogToolsMount = /** @type {HTMLElement} */ (container.querySelector('#fog-tools-mount'));

  createImportPanel(uvttMount, { mode: 'uvtt' });
  createImportPanel(imageMount, { mode: 'image', transport });

  const handouts = handoutsMount ? createHandouts(handoutsMount, { transport }) : null;

  const wallEditorMount = /** @type {HTMLElement} */ (container.querySelector('#wall-editor-mount'));
  const linkEditorMount = /** @type {HTMLElement} */ (container.querySelector('#link-editor-mount'));
  const templateToolsMount = /** @type {HTMLElement} */ (container.querySelector('#template-tools-mount'));

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

  // Initialisation de la bibliothèque de pions
  /** @type {{destroy: () => void} | null} */
  let tokenLibrary = null;
  if (tokenLibraryMount) {
    createTokenLibrary(tokenLibraryMount, { transport })
      .then((lib) => {
        tokenLibrary = lib;
      })
      .catch((err) => {
        console.error('Erreur lors du chargement de la bibliothèque de pions :', err);
        tokenLibraryMount.innerHTML = `
          <div style="padding: 0.75rem; background: #3a1a1a; color: #e07070; border-radius: 4px; border: 1px solid #5a3a3a;">
            ✗ Erreur : Impossible de charger la bibliothèque de pions.
          </div>
        `;
      });
  }

  // Initialisation du générateur de pions avec ajout direct au store lors de la génération
  const tokenMaker = createTokenMaker(tokenMakerMount, {
    defaultLevelId: store.getActiveLevelId(),
    onGenerate: (token, _dataUrl) => {
      // Ajout automatique du pion généré au store
      store.addToken(token);

      // Envoi sur le réseau si transport disponible
      if (transport) {
        transport.publish({
          type: 'token.add',
          payload: { token },
          at: Date.now(),
          by: 'gm',
        });
      }
    },
  });

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
        <div style="padding: 1rem; background: #3a1a1a; color: #e07070; border-radius: 4px; border: 1px solid #5a3a3a;">
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

  function updateGridFromUI() {
    const visible = gridVisibleInput.checked;
    // ⛔ Lu depuis le champ, jamais figé. Cette ligne a valu `'square'` en dur pendant tout le
    // temps où `HexGrid` n'existait pas ; la rendre constante à nouveau ferait de la liste un
    // décor qui ne change rien, ce qu'aucune vérification d'affichage ne verrait.
    const type = /** @type {import('../../core/types.js').GridType} */ (
      gridTypeSelect.value === 'hex' ? 'hex' : 'square'
    );
    const color = gridColorInput.value;
    const opacity = parseFloat(gridOpacityInput.value);

    gridOpacityVal.textContent = String(opacity);

    const activeLvl = store.getActiveLevel();
    const gridConfig = {
      visible,
      type,
      color,
      opacity,
      offsetX: activeLvl?.grid?.offsetX ?? 0,
      offsetY: activeLvl?.grid?.offsetY ?? 0,
    };

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

  gridVisibleInput.addEventListener('change', updateGridFromUI, { signal: listeners.signal });
  gridTypeSelect.addEventListener('change', updateGridFromUI, { signal: listeners.signal });
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
    container.querySelector('#gm-evict-others')
  );

  function refreshEvictButton() {
    if (!evictOthersBtn) return;
    const others = getOtherGmSessions();
    evictOthersBtn.textContent = others.length === 0 ? 'Aucun autre MJ' : `Autres MJ (${others.length})`;
    evictOthersBtn.disabled = others.length === 0;
    evictOthersBtn.style.opacity = others.length === 0 ? '0.5' : '1';
    evictOthersBtn.style.cursor = others.length === 0 ? 'default' : 'pointer';
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
    container.querySelector('#gm-leave-session')
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
  const tokenEditSizeCells = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-size-cells'));
  const tokenEditSpeedCells = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-speed-cells'));
  const tokenEditHidden = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-hidden'));
  const tokenEditPlayerMovable = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-player-movable'));
  const tokenEditLocked = /** @type {HTMLInputElement} */ (container.querySelector('#token-edit-locked'));
  const tokenEditStatus = /** @type {HTMLElement} */ (container.querySelector('#token-edit-status'));
  const btnDeleteToken = /** @type {HTMLButtonElement} */ (container.querySelector('#btn-delete-token'));

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
    tokenHpMax,
    ...markerCheckboxes,
  ];

  function updateTokenEditUIFromStore() {
    const selectedToken = store.getSelectedToken();
    const disabled = !selectedToken;
    for (const control of tokenEditControls) control.disabled = disabled;
    btnDeleteToken.disabled = disabled;

    if (!selectedToken) {
      tokenEditLabel.value = '';
      tokenEditStatus.textContent = '';
      tokenHpCurrent.value = '';
      tokenHpMax.value = '';
      tokenHpCurrent.disabled = true;
      tokenHealthSection.style.display = 'none';
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
      tokenHealthSection.style.display = 'none';
    } else {
      tokenHealthSection.style.display = 'block';
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
    ])) {
      if (document.activeElement !== control) control.value = value;
    }
    tokenEditHidden.checked = Boolean(selectedToken.hidden);
    tokenEditPlayerMovable.checked = Boolean(selectedToken.playerMovable);
    tokenEditLocked.checked = Boolean(selectedToken.locked);

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
      tokenEditStatus.style.color = '#e74c3c';
      tokenEditStatus.textContent = err instanceof Error ? err.message : String(err);
      updateTokenEditUIFromStore();
      return;
    }

    tokenEditStatus.style.color = '#2ecc71';
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
        tokenEditStatus.style.color = '#e74c3c';
        tokenEditStatus.textContent = 'Le nom ne peut pas être vide.';
        updateTokenEditUIFromStore();
        return;
      }
      if (value === store.getSelectedToken()?.label) return;
      applyTokenPatch({ label: value });
    },
    { signal: listeners.signal }
  );

  tokenHpCurrent.addEventListener(
    'change',
    () => {
      const selectedToken = store.getSelectedToken();
      if (!selectedToken || selectedToken.hp === null || selectedToken.hp === undefined) return;
      const raw = parseInt(tokenHpCurrent.value.trim(), 10);
      const current = Number.isNaN(raw) ? 0 : Math.max(0, Math.min(raw, selectedToken.hp.max));
      tokenHpCurrent.value = String(current);
      if (current === selectedToken.hp.current) return;
      applyTokenPatch({ hp: { current, max: selectedToken.hp.max } });
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
        const selectedToken = store.getSelectedToken();
        if (!selectedToken || selectedToken.kind === 'pc' || selectedToken.hp === null) return;
        if (radio.checked) {
          const health = /** @type {'unharmed'|'wounded'|'critical'} */ (radio.value);
          if (health === selectedToken.health) return;
          applyTokenPatch({ health });
        }
      },
      { signal: listeners.signal }
    );
  }

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
        tokenEditStatus.style.color = '#e74c3c';
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
        tokenEditStatus.style.color = '#e74c3c';
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
        tokenEditStatus.style.color = '#e74c3c';
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

  // ── Barre d'étage (Lot 3, S-02) ──────────────────────────────────────────────────────────
  const levelBar = /** @type {HTMLElement} */ (container.querySelector('#gm-level-bar'));
  const levelSelect = /** @type {HTMLSelectElement} */ (container.querySelector('#gm-level-select'));
  const levelStatus = /** @type {HTMLElement} */ (container.querySelector('#gm-level-status'));
  const ambientInput = /** @type {HTMLInputElement} */ (container.querySelector('#gm-ambient-level'));
  const ambientValue = /** @type {HTMLOutputElement} */ (container.querySelector('#gm-ambient-value'));
  const bakedWarning = /** @type {HTMLElement} */ (container.querySelector('#gm-baked-warning'));

  function updateLightBarFromStore() {
    const level = store.getRenderSnapshot().activeLevel;
    const baked = Boolean(level?.ambient?.baked);
    const value = baked ? 1 : Math.max(0, Math.min(1, Number(level?.ambient?.level) || 0));
    if (document.activeElement !== ambientInput) ambientInput.value = String(value);
    ambientValue.value = value.toFixed(2);
    ambientValue.textContent = value.toFixed(2);
    ambientInput.disabled = !level || baked;
    bakedWarning.style.display = baked ? 'inline' : 'none';
  }

  ambientInput.addEventListener(
    'change',
    () => {
      const level = store.getRenderSnapshot().activeLevel;
      if (!level || level.ambient?.baked) return;
      const ambient = {
        ...level.ambient,
        level: Math.max(0, Math.min(1, Number(ambientInput.value))),
      };
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
        updateLightBarFromStore();
      }
    },
    { signal: listeners.signal }
  );

  /**
   * Reflète les étages de la campagne et l'étage actif.
   *
   * ⚠ Ne reconstruit les options que si la **liste** a changé. Les reconstruire à chaque
   * notification du store — donc à chaque déplacement de pion — refermerait la liste déroulante
   * sous le doigt du MJ en pleine sélection, et ferait clignoter le champ pendant les animations.
   */
  function updateLevelBarFromStore() {
    // ⚠ `getLevelSummaries()` et surtout PAS `getCampaign()`. Ce dernier clone et gèle toute la
    // campagne — 2,49 ms mesurés sur une carte de 65 × 71 et 1338 murs — et cette fonction tourne
    // à **chaque mutation du store**, donc à chaque déplacement de pion. La première version
    // payait le clonage de tous les murs pour n'en tirer qu'une liste de noms.
    const etages = store.getLevelSummaries();
    const actif = store.getActiveLevelId();

    // Un seul étage : la barre n'apporte rien, elle disparaît.
    levelBar.style.display = etages.length > 1 ? 'flex' : 'none';
    if (etages.length === 0) return;

    // Signature explicite, lisible et sans caractères de contrôle littéraux.
    const signature = JSON.stringify(etages.map((l) => [l.id, l.name]));
    if (levelSelect.dataset.signature !== signature) {
      levelSelect.dataset.signature = signature;
      levelSelect.replaceChildren(
        ...etages.map((l) => {
          const opt = document.createElement('option');
          opt.value = l.id;
          opt.textContent = l.name || l.id;
          return opt;
        })
      );
    }
    if (actif && levelSelect.value !== actif) levelSelect.value = actif;
  }

  // ── Cadenas de bascule automatique (Lot 3, S-04) ─────────────────────────────────────────
  //
  // Purement local au poste MJ, et **volontairement pas dans la campagne** : c'est un réglage de
  // conduite de séance, pas un fait de jeu. Le mettre dans le document le ferait voyager jusqu'aux
  // tablettes et survivre à la partie, alors qu'il ne concerne que ce que le MJ veut montrer dans
  // les dix prochaines minutes.
  const levelLockBtn = /** @type {HTMLButtonElement} */ (container.querySelector('#gm-level-lock'));
  let levelFollowLocked = false;

  function renderLevelLock() {
    levelLockBtn.textContent = levelFollowLocked ? '🔒' : '🔓';
    levelLockBtn.setAttribute('aria-pressed', String(levelFollowLocked));
    levelLockBtn.style.background = levelFollowLocked ? '#3a2f1a' : '#1a1a1a';
    levelLockBtn.style.color = levelFollowLocked ? '#e0c080' : '#888';
    levelLockBtn.style.borderColor = levelFollowLocked ? '#6a5530' : '#444';
    levelStatus.style.color = '#888';
    levelStatus.textContent = levelFollowLocked ? 'bascule auto suspendue' : '';
  }

  levelLockBtn.addEventListener(
    'click',
    () => {
      levelFollowLocked = !levelFollowLocked;
      renderLevelLock();
    },
    { signal: listeners.signal }
  );
  renderLevelLock();

  // Le ping passe par `setActiveTool`, donc désarmer un autre outil est gratuit : c'est
  // l'exclusivité mutuelle existante qui s'en charge, pas un traitement particulier ici.
  const pingArmBtn = /** @type {HTMLButtonElement} */ (container.querySelector('#gm-ping-arm'));
  pingArmBtn.addEventListener(
    'click',
    () => setActiveTool(activeToolName === 'ping' ? 'none' : 'ping'),
    { signal: listeners.signal }
  );
  const measureArmBtn = /** @type {HTMLButtonElement} */ (container.querySelector('#gm-measure-arm'));
  measureArmBtn.addEventListener(
    'click',
    () => setActiveTool(activeToolName === 'measure' ? 'none' : 'measure'),
    { signal: listeners.signal }
  );
  updateMeasureButton();

  levelSelect.addEventListener(
    'change',
    () => {
      const cible = levelSelect.value;
      if (!cible || cible === store.getActiveLevelId()) return;
      try {
        store.selectLevel(cible);
      } catch (err) {
        levelStatus.style.color = '#e74c3c';
        levelStatus.textContent = err instanceof Error ? err.message : String(err);
        updateLevelBarFromStore();
        return;
      }
      levelStatus.style.color = '#888';
      levelStatus.textContent = '';
      // ⚠ Publier APRÈS la mutation locale, et seulement si elle a réussi : annoncer un étage que
      // le MJ n'a pas pu adopter enverrait la table où lui-même n'est pas.
      transport?.publish({
        type: 'level.select',
        payload: { levelId: cible },
        at: Date.now(),
        by: 'gm',
      });
    },
    { signal: listeners.signal }
  );

  updateLevelBarFromStore();
  updateLightBarFromStore();

  // Écouter les changements dans le store pour mettre à jour les inputs de grille si besoin
  const unsubscribeStore = store.subscribe(() => {
    updateLevelBarFromStore();
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

  return {
    /** Le cadenas de bascule automatique est-il armé ? Lu par `app/gm.js` (Lot 3, S-04). */
    isLevelFollowLocked: () => levelFollowLocked,
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
      versionBadge?.detach();
      sceneLibrary?.destroy();
      tokenLibrary?.destroy();
      handouts?.destroy();
      container.replaceChildren();
    },
  };
}
