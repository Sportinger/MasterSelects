import type { RenderPresentationStrategy } from '../render/renderCapabilityProbe';
import type { ToolResult } from './types';
import {
  hashWorkerFirstEvidencePayload,
  stableStringifyWorkerFirstEvidence,
} from './workerFirstPlatformEvidencePackage';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
  type WorkerFirstProofPlatform,
} from './workerFirstW5Gates';

interface WorkerFirstPlatformEvidenceMatrixDeps {
  readonly hashEvidence?: (payload: string) => Promise<string> | string;
}

interface VerifiedPlatformPackage {
  readonly platform: WorkerFirstProofPlatform;
  readonly status: 'valid' | 'invalid';
  readonly evidenceHash: string | null;
  readonly expectedHash: string | null;
  readonly strategy: string | null;
  readonly frameCount: number | null;
  readonly staleVisibleFrameCount: number | null;
  readonly nonBlankRatio: number | null;
  readonly failures: readonly string[];
}

const REQUIRED_PACKAGE_CHECKS = [
  'capabilityProbeSucceeded',
  'platformResolved',
  'fixtureSucceeded',
  'visibleStressSucceeded',
  'visibleStressNoStaleFrames',
  'visibleStressNonBlank',
  'statsBeforeStressSucceeded',
  'statsAfterStressSucceeded',
  'playbackTraceSucceeded',
  'statsStartPermissionsRemainFalse',
  'traceStartPermissionsRemainFalse',
] as const;

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRequiredPlatform(value: unknown): value is WorkerFirstProofPlatform {
  return WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.includes(value as WorkerFirstProofPlatform);
}

function isWorkerPresentationStrategy(value: unknown): value is RenderPresentationStrategy {
  return value === 'worker-webgpu-present'
    || value === 'worker-webgpu-main-present'
    || value === 'worker-cpu-present';
}

function sameRequiredPlatformSet(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const required = new Set(WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS);
  const provided = new Set(value.filter((entry): entry is string => typeof entry === 'string'));
  return provided.size === required.size
    && [...required].every((platform) => provided.has(platform));
}

function packageWithoutEvidenceHash(pkg: Record<string, unknown>): Record<string, unknown> {
  const { evidenceHash: _evidenceHash, ...payload } = pkg;
  return payload;
}

function allChecksPassed(checks: Record<string, unknown> | null): readonly string[] {
  if (!checks) return ['checks:missing'];
  const failures: string[] = [];
  for (const key of REQUIRED_PACKAGE_CHECKS) {
    if (checks[key] !== true) {
      failures.push(`checks.${key}:${String(checks[key])}`);
    }
  }
  return failures;
}

function startBooleansStayFalse(record: Record<string, unknown> | null, prefix: string): readonly string[] {
  if (!record) return [`${prefix}:missing`];
  return [
    record.canStartWorkerWebGpu === false ? null : `${prefix}.canStartWorkerWebGpu:${String(record.canStartWorkerWebGpu)}`,
    record.canStartWorkerPresentation === false
      ? null
      : `${prefix}.canStartWorkerPresentation:${String(record.canStartWorkerPresentation)}`,
    record.canStartRenderDispatcherCutover === false
      ? null
      : `${prefix}.canStartRenderDispatcherCutover:${String(record.canStartRenderDispatcherCutover)}`,
  ].filter((failure): failure is string => Boolean(failure));
}

