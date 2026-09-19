import type { TimelineHeaderProps } from '../types';
import type { TimelineClip } from '../../../types/timeline';

export type TimelineHeaderKeyframe = TimelineHeaderProps['clipKeyframes'] extends Map<string, infer T>
  ? T extends Array<infer K> ? K : never
  : never;

export interface TimelineHeaderPropertySelection {
  clip: TimelineClip | null;
  keyframes: TimelineHeaderKeyframe[];
}

export type TimelineHeaderComponentProps =
  | (TimelineHeaderProps & { propertySelection?: undefined })
  | (Omit<
      TimelineHeaderProps,
      'clipKeyframes' | 'clips' | 'playheadPosition' | 'selectedClipIds'
    > & {
      propertySelection: TimelineHeaderPropertySelection;
      clipKeyframes?: never;
      clips?: never;
      playheadPosition?: never;
      selectedClipIds?: never;
    });

const EMPTY_HEADER_KEYFRAMES = new Map<string, TimelineHeaderKeyframe[]>();

export function resolveTimelineHeaderPropertySelection(
  trackId: string,
  propertySelection: TimelineHeaderPropertySelection | undefined,
  clips: TimelineClip[] | undefined,
  selectedClipIds: Set<string> | undefined,
  clipKeyframes: Map<string, TimelineHeaderKeyframe[]> | undefined,
  playheadPosition: number | undefined,
) {
  if (!propertySelection) {
    return {
      selectedTrackClip: clips?.find((clip) =>
        clip.trackId === trackId && selectedClipIds?.has(clip.id)
      ) ?? null,
      propertyClipKeyframes: clipKeyframes ?? EMPTY_HEADER_KEYFRAMES,
      playheadPositionOverride: playheadPosition,
    };
  }

  return {
    selectedTrackClip: propertySelection.clip,
    propertyClipKeyframes: propertySelection.clip
      ? new Map([[propertySelection.clip.id, propertySelection.keyframes]])
      : EMPTY_HEADER_KEYFRAMES,
    playheadPositionOverride: undefined,
  };
}
