import { captureRenderTargetSnapshot } from '../render/renderTargetSnapshotFactory';
import type {
  RenderCapabilityProbeResult,
  RenderPresentationStrategy,
} from '../render/renderCapabilityProbe';
import { getLastRenderCapabilityProbe } from '../render/renderCapabilityProbe';
import type { ToolResult } from './types';
import { handleGetPlaybackTrace, handleGetStats } from './handlers/stats';
import { handleRunWorkerFirstRenderCapabilityProbe } from './workerFirstCapabilityProbeBridge';
import { handleRunWorkerFirstSolidTextImageGoldenFixture } from './workerFirstSolidTextImageGoldenFixture';
import { handleRunWorkerFirstVisiblePresentationStressProof } from './workerFirstVisibleStressBridge';
import {
  createWorkerFirstProofSnapshot,
  type WorkerFirstProofSnapshot,
} from './workerFirstProofHarness';
import { getWorkerFirstProofCaptures } from './workerFirstProofCaptures';
import { getWorkerFirstCounterSources } from './workerFirstCounterSources';
import {
  isWorkerFirstPresentationStrategy,
  resolveWorkerFirstProofPlatformFromProbe,
} from './workerFirstProofPlatform';
import {
  WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
  type WorkerFirstProofPlatform,
} from './workerFirstW5Gates';

export interface WorkerFirstPlatformEvidencePackageDeps {
  readonly runCapabilityProbe?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly prepareVisibleStressFixture?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly runVisibleStressProof?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getStats?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getPlaybackTrace?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly createAcceptedSnapshot?: () => WorkerFirstProofSnapshot;
  readonly hashEvidence?: (payload: string) => Promise<string> | string;
  readonly prepareVisibleSurface?: () => Promise<void> | void;
  readonly now?: () => number;
}

const FORBIDDEN_CALLER_EVIDENCE_FIELDS = [
  'fingerprint',
  'mainFingerprint',
  'workerFingerprint',
  'proof',
  'proofCaptures',
  'goldenFixtures',
  'shadowSamples',
  'visibleProofs',
  'workerShadowParity',
  'visiblePresentation',
  'w5Prerequisites',
  'acceptedSnapshot',
  'allowW5StartFromCapturedEvidence',
  'canStartWorkerWebGpu',
  'canStartWorkerPresentation',
  'canStartRenderDispatcherCutover',
  'capabilityProbe',
  'selectedStrategy',
  'platform',
  'strategy',
  'requiredPlatforms',
  'missingPlatforms',
  'evidenceHash',
  'packageId',
] as const;

const FORWARDED_FIXTURE_NUMERIC_ARGS = [
  'width',
  'height',
  'sampleWidth',
  'sampleHeight',
  'settleMs',
] as const;

const FORWARDED_VISIBLE_STRESS_NUMERIC_ARGS = [
  'settleMs',
  'minPreviewFrames',
  'startTime',
  'playbackSpeed',
  'captureSettleMs',
] as const;

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, readNumber(args[key], fallback)));
}

function readDurationMs(args: Record<string, unknown>): number {
  return Math.round(readNumberArg(args, 'durationMs', 5000, 250, 9000));
}

function prepareVisibleSurfaceForPlatformEvidence(): void {
  if (typeof document === 'undefined') return;
  const styleId = 'worker-first-platform-evidence-overlay-suppression';
  if (document.getElementById(styleId)) return;
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .welcome-overlay-backdrop {
      display: none !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function findForbiddenEvidenceFields(args: Record<string, unknown>): string[] {
  return FORBIDDEN_CALLER_EVIDENCE_FIELDS.filter((field) => args[field] !== undefined);
}

function isCapabilityProbeResult(value: unknown): value is RenderCapabilityProbeResult {
  const record = readObject(value);
  const facts = readObject(record?.facts);
  return Boolean(
    record
    && facts
    && typeof record.timestamp === 'number'
    && typeof record.browserEngine === 'string'
    && typeof record.os === 'string'
    && isWorkerFirstPresentationStrategy(record.selectedStrategy),
  );
}

function extractCapabilityProbe(result: ToolResult): RenderCapabilityProbeResult | null {
  const data = readObject(result.data);
  const probe = data?.capabilityProbe;
  return isCapabilityProbeResult(probe) ? probe : null;
}

function buildVisibleStressFixtureArgs(args: Record<string, unknown>, durationMs: number): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {
    resetProject: true,
    restoreTimelineAfterRun: false,
    durationSeconds: durationMs / 1000 + 0.75,
  };
  for (const key of FORWARDED_FIXTURE_NUMERIC_ARGS) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      forwarded[key] = value;
    }
  }
  return forwarded;
}

