import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Preview } from '../../src/components/preview/Preview';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { Composition, MediaFile } from '../../src/stores/mediaStore';

vi.mock('../../src/hooks/useEngine', () => ({
  useEngine: () => ({ isEngineReady: false }),
}));

vi.mock('../../src/hooks/useShortcut', () => ({
  useShortcut: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  DEFAULT_SCENE_CAMERA_SETTINGS: { fov: 60, near: 0.1, far: 1000 },
  useMediaStore: Object.assign(vi.fn(), {
    getState: vi.fn(),
  }),
}));

const timelineState = {
  clips: [],
  selectedClipIds: new Set<string>(),
  primarySelectedClipId: null,
  selectClip: vi.fn(),
  updateClipTransform: vi.fn(),
  maskEditMode: 'none',
  layers: [],
  selectedLayerId: null,
  selectLayer: vi.fn(),
  updateLayer: vi.fn(),
  tracks: [],
  isPlaying: false,
  setPropertyValue: vi.fn(),
  hasKeyframes: vi.fn(() => false),
  isRecording: vi.fn(() => false),
  playheadPosition: 0,
  getInterpolatedTransform: vi.fn(() => null),
};

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: Object.assign(vi.fn((selector: (state: typeof timelineState) => unknown) => selector(timelineState)), {
    getState: vi.fn(() => timelineState),
  }),
}));

const engineState = {
  engineInitFailed: false,
  engineInitError: null,
  engineStats: null,
  sceneNavClipId: null,
  sceneNavFpsMode: false,
  sceneNavFpsMoveSpeed: 1,
  activeGaussianSplatLoadProgress: null,
  setSceneNavFpsMoveSpeed: vi.fn(),
};

vi.mock('../../src/stores/engineStore', () => ({
  selectActiveGaussianSplatLoadProgress: (state: typeof engineState) => state.activeGaussianSplatLoadProgress,
  selectSceneNavClipId: (state: typeof engineState) => state.sceneNavClipId,
  selectSceneNavFpsMode: (state: typeof engineState) => state.sceneNavFpsMode,
  selectSceneNavFpsMoveSpeed: (state: typeof engineState) => state.sceneNavFpsMoveSpeed,
  stepSceneNavFpsMoveSpeed: vi.fn((speed: number) => speed),
  useEngineStore: Object.assign(vi.fn((selector: (state: typeof engineState) => unknown) => selector(engineState)), {
    getState: vi.fn(() => engineState),
  }),
}));

const dockState = {
  addPreviewPanel: vi.fn(),
  updatePanelData: vi.fn(),
  closePanelById: vi.fn(),
};

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: vi.fn((selector: (state: typeof dockState) => unknown) => selector(dockState)),
}));

const settingsState = {
  outputResolution: { width: 1920, height: 1080 },
  previewQuality: 'full',
  setPreviewQuality: vi.fn(),
};

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(vi.fn((selector: (state: typeof settingsState) => unknown) => selector(settingsState)), {
    getState: vi.fn(() => settingsState),
  }),
}));

vi.mock('../../src/stores/renderTargetStore', () => ({
  useRenderTargetStore: {
    getState: vi.fn(() => ({
      registerTarget: vi.fn(),
      unregisterTarget: vi.fn(),
      setTargetTransparencyGrid: vi.fn(),
    })),
  },
}));

vi.mock('../../src/stores/historyStore', () => ({
  startBatch: vi.fn(),
  endBatch: vi.fn(),
}));

vi.mock('../../src/stores/sam2Store', () => ({
  useSAM2Store: vi.fn((selector: (state: { isActive: boolean }) => unknown) => selector({ isActive: false })),
}));

vi.mock('../../src/services/renderScheduler', () => ({
  renderScheduler: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('../../src/components/preview/SourceMonitor', () => ({
  SourceMonitor: ({ file }: { file: MediaFile }) => <div data-testid="source-monitor">{file.name}</div>,
}));

vi.mock('../../src/components/preview/PreviewControls', () => ({
  PreviewControls: ({ sourceMonitorActive }: { sourceMonitorActive: boolean }) => (
    <div data-testid="preview-controls">{sourceMonitorActive ? 'source' : 'composition'}</div>
  ),
}));

vi.mock('../../src/components/preview/StatsOverlay', () => ({
  StatsOverlay: () => null,
}));

vi.mock('../../src/components/preview/PreviewBottomControls', () => ({
  PreviewBottomControls: () => null,
}));

vi.mock('../../src/components/preview/MaskOverlay', () => ({
  MaskOverlay: () => null,
}));

vi.mock('../../src/components/preview/SAM2Overlay', () => ({
  SAM2Overlay: () => null,
}));

vi.mock('../../src/components/preview/SceneObjectOverlay', () => ({
  SceneObjectOverlay: () => null,
}));

vi.mock('../../src/components/preview/useEditModeOverlay', () => ({
  useEditModeOverlay: () => ({
    calculateLayerBounds: vi.fn(),
    findLayerAtPosition: vi.fn(),
    findHandleAtPosition: vi.fn(),
    getCursorForHandle: vi.fn(() => 'default'),
  }),
}));

vi.mock('../../src/components/preview/useLayerDrag', () => ({
  useLayerDrag: () => ({
    isDragging: false,
    dragMode: null,
    dragHandle: null,
    hoverHandle: null,
    handleOverlayMouseDown: vi.fn(),
    handleOverlayMouseMove: vi.fn(),
    handleOverlayMouseUp: vi.fn(),
  }),
}));

type MockMediaState = {
  files: MediaFile[];
  compositions: Composition[];
  activeCompositionId: string | null;
  previewCompositionId: string | null;
  sourceMonitorFileId: string | null;
  setSourceMonitorFile: ReturnType<typeof vi.fn>;
};

const mockedUseMediaStore = useMediaStore as unknown as ReturnType<typeof vi.fn> & {
  getState: ReturnType<typeof vi.fn>;
};

function createComposition(id: string): Composition {
  return {
    id,
    name: id,
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 10,
    backgroundColor: '#000000',
  };
}

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
  };
}

describe('Preview source monitor lifecycle', () => {
  let mediaState: MockMediaState;

  beforeEach(() => {
    class TestResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

    mediaState = {
      files: [createVideoFile()],
      compositions: [createComposition('comp-1'), createComposition('comp-2')],
      activeCompositionId: 'comp-1',
      previewCompositionId: null,
      sourceMonitorFileId: 'file-1',
      setSourceMonitorFile: vi.fn((id: string | null) => {
        mediaState.sourceMonitorFileId = id;
      }),
    };

    mockedUseMediaStore.mockImplementation((selector: (state: MockMediaState) => unknown) => selector(mediaState));
    mockedUseMediaStore.getState.mockReturnValue(mediaState);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not close the source monitor just because a source file was selected', () => {
    render(<Preview panelId="preview" source={{ type: 'activeComp' }} showTransparencyGrid={false} />);

    expect(screen.getByTestId('source-monitor')).toHaveTextContent('Clip.mp4');
    expect(mediaState.setSourceMonitorFile).not.toHaveBeenCalledWith(null);
  });

  it('still closes the source monitor when the active composition actually changes', () => {
    const { rerender } = render(
      <Preview panelId="preview" source={{ type: 'activeComp' }} showTransparencyGrid={false} />,
    );

    mediaState.activeCompositionId = 'comp-2';
    rerender(<Preview panelId="preview" source={{ type: 'activeComp' }} showTransparencyGrid={false} />);

    expect(mediaState.setSourceMonitorFile).toHaveBeenCalledWith(null);
  });
});
