import { describe, expect, it, vi } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstPlatformEvidencePackage,
  type WorkerFirstPlatformEvidencePackageDeps,
} from '../../src/services/aiTools/workerFirstPlatformEvidencePackage';
import { createWorkerFirstProofSnapshot } from '../../src/services/aiTools/workerFirstProofHarness';
import type { RenderCapabilityProbeResult } from '../../src/services/render/renderCapabilityProbe';

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

function statsResult(options: { readonly startPermissions?: boolean } = {}): ToolResult {
  const canStart = options.startPermissions === true;
  return {
    success: true,
    data: {
      engineReady: true,
      cacheRuntime: { records: [{ cacheId: 'cache-1' }] },
      providerRuntime: { providers: [{ providerId: 'provider-1' }] },
      independentRenderScheduler: { jobs: [{ jobId: 'job-1' }] },
      workerFirstRenderer: {
        w5GateEvidenceMode: 'stats-observation',
        w5Prerequisites: {
          canStartWorkerWebGpu: canStart,
          canStartWorkerPresentation: false,
          canStartRenderDispatcherCutover: false,
        },
      },
    },
  };
}

function traceResult(options: { readonly startPermissions?: boolean } = {}): ToolResult {
  const canStart = options.startPermissions === true;
  return {
    success: true,
    data: {
      playback: {
        status: 'ok',
        previewFrames: 12,
        previewUpdates: 12,
        stalePreviewFrames: 0,
      },
      workerFirstRenderer: {
        w5GateEvidenceMode: 'stats-observation',
        w5Prerequisites: {
          canStartWorkerWebGpu: canStart,
          canStartWorkerPresentation: false,
          canStartRenderDispatcherCutover: false,
        },
      },
    },
  };
}

function visibleStressResult(options: {
  readonly staleVisibleFrameCount?: number;
  readonly nonBlankRatio?: number;
} = {}): ToolResult {
  return {
    success: true,
    data: {
      source: 'renderTarget:preview',
      stress: {
        playbackDurationMs: 1000,
        frameCount: 12,
        staleVisibleFrameCount: options.staleVisibleFrameCount ?? 0,
      },
      proof: {
        platform: 'windows-chromium',
        strategy: 'worker-webgpu-main-present',
        proof: {
          attached: true,
          viewportIntersecting: true,
          centerOccluded: false,
          fingerprint: {
            ...fingerprint,
            nonBlankRatio: options.nonBlankRatio ?? 1,
          },
          errors: [],
        },
      },
    },
  };
}

function createDeps(
  overrides: Partial<WorkerFirstPlatformEvidencePackageDeps> = {},
): WorkerFirstPlatformEvidencePackageDeps {
  return {
    runCapabilityProbe: vi.fn(async () => ({
      success: true,
      data: {
        capabilityProbe,
        selectedStrategy: capabilityProbe.selectedStrategy,
      },
    })),
    prepareVisibleStressFixture: vi.fn(async () => ({
      success: true,
      data: {
        projectId: 'solid-text-image',
        manifestSampleTimesSeconds: [0, 0.5, 1],
        captures: [{ sampleTimeSeconds: 1 }],
        failures: [],
      },
    })),
    runVisibleStressProof: vi.fn(async () => visibleStressResult()),
    getStats: vi.fn(async () => statsResult()),
    getPlaybackTrace: vi.fn(async () => traceResult()),
    createAcceptedSnapshot: vi.fn(() => createWorkerFirstProofSnapshot({
      capabilityProbe,
      visibleProofs: [{
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
      }],
      allowW5StartFromCapturedEvidence: true,
    })),
    hashEvidence: vi.fn(async () => 'sha256-test-hash'),
    prepareVisibleSurface: vi.fn(),
    now: (() => {
      let value = 1000;
      return () => value += 25;
    })(),
    ...overrides,
  };
}

