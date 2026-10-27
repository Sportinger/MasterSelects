import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryLifecycle, isSupersededScratchOpen, newRepositoryDescriptor, type PreparedRepository } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
import { RepositorySession, type RepositorySessionOptions } from '../../src/services/project/repository/RepositorySession';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { RepositoryLoadTimer, type RepositoryLoadReport } from '../../src/services/project/repository/lifecycle/repositoryLoadTimings';

const workspace = vi.hoisted(() => ({ read: vi.fn(async () => ({ restored: true })) }));
vi.mock('../../src/services/project/repository/lifecycle/workspaceProjection', async original => ({
  ...(await original<typeof import('../../src/services/project/repository/lifecycle/workspaceProjection')>()),
  readProjectWorkspace: workspace.read,
}));
afterEach(() => { vi.restoreAllMocks(); workspace.read.mockClear(); });

function fakeSession(id: string) {
  const coordinator = {
    async handoff(action: () => Promise<void>) { await action(); },
    receipt() { return { repositoryId: id, sessionEpoch: 'test', operationSequence: 1, views: {} }; },
    flush: vi.fn(async () => {}), appendJournal: vi.fn(), getStatus: () => ({ error: null }),
  };
  return {
    descriptor: newRepositoryDescriptor(id), opening: { writable: true }, location: { kind: 'opfs', path: id },
    coordinator,
    // Like the real session: without `flush: false` the first revision is confirmed on its own.
    initialize: vi.fn(async (_entities: unknown, _label: string, options: { flush?: boolean } = {}) => { if (options.flush !== false) await coordinator.flush(); }),
    updateView: vi.fn(async () => 1),
    close: vi.fn(async () => {}),
  } as unknown as RepositorySession & { initialize: ReturnType<typeof vi.fn>; updateView: ReturnType<typeof vi.fn>; coordinator: typeof coordinator };
}
const prepared = (id: string, extra: Partial<PreparedRepository> = {}) => async (): Promise<PreparedRepository> => ({ options: { descriptor: newRepositoryDescriptor(id) } as RepositorySessionOptions, ...extra });
function lifecycleWith(reports: Array<RepositoryLoadReport | null>, phases: string[] = []) {
  return new RepositoryLifecycle({ async barrier() { return { release() {} }; }, async activate() {}, install() {},
    progress(value) { phases.push(value.phase); }, measure: () => report => { reports.push(report); } });
}

