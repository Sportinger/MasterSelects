import { describe, expect, it, vi } from 'vitest';
import {
  ArtifactCaptureRecordingBlobStore,
  appendCaptureRecoveryChunk,
  readCaptureRecoveryEntries,
  upsertCaptureRecoveryEntry,
  writeCaptureRecoveryEntries,
  getCaptureRecoveryStorage,
} from '../recording/recoveryPersistence';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('capture recovery persistence', () => {
  it('round-trips the ledger and keeps chunks ordered', () => {
    const storage = new MemoryStorage();
    upsertCaptureRecoveryEntry(storage, {
      sessionId: 'session-1',
      status: 'active',
      tier: 'media-recorder',
      startedAt: 1000,
      chunks: [],
    });
    appendCaptureRecoveryChunk(storage, 'session-1', {
      artifactId: 'chunk-2', chunkIndex: 2, mimeType: 'video/webm', bytes: 2, startedAt: 1000, timeStart: 2,
    });
    appendCaptureRecoveryChunk(storage, 'session-1', {
      artifactId: 'chunk-1', chunkIndex: 1, mimeType: 'video/webm', bytes: 1, startedAt: 1000, timeStart: 1,
    });
    appendCaptureRecoveryChunk(storage, 'session-1', {
      artifactId: 'chunk-1', chunkIndex: 3, mimeType: 'video/webm', bytes: 1, startedAt: 1000, timeStart: 3,
    });

    expect(readCaptureRecoveryEntries(storage)[0]?.chunks.map(chunk => chunk.chunkIndex)).toEqual([1, 2, 3]);
    writeCaptureRecoveryEntries(storage, []);
    expect(readCaptureRecoveryEntries(storage)).toEqual([]);
  });

  it('uses the capture-specific artifact producer id', async () => {
    const put = vi.fn(async (_blob: Blob, _options: unknown) => 'artifact-1');
    const store = new ArtifactCaptureRecordingBlobStore({
      put,
      get: vi.fn(async () => null),
      delete: vi.fn(async () => undefined),
    });
    await store.putChunk({
      sessionId: 'session-1',
      chunkIndex: 0,
      blob: new Blob(['chunk'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      startedAt: 1000,
      timeStart: 0,
    });

    const options = put.mock.calls[0]?.[1] as { producer?: { providerId?: string } } | undefined;
    expect(options?.producer?.providerId).toBe('masterselects.capture.recording');
  });

  it('provides an in-memory ledger when localStorage is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('denied'); } });
    try {
      const storage = getCaptureRecoveryStorage();
      storage.setItem('capture-fallback-test', 'ok');
      expect(storage.getItem('capture-fallback-test')).toBe('ok');
      storage.removeItem('capture-fallback-test');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  });
});
