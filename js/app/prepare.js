import { createLinkEditor } from '../ui/gm/linkEditor.js';
import { createTokenMaker } from '../ui/gm/tokenMaker.js';
import { gridFor } from '../grid/index.js';
import { screenToMapPoint } from '../render/camera.js';

/** @type {HTMLElement} */
const journal = /** @type {HTMLElement} */ (document.getElementById('journal'));
const horsLigne = /** @type {HTMLElement} */ (document.getElementById('hors-ligne'));
const outil = /** @type {HTMLElement} */ (document.getElementById('outil'));
const selSource = /** @type {HTMLSelectElement} */ (document.getElementById('source'));
const details = /** @type {HTMLElement} */ (document.querySelector('#details tbody'));
const variantes = /** @type {HTMLElement} */ (document.getElementById('variantes'));

const champPpc = /** @type {HTMLInputElement} */ (document.getElementById('ppc'));
const champCap = /** @type {HTMLInputElement} */ (document.getElementById('cap'));
const champQual = /** @type {HTMLInputElement} */ (document.getElementById('qual'));
const champForce = /** @type {HTMLInputElement} */ (document.getElementById('force'));
const btnPreview = /** @type {HTMLButtonElement} */ (document.getElementById('btn-preview'));
const btnVider = /** @type {HTMLButtonElement} */ (document.getElementById('btn-vider'));
const btnPublish = /** @type {HTMLButtonElement} */ (document.getElementById('btn-publish'));

const etat = /** @type {HTMLElement} */ (document.getElementById('prep-etat'));
const btnJournal = /** @type {HTMLButtonElement} */ (document.getElementById('btn-journal'));

/** @type {any[]} */
let sources = [];
/** @type {any[]} sources que le serveur n'a pas su lire — elles restent listées, jamais écartées */
let illisibles = [];

/** @param {boolean} ouvert */
function deplierJournal(ouvert) {
  etat.classList.toggle('ouvert', ouvert);
  btnJournal.setAttribute('aria-expanded', String(ouvert));
  btnJournal.textContent = ouvert ? 'Replier' : 'Déplier';
}

btnJournal.addEventListener('click', () => deplierJournal(!etat.classList.contains('ouvert')));

/**
 * Écrit dans la barre d'état. Un message de plusieurs lignes la déplie de lui-même : c'est le
 * cas de l'inventaire de suppression et des avertissements de publication, qu'une ligne
 * tronquée cacherait.
 *
 * @param {string} texte
 */
function dire(texte) {
  journal.textContent = texte;
  const tete = texte.trimStart().charAt(0);
  journal.dataset.ton = tete === '✓' ? 'ok' : tete === '✗' ? 'erreur' : tete === '⚠' ? 'avert' : '';
  deplierJournal(texte.includes('\n'));
}

// --- Ateliers ------------------------------------------------------------------------

const ateliers = /** @type {HTMLElement} */ (document.getElementById('prep-ateliers'));
/** @type {Set<string>} */
const NOMS_ATELIERS = new Set(['cartes', 'liaisons', 'pions']);

/**
 * Affiche un atelier. Le nom va dans l'adresse (`#pions`) pour qu'un rechargement rouvre le
 * même : on recharge souvent cette page après avoir déposé un fichier dans `maps/`.
 *
 * @param {string} nom
 */
function ouvrirAtelier(nom) {
  if (!NOMS_ATELIERS.has(nom)) nom = 'cartes';
  for (const onglet of ateliers.querySelectorAll('button[data-atelier]')) {
    const actif = /** @type {HTMLElement} */ (onglet).dataset.atelier === nom;
    onglet.setAttribute('aria-selected', String(actif));
    const panneau = document.getElementById(`atelier-${/** @type {HTMLElement} */ (onglet).dataset.atelier}`);
    if (panneau) panneau.hidden = !actif;
  }
  if (location.hash !== `#${nom}`) history.replaceState(null, '', `#${nom}`);
  // Un canvas mesuré pendant que son atelier était caché l'a été à 0 × 0 : la vue se cadre
  // à la première ouverture, puis garde le cadrage choisi.
  if (nom === 'liaisons') {
    if (vueACadrer) resetMapView();
    else drawMapCanvas();
  }
}

ateliers.addEventListener('click', (e) => {
  const onglet = /** @type {HTMLElement} */ (e.target).closest('button[data-atelier]');
  if (onglet) ouvrirAtelier(/** @type {HTMLElement} */ (onglet).dataset.atelier ?? 'cartes');
});

/** @param {number} octets */
function mio(octets) {
  return `${(octets / 1048576).toFixed(2)} Mio`;
}

/**
 * Appelle l'API locale et remonte l'erreur *du serveur*, pas un « échec » générique.
 *
 * @param {string} route
 * @param {any} [body]
 * @returns {Promise<any>}
 */
async function api(route, body) {
  const reponse = await fetch(route, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error ?? `HTTP ${reponse.status}`);
  return donnees;
}