function buildVisibleStressArgs(
  args: Record<string, unknown>,
  platform: WorkerFirstProofPlatform,
  strategy: RenderPresentationStrategy,
  durationMs: number,
): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {
    platform,
    strategy,
    durationMs,
  };
  for (const key of FORWARDED_VISIBLE_STRESS_NUMERIC_ARGS) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      forwarded[key] = value;
    }
  }
  if (typeof args.resetDiagnostics === 'boolean') {
    forwarded.resetDiagnostics = args.resetDiagnostics;
  }
  return forwarded;
}

function summarizeCapabilityProbe(probe: RenderCapabilityProbeResult, platform: WorkerFirstProofPlatform | null) {
  return {
    platform,
    selectedStrategy: probe.selectedStrategy,
    browserEngine: probe.browserEngine,
    os: probe.os,
    gpuAdapter: probe.gpuAdapter,
    facts: probe.facts,
    selectionReason: probe.selectionReason,
    timestamp: probe.timestamp,
  };
}

function summarizeVisibleStress(result: ToolResult): Record<string, unknown> | null {
  const data = readObject(result.data);
  if (!data) return null;
  const stress = readObject(data.stress);
  const proofEnvelope = readObject(data.proof);
  const visibleProof = readObject(proofEnvelope?.proof);
  const fingerprint = readObject(visibleProof?.fingerprint);
  return {
    source: data.source ?? null,
    platform: proofEnvelope?.platform ?? null,
    strategy: proofEnvelope?.strategy ?? null,
    playbackDurationMs: stress?.playbackDurationMs ?? null,
    frameCount: stress?.frameCount ?? null,
    staleVisibleFrameCount: stress?.staleVisibleFrameCount ?? null,
    nonBlankRatio: fingerprint?.nonBlankRatio ?? null,
    attached: visibleProof?.attached ?? null,
    viewportIntersecting: visibleProof?.viewportIntersecting ?? null,
    centerOccluded: visibleProof?.centerOccluded ?? null,
    errors: Array.isArray(visibleProof?.errors) ? visibleProof.errors : [],
  };
}

function summarizeStats(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data) ?? {};
  const cacheRuntime = readObject(data.cacheRuntime) ?? {};
  const providerRuntime = readObject(data.providerRuntime) ?? {};
  const scheduler = readObject(data.independentRenderScheduler) ?? {};
  const workerFirstRenderer = readObject(data.workerFirstRenderer) ?? {};
  const prerequisites = readObject(workerFirstRenderer.w5Prerequisites) ?? {};
  return {
    engineReady: readBool(data.engineReady),
    cacheRuntimeRecordCount: Array.isArray(cacheRuntime.records) ? cacheRuntime.records.length : null,
    providerRuntimeRecordCount: Array.isArray(providerRuntime.providers) ? providerRuntime.providers.length : null,
    independentRenderSchedulerJobCount: Array.isArray(scheduler.jobs) ? scheduler.jobs.length : null,
    workerFirstRendererPresent: Object.keys(workerFirstRenderer).length > 0,
    w5GateEvidenceMode: workerFirstRenderer.w5GateEvidenceMode ?? null,
    canStartWorkerWebGpu: readBool(prerequisites.canStartWorkerWebGpu),
    canStartWorkerPresentation: readBool(prerequisites.canStartWorkerPresentation),
    canStartRenderDispatcherCutover: readBool(prerequisites.canStartRenderDispatcherCutover),
  };
}

function summarizeTrace(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data) ?? {};
  const playback = readObject(data.playback) ?? {};
  const workerFirstRenderer = readObject(data.workerFirstRenderer) ?? {};
  const prerequisites = readObject(workerFirstRenderer.w5Prerequisites) ?? {};
  return {
    playbackStatus: playback.status ?? null,
    previewFrames: readNumber(playback.previewFrames),
    previewUpdates: readNumber(playback.previewUpdates),
    stalePreviewFrames: readNumber(playback.stalePreviewFrames),
    workerFirstRendererPresent: Object.keys(workerFirstRenderer).length > 0,
    w5GateEvidenceMode: workerFirstRenderer.w5GateEvidenceMode ?? null,
    canStartWorkerWebGpu: readBool(prerequisites.canStartWorkerWebGpu),
    canStartWorkerPresentation: readBool(prerequisites.canStartWorkerPresentation),
    canStartRenderDispatcherCutover: readBool(prerequisites.canStartRenderDispatcherCutover),
  };
}

