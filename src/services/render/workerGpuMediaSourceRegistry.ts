import type { Layer } from '../../types';
import type { MediaFile } from '../../stores/mediaStore/types';
import { splitLayerEffects } from '../../engine/render/layerEffectStack';
import type { WorkerRenderHostRuntimeBridge } from './workerRenderHostRuntimeBridge';
import type { WorkerRenderHostRuntimeJobOutput } from './workerRenderHostRuntimeHandlers';

export interface WorkerGpuVideoPresentationSource {
  readonly sourceId: string;
  readonly sourceKey: string;
  readonly file: File;
  readonly mediaTime: number;
  readonly timelineTime: number;
  readonly mediaFileId?: string;
  readonly runtimeSourceId?: string;
  readonly runtimeSessionKey?: string;
}

export interface WorkerGpuVideoPresentationLayerStyle {
  readonly opacity: number;
  readonly blendMode: string;
  readonly inlineBrightness: number;
  readonly inlineContrast: number;
  readonly inlineSaturation: number;
  readonly inlineInvert: boolean;
  readonly hueShift: number;
  readonly pixelateSize: number;
  readonly kaleidoscopeSegments: number;
  readonly kaleidoscopeRotation: number;
  readonly mirrorHorizontal: boolean;
  readonly mirrorVertical: boolean;
  readonly rgbSplitAmount: number;
  readonly rgbSplitAngle: number;
  readonly blurRadius: number;
  readonly exposure: number;
  readonly exposureOffset: number;
  readonly exposureGamma: number;
  readonly temperature: number;
  readonly tint: number;
  readonly vibrance: number;
  readonly thresholdLevel: number;
  readonly posterizeLevels: number;
  readonly vignetteAmount: number;
  readonly vignetteSize: number;
  readonly vignetteSoftness: number;
  readonly vignetteRoundness: number;
  readonly chromaKeyMode: number;
  readonly chromaKeyTolerance: number;
  readonly chromaKeySoftness: number;
  readonly chromaKeySpill: number;
  readonly scanlineDensity: number;
  readonly scanlineOpacity: number;
  readonly scanlineSpeed: number;
  readonly grainAmount: number;
  readonly grainSize: number;
  readonly grainSpeed: number;
  readonly waveAmplitudeX: number;
  readonly waveAmplitudeY: number;
  readonly waveFrequencyX: number;
  readonly waveFrequencyY: number;
  readonly twirlAmount: number;
  readonly twirlRadius: number;
  readonly twirlCenterX: number;
  readonly twirlCenterY: number;
  readonly bulgeAmount: number;
  readonly bulgeRadius: number;
  readonly bulgeCenterX: number;
  readonly bulgeCenterY: number;
  readonly sharpenAmount: number;
  readonly sharpenRadius: number;
  readonly edgeDetectStrength: number;
  readonly edgeDetectInvert: boolean;
  readonly glowAmount: number;
  readonly glowThreshold: number;
  readonly glowRadius: number;
  readonly levelsInputBlack: number;
  readonly levelsInputWhite: number;
  readonly levelsGamma: number;
  readonly levelsOutputBlack: number;
  readonly levelsOutputWhite: number;
  readonly levelsEnabled: boolean;
  readonly complexEffectCount: number;
}

export interface WorkerGpuVideoPresentationLayer extends WorkerGpuVideoPresentationSource, WorkerGpuVideoPresentationLayerStyle {
  readonly layerId: string;
}

export type WorkerGpuVideoSourceLoadResult =
  | { readonly status: 'already-loaded' }
  | { readonly status: 'loaded' }
  | { readonly status: 'failed' };

function createFileSignature(file: File): string {
  return `${file.size}:${file.lastModified}`;
}

function createSourceKey(layer: Layer): string {
  const source = layer.source;
  if (!source) return `layer:${layer.id}`;
  if (source.runtimeSourceId && source.runtimeSessionKey) {
    return `runtime:${source.runtimeSourceId}:${source.runtimeSessionKey}`;
  }
  if (source.mediaFileId) {
    return `media:${source.mediaFileId}:${layer.sourceClipId ?? layer.id}`;
  }
  return `layer:${layer.sourceClipId ?? layer.id}`;
}

