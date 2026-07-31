import type { JsonValue, StoryboardFingerprint } from '../contracts';
import type {
  VariantBoundaryFingerprintInput,
  VariantFingerprintClipSegment,
  VariantFingerprintInputs,
  VariantFingerprintTransition,
  VariantOutsideFingerprintInput,
  VariantRangeSnapshot,
  VariantScopeFingerprintInput,
  VariantSnapshotFingerprints,
  VariantSourceClip,
  VariantSourceTransition,
} from './types';

type FingerprintZone = 'scope' | 'boundary' | 'outside';

interface ZonedClipSegment {
  zone: FingerprintZone;
  segment: VariantFingerprintClipSegment;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) output[key] = canonicalize(entry);
    }
    return output;
  }
  return value;
}

export function stableStringifyVariantFingerprintInput(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

function intersects(start: number, end: number, zoneStart: number, zoneEnd: number): boolean {
  return start < zoneEnd && end > zoneStart;
}

function projectedSegment(
  clip: VariantSourceClip,
  startTime: number,
  endTime: number,
): VariantFingerprintClipSegment {
  const sourceStartSeconds = clip.sourceStartSeconds === undefined
    ? undefined
    : clip.sourceStartSeconds + Math.max(0, startTime - clip.startTime);
  return {
    sourceClipId: clip.sourceClipId ?? clip.id,
    trackId: clip.trackId,
    startTime,
    endTime,
    ...(sourceStartSeconds === undefined ? {} : { sourceStartSeconds }),
    payload: clip.payload,
  };
}

function splitAllowedClip(snapshot: VariantRangeSnapshot, clip: VariantSourceClip): ZonedClipSegment[] {
  const { startTime, endTime } = snapshot.scope;
  const boundaryStart = Math.max(0, startTime - snapshot.boundaryPaddingSeconds);
  const boundaryEnd = endTime + snapshot.boundaryPaddingSeconds;
  const boundaries = [
    { zone: 'outside' as const, start: clip.startTime, end: Math.min(clip.endTime, boundaryStart) },
    { zone: 'boundary' as const, start: Math.max(clip.startTime, boundaryStart), end: Math.min(clip.endTime, startTime) },
    { zone: 'scope' as const, start: Math.max(clip.startTime, startTime), end: Math.min(clip.endTime, endTime) },
    { zone: 'boundary' as const, start: Math.max(clip.startTime, endTime), end: Math.min(clip.endTime, boundaryEnd) },
    { zone: 'outside' as const, start: Math.max(clip.startTime, boundaryEnd), end: clip.endTime },
  ];
  return boundaries
    .filter((entry) => entry.end > entry.start)
    .map((entry) => ({
      zone: entry.zone,
      segment: projectedSegment(clip, entry.start, entry.end),
    }));
}

function compareSegments(
  left: VariantFingerprintClipSegment,
  right: VariantFingerprintClipSegment,
): number {
  return left.trackId.localeCompare(right.trackId)
    || left.startTime - right.startTime
    || left.endTime - right.endTime
    || left.sourceClipId.localeCompare(right.sourceClipId);
}

function transitionProjection(
  transition: VariantSourceTransition,
  sourceIdsByClipId: Map<string, string>,
): VariantFingerprintTransition {
  return {
    id: transition.id,
    trackId: transition.trackId,
    time: transition.time,
    ...(transition.fromClipId === undefined
      ? {}
      : {
          fromSourceClipId: sourceIdsByClipId.get(transition.fromClipId)
            ?? transition.fromClipId,
        }),
    ...(transition.toClipId === undefined
      ? {}
      : {
          toSourceClipId: sourceIdsByClipId.get(transition.toClipId)
            ?? transition.toClipId,
        }),
    payload: transition.payload,
  };
}

function compareTransitions(
  left: VariantFingerprintTransition,
  right: VariantFingerprintTransition,
): number {
  return left.trackId.localeCompare(right.trackId)
    || left.time - right.time
    || left.id.localeCompare(right.id);
}

export function createVariantFingerprintInputs(
  snapshot: VariantRangeSnapshot,
): VariantFingerprintInputs {
  const selectedTrackIds = new Set(snapshot.scope.trackIds);
  const linkedClipIds = new Set(snapshot.linkedExpansionClipIds);
  const sourceIdsByClipId = new Map(
    snapshot.source.clips.map((clip) => [clip.id, clip.sourceClipId ?? clip.id]),
  );
  const zones: Record<FingerprintZone, VariantFingerprintClipSegment[]> = {
    scope: [],
    boundary: [],
    outside: [],
  };

  for (const clip of snapshot.source.clips) {
    const allowed = selectedTrackIds.has(clip.trackId) || linkedClipIds.has(clip.id);
    if (!allowed) {
      zones.outside.push(projectedSegment(clip, clip.startTime, clip.endTime));
      continue;
    }
    for (const entry of splitAllowedClip(snapshot, clip)) {
      zones[entry.zone].push(entry.segment);
    }
  }
  zones.scope.sort(compareSegments);
  zones.boundary.sort(compareSegments);
  zones.outside.sort(compareSegments);

  const transitionZones: Record<FingerprintZone, VariantFingerprintTransition[]> = {
    scope: [],
    boundary: [],
    outside: [],
  };
  const boundaryStart = Math.max(0, snapshot.scope.startTime - snapshot.boundaryPaddingSeconds);
  const boundaryEnd = snapshot.scope.endTime + snapshot.boundaryPaddingSeconds;
  for (const transition of snapshot.source.transitions) {
    const linkedTransition = (
      (transition.fromClipId !== undefined && linkedClipIds.has(transition.fromClipId))
      || (transition.toClipId !== undefined && linkedClipIds.has(transition.toClipId))
    );
    const allowed = selectedTrackIds.has(transition.trackId) || linkedTransition;
    const projected = transitionProjection(transition, sourceIdsByClipId);
    const zone: FingerprintZone = !allowed
      ? 'outside'
      : transition.time >= snapshot.scope.startTime && transition.time <= snapshot.scope.endTime
        ? 'scope'
        : transition.time >= boundaryStart && transition.time <= boundaryEnd
          ? 'boundary'
          : 'outside';
    transitionZones[zone].push(projected);
  }
  transitionZones.scope.sort(compareTransitions);
  transitionZones.boundary.sort(compareTransitions);
  transitionZones.outside.sort(compareTransitions);

  const scope: VariantScopeFingerprintInput = {
    schemaVersion: 1,
    kind: 'scope',
    compositionId: snapshot.compositionId,
    scope: snapshot.scope,
    linkedExpansionPolicy: snapshot.linkedExpansionPolicy,
    linkedExpansionClipIds: [...snapshot.linkedExpansionClipIds].sort(),
    clipSegments: zones.scope,
    transitions: transitionZones.scope,
  };
  const boundary: VariantBoundaryFingerprintInput = {
    schemaVersion: 1,
    kind: 'boundary',
    compositionId: snapshot.compositionId,
    scope: snapshot.scope,
    boundaryPaddingSeconds: snapshot.boundaryPaddingSeconds,
    clipSegments: zones.boundary,
    transitions: transitionZones.boundary,
  };
  const outside: VariantOutsideFingerprintInput = {
    schemaVersion: 1,
    kind: 'outside',
    compositionId: snapshot.compositionId,
    scope: snapshot.scope,
    boundaryPaddingSeconds: snapshot.boundaryPaddingSeconds,
    tracks: snapshot.source.tracks
      .map((track) => ({ ...track }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    clipSegments: zones.outside,
    transitions: transitionZones.outside,
    globalState: snapshot.source.globalState,
  };
  return { scope, boundary, outside };
}

async function hashJson(value: JsonValue): Promise<StoryboardFingerprint> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('SHA-256 is unavailable in this runtime.');
  }
  const payload = stableStringifyVariantFingerprintInput(value);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return {
    schemaVersion: 1,
    algorithm: 'sha-256',
    value: Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  };
}

export async function fingerprintVariantRangeSnapshot(
  snapshot: VariantRangeSnapshot,
): Promise<VariantSnapshotFingerprints> {
  const inputs = createVariantFingerprintInputs(snapshot);
  const [scope, boundary, outside] = await Promise.all([
    hashJson(inputs.scope as unknown as JsonValue),
    hashJson(inputs.boundary as unknown as JsonValue),
    hashJson(inputs.outside as unknown as JsonValue),
  ]);
  return { scope, boundary, outside };
}

export function clipIntersectsVariantScope(
  clip: VariantSourceClip,
  snapshot: VariantRangeSnapshot,
): boolean {
  return intersects(
    clip.startTime,
    clip.endTime,
    snapshot.scope.startTime,
    snapshot.scope.endTime,
  );
}
