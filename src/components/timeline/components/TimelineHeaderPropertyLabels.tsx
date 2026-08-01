import { useEffect, useMemo } from 'react';
import {
  createEffectProperty,
  type AnimatableProperty,
} from '../../../types/animationProperties';
import type { ClipTransform } from '../../../types/timelineCore';
import { useTimelineStore } from '../../../stores/timeline';
import { TimelineHeaderPropertyRow } from './TimelineHeaderPropertyRow';
import {
  shouldHide3DOnlyProperties,
  sortTimelineHeaderProperties,
  type KeyframeTrackClip,
} from '../utils/timelineHeaderPropertyModel';

export function TimelineHeaderPropertyLabels({
  addKeyframe,
  clipKeyframes,
  expandedCurveProperties,
  getInterpolatedEffects,
  getInterpolatedTransform,
  hoveredKeyframeRow,
  isAudioTrack,
  onKeyframeRowHover,
  onToggleCurveExpanded,
  playheadPosition,
  selectedClip,
  setPlayheadPosition,
  setPropertyValue,
  trackId,
}: {
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  hoveredKeyframeRow?: { trackId: string; property: AnimatableProperty } | null;
  isAudioTrack: boolean;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
  onToggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  playheadPosition: number;
  selectedClip: KeyframeTrackClip | null;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  trackId: string;
}) {
  const clipId = selectedClip?.id;
  const keyframes = useMemo(
    () => (clipId ? clipKeyframes.get(clipId) || [] : []),
    [clipId, clipKeyframes],
  );

  useEffect(() => {
    if (!isAudioTrack || !selectedClip || !keyframes.some((keyframe) => keyframe.property === 'opacity')) {
      return;
    }

    const store = useTimelineStore.getState();
    const currentClip = store.clips.find((clip) => clip.id === selectedClip.id);
    if (!currentClip) return;
    const currentTrack = store.tracks.find((track) => track.id === currentClip.trackId);
    if (currentTrack?.type !== 'audio') return;

    const volumeEffectId = currentClip.effects?.find((effect) => effect.type === 'audio-volume')?.id
      ?? store.addClipEffect(currentClip.id, 'audio-volume');
    if (!volumeEffectId) return;

    const volumeProperty = createEffectProperty(volumeEffectId, 'volume');
    const currentKeyframes = store.clipKeyframes.get(currentClip.id) ?? [];
    currentKeyframes
      .filter((keyframe) => keyframe.property === 'opacity')
      .forEach((keyframe) => {
        const hasVolumeKeyframeAtTime = currentKeyframes.some((candidate) =>
          candidate.property === volumeProperty &&
          Math.abs(candidate.time - keyframe.time) < 0.01
        );

        if (hasVolumeKeyframeAtTime) {
          store.removeKeyframe(keyframe.id);
          return;
        }

        store.updateKeyframe(keyframe.id, { property: volumeProperty });
      });
  }, [isAudioTrack, keyframes, selectedClip]);

  const keyframeProperties = useMemo(() => {
    const props = new Set<string>();
    keyframes.forEach((kf) => props.add(kf.property));
    if (shouldHide3DOnlyProperties(selectedClip)) {
      props.delete('rotation.x');
      props.delete('rotation.y');
      props.delete('position.z');
      props.delete('scale.z');
    }
    return props;
  }, [keyframes, selectedClip]);

  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-labels" />;
  }

  const sortedProperties = sortTimelineHeaderProperties(keyframeProperties, selectedClip);
  const trackCurveProps = expandedCurveProperties.get(trackId);

  return (
    <div className="track-property-labels">
      {sortedProperties.map((prop) => {
        const isCurveExpanded = trackCurveProps?.has(prop as AnimatableProperty) ?? false;
        const isKeyframeRowHovered =
          hoveredKeyframeRow?.trackId === trackId &&
          hoveredKeyframeRow.property === prop;
        return (
          <TimelineHeaderPropertyRow
            key={prop}
            prop={prop}
            clipId={selectedClip.id}
            trackId={trackId}
            clip={selectedClip}
            isAudioTrack={isAudioTrack}
            keyframes={keyframes}
            playheadPosition={playheadPosition}
            getInterpolatedTransform={getInterpolatedTransform}
            getInterpolatedEffects={getInterpolatedEffects}
            addKeyframe={addKeyframe}
            setPlayheadPosition={setPlayheadPosition}
            setPropertyValue={setPropertyValue}
            isCurveExpanded={isCurveExpanded}
            isKeyframeRowHovered={isKeyframeRowHovered}
            onToggleCurveExpanded={() => onToggleCurveExpanded(trackId, prop as AnimatableProperty)}
            onKeyframeRowHover={onKeyframeRowHover}
          />
        );
      })}
    </div>
  );
}
