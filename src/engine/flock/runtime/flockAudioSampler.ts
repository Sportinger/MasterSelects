import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { renderHostPort } from '../../../services/render/renderHostPort';
import {
  getCachedTimelineLoudnessEnvelope,
  loadTimelineLoudnessEnvelope,
  type TimelineLoudnessCurve,
} from '../../../services/audio/timelineLoudnessEnvelopeCache';
import type { FlockAudioSampler } from '../../../services/flock/compiler/flockParamEvaluation';

/**
 * Deterministic audio modulation from existing loudness analysis artifacts.
 * Missing analysis is reported as unavailable (null) — never replaced with
 * wall-clock playback levels. A completed async load bumps the revision so
 * flock sessions resimulate with the frozen analysis.
 */

const PREFERRED_METRICS = ['momentary-lufs', 'rms-dbfs', 'short-term-lufs', 'sample-peak-dbfs'];
const pendingLoads = new Set<string>();
let audioRevision = 0;

export function getFlockAudioRevision(): number {
  return audioRevision;
}

function pickCurve(curves: TimelineLoudnessCurve[]): TimelineLoudnessCurve | null {
  for (const metric of PREFERRED_METRICS) {
    const curve = curves.find((candidate) => candidate.metric === metric && candidate.channelIndex === undefined)
      ?? curves.find((candidate) => candidate.metric === metric);
    if (curve) return curve;
  }
  return curves[0] ?? null;
}

function normalizeDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value + 60) / 60));
}

export function createFlockAudioSampler(flockClipId: string): FlockAudioSampler {
  return (audioClipId, sourceTime, smoothingSeconds) => {
    const clips = useTimelineStore.getState().clips;
    const audioClip = clips.find((clip) => clip.id === audioClipId);
    if (!audioClip) return null;
    const mediaFileId = audioClip.mediaFileId ?? audioClip.source?.mediaFileId;
    const refId = mediaFileId
      ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)?.audioAnalysisRefs?.loudnessEnvelopeId
      : undefined;
    if (!refId) return null;
    const envelope = getCachedTimelineLoudnessEnvelope(refId);
    if (!envelope) {
      if (!pendingLoads.has(refId)) {
        pendingLoads.add(refId);
        void loadTimelineLoudnessEnvelope(refId).then((loaded) => {
          if (loaded) {
            audioRevision += 1;
            renderHostPort.requestRender();
          }
        }).catch(() => undefined);
      }
      return null;
    }
    const curve = pickCurve(envelope.curves);
    if (!curve || curve.pointCount === 0 || curve.hopDuration <= 0) return null;
    // Map flock source time -> timeline time -> audio source time (constant-speed placement).
    const flockClip = clips.find((clip) => clip.id === flockClipId);
    const timelineTime = flockClip ? flockClip.startTime + (sourceTime - flockClip.inPoint) : sourceTime;
    const audioTime = timelineTime - audioClip.startTime + audioClip.inPoint;
    const sampleAt = (time: number) => {
      const index = Math.max(0, Math.min(curve.pointCount - 1, Math.floor(time / curve.hopDuration)));
      return normalizeDb(curve.values[index]);
    };
    if (smoothingSeconds <= curve.hopDuration) return sampleAt(audioTime);
    const samples = Math.min(64, Math.ceil(smoothingSeconds / curve.hopDuration));
    let sum = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      sum += sampleAt(audioTime - (sample * smoothingSeconds) / samples);
    }
    return sum / samples;
  };
}