/**
 * Affiche les faits de la source, tels que le serveur les rapporte.
 *
 * **Aucune projection ici.** Une première version calculait dans le navigateur ce que la
 * chaîne allait produire — donc rejouait le raisonnement de `resample.mjs`, exactement ce
 * que ce chantier interdit, et le test d'architecture l'a refusé pour la bonne raison. La
 * vérité sur la sortie s'obtient en fabriquant une variante, pas en la devinant.
 */
function afficherDetails() {
  const src = sources.find((s) => s.file === selSource.value);
  if (!src) {
    const illisible = illisibles.find((i) => i.file === selSource.value);
    details.replaceChildren();
    if (illisible) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = 'Illisible';
      const td = document.createElement('td');
      td.textContent = `⚠ ${illisible.file} : ${illisible.error}`;
      tr.append(th, td);
      details.appendChild(tr);
    }
    btnPreview.disabled = !src;
    return;
  }
  btnPreview.disabled = false;
  // Chaque compte confronte le retenu au déclaré. Sur un export venu d'un outil qu'on n'a
  // jamais vu, l'écart entre les deux est toute l'information utile : « 0 / 141 portes »
  // se lit d'un coup d'œil, là où un simple « 0 porte » ressemble à une carte sans porte.
  /** @param {number} retenu @param {number} declare */
  const compte = (retenu, declare) =>
    retenu === declare ? `${retenu}` : `${retenu} sur ${declare} ⚠`;

  const lignes = [
    ['Fichier', `${src.file} — ${mio(src.bytes)}`],
    ['Grille', `${src.cellsX} × ${src.cellsY} cases à ${src.densiteSource} px/case`],
    ['Image source', `${src.sourceWidth} × ${src.sourceHeight}`],
    [
      'Géométrie retenue',
      `${compte(src.walls, src.declares.walls)} murs, ` +
        `${compte(src.portals, src.declares.portals)} portes, ` +
        `${compte(src.lights, src.declares.lights)} lumières`,
    ],
    // Surtout pas « éclairage cuit » : c'est la traduction littérale de `baked_lighting`,
    // et elle n'apprend rien à qui ne connaît pas le terme. Ce qui compte est l'effet.
    [
      'Lumière',
      src.bakedLighting
        ? 'déjà peinte dans l’image — un éclairage dynamique s’y ajouterait en double'
        : 'absente de l’image — l’image est neutre',
    ],
  ];
  if (src.warnings.length > 0) {
    lignes.push([
      'À la lecture',
      src.warnings.map((/** @type {string} */ w) => `⚠ ${w}`),
    ]);
  }

  details.replaceChildren(
    ...lignes.map(([label, value]) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = label;
      const td = document.createElement('td');
      if (Array.isArray(value)) {
        value.forEach((warning, index) => {
          if (index > 0) td.appendChild(document.createElement('br'));
          td.appendChild(document.createTextNode(warning));
        });
      } else {
        td.textContent = value;
      }
      tr.append(th, td);
      return tr;
    })
  );
}

/** @param {any} v résultat de /api/preview */
function ajouterVariante(v) {
  const bloc = document.createElement('div');
  bloc.className = 'variante';

  const titre = document.createElement('h3');
  titre.textContent = `${v.settings.targetPxPerCell} px/case · plafond ${v.settings.maxTexturePx} · q${v.settings.quality}`;
  bloc.appendChild(titre);

  const dl = document.createElement('dl');
  for (const [k, val] of [
    ['Sortie', `${v.width} × ${v.height}`],
    ['Densité', `${v.densiteSortie.toFixed(1)} px/case`],
    ['Poids', mio(v.bytes)],
    ['Durée', `${(v.elapsedMs / 1000).toFixed(1)} s`],
  ]) {
    const dt = document.createElement('dt');
    dt.textContent = String(k);
    const dd = document.createElement('dd');
    dd.textContent = String(val);
    dl.append(dt, dd);
  }
  bloc.appendChild(dl);

  // Deux vues : la carte entière pour le cadrage, et un détail à l'échelle 1:1 — c'est
  // seulement à cette échelle qu'une différence de qualité se juge.
  const img = document.createElement('img');
  img.className = 'apercu';
  img.src = v.imageUrl;
  img.alt = `Aperçu ${v.variant}`;
  bloc.appendChild(img);

  const bascule = document.createElement('button');
  bascule.textContent = 'Voir la carte entière';
  bascule.addEventListener('click', () => {
    const entier = img.classList.toggle('entier');
    bascule.textContent = entier ? 'Voir un détail à 1:1' : 'Voir la carte entière';
  });
  bloc.appendChild(bascule);

  if (v.warnings.length > 0) {
    const p = document.createElement('p');
    p.className = 'avert';
    p.textContent = `⚠ ${v.warnings.join(' — ')}`;
    bloc.appendChild(p);
  }

  variantes.appendChild(bloc);
  btnVider.disabled = false;
}

/**
 * @param {HTMLButtonElement} bouton
 * @param {() => Promise<void>} action
 */