function runtimeOutputHasError(output: WorkerRenderHostRuntimeJobOutput | null): boolean {
  return output?.statusEvents.some((event) => event.type === 'error') ?? true;
}

function finiteEffectNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function effectBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

export function resolveWorkerGpuVideoPresentationLayerStyle(layer: Layer): WorkerGpuVideoPresentationLayerStyle {
  const effectStack = splitLayerEffects(layer.effects);
  return {
    opacity: typeof layer.opacity === 'number' && Number.isFinite(layer.opacity)
      ? Math.max(0, Math.min(1, layer.opacity))
      : 1,
    blendMode: typeof layer.blendMode === 'string' ? layer.blendMode : 'normal',
    inlineBrightness: effectStack.inlineEffects.brightness,
    inlineContrast: effectStack.inlineEffects.contrast,
    inlineSaturation: effectStack.inlineEffects.saturation,
    inlineInvert: effectStack.inlineEffects.invert,
    ...workerGpuEffectParams(effectStack.complexEffects),
    complexEffectCount: effectStack.complexEffects?.length ?? 0,
  };
}

function workerGpuEffectParams(effects: ReturnType<typeof splitLayerEffects>['complexEffects']) {
  const params = {
    hueShift: 0,
    pixelateSize: 0,
    kaleidoscopeSegments: 0,
    kaleidoscopeRotation: 0,
    mirrorHorizontal: false,
    mirrorVertical: false,
    rgbSplitAmount: 0,
    rgbSplitAngle: 0,
    blurRadius: 0,
    exposure: 0,
    exposureOffset: 0,
    exposureGamma: 1,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    thresholdLevel: -1,
    posterizeLevels: 0,
    vignetteAmount: 0,
    vignetteSize: 0.5,
    vignetteSoftness: 0.5,
    vignetteRoundness: 1,
    chromaKeyMode: 0,
    chromaKeyTolerance: 0.2,
    chromaKeySoftness: 0.1,
    chromaKeySpill: 0.5,
    scanlineDensity: 0,
    scanlineOpacity: 0,
    scanlineSpeed: 0,
    grainAmount: 0,
    grainSize: 1,
    grainSpeed: 1,
    waveAmplitudeX: 0,
    waveAmplitudeY: 0,
    waveFrequencyX: 5,
    waveFrequencyY: 5,
    twirlAmount: 0,
    twirlRadius: 0.5,
    twirlCenterX: 0.5,
    twirlCenterY: 0.5,
    bulgeAmount: 0,
    bulgeRadius: 0.5,
    bulgeCenterX: 0.5,
    bulgeCenterY: 0.5,
    sharpenAmount: 0,
    sharpenRadius: 1,
    edgeDetectStrength: 0,
    edgeDetectInvert: false,
    glowAmount: 0,
    glowThreshold: 0.6,
    glowRadius: 20,
    levelsInputBlack: 0,
    levelsInputWhite: 1,
    levelsGamma: 1,
    levelsOutputBlack: 0,
    levelsOutputWhite: 1,
    levelsEnabled: false,
  };
  for (const effect of effects ?? []) {
    const effectParams = effect.params as Record<string, unknown>;
    const effectType = effect.type as string;
    switch (effectType) {
      case 'hue-shift':
        params.hueShift = finiteEffectNumber(effectParams.shift, 0);
        break;
      case 'pixelate':
        params.pixelateSize = finiteEffectNumber(effectParams.size, 8);
        break;
      case 'kaleidoscope':
        params.kaleidoscopeSegments = finiteEffectNumber(effectParams.segments, 6);
        params.kaleidoscopeRotation = finiteEffectNumber(effectParams.rotation, 0);
        break;
      case 'mirror':
        params.mirrorHorizontal = effectBoolean(effectParams.horizontal);
        params.mirrorVertical = effectBoolean(effectParams.vertical);
        break;
      case 'rgb-split':
        params.rgbSplitAmount = finiteEffectNumber(effectParams.amount, 0.01);
        params.rgbSplitAngle = finiteEffectNumber(effectParams.angle, 0);
        break;
      case 'gaussian-blur':
      case 'box-blur':
      case 'blur':
        params.blurRadius = Math.max(0, finiteEffectNumber(
          effectParams.radius,
          finiteEffectNumber(effectParams.amount, effectType === 'box-blur' ? 5 : 10),
        ));
        break;
      case 'exposure':
        params.exposure = finiteEffectNumber(effectParams.exposure, 0);
        params.exposureOffset = finiteEffectNumber(effectParams.offset, 0);
        params.exposureGamma = Math.max(0.001, finiteEffectNumber(effectParams.gamma, 1));
        break;
      case 'temperature':
        params.temperature = finiteEffectNumber(effectParams.temperature, 0);
        params.tint = finiteEffectNumber(effectParams.tint, 0);
        break;
      case 'vibrance':
        params.vibrance = finiteEffectNumber(effectParams.amount, 0);
        break;
      case 'threshold':
        params.thresholdLevel = finiteEffectNumber(effectParams.level, 0.5);
        break;
      case 'posterize':
        params.posterizeLevels = Math.max(2, finiteEffectNumber(effectParams.levels, 6));
        break;
      case 'vignette':
        params.vignetteAmount = finiteEffectNumber(effectParams.amount, 0.5);
        params.vignetteSize = finiteEffectNumber(effectParams.size, 0.5);
        params.vignetteSoftness = finiteEffectNumber(effectParams.softness, 0.5);
        params.vignetteRoundness = finiteEffectNumber(effectParams.roundness, 1);
        break;
      case 'chroma-key':
        params.chromaKeyMode = effectParams.keyColor === 'blue' ? 2 : 1;
        params.chromaKeyTolerance = finiteEffectNumber(effectParams.tolerance, 0.2);
        params.chromaKeySoftness = finiteEffectNumber(effectParams.softness, 0.1);
        params.chromaKeySpill = finiteEffectNumber(effectParams.spillSuppression, 0.5);
        break;
      case 'scanlines':
        params.scanlineDensity = finiteEffectNumber(effectParams.density, 5);
        params.scanlineOpacity = finiteEffectNumber(effectParams.opacity, 0.3);
        params.scanlineSpeed = finiteEffectNumber(effectParams.speed, 0);
        break;
      case 'grain':
        params.grainAmount = finiteEffectNumber(effectParams.amount, 0.1);
        params.grainSize = Math.max(0.001, finiteEffectNumber(effectParams.size, 1));
        params.grainSpeed = finiteEffectNumber(effectParams.speed, 1);
        break;
      case 'wave':
        params.waveAmplitudeX = finiteEffectNumber(effectParams.amplitudeX, 0.02);
        params.waveAmplitudeY = finiteEffectNumber(effectParams.amplitudeY, 0.02);
        params.waveFrequencyX = finiteEffectNumber(effectParams.frequencyX, 5);
        params.waveFrequencyY = finiteEffectNumber(effectParams.frequencyY, 5);
        break;
      case 'twirl':
        params.twirlAmount = finiteEffectNumber(effectParams.amount, 1);
        params.twirlRadius = Math.max(0.0001, finiteEffectNumber(effectParams.radius, 0.5));
        params.twirlCenterX = finiteEffectNumber(effectParams.centerX, 0.5);
        params.twirlCenterY = finiteEffectNumber(effectParams.centerY, 0.5);
        break;
      case 'bulge':
        params.bulgeAmount = finiteEffectNumber(effectParams.amount, 0.5);
        params.bulgeRadius = Math.max(0.0001, finiteEffectNumber(effectParams.radius, 0.5));
        params.bulgeCenterX = finiteEffectNumber(effectParams.centerX, 0.5);
        params.bulgeCenterY = finiteEffectNumber(effectParams.centerY, 0.5);
        break;
      case 'sharpen':
        params.sharpenAmount = finiteEffectNumber(effectParams.amount, 1);
        params.sharpenRadius = Math.max(0, finiteEffectNumber(effectParams.radius, 1));
        break;
      case 'edge-detect':
        params.edgeDetectStrength = finiteEffectNumber(effectParams.strength, 1);
        params.edgeDetectInvert = effectBoolean(effectParams.invert);
        break;
      case 'glow':
        params.glowAmount = finiteEffectNumber(effectParams.amount, 1);
        params.glowThreshold = finiteEffectNumber(effectParams.threshold, 0.6);
        params.glowRadius = Math.max(0, finiteEffectNumber(effectParams.radius, 20));
        break;
      case 'levels':
        params.levelsInputBlack = finiteEffectNumber(effectParams.inputBlack, 0);
        params.levelsInputWhite = finiteEffectNumber(effectParams.inputWhite, 1);
        params.levelsGamma = finiteEffectNumber(effectParams.gamma, 1);
        params.levelsOutputBlack = finiteEffectNumber(effectParams.outputBlack, 0);
        params.levelsOutputWhite = finiteEffectNumber(effectParams.outputWhite, 1);
        params.levelsEnabled = true;
        break;
    }
  }
  return params;
}

