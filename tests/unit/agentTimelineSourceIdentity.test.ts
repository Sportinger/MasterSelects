import { describe, expect, it, vi } from 'vitest';
import { createSourceIdentity } from '../../src/services/agentTimeline/sourceIdentityService';

function bytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => index % 251);
}

function traceSlices(source: Blob): { source: Blob; calls: Array<[number, number]> } {
  const calls: Array<[number, number]> = [];
  const slice = source.slice.bind(source);
  return {
    source: {
      size: source.size,
      type: source.type,
      slice(start = 0, end = source.size, contentType?: string): Blob {
        calls.push([start, end]);
        return slice(start, end, contentType);
      },
    } as Blob,
    calls,
  };
}

function uint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function textField(value: string): Uint8Array[] {
  const bytes = new TextEncoder().encode(value);
  return [uint64(bytes.byteLength), bytes];
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function expectedFullHash(data: Uint8Array, mediaType: string): Promise<string> {
  const canonical = concatenate([
    ...textField('agent-timeline-source-identity/v1'),
    ...textField('source-identity'),
    ...textField('full-stream'),
    uint64(data.byteLength),
    ...textField(mediaType),
    data,
  ]);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', canonical);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe('createSourceIdentity', () => {
  it('is versioned and stable for equivalent File and Blob data', async () => {
    const data = bytes(1024);
    const blob = new Blob([data], { type: 'video/mp4' });
    const file = new File([data], 'renamed-source.mp4', { type: 'video/mp4', lastModified: 1 });

    const [blobIdentity, fileIdentity] = await Promise.all([
      createSourceIdentity(blob),
      createSourceIdentity(file),
    ]);

    expect(blobIdentity).toEqual(fileIdentity);
    expect(blobIdentity).toMatchObject({
      type: 'source-identity',
      version: 'agent-timeline-source-identity/v1',
      strategy: 'sampled-chunks',
      hashAlgorithm: 'sha-256',
      metadata: { size: 1024, mediaType: 'video/mp4' },
    });
    expect(blobIdentity.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses bounded, deterministic sample reads instead of reading a whole large Blob', async () => {
    const blob = new Blob([bytes(2 * 1024 * 1024 + 17)], { type: 'video/webm' });
    const { source, calls } = traceSlices(blob);

    await createSourceIdentity(source);

    expect(calls).toHaveLength(5);
    for (const [start, end] of calls) {
      expect(end - start).toBeLessThanOrEqual(256 * 1024);
    }
    expect(calls[0]).toEqual([0, 256 * 1024]);
    expect(calls[4]).toEqual([source.size - 256 * 1024, source.size]);
  });

  it('streams a strong full hash in configured chunks and reports progress', async () => {
    const data = bytes(25);
    const { source, calls } = traceSlices(new Blob([data], { type: 'audio/wav' }));
    const progress = vi.fn();

    const identity = await createSourceIdentity(source, {
      strategy: 'full-stream',
      chunkSizeBytes: 8,
      onProgress: progress,
    });

    expect(identity.strategy).toBe('full-stream');
    await expect(expectedFullHash(data, 'audio/wav')).resolves.toBe(identity.hash);
    expect(calls).toEqual([[0, 8], [8, 16], [16, 24], [24, 25]]);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      bytesRead: 25,
      totalBytes: 25,
      fraction: 1,
    }));
  });

  it('honors cancellation before additional Blob chunks are read', async () => {
    const blob = new Blob([bytes(32)]);
    const controller = new AbortController();
    let reads = 0;
    const source = {
      size: blob.size,
      type: blob.type,
      slice(start = 0, end = blob.size, contentType?: string): Blob {
        reads += 1;
        if (reads === 1) controller.abort();
        return blob.slice(start, end, contentType);
      },
    } as Blob;

    await expect(createSourceIdentity(source, {
      strategy: 'full-stream',
      chunkSizeBytes: 8,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(reads).toBe(1);
  });
});
