// @ts-check

import { PointerInput } from '../../input/pointer.js';
import { gridFor } from '../../grid/index.js';
import { cellKey } from '../../core/cellKey.js';
import * as store from '../../state/store.js';

import { findHitTemplate, templateDragPose } from '../../input/templateHit.js';
import {
  findHitToken,
  exactTokenAtCell,
  isPlayerManipulableToken,
} from '../../input/tokenHit.js';
import { boutonsPorte } from '../../render/layers/portals.js';
import { boutonLiaison } from '../../render/layers/links.js';
import { TOKEN_MOVE_STEP_MS } from '../../render/layers/tokens.js';

/**
 * Teste si un point en unités carte se trouve dans un rectangle en unités carte.
 * @param {{ x: number, y: number }} pt
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @returns {boolean}
 */
function pointInRect(pt, rect) {
  return (
    pt.x >= rect.x &&
    pt.x <= rect.x + rect.width &&
    pt.y >= rect.y &&
    pt.y <= rect.y + rect.height
  );
}

/**
 * Indique si une animation de déplacement court actuellement sur cet étage (CA11).
 * @param {readonly Token[]} tokens
 * @param {string} levelId
 * @param {number} now
 * @returns {boolean}
 */
function isAnyTokenMoveAnimating(tokens, levelId, now) {
  for (const token of tokens) {
    if (token.levelId !== levelId || !token.move || !Number.isFinite(token.move.startedAt)) continue;
    const path = Array.isArray(token.move.path) && token.move.path.length >= 2
      ? token.move.path
      : token.move.from && token.move.to
        ? [token.move.from, token.move.to]
        : null;
    if (!path || path.length < 2) continue;
    const last = path[path.length - 1];
    if (last.a !== token.cell.a || last.b !== token.cell.b) continue;
    if (now - token.move.startedAt < (path.length - 1) * TOKEN_MOVE_STEP_MS) {
      return true;
    }
  }
  return false;
}

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
 * @property {(token: Token, level: import('../../core/types.js').Level) => boolean} [isTokenVisible]
 * @property {(token: Token|null) => void} [onInspectToken] Ouvre ou ferme la consultation locale.
 * @property {() => number} [getInsetTop] Hauteur de la barre d'onglets d'étages pour le calage du bouton de liaison.
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
  const isTokenVisible = options.isTokenVisible ?? ((token) => !token.hidden);
  const onInspectToken = options.onInspectToken ?? (() => {});
  const getInsetTop = options.getInsetTop ?? (() => 0);
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

    // Tout tap referme la consultation ; seul le tap sur un pion consultable la rouvre, plus bas.
    onInspectToken(null);

    const grid = gridFor(activeLevel);
    const turn = store.getTurn();
    const filter = /** @param {Token} token */ (token) => isTokenVisible(token, activeLevel);
    // Une préparation commence dès la sélection du pion (zone affichée) : masquer les boutons dès
    // ce stade évite qu'un bouton « Fermer » ou « Prendre l'escalier » n'intercepte le tap de la
    // case juste derrière une porte ouverte ou juste au-dessus d'un escalier (CA1, CA11).
    const hasPreparation = Boolean(selectedToken || movePlanning?.getPlan());
    const animatingMove = isAnyTokenMoveAnimating(campaign.tokens, activeLevel.id, Date.now());

    // Boutons de liaison et de porte testés AVANT l'arbitrage pion/case, uniquement hors
    // préparation de mouvement et hors animation (décisions 1, 2, 3, 4, 5 du 22/11/2026 ; CA1–CA12).
    if (!hasPreparation && !animatingMove) {
      const visibleTokens = campaign.tokens.filter((t) => t.levelId === activeLevel.id && filter(t));
      const fullCamera =
        'screenWidth' in camera && 'screenHeight' in camera
          ? /** @type {import('../../render/camera.js').Camera} */ (camera)
          : undefined;
      const links = campaign.links ?? [];
      for (const token of visibleTokens) {
        const linkButton = boutonLiaison(grid, activeLevel, links, token, {
          zoom: camera.zoom,
          turn,
          camera: fullCamera,
          insetTop: getInsetTop(),
        });
        if (linkButton && pointInRect(intention.mapPos, linkButton.rect)) {
          cancelledAtCell = null;
          let destination;
          try {
            destination = movePlanning
              ? movePlanning.withSuppressedReconcile(() => store.traverseLink(token.id, linkButton.linkId))
              : store.traverseLink(token.id, linkButton.linkId);
          } catch {
            onDestinationRejected(token.cell, 'refused');
            return;
          }
          movePlanning?.cancel();
          transport?.publish({
            type: 'link.traverse',
            payload: { tokenId: token.id, linkId: linkButton.linkId, destination },
            at: Date.now(),
            by: 'players',
          });
          return;
        }
      }

      const doorButtons = boutonsPorte(grid, activeLevel, visibleTokens, {
        zoom: camera.zoom,
        turn,
      });
      const hitDoorButton = doorButtons.find((btn) => pointInRect(intention.mapPos, btn.rect));
      if (hitDoorButton) {
        cancelledAtCell = null;
        if (!hitDoorButton.enabled) {
          // CA10 : bouton grisé hors tour, sans effet.
          return;
        }
        const portal = activeLevel.portals.find((p) => p.id === hitDoorButton.portalId);
        if (!portal) return;
        /** @type {'open'|'closed'|null} */
        let targetState = null;
        if (portal.state === 'closed') targetState = 'open';
        else if (portal.state === 'open') targetState = 'closed';
        if (targetState) {
          store.setPortalState(activeLevel.id, portal.id, targetState);
          transport?.publish({
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
        return;
      }
    }

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
      { filter, deprioritize: (t) => !isPlayerManipulableToken(t, turn) }
    );
    const tappedToken = tappedHit ? tappedHit.token : null;

    const tappedMovablePc = tappedToken && isPlayerManipulableToken(tappedToken, turn) ? tappedToken : null;

    // Le pion qui occupe **exactement** la case touchée, marge exclue : sert à décider de la
    // destination d'un déplacement plus bas.
    const exactTappedToken = exactTokenAtCell(activeLevel, targetCell, campaign.tokens, {
      filter,
      grid,
    });

    if (!selectedToken) {
      store.selectToken(tappedMovablePc ? tappedMovablePc.id : null);
      cancelledAtCell = null;
      if (tappedMovablePc) movePlanning?.start(tappedMovablePc, activeLevel);
      // Un pion que la tablette ne déplace pas ne se sélectionne pas : il se CONSULTE, en
      // lecture seule (combat du 21/11/2026). Ni zone, ni préparation, rien ne part au réseau.
      else if (tappedToken) onInspectToken(tappedToken);
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
      exactTappedToken && isPlayerManipulableToken(exactTappedToken, turn) ? exactTappedToken : null;

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

    // Décision 1 du 22/11/2026 (CA3) : retaper la case du pion sélectionné ne franchit plus de
    // liaison — seul le bouton de liaison le fait.
    if (targetCell.a === selectedToken.cell.a && targetCell.b === selectedToken.cell.b) {
      return;
    }

    if (exactTappedToken && exactTappedToken.id !== selectedToken.id) {
      // Un PNJ ou un pion interdit présent exactement sur la case n'est jamais une destination de mouvement implicite.
      onDestinationRejected(targetCell, 'occupied');
      return;
    }

    if (
      selectedToken.hidden ||
      !isPlayerManipulableToken(selectedToken, turn)
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
      // ⭐ Coût retenu pour décompter le mouvement du tour LOCALEMENT, sans attendre le
      // `turn.select` que le MJ republie après son `reportMove`. Sans ce décompte, la tablette
      // proposait le budget ENTIER pendant tout l'aller-retour réseau — relevé entre 336 ms et
      // 2,4 s en séance le 7 août 2026 — et trois taps rapides suffisaient à rejouer un second
      // trajet complet dans le même tour. Le décompte local est sans danger de double compte :
      // `turn.select` porte une valeur ABSOLUE et `setTurn` ne fait jamais redescendre le
      // compteur du même pion.
      let coutValide = 0;
      const validation = movePlanning?.validate(latestToken, activeLevel, (path, destination, cost) => {
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
        coutValide = cost;
        store.selectToken(null);
        return true;
      });
      if (!validation?.ok) onDestinationRejected(targetCell, 'refused');
      // ⛔ Après `validate`, jamais dedans : pendant le `commit` la préparation est en statut
      // `validating`, et notifier les abonnés à ce moment-là ferait réentrer `reconcile` sur un
      // plan en cours de validation.
      else if (coutValide > 0) store.addTurnSpent(latestToken.id, coutValide);
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
    startTouchHold: (mapPos) => {
      const { campaign, activeLevel, selectedToken } = store.getState();
      if (!campaign || !activeLevel || !selectedToken) return;
      const hit = findHitToken(gridFor(activeLevel), activeLevel, mapPos, camera.zoom, campaign.tokens, {
        filter: (token) => isTokenVisible(token, activeLevel),
      });
      if (!hit || isPlayerManipulableToken(hit.token, store.getTurn())) return;
      onInspectToken(hit.token);
      return () => onInspectToken(null);
    },
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
