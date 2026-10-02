import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickArchiveOutput } from '../../src/services/project/repository/lifecycle/exportProjectArchive';
vi.mock('../../src/services/project/repository/archive/archiveTransport', () => ({ exportRepositoryArchive: vi.fn() }));
vi.mock('../../src/services/project/repository/archive/runtimeSources', () => ({ captureRuntimeArchiveSources: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/repositoryLocations', () => ({ backendForLocation: vi.fn() }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({ getActiveRepositorySession: vi.fn(), flushEditorRepository: vi.fn() }));
vi.mock('../../src/services/project/repository/persistence/recovery', () => ({ recoverRepository: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
function destination(size: number) {
  const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  vi.stubGlobal('window', { showSaveFilePicker: async () => ({ createWritable: async () => writable, getFile: async () => ({ size }) }) });
  return writable;
}
describe('archive destination confirmation', () => {
  it('rejects an empty export before committing the destination', async () => {
    const writable = destination(0); const output = await pickArchiveOutput('fixture');
    await expect(output!.close()).rejects.toThrow('produced no data');
    expect(writable.close).not.toHaveBeenCalled();
  });
  it('rejects a zero-byte destination after nonempty stream writes instead of reporting success', async () => {
    destination(0); const output = await pickArchiveOutput('fixture');
    await output!.write(new Uint8Array([1, 2, 3]));
    await expect(output!.close()).rejects.toThrow('not completely written');
  });
  it('accepts the destination only after its committed byte count matches the streamed archive', async () => {
    const writable = destination(5); const output = await pickArchiveOutput('fixture');
    await output!.write(new Uint8Array([1, 2])); await output!.write(new Uint8Array([3, 4, 5]));
    await expect(output!.close()).resolves.toBeUndefined(); expect(writable.close).toHaveBeenCalledOnce();
  });
});
