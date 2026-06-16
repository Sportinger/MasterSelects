import { describe, expect, it } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { DomVisibleCanvasProof } from '../../src/services/aiTools/visiblePixelProof';
import type {
  WorkerFirstGoldenProjectManifest,
  WorkerFirstProofCounters,
} from '../../src/services/aiTools/workerFirstProofHarness';
import {
  createWorkerFirstW5PrerequisiteReport,
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
  type WorkerVisiblePresentationProof,
} from '../../src/services/aiTools/workerFirstW5Gates';

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

const blankFingerprint: FrameFingerprint = {
  ...fingerprint,
  hash: '00000000',
  nonBlankRatio: 0,
  avgRgb: { r: 0, g: 0, b: 0 },
  meanLuma: 0,
  colorRange: { r: 0, g: 0, b: 0, luma: 0 },
};

const cleanCounters: WorkerFirstProofCounters = {
  queueDepth: 0,
  transferLatencyMs: 3,
  providerWaitMs: 2,
  presentedFrameId: 'frame-a',
  frameLifetime: {
    outstanding: 0,
    created: 2,
    cloned: 0,
    transferred: 2,
    imported: 2,
    cached: 1,
    released: 2,
    closed: 2,
    lateClosed: 0,
    leaked: 0,
    fallbackUsed: 0,
  },
  passes: {
    graphNodesEmitted: 3,
    graphNodesExecuted: 3,
    graphNodesDeduped: 1,
    graphNodesSkipped: 0,
    passCount: 2,
    effectPassCount: 1,
    duplicatePassCount: 0,
  },
  cache: {
    hits: 1,
    misses: 0,
    evictions: 0,
    vramPeakBytes: 1024,
  },
  visiblePixels: {
    nonBlankRatio: 1,
    blackFrameCount: 0,
    freezeCount: 0,
    staleVisibleFrameCount: 0,
  },
};

const capturedManifest: WorkerFirstGoldenProjectManifest = {
  id: 'solid-text-image',
  description: 'captured fixture',
  sampleTimesSeconds: [0],
  requiredSignals: ['solid'],
  proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
  status: 'captured',
};

const fixtureRequiredManifest: WorkerFirstGoldenProjectManifest = {
  ...capturedManifest,
  id: 'multi-video',
  status: 'fixture-required',
};

function visibleProof(overrides: Partial<DomVisibleCanvasProof> = {}): DomVisibleCanvasProof {
  return {
    attached: true,
    cssSize: { width: 320, height: 180 },
    backingSize: { width: 320, height: 180 },
    viewportIntersecting: true,
    centerOccluded: false,
    fingerprint,
    errors: [],
    ...overrides,
  };
}

function platformProofs(): WorkerVisiblePresentationProof[] {
  return WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.map((platform) => ({
    platform,
    strategy: platform === 'linux-firefox-mesa' ? 'worker-cpu-present' : 'worker-webgpu-main-present',
    proof: visibleProof(),
    capabilityProbe: null,
    stress: {
      playbackDurationMs: 5000,
      frameCount: 150,
      staleVisibleFrameCount: 0,
    },
  }));
}

describe('worker-first W5 prerequisite gates', () => {
  it('blocks W5 in the current pre-fixture state instead of implying readiness', () => {
    const report = createWorkerFirstW5PrerequisiteReport({
      manifests: [capturedManifest, fixtureRequiredManifest],
      counters: cleanCounters,
    });

    expect(report.canStartWorkerWebGpu).toBe(false);
    expect(report.canStartWorkerPresentation).toBe(false);
    expect(report.canStartRenderDispatcherCutover).toBe(false);
    expect(report.workerShadowParity.status).toBe('blocked');
    expect(report.visiblePresentation.status).toBe('blocked');
    expect(report.workerShadowParity.checks.find((check) => check.id === 'golden-fixtures-captured'))
      .toMatchObject({ status: 'blocked' });
  });

  it('passes W5 prerequisites only when shadow parity and visible presentation proof are complete', () => {
    const report = createWorkerFirstW5PrerequisiteReport({
      manifests: [capturedManifest],
      counters: cleanCounters,
      shadowSamples: [{
        projectId: 'solid-text-image',
        sampleTimeSeconds: 0,
        mainFingerprint: fingerprint,
        workerFingerprint: fingerprint,
      }],
      visibleProofs: platformProofs(),
    });

    expect(report.workerShadowParity.status).toBe('passed');
    expect(report.visiblePresentation.status).toBe('passed');
    expect(report.canStartWorkerWebGpu).toBe(true);
    expect(report.canStartWorkerPresentation).toBe(true);
    expect(report.canStartRenderDispatcherCutover).toBe(true);
  });

  it('does not let capture-only visible proofs block a stress proof for the same platform', () => {
    const [windowsProof, ...otherProofs] = platformProofs();
    const report = createWorkerFirstW5PrerequisiteReport({
      manifests: [capturedManifest],
      counters: cleanCounters,
      shadowSamples: [{
        projectId: 'solid-text-image',
        sampleTimeSeconds: 0,
        mainFingerprint: fingerprint,
        workerFingerprint: fingerprint,
      }],
      visibleProofs: [
        {
          ...windowsProof,
          stress: null,
        },
        windowsProof,
        ...otherProofs,
      ],
    });

    expect(report.visiblePresentation.checks.find((check) => check.id === 'no-stale-visible-frames-under-stress'))
      .toMatchObject({ status: 'passed' });
    expect(report.visiblePresentation.status).toBe('passed');
  });

  it('fails W5 prerequisites when parity, queue, lifetime, or visible pixels regress', () => {
    const report = createWorkerFirstW5PrerequisiteReport({
      manifests: [capturedManifest],
      counters: {
        ...cleanCounters,
        queueDepth: 5,
        frameLifetime: {
          ...cleanCounters.frameLifetime,
          outstanding: 1,
          leaked: 1,
        },
      },
      shadowSamples: [{
        projectId: 'solid-text-image',
        sampleTimeSeconds: 0,
        mainFingerprint: fingerprint,
        workerFingerprint: blankFingerprint,
      }],
      visibleProofs: platformProofs().map((proof, index) => index === 0
        ? {
            ...proof,
            proof: visibleProof({ fingerprint: blankFingerprint }),
            stress: {
              playbackDurationMs: 5000,
              frameCount: 150,
              staleVisibleFrameCount: 2,
            },
          }
        : proof),
    });

    expect(report.workerShadowParity.status).toBe('failed');
    expect(report.visiblePresentation.status).toBe('failed');
    expect(report.canStartWorkerWebGpu).toBe(false);
    expect(report.workerShadowParity.checks.find((check) => check.id === 'queue-depth-bounded'))
      .toMatchObject({ status: 'failed' });
    expect(report.workerShadowParity.checks.find((check) => check.id === 'frame-provider-lifetime-drained'))
      .toMatchObject({ status: 'failed' });
    expect(report.visiblePresentation.checks.find((check) => check.id === 'dom-visible-nonblank'))
      .toMatchObject({ status: 'failed' });
  });
});
