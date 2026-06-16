import type { FrameFingerprint } from './frameFingerprint';
import {
  captureDomVisibleCanvasProof,
  type DomVisibleCanvasProof,
  type DomVisibleCanvasProofOptions,
} from './visiblePixelProof';
import type {
  WorkerFirstGoldenProjectId,
  WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';
import type {
  WorkerFirstProofPlatform,
  WorkerShadowParitySample,
  WorkerVisiblePresentationProof,
} from './workerFirstW5Gates';
import type {
  RenderCapabilityProbeResult,
  RenderPresentationStrategy,
} from '../render/renderCapabilityProbe';

export interface WorkerFirstGoldenFixtureCapture {
  readonly projectId: WorkerFirstGoldenProjectId;
  readonly sampleTimeSeconds: number;
  readonly fingerprint: FrameFingerprint;
  readonly source: 'main-renderer' | 'worker-shadow-main' | 'export-frame';
  readonly capturedAt: number;
}

export interface WorkerFirstProofCaptureSnapshot {
  readonly goldenFixtures: readonly WorkerFirstGoldenFixtureCapture[];
  readonly shadowSamples: readonly WorkerShadowParitySample[];
  readonly visibleProofs: readonly WorkerVisiblePresentationProof[];
  readonly updatedAt: number | null;
}

export interface WorkerFirstVisiblePresentationCaptureInput {
  readonly platform: WorkerFirstProofPlatform;
  readonly canvas: Parameters<typeof captureDomVisibleCanvasProof>[0];
  readonly strategy?: RenderPresentationStrategy;
  readonly capabilityProbe?: RenderCapabilityProbeResult | null;
  readonly stress?: WorkerVisiblePresentationProof['stress'];
  readonly proofOptions?: DomVisibleCanvasProofOptions;
}

export type WorkerFirstGoldenFixtureCaptureInput =
  Omit<WorkerFirstGoldenFixtureCapture, 'capturedAt'> & {
    readonly capturedAt?: number;
  };

let goldenFixtures: WorkerFirstGoldenFixtureCapture[] = [];
let shadowSamples: WorkerShadowParitySample[] = [];
let visibleProofs: WorkerVisiblePresentationProof[] = [];
let updatedAt: number | null = null;

function touch(timestamp = Date.now()): number {
  updatedAt = Math.max(updatedAt ?? 0, timestamp);
  return timestamp;
}

function cloneFingerprint(fingerprint: FrameFingerprint): FrameFingerprint {
  return {
    ...fingerprint,
    avgRgb: { ...fingerprint.avgRgb },
    colorRange: { ...fingerprint.colorRange },
  };
}

function cloneCapabilityProbe(probe: RenderCapabilityProbeResult | null): RenderCapabilityProbeResult | null {
  if (!probe) return null;
  return {
    ...probe,
    facts: { ...probe.facts },
    gpuAdapter: probe.gpuAdapter ? { ...probe.gpuAdapter } : null,
  };
}

function cloneVisibleProof(proof: DomVisibleCanvasProof | null): DomVisibleCanvasProof | null {
  if (!proof) return null;
  return {
    ...proof,
    cssSize: { ...proof.cssSize },
    backingSize: { ...proof.backingSize },
    fingerprint: proof.fingerprint ? cloneFingerprint(proof.fingerprint) : null,
    errors: [...proof.errors],
  };
}

function cloneGoldenFixture(capture: WorkerFirstGoldenFixtureCapture): WorkerFirstGoldenFixtureCapture {
  return {
    ...capture,
    fingerprint: cloneFingerprint(capture.fingerprint),
  };
}

function cloneShadowSample(sample: WorkerShadowParitySample): WorkerShadowParitySample {
  return {
    ...sample,
    mainFingerprint: sample.mainFingerprint ? cloneFingerprint(sample.mainFingerprint) : null,
    workerFingerprint: sample.workerFingerprint ? cloneFingerprint(sample.workerFingerprint) : null,
    thresholds: sample.thresholds ? { ...sample.thresholds } : undefined,
  };
}

function cloneWorkerVisibleProof(proof: WorkerVisiblePresentationProof): WorkerVisiblePresentationProof {
  return {
    ...proof,
    proof: cloneVisibleProof(proof.proof),
    capabilityProbe: cloneCapabilityProbe(proof.capabilityProbe),
    stress: proof.stress ? { ...proof.stress } : null,
  };
}

function cloneManifest(manifest: WorkerFirstGoldenProjectManifest): WorkerFirstGoldenProjectManifest {
  return {
    ...manifest,
    sampleTimesSeconds: [...manifest.sampleTimesSeconds],
    requiredSignals: [...manifest.requiredSignals],
    proofSurfaces: [...manifest.proofSurfaces],
  };
}

export function clearWorkerFirstProofCaptures(): void {
  goldenFixtures = [];
  shadowSamples = [];
  visibleProofs = [];
  updatedAt = null;
}

export function clearWorkerFirstProofCapturesForTests(): void {
  clearWorkerFirstProofCaptures();
}

export function recordWorkerFirstGoldenFixtureCapture(
  input: WorkerFirstGoldenFixtureCaptureInput,
): void {
  const capturedAt = touch(input.capturedAt);
  const capture: WorkerFirstGoldenFixtureCapture = {
    ...input,
    fingerprint: cloneFingerprint(input.fingerprint),
    capturedAt,
  };
  const existingIndex = goldenFixtures.findIndex((entry) => (
    entry.projectId === capture.projectId
    && entry.sampleTimeSeconds === capture.sampleTimeSeconds
    && entry.source === capture.source
  ));
  if (existingIndex >= 0) {
    goldenFixtures[existingIndex] = capture;
  } else {
    goldenFixtures = [...goldenFixtures, capture];
  }
}

export function recordWorkerFirstShadowParitySample(
  sample: WorkerShadowParitySample,
  capturedAt?: number,
): void {
  touch(capturedAt);
  const next = cloneShadowSample(sample);
  const existingIndex = shadowSamples.findIndex((entry) => (
    entry.projectId === next.projectId
    && entry.sampleTimeSeconds === next.sampleTimeSeconds
  ));
  if (existingIndex >= 0) {
    shadowSamples[existingIndex] = next;
  } else {
    shadowSamples = [...shadowSamples, next];
  }
}

export function recordWorkerFirstVisiblePresentationProof(
  proof: WorkerVisiblePresentationProof,
  capturedAt?: number,
): void {
  touch(capturedAt);
  const next = cloneWorkerVisibleProof(proof);
  const existingIndex = visibleProofs.findIndex((entry) => entry.platform === next.platform);
  if (existingIndex >= 0) {
    visibleProofs[existingIndex] = next;
  } else {
    visibleProofs = [...visibleProofs, next];
  }
}

export function captureWorkerFirstVisiblePresentationProof(
  input: WorkerFirstVisiblePresentationCaptureInput,
): WorkerVisiblePresentationProof {
  const proof: WorkerVisiblePresentationProof = {
    platform: input.platform,
    strategy: input.strategy ?? input.capabilityProbe?.selectedStrategy ?? 'main-host-dev',
    proof: captureDomVisibleCanvasProof(input.canvas, input.proofOptions),
    capabilityProbe: input.capabilityProbe ?? null,
    stress: input.stress ?? null,
  };
  recordWorkerFirstVisiblePresentationProof(proof);
  return cloneWorkerVisibleProof(proof);
}

export function getWorkerFirstProofCaptures(): WorkerFirstProofCaptureSnapshot {
  return {
    goldenFixtures: goldenFixtures.map(cloneGoldenFixture),
    shadowSamples: shadowSamples.map(cloneShadowSample),
    visibleProofs: visibleProofs.map(cloneWorkerVisibleProof),
    updatedAt,
  };
}

export function deriveWorkerFirstCapturedGoldenManifests(
  manifests: readonly WorkerFirstGoldenProjectManifest[],
  captures: readonly WorkerFirstGoldenFixtureCapture[],
): readonly WorkerFirstGoldenProjectManifest[] {
  return manifests.map((manifest) => {
    if (manifest.status === 'captured') {
      return cloneManifest(manifest);
    }
    const allSamplesCaptured = manifest.sampleTimesSeconds.every((sampleTimeSeconds) => (
      captures.some((capture) => (
        capture.projectId === manifest.id
        && capture.sampleTimeSeconds === sampleTimeSeconds
        && capture.source === 'main-renderer'
      ))
    ));
    return {
      ...cloneManifest(manifest),
      status: allSamplesCaptured ? 'captured' : manifest.status,
    };
  });
}
