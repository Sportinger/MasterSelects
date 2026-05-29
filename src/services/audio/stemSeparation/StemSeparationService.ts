import type { SignalMetadata } from '../../../signals';
import { encodeFloat32PcmChunksToWavBlob } from '../../../engine/audio/AudioFileEncoder';
import { useMediaStore, type MediaFile, type MediaFolder } from '../../../stores/mediaStore';
import type { AudioChannelLayout, AudioArtifactRef } from '../audioArtifactTypes';
import type { ClipAudioStemLayer, ClipAudioStemState, MediaFileStemInfo } from '../../../types/audio';
import type { ClipStemSeparationRunnerRequest } from '../../../stores/timeline/types';
import { AudioArtifactStore } from '../AudioArtifactStore';
import { Logger } from '../../logger';
import {
  CLIP_AUDIO_ANALYSIS_DECODER_VERSION,
  prepareClipAudioAnalysisInput,
  SOURCE_AUDIO_ANALYSIS_DECODER_ID,
  type PreparedClipAudioAnalysisInput,
} from '../ClipAudioAnalysisOrchestrator';
import { createCurrentAudioArtifactStore } from '../timelineWaveformPyramidCache';
import {
  DEFAULT_STEM_MODEL_ID,
  requireStemModel,
} from './modelCatalog';
import { STEM_SOURCE_LAYER_ID } from './stemSourceLayer';
import {
  createStemPcmF32Metadata,
  encodeStemPcmF32Payload,
  STEM_PCM_F32_MIME_TYPE,
} from './stemPcm';
import { createStemWaveformPreview } from './stemWaveformPreview';
import { getStemModelManager } from './StemModelManager';
import { StemSeparationWorkerClient, type StemSeparationWorkerClientLike } from './StemSeparationWorkerClient';
import type {
  StemModelCacheStatus,
  StemModelCatalogEntry,
  StemModelFileBuffer,
  StemSeparationInput,
  StemSeparationWorkerStemResult,
} from './types';

const STEM_SEPARATION_DECODER_ID = 'masterselects.stem-separation-worker';
const STEM_SEPARATION_ANALYZER_ID = 'masterselects.stem-separation';
const STEM_SEPARATION_ANALYZER_VERSION = '1.0.0';
const SOURCE_PREPARATION_PROGRESS = 0.08;
const DOWNLOAD_PROGRESS_START = 0.10;
const DOWNLOAD_PROGRESS_END = 0.35;
const LOAD_PROGRESS_END = 0.45;
const SEPARATION_PROGRESS_END = 0.90;
const STORING_PROGRESS = 0.95;
const STEM_MEDIA_PROGRESS = 0.98;
const STEM_MEDIA_ROOT_FOLDER_NAME = 'Stems';

const log = Logger.create('StemSeparationService');

interface StemModelManagerLike {
  getCacheStatus?: (modelId?: string) => Promise<StemModelCacheStatus>;
  ensureModelCached?: (
    modelId?: string,
    options?: {
      signal?: AbortSignal;
      onProgress?: (progress: {
        progress: number;
        fileName: string;
        downloadedBytes: number;
        totalFileBytes: number;
        overallDownloadedBytes: number;
        overallTotalBytes: number;
      }) => void;
    },
  ) => Promise<StemModelCacheStatus>;
  loadModelBuffers: (modelId?: string) => Promise<StemModelFileBuffer[]>;
  clearModelCache?: (modelId?: string) => Promise<void>;
}

export interface StemSeparationServiceOptions {
  modelManager?: StemModelManagerLike;
  artifactStore?: AudioArtifactStore;
  createArtifactStore?: () => AudioArtifactStore;
  workerClient?: StemSeparationWorkerClientLike;
  createWorkerClient?: () => StemSeparationWorkerClientLike;
  prepareInput?: typeof prepareClipAudioAnalysisInput;
  getMediaLibraryStore?: () => StemMediaLibraryStore;
  publishStemFilesToMediaLibrary?: boolean;
  now?: () => number;
}

