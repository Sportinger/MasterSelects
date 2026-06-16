import {
  compareFrameFingerprints,
  type FrameFingerprint,
  type FrameFingerprintComparison,
  type FrameFingerprintOptions,
} from './frameFingerprint';
import type { ToolResult } from './types';
import {
  handleRunWorkerFirstExportGoldenFixture,
} from './workerFirstExportGoldenFixture';
import {
  recordWorkerFirstShadowParitySample,
} from './workerFirstProofCaptures';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
} from './workerFirstProofHarness';
import {
  renderSolidTextImageShadowFrameInWorker,
  recordWorkerFirstShadowParityRunCounters,
  WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
  type WorkerFirstSolidTextImageShadowRenderPlan,
  type WorkerFirstSolidTextImageShadowRenderResult,
} from './workerFirstSolidTextImageShadowParity';

const PROJECT_ID = 'export' as const;

export interface WorkerFirstExportShadowParityDeps {
  readonly materializeAndCaptureMainFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly renderWorkerShadowFingerprint: (
    plan: WorkerFirstSolidTextImageShadowRenderPlan,
    options: FrameFingerprintOptions,
  ) => Promise<WorkerFirstSolidTextImageShadowRenderResult>;
}

const DEFAULT_DEPS: WorkerFirstExportShadowParityDeps = {
  materializeAndCaptureMainFixture: (args) => handleRunWorkerFirstExportGoldenFixture(args),
  renderWorkerShadowFingerprint: (plan, options) => renderSolidTextImageShadowFrameInWorker(plan, options),
};

function manifestSampleTimes(): readonly number[] {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('export golden manifest is missing');
  }
  return manifest.sampleTimesSeconds;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function readSampleDimension(
  args: Record<string, unknown>,
  key: 'sampleWidth' | 'sampleHeight',
): number | undefined {
  if (args[key] === undefined) return undefined;
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(256, Math.round(value)));
}

function hasCallerProofFields(args: Record<string, unknown>): boolean {
  return args.mainFingerprint !== undefined
    || args.workerFingerprint !== undefined
    || args.fingerprint !== undefined
    || args.thresholds !== undefined
    || args.source !== undefined
    || args.captures !== undefined;
}

function isFrameFingerprint(value: unknown): value is FrameFingerprint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FrameFingerprint>;
  return typeof candidate.hash === 'string'
    && typeof candidate.sourceWidth === 'number'
    && typeof candidate.sourceHeight === 'number'
    && typeof candidate.nonBlankRatio === 'number'
    && typeof candidate.alphaCoverage === 'number'
    && typeof candidate.meanLuma === 'number'
    && !!candidate.avgRgb
    && typeof candidate.avgRgb.r === 'number'
    && typeof candidate.avgRgb.g === 'number'
    && typeof candidate.avgRgb.b === 'number'
    && !!candidate.colorRange
    && typeof candidate.colorRange.r === 'number'
    && typeof candidate.colorRange.g === 'number'
    && typeof candidate.colorRange.b === 'number'
    && typeof candidate.colorRange.luma === 'number';
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readFixtureCaptures(result: ToolResult): readonly Record<string, unknown>[] {
  const data = readObject(result.data);
  return Array.isArray(data?.captures)
    ? data.captures.filter((capture): capture is Record<string, unknown> => Boolean(readObject(capture)))
    : [];
}

function readMainFingerprintFromFixture(
  fixtureResult: ToolResult,
  sampleTimeSeconds: number,
): FrameFingerprint | null {
  const capture = readFixtureCaptures(fixtureResult)
    .find((entry) => entry.sampleTimeSeconds === sampleTimeSeconds);
  return isFrameFingerprint(capture?.fingerprint) ? capture.fingerprint : null;
}

