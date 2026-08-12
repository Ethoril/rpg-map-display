// @ts-check

import { edgeKey } from '../core/cellKey.js';

/** @typedef {import('../core/types.js').Level} Level */
/** @typedef {import('../core/types.js').Portal} Portal */
/** @typedef {import('../grid/GridAdapter.js').GridAdapter} GridAdapter */
/** @typedef {{ x: number, y: number }} Point */

/**
 * Cache privé du masque d'arêtes bloquées par étage (clé = levelId).
 * L'instance de Map reste encapsulée et non exposée à l'extérieur.
 *
 * @type {Map<string, { signature: string, edges: Set<string> }>}
 */
const cache = new Map();

let computeCount = 0;

/**
 * Compteur du nombre de calculs géométriques réels effectués.
 * @returns {number}
 */
export function getBlockedEdgesComputeCount() {
  return computeCount;
}

/**
 * Réinitialise le compteur de calculs réels.
 * @returns {void}
 */
export function resetBlockedEdgesComputeCount() {
  computeCount = 0;
}

/**
 * Indique si un portail/porte est ouvert.
 * Supporte `portal.closed` (booléen) et le futur `portal.state` ('open' | 'closed' | 'locked').
 * Une porte n'est ouverte que si state === 'open' ou (!state && closed === false).
 *
 * @param {Portal | {closed?: boolean, state?: string}} portal
 * @returns {boolean}
 */
export function isPortalOpen(portal) {
  if (!portal) return false;
  if (typeof portal.state === 'string') {
    return portal.state === 'open';
  }
  return portal.closed === false;
}

/**
 * Calcule l'empreinte géométrique d'un étage pour valider le cache.
 *
 * @param {Level} level
 * @returns {string}
 */
function getGeometrySignature(level) {
  if (!level) return '';

  /** @type {string[]} */
  const wallParts = [];
  if (Array.isArray(level.walls)) {
    for (let i = 0; i < level.walls.length; i++) {
      const poly = level.walls[i];
      if (Array.isArray(poly)) {
        for (let j = 0; j < poly.length; j++) {
          const p = poly[j];
          if (p) {
            wallParts.push(`${p.cellX},${p.cellY}`);
          }
        }
      }
    }
  }

  /** @type {string[]} */
  const portalParts = [];
  if (Array.isArray(level.portals)) {
    for (let i = 0; i < level.portals.length; i++) {
      const p = level.portals[i];
      if (p) {
        portalParts.push(`${p.id}:${p.a?.cellX},${p.a?.cellY}-${p.b?.cellX},${p.b?.cellY}:${isPortalOpen(p)}`);
      }
    }
  }

  // ⛔ **Le pavage et les dimensions font partie de l'empreinte.** Le masque d'arêtes dépend de la
  // grille autant que des murs : à murs identiques, un étage passé de carré à hexagonal n'a ni les
  // mêmes voisinages ni les mêmes arêtes. Sans ces trois champs, un recalibrage ou un changement de
  // pavage sur un étage de même identifiant resservait le masque périmé du cache — **les murs
  // bloquaient les mauvaises arêtes, en silence**. Mesuré le 12/08/2026 : 16 arêtes servies depuis
  // le cache contre 19 après recalcul.
  const grille = `${level.grid?.type ?? 'square'}:${level.widthCells}x${level.heightCells}`;
  return `${level.id || 'default'}_g:${grille}_w:${wallParts.join(';')}_p:${portalParts.join(';')}`;
}

/**
 * Invalide le cache d'un étage spécifique (ex. lors d'un `portal.toggle`)
 * ou vider le cache entier si aucun `levelId` n'est spécifié.
 *
 * @param {string} [levelId]
 * @returns {void}
 */
export function invalidateBlockedEdgesCache(levelId) {
  if (levelId) {
    cache.delete(levelId);
  } else {
    cache.clear();
  }
}

/**
 * Teste si le point P est sur le segment [A, B] (bornes incluses) avec une tolérance epsilon.
 *
 * @param {Point} P
 * @param {Point} A
 * @param {Point} B
 * @param {number} [eps]
 * @returns {boolean}
 */
function isPointOnSegment(P, A, B, eps = 1e-9) {
  return (
    P.x >= Math.min(A.x, B.x) - eps &&
    P.x <= Math.max(A.x, B.x) + eps &&
    P.y >= Math.min(A.y, B.y) - eps &&
    P.y <= Math.max(A.y, B.y) + eps &&
    Math.abs((B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)) <= eps
  );
}

