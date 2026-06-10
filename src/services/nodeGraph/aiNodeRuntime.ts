import type {
  ClipCustomNodeDefinition,
  ClipCustomNodeParamValue,
  LayerSource,
  TextClipProperties,
  TimelineClip,
} from '../../types';
import { Logger } from '../logger';
import { textRenderer } from '../textRenderer';
import { getCanvasVersion, markDynamicCanvasUpdated } from '../canvasVersion';
import { extractAINodeGeneratedCode } from './aiNodeDefinition';
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
  createRuntimeTime,
  createSerializableGraph,
  type AINodeRuntimeContext,
  type AINodeRuntimeInputValue,
} from './aiNodeRuntimeGraphSignals';

const log = Logger.create('AINodeRuntime');

const PIXEL_SORT_MAX_PIXELS = 320 * 180;
const GENERATED_NODE_MAX_PIXELS = 96 * 54;
const AI_NODE_RUNTIME_CACHE_ENTRY_LIMIT = 24;
const AI_NODE_RUNTIME_CACHE_BYTE_LIMIT = 96 * 1024 * 1024;

export interface AINodeRuntimeTexture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
  text?: string | Partial<TextClipProperties>;
}

type AINodeProcessFunction = (
  input: Record<string, AINodeRuntimeInputValue>,
  context: AINodeRuntimeContext,
) => { output?: AINodeRuntimeTexture } | AINodeRuntimeTexture | undefined;

interface AINodeExecutable {
  process?: AINodeProcessFunction;
}

interface RuntimeCacheEntry {
  clipId: string;
  canvas: HTMLCanvasElement;
  sourceCanvas: HTMLCanvasElement;
  resourceIds: readonly [string, string];
  byteSize: number;
  lastSignature?: string;
}

type AINodeParamResolver = (nodeId: string) => Record<string, ClipCustomNodeParamValue>;

const runtimeCache = new Map<string, RuntimeCacheEntry>();
const executableCache = new Map<string, AINodeExecutable | null>();
let runtimeCacheBytes = 0;

function isRunnableCustomNode(definition: ClipCustomNodeDefinition): boolean {
  return definition.bypassed !== true &&
    definition.status === 'ready' &&
    !!extractAINodeGeneratedCode(definition.ai.generatedCode ?? '');
}

function getConnectedRunnableCustomNodes(clip: TimelineClip): ClipCustomNodeDefinition[] {
  const runnableById = new Map(
    (clip.nodeGraph?.customNodes ?? [])
      .filter(isRunnableCustomNode)
      .map((definition) => [definition.id, definition]),
  );

  if (runnableById.size === 0) {
    return [];
  }

  const graph = buildClipNodeGraph(clip);
  const incomingEdges = new Map(graph.edges.map((edge) => [`${edge.toNodeId}:${edge.toPortId}`, edge]));
  const chain: ClipCustomNodeDefinition[] = [];
  const visitedNodes = new Set<string>();
  let incomingEdge = incomingEdges.get('output:input');

  while (incomingEdge && incomingEdge.type === 'texture' && incomingEdge.fromNodeId !== 'source') {
    if (visitedNodes.has(incomingEdge.fromNodeId)) {
      return [];
    }
    visitedNodes.add(incomingEdge.fromNodeId);

    const customNode = runnableById.get(incomingEdge.fromNodeId);
    if (customNode) {
      chain.unshift(customNode);
    }

    incomingEdge = incomingEdges.get(`${incomingEdge.fromNodeId}:input`);
  }

  return incomingEdge?.fromNodeId === 'source' && incomingEdge.type === 'texture' ? chain : [];
}

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

