import { describe, expect, it, vi } from 'vitest';
import { connectOfflineLinkedMedia } from '../../src/services/project/repository/transaction/editorLinkedMediaConnection';

const mocks = vi.hoisted(() => ({ state: { files: [] as Array<Record<string, unknown>> },
  items: [] as Array<Record<string, unknown>>, setState: vi.fn(), restore: vi.fn(), session: {} }));
vi.mock('../../src/services/project/repository/transaction/storeMutationBoundary', () => ({
  getRepositoryStore: (name: string) => name === 'media' ? { getState: () => mocks.state, setState: mocks.setState } : undefined,
  withRepositoryHydration: (run: () => unknown) => run(),
}));
vi.mock('../../src/services/project/repository/transaction/editorMutationRuntime', () => ({ getEditorRepositorySession: () => mocks.session }));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({ readEditorRepositoryProject: () => ({ media: mocks.items }) }));
vi.mock('../../src/services/project/load/loadMediaHydration', () => ({ convertProjectMediaToStore: async (items: Array<Record<string, unknown>>) => items.map(item => ({ ...item,
  file: new File(['data'], `${item.id}.mp4`), url: `blob:${item.id}`, hasFileHandle: true })) }));
vi.mock('../../src/services/project/repository/transaction/restoreLinkedTimelineMedia', () => ({ restoreLinkedTimelineMedia: mocks.restore }));
vi.mock('../../src/stores/mediaStore/slices/fileManage/timelineClipReload', () => ({ updateTimelineClips: vi.fn() }));
vi.mock('../../src/services/project/load/loadProgress', () => ({ completeProjectLoadProgress: vi.fn(), setProjectLoadProgress: vi.fn() }));

describe('linked media connection updates', () => {
  it('publishes initial sources promptly and batches the remaining library without changing authored fields', async () => {
    mocks.items = Array.from({ length: 48 }, (_, index) => ({ id: `source-${index}`, name: `source-${index}`, type: 'video' }));
    mocks.state.files = mocks.items.map(item => ({ ...item, file: undefined, duration: 300, thumbnailUrl: 'saved-thumbnail' }));
    const batchSizes: number[] = [];
    mocks.setState.mockImplementation((patch: typeof mocks.state) => {
      batchSizes.push(patch.files.filter((file, index) => file.file && !mocks.state.files[index].file).length);
      mocks.state = patch;
    });
    expect(await connectOfflineLinkedMedia(vi.fn())).toBe(48);
    expect(mocks.state.files.every(file => file.file instanceof File && file.duration === 300 && file.thumbnailUrl === 'saved-thumbnail')).toBe(true);
    expect(batchSizes[0]).toBeGreaterThan(0);
    expect(batchSizes[0]).toBeLessThanOrEqual(4);
    expect(batchSizes.some(size => size >= 16)).toBe(true);
    expect(mocks.setState.mock.calls.length).toBeLessThanOrEqual(7);
    expect(mocks.restore).toHaveBeenCalledTimes(48);
  });
});