async function pendant(bouton, action) {
  const avant = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = 'En cours…';
  try {
    await action();
  } catch (err) {
    dire(`✗ ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    bouton.disabled = false;
    bouton.textContent = avant;
  }
}

btnPreview.addEventListener('click', () =>
  pendant(btnPreview, async () => {
    const v = await api('/api/preview', {
      file: selSource.value,
      targetPxPerCell: Number(champPpc.value),
      maxTexturePx: Number(champCap.value),
      quality: Number(champQual.value),
    });
    ajouterVariante(v);
    dire(`✓ Variante ${v.variant} fabriquée en ${(v.elapsedMs / 1000).toFixed(1)} s.`);
  })
);

btnVider.addEventListener('click', () => {
  variantes.replaceChildren();
  btnVider.disabled = true;
  dire('Variantes retirées de l’affichage. Les fichiers restent dans maps/.preview/.');
});

btnPublish.addEventListener('click', () =>
  pendant(btnPublish, async () => {
    const r = await api('/api/publish', { force: champForce.checked });
    const avert = r.warnings.length ? `\n\nAvertissements :\n - ${r.warnings.join('\n - ')}` : '';
    dire(
      `✓ Catalogue publié en ${(r.elapsedMs / 1000).toFixed(1)} s : ${r.mapsCount} carte(s), ` +
        `dont ${r.preparedCount} refabriquée(s) et ${r.skippedCount} réutilisée(s).` +
        `\n${r.totalWalls} murs, ${r.totalPortals} portes, ${r.totalLights} lumières.${avert}`
    );
    await rechargerCatalogueEtCartes();
  })
);

/**
 * Les variantes affichées sont celles d'une source : en changer les retire de l'écran, pas du
 * disque — comparer les réglages de deux cartes différentes n'apprendrait rien.
 */
function changerDeSource() {
  variantes.replaceChildren();
  btnVider.disabled = true;
  afficherDetails();
}

selSource.addEventListener('change', changerDeSource);

// --- Bibliothèque de pions ---------------------------------------------------------

const tokensListe = /** @type {HTMLElement} */ (document.getElementById('tokens-liste'));
const pionsFabrique = /** @type {HTMLElement} */ (document.getElementById('pions-fabrique'));

/** @param {any[]} tokens */
function afficherTokens(tokens) {
  tokensListe.replaceChildren();
  if (tokens.length === 0) {
    const p = document.createElement('p');
    p.className = 'pions-vide';
    p.textContent = 'Bibliothèque vide. Le fabricant, à gauche, la remplit.';
    tokensListe.appendChild(p);
    return;
  }

  for (const t of tokens) {
    const carte = document.createElement('article');
    carte.className = 'pion';
    // La couleur de bordure du pion, telle qu'il la portera sur la carte. Posée comme
    // variable, jamais comme style : la feuille garde la main sur tout le reste.
    if (typeof t.borderColor === 'string') carte.style.setProperty('--pion-bord', t.borderColor);

    const img = document.createElement('img');
    img.src = `/${t.imageUrl}?v=${encodeURIComponent(t.imageUrl)}-${tokens.length}`;
    img.alt = t.name;

    const info = document.createElement('div');
    const maxHpStr = typeof t.maxHp === 'number' && t.maxHp >= 1 ? `${t.maxHp} PV` : 'sans PV';
    const name = document.createElement('strong');
    name.textContent = t.name;
    const genre = document.createElement('span');
    genre.className = t.kind === 'pc' ? 'genre pj' : 'genre';
    genre.textContent = t.kind === 'pc' ? 'PJ' : 'PNJ';
    const metadata = document.createElement('span');
    metadata.className = 'meta';
    metadata.append(
      genre,
      `${t.id} · taille ${t.sizeCells} · vitesse ${t.speedCells} · vision ${t.visionDim} · ${maxHpStr}`
    );

    const actions = document.createElement('div');
    actions.className = 'actions';

    const bEdit = document.createElement('button');
    bEdit.className = 'gm-btn--sm';
    bEdit.textContent = 'Éditer';
    bEdit.addEventListener('click', () => {
      prepTokenMaker?.populateFromToken(t);
      pionsFabrique.scrollTo({ top: 0, behavior: 'smooth' });
      dire(`Édition de « ${t.name} » (${t.id}). Modifiez les champs puis cliquez sur Mettre à jour.`);
    });

    const bDel = document.createElement('button');
    bDel.className = 'gm-btn--sm gm-btn--ghost';
    bDel.textContent = 'Supprimer';
    bDel.addEventListener('click', () =>
      pendant(bDel, async () => {
        const r = await api('/api/tokens/delete', { id: t.id });
        afficherTokens(r.tokens);
        dire(
          `✓ « ${r.removed.name} » retiré de la bibliothèque.\n` +
            `Son image ${r.orphan} est conservée : une campagne enregistrée peut encore la référencer.`
        );
      })
    );

    actions.append(bEdit, bDel);
    info.append(name, metadata, actions);
    carte.append(img, info);
    tokensListe.appendChild(carte);
  }
}

// --- Bibliothèque de cartes (tranche C-1) ------------------------------------------
//
// Depuis la refonte de l'outil, la liste des sources et la bibliothèque ne font qu'une : une
// carte se choisit à gauche, et sa fiche — faits de la source, comparaison de réglages,
// renommer, supprimer — s'affiche à droite.

const cartesItems = /** @type {HTMLElement} */ (document.getElementById('cartes-items'));
const ficheNom = /** @type {HTMLElement} */ (document.getElementById('fiche-nom'));
const ficheIdent = /** @type {HTMLElement} */ (document.getElementById('fiche-ident'));
const ficheActions = /** @type {HTMLElement} */ (document.getElementById('fiche-actions'));
const ficheInventaire = /** @type {HTMLElement} */ (document.getElementById('fiche-inventaire'));
const carteFiche = /** @type {HTMLElement} */ (document.getElementById('carte-fiche'));

/** @type {any[]} dernière réponse de /api/maps */
let cartes = [];
/** @type {string|null} */
let carteChoisie = null;

/** @param {number} octets */
function kio(octets) {
  return octets >= 1048576 ? mio(octets) : `${(octets / 1024).toFixed(0)} Kio`;
}

/**
 * Le texte de l'inventaire de suppression, fichier par fichier.
 *
 * ⚠ Il est écrit une seule fois et sert **aux deux** usages — l'affichage dans la ligne et
 * la demande de confirmation. Deux textes distincts finiraient par diverger, et sur un geste
 * sans annulation c'est le pire endroit pour annoncer autre chose que ce qu'on détruit.
 *
 * @param {any} plan réponse de /api/maps/deletion-plan
 * @returns {string[]}
 */
function inventaireSuppression(plan) {
  const lignes = [
    `Supprimer définitivement la carte « ${plan.name} » (${plan.id}) ?`,
    '',
    `${plan.files.length} fichier(s), ${kio(plan.totalBytes)} :`,
    ...plan.files.map((/** @type {any} */ f) => `  maps/${f.path} — ${kio(f.bytes)}`),
  ];
  const entrees = [
    plan.dansCatalogue ? 'catalog.json' : null,
    plan.dansManifeste ? 'scenes.json' : null,
    plan.dansRecettes ? 'le cache de recettes' : null,
  ].filter(Boolean);
  if (entrees.length > 0) {
    lignes.push('', `Son entrée sera retirée de : ${entrees.join(', ')}.`);
  }
  lignes.push(
    '',
    // La source part avec le reste, et le dire n'est pas optionnel : c'est le seul fichier
    // que le mainteneur a lui-même déposé dans maps/.
    'La ou les sources partent aussi : les garder ferait recréer la carte à la prochaine publication.',
    'Cette action est irréversible.'
  );
  return lignes;
}

/** @param {any[]} maps réponse de /api/maps */
function afficherCartes(maps) {
  cartes = maps;
  cartesItems.replaceChildren();
  ficheInventaire.replaceChildren();

  if (maps.length === 0) {
    const li = document.createElement('li');
    li.className = 'cartes-vide';
    li.textContent = 'Aucune carte dans maps/. Y déposer un .dd2vtt, .df2vtt, .uvtt ou une image.';
    cartesItems.appendChild(li);
    carteChoisie = null;
    carteFiche.classList.add('cache');
    return;
  }
  carteFiche.classList.remove('cache');

  // Une carte par source, garanti par construction : /api/maps et /api/sources partent du même
  // filtre sur le même dossier. Aucune source ne peut manquer à cette liste.
  if (!maps.some((m) => m.id === carteChoisie)) carteChoisie = maps[0].id;

  for (const m of maps) {
    const li = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'carte-item';
    bouton.dataset.cle = m.id;

    const vignette = document.createElement('span');
    vignette.className = 'vignette';
    if (m.thumbUrl) {
      const img = document.createElement('img');
      // Le paramètre casse le cache du navigateur : une carte republiée garde le même nom de
      // vignette, et l'image d'avant resterait affichée.
      img.src = `/${m.thumbUrl}?v=${Date.now()}`;
      img.alt = `Vignette de ${m.name}`;
      vignette.appendChild(img);
    } else {
      vignette.textContent = m.publiee ? 'sans vignette' : 'non publiée';
    }

    const info = document.createElement('span');
    const nom = document.createElement('strong');
    nom.textContent = m.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const statut = document.createElement('span');
    statut.className = m.publiee ? 'publiee' : 'brouillon';
    statut.textContent = m.publiee ? 'publiée' : 'jamais publiée';
    meta.append(`${m.levelCount} étage(s) · `, statut);
    info.append(nom, meta);

    bouton.append(vignette, info);
    bouton.addEventListener('click', () => choisirCarte(m.id));
    li.appendChild(bouton);
    cartesItems.appendChild(li);
  }

  choisirCarte(carteChoisie);
}

/**
 * Affiche la fiche d'une carte. Le sélecteur de source n'offre que ses fichiers : un étage par
 * source, et c'est une source — pas une carte — que la comparaison de réglages fabrique.
 *
 * @param {string|null} cle
 */
function choisirCarte(cle) {
  const m = cartes.find((e) => e.id === cle);
  if (!m) return;
  const changement = cle !== carteChoisie || selSource.options.length === 0;
  carteChoisie = cle;

  for (const b of cartesItems.querySelectorAll('.carte-item')) {
    b.setAttribute('aria-current', String(/** @type {HTMLElement} */ (b).dataset.cle === cle));
  }

  ficheNom.textContent = m.name;
  ficheIdent.textContent = `${m.id} · ${m.publiee ? 'publiée' : 'jamais publiée'} · ${m.sources.join(', ')}`;

  const avant = selSource.value;
  selSource.replaceChildren(
    ...m.sources.map((/** @type {string} */ file) => {
      const s = sources.find((x) => x.file === file);
      const option = document.createElement('option');
      option.value = file;
      option.textContent = s ? `${s.name} — ${file}` : `${file} (illisible)`;
      return option;
    })
  );
  selSource.disabled = m.sources.length < 2;
  if (m.sources.includes(avant)) selSource.value = avant;
  if (changement) changerDeSource();
  else afficherDetails();

  ficheActions.replaceChildren();

  const bRenommer = document.createElement('button');
  bRenommer.textContent = 'Renommer';
  bRenommer.addEventListener('click', () => {
    const saisi = window.prompt(`Nouveau nom pour « ${m.name} » ?`, m.name);
    if (saisi === null) return;
    pendant(bRenommer, async () => {
      const r = await api('/api/scenes/rename', { id: m.id, name: saisi });
      afficherCartes(r.maps);
      dire(
        `✓ Carte « ${r.name} » renommée dans maps/scenes.json` +
          `${r.creee ? ' (son entrée y a été créée : elle n’en avait pas)' : ''}.\n` +
          `⚠ Rien n'a été republié : le catalogue et la scène générée portent encore ` +
          `l'ancien nom jusqu'au prochain clic sur « Publier le catalogue ».`
      );
    });
  });

  const bSupprimer = document.createElement('button');
  bSupprimer.className = 'gm-btn--danger';
  bSupprimer.textContent = 'Supprimer';
  bSupprimer.addEventListener('click', () =>
    pendant(bSupprimer, async () => {
      // L'inventaire d'abord, la question ensuite : personne ne confirme une suppression
      // dont il ne sait pas ce qu'elle emporte.
      const plan = await api(`/api/maps/deletion-plan?id=${encodeURIComponent(m.id)}`);
      const lignes = inventaireSuppression(plan);

      const affiche = document.createElement('p');
      affiche.className = 'inventaire';
      affiche.textContent = lignes.join('\n');
      ficheInventaire.replaceChildren(affiche);
      dire(lignes.join('\n'));

      if (!window.confirm(lignes.join('\n'))) {
        dire('Suppression annulée. Rien n’a été touché.');
        return;
      }

      const r = await api('/api/maps/delete', { id: m.id });
      afficherCartes(r.maps);
      dire(
        `✓ Carte « ${r.name} » supprimée : ${r.files.length} fichier(s), ${kio(r.totalBytes)} ` +
          `rendus à l'arbre de travail.\n` +
          // Dire la vérité sur git : la place n'est rendue que dans l'arbre de travail.
          `⚠ Les fichiers déjà commités restent dans l'historique git — la suppression ` +
          `arrête leur croissance, elle ne réécrit pas le passé.`
      );
    })
  );

  ficheActions.append(bRenommer, bSupprimer);
}

