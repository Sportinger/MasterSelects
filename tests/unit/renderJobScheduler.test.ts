import { describe, expect, it } from 'vitest';

import { RenderJobScheduler, type RenderSchedulerJob } from '../../src/services/renderJobs/renderJobScheduler';

function job(overrides: Partial<RenderSchedulerJob>): RenderSchedulerJob {
  return {
    id: 'job',
    type: 'independent-preview',
    targetId: 'target',
    compositionId: 'comp',
    priority: 'normal',
    createdAt: 0,
    ...overrides,
  };
}

describe('RenderJobScheduler', () => {
  it('starts higher-priority jobs before older lower-priority jobs', () => {
    const scheduler = new RenderJobScheduler();
    scheduler.enqueue(job({ id: 'low', priority: 'low', createdAt: 1 }));
    scheduler.enqueue(job({ id: 'critical', priority: 'critical', createdAt: 2 }));

    expect(scheduler.startNext(10)?.id).toBe('critical');
    expect(scheduler.complete('critical')).toBe(true);
    expect(scheduler.startNext(10)?.id).toBe('low');
  });

  it('uses latest-wins coalescing for scrub jobs with the same coalesce key', () => {
    const scheduler = new RenderJobScheduler();
    scheduler.enqueue(job({ id: 'scrub-1', type: 'scrub', coalesceKey: 'target:program', createdAt: 1 }));
    scheduler.enqueue(job({ id: 'scrub-2', type: 'scrub', coalesceKey: 'target:program', createdAt: 2 }));

    const snapshot = scheduler.snapshot(3);
    expect(snapshot.queueDepth).toBe(1);
    expect(snapshot.counters.coalesced).toBe(1);
    expect(scheduler.startNext(3)?.id).toBe('scrub-2');
  });

  it('re-sorts after coalescing changes a queued job priority', () => {
    const scheduler = new RenderJobScheduler();
    scheduler.enqueue(job({ id: 'normal', priority: 'normal', createdAt: 1 }));
    scheduler.enqueue(job({
      id: 'scrub-low',
      type: 'scrub',
      priority: 'low',
      coalesceKey: 'target:program',
      createdAt: 2,
    }));
    scheduler.enqueue(job({
      id: 'scrub-critical',
      type: 'scrub',
      priority: 'critical',
      coalesceKey: 'target:program',
      createdAt: 3,
    }));

    expect(scheduler.startNext(4)?.id).toBe('scrub-critical');
    expect(scheduler.startNext(4)?.id).toBe('normal');
  });

  it('does not coalesce exact-frame jobs', () => {
    const scheduler = new RenderJobScheduler();
    scheduler.enqueue(job({ id: 'export-1', type: 'export', coalesceKey: 'export', exactFrame: true }));
    scheduler.enqueue(job({ id: 'export-2', type: 'export', coalesceKey: 'export', exactFrame: true }));

    expect(scheduler.snapshot().queueDepth).toBe(2);
    expect(scheduler.snapshot().counters.coalesced).toBe(0);
  });

  it('coalesces resize requests per target', () => {
    const scheduler = new RenderJobScheduler();
    scheduler.coalesceResize({ targetId: 'program', width: 640, height: 360, devicePixelRatio: 1, requestedAt: 1 });
    scheduler.coalesceResize({ targetId: 'program', width: 1280, height: 720, devicePixelRatio: 2, requestedAt: 2 });

    expect(scheduler.snapshot().counters.resizeCoalesced).toBe(1);
    expect(scheduler.consumeResize('program')).toEqual({
      targetId: 'program',
      width: 1280,
      height: 720,
      devicePixelRatio: 2,
      requestedAt: 2,
    });
    expect(scheduler.consumeResize('program')).toBeNull();
  });

  it('tracks stale responses and queue drains', () => {
    const scheduler = new RenderJobScheduler();
    scheduler.enqueue(job({ id: 'a' }));
    scheduler.enqueue(job({ id: 'b' }));

    expect(scheduler.complete('missing')).toBe(false);
    scheduler.drain('drop');

    const snapshot = scheduler.snapshot();
    expect(snapshot.queueDepth).toBe(0);
    expect(snapshot.counters.staleResponses).toBe(1);
    expect(snapshot.counters.dropped).toBe(2);
  });
});
