import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_WORKER_PROTOCOL_VERSION,
  WorkerRuntimeHost,
  type RuntimeWorkerOutboundMessage,
} from '../../../src/runtime/worker';
import {
  createAudioIntelligenceWorkerHandlers,
  type AudioIntelligenceWorkerHandlerOptions,
  type VadSessionLike,
} from '../../../src/services/audio/intelligence/worker/handlers';
import type {
  AudioIntelligenceVadJobInput,
  AudioIntelligenceVadJobOutput,
} from '../../../src/services/audio/intelligence/audioIntelligenceTypes';
import type { VoiceActivityConfig } from '../../../src/services/audio/voiceActivityManifest';

const CONFIG: VoiceActivityConfig = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSpeechMs: 250,
  minSilenceMs: 100,
  padMs: 30,
  frameSamples: 512,
};

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await wait();
  }
  throw new Error('Timed out waiting for runtime worker event');
}

async function waitForTerminal(
  events: RuntimeWorkerOutboundMessage[],
  jobId: string,
): Promise<RuntimeWorkerOutboundMessage> {
  const isTerminal = (event: RuntimeWorkerOutboundMessage) => (
    event.type === 'runtime.job.completed'
    || event.type === 'runtime.job.failed'
    || event.type === 'runtime.job.cancelled'
  ) && event.jobId === jobId;
  await waitFor(() => events.some(isTerminal));
  const terminal = events.find(isTerminal);
  if (!terminal) {
    throw new Error('Runtime job did not produce a terminal event');
  }
  return terminal;
}

interface FakeSessionOptions {
  probabilities?: Float32Array;
  hangUntilAborted?: boolean;
}

function createHarness(
  sessionOptions: FakeSessionOptions = {},
  handlerOptions: Partial<Omit<AudioIntelligenceWorkerHandlerOptions, 'createSession'>> = {},
) {
  const events: RuntimeWorkerOutboundMessage[] = [];
  const transferLists: Transferable[][] = [];
  const releaseCalls: number[] = [];
  let sessionIndex = 0;

  const createSession = vi.fn(async (modelBytes: ArrayBuffer): Promise<VadSessionLike> => {
    expect(modelBytes.byteLength).toBeGreaterThan(0);
    const index = sessionIndex;
    sessionIndex += 1;
    return {
      process: async (_pcm, options) => {
        if (sessionOptions.hangUntilAborted) {
          for (;;) {
            await wait();
            options?.checkAborted?.();
          }
        }
        const probabilities = sessionOptions.probabilities ?? new Float32Array(0);
        options?.onProgress?.(probabilities.length, probabilities.length);
        return probabilities;
      },
      release: () => {
        releaseCalls.push(index);
      },
    };
  });

  const host = new WorkerRuntimeHost({
    handlers: createAudioIntelligenceWorkerHandlers({ createSession, ...handlerOptions }),
    now: () => '2026-07-28T00:00:00.000Z',
    postMessage: (message, transfer = []) => {
      events.push(message);
      transferLists.push(transfer);
    },
  });

  const startJob = (jobId: string, handlerId: string, input: unknown) => {
    host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.start',
      job: {
        jobId,
        providerId: 'masterselects.audio-intelligence',
        handlerId,
        input,
      },
    });
  };

  const init = async (jobId = 'job-init') => {
    startJob(jobId, 'audio-intel.init', {
      modelId: 'silero-vad',
      modelVersion: 'v5.1.2',
      modelBytes: new Uint8Array([1, 2, 3, 4]).buffer,
    });
    return waitForTerminal(events, jobId);
  };

  const vadInput = (overrides: Partial<AudioIntelligenceVadJobInput> = {}): AudioIntelligenceVadJobInput => ({
    pcm: new Float32Array(512 * 10),
    sampleRate: 16_000,
    offsetSeconds: 0,
    config: CONFIG,
    ...overrides,
  });

  return { host, events, transferLists, createSession, releaseCalls, startJob, init, vadInput };
}

