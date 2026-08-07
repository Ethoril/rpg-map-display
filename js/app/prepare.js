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
    details.replaceChildren();
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
  })
);

selSource.addEventListener('change', afficherDetails);

// --- Bibliothèque de pions ---------------------------------------------------------

const tokensListe = /** @type {HTMLElement} */ (document.querySelector('#tokens-liste tbody'));
const champs = {
  id: /** @type {HTMLInputElement} */ (document.getElementById('tk-id')),
  name: /** @type {HTMLInputElement} */ (document.getElementById('tk-name')),
  kind: /** @type {HTMLSelectElement} */ (document.getElementById('tk-kind')),
  size: /** @type {HTMLInputElement} */ (document.getElementById('tk-size')),
  speed: /** @type {HTMLInputElement} */ (document.getElementById('tk-speed')),
  vb: /** @type {HTMLInputElement} */ (document.getElementById('tk-vb')),
  vd: /** @type {HTMLInputElement} */ (document.getElementById('tk-vd')),
  maxHp: /** @type {HTMLInputElement} */ (document.getElementById('tk-max-hp')),
  color: /** @type {HTMLInputElement} */ (document.getElementById('tk-color')),
  image: /** @type {HTMLInputElement} */ (document.getElementById('tk-image')),
};
const btnTokenSave = /** @type {HTMLButtonElement} */ (document.getElementById('btn-token-save'));
const btnTokenReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-token-reset'));

/** `imageUrl` de l'entrée en cours d'édition, conservée si aucune image neuve n'est fournie. */
let imageUrlCourante = '';

/** @param {any[]} tokens */
function afficherTokens(tokens) {
  tokensListe.replaceChildren();
  if (tokens.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'Bibliothèque vide. Le formulaire ci-dessous la remplit.';
    td.style.opacity = '.7';
    tr.appendChild(td);
    tokensListe.appendChild(tr);
    return;
  }

  for (const t of tokens) {
    const tr = document.createElement('tr');

    const tdImg = document.createElement('td');
    const img = document.createElement('img');
    // Cache court-circuité : après remplacement d'une image, le navigateur resservirait
    // l'ancienne sous la même URL et l'édition semblerait sans effet.
    img.src = `/${t.imageUrl}?v=${encodeURIComponent(t.imageUrl)}-${tokens.length}`;
    img.alt = t.name;
    tdImg.appendChild(img);

    const tdInfo = document.createElement('td');
    const maxHpStr = typeof t.maxHp === 'number' && t.maxHp >= 1 ? `${t.maxHp} PV` : 'sans PV';
    const name = document.createElement('strong');
    name.textContent = t.name;
    const metadata = document.createElement('span');
    metadata.style.cssText = 'opacity:.7;font-size:.85em';
    metadata.textContent =
      `${t.id} · ${t.kind === 'pc' ? 'PJ' : 'PNJ'} · taille ${t.sizeCells} · ` +
      `vitesse ${t.speedCells} · vision ${t.visionBright}/${t.visionDim} · ${maxHpStr}`;
    tdInfo.append(name, document.createElement('br'), metadata);

    const tdActions = document.createElement('td');
    tdActions.style.whiteSpace = 'nowrap';

    const bEdit = document.createElement('button');
    bEdit.textContent = 'Éditer';
    bEdit.addEventListener('click', () => remplirFormulaire(t));

    const bDel = document.createElement('button');
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

    tdActions.append(bEdit, bDel);
    tr.append(tdImg, tdInfo, tdActions);
    tokensListe.appendChild(tr);
  }
}

/** @param {any} t */
function remplirFormulaire(t) {
  champs.id.value = t.id;
  champs.name.value = t.name;
  champs.kind.value = t.kind;
  champs.size.value = String(t.sizeCells);
  champs.speed.value = String(t.speedCells);
  champs.vb.value = String(t.visionBright);
  champs.vd.value = String(t.visionDim);
  champs.maxHp.value = typeof t.maxHp === 'number' && t.maxHp >= 1 ? String(t.maxHp) : '';
  champs.color.value = t.borderColor;
  champs.image.value = '';
  imageUrlCourante = t.imageUrl;
  dire(`Édition de « ${t.name} ». Sans nouvelle image, celle en place est conservée.`);
}

function viderFormulaire() {
  champs.id.value = '';
  champs.name.value = '';
  champs.kind.value = 'npc';
  champs.size.value = '1';
  champs.speed.value = '3';
  champs.vb.value = '5';
  champs.vd.value = '10';
  champs.maxHp.value = '';
  champs.color.value = '#e74c3c';
  champs.image.value = '';
  imageUrlCourante = '';
}

/** @param {File} file */
function lireFichier(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Lecture impossible de ${file.name}`));
    reader.readAsDataURL(file);
  });
}

btnTokenReset.addEventListener('click', () => {
  viderFormulaire();
  dire('Formulaire vidé — la prochaine sauvegarde créera une entrée.');
});

btnTokenSave.addEventListener('click', () =>
  pendant(btnTokenSave, async () => {
    const fichier = champs.image.files?.[0];
    const imageDataUrl = fichier ? await lireFichier(fichier) : undefined;

    // Une création sans image n'a rien à afficher. Le dire ici évite un aller-retour et
    // un message d'erreur du serveur là où la cause est évidente côté page.
    if (!imageDataUrl && !imageUrlCourante) {
      dire('✗ Aucune image : choisir un fichier, ou éditer une entrée qui en a déjà une.');
      return;
    }

    const rawMaxHp = champs.maxHp.value.trim();
    const maxHp = rawMaxHp !== '' ? Math.max(1, parseInt(rawMaxHp, 10) || 1) : null;

    const entry = {
      id: champs.id.value.trim(),
      name: champs.name.value.trim(),
      imageUrl: imageUrlCourante,
      kind: champs.kind.value === 'pc' ? 'pc' : 'npc',
      sizeCells: Number(champs.size.value) || 1,
      speedCells: Number(champs.speed.value) || 3,
      visionBright: Number(champs.vb.value),
      visionDim: Number(champs.vd.value),
      emitsLight: null,
      borderColor: champs.color.value,
      maxHp,
    };

    const r = await api('/api/tokens/save', { entry, imageDataUrl });
    afficherTokens(r.tokens);
    imageUrlCourante = r.imageUrl;
    champs.image.value = '';
    dire(
      `✓ « ${entry.name} » ${r.replaced ? 'mis à jour' : 'ajouté'} dans la bibliothèque ` +
        `(${r.imageUrl}). Commiter maps/tokens/ pour le retrouver sur une autre machine.`
    );
  })
);

/** Démarrage : sans API, la page le dit au lieu d'échouer en silence. */
(async () => {
  try {
    const data = await api('/api/sources');
    champPpc.value = String(data.defaults.targetPxPerCell);
    champCap.value = String(data.defaults.maxTexturePx);
    champQual.value = String(data.defaults.quality);

    sources = data.sources;
    selSource.replaceChildren(
      ...sources.map((s) => {
        const option = document.createElement('option');
        option.value = s.file;
        option.textContent = `${s.name} — ${s.file}`;
        return option;
      })
    );

    outil.classList.remove('cache');
    afficherDetails();

    const biblio = await api('/api/tokens');
    afficherTokens(biblio.tokens);
    if (biblio.errors.length > 0) {
      dire(`⚠ Catalogue de pions invalide : ${biblio.errors.join(' ; ')}`);
    }

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
