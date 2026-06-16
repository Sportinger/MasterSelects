import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { RenderCapabilityProbeResult } from '../../src/services/render/renderCapabilityProbe';
import {
  createWorkerFirstProofSnapshot,
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
} from '../../src/services/aiTools/workerFirstProofHarness';
import {
  clearWorkerFirstProofCaptures,
  getWorkerFirstProofCaptures,
  recordWorkerFirstVisiblePresentationProof,
  recordWorkerFirstGoldenFixtureCapture,
  recordWorkerFirstShadowParitySample,
} from '../../src/services/aiTools/workerFirstProofCaptures';
import {
  handleRunWorkerFirstW5EvidenceSuite,
  WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS,
  type WorkerFirstW5EvidenceSuiteRunner,
} from '../../src/services/aiTools/workerFirstW5EvidenceSuite';
import {
  clearWorkerFirstCounterSourcesForTests,
  getWorkerFirstCounterSources,
  recordWorkerFirstTimingCounters,
} from '../../src/services/aiTools/workerFirstCounterSources';

const fingerprint: FrameFingerprint = {
  sourceWidth: 16,
  sourceHeight: 16,
  sampleWidth: 16,
  sampleHeight: 16,
  pixelCount: 256,
  hash: 'abc12345',
  nonBlankRatio: 1,
  alphaCoverage: 1,
  avgRgb: { r: 120, g: 80, b: 40 },
  meanLuma: 90,
  colorRange: { r: 100, g: 90, b: 80, luma: 85 },
};

const capabilityProbe: RenderCapabilityProbeResult = {
  timestamp: 123,
  browserEngine: 'chromium',
  os: 'windows',
  gpuAdapter: null,
  facts: {
    workerNavigatorGpu: true,
    workerWebGpuDevice: true,
    offscreenCanvasTransfer: true,
    offscreenCanvasWebGpuContext: true,
    workerCanvasPresentation: false,
    videoFrameTransfer: true,
    imageBitmapTransfer: true,
    webCodecs: true,
    webCodecsWorker: true,
    copyExternalImageToTexture: true,
    audioContext: true,
  },
  selectedStrategy: 'worker-webgpu-main-present',
  selectionReason: 'test',
};

function createAcceptedSnapshot() {
  return createWorkerFirstProofSnapshot({
    proofCaptures: getWorkerFirstProofCaptures(),
    counterSources: getWorkerFirstCounterSources(),
    capabilityProbe,
    allowW5StartFromCapturedEvidence: true,
  });
}

function createSuccessfulRunners(runArgs: Record<string, unknown>[]): WorkerFirstW5EvidenceSuiteRunner[] {
  const runners = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.map((manifest): WorkerFirstW5EvidenceSuiteRunner => ({
    id: `${manifest.id}-golden`,
    kind: 'golden-fixture',
    projectId: manifest.id,
    run: async (args) => {
      runArgs.push(args);
      for (const sampleTimeSeconds of manifest.sampleTimesSeconds) {
        recordWorkerFirstGoldenFixtureCapture({
          projectId: manifest.id,
          sampleTimeSeconds,
          fingerprint,
          source: 'main-renderer',
          capturedAt: 100 + sampleTimeSeconds,
        });
      }
      return {
        success: true,
        data: {
          projectId: manifest.id,
          manifestSampleTimesSeconds: manifest.sampleTimesSeconds,
          captures: manifest.sampleTimesSeconds.map((sampleTimeSeconds) => ({ sampleTimeSeconds })),
          failures: [],
        },
      };
    },
  }));

  runners.push({
    id: 'solid-text-image-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'solid-text-image',
    run: async (args) => {
      runArgs.push(args);
      const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === 'solid-text-image');
      for (const sampleTimeSeconds of manifest?.sampleTimesSeconds ?? []) {
        recordWorkerFirstShadowParitySample({
          projectId: 'solid-text-image',
          sampleTimeSeconds,
          mainFingerprint: fingerprint,
          workerFingerprint: fingerprint,
        }, 200 + sampleTimeSeconds);
      }
      return {
        success: true,
        data: {
          projectId: 'solid-text-image',
          manifestSampleTimesSeconds: manifest?.sampleTimesSeconds ?? [],
          samples: manifest?.sampleTimesSeconds.map((sampleTimeSeconds) => ({ sampleTimeSeconds })) ?? [],
          failures: [],
        },
      };
    },
  });

  return runners;
}