export class WorkerGpuMediaSourceRegistry {
  private readonly loadedSourceIds = new Set<string>();
  private readonly pendingSourceLoads = new Map<string, Promise<WorkerGpuVideoSourceLoadResult>>();

  get loadedSourceCount(): number {
    return this.loadedSourceIds.size;
  }

  get pendingLoadCount(): number {
    return this.pendingSourceLoads.size;
  }

  resolveVideoPresentationSource(
    layers: readonly Layer[],
    mediaFiles: readonly MediaFile[],
  ): WorkerGpuVideoPresentationSource | null {
    return this.resolveVideoPresentationSources(layers, mediaFiles)[0] ?? null;
  }

  resolveVideoPresentationSources(
    layers: readonly Layer[],
    mediaFiles: readonly MediaFile[],
  ): readonly WorkerGpuVideoPresentationLayer[] {
    const mediaFileById = new Map(mediaFiles.map((file) => [file.id, file]));
    const sources: WorkerGpuVideoPresentationLayer[] = [];
    for (const layer of layers) {
      const source = layer.source;
      if (!layer.visible || source?.type !== 'video') continue;
      const mediaTime = source.mediaTime ?? source.targetMediaTime;
      if (typeof mediaTime !== 'number' || !Number.isFinite(mediaTime)) continue;
      const mediaFile = source.mediaFileId ? mediaFileById.get(source.mediaFileId) : undefined;
      const file = source.file ?? mediaFile?.file;
      if (!file) continue;
      const sourceKey = createSourceKey(layer);
      sources.push({
        sourceId: `gpu-video:${sourceKey}:${createFileSignature(file)}`,
        sourceKey,
        file,
        layerId: layer.id,
        mediaTime,
        timelineTime: mediaTime,
        ...resolveWorkerGpuVideoPresentationLayerStyle(layer),
        mediaFileId: source.mediaFileId,
        runtimeSourceId: source.runtimeSourceId,
        runtimeSessionKey: source.runtimeSessionKey,
      });
    }
    return sources;
  }

