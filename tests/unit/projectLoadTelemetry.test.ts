import { afterEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../src/services/productAnalytics', () => ({ productAnalytics: analytics }));

import {
  FIRST_FRAME_TIMEOUT_MS,
  formatProjectLoadTiming,
  sanitizeProjectLoadTiming,
  projectLoadAnalyticsProperties,
  readProjectLoadTimings,
  roundLoadMs,
  startProjectLoadMeasurement,
  type ProjectLoadTiming,
} from '../../src/services/project/load/projectLoadTelemetry';
import { PROJECT_LOAD_TIMING_FIELDS, sanitizeProductAnalyticsProperties } from '../../src/services/productAnalytics/catalog';
import { REPOSITORY_LOAD_PHASES } from '../../src/services/project/repository/lifecycle/repositoryLoadTimings';

afterEach(() => {
  analytics.track.mockClear(); vi.unstubAllGlobals(); vi.useRealTimers();
  (globalThis as { __MS_PROJECT_LOAD__?: unknown }).__MS_PROJECT_LOAD__ = undefined;
});

/** Animation frames that run only when the test advances them. */
function manualFrames() {
  const pending = new Map<number, FrameRequestCallback>(); let next = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending.set(next, callback); return next++; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
  return { frame(time = 0) { const due = [...pending.values()]; pending.clear(); for (const callback of due) callback(time); } };
}

const timing = (overrides: Partial<ProjectLoadTiming> = {}): ProjectLoadTiming => ({
  kind: 'create', outcome: 'ready', totalMs: 31_234, storage: 'opfs', writable: true, recoveredRecords: 3,
  phases: { queue: 12, storage_open: 412.4, session_read: 29_876, activation: 81 },
  mainThread: { longTaskMs: 1_234, longTaskMaxMs: 640, longTaskCount: 4, frameGapMaxMs: 28_400, pageHidden: false },
  ...overrides,
});

describe('project load phase telemetry', () => {
  it('rounds durations coarsely and caps them', () => {
    expect(roundLoadMs(4)).toBe(0);
    expect(roundLoadMs(412.4)).toBe(410);
    expect(roundLoadMs(2_345)).toBe(2_300);
    expect(roundLoadMs(29_876)).toBe(30_000);
    expect(roundLoadMs(9_999_999)).toBe(600_000);
    expect(roundLoadMs(Number.NaN)).toBe(0);
  });

  it('sends every phase through the analytics allowlist without project names or paths', () => {
    const properties = projectLoadAnalyticsProperties(timing());
    const sanitized = sanitizeProductAnalyticsProperties('project_load_phases', { ...properties, project_name: 'My secret project', path: 'My secret project' });
    expect(sanitized).toEqual(properties);
    expect(sanitized).toMatchObject({ kind: 'create', outcome: 'ready', storage: 'opfs', total_ms: 31_000, queue_ms: 10,
      storage_open_ms: 410, session_read_ms: 30_000, activation_ms: 80, long_task_ms: 1_200, long_task_max_ms: 640,
      long_task_count: 4, frame_gap_max_ms: 28_000, page_hidden: false, writable: true, recovered_records: 3 });
    expect(JSON.stringify(sanitized)).not.toContain('secret');
    // Each lifecycle phase has an allowlisted field, so no measured phase is dropped on the server.
    for (const phase of REPOSITORY_LOAD_PHASES) expect(PROJECT_LOAD_TIMING_FIELDS).toContain(`${phase}_ms`);
  });

  it('reports one event per finished operation, keeps it for remote debugging and drops no-ops', () => {
    const finish = startProjectLoadMeasurement('open');
    finish({ kind: 'open', outcome: 'failed', totalMs: 640, phases: { session_read: 300 }, storage: 'indexeddb' });
    expect(analytics.track).toHaveBeenCalledWith('project_load_phases', expect.objectContaining({ kind: 'open', storage: 'indexeddb', session_read_ms: 300 }));
    expect(readProjectLoadTimings()).toHaveLength(1);
    startProjectLoadMeasurement('scratch')(null);
    expect(analytics.track).toHaveBeenCalledOnce();
    expect(formatProjectLoadTiming(timing())).toContain('session_read 29876');
  });

  it('keeps the storage worker start for diagnostics, in the window list and the log line, but not in analytics', () => {
    const withWorker = timing({ workerStartMs: 13_790.4 });
    expect(sanitizeProjectLoadTiming(withWorker).workerStartMs).toBe(13_790.4);
    expect(formatProjectLoadTiming(withWorker)).toContain('storage worker start 13790');
    expect(sanitizeProjectLoadTiming(timing({ workerStartMs: Number.NaN }))).not.toHaveProperty('workerStartMs');
    expect(projectLoadAnalyticsProperties(withWorker)).toEqual(projectLoadAnalyticsProperties(timing()));
  });

  it('keeps only a sanitized report on the window: no location, folder handle, path or name', () => {
    const handle = { kind: 'directory', name: 'My secret project' };
    const report = { kind: 'save', outcome: 'ready', totalMs: 40, phases: { publish: 30 }, storage: 'fsa', writable: true,
      location: { kind: 'fsa', handle }, path: 'projects/My secret project', projectName: 'My secret project' };
    startProjectLoadMeasurement('save')(report as unknown as Parameters<ReturnType<typeof startProjectLoadMeasurement>>[0]);
    const [kept] = readProjectLoadTimings();
    expect(Object.keys(kept!).toSorted()).toEqual(['kind', 'mainThread', 'outcome', 'phases', 'storage', 'totalMs', 'writable']);
    expect(kept).toMatchObject({ kind: 'save', outcome: 'ready', storage: 'fsa', phases: { publish: 30 } });
    expect(JSON.stringify((globalThis as { __MS_PROJECT_LOAD__?: unknown }).__MS_PROJECT_LOAD__)).not.toContain('secret');
  });

  it('measures a ready open until the first painted frame after it, and reports a save at once', async () => {
    const frames = manualFrames(); let clock = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const finish = startProjectLoadMeasurement('create');
    finish({ kind: 'create', outcome: 'ready', totalMs: 200, phases: { activation: 50 }, storage: 'opfs' });
    // Still waiting: React has not rendered the editor yet.
    expect(analytics.track).not.toHaveBeenCalled();
    clock += 30_000; frames.frame(); // The frame before the (late) paint.
    await Promise.resolve();
    expect(analytics.track).not.toHaveBeenCalled();
    clock += 16; frames.frame(); // The frame after it.
    await vi.waitFor(() => expect(analytics.track).toHaveBeenCalledOnce());
    expect(analytics.track).toHaveBeenCalledWith('project_load_phases', expect.objectContaining({ kind: 'create', first_frame_ms: 30_000 }));
    expect(readProjectLoadTimings()[0]).toMatchObject({ firstFrameMs: 30_016 });
    expect(formatProjectLoadTiming(readProjectLoadTimings()[0]!)).toContain('first frame 30016');
    expect(sanitizeProductAnalyticsProperties('project_load_phases', { first_frame_ms: 30_000 })).toEqual({ first_frame_ms: 30_000 });

    startProjectLoadMeasurement('save')({ kind: 'save', outcome: 'ready', totalMs: 40, phases: { publish: 30 }, storage: 'opfs' });
    expect(analytics.track).toHaveBeenCalledTimes(2);
    expect(analytics.track).toHaveBeenLastCalledWith('project_load_phases', expect.not.objectContaining({ first_frame_ms: expect.anything() }));
  });

  it('still reports when no frame comes (hidden page or frozen compositor), without a first frame time', () => {
    vi.useFakeTimers(); manualFrames();
    startProjectLoadMeasurement('open')({ kind: 'open', outcome: 'ready', totalMs: 120, phases: {}, storage: 'opfs' });
    expect(analytics.track).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FIRST_FRAME_TIMEOUT_MS);
    return vi.waitFor(() => expect(analytics.track).toHaveBeenCalledOnce()).then(() => {
      expect(readProjectLoadTimings()[0]).not.toHaveProperty('firstFrameMs');
    });
  });
});
