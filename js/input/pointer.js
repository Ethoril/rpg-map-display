// @ts-check

import { DRAG_HOLD_MS } from '../core/constants.js';
import { distanceBetween, centerBetween, isDragThresholdExceeded } from './gestures.js';

/** @typedef {import('../core/types.js').ScreenPoint} ScreenPoint */
/** @typedef {import('../core/types.js').MapPoint} MapPoint */
/** @typedef {import('./gestures.js').InputIntention} InputIntention */

/**
 * Interface minimale de la caméra attendue par la couche d'input.
 * Permet d'éviter d'importer camera.js dans input/ (règle d'architecture).
 *
 * @typedef {Object} InputCamera
 * @property {(screenPoint: ScreenPoint) => MapPoint} screenToMap
 */

/**
 * Options de configuration du gestionnaire d'input.
 *
 * @typedef {Object} PointerInputOptions
 * @property {'players'|'gm'} [role='players'] Rôle du client ('players' pour vue joueurs, 'gm' pour vue MJ)
 * @property {(intention: InputIntention) => void} [onIntention] Callback recevant les intentions émises
 * @property {number} [dragHoldMs=DRAG_HOLD_MS] Seuil temporel de drag (ms)
 * @property {number} [dragDistanceThreshold=5] Seuil spatial de drag (pixels)
 * @property {number} [longPressMs=500] Seuil pour l'appui long (ms)
 */

/**
 * Couche d'abstraction d'input (Pointeur & Gestes).
 * Écoute les événements DOM et les traduit en intentions abstraites sans connaître le store.
 */
export class PointerInput {
  /**
   * @param {HTMLElement} element Élément DOM à écouter (ex: canvas)
   * @param {InputCamera} camera Instance de caméra pour les conversions de coordonnées
   * @param {PointerInputOptions} [options={}]
   */
  constructor(element, camera, options = {}) {
    this.element = element;
    this.camera = camera;
    this.role = options.role ?? 'players';
    this.onIntention = options.onIntention ?? (() => {});
    this.dragHoldMs = options.dragHoldMs ?? DRAG_HOLD_MS;
    this.dragDistanceThreshold = options.dragDistanceThreshold ?? 5;
    this.longPressMs = options.longPressMs ?? 500;

    /** @type {Map<number, { screenPos: ScreenPoint, timeStamp: number }>} */
    this.activePointers = new Map();

    /** @type {ScreenPoint | null} */
    this.startScreenPos = null;
    /** @type {ScreenPoint | null} */
    this.lastScreenPos = null;
    /** @type {number} */
    this.startTime = 0;

    /** @type {ReturnType<typeof setTimeout> | null} */
    this.longPressTimer = null;
    /** @type {boolean} */
    this.longPressTriggered = false;

    /** @type {boolean} */
    this.isDraggingToken = false;
    /** @type {boolean} */
    this.isPanning = false;
    /** @type {boolean} */
    this.isPinching = false;

    /** @type {number} */
    this.initialPinchDistance = 0;
    /** @type {ScreenPoint | null} */
    this.lastPinchCenter = null;

    // Coalescence via rAF pour le pan
    /** @type {number} */
    this.pendingPanX = 0;
    /** @type {number} */
    this.pendingPanY = 0;
    /** @type {number | null} */
    this.rafId = null;

    // Handlers reliés avec `this` lié
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.flushCoalescedPan = this.flushCoalescedPan.bind(this);

    this.attach();
  }

  /**
   * Modifie le rôle courant (vue joueurs ou vue MJ).
   * @param {'players'|'gm'} role
   */
  setRole(role) {
    this.role = role;
  }

