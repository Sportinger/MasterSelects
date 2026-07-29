import type { TimelineClip } from '../../../stores/timeline/types';
import { collectNestedVideoClips } from './nestedVideoClips';

export function getExportSourceKey(clip: TimelineClip): string {
  return (
    clip.mediaFileId ||
    clip.source?.mediaFileId ||
    clip.source?.runtimeSourceId ||
    clip.source?.filePath ||
    clip.id
  );
}

/**
 * Sources can share one seekable export decoder only when the regular clips
 * never need two source frames at the same timeline instant. Transitions and
 * nested uses remain isolated because they can introduce hidden concurrency.
 */
export function collectShareableRegularVideoSourceKeys(
  videoClips: readonly TimelineClip[],
): Set<string> {
  const regularClipsBySource = new Map<string, TimelineClip[]>();
  const nestedSourceKeys = new Set<string>();

  for (const clip of videoClips) {
    if (clip.isComposition) {
      for (const { clip: nestedClip } of collectNestedVideoClips(clip)) {
        if (nestedClip.source?.type === 'video') {
          nestedSourceKeys.add(getExportSourceKey(nestedClip));
        }
      }
      continue;
    }
    if (clip.source?.type !== 'video') continue;

    const key = getExportSourceKey(clip);
    const sourceClips = regularClipsBySource.get(key) ?? [];
    sourceClips.push(clip);
    regularClipsBySource.set(key, sourceClips);
  }

  const shareable = new Set<string>();
  for (const [key, sourceClips] of regularClipsBySource) {
    if (nestedSourceKeys.has(key)) continue;
    if (sourceClips.some(clip => clip.transitionIn || clip.transitionOut)) continue;

    const sorted = [...sourceClips].sort((a, b) =>
      a.startTime - b.startTime || a.duration - b.duration
    );
    let previousEnd = Number.NEGATIVE_INFINITY;
    let overlaps = false;
    for (const clip of sorted) {
      if (clip.startTime < previousEnd - 1e-6) {
        overlaps = true;
        break;
      }
      previousEnd = Math.max(previousEnd, clip.startTime + clip.duration);
    }

    if (!overlaps) {
      shareable.add(key);
    }
  }

  return shareable;
}

export function countFastSequentialVideoDecoders(
  videoClips: readonly TimelineClip[],
): number {
  const shareableSourceKeys = collectShareableRegularVideoSourceKeys(videoClips);
  const countedSharedSources = new Set<string>();
  const nestedClipIds = new Set<string>();
  let decoderCount = 0;

  for (const clip of videoClips) {
    if (clip.isComposition) {
      for (const { clip: nestedClip } of collectNestedVideoClips(clip)) {
        nestedClipIds.add(nestedClip.id);
      }
      continue;
    }
    if (clip.source?.type !== 'video') continue;

    const key = getExportSourceKey(clip);
    if (shareableSourceKeys.has(key)) {
      if (countedSharedSources.has(key)) continue;
      countedSharedSources.add(key);
    }
    decoderCount += 1;
  }

  // Nested composition clips cannot share the sequential decoder path. FAST
  // export registers each nested clip with its own parallel decoder.
  return decoderCount + nestedClipIds.size;
}
