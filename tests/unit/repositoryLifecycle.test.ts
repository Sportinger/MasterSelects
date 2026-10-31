import { describe, it, expect, vi, afterEach } from 'vitest';
import { RepositoryLifecycle, newRepositoryDescriptor } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
import { RepositorySession } from '../../src/services/project/repository/RepositorySession';
import type { RepositorySessionOptions } from '../../src/services/project/repository/RepositorySession';

vi.mock('../../src/services/project/repository/lifecycle/workspaceProjection', () => ({ readProjectWorkspace: async () => ({}), assembleProjectWorkspace: async () => ({}) }));
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

  it('does not keep the previous owner installed when re-activating it after a failed switch fails', async () => {
    const first = fakeSession('first'), second = fakeSession('second');
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const installed: (string | null)[] = []; let opens = 0;
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; },
      async activate(session) {
        opens++;
        // The switch target fails, then restoring the previous owner fails too (e.g. undecodable entities).
        if (opens > 1) throw new Error(`cannot activate ${session.descriptor.repositoryId}`);
      },
      install(session) { installed.push(session ? session.descriptor.repositoryId : null); },
    });
    await lifecycle.open(prepared('first'));
    await expect(lifecycle.open(prepared('second'))).rejects.toThrow('cannot activate second');
    expect(lifecycle.getSession()).toBeNull();
    expect(installed.at(-1)).toBeNull();
    expect(first.close).toHaveBeenCalled();
    expect(lifecycle.getState().error).toContain('cannot activate');
  });
});

describe('switching away from a project whose files are gone', () => {
  function vanishedSession(id: string) {
    const session = fakeSession(id);
    const handoff = vi.fn(async () => { throw new Error('A requested file or directory could not be found'); });
    return Object.assign(session, {
      coordinator: { ...session.coordinator, handoff },
      abandon: vi.fn(async () => {}),
    }) as RepositorySession & { abandon: ReturnType<typeof vi.fn> };
  }

  it('switches without the final save of the old session and ends it without saving', async () => {
    const first = vanishedSession('first'), second = fakeSession('second');
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const activated: string[] = [];
    const lifecycle = new RepositoryLifecycle({
      async beforeReceipt() { throw new Error('views cannot be written'); },
      async barrier() { return { release() {} }; },
      async activate(session) { activated.push(session.descriptor.repositoryId); }, install() {},
    });
    await lifecycle.open(prepared('first'));
    await lifecycle.open(prepared('second'), 'create', { abandonPrevious: true });
    expect(lifecycle.getSession()).toBe(second);
    expect(activated).toEqual(['first', 'second']);
    expect(first.coordinator.handoff).not.toHaveBeenCalled();
    expect(first.abandon).toHaveBeenCalledOnce();
    expect(first.close).not.toHaveBeenCalled();
    expect(lifecycle.getState().error).toBeNull();
  });

  it('keeps the old session and the editor state when the rescue switch fails', async () => {
    const first = vanishedSession('first');
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('target unavailable'));
    const activated: string[] = [];
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; },
      async activate(session) { activated.push(session.descriptor.repositoryId); }, install() {},
    });
    await lifecycle.open(prepared('first'));
    await expect(lifecycle.open(prepared('second'), 'create', { abandonPrevious: true })).rejects.toThrow('target unavailable');
    // Re-reading the vanished project would fail and drop it; the content on screen stays for another try.
    expect(lifecycle.getSession()).toBe(first);
    expect(activated).toEqual(['first']);
    expect(first.abandon).not.toHaveBeenCalled();
  });
});


describe('failed or cancelled project preparation', () => {
  const lifecycleWithPhases = (phases: string[]) => new RepositoryLifecycle({ async barrier() { return { release() {} }; },
    async activate() {}, install() {}, progress(value) { phases.push(value.phase); } });

  it('keeps the open project and its save state when another project fails to prepare', async () => {
    const first = fakeSession('first');
    vi.spyOn(RepositorySession, 'open').mockResolvedValueOnce(first);
    const phases: string[] = []; const lifecycle = lifecycleWithPhases(phases);
    await lifecycle.open(prepared('first'));
    await expect(lifecycle.open(async () => { throw new Error('Archive is corrupt'); })).rejects.toThrow('Archive is corrupt');
    expect(lifecycle.getSession()).toBe(first);
    // A stale lifecycle error would show "Save failed" for the untouched open project.
    expect(lifecycle.getState().error).toBeNull();
    expect(phases.at(-1)).toBe('failed');
  });

  it('records a preparation failure without an open project, but never a cancellation', async () => {
    const phases: string[] = []; const lifecycle = lifecycleWithPhases(phases);
    await expect(lifecycle.open(async () => { throw new DOMException('Cancelled', 'AbortError'); })).rejects.toThrow('Cancelled');
    expect(lifecycle.getState().error).toBeNull();
    await expect(lifecycle.open(async () => { throw new Error('Storage unavailable'); })).rejects.toThrow('Storage unavailable');
    expect(lifecycle.getState().error).toBe('Storage unavailable');
  });
});

describe('save retries', () => {
  it('retries the failed queue before capture, inside the serialized lifecycle', async () => {
    const target = fakeSession('retry'); const order: string[] = [];
    let failed = true;
    target.coordinator.getStatus = vi.fn(() => ({ error: failed ? new Error('Read failed') : null })) as never;
    target.coordinator.retry = vi.fn(async () => { order.push('retry'); failed = false; });
    target.coordinator.flush = vi.fn(async () => { order.push('flush'); if (failed) throw new Error('Read failed'); });
    vi.spyOn(RepositorySession, 'open').mockResolvedValue(target);
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; }, async activate() {}, install() {},
      async beforeReceipt() { order.push('capture'); if (failed) throw new Error('Recovery queue full'); },
    });
    await lifecycle.open(prepared('retry'));
    await lifecycle.flush({ retry: true });
    expect(order).toEqual(['retry', 'capture', 'flush']);
    order.length = 0; await lifecycle.flush({ retry: true });
    expect(order).toEqual(['capture', 'flush']);
  });
  it('keeps a failed retry visible and never captures or confirms new changes', async () => {
    const target = fakeSession('still-failed');
    const failure = new Error('Disk still unavailable');
    target.coordinator.getStatus = vi.fn(() => ({ error: failure })) as never;
    target.coordinator.retry = vi.fn(async () => { throw failure; });
    const capture = vi.fn();
    vi.spyOn(RepositorySession, 'open').mockResolvedValue(target);
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; }, async activate() {}, install() {}, beforeReceipt: capture });
    await lifecycle.open(prepared('still-failed'));
    await expect(lifecycle.flush({ retry: true })).rejects.toBe(failure);
    expect(capture).not.toHaveBeenCalled();
  });
});
