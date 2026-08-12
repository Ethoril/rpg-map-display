// @ts-check

import { PING_DURATION_MS } from '../../core/constants.js';

/**
 * @typedef {import('../../core/types.js').Level} Level
 * @typedef {import('../../grid/GridAdapter.js').GridAdapter} GridAdapter
 */

/**
 * Marqueur « regarde ici » — un ping (CdC §5.5).
 *
 * ## Ce que cette couche n'est pas
 *
 * ⛔ **Elle ne lit pas le store, et le ping n'est pas un état de campagne.** Un ping est un geste,
 * pas une donnée : il ne se persiste pas, ne se rejoue pas, et un joueur qui rejoint la séance ne
 * doit surtout pas en voir un vieux. Il vit donc en variable locale de la vue, exactement comme
 * `lockedPortalFlash` du battement des portes verrouillées, dont cette couche reprend le motif.
 *
 * ## Pourquoi l'horodatage est local
 *
 * ⭐ L'animation se calcule sur un `at` posé **à la réception**, par le poste qui affiche. Il serait
 * naturel de copier l'animation des pions, qui dérive tout de `move.startedAt` + `now` — et ce
 * serait un défaut. `startedAt` est estampillé avec le `Date.now()` de l'émetteur
 * (`store.js`, `moveTokenToCell`), or la tablette de ce projet a été mesurée **5,3 s en avance**.
 * Un ping de 2 s jugé sur cette horloge étrangère serait déjà expiré en arrivant : il
 * n'apparaîtrait **jamais** sur le poste des joueurs, celui pour qui le geste existe.
 *
 * Un pion a besoin de déterminisme — un client qui rejoint doit le voir au bon endroit. Un ping n'a
 * aucun état à reconstituer, donc chacun peut l'animer depuis sa propre réception sans que la
 * différence soit observable. **La conception la plus simple est ici la plus juste**, ce qui est
 * assez rare pour être écrit.
 *
 * ## Épaisseurs
 *
 * Toutes les grandeurs sont écrites en **pixels écran** puis divisées par le zoom, comme
 * `portals.js` : le contexte reçu est déjà mis à l'échelle par `camera.applyToContext`, donc une
 * valeur écrite crûment serait une grandeur *carte* — juste à zoom 1 et fausse partout ailleurs.
 */

/** Rayon final de l'onde, en pixels écran. */
export const PING_MAX_RADIUS_SCREEN_PX = 44;

/** Rayon du point central, en pixels écran. */
export const PING_DOT_RADIUS_SCREEN_PX = 5;

/** Épaisseur du trait de l'onde, en pixels écran. */
export const PING_RING_WIDTH_SCREEN_PX = 3;

/** Nombre d'ondes concentriques décalées dans le temps. */
export const PING_WAVE_COUNT = 3;

/** Teinte du ping. Jaune franc : aucune autre couche ne l'emploie. */
export const PING_COLOR = '#facc15';

export class PingsLayer {
  /**
   * Dessine le ping courant, s'il est encore dans sa fenêtre d'affichage.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {GridAdapter} grid - non utilisé pour la position, qui est déjà en pixels carte ;
   *   présent pour que la signature reste celle des autres couches et qu'un usage futur
   *   (accrochage à la case) n'ait pas à changer l'appelant.
   * @param {Level|null} level - l'étage actif : un ping d'un autre étage ne se dessine pas
   * @param {{
   *   ping?: { levelId: string, mapPos: { x: number, y: number }, at: number }|null,
   *   now?: number,
   *   zoom?: number
   * }} [options]
   * @returns {{ drawn: boolean, animationActive: boolean }}
   */
  render(ctx, grid, level, options = {}) {
    const result = { drawn: false, animationActive: false };
    const ping = options.ping ?? null;
    if (!ctx || !level || !ping || !ping.mapPos) return result;

    // Un ping appartient à un étage. Le montrer sur un autre placerait un repère « regarde ici »
    // à un endroit qui ne veut rien dire — pire qu'une absence de repère.
    if (ping.levelId && ping.levelId !== level.id) return result;

    const now = options.now ?? 0;
    const age = now - ping.at;
    // ⛔ Un âge négatif n'est pas « pas encore commencé », c'est une incohérence d'horloge : on ne
    // dessine rien plutôt que de fabriquer une progression hors bornes.
    if (age < 0 || age >= PING_DURATION_MS) return result;

    const zoom = options.zoom && options.zoom > 0 ? options.zoom : 1;
    /** @param {number} screenPx */
    const px = (screenPx) => screenPx / zoom;
    const { x, y } = ping.mapPos;

    ctx.save();
    ctx.lineCap = 'round';

    // Les ondes partent décalées d'une fraction de la durée, pour lire comme une pulsation et non
    // comme un cercle unique qui grossit.
    for (let i = 0; i < PING_WAVE_COUNT; i++) {
      const decalage = i / PING_WAVE_COUNT;
      const progres = age / PING_DURATION_MS - decalage;
      if (progres <= 0 || progres > 1) continue;
      ctx.globalAlpha = 1 - progres;
      ctx.strokeStyle = PING_COLOR;
      ctx.lineWidth = px(PING_RING_WIDTH_SCREEN_PX);
      ctx.beginPath();
      ctx.arc(x, y, px(PING_MAX_RADIUS_SCREEN_PX) * progres, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Le point central reste opaque presque jusqu'à la fin : c'est lui qui désigne l'endroit, les
    // ondes ne servent qu'à attirer l'œil.
    ctx.globalAlpha = Math.min(1, 2 * (1 - age / PING_DURATION_MS));
    ctx.fillStyle = PING_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, px(PING_DOT_RADIUS_SCREEN_PX), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    result.drawn = true;
    result.animationActive = true;
    return result;
  }
}
