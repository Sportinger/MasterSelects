import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaPanel } from '../../src/components/panels/MediaPanel';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore';

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      activatePanelType: vi.fn(),
    })),
  }),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      setDuration: vi.fn(),
      slotGridProgress: 0,
      clips: [],
      selectClip: vi.fn(),
    })),
  }),
}));

type MockMediaState = Record<string, unknown> & {
  files: MediaFile[];
  selectedIds: string[];
  setSelection: ReturnType<typeof vi.fn>;
  setSourceMonitorFile: ReturnType<typeof vi.fn>;
  getItemsByFolder: (folderId: string | null) => unknown[];
};

const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
};

function createVideoFile(): MediaFile {
  return {
    id: 'file-1',
    name: 'Clip.mp4',
    type: 'video',
    parentId: null,
    createdAt: 1,
    file: new File(['video'], 'Clip.mp4', { type: 'video/mp4' }),
    url: 'blob:clip',
    duration: 10,
    width: 1920,
    height: 1080,
    codec: 'H.264',
  };
}

function createMediaState(): MockMediaState {
  const file = createVideoFile();
  const state: MockMediaState = {
    files: [file],
    compositions: [],
    folders: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    splatEffectorItems: [],
    selectedIds: [],
    expandedFolderIds: [],
    fileSystemSupported: false,
    proxyFolderName: null,
    activeCompositionId: null,
    sourceMonitorFileId: null,
    sourceMonitorPlaybackRequestId: 0,
    importFiles: vi.fn(),
    importFilesWithPicker: vi.fn(),
    createComposition: vi.fn(),
    createFolder: vi.fn(),
    removeFile: vi.fn(),
    removeComposition: vi.fn(),
    removeFolder: vi.fn(),
    renameFile: vi.fn(),
    renameFolder: vi.fn(),
    reloadFile: vi.fn(),
    toggleFolderExpanded: vi.fn(),
    setSelection: vi.fn((ids: string[]) => {
      state.selectedIds = ids;
    }),
    addToSelection: vi.fn(),
    getItemsByFolder: (folderId: string | null) => state.files.filter((item) => item.parentId === folderId),
    openCompositionTab: vi.fn(),
    updateComposition: vi.fn(),
    generateProxy: vi.fn(),
    cancelProxyGeneration: vi.fn(),
    pickProxyFolder: vi.fn(),
    showInExplorer: vi.fn(),
    moveToFolder: vi.fn(),
    createTextItem: vi.fn(),
    getOrCreateTextFolder: vi.fn(),
    removeTextItem: vi.fn(),
    createSolidItem: vi.fn(),
    getOrCreateSolidFolder: vi.fn(),
    updateSolidItem: vi.fn(),
    createMeshItem: vi.fn(),
    getOrCreateMeshFolder: vi.fn(),
    removeMeshItem: vi.fn(),
    createCameraItem: vi.fn(),
    getOrCreateCameraFolder: vi.fn(),
    removeCameraItem: vi.fn(),
    createSplatEffectorItem: vi.fn(),
    getOrCreateSplatEffectorFolder: vi.fn(),
    removeSplatEffectorItem: vi.fn(),
    setLabelColor: vi.fn(),
    importGaussianSplat: vi.fn(),
    refreshFileUrls: vi.fn(),
    ensureFileThumbnail: vi.fn(async () => false),
    setSourceMonitorFile: vi.fn((id: string | null) => {
      state.sourceMonitorFileId = id;
      if (id !== null) {
        state.sourceMonitorPlaybackRequestId = (state.sourceMonitorPlaybackRequestId as number) + 1;
      }
    }),
  };
  return state;
}

describe('MediaPanel source monitor opening', () => {
  let mediaState: MockMediaState;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('media-panel-view-mode', 'board');

    mediaState = createMediaState();
    mockedUseMediaStore.mockImplementation((selector: (state: MockMediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockReturnValue(mediaState);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps board asset clicks eligible for double-click source preview', () => {
    const { container } = render(<MediaPanel />);
    const node = container.querySelector('.media-board-node');

    expect(node).toBeInstanceOf(HTMLElement);
    expect(fireEvent.mouseDown(node!, { button: 0, detail: 1, clientX: 80, clientY: 80 })).toBe(true);
    fireEvent.mouseUp(window);

    fireEvent.doubleClick(node!, { button: 0, detail: 2 });

    expect(mediaState.setSourceMonitorFile).toHaveBeenCalledWith('file-1');
  });

  it('does not mount board assets far outside the viewport', () => {
    localStorage.setItem('media-panel-board-viewport', JSON.stringify({
      zoom: 1,
      panX: -20000,
      panY: -20000,
    }));

    const { container } = render(<MediaPanel />);

    expect(container.querySelectorAll('.media-board-node')).toHaveLength(0);
  });
});
