import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, blobToArrayBuffer } from '../../../src/artifacts';
import { AudioArtifactStore } from '../../../src/services/audio/AudioArtifactStore';
import {
  decodeStemPcmF32Payload,
  StemSeparationService,
  STEM_PCM_F32_MIME_TYPE,
  type StemSeparationWorkerClientLike,
  type StemSeparationWorkerStemResult,
} from '../../../src/services/audio/stemSeparation';
import type { PreparedClipAudioAnalysisInput } from '../../../src/services/audio/ClipAudioAnalysisOrchestrator';
import type { ClipStemSeparationRunnerRequest } from '../../../src/stores/timeline/types';
import { createMockClip } from '../../helpers/mockData';

const FIXED_TIME_ISO = '2026-05-28T12:00:00.000Z';
const FIXED_TIME_MS = Date.parse(FIXED_TIME_ISO);

function createMockAudioBuffer(channels: number[][], sampleRate = 8): AudioBuffer {
  const channelData = channels.map(samples => Float32Array.from(samples));
  const length = channelData[0]?.length ?? 0;

  return {
    numberOfChannels: channelData.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData: vi.fn((channelIndex: number) => channelData[channelIndex]),
  } as unknown as AudioBuffer;
}

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(
    new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME_ISO),
  );
}

function createPreparedInput(): PreparedClipAudioAnalysisInput {
  const sourceBuffer = createMockAudioBuffer([
    [1, 2, 3, 4],
    [4, 3, 2, 1],
  ], 4);

  return {
    mediaFileId: 'media-a',
    sourceFingerprint: 'sha256:source-a',
    sourceBuffer,
    analysisBuffer: sourceBuffer,
    processed: false,
    decoderId: 'test-decoder',
    decoderVersion: '1.0.0',
    metadata: {
      sourceClipId: 'clip-a',
      sourceClipName: 'Dialog',
      sourceInPoint: 0,
      sourceOutPoint: 1,
      timelineDuration: 1,
      timelineSpeed: 1,
      reversed: false,
      processed: false,
    },
  };
}

function createWorkerStems(): StemSeparationWorkerStemResult[] {
  return [
    {
      kind: 'drums',
      sampleRate: 4,
      channels: [Float32Array.from([0.125, 0.25]), Float32Array.from([0.25, 0.125])],
    },
    {
      kind: 'bass',
      sampleRate: 4,
      channels: [Float32Array.from([0.3, 0.4]), Float32Array.from([0.4, 0.3])],
    },
    {
      kind: 'other',
      sampleRate: 4,
      channels: [Float32Array.from([0.5, 0.6]), Float32Array.from([0.6, 0.5])],
    },
    {
      kind: 'vocals',
      sampleRate: 4,
      channels: [Float32Array.from([0.7, 0.8]), Float32Array.from([0.8, 0.7])],
    },
  ];
}

function createModelManager() {
  const cachedStatus = {
    modelId: 'demucs-htdemucs-web',
    modelVersion: 'test-model-v1',
    cached: true,
    expectedBytes: 5,
    actualBytes: 5,
    files: [],
  };
  return {
    getCacheStatus: vi.fn(async () => cachedStatus),
    ensureModelCached: vi.fn(async (_modelId?: string, options?: { onProgress?: (progress: {
      progress: number;
      fileName: string;
      downloadedBytes: number;
      totalFileBytes: number;
      overallDownloadedBytes: number;
      overallTotalBytes: number;
    }) => void }) => {
      options?.onProgress?.({
        progress: 1,
        fileName: 'htdemucs_embedded.onnx',
        downloadedBytes: 5,
        totalFileBytes: 5,
        overallDownloadedBytes: 5,
        overallTotalBytes: 5,
      });
      return cachedStatus;
    }),
    loadModelBuffers: vi.fn(async () => [{
      name: 'htdemucs_embedded.onnx',
      buffer: new Uint8Array([1, 2, 3, 4, 5]).buffer,
    }]),
    clearModelCache: vi.fn(async () => undefined),
  };
}

