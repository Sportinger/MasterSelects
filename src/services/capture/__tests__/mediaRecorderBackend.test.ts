import { describe, expect, it, vi } from 'vitest';
import { MediaRecorderCaptureBackend } from '../recording/mediaRecorderBackend';
import type {
  CaptureRecoveryBlobStore,
  CaptureRecoveryChunkInput,
  CaptureRecoveryChunkRef,
} from '../recording/recoveryPersistence';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

class MemoryBlobStore implements CaptureRecoveryBlobStore {
  readonly writes: CaptureRecoveryChunkInput[] = [];
  async putChunk(input: CaptureRecoveryChunkInput): Promise<CaptureRecoveryChunkRef> {
    this.writes.push(input);
    return {
      artifactId: `artifact-${input.chunkIndex}`,
      chunkIndex: input.chunkIndex,
      mimeType: input.mimeType,
      bytes: input.blob.size,
      startedAt: input.startedAt,
      timeStart: input.timeStart,
      duration: input.duration,
    };
  }
  async getChunk(): Promise<Blob | null> { return null; }
}

class FakeMediaRecorder extends EventTarget {
  static supported = new Set<string>();
  static isTypeSupported(mimeType: string): boolean { return this.supported.has(mimeType); }
  state: RecordingState = 'inactive';
  readonly mimeType: string;
  readonly pause = vi.fn(() => {
    this.state = 'paused';
    this.dispatchEvent(new Event('pause'));
  });
  readonly resume = vi.fn(() => {
    this.state = 'recording';
    this.dispatchEvent(new Event('resume'));
  });
  readonly requestData = vi.fn(() => this.emit('tail'));
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? 'video/fallback';
  }
  start(): void { this.state = 'recording'; }
  stop(): void {
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }
  emit(value: string): void {
    const event = new Event('dataavailable') as BlobEvent;
    Object.defineProperty(event, 'data', { value: new Blob([value], { type: this.mimeType }) });
    this.dispatchEvent(event);
  }
}

function createBackend(now: () => number, blobStore = new MemoryBlobStore()) {
  return {
    backend: new MediaRecorderCaptureBackend({
      recorderConstructor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      blobStore,
      recoveryStorage: new MemoryStorage(),
      timesliceMs: 1000,
      now,
    }),
    blobStore,
  };
}

describe('MediaRecorderCaptureBackend', () => {
  it('probes MIME fallbacks, persists chunks, and returns only artifact refs', async () => {
    FakeMediaRecorder.supported = new Set(['video/webm']);
    let now = 1000;
    const { backend, blobStore } = createBackend(() => now);
    await backend.start({
      sessionId: 'session-1',
      source: {} as MediaStream,
      config: { tier: 'media-recorder', fps: 30, bitrateBitsPerSecond: 4_000_000 },
    });
    const recorder = (backend as unknown as { recorder: FakeMediaRecorder }).recorder;
    recorder.emit('first');
    now = 3000;
    const result = await backend.stop();

    expect(result).toMatchObject({ mimeType: 'video/webm', durationSeconds: 2, artifactIds: ['artifact-0', 'artifact-1'] });
    expect(blobStore.writes).toHaveLength(2);
    expect(result).not.toHaveProperty('blob');
    expect(backend).not.toHaveProperty('chunks');
  });

  it('maps pause and resume to MediaRecorder and excludes paused time', async () => {
    FakeMediaRecorder.supported = new Set(['video/webm']);
    let now = 1000;
    const { backend } = createBackend(() => now);
    await backend.start({
      sessionId: 'session-1',
      source: {} as MediaStream,
      config: { tier: 'media-recorder', fps: 30, bitrateBitsPerSecond: 4_000_000 },
    });
    const recorder = (backend as unknown as { recorder: FakeMediaRecorder }).recorder;
    now = 3000;
    await backend.pause();
    now = 8000;
    await backend.resume();
    now = 10000;
    const result = await backend.stop();

    expect(recorder.pause).toHaveBeenCalledOnce();
    expect(recorder.resume).toHaveBeenCalledOnce();
    expect(result.durationSeconds).toBe(4);
  });
});
