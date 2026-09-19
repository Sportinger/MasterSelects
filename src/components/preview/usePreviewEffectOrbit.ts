import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type React from 'react';

import { getEffect } from '../../effects';
import type { EffectCameraInteraction, EffectParam } from '../../effects/types';
import { useEngineStore } from '../../stores/engineStore';
import { endBatch, startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import {
  resolvePreviewEffectOrbitDollyDistance,
  resolvePreviewEffectOrbitDragAngles,
} from './previewEffectOrbitMath';
import {
  getPreviewPinchTranslation,
  isPreviewPinchWheelEvent,
} from './usePreviewPinchZoom';

interface PreviewSize {
  width: number;
  height: number;
}

interface ActiveOrbitTarget {
  clipId: string;
  effectId: string;
  interaction: EffectCameraInteraction;
  params: Record<string, EffectParam>;
  values: Record<string, unknown>;
}

interface DragState {
  target: ActiveOrbitTarget;
  mode: 'orbit' | 'pan';
  x: number;
  y: number;
  yaw: number;
  tilt: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

interface WheelState {
  clipId: string;
  effectId: string;
  paramName: string;
  current: number;
  target: number;
}

interface UsePreviewEffectOrbitOptions {
  selectedClipId: string | null;
  editMode: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  canvasSize: PreviewSize;
}

type PreviewWheelEvent = WheelEvent | React.WheelEvent;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function getNumberParam(target: ActiveOrbitTarget, paramName: string): number {
  const value = target.values[paramName];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const fallback = target.params[paramName]?.default;
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0;
}

function getParamBounds(param: EffectParam | undefined): { min: number; max: number } {
  return {
    min: typeof param?.min === 'number' ? param.min : Number.NEGATIVE_INFINITY,
    max: typeof param?.max === 'number' ? param.max : Number.POSITIVE_INFINITY,
  };
}

export function usePreviewEffectOrbit({
  selectedClipId,
  editMode,
  canvasRef,
  canvasSize,
}: UsePreviewEffectOrbitOptions) {
  const effectOrbitTarget = useEngineStore((state) => state.effectOrbitTarget);
  const targetClip = useTimelineStore((state) => (
    effectOrbitTarget ? state.clips.find((clip) => clip.id === effectOrbitTarget.clipId) : undefined
  ));
  const [isDragging, setIsDragging] = useState(false);
  const eligibilityRef = useRef({ selectedClipId, editMode });
  const dragRef = useRef<DragState | null>(null);
  const wheelRef = useRef<WheelState | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const wheelAnimationStepRef = useRef<() => void>(() => undefined);
  const wheelTimerRef = useRef<number | null>(null);
  const dragBatchOpenRef = useRef(false);
  const wheelBatchOpenRef = useRef(false);

  useEffect(() => {
    eligibilityRef.current = { selectedClipId, editMode };
  }, [editMode, selectedClipId]);

  const activeTarget = useMemo<ActiveOrbitTarget | null>(() => {
    if (!effectOrbitTarget || editMode || selectedClipId !== effectOrbitTarget.clipId) return null;
    if (!targetClip || targetClip.is3D) return null;
    const effect = targetClip.effects.find((candidate) => candidate.id === effectOrbitTarget.effectId);
    if (!effect?.enabled) return null;
    const definition = getEffect(effect.type);
    if (!definition || !('cameraInteraction' in definition) || !definition.cameraInteraction) return null;
    return {
      clipId: targetClip.id,
      effectId: effect.id,
      interaction: definition.cameraInteraction,
      params: definition.params,
      values: effect.params,
    };
  }, [editMode, effectOrbitTarget, selectedClipId, targetClip]);
  const orbitActive = activeTarget !== null;

  const resolveFreshTarget = useCallback((): ActiveOrbitTarget | null => {
    const eligibility = eligibilityRef.current;
    const target = useEngineStore.getState().effectOrbitTarget;
    if (!target || eligibility.editMode || eligibility.selectedClipId !== target.clipId) return null;
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === target.clipId);
    if (!clip || clip.is3D) return null;
    const effect = clip.effects.find((candidate) => candidate.id === target.effectId);
    if (!effect?.enabled) return null;
    const definition = getEffect(effect.type);
    if (!definition || !('cameraInteraction' in definition) || !definition.cameraInteraction) return null;
    return {
      clipId: clip.id,
      effectId: effect.id,
      interaction: definition.cameraInteraction,
      params: definition.params,
      values: effect.params,
    };
  }, []);

  const writeParam = useCallback((clipId: string, effectId: string, paramName: string, value: number) => {
    useTimelineStore.getState().setPropertyValue(clipId, `effect.${effectId}.${paramName}`, value);
  }, []);

  const finishDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
    if (dragBatchOpenRef.current) {
      dragBatchOpenRef.current = false;
      endBatch();
    }
  }, []);

  const finishWheel = useCallback((writeTarget: boolean) => {
    if (wheelTimerRef.current !== null) {
      window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = null;
    }
    if (wheelFrameRef.current !== null) {
      window.cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = null;
    }
    const wheel = wheelRef.current;
    if (writeTarget && wheel && Math.abs(wheel.target - wheel.current) > 0) {
      wheel.current = wheel.target;
      writeParam(wheel.clipId, wheel.effectId, wheel.paramName, wheel.target);
    }
    wheelRef.current = null;
    if (wheelBatchOpenRef.current) {
      wheelBatchOpenRef.current = false;
      endBatch();
    }
  }, [writeParam]);

  const animateWheel = useCallback(() => {
    wheelFrameRef.current = null;
    const wheel = wheelRef.current;
    const fresh = resolveFreshTarget();
    if (!wheel || !fresh || fresh.clipId !== wheel.clipId || fresh.effectId !== wheel.effectId) {
      finishWheel(false);
      return;
    }
    const difference = wheel.target - wheel.current;
    if (Math.abs(difference) < 0.001) {
      wheel.current = wheel.target;
      writeParam(wheel.clipId, wheel.effectId, wheel.paramName, wheel.target);
      return;
    }
    wheel.current += difference * 0.25;
    writeParam(wheel.clipId, wheel.effectId, wheel.paramName, wheel.current);
    wheelFrameRef.current = window.requestAnimationFrame(() => wheelAnimationStepRef.current());
  }, [finishWheel, resolveFreshTarget, writeParam]);

  useEffect(() => {
    wheelAnimationStepRef.current = animateWheel;
  }, [animateWheel]);

  const beginOrbitDrag = useCallback((event: React.MouseEvent, mode: 'orbit' | 'pan') => {
    const target = resolveFreshTarget();
    if (!target) return;
    const { centerXParam, centerYParam, tiltParam, yawParam } = target.interaction;
    if (mode === 'pan' && (!centerXParam || !centerYParam)) return;
    finishWheel(true);
    const rect = canvasRef.current?.getBoundingClientRect();
    dragRef.current = {
      target,
      mode,
      x: event.clientX,
      y: event.clientY,
      yaw: getNumberParam(target, yawParam),
      tilt: getNumberParam(target, tiltParam),
      centerX: centerXParam ? getNumberParam(target, centerXParam) : 0.5,
      centerY: centerYParam ? getNumberParam(target, centerYParam) : 0.5,
      width: Math.max(1, rect?.width ?? canvasSize.width),
      height: Math.max(1, rect?.height ?? canvasSize.height),
    };
    dragBatchOpenRef.current = startBatch(mode === 'pan' ? 'Pan effect camera' : 'Orbit effect camera').opened;
    setIsDragging(true);
  }, [canvasRef, canvasSize.height, canvasSize.width, finishWheel, resolveFreshTarget]);

  const handleWheel = useCallback((event: PreviewWheelEvent): boolean => {
    const target = resolveFreshTarget();
    if (!target) return false;
    const isPinch = isPreviewPinchWheelEvent(event as WheelEvent);
    const paramName = target.interaction.distanceParam;
    const bounds = getParamBounds(target.params[paramName]);
    const existing = wheelRef.current;
    const current = existing?.clipId === target.clipId && existing.effectId === target.effectId
      ? existing.current
      : getNumberParam(target, paramName);
    const previousTarget = existing?.clipId === target.clipId && existing.effectId === target.effectId
      ? existing.target
      : current;
    wheelRef.current = {
      clipId: target.clipId,
      effectId: target.effectId,
      paramName,
      current,
      target: clamp(resolvePreviewEffectOrbitDollyDistance(previousTarget, event.deltaY), bounds.min, bounds.max),
    };
    if (!wheelBatchOpenRef.current) {
      wheelBatchOpenRef.current = startBatch(isPinch ? 'Navigate effect camera' : 'Zoom effect camera').opened;
    }
    if (isPinch) {
      const { centerXParam, centerYParam } = target.interaction;
      const translation = getPreviewPinchTranslation(event as WheelEvent);
      if (
        centerXParam
        && centerYParam
        && (Math.abs(translation.x) > Number.EPSILON || Math.abs(translation.y) > Number.EPSILON)
      ) {
        const rect = canvasRef.current?.getBoundingClientRect();
        const width = Math.max(1, rect?.width ?? canvasSize.width);
        const height = Math.max(1, rect?.height ?? canvasSize.height);
        writeParam(
          target.clipId,
          target.effectId,
          centerXParam,
          clamp(getNumberParam(target, centerXParam) - translation.x / width, 0, 1),
        );
        writeParam(
          target.clipId,
          target.effectId,
          centerYParam,
          clamp(getNumberParam(target, centerYParam) - translation.y / height, 0, 1),
        );
      }
    }
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = window.setTimeout(() => {
      wheelTimerRef.current = null;
      finishWheel(true);
    }, 180);
    if (wheelFrameRef.current === null) {
      wheelFrameRef.current = window.requestAnimationFrame(animateWheel);
    }
    return true;
  }, [animateWheel, canvasRef, canvasSize.height, canvasSize.width, finishWheel, resolveFreshTarget, writeParam]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      const fresh = resolveFreshTarget();
      if (!drag || !fresh || fresh.clipId !== drag.target.clipId || fresh.effectId !== drag.target.effectId) {
        finishDrag();
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (drag.mode === 'orbit') {
        const tiltBounds = getParamBounds(drag.target.params[drag.target.interaction.tiltParam]);
        const yawBounds = getParamBounds(drag.target.params[drag.target.interaction.yawParam]);
        const orbitAngles = resolvePreviewEffectOrbitDragAngles(drag.yaw, drag.tilt, dx, dy);
        const yawValue = orbitAngles.yaw;
        writeParam(drag.target.clipId, drag.target.effectId, drag.target.interaction.yawParam,
          drag.target.interaction.yawWrap ? wrapDegrees(yawValue) : clamp(yawValue, yawBounds.min, yawBounds.max));
        const tiltValue = orbitAngles.tilt;
        writeParam(drag.target.clipId, drag.target.effectId, drag.target.interaction.tiltParam,
          drag.target.interaction.tiltWrap ? wrapDegrees(tiltValue) : clamp(tiltValue, tiltBounds.min, tiltBounds.max));
      } else {
        const { centerXParam, centerYParam } = drag.target.interaction;
        if (!centerXParam || !centerYParam) return;
        writeParam(drag.target.clipId, drag.target.effectId, centerXParam, clamp(drag.centerX - dx / drag.width, 0, 1));
        writeParam(drag.target.clipId, drag.target.effectId, centerYParam, clamp(drag.centerY - dy / drag.height, 0, 1));
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', finishDrag);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishDrag);
    };
  }, [finishDrag, isDragging, resolveFreshTarget, writeParam]);

  useEffect(() => {
    if (orbitActive) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      finishDrag();
      finishWheel(false);
    });
    return () => { cancelled = true; };
  }, [finishDrag, finishWheel, orbitActive]);

  useEffect(() => () => {
    finishDrag();
    finishWheel(false);
  }, [finishDrag, finishWheel]);

  return {
    orbitActive,
    beginOrbitDrag,
    handleWheel,
    cursor: isDragging ? 'grabbing' : 'grab',
  } as const;
}
