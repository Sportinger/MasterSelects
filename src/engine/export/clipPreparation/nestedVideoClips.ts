import { MAX_NESTING_DEPTH } from '../../../stores/timeline/constants';
import type { TimelineClip } from '../../../stores/timeline/types';

export interface NestedVideoClip {
  clip: TimelineClip;
  parentClip: TimelineClip;
  mainTimelineStart: number;
  mainTimelineDuration: number;
}

export interface NestedVideoExportRange {
  startTime: number;
  endTime: number;
  hasAnimatedSpeed?: (clip: TimelineClip) => boolean;
}

type TimeWindow = { start: number; end: number };

// Only prune when the composition-to-parent mapping is unambiguous. Retimed
// compositions and transition handles may visit source times outside their
// ordinary trim window; retain those descendants rather than guessing bounds.
function canPruneComposition(clip: TimelineClip, range: NestedVideoExportRange): boolean {
  const inlineKeyframes = (clip as TimelineClip & {
    keyframes?: readonly { property: string }[];
  }).keyframes;
  return (clip.speed ?? 1) === 1 && !clip.reversed &&
    !clip.transitionSourceMap && !clip.transitionSourceHold &&
    !Number.isFinite(clip.transitionSourceTimeOverride) &&
    !clip.transitionIn && !clip.transitionOut &&
    !inlineKeyframes?.some((keyframe) => keyframe.property === 'speed') &&
    !range.hasAnimatedSpeed?.(clip);
}

function intersectWindow(a: TimeWindow, b: TimeWindow): TimeWindow | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  // Keep a boundary neighbour when repeated frame/source conversions differ
  // only by floating-point rounding. This never changes rendered clip timing.
  return end < start - 1e-9 ? null : { start, end: Math.max(start, end) };
}

export function collectNestedVideoClips(
  compositionClip: TimelineClip,
  exportRange?: NestedVideoExportRange,
): NestedVideoClip[] {
  if (!compositionClip.isComposition) return [];

  const nestedVideoClips: NestedVideoClip[] = [];
  const collectedClipIds = new Set<string>();
  const getCompositionMapping = (
    clip: TimelineClip,
    parentMainAtSourceZero: number,
    parentMainSecondsPerSourceSecond: number,
  ): { mainAtSourceZero: number; mainSecondsPerSourceSecond: number } => {
    const rawSpeed = clip.speed ?? 1;
    const speed = Math.max(0.0001, Math.abs(rawSpeed));
    const reversed = Boolean(clip.reversed) !== (rawSpeed < 0);
    const sourceAnchor = reversed ? clip.outPoint : clip.inPoint;
    const direction = reversed ? -1 : 1;
    return {
      mainAtSourceZero:
        parentMainAtSourceZero +
        parentMainSecondsPerSourceSecond *
          (clip.startTime - (direction * sourceAnchor) / speed),
      mainSecondsPerSourceSecond:
        parentMainSecondsPerSourceSecond * direction / speed,
    };
  };
  const collect = (
    parentClip: TimelineClip,
    mainAtSourceZero: number,
    mainSecondsPerSourceSecond: number,
    depth: number,
    visibleWindow: TimeWindow | undefined,
  ): void => {
    if (depth >= MAX_NESTING_DEPTH || !parentClip.nestedClips) return;

    // A nested composition is represented by a visual clip and a linked audio
    // clip. Both carry composition data, but only the instance on a visible
    // video track belongs in the video decoder tree. Traversing the audio twin
    // duplicates every descendant decoder under an "(Audio)" namespace.
    const nestedVideoTrackIds = parentClip.nestedTracks
      ? new Set(
        parentClip.nestedTracks
          .filter((track) => track.type === 'video' && track.visible !== false)
          .map((track) => track.id),
      )
      : null;
    // Transition planning only requires the outgoing link. The incoming clip
    // need not carry transitionIn, and may be sampled before its own start.
    const incomingTransitionIds = new Set(parentClip.nestedClips.flatMap((clip) =>
      clip.transitionOut ? [clip.transitionOut.linkedClipId] : [],
    ));

    for (const clip of parentClip.nestedClips) {
      if (nestedVideoTrackIds && !nestedVideoTrackIds.has(clip.trackId)) {
        continue;
      }
      const mappedStart = mainAtSourceZero + mainSecondsPerSourceSecond * clip.startTime;
      const mappedEnd = mainAtSourceZero +
        mainSecondsPerSourceSecond * (clip.startTime + clip.duration);
      const clipWindow = { start: Math.min(mappedStart, mappedEnd), end: Math.max(mappedStart, mappedEnd) };
      const isTransitionParticipant = !!clip.transitionIn || !!clip.transitionOut || incomingTransitionIds.has(clip.id);
      const activeWindow = visibleWindow && !isTransitionParticipant
        ? intersectWindow(visibleWindow, clipWindow)
        : visibleWindow;
      if (activeWindow === null) continue;
      if (clip.isComposition) {
        if (clip.source?.type === 'audio') continue;
        const childMapping = getCompositionMapping(
          clip,
          mainAtSourceZero,
          mainSecondsPerSourceSecond,
        );
        collect(
          clip,
          childMapping.mainAtSourceZero,
          childMapping.mainSecondsPerSourceSecond,
          depth + 1,
          exportRange && !isTransitionParticipant && canPruneComposition(clip, exportRange)
            ? activeWindow : undefined,
        );
      } else if (clip.source?.type === 'video' && !collectedClipIds.has(clip.id)) {
        collectedClipIds.add(clip.id);
        nestedVideoClips.push({
          clip,
          parentClip,
          mainTimelineStart: Math.min(mappedStart, mappedEnd),
          mainTimelineDuration: Math.abs(mappedEnd - mappedStart),
        });
      }
    }
  };

  const rootMapping = getCompositionMapping(compositionClip, 0, 1);
  const rootWindow = exportRange && !compositionClip.transitionIn && !compositionClip.transitionOut
    ? intersectWindow(
      { start: exportRange.startTime, end: exportRange.endTime },
      { start: compositionClip.startTime, end: compositionClip.startTime + compositionClip.duration },
    )
    : undefined;
  if (rootWindow === null) return [];
  collect(
    compositionClip,
    rootMapping.mainAtSourceZero,
    rootMapping.mainSecondsPerSourceSecond,
    0,
    exportRange && canPruneComposition(compositionClip, exportRange) ? rootWindow : undefined,
  );
  return nestedVideoClips;
}
