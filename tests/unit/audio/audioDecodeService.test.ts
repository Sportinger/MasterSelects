import { describe, expect, it, vi } from 'vitest';
import {
  AudioDecodeService,
  BROWSER_AUDIO_DECODE_DECODER_ID,
  type BrowserAudioDecodeRuntimeOptions,
} from '../../../src/services/audio/AudioDecodeService';
import type {
  AudioDecodeProgress,
  AudioDecodeRequest,
  AudioDecodeRuntime,
  AudioDecodeRuntimeContext,
  AudioDecodeRuntimeResult,
} from '../../../src/services/audio/audioDecodeTypes';

function createMockAudioBuffer(options: {
  numberOfChannels?: number;
  sampleRate?: number;
  length?: number;
} = {}): AudioBuffer {
  const numberOfChannels = options.numberOfChannels ?? 2;
  const sampleRate = options.sampleRate ?? 48_000;
  const length = options.length ?? sampleRate * 2;

  return {
    numberOfChannels,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn(() => new Float32Array(length)),
  } as unknown as AudioBuffer;
}

function createRequest(overrides: Partial<AudioDecodeRequest> = {}): AudioDecodeRequest {
  return {
    mediaFileId: 'media-a',
    sourceFingerprint: 'sha256:source-a',
    source: {
      kind: 'bytes',
      bytes: new Uint8Array([1, 2, 3, 4]),
      name: 'source.wav',
      mimeType: 'audio/wav',
    },
    ...overrides,
  };
}

