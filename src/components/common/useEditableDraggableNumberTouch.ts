import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import {
  claimEditableValueTouchSession,
  ownsEditableValueTouchSession,
  releaseEditableValueTouchSession,
} from '../../services/input/editableValueTouchSession';

export type TouchDragAxis = 'horizontal' | 'vertical';
export type TouchDragSpeed = 'normal' | 'fast' | 'fine';

export interface TouchValueFeedback {
  axis: TouchDragAxis | null;
  left: number;
  top: number;
  placement: 'above' | 'below';
  speed: TouchDragSpeed;
  value: number;
}

interface UseEditableDraggableNumberTouchOptions {
  value: number;
  disabled: boolean;
  interactionBlocked: boolean;
  onChange: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onSingleTap: () => void;
  onDoubleTap: () => void;
  onLongPress: () => void;
  resolveDraggedValue: (startValue: number, signedDistance: number) => number;
  touchDragAxis: 'auto' | TouchDragAxis;
}

type TouchPoint = {
  clientX: number;
  clientY: number;
};

const TOUCH_DRAG_THRESHOLD_PX = 6;
const TOUCH_FEEDBACK_EDGE_MARGIN_PX = 72;
const TOUCH_DOUBLE_TAP_INTERVAL_MS = 320;
const TOUCH_DOUBLE_TAP_DISTANCE_PX = 36;
const TOUCH_LONG_PRESS_MS = 520;
const FAST_TOUCH_MULTIPLIER = 10;
const FINE_TOUCH_MULTIPLIER = 0.1;

function getSpeed(modifierCount: number): TouchDragSpeed {
  if (modifierCount >= 2) return 'fine';
  if (modifierCount === 1) return 'fast';
  return 'normal';
}

function getSpeedMultiplier(speed: TouchDragSpeed): number {
  if (speed === 'fast') return FAST_TOUCH_MULTIPLIER;
  if (speed === 'fine') return FINE_TOUCH_MULTIPLIER;
  return 1;
}

function getTouchValueFeedback(
  value: number,
  clientX: number,
  clientY: number,
  axis: TouchDragAxis | null,
  speed: TouchDragSpeed,
): TouchValueFeedback {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const left = Math.max(
    TOUCH_FEEDBACK_EDGE_MARGIN_PX,
    Math.min(clientX, viewportWidth - TOUCH_FEEDBACK_EDGE_MARGIN_PX),
  );
  const placement = clientY < 96 ? 'below' : 'above';

  return {
    axis,
    left,
    top: placement === 'above' ? clientY - 48 : clientY + 48,
    placement,
    speed,
    value,
  };
}

function latestPointerSample(event: PointerEvent): PointerEvent {
  const coalesced = event.getCoalescedEvents?.();
  return coalesced?.at(-1) ?? event;
}

