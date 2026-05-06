import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mediaState: {
    files: [] as unknown[],
    compositions: [] as unknown[],
    folders: [] as unknown[],
    textItems: [] as unknown[],
    solidItems: [] as unknown[],
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
  scanRawFolder: vi.fn(async () => new Map()),
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
    clips: [] as unknown[],
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
  midiState: {
    isEnabled: false,
    transportBindings: {
      playPause: null as { channel: number; note: number } | null,
      stop: null as { channel: number; note: number } | null,
    },
    slotBindings: {} as Record<number, { channel: number; note: number } | null>,
    parameterBindings: {} as Record<string, unknown>,
  },
  mediaSetState: vi.fn(),
  midiSetState: vi.fn(),
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

vi.mock('../../src/stores/midiStore', () => ({
  useMIDIStore: {
    getState: () => mocks.midiState,
    setState: mocks.midiSetState,
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
    scanRawFolder: mocks.scanRawFolder,
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
  handleThumbnailDedup: vi.fn(async (_fileHash: string | undefined, thumbnailUrl: string | undefined) => thumbnailUrl),
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
    mocks.midiState.isEnabled = false;
    mocks.midiState.transportBindings = {
      playPause: null,
      stop: null,
    };
    mocks.midiState.slotBindings = {};
    mocks.midiState.parameterBindings = {};
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
    mocks.mediaSetState.mockImplementation((partial: Record<string, unknown> | ((state: typeof mocks.mediaState) => Record<string, unknown>)) => {
      const nextPartial = typeof partial === 'function'
        ? partial(mocks.mediaState)
        : partial;
      Object.assign(mocks.mediaState, nextPartial);
    });
    mocks.midiSetState.mockImplementation((partial: Record<string, unknown>) => {
      Object.assign(mocks.midiState, partial);
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

  it('persists marker MIDI bindings when syncing stores to the project file', async () => {
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
      timelineData: { tracks: [], clips: [], markers: [] },
    }];
    mocks.timelineState.getSerializableState.mockReturnValue({
      tracks: [{ id: 'track-v1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false }],
      clips: [],
      markers: [
        {
          id: 'marker-1',
          time: 12.5,
          label: 'Drop',
          color: '#ff6600',
          stopPlayback: true,
          midiBindings: [
            { action: 'playFromMarker', channel: 1, note: 36 },
            { action: 'jumpToMarker', channel: 1, note: 37 },
            { action: 'jumpToMarkerAndStop', channel: 1, note: 38 },
          ],
        },
      ],
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
        markers: [
          expect.objectContaining({
            id: 'marker-1',
            time: 12.5,
            name: 'Drop',
            color: '#ff6600',
            stopPlayback: true,
            midiBindings: [
              { action: 'playFromMarker', channel: 1, note: 36 },
              { action: 'jumpToMarker', channel: 1, note: 37 },
              { action: 'jumpToMarkerAndStop', channel: 1, note: 38 },
            ],
          }),
        ],
      }),
    ]);
  });

  it('persists transport MIDI bindings in project uiState when syncing stores to the project file', async () => {
    const projectData = {
      media: [],
      compositions: [],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    };
    mocks.getProjectData.mockReturnValue(projectData);
    mocks.midiState.isEnabled = true;
    mocks.midiState.transportBindings = {
      playPause: { channel: 1, note: 48 },
      stop: { channel: 1, note: 49 },
    };

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(projectData.uiState).toEqual(expect.objectContaining({
      midi: expect.objectContaining({
        isEnabled: true,
        transportBindings: {
          playPause: { channel: 1, note: 48 },
          stop: { channel: 1, note: 49 },
        },
      }),
    }));
  });

  it('persists slot and parameter MIDI bindings in project uiState when syncing stores to the project file', async () => {
    const projectData = {
      media: [],
      compositions: [],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    };
    mocks.getProjectData.mockReturnValue(projectData);
    mocks.midiState.slotBindings = {
      3: { channel: 2, note: 64 },
    };
    mocks.midiState.parameterBindings = {
      'parameter:clip-1:opacity': {
        id: 'parameter:clip-1:opacity',
        clipId: 'clip-1',
        property: 'opacity',
        label: 'Opacity',
        min: 0,
        max: 1,
        damping: true,
        message: { type: 'control-change', channel: 2, control: 7 },
      },
    };

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(projectData.uiState).toEqual(expect.objectContaining({
      midi: expect.objectContaining({
        slotBindings: {
          3: { channel: 2, note: 64 },
        },
        parameterBindings: {
          'parameter:clip-1:opacity': expect.objectContaining({
            clipId: 'clip-1',
            property: 'opacity',
            damping: true,
            message: { type: 'control-change', channel: 2, control: 7 },
          }),
        },
      }),
    }));
  });

  it('persists vector animation metadata and clip settings for lottie assets', async () => {
    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.files = [{
      id: 'media-lottie-1',
      name: 'anim.lottie',
      type: 'lottie',
      filePath: 'C:/capture/anim.lottie',
      projectPath: 'Raw/anim.lottie',
      duration: 4,
      width: 640,
      height: 360,
      fps: 30,
      fileSize: 4096,
      proxyStatus: 'none',
      parentId: null,
      createdAt: 1,
      vectorAnimation: {
        provider: 'lottie',
        width: 640,
        height: 360,
        fps: 30,
        duration: 4,
        totalFrames: 120,
        animationNames: ['intro', 'loop'],
        defaultAnimationName: 'intro',
        stateMachineNames: ['button-machine'],
        stateMachineStates: {
          'button-machine': ['idle', 'hover'],
        },
        stateMachineInputs: {
          'button-machine': [
            { name: 'OnOffSwitch', type: 'boolean', defaultValue: false },
          ],
        },
      },
    }];
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
        id: 'clip-lottie-1',
        trackId: 'track-v1',
        name: 'anim.lottie',
        mediaFileId: 'media-lottie-1',
        startTime: 0,
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        sourceType: 'lottie',
        naturalDuration: 4,
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        effects: [],
        vectorAnimationSettings: {
          loop: true,
          endBehavior: 'loop',
          playbackMode: 'bounce',
          fit: 'cover',
          renderWidth: 1920,
          renderHeight: 1080,
          animationName: 'loop',
          stateMachineName: 'button-machine',
          stateMachineState: 'idle',
          stateMachineStateCues: [
            { id: 'cue-1', time: 1.25, stateName: 'hover', immediate: true },
          ],
          stateMachineInputValues: {
            OnOffSwitch: 1,
          },
          backgroundColor: '#112233',
        },
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

    expect(mocks.updateMedia).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'media-lottie-1',
        type: 'lottie',
        vectorAnimation: expect.objectContaining({
          provider: 'lottie',
          animationNames: ['intro', 'loop'],
        }),
      }),
    ]);
    expect(mocks.updateCompositions).toHaveBeenCalledWith([
      expect.objectContaining({
        clips: [
          expect.objectContaining({
            id: 'clip-lottie-1',
            sourceType: 'lottie',
            vectorAnimationSettings: expect.objectContaining({
              animationName: 'loop',
              stateMachineName: 'button-machine',
              playbackMode: 'bounce',
              renderWidth: 1920,
              stateMachineStateCues: [
                { id: 'cue-1', time: 1.25, stateName: 'hover', immediate: true },
              ],
              stateMachineInputValues: {
                OnOffSwitch: 1,
              },
              backgroundColor: '#112233',
            }),
          }),
        ],
      }),
    ]);
  });

  it('persists model sequence metadata for glb sequence assets', async () => {
    const modelSequence = {
      fps: 30,
      frameCount: 3,
      playbackMode: 'clamp' as const,
      sequenceName: 'hero',
      frames: [
        {
          name: 'hero000000.glb',
          projectPath: 'Raw/hero-seq_000000_hero000000.glb',
          sourcePath: 'C:/capture/hero000000.glb',
          absolutePath: 'C:/capture/hero000000.glb',
          file: new File(['0'], 'hero000000.glb', { type: 'model/gltf-binary' }),
          modelUrl: 'blob:hero-0',
        },
        {
          name: 'hero000001.glb',
          projectPath: 'Raw/hero-seq_000001_hero000001.glb',
          sourcePath: 'C:/capture/hero000001.glb',
          absolutePath: 'C:/capture/hero000001.glb',
          file: new File(['1'], 'hero000001.glb', { type: 'model/gltf-binary' }),
          modelUrl: 'blob:hero-1',
        },
        {
          name: 'hero000002.glb',
          projectPath: 'Raw/hero-seq_000002_hero000002.glb',
          sourcePath: 'C:/capture/hero000002.glb',
          absolutePath: 'C:/capture/hero000002.glb',
          file: new File(['2'], 'hero000002.glb', { type: 'model/gltf-binary' }),
          modelUrl: 'blob:hero-2',
        },
      ],
    };

    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.files = [{
      id: 'media-model-seq-1',
      name: 'hero (3f)',
      type: 'model',
      filePath: 'C:/capture/hero000000.glb',
      projectPath: 'Raw/hero-seq_000000_hero000000.glb',
      duration: 0.1,
      fps: 30,
      fileSize: 4096,
      proxyStatus: 'none',
      parentId: null,
      createdAt: 1,
      modelSequence,
    }];
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
        id: 'clip-model-seq-1',
        trackId: 'track-v1',
        name: 'Hero Sequence',
        mediaFileId: 'media-model-seq-1',
        startTime: 0,
        duration: 0.1,
        inPoint: 0,
        outPoint: 0.1,
        sourceType: 'model',
        naturalDuration: 0.1,
        source: {
          type: 'model',
          mediaFileId: 'media-model-seq-1',
          modelSequence,
        },
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        effects: [],
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

    expect(mocks.updateMedia).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'media-model-seq-1',
        type: 'model',
        modelSequence: expect.objectContaining({
          fps: 30,
          frameCount: 3,
          frames: [
            expect.objectContaining({
              name: 'hero000000.glb',
              projectPath: 'Raw/hero-seq_000000_hero000000.glb',
              sourcePath: 'C:/capture/hero000000.glb',
              absolutePath: 'C:/capture/hero000000.glb',
            }),
            expect.objectContaining({
              name: 'hero000001.glb',
              projectPath: 'Raw/hero-seq_000001_hero000001.glb',
              sourcePath: 'C:/capture/hero000001.glb',
              absolutePath: 'C:/capture/hero000001.glb',
            }),
            expect.objectContaining({
              name: 'hero000002.glb',
              projectPath: 'Raw/hero-seq_000002_hero000002.glb',
              sourcePath: 'C:/capture/hero000002.glb',
              absolutePath: 'C:/capture/hero000002.glb',
            }),
          ],
        }),
      }),
    ]);
    expect(mocks.updateCompositions).toHaveBeenCalledWith([
      expect.objectContaining({
        clips: [
          expect.objectContaining({
            id: 'clip-model-seq-1',
            sourceType: 'model',
            modelSequence: expect.objectContaining({
              frameCount: 3,
            }),
          }),
        ],
      }),
    ]);
  });

  it('persists gaussian splat sequence metadata for numbered ply sequence assets', async () => {
    const gaussianSplatSequence = {
      fps: 30,
      frameCount: 3,
      playbackMode: 'clamp' as const,
      sequenceName: 'scan',
      sharedBounds: {
        min: [-2, -1, 0],
        max: [5, 6, 7],
      },
      frames: [
        {
          name: 'scan000000.ply',
          projectPath: 'Raw/scan-seq_000000_scan000000.ply',
          sourcePath: 'C:/capture/scan000000.ply',
          absolutePath: 'C:/capture/scan000000.ply',
          file: new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
          splatUrl: 'blob:scan-0',
        },
        {
          name: 'scan000001.ply',
          projectPath: 'Raw/scan-seq_000001_scan000001.ply',
          sourcePath: 'C:/capture/scan000001.ply',
          absolutePath: 'C:/capture/scan000001.ply',
          file: new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
          splatUrl: 'blob:scan-1',
        },
        {
          name: 'scan000002.ply',
          projectPath: 'Raw/scan-seq_000002_scan000002.ply',
          sourcePath: 'C:/capture/scan000002.ply',
          absolutePath: 'C:/capture/scan000002.ply',
          file: new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
          splatUrl: 'blob:scan-2',
        },
      ],
    };

    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.files = [{
      id: 'media-splat-seq-1',
      name: 'scan (3f)',
      type: 'gaussian-splat',
      filePath: 'C:/capture/scan000000.ply',
      projectPath: 'Raw/scan-seq_000000_scan000000.ply',
      duration: 0.1,
      fps: 30,
      fileSize: 4096,
      proxyStatus: 'none',
      parentId: null,
      createdAt: 1,
      gaussianSplatSequence,
    }];
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
        id: 'clip-splat-seq-1',
        trackId: 'track-v1',
        name: 'Scan Sequence',
        mediaFileId: 'media-splat-seq-1',
        startTime: 0,
        duration: 0.1,
        inPoint: 0,
        outPoint: 0.1,
        sourceType: 'gaussian-splat',
        naturalDuration: 0.1,
        source: {
          type: 'gaussian-splat',
          mediaFileId: 'media-splat-seq-1',
          gaussianSplatSequence,
        },
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        effects: [],
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

    expect(mocks.updateMedia).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'media-splat-seq-1',
        type: 'gaussian-splat',
        gaussianSplatSequence: expect.objectContaining({
          fps: 30,
          frameCount: 3,
          sharedBounds: {
            min: [-2, -1, 0],
            max: [5, 6, 7],
          },
          frames: [
            expect.objectContaining({
              name: 'scan000000.ply',
              projectPath: 'Raw/scan-seq_000000_scan000000.ply',
              sourcePath: 'C:/capture/scan000000.ply',
              absolutePath: 'C:/capture/scan000000.ply',
            }),
            expect.objectContaining({
              name: 'scan000001.ply',
              projectPath: 'Raw/scan-seq_000001_scan000001.ply',
              sourcePath: 'C:/capture/scan000001.ply',
              absolutePath: 'C:/capture/scan000001.ply',
            }),
            expect.objectContaining({
              name: 'scan000002.ply',
              projectPath: 'Raw/scan-seq_000002_scan000002.ply',
              sourcePath: 'C:/capture/scan000002.ply',
              absolutePath: 'C:/capture/scan000002.ply',
            }),
          ],
        }),
      }),
    ]);
    expect(mocks.updateCompositions).toHaveBeenCalledWith([
      expect.objectContaining({
        clips: [
          expect.objectContaining({
            id: 'clip-splat-seq-1',
            sourceType: 'gaussian-splat',
            gaussianSplatSequence: expect.objectContaining({
              frameCount: 3,
              sharedBounds: {
                min: [-2, -1, 0],
                max: [5, 6, 7],
              },
              frames: [
                expect.not.objectContaining({
                  file: expect.anything(),
                }),
                expect.not.objectContaining({
                  file: expect.anything(),
                }),
                expect.not.objectContaining({
                  file: expect.anything(),
                }),
              ],
            }),
          }),
        ],
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

  it('moves media panel items with missing folder parents back to root on load', async () => {
    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-orphan',
        name: 'orphan.png',
        type: 'image',
        sourcePath: 'E:/project/Raw/orphan.png',
        projectPath: 'Raw/orphan.png',
        duration: 0,
        width: 1024,
        height: 768,
        hasProxy: false,
        folderId: 'missing-folder',
        importedAt: new Date(1).toISOString(),
      }],
      compositions: [{
        id: 'comp-orphan',
        name: 'Comp Orphan',
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 60,
        backgroundColor: '#000000',
        folderId: 'missing-folder',
        tracks: [],
        clips: [],
        markers: [],
      }],
      folders: [{
        id: 'folder-cycle',
        name: 'Broken Folder',
        parentId: 'folder-cycle',
      }],
      textItems: [{
        id: 'text-orphan',
        name: 'Text Orphan',
        type: 'text',
        parentId: 'missing-folder',
        createdAt: 1,
        text: 'hello',
        fontFamily: 'Arial',
        fontSize: 64,
        color: '#ffffff',
        duration: 5,
      }],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.mediaSetState).toHaveBeenCalledWith(expect.objectContaining({
      files: [
        expect.objectContaining({
          id: 'media-orphan',
          parentId: null,
        }),
      ],
      compositions: [
        expect.objectContaining({
          id: 'comp-orphan',
          parentId: null,
        }),
      ],
      folders: [
        expect.objectContaining({
          id: 'folder-cycle',
          parentId: null,
        }),
      ],
      textItems: [
        expect.objectContaining({
          id: 'text-orphan',
          parentId: null,
        }),
      ],
    }));
  });

  it('skips destructive project sync from a stale default store after loading a large project', async () => {
    const persistedMedia = Array.from({ length: 60 }, (_, index) => ({
      id: `media-${index}`,
      name: `media-${index}.png`,
      type: 'image' as const,
      sourcePath: `E:/project/Raw/media-${index}.png`,
      projectPath: `Raw/media-${index}.png`,
      width: 1024,
      height: 768,
      hasProxy: false,
      folderId: `folder-${index % 10}`,
      importedAt: new Date(index + 1).toISOString(),
    }));

    mocks.mediaState.files = persistedMedia.map((file) => ({
      id: file.id,
      name: file.name,
      type: 'image',
      parentId: null,
      createdAt: 1,
      url: '',
      projectPath: file.projectPath,
    }));
    mocks.mediaState.folders = [];
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
    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.openCompositionIds = ['comp-1'];

    mocks.getProjectData.mockReturnValue({
      media: persistedMedia,
      compositions: [
        {
          id: 'comp-old-1',
          name: 'Comp 1',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 60,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [],
          clips: [],
          markers: [],
        },
        {
          id: 'comp-old-2',
          name: 'Comp 2',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 60,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [],
          clips: [],
          markers: [],
        },
      ],
      folders: Array.from({ length: 10 }, (_, index) => ({
        id: `folder-${index}`,
        name: `Folder ${index}`,
        parentId: null,
      })),
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: 'comp-old-1',
      openCompositionIds: ['comp-old-1', 'comp-old-2'],
      expandedFolderIds: Array.from({ length: 10 }, (_, index) => `folder-${index}`),
      slotAssignments: {},
      uiState: {},
    });

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(mocks.updateMedia).not.toHaveBeenCalled();
    expect(mocks.updateCompositions).not.toHaveBeenCalled();
    expect(mocks.updateFolders).not.toHaveBeenCalled();
  });

  it('restores transport MIDI bindings from project uiState', async () => {
    mocks.getProjectData.mockReturnValue({
      media: [],
      compositions: [],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {
        midi: {
          isEnabled: true,
          transportBindings: {
            playPause: { channel: 3, note: 50 },
            stop: { channel: 3, note: 51 },
          },
        },
      },
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.midiSetState).toHaveBeenCalledWith(expect.objectContaining({
      isEnabled: true,
      transportBindings: {
        playPause: { channel: 3, note: 50 },
        stop: { channel: 3, note: 51 },
      },
    }));
  });

  it('restores slot and parameter MIDI bindings from project uiState', async () => {
    mocks.getProjectData.mockReturnValue({
      media: [],
      compositions: [],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: null,
      openCompositionIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {
        midi: {
          slotBindings: {
            4: { channel: 4, note: 52 },
          },
          parameterBindings: {
            'parameter:clip-1:opacity': {
              id: 'parameter:clip-1:opacity',
              clipId: 'clip-1',
              property: 'opacity',
              label: 'Opacity',
              min: 0,
              max: 1,
              damping: true,
              message: { type: 'control-change', channel: 4, control: 9 },
            },
          },
        },
      },
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.midiSetState).toHaveBeenCalledWith(expect.objectContaining({
      isEnabled: false,
      transportBindings: {
        playPause: null,
        stop: null,
      },
      slotBindings: {
        4: { channel: 4, note: 52 },
      },
      parameterBindings: {
        'parameter:clip-1:opacity': expect.objectContaining({
          clipId: 'clip-1',
          property: 'opacity',
          damping: true,
          message: { type: 'control-change', channel: 4, control: 9 },
        }),
      },
      learnTarget: null,
    }));
  });

  it('clears project MIDI bindings when loading a project without MIDI state', async () => {
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

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.midiSetState).toHaveBeenCalledWith(expect.objectContaining({
      transportBindings: {
        playPause: null,
        stop: null,
      },
      slotBindings: {},
      parameterBindings: {},
      learnTarget: null,
    }));
  });

  it('restores stop markers and marker MIDI bindings when loading a composition', async () => {
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
        tracks: [],
        clips: [],
        markers: [{
          id: 'marker-1',
          time: 12.5,
          name: 'Drop',
          color: '#ff6600',
          duration: 0,
          stopPlayback: true,
          midiBindings: [
            { action: 'jumpToMarkerAndStop', channel: 2, note: 44 },
          ],
        }],
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
      markers: [
        expect.objectContaining({
          id: 'marker-1',
          time: 12.5,
          label: 'Drop',
          color: '#ff6600',
          stopPlayback: true,
          midiBindings: [
            { action: 'jumpToMarkerAndStop', channel: 2, note: 44 },
          ],
        }),
      ],
    }));
  });

  it('restores model sequence frame urls from project RAW files when loading a project', async () => {
    const frameFiles = [
      new File(['0'], 'hero000000.glb', { type: 'model/gltf-binary' }),
      new File(['1'], 'hero000001.glb', { type: 'model/gltf-binary' }),
      new File(['2'], 'hero000002.glb', { type: 'model/gltf-binary' }),
    ];

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-model-seq-1',
        name: 'hero (3f)',
        type: 'model',
        sourcePath: 'C:/capture/hero000000.glb',
        projectPath: 'Raw/hero-seq_000000_hero000000.glb',
        duration: 0.1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
        modelSequence: {
          fps: 30,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            {
              name: 'hero000000.glb',
              projectPath: 'Raw/hero-seq_000000_hero000000.glb',
              sourcePath: 'C:/capture/hero000000.glb',
              absolutePath: 'C:/capture/hero000000.glb',
            },
            {
              name: 'hero000001.glb',
              projectPath: 'Raw/hero-seq_000001_hero000001.glb',
              sourcePath: 'C:/capture/hero000001.glb',
              absolutePath: 'C:/capture/hero000001.glb',
            },
            {
              name: 'hero000002.glb',
              projectPath: 'Raw/hero-seq_000002_hero000002.glb',
              sourcePath: 'C:/capture/hero000002.glb',
              absolutePath: 'C:/capture/hero000002.glb',
            },
          ],
        },
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
    mocks.getFileFromRaw.mockImplementation(async (relativePath: string) => {
      const fileByPath: Record<string, File> = {
        'Raw/hero-seq_000000_hero000000.glb': frameFiles[0],
        'Raw/hero-seq_000001_hero000001.glb': frameFiles[1],
        'Raw/hero-seq_000002_hero000002.glb': frameFiles[2],
      };
      const file = fileByPath[relativePath];
      return file ? { file } : null;
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.mediaState.files).toEqual([
      expect.objectContaining({
        id: 'media-model-seq-1',
        type: 'model',
        file: frameFiles[0],
        projectPath: 'Raw/hero-seq_000000_hero000000.glb',
        modelSequence: expect.objectContaining({
          frameCount: 3,
          frames: [
            expect.objectContaining({
              file: frameFiles[0],
              modelUrl: 'blob:project-media',
            }),
            expect.objectContaining({
              file: frameFiles[1],
              modelUrl: 'blob:project-media',
            }),
            expect.objectContaining({
              file: frameFiles[2],
              modelUrl: 'blob:project-media',
            }),
          ],
        }),
      }),
    ]);
  });

  it('restores gaussian splat sequence frame urls from project RAW files when loading a project', async () => {
    const frameFiles = [
      new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
      new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
    ];

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-splat-seq-1',
        name: 'scan (3f)',
        type: 'gaussian-splat',
        sourcePath: 'C:/capture/scan000000.ply',
        projectPath: 'Raw/scan-seq_000000_scan000000.ply',
        duration: 0.1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
        gaussianSplatSequence: {
          fps: 30,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          sharedBounds: {
            min: [-2, -1, 0],
            max: [5, 6, 7],
          },
          frames: [
            {
              name: 'scan000000.ply',
              projectPath: 'Raw/scan-seq_000000_scan000000.ply',
              sourcePath: 'C:/capture/scan000000.ply',
              absolutePath: 'C:/capture/scan000000.ply',
            },
            {
              name: 'scan000001.ply',
              projectPath: 'Raw/scan-seq_000001_scan000001.ply',
              sourcePath: 'C:/capture/scan000001.ply',
              absolutePath: 'C:/capture/scan000001.ply',
            },
            {
              name: 'scan000002.ply',
              projectPath: 'Raw/scan-seq_000002_scan000002.ply',
              sourcePath: 'C:/capture/scan000002.ply',
              absolutePath: 'C:/capture/scan000002.ply',
            },
          ],
        },
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
    mocks.getFileFromRaw.mockImplementation(async (relativePath: string) => {
      const fileByPath: Record<string, File> = {
        'Raw/scan-seq_000000_scan000000.ply': frameFiles[0],
        'Raw/scan-seq_000001_scan000001.ply': frameFiles[1],
        'Raw/scan-seq_000002_scan000002.ply': frameFiles[2],
      };
      const file = fileByPath[relativePath];
      return file ? { file } : null;
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.mediaState.files).toEqual([
      expect.objectContaining({
        id: 'media-splat-seq-1',
        type: 'gaussian-splat',
        file: frameFiles[0],
        projectPath: 'Raw/scan-seq_000000_scan000000.ply',
        gaussianSplatSequence: expect.objectContaining({
          frameCount: 3,
          sharedBounds: {
            min: [-2, -1, 0],
            max: [5, 6, 7],
          },
          frames: [
            expect.objectContaining({
              file: frameFiles[0],
              splatUrl: 'blob:project-media',
            }),
            expect.objectContaining({
              file: frameFiles[1],
              splatUrl: 'blob:project-media',
            }),
            expect.objectContaining({
              file: frameFiles[2],
              splatUrl: 'blob:project-media',
            }),
          ],
        }),
      }),
    ]);
  });

  it('restores model sequence frames from stored frame handles when no RAW copies exist', async () => {
    const frameFiles = [
      new File(['0'], 'hero000000.glb', { type: 'model/gltf-binary' }),
      new File(['1'], 'hero000001.glb', { type: 'model/gltf-binary' }),
      new File(['2'], 'hero000002.glb', { type: 'model/gltf-binary' }),
    ];

    const frameHandles = frameFiles.map((file) => ({
      kind: 'file',
      name: file.name,
      getFile: vi.fn(async () => file),
      queryPermission: vi.fn(async () => 'granted'),
    })) as unknown as FileSystemFileHandle[];

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-model-seq-2',
        name: 'hero (3f)',
        type: 'model',
        sourcePath: 'C:/capture/hero000000.glb',
        duration: 0.1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
        modelSequence: {
          fps: 30,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'hero',
          frames: [
            { name: 'hero000000.glb', sourcePath: 'C:/capture/hero000000.glb', absolutePath: 'C:/capture/hero000000.glb' },
            { name: 'hero000001.glb', sourcePath: 'C:/capture/hero000001.glb', absolutePath: 'C:/capture/hero000001.glb' },
            { name: 'hero000002.glb', sourcePath: 'C:/capture/hero000002.glb', absolutePath: 'C:/capture/hero000002.glb' },
          ],
        },
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
    mocks.getStoredHandle.mockImplementation(async (key: string) => {
      const byKey: Record<string, FileSystemHandle> = {
        'media_media-model-seq-2': frameHandles[0],
        'media_media-model-seq-2_frame_0': frameHandles[0],
        'media_media-model-seq-2_frame_1': frameHandles[1],
        'media_media-model-seq-2_frame_2': frameHandles[2],
      };
      return byKey[key] ?? null;
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.mediaState.files).toEqual([
      expect.objectContaining({
        id: 'media-model-seq-2',
        type: 'model',
        file: frameFiles[0],
        modelSequence: expect.objectContaining({
          frameCount: 3,
          frames: [
            expect.objectContaining({ file: frameFiles[0], modelUrl: 'blob:project-media' }),
            expect.objectContaining({ file: frameFiles[1], modelUrl: 'blob:project-media' }),
            expect.objectContaining({ file: frameFiles[2], modelUrl: 'blob:project-media' }),
          ],
        }),
      }),
    ]);
  });

  it('restores gaussian splat sequence frames from stored frame handles when no RAW copies exist', async () => {
    const frameFiles = [
      new File(['0'], 'scan000000.ply', { type: 'application/octet-stream' }),
      new File(['1'], 'scan000001.ply', { type: 'application/octet-stream' }),
      new File(['2'], 'scan000002.ply', { type: 'application/octet-stream' }),
    ];

    const frameHandles = frameFiles.map((file) => ({
      kind: 'file',
      name: file.name,
      getFile: vi.fn(async () => file),
      queryPermission: vi.fn(async () => 'granted'),
    })) as unknown as FileSystemFileHandle[];

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-splat-seq-2',
        name: 'scan (3f)',
        type: 'gaussian-splat',
        sourcePath: 'C:/capture/scan000000.ply',
        duration: 0.1,
        width: 1920,
        height: 1080,
        frameRate: 30,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
        gaussianSplatSequence: {
          fps: 30,
          frameCount: 3,
          playbackMode: 'clamp',
          sequenceName: 'scan',
          sharedBounds: {
            min: [-2, -1, 0],
            max: [5, 6, 7],
          },
          frames: [
            { name: 'scan000000.ply', sourcePath: 'C:/capture/scan000000.ply', absolutePath: 'C:/capture/scan000000.ply' },
            { name: 'scan000001.ply', sourcePath: 'C:/capture/scan000001.ply', absolutePath: 'C:/capture/scan000001.ply' },
            { name: 'scan000002.ply', sourcePath: 'C:/capture/scan000002.ply', absolutePath: 'C:/capture/scan000002.ply' },
          ],
        },
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
    mocks.getStoredHandle.mockImplementation(async (key: string) => {
      const byKey: Record<string, FileSystemHandle> = {
        'media_media-splat-seq-2': frameHandles[0],
        'media_media-splat-seq-2_frame_0': frameHandles[0],
        'media_media-splat-seq-2_frame_1': frameHandles[1],
        'media_media-splat-seq-2_frame_2': frameHandles[2],
      };
      return byKey[key] ?? null;
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.mediaState.files).toEqual([
      expect.objectContaining({
        id: 'media-splat-seq-2',
        type: 'gaussian-splat',
        file: frameFiles[0],
        gaussianSplatSequence: expect.objectContaining({
          frameCount: 3,
          sharedBounds: {
            min: [-2, -1, 0],
            max: [5, 6, 7],
          },
          frames: [
            expect.objectContaining({ file: frameFiles[0], splatUrl: 'blob:project-media' }),
            expect.objectContaining({ file: frameFiles[1], splatUrl: 'blob:project-media' }),
            expect.objectContaining({ file: frameFiles[2], splatUrl: 'blob:project-media' }),
          ],
        }),
      }),
    ]);
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
