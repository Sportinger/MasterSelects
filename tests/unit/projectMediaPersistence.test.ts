import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { revokeAllMediaObjectUrls } from '../../src/services/project/mediaObjectUrlManager';
import { flashBoardMediaBridge } from '../../src/services/flashboard/FlashBoardMediaBridge';
import { resetFlashBoardActiveGenerationState } from '../../src/stores/flashboardStore/activeGenerationRecords';
import type { ProjectFlashBoardState } from '../../src/services/project/types';

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
  hasProxyAudio: vi.fn(async () => false),
  scanRawFolder: vi.fn(async () => new Map()),
  scanProjectFolder: vi.fn(async () => new Map()),
  isProjectOpen: vi.fn(() => true),
  saveProject: vi.fn(async () => true),
  getStoredHandle: vi.fn(async () => null),
  storeHandle: vi.fn(async () => undefined),
  getThumbnail: vi.fn(async () => undefined),
  saveThumbnail: vi.fn(async () => undefined),
  deleteSourceThumbnails: vi.fn(async () => undefined),
  getFileHandle: vi.fn(() => undefined),
  storeFileHandle: vi.fn(),
  clearTimeline: vi.fn(),
  loadState: vi.fn(async () => undefined),
  timelineState: {
    clearTimeline: vi.fn(),
    loadState: vi.fn(async () => undefined),
    updateClip: vi.fn(),
    getSerializableState: vi.fn(() => ({ tracks: [], clips: [] })),
    clips: [] as unknown[],
    timelineSessionId: 1,
    clipKeyframes: new Map<string, unknown[]>(),
    playheadPosition: 0,
    zoom: 1,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    thumbnailsEnabled: true,
    waveformsEnabled: true,
    audioDisplayMode: 'detailed' as const,
    showTranscriptMarkers: false,
    setThumbnailsEnabled: vi.fn(),
    setWaveformsEnabled: vi.fn(),
    setAudioDisplayMode: vi.fn(),
    setShowTranscriptMarkers: vi.fn(),
  },
  timelineSetState: vi.fn(),
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
  createMediaSourceReplacementPatch: vi.fn(async (file: File) => ({
    fileHash: `hash:${file.name}`,
  })),
  createMediaSourceReplacementResetPatch: vi.fn(() => ({
    fileHash: undefined,
  })),
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
    setState: mocks.timelineSetState,
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
    hasProxyAudio: mocks.hasProxyAudio,
    scanRawFolder: mocks.scanRawFolder,
    scanProjectFolder: mocks.scanProjectFolder,
    isProjectOpen: mocks.isProjectOpen,
    saveProject: mocks.saveProject,
  },
}));

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getStoredHandle: mocks.getStoredHandle,
    storeHandle: mocks.storeHandle,
    getThumbnail: mocks.getThumbnail,
    saveThumbnail: mocks.saveThumbnail,
    deleteSourceThumbnails: mocks.deleteSourceThumbnails,
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
  createManagedThumbnailUrl: vi.fn(async (_mediaId: string, thumbnailUrl: string | undefined) => thumbnailUrl),
  createThumbnail: vi.fn(async () => undefined),
  handleThumbnailDedup: vi.fn(async (
    _fileHash: string | undefined,
    thumbnailUrl: string | undefined,
    _mediaId?: string,
  ) => thumbnailUrl),
}));

vi.mock('../../src/engine/WebGPUEngine', () => ({
  engine: {
    preCacheVideoFrame: vi.fn(),
  },
}));

vi.mock('../../src/stores/mediaStore/slices/fileManageSlice', () => ({
  createMediaSourceReplacementPatch: mocks.createMediaSourceReplacementPatch,
  createMediaSourceReplacementResetPatch: mocks.createMediaSourceReplacementResetPatch,
  updateTimelineClips: vi.fn(async () => undefined),
}));

const defaultProjectTransform = () => ({
  x: 0,
  y: 0,
  z: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  anchorX: 0.5,
  anchorY: 0.5,
  opacity: 1,
  blendMode: 'normal',
});

