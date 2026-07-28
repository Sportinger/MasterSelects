import type { TimelineClip } from '../../../types/timeline';
import { audioExtractor } from '../../../engine/audio/AudioExtractor';
import { getClipAudioSourceRange } from '../audioRepairSuggestionOperations';
import {
  detectAudioSilenceRanges,
  type AudioSilenceDetectionOptions,
  type AudioSilenceRange,
} from '../audioSilenceDetection';
import type { AudioAnalysisArtifact } from '../audioArtifactTypes';
import type { RoomToneProfileManifest } from '../roomToneProfileManifest';
import { snapSourceTimeToZeroCrossing } from '../sampleAccurateSnap';
import { createCurrentAudioArtifactStore } from '../timelineWaveformPyramidCache';
import {
  loadAudioIntelligencePayloads,
  type AudioIntelligencePayloads,
} from '../../agentTimeline/artifacts/audioIntelligencePayloadLoader';
import { roomToneProfileToFillParams } from './roomTone/roomToneFillParams';

const ZERO_CROSSING_SNAP_SECONDS = 0.01;
const VAD_RMS_FALLBACK_DB = -60;

interface DecodedClipAudio {
  buffer: AudioBuffer;
  sourceStart: number;
}

interface LoadedAudioIntelligence {
  artifacts: readonly AudioAnalysisArtifact[];
  payloads: AudioIntelligencePayloads;
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

async function decodeClipAudio(clip: TimelineClip): Promise<DecodedClipAudio> {
  const sourceRange = getClipAudioSourceRange(clip);
  const sourceBuffer = await audioExtractor.extractAudio(
    clip.file,
    getClipMediaFileId(clip) ?? clip.id,
  );
  return {
    buffer: audioExtractor.trimBuffer(sourceBuffer, sourceRange.start, sourceRange.end),
    sourceStart: sourceRange.start,
  };
}

async function loadClipAudioIntelligence(
  clip: TimelineClip,
): Promise<LoadedAudioIntelligence | undefined> {
  const mediaFileId = getClipMediaFileId(clip);
  if (!mediaFileId) return undefined;
  try {
    const store = createCurrentAudioArtifactStore();
    const artifacts = await store.listAnalysisArtifacts(mediaFileId);
    return {
      artifacts,
      payloads: await loadAudioIntelligencePayloads(artifacts, store),
    };
  } catch {
    return undefined;
  }
}

function loudnessForRange(
  payloads: AudioIntelligencePayloads,
  start: number,
  end: number,
): number {
  const curve = ['rms-dbfs', 'short-term-lufs', 'momentary-lufs']
    .map(metric => payloads.loudness?.curves.find(candidate => candidate.metric === metric))
    .find(candidate => candidate !== undefined);
  const values = curve?.windows
    .filter(window => window.start < end && window.end > start)
    .map(window => window.valueDb)
    .filter(Number.isFinite) ?? [];
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : VAD_RMS_FALLBACK_DB;
}

function silenceRangesFromVoiceActivity(
  clip: TimelineClip,
  payloads: AudioIntelligencePayloads,
  options: AudioSilenceDetectionOptions,
): AudioSilenceRange[] | undefined {
  const voiceActivity = payloads.voiceActivity;
  if (!voiceActivity) return undefined;
  const sourceRange = getClipAudioSourceRange(clip);
  const minSilenceSeconds = Math.max(0.05, Math.min(30, options.minSilenceSeconds ?? 0.32));
  const paddingSeconds = Math.max(0, Math.min(1, options.paddingSeconds ?? 0.025));
  const maxRanges = Math.max(1, Math.min(512, Math.round(options.maxRanges ?? 96)));
  const speech = voiceActivity.segments
    .filter(segment => segment.end > sourceRange.start && segment.start < sourceRange.end)
    .map(segment => ({
      start: Math.max(sourceRange.start, segment.start),
      end: Math.min(sourceRange.end, segment.end),
    }))
    .filter(segment => segment.end > segment.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
    .reduce<{ start: number; end: number }[]>((merged, segment) => {
      const previous = merged[merged.length - 1];
      if (previous && segment.start <= previous.end) {
        previous.end = Math.max(previous.end, segment.end);
      } else {
        merged.push({ ...segment });
      }
      return merged;
    }, []);

  const gaps: AudioSilenceRange[] = [];
  let cursor = sourceRange.start;
  for (const segment of speech) {
    const start = Math.max(sourceRange.start, cursor - paddingSeconds);
    const end = Math.min(sourceRange.end, segment.start + paddingSeconds);
    if (end - start >= minSilenceSeconds) {
      gaps.push({
        start,
        end,
        duration: end - start,
        rmsDb: loudnessForRange(payloads, start, end),
      });
    }
    cursor = Math.max(cursor, segment.end);
  }
  const tailStart = Math.max(sourceRange.start, cursor - paddingSeconds);
  if (sourceRange.end - tailStart >= minSilenceSeconds) {
    gaps.push({
      start: tailStart,
      end: sourceRange.end,
      duration: sourceRange.end - tailStart,
      rmsDb: loudnessForRange(payloads, tailStart, sourceRange.end),
    });
  }
  return gaps.slice(0, maxRanges);
}

function hasFreshVoiceActivityArtifact(
  artifacts: readonly AudioAnalysisArtifact[],
): boolean {
  return artifacts.some(artifact => artifact.kind === 'voice-activity'
    && !artifact.stale
    && artifact.clipAudioStateHash === undefined);
}

function snapSilenceRanges(
  clip: TimelineClip,
  ranges: readonly AudioSilenceRange[],
  decoded: DecodedClipAudio,
): AudioSilenceRange[] {
  const sourceRange = getClipAudioSourceRange(clip);
  return ranges.map((range) => {
    const snappedStart = snapSourceTimeToZeroCrossing(
      decoded.buffer,
      range.start - decoded.sourceStart,
      { maxDistanceSeconds: ZERO_CROSSING_SNAP_SECONDS },
    );
    const snappedEnd = snapSourceTimeToZeroCrossing(
      decoded.buffer,
      range.end - decoded.sourceStart,
      { maxDistanceSeconds: ZERO_CROSSING_SNAP_SECONDS },
    );
    const start = Math.max(sourceRange.start, Math.min(sourceRange.end,
      snappedStart === null ? range.start : decoded.sourceStart + snappedStart));
    const end = Math.max(start, Math.min(sourceRange.end,
      snappedEnd === null ? range.end : decoded.sourceStart + snappedEnd));
    return { ...range, start, end, duration: end - start };
  });
}

function freshestRoomToneProfile(
  artifacts: readonly AudioAnalysisArtifact[],
): RoomToneProfileManifest | undefined {
  const artifact = artifacts
    .filter(candidate => candidate.kind === 'room-tone-profile'
      && !candidate.stale)
    .toSorted((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))[0];
  const manifest = artifact?.metadata?.roomToneProfileManifest;
  return manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? manifest as unknown as RoomToneProfileManifest
    : undefined;
}

export function normalizeAudioEditSilenceRanges(
  clip: TimelineClip,
  ranges: readonly AudioSilenceRange[],
): AudioSilenceRange[] {
  const sourceRange = getClipAudioSourceRange(clip);
  const normalized = ranges
    .map(range => {
      const start = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.min(range.start, range.end)));
      const end = Math.max(sourceRange.start, Math.min(sourceRange.end, Math.max(range.start, range.end)));
      return {
        start,
        end,
        duration: Math.max(0, end - start),
        rmsDb: typeof range.rmsDb === 'number' && Number.isFinite(range.rmsDb) ? range.rmsDb : -120,
      };
    })
    .filter(range => range.duration > 0.01)
    .toSorted((a, b) => a.start - b.start);

