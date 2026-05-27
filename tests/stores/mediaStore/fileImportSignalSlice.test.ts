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
  generateTimelineWaveformAnalysisForFile: waveformMocks.generateTimelineWaveformAnalysisForFile,
}));

vi.mock('../../../src/services/projectFileService', () => ({
  projectFileService: {
    getProjectHandle: vi.fn(() => null),
  },
}));

type TestState = MediaState & FileImportActions;

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

function createTestStore() {
  return create<TestState>()((set, get) => ({
    ...createInitialMediaState(),
    ...createFileImportSlice(set, get),
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

  it('starts detailed source waveform generation after audio import finalizes', async () => {
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
        includePyramid: false,
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
      waveformProgress: 100,
    });
  });
});
