import { describe, expect, it } from 'vitest';
import { transitionCaptureSession } from '../recording/sessionStateMachine';
import { createIdleCaptureSnapshot } from '../recording/sessionTypes';

const source = {
  surface: 'monitor' as const,
  dimensions: { width: 1920, height: 1080 },
  hasDisplayAudio: true,
  cursorSupported: true,
};

function recordingSnapshot() {
  let snapshot = transitionCaptureSession(createIdleCaptureSnapshot(), { type: 'request-source', sessionId: 'session-1' });
  snapshot = transitionCaptureSession(snapshot, { type: 'source-ready', source });
  return transitionCaptureSession(snapshot, { type: 'start-recording', tier: 'media-recorder', startedAt: 1000 });
}

describe('capture session state machine', () => {
  it('tracks recording pause time without counting the paused interval', () => {
    let snapshot = transitionCaptureSession(recordingSnapshot(), { type: 'pause', at: 4000 });
    expect(snapshot).toMatchObject({ phase: 'paused', elapsedSeconds: 3, pausedAt: 4000 });

    snapshot = transitionCaptureSession(snapshot, { type: 'resume', at: 9000 });
    snapshot = transitionCaptureSession(snapshot, { type: 'stop', at: 11000 });
    expect(snapshot).toMatchObject({ phase: 'stopping', elapsedSeconds: 5, pausedDurationMs: 5000 });

    snapshot = transitionCaptureSession(snapshot, {
      type: 'complete',
      at: 16000,
      result: { sessionId: 'session-1', mimeType: 'video/webm', durationSeconds: 5, bytes: 1, artifactIds: [] },
    });
    expect(snapshot.elapsedSeconds).toBe(5);
  });

  it.each([
    ['requesting-source', () => transitionCaptureSession(createIdleCaptureSnapshot(), { type: 'request-source', sessionId: 's' }), 'error'],
    ['previewing', () => transitionCaptureSession(transitionCaptureSession(createIdleCaptureSnapshot(), { type: 'request-source', sessionId: 's' }), { type: 'source-ready', source }), 'error'],
    ['recording', recordingSnapshot, 'stopping'],
    ['paused', () => transitionCaptureSession(recordingSnapshot(), { type: 'pause', at: 2000 }), 'stopping'],
    ['stopping', () => transitionCaptureSession(recordingSnapshot(), { type: 'stop', at: 2000 }), 'stopping'],
  ] as const)('handles source loss while %s', (_phase, makeSnapshot, expectedPhase) => {
    expect(transitionCaptureSession(makeSnapshot(), { type: 'source-lost', at: 3000 })).toMatchObject({
      phase: expectedPhase,
      sourceLost: true,
    });
  });
});
