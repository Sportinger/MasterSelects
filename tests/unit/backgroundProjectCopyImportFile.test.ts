// importFile hands a background copy to the media it commits. When the import ends without them (the
// placeholder was replaced or removed while importing, or finalizing failed), the copy must be released:
// no longer pending (the unload guard and the "Copying into project" status end) and never counted as copied.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile, MediaState } from '../../src/stores/mediaStore/types';
import type { ProjectCopySource } from '../../src/stores/mediaStore/helpers/importPipeline';
import { beginProjectMediaCopy, dismissProjectMediaCopyNotice, getProjectMediaCopyNotice } from '../../src/services/project/mediaCopy/projectMediaCopyNotices';

const pipeline = vi.hoisted(() => ({ processImport: vi.fn() }));
vi.mock('../../src/stores/mediaStore/helpers/importPipeline', async original => ({
  ...(await original<typeof import('../../src/stores/mediaStore/helpers/importPipeline')>()),
  processImport: pipeline.processImport,
}));
vi.mock('../../src/stores/mediaStore/slices/fileImport/importPlanning', () => ({
  resolveImportEntry: async () => ({ route: 'media', type: 'video' }),
  runSignalImport: vi.fn(),
}));
const finalize = vi.hoisted(() => ({ fail: false }));
vi.mock('../../src/stores/mediaStore/slices/fileImport/placeholderLifecycle', async original => {
  const actual = await original<typeof import('../../src/stores/mediaStore/slices/fileImport/placeholderLifecycle')>();
  return {
    ...actual,
    finalizeImportedMediaFile: (...args: Parameters<typeof actual.finalizeImportedMediaFile>) => {
      if (finalize.fail) throw new Error('finalizing failed');
      return actual.finalizeImportedMediaFile(...args);
    },
    startMediaFileAudioProxyGeneration: vi.fn(),
    startVideoProxyGenerationIfNeeded: vi.fn(),
  };
});

import { createSingleFileImportActions } from '../../src/stores/mediaStore/slices/fileImport/singleFileImportActions';

function store() {
  let state = { files: [] as MediaFile[] } as unknown as MediaState;
  const set = (patch: Partial<MediaState> | ((current: MediaState) => Partial<MediaState>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const get = () => state;
  return { set, get };
}

function deferredCopy() {
  let resolve!: (value: ProjectCopySource | null) => void;
  const promise = new Promise<ProjectCopySource | null>(done => { resolve = done; });
  return { promise, resolve };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  if (getProjectMediaCopyNotice()) dismissProjectMediaCopyNotice();
  pipeline.processImport.mockReset();
  finalize.fail = false;
});

describe('importFile and a background copy no media took over', () => {
  it('releases the copy when the placeholder was replaced while importing', async () => {
    const { set, get } = store();
    const file = new File(['abcd'], 'clip.mp4');
    const ticket = beginProjectMediaCopy(file, true, 'background');
    const copy = deferredCopy();
    pipeline.processImport.mockImplementation(async ({ id }: { id: string }) => {
      // Another import or a delete replaced the placeholder meanwhile.
      set(state => ({ files: state.files.map(entry => entry.id === id ? { ...entry, file: new File(['x'], 'other.mp4') } : entry) }));
      return { mediaFile: { id, name: 'clip.mp4', type: 'video', file, url: '' } as unknown as MediaFile, projectCopy: copy.promise };
    });
    const { importFile } = createSingleFileImportActions(set as never, get as never, undefined as never);

    await expect(importFile(file, null, { copyInBackground: true })).rejects.toMatchObject({ name: 'AbortError' });
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 1 });
    copy.resolve({ file: new File(['abcd'], 'clip.mp4'), relativePath: 'Raw/clip.mp4', ticket });
    await settle();
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 0, failures: [] });
  });

  it('releases the copy when finalizing the media failed', async () => {
    const { set, get } = store();
    const file = new File(['abcd'], 'clip.mp4');
    const ticket = beginProjectMediaCopy(file, true, 'background');
    pipeline.processImport.mockImplementation(async ({ id }: { id: string }) => ({
      mediaFile: { id, name: 'clip.mp4', type: 'video', file, url: '' } as unknown as MediaFile,
      projectCopy: Promise.resolve({ file: new File(['abcd'], 'clip.mp4'), relativePath: 'Raw/clip.mp4', ticket }),
    }));
    finalize.fail = true;
    const { importFile } = createSingleFileImportActions(set as never, get as never, undefined as never);

    await expect(importFile(file, null, { copyInBackground: true })).rejects.toThrow('finalizing failed');
    await settle();
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 0 });
    expect(get().files).toEqual([]);
  });
});