function createWorkerClient(stems = createWorkerStems()): StemSeparationWorkerClientLike {
  return {
    loadModel: vi.fn(async (model) => ({ modelId: model.id, backend: 'wasm' })),
    loadModelFromUrl: vi.fn(async (model) => ({ modelId: model.id, backend: 'wasm' })),
    separate: vi.fn(async (_jobId, _input, options) => {
      options?.onProgress?.({
        phase: 'separating',
        progress: 0.5,
        message: 'Separated test segment',
      });
      return stems;
    }),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
}

function createRequest(updateProgress = vi.fn()): ClipStemSeparationRunnerRequest {
  const clip = createMockClip({
    id: 'clip-a',
    name: 'Dialog',
    source: { type: 'audio', naturalDuration: 1 },
    duration: 1,
    inPoint: 0,
    outPoint: 1,
  });

  return {
    jobId: 'stem-job-a',
    clip,
    requestedClip: clip,
    options: {},
    signal: new AbortController().signal,
    updateProgress,
  };
}

describe('StemSeparationService', () => {
  it('runs cached model separation, stores PCM stem artifacts, and returns clip stem state', async () => {
    const store = createStore();
    const modelManager = createModelManager();
    const workerClient = createWorkerClient();
    const prepared = createPreparedInput();
    const updateProgress = vi.fn();
    const service = new StemSeparationService({
      artifactStore: store,
      modelManager,
      workerClient,
      prepareInput: vi.fn(async () => prepared),
      publishStemFilesToMediaLibrary: false,
      now: () => FIXED_TIME_MS,
    });

    const result = await service.separateClip(createRequest(updateProgress));

    expect(modelManager.getCacheStatus).toHaveBeenCalledWith('demucs-htdemucs-web');
    expect(modelManager.loadModelBuffers).toHaveBeenCalledWith('demucs-htdemucs-web');
    expect(workerClient.loadModel).toHaveBeenCalledOnce();
    expect(workerClient.separate).toHaveBeenCalledWith(
      'stem-job-a',
      expect.objectContaining({
        mediaFileId: 'media-a',
        sourceFingerprint: 'sha256:source-a',
        sampleRate: 4,
        channelCount: 2,
        frameCount: 4,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(result).toMatchObject({
      activeSetId: 'stem-set:stem-job-a',
      modelId: 'demucs-htdemucs-web',
      sourceFingerprint: 'sha256:source-a',
      sampleRate: 4,
      channelCount: 2,
      mixMode: 'stems',
      stems: [
        { id: 'stem-stem-job-a-drums', kind: 'drums', enabled: true, gainDb: 0 },
        { id: 'stem-stem-job-a-bass', kind: 'bass', enabled: true, gainDb: 0 },
        { id: 'stem-stem-job-a-other', kind: 'other', enabled: true, gainDb: 0 },
        { id: 'stem-stem-job-a-vocals', kind: 'vocals', enabled: true, gainDb: 0 },
      ],
    });
    expect(updateProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'storing' }));

    const drums = result?.stems[0];
    expect(drums?.payloadRef.mimeType).toBe(STEM_PCM_F32_MIME_TYPE);
    expect(drums?.waveform).toEqual([1, 1]);
    const payload = drums ? await store.getPayload(drums.payloadRef.artifactId) : null;
    expect(payload).toBeTruthy();
    const decoded = decodeStemPcmF32Payload(await blobToArrayBuffer(payload!), drums?.payloadRef.metadata);
    expect(decoded.sampleRate).toBe(4);
    expect(decoded.channelCount).toBe(2);
    expect(Array.from(decoded.channels[0])).toEqual([0.125, 0.25]);

    const manifest = drums ? await store.getAnalysisArtifact(drums.manifestArtifactId) : null;
    expect(manifest).toMatchObject({
      kind: 'stem-separation',
      mediaFileId: 'media-a',
      sourceFingerprint: 'sha256:source-a',
      payloadRefs: [expect.objectContaining({ artifactId: drums?.payloadRef.artifactId })],
      metadata: {
        stemKind: 'drums',
        modelId: 'demucs-htdemucs-web',
      },
    });
  });

  it('publishes WAV stem files into Stems/source media folders', async () => {
    const folders: Array<{ id: string; name: string; parentId: string | null; createdAt: number; isExpanded: boolean }> = [];
    const imported: Array<{ file: File; parentId: string | null | undefined; projectFileName?: string }> = [];
    const importFile = vi.fn(async (file: File, parentId?: string | null, options?: { projectFileName?: string }) => {
      imported.push({ file, parentId, projectFileName: options?.projectFileName });
      return {
        id: `media-${imported.length}`,
        name: file.name,
        type: 'audio',
        parentId: parentId ?? null,
        createdAt: FIXED_TIME_MS,
        file,
        url: 'blob:test',
        fileSize: file.size,
      };
    });
    const service = new StemSeparationService({
      artifactStore: createStore(),
      modelManager: createModelManager(),
      workerClient: createWorkerClient(),
      prepareInput: vi.fn(async () => createPreparedInput()),
      getMediaLibraryStore: () => ({
        folders,
        createFolder: (name: string, parentId: string | null = null) => {
          const folder = {
            id: `folder-${folders.length + 1}`,
            name,
            parentId,
            createdAt: FIXED_TIME_MS,
            isExpanded: true,
          };
          folders.push(folder);
          return folder;
        },
        importFile,
      }),
      now: () => FIXED_TIME_MS,
    });

    const result = await service.separateClip(createRequest());

    expect(folders.map(folder => ({ name: folder.name, parentId: folder.parentId }))).toEqual([
      { name: 'Stems', parentId: null },
      { name: 'Dialog', parentId: 'folder-1' },
    ]);
    expect(imported.map(item => item.file.name)).toEqual([
      'Dialog - Drums.wav',
      'Dialog - Bass.wav',
      'Dialog - Other.wav',
      'Dialog - Vocals.wav',
    ]);
    expect(imported[0]?.projectFileName).toBe('Stems/Dialog/Dialog - Drums.wav');
    expect(imported.every(item => item.parentId === 'folder-2')).toBe(true);
    expect(result?.stems.map(stem => stem.mediaFileId)).toEqual(['media-1', 'media-2', 'media-3', 'media-4']);
  });

  it('loads the model by URL in the worker when cached model buffers cannot be read', async () => {
    const store = createStore();
    const modelManager = createModelManager();
    modelManager.loadModelBuffers
      .mockRejectedValueOnce(new DOMException('The requested file could not be read.', 'NotReadableError'));
    const workerClient = createWorkerClient();
    const updateProgress = vi.fn();
    const service = new StemSeparationService({
      artifactStore: store,
      modelManager,
      workerClient,
      prepareInput: vi.fn(async () => createPreparedInput()),
      publishStemFilesToMediaLibrary: false,
      now: () => FIXED_TIME_MS,
    });

    const result = await service.separateClip(createRequest(updateProgress));

    expect(result?.stems).toHaveLength(4);
    expect(modelManager.loadModelBuffers).toHaveBeenCalledTimes(1);
    expect(modelManager.clearModelCache).toHaveBeenCalledWith('demucs-htdemucs-web');
    expect(updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'loading-model',
      message: 'Cached stem model could not be read. Loading directly in the worker.',
    }));
    expect(workerClient.loadModel).not.toHaveBeenCalled();
    expect(workerClient.loadModelFromUrl).toHaveBeenCalledOnce();
  });

  it('downloads and persists the model when it is not cached before loading the worker', async () => {
    const modelManager = createModelManager();
    modelManager.getCacheStatus.mockResolvedValueOnce({
      modelId: 'demucs-htdemucs-web',
      modelVersion: 'test-model-v1',
      cached: false,
      expectedBytes: 5,
      actualBytes: 0,
      files: [],
    });
    const workerClient = createWorkerClient();
    const updateProgress = vi.fn();
    const service = new StemSeparationService({
      artifactStore: createStore(),
      modelManager,
      workerClient,
      prepareInput: vi.fn(async () => createPreparedInput()),
      publishStemFilesToMediaLibrary: false,
      now: () => FIXED_TIME_MS,
    });

    const result = await service.separateClip(createRequest(updateProgress));

    expect(result?.stems).toHaveLength(4);
    expect(modelManager.ensureModelCached).toHaveBeenCalledWith(
      'demucs-htdemucs-web',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(modelManager.loadModelBuffers).toHaveBeenCalledWith('demucs-htdemucs-web');
    expect(workerClient.loadModel).toHaveBeenCalledOnce();
    expect(workerClient.loadModelFromUrl).not.toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading-model',
      message: 'Downloading htdemucs_embedded.onnx.',
    }));
  });

  it('loads the model by URL in the worker when cache status cannot be read', async () => {
    const modelManager: ReturnType<typeof createModelManager> & { ensureModelCached?: undefined } = createModelManager();
    modelManager.ensureModelCached = undefined;
    modelManager.getCacheStatus.mockRejectedValueOnce(new Error('Array buffer allocation failed'));
    const workerClient = createWorkerClient();
    const updateProgress = vi.fn();
    const service = new StemSeparationService({
      artifactStore: createStore(),
      modelManager,
      workerClient,
      prepareInput: vi.fn(async () => createPreparedInput()),
      publishStemFilesToMediaLibrary: false,
      now: () => FIXED_TIME_MS,
    });

    const result = await service.separateClip(createRequest(updateProgress));

    expect(result?.stems).toHaveLength(4);
    expect(modelManager.loadModelBuffers).not.toHaveBeenCalled();
    expect(workerClient.loadModel).not.toHaveBeenCalled();
    expect(workerClient.loadModelFromUrl).toHaveBeenCalledOnce();
    expect(updateProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'loading-model',
      message: 'Loading stem model directly in the worker.',
    }));
  });

  it('rejects region-only separation until source-range rendering is wired', async () => {
    const service = new StemSeparationService({
      artifactStore: createStore(),
      modelManager: createModelManager(),
      workerClient: createWorkerClient(),
      prepareInput: vi.fn(async () => createPreparedInput()),
      publishStemFilesToMediaLibrary: false,
      now: () => FIXED_TIME_MS,
    });
    const request = createRequest();
    request.options = { range: { start: 0, end: 0.5 } };

    await expect(service.separateClip(request)).rejects.toThrow('Region-only stem separation is not supported yet.');
  });

  it('fails clearly when the worker omits expected production stems', async () => {
    const service = new StemSeparationService({
      artifactStore: createStore(),
      modelManager: createModelManager(),
      workerClient: createWorkerClient([
        {
          kind: 'vocals',
          sampleRate: 4,
          channels: [Float32Array.from([1, 1]), Float32Array.from([1, 1])],
        },
      ]),
      prepareInput: vi.fn(async () => createPreparedInput()),
      publishStemFilesToMediaLibrary: false,
      now: () => FIXED_TIME_MS,
    });

    await expect(service.separateClip(createRequest())).rejects.toThrow(
      'Stem separation did not return expected stems: drums, bass, other.',
    );
  });
});