function startPermissionsRemainFalse(summary: Record<string, unknown>): boolean {
  return summary.canStartWorkerWebGpu === false
    && summary.canStartWorkerPresentation === false
    && summary.canStartRenderDispatcherCutover === false;
}

function summarizeAcceptedGate(snapshot: WorkerFirstProofSnapshot) {
  const missingPlatforms = WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS.filter((platform) => (
    !snapshot.proofCaptures.visibleProofs.some((proof) => proof.platform === platform)
  ));
  return {
    w5GateEvidenceMode: snapshot.w5GateEvidenceMode,
    proofCaptureCounts: {
      goldenFixtures: snapshot.proofCaptures.goldenFixtures.length,
      shadowSamples: snapshot.proofCaptures.shadowSamples.length,
      visibleProofs: snapshot.proofCaptures.visibleProofs.length,
    },
    workerShadowParityStatus: snapshot.w5Prerequisites.workerShadowParity.status,
    visiblePresentationStatus: snapshot.w5Prerequisites.visiblePresentation.status,
    missingPlatforms,
    canStartWorkerWebGpu: snapshot.w5Prerequisites.canStartWorkerWebGpu,
    canStartWorkerPresentation: snapshot.w5Prerequisites.canStartWorkerPresentation,
    canStartRenderDispatcherCutover: snapshot.w5Prerequisites.canStartRenderDispatcherCutover,
  };
}

