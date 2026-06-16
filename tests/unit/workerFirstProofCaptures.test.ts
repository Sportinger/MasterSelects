import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import type { WorkerFirstGoldenProjectManifest } from '../../src/services/aiTools/workerFirstProofHarness';
import {
  captureWorkerFirstVisiblePresentationProof,
  clearWorkerFirstProofCapturesForTests,
  deriveWorkerFirstCapturedGoldenManifests,
  getWorkerFirstProofCaptures,
  recordWorkerFirstGoldenFixtureCapture,
  recordWorkerFirstShadowParitySample,
  recordWorkerFirstVisiblePresentationProof,
} from '../../src/services/aiTools/workerFirstProofCaptures';
import type {
  WorkerShadowParitySample,
  WorkerVisiblePresentationProof,
} from '../../src/services/aiTools/workerFirstW5Gates';

const originalElementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

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

const changedFingerprint: FrameFingerprint = {
  ...fingerprint,
  hash: 'def67890',
  avgRgb: { r: 20, g: 140, b: 220 },
};

const manifest: WorkerFirstGoldenProjectManifest = {
  id: 'solid-text-image',
  description: 'test manifest',
  sampleTimesSeconds: [0, 1],
  requiredSignals: ['solid'],
  proofSurfaces: ['frame-fingerprint'],
  status: 'fixture-required',
};

function visibleProof(): WorkerVisiblePresentationProof {
  return {
    platform: 'windows-chromium',
    strategy: 'worker-webgpu-main-present',
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
  };
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  Object.defineProperty(canvas, 'isConnected', {
    configurable: true,
    value: true,
  });
  canvas.getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 330,
    bottom: 200,
    width: 320,
    height: 180,
    toJSON: () => ({}),
  } as DOMRect));
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => canvas),
  });
  return canvas;
}

describe('worker-first proof captures', () => {
  beforeEach(() => {
    clearWorkerFirstProofCapturesForTests();
  });

  afterEach(() => {
    clearWorkerFirstProofCapturesForTests();
    vi.restoreAllMocks();
    if (originalElementFromPointDescriptor) {
      Object.defineProperty(document, 'elementFromPoint', originalElementFromPointDescriptor);
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('records proof captures as serializable snapshots and replaces repeated keys', () => {
    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      fingerprint,
      source: 'main-renderer',
      capturedAt: 10,
    });
    recordWorkerFirstShadowParitySample({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      mainFingerprint: fingerprint,
      workerFingerprint: fingerprint,
    }, 20);
    recordWorkerFirstShadowParitySample({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      mainFingerprint: fingerprint,
      workerFingerprint: changedFingerprint,
    }, 30);
    recordWorkerFirstVisiblePresentationProof(visibleProof(), 40);

    const snapshot = getWorkerFirstProofCaptures();

    expect(snapshot.updatedAt).toBe(40);
    expect(snapshot.goldenFixtures).toHaveLength(1);
    expect(snapshot.shadowSamples).toHaveLength(1);
    expect(snapshot.shadowSamples[0].workerFingerprint?.hash).toBe('def67890');
    expect(snapshot.visibleProofs).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);

    (snapshot.shadowSamples as WorkerShadowParitySample[]).length = 0;
    expect(getWorkerFirstProofCaptures().shadowSamples).toHaveLength(1);
  });

  it('derives captured manifest status only after every sample time has a fixture', () => {
    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      fingerprint,
      source: 'export-frame',
      capturedAt: 5,
    });
    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 1,
      fingerprint,
      source: 'worker-shadow-main',
      capturedAt: 6,
    });

    expect(deriveWorkerFirstCapturedGoldenManifests(
      [manifest],
      getWorkerFirstProofCaptures().goldenFixtures,
    )[0].status).toBe('fixture-required');

    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 0,
      fingerprint,
      source: 'main-renderer',
      capturedAt: 10,
    });

    expect(deriveWorkerFirstCapturedGoldenManifests(
      [manifest],
      getWorkerFirstProofCaptures().goldenFixtures,
    )[0].status).toBe('fixture-required');

    recordWorkerFirstGoldenFixtureCapture({
      projectId: 'solid-text-image',
      sampleTimeSeconds: 1,
      fingerprint,
      source: 'main-renderer',
      capturedAt: 20,
    });

    expect(deriveWorkerFirstCapturedGoldenManifests(
      [manifest],
      getWorkerFirstProofCaptures().goldenFixtures,
    )[0].status).toBe('captured');
  });

  it('captures DOM-visible presentation metadata without storing the canvas handle', () => {
    const proof = captureWorkerFirstVisiblePresentationProof({
      platform: 'windows-chromium',
      canvas: createCanvas(),
      strategy: 'worker-cpu-present',
      proofOptions: { includeFingerprint: false },
      stress: {
        playbackDurationMs: 1000,
        frameCount: 30,
        staleVisibleFrameCount: 0,
      },
    });

    const snapshot = getWorkerFirstProofCaptures();

    expect(proof.proof).toMatchObject({
      attached: true,
      cssSize: { width: 320, height: 180 },
      viewportIntersecting: true,
      centerOccluded: false,
      fingerprint: null,
    });
    expect(snapshot.visibleProofs).toHaveLength(1);
    expect(snapshot.visibleProofs[0].platform).toBe('windows-chromium');
    expect(snapshot.visibleProofs[0].proof).toEqual(proof.proof);
    expect(JSON.stringify(snapshot)).not.toContain('HTMLCanvasElement');
  });
});