  /**
   * Attache les écouteurs d'événements DOM à l'élément.
   */
  attach() {
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);
    this.element.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  /**
   * Détache les écouteurs et nettoie les timers/rAF.
   */
  detach() {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('wheel', this.handleWheel);

    this.clearLongPressTimer();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Convertit un événement pointer/mouse en ScreenPoint relatif à l'élément.
   *
   * @param {PointerEvent | WheelEvent | MouseEvent} e
   * @returns {ScreenPoint}
   */
  getScreenPoint(e) {
    const rect = this.element.getBoundingClientRect();
    return {
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
    };
  }

  /**
   * Annule le timer d'appui long.
   */
  clearLongPressTimer() {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * Émet immédiatement une intention.
   * @param {InputIntention} intention
   */
  emit(intention) {
    this.onIntention(intention);
  }

  /**
   * Accumule le delta de pan et planifie la livraison coalescée sur la rAF suivante.
   * @param {number} dx
   * @param {number} dy
   */
  queuePan(dx, dy) {
    this.pendingPanX += dx;
    this.pendingPanY += dy;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.flushCoalescedPan);
    }
  }

  /**
   * Vide la file de pan accumulée en émettant une seule intention panBy.
   */
  flushCoalescedPan() {
    this.rafId = null;
    if (this.pendingPanX !== 0 || this.pendingPanY !== 0) {
      const deltaX = this.pendingPanX;
      const deltaY = this.pendingPanY;
      this.pendingPanX = 0;
      this.pendingPanY = 0;
      this.emit({ type: 'panBy', deltaX, deltaY });
    }
  }

  /**
   * Gestionnaire d'événement pointerdown.
   * @param {PointerEvent} e
   */
  handlePointerDown(e) {
    const screenPos = this.getScreenPoint(e);
    const timeStamp = performance.now();

    this.activePointers.set(e.pointerId, { screenPos, timeStamp });

    if (this.activePointers.size === 1) {
      this.startScreenPos = screenPos;
      this.lastScreenPos = screenPos;
      this.startTime = timeStamp;
      this.isDraggingToken = false;
      this.isPanning = false;
      this.isPinching = false;
      this.longPressTriggered = false;

      // Planification du timer d'appui long
      this.clearLongPressTimer();
      this.longPressTimer = setTimeout(() => {
        if (this.activePointers.size === 1 && this.startScreenPos) {
          this.longPressTriggered = true;
          const mapPos = this.camera.screenToMap(this.startScreenPos);
          this.emit({
            type: 'longPress',
            screenPos: this.startScreenPos,
            mapPos,
          });
        }
      }, this.longPressMs);
    } else if (this.activePointers.size === 2) {
      // Annulation d'appui long et bascule en mode pinch/pan à 2 doigts
      this.clearLongPressTimer();
      this.isPinching = true;

      const pointers = Array.from(this.activePointers.values());
      const p1 = pointers[0].screenPos;
      const p2 = pointers[1].screenPos;

      this.initialPinchDistance = distanceBetween(p1, p2);
      this.lastPinchCenter = centerBetween(p1, p2);
    }
  }

