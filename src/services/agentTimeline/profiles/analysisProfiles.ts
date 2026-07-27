import type {
  AgentTimelineProfile,
} from '../../../types/agentTimeline/manifest';
import type {
  AgentTimelineProfileSettings,
} from '../../../types/agentTimeline/analysisEstimate';

const PROFILE_SETTINGS: Record<Exclude<AgentTimelineProfile, 'custom'>, AgentTimelineProfileSettings> = {
  quick: {
    profile: 'quick',
    metricSamplesPerSecond: 1,
    // The legacy frame artifact stores visual metrics and face observations
    // together. Keep Quick on the same 1 fps cadence until those artifacts
    // have independent per-channel sample series.
    faceSamplesPerSecond: 1,
    cameraSamplesPerSecond: 1,
    audioHopSeconds: 0.25,
    ocrKeyframesPerShot: 0,
    activeSpeakerCandidateSamplesPerSecond: 0,
    spatialResolution: { width: 160, height: 90 },
  },
  balanced: {
    profile: 'balanced',
    metricSamplesPerSecond: 2,
    faceSamplesPerSecond: 2,
    cameraSamplesPerSecond: 2,
    audioHopSeconds: 0.1,
    ocrKeyframesPerShot: 1,
    activeSpeakerCandidateSamplesPerSecond: 0,
    spatialResolution: { width: 160, height: 90 },
  },
  deep: {
    profile: 'deep',
    metricSamplesPerSecond: 5,
    faceSamplesPerSecond: 2,
    cameraSamplesPerSecond: 2,
    audioHopSeconds: 0.1,
    ocrKeyframesPerShot: 3,
    activeSpeakerCandidateSamplesPerSecond: 8,
    spatialResolution: { width: 160, height: 90 },
  },
};

export function getAgentTimelineProfileSettings(
  profile: Exclude<AgentTimelineProfile, 'custom'>,
): AgentTimelineProfileSettings {
  const settings = PROFILE_SETTINGS[profile];
  return {
    ...settings,
    spatialResolution: { ...settings.spatialResolution },
  };
}

export function validateAgentTimelineProfileSettings(
  settings: AgentTimelineProfileSettings,
): AgentTimelineProfileSettings {
  const rates = [
    settings.metricSamplesPerSecond,
    settings.faceSamplesPerSecond,
    settings.cameraSamplesPerSecond,
    settings.ocrKeyframesPerShot,
    settings.activeSpeakerCandidateSamplesPerSecond,
  ];
  if (rates.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Analysis profile rates must be finite and non-negative');
  }
  if (!Number.isFinite(settings.audioHopSeconds) || settings.audioHopSeconds <= 0) {
    throw new RangeError('Analysis profile audio hop must be positive');
  }
  if (!Number.isSafeInteger(settings.spatialResolution.width)
    || !Number.isSafeInteger(settings.spatialResolution.height)
    || settings.spatialResolution.width <= 0
    || settings.spatialResolution.height <= 0) {
    throw new RangeError('Analysis profile resolution must contain positive integers');
  }
  return {
    ...settings,
    spatialResolution: { ...settings.spatialResolution },
  };
}
