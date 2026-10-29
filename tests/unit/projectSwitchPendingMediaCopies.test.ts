// A phone import returns before its copy into the project is durable. Opening, creating or closing
// another project meanwhile must not drop that copy: the old project would keep media whose project copy
// is never recorded and that are offline after a reload. Every project switch goes through
// openEditorRepository / closeEditorRepository, so both wait for running copies first, with visible
// progress, and only then replace the project. The wait always has a way out: the caller's Cancel, and
// after a while "Continue without it", which reports the unfinished copies as interrupted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as editor from '../../src/services/project/repository/lifecycle/editorRepositoryLifecycle';
import { beginProjectMediaCopy, dismissProjectMediaCopyNotice, getProjectMediaCopyNotice, noteProjectMediaCopyBytes } from '../../src/services/project/mediaCopy/projectMediaCopyNotices';
import { CONTINUE_WITHOUT_COPIES_AFTER_MS, COPY_LEFT_BY_SWITCH_MESSAGE, continueProjectSwitchWithoutCopies } from '../../src/services/project/mediaCopy/projectSwitchCopyWait';
import { setProjectLoadProgress } from '../../src/services/project/load/loadProgress';

const fake = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/RepositoryLifecycle', async original => ({
  ...(await original<typeof import('../../src/services/project/repository/lifecycle/RepositoryLifecycle')>()),
  editorRepositoryLifecycle: () => ({
    getSession: () => null,
    getState: () => ({ session: null, switching: false, error: null }),
    subscribe: () => () => {},
    ensureScratch: vi.fn(),
    open: fake.open,
    flush: vi.fn(), close: fake.close,
  }),
}));
vi.mock('../../src/services/project/load/loadProgress', () => ({
  setProjectLoadProgress: vi.fn(), completeProjectLoadProgress: vi.fn(), failProjectLoadProgress: vi.fn(),
}));

const prepare = async () => { throw new Error('not called by the fake lifecycle'); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const progress = vi.mocked(setProjectLoadProgress);

beforeEach(() => {
  if (getProjectMediaCopyNotice()) dismissProjectMediaCopyNotice();
  fake.open.mockReset().mockResolvedValue({ location: { kind: 'opfs', path: 'next' } });
  fake.close.mockReset().mockResolvedValue(undefined);
  progress.mockReset();
});
afterEach(() => { vi.useRealTimers(); if (getProjectMediaCopyNotice()?.pendingFiles === 0) dismissProjectMediaCopyNotice(); });
const MB = 1024 * 1024;

describe('project switch with a background copy into the current project', () => {
  it('opening another project waits for the copy and shows why', async () => {
    const ticket = beginProjectMediaCopy(new File([new Uint8Array(4 * 1024 * 1024)], 'clip.mp4'), true, 'background');
    const opened = editor.openEditorRepository(prepare);
    await settle(); await settle();
    expect(fake.open).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Finishing the copy into the current project', detail: '1 file · 4.0 MB left', blocking: true,
    }));

    ticket.done();
    await expect(opened).resolves.toEqual({ location: { kind: 'opfs', path: 'next' } });
    expect(fake.open).toHaveBeenCalledOnce();
  });

  it('a failed copy also releases the switch (its failure is in the notice)', async () => {
    const ticket = beginProjectMediaCopy(new File(['abcd'], 'clip.mp4'), true, 'background');
    const closed = editor.closeEditorRepository();
    await settle();
    expect(fake.close).not.toHaveBeenCalled();
    ticket.fail(new Error('browser storage is full'));
    await closed;
    expect(fake.close).toHaveBeenCalledOnce();
    expect(getProjectMediaCopyNotice()?.failures).toHaveLength(1);
  });

  it('shows the bytes the storage worker has read (hash pass, then write pass) while it waits', async () => {
    const file = new File([new Uint8Array(8 * MB)], 'clip.mp4');
    const ticket = beginProjectMediaCopy(file, true, 'background');
    const opened = editor.openEditorRepository(prepare);
    await settle();
    noteProjectMediaCopyBytes(file, 'hash', 8 * MB);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ detail: '1 file · 4.0 MB left', percent: 50 }));
    noteProjectMediaCopyBytes(file, 'write', 4 * MB);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ detail: '1 file · 2.0 MB left', percent: 75 }));
    // Bytes of a file that is not a running copy change nothing.
    progress.mockClear();
    noteProjectMediaCopyBytes(new File(['x'], 'other.mp4'), 'write', 1);
    expect(progress).not.toHaveBeenCalled();
    ticket.done();
    await opened;
  });

  it('after a while offers to continue without the copy; continuing opens the project and reports the copy as interrupted', async () => {
    vi.useFakeTimers();
    const ticket = beginProjectMediaCopy(new File([new Uint8Array(4 * MB)], 'clip.mp4'), true, 'background');
    const opened = editor.openEditorRepository(prepare);
    await vi.advanceTimersByTimeAsync(CONTINUE_WITHOUT_COPIES_AFTER_MS - 100);
    expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'continue-without-copies' }));
    await vi.advanceTimersByTimeAsync(200);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'continue-without-copies', blocking: true }));
    expect(fake.open).not.toHaveBeenCalled();

    continueProjectSwitchWithoutCopies();
    await opened;
    expect(fake.open).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith(null);
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, pendingBytes: 0,
      failures: [{ name: 'clip.mp4', bytes: 4 * MB, message: COPY_LEFT_BY_SWITCH_MESSAGE, interrupted: true }] });
    // The copy finishing later changes nothing: its ticket was settled by the switch.
    ticket.done();
    expect(getProjectMediaCopyNotice()).toMatchObject({ copiedFiles: 0, failures: [expect.objectContaining({ interrupted: true })] });
  });

  it("the caller's Cancel ends the wait: the open rejects, nothing opens, and the copy keeps running", async () => {
    const ticket = beginProjectMediaCopy(new File(['abcd'], 'clip.mp4'), true, 'background');
    const controller = new AbortController();
    const opened = editor.openEditorRepository(prepare, 'open', controller.signal);
    await settle();
    controller.abort();
    await expect(opened).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.open).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(null);
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 1, failures: [] });
    ticket.done();
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 1 });
  });

  it('an already cancelled open does not wait at all', async () => {
    const ticket = beginProjectMediaCopy(new File(['abcd'], 'clip.mp4'), true, 'background');
    const controller = new AbortController();
    controller.abort();
    await expect(editor.openEditorRepository(prepare, 'open', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).not.toHaveBeenCalled();
    ticket.done();
  });

  it('switches at once without running copies', async () => {
    await editor.openEditorRepository(prepare);
    expect(fake.open).toHaveBeenCalledOnce();
    expect(progress).not.toHaveBeenCalled();
  });
});