/**
 * Teste si le segment [A, B] croise le segment [C, D].
 * Traitement explicite des chevauchements colinéaires et des contacts aux extrémités.
 *
 * @param {Point} A
 * @param {Point} B
 * @param {Point} C
 * @param {Point} D
 * @param {number} [eps]
 * @returns {boolean}
 */
export function segmentsIntersect(A, B, C, D, eps = 1e-9) {
  const minAxBx = Math.min(A.x, B.x);
  const maxAxBx = Math.max(A.x, B.x);
  const minAyBy = Math.min(A.y, B.y);
  const maxAyBy = Math.max(A.y, B.y);

  const minCxDx = Math.min(C.x, D.x);
  const maxCxDx = Math.max(C.x, D.x);
  const minCyDy = Math.min(C.y, D.y);
  const maxCyDy = Math.max(C.y, D.y);

  // Pré-filtre par boîtes englobantes
  if (
    maxAxBx < minCxDx - eps ||
    minAxBx > maxCxDx + eps ||
    maxAyBy < minCyDy - eps ||
    minAyBy > maxCyDy + eps
  ) {
    return false;
  }

  const cp1 = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
  const cp2 = (B.x - A.x) * (D.y - A.y) - (B.y - A.y) * (D.x - A.x);
  const cp3 = (D.x - C.x) * (A.y - C.y) - (D.y - C.y) * (A.x - C.x);
  const cp4 = (D.x - C.x) * (B.y - C.y) - (D.y - C.y) * (B.x - C.x);

  // Cas général : chevauchement strict
  if (
    ((cp1 > eps && cp2 < -eps) || (cp1 < -eps && cp2 > eps)) &&
    ((cp3 > eps && cp4 < -eps) || (cp3 < -eps && cp4 > eps))
  ) {
    return true;
  }

  // Cas de contact ou de colinéarité
  if (Math.abs(cp1) <= eps && isPointOnSegment(C, A, B, eps)) return true;
  if (Math.abs(cp2) <= eps && isPointOnSegment(D, A, B, eps)) return true;
  if (Math.abs(cp3) <= eps && isPointOnSegment(A, C, D, eps)) return true;
  if (Math.abs(cp4) <= eps && isPointOnSegment(B, C, D, eps)) return true;

  return false;
}

/**
 * Structure représentant un segment de mur ou de portail.
 * @typedef {{ A: Point, B: Point, id: number }} Segment
 */

/**
 * Extrait tous les segments d'obstacles (murs et portails non ouverts) d'un étage.
 * Si un GridAdapter est fourni, les coordonnées sont converties en pixels carte ({ p1, p2 }).
 * Sinon, elles restent en coordonnées de case ({ A, B }).
 *
 * @param {Level} level
 * @param {GridAdapter} [grid]
 * @returns {Array<any>}
 */
