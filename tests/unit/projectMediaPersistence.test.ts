import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mediaState: {
    files: [] as any[],
    compositions: [] as any[],
    folders: [] as any[],
    textItems: [] as any[],
    solidItems: [] as any[],
    activeCompositionId: null as string | null,
    openCompositionIds: [] as string[],
    expandedFolderIds: [] as string[],
    slotAssignments: {} as Record<string, number>,
    proxyEnabled: false,
    setProxyEnabled: vi.fn(),
  },
  updateMedia: vi.fn(),
  updateCompositions: vi.fn(),
  updateFolders: vi.fn(),
  getProjectData: vi.fn(),
  getFileFromRaw: vi.fn(),
  getTranscript: vi.fn(async () => null),
  getAnalysisRanges: vi.fn(async () => []),
  isProjectOpen: vi.fn(() => true),
  saveProject: vi.fn(async () => true),
  getStoredHandle: vi.fn(async () => null),
  storeHandle: vi.fn(async () => undefined),
  getFileHandle: vi.fn(() => undefined),
  storeFileHandle: vi.fn(),
  clearTimeline: vi.fn(),
  loadState: vi.fn(async () => undefined),
  timelineState: {
    clearTimeline: vi.fn(),
    loadState: vi.fn(async () => undefined),
    getSerializableState: vi.fn(() => ({ tracks: [], clips: [] })),
    clips: [] as any[],
    playheadPosition: 0,
    zoom: 1,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    thumbnailsEnabled: true,
    waveformsEnabled: true,
    showTranscriptMarkers: false,
    setThumbnailsEnabled: vi.fn(),
    setWaveformsEnabled: vi.fn(),
    setShowTranscriptMarkers: vi.fn(),
  },
  youtubeState: {
    getState: vi.fn(() => ({})),
    loadState: vi.fn(),
    reset: vi.fn(),
  },
  dockState: {
    getLayoutForProject: vi.fn(() => ({ panes: [] })),
    setLayoutFromProject: vi.fn(),
  },
  settingsState: {
    showChangelogOnStartup: true,
    lastSeenChangelogVersion: '1.0.0',
    loadApiKeys: vi.fn(async () => undefined),
  },
  mediaSetState: vi.fn(),
  createObjectURL: vi.fn(() => 'blob:project-media'),
  settingsSetState: vi.fn(),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => mocks.mediaState,
    setState: mocks.mediaSetState,
  },
}));

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => mocks.timelineState,
  },
}));

vi.mock('../../src/stores/youtubeStore', () => ({
  useYouTubeStore: {
    getState: () => mocks.youtubeState,
  },
}));

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: {
    getState: () => mocks.dockState,
  },
}));

vi.mock('../../src/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
    setState: mocks.settingsSetState,
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    updateMedia: mocks.updateMedia,
    updateCompositions: mocks.updateCompositions,
    updateFolders: mocks.updateFolders,
    getProjectData: mocks.getProjectData,
    getFileFromRaw: mocks.getFileFromRaw,
    getTranscript: mocks.getTranscript,
    getAnalysisRanges: mocks.getAnalysisRanges,
    isProjectOpen: mocks.isProjectOpen,
    saveProject: mocks.saveProject,
  },
}));

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getStoredHandle: mocks.getStoredHandle,
    storeHandle: mocks.storeHandle,
  },
}));

vi.mock('../../src/services/fileSystemService', () => ({
  fileSystemService: {
    getFileHandle: mocks.getFileHandle,
    storeFileHandle: mocks.storeFileHandle,
  },
}));

vi.mock('../../src/stores/mediaStore/helpers/mediaInfoHelpers', () => ({
  getMediaInfo: vi.fn(async () => ({})),
}));

vi.mock('../../src/stores/mediaStore/helpers/thumbnailHelpers', () => ({
  createThumbnail: vi.fn(async () => undefined),
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    preCacheVideoFrame: vi.fn(),
  },
}));

vi.mock('../../src/stores/mediaStore/slices/fileManageSlice', () => ({
  updateTimelineClips: vi.fn(async () => undefined),
}));

