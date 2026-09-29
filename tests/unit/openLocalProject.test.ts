import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  dirty: false, exporting: false, connected: true,
  connect: vi.fn(), load: vi.fn(), hydrate: vi.fn(), restoreBackend: vi.fn(),
}));
vi.mock('../../src/services/projectFileService', () => ({ projectFileService: {
  hasUnsavedChanges: () => state.dirty, loadProject: state.load, activeBackend: 'fsa', activateFsaBackend: state.restoreBackend,
} }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ isExporting: state.exporting }) } }));
vi.mock('../../src/services/nativeHelper', () => ({ NativeHelperClient: {
  isConnected: () => state.connected, connect: state.connect,
} }));
vi.mock('../../src/services/project/projectLoad', () => ({ loadProjectToStores: state.hydrate }));
import { addAllowedRoot } from '../../src/services/security/fileAccessBroker';
import { handleOpenLocalProject } from '../../src/services/aiTools/handlers/localProject';

describe('openLocalProject', () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.dirty = false; state.exporting = false; state.connected = true;
    state.connect.mockResolvedValue(true); state.load.mockResolvedValue(true); state.hydrate.mockResolvedValue(undefined);
    addAllowedRoot('C:/Projects');
  });
  it('loads the authorized folder and hydrates the editor', async () => {
    expect((await handleOpenLocalProject({ directory: 'C:\\Projects\\Study' })).success).toBe(true);
    expect(state.load).toHaveBeenCalledWith('C:/Projects/Study');
    expect(state.hydrate).toHaveBeenCalledOnce();
  });
  it('rejects traversal and paths outside approved roots before accessing a project', async () => {
    for (const directory of ['C:/Projects/../secret', 'C:/Other/Study', 'Study']) {
      expect((await handleOpenLocalProject({ directory })).success).toBe(false);
    }
    expect(state.load).not.toHaveBeenCalled();
  });
  it('preserves dirty projects and active exports', async () => {
    state.dirty = true;
    expect((await handleOpenLocalProject({ directory: 'C:/Projects/Study' })).success).toBe(false);
    state.dirty = false; state.exporting = true;
    expect((await handleOpenLocalProject({ directory: 'C:/Projects/Study' })).success).toBe(false);
    expect(state.load).not.toHaveBeenCalled();
  });
  it('rechecks changes made while connecting to the helper', async () => {
    state.connected = false;
    state.connect.mockImplementation(async () => { state.dirty = true; return true; });
    expect((await handleOpenLocalProject({ directory: 'C:/Projects/Study' })).success).toBe(false);
    expect(state.load).not.toHaveBeenCalled();
  });
  it('does not hydrate a missing project and permits a subsequent retry', async () => {
    state.load.mockResolvedValueOnce(false);
    expect((await handleOpenLocalProject({ directory: 'C:/Projects/Missing' })).success).toBe(false);
    expect(state.hydrate).not.toHaveBeenCalled();
    expect(state.restoreBackend).toHaveBeenCalledOnce();
    expect((await handleOpenLocalProject({ directory: 'C:/Projects/Study' })).success).toBe(true);
  });
});
