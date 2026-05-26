import type {
  AudioAnalysisWarning,
  AudioExportPreflightMeasurement,
  MasterAudioState,
  TimelineClip,
  TimelineTrack,
} from '../../types';
import type { AudioExportPreflightState } from '../../types/audio';
import { renderAudioGraph } from '../../engine/audio/AudioGraphRenderer';
import type {
  AudioGraphRenderPlan,
  AudioGraphScope,
  AudioGraphSkippedEffect,
} from '../../engine/audio/AudioGraphTypes';
import { analyzeAudioBufferLoudnessSummary } from './LoudnessEnvelopeGenerator';

const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'aiff', 'opus']);

export interface AudioExportPreflightInput {
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  masterAudioState?: MasterAudioState;
  startTime: number;
  endTime: number;
  renderedBuffer?: AudioBuffer | null;
  now?: number;
}

function warning(
  code: string,
  message: string,
  severity: AudioAnalysisWarning['severity'],
  details?: AudioAnalysisWarning['details'],
): AudioAnalysisWarning {
  return { code, message, severity, ...(details ? { details } : {}) };
}

function normalizeRange(startTime: number, endTime: number): { startTime: number; endTime: number } {
  const start = Number.isFinite(startTime) ? startTime : 0;
  const end = Number.isFinite(endTime) ? endTime : start;
  return {
    startTime: Math.max(0, Math.min(start, end)),
    endTime: Math.max(0, Math.max(start, end)),
  };
}

function clipOverlapsRange(clip: TimelineClip, startTime: number, endTime: number): boolean {
  const clipStart = Number.isFinite(clip.startTime) ? clip.startTime : 0;
  const clipDuration = Number.isFinite(clip.duration) ? clip.duration : 0;
  const clipEnd = clipStart + Math.max(0, clipDuration);
  return clipEnd > startTime && clipStart < endTime;
}

function clipHasExportableAudioSource(clip: TimelineClip): boolean {
  if (clip.isComposition && clip.mixdownBuffer && clip.hasMixdownAudio) return true;
  if (clip.source?.type === 'audio') return true;
  if (clip.file?.type?.startsWith('audio/')) return true;

  const extension = (clip.file?.name || clip.name || '').split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(extension);
}

function getCandidateAudioClips(
  clips: readonly TimelineClip[],
  startTime: number,
  endTime: number,
): TimelineClip[] {
  return clips.filter(clip =>
    clipOverlapsRange(clip, startTime, endTime) &&
    clipHasExportableAudioSource(clip)
  );
}

function diagnosticWarnings(plan: AudioGraphRenderPlan): AudioAnalysisWarning[] {
  return plan.diagnostics.map(diagnostic => warning(
    diagnostic.code,
    diagnostic.message,
    diagnostic.severity,
    {
      graphKey: plan.graphKey,
      ...(diagnostic.scope ? { scope: diagnostic.scope } : {}),
      ...(diagnostic.refId ? { refId: diagnostic.refId } : {}),
    },
  ));
}

function skippedEffectWarning(
  skipped: AudioGraphSkippedEffect,
  scope: AudioGraphScope,
  ownerId: string,
): AudioAnalysisWarning | null {
  if (skipped.status !== 'invalid') return null;
  return warning(
    'audio-export-invalid-effect-skipped',
    `Invalid audio effect "${skipped.descriptorId}" will be skipped during export.`,
    'error',
    {
      effectId: skipped.effectId,
      descriptorId: skipped.descriptorId,
      scope,
      ownerId,
    },
  );
}

function skippedEffectWarnings(plan: AudioGraphRenderPlan): AudioAnalysisWarning[] {
  const warnings: AudioAnalysisWarning[] = [];

  for (const clip of plan.clips) {
    for (const skipped of clip.skippedEffects) {
      const item = skippedEffectWarning(skipped, 'clip', clip.clipId);
      if (item) warnings.push(item);
    }
  }

  for (const track of plan.tracks) {
    for (const skipped of track.skippedEffects) {
      const item = skippedEffectWarning(skipped, 'track', track.trackId);
      if (item) warnings.push(item);
    }
  }

  for (const skipped of plan.master.skippedEffects) {
    const item = skippedEffectWarning(skipped, 'master', 'master');
    if (item) warnings.push(item);
  }

  return warnings;
}

