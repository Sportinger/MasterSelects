import { captureRenderTargetSnapshot } from '../render/renderTargetSnapshotFactory';
import {
  getLastRenderCapabilityProbe,
  type RenderCapabilityProbeResult,
  type RenderPresentationStrategy,
} from '../render/renderCapabilityProbe';
import type { ToolResult } from './types';
import { handleRunWorkerFirstBakeGoldenFixture } from './workerFirstBakeGoldenFixture';
import { handleRunWorkerFirstBakeShadowParity } from './workerFirstBakeShadowParity';
import { handleRunWorkerFirstRenderCapabilityProbe } from './workerFirstCapabilityProbeBridge';
import { handleRunWorkerFirstEffectsMasksTransitionsGoldenFixture } from './workerFirstEffectsMasksTransitionsGoldenFixture';
import { handleRunWorkerFirstEffectsMasksTransitionsShadowParity } from './workerFirstEffectsMasksTransitionsShadowParity';
import { handleRunWorkerFirstExportGoldenFixture } from './workerFirstExportGoldenFixture';
import { handleRunWorkerFirstExportShadowParity } from './workerFirstExportShadowParity';
import { handleRunWorkerFirstHtmlProviderGoldenFixture } from './workerFirstHtmlProviderGoldenFixture';
import { handleRunWorkerFirstHtmlProviderShadowParity } from './workerFirstHtmlProviderShadowParity';
import { handleRunWorkerFirstJpegProxyGoldenFixture } from './workerFirstJpegProxyGoldenFixture';
import { handleRunWorkerFirstJpegProxyShadowParity } from './workerFirstJpegProxyShadowParity';
import { handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture } from './workerFirstMultiTargetOutputSliceGoldenFixture';
import { handleRunWorkerFirstMultiTargetOutputSliceShadowParity } from './workerFirstMultiTargetOutputSliceShadowParity';
import { handleRunWorkerFirstMultiVideoGoldenFixture } from './workerFirstMultiVideoGoldenFixture';
import { handleRunWorkerFirstMultiVideoShadowParity } from './workerFirstMultiVideoShadowParity';
import { handleRunWorkerFirstNestedCompsGoldenFixture } from './workerFirstNestedCompsGoldenFixture';
import { handleRunWorkerFirstNestedCompsShadowParity } from './workerFirstNestedCompsShadowParity';
import { handleRunWorkerFirstRamCacheGoldenFixture } from './workerFirstRamCacheGoldenFixture';
import { handleRunWorkerFirstRamCacheShadowParity } from './workerFirstRamCacheShadowParity';
import { handleRunWorkerFirstSolidTextImageGoldenFixture } from './workerFirstSolidTextImageGoldenFixture';
import { handleRunWorkerFirstSolidTextImageShadowParity } from './workerFirstSolidTextImageShadowParity';
import { handleRunWorkerFirstUniversal3dGoldenFixture } from './workerFirstUniversal3dGoldenFixture';
import { handleRunWorkerFirstUniversal3dShadowParity } from './workerFirstUniversal3dShadowParity';
import { handleRunWorkerFirstVisiblePresentationStressProof } from './workerFirstVisibleStressBridge';
import { handleRunWorkerFirstWebCodecsProviderGoldenFixture } from './workerFirstWebCodecsProviderGoldenFixture';
import { handleRunWorkerFirstWebCodecsProviderShadowParity } from './workerFirstWebCodecsProviderShadowParity';
import {
  createWorkerFirstProofSnapshot,
  type WorkerFirstGoldenProjectId,
  type WorkerFirstProofSnapshot,
} from './workerFirstProofHarness';
import {
  isWorkerFirstPresentationStrategy,
  resolveWorkerFirstProofPlatformFromProbe,
} from './workerFirstProofPlatform';
import {
  clearWorkerFirstProofCaptures,
  getWorkerFirstProofCaptures,
} from './workerFirstProofCaptures';
import {
  clearWorkerFirstCounterSources,
  getWorkerFirstCounterSources,
} from './workerFirstCounterSources';
import type { WorkerFirstProofPlatform } from './workerFirstW5Gates';

