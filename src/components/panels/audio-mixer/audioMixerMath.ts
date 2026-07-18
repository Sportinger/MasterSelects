import type {
  AudioExportPreflightState,
  MasterAudioState,
  TrackAudioState,
} from '../../../types/audio';
import type { TimelineTrack } from '../../../types/timeline';

export const DEFAULT_MASTER_AUDIO_STATE: MasterAudioState = {
  volumeDb: 0,
  limiterEnabled: false,
  truePeakCeilingDb: -1,
  targetLufs: -14,
  effectStack: [],
};

export const MASTER_FOCUS_ID = '__master__';

const MIXER_FADER_MIN_DB = -60;
const MIXER_FADER_MAX_DB = 18;

export function getTrackAudioState(track: TimelineTrack): TrackAudioState {
  return {
    volumeDb: 0,
    pan: 0,
    muted: track.muted,
    solo: track.solo,
    recordArm: false,
    inputMonitor: false,
    meterMode: 'peak',
    ...(track.audioState ?? {}),
  };
}

export function formatDb(value: number): string {
  if (!Number.isFinite(value)) return '-inf';
  return value <= -59.95 ? '-inf' : value.toFixed(1);
}

export function formatDbLong(value: number): string {
  const formatted = formatDb(value);
  return formatted === '-inf' ? formatted : `${formatted} dB`;
}

export function getMixerFaderScaleTopPercent(
  value: number,
  min = MIXER_FADER_MIN_DB,
  max = MIXER_FADER_MAX_DB,
): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 100;
  }
  const clamped = Math.max(min, Math.min(max, value));
  return ((max - clamped) / (max - min)) * 100;
}

export function formatPan(value: number): string {
  if (Math.abs(value) < 0.005) return 'C';
  return value < 0 ? `L${Math.round(Math.abs(value) * 100)}` : `R${Math.round(value * 100)}`;
}

export function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0s';
  return `${value.toFixed(1)}s`;
}

export function getPreflightStatus(preflight: AudioExportPreflightState | undefined): {
  label: string;
  className: string;
} {
  const warnings = preflight?.warnings ?? [];
  if (warnings.some(warning => warning.severity === 'error')) {
    return { label: 'Error', className: 'error' };
  }
  if (warnings.some(warning => warning.severity === 'warning')) {
    return { label: 'Warning', className: 'warning' };
  }
  if (preflight?.measurement) {
    return { label: 'Measured', className: 'ok' };
  }
  if (preflight?.lastCheckedAt) {
    return { label: 'Checked', className: 'ok' };
  }
  return { label: 'Not checked', className: '' };
}
