import { useCallback, useState } from 'react';
import type { AnimatableProperty } from '../../../types/animationProperties';
import type { TimelineClip } from '../../../types/timeline';
import type { TimelineCurveModeController } from './useTimelineCurveMode';
import { useTimelineGraphPanelResize } from './useTimelineGraphPanelResize';

export interface TimelineGraphTarget {
  clipId: string;
  property: AnimatableProperty;
}

interface UseTimelineGraphControllerInput {
  clips: readonly TimelineClip[];
  expandedCurveProperties: ReadonlyMap<string, ReadonlySet<AnimatableProperty>>;
  selectedClipIds: ReadonlySet<string>;
  timelineCurveMode: TimelineCurveModeController['timelineCurveMode'];
  setTimelineCurveMode: TimelineCurveModeController['setTimelineCurveMode'];
  toggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
}

/**
 * Joins every Graph entry point to one focused clip/property target while the
 * timeline store remains the canonical owner of keyframes and row focus.
 */
export function useTimelineGraphController({
  clips,
  expandedCurveProperties,
  selectedClipIds,
  timelineCurveMode,
  setTimelineCurveMode,
  toggleCurveExpanded,
}: UseTimelineGraphControllerInput) {
  const [timelineGraphTarget, setTimelineGraphTarget] = useState<TimelineGraphTarget | null>(null);
  useTimelineGraphPanelResize(timelineCurveMode);

  const openTimelineGraphForProperty = useCallback((
    trackId: string,
    property: AnimatableProperty,
  ) => {
    const selectedClip = clips.find(
      (clip) => clip.trackId === trackId && selectedClipIds.has(clip.id),
    );
    if (selectedClip) {
      setTimelineGraphTarget({ clipId: selectedClip.id, property });
    }
    if (!expandedCurveProperties.get(trackId)?.has(property)) {
      toggleCurveExpanded(trackId, property);
    }
    setTimelineCurveMode('graph');
  }, [
    clips,
    expandedCurveProperties,
    selectedClipIds,
    setTimelineCurveMode,
    toggleCurveExpanded,
  ]);

  const focusTimelineGraphSeries = useCallback((target: TimelineGraphTarget) => {
    const clip = clips.find((candidate) => candidate.id === target.clipId);
    if (!clip) return;
    setTimelineGraphTarget(target);
    if (!expandedCurveProperties.get(clip.trackId)?.has(target.property)) {
      toggleCurveExpanded(clip.trackId, target.property);
    }
    setTimelineCurveMode('graph');
  }, [clips, expandedCurveProperties, setTimelineCurveMode, toggleCurveExpanded]);

  let preferredTimelineGraphTarget: TimelineGraphTarget | null = null;
  if (timelineGraphTarget && selectedClipIds.has(timelineGraphTarget.clipId)) {
    preferredTimelineGraphTarget = timelineGraphTarget;
  } else {
    for (const [trackId, properties] of expandedCurveProperties) {
      const property = properties.values().next().value as AnimatableProperty | undefined;
      if (!property) continue;
      const selectedClip = clips.find(
        (clip) => clip.trackId === trackId && selectedClipIds.has(clip.id),
      );
      if (!selectedClip) continue;
      preferredTimelineGraphTarget = { clipId: selectedClip.id, property };
      break;
    }
  }

  const closeTimelineGraph = useCallback(() => {
    setTimelineCurveMode('timeline');
  }, [setTimelineCurveMode]);

  return {
    closeTimelineGraph,
    focusTimelineGraphSeries,
    openTimelineGraphForProperty,
    preferredTimelineGraphTarget,
  };
}
