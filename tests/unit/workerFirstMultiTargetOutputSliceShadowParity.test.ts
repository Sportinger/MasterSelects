import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstMultiTargetOutputSliceShadowParity,
  type WorkerFirstMultiTargetOutputSliceShadowParityDeps,
} from '../../src/services/aiTools/workerFirstMultiTargetOutputSliceShadowParity';
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
  hash: '06677244',
  nonBlankRatio: 0.8867,
  alphaCoverage: 1,
  avgRgb: { r: 43.0977, g: 83.0547, b: 72.3945 },
  meanLuma: 73.7902,
  colorRange: { r: 206, g: 255, b: 255, luma: 239.6652 },
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
} = {}): WorkerFirstMultiTargetOutputSliceShadowParityDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeAndCaptureMainFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'multi-target-output-slice',
        fixture: {
          width: 1280,
          height: 720,
          durationSeconds: 3.25,
          targetIds: ['wfg-output-slice-target-a', 'wfg-output-slice-target-b'],
          enabledSliceCount: 1,
        },
      },
    }),
    captureMainFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'multi-target-output-slice',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          fingerprint: mainFingerprint,
        },
      }
    )),
    renderWorkerShadowFingerprint: vi.fn(async () => ({
      renderer: 'worker-offscreen-2d-multi-target-output-slice',
      fingerprint: options.workerFingerprint ?? mainFingerprint,
      workerMs: 1.25,
    })),
  };
}

describe('worker-first multi-target/output-slice shadow parity runner', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    vi.restoreAllMocks();
  });

  it('materializes the fixture, captures main fingerprints, renders worker shadow samples, and records parity', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstMultiTargetOutputSliceShadowParity({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeAndCaptureMainFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'multi-target-output-slice',
      restoreTimelineAfterRun: false,
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureMainFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.captureMainFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'multi-target-output-slice',
      sampleTimeSeconds: 0,
      settleMs: 600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenCalledTimes(3);
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'multi-target-output-slice',
      sampleTimeSeconds: 0,
      width: 1280,
      height: 720,
    }), { sampleWidth: 12, sampleHeight: 10 });

    expect(result.data).toMatchObject({
      projectId: 'multi-target-output-slice',
      manifestSampleTimesSeconds: [0, 1, 2],
      failures: [],
      w5StartPermissionsRemainStatsGuarded: true,
    });

    const captures = getWorkerFirstProofCaptures();
    expect(captures.shadowSamples).toHaveLength(3);
    expect(captures.shadowSamples[0]).toMatchObject({
      projectId: 'multi-target-output-slice',
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
    expect(counters.presentedFrameId).toBe('multi-target-output-slice-worker-shadow:2');
  });

  it('rejects caller-supplied proof fields instead of recording spoofed parity', async () => {
    for (const args of [
      { mainFingerprint },
      { workerFingerprint: mainFingerprint },
      { fingerprint: mainFingerprint },
      { thresholds: { maxAvgRgbDelta: 9999 } },
      { source: 'worker-shadow-main' },
    ]) {
      const result = await handleRunWorkerFirstMultiTargetOutputSliceShadowParity(args, createDeps());
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

    const result = await handleRunWorkerFirstMultiTargetOutputSliceShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toBe('fixture failed');
    expect(deps.captureMainFingerprint).not.toHaveBeenCalled();
    expect(deps.renderWorkerShadowFingerprint).not.toHaveBeenCalled();
  });

  it('returns failures when main capture is missing or worker parity is outside thresholds', async () => {
    const deps = createDeps({
      captureResults: [
        { success: false, error: 'missing canvas' },
        {
          success: true,
          data: {
            sampleTimeSeconds: 1,
            fingerprint: mainFingerprint,
          },
        },
        {
          success: true,
          data: {
            sampleTimeSeconds: 2,
            fingerprint: mainFingerprint,
          },
        },
      ],
      workerFingerprint: blankFingerprint,
    });

    const result = await handleRunWorkerFirstMultiTargetOutputSliceShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('worker-shadow parity samples failed');
    expect(result.data).toMatchObject({
      failures: [
        { sampleTimeSeconds: 0, error: 'missing canvas' },
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