describe('worker-first W5 evidence suite', () => {
  beforeEach(() => {
    clearWorkerFirstProofCaptures();
    clearWorkerFirstCounterSourcesForTests();
  });

  afterEach(() => {
    clearWorkerFirstProofCaptures();
    clearWorkerFirstCounterSourcesForTests();
  });

  it('includes the effects/masks/transitions worker-shadow runner in the default suite', () => {
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'effects-masks-transitions-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'jpeg-proxy-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'nested-comps-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'ram-cache-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'bake-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'export-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'universal-3d-gaussian-cad-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'multi-video-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'webcodecs-provider-worker-shadow',
    );
    expect(WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS.map((runner) => runner.id)).toContain(
      'html-provider-fallback-worker-shadow',
    );
  });

  it('rejects caller-supplied proof evidence', async () => {
    const result = await handleRunWorkerFirstW5EvidenceSuite({
      platform: 'windows-chromium',
    }, {
      runners: [],
      createAcceptedSnapshot,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('caller-supplied proof fields');
    expect(result.data).toMatchObject({
      forbiddenFields: ['platform'],
    });
  });

  it('rejects unknown phase runner ids before clearing existing captures', async () => {
    let clearProofCalls = 0;
    let clearCounterCalls = 0;

    const result = await handleRunWorkerFirstW5EvidenceSuite({
      runnerIds: ['missing-runner'],
    }, {
      runners: [],
      clearProofCaptures: () => { clearProofCalls += 1; },
      clearCounterSources: () => { clearCounterCalls += 1; },
      createAcceptedSnapshot,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('runnerIds');
    expect(result.data).toMatchObject({
      unknownRunnerIds: ['missing-runner'],
      allowedRunnerIds: [],
    });
    expect(clearProofCalls).toBe(0);
    expect(clearCounterCalls).toBe(0);
  });

  it('rejects non-array phase runner ids before clearing existing captures', async () => {
    let clearProofCalls = 0;
    let clearCounterCalls = 0;
    const runners: WorkerFirstW5EvidenceSuiteRunner[] = [
      {
        id: 'phase-a',
        kind: 'golden-fixture',
        projectId: 'solid-text-image',
        run: async () => {
          throw new Error('phase-a should be skipped');
        },
      },
    ];

    const result = await handleRunWorkerFirstW5EvidenceSuite({
      runnerIds: 'phase-a',
    }, {
      runners,
      clearProofCaptures: () => { clearProofCalls += 1; },
      clearCounterSources: () => { clearCounterCalls += 1; },
      createAcceptedSnapshot,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('runnerIds must be an array');
    expect(result.data).toMatchObject({
      invalidRunnerIdsArg: true,
      allowedRunnerIds: ['phase-a'],
    });
    expect(clearProofCalls).toBe(0);
    expect(clearCounterCalls).toBe(0);
  });

  it('can run a selected phase without clearing previously captured evidence', async () => {
    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 999,
      fingerprint,
      source: 'main-renderer',
      capturedAt: 1,
    });
    let clearProofCalls = 0;
    let clearCounterCalls = 0;
    const runArgs: Record<string, unknown>[] = [];
    const runners: WorkerFirstW5EvidenceSuiteRunner[] = [
      {
        id: 'phase-a',
        kind: 'golden-fixture',
        projectId: 'solid-text-image',
        run: async (args) => {
          runArgs.push(args);
          recordWorkerFirstGoldenFixtureCapture({
            projectId: 'solid-text-image',
            sampleTimeSeconds: 0,
            fingerprint,
            source: 'main-renderer',
            capturedAt: 2,
          });
          return {
            success: true,
            data: {
              projectId: 'solid-text-image',
              manifestSampleTimesSeconds: [0],
              captures: [{ sampleTimeSeconds: 0 }],
              failures: [],
            },
          };
        },
      },
      {
        id: 'phase-b',
        kind: 'golden-fixture',
        projectId: 'multi-video',
        run: async () => {
          throw new Error('phase-b should be skipped');
        },
      },
    ];

    const result = await handleRunWorkerFirstW5EvidenceSuite({
      runnerIds: ['phase-a'],
      clearBeforeRun: false,
      includeVisiblePresentationProofs: false,
      sampleWidth: 8,
    }, {
      runners,
      clearProofCaptures: () => { clearProofCalls += 1; },
      clearCounterSources: () => { clearCounterCalls += 1; },
      createAcceptedSnapshot,
    });

    expect(result.success).toBe(false);
    const data = result.data as {
      runnerSelection: {
        clearBeforeRun: boolean;
        requestedRunnerIds: string[];
        selectedRunnerIds: string[];
        skippedRunnerIds: string[];
      };
      runners: Array<{ id: string; success: boolean }>;
    };
    expect(data.runnerSelection).toEqual({
      clearBeforeRun: false,
      requestedRunnerIds: ['phase-a'],
      selectedRunnerIds: ['phase-a'],
      skippedRunnerIds: ['phase-b'],
    });
    expect(data.runners).toEqual([expect.objectContaining({ id: 'phase-a', success: true })]);
    expect(runArgs).toEqual([expect.objectContaining({
      resetProject: true,
      restoreTimelineAfterRun: false,
      sampleWidth: 8,
    })]);
    expect(clearProofCalls).toBe(0);
    expect(clearCounterCalls).toBe(0);
    expect(getWorkerFirstProofCaptures().goldenFixtures.map((capture) => capture.sampleTimeSeconds))
      .toEqual([999, 0]);
  });

  it('clears volatile captures, runs every fixture plus worker-shadow parity, and returns an accepted gate snapshot', async () => {
    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 999,
      fingerprint,
      source: 'main-renderer',
      capturedAt: 1,
    });
    recordWorkerFirstTimingCounters({
      providerWaitMs: 44,
      presentedFrameId: 'stale-before-suite',
    }, 2);
    const runArgs: Record<string, unknown>[] = [];
    const result = await handleRunWorkerFirstW5EvidenceSuite({
      sampleWidth: 8,
      sampleHeight: 8,
      width: 640,
      ignored: 'not-forwarded',
      includeVisiblePresentationProofs: false,
    }, {
      runners: createSuccessfulRunners(runArgs),
      createAcceptedSnapshot,
      now: (() => {
        let value = 1000;
        return () => value += 25;
      })(),
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      runners: Array<{ id: string; success: boolean }>;
      proofCaptureCounts: { goldenFixtures: number; shadowSamples: number; visibleProofs: number };
      missingGoldenManifestIds: string[];
      w5GateEvidenceMode: string;
      workerShadowParity: { status: string };
      visiblePresentation: { status: string };
      canStartRenderDispatcherCutover: boolean;
      acceptedSnapshot: {
        counters: { providerWaitMs: number | null; presentedFrameId: string | null };
        goldenManifests: Array<{ status: string }>;
      };
    };
    const expectedGoldenCaptures = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS
      .reduce((total, manifest) => total + manifest.sampleTimesSeconds.length, 0);

    expect(data.runners).toHaveLength(WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.length + 1);
    expect(data.runners.every((runner) => runner.success)).toBe(true);
    expect(data.proofCaptureCounts.goldenFixtures).toBe(expectedGoldenCaptures);
    expect(data.proofCaptureCounts.shadowSamples).toBe(3);
    expect(data.proofCaptureCounts.visibleProofs).toBe(0);
    expect(data.missingGoldenManifestIds).toEqual([]);
    expect(data.w5GateEvidenceMode).toBe('accepted-gate-run');
    expect(data.workerShadowParity.status).toBe('passed');
    expect(data.visiblePresentation.status).toBe('blocked');
    expect(data.canStartRenderDispatcherCutover).toBe(false);
    expect(data.acceptedSnapshot.goldenManifests.every((manifest) => manifest.status === 'captured')).toBe(true);
    expect(data.acceptedSnapshot.counters.providerWaitMs).toBeNull();
    expect(data.acceptedSnapshot.counters.presentedFrameId).toBeNull();
    expect(runArgs.every((args) => args.resetProject === true)).toBe(true);
    expect(runArgs.every((args) => args.restoreTimelineAfterRun === false)).toBe(true);
    expect(runArgs.every((args) => args.sampleWidth === 8 && args.sampleHeight === 8)).toBe(true);
    expect(runArgs.every((args) => args.width === 640)).toBe(true);
    expect(runArgs.every((args) => !('ignored' in args))).toBe(true);
    expect(getWorkerFirstProofCaptures().goldenFixtures.some((capture) => capture.sampleTimeSeconds === 999))
      .toBe(false);
  });

  it('runs local visible stress evidence from a browser-derived capability probe by default', async () => {
    const visibleArgs: Record<string, unknown>[] = [];
    const result = await handleRunWorkerFirstW5EvidenceSuite({
      includeVisiblePresentationProofs: true,
      durationMs: 1000,
      minPreviewFrames: 3,
    }, {
      runners: createSuccessfulRunners([]),
      createAcceptedSnapshot,
      runCapabilityProbe: async (args) => {
        expect(args).toEqual({});
        return {
          success: true,
          data: {
            capabilityProbe,
            selectedStrategy: capabilityProbe.selectedStrategy,
          },
        };
      },
      prepareVisibleStressFixture: async (args) => {
        expect(args).toMatchObject({
          resetProject: true,
          restoreTimelineAfterRun: false,
          durationSeconds: 1.75,
        });
        expect('durationMs' in args).toBe(false);
        expect('minPreviewFrames' in args).toBe(false);
        return {
          success: true,
          data: {
            projectId: 'solid-text-image',
            manifestSampleTimesSeconds: [0, 0.5, 1],
            captures: [{ sampleTimeSeconds: 1 }],
            failures: [],
          },
        };
      },
      runVisibleStressProof: async (args) => {
        visibleArgs.push(args);
        recordWorkerFirstVisiblePresentationProof({
          platform: 'windows-chromium',
          strategy: 'worker-webgpu-main-present',
          capabilityProbe,
          proof: {
            attached: true,
            cssSize: { width: 320, height: 180 },
            backingSize: { width: 320, height: 180 },
            viewportIntersecting: true,
            centerOccluded: false,
            fingerprint,
            errors: [],
          },
          stress: {
            playbackDurationMs: 1000,
            frameCount: 12,
            staleVisibleFrameCount: 0,
          },
        }, 300);
        return {
          success: true,
          data: {
            source: 'renderTarget:preview',
            stress: {
              playbackDurationMs: 1000,
              frameCount: 12,
              staleVisibleFrameCount: 0,
            },
            proof: {
              platform: 'windows-chromium',
              strategy: 'worker-webgpu-main-present',
              proof: {
                fingerprint,
              },
            },
          },
        };
      },
    });

    expect(result.success).toBe(true);
    const data = result.data as {
      visibleEvidence: Array<{ id: string; success: boolean; summary: Record<string, unknown> | null }>;
      failedVisibleEvidenceIds: string[];
      proofCaptureCounts: { visibleProofs: number };
      visiblePresentation: { status: string; checks: Array<{ id: string; status: string }> };
      canStartRenderDispatcherCutover: boolean;
    };

    expect(visibleArgs).toEqual([expect.objectContaining({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      durationMs: 1000,
      minPreviewFrames: 3,
    })]);
    expect(data.visibleEvidence.map((entry) => entry.id)).toEqual([
      'render-capability-probe',
      'visible-stress-fixture',
      'visible-presentation-stress',
    ]);
    expect(data.visibleEvidence.every((entry) => entry.success)).toBe(true);
    expect(data.visibleEvidence[0].summary).toMatchObject({
      platform: 'windows-chromium',
      selectedStrategy: 'worker-webgpu-main-present',
    });
    expect(data.visibleEvidence[1].summary).toMatchObject({
      projectId: 'solid-text-image',
      captures: 1,
      failures: 0,
    });
    expect(data.visibleEvidence[2].summary).toMatchObject({
      platform: 'windows-chromium',
      staleVisibleFrameCount: 0,
      nonBlankRatio: 1,
    });
    expect(data.failedVisibleEvidenceIds).toEqual([]);
    expect(data.proofCaptureCounts.visibleProofs).toBe(1);
    expect(data.visiblePresentation.status).toBe('blocked');
    expect(data.visiblePresentation.checks.find((check) => check.id === 'no-stale-visible-frames-under-stress'))
      .toMatchObject({ status: 'passed' });
    expect(data.canStartRenderDispatcherCutover).toBe(false);
  });

  it('fails the suite when a controlled runner fails', async () => {
    const runners = createSuccessfulRunners([]);
    const failingRunner: WorkerFirstW5EvidenceSuiteRunner = {
      ...runners[0],
      id: 'solid-text-image-golden',
      run: async () => ({ success: false, error: 'fixture failed' }),
    };

    const result = await handleRunWorkerFirstW5EvidenceSuite({
      includeVisiblePresentationProofs: false,
    }, {
      runners: [failingRunner, ...runners.slice(1)],
      createAcceptedSnapshot,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not complete');
    expect(result.data).toMatchObject({
      failedRunnerIds: ['solid-text-image-golden'],
      missingGoldenManifestIds: ['solid-text-image'],
    });
  });
});
