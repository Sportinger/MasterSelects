import type { ClipCustomNodeDefinition, ClipCustomNodeParamValue } from '../../types/nodeGraph';
import type { LayerSource } from '../../types/layers';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip } from '../../types/timeline';
import { Logger } from '../logger';
import { getCanvasVersion, markDynamicCanvasUpdated } from '../canvasVersion';
import { buildClipNodeGraph } from './clipGraphProjection';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';
import type { RenderResourceDescriptor } from '../timeline/runtimeCoordinatorTypes';
import type { RuntimeProviderDemand } from '../../timeline';
import { createRenderResourceDescriptorFromDemand } from '../timeline/runtimeProviderDemandBridge';
import {
  createRuntimeAudioContext,
  createRuntimeAudioOptionsSignature,
  createRuntimeClipAudioSignature,
  resolveRuntimeAudioInput,
  type AINodeRuntimeAudioOptions,
} from './aiNodeRuntimeAudioContext';
import {
  createConnectedNodeInputs,
  createRuntimeClipMetadata,
  createRuntimeMetadata,
  createRuntimeSourceMetadata,
  createRuntimeTextSignal,
  createSerializableGraph,
  type AINodeRuntimeInputValue,
} from './aiNodeRuntimeGraphSignals';
import {
  applyAINodeSandboxTextResult,
  createAINodeSandboxNodeRequest,
} from './aiNodeRuntimeGeneratedNode';
import {
  disposeAINodeSandbox,
  runAINodeSandbox,
} from './aiNodeSandboxClient';
import type {
  AINodeSandboxCode,
  AINodeSandboxNodeRequest,
} from './aiNodeSandboxProtocol';
import {
  getConnectedRunnableCustomNodes,
  getNodeProcessPixelBudget,
  isPixelSortNode,
} from './aiNodeRuntimeRunnableNodes';

export { sortPixelsTexture } from './aiNodeRuntimeRunnableNodes';

const log = Logger.create('AINodeRuntime');

const AI_NODE_RUNTIME_CACHE_ENTRY_LIMIT = 24;
const AI_NODE_RUNTIME_CACHE_BYTE_LIMIT = 96 * 1024 * 1024;

export interface AINodeRuntimeTexture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
  text?: string | Partial<TextClipProperties>;
}

interface RuntimeCacheEntry {
  cacheKey: string;
  clipId: string;
  canvas: HTMLCanvasElement;
  sourceCanvas: HTMLCanvasElement;
  resourceIds: readonly [string, string];
  byteSize: number;
  lastSignature?: string;
  pendingSignature?: string;
  disabledCodeSignature?: string;
  queuedWork?: AINodeRuntimeWork;
}

type AINodeParamResolver = (nodeId: string) => Record<string, ClipCustomNodeParamValue>;

interface AINodeRuntimeWork {
  signature: string;
  codeSignature: string;
  codes: AINodeSandboxCode[];
  nodes: AINodeSandboxNodeRequest[];
  texture: AINodeRuntimeTexture;
  clip: TimelineClip;
  source: LayerSource;
  layerId: string;
}

const runtimeCache = new Map<string, RuntimeCacheEntry>();
const pendingRuntimeJobs = new Set<Promise<void>>();
let runtimeCacheBytes = 0;

export function hasRunnableAINodes(clip: TimelineClip): boolean {
  return getConnectedRunnableCustomNodes(clip).length > 0;
}

