import type {
  ClipCustomNodeDefinition,
  ClipCustomNodeParamValue,
  LayerSource,
  NodeGraph,
  TextClipProperties,
  TimelineClip,
} from '../../types';
import type { AudioAnalysisArtifactKind, MediaFileAudioAnalysisRefs } from '../../types/audio';
import { Logger } from '../logger';
import { textRenderer } from '../textRenderer';
import { createTextLayoutSnapshot, type TextBoxRect, type TextLayoutSnapshot } from '../textLayout';
import { getCanvasVersion, markDynamicCanvasUpdated } from '../canvasVersion';
import { extractAINodeGeneratedCode } from './aiNodeDefinition';
import { buildClipNodeGraph } from './clipGraphProjection';

const log = Logger.create('AINodeRuntime');

const PIXEL_SORT_MAX_PIXELS = 320 * 180;
const GENERATED_NODE_MAX_PIXELS = 96 * 54;
const MAX_RUNTIME_AUDIO_SPECTROGRAM_REFS = 16;

export interface AINodeRuntimeTexture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
  text?: string | Partial<TextClipProperties>;
}

interface AINodeRuntimeTime {
  currentTime: number;
  clipLocalTime: number;
  seconds: number;
  mediaTime?: number;
  valueOf: () => number;
  toString: () => string;
}

type AINodeRuntimeTextSignal = TextClipProperties & {
  content: string;
  layout?: TextLayoutSnapshot;
  contentBounds?: TextBoxRect;
  box?: TextBoxRect;
};

interface AINodeRuntimeAudioArtifactSignal {
  artifactId: string;
  kind: AudioAnalysisArtifactKind;
  provenance: 'source' | 'processed';
  available: true;
  stale: boolean;
}

interface AINodeRuntimeWaveformSummary {
  sampleCount: number;
  peak: number;
  rms: number;
  min: number;
  max: number;
  preview: number[];
}

interface AINodeRuntimeAudioAnalysisNamespace {
  waveform?: AINodeRuntimeAudioArtifactSignal;
  processedWaveform?: AINodeRuntimeAudioArtifactSignal;
  spectrogramTileSets: AINodeRuntimeAudioArtifactSignal[];
  spectrogramTileSetCount: number;
  omittedSpectrogramTileSetCount: number;
  loudness?: AINodeRuntimeAudioArtifactSignal;
  beats?: AINodeRuntimeAudioArtifactSignal;
  onsets?: AINodeRuntimeAudioArtifactSignal;
  phaseCorrelation?: AINodeRuntimeAudioArtifactSignal;
  transcriptTiming?: AINodeRuntimeAudioArtifactSignal;
  frequencySummary?: AINodeRuntimeAudioArtifactSignal;
}

interface AINodeRuntimeAudioContext {
  source: {
    mediaFileId?: string;
    sourceAudioRevisionId?: string;
    duration: number;
    inPoint: number;
    outPoint: number;
  };
  waveform?: AINodeRuntimeWaveformSummary;
  analysis: {
    source: AINodeRuntimeAudioAnalysisNamespace;
    processed: AINodeRuntimeAudioAnalysisNamespace;
    effective: AINodeRuntimeAudioAnalysisNamespace;
  };
}

interface AINodeRuntimeContext {
  clipId: string;
  clipLocalTime: number;
  mediaTime?: number;
  metadata: Record<string, unknown>;
  params: Record<string, ClipCustomNodeParamValue>;
  clip: Record<string, unknown>;
  source: Record<string, unknown>;
  graph: Record<string, unknown>;
  node: Record<string, unknown>;
  signals: Record<string, unknown>;
  audio?: AINodeRuntimeAudioContext;
  text?: AINodeRuntimeTextSignal;
}

type AINodeRuntimeInputValue =
  | AINodeRuntimeTexture
  | AINodeRuntimeTime
  | AINodeRuntimeTextSignal
  | AINodeRuntimeAudioContext
  | number
  | Record<string, unknown>
  | undefined;

