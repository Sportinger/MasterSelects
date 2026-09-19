import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { MediaState } from '../../../src/stores/mediaStore/types';
import { createFileImportSlice, type FileImportActions } from '../../../src/stores/mediaStore/slices/fileImportSlice';

const importPipelineMocks = vi.hoisted(() => ({
  nextId: 0,
  processImport: vi.fn(),
}));

const waveformMocks = vi.hoisted(() => ({
  generateTimelineWaveformAnalysisForFile: vi.fn(),
}));

vi.mock('../../../src/stores/mediaStore/helpers/importPipeline', () => ({
  generateId: vi.fn(() => `test-import-${++importPipelineMocks.nextId}`),
  processImport: importPipelineMocks.processImport,
}));

vi.mock('../../../src/services/audio/timelineWaveformPyramidCache', () => ({
  SOURCE_WAVEFORM_MAX_PREVIEW_SAMPLES: 32000,
  SOURCE_WAVEFORM_PREVIEW_SAMPLES_PER_SECOND: 160,
  generateTimelineWaveformAnalysisForFile: waveformMocks.generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress: (progress: number) => Math.round(Math.max(0, Math.min(70, progress)) / 70 * 20),
  mapSourceWaveformPyramidProgress: (progress: { percent: number }) => Math.round(20 + Math.max(0, Math.min(100, progress.percent)) / 100 * 79),
}));

vi.mock('../../../src/services/projectFileService', () => ({
  projectFileService: {
    getProjectHandle: vi.fn(() => null),
  },
}));

type TestState = MediaState & FileImportActions & {
  reloadFile: (id: string) => Promise<boolean>;
  ensureFileThumbnail: (id: string) => Promise<boolean>;
};

function createInitialMediaState(): MediaState {
  return {
    files: [],
    compositions: [],
    folders: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    cameraItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    signalArtifacts: [],
    signalGraphs: [],
    signalOperators: [],
    activeCompositionId: null,
    openCompositionIds: [],
    slotAssignments: {},
    slotDeckStates: {},
    slotClipSettings: {},
    selectedSlotCompositionId: null,
    previewCompositionId: null,
    sourceMonitorFileId: null,
    sourceMonitorPlaybackRequestId: 0,
    activeLayerSlots: {},
    layerOpacities: {},
    selectedIds: [],
    expandedFolderIds: [],
    currentProjectId: null,
    currentProjectName: 'Untitled Project',
    isLoading: false,
    projectLoadProgress: {
      active: false,
      phase: 'idle',
      percent: 0,
      message: '',
      blocking: false,
    },
    proxyEnabled: false,
    proxyGenerationQueue: [],
    currentlyGeneratingProxyId: null,
    fileSystemSupported: false,
    proxyFolderName: null,
  };
}

function createTestStore(
  reloadFile = vi.fn(async () => true),
  ensureFileThumbnail = vi.fn(async () => true),
) {
  return create<TestState>()((set, get) => ({
    ...createInitialMediaState(),
    ...createFileImportSlice(set, get),
    reloadFile,
    ensureFileThumbnail,
  }));
}