interface StemMediaLibraryStore {
  folders: MediaFolder[];
  createFolder: (name: string, parentId?: string | null) => MediaFolder;
  importFile: (
    file: File,
    parentId?: string | null,
    options?: { forceCopyToProject?: boolean; projectFileName?: string; stemInfo?: MediaFileStemInfo },
  ) => Promise<unknown>;
}

interface StoredStemLayer {
  layer: ClipAudioStemLayer;
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  duration: number;
}

type StemModelLoadSource =
  | { kind: 'buffers'; buffers: StemModelFileBuffer[] }
  | { kind: 'url'; url: string };

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function mapProgress(value: number, start: number, end: number): number {
  return start + clampProgress(value) * (end - start);
}

function stemLabel(kind: ClipAudioStemLayer['kind']): string {
  if (kind === 'sfx') return 'SFX';
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`;
}

function channelLayoutForCount(channelCount: number): AudioChannelLayout {
  if (channelCount === 1) {
    return { kind: 'mono', channelCount, labels: ['M'] };
  }
  if (channelCount === 2) {
    return { kind: 'stereo', channelCount, labels: ['L', 'R'] };
  }
  return { kind: 'discrete', channelCount };
}

function createStemSeparationAnalyzerVersion(model: StemModelCatalogEntry): string {
  return `${STEM_SEPARATION_ANALYZER_ID}:${STEM_SEPARATION_ANALYZER_VERSION}:${model.modelVersion}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Stem separation was cancelled.', 'AbortError');
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneBufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channelIndex) =>
    new Float32Array(buffer.getChannelData(channelIndex))
  );
}

function createWorkerInput(
  prepared: PreparedClipAudioAnalysisInput,
  modelId: string,
): StemSeparationInput {
  const channels = cloneBufferChannels(prepared.sourceBuffer);
  return {
    modelId,
    mediaFileId: prepared.mediaFileId,
    sourceFingerprint: prepared.sourceFingerprint,
    sampleRate: prepared.sourceBuffer.sampleRate,
    channelCount: prepared.sourceBuffer.numberOfChannels,
    frameCount: prepared.sourceBuffer.length,
    channels,
  };
}

function logicalStemArtifactId(input: {
  mediaFileId: string;
  sourceFingerprint: string;
  modelId: string;
  activeSetId: string;
  stemKind: string;
}): string {
  return [
    'audio',
    'stem-separation',
    input.mediaFileId,
    input.sourceFingerprint,
    input.modelId,
    input.activeSetId,
    input.stemKind,
  ].join(':');
}

function getModelOrderedStemResults(
  model: StemModelCatalogEntry,
  results: readonly StemSeparationWorkerStemResult[],
): StemSeparationWorkerStemResult[] {
  const byKind = new Map(results.map(result => [result.kind, result]));
  const missingKinds = model.outputStemOrder.filter(kind => !byKind.has(kind));
  if (missingKinds.length > 0) {
    throw new Error(`Stem separation did not return expected stems: ${missingKinds.join(', ')}.`);
  }
  return model.outputStemOrder.map(kind => byKind.get(kind)!);
}

function getPrimaryModelUrl(model: StemModelCatalogEntry): string {
  const url = model.files[0]?.url;
  if (!url) {
    throw new Error(`Stem separation model ${model.id} does not define a downloadable model URL.`);
  }
  return url;
}

function createStemManifestMetadata(input: {
  activeSetId: string;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  stem: StemSeparationWorkerStemResult;
  payloadRef: AudioArtifactRef;
  createdAt: number;
  frameCount: number;
  channelCount: number;
  duration: number;
}): SignalMetadata {
  return {
    stemSeparationManifest: {
      schemaVersion: 1,
      activeSetId: input.activeSetId,
      modelId: input.model.id,
      modelVersion: input.model.modelVersion,
      sourceFingerprint: input.prepared.sourceFingerprint,
      sourceMediaFileId: input.prepared.mediaFileId,
      sourceRangeStart: 0,
      sourceRangeEnd: input.prepared.sourceBuffer.duration,
      stemKind: input.stem.kind,
      outputStemOrder: input.model.outputStemOrder,
      payloadArtifactId: input.payloadRef.artifactId,
      payloadEncoding: 'planar-f32',
      sampleRate: input.stem.sampleRate,
      channelCount: input.channelCount,
      frameCount: input.frameCount,
      duration: input.duration,
      normalizationPolicy: 'model-native',
      createdAt: input.createdAt,
    },
    activeSetId: input.activeSetId,
    modelId: input.model.id,
    modelVersion: input.model.modelVersion,
    stemKind: input.stem.kind,
    sourceDecoderId: input.prepared.decoderId,
    sourceDecoderVersion: input.prepared.decoderVersion,
    sourceClipId: input.prepared.metadata.sourceClipId ?? '',
  };
}