function getNodeProcessPixelBudget(
  clip: TimelineClip,
  sourceSize: { width: number; height: number },
  hasPixelSortNode: boolean,
): number {
  if (clip.textProperties) {
    return sourceSize.width * sourceSize.height;
  }
  return hasPixelSortNode ? PIXEL_SORT_MAX_PIXELS : GENERATED_NODE_MAX_PIXELS;
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

function copyTexture(texture: AINodeRuntimeTexture): AINodeRuntimeTexture {
  return {
    data: new Uint8ClampedArray(texture.data),
    width: texture.width,
    height: texture.height,
  };
}

function isRuntimeTexture(value: unknown): value is AINodeRuntimeTexture {
  const candidate = value as Partial<AINodeRuntimeTexture> | null;
  return !!candidate &&
    candidate.data instanceof Uint8ClampedArray &&
    typeof candidate.width === 'number' &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    candidate.height > 0;
}

export function sortPixelsTexture(texture: AINodeRuntimeTexture): AINodeRuntimeTexture {
  const output = copyTexture(texture);
  const pixelCount = texture.width * texture.height;
  const pixels = new Array<number>(pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    pixels[i] = (
      (texture.data[base] << 24) |
      (texture.data[base + 1] << 16) |
      (texture.data[base + 2] << 8) |
      texture.data[base + 3]
    ) >>> 0;
  }

  pixels.sort((a, b) => a - b);

  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    const value = pixels[i];
    output.data[base] = (value >>> 24) & 0xff;
    output.data[base + 1] = (value >>> 16) & 0xff;
    output.data[base + 2] = (value >>> 8) & 0xff;
    output.data[base + 3] = value & 0xff;
  }

  return output;
}

function isPixelSortNode(definition: ClipCustomNodeDefinition): boolean {
  const haystack = `${definition.ai.prompt}\n${definition.ai.generatedCode ?? ''}`;
  return /sort(?:ing)?\s+(?:all\s+)?pixels|pixels?\s+sort/i.test(haystack);
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

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getReturnedTextValue(output: AINodeRuntimeTexture | undefined): string | Partial<TextClipProperties> | undefined {
  if (!output) {
    return undefined;
  }

  if (typeof output.text === 'string' || getRecord(output.text)) {
    return output.text;
  }

  const metadata = getRecord(output.metadata);
  const metadataText = getRecord(metadata?.text);
  const content = metadataText?.content;
  if (typeof content === 'string') {
    return content;
  }

  const text = metadataText?.text;
  return typeof text === 'string' ? text : undefined;
}

function mergeReturnedMetadata(
  base: Record<string, unknown>,
  output: AINodeRuntimeTexture | undefined,
  result?: unknown,
): Record<string, unknown> {
  const resultMetadata = getRecord(getRecord(result)?.metadata);
  if (!output?.metadata && !resultMetadata) {
    return base;
  }
  return {
    ...base,
    ...(resultMetadata ?? {}),
    ...(output?.metadata ?? {}),
  };
}

function getTopLevelReturnedText(result: unknown): string | Partial<TextClipProperties> | undefined {
  const text = getRecord(result)?.text;
  return typeof text === 'string' || getRecord(text) ? text as string | Partial<TextClipProperties> : undefined;
}

function renderTextSignalToTexture(
  texture: AINodeRuntimeTexture,
  baseText: TextClipProperties | undefined,
  returnedText: string | Partial<TextClipProperties> | undefined,
): AINodeRuntimeTexture {
  if (!baseText || returnedText === undefined || typeof document === 'undefined') {
    return texture;
  }

  const textPatch = typeof returnedText === 'string'
    ? { text: returnedText }
    : returnedText;
  const textPatchRecord = getRecord(textPatch);
  const normalizedTextPatch = textPatchRecord &&
    typeof textPatchRecord.content === 'string' &&
    typeof textPatchRecord.text !== 'string'
    ? { ...textPatch, text: textPatchRecord.content }
    : textPatch;
  const nextText = {
    ...baseText,
    ...normalizedTextPatch,
  };
  const canvas = textRenderer.createCanvas(texture.width, texture.height);
  textRenderer.render(nextText, canvas);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return texture;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    ...texture,
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
    text: returnedText,
    metadata: mergeReturnedMetadata(texture.metadata ?? {}, texture),
  };
}

function resolveCurrentTextProperties(
  baseText: TextClipProperties | undefined,
  texture: AINodeRuntimeTexture,
): TextClipProperties | undefined {
  if (!baseText || texture.text === undefined) {
    return baseText;
  }

  if (typeof texture.text === 'string') {
    return {
      ...baseText,
      text: texture.text,
    };
  }

  return {
    ...baseText,
    ...texture.text,
  };
}

function compileGeneratedNode(code: string, cacheKey: string): AINodeExecutable | null {
  const cached = executableCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let executable: AINodeExecutable | null = null;
  const defineNode = (definition: AINodeExecutable) => {
    executable = definition;
    return definition;
  };

  try {
    const run = new Function('defineNode', `"use strict";\n${code}\n;`);
    run(defineNode);
  } catch (error) {
    log.warn('Failed to compile generated AI node code', error);
  }

  executableCache.set(cacheKey, executable);
  return executable;
}

