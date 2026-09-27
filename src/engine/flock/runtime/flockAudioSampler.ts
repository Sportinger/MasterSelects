import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { renderHostPort } from '../../../services/render/renderHostPort';
import {
  getCachedTimelineLoudnessEnvelope,
  loadTimelineLoudnessEnvelope,
  type TimelineLoudnessCurve,
} from '../../../services/audio/timelineLoudnessEnvelopeCache';
import { pickFlockAudioCurve, sampleFlockAudioCurve, flockAudioCurveFingerprint } from './flockAudioCurve';
import type { FlockAudioSampler } from '../../../services/flock/compiler/flockParamEvaluation';

/**
 * Deterministic audio modulation from existing loudness analysis artifacts.
 * Missing analysis is reported as unavailable (null) — never replaced with
 * wall-clock playback levels. A completed async load bumps the revision so
 * flock sessions resimulate with the frozen analysis.
 */

const pendingLoads = new Set<string>();
let audioRevision = 0;

export function getFlockAudioRevision(): number { return audioRevision; }

export interface FlockAudioInput {
  curve: TimelineLoudnessCurve | null;
  sourceOffset: number;
}

/** Resolve against the owning composition's clips; unavailable analysis stays null. */
export function resolveFlockAudioInput(flockClipId: string, audioClipId: string,
  clips = useTimelineStore.getState().clips, options: { loadMissing?: boolean } = {}): FlockAudioInput {
  const audioClip = clips.find(clip => clip.id === audioClipId);
  if (!audioClip) return { curve: null, sourceOffset: 0 };
  const flockClip = clips.find(clip => clip.id === flockClipId);
  const sourceOffset = (flockClip ? flockClip.startTime - flockClip.inPoint : 0) - audioClip.startTime + audioClip.inPoint;
  const mediaFileId = audioClip.mediaFileId ?? audioClip.source?.mediaFileId;
  const refId = mediaFileId ? useMediaStore.getState().files.find(file => file.id === mediaFileId)?.audioAnalysisRefs?.loudnessEnvelopeId : undefined;
  if (!refId) return { curve: null, sourceOffset };
  const envelope = getCachedTimelineLoudnessEnvelope(refId);
  if (!envelope) {
    if (options.loadMissing !== false && !pendingLoads.has(refId)) {
      pendingLoads.add(refId);
      void loadTimelineLoudnessEnvelope(refId).then(loaded => {
        if (loaded) { audioRevision += 1; renderHostPort.requestRender(); }
      }).catch(() => undefined);
    }
    return { curve: null, sourceOffset };
  }
  const curve = pickFlockAudioCurve(envelope.curves);
  return { curve: curve && curve.pointCount > 0 && curve.hopDuration > 0 ? curve : null, sourceOffset };
}

export function createFlockAudioSampler(flockClipId: string, options: { loadMissing?: boolean } = {}): FlockAudioSampler {
  return (audioClipId, sourceTime, smoothingSeconds) => {
    const input = resolveFlockAudioInput(flockClipId, audioClipId, undefined, options);
    return sampleFlockAudioCurve(input.curve, sourceTime + input.sourceOffset, smoothingSeconds);
  };
}

export function getFlockAudioFingerprint(flockClipId: string, audioClipIds: readonly string[]): string {
  return JSON.stringify([...new Set(audioClipIds)].toSorted().map(id => {
    const input = resolveFlockAudioInput(flockClipId, id);
    return [id, input.sourceOffset, input.curve ? flockAudioCurveFingerprint(input.curve) : null];
  }));
}
