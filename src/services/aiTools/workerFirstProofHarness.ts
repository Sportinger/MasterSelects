import type { RenderTargetSnapshot } from '../../engine/render/contracts';
import type {
  RenderCapabilityProbeResult,
  RenderPresentationStrategy,
} from '../render/renderCapabilityProbe';
import {
  createWorkerFirstW5PrerequisiteReport,
  type WorkerFirstW5PrerequisiteReport,
} from './workerFirstW5Gates';
import {
  buildWorkerFirstProofCounters,
  type WorkerFirstProofCounterSources,
} from './workerFirstGateInputs';
import {
  deriveWorkerFirstCapturedGoldenManifests,
  type WorkerFirstGoldenFixtureCapture,
  type WorkerFirstProofCaptureSnapshot,
} from './workerFirstProofCaptures';
import type {
  WorkerShadowParitySample,
  WorkerVisiblePresentationProof,
} from './workerFirstW5Gates';

export type WorkerFirstRendererMode = 'main' | 'worker-shadow' | 'worker-presenting' | 'worker-only';

export type WorkerFirstGoldenProjectId =
  | 'solid-text-image'
  | 'multi-video'
  | 'webcodecs-provider'
  | 'html-provider-fallback'
  | 'jpeg-proxy'
  | 'nested-comps'
  | 'effects-masks-transitions'
  | 'multi-target-output-slice'
  | 'ram-cache'
  | 'bake'
  | 'export'
  | 'universal-3d-gaussian-cad';

export interface WorkerFirstGoldenProjectManifest {
  readonly id: WorkerFirstGoldenProjectId;
  readonly description: string;
  readonly sampleTimesSeconds: readonly number[];
  readonly requiredSignals: readonly string[];
  readonly proofSurfaces: ReadonlyArray<'frame-fingerprint' | 'dom-visible-capture' | 'ai-bridge-smoke'>;
  readonly status: 'defined' | 'fixture-required' | 'captured';
}

export interface WorkerFirstProofCounters {
  readonly queueDepth: number;
  readonly transferLatencyMs: number | null;
  readonly providerWaitMs: number | null;
  readonly presentedFrameId: string | null;
  readonly frameLifetime: {
    readonly outstanding: number;
    readonly created: number;
    readonly cloned: number;
    readonly transferred: number;
    readonly imported: number;
    readonly cached: number;
    readonly released: number;
    readonly closed: number;
    readonly lateClosed: number;
    readonly leaked: number;
    readonly fallbackUsed: number;
  };
  readonly passes: {
    readonly graphNodesEmitted: number;
    readonly graphNodesExecuted: number;
    readonly graphNodesDeduped: number;
    readonly graphNodesSkipped: number;
    readonly passCount: number;
    readonly effectPassCount: number;
    readonly duplicatePassCount: number;
  };
  readonly cache: {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly vramPeakBytes: number;
  };
  readonly visiblePixels: {
    readonly nonBlankRatio: number | null;
    readonly blackFrameCount: number;
    readonly freezeCount: number;
    readonly staleVisibleFrameCount: number;
  };
}

export interface WorkerFirstProofSnapshot {
  readonly mode: WorkerFirstRendererMode;
  readonly selectedStrategy: RenderPresentationStrategy;
  readonly w5GateEvidenceMode: 'stats-observation' | 'accepted-gate-run';
  readonly activeJobId: string | null;
  readonly activeJobType: string | null;
  readonly targetIds: readonly string[];
  readonly goldenManifests: readonly WorkerFirstGoldenProjectManifest[];
  readonly proofCaptures: WorkerFirstProofCaptureSnapshot;
  readonly proofPaths: {
    readonly frameFingerprint: string;
    readonly domVisibleCapture: string;
    readonly aiBridgeStats: readonly string[];
  };
  readonly counters: WorkerFirstProofCounters;
  readonly capabilityProbeStatus: 'captured' | 'missing';
  readonly capabilityProbe: RenderCapabilityProbeResult | null;
  readonly w5Prerequisites: WorkerFirstW5PrerequisiteReport;
}

