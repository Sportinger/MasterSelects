import { describe, expect, it } from 'vitest';
import { blobToArrayBuffer } from '../../../artifacts/hash';
import {
  reassembleCaptureRecoveryRecording,
  type CaptureRecoveryBlobStore,
  type CaptureRecoveryChunkRef,
  type CaptureRecoveryEntry,
} from '../recording/recoveryPersistence';

function ref(chunkIndex: number, position: number | undefined, bytes: number): CaptureRecoveryChunkRef {
  return {
    artifactId: `artifact-${chunkIndex}`,
    chunkIndex,
    position,
    bytes,
    mimeType: 'video/mp4',
    startedAt: 1,
    timeStart: 0,
  };
}

function entry(chunks: CaptureRecoveryChunkRef[]): CaptureRecoveryEntry {
  return { sessionId: 'capture-1', status: 'active', tier: 'webcodecs', startedAt: 1, mimeType: 'video/mp4', chunks };
}

describe('capture recovery reassembly', () => {
  it('replays positioned runs in write order with byte-exact overwrite semantics', async () => {
    const chunks = [ref(0, 0, 4), ref(1, 2, 2), ref(2, 6, 1)];
    const data = new Map([
      ['artifact-0', new Blob([new Uint8Array([1, 2, 3, 4])])],
      ['artifact-1', new Blob([new Uint8Array([9, 8])])],
      ['artifact-2', new Blob([new Uint8Array([7])])],
    ]);
    const store = { getChunk: async (chunk: CaptureRecoveryChunkRef) => data.get(chunk.artifactId) ?? null } as CaptureRecoveryBlobStore;

    const restored = await reassembleCaptureRecoveryRecording(entry(chunks), store);

    expect([...new Uint8Array(await blobToArrayBuffer(restored))]).toEqual([1, 2, 9, 8, 0, 0, 7]);
  });

  it('keeps Tier A chunks as ordered best-effort concatenation', async () => {
    const chunks = [ref(1, undefined, 1), ref(0, undefined, 1)];
    const store = {
      getChunk: async (chunk: CaptureRecoveryChunkRef) => new Blob([chunk.chunkIndex === 0 ? 'A' : 'B']),
    } as CaptureRecoveryBlobStore;

    const restored = await reassembleCaptureRecoveryRecording(entry(chunks), store);
    expect(new TextDecoder().decode(await blobToArrayBuffer(restored))).toBe('AB');
  });
});
