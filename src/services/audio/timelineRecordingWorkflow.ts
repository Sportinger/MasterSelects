import type { AudioRecordingPhase, AudioRecordingTarget } from '../../types/audio';
import type { TimelineTrack } from '../../types';
import { useTimelineStore } from '../../stores/timeline';
import { audioRecordingService } from './AudioRecordingService';

export interface TimelineRecordingRange {
  mode: 'record' | 'punch';
  startTime: number;
  punchInTime?: number;
  punchOutTime?: number;
  invalidReason?: string;
}

export interface ToggleTimelineRecordingInput {
  isRecording: boolean;
  armedAudioTracks: readonly TimelineTrack[];
  playheadPosition: number;
  inPoint: number | null;
  outPoint: number | null;
  duration: number;
  noArmedTrackCode: string;
  failureCode: string;
}

export type TimelineRecordingToggleResult =
  | 'started'
  | 'stopped'
  | 'no-armed-tracks'
  | 'failed';

const MIN_PUNCH_DURATION_SECONDS = 0.02;

export function isAudioRecordingActivePhase(phase: AudioRecordingPhase): boolean {
  return phase === 'waiting-for-punch'
    || phase === 'warming-input'
    || phase === 'recording'
    || phase === 'requesting-input'
    || phase === 'stopping';
}

export function resolveTimelineRecordingRange(input: {
  playheadPosition: number;
  inPoint: number | null;
  outPoint: number | null;
  duration: number;
}): TimelineRecordingRange {
  const duration = Number.isFinite(input.duration) ? Math.max(0, input.duration) : 0;
  const playheadPosition = Math.max(0, Math.min(
    Number.isFinite(input.playheadPosition) ? input.playheadPosition : 0,
    duration,
  ));
  const inPoint = typeof input.inPoint === 'number' && Number.isFinite(input.inPoint)
    ? Math.max(0, Math.min(input.inPoint, duration))
    : null;
  const outPoint = typeof input.outPoint === 'number' && Number.isFinite(input.outPoint)
    ? Math.max(0, Math.min(input.outPoint, duration))
    : null;
  const startTime = inPoint !== null && playheadPosition < inPoint
    ? inPoint
    : playheadPosition;
  const punchOutTime = outPoint !== null && outPoint > startTime + MIN_PUNCH_DURATION_SECONDS
    ? outPoint
    : undefined;
  const mode = inPoint !== null || punchOutTime !== undefined ? 'punch' : 'record';

  return {
    mode,
    startTime,
    punchInTime: inPoint !== null ? startTime : undefined,
    punchOutTime,
    invalidReason: outPoint !== null && outPoint <= startTime + MIN_PUNCH_DURATION_SECONDS
      ? 'Out point is at or before the recording start.'
      : undefined,
  };
}

export function createAudioRecordingTargets(tracks: readonly TimelineTrack[]): AudioRecordingTarget[] {
  return tracks.map(track => ({
    trackId: track.id,
    trackName: track.name,
    inputDeviceId: track.audioState?.inputDeviceId,
  }));
}

function publishRecordingWarning(code: string, message: string, severity: 'warning' | 'error'): void {
  useTimelineStore.getState().updateMasterAudioState({
    exportPreflight: {
      lastCheckedAt: Date.now(),
      warnings: [{
        code,
        message,
        severity,
      }],
    },
  });
}

export async function toggleTimelineAudioRecording(
  input: ToggleTimelineRecordingInput,
): Promise<TimelineRecordingToggleResult> {
  try {
    if (input.isRecording) {
      const result = await audioRecordingService.stop();
      await audioRecordingService.commitRecordingResult(result);
      return 'stopped';
    }

    if (input.armedAudioTracks.length === 0) {
      publishRecordingWarning(
        input.noArmedTrackCode,
        'Arm at least one audio track before recording.',
        'warning',
      );
      return 'no-armed-tracks';
    }

    const range = resolveTimelineRecordingRange(input);

    await audioRecordingService.start({
      startTime: range.startTime,
      punchInTime: range.punchInTime,
      punchOutTime: range.punchOutTime,
      targets: createAudioRecordingTargets(input.armedAudioTracks),
      getTimelineTime: () => useTimelineStore.getState().playheadPosition,
      onPunchOut: async (result) => {
        await audioRecordingService.commitRecordingResult(result);
      },
    });
    return 'started';
  } catch (error) {
    publishRecordingWarning(
      input.failureCode,
      error instanceof Error ? error.message : 'Audio recording failed.',
      'error',
    );
    return 'failed';
  }
}
