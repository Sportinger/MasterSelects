import { createReferenceCorpusManifest, validateReferenceCorpusManifest } from './referenceCorpus.mjs';

export const AGENT_TIMELINE_BENCHMARK_SCHEMA_VERSION = 1;

export const PROFILE_RELATIVE_LIMITS = Object.freeze({
  quick: 1.25,
  balanced: 2,
  deep: 5,
});

export const DEFAULT_ABSOLUTE_BUDGET = Object.freeze({
  maxRssBytes: 512 * 1024 * 1024,
  maxOutputBytesPerMinute: 2 * 1024 * 1024,
});

function nonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function evaluateBenchmarkBudget({ profile, baselineMs, measurement, absoluteBudget = {} }) {
  const relativeLimit = PROFILE_RELATIVE_LIMITS[profile];
  if (!relativeLimit) throw new TypeError(`Unknown profile: ${profile}`);
  nonNegativeFinite(baselineMs, 'baselineMs');
  if (baselineMs <= 0) throw new TypeError('baselineMs must be greater than zero');
  if (!measurement || typeof measurement !== 'object') throw new TypeError('measurement must be an object');

  const wallTimeMs = nonNegativeFinite(measurement.wallTimeMs, 'measurement.wallTimeMs');
  const durationSeconds = nonNegativeFinite(measurement.durationSeconds, 'measurement.durationSeconds');
  const rssBytes = nonNegativeFinite(measurement.rssBytes, 'measurement.rssBytes');
  const outputBytes = nonNegativeFinite(measurement.outputBytes, 'measurement.outputBytes');
  const limits = { ...DEFAULT_ABSOLUTE_BUDGET, ...absoluteBudget };
  const outputBytesPerMinute = durationSeconds === 0 ? outputBytes : outputBytes / (durationSeconds / 60);
  const relativeRatio = wallTimeMs / baselineMs;
  const failures = [];
  if (relativeRatio > relativeLimit) {
    failures.push(`relative wall time ${relativeRatio.toFixed(3)}x exceeds ${relativeLimit}x`);
  }
  if (Number.isFinite(limits.maxWallTimeMs) && wallTimeMs > limits.maxWallTimeMs) {
    failures.push(`wall time ${wallTimeMs}ms exceeds ${limits.maxWallTimeMs}ms`);
  }
  if (Number.isFinite(limits.maxRssBytes) && rssBytes > limits.maxRssBytes) {
    failures.push(`RSS ${rssBytes} exceeds ${limits.maxRssBytes} bytes`);
  }
  if (Number.isFinite(limits.maxOutputBytes) && outputBytes > limits.maxOutputBytes) {
    failures.push(`output ${outputBytes} exceeds ${limits.maxOutputBytes} bytes`);
  }
  if (Number.isFinite(limits.maxOutputBytesPerMinute) && outputBytesPerMinute > limits.maxOutputBytesPerMinute) {
    failures.push(`output/minute ${Math.round(outputBytesPerMinute)} exceeds ${limits.maxOutputBytesPerMinute} bytes`);
  }
  return {
    passed: failures.length === 0,
    profile,
    relativeLimit,
    relativeRatio,
    outputBytesPerMinute,
    failures,
  };
}

export function createSyntheticMeasurement(referenceCase, { profile, cacheState = 'cold' }) {
  if (!referenceCase || typeof referenceCase !== 'object') throw new TypeError('referenceCase must be an object');
  const profileLimit = PROFILE_RELATIVE_LIMITS[profile];
  if (!profileLimit) throw new TypeError(`Unknown profile: ${profile}`);
  if (!['cold', 'warm'].includes(cacheState)) throw new TypeError('cacheState must be cold or warm');

  const complexity = referenceCase.tags.length + referenceCase.timeline.occurrenceCount * 2;
  const baselineMs = Math.max(1, Math.round(referenceCase.durationSeconds * (cacheState === 'warm' ? 0.18 : 0.9) + complexity * 3));
  const profileFactor = { quick: 1.08, balanced: 1.65, deep: 3.8 }[profile];
  const outputBytes = Math.round(referenceCase.durationSeconds * (cacheState === 'warm' ? 260 : 880) + complexity * 1024);
  return {
    durationSeconds: referenceCase.durationSeconds,
    wallTimeMs: Math.round(baselineMs * profileFactor),
    baselineMs,
    rssBytes: 32 * 1024 * 1024 + complexity * 256 * 1024,
    outputBytes,
    readBytes: Math.round(referenceCase.durationSeconds * (cacheState === 'warm' ? 512 : 4096)),
    decodedFrames: cacheState === 'warm' ? 0 : Math.round(referenceCase.durationSeconds * 2),
    cacheState,
  };
}