describe('audio intelligence worker handlers', () => {
  it('initializes a session and reports the model identity', async () => {
    const harness = createHarness();

    const terminal = await harness.init();

    expect(terminal).toMatchObject({
      type: 'runtime.job.completed',
      output: { backend: 'wasm', modelId: 'silero-vad', modelVersion: 'v5.1.2' },
    });
    expect(harness.createSession).toHaveBeenCalledTimes(1);
  });

  it('runs VAD inference plus segmentation and transfers the probability buffer', async () => {
    const probabilities = new Float32Array(10).fill(0.9);
    const harness = createHarness({ probabilities });
    await harness.init();

    harness.startJob('job-vad', 'audio-intel.vad', harness.vadInput({ offsetSeconds: 2 }));
    const terminal = await waitForTerminal(harness.events, 'job-vad');

    expect(terminal.type).toBe('runtime.job.completed');
    const output = (terminal as { output: AudioIntelligenceVadJobOutput }).output;
    expect(output.probabilityHop).toBeCloseTo(512 / 16_000, 9);
    expect(output.segments).toHaveLength(1);
    expect(output.segments[0].start).toBeCloseTo(2, 5);
    expect(output.segments[0].end).toBeCloseTo(2 + 10 * (512 / 16_000), 5);
    expect(output.segments[0].confidence).toBeCloseTo(0.9, 5);
    expect(output.probabilities).toBeInstanceOf(Float32Array);

    const completedIndex = harness.events.findIndex((event) => (
      event.type === 'runtime.job.completed' && event.jobId === 'job-vad'
    ));
    expect(harness.transferLists[completedIndex]).toContain(output.probabilities!.buffer);
    expect(harness.events.some((event) => (
      event.type === 'runtime.job.progress' && event.jobId === 'job-vad'
    ))).toBe(true);
  });

  it('fails a VAD job when no session has been initialized', async () => {
    const harness = createHarness();

    harness.startJob('job-vad-uninitialized', 'audio-intel.vad', harness.vadInput());
    const terminal = await waitForTerminal(harness.events, 'job-vad-uninitialized');

    expect(terminal).toMatchObject({
      type: 'runtime.job.failed',
      error: { message: expect.stringContaining('audio-intel.init') },
    });
  });

  it('fails a VAD job with a non-16kHz sample rate', async () => {
    const harness = createHarness();
    await harness.init();

    harness.startJob('job-vad-rate', 'audio-intel.vad', harness.vadInput({
      sampleRate: 48_000 as unknown as AudioIntelligenceVadJobInput['sampleRate'],
    }));
    const terminal = await waitForTerminal(harness.events, 'job-vad-rate');

    expect(terminal).toMatchObject({
      type: 'runtime.job.failed',
      error: { message: expect.stringContaining('16000') },
    });
  });

  it('fails a VAD job when frameSamples does not match Silero inference', async () => {
    const harness = createHarness();
    await harness.init();

    harness.startJob('job-vad-frame-size', 'audio-intel.vad', harness.vadInput({
      config: { ...CONFIG, frameSamples: 256 },
    }));
    const terminal = await waitForTerminal(harness.events, 'job-vad-frame-size');

    expect(terminal).toMatchObject({
      type: 'runtime.job.failed',
      error: { message: expect.stringContaining('frameSamples=512') },
    });
  });

  it('cancels a running VAD job through the abort signal', async () => {
    const harness = createHarness({ hangUntilAborted: true });
    await harness.init();

    harness.startJob('job-vad-cancel', 'audio-intel.vad', harness.vadInput());
    await waitFor(() => harness.events.some((event) => (
      event.type === 'runtime.job.running' && event.jobId === 'job-vad-cancel'
    )));
    harness.host.handleMessage({
      protocolVersion: RUNTIME_WORKER_PROTOCOL_VERSION,
      type: 'runtime.job.cancel',
      jobId: 'job-vad-cancel',
      reason: 'user cancelled',
    });

    const terminal = await waitForTerminal(harness.events, 'job-vad-cancel');
    expect(terminal).toMatchObject({
      type: 'runtime.job.cancelled',
      reason: 'user cancelled',
    });
  });

  it('releases the previous session when initialized again', async () => {
    const harness = createHarness();
    await harness.init('job-init-1');
    await harness.init('job-init-2');

    expect(harness.createSession).toHaveBeenCalledTimes(2);
    expect(harness.releaseCalls).toEqual([0]);
  });

  it('loads and releases a PCM token and runs an injected alignment handler through the host', async () => {
    const refineWordTimings = vi.fn(() => [{
      wordId: 'word-1',
      alignedStart: 2.1,
      alignedEnd: 2.5,
      confidence: 0.95,
    }]);
    const harness = createHarness({}, { refineWordTimings });
    harness.startJob('job-load-pcm', 'audio-intel.load-pcm', {
      pcm: new Float32Array(320).fill(0.25),
      sampleRate: 16_000,
      offsetSeconds: 2,
    });
    const loaded = await waitForTerminal(harness.events, 'job-load-pcm');
    expect(loaded.type).toBe('runtime.job.completed');
    const loadOutput = (loaded as {
      output: { token: string; energy: { values: Float32Array; hopSeconds: number; startSeconds: number } };
    }).output;
    expect(loadOutput.token).toBeTruthy();
    expect(loadOutput.energy.hopSeconds).toBe(0.01);
    expect(loadOutput.energy.startSeconds).toBe(2);
    expect(loadOutput.energy.values).toHaveLength(2);
    const loadIndex = harness.events.indexOf(loaded);
    expect(harness.transferLists[loadIndex]).toContain(loadOutput.energy.values.buffer);

    harness.startJob('job-align', 'audio-intel.align', {
      token: loadOutput.token,
      words: [{ id: 'word-1', text: 'hello', start: 2, end: 2.4 }],
      wordSource: 'provider',
      vadSegments: [{ start: 2, end: 3, confidence: 0.9 }],
    });
    const aligned = await waitForTerminal(harness.events, 'job-align');
    expect(aligned).toMatchObject({
      type: 'runtime.job.completed',
      output: [{ wordId: 'word-1', alignedStart: 2.1, alignedEnd: 2.5 }],
    });
    expect(refineWordTimings).toHaveBeenCalledWith(expect.objectContaining({
      energy: expect.objectContaining({ hopSeconds: 0.01, startSeconds: 2 }),
    }));

    harness.startJob('job-release-pcm', 'audio-intel.release-pcm', { token: loadOutput.token });
    expect(await waitForTerminal(harness.events, 'job-release-pcm')).toMatchObject({
      type: 'runtime.job.completed',
      output: { released: true },
    });
    harness.startJob('job-align-released', 'audio-intel.align', {
      token: loadOutput.token,
      words: [],
      wordSource: 'provider',
      vadSegments: [],
    });
    expect(await waitForTerminal(harness.events, 'job-align-released')).toMatchObject({
      type: 'runtime.job.failed',
      error: { message: expect.stringContaining('unavailable') },
    });
  });
});