type WorkerFirstEvidenceRunnerKind = 'golden-fixture' | 'worker-shadow-parity';
type WorkerFirstVisibleEvidenceKind =
  | 'capability-probe'
  | 'visible-stress-fixture'
  | 'visible-presentation-stress';

export interface WorkerFirstW5EvidenceSuiteRunner {
  readonly id: string;
  readonly kind: WorkerFirstEvidenceRunnerKind;
  readonly projectId: WorkerFirstGoldenProjectId;
  readonly run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface WorkerFirstW5EvidenceSuiteDeps {
  readonly runners?: readonly WorkerFirstW5EvidenceSuiteRunner[];
  readonly clearProofCaptures?: () => void;
  readonly createAcceptedSnapshot?: () => WorkerFirstProofSnapshot;
  readonly runCapabilityProbe?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly prepareVisibleStressFixture?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly runVisibleStressProof?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly clearCounterSources?: () => void;
  readonly now?: () => number;
}

export const WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS: readonly WorkerFirstW5EvidenceSuiteRunner[] = [
  {
    id: 'solid-text-image-golden',
    kind: 'golden-fixture',
    projectId: 'solid-text-image',
    run: (args) => handleRunWorkerFirstSolidTextImageGoldenFixture(args),
  },
  {
    id: 'multi-video-golden',
    kind: 'golden-fixture',
    projectId: 'multi-video',
    run: (args) => handleRunWorkerFirstMultiVideoGoldenFixture(args),
  },
  {
    id: 'multi-video-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'multi-video',
    run: (args) => handleRunWorkerFirstMultiVideoShadowParity(args),
  },
  {
    id: 'webcodecs-provider-golden',
    kind: 'golden-fixture',
    projectId: 'webcodecs-provider',
    run: (args) => handleRunWorkerFirstWebCodecsProviderGoldenFixture(args),
  },
  {
    id: 'webcodecs-provider-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'webcodecs-provider',
    run: (args) => handleRunWorkerFirstWebCodecsProviderShadowParity(args),
  },
  {
    id: 'html-provider-fallback-golden',
    kind: 'golden-fixture',
    projectId: 'html-provider-fallback',
    run: (args) => handleRunWorkerFirstHtmlProviderGoldenFixture(args),
  },
  {
    id: 'html-provider-fallback-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'html-provider-fallback',
    run: (args) => handleRunWorkerFirstHtmlProviderShadowParity(args),
  },
  {
    id: 'jpeg-proxy-golden',
    kind: 'golden-fixture',
    projectId: 'jpeg-proxy',
    run: (args) => handleRunWorkerFirstJpegProxyGoldenFixture(args),
  },
  {
    id: 'jpeg-proxy-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'jpeg-proxy',
    run: (args) => handleRunWorkerFirstJpegProxyShadowParity(args),
  },
  {
    id: 'nested-comps-golden',
    kind: 'golden-fixture',
    projectId: 'nested-comps',
    run: (args) => handleRunWorkerFirstNestedCompsGoldenFixture(args),
  },
  {
    id: 'nested-comps-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'nested-comps',
    run: (args) => handleRunWorkerFirstNestedCompsShadowParity(args),
  },
  {
    id: 'effects-masks-transitions-golden',
    kind: 'golden-fixture',
    projectId: 'effects-masks-transitions',
    run: (args) => handleRunWorkerFirstEffectsMasksTransitionsGoldenFixture(args),
  },
  {
    id: 'effects-masks-transitions-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'effects-masks-transitions',
    run: (args) => handleRunWorkerFirstEffectsMasksTransitionsShadowParity(args),
  },
  {
    id: 'multi-target-output-slice-golden',
    kind: 'golden-fixture',
    projectId: 'multi-target-output-slice',
    run: (args) => handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture(args),
  },
  {
    id: 'multi-target-output-slice-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'multi-target-output-slice',
    run: (args) => handleRunWorkerFirstMultiTargetOutputSliceShadowParity(args),
  },
  {
    id: 'ram-cache-golden',
    kind: 'golden-fixture',
    projectId: 'ram-cache',
    run: (args) => handleRunWorkerFirstRamCacheGoldenFixture(args),
  },
  {
    id: 'ram-cache-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'ram-cache',
    run: (args) => handleRunWorkerFirstRamCacheShadowParity(args),
  },
  {
    id: 'bake-golden',
    kind: 'golden-fixture',
    projectId: 'bake',
    run: (args) => handleRunWorkerFirstBakeGoldenFixture(args),
  },
  {
    id: 'bake-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'bake',
    run: (args) => handleRunWorkerFirstBakeShadowParity(args),
  },
  {
    id: 'export-golden',
    kind: 'golden-fixture',
    projectId: 'export',
    run: (args) => handleRunWorkerFirstExportGoldenFixture(args),
  },
  {
    id: 'export-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'export',
    run: (args) => handleRunWorkerFirstExportShadowParity(args),
  },
  {
    id: 'universal-3d-gaussian-cad-golden',
    kind: 'golden-fixture',
    projectId: 'universal-3d-gaussian-cad',
    run: (args) => handleRunWorkerFirstUniversal3dGoldenFixture(args),
  },
  {
    id: 'universal-3d-gaussian-cad-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'universal-3d-gaussian-cad',
    run: (args) => handleRunWorkerFirstUniversal3dShadowParity(args),
  },
  {
    id: 'solid-text-image-worker-shadow',
    kind: 'worker-shadow-parity',
    projectId: 'solid-text-image',
    run: (args) => handleRunWorkerFirstSolidTextImageShadowParity(args),
  },
];

const FORBIDDEN_CALLER_EVIDENCE_FIELDS = [
  'fingerprint',
  'mainFingerprint',
  'workerFingerprint',
  'thresholds',
  'source',
  'proofCaptures',
  'goldenFixtures',
  'shadowSamples',
  'visibleProofs',
  'visiblePresentation',
  'goldenManifests',
  'w5Prerequisites',
  'allowW5StartFromCapturedEvidence',
  'capabilityProbe',
  'selectedStrategy',
  'platform',
  'strategy',
] as const;

const FORWARDED_NUMERIC_ARGS = [
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
] as const;

const DEFAULT_VISIBLE_STRESS_DURATION_MS = 5000;
const MAX_VISIBLE_STRESS_DURATION_MS = 9000;

function createDefaultAcceptedSnapshot(): WorkerFirstProofSnapshot {
  return createWorkerFirstProofSnapshot({
    targetSnapshot: captureRenderTargetSnapshot(),
    capabilityProbe: getLastRenderCapabilityProbe(),
    proofCaptures: getWorkerFirstProofCaptures(),
    counterSources: getWorkerFirstCounterSources(),
    allowW5StartFromCapturedEvidence: true,
  });
}

function findForbiddenEvidenceFields(args: Record<string, unknown>): string[] {
  return FORBIDDEN_CALLER_EVIDENCE_FIELDS.filter((field) => args[field] !== undefined);
}

function readRunnerIdsArg(args: Record<string, unknown>): {
  readonly runnerIds: readonly string[] | null;
  readonly invalidRunnerIdsArg: boolean;
} {
  if (args.runnerIds === undefined) {
    return { runnerIds: null, invalidRunnerIdsArg: false };
  }
  if (!Array.isArray(args.runnerIds)) {
    return { runnerIds: [], invalidRunnerIdsArg: true };
  }
  return {
    runnerIds: args.runnerIds.filter((id): id is string => typeof id === 'string'),
    invalidRunnerIdsArg: false,
  };
}

function selectRunners(
  runners: readonly WorkerFirstW5EvidenceSuiteRunner[],
  args: Record<string, unknown>,
): {
  readonly selected: readonly WorkerFirstW5EvidenceSuiteRunner[];
  readonly requestedRunnerIds: readonly string[] | null;
  readonly invalidRunnerIdsArg: boolean;
  readonly unknownRunnerIds: readonly string[];
} {
  const { runnerIds: requestedRunnerIds, invalidRunnerIdsArg } = readRunnerIdsArg(args);
  if (!requestedRunnerIds) {
    return {
      selected: runners,
      requestedRunnerIds: null,
      invalidRunnerIdsArg,
      unknownRunnerIds: [],
    };
  }

  const knownIds = new Set(runners.map((runner) => runner.id));
  const unknownRunnerIds = requestedRunnerIds.filter((id) => !knownIds.has(id));
  const selected = runners.filter((runner) => requestedRunnerIds.includes(runner.id));
  return {
    selected,
    requestedRunnerIds,
    invalidRunnerIdsArg,
    unknownRunnerIds,
  };
}

function buildRunnerArgs(args: Record<string, unknown>): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {
    resetProject: true,
    restoreTimelineAfterRun: false,
  };
  for (const key of FORWARDED_NUMERIC_ARGS) {
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
): Record<string, unknown> {
  const forwarded: Record<string, unknown> = {
    platform,
    strategy,
    durationMs: readVisibleStressDurationMs(args),
  };
  for (const key of FORWARDED_VISIBLE_STRESS_NUMERIC_ARGS) {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      forwarded[key] = value;
    }
  }
  return forwarded;
}

