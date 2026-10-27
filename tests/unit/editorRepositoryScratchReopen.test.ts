import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { SCRATCH_SUPERSEDED_MESSAGE } from '../../src/services/project/repository/lifecycle/RepositoryLifecycle';
import * as editor from '../../src/services/project/repository/lifecycle/editorRepositoryLifecycle';

// The editor wrapper around the lifecycle: a project open that cancelled the background scratch open and
// then failed itself must bring the scratch workspace back, or later edits on that screen are not recorded.
const fake = vi.hoisted(() => ({
  session: null as unknown,
  ensureScratch: vi.fn(),
  open: vi.fn(),
}));
vi.mock('../../src/services/project/repository/lifecycle/RepositoryLifecycle', async original => ({
  ...(await original<typeof import('../../src/services/project/repository/lifecycle/RepositoryLifecycle')>()),
  editorRepositoryLifecycle: () => ({
    getSession: () => fake.session,
    getState: () => ({ session: fake.session, switching: false, error: null }),
    subscribe: () => () => {},
    ensureScratch: fake.ensureScratch,
    open: fake.open,
    flush: vi.fn(), close: vi.fn(),
  }),
}));

const prepare = async () => { throw new Error('not called by the fake lifecycle'); };
const superseded = () => new RepositoryError('cancelled', SCRATCH_SUPERSEDED_MESSAGE);

// One module instance: its supersede flag is module state, and every case below leaves it cleared.
afterEach(() => { fake.session = null; fake.ensureScratch.mockReset(); fake.open.mockReset(); });

describe('scratch workspace after a failed project open', () => {
  it('reopens the scratch workspace when an open that superseded it fails and no session is left', async () => {
    fake.ensureScratch.mockRejectedValueOnce(superseded()).mockResolvedValueOnce({});
    fake.open.mockRejectedValueOnce(new Error('Project is open in another tab'));
    await editor.ensureEditorScratchRepository(); // The superseded scratch open is not an error.
    expect(fake.ensureScratch).toHaveBeenCalledOnce();
    await expect(editor.openEditorRepository(prepare, 'create')).rejects.toThrow('Project is open in another tab');
    await vi.waitFor(() => expect(fake.ensureScratch).toHaveBeenCalledTimes(2));
    // Only once: a second failed open without another supersede does not reopen again.
    fake.open.mockRejectedValueOnce(new Error('Disk failed'));
    await expect(editor.openEditorRepository(prepare)).rejects.toThrow('Disk failed');
    await Promise.resolve();
    expect(fake.ensureScratch).toHaveBeenCalledTimes(2);
  });

  it('leaves the scratch closed when the open succeeded, kept a session, or never superseded it', async () => {
    fake.open.mockRejectedValueOnce(new Error('Disk failed'));
    await expect(editor.openEditorRepository(prepare)).rejects.toThrow('Disk failed');
    expect(fake.ensureScratch).not.toHaveBeenCalled();

    fake.ensureScratch.mockRejectedValueOnce(superseded());
    await editor.ensureEditorScratchRepository();
    fake.session = { location: { kind: 'opfs', path: 'restored' } }; // The previous project was restored.
    fake.open.mockRejectedValueOnce(new Error('Disk failed'));
    await expect(editor.openEditorRepository(prepare)).rejects.toThrow('Disk failed');
    await Promise.resolve();
    expect(fake.ensureScratch).toHaveBeenCalledOnce();

    fake.session = null; fake.ensureScratch.mockReset();
    fake.ensureScratch.mockRejectedValueOnce(superseded());
    await editor.ensureEditorScratchRepository();
    const session = { location: { kind: 'opfs', path: 'opened' } };
    fake.open.mockResolvedValueOnce(session);
    await expect(editor.openEditorRepository(prepare)).resolves.toBe(session);
    // A later failure no longer counts the old supersede.
    fake.open.mockRejectedValueOnce(new Error('Disk failed'));
    await expect(editor.openEditorRepository(prepare)).rejects.toThrow('Disk failed');
    await Promise.resolve();
    expect(fake.ensureScratch).toHaveBeenCalledOnce();
  });
});