  /**
   * Gestionnaire d'événement pointermove.
   * @param {PointerEvent} e
   */
  handlePointerMove(e) {
    if (!this.activePointers.has(e.pointerId)) return;

    const screenPos = this.getScreenPoint(e);
    const timeStamp = performance.now();
    this.activePointers.set(e.pointerId, { screenPos, timeStamp });

    if (this.activePointers.size === 1 && this.startScreenPos && this.lastScreenPos) {
      const distFromStart = distanceBetween(this.startScreenPos, screenPos);

      // Si mouvement significatif, annuler le long press
      if (distFromStart >= this.dragDistanceThreshold) {
        this.clearLongPressTimer();
      }

      if (this.longPressTriggered) return;

      const dx = screenPos.screenX - this.lastScreenPos.screenX;
      const dy = screenPos.screenY - this.lastScreenPos.screenY;
      this.lastScreenPos = screenPos;

      if (this.role === 'players') {
        // Vue joueurs — interdiction #1 : drag à 1 doigt = pan de la carte (panBy), jamais drag pion
        this.isPanning = true;
        this.queuePan(dx, dy);
      } else {
        // Vue MJ — interdiction #9 : drag pion autorisé au-delà du seuil DRAG_HOLD_MS / distance
        const isExceeded = isDragThresholdExceeded(
          this.startScreenPos,
          screenPos,
          this.startTime,
          timeStamp,
          this.dragHoldMs,
          this.dragDistanceThreshold
        );

        if (isExceeded || this.isDraggingToken) {
          const isFirstDrag = !this.isDraggingToken;
          this.isDraggingToken = true;

          const mapPos = this.camera.screenToMap(screenPos);
          this.emit({
            type: 'dragToken',
            screenPos,
            mapPos,
            phase: isFirstDrag ? 'start' : 'move',
          });
        }
      }
    } else if (this.activePointers.size === 2 && this.lastPinchCenter) {
      this.clearLongPressTimer();

      const pointers = Array.from(this.activePointers.values());
      const p1 = pointers[0].screenPos;
      const p2 = pointers[1].screenPos;

      const newDistance = distanceBetween(p1, p2);
      const newCenter = centerBetween(p1, p2);

      if (this.initialPinchDistance > 0 && newDistance > 0) {
        const scaleFactor = newDistance / this.initialPinchDistance;
        if (Math.abs(scaleFactor - 1.0) > 0.001) {
          this.emit({
            type: 'pinchZoom',
            scaleFactor,
            center: newCenter,
          });
          this.initialPinchDistance = newDistance;
        }
      }

      const panDx = newCenter.screenX - this.lastPinchCenter.screenX;
      const panDy = newCenter.screenY - this.lastPinchCenter.screenY;
      if (panDx !== 0 || panDy !== 0) {
        this.queuePan(panDx, panDy);
        this.lastPinchCenter = newCenter;
      }
    }
  }

  /**
   * Gestionnaire d'événement pointerup.
   * @param {PointerEvent} e
   */
  handlePointerUp(e) {
    if (!this.activePointers.has(e.pointerId)) return;

    const screenPos = this.getScreenPoint(e);
    const timeStamp = performance.now();

    this.clearLongPressTimer();

    if (this.activePointers.size === 1 && this.startScreenPos) {
      // Vider tout pan coalescé en attente
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.flushCoalescedPan();
      }

      const dist = distanceBetween(this.startScreenPos, screenPos);
      const duration = timeStamp - this.startTime;

      if (this.role === 'gm' && this.isDraggingToken) {
        const mapPos = this.camera.screenToMap(screenPos);
        this.emit({
          type: 'dragToken',
          screenPos,
          mapPos,
          phase: 'end',
        });
      } else if (!this.longPressTriggered && !this.isPanning && duration < this.dragHoldMs && dist < this.dragDistanceThreshold) {
        // C'est un TAP !
        const mapPos = this.camera.screenToMap(this.startScreenPos);
        this.emit({ type: 'tapCell', at: mapPos });
        this.emit({ type: 'tapToken', at: this.startScreenPos });
      }
    }

    this.activePointers.delete(e.pointerId);

    if (this.activePointers.size === 0) {
      this.startScreenPos = null;
      this.lastScreenPos = null;
      this.isDraggingToken = false;
      this.isPanning = false;
      this.isPinching = false;
      this.lastPinchCenter = null;
    }
  }

  /**
   * Gestionnaire d'événement pointercancel.
   * @param {PointerEvent} e
   */
  handlePointerCancel(e) {
    this.clearLongPressTimer();
    this.activePointers.delete(e.pointerId);

    if (this.activePointers.size === 0) {
      this.startScreenPos = null;
      this.lastScreenPos = null;
      this.isDraggingToken = false;
      this.isPanning = false;
      this.isPinching = false;
      this.lastPinchCenter = null;
    }
  }

  /**
   * Gestionnaire d'événement wheel (molette de souris pour zoom).
   * @param {WheelEvent} e
   */
  handleWheel(e) {
    e.preventDefault();
    const center = this.getScreenPoint(e);
    const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
    this.emit({
      type: 'pinchZoom',
      scaleFactor,
      center,
    });
  }
}
