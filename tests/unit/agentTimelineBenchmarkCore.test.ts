import { describe, expect, it } from 'vitest';
import {
  createSyntheticMeasurement,
  evaluateBenchmarkBudget,
  runBenchmarkCase,
  runSyntheticBenchmark,
} from '../../scripts/agent-timeline/benchmarkCore.mjs';
import {
  createReferenceCorpusManifest,
  validateReferenceCorpusManifest,
} from '../../scripts/agent-timeline/referenceCorpus.mjs';

describe('agent timeline Phase-0A benchmark harness', () => {
  it('keeps the reference corpus schema explicit and validates duplicate fixture IDs', () => {
    const corpus = createReferenceCorpusManifest();
    expect(validateReferenceCorpusManifest(corpus)).toEqual([]);
    corpus.cases[1].id = corpus.cases[0].id;
    expect(validateReferenceCorpusManifest(corpus)).toContain(`duplicate case id: ${corpus.cases[0].id}`);
  });

  it('evaluates relative and absolute budget gates separately', () => {
    const result = evaluateBenchmarkBudget({
      profile: 'quick',
      baselineMs: 100,
      measurement: { wallTimeMs: 130, durationSeconds: 60, rssBytes: 90, outputBytes: 60 },
      absoluteBudget: { maxRssBytes: 80, maxOutputBytesPerMinute: 50 },
    });
    expect(result.passed).toBe(false);
    expect(result.relativeRatio).toBeCloseTo(1.3);
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('relative wall time'),
      expect.stringContaining('RSS'),
      expect.stringContaining('output/minute'),
    ]));
  });

  it('is deterministic for synthetic fixtures when its measurements are injected', async () => {
    const corpus = createReferenceCorpusManifest();
    const first = createSyntheticMeasurement(corpus.cases[0], { profile: 'balanced', cacheState: 'cold' });
    const second = createSyntheticMeasurement(corpus.cases[0], { profile: 'balanced', cacheState: 'cold' });
    expect(second).toEqual(first);

    let tick = 0;
    const fixedNow = () => (tick += 5);
    const report = await runSyntheticBenchmark({
      profiles: ['quick'],
      cacheStates: ['warm'],
      now: fixedNow,
      rss: () => 42,
    });
    expect(report.summary.completedRuns).toBe(corpus.cases.length);
    expect(report.runs.every((run) => run.observed.wallTimeMs === 5 && run.observed.rssBytes === 42)).toBe(true);
    expect(report).toMatchObject({ qualifying: false, gateMeasurements: [] });
  });

  it('stops at a cancellation checkpoint without running later work', async () => {
    const result = await runBenchmarkCase({
      referenceCase: createReferenceCorpusManifest().cases[0],
      profile: 'quick',
      cacheState: 'cold',
      shouldCancel: (checkpoint) => checkpoint === 'before-run',
      operation: () => {
        throw new Error('operation must not run after cancellation');
      },
      now: () => 0,
      rss: () => 1,
    });
    expect(result.status).toBe('cancelled');
    expect(result.checkpoints).toEqual([{ name: 'before-run', cancelled: true }]);
  });

  it('propagates cancellation raised by an operation checkpoint', async () => {
    const result = await runBenchmarkCase({
      referenceCase: createReferenceCorpusManifest().cases[0],
      profile: 'quick',
      cacheState: 'cold',
      shouldCancel: (checkpoint) => checkpoint === 'decode',
      operation: ({ checkpoint }) => {
        checkpoint('decode');
        return { outputBytes: 0 };
      },
      now: () => 0,
      rss: () => 1,
    });
    expect(result.status).toBe('cancelled');
    expect(result.checkpoints).toEqual(expect.arrayContaining([{ name: 'decode', cancelled: true }]));
  });
});
