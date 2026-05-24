import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { MediaState } from '../../../src/stores/mediaStore/types';
import { createFileImportSlice, type FileImportActions } from '../../../src/stores/mediaStore/slices/fileImportSlice';

const importPipelineMocks = vi.hoisted(() => ({
  nextId: 0,
  processImport: vi.fn(),
}));

vi.mock('../../../src/stores/mediaStore/helpers/importPipeline', () => ({
  generateId: vi.fn(() => `test-import-${++importPipelineMocks.nextId}`),
  processImport: importPipelineMocks.processImport,
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
});
