import { describe, expect, it } from 'vitest';

import type { RenderTargetSnapshot } from '../../src/engine/render/contracts';
import {
  createWorkerFirstProofSnapshot,
  WORKER_FIRST_FOCUSED_CHECKS,
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from '../../src/services/aiTools/workerFirstProofHarness';
import type { RenderCapabilityProbeResult } from '../../src/services/render/renderCapabilityProbe';
import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
  type WorkerVisiblePresentationProof,
} from '../../src/services/aiTools/workerFirstW5Gates';

const targetSnapshot: RenderTargetSnapshot = {
  resolution: { width: 1920, height: 1080 },
  targets: [
    {
      id: 'program',
      name: 'Program',
      source: { type: 'activeComp' },
      destinationType: 'canvas',
      enabled: true,
      showTransparencyGrid: false,
      isFullscreen: false,
    },
    {
      id: 'disabled',
      name: 'Disabled',
      source: { type: 'activeComp' },
      destinationType: 'canvas',
      enabled: false,
      showTransparencyGrid: false,
      isFullscreen: false,
    },
  ],
  activeCompositionTargetIds: ['program'],
  independentTargetIds: [],
  sliceConfigs: {},
  outputPreview: { activeTab: 'output', previewingTargetId: null },
};

const capabilityProbe: RenderCapabilityProbeResult = {
  timestamp: 1,
  browserEngine: 'chromium',
  os: 'windows',
  gpuAdapter: null,
  facts: {
    workerNavigatorGpu: true,
    workerWebGpuDevice: true,
    offscreenCanvasTransfer: true,
    offscreenCanvasWebGpuContext: true,
    workerCanvasPresentation: true,
    videoFrameTransfer: true,
    imageBitmapTransfer: true,
    webCodecs: true,
    webCodecsWorker: true,
    copyExternalImageToTexture: true,
    audioContext: true,
  },
  selectedStrategy: 'worker-webgpu-present',
  selectionReason: 'test',
};

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

const capturedManifest: WorkerFirstGoldenProjectManifest = {
  id: 'solid-text-image',
  description: 'captured fixture',
  sampleTimesSeconds: [0],
  requiredSignals: ['solid'],
  proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
  status: 'fixture-required',
};

function visibleProofs(): WorkerVisiblePresentationProof[] {
  return WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.map((platform) => ({
    platform,
    strategy: platform === 'linux-firefox-mesa' ? 'worker-cpu-present' : 'worker-webgpu-main-present',
    proof: {
      attached: true,
      cssSize: { width: 320, height: 180 },
      backingSize: { width: 320, height: 180 },
      viewportIntersecting: true,
      centerOccluded: false,
      fingerprint,
      errors: [],
    },
    capabilityProbe: null,
    stress: {
      playbackDurationMs: 5000,
      frameCount: 150,
      staleVisibleFrameCount: 0,
    },
  }));
}

describe('worker-first proof harness', () => {
  it('defines the W0 golden manifest families and sample times', () => {
    expect(WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.map((manifest) => manifest.id)).toEqual([
      'solid-text-image',
      'multi-video',
      'webcodecs-provider',
      'html-provider-fallback',
      'jpeg-proxy',
      'nested-comps',
      'effects-masks-transitions',
      'multi-target-output-slice',
      'ram-cache',
      'bake',
      'export',
      'universal-3d-gaussian-cad',
    ]);
    expect(WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.every((manifest) => manifest.sampleTimesSeconds.length > 0))
      .toBe(true);
    expect(WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.every((manifest) => manifest.proofSurfaces.length > 0))
      .toBe(true);
  });

  it('creates a passive main-renderer proof snapshot for getStats and getPlaybackTrace', () => {
    const snapshot = createWorkerFirstProofSnapshot({ targetSnapshot, capabilityProbe });

    expect(snapshot.mode).toBe('main');
    expect(snapshot.selectedStrategy).toBe('worker-webgpu-present');
    expect(snapshot.w5GateEvidenceMode).toBe('stats-observation');
    expect(snapshot.capabilityProbeStatus).toBe('captured');
    expect(snapshot.capabilityProbe).toEqual(capabilityProbe);
    expect(snapshot.targetIds).toEqual(['program']);
    expect(snapshot.activeJobId).toBeNull();
    expect(snapshot.counters.queueDepth).toBe(0);
    expect(snapshot.counters.frameLifetime.outstanding).toBe(0);
    expect(snapshot.counters.frameLifetime.leaked).toBe(0);
    expect(snapshot.w5Prerequisites).toMatchObject({
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
      workerShadowParity: { status: 'blocked' },
      visiblePresentation: { status: 'blocked' },
    });
    expect(snapshot.proofPaths.aiBridgeStats).toEqual([
      'getStats.workerFirstRenderer',
      'getPlaybackTrace.workerFirstRenderer',
    ]);
    expect(snapshot.proofPaths.domVisibleCapture).toBe(
      'src/services/aiTools/visiblePixelProof.ts:captureDomVisibleCanvasProof',
    );
  });

  it('keeps missing capability probes explicit instead of manufacturing platform facts', () => {
    const snapshot = createWorkerFirstProofSnapshot({ targetSnapshot });

    expect(snapshot.selectedStrategy).toBe('main-host-dev');
    expect(snapshot.capabilityProbeStatus).toBe('missing');
    expect(snapshot.capabilityProbe).toBeNull();
  });

  it('feeds recorded proof captures into W5 prerequisites without enabling cutover from static state', () => {
    const snapshot = createWorkerFirstProofSnapshot({
      goldenManifests: [capturedManifest],
      allowW5StartFromCapturedEvidence: true,
      proofCaptures: {
        goldenFixtures: [{
          projectId: 'solid-text-image',
          sampleTimeSeconds: 0,
          fingerprint,
          source: 'main-renderer',
          capturedAt: 123,
        }],
        shadowSamples: [{
          projectId: 'solid-text-image',
          sampleTimeSeconds: 0,
          mainFingerprint: fingerprint,
          workerFingerprint: fingerprint,
        }],
        visibleProofs: visibleProofs(),
        updatedAt: 123,
      },
    });

    expect(snapshot.proofCaptures.updatedAt).toBe(123);
    expect(snapshot.w5GateEvidenceMode).toBe('accepted-gate-run');
    expect(snapshot.goldenManifests[0].status).toBe('captured');
    expect(snapshot.w5Prerequisites.workerShadowParity.status).toBe('passed');
    expect(snapshot.w5Prerequisites.visiblePresentation.status).toBe('passed');
    expect(snapshot.w5Prerequisites.canStartWorkerWebGpu).toBe(true);
  });

  it('names executable focused checks for the first worker-first packets', () => {
    expect(WORKER_FIRST_FOCUSED_CHECKS.targetCorrectness).toContain('cachedFrameRenderer.test.ts');
    expect(WORKER_FIRST_FOCUSED_CHECKS.proofHarness).toBe(
      'npx vitest run tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts',
    );
    expect(WORKER_FIRST_FOCUSED_CHECKS.platformCapability).toBe(
      'npx vitest run tests/unit/renderCapabilityProbe.test.ts',
    );
    expect(WORKER_FIRST_FOCUSED_CHECKS.w5PrerequisiteGates).toBe(
      'npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstMultiVideoShadowParity.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderShadowParity.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstNestedCompsShadowParity.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderShadowParity.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstJpegProxyShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstRamCacheShadowParity.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstBakeShadowParity.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstExportShadowParity.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstUniversal3dShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstPlatformEvidenceMatrix.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts',
    );
  });
});
