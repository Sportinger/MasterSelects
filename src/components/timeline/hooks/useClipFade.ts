// useClipFade - Fade-in/out handle dragging through timeline edit operations.
// Creates opacity keyframes (video) or volume keyframes (audio) as the user drags.
// Preserves existing bezier handles when adjusting fade duration.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { TimelineClip, TimelineTrack, AnimatableProperty, Keyframe } from '../../../types';
import { createEffectProperty } from '../../../types';
import type {
  ApplyTimelineEditOperationOptions,
  TimelineEditOperation,
  TimelineEditResult,
} from '../../../stores/timeline/editOperations/types';
import type { ClipFadeState } from '../types';

type ApplyTimelineEditOperation = (
  operation: TimelineEditOperation,
  options: ApplyTimelineEditOperationOptions,
) => TimelineEditResult;

interface UseClipFadeProps {
  // Clip and track data
  clipMap: Map<string, TimelineClip>;
  tracks: TimelineTrack[];
  isExporting: boolean;

  // Edit operation actions
  applyTimelineEditOperation: ApplyTimelineEditOperation;
  getClipKeyframes: (clipId: string) => Keyframe[];

  // Audio effect management
  addClipEffect: (clipId: string, effectType: string) => string | null | undefined;

  // Helpers
  pixelToTime: (pixel: number) => number;
}