// --- V-02 Éditeur de liaisons & Vue carte interactif -------------------------------

const selLinkScene = /** @type {HTMLSelectElement} */ (document.getElementById('link-scene-select'));
const selLinkLevel = /** @type {HTMLSelectElement} */ (document.getElementById('link-level-select'));
const prepMapCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('prep-map-canvas'));
const prepMapZoom = /** @type {HTMLInputElement} */ (document.getElementById('prep-map-zoom'));
const btnResetView = /** @type {HTMLButtonElement} */ (document.getElementById('prep-map-reset-view'));
const cellInfo = /** @type {HTMLElement} */ (document.getElementById('prep-map-cell-info'));
const linkEditorMount = /** @type {HTMLElement} */ (document.getElementById('prep-link-editor-mount'));
const tokenMakerMount = /** @type {HTMLElement} */ (document.getElementById('token-maker-mount'));

/** @type {any} */
let currentScene = null;
/**
 * Identifiant de la scène **du catalogue**, conservé à part.
 *
 * ⛔ Ne pas le relire dans `currentScene` : un document de scène est une **campagne**, dont les
 * clés racine sont `schemaVersion`, `campaignId`, `name`, `levels`, `links`, `tokens`,
 * `templates` et `settings`. Il n'y a pas de champ `id`, et `campaignId` vaut
 * `campaign-<sceneId>` — donc ni l'un ni l'autre n'est la clé attendue par le serveur, qui
 * écrit `maps/<sceneId>.links.json` et relit `maps/generated/<sceneId>.scene.json`.
 *
 * Le défaut a été trouvé au premier vrai clic sur « Créer la liaison » : `sceneId` partait
 * `undefined`, le serveur répondait 400 « Identifiant de scène manquant », et le message de
 * succès aurait de toute façon annoncé `maps/undefined.links.json`.
 * @type {string|null}
 */