type AINodeProcessFunction = (
  input: Record<string, AINodeRuntimeInputValue>,
  context: AINodeRuntimeContext,
) => { output?: AINodeRuntimeTexture } | AINodeRuntimeTexture | undefined;

interface AINodeExecutable {
  process?: AINodeProcessFunction;
}

interface RuntimeCacheEntry {
  canvas: HTMLCanvasElement;
  sourceCanvas: HTMLCanvasElement;
  lastSignature?: string;
}

type AINodeParamResolver = (nodeId: string) => Record<string, ClipCustomNodeParamValue>;

const runtimeCache = new Map<string, RuntimeCacheEntry>();
const executableCache = new Map<string, AINodeExecutable | null>();

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

function ensureCacheEntry(key: string): RuntimeCacheEntry {
  const existing = runtimeCache.get(key);
  if (existing) {
    return existing;
  }

  const entry = {
    canvas: document.createElement('canvas'),
    sourceCanvas: document.createElement('canvas'),
  };
  entry.canvas.dataset.masterselectsDynamic = 'true';
  runtimeCache.set(key, entry);
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

function createRuntimeTime(context: AINodeRuntimeContext): AINodeRuntimeTime {
  return {
    currentTime: context.clipLocalTime,
    clipLocalTime: context.clipLocalTime,
    seconds: context.clipLocalTime,
    mediaTime: context.mediaTime,
    valueOf: () => context.clipLocalTime,
    toString: () => String(context.clipLocalTime),
  };
}

function createSerializableGraph(graph: NodeGraph): Record<string, unknown> {
  return {
    id: graph.id,
    owner: graph.owner,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      runtime: node.runtime,
      label: node.label,
      inputs: node.inputs,
      outputs: node.outputs,
      params: node.params,
    })),
    edges: graph.edges,
  };
}

function createRuntimeClipMetadata(clip: TimelineClip): Record<string, unknown> {
  return {
    id: clip.id,
    name: clip.name,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: clip.source?.type,
    trackId: clip.trackId,
  };
}

function createRuntimeSourceMetadata(source: LayerSource): Record<string, unknown> {
  return {
    type: source.type,
    mediaTime: source.mediaTime,
    targetMediaTime: source.targetMediaTime,
    intrinsicWidth: source.intrinsicWidth,
    intrinsicHeight: source.intrinsicHeight,
    previewPath: source.previewPath,
  };
}

function createAudioArtifactSignal(
  artifactId: string | undefined,
  kind: AudioAnalysisArtifactKind,
  provenance: 'source' | 'processed',
): AINodeRuntimeAudioArtifactSignal | undefined {
  if (!artifactId) {
    return undefined;
  }

  return {
    artifactId,
    kind,
    provenance,
    available: true,
    stale: false,
  };
}

function createAudioAnalysisNamespace(
  refs: MediaFileAudioAnalysisRefs | undefined,
  provenance: 'source' | 'processed',
): AINodeRuntimeAudioAnalysisNamespace {
  const spectrogramTileSetIds = refs?.spectrogramTileSetIds ?? [];
  const boundedSpectrogramTileSetIds = spectrogramTileSetIds.slice(0, MAX_RUNTIME_AUDIO_SPECTROGRAM_REFS);

  return {
    waveform: createAudioArtifactSignal(refs?.waveformPyramidId, 'waveform-pyramid', provenance),
    processedWaveform: createAudioArtifactSignal(
      refs?.processedWaveformPyramidId,
      'processed-waveform-pyramid',
      provenance,
    ),
    spectrogramTileSets: boundedSpectrogramTileSetIds
      .map((artifactId) => createAudioArtifactSignal(artifactId, 'spectrogram-tiles', provenance))
      .filter((signal): signal is AINodeRuntimeAudioArtifactSignal => Boolean(signal)),
    spectrogramTileSetCount: spectrogramTileSetIds.length,
    omittedSpectrogramTileSetCount: Math.max(
      0,
      spectrogramTileSetIds.length - boundedSpectrogramTileSetIds.length,
    ),
    loudness: createAudioArtifactSignal(refs?.loudnessEnvelopeId, 'loudness-envelope', provenance),
    beats: createAudioArtifactSignal(refs?.beatGridId, 'beat-grid', provenance),
    onsets: createAudioArtifactSignal(refs?.onsetMapId, 'onset-map', provenance),
    phaseCorrelation: createAudioArtifactSignal(refs?.phaseCorrelationId, 'phase-correlation', provenance),
    transcriptTiming: createAudioArtifactSignal(refs?.transcriptTimingId, 'transcript-timing', provenance),
    frequencySummary: createAudioArtifactSignal(refs?.frequencySummaryId, 'frequency-summary', provenance),
  };
}