describe('worker-first platform evidence package', () => {
  it('derives platform evidence in-browser and returns a hashable package without enabling W5 start gates', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstPlatformEvidencePackage({
      width: 640,
      height: 360,
      durationMs: 1000,
      minPreviewFrames: 2,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.prepareVisibleSurface).toHaveBeenCalledTimes(1);
    expect(deps.runCapabilityProbe).toHaveBeenCalledWith({});
    expect(deps.prepareVisibleStressFixture).toHaveBeenCalledWith({
      resetProject: true,
      restoreTimelineAfterRun: false,
      durationSeconds: 1.75,
      width: 640,
      height: 360,
    });
    expect(deps.runVisibleStressProof).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      durationMs: 1000,
      minPreviewFrames: 2,
    }));
    expect(deps.getStats).toHaveBeenCalledTimes(2);
    expect(deps.getPlaybackTrace).toHaveBeenCalledWith({ windowMs: 5000, limit: 200 });
    expect(deps.hashEvidence).toHaveBeenCalledOnce();
    const data = result.data as {
      package: {
        evidenceHash: string;
        platform: string;
        strategy: string;
        checks: Record<string, boolean>;
        visibleStress: Record<string, unknown>;
        acceptedGate: { missingPlatforms: string[]; canStartRenderDispatcherCutover: boolean };
        w5StartPermissionsRemainStatsGuarded: boolean;
      };
    };

    expect(data.package).toMatchObject({
      evidenceHash: 'sha256-test-hash',
      platform: 'windows-chromium',
      strategy: 'worker-webgpu-main-present',
      checks: {
        visibleStressSucceeded: true,
        visibleStressAttached: true,
        visibleStressViewportIntersecting: true,
        visibleStressNotCenterOccluded: true,
        visibleStressNoStaleFrames: true,
        visibleStressNonBlank: true,
        statsStartPermissionsRemainFalse: true,
        traceStartPermissionsRemainFalse: true,
      },
      visibleStress: {
        frameCount: 12,
        staleVisibleFrameCount: 0,
        nonBlankRatio: 1,
      },
      w5StartPermissionsRemainStatsGuarded: true,
    });
    expect(data.package.acceptedGate.missingPlatforms).toEqual([
      'linux-chromium-mesa',
      'linux-firefox-mesa',
      'macos-safari',
      'macos-firefox',
    ]);
    expect(data.package.acceptedGate.canStartRenderDispatcherCutover).toBe(false);
  });

  it('rejects caller-supplied proof fields', async () => {
    const result = await handleRunWorkerFirstPlatformEvidencePackage({
      platform: 'windows-chromium',
      evidenceHash: 'spoof',
    }, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('caller-supplied proof fields');
    expect(result.data).toMatchObject({
      forbiddenFields: ['platform', 'evidenceHash'],
    });
  });

  it('fails before stress capture when the browser does not map to a required W5 platform', async () => {
    const unsupportedProbe: RenderCapabilityProbeResult = {
      ...capabilityProbe,
      browserEngine: 'unknown',
      os: 'unknown',
    };
    const deps = createDeps({
      runCapabilityProbe: vi.fn(async () => ({
        success: true,
        data: { capabilityProbe: unsupportedProbe },
      })),
    });

    const result = await handleRunWorkerFirstPlatformEvidencePackage({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not map');
    expect(deps.prepareVisibleStressFixture).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({
      requiredPlatforms: [
        'windows-chromium',
        'linux-chromium-mesa',
        'linux-firefox-mesa',
        'macos-safari',
        'macos-firefox',
      ],
    });
  });

  it('fails when visible stress or start-permission guards are not satisfied', async () => {
    const deps = createDeps({
      runVisibleStressProof: vi.fn(async () => visibleStressResult({
        staleVisibleFrameCount: 2,
        nonBlankRatio: 0,
      })),
      getStats: vi.fn(async () => statsResult({ startPermissions: true })),
      getPlaybackTrace: vi.fn(async () => traceResult({ startPermissions: true })),
    });

    const result = await handleRunWorkerFirstPlatformEvidencePackage({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not satisfy');
    expect(result.data).toMatchObject({
      checks: {
        visibleStressNoStaleFrames: false,
        visibleStressNonBlank: false,
        statsStartPermissionsRemainFalse: false,
        traceStartPermissionsRemainFalse: false,
      },
    });
  });
});
