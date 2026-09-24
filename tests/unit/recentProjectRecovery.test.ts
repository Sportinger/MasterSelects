import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getStoredHandle: vi.fn(), remove: vi.fn(), load: vi.fn(), permission: vi.fn(), request: vi.fn() }));
vi.mock('../../src/services/projectDB', () => ({ projectDB: { getStoredHandle: mock.getStoredHandle } }));
vi.mock('../../src/services/project/recentProjects', () => ({
  getRecentProject: () => ({ id: 'recent', backend: 'fsa', name: 'Test project', handleKey: 'recentProject:recent' }),
  removeRecentProject: mock.remove,
}));
import { openRecentProject, type RecentProjectOpeningContext } from '../../src/services/project/fileService/recentProjectOpening';
const context = { isFsaAvailable: true, coreService: { loadProject: mock.load }, activateFsaBackend: vi.fn(), ensureNativeBackendReady: vi.fn() } as unknown as RecentProjectOpeningContext;
beforeEach(() => {
  vi.clearAllMocks(); mock.permission.mockResolvedValue('granted'); mock.request.mockResolvedValue('granted'); mock.load.mockResolvedValue(true);
  mock.getStoredHandle.mockResolvedValue({ kind: 'directory', queryPermission: mock.permission, requestPermission: mock.request });
});
describe('recent project recovery', () => {
  it('retains entries when their cached folder handle is missing', async () => {
    mock.getStoredHandle.mockResolvedValue(null);
    await expect(openRecentProject(context, 'recent')).rejects.toThrow('Open existing');
    expect(mock.remove).not.toHaveBeenCalled(); expect(mock.load).not.toHaveBeenCalled();
  });
  it('retains links after temporary package read failures', async () => {
    mock.load.mockResolvedValue(false);
    await expect(openRecentProject(context, 'recent')).rejects.toThrow('folder link has been kept');
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it('requests renewed permission and opens the same stored folder', async () => {
    mock.permission.mockResolvedValue('prompt');
    await expect(openRecentProject(context, 'recent')).resolves.toBe(true);
    expect(mock.request).toHaveBeenCalledWith({ mode: 'readwrite' }); expect(mock.load).toHaveBeenCalledOnce();
  });
  it('preserves denied access for later recovery', async () => {
    mock.permission.mockResolvedValue('prompt'); mock.request.mockResolvedValue('denied');
    await expect(openRecentProject(context, 'recent')).rejects.toThrow('not granted');
    expect(mock.remove).not.toHaveBeenCalled(); expect(mock.load).not.toHaveBeenCalled();
  });
});