function readVisibleStressDurationMs(args: Record<string, unknown>): number {
  const value = args.durationMs;
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? value
    : DEFAULT_VISIBLE_STRESS_DURATION_MS;
  return Math.max(250, Math.min(MAX_VISIBLE_STRESS_DURATION_MS, Math.round(numeric)));
}

function buildVisibleStressFixtureArgs(args: Record<string, unknown>): Record<string, unknown> {
  return {
    ...buildRunnerArgs(args),
    durationSeconds: readVisibleStressDurationMs(args) / 1000 + 0.75,
  };
}

function readObject(data: unknown): Record<string, unknown> | null {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
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

function summarizeRunnerResult(result: ToolResult): Record<string, unknown> | null {
  const data = readObject(result.data);
  if (!data) return null;
  const samples = Array.isArray(data.samples) ? data.samples.length : undefined;
  const failures = Array.isArray(data.failures) ? data.failures.length : undefined;
  const captures = Array.isArray(data.captures) ? data.captures.length : undefined;
  return {
    projectId: data.projectId,
    manifestSampleTimesSeconds: data.manifestSampleTimesSeconds,
    samples,
    captures,
    failures,
  };
}

function summarizeCapabilityProbeResult(result: ToolResult): Record<string, unknown> | null {
  const capabilityProbe = extractCapabilityProbe(result);
  if (!capabilityProbe) return null;
  return {
    platform: resolveWorkerFirstProofPlatformFromProbe(capabilityProbe),
    selectedStrategy: capabilityProbe.selectedStrategy,
    browserEngine: capabilityProbe.browserEngine,
    os: capabilityProbe.os,
  };
}

function summarizeVisibleStressResult(result: ToolResult): Record<string, unknown> | null {
  const data = readObject(result.data);
  if (!data) return null;
  const stress = readObject(data.stress);
  const proof = readObject(data.proof);
  const visibleProof = readObject(proof?.proof);
  const fingerprint = readObject(visibleProof?.fingerprint);
  return {
    source: data.source,
    platform: proof?.platform,
    strategy: proof?.strategy,
    frameCount: stress?.frameCount,
    staleVisibleFrameCount: stress?.staleVisibleFrameCount,
    nonBlankRatio: fingerprint?.nonBlankRatio,
  };
}

function missingCapturedManifestIds(snapshot: WorkerFirstProofSnapshot): WorkerFirstGoldenProjectId[] {
  return snapshot.goldenManifests
    .filter((manifest) => manifest.status !== 'captured')
    .map((manifest) => manifest.id);
}

async function runVisiblePresentationEvidence(
  args: Record<string, unknown>,
  deps: WorkerFirstW5EvidenceSuiteDeps,
  now: () => number,
): Promise<Array<{
  readonly id: string;
  readonly kind: WorkerFirstVisibleEvidenceKind;
  readonly success: boolean;
  readonly error?: string;
  readonly durationMs: number;
  readonly summary: Record<string, unknown> | null;
}>> {
  const results: Array<{
    readonly id: string;
    readonly kind: WorkerFirstVisibleEvidenceKind;
    readonly success: boolean;
    readonly error?: string;
    readonly durationMs: number;
    readonly summary: Record<string, unknown> | null;
  }> = [];
  const runCapabilityProbe = deps.runCapabilityProbe ?? handleRunWorkerFirstRenderCapabilityProbe;
  const prepareVisibleStressFixture = deps.prepareVisibleStressFixture ?? handleRunWorkerFirstSolidTextImageGoldenFixture;
  const runVisibleStressProof = deps.runVisibleStressProof ?? handleRunWorkerFirstVisiblePresentationStressProof;

  const capabilityStartedAt = now();
  const capabilityResult = await runCapabilityProbe({});
  results.push({
    id: 'render-capability-probe',
    kind: 'capability-probe',
    success: capabilityResult.success,
    ...(capabilityResult.error ? { error: capabilityResult.error } : {}),
    durationMs: now() - capabilityStartedAt,
    summary: summarizeCapabilityProbeResult(capabilityResult),
  });
  if (!capabilityResult.success) {
    return results;
  }

  const capabilityProbe = extractCapabilityProbe(capabilityResult);
  if (!capabilityProbe) {
    results.push({
      id: 'visible-presentation-stress',
      kind: 'visible-presentation-stress',
      success: false,
      error: 'Render capability probe did not return a usable probe result.',
      durationMs: 0,
      summary: null,
    });
    return results;
  }

  const platform = resolveWorkerFirstProofPlatformFromProbe(capabilityProbe);
  if (!platform) {
    results.push({
      id: 'visible-presentation-stress',
      kind: 'visible-presentation-stress',
      success: false,
      error: 'Current capability probe does not map to a required W5 proof platform.',
      durationMs: 0,
      summary: summarizeCapabilityProbeResult(capabilityResult),
    });
    return results;
  }

  const fixtureStartedAt = now();
  const fixtureResult = await prepareVisibleStressFixture(buildVisibleStressFixtureArgs(args));
  results.push({
    id: 'visible-stress-fixture',
    kind: 'visible-stress-fixture',
    success: fixtureResult.success,
    ...(fixtureResult.error ? { error: fixtureResult.error } : {}),
    durationMs: now() - fixtureStartedAt,
    summary: summarizeRunnerResult(fixtureResult),
  });
  if (!fixtureResult.success) {
    return results;
  }

  const visibleStartedAt = now();
  const visibleResult = await runVisibleStressProof(
    buildVisibleStressArgs(args, platform, capabilityProbe.selectedStrategy),
  );
  results.push({
    id: 'visible-presentation-stress',
    kind: 'visible-presentation-stress',
    success: visibleResult.success,
    ...(visibleResult.error ? { error: visibleResult.error } : {}),
    durationMs: now() - visibleStartedAt,
    summary: summarizeVisibleStressResult(visibleResult),
  });
  return results;
}

export async function handleRunWorkerFirstW5EvidenceSuite(
  args: Record<string, unknown>,
  deps: WorkerFirstW5EvidenceSuiteDeps = {},
): Promise<ToolResult> {
  const forbiddenFields = findForbiddenEvidenceFields(args);
  if (forbiddenFields.length > 0) {
    return {
      success: false,
      error: 'W5 evidence suite captures browser evidence itself; caller-supplied proof fields are not accepted.',
      data: { forbiddenFields },
    };
  }

  const runners = deps.runners ?? WORKER_FIRST_W5_EVIDENCE_SUITE_RUNNERS;
  const runnerSelection = selectRunners(runners, args);
  if (runnerSelection.invalidRunnerIdsArg || runnerSelection.unknownRunnerIds.length > 0) {
    return {
      success: false,
      error: runnerSelection.invalidRunnerIdsArg
        ? 'W5 evidence suite runnerIds must be an array of controlled suite runner ids.'
        : 'W5 evidence suite runnerIds must reference controlled suite runners.',
      data: {
        invalidRunnerIdsArg: runnerSelection.invalidRunnerIdsArg,
        unknownRunnerIds: runnerSelection.unknownRunnerIds,
        allowedRunnerIds: runners.map((runner) => runner.id),
      },
    };
  }

  const now = deps.now ?? (() => Date.now());
  const includeVisiblePresentationProofs = args.includeVisiblePresentationProofs !== false;
  const clearBeforeRun = args.clearBeforeRun !== false;
  const startedAt = now();
  const runnerArgs = buildRunnerArgs(args);
  const runnerResults: Array<{
    readonly id: string;
    readonly kind: WorkerFirstEvidenceRunnerKind;
    readonly projectId: WorkerFirstGoldenProjectId;
    readonly success: boolean;
    readonly error?: string;
    readonly durationMs: number;
    readonly summary: Record<string, unknown> | null;
  }> = [];

  if (clearBeforeRun) {
    (deps.clearProofCaptures ?? clearWorkerFirstProofCaptures)();
    (deps.clearCounterSources ?? clearWorkerFirstCounterSources)();
  }

  for (const runner of runnerSelection.selected) {
    const runnerStartedAt = now();
    try {
      const result = await runner.run(runnerArgs);
      runnerResults.push({
        id: runner.id,
        kind: runner.kind,
        projectId: runner.projectId,
        success: result.success,
        ...(result.error ? { error: result.error } : {}),
        durationMs: now() - runnerStartedAt,
        summary: summarizeRunnerResult(result),
      });
    } catch (error) {
      runnerResults.push({
        id: runner.id,
        kind: runner.kind,
        projectId: runner.projectId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: now() - runnerStartedAt,
        summary: null,
      });
    }
  }

  const visibleEvidenceResults = includeVisiblePresentationProofs
    ? await runVisiblePresentationEvidence(args, deps, now)
    : [];
  const acceptedSnapshot = (deps.createAcceptedSnapshot ?? createDefaultAcceptedSnapshot)();
  const missingManifests = missingCapturedManifestIds(acceptedSnapshot);
  const failedRunners = runnerResults.filter((result) => !result.success);
  const failedVisibleEvidence = visibleEvidenceResults.filter((result) => !result.success);
  const workerShadowStatus = acceptedSnapshot.w5Prerequisites.workerShadowParity.status;
  const suitePassed = failedRunners.length === 0
    && failedVisibleEvidence.length === 0
    && missingManifests.length === 0
    && workerShadowStatus === 'passed';
  const finishedAt = now();
  const data = {
    suiteId: 'W5_ACCEPTED_EVIDENCE_SUITE',
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    runnerArgs,
    runnerSelection: {
      clearBeforeRun,
      requestedRunnerIds: runnerSelection.requestedRunnerIds,
      selectedRunnerIds: runnerSelection.selected.map((runner) => runner.id),
      skippedRunnerIds: runners
        .map((runner) => runner.id)
        .filter((id) => !runnerSelection.selected.some((runner) => runner.id === id)),
    },
    runners: runnerResults,
    visibleEvidence: visibleEvidenceResults,
    failedRunnerIds: failedRunners.map((result) => result.id),
    failedVisibleEvidenceIds: failedVisibleEvidence.map((result) => result.id),
    missingGoldenManifestIds: missingManifests,
    proofCaptureCounts: {
      goldenFixtures: acceptedSnapshot.proofCaptures.goldenFixtures.length,
      shadowSamples: acceptedSnapshot.proofCaptures.shadowSamples.length,
      visibleProofs: acceptedSnapshot.proofCaptures.visibleProofs.length,
    },
    w5GateEvidenceMode: acceptedSnapshot.w5GateEvidenceMode,
    workerShadowParity: acceptedSnapshot.w5Prerequisites.workerShadowParity,
    visiblePresentation: acceptedSnapshot.w5Prerequisites.visiblePresentation,
    canStartWorkerWebGpu: acceptedSnapshot.w5Prerequisites.canStartWorkerWebGpu,
    canStartWorkerPresentation: acceptedSnapshot.w5Prerequisites.canStartWorkerPresentation,
    canStartRenderDispatcherCutover: acceptedSnapshot.w5Prerequisites.canStartRenderDispatcherCutover,
    acceptedSnapshot,
    w5StartPermissionsRemainStatsGuarded: true,
  };

  return suitePassed
    ? { success: true, data }
    : {
        success: false,
        error: 'W5 evidence suite did not complete all required local evidence.',
        data,
      };
}