let currentSceneId = null;
/** @type {any} */
let currentLevel = null;
/** @type {HTMLImageElement|null} */
let loadedMapImage = null;
let mapPanX = 0;
let mapPanY = 0;
let mapZoom = 1.0;
let isPanningMap = false;
let panStartX = 0;
let panStartY = 0;
let initialPanX = 0;
let initialPanY = 0;
/**
 * Vrai tant que la vue n'a pas été cadrée sur l'image courante avec de vraies dimensions : un
 * atelier caché mesure 0 × 0, et cadrer à ce moment-là poserait la carte n'importe où.
 */
let vueACadrer = true;

/**
 * Les couleurs des marques de liaison, lues dans le thème plutôt qu'écrites ici : laiton pour
 * la liaison choisie, comme partout ailleurs où il dit « actif ».
 */
function couleursDuTheme() {
  const css = getComputedStyle(document.documentElement);
  /** @param {string} nom */
  const lire = (nom) => css.getPropertyValue(nom).trim();
  return { choisie: lire('--gm-laiton'), a: lire('--gm-info'), b: lire('--gm-sang'), trait: lire('--gm-texte') };
}

/** @type {ReturnType<typeof createLinkEditor>|null} */
let prepLinkEditor = null;

if (linkEditorMount) {
  prepLinkEditor = createLinkEditor(linkEditorMount, {
    getLevels: () => (currentScene?.levels ?? []).map((/** @type {any} */ l) => ({ id: l.id, name: l.name })),
    getLinks: () => currentScene?.links ?? [],
    onAdd: async (newLink) => {
      if (!currentScene || !currentSceneId) return;
      const links = [...(currentScene.links ?? []), newLink];
      await api('/api/scene/links', { sceneId: currentSceneId, links });
      currentScene.links = links;
      prepLinkEditor?.refresh();
      drawMapCanvas();
      dire(`✓ Liaison « ${newLink.label || newLink.kind} » enregistrée dans maps/${currentSceneId}.links.json.`);
    },
    onRemove: async (linkId) => {
      if (!currentScene || !currentSceneId) return;
      const links = (currentScene.links ?? []).filter((/** @type {any} */ l) => l.id !== linkId);
      await api('/api/scene/links', { sceneId: currentSceneId, links });
      currentScene.links = links;
      prepLinkEditor?.refresh();
      drawMapCanvas();
      dire(`✓ Liaison retirée de maps/${currentSceneId}.links.json.`);
    },
    onArmChange: () => drawMapCanvas(),
    requestRender: () => drawMapCanvas(),
  });
}