export async function runBenchmarkCase({ referenceCase, profile, cacheState, operation, signal, shouldCancel, now = () => performance.now(), rss = () => process.memoryUsage().rss }) {
  const checkpoints = [];
  let cancelled = false;
  const checkpoint = (name) => {
    cancelled = Boolean(cancelled || signal?.aborted || shouldCancel?.(name));
    checkpoints.push({ name, cancelled });
    if (cancelled) return true;
    return false;
  };

  const startedAt = now();
  checkpoint('before-run');
  if (checkpoints.at(-1).cancelled) return { status: 'cancelled', checkpoints, wallTimeMs: 0, rssBytes: rss() };
  const result = await operation({ checkpoint, referenceCase, profile, cacheState });
  const wallTimeMs = Math.max(0, now() - startedAt);
  if (cancelled) return { status: 'cancelled', checkpoints, wallTimeMs, rssBytes: rss() };
  if (checkpoint('after-run')) return { status: 'cancelled', checkpoints, wallTimeMs, rssBytes: rss() };
  return { status: 'completed', checkpoints, wallTimeMs, rssBytes: rss(), result };
}

export async function runSyntheticBenchmark({ profiles = ['quick', 'balanced', 'deep'], cacheStates = ['cold', 'warm'], shouldCancel, now, rss }) {
  const corpus = createReferenceCorpusManifest();
  const schemaErrors = validateReferenceCorpusManifest(corpus);
  if (schemaErrors.length > 0) throw new Error(`Invalid built-in reference corpus: ${schemaErrors.join('; ')}`);
  const runs = [];
  for (const referenceCase of corpus.cases) {
    for (const profile of profiles) {
      for (const cacheState of cacheStates) {
        const executed = await runBenchmarkCase({
          referenceCase,
          profile,
          cacheState,
          shouldCancel,
          now,
          rss,
          operation: ({ checkpoint }) => {
            const measurement = createSyntheticMeasurement(referenceCase, { profile, cacheState });
            checkpoint('synthetic-measurement');
            return measurement;
          },
        });
        if (executed.status === 'cancelled') {
          runs.push({ caseId: referenceCase.id, profile, cacheState, ...executed });
          return buildBenchmarkReport(corpus, runs);
        }
        const measurement = { ...executed.result, wallTimeMs: executed.result.wallTimeMs };
        const budget = evaluateBenchmarkBudget({ profile, baselineMs: measurement.baselineMs, measurement });
        runs.push({
          caseId: referenceCase.id,
          profile,
          cacheState,
          status: executed.status,
          checkpoints: executed.checkpoints,
          observed: { wallTimeMs: executed.wallTimeMs, rssBytes: executed.rssBytes },
          measurement,
          budget,
        });
      }
    }
  }
  return buildBenchmarkReport(corpus, runs);
}

export function buildBenchmarkReport(corpus, runs) {
  const completed = runs.filter((run) => run.status === 'completed');
  const cancelled = runs.filter((run) => run.status === 'cancelled');
  return {
    schemaVersion: AGENT_TIMELINE_BENCHMARK_SCHEMA_VERSION,
    kind: 'agent-timeline-benchmark-report',
    /** Synthetic cases validate contracts only; production gates consume real-media evidence. */
    qualifying: false,
    gateMeasurements: [],
    corpus: clone(corpus),
    runs,
    summary: {
      totalRuns: runs.length,
      completedRuns: completed.length,
      cancelledRuns: cancelled.length,
      failedBudgetRuns: completed.filter((run) => !run.budget.passed).length,
      synthetic: true,
    },
  };
}