  loadVideoSource(
    bridge: WorkerRenderHostRuntimeBridge,
    source: WorkerGpuVideoPresentationSource,
    requestId: string,
  ): Promise<WorkerGpuVideoSourceLoadResult> {
    if (this.loadedSourceIds.has(source.sourceId)) {
      return Promise.resolve({ status: 'already-loaded' });
    }
    const pending = this.pendingSourceLoads.get(source.sourceId);
    if (pending) {
      return pending;
    }

    const loadPromise = (async (): Promise<WorkerGpuVideoSourceLoadResult> => {
      try {
        const buffer = await source.file.arrayBuffer();
        const output = await bridge.loadWebCodecsSource(
          requestId,
          source.sourceId,
          buffer,
          {
            hardwareAcceleration: 'prefer-hardware',
            returnBitmap: false,
          },
        );
        const loaded = !runtimeOutputHasError(output) && output.webCodecs?.status.ready === true;
        if (!loaded) {
          return { status: 'failed' };
        }
        this.loadedSourceIds.add(source.sourceId);
        return { status: 'loaded' };
      } catch {
        return { status: 'failed' };
      } finally {
        this.pendingSourceLoads.delete(source.sourceId);
      }
    })();

    this.pendingSourceLoads.set(source.sourceId, loadPromise);
    return loadPromise;
  }

  clear(): void {
    this.loadedSourceIds.clear();
    this.pendingSourceLoads.clear();
  }
}
