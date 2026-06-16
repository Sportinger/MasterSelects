import { describe, expect, it } from 'vitest';

import {
  stableStringifyWorkerFirstEvidence,
} from '../../src/services/aiTools/workerFirstPlatformEvidencePackage';
import { handleVerifyWorkerFirstPlatformEvidenceMatrix } from '../../src/services/aiTools/workerFirstPlatformEvidenceMatrix';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
  type WorkerFirstProofPlatform,
} from '../../src/services/aiTools/workerFirstW5Gates';

const hashEvidence = async (payload: string): Promise<string> => {
  let hash = 0;
  for (let index = 0; index < payload.length; index += 1) {
    hash = (Math.imul(hash, 31) + payload.charCodeAt(index)) >>> 0;
  }
  return `hash-${hash.toString(16)}-${payload.length}`;
};

function createPackagePayload(platform: WorkerFirstProofPlatform): Record<string, unknown> {
  return {
    schema: 'worker-first-platform-evidence/v1',
    packageId: `worker-first-platform-evidence:${platform}:1000`,
    createdAt: 1000,
    finishedAt: 1200,
    durationMs: 200,
    platform,
    strategy: 'worker-cpu-present',
    requiredPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
    settings: {
      durationMs: 1000,
      width: 1280,
      height: 720,
    },
    capabilityProbe: {
      platform,
      selectedStrategy: 'worker-cpu-present',
      browserEngine: platform.includes('firefox') ? 'firefox' : platform.includes('safari') ? 'safari' : 'chromium',
      os: platform.startsWith('linux') ? 'linux' : platform.startsWith('macos') ? 'macos' : 'windows',
      facts: { workerNavigatorGpu: true },
      timestamp: 1100,
    },
    fixture: {
      success: true,
      error: null,
      data: { projectId: 'solid-text-image' },
    },
    visibleStress: {
      source: 'renderTarget:preview',
      platform,
      strategy: 'worker-cpu-present',
      playbackDurationMs: 1000,
      frameCount: 24,
      staleVisibleFrameCount: 0,
      nonBlankRatio: 1,
      attached: true,
      viewportIntersecting: true,
      centerOccluded: false,
      errors: [],
    },
    statsBeforeStress: {
      engineReady: true,
      w5GateEvidenceMode: 'stats-observation',
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    statsAfterStress: {
      engineReady: true,
      w5GateEvidenceMode: 'stats-observation',
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    playbackTrace: {
      playbackStatus: 'ok',
      previewFrames: 24,
      previewUpdates: 24,
      stalePreviewFrames: 0,
      w5GateEvidenceMode: 'stats-observation',
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    acceptedGate: {
      w5GateEvidenceMode: 'accepted-gate-run',
      proofCaptureCounts: {
        goldenFixtures: 38,
        shadowSamples: 10,
        visibleProofs: 1,
      },
      workerShadowParityStatus: 'passed',
      visiblePresentationStatus: 'blocked',
      missingPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.filter((entry) => entry !== platform),
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
    },
    checks: {
      capabilityProbeSucceeded: true,
      platformResolved: true,
      fixtureSucceeded: true,
      visibleStressSucceeded: true,
      visibleStressNoStaleFrames: true,
      visibleStressNonBlank: true,
      statsBeforeStressSucceeded: true,
      statsAfterStressSucceeded: true,
      playbackTraceSucceeded: true,
      statsStartPermissionsRemainFalse: true,
      traceStartPermissionsRemainFalse: true,
    },
    errors: {
      fixture: null,
      visibleStress: null,
      statsBeforeStress: null,
      statsAfterStress: null,
      playbackTrace: null,
    },
    w5StartPermissionsRemainStatsGuarded: true,
  };
}

async function signedPackage(platform: WorkerFirstProofPlatform): Promise<Record<string, unknown>> {
  const payload = createPackagePayload(platform);
  return {
    ...payload,
    evidenceHash: await hashEvidence(stableStringifyWorkerFirstEvidence(payload)),
  };
}

describe('worker-first platform evidence matrix', () => {
  it('passes only when every required platform has one valid hash-checked package', async () => {
    const packages = await Promise.all(WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.map(signedPackage));

    const result = await handleVerifyWorkerFirstPlatformEvidenceMatrix({ packages }, { hashEvidence });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      matrixComplete: true,
      providedPackageCount: 5,
      validPackageCount: 5,
      missingPlatforms: [],
      duplicatePlatforms: [],
      canStartWorkerWebGpu: false,
      canStartWorkerPresentation: false,
      canStartRenderDispatcherCutover: false,
      w5StartPermissionsRemainStatsGuarded: true,
    });
  });

  it('reports missing required platforms without accepting a partial matrix', async () => {
    const packages = [await signedPackage('windows-chromium')];

    const result = await handleVerifyWorkerFirstPlatformEvidenceMatrix({ packages }, { hashEvidence });

    expect(result.success).toBe(false);
    expect(result.error).toContain('incomplete');
    expect(result.data).toMatchObject({
      matrixComplete: false,
      validPackageCount: 1,
      missingPlatforms: [
        'linux-chromium-mesa',
        'linux-firefox-mesa',
        'macos-safari',
        'macos-firefox',
      ],
    });
  });

  it('rejects tampered packages even when the platform is present', async () => {
    const tampered = await signedPackage('windows-chromium');
    (tampered.visibleStress as Record<string, unknown>).nonBlankRatio = 0;

    const result = await handleVerifyWorkerFirstPlatformEvidenceMatrix({
      packages: [tampered],
    }, { hashEvidence });

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      invalidPackages: [
        expect.objectContaining({
          index: 0,
          platform: 'windows-chromium',
          status: 'invalid',
          failures: expect.arrayContaining([
            'visibleStress.nonBlankRatio:0',
            'evidenceHash:mismatch',
          ]),
        }),
      ],
    });
  });

  it('fails duplicate valid packages for the same platform', async () => {
    const packages = await Promise.all([
      signedPackage('windows-chromium'),
      signedPackage('windows-chromium'),
      signedPackage('linux-chromium-mesa'),
      signedPackage('linux-firefox-mesa'),
      signedPackage('macos-safari'),
      signedPackage('macos-firefox'),
    ]);

    const result = await handleVerifyWorkerFirstPlatformEvidenceMatrix({ packages }, { hashEvidence });

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      matrixComplete: false,
      duplicatePlatforms: ['windows-chromium'],
      missingPlatforms: [],
    });
  });

  it('requires a packages array', async () => {
    const result = await handleVerifyWorkerFirstPlatformEvidenceMatrix({}, { hashEvidence });

    expect(result.success).toBe(false);
    expect(result.error).toContain('packages array');
  });
});
