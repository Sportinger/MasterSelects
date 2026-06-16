import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstEffectsMasksTransitionsShadowParity,
  type WorkerFirstEffectsMasksTransitionsShadowParityDeps,
} from '../../src/services/aiTools/workerFirstEffectsMasksTransitionsShadowParity';
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
  hash: 'ec5ac7ac',
  nonBlankRatio: 1,
  alphaCoverage: 1,
  avgRgb: { r: 93.0977, g: 121.0547, b: 98.3945 },
  meanLuma: 112.7902,
  colorRange: { r: 220, g: 230, b: 210, luma: 205.6652 },
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
} = {}): WorkerFirstEffectsMasksTransitionsShadowParityDeps {
  const captureResults = [...(options.captureResults ?? [])];
  return {
    materializeAndCaptureMainFixture: vi.fn(async () => options.materializeResult ?? {
      success: true,
      data: {
        projectId: 'effects-masks-transitions',
        fixture: {
          width: 1280,
          height: 720,
          durationSeconds: 2,
          effectCount: 2,
          maskCount: 1,
          transitionCount: 1,
          blendMode: 'screen',
        },
      },
    }),
    captureMainFingerprint: vi.fn(async (args: Record<string, unknown>) => (
      captureResults.shift() ?? {
        success: true,
        data: {
          projectId: 'effects-masks-transitions',
          sampleTimeSeconds: args.sampleTimeSeconds,
          source: 'main-renderer',
          fingerprint: mainFingerprint,
        },
      }
    )),
    renderWorkerShadowFingerprint: vi.fn(async () => ({
      renderer: 'worker-offscreen-2d-effects-masks-transitions',
      fingerprint: options.workerFingerprint ?? mainFingerprint,
      workerMs: 1.25,
    })),
  };
}

describe('worker-first effects/masks/transitions shadow parity runner', () => {
  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    clearWorkerFirstCounterSourcesForTests();
    vi.restoreAllMocks();
  });

  it('materializes the fixture, captures main fingerprints, renders worker shadow samples, and records parity', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstEffectsMasksTransitionsShadowParity({
      sampleWidth: 12,
      sampleHeight: 10,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeAndCaptureMainFixture).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'effects-masks-transitions',
      restoreTimelineAfterRun: false,
      sampleWidth: 12,
      sampleHeight: 10,
    }));
    expect(deps.captureMainFingerprint).toHaveBeenCalledTimes(4);
    expect(deps.captureMainFingerprint).toHaveBeenNthCalledWith(1, {
      projectId: 'effects-masks-transitions',
      sampleTimeSeconds: 0,
      settleMs: 600,
      sampleWidth: 12,
      sampleHeight: 10,
    });
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenCalledTimes(4);
    expect(deps.renderWorkerShadowFingerprint).toHaveBeenNthCalledWith(1, expect.objectContaining({
      projectId: 'effects-masks-transitions',
      sampleTimeSeconds: 0,
      width: 1280,
      height: 720,
    }), { sampleWidth: 12, sampleHeight: 10 });

    expect(result.data).toMatchObject({
      projectId: 'effects-masks-transitions',
      manifestSampleTimesSeconds: [0, 0.5, 1, 1.5],
      failures: [],
      w5StartPermissionsRemainStatsGuarded: true,
    });

    const captures = getWorkerFirstProofCaptures();
    expect(captures.shadowSamples).toHaveLength(4);
    expect(captures.shadowSamples[0]).toMatchObject({
      projectId: 'effects-masks-transitions',
      sampleTimeSeconds: 0,
      mainFingerprint,
      workerFingerprint: mainFingerprint,
    });

    const counters = getWorkerFirstCounterSourceSnapshot();
    expect(counters.scheduler).toMatchObject({
      queueDepth: 0,
      counters: {
        admitted: 4,
        started: 4,
        completed: 4,
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
    expect(counters.presentedFrameId).toBe('effects-masks-transitions-worker-shadow:1.5');
  });

  it('rejects caller-supplied proof fields instead of recording spoofed parity', async () => {
    for (const args of [
      { mainFingerprint },
      { workerFingerprint: mainFingerprint },
      { fingerprint: mainFingerprint },
      { thresholds: { maxAvgRgbDelta: 9999 } },
      { source: 'worker-shadow-main' },
    ]) {
      const result = await handleRunWorkerFirstEffectsMasksTransitionsShadowParity(args, createDeps());
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

    const result = await handleRunWorkerFirstEffectsMasksTransitionsShadowParity({}, deps);

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
            sampleTimeSeconds: 0.5,
            fingerprint: mainFingerprint,
          },
        },
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
            sampleTimeSeconds: 1.5,
            fingerprint: mainFingerprint,
          },
        },
      ],
      workerFingerprint: blankFingerprint,
    });

    const result = await handleRunWorkerFirstEffectsMasksTransitionsShadowParity({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('worker-shadow parity samples failed');
    expect(result.data).toMatchObject({
      failures: [
        { sampleTimeSeconds: 0, error: 'missing canvas' },
        { sampleTimeSeconds: 0.5 },
        { sampleTimeSeconds: 1 },
        { sampleTimeSeconds: 1.5 },
      ],
    });
    expect(getWorkerFirstProofCaptures().shadowSamples).toHaveLength(3);
    expect(getWorkerFirstCounterSourceSnapshot().scheduler).toMatchObject({
      queueDepth: 0,
      counters: {
        admitted: 4,
        started: 4,
        completed: 3,
        dropped: 1,
      },
    });
  });
});
