// @ts-check

import { PointerInput } from '../../input/pointer.js';
import { findHitPortal } from '../../input/portalHit.js';
import { gridFor } from '../../grid/index.js';
import { cellKey } from '../../core/cellKey.js';
import * as store from '../../state/store.js';

import { findHitTemplate, templateDragPose } from '../../input/templateHit.js';
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
 * @property {(preview: {templateId: string, origin: import('../../core/types.js').MapPoint, directionDeg: number}|null) => void} [onTemplatePreview]
 *   Pose d'aperçu d'un gabarit en cours de glisser, `null` quand il s'achève ou s'interrompt (B4).
 * @property {()=>void} [onMovePlanChanged] Demande un rendu après un changement de préparation.
 * @property {MovePlanningApi} [movePlanning] Contrôleur injecté par la vue applicative.
 */

/** @typedef {import('../../app/movePlanning.js').MovePlanningController} MovePlanningApi */

/**
 * Monte la vue joueurs : attache les écouteurs d'input et synchronise le store et le réseau.
 *
 * @param {PlayerBootstrapOptions} options
 * @returns {{ detach: () => void, pointerInput: PointerInput, movePlanning?: MovePlanningApi }}
 */
export function bootstrapPlayerView(options) {
  const { element, camera, transport } = options;
  const onDestinationRejected = options.onDestinationRejected ?? (() => {});
  const onTemplatePreview = options.onTemplatePreview ?? (() => {});
  const movePlanning = options.movePlanning;
  /** @type {Cell|null} */
  let cancelledAtCell = null;

  /** @type {import('../../input/templateHit.js').TemplateDragState|null} */
  let playerTemplateDragState = null;

  /**
   * Traite les intentions d'input spécifiques à la vue joueurs.
   * @param {InputIntention} intention
   */
  function handleIntention(intention) {
    if (intention.type !== 'tap') cancelledAtCell = null;
    if (intention.type === 'dragTemplate') {
      if (intention.phase === 'cancel') {
        // Geste interrompu — second doigt, pointercancel (B3, B4) : rien n'a été muté, rien
        // n'est publié, l'aperçu s'efface. Avant, le store avait déjà bougé à chaque `move`,
        // et le `end` jamais émis laissait la table et le MJ en désaccord.
        playerTemplateDragState = null;
        onTemplatePreview(null);
        return;
      }
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return;
      const activeLevel = state.activeLevel;
      const t = (state.campaign.templates || []).find((item) => item.id === intention.templateId);
      if (!t || t.levelId !== activeLevel.id || t.visibleToPlayers !== true) return;

      if (intention.phase === 'start') {
        playerTemplateDragState = {
          templateId: t.id,
          dragMode: intention.dragMode,
          startMapPos: { ...intention.mapPos },
          initialOrigin: { ...t.origin },
          initialDirectionDeg: t.directionDeg || 0,
        };
      }
      if (!playerTemplateDragState || playerTemplateDragState.templateId !== t.id) return;

      // ⛔ Aperçu seul tant que le doigt est posé (B4) : ni store, ni réseau.
      const pose = templateDragPose(playerTemplateDragState, intention.mapPos);
      if (intention.phase !== 'end') {
        onTemplatePreview({ templateId: t.id, ...pose });
        return;
      }

      playerTemplateDragState = null;
      onTemplatePreview(null);
      store.moveTemplate(t.id, pose.origin, pose.directionDeg);
      transport?.publish({
        type: 'template.move',
        payload: { templateId: t.id, origin: pose.origin, directionDeg: pose.directionDeg },
        at: Date.now(),
        by: 'players',
      });
      return;
    }

    if (intention.type !== 'tap') {
      if (intention.type === 'doubleTap') return;
      return;
    }

    const state = store.getState();
    const { campaign, activeLevel, selectedToken } = state;

    if (!campaign || !activeLevel) {
      return;
    }

    const grid = gridFor(activeLevel);
    const targetCell = grid.cellFromPoint(intention.mapPos);
    if (!targetCell) {
      if (movePlanning?.getPlan()?.steps.length) movePlanning.cancel();
      else store.selectToken(null);
      return;
    }

    const tappedHit = findHitToken(
      grid,
      activeLevel,
      intention.mapPos,
      camera.zoom,
      campaign.tokens,
      { filter: (t) => !t.hidden, deprioritize: (t) => !isPlayerManipulableToken(t) }
    );
    const tappedToken = tappedHit ? tappedHit.token : null;

    const tappedMovablePc = tappedToken && isPlayerManipulableToken(tappedToken) ? tappedToken : null;

    // Le pion qui occupe **exactement** la case touchée, marge exclue. Il sert deux fois : à
    // borner la retombée vers la porte juste en dessous, et à décider de la destination d'un
    // déplacement plus bas.
    const exactTappedToken = exactTokenAtCell(activeLevel, targetCell, campaign.tokens, {
      filter: (t) => !t.hidden,
      grid,
    });

    // Arbitrage n°1 (brief distance) : le plus proche gagne, dans une seule et même unité —
    // la CARTE, parce que c'est elle qui porte la géométrie ; l'écran n'est qu'une fenêtre posée
    // dessus, et sa fraction de case varie avec le zoom (brief O §5a le disait déjà : à la vue
    // « carte entière », 24 px d'écran couvrent presque une case entière en unités carte). Un
    // pion touché en plein (`tappedHit.dist === 0`) est de fait toujours strictement plus proche
    // qu'aucune porte à portée, donc la protection du chantier O — un pion sous le doigt bloque
    // la porte derrière lui — en découle SANS cas particulier à écrire ici.
    const hitPortal = findHitPortal(grid, activeLevel, intention.mapPos, camera.zoom);
    const portalIsCloser =
      hitPortal && (!tappedHit || hitPortal.dist < tappedHit.dist - 1e-6);
    if (portalIsCloser) {
      cancelledAtCell = null;
      const portal = hitPortal.portal;
      /** @type {'open'|'closed'|null} */
      let targetState = null;
      if (portal.state === 'closed') {
        targetState = 'open';
      } else if (portal.state === 'open') {
        targetState = 'closed';
      }
      if (targetState) {
        store.setPortalState(activeLevel.id, portal.id, targetState);
        if (transport) {
          transport.publish({
            type: 'portal.toggle',
            payload: {
              levelId: activeLevel.id,
              portalId: portal.id,
              state: targetState,
            },
            at: Date.now(),
            by: 'players',
          });
        }
      }
      return;
    }

    if (!selectedToken) {
      store.selectToken(tappedMovablePc ? tappedMovablePc.id : null);
      cancelledAtCell = null;
      if (tappedMovablePc) movePlanning?.start(tappedMovablePc, activeLevel);
      return;
    }

    const plan = movePlanning?.getPlan();
    if (!tappedToken && !exactTappedToken && cancelledAtCell && targetCell.a === cancelledAtCell.a && targetCell.b === cancelledAtCell.b) {
      cancelledAtCell = null;
      movePlanning?.cancel();
      store.selectToken(null);
      return;
    }
    cancelledAtCell = null;

    // Sélection active : la marge sert à **désigner**, jamais à définir une destination. Un tap
    // sur une case vide voisine d'un autre pion doit déplacer le pion sélectionné, pas annuler la
    // sélection — donc l'occupation de la case cible se lit à l'appartenance exacte.
    const exactMovablePc =
      exactTappedToken && isPlayerManipulableToken(exactTappedToken) ? exactTappedToken : null;

    // ⚠ Depuis C-6 (10/09/2026, `docs/QUESTIONS-EN-ATTENTE.md`), l'empilement de pions est
    // impossible : `exactTappedToken` ne peut donc plus désigner un AUTRE PJ que celui déjà
    // sélectionné sur sa propre case, et cette branche est en pratique inatteignable. Elle reste
    // écrite — et AVANT le franchissement — en garde défensive : `exactTokenAtCell` et
    // `findHitToken` ne sont volontairement pas mis en accord (C-6 en fait la remarque), et si
    // l'invariant venait un jour à être contourné ailleurs, mieux vaut resélectionner que
    // franchir avec le mauvais pion sous le doigt.
    if (exactMovablePc && exactMovablePc.id !== selectedToken.id) {
      movePlanning?.cancel();
      store.selectToken(exactMovablePc.id);
      movePlanning?.start(exactMovablePc, activeLevel);
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
    // 16 août 2026 seulement. Avant C-6 (10/09/2026), le MJ pouvait poser un PNJ — ou un pion
    // 2×2 — sur la case où se tenait déjà un PJ, et `exactTokenAtCell` rendait alors le PREMIER
    // pion du tableau : si c'était le PNJ, le tap partait en « case occupée » puis désélectionnait,
    // alors que le joueur avait simplement retapé sa propre case, ouvrant une boucle sans issue
    // arbitrée par l'ordre du tableau. Depuis C-6, un PNJ ne peut plus être posé sur la case d'un
    // PJ — `moveTokenToCell`/`addToken` le refusent — donc `exactTappedToken` ne peut plus être
    // que le pion déjà sélectionné ici. L'ordre reste correct à garder : taper la case où l'on
    // est déjà n'est jamais un déplacement vers une case occupée — la question ne s'y pose pas.
    if (targetCell.a === selectedToken.cell.a && targetCell.b === selectedToken.cell.b) {
      const liaison = store.findLinkAtCell(activeLevel.id, targetCell);
      // Chantier C-9 : monté, on ne prend aucune liaison depuis la tablette — on descend de
      // cheval pour changer d'étage. Le MJ, lui, reste libre (glisser, sélecteur d'étage).
      if (liaison && selectedToken.mounted === true) {
        onDestinationRejected(targetCell, 'refused');
        return;
      }
      if (
        liaison &&
        selectedToken.kind === 'pc' &&
        !selectedToken.locked &&
        !selectedToken.hidden &&
        selectedToken.playerMovable !== false
      ) {
        let destination;
        try {
          destination = movePlanning
            ? movePlanning.withSuppressedReconcile(() => store.traverseLink(selectedToken.id, liaison.link.id))
            : store.traverseLink(selectedToken.id, liaison.link.id);
        } catch {
          onDestinationRejected(targetCell, 'refused');
          return;
        }
        movePlanning?.cancel();
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
      return;
    }

    if (
      selectedToken.hidden ||
      selectedToken.kind !== 'pc' ||
      selectedToken.locked ||
      selectedToken.playerMovable === false
    ) {
      onDestinationRejected(targetCell, 'refused');
      movePlanning?.cancel();
      store.selectToken(null);
      return;
    }

    const currentPlan = movePlanning?.getPlan();
    const endpoint = currentPlan?.steps.length ? currentPlan.path[currentPlan.path.length - 1] : null;
    if (endpoint && endpoint.a === targetCell.a && endpoint.b === targetCell.b) {
      const latestToken = store.getCampaign()?.tokens.find((item) => item.id === selectedToken.id);
      if (!latestToken) return;
      const validation = movePlanning?.validate(latestToken, activeLevel, (path, destination) => {
        if (store.findMoveConflict(latestToken.id, destination)) {
          onDestinationRejected(destination, 'occupied');
          return false;
        }
        const startedAt = Date.now();
        try {
          store.moveTokenToCell(latestToken.id, destination, {
            from: { ...latestToken.cell }, to: destination, path, startedAt,
          });
        } catch {
          onDestinationRejected(destination, 'occupied');
          return false;
        }
        transport?.publish({
          type: 'token.move',
          payload: { tokenId: latestToken.id, from: { ...latestToken.cell }, to: destination, path, startedAt },
          at: startedAt,
          by: 'players',
        });
        store.selectToken(null);
        return true;
      });
      if (!validation?.ok) onDestinationRejected(targetCell, 'refused');
      return;
    }
    const candidatePlan = currentPlan ?? movePlanning?.start(selectedToken, activeLevel);
    if (!candidatePlan) return;
    const targetKey = cellKey(targetCell);
    if (!candidatePlan.reachable.has(targetKey)) {
      if (candidatePlan.steps.length) {
        movePlanning?.cancel();
        cancelledAtCell = { ...targetCell };
      } else {
        movePlanning?.cancel();
        store.selectToken(null);
      }
      return;
    }
    const result = movePlanning?.extend(targetCell, selectedToken, activeLevel);
    if (result && !result.ok) onDestinationRejected(targetCell, 'refused');
  }

  const pointerInput = new PointerInput(element, camera, {
    role: 'players',
    onIntention: handleIntention,
    canDoubleTap: () => store.getState().selectedTokenId === null,
    contextKey: () => {
      const current = store.getState();
      return `${current.activeLevelId || ''}:${current.selectedTokenId || ''}`;
    },
    canStartTemplateDrag: (_screenPos, mapPos) => {
      const state = store.getState();
      if (!state.activeLevel || !state.campaign) return null;
      const hit = findHitTemplate(
        state.activeLevel, state.campaign.templates || [], mapPos, camera.zoom,
        gridFor(state.activeLevel).cellPitch().x, true
      );
      return hit ? { templateId: hit.template.id, dragMode: hit.mode } : null;
    },
  });

  return {
    detach: () => {
      // Le contrôleur est détenu par la vue applicative, qui le nettoie après le détachement.
      pointerInput.detach();
    },
    pointerInput,
    movePlanning,
  };
}

// `findHitPortal` et `distancePointToSegment` vivaient ici en double avec la vue MJ.
// Elles sont désormais dans `js/input/portalHit.js`, avec leur tolérance.
