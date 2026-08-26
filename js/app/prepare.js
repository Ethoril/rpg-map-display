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

/** @param {any[]} tokens */
function afficherTokens(tokens) {
  tokensListe.replaceChildren();
  if (tokens.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = 'Bibliothèque vide. Le formulaire ci-dessus la remplit.';
    td.style.opacity = '.7';
    tr.appendChild(td);
    tokensListe.appendChild(tr);
    return;
  }

  for (const t of tokens) {
    const tr = document.createElement('tr');

    const tdImg = document.createElement('td');
    const img = document.createElement('img');
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
      `vitesse ${t.speedCells} · vision ${t.visionDim} · ${maxHpStr}`;
    tdInfo.append(name, document.createElement('br'), metadata);

    const tdActions = document.createElement('td');
    tdActions.style.whiteSpace = 'nowrap';

    const bEdit = document.createElement('button');
    bEdit.textContent = 'Éditer';
    bEdit.addEventListener('click', () => {
      prepTokenMaker?.populateFromToken(t);
      tokenMakerMount?.scrollIntoView({ behavior: 'smooth' });
      dire(`Édition de « ${t.name} » (${t.id}). Modifiez les champs puis cliquez sur Mettre à jour.`);
    });

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
        ctx.fillStyle = isSelected ? '#f5a623' : isA ? '#4a90e2' : '#e74c3c';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / mapZoom;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
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
  const vw = viewport?.clientWidth || 500;
  const vh = viewport?.clientHeight || 420;

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
        cellInfo.textContent = `Case: ${cell.a}, ${cell.b}`;
      } else {
        cellInfo.textContent = 'Case: hors limites';
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

selLinkScene?.addEventListener('change', () => {
  chargerScenePourLiaisons(selLinkScene.value);
});

selLinkLevel?.addEventListener('change', () => {
  chargerLevelMap(selLinkLevel.value);
});

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

    // Charger les scènes publiées pour l'éditeur de liaisons
    if (selLinkScene) {
      const catalogData = await fetch('/maps/catalog.json').then((r) => r.json()).catch(() => null);
      if (catalogData && Array.isArray(catalogData.maps)) {
        selLinkScene.replaceChildren(
          ...catalogData.maps.map((/** @type {any} */ m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `${m.name} (${m.id})`;
            return opt;
          })
        );
        if (catalogData.maps.length > 0) {
          selLinkScene.value = catalogData.maps[0].id;
          chargerScenePourLiaisons(catalogData.maps[0].id);
        }
      }
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
