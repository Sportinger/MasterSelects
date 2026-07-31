import type { JsonObject, TimelineVariantScope } from '../contracts';
import { normalizeTimelineVariantScope } from './scope';
import type {
  VariantCapturedClip,
  VariantClipRangeRelation,
  VariantClipSegment,
  VariantLinkedExpansionPolicy,
  VariantRangeSnapshot,
  VariantSourceClip,
  VariantTimelineSourceSnapshot,
} from './types';

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function clonePayload(payload: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(payload)) as JsonObject;
}

function intersects(clip: VariantSourceClip, startTime: number, endTime: number): boolean {
  return clip.startTime < endTime && clip.endTime > startTime;
}

function segment(
  clip: VariantSourceClip,
  startTime: number,
  endTime: number,
): VariantClipSegment {
  const sourceStartSeconds = clip.sourceStartSeconds === undefined
    ? undefined
    : clip.sourceStartSeconds + Math.max(0, startTime - clip.startTime);
  return {
    clipId: clip.id,
    sourceClipId: clip.sourceClipId ?? clip.id,
    trackId: clip.trackId,
    startTime,
    endTime,
    ...(sourceStartSeconds === undefined ? {} : { sourceStartSeconds }),
    payload: clonePayload(clip.payload),
  };
}

function relationFor(
  clip: VariantSourceClip,
  scope: TimelineVariantScope,
): VariantClipRangeRelation {
  const crossesStart = clip.startTime < scope.startTime;
  const crossesEnd = clip.endTime > scope.endTime;
  if (crossesStart && crossesEnd) return 'covers-range';
  if (crossesStart) return 'crosses-start';
  if (crossesEnd) return 'crosses-end';
  return 'inside';
}

function captureClip(
  clip: VariantSourceClip,
  scope: TimelineVariantScope,
  linkedExpansion: boolean,
): VariantCapturedClip {
  const insideStart = Math.max(clip.startTime, scope.startTime);
  const insideEnd = Math.min(clip.endTime, scope.endTime);
  return {
    clipId: clip.id,
    sourceClipId: clip.sourceClipId ?? clip.id,
    trackId: clip.trackId,
    relation: relationFor(clip, scope),
    inside: segment(clip, insideStart, insideEnd),
    ...(clip.startTime < scope.startTime
      ? { beforeRange: segment(clip, clip.startTime, scope.startTime) }
      : {}),
    ...(clip.endTime > scope.endTime
      ? { afterRange: segment(clip, scope.endTime, clip.endTime) }
      : {}),
    linkedExpansion,
  };
}

function validateSource(
  source: VariantTimelineSourceSnapshot,
  scope: TimelineVariantScope,
): void {
  if (source.schemaVersion !== 1) throw new Error('Unsupported range snapshot schemaVersion.');
  if (!source.compositionId.trim()) throw new Error('compositionId is required.');
  finiteNonNegative(source.boundaryPaddingSeconds, 'boundaryPaddingSeconds');
  const trackIds = new Set<string>();
  for (const track of source.tracks) {
    if (!track.id.trim() || trackIds.has(track.id)) throw new Error('Track ids must be unique.');
    trackIds.add(track.id);
  }
  for (const trackId of scope.trackIds) {
    if (!trackIds.has(trackId)) throw new Error(`Scope references missing track ${trackId}.`);
  }
  const clipIds = new Set<string>();
  for (const clip of source.clips) {
    if (!clip.id.trim() || clipIds.has(clip.id)) throw new Error('Clip ids must be unique.');
    clipIds.add(clip.id);
    if (!trackIds.has(clip.trackId)) throw new Error(`Clip ${clip.id} references a missing track.`);
    finiteNonNegative(clip.startTime, `clip ${clip.id} startTime`);
    finiteNonNegative(clip.endTime, `clip ${clip.id} endTime`);
    if (clip.endTime <= clip.startTime) throw new Error(`Clip ${clip.id} has no duration.`);
  }
}

