import type { Composition } from '../../../stores/mediaStore/types';
import type {
  SerializableClip,
  TimelineTrack,
} from '../../../types/timeline';
import type {
  JsonObject,
  TimelineVariantScope,
} from '../contracts';
import type {
  VariantSourceTransition,
  VariantTimelineSourceSnapshot,
} from './types';

export interface CreateVariantCompositionSourceInput {
  composition: Composition;
  scope: TimelineVariantScope;
  boundaryPaddingSeconds?: number;
  sourceClipIdentityByClipId?: Readonly<Record<string, string>>;
}

function jsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function clipPayload(clip: SerializableClip): JsonObject {
  const payload = structuredClone(clip) as unknown as Record<string, unknown>;
  delete payload.id;
  delete payload.trackId;
  delete payload.startTime;
  delete payload.duration;
  delete payload.inPoint;
  delete payload.outPoint;
  delete payload.linkedClipId;
  delete payload.transitionIn;
  delete payload.transitionOut;
  return jsonObject(payload);
}

function trackPayload(track: TimelineTrack): JsonObject {
  const payload = structuredClone(track) as unknown as Record<string, unknown>;
  delete payload.id;
  delete payload.type;
  return jsonObject(payload);
}

function transitionEntries(
  clips: readonly SerializableClip[],
): VariantSourceTransition[] {
  const entries = new Map<string, VariantSourceTransition>();
  for (const clip of clips) {
    const candidates = [
      clip.transitionIn
        ? { transition: clip.transitionIn, time: clip.startTime }
        : undefined,
      clip.transitionOut
        ? { transition: clip.transitionOut, time: clip.startTime + clip.duration }
        : undefined,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const existing = entries.get(candidate.transition.id);
      const linkedClip = clips.find(
        (entry) => entry.id === candidate.transition.linkedClipId,
      );
      const fromClipId = clip.transitionOut === candidate.transition
        ? clip.id
        : linkedClip?.id;
      const toClipId = clip.transitionIn === candidate.transition
        ? clip.id
        : linkedClip?.id;
      entries.set(candidate.transition.id, existing ?? {
        id: candidate.transition.id,
        trackId: clip.trackId,
        time: candidate.time,
        ...(fromClipId ? { fromClipId } : {}),
        ...(toClipId ? { toClipId } : {}),
        payload: jsonObject(candidate.transition),
      });
    }
  }
  return [...entries.values()].toSorted((left, right) => (
    left.time - right.time || left.id.localeCompare(right.id)
  ));
}

export function createVariantTimelineSourceFromComposition(
  input: CreateVariantCompositionSourceInput,
): VariantTimelineSourceSnapshot {
  const timeline = input.composition.timelineData;
  if (!timeline) {
    throw new Error(`Composition ${input.composition.id} has no timeline data.`);
  }
  const supportedTrackIds = new Set(
    timeline.tracks
      .filter((track) => track.type === 'video' || track.type === 'audio')
      .map((track) => track.id),
  );
  const clips = timeline.clips.filter((clip) => supportedTrackIds.has(clip.trackId));
  const unsupportedTrackIds = new Set(
    timeline.tracks
      .filter((track) => !supportedTrackIds.has(track.id))
      .map((track) => track.id),
  );

  return {
    schemaVersion: 1,
    compositionId: input.composition.id,
    scope: structuredClone(input.scope),
    boundaryPaddingSeconds: input.boundaryPaddingSeconds ?? 1,
    tracks: timeline.tracks
      .filter((track): track is TimelineTrack & { type: 'video' | 'audio' } => (
        track.type === 'video' || track.type === 'audio'
      ))
      .map((track) => ({
        id: track.id,
        kind: track.type,
        payload: trackPayload(track),
      })),
    clips: clips.map((clip) => ({
      id: clip.id,
      sourceClipId: input.sourceClipIdentityByClipId?.[clip.id] ?? clip.id,
      trackId: clip.trackId,
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
      sourceStartSeconds: clip.inPoint,
      linkedClipIds: clip.linkedClipId ? [clip.linkedClipId] : [],
      payload: clipPayload(clip),
    })),
    transitions: transitionEntries(clips),
    globalState: jsonObject({
      duration: timeline.duration,
      durationLocked: timeline.durationLocked ?? false,
      frameRate: input.composition.frameRate,
      unsupportedTracks: timeline.tracks.filter((track) => unsupportedTrackIds.has(track.id)),
      unsupportedClips: timeline.clips.filter((clip) => unsupportedTrackIds.has(clip.trackId)),
    }),
  };
}
