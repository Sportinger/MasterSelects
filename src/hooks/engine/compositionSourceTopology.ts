import type { TimelineClip } from '../../types/timeline';

function hasDifferentRuntimeSource(
  previous: TimelineClip,
  next: TimelineClip,
): boolean {
  const previousSource = previous.source;
  const nextSource = next.source;

  return previousSource?.type !== nextSource?.type
    || previousSource?.mediaFileId !== nextSource?.mediaFileId
    || previousSource?.runtimeSourceId !== nextSource?.runtimeSourceId
    || previousSource?.runtimeSessionKey !== nextSource?.runtimeSessionKey
    || previousSource?.videoElement !== nextSource?.videoElement
    || previousSource?.imageElement !== nextSource?.imageElement
    || previousSource?.textCanvas !== nextSource?.textCanvas
    || previousSource?.webCodecsPlayer !== nextSource?.webCodecsPlayer;
}

/**
 * Detect changes that require CompositionRenderer to bind a different set of
 * runtime sources. Ordinary transforms, effects and keyframes intentionally
 * stay on the cheap live-evaluation path.
 */
export function hasCompositionSourceTopologyChanged(
  previousClips: readonly TimelineClip[],
  nextClips: readonly TimelineClip[],
): boolean {
  if (previousClips.length !== nextClips.length) return true;

  const nextClipById = new Map(nextClips.map((clip) => [clip.id, clip]));
  for (const previous of previousClips) {
    const next = nextClipById.get(previous.id);
    if (!next) return true;
    if (
      previous.isComposition !== next.isComposition
      || previous.compositionId !== next.compositionId
      || hasDifferentRuntimeSource(previous, next)
    ) {
      return true;
    }
  }

  return false;
}