function collectLinkedExpansion(
  clipsById: Map<string, VariantSourceClip>,
  seedIds: Set<string>,
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const clip of clipsById.values()) {
    const neighbors = adjacency.get(clip.id) ?? new Set<string>();
    adjacency.set(clip.id, neighbors);
    for (const linkedId of clip.linkedClipIds) {
      if (!clipsById.has(linkedId)) continue;
      neighbors.add(linkedId);
      const reverse = adjacency.get(linkedId) ?? new Set<string>();
      reverse.add(clip.id);
      adjacency.set(linkedId, reverse);
    }
  }
  const expanded = new Set<string>();
  const queue = [...seedIds];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    for (const linkedId of adjacency.get(currentId) ?? []) {
      if (visited.has(linkedId)) continue;
      visited.add(linkedId);
      expanded.add(linkedId);
      queue.push(linkedId);
    }
  }
  for (const seedId of seedIds) expanded.delete(seedId);
  return expanded;
}

export function captureVariantRangeSnapshot(
  source: VariantTimelineSourceSnapshot,
): VariantRangeSnapshot {
  const scope = normalizeTimelineVariantScope(source.scope);
  validateSource(source, scope);
  const selectedTrackIds = new Set(scope.trackIds);
  const clipsById = new Map(source.clips.map((clip) => [clip.id, clip]));
  const directlyCapturedIds = new Set(
    source.clips
      .filter((clip) => selectedTrackIds.has(clip.trackId) && intersects(
        clip,
        scope.startTime,
        scope.endTime,
      ))
      .map((clip) => clip.id),
  );
  const linkedExpansionPolicy: VariantLinkedExpansionPolicy = scope.includeLinked
    ? 'linked-clips'
    : 'none';
  const linkedExpansionIds = scope.includeLinked
    ? collectLinkedExpansion(clipsById, directlyCapturedIds)
    : new Set<string>();
  const capturedClips = source.clips
    .filter((clip) => (
      (directlyCapturedIds.has(clip.id) || linkedExpansionIds.has(clip.id))
      && intersects(clip, scope.startTime, scope.endTime)
    ))
    .map((clip) => captureClip(clip, scope, linkedExpansionIds.has(clip.id)))
    .toSorted((left, right) => (
      left.trackId.localeCompare(right.trackId)
      || left.inside.startTime - right.inside.startTime
      || left.sourceClipId.localeCompare(right.sourceClipId)
    ));
  const linkedExpansionClipIds = capturedClips
    .filter((clip) => clip.linkedExpansion)
    .map((clip) => clip.clipId)
    .sort();
  const linkedExpansionTrackIds = [...new Set(
    capturedClips
      .filter((clip) => clip.linkedExpansion && !selectedTrackIds.has(clip.trackId))
      .map((clip) => clip.trackId),
  )].sort();

  return {
    schemaVersion: 1,
    compositionId: source.compositionId,
    scope,
    boundaryPaddingSeconds: finiteNonNegative(
      source.boundaryPaddingSeconds,
      'boundaryPaddingSeconds',
    ),
    linkedExpansionPolicy,
    linkedExpansionClipIds,
    linkedExpansionTrackIds,
    capturedClips,
    source: {
      schemaVersion: 1,
      compositionId: source.compositionId,
      scope,
      boundaryPaddingSeconds: source.boundaryPaddingSeconds,
      tracks: source.tracks.map((track) => ({
        ...track,
        payload: clonePayload(track.payload),
      })),
      clips: source.clips.map((clip) => ({
        ...clip,
        linkedClipIds: [...clip.linkedClipIds],
        payload: clonePayload(clip.payload),
      })),
      transitions: source.transitions.map((transition) => ({
        ...transition,
        payload: clonePayload(transition.payload),
      })),
      globalState: clonePayload(source.globalState),
    },
  };
}