function graphFeatureWarnings(plan: AudioGraphRenderPlan): AudioAnalysisWarning[] {
  const warnings: AudioAnalysisWarning[] = [];

  for (const track of plan.tracks) {
    const enabledSendCount = track.sends.filter(send => send.enabled !== false).length;
    if (enabledSendCount > 0) {
      warnings.push(warning(
        'audio-export-track-sends-rendered-as-master-returns',
        `${enabledSendCount} enabled send${enabledSendCount === 1 ? '' : 's'} on track "${track.trackId}" will be rendered into the master mix as send return audio.`,
        'info',
        { trackId: track.trackId, sendCount: enabledSendCount },
      ));
    }
  }

  return warnings;
}

function inputStateWarnings(tracks: readonly TimelineTrack[]): AudioAnalysisWarning[] {
  const warnings: AudioAnalysisWarning[] = [];

  for (const track of tracks) {
    if (track.audioState?.recordArm) {
      warnings.push(warning(
        'audio-export-record-arm-active',
        `Track "${track.name}" is record-armed; only recorded timeline clips are exported.`,
        'warning',
        { trackId: track.id },
      ));
    }
    if (track.audioState?.inputMonitor) {
      warnings.push(warning(
        'audio-export-input-monitor-not-rendered',
        `Track "${track.name}" has input monitoring enabled; live monitored input is not rendered into export.`,
        'warning',
        { trackId: track.id },
      ));
    }
  }

  return warnings;
}

function roundMetric(value: number | undefined, digits = 2): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function masterStateWarnings(masterAudioState: MasterAudioState | undefined): AudioAnalysisWarning[] {
  const warnings: AudioAnalysisWarning[] = [];
  if (!masterAudioState) return warnings;

  if (!masterAudioState.limiterEnabled && masterAudioState.truePeakCeilingDb !== -1) {
    warnings.push(warning(
      'audio-export-true-peak-ceiling-disabled',
      'True-peak ceiling is only applied when the master limiter is enabled.',
      'info',
      { truePeakCeilingDb: masterAudioState.truePeakCeilingDb },
    ));
  }

  if (!masterAudioState.limiterEnabled && masterAudioState.volumeDb > 0.5) {
    warnings.push(warning(
      'audio-export-positive-master-gain-without-limiter',
      `Master gain is +${masterAudioState.volumeDb.toFixed(1)} dB with no limiter enabled.`,
      'warning',
      { volumeDb: masterAudioState.volumeDb },
    ));
  }

  return warnings;
}

function createMeasurement(
  renderedBuffer: AudioBuffer | null | undefined,
  masterAudioState: MasterAudioState | undefined,
): AudioExportPreflightMeasurement | undefined {
  if (!renderedBuffer) return undefined;
  const summary = analyzeAudioBufferLoudnessSummary(renderedBuffer);
  const targetLufs = masterAudioState?.targetLufs;
  const integratedLufs = roundMetric(summary.integratedLufs);

  return {
    mode: 'rendered-export',
    duration: roundMetric(renderedBuffer.duration, 3) ?? 0,
    sampleRate: renderedBuffer.sampleRate,
    channelCount: renderedBuffer.numberOfChannels,
    integratedLufs,
    truePeakDbtp: roundMetric(summary.truePeakDbtp),
    samplePeakDbfs: roundMetric(summary.samplePeakDbfs),
    rmsDbfs: roundMetric(summary.rmsDbfs),
    ...(targetLufs !== undefined ? { targetLufs } : {}),
    ...(targetLufs !== undefined && integratedLufs !== undefined
      ? { loudnessDelta: roundMetric(integratedLufs - targetLufs) }
      : {}),
    ...(masterAudioState?.limiterEnabled
      ? { truePeakCeilingDb: masterAudioState.truePeakCeilingDb }
      : {}),
  };
}

