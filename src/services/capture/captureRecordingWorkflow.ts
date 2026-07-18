import { screenCaptureService } from './ScreenCaptureService';
import type { CaptureRecordingConfig, CaptureRecordingResult, CaptureSessionSnapshot } from './recording/sessionTypes';
import { commitCaptureRecording, type CaptureCommitOptions, type CaptureCommitResult } from './recording/commitRecording';
import { getCaptureRecoveryStorage, readCaptureRecoveryEntries } from './recording/recoveryPersistence';

export function startCaptureRecording(config: CaptureRecordingConfig): Promise<CaptureSessionSnapshot> {
  return screenCaptureService.start(config);
}

export function pauseCaptureRecording(): Promise<CaptureSessionSnapshot> {
  return screenCaptureService.pause();
}

export function resumeCaptureRecording(): Promise<CaptureSessionSnapshot> {
  return screenCaptureService.resume();
}

export async function stopAndCommitCaptureRecording(
  options: CaptureCommitOptions = {},
): Promise<CaptureCommitResult> {
  return commitCaptureRecording(await screenCaptureService.stop(), options);
}

export function commitRecoveredCaptureRecording(
  sessionId: string,
  options: CaptureCommitOptions = {},
): Promise<CaptureCommitResult> {
  const storage = options.recoveryStorage ?? getCaptureRecoveryStorage();
  const entry = readCaptureRecoveryEntries(storage).find(candidate => candidate.sessionId === sessionId);
  if (!entry) throw new Error('No recoverable screen recording is available for this session.');
  if (entry.tier === 'webcodecs' && !entry.recoverable) {
    throw new Error('The interrupted MP4 has no completely persisted media fragment to restore.');
  }
  const result: CaptureRecordingResult = {
    sessionId,
    mimeType: entry.mimeType ?? 'video/webm',
    durationSeconds: entry.durationSeconds ?? Math.max(0, ...entry.chunks.map(chunk => chunk.timeStart + (chunk.duration ?? 0))),
    bytes: entry.bytes ?? (entry.chunks.some(chunk => chunk.position !== undefined)
      ? entry.chunks.reduce((size, chunk) => Math.max(size, (chunk.position ?? 0) + chunk.bytes), 0)
      : entry.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)),
    artifactIds: entry.chunks.map(chunk => chunk.artifactId),
  };
  return commitCaptureRecording(result, options);
}
