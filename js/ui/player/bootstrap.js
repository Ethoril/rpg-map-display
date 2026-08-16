// @ts-check

import { PointerInput } from '../../input/pointer.js';
import { findHitPortal } from '../../input/portalHit.js';
import { gridFor } from '../../grid/index.js';
import { cellKey } from '../../core/cellKey.js';
import { findPath } from '../../movement/path.js';
import { computeBlockedEdges } from '../../import/blockedEdges.js';
import { terrainCostRecordToMap } from '../../core/schema.js';
import * as store from '../../state/store.js';

import { findHitTemplate } from '../../input/templateHit.js';
import {
  findHitToken,
  exactTokenAtCell,
  isPlayerManipulableToken,
} from '../../input/tokenHit.js';

/** @typedef {import('../../core/types.js').Cell} Cell */
/** @typedef {import('../../core/types.js').Token} Token */
/** @typedef {import('../../input/gestures.js').InputIntention} InputIntention */
/** @typedef {import('../../transport/Transport.js').Transport} Transport */
/** @typedef {import('../../input/pointer.js').InputCamera} InputCamera */

/**
 * Options d'initialisation de la vue joueurs.
 * @typedef {Object} PlayerBootstrapOptions
 * @property {HTMLElement} element Élément HTML à écouter (canvas)
 * @property {InputCamera} camera Instance de la caméra pour conversions d'écran vers carte
 * @property {Transport} [transport] Transport réseau optionnel pour la synchronisation
 * @property {(cell: Cell, kind: 'refused'|'occupied') => void} [onDestinationRejected]
 *   Retour transitoire demandé par la vue pour une destination qui ne peut pas recevoir le pion.
 */

/**
 * Monte la vue joueurs : attache les écouteurs d'input et synchronise le store et le réseau.
 *
 * @param {PlayerBootstrapOptions} options
 * @returns {{ detach: () => void, pointerInput: PointerInput }}
 */