function mergeAudioAnalysisNamespaces(
  source: AINodeRuntimeAudioAnalysisNamespace,
  processed: AINodeRuntimeAudioAnalysisNamespace,
): AINodeRuntimeAudioAnalysisNamespace {
  const spectrogramSource = processed.spectrogramTileSets.length > 0 ? processed : source;

  return {
    waveform: processed.processedWaveform ?? processed.waveform ?? source.waveform,
    processedWaveform: processed.processedWaveform ?? source.processedWaveform,
    spectrogramTileSets: spectrogramSource.spectrogramTileSets,
    spectrogramTileSetCount: spectrogramSource.spectrogramTileSetCount,
    omittedSpectrogramTileSetCount: spectrogramSource.omittedSpectrogramTileSetCount,
    loudness: processed.loudness ?? source.loudness,
    beats: processed.beats ?? source.beats,
    onsets: processed.onsets ?? source.onsets,
    phaseCorrelation: processed.phaseCorrelation ?? source.phaseCorrelation,
    transcriptTiming: processed.transcriptTiming ?? source.transcriptTiming,
    frequencySummary: processed.frequencySummary ?? source.frequencySummary,
  };
}

function summarizeWaveform(waveform: number[] | undefined): AINodeRuntimeWaveformSummary | undefined {
  if (!waveform || waveform.length === 0) {
    return undefined;
  }

  let peak = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let squareSum = 0;

  for (const value of waveform) {
    const sample = Number.isFinite(value) ? value : 0;
    peak = Math.max(peak, Math.abs(sample));
    min = Math.min(min, sample);
    max = Math.max(max, sample);
    squareSum += sample * sample;
  }

  const previewLength = Math.min(256, waveform.length);
  const preview = Array.from({ length: previewLength }, (_, index) => {
    const sourceIndex = Math.min(
      waveform.length - 1,
      Math.floor((index / Math.max(1, previewLength)) * waveform.length),
    );
    const sample = waveform[sourceIndex];
    return Number.isFinite(sample) ? sample : 0;
  });

  return {
    sampleCount: waveform.length,
    peak,
    rms: Math.sqrt(squareSum / waveform.length),
    min,
    max,
    preview,
  };
}

function hasAudioAnalysis(namespace: AINodeRuntimeAudioAnalysisNamespace): boolean {
  return Boolean(
    namespace.waveform ||
    namespace.processedWaveform ||
    namespace.spectrogramTileSetCount > 0 ||
    namespace.loudness ||
    namespace.beats ||
    namespace.onsets ||
    namespace.phaseCorrelation ||
    namespace.transcriptTiming ||
    namespace.frequencySummary,
  );
}

function createRuntimeAudioContext(clip: TimelineClip): AINodeRuntimeAudioContext | undefined {
  const source = createAudioAnalysisNamespace(clip.audioState?.sourceAnalysisRefs, 'source');
  const processed = createAudioAnalysisNamespace(clip.audioState?.processedAnalysisRefs, 'processed');
  const effective = mergeAudioAnalysisNamespaces(source, processed);
  const waveform = summarizeWaveform(clip.waveform);
  const hasAudioSource = clip.source?.type === 'audio' ||
    clip.file?.type?.startsWith('audio/') ||
    Boolean(clip.audioState) ||
    Boolean(waveform) ||
    hasAudioAnalysis(effective);

  if (!hasAudioSource) {
    return undefined;
  }

  return {
    source: {
      mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
      sourceAudioRevisionId: clip.audioState?.sourceAudioRevisionId,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
    },
    waveform,
    analysis: {
      source,
      processed,
      effective,
    },
  };
}

