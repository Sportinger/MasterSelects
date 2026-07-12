import type {
  CaptureRecordingResult,
  CaptureSessionSnapshot,
  CaptureSourceSnapshot,
  CaptureStorageWarning,
  CaptureTier,
} from './sessionTypes';
import { createIdleCaptureSnapshot } from './sessionTypes';

const SOURCE_LOST_MESSAGE = 'The selected capture source stopped sharing.';

export type CaptureSessionEvent =
  | { type: 'request-source'; sessionId: string }
  | { type: 'source-ready'; source: CaptureSourceSnapshot }
  | { type: 'start-recording'; tier: CaptureTier; startedAt: number; storageWarnings?: CaptureStorageWarning[] }
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number }
  | { type: 'stop'; at: number }
  | { type: 'source-lost'; at: number }
  | { type: 'complete'; at: number; result: CaptureRecordingResult }
  | { type: 'fail'; message: string }
  | { type: 'reset' };

export const ACTIVE_CAPTURE_PHASES = [
  'requesting-source',
  'previewing',
  'recording',
  'paused',
  'stopping',
] as const;

function elapsedSeconds(snapshot: CaptureSessionSnapshot, at: number): number {
  if (snapshot.startedAt === undefined) return snapshot.elapsedSeconds;
  const pausedNow = snapshot.pausedAt === undefined ? 0 : Math.max(0, at - snapshot.pausedAt);
  return Math.max(0, (at - snapshot.startedAt - snapshot.pausedDurationMs - pausedNow) / 1000);
}

function invalidTransition(snapshot: CaptureSessionSnapshot, event: CaptureSessionEvent): never {
  throw new Error(`Cannot ${event.type} while capture is ${snapshot.phase}.`);
}

export function transitionCaptureSession(
  snapshot: CaptureSessionSnapshot,
  event: CaptureSessionEvent,
): CaptureSessionSnapshot {
  if (event.type === 'reset') return createIdleCaptureSnapshot();
  if (event.type === 'fail') {
    return { ...snapshot, phase: 'error', pausedAt: undefined, lastError: event.message };
  }

  switch (event.type) {
    case 'request-source':
      if (!['idle', 'complete', 'error'].includes(snapshot.phase)) return invalidTransition(snapshot, event);
      return { ...createIdleCaptureSnapshot(), phase: 'requesting-source', sessionId: event.sessionId };
    case 'source-ready':
      if (snapshot.phase !== 'requesting-source') return invalidTransition(snapshot, event);
      return {
        ...snapshot,
        phase: 'previewing',
        selectedSurface: event.source.surface,
        dimensions: event.source.dimensions,
        hasDisplayAudio: event.source.hasDisplayAudio,
        hasMicrophoneAudio: event.source.hasMicrophoneAudio,
        cursorSupported: event.source.cursorSupported,
      };
    case 'start-recording':
      if (snapshot.phase !== 'previewing') return invalidTransition(snapshot, event);
      return {
        ...snapshot,
        phase: 'recording',
        activeTier: event.tier,
        startedAt: event.startedAt,
        elapsedSeconds: 0,
        pausedDurationMs: 0,
        storageWarnings: event.storageWarnings ?? [],
      };
    case 'pause':
      if (snapshot.phase !== 'recording') return invalidTransition(snapshot, event);
      return { ...snapshot, phase: 'paused', elapsedSeconds: elapsedSeconds(snapshot, event.at), pausedAt: event.at };
    case 'resume':
      if (snapshot.phase !== 'paused' || snapshot.pausedAt === undefined) return invalidTransition(snapshot, event);
      return {
        ...snapshot,
        phase: 'recording',
        pausedDurationMs: snapshot.pausedDurationMs + Math.max(0, event.at - snapshot.pausedAt),
        pausedAt: undefined,
      };
    case 'stop':
      if (snapshot.phase === 'stopping') return snapshot;
      if (snapshot.phase !== 'recording' && snapshot.phase !== 'paused') return invalidTransition(snapshot, event);
      return { ...snapshot, phase: 'stopping', elapsedSeconds: elapsedSeconds(snapshot, event.at), pausedAt: undefined };
    case 'source-lost':
      if (!ACTIVE_CAPTURE_PHASES.includes(snapshot.phase as (typeof ACTIVE_CAPTURE_PHASES)[number])) {
        return invalidTransition(snapshot, event);
      }
      if (snapshot.phase === 'recording' || snapshot.phase === 'paused' || snapshot.phase === 'stopping') {
        return {
          ...snapshot,
          phase: 'stopping',
          elapsedSeconds: elapsedSeconds(snapshot, event.at),
          pausedAt: undefined,
          sourceLost: true,
        };
      }
      return { ...snapshot, phase: 'error', sourceLost: true, lastError: SOURCE_LOST_MESSAGE };
    case 'complete':
      if (snapshot.phase !== 'stopping') return invalidTransition(snapshot, event);
      return {
        ...snapshot,
        phase: 'complete',
        elapsedSeconds: snapshot.elapsedSeconds,
        bytes: event.result.bytes,
        mimeType: event.result.mimeType,
        result: event.result,
      };
  }
}

export function getCaptureElapsedSeconds(snapshot: CaptureSessionSnapshot, now: number): number {
  return snapshot.phase === 'recording' || snapshot.phase === 'paused'
    ? elapsedSeconds(snapshot, now)
    : snapshot.elapsedSeconds;
}