interface UseClipFadeReturn {
  clipFade: ClipFadeState | null;
  clipFadeRef: React.MutableRefObject<ClipFadeState | null>;
  handleFadeStart: (e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => void;
  getFadeInDuration: (clipId: string) => number;
  getFadeOutDuration: (clipId: string) => number;
}

export function useClipFade({
  clipMap,
  tracks,
  isExporting,
  applyTimelineEditOperation,
  getClipKeyframes,
  addClipEffect,
  pixelToTime,
}: UseClipFadeProps): UseClipFadeReturn {
  const [clipFade, setClipFade] = useState<ClipFadeState | null>(null);
  const clipFadeRef = useRef<ClipFadeState | null>(clipFade);

  useEffect(() => {
    clipFadeRef.current = clipFade;
  }, [clipFade]);

  // Store the keyframe IDs we're working with during a drag.
  const fadeKeyframeIdsRef = useRef<{
    zeroKeyframeId?: string;
    oneKeyframeId?: string;
  }>({});

  const fadeDragSessionRef = useRef<{
    transactionId: string;
    historyBatchId: string;
    updateIndex: number;
    property: AnimatableProperty;
    currentFadeDuration: number;
    hasAppliedUpdate: boolean;
  } | null>(null);

  // Helper to check if clip is on an audio track
  const isAudioClip = useCallback((clipId: string): boolean => {
    const clip = clipMap.get(clipId);
    if (!clip) return false;
    const track = tracks.find(t => t.id === clip.trackId);
    return track?.type === 'audio';
  }, [clipMap, tracks]);

  // Helper to get the fade property for a clip (opacity for video, volume for audio)
  const getFadeProperty = useCallback((clipId: string): AnimatableProperty => {
    const clip = clipMap.get(clipId);
    if (!clip) return 'opacity';

    if (isAudioClip(clipId)) {
      // For audio clips, use the audio-volume effect's volume parameter
      const volumeEffect = clip.effects?.find(e => e.type === 'audio-volume');
      if (volumeEffect) {
        return createEffectProperty(volumeEffect.id, 'volume');
      }
      // If no volume effect exists, we'll need to create one first
      return 'opacity'; // Fallback, but we'll handle this in handleFadeStart
    }

    return 'opacity';
  }, [clipMap, isAudioClip]);

  // Ensure audio clip has a volume effect and return its property
  const ensureAudioVolumeEffect = useCallback((clipId: string): AnimatableProperty => {
    const clip = clipMap.get(clipId);
    if (!clip) return 'opacity';

    if (!isAudioClip(clipId)) return 'opacity';

    const volumeEffect = clip.effects?.find(e => e.type === 'audio-volume');
    if (volumeEffect) {
      return createEffectProperty(volumeEffect.id, 'volume');
    }

    const volumeEffectId = addClipEffect(clipId, 'audio-volume');
    if (volumeEffectId) {
      return createEffectProperty(volumeEffectId, 'volume');
    }

    return 'opacity';
  }, [clipMap, isAudioClip, addClipEffect]);

  const isFadeKeyframeForProperty = useCallback((clipId: string, keyframe: Keyframe, property: AnimatableProperty): boolean => (
    keyframe.property === property || (isAudioClip(clipId) && keyframe.property.includes('.volume'))
  ), [isAudioClip]);

  const refreshFadeKeyframeIds = useCallback((
    clipId: string,
    edge: 'left' | 'right',
    property: AnimatableProperty,
    clipDuration: number,
  ) => {
    const fadeKeyframes = getClipKeyframes(clipId)
      .filter(keyframe => isFadeKeyframeForProperty(clipId, keyframe, property))
      .sort((a, b) => a.time - b.time);

    if (edge === 'left') {
      const zeroKeyframe = fadeKeyframes.find(keyframe => keyframe.time === 0 && keyframe.value === 0);
      const oneKeyframe = fadeKeyframes.find(keyframe => keyframe.value >= 0.99 && keyframe.time > 0 && keyframe.time <= clipDuration * 0.5);
      fadeKeyframeIdsRef.current = {
        zeroKeyframeId: zeroKeyframe?.id,
        oneKeyframeId: oneKeyframe?.id,
      };
      return;
    }

    const zeroKeyframe = fadeKeyframes.find(keyframe => Math.abs(keyframe.time - clipDuration) < 0.01 && keyframe.value === 0);
    const oneKeyframe = fadeKeyframes.find(keyframe => keyframe.value >= 0.99 && keyframe.time > clipDuration * 0.5);
    fadeKeyframeIdsRef.current = {
      zeroKeyframeId: zeroKeyframe?.id,
      oneKeyframeId: oneKeyframe?.id,
    };
  }, [getClipKeyframes, isFadeKeyframeForProperty]);

  const getAudioVolumeEffectId = useCallback((property: AnimatableProperty): string | undefined => {
    const parts = property.split('.');
    return parts[0] === 'effect' && parts[2] === 'volume' ? parts[1] : undefined;
  }, []);

  const buildFadeKeyframePlan = useCallback((
    clipId: string,
    edge: 'left' | 'right',
    property: AnimatableProperty,
    duration: number,
  ) => {
    const session = fadeDragSessionRef.current;
    const { zeroKeyframeId, oneKeyframeId } = fadeKeyframeIdsRef.current;
    const needsCreatedIds = duration > 0.01 && (!zeroKeyframeId || !oneKeyframeId);
    const createdKeyframeIds = needsCreatedIds && session
      ? [`${session.transactionId}:zero`, `${session.transactionId}:one`]
      : [];

    return {
      clipId,
      property,
      edge,
      duration,
      zeroKeyframeId,
      oneKeyframeId,
      createdKeyframeIds,
      movedKeyframeIds: duration > 0.01
        ? [zeroKeyframeId, oneKeyframeId].filter((keyframeId): keyframeId is string => Boolean(keyframeId))
        : [],
      removedKeyframeIds: duration <= 0.01
        ? [zeroKeyframeId, oneKeyframeId].filter((keyframeId): keyframeId is string => Boolean(keyframeId))
        : [],
      audioVolumeEffectId: isAudioClip(clipId) ? getAudioVolumeEffectId(property) : undefined,
    };
  }, [getAudioVolumeEffectId, isAudioClip]);

  const resolveFadeDuration = useCallback((fade: ClipFadeState, clientX: number): number => {
    const deltaX = clientX - fade.startX;
    const deltaTime = pixelToTime(Math.abs(deltaX));
    const requestedFadeDuration = fade.edge === 'left'
      ? fade.originalFadeDuration + (deltaX > 0 ? deltaTime : -deltaTime)
      : fade.originalFadeDuration + (deltaX < 0 ? deltaTime : -deltaTime);
    return Math.max(0, Math.min(requestedFadeDuration, fade.clipDuration * 0.5));
  }, [pixelToTime]);

  // Calculate fade-in duration from keyframes (opacity for video, volume for audio)
  const getFadeInDuration = useCallback((clipId: string): number => {
    const keyframes = getClipKeyframes(clipId);
    const fadeProperty = getFadeProperty(clipId);

    const fadeKeyframes = keyframes
      .filter(k => k.property === fadeProperty || (isAudioClip(clipId) && k.property.includes('.volume')))
      .sort((a, b) => a.time - b.time);

    if (fadeKeyframes.length < 2) return 0;

    // Fade-in: First keyframe should be at time 0 with value 0,
    // and we look for the next keyframe with value 1
    const firstKf = fadeKeyframes[0];
    if (firstKf.time !== 0 || firstKf.value !== 0) return 0;

    // Find the first keyframe with value 1 (or near 1)
    for (const kf of fadeKeyframes) {
      if (kf.value >= 0.99 && kf.time > 0) {
        return kf.time;
      }
    }

    return 0;
  }, [getClipKeyframes, getFadeProperty, isAudioClip]);

  // Calculate fade-out duration from keyframes (opacity for video, volume for audio)
  const getFadeOutDuration = useCallback((clipId: string): number => {
    const clip = clipMap.get(clipId);
    if (!clip) return 0;

    const keyframes = getClipKeyframes(clipId);
    const fadeProperty = getFadeProperty(clipId);

    const fadeKeyframes = keyframes
      .filter(k => k.property === fadeProperty || (isAudioClip(clipId) && k.property.includes('.volume')))
      .sort((a, b) => a.time - b.time);

    if (fadeKeyframes.length < 2) return 0;

    // Fade-out: Last keyframe should be at clip.duration with value 0,
    // and we look for the previous keyframe with value 1
    const lastKf = fadeKeyframes[fadeKeyframes.length - 1];
    const tolerance = 0.01; // 10ms tolerance for floating point
    if (Math.abs(lastKf.time - clip.duration) > tolerance || lastKf.value !== 0) return 0;

    // Find the last keyframe with value 1 (before the final 0)
    for (let i = fadeKeyframes.length - 2; i >= 0; i--) {
      const kf = fadeKeyframes[i];
      if (kf.value >= 0.99) {
        return clip.duration - kf.time;
      }
    }

    return 0;
  }, [clipMap, getClipKeyframes, getFadeProperty, isAudioClip]);

  const handleFadeStart = useCallback(
    (e: React.MouseEvent, clipId: string, edge: 'left' | 'right') => {
      e.stopPropagation();
      e.preventDefault();
      if (isExporting) return;

      const clip = clipMap.get(clipId);
      if (!clip) return;
      if (tracks.find(track => track.id === clip.trackId)?.locked) return;

      // For audio clips, ensure the volume effect exists
      const fadeProperty = isAudioClip(clipId)
        ? ensureAudioVolumeEffect(clipId)
        : 'opacity' as AnimatableProperty;

      // Get existing fade duration
      const originalFadeDuration = edge === 'left'
        ? getFadeInDuration(clipId)
        : getFadeOutDuration(clipId);

      // Find existing keyframes for this fade
      const keyframes = getClipKeyframes(clipId);
      const fadeKeyframes = keyframes
        .filter(k => k.property === fadeProperty || (isAudioClip(clipId) && k.property.includes('.volume')))
        .sort((a, b) => a.time - b.time);

      // Reset keyframe IDs for this drag session
      fadeKeyframeIdsRef.current = {};

      if (edge === 'left') {
        // Fade-in: Look for keyframe at 0 (value 0) and next one (value 1)
        const startKf = fadeKeyframes.find(k => k.time === 0 && k.value === 0);
        const endKf = fadeKeyframes.find(k => k.value >= 0.99 && k.time > 0 && k.time < clip.duration * 0.5);

        if (startKf && endKf) {
          fadeKeyframeIdsRef.current.zeroKeyframeId = startKf.id;
          fadeKeyframeIdsRef.current.oneKeyframeId = endKf.id;
        }
      } else {
        // Fade-out: Look for keyframe at end (value 0) and previous one (value 1)
        const endKf = fadeKeyframes.find(k => Math.abs(k.time - clip.duration) < 0.01 && k.value === 0);
        const startKf = fadeKeyframes.find(k => k.value >= 0.99 && k.time > clip.duration * 0.5);

        if (startKf && endKf) {
          fadeKeyframeIdsRef.current.oneKeyframeId = startKf.id;
          fadeKeyframeIdsRef.current.zeroKeyframeId = endKf.id;
        }
      }

      const transactionId = `fade:${clipId}:${edge}:${Date.now()}`;
      const historyBatchId = `${transactionId}:history`;
      fadeDragSessionRef.current = {
        transactionId,
        historyBatchId,
        updateIndex: 0,
        property: fadeProperty,
        currentFadeDuration: originalFadeDuration,
        hasAppliedUpdate: false,
      };
      applyTimelineEditOperation({
        id: `${transactionId}:begin`,
        type: 'fade-transaction-begin',
        transactionId,
        historyBatchId,
        source: 'ui',
        phase: 'begin',
        clipId,
        edge,
        originalFadeDuration,
        clipDuration: clip.duration,
        property: fadeProperty,
      }, { source: 'ui', historyLabel: 'Begin fade transaction' });

      const initialFade: ClipFadeState = {
        clipId,
        edge,
        startX: e.clientX,
        currentX: e.clientX,
        clipDuration: clip.duration,
        originalFadeDuration,
      };
      setClipFade(initialFade);
      clipFadeRef.current = initialFade;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const fade = clipFadeRef.current;
        if (!fade) return;

        const currentClip = clipMap.get(fade.clipId);
        if (!currentClip) return;

        // Determine the property to use for this fade (opacity for video, volume for audio)
        const session = fadeDragSessionRef.current;
        const currentFadeProperty = session?.property ?? (isAudioClip(fade.clipId)
          ? ensureAudioVolumeEffect(fade.clipId)
          : 'opacity' as AnimatableProperty);
        const newFadeDuration = resolveFadeDuration(
          { ...fade, clipDuration: currentClip.duration },
          moveEvent.clientX,
        );

        if (session) {
          const updateIndex = session.updateIndex;
          session.updateIndex += 1;
          session.currentFadeDuration = newFadeDuration;
          const result = applyTimelineEditOperation({
            id: `${session.transactionId}:update:${updateIndex}`,
            type: 'fade-transaction-update',
            transactionId: session.transactionId,
            historyBatchId: session.historyBatchId,
            source: 'ui',
            phase: 'update',
            clipId: fade.clipId,
            edge: fade.edge,
            requestedFadeDuration: newFadeDuration,
            resolvedFadeDuration: newFadeDuration,
            keyframePlan: buildFadeKeyframePlan(
              fade.clipId,
              fade.edge,
              currentFadeProperty,
              newFadeDuration,
            ),
          }, { source: 'ui', historyLabel: 'Update fade transaction', deferHistoryCommit: true });
          if (result.success) {
            session.hasAppliedUpdate = true;
            refreshFadeKeyframeIds(fade.clipId, fade.edge, currentFadeProperty, currentClip.duration);
          }
        }

        // Now update local state to trigger re-render with the fresh keyframe data
        const updated = {
          ...fade,
          currentX: moveEvent.clientX,
        };
        setClipFade(updated);
        clipFadeRef.current = updated;
      };

      const handleMouseUp = () => {
        const fade = clipFadeRef.current;
        const session = fadeDragSessionRef.current;
        if (fade && session?.hasAppliedUpdate) {
          const currentClip = clipMap.get(fade.clipId);
          if (currentClip) {
            applyTimelineEditOperation({
              id: `${session.transactionId}:commit`,
              type: 'fade-transaction-commit',
              transactionId: session.transactionId,
              historyBatchId: session.historyBatchId,
              source: 'ui',
              phase: 'commit',
              clipId: fade.clipId,
              edge: fade.edge,
              finalFadeDuration: session.currentFadeDuration,
              keyframePlan: buildFadeKeyframePlan(
                fade.clipId,
                fade.edge,
                session.property,
                session.currentFadeDuration,
              ),
            }, { source: 'ui', historyLabel: 'Edit clip fade' });
            refreshFadeKeyframeIds(fade.clipId, fade.edge, session.property, currentClip.duration);
          }
        }
        setClipFade(null);
        clipFadeRef.current = null;
        fadeKeyframeIdsRef.current = {};
        fadeDragSessionRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [
      clipMap,
      tracks,
      isExporting,
      getFadeInDuration,
      getFadeOutDuration,
      getClipKeyframes,
      applyTimelineEditOperation,
      isAudioClip,
      ensureAudioVolumeEffect,
      resolveFadeDuration,
      buildFadeKeyframePlan,
      refreshFadeKeyframeIds,
    ]
  );

  return {
    clipFade,
    clipFadeRef,
    handleFadeStart,
    getFadeInDuration,
    getFadeOutDuration,
  };
}