export function useEditableDraggableNumberTouch({
  value,
  disabled,
  interactionBlocked,
  onChange,
  onDragStart,
  onDragEnd,
  onSingleTap,
  onDoubleTap,
  onLongPress,
  resolveDraggedValue,
  touchDragAxis: touchDragAxisPreference,
}: UseEditableDraggableNumberTouchOptions) {
  const owner = useRef(Symbol('editable-value-touch'));
  const dragPointerId = useRef<number | null>(null);
  const dragCaptureTarget = useRef<Element | null>(null);
  const dragStartPoint = useRef<TouchPoint>({ clientX: 0, clientY: 0 });
  const dragLastPoint = useRef<TouchPoint>({ clientX: 0, clientY: 0 });
  const touchStartValue = useRef(0);
  const currentValue = useRef(value);
  const accumulatedDistance = useRef(0);
  const touchDragAxis = useRef<TouchDragAxis | null>(null);
  const touchDragStarted = useRef(false);
  const usedModifiers = useRef(false);
  const secondTapCandidate = useRef(false);
  const longPressFired = useRef(false);
  const longPressTimer = useRef<number | null>(null);
  const pendingTap = useRef<{
    completedAt: number;
    point: TouchPoint;
    timerId: number;
  } | null>(null);
  const modifierPointerIds = useRef(new Set<number>());
  const latestFeedback = useRef<TouchValueFeedback | null>(null);
  const feedbackElementRef = useRef<HTMLOutputElement>(null);
  const suppressMouseUntil = useRef(0);
  const callbacks = useRef({
    onChange,
    onDoubleTap,
    onDragEnd,
    onDragStart,
    onLongPress,
    onSingleTap,
    resolveDraggedValue,
  });
  callbacks.current = {
    onChange,
    onDoubleTap,
    onDragEnd,
    onDragStart,
    onLongPress,
    onSingleTap,
    resolveDraggedValue,
  };
  currentValue.current = touchDragStarted.current ? currentValue.current : value;
  const [touchFeedback, setTouchFeedback] = useState<TouchValueFeedback | null>(null);

  const positionFeedbackElement = useCallback((feedback: TouchValueFeedback) => {
    latestFeedback.current = feedback;
    const element = feedbackElementRef.current;
    if (!element) return;
    element.style.left = `${feedback.left}px`;
    element.style.top = `${feedback.top}px`;
  }, []);

  const publishFeedback = useCallback((
    nextValue: number,
    point: TouchPoint,
    axis = touchDragAxis.current,
  ) => {
    const feedback = getTouchValueFeedback(
      nextValue,
      point.clientX,
      point.clientY,
      axis,
      getSpeed(modifierPointerIds.current.size),
    );
    positionFeedbackElement(feedback);
    setTouchFeedback((previous) => previous === null
      ? feedback
      : {
          ...previous,
          axis: feedback.axis,
          placement: feedback.placement,
          speed: feedback.speed,
          value: feedback.value,
        });
  }, [positionFeedbackElement]);

  const releasePointerCapture = useCallback((pointerId: number) => {
    const target = dragCaptureTarget.current;
    if (!(target instanceof Element)) return;
    try {
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture?.(pointerId);
    } catch {
      // Capture may already be gone after a browser-level pointer cancellation.
    }
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }, []);

  const applyTap = useCallback((point: TouchPoint) => {
    if (secondTapCandidate.current) {
      secondTapCandidate.current = false;
      callbacks.current.onDoubleTap();
      return;
    }

    const timerId = window.setTimeout(() => {
      if (pendingTap.current?.timerId !== timerId) return;
      pendingTap.current = null;
      callbacks.current.onSingleTap();
    }, TOUCH_DOUBLE_TAP_INTERVAL_MS);
    pendingTap.current = {
      completedAt: Date.now(),
      point,
      timerId,
    };
  }, []);

  const finishSession = useCallback((allowTap: boolean) => {
    const pointerId = dragPointerId.current;
    if (pointerId !== null) releasePointerCapture(pointerId);
    const wasDragging = touchDragStarted.current;
    const shouldApplyTap = allowTap
      && !wasDragging
      && !usedModifiers.current
      && !longPressFired.current;
    const tapPoint = dragLastPoint.current;

    clearLongPressTimer();
    dragPointerId.current = null;
    dragCaptureTarget.current = null;
    modifierPointerIds.current.clear();
    touchDragAxis.current = null;
    touchDragStarted.current = false;
    usedModifiers.current = false;
    longPressFired.current = false;
    accumulatedDistance.current = 0;
    latestFeedback.current = null;
    suppressMouseUntil.current = Date.now() + 700;
    releaseEditableValueTouchSession(owner.current);
    setTouchFeedback(null);

    if (wasDragging) callbacks.current.onDragEnd?.();
    else if (shouldApplyTap) applyTap(tapPoint);
  }, [applyTap, clearLongPressTimer, releasePointerCapture]);

  const beginDragPointer = useCallback((event: PointerEvent) => {
    dragPointerId.current = event.pointerId;
    dragCaptureTarget.current = event.target instanceof Element ? event.target : null;
    dragStartPoint.current = { clientX: event.clientX, clientY: event.clientY };
    dragLastPoint.current = { clientX: event.clientX, clientY: event.clientY };
    publishFeedback(currentValue.current, dragLastPoint.current);
    try {
      dragCaptureTarget.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Window listeners keep the session continuous without pointer capture.
    }
  }, [publishFeedback]);

  const applyDragPointerMove = useCallback((event: PointerEvent) => {
    if (event.pointerId !== dragPointerId.current) return;
    const sample = latestPointerSample(event);
    const point = { clientX: sample.clientX, clientY: sample.clientY };
    const fromStartX = point.clientX - dragStartPoint.current.clientX;
    const fromStartY = point.clientY - dragStartPoint.current.clientY;
    let axis = touchDragAxis.current;

    if (axis === null) {
      if (Math.max(Math.abs(fromStartX), Math.abs(fromStartY)) < TOUCH_DRAG_THRESHOLD_PX) {
        dragLastPoint.current = point;
        publishFeedback(currentValue.current, point, null);
        return;
      }
      axis = touchDragAxisPreference === 'auto'
        ? Math.abs(fromStartX) >= Math.abs(fromStartY) ? 'horizontal' : 'vertical'
        : touchDragAxisPreference;
      clearLongPressTimer();
      touchDragAxis.current = axis;
      touchDragStarted.current = true;
      callbacks.current.onDragStart?.();
      const initialDistance = axis === 'horizontal' ? fromStartX : -fromStartY;
      accumulatedDistance.current += initialDistance * getSpeedMultiplier(
        getSpeed(modifierPointerIds.current.size),
      );
    } else {
      const deltaX = point.clientX - dragLastPoint.current.clientX;
      const deltaY = point.clientY - dragLastPoint.current.clientY;
      const signedDelta = axis === 'horizontal' ? deltaX : -deltaY;
      accumulatedDistance.current += signedDelta * getSpeedMultiplier(
        getSpeed(modifierPointerIds.current.size),
      );
    }

    dragLastPoint.current = point;
    const nextValue = callbacks.current.resolveDraggedValue(
      touchStartValue.current,
      accumulatedDistance.current,
    );
    currentValue.current = nextValue;
    callbacks.current.onChange(nextValue);
    publishFeedback(nextValue, point, axis);
  }, [clearLongPressTimer, publishFeedback, touchDragAxisPreference]);

  useEffect(() => {
    const stopOwnedEvent = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (
        event.pointerType === 'mouse'
        || !ownsEditableValueTouchSession(owner.current)
        || event.pointerId === dragPointerId.current
        || modifierPointerIds.current.has(event.pointerId)
      ) return;

      stopOwnedEvent(event);
      if (dragPointerId.current === null) {
        beginDragPointer(event);
        return;
      }

      modifierPointerIds.current.add(event.pointerId);
      usedModifiers.current = true;
      clearLongPressTimer();
      publishFeedback(currentValue.current, dragLastPoint.current);
    };

    const handleWindowPointerMove = (event: PointerEvent) => {
      if (!ownsEditableValueTouchSession(owner.current)) return;
      if (
        event.pointerId !== dragPointerId.current
        && !modifierPointerIds.current.has(event.pointerId)
      ) return;
      stopOwnedEvent(event);
      if (event.pointerId === dragPointerId.current) applyDragPointerMove(event);
    };

    const handleWindowPointerFinish = (event: PointerEvent) => {
      if (!ownsEditableValueTouchSession(owner.current)) return;

      if (modifierPointerIds.current.delete(event.pointerId)) {
        stopOwnedEvent(event);
        if (dragPointerId.current === null && modifierPointerIds.current.size === 0) {
          finishSession(false);
        } else {
          publishFeedback(currentValue.current, dragLastPoint.current);
        }
        return;
      }

      if (event.pointerId !== dragPointerId.current) return;
      stopOwnedEvent(event);
      releasePointerCapture(event.pointerId);
      dragPointerId.current = null;
      dragCaptureTarget.current = null;
      if (modifierPointerIds.current.size === 0) {
        finishSession(event.type === 'pointerup');
      }
    };

    const handleRawPointerUpdate = (rawEvent: Event) => {
      const event = rawEvent as PointerEvent;
      if (
        event.pointerId !== dragPointerId.current
        || !ownsEditableValueTouchSession(owner.current)
        || !latestFeedback.current
      ) return;
      const sample = latestPointerSample(event);
      positionFeedbackElement(getTouchValueFeedback(
        currentValue.current,
        sample.clientX,
        sample.clientY,
        touchDragAxis.current,
        getSpeed(modifierPointerIds.current.size),
      ));
    };

    window.addEventListener('pointerdown', handleWindowPointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handleWindowPointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handleWindowPointerFinish, { capture: true, passive: false });
    window.addEventListener('pointercancel', handleWindowPointerFinish, { capture: true, passive: false });
    window.addEventListener('pointerrawupdate', handleRawPointerUpdate, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown, true);
      window.removeEventListener('pointermove', handleWindowPointerMove, true);
      window.removeEventListener('pointerup', handleWindowPointerFinish, true);
      window.removeEventListener('pointercancel', handleWindowPointerFinish, true);
      window.removeEventListener('pointerrawupdate', handleRawPointerUpdate, true);
    };
  }, [applyDragPointerMove, beginDragPointer, clearLongPressTimer, finishSession, positionFeedbackElement, publishFeedback, releasePointerCapture]);

  useEffect(() => () => {
    clearLongPressTimer();
    if (pendingTap.current !== null) window.clearTimeout(pendingTap.current.timerId);
    pendingTap.current = null;
    if (!ownsEditableValueTouchSession(owner.current)) return;
    const wasDragging = touchDragStarted.current;
    releaseEditableValueTouchSession(owner.current);
    if (wasDragging) callbacks.current.onDragEnd?.();
  }, [clearLongPressTimer]);

  const handleTouchPointerDown = useCallback((event: ReactPointerEvent<HTMLSpanElement>) => {
    if (
      event.pointerType === 'mouse'
      || disabled
      || interactionBlocked
      || !claimEditableValueTouchSession(owner.current)
    ) return;

    event.preventDefault();
    event.stopPropagation();
    const point = { clientX: event.clientX, clientY: event.clientY };
    const previousTap = pendingTap.current;
    const canCompleteDoubleTap = previousTap !== null
      && Date.now() - previousTap.completedAt <= TOUCH_DOUBLE_TAP_INTERVAL_MS
      && Math.hypot(
        point.clientX - previousTap.point.clientX,
        point.clientY - previousTap.point.clientY,
      ) <= TOUCH_DOUBLE_TAP_DISTANCE_PX;
    if (canCompleteDoubleTap && previousTap) {
      window.clearTimeout(previousTap.timerId);
      pendingTap.current = null;
    }
    secondTapCandidate.current = canCompleteDoubleTap;
    longPressFired.current = false;
    touchStartValue.current = value;
    currentValue.current = value;
    accumulatedDistance.current = 0;
    touchDragAxis.current = null;
    touchDragStarted.current = false;
    usedModifiers.current = false;
    modifierPointerIds.current.clear();
    beginDragPointer(event.nativeEvent);
    clearLongPressTimer();
    const pointerId = event.pointerId;
    longPressTimer.current = window.setTimeout(() => {
      if (
        dragPointerId.current !== pointerId
        || touchDragStarted.current
        || usedModifiers.current
        || !ownsEditableValueTouchSession(owner.current)
      ) return;
      longPressTimer.current = null;
      longPressFired.current = true;
      secondTapCandidate.current = false;
      finishSession(false);
      callbacks.current.onLongPress();
    }, TOUCH_LONG_PRESS_MS);
  }, [beginDragPointer, clearLongPressTimer, disabled, finishSession, interactionBlocked, value]);

  const shouldSuppressMouse = useCallback(() => Date.now() < suppressMouseUntil.current, []);

  return {
    feedbackElementRef,
    touchFeedback,
    handleTouchPointerDown,
    shouldSuppressMouse,
  };
}
