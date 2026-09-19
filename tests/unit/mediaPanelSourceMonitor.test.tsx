import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaPanel } from '../../src/components/panels/MediaPanel';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { Composition, MediaFile } from '../../src/stores/mediaStore';

const dockMocks = vi.hoisted(() => ({
  activatePanelType: vi.fn(),
}));

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: Object.assign(vi.fn((selector: (state: unknown) => unknown) => selector({
    activatePanelType: dockMocks.activatePanelType,
  })), {
    getState: vi.fn(() => ({
      activatePanelType: dockMocks.activatePanelType,
    })),
  }),
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(vi.fn((selector: (state: unknown) => unknown) => selector({
    setDuration: vi.fn(),
    slotGridProgress: 0,
    clips: [],
    selectClip: vi.fn(),
    selectedClipIds: new Set<string>(),
    selectedKeyframeIds: new Set<string>(),
    clipboardData: null,
    clipboardKeyframes: null,
    maskPanelActive: false,
    clipboardMask: null,
    addClip: vi.fn(),
    addCompClip: vi.fn(),
    getSerializableState: vi.fn(),
    invalidateCache: vi.fn(),
  })), {
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

function createComposition(): Composition {
  return {
    id: 'comp-1',
    name: 'Comp 1',
    type: 'composition',
    parentId: null,
    createdAt: 2,
    width: 1080,
    height: 1920,
    frameRate: 30,
    duration: 12,
    backgroundColor: '#000000',
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
    generateAudioProxy: vi.fn(),
    generateMediaWaveform: vi.fn(),
    generateMediaSpectrogram: vi.fn(),
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
    copyMediaItems: vi.fn(),
    pasteMediaItems: vi.fn(() => []),
    duplicateMediaItems: vi.fn(() => []),
    hasMediaClipboard: vi.fn(() => false),
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

  it('reopens a composition from the media panel when no composition is active', () => {
    const composition = createComposition();
    mediaState.compositions = [composition];
    mediaState.activeCompositionId = null;

    const { container } = render(<MediaPanel />);
    const node = container.querySelector(`[data-item-id="${composition.id}"]`);

    expect(node).toBeInstanceOf(HTMLElement);
    fireEvent.doubleClick(node!, { button: 0, detail: 2 });

    expect(dockMocks.activatePanelType).toHaveBeenCalledWith('timeline');
    expect(mediaState.openCompositionTab).toHaveBeenCalledWith(composition.id, {
      skipAnimation: true,
    });
  });

  it('renames only from the composition name and opens from the rest of the row', () => {
    localStorage.setItem('media-panel-view-mode', 'classic');
    const composition = createComposition();
    mediaState.compositions = [composition];

    const { container } = render(<MediaPanel />);
    const row = container.querySelector(`[data-item-id="${composition.id}"] .media-item`);
    const name = container.querySelector(`[data-item-id="${composition.id}"] .media-item-name`);

    expect(row).toBeInstanceOf(HTMLElement);
    expect(name).toBeInstanceOf(HTMLElement);
    fireEvent.doubleClick(name!, { button: 0, detail: 2 });

    expect(container.querySelector('.media-item-rename')).toBeInstanceOf(HTMLInputElement);
    expect(mediaState.openCompositionTab).not.toHaveBeenCalled();

    fireEvent.doubleClick(row!, { button: 0, detail: 2 });
    expect(mediaState.openCompositionTab).toHaveBeenCalledWith(composition.id, {
      skipAnimation: true,
    });
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

  it('shows regenerate artifact actions in the media item context menu', () => {
    mediaState.files[0] = {
      ...mediaState.files[0],
      hasAudio: true,
      audioCodec: 'aac',
      thumbnailUrl: 'blob:thumb',
      proxyStatus: 'ready',
      audioProxyStatus: 'ready',
      hasProxyAudio: true,
      waveform: [0.1, 0.4, 0.2],
      waveformStatus: 'ready',
      audioAnalysisRefs: {
        waveformPyramidId: 'waveform-1',
        spectrogramTileSetIds: ['spectral-1'],
      },
    };

    const { container } = render(<MediaPanel />);
    const node = container.querySelector('.media-board-node');

    expect(node).toBeInstanceOf(HTMLElement);
    fireEvent.contextMenu(node!, { clientX: 96, clientY: 96 });

    expect(screen.getByText('Regenerate')).toBeTruthy();
    expect(screen.getAllByText(/^Proxy/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Thumbnails/)).toBeTruthy();
    expect(screen.getByText(/WAV Audio Proxy/)).toBeTruthy();
    expect(screen.getByText(/Waveform/)).toBeTruthy();
    expect(screen.getByText(/Spectral/)).toBeTruthy();
  });
});