function drawMapCanvas() {
  if (!prepMapCanvas) return;
  const viewport = prepMapCanvas.parentElement;
  if (!viewport) return;

  const w = viewport.clientWidth || 500;
  const h = viewport.clientHeight || 420;
  prepMapCanvas.width = w;
  prepMapCanvas.height = h;

  const ctx = prepMapCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(mapPanX, mapPanY);
  ctx.scale(mapZoom, mapZoom);

  if (loadedMapImage) {
    ctx.drawImage(loadedMapImage, 0, 0);
  }

  if (currentLevel) {
    const grid = gridFor(currentLevel);
    grid.renderGrid(ctx);

    // Dessin des liaisons existantes
    const selectedLinkId = prepLinkEditor?.getSelectedLinkId();
    const couleurs = couleursDuTheme();
    const links = currentScene?.links ?? [];
    for (const link of links) {
      const isA = link.a?.levelId === currentLevel.id;
      const isB = link.b?.levelId === currentLevel.id;
      if (!isA && !isB) continue;

      const isSelected = link.id === selectedLinkId;

      for (const side of [isA ? link.a : null, isB ? link.b : null].filter(Boolean)) {
        const pt = grid.pointFromCell({ a: side.at.cellX, b: side.at.cellY });
        const ptNext = grid.pointFromCell({ a: side.at.cellX + 1, b: side.at.cellY });
        const cellSize = Math.abs(ptNext.x - pt.x);
        const r = cellSize * 0.35;

        ctx.save();
        ctx.fillStyle = isSelected ? couleurs.choisie : isA ? couleurs.a : couleurs.b;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = couleurs.trait;
        ctx.lineWidth = 2 / mapZoom;
        ctx.stroke();

        ctx.fillStyle = couleurs.trait;
        ctx.font = `${Math.max(10, Math.round(14 / mapZoom))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const symbol = link.kind === 'stairs' ? '↕' : link.kind === 'elevator' ? '🛗' : '🪜';
        ctx.fillText(symbol, pt.x, pt.y);
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

function resetMapView() {
  if (!loadedMapImage || !prepMapCanvas) return;
  const viewport = prepMapCanvas.parentElement;
  if (!viewport || viewport.clientWidth === 0) {
    vueACadrer = true;
    return;
  }
  vueACadrer = false;
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;

  const scaleX = vw / (loadedMapImage.width || 1);
  const scaleY = vh / (loadedMapImage.height || 1);
  mapZoom = Math.min(scaleX, scaleY, 1.0);
  if (prepMapZoom) prepMapZoom.value = String(mapZoom);

  mapPanX = (vw - loadedMapImage.width * mapZoom) / 2;
  mapPanY = (vh - loadedMapImage.height * mapZoom) / 2;
  drawMapCanvas();
}

async function chargerScenePourLiaisons(/** @type {string} */ sceneId) {
  if (!sceneId) return;
  try {
    currentScene = await api(`/api/scene?id=${encodeURIComponent(sceneId)}`);
    currentSceneId = sceneId;
    const levels = currentScene.levels ?? [];

    selLinkLevel.replaceChildren(
      ...levels.map((/** @type {any} */ l) => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = `${l.name} (${l.id})`;
        return opt;
      })
    );

    if (levels.length > 0) {
      selLinkLevel.value = levels[0].id;
      chargerLevelMap(levels[0].id);
    }
    prepLinkEditor?.refresh();
  } catch (err) {
    dire(`✗ Erreur lors du chargement de la scène : ${err instanceof Error ? err.message : String(err)}`);
  }
}

function chargerLevelMap(/** @type {string} */ levelId) {
  if (!currentScene) return;
  currentLevel = (currentScene.levels ?? []).find((/** @type {any} */ l) => l.id === levelId) ?? null;
  if (!currentLevel) return;

  const img = new Image();
  img.onload = () => {
    loadedMapImage = img;
    resetMapView();
  };
  img.src = `/${currentLevel.imageUrl}`;
}

if (prepMapCanvas) {
  const viewport = prepMapCanvas.parentElement;

  viewport?.addEventListener('pointerdown', (e) => {
    isPanningMap = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    initialPanX = mapPanX;
    initialPanY = mapPanY;
    viewport.setPointerCapture(e.pointerId);
  });

  viewport?.addEventListener('pointermove', (e) => {
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const mapPt = screenToMapPoint(
      { clientX: e.clientX, clientY: e.clientY },
      { rectLeft: rect.left, rectTop: rect.top, panX: mapPanX, panY: mapPanY, zoom: mapZoom }
    );

    if (currentLevel) {
      const grid = gridFor(currentLevel);
      const cell = grid.cellFromPoint(mapPt);
      if (cell) {
        cellInfo.textContent = `Case : ${cell.a}, ${cell.b}`;
      } else {
        cellInfo.textContent = 'Case : hors limites';
      }
    }

    if (!isPanningMap) return;
    mapPanX = initialPanX + (e.clientX - panStartX);
    mapPanY = initialPanY + (e.clientY - panStartY);
    drawMapCanvas();
  });

  const stopPan = (/** @type {PointerEvent} */ e) => {
    if (isPanningMap) {
      const dist = Math.hypot(e.clientX - panStartX, e.clientY - panStartY);
      isPanningMap = false;
      if (viewport) {
        try {
          viewport.releasePointerCapture(e.pointerId);
        } catch (_) {
          /* ignorer */
        }
      }

      // S'il s'agit d'un simple clic (pas de glisser), poser l'extrémité
      if (dist < 5 && currentLevel && viewport) {
        const rect = viewport.getBoundingClientRect();
        const mapPt = screenToMapPoint(
          { clientX: e.clientX, clientY: e.clientY },
          { rectLeft: rect.left, rectTop: rect.top, panX: initialPanX, panY: initialPanY, zoom: mapZoom }
        );
        const grid = gridFor(currentLevel);
        const cell = grid.cellFromPoint(mapPt);

        if (cell) {
          if (prepLinkEditor?.isArmed()) {
            prepLinkEditor.setEndpointA(currentLevel.id, { a: cell.a, b: cell.b });
          } else {
            // Remplir les champs B au clic pour faciliter la saisie
            const inputX = /** @type {HTMLInputElement} */ (document.getElementById('link-cell-x'));
            const inputY = /** @type {HTMLInputElement} */ (document.getElementById('link-cell-y'));
            if (inputX) inputX.value = String(cell.a);
            if (inputY) inputY.value = String(cell.b);
          }
          drawMapCanvas();
        }
      }
    }
  };

  viewport?.addEventListener('pointerup', stopPan);
  viewport?.addEventListener('pointercancel', stopPan);

  viewport?.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!viewport) return;
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const nextZoom = Math.max(0.1, Math.min(5.0, mapZoom * factor));

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    mapPanX = mouseX - (mouseX - mapPanX) * (nextZoom / mapZoom);
    mapPanY = mouseY - (mouseY - mapPanY) * (nextZoom / mapZoom);
    mapZoom = nextZoom;

    if (prepMapZoom) prepMapZoom.value = String(mapZoom);
    drawMapCanvas();
  }, { passive: false });
}

prepMapZoom?.addEventListener('input', () => {
  mapZoom = parseFloat(prepMapZoom.value) || 1.0;
  drawMapCanvas();
});

btnResetView?.addEventListener('click', resetMapView);
window.addEventListener('resize', () => drawMapCanvas());

selLinkScene?.addEventListener('change', () => {
  chargerScenePourLiaisons(selLinkScene.value);
});

selLinkLevel?.addEventListener('change', () => {
  chargerLevelMap(selLinkLevel.value);
});

/**
 * Recharge les cartes du serveur, rafraîchit le tableau de la bibliothèque
 * et met à jour le sélecteur de scène de l'éditeur de liaisons.
 */
async function rechargerCatalogueEtCartes() {
  const reponse = await api('/api/maps');
  afficherCartes(reponse.maps);

  if (selLinkScene) {
    const catalogData = await fetch('/maps/catalog.json')
      .then((r) => r.json())
      .catch(() => null);
    if (catalogData && Array.isArray(catalogData.maps)) {
      const prevVal = selLinkScene.value;
      selLinkScene.replaceChildren(
        ...catalogData.maps.map((/** @type {any} */ m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = `${m.name} (${m.id})`;
          return opt;
        })
      );
      if (catalogData.maps.some((/** @type {any} */ m) => m.id === prevVal)) {
        selLinkScene.value = prevVal;
      } else if (catalogData.maps.length > 0) {
        selLinkScene.value = catalogData.maps[0].id;
        chargerScenePourLiaisons(catalogData.maps[0].id);
      }
    }
  }
}

// --- V-03 Recadrage des pions dans l'outil avec budget 256 Kio ---------------------

/** @type {ReturnType<typeof createTokenMaker>|null} */
let prepTokenMaker = null;

if (tokenMakerMount) {
  prepTokenMaker = createTokenMaker(tokenMakerMount, {
    maxBytes: 256 * 1024,
    requireLevelId: false,
    onGenerate: async (token, dataUrl) => {
      try {
        const id = token.id || 'pion-1';
        const name = token.label || 'Nouveau pion';

        const entry = {
          id,
          name,
          imageUrl: token.imageUrl,
          kind: token.kind,
          sizeCells: token.sizeCells,
          speedCells: token.speedCells,
          visionDim: token.visionDim,
          emitsLight: token.emitsLight,
          borderColor: token.borderColor,
          maxHp: token.hp ? token.hp.max : null,
        };

        const r = await api('/api/tokens/save', { entry, imageDataUrl: dataUrl });
        afficherTokens(r.tokens);
        dire(`✓ Pion « ${entry.name} » (${id}) sauvegardé dans la bibliothèque (${r.imageUrl}).`);
      } catch (err) {
        dire(`✗ Erreur lors de la sauvegarde du pion : ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    },
  });
}