function createShadowPlan(args: Record<string, unknown>, sampleTimeSeconds: number): WorkerFirstSolidTextImageShadowRenderPlan {
  const width = Math.round(readNumberArg(args, 'width', 1280, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', 720, 180, 2160));
  const minDuration = Math.max(...manifestSampleTimes()) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', 2.35, minDuration, 30);
  return {
    projectId: PROJECT_ID,
    width,
    height,
    durationSeconds,
    sampleTimeSeconds,
  };
}

function buildFingerprintOptions(args: Record<string, unknown>): FrameFingerprintOptions {
  const sampleWidth = readSampleDimension(args, 'sampleWidth');
  const sampleHeight = readSampleDimension(args, 'sampleHeight');
  return {
    ...(sampleWidth !== undefined ? { sampleWidth } : {}),
    ...(sampleHeight !== undefined ? { sampleHeight } : {}),
  };
}

export async function handleRunWorkerFirstExportShadowParity(
  args: Record<string, unknown>,
  deps: WorkerFirstExportShadowParityDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This worker-shadow parity runner only supports the export golden fixture.',
      data: {
        projectId: PROJECT_ID,
      },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Worker-shadow parity fingerprints, source, captures, and thresholds are captured by the browser and cannot be caller-supplied.',
    };
  }

  const fingerprintOptions = buildFingerprintOptions(args);
  const fixtureResult = await deps.materializeAndCaptureMainFixture({
    ...args,
    projectId: PROJECT_ID,
    restoreTimelineAfterRun: false,
  });
  if (!fixtureResult.success) {
    return fixtureResult;
  }

  const sampleResults: Array<{
    readonly sampleTimeSeconds: number;
    readonly mainFingerprint: FrameFingerprint;
    readonly workerFingerprint: FrameFingerprint;
    readonly comparison: FrameFingerprintComparison;
    readonly worker: Omit<WorkerFirstSolidTextImageShadowRenderResult, 'fingerprint'>;
  }> = [];
  const failures: Array<{ sampleTimeSeconds: number; error: string }> = [];

  for (const sampleTimeSeconds of manifestSampleTimes()) {
    const mainFingerprint = readMainFingerprintFromFixture(fixtureResult, sampleTimeSeconds);
    if (!mainFingerprint) {
      failures.push({
        sampleTimeSeconds,
        error: 'Export golden fixture capture did not return a main renderer fingerprint.',
      });
      continue;
    }

    try {
      const plan = createShadowPlan(args, sampleTimeSeconds);
      const workerResult = await deps.renderWorkerShadowFingerprint(plan, fingerprintOptions);
      const comparison = compareFrameFingerprints(
        mainFingerprint,
        workerResult.fingerprint,
        WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
      );
      recordWorkerFirstShadowParitySample({
        projectId: PROJECT_ID,
        sampleTimeSeconds,
        mainFingerprint,
        workerFingerprint: workerResult.fingerprint,
        thresholds: WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
      });
      sampleResults.push({
        sampleTimeSeconds,
        mainFingerprint,
        workerFingerprint: workerResult.fingerprint,
        comparison,
        worker: {
          renderer: workerResult.renderer,
          workerMs: workerResult.workerMs,
        },
      });
      if (!comparison.passed) {
        failures.push({
          sampleTimeSeconds,
          error: comparison.failures.join(', '),
        });
      }
    } catch (error) {
      failures.push({
        sampleTimeSeconds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  recordWorkerFirstShadowParityRunCounters({
    projectId: PROJECT_ID,
    samples: sampleResults,
    failures,
    capturedAt: Date.now(),
  });

  const data = {
    projectId: PROJECT_ID,
    manifestSampleTimesSeconds: manifestSampleTimes(),
    fixture: fixtureResult.data,
    samples: sampleResults,
    failures,
    thresholds: WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
    w5StartPermissionsRemainStatsGuarded: true,
  };

  return failures.length > 0
    ? {
        success: false,
        error: 'One or more export worker-shadow parity samples failed.',
        data,
      }
    : {
        success: true,
        data,
      };
}