  const merged: AudioSilenceRange[] = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end + 0.001) {
      previous.end = Math.max(previous.end, range.end);
      previous.duration = previous.end - previous.start;
      previous.rmsDb = Math.min(previous.rmsDb, range.rmsDb);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

export async function detectRmsAudioSilence(
  clip: TimelineClip,
  options: AudioSilenceDetectionOptions,
): Promise<AudioSilenceRange[]> {
  const decoded = await decodeClipAudio(clip);
  const ranges = detectAudioSilenceRanges(decoded.buffer, options).map(range => ({
    ...range,
    start: decoded.sourceStart + range.start,
    end: decoded.sourceStart + range.end,
  }));
  return normalizeAudioEditSilenceRanges(clip, snapSilenceRanges(clip, ranges, decoded));
}

export async function detectSilenceWithAudioArtifacts(
  clip: TimelineClip,
  options: AudioSilenceDetectionOptions,
): Promise<AudioSilenceRange[]> {
  const intelligence = await loadClipAudioIntelligence(clip);
  const vadRanges = intelligence && hasFreshVoiceActivityArtifact(intelligence.artifacts)
    ? silenceRangesFromVoiceActivity(clip, intelligence.payloads, options)
    : undefined;
  if (vadRanges) {
    try {
      return normalizeAudioEditSilenceRanges(
        clip,
        snapSilenceRanges(clip, vadRanges, await decodeClipAudio(clip)),
      );
    } catch {
      return normalizeAudioEditSilenceRanges(clip, vadRanges);
    }
  }

  return detectRmsAudioSilence(clip, options);
}

export async function resolveRoomToneProfileFillParams(
  clip: TimelineClip,
): Promise<Record<string, string> | undefined> {
  const intelligence = await loadClipAudioIntelligence(clip);
  const profile = intelligence
    ? freshestRoomToneProfile(intelligence.artifacts)
    : undefined;
  return profile ? roomToneProfileToFillParams(profile, 12) : undefined;
}