function createDefaultAcceptedSnapshot(): WorkerFirstProofSnapshot {
  return createWorkerFirstProofSnapshot({
    targetSnapshot: captureRenderTargetSnapshot(),
    capabilityProbe: getLastRenderCapabilityProbe(),
    proofCaptures: getWorkerFirstProofCaptures(),
    counterSources: getWorkerFirstCounterSources(),
    allowW5StartFromCapturedEvidence: true,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = canonicalize(entry);
      }
    }
    return sorted;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

export function stableStringifyWorkerFirstEvidence(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function hashWorkerFirstEvidencePayload(payload: string): Promise<string> {
  if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(payload);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function handleRunWorkerFirstPlatformEvidencePackage(
  args: Record<string, unknown>,
  deps: WorkerFirstPlatformEvidencePackageDeps = {},
): Promise<ToolResult> {
  const forbiddenFields = findForbiddenEvidenceFields(args);
  if (forbiddenFields.length > 0) {
    return {
      success: false,
      error: 'Platform evidence package captures browser evidence itself; caller-supplied proof fields are not accepted.',
      data: { forbiddenFields },
    };
  }

  const now = deps.now ?? (() => Date.now());
  const runCapabilityProbe = deps.runCapabilityProbe ?? handleRunWorkerFirstRenderCapabilityProbe;
  const prepareVisibleStressFixture = deps.prepareVisibleStressFixture
    ?? handleRunWorkerFirstSolidTextImageGoldenFixture;
  const runVisibleStressProof = deps.runVisibleStressProof ?? handleRunWorkerFirstVisiblePresentationStressProof;
  const getStats = deps.getStats ?? handleGetStats;
  const getPlaybackTrace = deps.getPlaybackTrace ?? handleGetPlaybackTrace;
  const createAcceptedSnapshot = deps.createAcceptedSnapshot ?? createDefaultAcceptedSnapshot;
  const hashEvidence = deps.hashEvidence ?? hashWorkerFirstEvidencePayload;
  const prepareVisibleSurface = deps.prepareVisibleSurface ?? prepareVisibleSurfaceForPlatformEvidence;
  const startedAt = now();
  const durationMs = readDurationMs(args);
  await prepareVisibleSurface();

  const capabilityResult = await runCapabilityProbe({});
  const capabilityProbe = extractCapabilityProbe(capabilityResult);
  if (!capabilityResult.success || !capabilityProbe) {
    return {
      success: false,
      error: capabilityResult.error ?? 'Render capability probe did not return a usable probe result.',
      data: {
        capabilityProbe: capabilityResult.data ?? null,
        w5StartPermissionsRemainStatsGuarded: true,
      },
    };
  }

  const platform = resolveWorkerFirstProofPlatformFromProbe(capabilityProbe);
  if (!platform) {
    return {
      success: false,
      error: 'Current capability probe does not map to a required W5 proof platform.',
      data: {
        capabilityProbe: summarizeCapabilityProbe(capabilityProbe, null),
        requiredPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
        w5StartPermissionsRemainStatsGuarded: true,
      },
    };
  }

  const fixtureResult = await prepareVisibleStressFixture(
    buildVisibleStressFixtureArgs(args, durationMs),
  );
  const statsBeforeStress = await getStats({});
  const visibleStressResult = fixtureResult.success
    ? await runVisibleStressProof(
        buildVisibleStressArgs(args, platform, capabilityProbe.selectedStrategy, durationMs),
      )
    : {
        success: false,
        error: 'Visible stress proof skipped because fixture materialization failed.',
      };
  const statsAfterStress = await getStats({});
  const playbackTrace = await getPlaybackTrace({ windowMs: 5000, limit: 200 });
  const acceptedSnapshot = createAcceptedSnapshot();
  const finishedAt = now();

  const visibleStress = summarizeVisibleStress(visibleStressResult);
  const statsBeforeStressSummary = summarizeStats(statsBeforeStress);
  const statsAfterStressSummary = summarizeStats(statsAfterStress);
  const playbackTraceSummary = summarizeTrace(playbackTrace);
  const acceptedGate = summarizeAcceptedGate(acceptedSnapshot);
  const settings = {
    durationMs,
    fixtureDurationSeconds: durationMs / 1000 + 0.75,
    width: args.width ?? null,
    height: args.height ?? null,
    sampleWidth: args.sampleWidth ?? null,
    sampleHeight: args.sampleHeight ?? null,
    minPreviewFrames: args.minPreviewFrames ?? null,
    settleMs: args.settleMs ?? null,
    captureSettleMs: args.captureSettleMs ?? null,
    startTime: args.startTime ?? null,
    playbackSpeed: args.playbackSpeed ?? null,
  };
  const checks = {
    capabilityProbeSucceeded: true,
    platformResolved: true,
    fixtureSucceeded: fixtureResult.success,
    visibleStressSucceeded: visibleStressResult.success,
    visibleStressAttached: visibleStress?.attached === true,
    visibleStressViewportIntersecting: visibleStress?.viewportIntersecting === true,
    visibleStressNotCenterOccluded: visibleStress?.centerOccluded !== true,
    visibleStressNoStaleFrames: readNumber(visibleStress?.staleVisibleFrameCount, 1) === 0,
    visibleStressNonBlank: readNumber(visibleStress?.nonBlankRatio, 0) >= 0.05,
    statsBeforeStressSucceeded: statsBeforeStress.success,
    statsAfterStressSucceeded: statsAfterStress.success,
    playbackTraceSucceeded: playbackTrace.success,
    statsStartPermissionsRemainFalse: startPermissionsRemainFalse(statsAfterStressSummary),
    traceStartPermissionsRemainFalse: startPermissionsRemainFalse(playbackTraceSummary),
  };
  const passed = Object.values(checks).every(Boolean);
  const packagePayload = {
    schema: 'worker-first-platform-evidence/v1',
    packageId: `worker-first-platform-evidence:${platform}:${startedAt}`,
    createdAt: startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    platform,
    strategy: capabilityProbe.selectedStrategy,
    requiredPlatforms: WORKER_FIRST_REQUIRED_PRESENTATION_PLATFORMS,
    settings,
    capabilityProbe: summarizeCapabilityProbe(capabilityProbe, platform),
    fixture: {
      success: fixtureResult.success,
      error: fixtureResult.error ?? null,
      data: fixtureResult.data ?? null,
    },
    visibleStress,
    statsBeforeStress: statsBeforeStressSummary,
    statsAfterStress: statsAfterStressSummary,
    playbackTrace: playbackTraceSummary,
    acceptedGate,
    checks,
    errors: {
      fixture: fixtureResult.error ?? null,
      visibleStress: visibleStressResult.error ?? null,
      statsBeforeStress: statsBeforeStress.error ?? null,
      statsAfterStress: statsAfterStress.error ?? null,
      playbackTrace: playbackTrace.error ?? null,
    },
    w5StartPermissionsRemainStatsGuarded: true,
  };
  const evidenceHash = await hashEvidence(stableStringifyWorkerFirstEvidence(packagePayload));
  const proofPackage = {
    ...packagePayload,
    evidenceHash,
  };

  return passed
    ? {
        success: true,
        data: {
          package: proofPackage,
          checks,
          w5StartPermissionsRemainStatsGuarded: true,
        },
      }
    : {
        success: false,
        error: 'Platform evidence package did not satisfy all checks.',
        data: {
          package: proofPackage,
          checks,
          w5StartPermissionsRemainStatsGuarded: true,
        },
      };
}