function createStemMediaFileInfo(input: {
  activeSetId: string;
  model: StemModelCatalogEntry;
  prepared: PreparedClipAudioAnalysisInput;
  request: ClipStemSeparationRunnerRequest;
  stem: StemSeparationWorkerStemResult;
  createdAt: number;
}): MediaFileStemInfo {
  const sourceClipId = typeof input.prepared.metadata.sourceClipId === 'string'
    ? input.prepared.metadata.sourceClipId
    : undefined;
  const sourceClipName = typeof input.prepared.metadata.sourceClipName === 'string'
    ? input.prepared.metadata.sourceClipName
    : undefined;

  return {
    schemaVersion: 1,
    sourceMediaFileId: input.prepared.mediaFileId,
    sourceFingerprint: input.prepared.sourceFingerprint,
    sourceClipId: sourceClipId ?? input.request.clip.id,
    sourceClipName: sourceClipName ?? input.request.clip.name,
    activeSetId: input.activeSetId,
    modelId: input.model.id,
    modelVersion: input.model.modelVersion,
    kind: input.stem.kind,
    label: stemLabel(input.stem.kind),
    createdAt: input.createdAt,
  };
}

export class StemSeparationService {
  private readonly modelManager: StemModelManagerLike;
  private readonly artifactStore: AudioArtifactStore | null;
  private readonly createArtifactStore: () => AudioArtifactStore;
  private readonly createWorkerClient: () => StemSeparationWorkerClientLike;
  private readonly prepareInput: typeof prepareClipAudioAnalysisInput;
  private readonly getMediaLibraryStore: () => StemMediaLibraryStore;
  private readonly publishStemFilesToMediaLibrary: boolean;
  private readonly now: () => number;
  private workerClient: StemSeparationWorkerClientLike | null;

  constructor(options: StemSeparationServiceOptions = {}) {
    this.modelManager = options.modelManager ?? getStemModelManager();
    this.artifactStore = options.artifactStore ?? null;
    this.createArtifactStore = options.createArtifactStore ?? createCurrentAudioArtifactStore;
    this.workerClient = options.workerClient ?? null;
    this.createWorkerClient = options.createWorkerClient ?? (() => new StemSeparationWorkerClient());
    this.prepareInput = options.prepareInput ?? prepareClipAudioAnalysisInput;
    this.getMediaLibraryStore = options.getMediaLibraryStore ?? (() => useMediaStore.getState() as StemMediaLibraryStore);
    this.publishStemFilesToMediaLibrary = options.publishStemFilesToMediaLibrary ?? true;
    this.now = options.now ?? Date.now;
  }

