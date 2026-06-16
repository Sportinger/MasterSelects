import {
  compareFrameFingerprints,
  type FrameFingerprint,
  type FrameFingerprintComparisonThresholds,
} from './frameFingerprint';
import type { DomVisibleCanvasProof } from './visiblePixelProof';
import type {
  WorkerFirstGoldenProjectId,
  WorkerFirstGoldenProjectManifest,
  WorkerFirstProofCounters,
} from './workerFirstProofHarness';
import type {
  RenderCapabilityProbeResult,
  RenderPresentationStrategy,
} from '../render/renderCapabilityProbe';

export type WorkerFirstProofPlatform =
  | 'windows-chromium'
  | 'linux-chromium-mesa'
  | 'linux-firefox-mesa'
  | 'macos-safari'
  | 'macos-firefox';

export type WorkerFirstGateStatus = 'passed' | 'failed' | 'blocked';

export interface WorkerFirstGateCheck {
  readonly id: string;
  readonly status: WorkerFirstGateStatus;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly blockers: readonly string[];
}

export interface WorkerFirstGateResult {
  readonly id: string;
  readonly status: WorkerFirstGateStatus;
  readonly checks: readonly WorkerFirstGateCheck[];
}

export interface WorkerShadowParitySample {
  readonly projectId: WorkerFirstGoldenProjectId;
  readonly sampleTimeSeconds: number;
  readonly mainFingerprint: FrameFingerprint | null;
  readonly workerFingerprint: FrameFingerprint | null;
  readonly thresholds?: FrameFingerprintComparisonThresholds;
}

export interface WorkerVisiblePresentationProof {
  readonly platform: WorkerFirstProofPlatform;
  readonly strategy: RenderPresentationStrategy;
  readonly proof: DomVisibleCanvasProof | null;
  readonly capabilityProbe: RenderCapabilityProbeResult | null;
  readonly stress: {
    readonly playbackDurationMs: number;
    readonly frameCount: number;
    readonly staleVisibleFrameCount: number;
  } | null;
}

export interface WorkerFirstW5PrerequisiteOptions {
  readonly manifests: readonly WorkerFirstGoldenProjectManifest[];
  readonly counters: WorkerFirstProofCounters;
  readonly shadowSamples?: readonly WorkerShadowParitySample[];
  readonly visibleProofs?: readonly WorkerVisiblePresentationProof[];
  readonly requiredPlatforms?: readonly WorkerFirstProofPlatform[];
  readonly maxQueueDepth?: number;
  readonly minVisibleNonBlankRatio?: number;
}

export interface WorkerFirstW5PrerequisiteReport {
  readonly workerShadowParity: WorkerFirstGateResult;
  readonly visiblePresentation: WorkerFirstGateResult;
  readonly canStartWorkerWebGpu: boolean;
  readonly canStartWorkerPresentation: boolean;
  readonly canStartRenderDispatcherCutover: boolean;
}

export const WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS: readonly WorkerFirstProofPlatform[] = [
  'windows-chromium',
  'linux-chromium-mesa',
  'linux-firefox-mesa',
  'macos-safari',
  'macos-firefox',
];

function checkStatus(checks: readonly WorkerFirstGateCheck[]): WorkerFirstGateStatus {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.some((check) => check.status === 'blocked')) return 'blocked';
  return 'passed';
}

function makeCheck(input: WorkerFirstGateCheck): WorkerFirstGateCheck {
  return input;
}

function fixtureCaptureCheck(manifests: readonly WorkerFirstGoldenProjectManifest[]): WorkerFirstGateCheck {
  const missing = manifests.filter((manifest) => manifest.status !== 'captured');
  return makeCheck({
    id: 'golden-fixtures-captured',
    status: missing.length === 0 ? 'passed' : 'blocked',
    summary: missing.length === 0
      ? 'All golden manifests have captured fixtures.'
      : `${missing.length} golden manifests still need captured fixtures.`,
    evidence: manifests
      .filter((manifest) => manifest.status === 'captured')
      .map((manifest) => manifest.id),
    blockers: missing.map((manifest) => `${manifest.id}:${manifest.status}`),
  });
}