describe('project media persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mediaState.files = [];
    mocks.mediaState.compositions = [];
    mocks.mediaState.folders = [];
    mocks.mediaState.textItems = [];
    mocks.mediaState.solidItems = [];
    mocks.mediaState.activeCompositionId = null;
    mocks.mediaState.openCompositionIds = [];
    mocks.mediaState.expandedFolderIds = [];
    mocks.mediaState.slotAssignments = {};
    mocks.mediaState.proxyEnabled = false;
    mocks.timelineState.clips = [];
    mocks.getProjectData.mockReturnValue({
      media: [],
      compositions: [],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });
    mocks.mediaSetState.mockImplementation((partial: Record<string, unknown> | ((state: any) => Record<string, unknown>)) => {
      const nextPartial = typeof partial === 'function'
        ? partial(mocks.mediaState)
        : partial;
      Object.assign(mocks.mediaState, nextPartial);
    });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(mocks.createObjectURL);
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
      configurable: true,
    });
  });

  it('persists projectPath when syncing stores to the project file', async () => {
    mocks.mediaState.files = [{
      id: 'media-1',
      name: 'clip.mp4',
      type: 'video',
      filePath: 'C:/capture/clip.mp4',
      projectPath: 'Raw/clip.mp4',
      duration: 12,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
      audioCodec: 'aac',
      container: 'mp4',
      bitrate: 1_000_000,
      fileSize: 1234,
      hasAudio: true,
      proxyStatus: 'ready',
      parentId: null,
      createdAt: 1,
    }];

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(mocks.updateMedia).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'media-1',
        sourcePath: 'C:/capture/clip.mp4',
        projectPath: 'Raw/clip.mp4',
      }),
    ]);
  });

  it('persists gaussian splat transform scale and splat settings into project compositions', async () => {
    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.compositions = [{
      id: 'comp-1',
      name: 'Comp 1',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 60,
      backgroundColor: '#000000',
      timelineData: { tracks: [], clips: [] },
    }];
    mocks.timelineState.getSerializableState.mockReturnValue({
      tracks: [{ id: 'track-v1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false }],
      clips: [{
        id: 'clip-gs-1',
        trackId: 'track-v1',
        name: 'Splat',
        mediaFileId: 'media-splat-1',
        startTime: 0,
        duration: 10,
        inPoint: 0,
        outPoint: 10,
        sourceType: 'gaussian-splat',
        transform: {
          opacity: 0.8,
          blendMode: 'screen',
          position: { x: 12, y: -8, z: 4 },
          scale: { x: 1.75, y: 0.5, z: 2.25 },
          rotation: { x: 11, y: 22, z: 33 },
        },
        effects: [],
        gaussianSplatSettings: {
          render: {
            useNativeRenderer: true,
            maxSplats: 123456,
            splatScale: 2.5,
            nearPlane: 0.25,
            farPlane: 2500,
            backgroundColor: 'transparent',
            sortFrequency: 3,
          },
          temporal: {
            enabled: false,
            playbackMode: 'loop',
            sequenceFps: 30,
            frameBlend: 0,
          },
          particle: {
            enabled: false,
            effectType: 'none',
            intensity: 0.5,
            speed: 1,
            seed: 42,
          },
        },
        is3D: true,
      }],
      playheadPosition: 0,
      duration: 60,
      zoom: 1,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
    });

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(mocks.updateCompositions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'comp-1',
        clips: [
          expect.objectContaining({
            id: 'clip-gs-1',
            sourceType: 'gaussian-splat',
            transform: expect.objectContaining({
              x: 12,
              y: -8,
              z: 4,
              scaleX: 1.75,
              scaleY: 0.5,
              scaleZ: 2.25,
              rotation: 33,
              rotationX: 11,
              rotationY: 22,
              opacity: 0.8,
              blendMode: 'screen',
            }),
            gaussianSplatSettings: expect.objectContaining({
              render: expect.objectContaining({
                splatScale: 2.5,
                useNativeRenderer: true,
              }),
            }),
          }),
        ],
      }),
    ]);
  });

  it('restores projectPath from the RAW file when loading legacy project media', async () => {
    const rawFile = new File(['raw-bytes'], 'clip.mp4', { type: 'video/mp4' });
    const rawHandle = {
      name: 'clip.mp4',
      kind: 'file',
      getFile: vi.fn(async () => rawFile),
      queryPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemFileHandle;

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-1',
        name: 'clip.mp4',
        type: 'video',
        sourcePath: 'C:/capture/clip.mp4',
        duration: 12,
        width: 1920,
        height: 1080,
        frameRate: 30,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
      }],
      compositions: [],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });
    mocks.getFileFromRaw.mockImplementation(async (relativePath: string) => (
      relativePath === 'Raw/clip.mp4'
        ? { file: rawFile, handle: rawHandle }
        : null
    ));

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.mediaSetState).toHaveBeenCalledWith(expect.objectContaining({
      files: [
        expect.objectContaining({
          id: 'media-1',
          projectPath: 'Raw/clip.mp4',
          file: rawFile,
        }),
      ],
    }));
  });

  it('restores project transforms as nested clip transforms for gaussian splats', async () => {
    mocks.getProjectData.mockReturnValue({
      media: [],
      compositions: [{
        id: 'comp-1',
        name: 'Comp 1',
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 60,
        backgroundColor: '#000000',
        folderId: null,
        tracks: [{ id: 'track-v1', name: 'Video 1', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false }],
        clips: [{
          id: 'clip-gs-1',
          trackId: 'track-v1',
          name: 'Splat',
          mediaId: 'media-splat-1',
          sourceType: 'gaussian-splat',
          naturalDuration: 3600,
          startTime: 0,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
          transform: {
            x: 12,
            y: -8,
            z: 4,
            scaleX: 1.75,
            scaleY: 0.5,
            scaleZ: 2.25,
            rotation: 33,
            rotationX: 11,
            rotationY: 22,
            anchorX: 0.5,
            anchorY: 0.5,
            opacity: 0.8,
            blendMode: 'screen',
          },
          effects: [],
          masks: [],
          keyframes: [],
          volume: 1,
          audioEnabled: true,
          reversed: false,
          disabled: false,
          gaussianSplatSettings: {
            render: {
              useNativeRenderer: true,
              maxSplats: 123456,
              splatScale: 2.5,
              nearPlane: 0.25,
              farPlane: 2500,
              backgroundColor: 'transparent',
              sortFrequency: 3,
            },
            temporal: {
              enabled: false,
              playbackMode: 'loop',
              sequenceFps: 30,
              frameBlend: 0,
            },
            particle: {
              enabled: false,
              effectType: 'none',
              intensity: 0.5,
              speed: 1,
              seed: 42,
            },
          },
          is3D: true,
        }],
        markers: [],
      }],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: 'comp-1',
      openCompositionIds: ['comp-1'],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.timelineState.loadState).toHaveBeenCalledWith(expect.objectContaining({
      clips: [
        expect.objectContaining({
          id: 'clip-gs-1',
          gaussianSplatSettings: expect.objectContaining({
            render: expect.objectContaining({ splatScale: 2.5 }),
          }),
          transform: {
            opacity: 0.8,
            blendMode: 'screen',
            position: { x: 12, y: -8, z: 4 },
            scale: { x: 1.75, y: 0.5, z: 2.25 },
            rotation: { x: 11, y: 22, z: 33 },
          },
        }),
      ],
    }));
  });
});