function measurementWarnings(
  measurement: AudioExportPreflightMeasurement | undefined,
  masterAudioState: MasterAudioState | undefined,
): AudioAnalysisWarning[] {
  if (!measurement) return [];
  const warnings: AudioAnalysisWarning[] = [];
  const samplePeakDbfs = measurement.samplePeakDbfs;
  const truePeakDbtp = measurement.truePeakDbtp;

  if (typeof samplePeakDbfs === 'number' && samplePeakDbfs > 0.001) {
    warnings.push(warning(
      'audio-export-rendered-sample-clipping',
      `Rendered export sample peak is ${samplePeakDbfs.toFixed(2)} dBFS, so the file can clip.`,
      'error',
      { samplePeakDbfs },
    ));
  }

  if (masterAudioState?.limiterEnabled) {
    const ceiling = masterAudioState.truePeakCeilingDb;
    if (typeof truePeakDbtp === 'number' && truePeakDbtp > ceiling + 0.05) {
      warnings.push(warning(
        'audio-export-rendered-true-peak-over-ceiling',
        `Rendered true peak ${truePeakDbtp.toFixed(2)} dBTP is above the master ceiling ${ceiling.toFixed(1)} dBTP.`,
        'error',
        { truePeakDbtp, truePeakCeilingDb: ceiling },
      ));
    }
  } else if (typeof truePeakDbtp === 'number' && truePeakDbtp > -0.1) {
    warnings.push(warning(
      'audio-export-rendered-true-peak-hot',
      `Rendered true peak is ${truePeakDbtp.toFixed(2)} dBTP with no master limiter enabled.`,
      'warning',
      { truePeakDbtp },
    ));
  }

  if (
    measurement.targetLufs !== undefined &&
    measurement.integratedLufs !== undefined &&
    Math.abs(measurement.integratedLufs - measurement.targetLufs) > 1
  ) {
    warnings.push(warning(
      'audio-export-rendered-lufs-target-mismatch',
      `Rendered integrated loudness is ${measurement.integratedLufs.toFixed(2)} LUFS, ${measurement.loudnessDelta?.toFixed(2)} LU away from the ${measurement.targetLufs.toFixed(1)} LUFS target.`,
      'warning',
      {
        integratedLufs: measurement.integratedLufs,
        targetLufs: measurement.targetLufs,
        ...(measurement.loudnessDelta !== undefined ? { loudnessDelta: measurement.loudnessDelta } : {}),
      },
    ));
  }

  if (typeof samplePeakDbfs === 'number' && samplePeakDbfs <= -90) {
    warnings.push(warning(
      'audio-export-rendered-silence',
      'Rendered export audio is effectively silent.',
      'info',
      {
        samplePeakDbfs,
        ...(measurement.integratedLufs !== undefined ? { integratedLufs: measurement.integratedLufs } : {}),
      },
    ));
  }

  return warnings;
}

export function runAudioExportPreflight(input: AudioExportPreflightInput): AudioExportPreflightState {
  const { startTime, endTime } = normalizeRange(input.startTime, input.endTime);
  const candidates = getCandidateAudioClips(input.clips, startTime, endTime);
  const measurement = createMeasurement(input.renderedBuffer, input.masterAudioState);
  const plan = renderAudioGraph({
    clips: candidates,
    tracks: input.tracks,
    masterAudioState: input.masterAudioState,
    mode: 'export',
  });
  const activeTrackIds = new Set(plan.tracks.filter(track => track.active).map(track => track.trackId));
  const activeClipCount = plan.clips.filter(clip => clip.active && activeTrackIds.has(clip.trackId)).length;
  const warnings: AudioAnalysisWarning[] = [
    ...diagnosticWarnings(plan),
    ...skippedEffectWarnings(plan),
    ...graphFeatureWarnings(plan),
    ...inputStateWarnings(input.tracks),
    ...masterStateWarnings(input.masterAudioState),
    ...measurementWarnings(measurement, input.masterAudioState),
  ];

  if (activeClipCount === 0) {
    warnings.push(warning(
      'audio-export-no-active-audio',
      'No active audio clips are audible in the selected export range.',
      'info',
      { startTime, endTime, candidateClipCount: candidates.length },
    ));
  }

  return {
    lastCheckedAt: input.now ?? Date.now(),
    warnings,
    ...(measurement ? { measurement } : {}),
  };
}