function shadowFingerprintCheck(samples: readonly WorkerShadowParitySample[]): WorkerFirstGateCheck {
  if (samples.length === 0) {
    return makeCheck({
      id: 'golden-fingerprint-parity',
      status: 'blocked',
      summary: 'No worker-shadow fingerprint samples have been captured.',
      evidence: [],
      blockers: ['worker-shadow samples missing'],
    });
  }

  const failures: string[] = [];
  const evidence: string[] = [];
  const blockers: string[] = [];
  for (const sample of samples) {
    const sampleId = `${sample.projectId}@${sample.sampleTimeSeconds}`;
    if (!sample.mainFingerprint || !sample.workerFingerprint) {
      blockers.push(`${sampleId}:missing fingerprint`);
      continue;
    }
    const comparison = compareFrameFingerprints(
      sample.mainFingerprint,
      sample.workerFingerprint,
      sample.thresholds,
    );
    if (comparison.passed) {
      evidence.push(`${sampleId}:passed`);
    } else {
      failures.push(`${sampleId}:${comparison.failures.join(',')}`);
    }
  }

  return makeCheck({
    id: 'golden-fingerprint-parity',
    status: failures.length > 0 ? 'failed' : blockers.length > 0 ? 'blocked' : 'passed',
    summary: failures.length > 0
      ? `${failures.length} worker-shadow fingerprint samples failed.`
      : blockers.length > 0
        ? `${blockers.length} worker-shadow fingerprint samples are incomplete.`
        : `${evidence.length} worker-shadow fingerprint samples match.`,
    evidence,
    blockers: [...failures, ...blockers],
  });
}

function queueDepthCheck(counters: WorkerFirstProofCounters, maxQueueDepth: number): WorkerFirstGateCheck {
  return makeCheck({
    id: 'queue-depth-bounded',
    status: counters.queueDepth <= maxQueueDepth ? 'passed' : 'failed',
    summary: `Queue depth is ${counters.queueDepth}; max allowed is ${maxQueueDepth}.`,
    evidence: [`queueDepth:${counters.queueDepth}`],
    blockers: counters.queueDepth <= maxQueueDepth ? [] : [`queueDepth:${counters.queueDepth}`],
  });
}

function frameLifetimeCheck(counters: WorkerFirstProofCounters): WorkerFirstGateCheck {
  const outstanding = counters.frameLifetime.outstanding;
  const leaked = counters.frameLifetime.leaked;
  const passed = outstanding === 0 && leaked === 0;
  return makeCheck({
    id: 'frame-provider-lifetime-drained',
    status: passed ? 'passed' : 'failed',
    summary: `Frame lifetime outstanding=${outstanding}, leaked=${leaked}.`,
    evidence: [
      `outstanding:${outstanding}`,
      `released:${counters.frameLifetime.released}`,
      `closed:${counters.frameLifetime.closed}`,
      `leaked:${leaked}`,
    ],
    blockers: passed ? [] : [`outstanding:${outstanding}`, `leaked:${leaked}`],
  });
}

function evaluateWorkerShadowParity(options: WorkerFirstW5PrerequisiteOptions): WorkerFirstGateResult {
  const checks = [
    fixtureCaptureCheck(options.manifests),
    shadowFingerprintCheck(options.shadowSamples ?? []),
    queueDepthCheck(options.counters, options.maxQueueDepth ?? 2),
    frameLifetimeCheck(options.counters),
  ];
  return {
    id: 'W5_WORKER_SHADOW_PARITY',
    status: checkStatus(checks),
    checks,
  };
}

function platformProofCheck(
  proofs: readonly WorkerVisiblePresentationProof[],
  requiredPlatforms: readonly WorkerFirstProofPlatform[],
): WorkerFirstGateCheck {
  const proven = new Set(proofs.map((proof) => proof.platform));
  const missing = requiredPlatforms.filter((platform) => !proven.has(platform));
  return makeCheck({
    id: 'platform-visible-proofs-captured',
    status: missing.length === 0 ? 'passed' : 'blocked',
    summary: missing.length === 0
      ? 'Visible-presentation proof exists for every required platform.'
      : `${missing.length} required platform visible proofs are missing.`,
    evidence: proofs.map((proof) => `${proof.platform}:${proof.strategy}`),
    blockers: missing,
  });
}

function domVisibleNonblankCheck(
  proofs: readonly WorkerVisiblePresentationProof[],
  minNonBlankRatio: number,
): WorkerFirstGateCheck {
  if (proofs.length === 0) {
    return makeCheck({
      id: 'dom-visible-nonblank',
      status: 'blocked',
      summary: 'No DOM-visible presentation proofs have been captured.',
      evidence: [],
      blockers: ['visible proof missing'],
    });
  }

  const evidence: string[] = [];
  const blockers: string[] = [];
  const failures: string[] = [];
  for (const entry of proofs) {
    const proof = entry.proof;
    if (!proof?.fingerprint) {
      blockers.push(`${entry.platform}:missing fingerprint`);
      continue;
    }
    const prefix = `${entry.platform}:${entry.strategy}`;
    const problems = [
      !proof.attached ? 'detached' : null,
      !proof.viewportIntersecting ? 'outside viewport' : null,
      proof.centerOccluded === true ? 'center occluded' : null,
      proof.errors.length > 0 ? `errors:${proof.errors.join('|')}` : null,
      proof.fingerprint.nonBlankRatio < minNonBlankRatio
        ? `nonBlankRatio:${proof.fingerprint.nonBlankRatio}/${minNonBlankRatio}`
        : null,
    ].filter((problem): problem is string => Boolean(problem));
    if (problems.length > 0) {
      failures.push(`${prefix}:${problems.join(',')}`);
    } else {
      evidence.push(`${prefix}:nonBlankRatio:${proof.fingerprint.nonBlankRatio}`);
    }
  }

  return makeCheck({
    id: 'dom-visible-nonblank',
    status: failures.length > 0 ? 'failed' : blockers.length > 0 ? 'blocked' : 'passed',
    summary: failures.length > 0
      ? `${failures.length} DOM-visible proofs failed.`
      : blockers.length > 0
        ? `${blockers.length} DOM-visible proofs are incomplete.`
        : `${evidence.length} DOM-visible proofs are nonblank.`,
    evidence,
    blockers: [...failures, ...blockers],
  });
}