describe('fileImportSlice Signal imports', () => {
  beforeEach(() => {
    importPipelineMocks.nextId = 0;
    importPipelineMocks.processImport.mockReset();
    waveformMocks.generateTimelineWaveformAnalysisForFile.mockReset();
    waveformMocks.generateTimelineWaveformAnalysisForFile.mockResolvedValue({
      waveform: [0.1, 0.7, 1, 0.25],
      waveformChannels: [
        [0.1, 0.7, 1, 0.25],
        [0.05, 0.5, 0.8, 0.2],
      ],
      audioAnalysisRefs: {
        waveformPyramidId: 'artifact:waveform-pyramid',
      },
    });
  });

  it('imports CSV files through the universal signal route', async () => {
    const store = createTestStore();
    const file = new File(['name,score\nAda,42\nGrace,99'], 'scores.csv', { type: 'text/csv' });

    const importedItems = await store.getState().importFiles([file], 'folder-1');

    expect(importedItems).toHaveLength(1);
    expect(importedItems[0]?.type).toBe('signal');
    expect(store.getState().files).toEqual([]);
    expect(importPipelineMocks.processImport).not.toHaveBeenCalled();

    const [signalAsset] = store.getState().signalAssets;
    expect(signalAsset).toMatchObject({
      name: 'scores.csv',
      type: 'signal',
      parentId: 'folder-1',
      providerId: 'masterselects.import.csv',
    });
    expect(signalAsset?.signalKinds).toEqual(['table', 'metadata', 'binary']);
    expect(signalAsset?.asset.source).toMatchObject({
      kind: 'file',
      fileName: 'scores.csv',
      extension: 'csv',
      providerId: 'masterselects.import.csv',
    });
    expect(signalAsset?.artifacts.map((artifact) => artifact.encoding)).toEqual(['csv', 'table-records']);
    expect(store.getState().signalArtifacts).toHaveLength(2);
  });

  it('keeps unknown files as binary SignalAssets instead of rejecting them', async () => {
    const store = createTestStore();
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'part.step', {
      type: 'application/step',
    });

    await store.getState().importFiles([file]);

    const [signalAsset] = store.getState().signalAssets;
    expect(signalAsset).toMatchObject({
      name: 'part.step',
      type: 'signal',
      providerId: 'masterselects.import.binary-fallback',
    });
    expect(signalAsset?.signalKinds).toEqual(['binary', 'metadata']);
    expect(signalAsset?.artifacts).toHaveLength(1);
    expect(signalAsset?.artifacts[0]?.storage.kind).toBe('memory');
  });

  it('starts persistent source waveform generation after audio import finalizes', async () => {
    const store = createTestStore();
    const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' });
    const mediaFile = {
      id: 'test-import-1',
      name: 'voice.wav',
      type: 'audio',
      parentId: 'folder-1',
      createdAt: 1,
      file,
      url: 'blob:voice',
      duration: 12,
      hasAudio: true,
    } as const;
    importPipelineMocks.processImport.mockResolvedValue({ mediaFile });

    await store.getState().importFile(file, 'folder-1');

    expect(waveformMocks.generateTimelineWaveformAnalysisForFile).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        mediaFileId: 'test-import-1',
        includePyramid: true,
        samplesPerSecond: 160,
        maxPreviewSamples: 32000,
      }),
    );

    await vi.waitFor(() => {
      expect(store.getState().files[0]?.waveformStatus).toBe('ready');
    });
    expect(store.getState().files[0]).toMatchObject({
      waveform: [0.1, 0.7, 1, 0.25],
      waveformChannels: [
        [0.1, 0.7, 1, 0.25],
        [0.05, 0.5, 0.8, 0.2],
      ],
      audioAnalysisRefs: {
        waveformPyramidId: 'artifact:waveform-pyramid',
      },
      waveformProgress: 100,
    });
  });

  it('finishes batch video import before starting its thumbnail in the background', async () => {
    const ensureFileThumbnail = vi.fn(async () => true);
    const store = createTestStore(undefined, ensureFileThumbnail);
    const file = new File(['video'], 'ipad-video.mov', { type: 'video/quicktime' });
    const slice = vi.spyOn(file, 'slice');
    const mediaFile = {
      id: 'test-import-1',
      name: file.name,
      type: 'video',
      parentId: null,
      createdAt: 1,
      file,
      fileSize: file.size,
      url: 'blob:ipad-video',
      duration: 12,
    } as const;
    importPipelineMocks.processImport.mockResolvedValue({ mediaFile });

    const importedItems = await store.getState().importFiles([file]);

    expect(importedItems).toEqual([mediaFile]);
    expect(store.getState().files[0]?.isImporting).toBe(false);
    expect(importPipelineMocks.processImport).toHaveBeenCalledWith(expect.objectContaining({
      file,
      id: 'test-import-1',
      generateThumbnail: false,
      typeOverride: 'video',
    }));
    expect(slice).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ensureFileThumbnail).toHaveBeenCalledWith('test-import-1'));
  });

  it('repairs a restored media item with a missing source when the same file is imported again', async () => {
    const reloadFile = vi.fn(async () => true);
    const store = createTestStore(reloadFile);
    const file = new File(['android-image'], 'android-photo.jpg', { type: 'image/jpeg' });
    store.setState({
      files: [{
        id: 'media-android',
        name: file.name,
        type: 'image',
        parentId: null,
        createdAt: 1,
        fileSize: file.size,
        duration: 5,
      }],
    });
    importPipelineMocks.processImport.mockResolvedValue({
      mediaFile: {
        id: 'media-android',
        name: file.name,
        type: 'image',
        parentId: null,
        createdAt: 2,
        file,
        fileSize: file.size,
        url: 'blob:android-project-copy',
        projectPath: 'Raw/android-photo.jpg',
        duration: 5,
      },
    });

    const result = await store.getState().importFile(file);

    expect(importPipelineMocks.processImport).toHaveBeenCalledWith(expect.objectContaining({
      file,
      id: 'media-android',
      forceCopyToProject: true,
      typeOverride: 'image',
    }));
    expect(store.getState().files).toHaveLength(1);
    expect(result).toMatchObject({
      id: 'media-android',
      file,
      projectPath: 'Raw/android-photo.jpg',
    });
    expect(reloadFile).toHaveBeenCalledWith('media-android');
  });
});
