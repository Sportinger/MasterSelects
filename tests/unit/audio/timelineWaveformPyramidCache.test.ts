import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress,
  mapSourceWaveformPyramidProgress,
} from '../../../src/services/audio/timelineWaveformPyramidCache';
import { installInProcessWaveformWorker } from '../../helpers/inProcessWaveformWorker';

installInProcessWaveformWorker();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createMockAudioBuffer(samples: number[], sampleRate = 48_000): AudioBuffer {
  const data = Float32Array.from(samples);
  return {
    numberOfChannels: 1,
    sampleRate,
    length: data.length,
    duration: data.length / sampleRate,
    getChannelData: vi.fn(() => data),
    copyFromChannel: vi.fn((destination: Float32Array, _channelIndex: number, offset = 0) => {
      destination.set(data.subarray(offset, offset + destination.length));
    }),
  } as unknown as AudioBuffer;
}

describe('timeline waveform analysis cache', () => {
  const originalAudioContext = globalThis.AudioContext;

  afterEach(() => {
    vi.restoreAllMocks();
    const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
    if (originalAudioContext) {
      globalScope.AudioContext = originalAudioContext;
    } else {
      delete globalScope.AudioContext;
    }
  });

  it('shares an active source waveform job with later callers and fans out progress', async () => {
    const decodeDeferred = createDeferred<AudioBuffer>();
    const contexts: Array<{
      decodeAudioData: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const globalScope = globalThis as typeof globalThis & { AudioContext?: typeof AudioContext };
    class MockAudioContext {
      decodeAudioData = vi.fn(() => decodeDeferred.promise);
      close = vi.fn().mockResolvedValue(undefined);

      constructor() {
        contexts.push(this);
      }
    }
    globalScope.AudioContext = MockAudioContext as unknown as typeof AudioContext;

    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const file = {
      name: 'shared.wav',
      size: bytes.byteLength,
      lastModified: 123,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.slice(0)),
    } as unknown as File;
    const firstProgress: number[] = [];
    const secondProgress: number[] = [];

    const first = generateTimelineWaveformAnalysisForFile(file, {
      includePyramid: false,
      reusePersisted: false,
      mediaFileId: 'media-shared',
      onProgress: (progress) => firstProgress.push(progress),
    });
    const second = generateTimelineWaveformAnalysisForFile(file, {
      includePyramid: false,
      reusePersisted: false,
      mediaFileId: 'media-shared',
      onProgress: (progress) => secondProgress.push(progress),
    });

    // The decode is queued as background source work, so the shared job starts asynchronously.
    await vi.waitFor(() => expect(file.arrayBuffer).toHaveBeenCalledTimes(1));
    expect(contexts).toHaveLength(1);

    decodeDeferred.resolve(createMockAudioBuffer([0, 0.25, -0.5, 1]));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(firstResult.waveform.length).toBeGreaterThan(0);
    expect(firstProgress.at(-1)).toBe(100);
    expect(secondProgress).toContain(100);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(contexts[0].close).toHaveBeenCalledTimes(1);
  });

  it('maps quick preview and long pyramid work to a steadier source waveform progress curve', () => {
    expect(mapSourceWaveformPreviewProgress(0)).toBe(0);
    expect(mapSourceWaveformPreviewProgress(70)).toBe(20);
    expect(mapSourceWaveformPyramidProgress({
      jobId: 'job',
      mediaFileId: 'media',
      sourceFingerprint: 'sha256:source',
      phase: 'queued',
      percent: 0,
      timestamp: '2026-05-27T00:00:00.000Z',
      cacheKey: 'cache',
    })).toBe(20);
    expect(mapSourceWaveformPyramidProgress({
      jobId: 'job',
      mediaFileId: 'media',
      sourceFingerprint: 'sha256:source',
      phase: 'analyzing',
      percent: 75,
      timestamp: '2026-05-27T00:00:00.000Z',
      cacheKey: 'cache',
    })).toBe(79);
    expect(mapSourceWaveformPyramidProgress({
      jobId: 'job',
      mediaFileId: 'media',
      sourceFingerprint: 'sha256:source',
      phase: 'storing-payloads',
      percent: 95,
      timestamp: '2026-05-27T00:00:00.000Z',
      cacheKey: 'cache',
    })).toBe(95);
  });
});