async function verifyPackage(
  value: unknown,
  hashEvidence: (payload: string) => Promise<string> | string,
): Promise<VerifiedPlatformPackage> {
  const pkg = readObject(value);
  const platform = readString(pkg?.platform);
  const evidenceHash = readString(pkg?.evidenceHash);
  const strategy = readString(pkg?.strategy);
  const visibleStress = readObject(pkg?.visibleStress);
  const capabilityProbe = readObject(pkg?.capabilityProbe);
  const statsAfterStress = readObject(pkg?.statsAfterStress);
  const playbackTrace = readObject(pkg?.playbackTrace);
  const acceptedGate = readObject(pkg?.acceptedGate);
  const checks = readObject(pkg?.checks);
  const failures: string[] = [];
  let expectedHash: string | null = null;

  if (!pkg) failures.push('package:not-object');
  if (pkg?.schema !== 'worker-first-platform-evidence/v1') failures.push(`schema:${String(pkg?.schema)}`);
  if (!evidenceHash) failures.push('evidenceHash:missing');
  if (!isRequiredPlatform(platform)) failures.push(`platform:${String(platform)}`);
  if (!isWorkerPresentationStrategy(strategy)) failures.push(`strategy:${String(strategy)}`);
  if (!sameRequiredPlatformSet(pkg?.requiredPlatforms)) failures.push('requiredPlatforms:mismatch');
  if (capabilityProbe?.platform !== platform) failures.push('capabilityProbe.platform:mismatch');
  if (visibleStress?.platform !== platform) failures.push('visibleStress.platform:mismatch');
  if (visibleStress?.strategy !== strategy) failures.push('visibleStress.strategy:mismatch');
  if (visibleStress?.attached !== true) failures.push(`visibleStress.attached:${String(visibleStress?.attached)}`);
  if (visibleStress?.viewportIntersecting !== true) {
    failures.push(`visibleStress.viewportIntersecting:${String(visibleStress?.viewportIntersecting)}`);
  }
  if (visibleStress?.centerOccluded === true) failures.push('visibleStress.centerOccluded:true');
  if (Array.isArray(visibleStress?.errors) && visibleStress.errors.length > 0) {
    failures.push(`visibleStress.errors:${visibleStress.errors.join('|')}`);
  }

  const frameCount = readNumber(visibleStress?.frameCount);
  const staleVisibleFrameCount = readNumber(visibleStress?.staleVisibleFrameCount);
  const nonBlankRatio = readNumber(visibleStress?.nonBlankRatio);
  if (frameCount === null || frameCount <= 0) failures.push(`visibleStress.frameCount:${String(frameCount)}`);
  if (staleVisibleFrameCount !== 0) {
    failures.push(`visibleStress.staleVisibleFrameCount:${String(staleVisibleFrameCount)}`);
  }
  if (nonBlankRatio === null || nonBlankRatio < 0.05) {
    failures.push(`visibleStress.nonBlankRatio:${String(nonBlankRatio)}`);
  }

  failures.push(...allChecksPassed(checks));
  if (statsAfterStress?.w5GateEvidenceMode !== 'stats-observation') {
    failures.push(`statsAfterStress.w5GateEvidenceMode:${String(statsAfterStress?.w5GateEvidenceMode)}`);
  }
  if (playbackTrace?.w5GateEvidenceMode !== 'stats-observation') {
    failures.push(`playbackTrace.w5GateEvidenceMode:${String(playbackTrace?.w5GateEvidenceMode)}`);
  }
  failures.push(...startBooleansStayFalse(statsAfterStress, 'statsAfterStress'));
  failures.push(...startBooleansStayFalse(playbackTrace, 'playbackTrace'));
  failures.push(...startBooleansStayFalse(acceptedGate, 'acceptedGate'));
  if (pkg?.w5StartPermissionsRemainStatsGuarded !== true) {
    failures.push(`w5StartPermissionsRemainStatsGuarded:${String(pkg?.w5StartPermissionsRemainStatsGuarded)}`);
  }

  if (pkg && evidenceHash) {
    expectedHash = await hashEvidence(stableStringifyWorkerFirstEvidence(packageWithoutEvidenceHash(pkg)));
    if (expectedHash !== evidenceHash) {
      failures.push('evidenceHash:mismatch');
    }
  }

  return {
    platform: isRequiredPlatform(platform) ? platform : 'windows-chromium',
    status: failures.length === 0 ? 'valid' : 'invalid',
    evidenceHash,
    expectedHash,
    strategy,
    frameCount,
    staleVisibleFrameCount,
    nonBlankRatio,
    failures,
  };
}

function readPackages(args: Record<string, unknown>): readonly unknown[] | null {
  return Array.isArray(args.packages) ? args.packages : null;
}

export async function handleVerifyWorkerFirstPlatformEvidenceMatrix(
  args: Record<string, unknown>,
  deps: WorkerFirstPlatformEvidenceMatrixDeps = {},
): Promise<ToolResult> {
  const packages = readPackages(args);
  if (!packages) {
    return {
      success: false,
      error: 'Worker-first platform evidence matrix requires a packages array.',
      data: {
        requiredPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
        w5StartPermissionsRemainStatsGuarded: true,
      },
    };
  }

  const hashEvidence = deps.hashEvidence ?? hashWorkerFirstEvidencePayload;
  const verified = await Promise.all(packages.map((pkg) => verifyPackage(pkg, hashEvidence)));
  const validByPlatform: Partial<Record<WorkerFirstProofPlatform, VerifiedPlatformPackage[]>> = {};
  for (const entry of verified.filter((entry) => entry.status === 'valid')) {
    validByPlatform[entry.platform] = [...(validByPlatform[entry.platform] ?? []), entry];
  }

  const duplicatePlatforms = WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS
    .filter((platform) => (validByPlatform[platform]?.length ?? 0) > 1);
  const missingPlatforms = WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS
    .filter((platform) => (validByPlatform[platform]?.length ?? 0) === 0);
  const invalidPackages = verified
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => entry.status === 'invalid');
  const matrixComplete = missingPlatforms.length === 0
    && duplicatePlatforms.length === 0
    && invalidPackages.length === 0;

  const data = {
    schema: 'worker-first-platform-evidence-matrix/v1',
    requiredPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
    providedPackageCount: packages.length,
    validPackageCount: verified.filter((entry) => entry.status === 'valid').length,
    matrixComplete,
    missingPlatforms,
    duplicatePlatforms,
    invalidPackages,
    platforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.map((platform) => ({
      platform,
      status: duplicatePlatforms.includes(platform)
        ? 'duplicate'
        : (validByPlatform[platform]?.length ?? 0) > 0
          ? 'valid'
          : 'missing',
      packages: validByPlatform[platform] ?? [],
    })),
    canStartWorkerWebGpu: false,
    canStartWorkerPresentation: false,
    canStartRenderDispatcherCutover: false,
    w5StartPermissionsRemainStatsGuarded: true,
  };

  return matrixComplete
    ? { success: true, data }
    : {
        success: false,
        error: 'Worker-first platform evidence matrix is incomplete or invalid.',
        data,
      };
}