  async separateClip(request: ClipStemSeparationRunnerRequest): Promise<ClipAudioStemState | null> {
    if (request.options.range) {
      throw new Error('Region-only stem separation is not supported yet.');
    }

    const model = requireStemModel(request.options.modelId ?? DEFAULT_STEM_MODEL_ID);
    request.updateProgress({
      phase: 'preparing',
      progress: 0,
      message: 'Preparing stem separation.',
    });

    const modelSource = await this.prepareModelSource(model, request);
    const loadResult = await this.loadWorkerModelWithRecovery(model, modelSource, request);
    request.updateProgress({
      phase: 'loading-model',
      backend: loadResult.backend,
      progress: LOAD_PROGRESS_END,
      message: `Stem model loaded with ${loadResult.backend.toUpperCase()}.`,
    });

    request.updateProgress({
      phase: 'preparing',
      backend: loadResult.backend,
      progress: LOAD_PROGRESS_END,
      message: 'Preparing source audio for stem separation.',
    });

    const prepared = await this.prepareInput({
      clip: request.clip,
      needsProcessed: false,
      signal: request.signal,
    });
    throwIfAborted(request.signal);
    if (!prepared) {
      throw new Error('Clip has no source audio available for stem separation.');
    }

    request.updateProgress({
      phase: 'preparing',
      backend: loadResult.backend,
      progress: Math.max(LOAD_PROGRESS_END, SOURCE_PREPARATION_PROGRESS),
      message: 'Source audio ready for stem separation.',
    });

    const workerInput = createWorkerInput(prepared, model.id);
    const worker = this.getWorkerClient();
    let stems: StemSeparationWorkerStemResult[];
    try {
      stems = await worker.separate(request.jobId, workerInput, {
        signal: request.signal,
        onProgress: (progress) => {
          request.updateProgress({
            phase: 'separating',
            progress: mapProgress(progress.progress, LOAD_PROGRESS_END, SEPARATION_PROGRESS_END),
            message: progress.message,
          });
        },
      });
    } finally {
      this.disposeWorkerClient();
    }
    throwIfAborted(request.signal);

    request.updateProgress({
      phase: 'storing',
      progress: STORING_PROGRESS,
      message: 'Storing separated stems.',
    });

    const orderedStems = getModelOrderedStemResults(model, stems);
    const storedLayers = await this.storeStemResults({
      request,
      model,
      prepared,
      stems: orderedStems,
    });

    if (storedLayers.length === 0) {
      return null;
    }

    const firstLayer = storedLayers[0];
    return {
      activeSetId: `stem-set:${request.jobId}`,
      modelId: model.id,
      modelVersion: model.modelVersion,
      createdAt: this.now(),
      sourceFingerprint: prepared.sourceFingerprint,
      range: {
        start: 0,
        end: prepared.sourceBuffer.duration,
      },
      sampleRate: firstLayer.sampleRate,
      channelCount: firstLayer.channelCount,
      stems: storedLayers.map(stored => stored.layer),
      soloStemId: STEM_SOURCE_LAYER_ID,
      sourceGainDb: 0,
      mixMode: 'original',
    };
  }

  dispose(): void {
    this.disposeWorkerClient();
  }

  private getWorkerClient(): StemSeparationWorkerClientLike {
    this.workerClient ??= this.createWorkerClient();
    return this.workerClient;
  }

  private disposeWorkerClient(): void {
    this.workerClient?.dispose();
    this.workerClient = null;
  }

  private getArtifactStore(): AudioArtifactStore {
    return this.artifactStore ?? this.createArtifactStore();
  }