function noStaleFramesCheck(proofs: readonly WorkerVisiblePresentationProof[]): WorkerFirstGateCheck {
  if (proofs.length === 0) {
    return makeCheck({
      id: 'no-stale-visible-frames-under-stress',
      status: 'blocked',
      summary: 'Playback stress proof is missing.',
      evidence: [],
      blockers: ['visible stress proofs missing'],
    });
  }

  const provenPlatforms = [...new Set(proofs.map((proof) => proof.platform))];
  const stressProofs = proofs.filter((proof) => proof.stress);
  const missingStressPlatforms = provenPlatforms.filter((platform) => (
    !stressProofs.some((proof) => proof.platform === platform)
  ));
  if (missingStressPlatforms.length > 0) {
    return makeCheck({
      id: 'no-stale-visible-frames-under-stress',
      status: 'blocked',
      summary: 'Playback stress proof is missing for at least one proven platform.',
      evidence: stressProofs.map((proof) => `${proof.platform}:frames:${proof.stress?.frameCount}`),
      blockers: missingStressPlatforms,
    });
  }

  const stale = stressProofs.filter((proof) => (proof.stress?.staleVisibleFrameCount ?? 0) > 0);
  return makeCheck({
    id: 'no-stale-visible-frames-under-stress',
    status: stale.length === 0 ? 'passed' : 'failed',
    summary: stale.length === 0
      ? 'No stale visible frames were observed in playback stress proofs.'
      : `${stale.length} platform stress proofs observed stale visible frames.`,
    evidence: stressProofs.map((proof) => (
      `${proof.platform}:stale:${proof.stress?.staleVisibleFrameCount ?? 'missing'}`
    )),
    blockers: stale.map((proof) => `${proof.platform}:stale:${proof.stress?.staleVisibleFrameCount}`),
  });
}

function workerStrategyCheck(proofs: readonly WorkerVisiblePresentationProof[]): WorkerFirstGateCheck {
  if (proofs.length === 0) {
    return makeCheck({
      id: 'worker-presentation-strategy-selected',
      status: 'blocked',
      summary: 'No platform strategy proofs have been captured.',
      evidence: [],
      blockers: ['strategy proofs missing'],
    });
  }
  const blocked = proofs.filter((proof) => proof.strategy === 'main-host-dev');
  return makeCheck({
    id: 'worker-presentation-strategy-selected',
    status: blocked.length === 0 ? 'passed' : 'blocked',
    summary: blocked.length === 0
      ? 'Every visible proof uses a worker-capable presentation strategy.'
      : `${blocked.length} platforms still select the temporary main-host-dev strategy.`,
    evidence: proofs.map((proof) => `${proof.platform}:${proof.strategy}`),
    blockers: blocked.map((proof) => proof.platform),
  });
}

function evaluateVisiblePresentation(options: WorkerFirstW5PrerequisiteOptions): WorkerFirstGateResult {
  const proofs = options.visibleProofs ?? [];
  const requiredPlatforms = options.requiredPlatforms ?? WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS;
  const checks = [
    platformProofCheck(proofs, requiredPlatforms),
    domVisibleNonblankCheck(proofs, options.minVisibleNonBlankRatio ?? 0.05),
    noStaleFramesCheck(proofs),
    workerStrategyCheck(proofs),
  ];
  return {
    id: 'W5_VISIBLE_PRESENTATION_PROVEN',
    status: checkStatus(checks),
    checks,
  };
}

export function createWorkerFirstW5PrerequisiteReport(
  options: WorkerFirstW5PrerequisiteOptions,
): WorkerFirstW5PrerequisiteReport {
  const workerShadowParity = evaluateWorkerShadowParity(options);
  const visiblePresentation = evaluateVisiblePresentation(options);
  const w5GatesPassed = workerShadowParity.status === 'passed'
    && visiblePresentation.status === 'passed';

  return {
    workerShadowParity,
    visiblePresentation,
    canStartWorkerWebGpu: w5GatesPassed,
    canStartWorkerPresentation: w5GatesPassed,
    canStartRenderDispatcherCutover: w5GatesPassed,
  };
}
