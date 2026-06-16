import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstWebCodecsProviderShadowParity,
  type WorkerFirstWebCodecsProviderShadowParityDeps,
} from '../../src/services/aiTools/workerFirstWebCodecsProviderShadowParity';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSourceSnapshot,
} from '../../src/services/aiTools/workerFirstCounterSources';
import {
  clearWorkerFirstProofCapturesForTests,
  getWorkerFirstProofCaptures,
} from '../../src/services/aiTools/workerFirstProofCaptures';

const mainFingerprint: FrameFingerprint = {
  sourceWidth: 16,
  sourceHeight: 16,
  sampleWidth: 16,
  sampleHeight: 16,
  pixelCount: 256,
  hash: '4595eb5f',
  nonBlankRatio: 0.2708,
  alphaCoverage: 1,
  avgRgb: { r: 42.25, g: 61.5, b: 82.75 },
  meanLuma: 61.4219,
  colorRange: { r: 220, g: 218, b: 212, luma: 216.8125 },
};

const blankFingerprint: FrameFingerprint = {
  ...mainFingerprint,
  hash: '00000000',
  nonBlankRatio: 0,
  avgRgb: { r: 0, g: 0, b: 0 },
  meanLuma: 0,
  colorRange: { r: 0, g: 0, b: 0, luma: 0 },
};

function createDeps(options: {
  readonly materializeResult?: ToolResult;
  readonly captureResults?: readonly ToolResult[];
  readonly workerFingerprint?: FrameFingerprint;
} = {}): WorkerFirstWebCodecsProviderShadowParityDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeMainFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'webcodecs-provider',
        fixture: {
          width: 1280,
          height: 720,
          durationSeconds: 2.25,
          webCodecs: { ready: true, fullMode: true, hasFrame: true, width: 1280, height: 720 },
          timelineSignals: ['video', 'webcodecs'],
        },
      },
    }),
    captureMainFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'webcodecs-provider',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          timelineSignals: ['video', 'webcodecs'],
          fingerprint: mainFingerprint,
        },
      }
    )),
    renderWorkerShadowFingerprint: vi.fn(async () => ({
      renderer: 'worker-offscreen-2d-webcodecs-provider',
      fingerprint: options.workerFingerprint ?? mainFingerprint,
      workerMs: 1.25,
    })),
  };
}

describe('worker-first webcodecs-provider shadow parity runner', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    vi.restoreAllMocks();
  });

  it('materializes the fixture, captures main fingerprints, renders worker shadow samples, and records parity', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstWebCodecsProviderShadowParity({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeMainFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'webcodecs-provider',
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureMainFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureMainFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 0,
      settleMs: 1500,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureMainFingerprint).toHaveBeenNthCalledWith(2, {
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 0.75,
      settleMs: 1500,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.captureMainFingerprint).toHaveBeenNthCalledWith(3, {
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 1.5,
      settleMs: 1500,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 0,
      width: 1280,
      height: 720,
    }), { sampleWidth: 12, sampleHeight: 10 });

    expect(result.data).toMatchObject({
      projectId: 'webcodecs-provider',
      manifestSampleTimesSeconds: [0, 0.75, 1.5],
      failures: [],
      w5StartPermissionsRemainStatsGuarded: true,
    });
    expect(getWorkerFirstProofCaptures().shadowSamples).toHaveLength(3);
    expect(getWorkerFirstProofCaptures().shadowSamples[0]).toMatchObject({
      projectId: 'webcodecs-provider',
      sampleTimeSeconds: 0,
      mainFingerprint,
      workerFingerprint: mainFingerprint,
    });
    expect(getWorkerFirstCounterSourceSnapshot().scheduler).toMatchObject({
      queueDepth: 0,
      counters: {
        admitted: 3,
        started: 3,
        completed: 3,
        dropped: 0,
      },
    });
    expect(getWorkerFirstCounterSourceSnapshot().presentedFrameId)
      .toBe('webcodecs-provider-worker-shadow:1.5');
  });

  it('rejects caller-supplied proof fields instead of recording spoofed parity', async () => {
    for (const args of [
      { mainFingerprint },
      { workerFingerprint: mainFingerprint },
      { fingerprint: mainFingerprint },
      { thresholds: { maxAvgRgbDelta: 9999 } },
      { source: 'worker-shadow-main' },
    ]) {
      const result = await handleRunWorkerFirstWebCodecsProviderShadowParity(args, createDeps());
      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be caller-supplied');
    }
    expect(getWorkerFirstProofCaptures().shadowSamples).toHaveLength(0);
  });

  it('does not run shadow rendering when fixture materialization fails', async () => {
    const deps = createDeps({
      materializeResult: {
        success: false,
        error: 'fixture failed',
      },
    });

    const result = await handleRunWorkerFirstWebCodecsProviderShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureMainFingerprint).not.toHaveBeenCalled();
    expect(deps.renderWorkerShadowFingerprint).not.toHaveBeenCalled();
  });

  it('returns failures when main capture is missing or worker parity is outside thresholds', async () => {
    const deps = createDeps({
      captureResults: [
        { success: false, error: 'missing webcodecs frame' },
        {
          success: true,
          data: { sampleTimeSeconds: 0.75, fingerprint: mainFingerprint },
        },
        {
          success: true,
          data: { sampleTimeSeconds: 1.5, fingerprint: mainFingerprint },
        },
      ],
      workerFingerprint: blankFingerprint,
    });

    const result = await handleRunWorkerFirstWebCodecsProviderShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('worker-shadow parity samples failed');
    expect(result.data).toMatchObject({
      failures: [
        { sampleTimeSeconds: 0, error: 'missing webcodecs frame' },
        { sampleTimeSeconds: 0.75 },
        { sampleTimeSeconds: 1.5 },
      ],
    });
    expect(getWorkerFirstProofCaptures().shadowSamples).toHaveLength(2);
    expect(getWorkerFirstCounterSourceSnapshot().scheduler).toMatchObject({
      queueDepth: 0,
      counters: {
        admitted: 3,
        started: 3,
        completed: 2,
        dropped: 1,
      },
    });
  });
});
