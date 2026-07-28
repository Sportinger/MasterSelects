import type { TimelineClip } from '../../../types/timeline';
import type { useTimelineStore } from '../../../stores/timeline';
import {
  countSpeechMarkers,
  type ProsodyContourManifest,
} from '../../audio/intelligence/audioIntelligencePayloadTypes';
import { loadAudioIntelligencePayloads } from '../../agentTimeline/artifacts/audioIntelligencePayloadLoader';
import { createCurrentAudioArtifactStore } from '../../audio/timelineWaveformPyramidCache';
import type { AudioAnalysisArtifact } from '../../audio/audioArtifactTypes';
import type { ToolResult } from '../types';

 type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

function sourceTimeToTimeline(
  clip: TimelineClip,
  sourceTime: number,
  timelineStore: TimelineStore,
): number {
  if (typeof timelineStore.getSourceTimeForClip === 'function') {
    const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
    const sourceAt = (localTime: number) => {
      const offset = timelineStore.getSourceTimeForClip(clip.id, localTime);
      return reversed ? clip.outPoint - Math.abs(offset) : clip.inPoint + offset;
    };
    let bestLocal = 0;
    let bestDistance = Infinity;
    const steps = 96;
    for (let index = 0; index <= steps; index += 1) {
      const local = clip.duration * (index / steps);
      const distance = Math.abs(sourceAt(local) - sourceTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLocal = local;
      }
    }
    let radius = clip.duration / steps;
    for (let pass = 0; pass < 12; pass += 1) {
      const left = Math.max(0, bestLocal - radius);
      const right = Math.min(clip.duration, bestLocal + radius);
      const leftDistance = Math.abs(sourceAt(left) - sourceTime);
      const rightDistance = Math.abs(sourceAt(right) - sourceTime);
      if (leftDistance < bestDistance) {
        bestLocal = left;
        bestDistance = leftDistance;
      }
      if (rightDistance < bestDistance) {
        bestLocal = right;
        bestDistance = rightDistance;
      }
      radius /= 2;
    }
    return clip.startTime + bestLocal;
  }

  const speed = clip.speed ?? 1;
  const absoluteSpeed = Math.max(0.0001, Math.abs(speed));
  const reversed = clip.reversed === true || speed < 0;
  const local = reversed
    ? (clip.outPoint - sourceTime) / absoluteSpeed
    : (sourceTime - clip.inPoint) / absoluteSpeed;
  return clip.startTime + Math.max(0, local);
}

function freshestProsodyManifest(
  artifacts: readonly AudioAnalysisArtifact[],
): ProsodyContourManifest | undefined {
  const artifact = artifacts
    .filter(candidate => candidate.kind === 'prosody-contour'
      && !candidate.stale
      && candidate.clipAudioStateHash === undefined)
    .toSorted((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))[0];
  const manifest = artifact?.metadata?.prosodyContourManifest;
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest as unknown as ProsodyContourManifest
    : undefined;
}

export async function handleGetSpeechMarkers(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const requestedStart = typeof args.sourceStart === 'number' ? args.sourceStart : clip.inPoint;
  const requestedEnd = typeof args.sourceEnd === 'number' ? args.sourceEnd : clip.outPoint;
  const clampTime = (value: number) => Math.min(clip.outPoint, Math.max(clip.inPoint, value));
  const sourceA = clampTime(requestedStart);
  const sourceB = clampTime(requestedEnd);
  const sourceStart = Math.min(sourceA, sourceB);
  const sourceEnd = Math.max(sourceA, sourceB);
  const offset = Math.max(0, typeof args.offset === 'number' ? Math.floor(args.offset) : 0);
  const limit = Math.min(250, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 100));
  const requestedKinds = Array.isArray(args.kinds)
    ? new Set(args.kinds.filter((kind): kind is string => typeof kind === 'string'))
    : undefined;
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;

  let artifacts: AudioAnalysisArtifact[] = [];
  let payloads: Awaited<ReturnType<typeof loadAudioIntelligencePayloads>> = {};
  if (mediaFileId) {
    try {
      const store = createCurrentAudioArtifactStore();
      artifacts = await store.listAnalysisArtifacts(mediaFileId);
      payloads = await loadAudioIntelligencePayloads(artifacts, store);
    } catch {
      // An unreadable artifact is reported like a missing artifact so callers can regenerate it.
    }
  }

  const prosody = freshestProsodyManifest(artifacts)?.summary;
  const summary = prosody ? {
    ...(prosody.medianF0Hz !== undefined ? { medianF0Hz: prosody.medianF0Hz } : {}),
    ...(prosody.meanSpeechRateSps !== undefined ? { meanSpeechRateSps: prosody.meanSpeechRateSps } : {}),
  } : undefined;
  if (!payloads.speechMarkers) {
    return {
      success: true,
      data: {
        clipId,
        hasMarkers: false,
        sourceRange: { start: sourceStart, end: sourceEnd },
        offset,
        limit,
        returned: 0,
        hasMore: false,
        nextOffset: null,
        counts: {},
        markers: [],
        summary,
        hint: 'Run startClipAudioIntelligence to generate speech markers for this clip.',
      },
    };
  }

  const matching = payloads.speechMarkers.markers
    .filter(marker => marker.end >= sourceStart && marker.start <= sourceEnd)
    .filter(marker => !requestedKinds || requestedKinds.has(marker.type))
    .map(marker => ({
      ...marker,
      start: Math.max(sourceStart, marker.start),
      end: Math.min(sourceEnd, marker.end),
    }))
    .filter(marker => marker.end >= marker.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  const page = matching.slice(offset, offset + limit);
  const hasMore = offset + page.length < matching.length;

  return {
    success: true,
    data: {
      clipId,
      hasMarkers: true,
      sourceRange: { start: sourceStart, end: sourceEnd },
      markerCount: payloads.speechMarkers.markers.length,
      matchingMarkerCount: matching.length,
      offset,
      limit,
      returned: page.length,
      hasMore,
      nextOffset: hasMore ? offset + page.length : null,
      counts: countSpeechMarkers(matching),
      markers: page.map(marker => {
        const timelineA = sourceTimeToTimeline(clip, marker.start, timelineStore);
        const timelineB = sourceTimeToTimeline(clip, marker.end, timelineStore);
        return {
          id: marker.id,
          type: marker.type,
          start: marker.start,
          end: marker.end,
          timelineStart: Math.min(timelineA, timelineB),
          timelineEnd: Math.max(timelineA, timelineB),
          confidence: marker.confidence,
          ...(marker.text !== undefined ? { text: marker.text } : {}),
          ...(marker.wordIds !== undefined ? { wordIds: marker.wordIds } : {}),
        };
      }),
      summary,
    },
  };
}