describe('background scratch open versus a project the person opens', () => {
  it('cancels a scratch open that is still reading instead of making the project open wait behind it', async () => {
    const project = fakeSession('project'); const reports: Array<RepositoryLoadReport | null> = []; const phases: string[] = [];
    let scratchSignal: AbortSignal | undefined;
    vi.spyOn(RepositorySession, 'open').mockImplementationOnce(options => new Promise((_resolve, reject) => {
      // A slow scratch recovery: it only ends when its requests are cancelled.
      options.onOpenProgress?.({ phase: 'projection' }); scratchSignal = options.signal;
      options.signal?.addEventListener('abort', () => reject(new RepositoryError('cancelled', 'Project storage request cancelled')));
    })).mockResolvedValueOnce(project);
    const lifecycle = lifecycleWith(reports, phases);
    const scratch = lifecycle.ensureScratch(prepared('scratch'));
    const scratchResult = scratch.catch(error => error);
    await vi.waitFor(() => expect(scratchSignal).toBeDefined());
    phases.length = 0;
    const opened = await Promise.race([lifecycle.open(prepared('project')),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Project open waited behind the scratch open')), 1_000))]);
    expect(opened).toBe(project);
    expect(isSupersededScratchOpen(await scratchResult)).toBe(true);
    // Not a failure: no "Project load failed" and no lifecycle error for the save status.
    expect(phases).not.toContain('failed'); expect(lifecycle.getState().error).toBeNull();
    expect(reports.map(report => report && [report.kind, report.outcome])).toEqual([['scratch', 'superseded'], ['open', 'ready']]);
  });

  it('skips a scratch open that is still queued and never cancels the creation of a new scratch repository', async () => {
    const created = fakeSession('scratch-new'), project = fakeSession('project');
    let releaseCreation!: () => void; const creationGate = new Promise<void>(resolve => { releaseCreation = resolve; });
    const open = vi.spyOn(RepositorySession, 'open').mockImplementationOnce(async options => {
      expect(options.signal).toBeUndefined(); await creationGate; return created;
    }).mockResolvedValueOnce(project);
    const lifecycle = lifecycleWith([]);
    const initialize = { entities: new Map(), workspace: { project: { layout: 1 } }, journals: [] };
    const scratch = lifecycle.ensureScratch(prepared('scratch-new', { initialize }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const opening = lifecycle.open(prepared('project'));
    releaseCreation();
    await expect(scratch).resolves.toBe(created);
    await expect(opening).resolves.toBe(project);

    const queued = new RepositoryLifecycle({ async barrier() { return { release() {} }; }, async activate() {}, install() {} });
    let releaseSave!: () => void; const save = new Promise<void>(resolve => { releaseSave = resolve; });
    const busy = queued.open(async () => { await save; throw new Error('Busy source'); }).catch(() => {});
    const skipped = queued.ensureScratch(prepared('never')).catch(error => error);
    const next = fakeSession('next'); open.mockResolvedValueOnce(next);
    const user = queued.open(prepared('next'));
    releaseSave(); await busy;
    expect(isSupersededScratchOpen(await skipped)).toBe(true);
    await expect(user).resolves.toBe(next);
    expect(open).toHaveBeenCalledTimes(3);
  });
});

describe('new project save point', () => {
  it('confirms the first revision and its views with one flush and uses the written workspace without reading it back', async () => {
    const target = fakeSession('created'); vi.spyOn(RepositorySession, 'open').mockResolvedValue(target);
    let activated: unknown;
    const reports: Array<RepositoryLoadReport | null> = [];
    const lifecycle = new RepositoryLifecycle({ async barrier() { return { release() {} }; }, async activate(_session, value) { activated = value; }, install() {},
      measure: () => report => { reports.push(report); } });
    const parts = { 'project/part/%2F': { name: 'Phone project' }, project: { $workspaceShape: { $workspacePart: 'project/part/%2F' } } };
    await lifecycle.open(prepared('created', { initialize: { entities: new Map(), workspace: parts, journals: [{ id: 'chat', value: 1 }] } }), 'create');
    expect(target.coordinator.flush).toHaveBeenCalledOnce();
    expect(target.initialize).toHaveBeenCalledWith(expect.any(Map), 'Created project', { flush: false });
    expect(target.updateView).toHaveBeenCalledTimes(2);
    expect(target.coordinator.appendJournal).toHaveBeenCalledWith('chat', 1);
    expect(workspace.read).not.toHaveBeenCalled();
    expect(activated).toEqual({ name: 'Phone project' });
    expect(reports[0]).toMatchObject({ kind: 'create', outcome: 'ready', writable: true, storage: expect.stringMatching(/^(opfs|indexeddb)$/) });
    // Only the storage kind: no location, path or folder handle that could name the project.
    expect(reports[0]).not.toHaveProperty('location');
    expect(JSON.stringify(reports[0])).not.toContain('created');
    expect(Object.keys(reports[0]!.phases)).toEqual(expect.arrayContaining(['queue', 'prepare', 'handoff', 'target', 'storage_open', 'initialize', 'views', 'activation']));
    expect(reports[0]!.phases.workspace).toBeUndefined();
  });
});

describe('phase timings', () => {
  it('reports every phase of an open, the recovered records, failures, and explicit saves only', async () => {
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 5);
    const target = fakeSession('timed');
    vi.spyOn(RepositorySession, 'open').mockImplementationOnce(async options => {
      options.onOpenProgress?.({ phase: 'recovery', processedRecords: 120 });
      options.onOpenProgress?.({ phase: 'projection' }); return target;
    }).mockRejectedValueOnce(new Error('Disk failed'));
    const reports: Array<RepositoryLoadReport | null> = [];
    const lifecycle = lifecycleWith(reports);
    await lifecycle.open(prepared('timed'));
    const [opened] = reports;
    expect(opened).toMatchObject({ kind: 'open', outcome: 'ready', recoveredRecords: 120 });
    expect(Object.keys(opened!.phases)).toEqual(['queue', 'prepare', 'handoff', 'target', 'storage_open', 'session_read', 'workspace', 'activation', 'close_previous']);
    expect(opened!.totalMs).toBeGreaterThanOrEqual(Object.values(opened!.phases).reduce((sum, value) => sum + value, 0));

    await expect(lifecycle.open(prepared('broken'))).rejects.toThrow('Disk failed');
    expect(reports[1]).toMatchObject({ kind: 'open', outcome: 'failed' });

    await lifecycle.flush();
    expect(reports).toHaveLength(2);
    await lifecycle.flush({ measure: true });
    expect(reports[2]).toMatchObject({ kind: 'save', outcome: 'ready' });
    expect(Object.keys(reports[2]!.phases)).toEqual(expect.arrayContaining(['queue', 'sync', 'publish']));
  });
});

describe('load report contents', () => {
  it('reduces a folder location to its storage kind and never keeps the handle', () => {
    const handle = { kind: 'directory', name: 'Private folder project' } as unknown as FileSystemDirectoryHandle;
    const timer = new RepositoryLoadTimer('open', () => 0);
    timer.noteLocation({ kind: 'fsa', handle });
    const report = timer.finish('ready')!;
    expect(report.storage).toBe('fsa');
    expect(Object.values(report)).not.toContain(handle);
    expect(JSON.stringify(report)).not.toContain('Private folder project');
    const browser = new RepositoryLoadTimer('open', () => 0);
    browser.noteLocation({ kind: 'opfs', path: 'projects/My secret project', store: 'indexeddb' });
    expect(browser.finish('ready')).toEqual({ kind: 'open', outcome: 'ready', totalMs: 0, phases: {}, storage: 'indexeddb' });
  });
});
