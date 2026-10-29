// A phone import returns before its copy into the project is durable. Opening, creating or closing
// another project meanwhile must not drop that copy: the old project would keep media whose project copy
// is never recorded and that are offline after a reload. Every project switch goes through
// openEditorRepository / closeEditorRepository, so both wait for running copies first, with visible
// progress, and only then replace the project.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as editor from '../../src/services/project/repository/lifecycle/editorRepositoryLifecycle';
import { beginProjectMediaCopy, dismissProjectMediaCopyNotice, getProjectMediaCopyNotice } from '../../src/services/project/mediaCopy/projectMediaCopyNotices';
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
afterEach(() => { if (getProjectMediaCopyNotice()?.pendingFiles === 0) dismissProjectMediaCopyNotice(); });

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

  it('switches at once without running copies', async () => {
    await editor.openEditorRepository(prepare);
    expect(fake.open).toHaveBeenCalledOnce();
    expect(progress).not.toHaveBeenCalled();
  });
});