  private async prepareModelSource(
    model: StemModelCatalogEntry,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<StemModelLoadSource> {
    request.updateProgress({
      phase: 'downloading-model',
      progress: DOWNLOAD_PROGRESS_START,
      message: `Checking ${model.label} cache.`,
    });

    let cached = !this.modelManager.getCacheStatus;
    if (this.modelManager.getCacheStatus) {
      try {
        cached = (await this.modelManager.getCacheStatus(model.id)).cached;
      } catch (error) {
        log.warn('Stem model cache status could not be read; loading model directly in the worker', {
          modelId: model.id,
          error: getErrorMessage(error),
        });
      }
    }

    throwIfAborted(request.signal);
    if (cached) {
      request.updateProgress({
        phase: 'loading-model',
        progress: DOWNLOAD_PROGRESS_END,
        message: 'Loading cached stem separation model.',
      });
      return this.loadCachedModelSource(model, request);
    }

    if (this.modelManager.ensureModelCached) {
      try {
        request.updateProgress({
          phase: 'downloading-model',
          progress: DOWNLOAD_PROGRESS_START,
          message: `Downloading ${model.label}.`,
        });
        await this.modelManager.ensureModelCached(model.id, {
          signal: request.signal,
          onProgress: (progress) => {
            request.updateProgress({
              phase: 'downloading-model',
              progress: mapProgress(progress.progress, DOWNLOAD_PROGRESS_START, DOWNLOAD_PROGRESS_END),
              message: `Downloading ${progress.fileName}.`,
            });
          },
        });
        throwIfAborted(request.signal);
        request.updateProgress({
          phase: 'loading-model',
          progress: DOWNLOAD_PROGRESS_END,
          message: 'Loading cached stem separation model.',
        });
        return this.loadCachedModelSource(model, request);
      } catch (error) {
        throwIfAborted(request.signal);
        log.warn('Stem model could not be cached; loading model directly in the worker', {
          modelId: model.id,
          error: getErrorMessage(error),
        });
      }
    }

    request.updateProgress({
      phase: 'loading-model',
      progress: DOWNLOAD_PROGRESS_END,
      message: 'Loading stem model directly in the worker.',
    });
    return { kind: 'url', url: getPrimaryModelUrl(model) };
  }

  private async loadCachedModelSource(
    model: StemModelCatalogEntry,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<StemModelLoadSource> {
    try {
      return {
        kind: 'buffers',
        buffers: await this.modelManager.loadModelBuffers(model.id),
      };
    } catch (error) {
      throwIfAborted(request.signal);
      log.warn('Cached stem model could not be read; loading model directly in the worker', {
        modelId: model.id,
        error: getErrorMessage(error),
      });
      await this.modelManager.clearModelCache?.(model.id);
      request.updateProgress({
        phase: 'loading-model',
        progress: DOWNLOAD_PROGRESS_END,
        message: 'Cached stem model could not be read. Loading directly in the worker.',
      });
      return { kind: 'url', url: getPrimaryModelUrl(model) };
    }
  }

  private async loadWorkerModelWithRecovery(
    model: StemModelCatalogEntry,
    source: StemModelLoadSource,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<Awaited<ReturnType<StemSeparationWorkerClientLike['loadModel']>>> {
    try {
      return await this.loadWorkerModelSource(model, source, request);
    } catch (error) {
      throwIfAborted(request.signal);
      log.warn('Stem worker could not load model; retrying with a fresh worker and direct model URL', {
        modelId: model.id,
        error: getErrorMessage(error),
      });
      request.updateProgress({
        phase: 'loading-model',
        progress: DOWNLOAD_PROGRESS_END,
        message: 'Stem model loader failed. Retrying with a fresh worker.',
      });

      this.disposeWorkerClient();
      return this.loadWorkerModelSource(model, { kind: 'url', url: getPrimaryModelUrl(model) }, request);
    }
  }

  private async loadWorkerModelSource(
    model: StemModelCatalogEntry,
    source: StemModelLoadSource,
    request: ClipStemSeparationRunnerRequest,
  ): Promise<Awaited<ReturnType<StemSeparationWorkerClientLike['loadModel']>>> {
    const worker = this.getWorkerClient();
    const onProgress = (progress: { progress: number; message?: string }) => {
      request.updateProgress({
        phase: 'loading-model',
        progress: mapProgress(progress.progress, DOWNLOAD_PROGRESS_END, LOAD_PROGRESS_END),
        message: progress.message,
      });
    };
    return source.kind === 'url'
      ? worker.loadModelFromUrl(model, source.url, { signal: request.signal, onProgress, backendPreference: 'wasm' })
      : worker.loadModel(model, source.buffers, { signal: request.signal, onProgress, backendPreference: 'wasm' });
  }

  private async storeStemResults(input: {
    request: ClipStemSeparationRunnerRequest;
    model: StemModelCatalogEntry;
    prepared: PreparedClipAudioAnalysisInput;
    stems: readonly StemSeparationWorkerStemResult[];
  }): Promise<StoredStemLayer[]> {
    const store = this.getArtifactStore();
    const activeSetId = `stem-set:${input.request.jobId}`;
    const createdAt = this.now();
    const createdAtIso = new Date(createdAt).toISOString();
    const analyzerVersion = createStemSeparationAnalyzerVersion(input.model);
    const stored: StoredStemLayer[] = [];

    for (const stem of input.stems) {
      throwIfAborted(input.request.signal);
      const frameCount = stem.channels[0]?.length ?? 0;
      const channelCount = stem.channels.length;
      const duration = frameCount / stem.sampleRate;
      const pcmMetadata = createStemPcmF32Metadata({
        channels: stem.channels,
        sampleRate: stem.sampleRate,
        normalizationPolicy: 'model-native',
      });
      const payloadMetadata: SignalMetadata = {
        ...pcmMetadata,
        activeSetId,
        modelId: input.model.id,
        modelVersion: input.model.modelVersion,
        stemKind: stem.kind,
        sourceFingerprint: input.prepared.sourceFingerprint,
      };
      const payloadRef = await store.putPayload(encodeStemPcmF32Payload({
        channels: stem.channels,
        sampleRate: stem.sampleRate,
        normalizationPolicy: 'model-native',
      }), {
        mediaFileId: input.prepared.mediaFileId,
        kind: 'stem-separation',
        sourceFingerprint: input.prepared.sourceFingerprint,
        mimeType: STEM_PCM_F32_MIME_TYPE,
        encoding: 'raw',
        analyzerVersion,
        createdAt: createdAtIso,
        sourceRefs: [
          `clip:${input.request.clip.id}`,
          `stem-set:${activeSetId}`,
          `stem:${stem.kind}`,
        ],
        metadata: payloadMetadata,
      });
      const artifactId = logicalStemArtifactId({
        mediaFileId: input.prepared.mediaFileId,
        sourceFingerprint: input.prepared.sourceFingerprint,
        modelId: input.model.id,
        activeSetId,
        stemKind: stem.kind,
      });
      const artifact = await store.putAnalysisArtifact({
        id: artifactId,
        kind: 'stem-separation',
        mediaFileId: input.prepared.mediaFileId,
        sourceFingerprint: input.prepared.sourceFingerprint,
        decoderId: STEM_SEPARATION_DECODER_ID,
        decoderVersion: `${SOURCE_AUDIO_ANALYSIS_DECODER_ID}:${CLIP_AUDIO_ANALYSIS_DECODER_VERSION}`,
        analyzerVersion,
        sampleRate: stem.sampleRate,
        channelLayout: channelLayoutForCount(channelCount),
        duration,
        payloadRefs: [payloadRef],
        createdAt,
        stale: false,
        metadata: createStemManifestMetadata({
          activeSetId,
          model: input.model,
          prepared: input.prepared,
          stem,
          payloadRef,
          createdAt,
          frameCount,
          channelCount,
          duration,
        }),
      });

      stored.push({
        sampleRate: stem.sampleRate,
        channelCount,
        frameCount,
        duration,
        layer: {
          id: `stem-${input.request.jobId}-${stem.kind}`,
          kind: stem.kind,
          label: stemLabel(stem.kind),
          analysisArtifactId: artifact.artifact.id,
          manifestArtifactId: artifact.artifact.manifestRef.artifactId,
          payloadRef,
          waveform: createStemWaveformPreview(stem.channels),
          enabled: true,
          gainDb: 0,
          phaseAligned: true,
          modelId: input.model.id,
          sourceFingerprint: input.prepared.sourceFingerprint,
        },
      });
    }

    if (this.publishStemFilesToMediaLibrary) {
      input.request.updateProgress({
        phase: 'storing',
        progress: STEM_MEDIA_PROGRESS,
        message: 'Adding stem WAV files to the media library.',
      });

      try {
        const publishedIds = await this.publishStemWavFilesToMediaLibrary({
          request: input.request,
          model: input.model,
          prepared: input.prepared,
          stems: input.stems,
          activeSetId,
          createdAt,
        });

        for (const layer of stored) {
          const mediaFileId = publishedIds.get(layer.layer.kind);
          if (mediaFileId) {
            layer.layer.mediaFileId = mediaFileId;
          }
        }
      } catch (error) {
        log.warn('Failed to add stem WAV files to the media library', { error });
      }
    }

    return stored;
  }

  private async publishStemWavFilesToMediaLibrary(input: {
    request: ClipStemSeparationRunnerRequest;
    model: StemModelCatalogEntry;
    prepared: PreparedClipAudioAnalysisInput;
    stems: readonly StemSeparationWorkerStemResult[];
    activeSetId: string;
    createdAt: number;
  }): Promise<Map<ClipAudioStemLayer['kind'], string>> {
    if (typeof File === 'undefined') {
      return new Map();
    }

    const sourceFolderName = createStemMediaFolderName(input.prepared, input.request);
    const rootFolderId = getOrCreateMediaFolder(this.getMediaLibraryStore, STEM_MEDIA_ROOT_FOLDER_NAME, null);
    const sourceFolderId = getOrCreateMediaFolder(this.getMediaLibraryStore, sourceFolderName, rootFolderId);
    const importedIds = new Map<ClipAudioStemLayer['kind'], string>();

    for (const stem of input.stems) {
      throwIfAborted(input.request.signal);
      const stemFileName = createStemFileName(sourceFolderName, stem.kind);
      const wavBlob = encodeFloat32PcmChunksToWavBlob({
        sampleRate: stem.sampleRate,
        channelCount: stem.channels.length,
        frameCount: stem.channels[0]?.length ?? 0,
        chunks: [{
          channels: stem.channels,
          frameCount: stem.channels[0]?.length ?? 0,
        }],
      });
      const file = new File([wavBlob], stemFileName, {
        type: 'audio/wav',
        lastModified: input.createdAt,
      });
      const imported = await this.getMediaLibraryStore().importFile(file, sourceFolderId, {
        forceCopyToProject: true,
        projectFileName: `${STEM_MEDIA_ROOT_FOLDER_NAME}/${sourceFolderName}/${stemFileName}`,
        stemInfo: createStemMediaFileInfo({
          activeSetId: input.activeSetId,
          model: input.model,
          prepared: input.prepared,
          request: input.request,
          stem,
          createdAt: input.createdAt,
        }),
      });
      if (isImportedAudioMediaFile(imported)) {
        importedIds.set(stem.kind, imported.id);
      }
    }

    return importedIds;
  }
}

function getOrCreateMediaFolder(
  getStore: () => StemMediaLibraryStore,
  name: string,
  parentId: string | null,
): string {
  const store = getStore();
  const existing = store.folders.find(folder => folder.name === name && folder.parentId === parentId);
  return existing?.id ?? store.createFolder(name, parentId).id;
}

function isImportedAudioMediaFile(value: unknown): value is MediaFile {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<MediaFile>).type === 'audio' &&
    typeof (value as Partial<MediaFile>).id === 'string',
  );
}

function sanitizeStemPathPart(value: string, fallback: string): string {
  const sanitized = Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized.slice(0, 120) : fallback;
}

function stripFileExtension(value: string): string {
  const lastDot = value.lastIndexOf('.');
  return lastDot > 0 ? value.slice(0, lastDot) : value;
}

function createStemMediaFolderName(
  prepared: PreparedClipAudioAnalysisInput,
  request: ClipStemSeparationRunnerRequest,
): string {
  const metadataName = typeof prepared.metadata.sourceClipName === 'string'
    ? prepared.metadata.sourceClipName
    : '';
  const rawName = metadataName
    || request.requestedClip.name
    || request.clip.name
    || request.requestedClip.file?.name
    || request.clip.file?.name
    || 'Source Clip';
  return sanitizeStemPathPart(stripFileExtension(rawName), 'Source Clip');
}

function createStemFileName(sourceFolderName: string, stemKind: ClipAudioStemLayer['kind']): string {
  return sanitizeStemPathPart(`${sourceFolderName} - ${stemLabel(stemKind)}.wav`, `${stemLabel(stemKind)}.wav`);
}


let instance: StemSeparationService | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    instance?.dispose();
    instance = null;
  });
}

export function getStemSeparationService(): StemSeparationService {
  instance ??= new StemSeparationService();
  return instance;
}