function createTextMeasureContext(): Pick<CanvasRenderingContext2D, 'font' | 'measureText'> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.createElement('canvas').getContext('2d');
}

function createRuntimeTextSignal(
  text?: TextClipProperties,
  dimensions?: { width: number; height: number },
): AINodeRuntimeTextSignal | undefined {
  if (!text) {
    return undefined;
  }

  const measureContext = createTextMeasureContext();
  const layout = measureContext && dimensions
    ? createTextLayoutSnapshot(measureContext, text, dimensions.width, dimensions.height)
    : undefined;

  return {
    ...text,
    content: text.text,
    layout,
    contentBounds: layout?.contentBounds,
    box: layout?.box,
  };
}

function createRuntimeMetadata(
  clip: TimelineClip,
  source: LayerSource,
  text?: TextClipProperties,
  dimensions?: { width: number; height: number },
  audio?: AINodeRuntimeAudioContext,
): Record<string, unknown> {
  return {
    clipName: clip.name,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: clip.source?.type,
    source: createRuntimeSourceMetadata(source),
    clip: createRuntimeClipMetadata(clip),
    audio,
    text: createRuntimeTextSignal(text, dimensions),
  };
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
        text: context.text,
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
): AINodeRuntimeTexture {
  const graph = buildClipNodeGraph(clip);
  const graphSignal = createSerializableGraph(graph);
  const clipSignal = createRuntimeClipMetadata(clip);
  const sourceSignal = createRuntimeSourceMetadata(source);
  const audioSignal = createRuntimeAudioContext(clip);

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
      signals: {
        texture: current,
        time: createRuntimeTime({
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
        }),
        params,
        metadata,
        clip: clipSignal,
        source: sourceSignal,
        graph: graphSignal,
        node: { id: definition.id, label: definition.label },
        audio: audioSignal,
        audioAnalysis: audioSignal?.analysis,
        text: textSignal,
      },
      text: textSignal,
    });
  }, texture);
}

export function renderClipAINodesToCanvas(
  clip: TimelineClip,
  source: LayerSource,
  layerId: string,
  clipLocalTime: number,
  resolveParams: AINodeParamResolver = () => ({}),
): HTMLCanvasElement | null {
  const runnableNodes = getConnectedRunnableCustomNodes(clip);
  if (runnableNodes.length === 0 || typeof document === 'undefined') {
    return null;
  }

  const canvasSource = getCanvasSource(source);
  const sourceSize = getCanvasSourceDimensions(source);
  if (!canvasSource || !sourceSize) {
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
    runnableNodes
      .map((definition) => {
        const params = resolveParams(definition.id);
        return `${definition.id}:${definition.ai.prompt}:${definition.ai.generatedCode}:${stableStringifyParams(params)}`;
      })
      .join('|'),
  ].join(':');

  const entry = ensureCacheEntry(`${layerId}:${clip.id}`);
  if (entry.lastSignature === signature) {
    return entry.canvas;
  }

  entry.sourceCanvas.width = processSize.width;
  entry.sourceCanvas.height = processSize.height;
  const context = entry.sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
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
    );

    entry.canvas.width = output.width;
    entry.canvas.height = output.height;
    const outputContext = entry.canvas.getContext('2d');
    if (!outputContext) {
      return null;
    }
    const outputImageData = outputContext.createImageData(output.width, output.height);
    outputImageData.data.set(output.data);
    outputContext.putImageData(outputImageData, 0, 0);
    markDynamicCanvasUpdated(entry.canvas, 'ai-node');
    entry.lastSignature = signature;
    return entry.canvas;
  } catch (error) {
    log.warn('Failed to render AI node canvas; passing source through', error);
    return null;
  }
}
