import { describe, it, expect, vi, afterEach } from 'vitest';
import { RepositoryLifecycle, newRepositoryDescriptor } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
import { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { RepositorySessionOptions } from '../../src/services/project/repository/RepositorySession';

vi.mock('../../src/services/project/repository/lifecycle/workspaceProjection', () => ({ readProjectWorkspace: async () => ({}) }));
afterEach(() => vi.restoreAllMocks());
function fakeSession(id: string) {
  return { descriptor: newRepositoryDescriptor(id), opening: { writable: true },
    coordinator: { async handoff(action: () => Promise<void>) { await action(); },
      receipt() { return { repositoryId: id, sessionEpoch: 'test', operationSequence: 0, views: {} }; }, async flush() {} }, close: vi.fn(async () => {}) } as unknown as RepositorySession;
}
const prepared = (id: string) => async () => ({ options: { descriptor: newRepositoryDescriptor(id) } as RepositorySessionOptions });
describe('repository lifecycle handoff', () => {
  it('captures workspace before blocking getters and flushes before activating the next session', async () => {
    const first = fakeSession('first'), second = fakeSession('second');
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const order: string[] = []; let blocked = false;
    const lifecycle = new RepositoryLifecycle({
      async beforeReceipt() { expect(blocked).toBe(false); order.push('capture'); },
      async barrier() { blocked = true; order.push('barrier'); return { release() { blocked = false; } }; },
      async activate(session) { order.push(`activate:${session.descriptor.repositoryId}`); }, install() {},
    });
    await lifecycle.open(prepared('first')); order.length = 0;
    await lifecycle.open(prepared('second'));
    expect(order).toEqual(['capture', 'barrier', 'activate:second']);
    expect(first.close).toHaveBeenCalledOnce();
  });
  it('keeps the activated new session if closing the retired owner fails', async () => {
    const first = fakeSession('first'), second = fakeSession('second');
    vi.mocked(first.close).mockRejectedValue(new Error('Retired close failed'));
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const activated: string[] = [];
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; },
      async activate(session) { activated.push(session.descriptor.repositoryId); }, install() {},
    });
    await lifecycle.open(prepared('first')); await lifecycle.open(prepared('second'));
    expect(lifecycle.getSession()).toBe(second);
    expect(second.close).not.toHaveBeenCalled();
    expect(activated).toEqual(['first', 'second']);
    expect(lifecycle.getState().error).toContain('Previous project cleanup failed');
  });
  it('forwards recovery progress and publishes ready only after activation and installation', async () => {
    const target = fakeSession('progress'); const events: string[] = [];
    let activateStarted!: () => void; let releaseActivation!: () => void;
    const started = new Promise<void>(resolve => { activateStarted = resolve; });
    const gate = new Promise<void>(resolve => { releaseActivation = resolve; });
    vi.spyOn(RepositorySession, 'open').mockImplementation(async options => {
      options.onOpenProgress?.({ phase: 'recovery', processedRecords: 42 });
      options.onOpenProgress?.({ phase: 'projection' }); return target;
    });
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; },
      async activate() { events.push('activate-start'); activateStarted(); await gate; events.push('activate-done'); },
      install() { events.push('install'); }, progress(value) { events.push(`progress:${value.phase}:${value.processedRecords ?? ''}`); },
    });
    const opening = lifecycle.open(prepared('progress')); await started;
    expect(events).toContain('progress:recovery:42');
    expect(events).not.toContain('progress:ready:');
    releaseActivation(); await opening;
    expect(events.slice(-3)).toEqual(['activate-done', 'install', 'progress:ready:']);
    const savedEvents = [...events]; await lifecycle.flush();
    expect(events).toEqual(savedEvents);
  });
  it('reports source preparation before worker recovery without replacing the active project', async () => {
    const first = fakeSession('first'), next = fakeSession('next');
    const events: string[] = [];
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first).mockImplementationOnce(async options => {
      events.push('worker'); options.onOpenProgress?.({ phase: 'recovery' }); return next;
    });
    const lifecycle = new RepositoryLifecycle({
      async barrier() { events.push('barrier'); return { release() {} }; },
      async activate() {}, install() {}, progress(value) { events.push(value.phase); },
    });
    await lifecycle.open(prepared('first')); events.length = 0;
    await lifecycle.open(async onProgress => {
      onProgress({ phase: 'source' }); onProgress({ phase: 'importing' });
      expect(lifecycle.getSession()).toBe(first);
      expect(events).not.toContain('barrier');
      return prepared('next')();
    });
    expect(events).toEqual(['opening', 'source', 'importing', 'barrier', 'worker', 'recovery', 'activation', 'ready']);
    expect(lifecycle.getSession()).toBe(next);
  });
  it.each(['prepare', 'worker', 'activation'] as const)('publishes a terminal failure if %s fails', async stage => {
    const target = fakeSession('failure'); const phases: string[] = [];
    vi.spyOn(RepositorySession, 'open').mockImplementation(async options => {
      options.onOpenProgress?.({ phase: 'recovery' });
      if (stage === 'worker') throw new Error('Worker failed'); return target;
    });
    const release = vi.fn();
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release }; },
      async activate() { if (stage === 'activation') throw new Error('Activation failed'); }, install() {},
      progress(value) { phases.push(value.phase); },
    });
    await expect(lifecycle.open(async () => {
      if (stage === 'prepare') throw new Error('Prepare failed'); return prepared('failure')();
    })).rejects.toThrow(/failed/);
    expect(phases.at(-1)).toBe('failed');
    expect(phases).not.toContain('ready'); expect(lifecycle.getState().switching).toBe(false);
    if (stage !== 'prepare') expect(release).toHaveBeenCalledOnce();
  });

});
