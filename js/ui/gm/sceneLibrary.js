// @ts-check
import { loadCatalog } from '../../import/catalog.js';
import { validateCampaign, normalizeCampaign } from '../../core/schema.js';
import * as store from '../../state/store.js';

/**
 * @typedef {import('../../transport/Transport.js').Transport} Transport
 * @typedef {import('../../import/catalog.js').CatalogMap} CatalogMap
 * @typedef {import('../../core/types.js').SceneLibraryEntry} SceneLibraryEntry
 */

/**
 * Options du composant sceneLibrary
 * @typedef {Object} SceneLibraryOptions
 * @property {Transport} [transport] Transport optionnel pour la synchronisation
 * @property {string} [catalogUrl='maps/catalog.json'] URL relative du catalogue
 */

/**
 * Monte une bibliothèque de cartes préparées.
 *
 * Charge `maps/catalog.json`, affiche les cartes disponibles et permet de
 * charger une scène préparée sans qu'aucune URL ne soit saisie par le MJ.
 *
 * @param {HTMLElement} container Élément HTML conteneur
 * @param {SceneLibraryOptions} [options={}]
 * @returns {Promise<{destroy: () => void}>}
 */
export async function createSceneLibrary(container, options = {}) {
  if (!container) {
    throw new Error('createSceneLibrary : conteneur HTML requis');
  }

  const { transport, catalogUrl = 'maps/catalog.json' } = options;
  const listeners = new AbortController();

  container.innerHTML = `
    <div class="scene-library gm-stack">
      <div class="scene-library-status gm-status gm-muted">
        Chargement du catalogue…
      </div>
      <div class="scene-library-list gm-stack"></div>
    </div>
  `;

  const statusEl = /** @type {HTMLElement} */ (container.querySelector('.scene-library-status'));
  const listEl = /** @type {HTMLElement} */ (container.querySelector('.scene-library-list'));

  /**
   * Affiche un message d'état dans le panneau. Les erreurs doivent rester
   * visibles dans l'interface (plan §7) et non dans la seule console.
   *
   * @param {'info'|'ok'|'error'} kind
   * @param {string} message
   */
  function setStatus(kind, message) {
    statusEl.classList.remove('gm-ok', 'gm-err', 'gm-muted');
    statusEl.classList.add(kind === 'ok' ? 'gm-ok' : kind === 'error' ? 'gm-err' : 'gm-muted');
    statusEl.textContent = message;
  }

  /**
   * Charge une scène préparée dans le store, de façon transactionnelle.
   *
   * Les URLs du catalogue restent RELATIVES : le navigateur les résout par
   * rapport au document, ce qui fonctionne aussi sous un sous-chemin.
   *
   * @param {CatalogMap} mapEntry
   * @param {'load'|'add'} mode
   * @param {HTMLButtonElement} loadBtn
   * @param {HTMLButtonElement} addBtn
   */
  async function handleLoadScene(mapEntry, mode, loadBtn, addBtn) {
    const btn = mode === 'load' ? loadBtn : addBtn;
    const originalLabel = btn.textContent;

    loadBtn.disabled = true;
    addBtn.disabled = true;

    try {
      const response = await fetch(mapEntry.sceneUrl);
      if (!response.ok) {
        throw new Error(
          `${response.status} ${response.statusText} en chargeant ${mapEntry.sceneUrl}`
        );
      }

      const sceneData = await response.json();
      const normalizedData = normalizeCampaign(sceneData);

      // Valider AVANT toute mutation du store (plan §7.2)
      const errors = validateCampaign(normalizedData);
      if (errors.length > 0) {
        throw new Error(`scène invalide — ${errors.join(' ; ')}`);
      }

      // Vérifier la cohérence scène/catalogue (plan §7.3). Un écart signale des
      // artefacts non régénérés : on le signale au lieu de l'écraser en silence.
      const sceneImageUrl = normalizedData.levels?.[0]?.imageUrl;
      if (sceneImageUrl !== mapEntry.imageUrl) {
        throw new Error(
          `incohérence d'artefacts — la scène référence "${sceneImageUrl}" ` +
            `alors que le catalogue annonce "${mapEntry.imageUrl}". ` +
            'Relancez `pnpm maps:prepare`.'
        );
      }

      if (mode === 'load') {
        store.loadCampaign(normalizedData);
      } else {
        for (const level of normalizedData.levels) {
          store.addLevel(level);
        }
      }

      // Synchronisation joueurs (U-05). Les deux modes ne diffusent pas la même
      // chose parce qu'ils ne font pas la même chose côté MJ :
      //   — « Charger » *remplace* la campagne. Seul un instantané absolu
      //     propage aussi la disparition des étages précédents, qu'une suite de
      //     `level.add` ne peut pas exprimer.
      //   — « Ajouter comme étage » est additif : un `level.add` par étage, au
      //     format attendu par js/app/networkEvents.js (`{ level }` au singulier).
      //
      // `scene.load` est le type du cahier des charges §7 ; rien n'est inventé.
      // Le payload ne porte que l'état non recalculable (CONVENTIONS §4) : ni
      // étage actif dérivé, ni cases atteignables, ni pion sélectionné résolu.
      //
      // ⭐ On ATTEND le résultat : annoncer « ✓ chargée » alors que rien n'est parti a déjà laissé
      // passer un défaut de canal pendant plusieurs séances (E-9). `publish` ne rejette jamais,
      // elle rend `{ok}` — d'où la lecture explicite plutôt qu'un `try`.
      if (transport) {
        /** @type {import('../../transport/Transport.js').PublishResult} */
        let resultat = { ok: true };
        if (mode === 'load') {
          resultat = await transport.publish({
            type: 'scene.load',
            payload: {
              campaign: store.getCampaign(),
              activeLevelId: store.getActiveLevelId(),
              selectedTokenId: null,
            },
            at: Date.now(),
            by: 'gm',
          });
        } else {
          for (const level of sceneData.levels) {
            const etage = await transport.publish({
              type: 'level.add',
              payload: { level },
              at: Date.now(),
              by: 'gm',
            });
            // Le premier échec suffit à disqualifier l'annonce : les étages suivants partent
            // quand même, parce qu'interrompre laisserait la table dans un état plus partiel
            // encore que celui qu'on signale.
            if (!etage.ok && resultat.ok) resultat = etage;
          }
        }

        if (!resultat.ok) {
          setStatus(
            'error',
            `⚠ « ${mapEntry.name} » chargée ici, mais NON transmise à la table — ${resultat.error.message}`
          );
          return;
        }
      }

      setStatus(
        'ok',
        mode === 'load'
          ? `✓ « ${mapEntry.name} » chargée — ${mapEntry.features.walls} murs, ${mapEntry.features.portals} portes`
          : `✓ « ${mapEntry.name} » ajoutée comme étage`
      );

      btn.textContent = '✓ Fait';
      btn.classList.add('gm-flash-ok');
      setTimeout(() => {
        btn.textContent = originalLabel;
        btn.classList.remove('gm-flash-ok');
      }, 1500);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatus('error', `✗ « ${mapEntry.name} » non chargée : ${errMsg}`);
    } finally {
      loadBtn.disabled = false;
      addBtn.disabled = false;
    }
  }

  /**
   * Construit la vignette d'une carte ou d'un étage.
   *
   * Sans `thumbUrl` — tout catalogue publié avant la tranche C-1 —, on rend un substitut
   * de la même boîte : une `<img>` sans source afficherait une icône d'image cassée, et un
   * élément absent ferait sauter la mise en page d'une carte à l'autre.
   *
   * @param {string|undefined} thumbUrl
   * @param {string} alt
   * @param {{ largeur: string, hauteur: string }} taille
   * @returns {HTMLElement}
   */
  function renderThumb(thumbUrl, alt, taille) {
    if (!thumbUrl) {
      const substitut = document.createElement('div');
      substitut.className = 'scene-card-thumb-placeholder';
      substitut.title = 'Aucune vignette — relancez `pnpm maps:prepare`';
      substitut.textContent = '🗺️';
      substitut.style.width = taille.largeur;
      substitut.style.height = taille.hauteur;
      substitut.style.display = 'flex';
      substitut.style.alignItems = 'center';
      substitut.style.justifyContent = 'center';
      substitut.style.background = 'var(--gm-creux)';
      substitut.style.border = '1px dashed var(--gm-trait)';
      substitut.style.borderRadius = 'var(--gm-r)';
      substitut.style.color = 'var(--gm-texte-3)';
      substitut.style.boxSizing = 'border-box';
      return substitut;
    }

    // L'URL reste RELATIVE, comme partout ailleurs dans ce fichier.
    const img = document.createElement('img');
    img.className = 'scene-card-thumb';
    img.src = thumbUrl;
    img.alt = alt;
    img.loading = 'lazy';
    img.style.width = taille.largeur;
    img.style.height = taille.hauteur;
    img.style.objectFit = 'cover';
    img.style.display = 'block';
    img.style.borderRadius = 'var(--gm-r)';
    return img;
  }

  /**
   * Construit la liste des étages d'une scène qui en compte plusieurs.
   *
   * ⭐ Elle existe parce que « ➕ Ajouter étage » ajoute **tous** les étages de la scène, et
   * que rien ne disait lesquels.
   *
   * @param {SceneLibraryEntry[]} levels
   * @returns {HTMLElement}
   */
  function renderLevelList(levels) {
    const listeEl = document.createElement('ul');
    listeEl.className = 'scene-card-levels gm-stack';
    listeEl.style.listStyle = 'none';
    listeEl.style.margin = '0';
    listeEl.style.padding = '0';

    for (const level of levels) {
      const item = document.createElement('li');
      item.className = 'scene-card-level gm-row';
      item.dataset.levelId = level.levelId;
      item.style.flexWrap = 'nowrap';
      item.style.minWidth = '0';

      const nomEl = document.createElement('span');
      nomEl.className = 'scene-card-level-name gm-muted';
      nomEl.textContent = level.name;
      nomEl.style.overflow = 'hidden';
      nomEl.style.textOverflow = 'ellipsis';
      nomEl.style.whiteSpace = 'nowrap';

      item.append(
        renderThumb(level.thumbUrl, `Vignette de l’étage ${level.name}`, {
          largeur: '48px',
          hauteur: '36px',
        }),
        nomEl
      );
      listeEl.appendChild(item);
    }

    return listeEl;
  }

  /**
   * Construit la carte d'une entrée du catalogue.
   *
   * @param {CatalogMap} mapEntry
   * @returns {HTMLElement}
   */
  function renderMapCard(mapEntry) {
    const mapCard = document.createElement('div');
    mapCard.className = 'scene-card gm-section gm-stack';
    mapCard.dataset.mapId = mapEntry.id;

    const header = document.createElement('div');

    const nameEl = document.createElement('h3');
    nameEl.className = 'scene-card-name gm-title';
    nameEl.textContent = mapEntry.name;
    nameEl.style.margin = '0';

    const countersEl = document.createElement('div');
    countersEl.className = 'scene-card-counters gm-muted';

    const feats = mapEntry.features;
    const plur = (/** @type {number} */ n, /** @type {string} */ un, /** @type {string} */ plu) =>
      `${n} ${n > 1 ? plu : un}`;
    const parts = [
      plur(feats.walls, 'mur', 'murs'),
      plur(feats.portals, 'porte', 'portes'),
      plur(feats.lights, 'lumière', 'lumières'),
    ];
    if (feats.bakedLighting) parts.push('éclairage intégré à l’image');
    countersEl.textContent = parts.join(' · ');

    header.append(nameEl, countersEl);

    const actions = document.createElement('div');
    actions.className = 'gm-row';

    /**
     * @param {string} className
     * @param {string} label
     * @returns {HTMLButtonElement}
     */
    const makeButton = (className, label) => {
      const btn = document.createElement('button');
      btn.className = className;
      btn.textContent = label;
      return btn;
    };

    const loadBtn = makeButton('scene-card-load gm-btn--sm gm-btn--primary', '📂 Charger');
    const addBtn = makeButton('scene-card-add gm-btn--sm', '➕ Ajouter étage');

    loadBtn.addEventListener(
      'click',
      () => {
        void handleLoadScene(mapEntry, 'load', loadBtn, addBtn);
      },
      { signal: listeners.signal }
    );

    addBtn.addEventListener(
      'click',
      () => {
        void handleLoadScene(mapEntry, 'add', loadBtn, addBtn);
      },
      { signal: listeners.signal }
    );

    actions.append(loadBtn, addBtn);

    // La vignette de la carte tient toute la largeur du panneau, hauteur bornée : à 1024 px
    // le panneau ne fait que ~360 px, et rien ne doit en dépasser (tests/gmPanelOverflow).
    mapCard.append(
      renderThumb(mapEntry.thumbUrl, `Vignette de « ${mapEntry.name} »`, {
        largeur: '100%',
        hauteur: '110px',
      }),
      header
    );
    // Une scène à un seul étage n'apprend rien de plus à l'énumérer.
    if (mapEntry.levels && mapEntry.levels.length > 1) {
      mapCard.appendChild(renderLevelList(mapEntry.levels));
    }
    mapCard.appendChild(actions);
    return mapCard;
  }

  try {
    const catalog = await loadCatalog(catalogUrl);

    if (catalog.maps.length === 0) {
      setStatus(
        'info',
        'Aucune carte disponible. Déposez un .uvtt dans maps/ puis lancez `pnpm maps:prepare`.'
      );
      return { destroy: () => listeners.abort() };
    }

    setStatus('ok', `✓ ${catalog.maps.length} carte(s) disponible(s)`);
    for (const mapEntry of catalog.maps) {
      listEl.appendChild(renderMapCard(mapEntry));
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    setStatus('error', `✗ Bibliothèque indisponible : ${errMsg}`);
    listEl.replaceChildren();
  }

  return {
    destroy: () => {
      listeners.abort();
    },
  };
}
