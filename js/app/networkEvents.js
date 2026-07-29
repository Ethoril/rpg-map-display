// @ts-check

import * as store from '../state/store.js';

/** @typedef {import('../core/types.js').NetEvent} NetEvent */

/**
 * Applique un événement réseau au store de façon idempotente.
 * Firebase reste entièrement hors de ce module.
 *
 * @param {NetEvent & {eventId?: string, clientId?: string}} event
 * @returns {boolean} true si le store a été modifié
 */
export function applyNetworkEvent(event) {
  if (!event || typeof event !== 'object' || !event.type) return false;
  const payload = /** @type {Record<string, any>} */ (event.payload || {});
  const campaign = store.getCampaign();

  switch (event.type) {
    case 'level.add': {
      if (!payload.level) return false;
      store.addLevel(payload.level);
      return true;
    }
    case 'level.grid': {
      if (!payload.levelId || !payload.grid) return false;
      if (!campaign?.levels.some((level) => level.id === payload.levelId)) return false;
      store.updateLevel(payload.levelId, { grid: payload.grid });
      return true;
    }
    case 'token.add': {
      if (!payload.token) return false;
      if (campaign?.tokens.some((token) => token.id === payload.token.id)) return false;
      store.addToken(payload.token);
      return true;
    }
    case 'token.move': {
      if (!payload.tokenId || !payload.to) return false;
      if (!campaign?.tokens.some((token) => token.id === payload.tokenId)) return false;
      store.moveTokenToCell(payload.tokenId, payload.to, {
        from: payload.from,
        to: payload.to,
        path: payload.path,
        startedAt: payload.startedAt ?? event.at,
      });
      return true;
    }
    default:
      return false;
  }
}

/**
 * Snapshot durable remis à Firestore/LocalStorage.
 *
 * @returns {{campaign: import('../core/types.js').Campaign|null, activeLevelId: string|null, selectedTokenId: string|null}}
 */
export function createSnapshotPayload() {
  const state = store.getState();
  return {
    campaign: state.campaign,
    activeLevelId: state.activeLevelId,
    selectedTokenId: state.selectedTokenId,
  };
}

