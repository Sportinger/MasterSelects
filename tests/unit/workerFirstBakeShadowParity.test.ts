import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstBakeShadowParity,
  type WorkerFirstBakeShadowParityDeps,
} from '../../src/services/aiTools/workerFirstBakeShadowParity';
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
  hash: 'b511ec5f',
  nonBlankRatio: 0.3164,
  alphaCoverage: 1,
  avgRgb: { r: 32.5, g: 44.25, b: 56.75 },
  meanLuma: 42.125,
  colorRange: { r: 240, g: 193, b: 124, luma: 193.2452 },
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
} = {}): WorkerFirstBakeShadowParityDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeAndCaptureMainFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'bake',
        fixture: {
          clipBake: {
            status: 'baked',
            completed: true,
            cachedFrameCount: 65,
            cachedRanges: [{ start: 0, end: 2.17 }],
          },
          compositionBake: {
            status: 'baked',
            completed: true,
            proxyReady: true,
          },
          timelineSignals: ['clip-bake', 'composition-bake', 'image', 'solid', 'text'],
        },
      },
    }),
    captureMainFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'bake',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          cachedFrameHit: true,
          fingerprint: mainFingerprint,
        },
      }
    )),
    renderWorkerShadowFingerprint: vi.fn(async () => ({
      renderer: 'worker-offscreen-2d-bake',
      fingerprint: options.workerFingerprint ?? mainFingerprint,
      workerMs: 1.25,
    })),
  };
}

describe('worker-first bake shadow parity runner', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    vi.restoreAllMocks();
  });

  it('materializes the fixture, captures baked main fingerprints, renders worker shadow samples, and records parity', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstBakeShadowParity({
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeAndCaptureMainFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'bake',
      restoreTimelineAfterRun: false,
      sampleWidth: 12,
      sampleHeight: 10,
      settleMs: 80,
    }));
    expect(deps.captureMainFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureMainFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'bake',
      sampleTimeSeconds: 0,
      settleMs: 80,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'bake',
      sampleTimeSeconds: 0,
      width: 1280,
      height: 720,
    }), { sampleWidth: 12, sampleHeight: 10 });

    expect(result.data).toMatchObject({
      projectId: 'bake',
      manifestSampleTimesSeconds: [0, 1, 2],
      failures: [],
      w5StartPermissionsRemainStatsGuarded: true,
    });

    const captures = getWorkerFirstProofCaptures();
    expect(captures.shadowSamples).toHaveLength(3);
    expect(captures.shadowSamples[0]).toMatchObject({
      projectId: 'bake',
      sampleTimeSeconds: 0,
      mainFingerprint,
      workerFingerprint: mainFingerprint,
    });

    const counters = getWorkerFirstCounterSourceSnapshot();
    expect(counters.scheduler).toMatchObject({
      queueDepth: 0,
      counters: {
        admitted: 3,
        started: 3,
        completed: 3,
        dropped: 0,
      },
    });
    expect(counters.cache).toMatchObject({
      entries: 0,
      bytes: 0,
      counters: { leakChecks: 1 },
    });
    expect(counters.providers).toEqual([]);
    expect(counters.providerWaitMs).toBe(0);
    expect(counters.presentedFrameId).toBe('bake-worker-shadow:2');
  });

  it('rejects caller-supplied proof fields instead of recording spoofed parity', async () => {
    for (const args of [
      { mainFingerprint },
      { workerFingerprint: mainFingerprint },
      { fingerprint: mainFingerprint },
      { thresholds: { maxAvgRgbDelta: 9999 } },
      { source: 'worker-shadow-main' },
    ]) {
      const result = await handleRunWorkerFirstBakeShadowParity(args, createDeps());
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

    const result = await handleRunWorkerFirstBakeShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureMainFingerprint).not.toHaveBeenCalled();
    expect(deps.renderWorkerShadowFingerprint).not.toHaveBeenCalled();
  });

  it('returns failures when main bake capture is missing or worker parity is outside thresholds', async () => {
    const deps = createDeps({
      captureResults: [
        { success: false, error: 'missing bake cache' },
        {
          success: true,
          data: {
            sampleTimeSeconds: 1,
            cachedFrameHit: true,
            fingerprint: mainFingerprint,
          },
        },
        {
          success: true,
          data: {
            sampleTimeSeconds: 2,
            cachedFrameHit: true,
            fingerprint: mainFingerprint,
          },
        },
      ],
      workerFingerprint: blankFingerprint,
    });

    const result = await handleRunWorkerFirstBakeShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('worker-shadow parity samples failed');
    expect(result.data).toMatchObject({
      failures: [
        { sampleTimeSeconds: 0, error: 'missing bake cache' },
        { sampleTimeSeconds: 1 },
        { sampleTimeSeconds: 2 },
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
