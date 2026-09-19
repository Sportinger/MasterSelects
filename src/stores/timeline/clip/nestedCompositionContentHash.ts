import type { CompositionTimelineData } from '../../../types/timeline';
import { MAX_NESTING_DEPTH } from '../constants';

interface CompositionContentSource {
  id: string;
  timelineData?: CompositionTimelineData;
}

function fingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9747b28c;
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x01000193);
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}

/** Source content only: viewport navigation and generated previews cannot change a mixdown. */
export function createNestedContentHash(
  timelineData: CompositionTimelineData | undefined,
  compositions: readonly CompositionContentSource[] = [],
): string {
  if (!timelineData) return '';
  const byId = new Map(compositions.map(composition => [composition.id, composition.timelineData]));
  const localFingerprints = new Map<CompositionTimelineData, string>();

  function localFingerprint(data: CompositionTimelineData): string {
    const existing = localFingerprints.get(data);
    if (existing) return existing;
    const result = fingerprint({
      duration: data.duration,
      masterAudioState: data.masterAudioState,
      tracks: data.tracks.map(track => ({
        id: track.id, type: track.type, muted: track.muted, solo: track.solo,
        visible: track.visible, audioState: track.audioState,
      })),
      clips: data.clips.map(clip => {
        const childId = clip.isComposition ? clip.compositionId : undefined;
        return {
          id: clip.id, trackId: clip.trackId, mediaFileId: clip.mediaFileId,
          sourceType: clip.sourceType, compositionId: childId,
          inPoint: clip.inPoint, outPoint: clip.outPoint, startTime: clip.startTime,
          duration: clip.duration, speed: clip.speed, reversed: clip.reversed,
          preservesPitch: clip.preservesPitch, linkedClipId: clip.linkedClipId,
          followsLinkedVideoSpeed: clip.followsLinkedVideoSpeed,
          transform: clip.transform, effects: clip.effects, keyframes: clip.keyframes,
          audioState: clip.audioState ? {
            sourceAudioRevisionId: clip.audioState.sourceAudioRevisionId,
            editStack: clip.audioState.editStack, effectStack: clip.audioState.effectStack,
            spectralLayers: clip.audioState.spectralLayers,
            stemSeparation: clip.audioState.stemSeparation, muted: clip.audioState.muted,
          } : undefined,
        };
      }),
    });
    localFingerprints.set(data, result);
    return result;
  }

  // Hash each reachable source once, rather than recursively expanding every
  // instance of a shared child (including linked video/audio wrapper pairs).
  // Breadth-first traversal reaches each source at its shallowest depth.
  const pending = [{ data: timelineData, depth: 0 }];
  const visited = new Set<string>();
  const descendants: Array<[string, string]> = [];
  for (let index = 0; index < pending.length; index++) {
    const { data, depth } = pending[index];
    if (depth + 1 >= MAX_NESTING_DEPTH) continue;
    for (const clip of data.clips) {
      const childId = clip.isComposition ? clip.compositionId : undefined;
      if (!childId || visited.has(childId)) continue;
      visited.add(childId);
      const child = byId.get(childId);
      if (!child) continue;
      descendants.push([childId, localFingerprint(child)]);
      pending.push({ data: child, depth: depth + 1 });
    }
  }
  return `nested-v2:${fingerprint({
    root: localFingerprint(timelineData),
    descendants: descendants.toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  })}`;
}

/** Include parents so an inner edit also refreshes more deeply nested instances. */
export function getCompositionContentDependents(
  compositionId: string,
  compositions: readonly CompositionContentSource[],
): ReadonlySet<string> {
  const affected = new Set([compositionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const composition of compositions) {
      if (affected.has(composition.id)) continue;
      if (composition.timelineData?.clips.some(clip =>
        clip.isComposition && clip.compositionId && affected.has(clip.compositionId)
      )) {
        affected.add(composition.id);
        changed = true;
      }
    }
  }
  return affected;
}