/** Démarrage : sans API, la page le dit au lieu d'échouer en silence. */
(async () => {
  try {
    const data = await api('/api/sources');
    champPpc.value = String(data.defaults.targetPxPerCell);
    champCap.value = String(data.defaults.maxTexturePx);
    champQual.value = String(data.defaults.quality);

    sources = data.sources;
    illisibles = data.illisibles;

    outil.classList.remove('cache');
    ateliers.classList.remove('cache');
    document.getElementById('prep-publier')?.classList.remove('cache');
    ouvrirAtelier(location.hash.slice(1));

    await rechargerCatalogueEtCartes();

    const biblio = await api('/api/tokens');
    afficherTokens(biblio.tokens);

    // Un seul message de démarrage : le défaut du catalogue de pions était écrit, puis écrasé
    // dans la foulée par le décompte des sources, sans avoir jamais été lisible.
    const avertissements = [
      ...(illisibles.length
        ? [`⚠ Sources illisibles : ${illisibles.map((i) => `${i.file} (${i.error})`).join(', ')}`]
        : []),
      ...(biblio.errors.length > 0 ? [`⚠ Catalogue de pions invalide : ${biblio.errors.join(' ; ')}`] : []),
    ];
    dire(
      [
        sources.length
          ? `${sources.length} source(s) dans maps/. Constantes du dépôt : plafond ${data.defaults.maxTexturePx} px, qualité ${data.defaults.quality}.`
          : 'Aucune source dans maps/. Y déposer un .dd2vtt, .df2vtt ou .uvtt.',
        ...avertissements,
      ].join('\n')
    );
  } catch {
    horsLigne.classList.remove('cache');
    dire('✗ Serveur local injoignable.');
  }
})();