export const WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS: readonly WorkerFirstGoldenProjectManifest[] = [
  {
    id: 'solid-text-image',
    description: 'Static solid, text, and image layers for baseline color and alpha parity.',
    sampleTimesSeconds: [0, 0.5, 1],
    requiredSignals: ['solid', 'text', 'image'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
    status: 'defined',
  },
  {
    id: 'multi-video',
    description: 'Many simultaneous video clips for provider wait, queue depth, and frame lifetime baselines.',
    sampleTimesSeconds: [1, 2, 3, 4],
    requiredSignals: ['video', 'audio-clock'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture', 'ai-bridge-smoke'],
    status: 'defined',
  },
  {
    id: 'webcodecs-provider',
    description: 'WebCodecs video source path before provider extraction.',
    sampleTimesSeconds: [0, 0.75, 1.5],
    requiredSignals: ['video', 'webcodecs'],
    proofSurfaces: ['frame-fingerprint', 'ai-bridge-smoke'],
    status: 'defined',
  },
  {
    id: 'html-provider-fallback',
    description: 'Temporary DOM video fallback path that must become a main-thread provider bridge.',
    sampleTimesSeconds: [0, 1, 2],
    requiredSignals: ['video', 'html-video'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
    status: 'defined',
  },
  {
    id: 'jpeg-proxy',
    description: 'JPEG proxy source substitution path.',
    sampleTimesSeconds: [0, 1, 2],
    requiredSignals: ['proxy-image', 'video'],
    proofSurfaces: ['frame-fingerprint', 'ai-bridge-smoke'],
    status: 'defined',
  },
  {
    id: 'nested-comps',
    description: 'Nested compositions reused by multiple parents and preview targets.',
    sampleTimesSeconds: [0, 1.25, 2.5],
    requiredSignals: ['composition', 'nested-composition'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
    status: 'defined',
  },
  {
    id: 'effects-masks-transitions',
    description: 'Representative effects, masks, transitions, and blend modes.',
    sampleTimesSeconds: [0, 0.5, 1, 1.5],
    requiredSignals: ['effect', 'mask', 'transition', 'blend-mode'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
    status: 'defined',
  },
  {
    id: 'multi-target-output-slice',
    description: 'Preview target fanout and output-slice routing.',
    sampleTimesSeconds: [0, 1, 2],
    requiredSignals: ['render-target', 'output-slice'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture', 'ai-bridge-smoke'],
    status: 'defined',
  },
  {
    id: 'ram-cache',
    description: 'RAM preview/cache consumer path including cached composite presentation.',
    sampleTimesSeconds: [0, 0.5, 1],
    requiredSignals: ['ram-preview', 'composite-cache'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
    status: 'defined',
  },
  {
    id: 'bake',
    description: 'Clip bake and composition bake paths before becoming explicit render jobs.',
    sampleTimesSeconds: [0, 1, 2],
    requiredSignals: ['clip-bake', 'composition-bake'],
    proofSurfaces: ['frame-fingerprint', 'ai-bridge-smoke'],
    status: 'defined',
  },
  {
    id: 'export',
    description: 'Export frame parity against preview render output.',
    sampleTimesSeconds: [0, 1, 2],
    requiredSignals: ['export'],
    proofSurfaces: ['frame-fingerprint', 'ai-bridge-smoke'],
    status: 'defined',
  },
  {
    id: 'universal-3d-gaussian-cad',
    description: 'Deferred universal-signal baseline for 3D, Gaussian, and CAD descriptors.',
    sampleTimesSeconds: [0, 1, 2],
    requiredSignals: ['3d', 'gaussian', 'cad'],
    proofSurfaces: ['frame-fingerprint', 'dom-visible-capture'],
    status: 'defined',
  },
];

export const WORKER_FIRST_FOCUSED_CHECKS = {
  targetCorrectness:
    'npx vitest run tests/unit/cachedFrameRenderer.test.ts tests/unit/usePreviewRenderTargetRegistration.test.tsx tests/unit/previewTargetRegistration.test.ts tests/unit/renderOutputRouterAdapter.test.ts',
  proofHarness:
    'npx vitest run tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts',
  platformCapability:
    'npx vitest run tests/unit/renderCapabilityProbe.test.ts',
  schedulerCache:
    'npx vitest run tests/unit/renderJobScheduler.test.ts tests/unit/renderCacheRegistry.test.ts',
  graphContracts:
    'npx vitest run tests/unit/renderGraphContracts.test.ts tests/unit/renderContracts.test.ts',
  providerContracts:
    'npx vitest run tests/unit/frameProviderPolicy.test.ts',
  w5PrerequisiteGates:
    'npx vitest run tests/unit/workerFirstCapabilityProbeBridge.test.ts tests/unit/workerFirstSolidTextImageGoldenFixture.test.ts tests/unit/workerFirstMultiVideoGoldenFixture.test.ts tests/unit/workerFirstMultiVideoShadowParity.test.ts tests/unit/workerFirstWebCodecsProviderGoldenFixture.test.ts tests/unit/workerFirstWebCodecsProviderShadowParity.test.ts tests/unit/workerFirstNestedCompsGoldenFixture.test.ts tests/unit/workerFirstNestedCompsShadowParity.test.ts tests/unit/workerFirstHtmlProviderGoldenFixture.test.ts tests/unit/workerFirstHtmlProviderShadowParity.test.ts tests/unit/workerFirstJpegProxyGoldenFixture.test.ts tests/unit/workerFirstJpegProxyShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceGoldenFixture.test.ts tests/unit/workerFirstRamCacheGoldenFixture.test.ts tests/unit/workerFirstRamCacheShadowParity.test.ts tests/unit/workerFirstBakeGoldenFixture.test.ts tests/unit/workerFirstBakeShadowParity.test.ts tests/unit/workerFirstExportGoldenFixture.test.ts tests/unit/workerFirstExportShadowParity.test.ts tests/unit/workerFirstUniversal3dGoldenFixture.test.ts tests/unit/workerFirstUniversal3dShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsGoldenFixture.test.ts tests/unit/workerFirstSolidTextImageShadowParity.test.ts tests/unit/workerFirstMultiTargetOutputSliceShadowParity.test.ts tests/unit/workerFirstEffectsMasksTransitionsShadowParity.test.ts tests/unit/workerFirstW5EvidenceSuite.test.ts tests/unit/workerFirstPlatformEvidencePackage.test.ts tests/unit/workerFirstPlatformEvidenceMatrix.test.ts tests/unit/workerFirstRuntimeExportPlaybackSmoke.test.ts tests/unit/workerFirstGoldenFixtureBridge.test.ts tests/unit/workerFirstVisibleCaptureBridge.test.ts tests/unit/workerFirstVisibleStressBridge.test.ts tests/unit/workerFirstCounterSources.test.ts tests/unit/workerFirstProofCaptures.test.ts tests/unit/workerFirstGateInputs.test.ts tests/unit/workerFirstW5Gates.test.ts tests/unit/workerFirstProofHarness.test.ts tests/unit/visiblePixelProof.test.ts tests/unit/aiToolStats.test.ts tests/unit/aiToolDefinitions.test.ts tests/unit/aiToolPolicy.test.ts tests/unit/workerFirstRuntimeCounterAdapter.test.ts tests/unit/providerRuntimeDiagnostics.test.ts tests/unit/renderCapabilityProbe.test.ts',
} as const;

function resolveTargetIds(snapshot: RenderTargetSnapshot | null | undefined): string[] {
  if (!snapshot) return [];
  return snapshot.targets
    .filter((target) => target.enabled)
    .map((target) => target.id);
}

function createEmptyProofCaptures(): WorkerFirstProofCaptureSnapshot {
  return {
    goldenFixtures: [],
    shadowSamples: [],
    visibleProofs: [],
    updatedAt: null,
  };
}

export function createWorkerFirstProofSnapshot(options: {
  targetSnapshot?: RenderTargetSnapshot | null;
  capabilityProbe?: RenderCapabilityProbeResult | null;
  counters?: WorkerFirstProofCounters;
  counterSources?: WorkerFirstProofCounterSources;
  goldenManifests?: readonly WorkerFirstGoldenProjectManifest[];
  goldenFixtureCaptures?: readonly WorkerFirstGoldenFixtureCapture[];
  shadowSamples?: readonly WorkerShadowParitySample[];
  visibleProofs?: readonly WorkerVisiblePresentationProof[];
  proofCaptures?: WorkerFirstProofCaptureSnapshot | null;
  allowW5StartFromCapturedEvidence?: boolean;
} = {}): WorkerFirstProofSnapshot {
  const selectedStrategy = options.capabilityProbe?.selectedStrategy ?? 'main-host-dev';
  const counters = options.counters ?? buildWorkerFirstProofCounters(options.counterSources);
  const providedProofCaptures = options.proofCaptures ?? createEmptyProofCaptures();
  const goldenFixtures = options.goldenFixtureCaptures ?? providedProofCaptures.goldenFixtures;
  const shadowSamples = options.shadowSamples ?? providedProofCaptures.shadowSamples;
  const visibleProofs = options.visibleProofs ?? providedProofCaptures.visibleProofs;
  const goldenManifests = deriveWorkerFirstCapturedGoldenManifests(
    options.goldenManifests ?? WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
    goldenFixtures,
  );
  const proofCaptures: WorkerFirstProofCaptureSnapshot = {
    goldenFixtures,
    shadowSamples,
    visibleProofs,
    updatedAt: providedProofCaptures.updatedAt,
  };
  const w5Prerequisites = createWorkerFirstW5PrerequisiteReport({
    manifests: goldenManifests,
    counters,
    shadowSamples,
    visibleProofs,
  });
  const guardedW5Prerequisites = options.allowW5StartFromCapturedEvidence === true
    ? w5Prerequisites
    : {
        ...w5Prerequisites,
        canStartWorkerWebGpu: false,
        canStartWorkerPresentation: false,
        canStartRenderDispatcherCutover: false,
      };
  return {
    mode: 'main',
    selectedStrategy,
    w5GateEvidenceMode: options.allowW5StartFromCapturedEvidence === true
      ? 'accepted-gate-run'
      : 'stats-observation',
    activeJobId: null,
    activeJobType: null,
    targetIds: resolveTargetIds(options.targetSnapshot),
    goldenManifests,
    proofCaptures,
    proofPaths: {
      frameFingerprint: 'src/services/aiTools/frameFingerprint.ts',
      domVisibleCapture: 'src/services/aiTools/visiblePixelProof.ts:captureDomVisibleCanvasProof',
      aiBridgeStats: ['getStats.workerFirstRenderer', 'getPlaybackTrace.workerFirstRenderer'],
    },
    counters,
    capabilityProbeStatus: options.capabilityProbe ? 'captured' : 'missing',
    capabilityProbe: options.capabilityProbe ?? null,
    w5Prerequisites: guardedW5Prerequisites,
  };
}
