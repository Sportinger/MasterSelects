import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getStoredHandle: vi.fn(), remove: vi.fn(), load: vi.fn(), permission: vi.fn(), request: vi.fn(), recent: vi.fn(), requestRoots: vi.fn() }));
const recentEntry = { id: 'recent', backend: 'fsa', name: 'Test project', handleKey: 'recentProject:recent' };
vi.mock('../../src/services/projectDB', () => ({ projectDB: { getStoredHandle: mock.getStoredHandle } }));
vi.mock('../../src/services/project/recentProjects', () => ({ getRecentProject: mock.recent, removeRecentProject: mock.remove }));
vi.mock('../../src/services/project/mediaSourceRootAccess', () => ({ requestMediaSourceRootAccess: mock.requestRoots }));
import { openRecentProject, type RecentProjectOpeningContext } from '../../src/services/project/fileService/recentProjectOpening';
const context = { isFsaAvailable: true, coreService: { loadProject: mock.load }, activateFsaBackend: vi.fn(), ensureNativeBackendReady: vi.fn() } as unknown as RecentProjectOpeningContext;
beforeEach(() => {
  vi.clearAllMocks(); mock.recent.mockReturnValue(recentEntry); mock.requestRoots.mockResolvedValue(undefined); mock.permission.mockResolvedValue('granted'); mock.request.mockResolvedValue('granted'); mock.load.mockResolvedValue(true);
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
  it('re-allows the project media folders before loading', async () => {
    mock.recent.mockReturnValue({ ...recentEntry, mediaSourceRootIds: ['source-root:1'] });
    const order: string[] = [];
    mock.requestRoots.mockImplementation(async () => { order.push('roots'); });
    mock.load.mockImplementation(async () => { order.push('load'); return true; });
    await expect(openRecentProject(context, 'recent')).resolves.toBe(true);
    expect(mock.requestRoots).toHaveBeenCalledWith(['source-root:1']); expect(order).toEqual(['roots', 'load']);
  });
  it('preserves denied access for later recovery', async () => {
    mock.permission.mockResolvedValue('prompt'); mock.request.mockResolvedValue('denied');
    await expect(openRecentProject(context, 'recent')).rejects.toThrow('not granted');
    expect(mock.remove).not.toHaveBeenCalled(); expect(mock.load).not.toHaveBeenCalled();
  });
});