describe('project media persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flashBoardMediaBridge.hydrateMetadata({});
    resetFlashBoardActiveGenerationState();
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
    mocks.timelineState.timelineSessionId = 1;
    mocks.timelineState.clipKeyframes = new Map<string, unknown[]>();
    mocks.timelineState.loadState.mockImplementation(async () => undefined);
    mocks.timelineState.updateClip.mockImplementation((clipId: string, patch: Record<string, unknown>) => {
      mocks.timelineState.clips = mocks.timelineState.clips.map((clip) => (
        typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === clipId
          ? { ...clip, ...patch }
          : clip
      ));
    });
    mocks.timelineSetState.mockImplementation((partial: Record<string, unknown> | ((state: typeof mocks.timelineState) => Record<string, unknown>)) => {
      const nextPartial = typeof partial === 'function'
        ? partial(mocks.timelineState)
        : partial;
      Object.assign(mocks.timelineState, nextPartial);
    });
    mocks.timelineState.audioDisplayMode = 'detailed';
    mocks.getFileFromRaw.mockResolvedValue(null);
    mocks.getTranscript.mockResolvedValue(null);
    mocks.getAnalysisRanges.mockResolvedValue([]);
    mocks.hasProxyAudio.mockResolvedValue(false);
    mocks.getStoredHandle.mockResolvedValue(null);
    mocks.storeHandle.mockResolvedValue(undefined);
    mocks.getThumbnail.mockResolvedValue(undefined);
    mocks.saveThumbnail.mockResolvedValue(undefined);
    mocks.deleteSourceThumbnails.mockResolvedValue(undefined);
    mocks.scanRawFolder.mockResolvedValue(new Map());
    mocks.scanProjectFolder.mockResolvedValue(new Map());
    mocks.createMediaSourceReplacementPatch.mockImplementation(async (file: File) => ({
      fileHash: `hash:${file.name}`,
    }));
    mocks.createMediaSourceReplacementResetPatch.mockImplementation(() => ({
      fileHash: undefined,
    }));
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

  afterEach(() => {
    flashBoardMediaBridge.hydrateMetadata({});
    revokeAllMediaObjectUrls();
    vi.restoreAllMocks();
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
  }, 10_000);

  it('persists transition source fields through project save/load without shared references', async () => {
    const transitionSourceMap = {
      version: 1 as const,
      segments: [{ kind: 'linear' as const, compStart: 0, compEnd: 1, sourceStart: 2, sourceEnd: 3 }],
    };
    const transitionRecipeBlendWindows = [{ compStart: 0.25, compEnd: 0.75, blendMode: 'add' as const }];
    const transitionComp = {
      kind: 'transition-comp' as const,
      sourceLayout: 'mapped-v3' as const,
      legacyBackupCompositionId: 'legacy-backup',
      parentCompositionId: 'parent',
      parentTransitionId: 'transition-1',
      parentOutgoingClipId: 'out',
      parentIncomingClipId: 'in',
      linkedOutgoingClipId: 'out',
      linkedIncomingClipId: 'in',
      innerTransitionId: '',
      paddingBefore: 0,
      paddingAfter: 0,
      bodyStart: 0,
      bodyEnd: 1,
    };
    mocks.mediaState.compositions = [{
      id: 'transition-comp',
      name: 'Transition Comp',
      type: 'composition',
      parentId: null,
      createdAt: 1,
      width: 1920,
      height: 1080,
      frameRate: 30,
      duration: 1,
      backgroundColor: '#000000',
      transitionComp,
      timelineData: {
        duration: 1,
        tracks: [],
        clips: [{
          id: 'clip-1',
          trackId: 'track-1',
          name: 'Panel',
          mediaFileId: 'media-1',
          startTime: 0,
          duration: 1,
          inPoint: 0,
          outPoint: 1,
          sourceType: 'video',
          naturalDuration: 3,
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          sourceRect: { x: 0.25, y: 0, width: 0.5, height: 1 },
          transitionRender: { kind: 'distortion', progress: 0.4, distortion: 'swirl', seed: 7 },
          transitionSourceTimeOverride: 2.5,
          transitionSourceHold: true,
          transitionSourceMap,
          transitionRecipeBlendWindows,
          effects: [],
          masks: [],
          keyframes: [],
          volume: 1,
          audioEnabled: true,
          reversed: false,
          disabled: false,
        }],
      },
    }];

    const { saveCurrentProject } = await import('../../src/services/project/projectSave');
    await expect(saveCurrentProject()).resolves.toBe(true);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);

    const [savedComposition] = mocks.updateCompositions.mock.calls[0][0];
    const savedClip = savedComposition.clips[0];
    expect(savedClip).toEqual(expect.objectContaining({
      sourceRect: { x: 0.25, y: 0, width: 0.5, height: 1 },
      transitionRender: { kind: 'distortion', progress: 0.4, distortion: 'swirl', seed: 7 },
      transitionSourceTimeOverride: 2.5,
      transitionSourceHold: true,
      transitionSourceMap,
      transitionRecipeBlendWindows,
    }));
    expect(savedComposition.transitionComp?.sourceLayout).toBe('mapped-v3');
    expect(savedComposition.transitionComp?.legacyBackupCompositionId).toBe('legacy-backup');

    transitionSourceMap.segments[0].sourceStart = 99;
    transitionRecipeBlendWindows[0].compStart = 99;
    transitionComp.sourceLayout = 'legacy-segmented';
    expect(savedClip.transitionSourceMap?.segments[0]).toMatchObject({ sourceStart: 2 });
    expect(savedClip.transitionRecipeBlendWindows?.[0]).toMatchObject({ compStart: 0.25 });
    expect(savedComposition.transitionComp?.sourceLayout).toBe('mapped-v3');

    const { convertProjectCompositionToStore } = await import('../../src/services/project/load/loadTimelineHydration');
    const [restoredComposition] = convertProjectCompositionToStore([savedComposition]);
    const restoredClip = restoredComposition.timelineData!.clips[0];
    expect(restoredClip.transitionSourceMap).toEqual(savedClip.transitionSourceMap);
    expect(restoredClip.transitionRecipeBlendWindows).toEqual(savedClip.transitionRecipeBlendWindows);
    expect(restoredComposition.transitionComp?.sourceLayout).toBe('mapped-v3');
    expect(restoredComposition.transitionComp?.legacyBackupCompositionId).toBe('legacy-backup');
    expect(restoredClip.transitionSourceMap).not.toBe(savedClip.transitionSourceMap);
    expect(restoredClip.transitionRecipeBlendWindows).not.toBe(savedClip.transitionRecipeBlendWindows);
    expect(restoredComposition.transitionComp).not.toBe(savedComposition.transitionComp);

    restoredClip.transitionSourceMap!.segments[0].sourceStart = 42;
    restoredClip.transitionRecipeBlendWindows![0].compStart = 42;
    restoredComposition.transitionComp!.sourceLayout = 'legacy-segmented';
    expect(savedClip.transitionSourceMap?.segments[0]).toMatchObject({ sourceStart: 2 });
    expect(savedClip.transitionRecipeBlendWindows?.[0]).toMatchObject({ compStart: 0.25 });
    expect(savedComposition.transitionComp?.sourceLayout).toBe('mapped-v3');
  }, 10_000);

  it('drops obsolete YouTube panel payloads when syncing stores to the project file', async () => {
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
      youtube: {
        videos: [{ id: 'yt-legacy', title: 'Legacy' }],
        lastQuery: 'legacy',
      },
    };
    mocks.getProjectData.mockReturnValue(projectData);

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(projectData).not.toHaveProperty('youtube');
    expect(mocks.youtubeState.getState).not.toHaveBeenCalled();
  });

  it('persists FlashBoard generation metadata when completed records are no longer active', async () => {
    const projectData: {
      media: unknown[];
      compositions: unknown[];
      folders: unknown[];
      settings: { width: number; height: number; frameRate: number };
      activeCompositionId: string | null;
      openCompositionIds: string[];
      expandedFolderIds: string[];
      slotAssignments: Record<string, number>;
      uiState: Record<string, unknown>;
      flashboard?: ProjectFlashBoardState;
    } = {
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
    flashBoardMediaBridge.hydrateMetadata({
      'media-generated-video': {
        mediaFileId: 'media-generated-video',
        service: 'kieai',
        providerId: 'kling-3.0',
        version: '3.0',
        outputType: 'video',
        mediaType: 'video',
        prompt: 'Draw the background first, then the figures.',
        duration: 10,
        aspectRatio: '16:9',
        referenceMediaFileIds: ['start-frame'],
        createdAt: '2026-07-03T06:40:15.866Z',
      },
    });

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(projectData.flashboard?.generationRecords).toEqual([]);
    expect(projectData.flashboard?.generationMetadataByMediaId['media-generated-video']).toMatchObject({
      providerId: 'kling-3.0',
      mediaType: 'video',
      prompt: 'Draw the background first, then the figures.',
    });
  });

  it('does not block project load on legacy WAV audio proxy disk checks', async () => {
    const sourceFile = new File(['clip'], 'clip.mp4', { type: 'video/mp4' });
    mocks.getFileFromRaw.mockResolvedValue({ file: sourceFile });
    mocks.hasProxyAudio.mockImplementation(async (storageKey: string) => storageKey === 'hash-clip-1');
    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-1',
        name: 'clip.mp4',
        type: 'video',
        sourcePath: 'C:/capture/clip.mp4',
        projectPath: 'Raw/clip.mp4',
        fileHash: 'hash-clip-1',
        duration: 12,
        frameRate: 30,
        audioCodec: 'aac',
        hasAudio: true,
        hasProxy: false,
        hasAudioProxy: false,
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

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.hasProxyAudio).not.toHaveBeenCalled();
    expect(mocks.mediaState.files[0]).toEqual(expect.objectContaining({
      id: 'media-1',
      file: sourceFile,
      hasProxyAudio: false,
      audioProxyStatus: 'none',
      audioProxyProgress: 0,
      audioProxyStorageKey: 'hash-clip-1',
    }));
  }, 10_000);

  it('resets transient YouTube panel state instead of hydrating obsolete project payloads', async () => {
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
      youtube: {
        videos: [{ id: 'yt-legacy', title: 'Legacy' }],
        lastQuery: 'legacy',
      },
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.youtubeState.reset).toHaveBeenCalledTimes(1);
    expect(mocks.youtubeState.loadState).not.toHaveBeenCalled();
  });

  it('persists advanced audio refs and state without embedding payload bytes', async () => {
    const projectData: {
      media: unknown[];
      compositions: unknown[];
      folders: unknown[];
      settings: { width: number; height: number; frameRate: number };
      activeCompositionId: string | null;
      openCompositionIds: string[];
      expandedFolderIds: string[];
      slotAssignments: Record<string, number>;
      uiState: Record<string, unknown>;
      audio?: unknown;
    } = {
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
    const audioAnalysisRefs = {
      waveformPyramidId: 'artifact:waveform-manifest',
      loudnessEnvelopeId: 'artifact:loudness-manifest',
      spectrogramTileSetIds: ['artifact:spectrogram-tiles'],
    };
    const bakeAsset = {
      id: 'derived-audio-bake-1',
      mediaFileId: 'media-derived-bake-1',
      sourceMediaFileId: 'media-audio-1',
      sourceClipId: 'clip-a1',
      operationIds: ['op-spectral-replace', 'op-room-tone'],
      createdAt: 1779713000000,
      provenance: {
        mode: 'bake',
        renderPath: 'clip-audio-render-service',
      },
    };
    const clipAudioState = {
      sourceAnalysisRefs: audioAnalysisRefs,
      editStack: [
        {
          id: 'op-spectral-replace',
          type: 'spectral-resynthesis',
          enabled: true,
          params: {
            frequencyMinHz: 320,
            frequencyMaxHz: 2400,
            blendMode: 'replace',
          },
          timeRange: { start: 1, end: 4 },
          createdAt: 1779713000100,
        },
        {
          id: 'op-room-tone',
          type: 'room-tone-fill',
          enabled: true,
          params: {
            roomToneSourceRanges: JSON.stringify([{ start: 7, end: 8.5 }]),
            gainDb: -36,
          },
          timeRange: { start: 4.5, end: 5.2 },
          createdAt: 1779713000200,
        },
      ],
      effectStack: [{
        id: 'fx-volume',
        descriptorId: 'audio-volume',
        enabled: true,
        params: { volume: 0.75 },
      }],
      spectralLayers: [{
        id: 'spectral-image-1',
        imageMediaFileId: 'media-image-mask-1',
        timeStart: 1,
        duration: 3,
        frequencyMin: 320,
        frequencyMax: 2400,
        opacity: 0.85,
        enabled: true,
        blendMode: 'replace',
        gainDb: -6,
        featherTime: 0.05,
        featherFrequency: 120,
        keyframes: [
          { id: 'skf-1', time: 1, opacity: 0.2, gainDb: -18, frequencyMin: 320, frequencyMax: 1800 },
          { id: 'skf-2', time: 3.5, opacity: 1, gainDb: -3, frequencyMin: 500, frequencyMax: 2400 },
        ],
      }],
      processedAnalysisRefs: {
        processedWaveformPyramidId: 'artifact:processed-waveform-manifest',
      },
      bakeHistory: [bakeAsset],
    };
    const trackAudioState = {
      volumeDb: -3,
      pan: 0.1,
      muted: false,
      solo: false,
      recordArm: false,
      inputMonitor: false,
      meterMode: 'peak',
    };
    const masterAudioState = {
      volumeDb: 0,
      limiterEnabled: true,
      truePeakCeilingDb: -1,
      targetLufs: -14,
    };

    mocks.getProjectData.mockReturnValue(projectData);
    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.files = [{
      id: 'media-audio-1',
      name: 'dialog.wav',
      type: 'audio',
      filePath: 'C:/capture/dialog.wav',
      projectPath: 'Raw/dialog.wav',
      duration: 12,
      audioCodec: 'pcm',
      container: 'wav',
      fileSize: 4096,
      proxyStatus: 'none',
      audioAnalysisRefs,
      parentId: null,
      createdAt: 1,
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
      tracks: [{
        id: 'track-a1',
        name: 'Audio 1',
        type: 'audio',
        height: 60,
        muted: false,
        visible: true,
        solo: false,
        audioState: trackAudioState,
      }],
      clips: [{
        id: 'clip-a1',
        trackId: 'track-a1',
        name: 'dialog.wav',
        mediaFileId: 'media-audio-1',
        startTime: 0,
        duration: 12,
        inPoint: 0,
        outPoint: 12,
        sourceType: 'audio',
        naturalDuration: 12,
        waveform: [0.1, 0.2],
        waveformGenerating: true,
        waveformProgress: 37,
        audioAnalysisJob: {
          jobId: 'job-transient',
          kind: 'frequency-phase-analysis',
          label: 'Frequency/Phase',
          artifactKinds: ['frequency-summary', 'phase-correlation'],
          processed: false,
          phase: 'analyzing',
          progress: 37,
          startedAt: '2026-05-25T10:00:00.000Z',
          updatedAt: '2026-05-25T10:00:01.000Z',
        },
        audioState: clipAudioState,
        transform: {
          opacity: 1,
          blendMode: 'normal',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1 },
          rotation: { x: 0, y: 0, z: 0 },
        },
        effects: [],
      }],
      playheadPosition: 0,
      duration: 60,
      zoom: 1,
      scrollX: 0,
      inPoint: null,
      outPoint: null,
      loopPlayback: false,
      masterAudioState,
    });

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(mocks.updateMedia).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'media-audio-1',
        audioAnalysisRefs,
      }),
    ]);
    expect(mocks.updateCompositions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'comp-1',
        masterAudioState,
        tracks: [
          expect.objectContaining({ id: 'track-a1', audioState: trackAudioState }),
        ],
        clips: [
          expect.objectContaining({ id: 'clip-a1', audioState: clipAudioState }),
        ],
      }),
    ]);
    expect(projectData.audio).toEqual(expect.objectContaining({
      schemaVersion: 1,
      analysisArtifactIds: expect.arrayContaining([
        'artifact:waveform-manifest',
        'artifact:loudness-manifest',
        'artifact:spectrogram-tiles',
        'artifact:processed-waveform-manifest',
      ]),
      derivedAssets: expect.arrayContaining([bakeAsset]),
      masterAudioState,
    }));
    const serializedProjectCompositions = JSON.stringify(mocks.updateCompositions.mock.calls[0][0]);
    expect(serializedProjectCompositions).not.toContain('Float32Array');
    expect(serializedProjectCompositions).not.toContain('blob:');
    expect(serializedProjectCompositions).not.toContain('audioAnalysisJob');
    expect(serializedProjectCompositions).not.toContain('waveformGenerating');
    expect(serializedProjectCompositions).not.toContain('waveformProgress');
    expect(serializedProjectCompositions).toContain('spectral-image-1');
    expect(serializedProjectCompositions).toContain('op-spectral-replace');
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

  it('persists the MIDI track instrument (synth + GM program) so it survives a reload', async () => {
    // Regression: the disk save/load maps tracks field-by-field (unlike the in-memory
    // spread path), and midiInstrument was omitted — so the Wavetable Synth / GM program
    // was lost on hard refresh. It must round-trip to the saved project composition.
    mocks.mediaState.activeCompositionId = 'comp-1';
    mocks.mediaState.compositions = [{
      id: 'comp-1', name: 'Comp 1', type: 'composition', parentId: null, createdAt: 1,
      width: 1920, height: 1080, frameRate: 30, duration: 60, backgroundColor: '#000000',
      timelineData: { tracks: [], clips: [] },
    }];
    mocks.timelineState.getSerializableState.mockReturnValue({
      tracks: [{
        id: 'track-m1', name: 'MIDI 1', type: 'midi', height: 60, muted: false, visible: true, solo: false,
        midiInstrument: { kind: 'gm', program: 40, isDrum: false, gain: 0.8 },
      }],
      clips: [],
      playheadPosition: 0, duration: 60, zoom: 1, scrollX: 0, inPoint: null, outPoint: null,
    });

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(mocks.updateCompositions).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'comp-1',
        tracks: [
          expect.objectContaining({
            id: 'track-m1',
            type: 'midi',
            midiInstrument: { kind: 'gm', program: 40, isDrum: false, gain: 0.8 },
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

  it('returns late primary IndexedDB file-handle restores in the loaded media store', async () => {
    const restoredFile = new File(['restored-bytes'], 'restored.mp4', { type: 'video/mp4' });
    const restoredHandle = {
      name: 'restored.mp4',
      kind: 'file',
      getFile: vi.fn(async () => restoredFile),
      queryPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemFileHandle;

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-handle',
        name: 'restored.mp4',
        type: 'video',
        sourcePath: 'D:/captures/restored.mp4',
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
    mocks.getStoredHandle.mockImplementation(async (key: string) => (
      key === 'media_media-handle' ? restoredHandle : null
    ));

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(restoredHandle.getFile).toHaveBeenCalledTimes(1);
    expect(mocks.mediaSetState).toHaveBeenCalledWith(expect.objectContaining({
      files: [
        expect.objectContaining({
          id: 'media-handle',
          file: restoredFile,
          url: 'blob:project-media',
          hasFileHandle: true,
        }),
      ],
    }));
    expect(mocks.scanRawFolder).not.toHaveBeenCalled();
  });

  it('rebuilds post-relink nested video and audio clips as data-only sources', async () => {
    const videoFile = new File(['video-bytes'], 'nested-video.mp4', { type: 'video/mp4' });
    const audioFile = new File(['audio-bytes'], 'nested-audio.wav', { type: 'audio/wav' });
    const videoHandle = {
      kind: 'file',
      name: videoFile.name,
      getFile: vi.fn(async () => videoFile),
      queryPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemFileHandle;
    const audioHandle = {
      kind: 'file',
      name: audioFile.name,
      getFile: vi.fn(async () => audioFile),
      queryPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemFileHandle;
    const createElementSpy = vi.spyOn(document, 'createElement');

    mocks.scanRawFolder.mockResolvedValue(new Map([
      [videoFile.name, videoHandle],
      [audioFile.name, audioHandle],
    ]));
    mocks.timelineState.loadState.mockImplementationOnce(async (timelineData: {
      clips: Array<Record<string, unknown>>;
    }) => {
      mocks.timelineState.clips = timelineData.clips.map((clip) => ({
        ...clip,
        nestedClips: [],
      }));
    });
    mocks.getProjectData.mockReturnValue({
      media: [
        {
          id: 'media-video-1',
          name: videoFile.name,
          type: 'video',
          sourcePath: 'C:/capture/nested-video.mp4',
          projectPath: 'Raw/nested-video.mp4',
          duration: 8,
          width: 1920,
          height: 1080,
          frameRate: 30,
          hasAudio: true,
          hasProxy: false,
          folderId: null,
          importedAt: new Date(1).toISOString(),
        },
        {
          id: 'media-audio-1',
          name: audioFile.name,
          type: 'audio',
          sourcePath: 'C:/capture/nested-audio.wav',
          projectPath: 'Raw/nested-audio.wav',
          duration: 8,
          audioCodec: 'pcm',
          hasProxy: false,
          folderId: null,
          importedAt: new Date(1).toISOString(),
        },
      ],
      compositions: [
        {
          id: 'parent-comp',
          name: 'Parent Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 12,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [{
            id: 'parent-video-track',
            name: 'Video 1',
            type: 'video',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'parent-comp-clip',
            trackId: 'parent-video-track',
            name: 'Nested Child',
            mediaId: '',
            startTime: 0,
            duration: 8,
            inPoint: 0,
            outPoint: 8,
            transform: defaultProjectTransform(),
            effects: [],
            masks: [],
            keyframes: [],
            volume: 1,
            audioEnabled: true,
            reversed: false,
            disabled: false,
            isComposition: true,
            compositionId: 'child-comp',
            thumbnails: ['existing-thumb'],
          }],
          markers: [],
        },
        {
          id: 'child-comp',
          name: 'Child Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 8,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [
            {
              id: 'child-video-track',
              name: 'Video 1',
              type: 'video',
              height: 60,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
            },
            {
              id: 'child-audio-track',
              name: 'Audio 1',
              type: 'audio',
              height: 60,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
            },
          ],
          clips: [
            {
              id: 'nested-video-clip',
              trackId: 'child-video-track',
              name: 'Nested Video',
              mediaId: 'media-video-1',
              sourceType: 'video',
              naturalDuration: 8,
              startTime: 0,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
              transform: defaultProjectTransform(),
              effects: [],
              masks: [],
              keyframes: [],
              volume: 1,
              audioEnabled: true,
              reversed: false,
              disabled: false,
            },
            {
              id: 'nested-audio-clip',
              trackId: 'child-audio-track',
              name: 'Nested Audio',
              mediaId: 'media-audio-1',
              sourceType: 'audio',
              naturalDuration: 8,
              startTime: 0,
              duration: 8,
              inPoint: 0,
              outPoint: 8,
              transform: defaultProjectTransform(),
              effects: [],
              masks: [],
              keyframes: [],
              volume: 1,
              audioEnabled: true,
              reversed: false,
              disabled: false,
            },
          ],
          markers: [],
        },
      ],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: 'parent-comp',
      openCompositionIds: ['parent-comp'],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    for (let attempt = 0; attempt < 5000 && mocks.timelineState.updateClip.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(mocks.timelineState.updateClip).toHaveBeenCalledWith('parent-comp-clip', expect.objectContaining({
      nestedClips: expect.any(Array),
      nestedTracks: expect.any(Array),
      isLoading: false,
    }));
    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as { nestedClips?: Array<{ id: string; source?: Record<string, unknown>; isLoading?: boolean }> };
    expect(parentClip.nestedClips).toHaveLength(2);

    const nestedVideo = parentClip.nestedClips?.find((clip) => clip.id === 'nested-parent-comp-clip-nested-video-clip');
    const nestedAudio = parentClip.nestedClips?.find((clip) => clip.id === 'nested-parent-comp-clip-nested-audio-clip');
    expect(nestedVideo?.source).toEqual(expect.objectContaining({
      type: 'video',
      mediaFileId: 'media-video-1',
      naturalDuration: 8,
      filePath: 'C:/capture/nested-video.mp4',
    }));
    expect(nestedAudio?.source).toEqual(expect.objectContaining({
      type: 'audio',
      mediaFileId: 'media-audio-1',
      naturalDuration: 8,
      filePath: 'C:/capture/nested-audio.wav',
    }));
    expect(nestedVideo?.source).not.toHaveProperty('videoElement');
    expect(nestedVideo?.source).not.toHaveProperty('audioElement');
    expect(nestedAudio?.source).not.toHaveProperty('videoElement');
    expect(nestedAudio?.source).not.toHaveProperty('audioElement');
    expect(nestedVideo?.isLoading).toBe(false);
    expect(nestedAudio?.isLoading).toBe(false);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(2);
    expect(createElementSpy.mock.calls.some(([tagName]) => tagName === 'video' || tagName === 'audio')).toBe(false);
    createElementSpy.mockRestore();
  }, 10_000);

  it('delegates post-relink nested reload recursively through nested compositions', async () => {
    const videoFile = new File(['video-bytes'], 'grandchild-video.mp4', { type: 'video/mp4' });
    mocks.mediaState.files = [{
      id: 'media-video-1',
      name: videoFile.name,
      type: 'video',
      file: videoFile,
      duration: 5,
      sourcePath: 'C:/capture/grandchild-video.mp4',
      absolutePath: 'C:/capture/grandchild-video.mp4',
    }];
    mocks.mediaState.compositions = [
      {
        id: 'child-comp',
        name: 'Child Comp',
        duration: 10,
        timelineData: {
          duration: 10,
          tracks: [{
            id: 'child-video-track',
            name: 'Child Video',
            type: 'video',
            height: 60,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'child-comp-clip',
            trackId: 'child-video-track',
            name: 'Grandchild Comp',
            sourceType: 'video',
            isComposition: true,
            compositionId: 'grandchild-comp',
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            transform: defaultProjectTransform(),
            effects: [],
          }],
        },
      },
      {
        id: 'grandchild-comp',
        name: 'Grandchild Comp',
        duration: 5,
        timelineData: {
          duration: 5,
          tracks: [{
            id: 'grandchild-video-track',
            name: 'Grandchild Video',
            type: 'video',
            height: 60,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'grandchild-video-clip',
            trackId: 'grandchild-video-track',
            name: 'Grandchild Video',
            mediaFileId: 'media-video-1',
            sourceType: 'video',
            naturalDuration: 5,
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            transform: defaultProjectTransform(),
            effects: [],
          }],
        },
      },
    ];
    mocks.timelineState.clips = [{
      id: 'parent-comp-clip',
      trackId: 'parent-video-track',
      name: 'Parent Comp Clip',
      isComposition: true,
      compositionId: 'child-comp',
      nestedClips: [],
      thumbnails: ['existing-thumb'],
    }];

    const { reloadNestedCompositionClips } = await import('../../src/services/project/projectLoad');
    await reloadNestedCompositionClips();

    expect(mocks.timelineState.updateClip).toHaveBeenCalledWith('parent-comp-clip', expect.objectContaining({
      nestedClips: expect.any(Array),
      nestedTracks: expect.any(Array),
      nestedClipBoundaries: expect.any(Array),
      isLoading: false,
    }));

    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as {
      nestedClips?: Array<{
        id: string;
        nestedClips?: Array<{ source?: Record<string, unknown>; isLoading?: boolean }>;
      }>;
    };
    const childCompClip = parentClip.nestedClips?.[0];
    const grandchildVideo = childCompClip?.nestedClips?.[0];

    expect(childCompClip?.id).toBe('nested-parent-comp-clip-child-comp-clip');
    expect(grandchildVideo?.source).toEqual(expect.objectContaining({
      type: 'video',
      mediaFileId: 'media-video-1',
      naturalDuration: 5,
      filePath: 'C:/capture/grandchild-video.mp4',
    }));
    expect(grandchildVideo?.source).not.toHaveProperty('videoElement');
    expect(grandchildVideo?.source).not.toHaveProperty('audioElement');
    expect(grandchildVideo?.isLoading).toBe(false);
  });

  it('skips same-id post-relink nested reload when the composition identity changes before update', async () => {
    mocks.mediaState.compositions = [
      {
        id: 'child-comp',
        name: 'Child Comp',
        duration: 10,
        timelineData: {
          duration: 10,
          tracks: [{
            id: 'child-video-track',
            name: 'Child Video',
            type: 'video',
            height: 60,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'child-comp-clip',
            trackId: 'child-video-track',
            name: 'Grandchild Comp',
            sourceType: 'video',
            isComposition: true,
            compositionId: 'grandchild-comp',
            startTime: 0,
            duration: 5,
            inPoint: 0,
            outPoint: 5,
            transform: defaultProjectTransform(),
            effects: [],
          }],
        },
      },
      {
        id: 'grandchild-comp',
        name: 'Grandchild Comp',
        duration: 5,
        timelineData: {
          duration: 5,
          tracks: [],
          clips: [],
        },
      },
    ];
    mocks.timelineState.clips = [{
      id: 'parent-comp-clip',
      trackId: 'parent-video-track',
      name: 'Parent Comp Clip',
      isComposition: true,
      compositionId: 'child-comp',
      nestedClips: [],
      thumbnails: ['existing-thumb'],
    }];

    const { reloadNestedCompositionClips } = await import('../../src/services/project/projectLoad');
    const reloadPromise = reloadNestedCompositionClips();

    mocks.timelineState.clips = [{
      ...(mocks.timelineState.clips[0] as Record<string, unknown>),
      compositionId: 'other-comp',
    }];

    await reloadPromise;

    expect(mocks.timelineState.updateClip).not.toHaveBeenCalled();
  });

  it('restores project-load nested image clips as data-only sources without stale async patches', async () => {
    const imageFile = new File(['image'], 'nested-still.png', { type: 'image/png' });
    const createdImages: HTMLImageElement[] = [];
    vi.stubGlobal('Image', function MockImage() {
      const image = document.createElement('img');
      createdImages.push(image);
      return image;
    } as unknown as typeof Image);

    mocks.mediaState.files = [{
      id: 'media-image-1',
      name: imageFile.name,
      type: 'image',
      file: imageFile,
      duration: 5,
      sourcePath: 'C:/capture/nested-still.png',
      absolutePath: 'C:/capture/nested-still.png',
    }];
    mocks.mediaState.compositions = [{
      id: 'child-comp',
      name: 'Child Comp',
      duration: 5,
      timelineData: {
        duration: 5,
        tracks: [{
          id: 'child-video-track',
          name: 'Child Video',
          type: 'video',
          height: 60,
          visible: true,
          muted: false,
          solo: false,
        }],
        clips: [{
          id: 'nested-image-clip',
          trackId: 'child-video-track',
          name: 'Nested Image',
          mediaFileId: 'media-image-1',
          sourceType: 'image',
          naturalDuration: 5,
          startTime: 0,
          duration: 5,
          inPoint: 0,
          outPoint: 5,
          transform: defaultProjectTransform(),
          effects: [],
        }],
      },
    }];
    mocks.timelineState.clips = [{
      id: 'parent-comp-clip',
      trackId: 'parent-video-track',
      name: 'Parent Comp Clip',
      isComposition: true,
      compositionId: 'child-comp',
      nestedClips: [],
      thumbnails: ['existing-thumb'],
    }];

    const { reloadNestedCompositionClips } = await import('../../src/services/project/projectLoad');
    await reloadNestedCompositionClips();

    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as { nestedClips?: Array<{ source?: { imageUrl?: string; imageElement?: HTMLImageElement }; isLoading?: boolean }> };
    expect(parentClip.nestedClips?.[0].source).toMatchObject({
      type: 'image',
      mediaFileId: 'media-image-1',
      imageUrl: 'blob:project-media',
      naturalDuration: 5,
      filePath: 'C:/capture/nested-still.png',
    });
    expect(parentClip.nestedClips?.[0].source?.imageElement).toBeUndefined();
    expect(parentClip.nestedClips?.[0].isLoading).toBe(false);

    mocks.timelineSetState.mockClear();
    mocks.timelineState.timelineSessionId = 2;
    expect(createdImages).toHaveLength(0);

    expect(mocks.timelineSetState).not.toHaveBeenCalled();
    expect(parentClip.nestedClips?.[0].source?.imageUrl).toBe('blob:project-media');
    expect(parentClip.nestedClips?.[0].isLoading).toBe(false);
  });

  it('keeps unavailable post-relink nested non-video assets as neutral placeholders', async () => {
    mocks.mediaState.files = [
      {
        id: 'media-image-1',
        name: 'missing-still.png',
        type: 'image',
        file: undefined,
        url: '',
        duration: 5,
        sourcePath: 'C:/missing/missing-still.png',
      },
      {
        id: 'media-lottie-1',
        name: 'missing-animation.lottie',
        type: 'lottie',
        file: undefined,
        url: '',
        duration: 5,
        sourcePath: 'C:/missing/missing-animation.lottie',
      },
      {
        id: 'media-model-1',
        name: 'missing-model.glb',
        type: 'model',
        file: undefined,
        url: '',
        duration: 3600,
        sourcePath: 'C:/missing/missing-model.glb',
      },
      {
        id: 'media-splat-1',
        name: 'missing-splat.ply',
        type: 'gaussian-splat',
        file: undefined,
        url: '',
        duration: 3600,
        sourcePath: 'C:/missing/missing-splat.ply',
      },
    ];
    mocks.mediaState.compositions = [{
      id: 'child-comp',
      name: 'Child Comp',
      duration: 8,
      timelineData: {
        duration: 8,
        tracks: [{
          id: 'child-video-track',
          name: 'Child Video',
          type: 'video',
          height: 60,
          visible: true,
          muted: false,
          solo: false,
        }],
        clips: [
          {
            id: 'nested-image-clip',
            trackId: 'child-video-track',
            name: 'Missing Image',
            mediaFileId: 'media-image-1',
            sourceType: 'image',
            naturalDuration: 5,
            startTime: 0,
            duration: 2,
            inPoint: 0,
            outPoint: 2,
            transform: defaultProjectTransform(),
            effects: [],
          },
          {
            id: 'nested-lottie-clip',
            trackId: 'child-video-track',
            name: 'Missing Lottie',
            mediaFileId: 'media-lottie-1',
            sourceType: 'lottie',
            naturalDuration: 5,
            startTime: 2,
            duration: 2,
            inPoint: 0,
            outPoint: 2,
            transform: defaultProjectTransform(),
            effects: [],
          },
          {
            id: 'nested-model-clip',
            trackId: 'child-video-track',
            name: 'Missing Model',
            mediaFileId: 'media-model-1',
            sourceType: 'model',
            naturalDuration: 3600,
            startTime: 4,
            duration: 2,
            inPoint: 0,
            outPoint: 2,
            transform: defaultProjectTransform(),
            effects: [],
            is3D: true,
          },
          {
            id: 'nested-splat-clip',
            trackId: 'child-video-track',
            name: 'Missing Splat',
            mediaFileId: 'media-splat-1',
            sourceType: 'gaussian-splat',
            naturalDuration: 3600,
            startTime: 6,
            duration: 2,
            inPoint: 0,
            outPoint: 2,
            transform: defaultProjectTransform(),
            effects: [],
            is3D: true,
          },
        ],
      },
    }];
    mocks.timelineState.clips = [{
      id: 'parent-comp-clip',
      trackId: 'parent-video-track',
      name: 'Parent Comp Clip',
      isComposition: true,
      compositionId: 'child-comp',
      nestedClips: [],
      thumbnails: ['existing-thumb'],
    }];

    const { reloadNestedCompositionClips } = await import('../../src/services/project/projectLoad');
    await reloadNestedCompositionClips();

    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(mocks.timelineState.updateClip).toHaveBeenCalledWith('parent-comp-clip', expect.objectContaining({
      nestedClips: expect.any(Array),
      isLoading: false,
    }));

    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as {
      nestedClips?: Array<{
        id: string;
        source?: unknown;
        isLoading?: boolean;
        needsReload?: boolean;
      }>;
    };
    const nestedById = new Map(parentClip.nestedClips?.map((clip) => [clip.id, clip]));
    const nestedImage = nestedById.get('nested-parent-comp-clip-nested-image-clip');
    const nestedLottie = nestedById.get('nested-parent-comp-clip-nested-lottie-clip');
    const nestedModel = nestedById.get('nested-parent-comp-clip-nested-model-clip');
    const nestedSplat = nestedById.get('nested-parent-comp-clip-nested-splat-clip');

    expect(nestedImage).toEqual(expect.objectContaining({
      source: null,
      isLoading: false,
      needsReload: undefined,
    }));
    expect(nestedLottie).toEqual(expect.objectContaining({
      source: null,
      isLoading: false,
      needsReload: undefined,
    }));
    expect(nestedModel).toEqual(expect.objectContaining({
      source: null,
      isLoading: false,
      needsReload: undefined,
    }));
    expect(nestedSplat).toEqual(expect.objectContaining({
      source: null,
      isLoading: false,
      needsReload: undefined,
    }));
  });

  it('rebuilds post-relink nested trees that already contain needsReload placeholders', async () => {
    const modelFile = new File(['model-bytes'], 'nested-model.glb', { type: 'model/gltf-binary' });

    mocks.mediaState.files = [{
      id: 'media-model-1',
      name: modelFile.name,
      type: 'model',
      file: modelFile,
      duration: 3600,
      sourcePath: 'C:/capture/nested-model.glb',
      absolutePath: 'C:/capture/nested-model.glb',
    }];
    mocks.mediaState.compositions = [{
      id: 'child-comp',
      name: 'Child Comp',
      duration: 8,
      timelineData: {
        duration: 8,
        tracks: [{
          id: 'child-video-track',
          name: 'Child Video',
          type: 'video',
          height: 60,
          visible: true,
          muted: false,
          solo: false,
        }],
        clips: [{
          id: 'nested-model-clip',
          trackId: 'child-video-track',
          name: 'Nested Model',
          mediaFileId: 'media-model-1',
          sourceType: 'model',
          naturalDuration: 3600,
          startTime: 0,
          duration: 8,
          inPoint: 0,
          outPoint: 8,
          transform: defaultProjectTransform(),
          effects: [],
          is3D: true,
        }],
      },
    }];
    mocks.timelineState.clips = [{
      id: 'parent-comp-clip',
      trackId: 'parent-video-track',
      name: 'Parent Comp Clip',
      isComposition: true,
      compositionId: 'child-comp',
      nestedClips: [{
        id: 'nested-parent-comp-clip-nested-model-clip',
        trackId: 'child-video-track',
        name: 'Nested Model',
        mediaFileId: 'media-model-1',
        source: {
          type: 'model',
          mediaFileId: 'media-model-1',
          naturalDuration: 3600,
        },
        needsReload: true,
        isLoading: false,
      }],
      thumbnails: ['existing-thumb'],
    }];

    const { reloadNestedCompositionClips } = await import('../../src/services/project/projectLoad');
    await reloadNestedCompositionClips();

    expect(mocks.timelineState.updateClip).toHaveBeenCalledWith('parent-comp-clip', expect.objectContaining({
      nestedClips: expect.any(Array),
      isLoading: false,
    }));

    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as { nestedClips?: Array<{ id: string; source?: Record<string, unknown>; needsReload?: boolean; isLoading?: boolean }> };
    const nestedModel = parentClip.nestedClips?.find((clip) => clip.id === 'nested-parent-comp-clip-nested-model-clip');

    expect(nestedModel?.source).toEqual(expect.objectContaining({
      type: 'model',
      mediaFileId: 'media-model-1',
      modelUrl: 'blob:project-media',
      naturalDuration: 3600,
    }));
    expect(nestedModel?.needsReload).toBeUndefined();
    expect(nestedModel?.isLoading).toBe(false);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('rebuilds post-relink nested model clips from restored model URLs', async () => {
    const modelFile = new File(['model-bytes'], 'nested-model.glb', { type: 'model/gltf-binary' });
    const modelHandle = {
      kind: 'file',
      name: modelFile.name,
      getFile: vi.fn(async () => modelFile),
      queryPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemFileHandle;

    mocks.scanRawFolder.mockResolvedValue(new Map([
      [modelFile.name, modelHandle],
    ]));
    mocks.timelineState.loadState.mockImplementationOnce(async (timelineData: {
      clips: Array<Record<string, unknown>>;
    }) => {
      mocks.timelineState.clips = timelineData.clips.map((clip) => ({
        ...clip,
        nestedClips: [],
      }));
    });
    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-model-1',
        name: modelFile.name,
        type: 'model',
        sourcePath: 'C:/capture/nested-model.glb',
        projectPath: 'Raw/nested-model.glb',
        duration: 3600,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
        modelSequence: {
          fps: 30,
          frameCount: 1,
          playbackMode: 'clamp',
          frames: [
            { name: modelFile.name, sourcePath: 'C:/capture/nested-model.glb', absolutePath: 'C:/capture/nested-model.glb' },
          ],
        },
      }],
      compositions: [
        {
          id: 'parent-comp',
          name: 'Parent Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 12,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [{
            id: 'parent-video-track',
            name: 'Video 1',
            type: 'video',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'parent-comp-clip',
            trackId: 'parent-video-track',
            name: 'Nested Child',
            mediaId: '',
            startTime: 0,
            duration: 8,
            inPoint: 0,
            outPoint: 8,
            transform: defaultProjectTransform(),
            effects: [],
            masks: [],
            keyframes: [],
            volume: 1,
            audioEnabled: true,
            reversed: false,
            disabled: false,
            isComposition: true,
            compositionId: 'child-comp',
            thumbnails: ['existing-thumb'],
          }],
          markers: [],
        },
        {
          id: 'child-comp',
          name: 'Child Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 8,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [{
            id: 'child-video-track',
            name: 'Video 1',
            type: 'video',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'nested-model-clip',
            trackId: 'child-video-track',
            name: 'Nested Model',
            mediaId: 'media-model-1',
            sourceType: 'model',
            naturalDuration: 3600,
            startTime: 0,
            duration: 8,
            inPoint: 0,
            outPoint: 8,
            transform: defaultProjectTransform(),
            effects: [],
            masks: [],
            keyframes: [],
            volume: 1,
            audioEnabled: false,
            reversed: false,
            disabled: false,
            is3D: true,
            modelSequence: {
              fps: 30,
              frameCount: 1,
              playbackMode: 'clamp',
              frames: [
                { name: modelFile.name, sourcePath: 'C:/capture/nested-model.glb', absolutePath: 'C:/capture/nested-model.glb' },
              ],
            },
          }],
          markers: [],
        },
      ],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: 'parent-comp',
      openCompositionIds: ['parent-comp'],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    for (let attempt = 0; attempt < 120 && mocks.timelineState.updateClip.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as { nestedClips?: Array<{ id: string; source?: Record<string, unknown>; is3D?: boolean; isLoading?: boolean }> };
    const nestedModel = parentClip.nestedClips?.find((clip) => clip.id === 'nested-parent-comp-clip-nested-model-clip');

    expect(nestedModel?.source).toEqual(expect.objectContaining({
      type: 'model',
      mediaFileId: 'media-model-1',
      modelUrl: 'blob:project-media',
      modelSequence: expect.objectContaining({ frameCount: 1 }),
      naturalDuration: 3600,
    }));
    expect(nestedModel?.is3D).toBe(true);
    expect(nestedModel?.isLoading).toBe(false);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('rebuilds post-relink nested gaussian splat clips from restored sequence URLs', async () => {
    const splatFile = new File(['splat-bytes'], 'nested-splat.ply', { type: 'application/octet-stream' });
    const splatHandle = {
      kind: 'file',
      name: splatFile.name,
      getFile: vi.fn(async () => splatFile),
      queryPermission: vi.fn(async () => 'granted'),
    } as unknown as FileSystemFileHandle;
    const gaussianSplatSequence = {
      fps: 30,
      frameCount: 1,
      playbackMode: 'clamp',
      sequenceName: 'scan',
      frames: [
        { name: splatFile.name, sourcePath: 'C:/capture/nested-splat.ply', absolutePath: 'C:/capture/nested-splat.ply' },
      ],
    };

    mocks.scanRawFolder.mockResolvedValue(new Map([
      [splatFile.name, splatHandle],
    ]));
    mocks.timelineState.loadState.mockImplementationOnce(async (timelineData: {
      clips: Array<Record<string, unknown>>;
    }) => {
      mocks.timelineState.clips = timelineData.clips.map((clip) => ({
        ...clip,
        nestedClips: [],
      }));
    });
    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-splat-1',
        name: splatFile.name,
        type: 'gaussian-splat',
        sourcePath: 'C:/capture/nested-splat.ply',
        projectPath: 'Raw/nested-splat.ply',
        duration: 3600,
        hasProxy: false,
        folderId: null,
        importedAt: new Date(1).toISOString(),
        gaussianSplatSequence,
      }],
      compositions: [
        {
          id: 'parent-comp',
          name: 'Parent Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 12,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [{
            id: 'parent-video-track',
            name: 'Video 1',
            type: 'video',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'parent-comp-clip',
            trackId: 'parent-video-track',
            name: 'Nested Child',
            mediaId: '',
            startTime: 0,
            duration: 8,
            inPoint: 0,
            outPoint: 8,
            transform: defaultProjectTransform(),
            effects: [],
            masks: [],
            keyframes: [],
            volume: 1,
            audioEnabled: true,
            reversed: false,
            disabled: false,
            isComposition: true,
            compositionId: 'child-comp',
            thumbnails: ['existing-thumb'],
          }],
          markers: [],
        },
        {
          id: 'child-comp',
          name: 'Child Comp',
          width: 1920,
          height: 1080,
          frameRate: 30,
          duration: 8,
          backgroundColor: '#000000',
          folderId: null,
          tracks: [{
            id: 'child-video-track',
            name: 'Video 1',
            type: 'video',
            height: 60,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
          }],
          clips: [{
            id: 'nested-splat-clip',
            trackId: 'child-video-track',
            name: 'Nested Splat',
            mediaId: 'media-splat-1',
            sourceType: 'gaussian-splat',
            naturalDuration: 3600,
            startTime: 0,
            duration: 8,
            inPoint: 0,
            outPoint: 8,
            transform: defaultProjectTransform(),
            effects: [],
            masks: [],
            keyframes: [],
            volume: 1,
            audioEnabled: false,
            reversed: false,
            disabled: false,
            is3D: true,
            threeDEffectorsEnabled: false,
            gaussianSplatSequence,
          }],
          markers: [],
        },
      ],
      folders: [],
      settings: { width: 1920, height: 1080, frameRate: 30 },
      activeCompositionId: 'parent-comp',
      openCompositionIds: ['parent-comp'],
      expandedFolderIds: [],
      slotAssignments: {},
      uiState: {},
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    for (let attempt = 0; attempt < 120 && mocks.timelineState.updateClip.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const parentClip = mocks.timelineState.clips.find((clip) => (
      typeof clip === 'object' && clip !== null && 'id' in clip && clip.id === 'parent-comp-clip'
    )) as { nestedClips?: Array<{ id: string; source?: Record<string, unknown>; is3D?: boolean; isLoading?: boolean }> };
    const nestedSplat = parentClip.nestedClips?.find((clip) => clip.id === 'nested-parent-comp-clip-nested-splat-clip');

    expect(nestedSplat?.source).toEqual(expect.objectContaining({
      type: 'gaussian-splat',
      mediaFileId: 'media-splat-1',
      gaussianSplatUrl: 'blob:project-media',
      gaussianSplatFileName: splatFile.name,
      gaussianSplatRuntimeKey: 'C:/capture/nested-splat.ply',
      gaussianSplatSequence: expect.objectContaining({ frameCount: 1, sequenceName: 'scan' }),
      naturalDuration: 3600,
      threeDEffectorsEnabled: false,
    }));
    expect(nestedSplat?.is3D).toBe(true);
    expect(nestedSplat?.isLoading).toBe(false);
    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1);
  }, 10_000);

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

  it('persists timeline audio display mode in project uiState', async () => {
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
    mocks.timelineState.audioDisplayMode = 'spectral';

    const { syncStoresToProject } = await import('../../src/services/project/projectSave');
    await syncStoresToProject();

    expect(projectData.uiState).toEqual(expect.objectContaining({
      audioDisplayMode: 'spectral',
    }));
  });

  it('restores advanced audio refs and state from project media and compositions', async () => {
    const audioAnalysisRefs = {
      waveformPyramidId: 'artifact:waveform-manifest',
      processedWaveformPyramidId: 'artifact:processed-waveform-manifest',
    };
    const clipAudioState = {
      sourceAnalysisRefs: audioAnalysisRefs,
      muted: false,
      editStack: [{
        id: 'op-spectral-replace',
        type: 'spectral-resynthesis',
        enabled: true,
        params: {
          frequencyMinHz: 300,
          frequencyMaxHz: 2100,
          blendMode: 'replace',
        },
        timeRange: { start: 2, end: 5 },
        createdAt: 1779713000100,
      }],
      effectStack: [{
        id: 'fx-eq',
        descriptorId: 'audio-eq',
        enabled: true,
        params: { band1k: 1.5 },
      }],
      spectralLayers: [{
        id: 'spectral-image-restore-1',
        imageMediaFileId: 'media-image-mask-1',
        timeStart: 2,
        duration: 3,
        frequencyMin: 300,
        frequencyMax: 2100,
        opacity: 0.9,
        enabled: true,
        blendMode: 'replace',
        gainDb: -4,
        featherTime: 0.04,
        featherFrequency: 160,
        keyframes: [
          { id: 'skf-restore-1', time: 2, opacity: 0.25, gainDb: -16, frequencyMin: 300, frequencyMax: 1500 },
          { id: 'skf-restore-2', time: 4.5, opacity: 1, gainDb: -2, frequencyMin: 600, frequencyMax: 2100 },
        ],
      }],
      bakeHistory: [{
        id: 'derived-audio-bake-restore-1',
        mediaFileId: 'media-derived-bake-restore-1',
        sourceMediaFileId: 'media-audio-1',
        sourceClipId: 'clip-a1',
        operationIds: ['op-spectral-replace'],
        createdAt: 1779713000300,
        provenance: {
          mode: 'bake',
          renderPath: 'clip-audio-render-service',
        },
      }],
    };
    const trackAudioState = {
      volumeDb: -6,
      pan: -0.25,
      muted: false,
      solo: false,
      recordArm: false,
      inputMonitor: false,
      meterMode: 'rms',
    };
    const masterAudioState = {
      volumeDb: -1,
      limiterEnabled: true,
      truePeakCeilingDb: -1,
    };

    mocks.getProjectData.mockReturnValue({
      media: [{
        id: 'media-audio-1',
        name: 'dialog.wav',
        type: 'audio',
        sourcePath: 'Raw/dialog.wav',
        projectPath: 'Raw/dialog.wav',
        duration: 12,
        audioCodec: 'pcm',
        container: 'wav',
        fileSize: 4096,
        hasProxy: false,
        audioAnalysisRefs,
        folderId: null,
        importedAt: '2026-05-25T10:00:00.000Z',
      }],
      compositions: [{
        id: 'comp-1',
        name: 'Comp 1',
        width: 1920,
        height: 1080,
        frameRate: 30,
        duration: 60,
        backgroundColor: '#000000',
        folderId: null,
        tracks: [{
          id: 'track-a1',
          name: 'Audio 1',
          type: 'audio',
          height: 60,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          audioState: trackAudioState,
        }],
        clips: [{
          id: 'clip-a1',
          trackId: 'track-a1',
          name: 'dialog.wav',
          mediaId: 'media-audio-1',
          sourceType: 'audio',
          startTime: 0,
          duration: 12,
          inPoint: 0,
          outPoint: 12,
          transform: {
            opacity: 1,
            blendMode: 'normal',
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1 },
            rotation: { x: 0, y: 0, z: 0 },
          },
          effects: [],
          masks: [],
          keyframes: [],
          volume: 1,
          audioEnabled: true,
          audioState: clipAudioState,
          audioAnalysisJob: {
            jobId: 'stale-job',
            kind: 'loudness-envelope',
            label: 'Loudness',
            artifactKinds: ['loudness-envelope'],
            processed: false,
            phase: 'analyzing',
            progress: 50,
            startedAt: '2026-05-25T10:00:00.000Z',
            updatedAt: '2026-05-25T10:00:01.000Z',
          },
          waveformGenerating: true,
          waveformProgress: 50,
          reversed: false,
          disabled: false,
        }],
        masterAudioState,
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

    expect(mocks.mediaState.files[0]).toEqual(expect.objectContaining({
      id: 'media-audio-1',
      audioAnalysisRefs,
    }));
    expect(mocks.timelineState.loadState).toHaveBeenCalledWith(expect.objectContaining({
      masterAudioState,
      tracks: [
        expect.objectContaining({ id: 'track-a1', audioState: trackAudioState }),
      ],
      clips: [
        expect.not.objectContaining({
          id: 'clip-a1',
          audioAnalysisJob: expect.anything(),
        }),
      ],
    }));
    const loadedClips = mocks.timelineState.loadState.mock.calls[0][0].clips;
    expect(loadedClips[0]).toEqual(expect.objectContaining({ id: 'clip-a1', audioState: clipAudioState }));
    expect(loadedClips[0]).not.toHaveProperty('audioAnalysisJob');
    expect(loadedClips[0]).not.toHaveProperty('waveformGenerating');
    expect(loadedClips[0]).not.toHaveProperty('waveformProgress');
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

  it('revokes previous media-state sequence frame urls before loading project media', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    mocks.mediaState.files = [
      {
        id: 'old-model-seq',
        name: 'old model sequence',
        type: 'model',
        parentId: null,
        createdAt: 1,
        url: 'blob:old-model-main',
        thumbnailUrl: 'blob:old-model-thumb',
        modelSequence: {
          fps: 30,
          frameCount: 2,
          playbackMode: 'clamp',
          frames: [
            { name: 'old000000.glb', modelUrl: 'blob:old-model-frame-0' },
            { name: 'old000001.glb', modelUrl: 'blob:old-model-frame-1' },
          ],
        },
      },
      {
        id: 'old-splat-seq',
        name: 'old splat sequence',
        type: 'gaussian-splat',
        parentId: null,
        createdAt: 1,
        url: 'blob:old-splat-main',
        proxyVideoUrl: 'blob:old-splat-proxy',
        audioProxyUrl: 'blob:old-splat-audio-proxy',
        gaussianSplatSequence: {
          fps: 30,
          frameCount: 2,
          playbackMode: 'clamp',
          frames: [
            { name: 'old000000.ply', splatUrl: 'blob:old-splat-frame-0' },
            { name: 'old000001.ply', splatUrl: 'blob:old-splat-frame-1' },
          ],
        },
      },
    ];
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

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-model-main');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-model-thumb');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-model-frame-0');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-model-frame-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-splat-main');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-splat-proxy');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-splat-audio-proxy');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-splat-frame-0');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-splat-frame-1');
    expect(mocks.mediaState.files).toEqual([]);
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

  it('restores timeline audio display mode from project uiState', async () => {
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
        audioDisplayMode: 'spectral',
      },
    });

    const { loadProjectToStores } = await import('../../src/services/project/projectLoad');
    await loadProjectToStores();

    expect(mocks.timelineState.setAudioDisplayMode).toHaveBeenCalledWith('spectral');
  });