function runGeneratedNode(
  definition: ClipCustomNodeDefinition,
  texture: AINodeRuntimeTexture,
  context: AINodeRuntimeContext,
  connectedInputs: Record<string, AINodeRuntimeInputValue> = {},
): AINodeRuntimeTexture {
  const code = extractAINodeGeneratedCode(definition.ai.generatedCode ?? '');
  if (!code) {
    return texture;
  }

  const executable = compileGeneratedNode(code, `${definition.id}:${code}`);
  if (!executable?.process) {
    return texture;
  }

  try {
    const result = executable.process(
      {
        input: texture,
        texture,
        time: createRuntimeTime(context),
        metadata: context.metadata,
        params: context.params,
        clip: context.clip,
        source: context.source,
        graph: context.graph,
        node: context.node,
        signals: context.signals,
        audio: context.audio,
        audioAnalysis: context.signals.audioAnalysis,
        frequencyBands: context.signals.frequencyBands,
        beats: context.signals.beats,
        onsets: context.signals.onsets,
        audioMetadata: context.signals.audioMetadata,
        audioRepairSuggestions: context.signals.audioRepairSuggestions,
        text: context.text,
        connectedInputs,
        ...connectedInputs,
      },
      context,
    );
    const output = 'output' in (result ?? {}) ? (result as { output?: AINodeRuntimeTexture }).output : result;
    if (!isRuntimeTexture(output)) {
      return texture;
    }

    const metadata = mergeReturnedMetadata(context.metadata, output, result);
    const returnedText = getReturnedTextValue(output) ?? getTopLevelReturnedText(result);
    return renderTextSignalToTexture(
      {
        ...output,
        metadata,
      },
      context.text,
      returnedText,
    );
  } catch (error) {
    log.warn('Generated AI node failed during render; passing input through', error);
    return texture;
  }
}

function processTexture(
  definitions: ClipCustomNodeDefinition[],
  clip: TimelineClip,
  source: LayerSource,
  texture: AINodeRuntimeTexture,
  clipLocalTime: number,
  resolveParams: AINodeParamResolver,
  audioOptions: AINodeRuntimeAudioOptions = {},
): AINodeRuntimeTexture {
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

  return definitions.reduce((current, definition) => {
    const params = resolveParams(definition.id);
    if (isPixelSortNode(definition)) {
      return sortPixelsTexture(current);
    }
    const currentText = resolveCurrentTextProperties(clip.textProperties, current);
    const currentDimensions = { width: current.width, height: current.height };
    const textSignal = createRuntimeTextSignal(currentText, currentDimensions);
    const metadata = {
      ...(current.metadata ?? {}),
      ...createRuntimeMetadata(clip, source, currentText, currentDimensions, audioSignal),
    };
    const timeSignal = createRuntimeTime({
      clipId: clip.id,
      clipLocalTime,
      mediaTime: source.mediaTime,
      params,
      metadata,
      clip: clipSignal,
      source: sourceSignal,
      graph: graphSignal,
      node: { id: definition.id, label: definition.label },
      signals: {},
      audio: audioSignal,
      text: textSignal,
    });
    const baseSignals: Record<string, AINodeRuntimeInputValue> = {
      texture: current,
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

    return runGeneratedNode(definition, current, {
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
    }, connectedInputs);
  }, texture);
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
    const output = processTexture(
      runnableNodes,
      clip,
      source,
      {
        data: imageData.data,
        width: imageData.width,
        height: imageData.height,
      },
      clipLocalTime,
      resolveParams,
      audioOptions,
    );

    if (!updateRuntimeCacheEntryResources(entry, cacheKey, clip, source, layerId, {
      width: output.width,
      height: output.height,
    })) {
      return null;
    }

    entry.canvas.width = output.width;
    entry.canvas.height = output.height;
    const outputContext = entry.canvas.getContext('2d');
    if (!outputContext) {
      releaseRuntimeCacheEntryByKey(cacheKey);
      return null;
    }
    const outputImageData = outputContext.createImageData(output.width, output.height);
    outputImageData.data.set(output.data);
    outputContext.putImageData(outputImageData, 0, 0);
    markDynamicCanvasUpdated(entry.canvas, 'ai-node');
    entry.lastSignature = signature;
    enforceAINodeRuntimeCacheLimits(cacheKey);
    return entry.canvas;
  } catch (error) {
    releaseRuntimeCacheEntryByKey(cacheKey);
    log.warn('Failed to render AI node canvas; passing source through', error);
    return null;
  }
}