export function extractBlockedSegments(level, grid) {
  if (!level) return [];

  /** @type {Array<any>} */
  const segments = [];

  if (Array.isArray(level.walls)) {
    for (const polyline of level.walls) {
      if (!Array.isArray(polyline) || polyline.length < 2) continue;
      for (let i = 0; i < polyline.length - 1; i++) {
        const p1 = polyline[i];
        const p2 = polyline[i + 1];
        if (p1 && p2) {
          if (grid) {
            segments.push({
              p1: grid.mapFromCellPoint(p1),
              p2: grid.mapFromCellPoint(p2),
            });
          } else {
            segments.push({
              A: { x: p1.cellX, y: p1.cellY },
              B: { x: p2.cellX, y: p2.cellY },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(level.portals)) {
    for (const portal of level.portals) {
      if (portal && !isPortalOpen(portal)) {
        if (grid) {
          segments.push({
            p1: grid.mapFromCellPoint(portal.a),
            p2: grid.mapFromCellPoint(portal.b),
          });
        } else {
          segments.push({
            A: { x: portal.a.cellX, y: portal.a.cellY },
            B: { x: portal.b.cellX, y: portal.b.cellY },
          });
        }
      }
    }
  }

  return segments;
}

/**
 * Calcul du masque d'arêtes de grille bloquées à partir de la géométrie de l'étage.
 * Utilise un cache interne basé sur l'identifiant et l'empreinte géométrique de l'étage.
 * Retourne TOUJOURS une copie défensive (`new Set`) pour empêcher toute corruption externe du cache.
 *
 * @param {Level} level
 * @param {GridAdapter} grid
 * @returns {Set<string>} Set de clés d'arêtes canoniques (obtenues via `edgeKey`)
 */
export function computeBlockedEdges(level, grid) {
  if (!level || !grid) return new Set();

  const levelId = level.id || 'default';
  const signature = getGeometrySignature(level);

  const cached = cache.get(levelId);
  if (cached && cached.signature === signature) {
    return new Set(cached.edges);
  }

  computeCount++;

  const blocked = new Set();
  const rawSegments = extractBlockedSegments(level, grid);

  if (rawSegments.length > 0) {
    const width = level.widthCells;
    const height = level.heightCells;

    if (!grid.allCells) {
      throw new Error('GridAdapter.allCells() est requis pour computeBlockedEdges');
    }

    // 1. Indexation spatiale par seaux de cases (convertie en unités de cases fractionnaires via cellPointFromMap)
    /** @type {Map<number, Array<{ p1: Point, p2: Point, id: number }>>} */
    const buckets = new Map();

    for (let i = 0; i < rawSegments.length; i++) {
      const raw = rawSegments[i];
      const seg = { p1: raw.p1, p2: raw.p2, id: i };

      const cp1 = grid.cellPointFromMap(raw.p1);
      const cp2 = grid.cellPointFromMap(raw.p2);

      // ⚠ **Élargissement d'une colonne des deux côtés. Voici la démonstration, parce qu'aucune
      // intuition ne tient ici.** En odd-r, `cellPointFromMap` rend `cellX = L − 0,5 · parité(rangée)`
      // où `L` est affine le long d'un segment. La colonne d'un point *intérieur* peut donc s'écarter
      // d'une demi-case de celles des deux extrémités, **dans les deux sens** : vers le bas si le
      // segment entre dans une rangée impaire, vers le haut s'il en sort. Donc pour tout segment, la
      // colonne de n'importe lequel de ses points appartient à
      // `[plancher(min des extrémités) − 1, plancher(max des extrémités) + 1]`.
      // En élargissant ainsi **le mur et l'arête**, la plage du mur et celle de la requête
      // contiennent toutes deux la colonne du point de croisement : elles se recoupent forcément.
      // C'est une preuve, pas un réglage — et elle vaut pour tout pavage, le carré n'ayant
      // simplement aucun saut de parité.
      // ⛔ Le cas qui a mordu : un mur longeant le bord gauche, à `cellX = -0,5` sur ses deux
      // extrémités. Sans le `+ 1`, `minCol = max(0, -1) = 0` et `maxCol = min(w-1, -1) = -1`
      // donnent une plage **vide** : le mur n'était rangé nulle part et cessait de bloquer, en
      // silence. Mesuré sur un hex 10 × 8 : 0 arête bloquée au lieu de 11. Un UVTT importé produit
      // couramment de telles coordonnées ; l'éditeur de murs, qui arrondit à l'entier, ne le fait pas.
      // ⚠ Seul le `+ 1` est isolé par une mutation ; les deux `− 1` se couvrent l'un l'autre sur
      // tout le corpus connu (1 600 configurations cherchées exprès, aucune ne les sépare). Ils sont
      // gardés quand même : retirer une borne parce qu'aucun test ne la voit, c'est optimiser contre
      // la suite, pas prouver qu'elle est inutile.
      // ⛔ Ne pas « simplifier » en retirant le bornage : la clé de seau `row * width + col` n'est
      // injective que pour `col ∈ [0, width-1]` — `col = -1` retomberait sur `(row-1, width-1)`.
      const minCol = Math.max(0, Math.floor(Math.min(cp1.cellX, cp2.cellX) - 1e-9) - 1);
      const maxCol = Math.min(width - 1, Math.floor(Math.max(cp1.cellX, cp2.cellX) + 1e-9) + 1);
      const minRow = Math.max(0, Math.floor(Math.min(cp1.cellY, cp2.cellY) - 1e-9));
      const maxRow = Math.min(height - 1, Math.floor(Math.max(cp1.cellY, cp2.cellY) + 1e-9));

      for (let col = minCol; col <= maxCol; col++) {
        for (let row = minRow; row <= maxRow; row++) {
          const cellIdx = row * width + col;
          let b = buckets.get(cellIdx);
          if (!b) {
            b = [];
            buckets.set(cellIdx, b);
          }
          b.push(seg);
        }
      }
    }

    const cells = grid.allCells(width, height);
    const processedEdgeNums = new Set();
    const seenStamp = new Int32Array(rawSegments.length);
    let stamp = 0;

    // Base de la clé d'arête : le nombre de cases de l'étage. Une arête est identifiée par
    // `min * cellCount + max` sur les deux index de case, ce qui est injectif — contrairement à
    // une constante magique, qui collisionne dès que `width * height` la dépasse.
    const cellCount = width * height;

    /** @type {Array<{ p1: Point, p2: Point, id: number }>} */
    const candidateSegs = [];

    // 2. Évaluer chaque arête centre-à-centre contre les seaux touchés par sa boîte englobante
    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const cell = cells[cIdx];
      const cellIdx = cell.b * width + cell.a;
      const neighbors = grid.neighbors(cell);
      const centerA = grid.pointFromCell(cell);

      for (let nIdx = 0; nIdx < neighbors.length; nIdx++) {
        const n = neighbors[nIdx];

        // ⚠ Les deux termes doivent être des index de CASE. Mélanger `cellIdx` avec l'index de
        // boucle `cIdx` rend la clé asymétrique : l'arête vue depuis chacune de ses deux cases
        // reçoit alors deux clés différentes, la déduplication ne prend plus (mesuré : 98,8 %
        // des arêtes testées deux fois) et deux arêtes distinctes peuvent partager une clé,
        // donc en perdre une en silence (mesuré : 1 arête sur un étage hex de 4 × 2).
        const nCellIdx = n.b * width + n.a;
        const edgeId = cellIdx < nCellIdx
          ? cellIdx * cellCount + nCellIdx
          : nCellIdx * cellCount + cellIdx;
        if (processedEdgeNums.has(edgeId)) continue;
        processedEdgeNums.add(edgeId);

        const centerB = grid.pointFromCell(n);

        const cpA = grid.cellPointFromMap(centerA);
        const cpB = grid.cellPointFromMap(centerB);

        // ⚠ **Même élargissement d'une colonne que pour les murs, et pour la même raison** — voir
        // la démonstration au-dessus de l'indexation. La rangée, elle, est affine en y : elle n'a
        // pas besoin d'être élargie.
        // ⛔ Ne pas resserrer le côté bas : l'équivalence stricte du test R-06 tombe en hexagonal
        // (mesuré : 862 arêtes au lieu de 866 avant que les murs ne soient élargis eux aussi).
        // Avant ce commit, la justesse ne tenait qu'à l'`- 1e-9`, qui élargissait d'une colonne
        // **par accident** — une tolérance numérique n'est pas un argument de couverture
        // géométrique.
        // Le côté haut n'est pas élargi ici : les centres de cases retombent sur des `cellX`
        // entiers et le saut de parité ne fait que **retirer** une demi-case, donc `+ 1e-9` suffit
        // comme tolérance. C'est le seul endroit où l'asymétrie est démontrable ; côté mur, dont
        // les extrémités sont quelconques, elle ne l'est pas.
        const minCol = Math.max(0, Math.floor(Math.min(cpA.cellX, cpB.cellX)) - 1);
        const maxCol = Math.min(width - 1, Math.floor(Math.max(cpA.cellX, cpB.cellX) + 1e-9));
        const minRow = Math.max(0, Math.floor(Math.min(cpA.cellY, cpB.cellY) - 1e-9));
        const maxRow = Math.min(height - 1, Math.floor(Math.max(cpA.cellY, cpB.cellY) + 1e-9));

        candidateSegs.length = 0;
        stamp++;

        for (let col = minCol; col <= maxCol; col++) {
          for (let row = minRow; row <= maxRow; row++) {
            const b = buckets.get(row * width + col);
            if (!b) continue;
            for (let i = 0; i < b.length; i++) {
              const seg = b[i];
              if (seenStamp[seg.id] !== stamp) {
                seenStamp[seg.id] = stamp;
                candidateSegs.push(seg);
              }
            }
          }
        }

        if (candidateSegs.length === 0) continue;

        for (let i = 0; i < candidateSegs.length; i++) {
          const seg = candidateSegs[i];
          if (segmentsIntersect(seg.p1, seg.p2, centerA, centerB)) {
            blocked.add(edgeKey(cell, n));
            break;
          }
        }
      }
    }
  }

  cache.set(levelId, {
    signature,
    edges: new Set(blocked),
  });

  return new Set(blocked);
}