function getCanvasSourceDimensions(source: LayerSource): { width: number; height: number } | null {
  const image = source.imageElement;
  if (image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const canvas = source.textCanvas;
  if (canvas) {
    return canvas.width > 0 && canvas.height > 0 ? { width: canvas.width, height: canvas.height } : null;
  }

  const frame = source.videoFrame ?? source.webCodecsPlayer?.getCurrentFrame?.();
  if (frame) {
    const width = frame.displayWidth || frame.codedWidth;
    const height = frame.displayHeight || frame.codedHeight;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  const video = source.videoElement;
  if (video) {
    const width = video.videoWidth || video.clientWidth || video.width;
    const height = video.videoHeight || video.clientHeight || video.height;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

function getCanvasSource(source: LayerSource): CanvasImageSource | null {
  if (source.imageElement) return source.imageElement;
  if (source.textCanvas) return source.textCanvas;

  const frame = source.videoFrame ?? source.webCodecsPlayer?.getCurrentFrame?.();
  if (frame) return frame;

  if (source.videoElement && source.videoElement.readyState >= 2) {
    return source.videoElement;
  }

  return null;
}

function getProcessSize(width: number, height: number, maxPixels: number): { width: number; height: number } {
  const pixels = width * height;
  if (pixels <= maxPixels) {
    return { width, height };
  }

  const scale = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getCanvasByteSize(width: number, height: number): number {
  return Math.max(0, Math.round(width) * Math.round(height) * 4);
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function getAINodeRuntimeCacheResourceIds(key: string): readonly [string, string] {
  const hash = hashString(key);
  return [
    `timeline:ai-node-runtime:${hash}:source-canvas`,
    `timeline:ai-node-runtime:${hash}:output-canvas`,
  ];
}

function getAINodeRuntimeOwner(clip: TimelineClip, source: LayerSource): RuntimeProviderDemand['owner'] {
  return removeUndefinedValues({
    ownerId: `timeline:ai-node-runtime:${clip.id}`,
    ownerType: 'clip' as const,
    clipId: clip.id,
    trackId: clip.trackId,
    compositionId: clip.compositionId,
    mediaFileId: source.mediaFileId ?? clip.source?.mediaFileId ?? clip.mediaFileId,
  });
}

function createAINodeRuntimeCanvasResource(params: {
  id: string;
  imageId: string;
  label: string;
  clip: TimelineClip;
  source: LayerSource;
  layerId: string;
  width: number;
  height: number;
}): RenderResourceDescriptor {
  const owner = getAINodeRuntimeOwner(params.clip, params.source);
  const demand: RuntimeProviderDemand = {
    id: params.id,
    facetId: `${params.id}:facet`,
    resourceKind: 'image-canvas',
    policyId: 'interactive',
    leasePolicy: 'lease-visible',
    owner,
    source: removeUndefinedValues({
      sourceId: params.source.runtimeSourceId ?? params.source.mediaFileId ?? params.clip.mediaFileId,
      mediaFileId: params.source.mediaFileId ?? params.clip.mediaFileId,
      clipId: params.clip.id,
      trackId: params.clip.trackId,
      compositionId: owner.compositionId,
      projectPath: params.source.filePath,
      previewPath: params.source.previewPath,
    }),
    dimensions: {
      width: params.width,
      height: params.height,
      durationSeconds: params.clip.duration,
    },
    priority: 'visible',
    tags: ['timeline', 'node-graph', 'ai-node-runtime', params.layerId],
  };

  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    imageKind: 'html-canvas',
    imageId: params.imageId,
    runtimeSourceId: params.source.runtimeSourceId,
    runtimeSessionKey: params.source.runtimeSessionKey,
    memoryCost: {
      heapBytes: getCanvasByteSize(params.width, params.height),
    },
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: params.imageId,
        providerKind: 'canvas',
        status: 'ok',
      },
    },
    label: params.label,
  });
}

function createAINodeRuntimeCanvasResources(params: {
  key: string;
  clip: TimelineClip;
  source: LayerSource;
  layerId: string;
  width: number;
  height: number;
}): readonly [RenderResourceDescriptor, RenderResourceDescriptor] {
  const [sourceResourceId, outputResourceId] = getAINodeRuntimeCacheResourceIds(params.key);
  return [
    createAINodeRuntimeCanvasResource({
      id: sourceResourceId,
      imageId: `${sourceResourceId}:image`,
      label: 'AI node source canvas',
      clip: params.clip,
      source: params.source,
      layerId: params.layerId,
      width: params.width,
      height: params.height,
    }),
    createAINodeRuntimeCanvasResource({
      id: outputResourceId,
      imageId: `${outputResourceId}:image`,
      label: 'AI node output canvas',
      clip: params.clip,
      source: params.source,
      layerId: params.layerId,
      width: params.width,
      height: params.height,
    }),
  ];
}

function reserveAINodeRuntimeCanvasResources(
  resources: readonly RenderResourceDescriptor[],
): boolean {
  const retained: string[] = [];
  for (const resource of resources) {
    const admission = timelineRuntimeCoordinator.canRetainResource(resource);
    if (!admission.admitted) {
      for (const resourceId of retained) {
        timelineRuntimeCoordinator.releaseResource(resourceId);
      }
      return false;
    }
    timelineRuntimeCoordinator.retainResource(resource);
    retained.push(resource.id);
  }
  return true;
}

function getAINodeRuntimeCanvasResourceByteSize(resources: readonly RenderResourceDescriptor[]): number {
  return resources.reduce((sum, resource) => sum + (resource.memoryCost?.heapBytes ?? 0), 0);
}

function releaseRuntimeCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function releaseRuntimeCacheEntry(entry: RuntimeCacheEntry): void {
  disposeAINodeSandbox(entry.cacheKey);
  runtimeCacheBytes -= entry.byteSize;
  for (const resourceId of entry.resourceIds) {
    timelineRuntimeCoordinator.releaseResource(resourceId);
  }
  releaseRuntimeCanvas(entry.canvas);
  releaseRuntimeCanvas(entry.sourceCanvas);
}

function releaseRuntimeCacheEntryByKey(key: string): void {
  const entry = runtimeCache.get(key);
  if (!entry) {
    return;
  }
  releaseRuntimeCacheEntry(entry);
  runtimeCache.delete(key);
}

function updateRuntimeCacheEntryResources(
  entry: RuntimeCacheEntry,
  key: string,
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  outputSize?: { width: number; height: number },
): boolean {
  const [sourceResource, outputResource] = createAINodeRuntimeCanvasResources({
    key,
    clip,
    source,
    layerId,
    width: Math.max(1, entry.sourceCanvas.width),
    height: Math.max(1, entry.sourceCanvas.height),
  });
  const outputWidth = Math.max(1, Math.round(outputSize?.width ?? entry.canvas.width));
  const outputHeight = Math.max(1, Math.round(outputSize?.height ?? entry.canvas.height));
  const outputDescriptor = {
    ...outputResource,
    dimensions: {
      ...outputResource.dimensions,
      width: outputWidth,
      height: outputHeight,
    },
    memoryCost: {
      heapBytes: getCanvasByteSize(outputWidth, outputHeight),
    },
  } satisfies RenderResourceDescriptor;
  if (!reserveAINodeRuntimeCanvasResources([sourceResource, outputDescriptor])) {
    releaseRuntimeCacheEntryByKey(key);
    return false;
  }

  const nextByteSize = (sourceResource.memoryCost?.heapBytes ?? 0) + (outputDescriptor.memoryCost?.heapBytes ?? 0);
  runtimeCacheBytes += nextByteSize - entry.byteSize;
  entry.byteSize = nextByteSize;
  return true;
}

function enforceAINodeRuntimeCacheLimits(protectedKey?: string): void {
  while (
    runtimeCache.size > AI_NODE_RUNTIME_CACHE_ENTRY_LIMIT ||
    runtimeCacheBytes > AI_NODE_RUNTIME_CACHE_BYTE_LIMIT
  ) {
    const oldestKey = runtimeCache.keys().next().value;
    if (!oldestKey || (oldestKey === protectedKey && runtimeCache.size === 1)) break;
    const oldest = runtimeCache.get(oldestKey);
    if (oldest) {
      releaseRuntimeCacheEntry(oldest);
    }
    runtimeCache.delete(oldestKey);
  }
}

export function clearAINodeRuntimeCache(): void {
  for (const entry of runtimeCache.values()) {
    releaseRuntimeCacheEntry(entry);
  }
  runtimeCache.clear();
  runtimeCacheBytes = 0;
}

export function clearAINodeRuntimeCacheForClip(clipId: string): void {
  for (const [key, entry] of runtimeCache.entries()) {
    if (entry.clipId !== clipId) {
      continue;
    }
    releaseRuntimeCacheEntry(entry);
    runtimeCache.delete(key);
  }
}

function ensureCacheEntry(
  key: string,
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  processSize: { width: number; height: number },
): RuntimeCacheEntry | null {
  const existing = runtimeCache.get(key);
  const resources = createAINodeRuntimeCanvasResources({
    key,
    clip,
    source,
    layerId,
    width: processSize.width,
    height: processSize.height,
  });
  const nextByteSize = getAINodeRuntimeCanvasResourceByteSize(resources);
  if (existing) {
    if (!reserveAINodeRuntimeCanvasResources(resources)) {
      releaseRuntimeCacheEntryByKey(key);
      return null;
    }
    runtimeCacheBytes += nextByteSize - existing.byteSize;
    existing.byteSize = nextByteSize;
    runtimeCache.delete(key);
    runtimeCache.set(key, existing);
    enforceAINodeRuntimeCacheLimits(key);
    return existing;
  }

  if (!reserveAINodeRuntimeCanvasResources(resources)) {
    return null;
  }

  const entry = {
    cacheKey: key,
    clipId: clip.id,
    canvas: document.createElement('canvas'),
    sourceCanvas: document.createElement('canvas'),
    resourceIds: [resources[0].id, resources[1].id] as const,
    byteSize: nextByteSize,
  };
  entry.canvas.dataset.masterselectsDynamic = 'true';
  runtimeCache.set(key, entry);
  runtimeCacheBytes += entry.byteSize;
  enforceAINodeRuntimeCacheLimits(key);
  return entry;
}

function stableStringifyParams(params: Record<string, ClipCustomNodeParamValue>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join(',');
}

function createSourceContentSignature(source: LayerSource): string {
  const canvas = source.textCanvas;
  if (canvas) {
    return [
      source.type,
      canvas.width,
      canvas.height,
      getCanvasVersion(canvas),
    ].join(':');
  }

  const image = source.imageElement;
  if (image) {
    return [
      source.type,
      image.currentSrc || image.src || '',
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
    ].join(':');
  }

  return [
    source.type,
    source.mediaTime ?? '',
    source.targetMediaTime ?? '',
    source.previewPath ?? '',
  ].join(':');
}

function createSandboxWork(
  definitions: ClipCustomNodeDefinition[],
  clip: TimelineClip,
  source: LayerSource,
  texture: AINodeRuntimeTexture,
  clipLocalTime: number,
  resolveParams: AINodeParamResolver,
  signature: string,
  layerId: string,
  audioOptions: AINodeRuntimeAudioOptions = {},
): AINodeRuntimeWork {
  const graph = buildClipNodeGraph(clip, audioOptions.track, {
    linkedClip: audioOptions.linkedClip,
    linkedTrack: audioOptions.linkedTrack,
  });
  const graphSignal = createSerializableGraph(graph);
  const clipSignal = createRuntimeClipMetadata(clip);
  const sourceSignal = createRuntimeSourceMetadata(source);
  const runtimeAudioInput = resolveRuntimeAudioInput(clip, audioOptions);
  const audioSignal = createRuntimeAudioContext(
    runtimeAudioInput.clip,
    runtimeAudioInput.track,
    audioOptions.masterAudioState,
  );
  const codes: AINodeSandboxCode[] = [];
  const nodes: AINodeSandboxNodeRequest[] = [];

  for (const definition of definitions) {
    const params = resolveParams(definition.id);
    const currentText = clip.textProperties;
    const currentDimensions = { width: texture.width, height: texture.height };
    const textSignal = createRuntimeTextSignal(currentText, currentDimensions);
    const metadata = {
      ...(texture.metadata ?? {}),
      ...createRuntimeMetadata(clip, source, currentText, currentDimensions, audioSignal),
    };
    const timeSignal = {
      currentTime: clipLocalTime,
      clipLocalTime,
      seconds: clipLocalTime,
      mediaTime: source.mediaTime,
    };
    const baseSignals: Record<string, AINodeRuntimeInputValue> = {
      texture,
      time: timeSignal,
      params,
      metadata,
      clip: clipSignal,
      source: sourceSignal,
      graph: graphSignal,
      node: { id: definition.id, label: definition.label },
      audio: audioSignal,
      audioAnalysis: audioSignal?.analysis,
      frequencyBands: audioSignal?.analysis.effective.frequencyBands,
      beats: audioSignal?.analysis.effective.beats,
      onsets: audioSignal?.analysis.effective.onsets,
      audioMetadata: audioSignal?.metadata,
      audioRepairSuggestions: audioSignal?.repairSuggestions,
      text: textSignal,
    };
    const connectedInputs = createConnectedNodeInputs(graph, definition.id, baseSignals, audioSignal);
    const signals = {
      ...baseSignals,
      connectedInputs,
    };
    const prepared = createAINodeSandboxNodeRequest(definition, texture, {
      clipId: clip.id,
      clipLocalTime,
      mediaTime: source.mediaTime,
      params,
      metadata,
      clip: clipSignal,
      source: sourceSignal,
      graph: graphSignal,
      node: {
        id: definition.id,
        label: definition.label,
        inputs: definition.inputs,
        outputs: definition.outputs,
        status: definition.status,
      },
      audio: audioSignal,
      signals,
      text: textSignal,
    }, connectedInputs, isPixelSortNode(definition));
    if (!prepared) continue;
    if (prepared.code) codes.push(prepared.code);
    nodes.push(prepared.request);
  }

  return {
    signature,
    codeSignature: codes.map((node) => `${node.id}:${node.code}`).join('\u0000'),
    codes,
    nodes,
    texture,
    clip,
    source,
    layerId,
  };
}

function writeTextureToRuntimeCanvas(
  entry: RuntimeCacheEntry,
  texture: AINodeRuntimeTexture,
): boolean {
  entry.canvas.width = texture.width;
  entry.canvas.height = texture.height;
  const outputContext = entry.canvas.getContext('2d');
  if (!outputContext) return false;
  const outputImageData = outputContext.createImageData(texture.width, texture.height);
  outputImageData.data.set(texture.data);
  outputContext.putImageData(outputImageData, 0, 0);
  markDynamicCanvasUpdated(entry.canvas, 'ai-node');
  return true;
}

function startSandboxWork(entry: RuntimeCacheEntry, work: AINodeRuntimeWork): void {
  entry.pendingSignature = work.signature;
  const job = runAINodeSandbox(entry.cacheKey, work.codes, {
    texture: work.texture,
    nodes: work.nodes,
  }).then((sandboxOutput) => {
    if (runtimeCache.get(entry.cacheKey) !== entry) return;
    if (entry.queuedWork && entry.queuedWork.signature !== work.signature) return;
    const output = applyAINodeSandboxTextResult(sandboxOutput, work.clip.textProperties);
    if (!updateRuntimeCacheEntryResources(entry, entry.cacheKey, work.clip, work.source, work.layerId, {
      width: output.width,
      height: output.height,
    })) return;
    if (!writeTextureToRuntimeCanvas(entry, output)) {
      releaseRuntimeCacheEntryByKey(entry.cacheKey);
      return;
    }
    entry.disabledCodeSignature = undefined;
    entry.lastSignature = work.signature;
  }).catch((error) => {
    if (runtimeCache.get(entry.cacheKey) === entry) {
      entry.disabledCodeSignature = work.codeSignature;
      entry.lastSignature = work.signature;
      log.warn('Generated AI node sandbox failed; passing source through', error);
    }
  }).finally(() => {
    pendingRuntimeJobs.delete(job);
    if (runtimeCache.get(entry.cacheKey) !== entry) return;
    entry.pendingSignature = undefined;
    const queued = entry.queuedWork;
    entry.queuedWork = undefined;
    if (queued && queued.signature !== entry.lastSignature) startSandboxWork(entry, queued);
  });
  pendingRuntimeJobs.add(job);
}

export async function waitForAINodeRuntimeIdle(): Promise<void> {
  while (pendingRuntimeJobs.size > 0) {
    await Promise.allSettled([...pendingRuntimeJobs]);
  }
}

export function renderClipAINodesToCanvas(
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  clipLocalTime: number,
  resolveParams: AINodeParamResolver = () => ({}),
  audioOptions: AINodeRuntimeAudioOptions = {},
): HTMLCanvasElement | null {
  const cacheKey = `${layerId}:${clip.id}`;
  const runnableNodes = getConnectedRunnableCustomNodes(clip);
  if (runnableNodes.length === 0 || typeof document === 'undefined') {
    releaseRuntimeCacheEntryByKey(cacheKey);
    return null;
  }

  const canvasSource = getCanvasSource(source);
  const sourceSize = getCanvasSourceDimensions(source);
  if (!canvasSource || !sourceSize) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    return null;
  }

  const hasPixelSortNode = runnableNodes.some(isPixelSortNode);
  const processSize = getProcessSize(
    sourceSize.width,
    sourceSize.height,
    getNodeProcessPixelBudget(clip, sourceSize, hasPixelSortNode),
  );
  const signature = [
    source.mediaTime ?? source.targetMediaTime ?? clipLocalTime,
    createSourceContentSignature(source),
    processSize.width,
    processSize.height,
    createRuntimeClipAudioSignature(clip),
    createRuntimeAudioOptionsSignature(audioOptions),
    runnableNodes
      .map((definition) => {
        const params = resolveParams(definition.id);
        return `${definition.id}:${definition.ai.prompt}:${definition.ai.generatedCode}:${stableStringifyParams(params)}`;
      })
      .join('|'),
  ].join(':');

  const entry = ensureCacheEntry(cacheKey, clip, source, layerId, processSize);
  if (!entry) {
    return null;
  }

  if (entry.lastSignature === signature) {
    return entry.canvas;
  }
  if (entry.pendingSignature === signature) {
    return entry.canvas;
  }

  entry.sourceCanvas.width = processSize.width;
  entry.sourceCanvas.height = processSize.height;
  const context = entry.sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    return null;
  }

  try {
    context.drawImage(canvasSource, 0, 0, processSize.width, processSize.height);
    const imageData = context.getImageData(0, 0, processSize.width, processSize.height);
    const texture: AINodeRuntimeTexture = {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
    };
    const work = createSandboxWork(
      runnableNodes,
      clip,
      source,
      texture,
      clipLocalTime,
      resolveParams,
      signature,
      layerId,
      audioOptions,
    );

    if (entry.canvas.width === 0 || entry.canvas.height === 0) {
      if (!writeTextureToRuntimeCanvas(entry, texture)) {
        releaseRuntimeCacheEntryByKey(cacheKey);
        return null;
      }
    }
    if (work.nodes.length === 0) {
      entry.lastSignature = signature;
      return entry.canvas;
    }
    if (entry.disabledCodeSignature === work.codeSignature) {
      if (!writeTextureToRuntimeCanvas(entry, texture)) {
        releaseRuntimeCacheEntryByKey(cacheKey);
        return null;
      }
      entry.lastSignature = signature;
      return entry.canvas;
    }

    if (!entry.pendingSignature) startSandboxWork(entry, work);
    else if (entry.pendingSignature !== signature) entry.queuedWork = work;
    enforceAINodeRuntimeCacheLimits(cacheKey);
    return entry.canvas;
  } catch (error) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    log.warn('Failed to render AI node canvas; passing source through', error);
    return null;
  }
}
