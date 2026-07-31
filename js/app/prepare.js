// @ts-check
/**
 * Point d'entrée de `prepare.html` — outil local de préparation des cartes (chantier L).
 *
 * **Ce module ne décode ni ne rééchantillonne aucune image.** Le pipeline n'a qu'une
 * implantation, en Node (`scripts/resample.mjs`), et c'est la règle qui gouverne ce
 * chantier : le plafond de texture, le garde-fou anti-agrandissement et la qualité WebP
 * n'existent qu'à un seul endroit. Une seconde implantation côté navigateur divergerait au
 * premier réglage, sans le moindre signal — motif déjà payé deux fois sur ce projet.
 *
 * Ici : appeler l'API locale, afficher ce qu'elle renvoie.
 */

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

/** @type {any[]} */
let sources = [];

/**
 * @param {string} texte
 */
function dire(texte) {
  journal.textContent = texte;
}

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
    details.innerHTML = '';
    return;
  }
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
      src.warnings.map((/** @type {string} */ w) => `⚠ ${w}`).join('<br>'),
    ]);
  }

  details.innerHTML = lignes
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('');
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
  variantes.innerHTML = '';
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
  })
);

selSource.addEventListener('change', afficherDetails);

/** Démarrage : sans API, la page le dit au lieu d'échouer en silence. */
(async () => {
  try {
    const data = await api('/api/sources');
    champPpc.value = String(data.defaults.targetPxPerCell);
    champCap.value = String(data.defaults.maxTexturePx);
    champQual.value = String(data.defaults.quality);

    sources = data.sources;
    selSource.innerHTML = sources
      .map((s) => `<option value="${s.file}">${s.name} — ${s.file}</option>`)
      .join('');

    outil.classList.remove('cache');
    afficherDetails();

    const illisibles = data.illisibles.length
      ? `\n⚠ Sources illisibles : ${data.illisibles.map((/** @type {any} */ i) => `${i.file} (${i.error})`).join(', ')}`
      : '';
    dire(
      sources.length
        ? `${sources.length} source(s) dans maps/. Constantes du dépôt : plafond ${data.defaults.maxTexturePx} px, qualité ${data.defaults.quality}.${illisibles}`
        : `Aucune source dans maps/. Y déposer un .dd2vtt, .df2vtt ou .uvtt.${illisibles}`
    );
  } catch {
    horsLigne.classList.remove('cache');
    dire('Serveur local injoignable.');
  }
})();
