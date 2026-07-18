import { describe, expect, it, vi } from 'vitest';
import { CaptureLifecycle } from '../captureLifecycle';
import {
  createScreenCaptureService,
  type ScreenCaptureBackend,
} from '../ScreenCaptureService';
import type { CaptureSessionSnapshot } from '../recording/sessionTypes';

type JsonPrimitive = string | number | boolean | null;
type IsJsonSafe<T> = [Exclude<T, undefined>] extends [JsonPrimitive]
  ? true
  : Exclude<T, undefined> extends readonly (infer Item)[]
    ? IsJsonSafe<Item>
    : Exclude<T, undefined> extends (...args: never[]) => unknown
      ? false
      : Exclude<T, undefined> extends object
        ? false extends {
            [Key in keyof Exclude<T, undefined>]-?: IsJsonSafe<Exclude<T, undefined>[Key]>
          }[keyof Exclude<T, undefined>]
          ? false
          : true
        : false;
const snapshotHasNoRuntimeHandles: IsJsonSafe<CaptureSessionSnapshot> = true;

function createBackend(): ScreenCaptureBackend {
  return {
    start: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => ({
      sessionId: 'session-1',
      mimeType: 'video/webm',
      durationSeconds: 2,
      bytes: 4,
      artifactIds: ['artifact-1'],
    })),
    cancel: vi.fn(async () => undefined),
    getStats: () => ({ encodeQueueSize: 2, queuedPacketBytes: 1024, artifactBytes: 4096, outputBytes: 4000 }),
  };
}

describe('ScreenCaptureService', () => {
  it('owns idempotent teardown in one lifecycle', async () => {
    const lifecycle = new CaptureLifecycle();
    const cleanup = vi.fn();
    const finalize = vi.fn(async () => 'done');
    lifecycle.addCleanup(cleanup);

    const [first, second] = await Promise.all([
      lifecycle.teardownSession('stop', finalize),
      lifecycle.teardownSession('source-lost', finalize),
    ]);

    expect([first, second]).toEqual(['done', 'done']);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps runtime source handles out of serializable snapshots', async () => {
    expect(snapshotHasNoRuntimeHandles).toBe(true);
    const backend = createBackend();
    const service = createScreenCaptureService({ backend, storageManager: {}, now: () => 1000 });
    const stream = { getTracks: () => [] } as unknown as MediaStream;

    service.beginSourceSelection('session-1');
    service.attachSource({ stream }, {
      surface: 'window',
      dimensions: { width: 1280, height: 720 },
      hasDisplayAudio: false,
      cursorSupported: false,
    });
    await service.start({ tier: 'media-recorder', fps: 30, bitrateBitsPerSecond: 4_000_000 });

    const snapshot = service.getSnapshot();
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot).not.toHaveProperty('stream');
    const diagnostic = service.getDiagnosticState();
    expect(JSON.parse(JSON.stringify(diagnostic))).toEqual(diagnostic);
    expect(diagnostic).toMatchObject({
      backend: { encodeQueueSize: 2, queuedPacketBytes: 1024, artifactBytes: 4096, outputBytes: 4000 },
      hasPreviewSource: true,
    });
  });

  it('accounts pause time from the request and coalesces calls while the backend drains', async () => {
    let now = 1000;
    let releasePause!: () => void;
    const backend = createBackend();
    backend.pause = vi.fn(() => new Promise<void>(resolve => { releasePause = resolve; }));
    const service = createScreenCaptureService({ backend, storageManager: {}, now: () => now });
    service.beginSourceSelection('session-1');
    service.attachSource({ stream: { getTracks: () => [] } as unknown as MediaStream }, {
      surface: 'window',
      dimensions: { width: 1280, height: 720 },
      hasDisplayAudio: false,
      cursorSupported: false,
    });
    await service.start({ tier: 'media-recorder', fps: 30, bitrateBitsPerSecond: 4_000_000 });

    now = 4000;
    const firstPause = service.pause();
    const secondPause = service.pause();
    expect(secondPause).toBe(firstPause);
    expect(backend.pause).toHaveBeenCalledOnce();
    now = 9000;
    releasePause();
    await Promise.all([firstPause, secondPause]);

    expect(service.getSnapshot()).toMatchObject({ phase: 'paused', elapsedSeconds: 3, pausedAt: 4000 });
  });
});
