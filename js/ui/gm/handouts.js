// @ts-check

import * as store from '../../state/store.js';
import {
  identifiantAleatoire,
  isPersistableAssetUrl,
  isUnusableGoogleDriveUrl,
  normalizeImageUrl,
} from '../../core/schema.js';
import { HANDOUT_SLOW_LOAD_MS, HANDOUT_LARGE_DIMENSION_PX } from '../../core/constants.js';

/** @typedef {import('../../transport/Transport.js').Transport} Transport */
/** @typedef {import('../../core/types.js').HandoutLibraryEntry} HandoutLibraryEntry */

/**
 * Options d'initialisation de l'interface Handouts MJ.
 * @typedef {Object} HandoutsOptions
 * @property {Transport} [transport]
 */

/**
 * Crée et monte la bibliothèque d'images de séance (handouts) du MJ — chantier C-3, tranche A.
 *
 * ⛔ **Aucune contrepartie côté joueurs.** La vue joueurs garde son overlay transitoire et rien
 * d'autre : ni liste, ni bouton, ni miniature. Le choix de ce qui est révélé vit ici.
 *
 * @param {HTMLElement} mount Élément DOM d'ancrage
 * @param {HandoutsOptions} [options]
 * @returns {{ destroy: () => void }}
 */
export function createHandouts(mount, options = {}) {
  if (!mount) {
    throw new Error('createHandouts : élément d\'ancrage requis');
  }

  const { transport } = options;
  const listeners = new AbortController();

  mount.innerHTML = `
    <div class="handouts-form" style="display: flex; flex-direction: column; gap: 1rem; background: #252525; padding: 1rem; border-radius: 6px; border: 1px solid #333;">
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem; color: #4a90e2;">Images de séance (Handouts)</h3>

      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <label for="handout-image-url" style="font-size: 0.85rem; color: #ccc;">URL de l'image (relative ou https://) :</label>
        <input type="text" id="handout-image-url" placeholder="./assets/mon-image.jpg" style="padding: 0.5rem; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;" />
      </div>

      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <label for="handout-title" style="font-size: 0.85rem; color: #ccc;">Nom / Titre (optionnel) :</label>
        <input type="text" id="handout-title" placeholder="Lettre secrète" style="padding: 0.5rem; background: #1e1e1e; color: #fff; border: 1px solid #444; border-radius: 4px; font-size: 0.85rem;" />
      </div>

      <div id="handout-error-msg" style="display: none; padding: 0.5rem; background: #3a1a1a; color: #ff6b6b; border: 1px solid #662222; border-radius: 4px; font-size: 0.8rem;"></div>
      <div id="handout-warning-msg" style="display: none; padding: 0.5rem; background: #3a3018; color: #f0c674; border: 1px solid #6b5520; border-radius: 4px; font-size: 0.8rem;"></div>

      <div style="display: flex; gap: 0.5rem;">
        <button id="handout-add-btn" style="flex: 1; padding: 0.6rem; background: #37474f; color: #fff; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">➕ Ajouter à la bibliothèque</button>
        <button id="handout-hide-btn" style="flex: 1; padding: 0.6rem; background: #c62828; color: #fff; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">🙈 Masquer</button>
      </div>

      <div id="handout-status" style="padding: 0.5rem; background: #1e1e1e; border-radius: 4px; border: 1px solid #333; font-size: 0.8rem; color: #aaa;">
        Aucun handout affiché aux joueurs.
      </div>

      <div id="handout-library" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
    </div>
  `;

  const urlInput = /** @type {HTMLInputElement} */ (mount.querySelector('#handout-image-url'));
  const titleInput = /** @type {HTMLInputElement} */ (mount.querySelector('#handout-title'));
  const errorEl = /** @type {HTMLElement} */ (mount.querySelector('#handout-error-msg'));
  const warningEl = /** @type {HTMLElement} */ (mount.querySelector('#handout-warning-msg'));
  const addBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#handout-add-btn'));
  const hideBtn = /** @type {HTMLButtonElement} */ (mount.querySelector('#handout-hide-btn'));
  const statusEl = /** @type {HTMLElement} */ (mount.querySelector('#handout-status'));
  const libraryEl = /** @type {HTMLElement} */ (mount.querySelector('#handout-library'));

  /** @param {string} message */
  function montrerErreur(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  function effacerMessages() {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    warningEl.textContent = '';
    warningEl.style.display = 'none';
  }

  /**
   * Sonde l'image qui vient d'être ajoutée et avertit le MJ si elle est lourde.
   *
   * ⛔ **Non bloquante, et sans aucun pouvoir de refus** — voir `HANDOUT_SLOW_LOAD_MS` dans
   * `core/constants.js` pour la raison de fond : le poids d'une image tierce est illisible avant
   * chargement (CORS), donc le seul plafond honnête est un avertissement sur ce qui s'observe
   * vraiment. L'entrée est déjà dans la bibliothèque quand cette sonde démarre.
   *
   * ⚠ Prend le strict nécessaire, et non une entrée de bibliothèque : la révélation sans campagne
   * n'en produit aucune, et elle a autant besoin de cet avertissement que l'ajout.
   *
   * @param {{name: string, imageUrl: string}} entry
   */
  function sonderImage(entry) {
    const debut = performance.now();
    const sonde = new Image();

    sonde.addEventListener('load', () => {
      const dureeMs = performance.now() - debut;
      const plusGrandCote = Math.max(sonde.naturalWidth, sonde.naturalHeight);
      /** @type {string[]} */
      const constats = [];
      if (dureeMs > HANDOUT_SLOW_LOAD_MS) {
        constats.push(`${(dureeMs / 1000).toFixed(1)} s pour arriver sur ce poste`);
      }
      if (plusGrandCote > HANDOUT_LARGE_DIMENSION_PX) {
        constats.push(`${sonde.naturalWidth} × ${sonde.naturalHeight} px`);
      }
      if (constats.length === 0) return;

      warningEl.textContent =
        `⚠ « ${entry.name} » est lourde (${constats.join(', ')}). La tablette des joueurs est plus ` +
        'lente que ce poste : la révélation risque de se faire attendre à la table. Une version ' +
        'réduite passerait mieux. L\'image reste dans la bibliothèque et peut être révélée.';
      warningEl.style.display = 'block';
    });

    sonde.addEventListener('error', () => {
      montrerErreur(
        `L'image n'a pas pu être chargée depuis ${entry.imageUrl} — la révéler montrerait un cadre ` +
          'vide aux joueurs. Vérifiez que le partage est bien « tous ceux qui ont le lien ».'
      );
    });

    sonde.src = entry.imageUrl;
  }

  /**
   * Révèle une image aux joueurs.
   *
   * ⭐ Chemin unique de la révélation, qu'elle vienne d'une entrée de bibliothèque ou d'un ajout
   * sans campagne : c'est ce qui garantit que l'identifiant affiché est **celui qu'on lui a
   * donné**, et qu'aucun des deux chemins ne se met à en refabriquer un de son côté.
   *
   * @param {{id: string, name: string, imageUrl: string}} handout
   */
  function reveler(handout) {
    // Une seule image à la fois : `setActiveHandout` **remplace**, il n'empile pas. Rien à masquer
    // d'abord, donc aucune fenêtre où les joueurs verraient deux images ou aucune.
    store.setActiveHandout(handout);

    if (transport) {
      transport.publish({
        type: 'handout.show',
        payload: { handout },
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  /** @param {HandoutLibraryEntry} entry */
  function revelerEntree(entry) {
    effacerMessages();
    reveler({ id: entry.id, name: entry.name, imageUrl: entry.imageUrl });
  }

  function masquer() {
    store.setActiveHandout(null);

    if (transport) {
      transport.publish({
        type: 'handout.hide',
        payload: {},
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  /** @param {HandoutLibraryEntry} entry */
  function retirerEntree(entry) {
    effacerMessages();

    // Lu **avant** le retrait : la mutation efface le handout actif s'il désigne cette entrée, et
    // on ne pourrait plus le constater après coup. Sans ce masquage, la TV garderait une image que
    // le MJ croit supprimée, et plus aucune entrée ne permettrait de la retirer de l'écran.
    const etaitAffichee = store.getActiveHandout()?.id === entry.id;

    try {
      store.removeHandoutFromLibrary(entry.id);
    } catch (err) {
      montrerErreur(
        `Retrait impossible : ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    if (etaitAffichee && transport) {
      transport.publish({
        type: 'handout.hide',
        payload: {},
        at: Date.now(),
        by: 'gm',
      });
    }
  }

  /**
   * Dessine la carte d'une entrée : aperçu, nom, révélation, retrait.
   *
   * @param {HandoutLibraryEntry} entry
   * @returns {HTMLElement}
   */
  function rendreEntree(entry) {
    const card = document.createElement('div');
    card.className = 'handout-entry';
    card.dataset.handoutId = entry.id;
    card.style.display = 'flex';
    card.style.alignItems = 'center';
    card.style.gap = '0.5rem';
    card.style.background = '#1e1e1e';
    card.style.border = '1px solid #333';
    card.style.borderRadius = '4px';
    card.style.padding = '0.4rem';

    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'handout-reveal-btn';
    revealBtn.style.flex = '1';
    revealBtn.style.display = 'flex';
    revealBtn.style.alignItems = 'center';
    revealBtn.style.gap = '0.6rem';
    revealBtn.style.background = 'transparent';
    revealBtn.style.border = 'none';
    revealBtn.style.color = '#ddd';
    revealBtn.style.cursor = 'pointer';
    revealBtn.style.textAlign = 'left';
    revealBtn.style.font = 'inherit';
    revealBtn.title = `Révéler « ${entry.name} » aux joueurs`;

    const thumb = document.createElement('img');
    thumb.className = 'handout-entry-thumb';
    thumb.src = entry.imageUrl;
    thumb.alt = '';
    thumb.style.width = '64px';
    thumb.style.height = '48px';
    thumb.style.objectFit = 'cover';
    thumb.style.background = '#000';
    thumb.style.borderRadius = '3px';
    thumb.style.flex = '0 0 auto';

    const label = document.createElement('span');
    label.className = 'handout-entry-name';
    label.textContent = entry.name;
    label.style.fontSize = '0.85rem';
    label.style.overflowWrap = 'anywhere';

    revealBtn.append(thumb, label);
    revealBtn.addEventListener('click', () => revelerEntree(entry), { signal: listeners.signal });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'handout-remove-btn';
    removeBtn.textContent = '🗑️';
    removeBtn.title = `Retirer « ${entry.name} » de la bibliothèque`;
    removeBtn.style.flex = '0 0 auto';
    removeBtn.style.padding = '0.4rem 0.5rem';
    removeBtn.style.background = '#3a1a1a';
    removeBtn.style.color = '#ff6b6b';
    removeBtn.style.border = '1px solid #662222';
    removeBtn.style.borderRadius = '4px';
    removeBtn.style.cursor = 'pointer';
    removeBtn.addEventListener('click', () => retirerEntree(entry), { signal: listeners.signal });

    card.append(revealBtn, removeBtn);
    return card;
  }

  /**
   * Signature de la bibliothèque telle qu'elle est actuellement dessinée. Redessiner à chaque
   * mutation du store ferait recharger toutes les miniatures au moindre déplacement de pion.
   *
   * `null` vaut « rien n'a encore été dessiné », un état qu'aucune signature ne peut prendre —
   * plutôt qu'une chaîne sentinelle, qui obligeait à choisir une valeur impossible et l'écrivait
   * avec des séparateurs de contrôle. ⚠ Ces octets rendaient le fichier **binaire aux yeux de
   * git**, donc sans diff et sans revue possible : ne pas en réintroduire ici ni ailleurs.
   * `JSON.stringify` d'un tableau de champs est sans ambiguïté et reste du texte.
   *
   * @type {string|null}
   */
  let signatureDessinee = null;

  function rafraichirUI() {
    const entries = [...store.getHandoutLibrary()].sort((a, b) => a.addedAt - b.addedAt);
    const signature = JSON.stringify(entries.map((e) => [e.id, e.name, e.imageUrl]));

    if (signature !== signatureDessinee) {
      signatureDessinee = signature;
      libraryEl.replaceChildren();
      if (entries.length === 0) {
        const vide = document.createElement('p');
        vide.className = 'handout-library-empty';
        vide.textContent = 'Bibliothèque vide : collez une URL d\'image ci-dessus pour l\'ajouter.';
        vide.style.margin = '0';
        vide.style.fontSize = '0.8rem';
        vide.style.color = '#777';
        libraryEl.appendChild(vide);
      } else {
        for (const entry of entries) {
          libraryEl.appendChild(rendreEntree(entry));
        }
      }
    }

    const active = store.getActiveHandout();
    if (active && active.imageUrl) {
      const displayName = active.name ? active.name : active.imageUrl;
      // ⚠ Recalculé depuis l'état, et non écrit une fois au moment du geste : le MJ lit « non
      // enregistrée » **tant que** l'image est à l'écran, pas seulement à la seconde où il a
      // cliqué. C'est une propriété de ce qui est affiché, pas une notification.
      const enregistre = entries.some((e) => e.id === active.id);
      if (enregistre) {
        statusEl.style.borderColor = '#2e7d32';
        statusEl.style.color = '#81c784';
        statusEl.textContent = `🟢 Affiché aux joueurs : ${displayName}`;
      } else {
        statusEl.style.borderColor = '#6b5520';
        statusEl.style.color = '#f0c674';
        statusEl.textContent =
          `🟡 Affiché aux joueurs : ${displayName} — ⚠ NON enregistrée : ` +
          (store.getCampaign()
            ? 'cette image ne figure pas dans la bibliothèque.'
            : 'la bibliothèque appartient à la campagne, et aucune n\'est chargée.');
      }
    } else {
      statusEl.style.borderColor = '#333';
      statusEl.style.color = '#aaa';
      statusEl.textContent = '⚪ Aucun handout affiché aux joueurs.';
    }

    for (const card of libraryEl.querySelectorAll('.handout-entry')) {
      const affichee = active !== null && card instanceof HTMLElement && card.dataset.handoutId === active.id;
      if (card instanceof HTMLElement) {
        card.style.borderColor = affichee ? '#2e7d32' : '#333';
      }
    }
  }

  addBtn.addEventListener('click', () => {
    effacerMessages();
    const saisie = urlInput.value.trim();

    if (!saisie) {
      montrerErreur('Veuillez saisir une URL d\'image.');
      return;
    }

    if (isUnusableGoogleDriveUrl(saisie)) {
      montrerErreur(
        'Ce lien Google Drive ne désigne pas un fichier (un dossier ?). Ouvrez l\'image dans Drive, puis copiez son lien de partage.'
      );
      return;
    }

    // Un lien de partage Drive est une page HTML : converti ici, avant le store et avant le
    // réseau, pour que ce soit une URL affichable qui parte — et non à l'affichage, où le
    // défaut se serait manifesté sur l'écran des joueurs.
    //
    // ⛔ Cette conversion reste **propre aux handouts** : elle ne vaut ni pour les fonds de carte
    // ni pour les images de pions. L'y étendre est un autre chantier, pas un effet de bord de
    // celui-ci.
    const url = normalizeImageUrl(saisie);
    // Le champ reflète ce qui est réellement enregistré : le MJ voit la conversion plutôt que de
    // la subir.
    if (url !== saisie) urlInput.value = url;

    if (!isPersistableAssetUrl(url)) {
      montrerErreur(
        'URL non persistable : les images data: et blob: ou absolues non-https sont interdites. Déposez le fichier dans un dossier du dépôt.'
      );
      return;
    }

    const nom = titleInput.value.trim() || 'Sans titre';

    // ⭐ **Sans campagne, le geste révèle au lieu d'échouer.** La bibliothèque est enregistrée DANS
    // la campagne, donc il n'y a effectivement nulle part où l'écrire — mais montrer une image n'a
    // **jamais** exigé de campagne (chantier H : « un handout peut être affiché avant tout
    // chargement de carte »), et faire passer la révélation par la bibliothèque aurait retiré cette
    // capacité en silence. Rien ne se déplace dans le dos de personne : le MJ obtient ce qu'il
    // voulait, et le statut lui dit exactement ce qu'il n'obtient pas.
    //
    // ⚠ Les deux champs ne sont **pas** vidés ici : l'URL n'est enregistrée nulle part, donc ce
    // formulaire est le seul endroit où elle existe encore. La vider empêcherait de re-révéler
    // l'image après un masquage.
    if (!store.getCampaign()) {
      const ephemere = { id: `handout-${identifiantAleatoire()}`, name: nom, imageUrl: url };
      reveler(ephemere);
      sonderImage(ephemere);
      return;
    }

    /** @type {HandoutLibraryEntry} */
    let entry;
    try {
      entry = store.addHandoutToLibrary({ name: nom, imageUrl: url });
    } catch (err) {
      montrerErreur(
        `Ajout impossible : ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    urlInput.value = '';
    titleInput.value = '';

    // ⚠ Après l'ajout, jamais avant : l'avertissement de taille n'a aucun droit de veto.
    sonderImage(entry);
  }, { signal: listeners.signal });

  hideBtn.addEventListener('click', () => {
    effacerMessages();
    masquer();
  }, { signal: listeners.signal });

  const unsubscribeStore = store.subscribe(rafraichirUI);
  rafraichirUI();

  return {
    destroy: () => {
      listeners.abort();
      unsubscribeStore();
      mount.replaceChildren();
    },
  };
}