export function bootstrapPlayerView(options) {
  const { element, camera, transport } = options;
  const onDestinationRejected = options.onDestinationRejected ?? (() => {});

  /** @type {{ templateId: string, startMapPos: import('../../core/types.js').MapPoint, initialOrigin: import('../../core/types.js').MapPoint, initialDirectionDeg: number }|null} */
  let playerTemplateDragState = null;

  /**
   * Traite les intentions d'input spécifiques à la vue joueurs.
   * @param {InputIntention} intention
   */
  function handleIntention(intention) {
    if (intention.type === 'dragTemplate') {
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return;
      const activeLevel = state.activeLevel;
      const t = (state.campaign.templates || []).find((item) => item.id === intention.templateId);
      if (!t || t.levelId !== activeLevel.id || t.visibleToPlayers !== true) return;

      if (intention.phase === 'start') {
        playerTemplateDragState = {
          templateId: t.id,
          startMapPos: { ...intention.mapPos },
          initialOrigin: { ...t.origin },
          initialDirectionDeg: t.directionDeg || 0,
        };
      }

      if (!playerTemplateDragState || playerTemplateDragState.templateId !== t.id) return;

      if (intention.dragMode === 'move') {
        const dx = intention.mapPos.x - playerTemplateDragState.startMapPos.x;
        const dy = intention.mapPos.y - playerTemplateDragState.startMapPos.y;
        const newOrigin = {
          x: playerTemplateDragState.initialOrigin.x + dx,
          y: playerTemplateDragState.initialOrigin.y + dy,
        };
        store.moveTemplate(t.id, newOrigin, t.directionDeg);
      } else if (intention.dragMode === 'rotate') {
        const dx = intention.mapPos.x - t.origin.x;
        const dy = intention.mapPos.y - t.origin.y;
        const angleRad = Math.atan2(dy, dx);
        const angleDeg = Math.round(((angleRad * 180) / Math.PI + 360) % 360);
        store.moveTemplate(t.id, t.origin, angleDeg);
      }

      if (intention.phase === 'end') {
        if (transport) {
          transport.publish({
            type: 'template.move',
            payload: {
              templateId: t.id,
              origin: t.origin,
              directionDeg: t.directionDeg || 0,
            },
            at: Date.now(),
            by: 'players',
          });
        }
        playerTemplateDragState = null;
      }
      return;
    }

    if (intention.type !== 'tap') {
      return;
    }

    const state = store.getState();
    const { campaign, activeLevel, selectedToken, reachableCells } = state;

    if (!campaign || !activeLevel) {
      return;
    }

    const grid = gridFor(activeLevel);
    const targetCell = grid.cellFromPoint(intention.mapPos);
    if (!targetCell) {
      store.selectToken(null);
      return;
    }

    const tappedToken = findHitToken(
      grid,
      activeLevel,
      intention.mapPos,
      camera.zoom,
      campaign.tokens,
      { filter: (t) => !t.hidden, deprioritize: (t) => !isPlayerManipulableToken(t) }
    );

    const tappedMovablePc = tappedToken && isPlayerManipulableToken(tappedToken) ? tappedToken : null;

    // Le pion qui occupe **exactement** la case touchée, marge exclue. Il sert deux fois : à
    // borner la retombée vers la porte juste en dessous, et à décider de la destination d'un
    // déplacement plus bas.
    const exactTappedToken = exactTokenAtCell(activeLevel, targetCell, campaign.tokens, {
      filter: (t) => !t.hidden,
    });

    // Arbitrage n°1 (brief O §5a), **borné à la marge** : un PNJ qu'on manque de peu ne bloque
    // plus la porte derrière lui — sinon la tolérance élargirait de 24 px la zone morte autour de
    // chaque PNJ, soit l'inverse de ce que ce chantier corrige. Mais un PNJ touché en plein
    // continue de la bloquer : sans cette borne, un PNJ posté à moins de 0,25 case d'une porte
    // ferait ouvrir la porte à chaque tap sur son corps, et la porte reprendrait la priorité
    // inconditionnelle que le brief §3 lui reproche.
    if (!tappedMovablePc && !exactTappedToken) {
      const hitPortal = findHitPortal(grid, activeLevel, intention.mapPos);
      if (hitPortal) {
        /** @type {'open'|'closed'|null} */
        let targetState = null;
        if (hitPortal.state === 'closed') {
          targetState = 'open';
        } else if (hitPortal.state === 'open') {
          targetState = 'closed';
        }
        if (targetState) {
          store.setPortalState(activeLevel.id, hitPortal.id, targetState);
          if (transport) {
            transport.publish({
              type: 'portal.toggle',
              payload: {
                levelId: activeLevel.id,
                portalId: hitPortal.id,
                state: targetState,
              },
              at: Date.now(),
              by: 'players',
            });
          }
        }
        return;
      }
    }

    if (!selectedToken) {
      store.selectToken(tappedMovablePc ? tappedMovablePc.id : null);
      return;
    }

    // Sélection active : la marge sert à **désigner**, jamais à définir une destination. Un tap
    // sur une case vide voisine d'un autre pion doit déplacer le pion sélectionné, pas annuler la
    // sélection — donc l'occupation de la case cible se lit à l'appartenance exacte.
    const exactMovablePc =
      exactTappedToken && isPlayerManipulableToken(exactTappedToken) ? exactTappedToken : null;

    // ⚠ Passer d'un PJ à un autre reste possible même sur la case du pion sélectionné : deux PJ
    // peuvent être empilés, et le second doit rester désignable au doigt. C'est pour ça que ce
    // bloc est AVANT le franchissement et non après — le déplacer sous lui rendrait le second PJ
    // insélectionnable tant que le premier l'est, `findHitToken` départageant par identifiant.
    if (exactMovablePc && exactMovablePc.id !== selectedToken.id) {
      store.selectToken(exactMovablePc.id);
      return;
    }

    // ── Lot 3, S-03 : franchir une liaison ────────────────────────────────────────────────
    //
    // Le geste est délibérément en **deux temps** : amener le pion sur l'escalier, puis retaper
    // sa case pour monter. Un franchissement en un seul tap ferait changer d'étage à chaque fois
    // qu'on vise l'escalier pour s'y poster, et la table verrait l'autre étage sans l'avoir
    // demandé. Retaper sa propre case ne servait à rien jusqu'ici : le geste était libre.
    //
    // ⛔ Ce bloc doit rester AVANT le refus « case occupée » ci-dessous, et il y était après le
    // 16 août 2026 seulement. Rien n'interdit au MJ de poser un PNJ — ou un pion 2×2 — sur la case
    // où se tient déjà un PJ : `exactTokenAtCell` rend alors le PREMIER pion du tableau, et si
    // c'est le PNJ, le tap partait en « case occupée » puis désélectionnait, alors que le joueur
    // avait simplement retapé sa propre case. Il resélectionnait, l'invite de franchissement se
    // rallumait, le tap refusait encore : boucle sans issue devant toute la table, arbitrée par
    // l'ordre du tableau de pions. Or taper la case où l'on est déjà n'est jamais un déplacement
    // vers une case occupée — la question de l'occupation ne s'y pose pas.
    if (targetCell.a === selectedToken.cell.a && targetCell.b === selectedToken.cell.b) {
      const liaison = store.findLinkAtCell(activeLevel.id, targetCell);
      if (
        liaison &&
        selectedToken.kind === 'pc' &&
        !selectedToken.locked &&
        !selectedToken.hidden &&
        selectedToken.playerMovable !== false
      ) {
        let destination;
        try {
          destination = store.traverseLink(selectedToken.id, liaison.link.id);
        } catch {
          onDestinationRejected(targetCell, 'refused');
          return;
        }
        transport?.publish({
          type: 'link.traverse',
          payload: { tokenId: selectedToken.id, linkId: liaison.link.id, destination },
          at: Date.now(),
          by: 'players',
        });
      }
      return;
    }

    if (exactTappedToken && exactTappedToken.id !== selectedToken.id) {
      // Un PNJ ou un pion interdit présent exactement sur la case n'est jamais une destination de mouvement implicite.
      onDestinationRejected(targetCell, 'occupied');
      store.selectToken(null);
      return;
    }

    if (
      selectedToken.kind !== 'pc' ||
      selectedToken.locked ||
      selectedToken.playerMovable === false
    ) {
      onDestinationRejected(targetCell, 'refused');
      store.selectToken(null);
      return;
    }

    const targetKey = cellKey(targetCell);
    if (!reachableCells.has(targetKey)) {
      onDestinationRejected(targetCell, 'refused');
      store.selectToken(null);
      return;
    }

    const blockedEdges = computeBlockedEdges(activeLevel, grid);
    const terrainCostMap = terrainCostRecordToMap(activeLevel.terrainCost);
    const path = findPath(grid, selectedToken.cell, targetCell, blockedEdges, terrainCostMap);
    const startedAt = Date.now();

    const moveData = {
      from: { a: selectedToken.cell.a, b: selectedToken.cell.b },
      to: { a: targetCell.a, b: targetCell.b },
      path,
      startedAt,
    };

    store.moveTokenToCell(selectedToken.id, targetCell, moveData);

    if (transport) {
      transport.publish({
        type: 'token.move',
        payload: {
          tokenId: selectedToken.id,
          from: moveData.from,
          to: moveData.to,
          path: moveData.path,
          startedAt: moveData.startedAt,
        },
        at: startedAt,
        by: 'players',
      });
    }
  }

  const pointerInput = new PointerInput(element, camera, {
    role: 'players',
    onIntention: handleIntention,
    canStartTemplateDrag: (_screenPos, mapPos) => {
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return null;
      const hit = findHitTemplate(state.activeLevel, state.campaign.templates || [], mapPos, camera.zoom, 0, true);
      return hit ? { templateId: hit.template.id, dragMode: hit.mode } : null;
    },
  });

  return {
    detach: () => {
      pointerInput.detach();
    },
    pointerInput,
  };
}

// `findHitPortal` et `distancePointToSegment` vivaient ici en double avec la vue MJ.
// Elles sont désormais dans `js/input/portalHit.js`, avec leur tolérance.