function createClock(): () => string {
  let tick = 0;
  return () => `2026-05-25T10:00:${String(tick++).padStart(2, '0')}.000Z`;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('AudioDecodeService', () => {
  it('streams progress and completes with decode result metadata', async () => {
    const buffer = createMockAudioBuffer({ numberOfChannels: 2, sampleRate: 48_000, length: 96_000 });
    const progressEvents: AudioDecodeProgress[] = [];
    const runtime: AudioDecodeRuntime = {
      id: 'mock.decode',
      version: '2.0.0',
      kind: 'mock',
      decode: async (_request, context) => {
        context.reportProgress({ phase: 'reading', percent: 10, message: 'reading bytes' });
        const sourceBytes = new Uint8Array(await context.readSourceBytes());
        expect([...sourceBytes]).toEqual([1, 2, 3, 4]);
        context.reportProgress({ phase: 'decoding', percent: 60, message: 'mock decoding' });
        return {
          buffer,
          metadata: { fixture: 'runtime metadata' },
        };
      },
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-1',
      now: createClock(),
    });

    const result = await service.runDecodeJob(createRequest(), {
      onProgress: (progress) => progressEvents.push(progress),
    }).promise;

    expect(result.metadata).toMatchObject({
      schemaVersion: 1,
      jobId: 'decode-job-1',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      decoderId: 'mock.decode',
      decoderVersion: '2.0.0',
      runtimeKind: 'mock',
      fallbackUsed: false,
      source: {
        kind: 'bytes',
        size: 4,
        name: 'source.wav',
        mimeType: 'audio/wav',
      },
      sampleRate: 48_000,
      channelLayout: {
        kind: 'stereo',
        channelCount: 2,
        labels: ['L', 'R'],
      },
      duration: 2,
      length: 96_000,
      decodedPcmBytes: 2 * 96_000 * 4,
      runtimeMetadata: { fixture: 'runtime metadata' },
    });
    expect(result.buffer).toBe(buffer);
    expect(progressEvents.map((event) => event.phase)).toEqual([
      'queued',
      'decoding',
      'reading',
      'decoding',
      'complete',
    ]);
    expect(progressEvents.map((event) => event.percent)).toEqual([0, 1, 10, 60, 100]);
    expect(service.getJobSnapshot('decode-job-1')).toMatchObject({
      status: 'completed',
      progress: { phase: 'complete', percent: 100 },
    });
    expect(service.getActiveJobIds()).toEqual([]);
  });

  it('keeps runtime progress bounded and snapshots metadata from mutable inputs', async () => {
    const buffer = createMockAudioBuffer({ numberOfChannels: 6, sampleRate: 48_000, length: 48_000 });
    const progressEvents: AudioDecodeProgress[] = [];
    const requestMetadata = {
      label: 'dialog',
      nested: { take: 1 },
    };
    const runtimeMetadata = {
      decodedBy: 'fixture',
      nested: { gain: 1 },
    };
    const warningDetails = {
      measuredDuration: 1,
    };
    const runtime: AudioDecodeRuntime = {
      id: 'mock.decode',
      version: '2.0.0',
      kind: 'mock',
      decode: async (_request, context) => {
        context.reportProgress({ phase: 'reading', percent: -20, message: 'below bounds' });
        context.reportProgress({ phase: 'decoding', percent: 140, message: 'above bounds' });
        context.reportProgress({ phase: 'finalizing', percent: 40, message: 'must stay monotonic' });
        return {
          buffer,
          metadata: runtimeMetadata,
          warnings: [
            {
              code: 'duration-mismatch',
              message: 'Fixture duration mismatch',
              details: warningDetails,
            },
          ],
        };
      },
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-bounds',
      now: createClock(),
    });

    const result = await service.runDecodeJob(createRequest({ metadata: requestMetadata }), {
      onProgress: (progress) => progressEvents.push(progress),
    }).promise;

    expect(progressEvents.map((event) => event.percent)).toEqual([0, 1, 1, 99, 99, 100]);
    expect(result.metadata.channelLayout).toEqual({ kind: 'surround', channelCount: 6 });
    expect(result.metadata.requestMetadata).toEqual({
      label: 'dialog',
      nested: { take: 1 },
    });
    expect(result.metadata.runtimeMetadata).toEqual({
      decodedBy: 'fixture',
      nested: { gain: 1 },
    });
    expect(result.warnings[0].details).toEqual({ measuredDuration: 1 });

    requestMetadata.label = 'mutated';
    (requestMetadata.nested as { take: number }).take = 2;
    runtimeMetadata.decodedBy = 'mutated';
    (runtimeMetadata.nested as { gain: number }).gain = 2;
    warningDetails.measuredDuration = 2;

    expect(result.metadata.requestMetadata).toEqual({
      label: 'dialog',
      nested: { take: 1 },
    });
    expect(result.metadata.runtimeMetadata).toEqual({
      decodedBy: 'fixture',
      nested: { gain: 1 },
    });
    expect(result.warnings[0].details).toEqual({ measuredDuration: 1 });
  });

  it('cancels an in-flight runtime job and ignores late decode completion', async () => {
    let resolveDecode: (result: AudioDecodeRuntimeResult) => void = () => {};
    let runtimeContext: AudioDecodeRuntimeContext | null = null;
    const progressEvents: AudioDecodeProgress[] = [];
    const runtime: AudioDecodeRuntime = {
      id: 'mock.slow-decode',
      version: '1.0.0',
      kind: 'mock',
      decode: vi.fn((_request, context) => {
        runtimeContext = context;
        context.reportProgress({ phase: 'decoding', percent: 25, message: 'waiting' });
        return new Promise<AudioDecodeRuntimeResult>((resolve) => {
          resolveDecode = resolve;
        });
      }),
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-cancel',
      now: createClock(),
    });
    const handle = service.runDecodeJob(createRequest(), {
      onProgress: (progress) => progressEvents.push(progress),
    });

    await flushMicrotasks();
    expect(runtime.decode).toHaveBeenCalledTimes(1);

    handle.cancel('user stopped decode');

    await expect(handle.promise).rejects.toMatchObject({
      name: 'AudioDecodeCancelledError',
      code: 'cancelled',
      jobId: 'decode-job-cancel',
    });

    runtimeContext?.reportProgress({ phase: 'decoding', percent: 90, message: 'late progress' });
    resolveDecode({ buffer: createMockAudioBuffer() });
    await flushMicrotasks();

    expect(progressEvents.map((event) => event.phase)).not.toContain('complete');
    expect(progressEvents.at(-1)).toMatchObject({
      phase: 'cancelled',
      percent: 25,
    });
    expect(service.getJobSnapshot('decode-job-cancel')).toMatchObject({
      status: 'cancelled',
      errorCode: 'cancelled',
    });
    expect(service.getActiveJobIds()).toEqual([]);
  });

  it('cancels an in-flight job by job id', async () => {
    let resolveDecode: (result: AudioDecodeRuntimeResult) => void = () => {};
    const runtime: AudioDecodeRuntime = {
      id: 'mock.slow-decode',
      version: '1.0.0',
      kind: 'mock',
      decode: vi.fn((_request, context) => {
        context.reportProgress({ phase: 'decoding', percent: 30, message: 'waiting' });
        return new Promise<AudioDecodeRuntimeResult>((resolve) => {
          resolveDecode = resolve;
        });
      }),
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-cancel-by-id',
      now: createClock(),
    });
    const handle = service.runDecodeJob(createRequest());

    await flushMicrotasks();
    expect(service.cancelJob('decode-job-cancel-by-id', 'batch cancelled')).toBe(true);

    await expect(handle.promise).rejects.toMatchObject({
      name: 'AudioDecodeCancelledError',
      code: 'cancelled',
      jobId: 'decode-job-cancel-by-id',
    });

    resolveDecode({ buffer: createMockAudioBuffer() });
    await flushMicrotasks();

    expect(service.getJobSnapshot('decode-job-cancel-by-id')).toMatchObject({
      status: 'cancelled',
      progress: {
        phase: 'cancelled',
        percent: 30,
      },
    });
    expect(service.cancelJob('decode-job-cancel-by-id')).toBe(false);
  });

  it('honors already-aborted signals before invoking a runtime', async () => {
    const runtime: AudioDecodeRuntime = {
      id: 'mock.decode',
      version: '1.0.0',
      kind: 'mock',
      decode: vi.fn().mockResolvedValue({ buffer: createMockAudioBuffer() }),
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-pre-cancel',
      now: createClock(),
    });
    const controller = new AbortController();
    controller.abort('pre-cancelled');

    const handle = service.runDecodeJob(createRequest(), {
      signal: controller.signal,
    });

    await expect(handle.promise).rejects.toMatchObject({
      name: 'AudioDecodeCancelledError',
      code: 'cancelled',
      jobId: 'decode-job-pre-cancel',
    });
    expect(runtime.decode).not.toHaveBeenCalled();
    expect(service.getJobSnapshot('decode-job-pre-cancel')).toMatchObject({
      status: 'cancelled',
    });
  });

  it('cancels while runtime support probing is still pending', async () => {
    let resolveProbe: (supported: boolean) => void = () => {};
    const runtime: AudioDecodeRuntime = {
      id: 'mock.pending-probe',
      version: '1.0.0',
      kind: 'mock',
      canDecode: vi.fn(() => new Promise<boolean>((resolve) => {
        resolveProbe = resolve;
      })),
      decode: vi.fn().mockResolvedValue({ buffer: createMockAudioBuffer() }),
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-probe-cancel',
      now: createClock(),
    });
    const handle = service.runDecodeJob(createRequest());

    await flushMicrotasks();
    expect(runtime.canDecode).toHaveBeenCalledTimes(1);

    handle.cancel('probe cancelled');

    await expect(handle.promise).rejects.toMatchObject({
      name: 'AudioDecodeCancelledError',
      code: 'cancelled',
      jobId: 'decode-job-probe-cancel',
    });

    resolveProbe(true);
    await flushMicrotasks();

    expect(runtime.decode).not.toHaveBeenCalled();
    expect(service.getJobSnapshot('decode-job-probe-cancel')).toMatchObject({
      status: 'cancelled',
      progress: { phase: 'cancelled', percent: 0 },
    });
    expect(service.getActiveJobIds()).toEqual([]);
  });

  it('reports unsupported sources without invoking runtimes that decline support', async () => {
    const runtime: AudioDecodeRuntime = {
      id: 'mock.unsupported',
      version: '1.0.0',
      kind: 'mock',
      canDecode: vi.fn().mockResolvedValue(false),
      decode: vi.fn().mockResolvedValue({ buffer: createMockAudioBuffer() }),
    };
    const service = new AudioDecodeService({
      runtimes: [runtime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-unsupported',
      now: createClock(),
    });

    await expect(service.runDecodeJob(createRequest()).promise).rejects.toMatchObject({
      name: 'AudioDecodeServiceError',
      code: 'no-decoder-available',
      jobId: 'decode-job-unsupported',
      message: expect.stringContaining('bytes source, 4 bytes'),
    });

    expect(runtime.decode).not.toHaveBeenCalled();
    expect(service.getJobSnapshot('decode-job-unsupported')).toMatchObject({
      status: 'failed',
      errorCode: 'no-decoder-available',
      progress: { phase: 'failed', percent: 0 },
    });
  });

  it('reports runtime probe and decode failures with decoder identity', async () => {
    const probingRuntime: AudioDecodeRuntime = {
      id: 'mock.probe-fails',
      version: '1.0.0',
      kind: 'mock',
      canDecode: vi.fn().mockRejectedValue(new Error('probe exploded')),
      decode: vi.fn().mockResolvedValue({ buffer: createMockAudioBuffer() }),
    };
    const probingService = new AudioDecodeService({
      runtimes: [probingRuntime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-probe-failed',
      now: createClock(),
    });

    await expect(probingService.runDecodeJob(createRequest()).promise).rejects.toMatchObject({
      name: 'AudioDecodeServiceError',
      code: 'runtime-probe-failed',
      jobId: 'decode-job-probe-failed',
      message: expect.stringContaining('mock.probe-fails'),
    });

    const decodingRuntime: AudioDecodeRuntime = {
      id: 'mock.decode-fails',
      version: '1.0.0',
      kind: 'mock',
      decode: vi.fn().mockRejectedValue(new Error('codec exploded')),
    };
    const decodingService = new AudioDecodeService({
      runtimes: [decodingRuntime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-decode-failed',
      now: createClock(),
    });

    await expect(decodingService.runDecodeJob(createRequest()).promise).rejects.toMatchObject({
      name: 'AudioDecodeServiceError',
      code: 'decode-failed',
      jobId: 'decode-job-decode-failed',
      message: expect.stringContaining('mock.decode-fails'),
    });
    expect(decodingService.getJobSnapshot('decode-job-decode-failed')).toMatchObject({
      status: 'failed',
      runtimeId: 'mock.decode-fails',
      errorCode: 'decode-failed',
    });
  });

  it('rejects invalid and oversized runtime decode results before completion', async () => {
    const invalidRuntime: AudioDecodeRuntime = {
      id: 'mock.invalid-buffer',
      version: '1.0.0',
      kind: 'mock',
      decode: vi.fn().mockResolvedValue({
        buffer: createMockAudioBuffer({ numberOfChannels: 0 }),
      }),
    };
    const invalidService = new AudioDecodeService({
      runtimes: [invalidRuntime],
      enableBrowserFallback: false,
      createJobId: () => 'decode-job-invalid',
      now: createClock(),
    });

    await expect(invalidService.runDecodeJob(createRequest()).promise).rejects.toMatchObject({
      name: 'AudioDecodeServiceError',
      code: 'invalid-decode-result',
      jobId: 'decode-job-invalid',
    });
    expect(invalidService.getJobSnapshot('decode-job-invalid')).toMatchObject({
      status: 'failed',
      progress: { phase: 'failed' },
    });

    const oversizedRuntime: AudioDecodeRuntime = {
      id: 'mock.huge-buffer',
      version: '1.0.0',
      kind: 'mock',
      decode: vi.fn().mockResolvedValue({
        buffer: createMockAudioBuffer({ numberOfChannels: 2, length: 1_000 }),
      }),
    };
    const oversizedService = new AudioDecodeService({
      runtimes: [oversizedRuntime],
      enableBrowserFallback: false,
      limits: {
        maxDecodedPcmBytes: 7_999,
      },
      createJobId: () => 'decode-job-output-too-large',
      now: createClock(),
    });

    await expect(oversizedService.runDecodeJob(createRequest()).promise).rejects.toMatchObject({
      name: 'AudioDecodeServiceError',
      code: 'decode-output-too-large',
      jobId: 'decode-job-output-too-large',
      message: expect.stringContaining('8000 PCM bytes'),
    });
    expect(oversizedService.getJobSnapshot('decode-job-output-too-large')).toMatchObject({
      status: 'failed',
      progress: { phase: 'failed' },
    });
  });

  it('uses the bounded browser fallback and rejects sources above the fallback byte limit', async () => {
    const decodedBuffer = createMockAudioBuffer({ numberOfChannels: 1, sampleRate: 44_100, length: 44_100 });
    const decodeAudioData = vi.fn().mockResolvedValue(decodedBuffer);
    const close = vi.fn().mockResolvedValue(undefined);
    const browserOptions: BrowserAudioDecodeRuntimeOptions = {
      limits: {
        maxSourceBytes: 4,
        maxDecodedPcmBytes: 1_000_000,
      },
      createAudioContext: () => ({
        decodeAudioData,
        close,
      }) as unknown as AudioContext,
    };
    const service = new AudioDecodeService({
      ...browserOptions,
      runtimes: [],
      createJobId: () => 'decode-job-fallback',
      now: createClock(),
    });

    const result = await service.runDecodeJob(createRequest()).promise;

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(result.metadata).toMatchObject({
      decoderId: BROWSER_AUDIO_DECODE_DECODER_ID,
      runtimeKind: 'browser-fallback',
      fallbackUsed: true,
      channelLayout: { kind: 'mono', channelCount: 1, labels: ['M'] },
    });
    expect(result.warnings[0]).toMatchObject({ code: 'decode-fallback' });

    const oversizedService = new AudioDecodeService({
      ...browserOptions,
      limits: {
        maxSourceBytes: 3,
        maxDecodedPcmBytes: 1_000_000,
      },
      runtimes: [],
      createJobId: () => 'decode-job-too-large',
      now: createClock(),
    });

    await expect(oversizedService.runDecodeJob(createRequest()).promise).rejects.toMatchObject({
      name: 'AudioDecodeServiceError',
      code: 'browser-fallback-source-too-large',
      jobId: 'decode-job-too-large',
    });
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
  });
});
