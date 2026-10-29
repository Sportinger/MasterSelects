import { beforeEach, describe, expect, it } from 'vitest';
import {
  MEDIA_IMPORT_REPORT_LIMIT,
  beginMediaImportTiming,
  formatMediaImportReport,
} from '../../src/stores/mediaStore/helpers/importPhaseTimings';

type ImportWindow = typeof globalThis & { __MS_MEDIA_IMPORT__?: unknown[] };

describe('media import phase timings', () => {
  beforeEach(() => {
    delete (globalThis as ImportWindow).__MS_MEDIA_IMPORT__;
  });

  it('records marked and timed phases, the total and the outcome on window.__MS_MEDIA_IMPORT__', async () => {
    let clock = 100;
    const timer = beginMediaImportTiming('pipeline', 'video', 30_000_000, () => clock);
    clock = 350;
    timer.mark('classify');
    const value = await timer.time('copy', async () => {
      clock = 2350;
      return 'copied';
    });
    expect(value).toBe('copied');
    clock = 2400;
    const report = timer.finish('ok');
    expect(report).toEqual({
      kind: 'pipeline', mediaType: 'video', bytes: 30_000_000, startedAt: 100,
      phases: [{ phase: 'classify', ms: 250 }, { phase: 'copy', ms: 2000 }], totalMs: 2300, outcome: 'ok',
    });
    expect((globalThis as ImportWindow).__MS_MEDIA_IMPORT__).toEqual([report]);
    expect(formatMediaImportReport(report)).toBe('classify 250 · copy 2000 (total 2300 ms)');
  });

  it('keeps the time of a phase that throws and ignores phases after finish', async () => {
    let clock = 0;
    const timer = beginMediaImportTiming('phone-add', 'video/mp4', 1, () => clock);
    await expect(timer.time('metadata', async () => { clock = 40; throw new Error('probe failed'); })).rejects.toThrow('probe failed');
    const report = timer.finish('failed');
    timer.mark('late');
    expect(timer.finish('ok')).toBe(report);
    expect(report.phases).toEqual([{ phase: 'metadata', ms: 40 }]);
    expect(report.outcome).toBe('failed');
  });

  it('keeps only the latest reports', () => {
    for (let index = 0; index < MEDIA_IMPORT_REPORT_LIMIT + 3; index++) beginMediaImportTiming('pipeline', 'image', index).finish('ok');
    const list = (globalThis as ImportWindow).__MS_MEDIA_IMPORT__ as Array<{ bytes: number }>;
    expect(list).toHaveLength(MEDIA_IMPORT_REPORT_LIMIT);
    expect(list[0].bytes).toBe(3);
  });
});
