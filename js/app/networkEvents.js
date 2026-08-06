// @ts-check

import * as store from '../state/store.js';
import { isPersistableAssetUrl } from '../core/schema.js';

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
    // Remplacement complet de la scène (U-05), pendant réseau du mode
    // « Charger » côté MJ. Le payload est un instantané **absolu** et non un
    // delta : le rejouer deux fois converge vers le même état.
    case 'scene.load': {
      // `restoreFromSnapshot` ne remplace la campagne que si `levels` est un
      // tableau ; sans cette garde, une forme aberrante passerait la validation
      // sans rien remplacer tout en effaçant la sélection.
      if (!payload.campaign || !Array.isArray(payload.campaign.levels)) return false;

      try {
        store.restoreFromSnapshot({
          campaign: payload.campaign,
          activeLevelId: payload.activeLevelId ?? null,
          selectedTokenId: payload.selectedTokenId ?? null,
          activeHandout: payload.activeHandout ?? null,
        });
      } catch (err) {
        // CONVENTIONS §6 : une donnée réseau inattendue se journalise et
        // s'ignore, sans corrompre le store. `restoreFromSnapshot` valide avant
        // de muter : l'état courant, valide, est resté en place.
        console.error(
          `Événement "scene.load" refusé, état courant conservé : ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return false;
      }
      return true;
    }
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
    // ── Lot 3, S-02 : la bascule d'étage traverse le réseau ────────────────────────────────
    //
    // Elle ne le faisait pas. `level.add` et `level.grid` existaient depuis le lot 1a, mais changer
    // l'étage actif restait purement local : la tablette n'apprenait l'étage qu'au démarrage, par
    // l'instantané. Le MJ montait à l'étage, la table restait au rez-de-chaussée, et rien ne le
    // signalait.
    //
    // ⚠ L'étage inconnu est refusé **bruyamment**. `store.selectLevel` lève sur un identifiant
    // inconnu : sans ce filtre, un événement arrivé avant l'étage qu'il désigne — l'ordre n'est pas
    // garanti sur le canal — ferait remonter une exception au travers du réducteur.
    case 'level.select': {
      if (!payload.levelId || typeof payload.levelId !== 'string') {
        console.error('Événement "level.select" refusé : payload malformé');
        return false;
      }
      if (!campaign?.levels.some((level) => level.id === payload.levelId)) {
        console.error(`Événement "level.select" refusé : étage inconnu "${payload.levelId}"`);
        return false;
      }
      store.selectLevel(payload.levelId);
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
    // `token.update` porte un patch de champs absolus, jamais un delta : le rejouer deux
    // fois converge. La liste blanche de `store.updateToken` reste seule juge des champs
    // acceptés — la reproduire ici la ferait dériver.
    case 'token.update': {
      if (!payload.tokenId || typeof payload.tokenId !== 'string') {
        console.error('Événement "token.update" refusé : tokenId manquant ou invalide');
        return false;
      }
      if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
        console.error('Événement "token.update" refusé : patch manquant ou non objet');
        return false;
      }
      if (!campaign?.tokens.some((token) => token.id === payload.tokenId)) {
        console.error(`Événement "token.update" refusé : pion inconnu "${payload.tokenId}"`);
        return false;
      }
      try {
        store.updateToken(payload.tokenId, payload.patch);
      } catch (err) {
        console.error(
          `Événement "token.update" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    // Un pion déjà absent n'est pas une erreur : c'est l'état visé. On retourne `false`
    // parce que rien n'a changé, sans journaliser — le rejeu d'une suppression est le cas
    // nominal d'une reconnexion, pas une anomalie.
    case 'token.delete': {
      if (!payload.tokenId || typeof payload.tokenId !== 'string') {
        console.error('Événement "token.delete" refusé : tokenId manquant ou invalide');
        return false;
      }
      if (!campaign?.tokens.some((token) => token.id === payload.tokenId)) return false;
      try {
        store.removeToken(payload.tokenId);
      } catch (err) {
        console.error(
          `Événement "token.delete" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    case 'token.elevation': {
      if (!payload.tokenId || typeof payload.tokenId !== 'string' || !Number.isFinite(payload.elevation)) {
        console.error('Événement "token.elevation" refusé : payload tokenId ou elevation invalide');
        return false;
      }
      if (!campaign?.tokens.some((token) => token.id === payload.tokenId)) {
        console.error(`Événement "token.elevation" refusé : pion inconnu "${payload.tokenId}"`);
        return false;
      }
      try {
        store.updateToken(payload.tokenId, { elevation: payload.elevation });
      } catch (err) {
        console.error(
          `Événement "token.elevation" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }

    case 'handout.show': {
      if (!payload.handout || typeof payload.handout !== 'object') {
        console.error('Événement "handout.show" refusé : payload handout manquant ou invalide');
        return false;
      }
      if (
        typeof payload.handout.imageUrl !== 'string' ||
        !isPersistableAssetUrl(payload.handout.imageUrl)
      ) {
        console.error('Événement "handout.show" refusé : URL d\'image non persistable ou interdite');
        return false;
      }
      try {
        store.setActiveHandout(payload.handout);
      } catch (err) {
        console.error(
          `Événement "handout.show" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    case 'handout.hide': {
      store.setActiveHandout(null);
      return true;
    }
    case 'fog.update': {
      if (!payload.levelId || typeof payload.levelId !== 'string') return false;
      store.setSessionFog(payload.levelId, typeof payload.png === 'string' ? payload.png : null);
      return true;
    }
    case 'vision.update': {
      if (!payload.levelId || typeof payload.levelId !== 'string') return false;
      store.setSessionVision(payload.levelId, typeof payload.png === 'string' ? payload.png : null);
      return true;
    }
    case 'portal.toggle': {
      if (
        !payload.levelId || typeof payload.levelId !== 'string' ||
        !payload.portalId || typeof payload.portalId !== 'string' ||
        (payload.state !== 'open' && payload.state !== 'closed' && payload.state !== 'locked')
      ) {
        console.error('Événement "portal.toggle" refusé : payload malformé');
        return false;
      }
      const level = campaign?.levels.find((l) => l.id === payload.levelId);
      if (!level) {
        console.error(`Événement "portal.toggle" refusé : étage inconnu "${payload.levelId}"`);
        return false;
      }
      const portal = level.portals.find((p) => p.id === payload.portalId);
      if (!portal) {
        console.error(`Événement "portal.toggle" refusé : portail inconnu "${payload.portalId}"`);
        return false;
      }
      if (portal.state === payload.state) {
        return false;
      }
      try {
        store.setPortalState(payload.levelId, payload.portalId, payload.state);
      } catch (err) {
        console.error(
          `Événement "portal.toggle" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    case 'wall.add': {
      if (
        !payload.levelId || typeof payload.levelId !== 'string' ||
        !Array.isArray(payload.wall) || payload.wall.length < 2
      ) {
        console.error('Événement "wall.add" refusé : payload malformé');
        return false;
      }
      if (!campaign?.levels.some((l) => l.id === payload.levelId)) {
        console.error(`Événement "wall.add" refusé : étage inconnu "${payload.levelId}"`);
        return false;
      }
      try {
        store.addWall(payload.levelId, payload.wall);
      } catch (err) {
        console.error(
          `Événement "wall.add" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    case 'wall.remove': {
      if (
        !payload.levelId || typeof payload.levelId !== 'string' ||
        !Array.isArray(payload.wall)
      ) {
        console.error('Événement "wall.remove" refusé : payload malformé');
        return false;
      }
      if (!campaign?.levels.some((l) => l.id === payload.levelId)) {
        console.error(`Événement "wall.remove" refusé : étage inconnu "${payload.levelId}"`);
        return false;
      }
      try {
        return store.removeWall(payload.levelId, payload.wall);
      } catch (err) {
        console.error(
          `Événement "wall.remove" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
    }

    case 'template.place': {
      if (!payload.template || typeof payload.template !== 'object' || !payload.template.levelId) {
        console.error('Événement "template.place" refusé : payload malformé');
        return false;
      }
      if (!campaign?.levels.some((l) => l.id === payload.template.levelId)) {
        console.error(`Événement "template.place" refusé : étage inconnu "${payload.template.levelId}"`);
        return false;
      }
      try {
        store.placeTemplate(payload.template);
      } catch (err) {
        console.error(
          `Événement "template.place" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    case 'template.move': {
      if (
        !payload.templateId ||
        typeof payload.templateId !== 'string' ||
        !payload.origin ||
        typeof payload.origin.x !== 'number' ||
        typeof payload.origin.y !== 'number'
      ) {
        console.error('Événement "template.move" refusé : payload malformé');
        return false;
      }
      try {
        store.moveTemplate(payload.templateId, payload.origin, payload.directionDeg);
      } catch (err) {
        console.error(
          `Événement "template.move" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }
    case 'template.clear': {
      if (!payload.levelId || typeof payload.levelId !== 'string') {
        console.error('Événement "template.clear" refusé : payload malformé');
        return false;
      }
      if (!campaign?.levels.some((l) => l.id === payload.levelId)) {
        console.error(`Événement "template.clear" refusé : étage inconnu "${payload.levelId}"`);
        return false;
      }
      try {
        store.clearTemplates(payload.levelId);
      } catch (err) {
        console.error(
          `Événement "template.clear" refusé : ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Snapshot durable remis à Firestore/LocalStorage.
 *
 * @returns {{campaign: import('../core/types.js').Campaign|null, activeLevelId: string|null, selectedTokenId: string|null, activeHandout: import('../core/types.js').Handout|null}}
 */
export function createSnapshotPayload() {
  const state = store.getState();
  return {
    campaign: state.campaign,
    activeLevelId: state.activeLevelId,
    selectedTokenId: state.selectedTokenId,
    activeHandout: state.activeHandout,
  };
}

