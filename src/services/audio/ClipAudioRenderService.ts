import type { EffectRenderProgress } from '../../engine/audio/AudioEffectRenderer';
import { AudioEffectRenderer, audioEffectRenderer } from '../../engine/audio/AudioEffectRenderer';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { TimeStretchProcessor, timeStretchProcessor, type TimeStretchProgress } from '../../engine/audio/TimeStretchProcessor';
import type { ClipAudioEditOperation, Keyframe, SpectralImageLayer, TimelineClip } from '../../types';
import { createCurrentAudioArtifactStore } from './timelineWaveformPyramidCache';
import { StemAudioSourceResolver, STEM_SOURCE_LAYER_ID, type StemAudioSourceResolution } from './stemSeparation';
import {
  collectProcessedAnalysisClipAudioEffectInstances,
  collectRenderableClipAudioEditOperations,
  collectRenderableClipAudioEffectInstances,
} from './processedWaveformEligibility';
import {
  appendSilence,
  cloneAudioBuffer,
  createGainAdjustedBuffer,
  createSilentLike,
  mixAudioBuffers,
  reverseAudioBuffer,
} from './clipRender/audioBufferPrimitives';
import { dbToLinearGain } from './clipRender/audioRenderMath';
import { renderEditStackOperations } from './clipRender/editStackRendering';
import { defaultSpectralImageLayerMaskProvider } from './clipRender/spectralImageMaskProvider';
import { applySpectralImageLayer, isSpectralLayerEnabled } from './clipRender/spectralImageLayerRendering';
import { emitProgress } from './clipRender/renderProgress';

export type ClipAudioRenderPhase =
  | 'stem-mix'
  | 'trimming'
  | 'edit-stack'
  | 'spectral-layers'
  | 'reversing'
  | 'speed'
  | 'muting'
  | 'effects'
  | 'complete';

export interface ClipAudioRenderProgress {
  phase: ClipAudioRenderPhase;
  percent: number;
  message?: string;
  speed?: TimeStretchProgress;
  effects?: EffectRenderProgress;
}

export interface ClipAudioRenderRequest {
  clip: TimelineClip;
  sourceBuffer: AudioBuffer;
  /**
   * The source buffer already contains exactly clip.inPoint..clip.outPoint.
   * Export uses this for ranged PCM proxy reads so a long source never has to
   * be decoded into one giant AudioBuffer.
   */
  sourceIsClipRange?: boolean;
  keyframes?: readonly Keyframe[];
  effectMode?: 'output' | 'analysis-shape';
  effectTailSeconds?: number;
  onProgress?: (progress: ClipAudioRenderProgress) => void;
}

export interface ClipAudioRenderResult {
  buffer: AudioBuffer;
}

export interface SpectralImageLayerMask {
  width: number;
  height: number;
  luminance: Float32Array;
  alpha?: Float32Array;
}

export type SpectralImageLayerMaskProvider = (
  layer: SpectralImageLayer,
  clip: TimelineClip,
) => Promise<SpectralImageLayerMask | null>;

export interface ClipAudioRenderServiceOptions {
  effectRenderer?: Pick<AudioEffectRenderer, 'renderEffectInstances'>;
  timeStretchProcessor?: Pick<TimeStretchProcessor, 'processConstantSpeed' | 'processWithKeyframes'>;
  extractor?: Pick<AudioExtractor, 'trimBuffer'>;
  spectralImageLayerMaskProvider?: SpectralImageLayerMaskProvider;
  stemAudioSourceResolver?: Pick<StemAudioSourceResolver, 'resolveStemMix'>;
}

function normalizeSpeedKeyframesForClipAudioRender(
  keyframes: readonly Keyframe[],
): Keyframe[] {
  return keyframes.map(keyframe => keyframe.property === 'speed'
    ? { ...keyframe, value: Math.abs(keyframe.value) || 0.01 }
    : { ...keyframe });
}

export class ClipAudioRenderService {
  private readonly effectRenderer: Pick<AudioEffectRenderer, 'renderEffectInstances'>;
  private readonly timeStretchProcessor: Pick<TimeStretchProcessor, 'processConstantSpeed' | 'processWithKeyframes'>;
  private readonly extractor: Pick<AudioExtractor, 'trimBuffer'>;
  private readonly spectralImageLayerMaskProvider: SpectralImageLayerMaskProvider;
  private readonly stemAudioSourceResolver?: Pick<StemAudioSourceResolver, 'resolveStemMix'>;

  constructor(options: ClipAudioRenderServiceOptions = {}) {
    this.effectRenderer = options.effectRenderer ?? audioEffectRenderer;
    this.timeStretchProcessor = options.timeStretchProcessor ?? timeStretchProcessor;
    this.extractor = options.extractor ?? audioExtractor;
    this.spectralImageLayerMaskProvider = options.spectralImageLayerMaskProvider ?? defaultSpectralImageLayerMaskProvider;
    this.stemAudioSourceResolver = options.stemAudioSourceResolver;
  }

  async render(request: ClipAudioRenderRequest): Promise<ClipAudioRenderResult> {
    const {
      clip,
      sourceBuffer,
      sourceIsClipRange = false,
      keyframes = [],
      effectMode = 'output',
      effectTailSeconds = 0,
      onProgress,
    } = request;

    const resolvedSourceBuffer = await this.resolveStemSourceBuffer(clip, sourceBuffer, onProgress);
    let processedBuffer = sourceIsClipRange
      ? resolvedSourceBuffer
      : this.trimClipBuffer(clip, resolvedSourceBuffer, onProgress);
    if (sourceIsClipRange) {
      emitProgress(onProgress, {
        phase: 'trimming',
        percent: 8,
        message: 'Clip audio range ready',
      });
    }
    processedBuffer = await this.renderEditStack(clip, processedBuffer, onProgress);
    processedBuffer = await this.renderSpectralImageLayers(clip, processedBuffer, onProgress);

    if (clip.reversed) {
      emitProgress(onProgress, {
        phase: 'reversing',
        percent: 18,
        message: 'Reversing clip audio',
      });
      processedBuffer = reverseAudioBuffer(processedBuffer);
    }

    processedBuffer = await this.processSpeed(clip, processedBuffer, keyframes, onProgress);

    if (clip.audioState?.muted === true && effectMode !== 'analysis-shape') {
      emitProgress(onProgress, {
        phase: 'muting',
        percent: 54,
        message: 'Rendering muted clip audio',
      });
      processedBuffer = createSilentLike(processedBuffer);
    } else {
      processedBuffer = appendSilence(processedBuffer, effectTailSeconds);
      processedBuffer = await this.renderEffects(clip, processedBuffer, keyframes, effectMode, onProgress);
    }

    emitProgress(onProgress, {
      phase: 'complete',
      percent: 100,
      message: 'Clip audio render complete',
    });

    return { buffer: processedBuffer };
  }

  private getStemAudioSourceResolver(): Pick<StemAudioSourceResolver, 'resolveStemMix'> {
    return this.stemAudioSourceResolver ?? new StemAudioSourceResolver({
      artifactStore: createCurrentAudioArtifactStore(),
    });
  }

  private async resolveStemSourceBuffer(
    clip: TimelineClip,
    sourceBuffer: AudioBuffer,
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): Promise<AudioBuffer> {
    const stemSeparation = clip.audioState?.stemSeparation;
    if (!stemSeparation) {
      return sourceBuffer;
    }

    const sourceBufferWithGain = createGainAdjustedBuffer(sourceBuffer, dbToLinearGain(stemSeparation.sourceGainDb ?? 0));
    if (
      stemSeparation.mixMode === 'original' ||
      stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID
    ) {
      return sourceBufferWithGain;
    }

    emitProgress(onProgress, {
      phase: 'stem-mix',
      percent: 2,
      message: 'Resolving clip stem mix',
    });

    const resolution: StemAudioSourceResolution = await this.getStemAudioSourceResolver().resolveStemMix(stemSeparation);
    if (resolution.missingStems.length > 0) {
      const labels = resolution.missingStems.map((stem) => stem.label || stem.kind).join(', ');
      throw new Error(`Missing stem artifacts: ${labels}`);
    }

    if (!resolution.buffer) {
      return stemSeparation.mixMode === 'hybrid'
        ? sourceBufferWithGain
        : createSilentLike(sourceBuffer);
    }

    emitProgress(onProgress, {
      phase: 'stem-mix',
      percent: 6,
      message: 'Clip stem mix ready',
    });

    return stemSeparation.mixMode === 'hybrid'
      ? mixAudioBuffers(sourceBufferWithGain, resolution.buffer)
      : resolution.buffer;
  }

  private async renderSpectralImageLayers(
    clip: TimelineClip,
    buffer: AudioBuffer,
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): Promise<AudioBuffer> {
    const layers = (clip.audioState?.spectralLayers ?? []).filter(isSpectralLayerEnabled);
    if (layers.length === 0) return buffer;

    emitProgress(onProgress, {
      phase: 'spectral-layers',
      percent: 22,
      message: 'Rendering spectral image layers',
    });

    const edited = cloneAudioBuffer(buffer);
    for (const layer of layers) {
      const mask = await this.spectralImageLayerMaskProvider(layer, clip);
      if (!mask || mask.width <= 0 || mask.height <= 0 || mask.luminance.length < mask.width * mask.height) {
        continue;
      }
      applySpectralImageLayer(edited, clip, layer, mask);
    }

    return edited;
  }

  private async renderEditStack(
    clip: TimelineClip,
    buffer: AudioBuffer,
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): Promise<AudioBuffer> {
    const operations = collectRenderableClipAudioEditOperations(clip);
    return renderEditStackOperations(
      this.effectRenderer,
      clip,
      buffer,
      operations as ClipAudioEditOperation[],
      onProgress,
    );
  }

  private trimClipBuffer(
    clip: TimelineClip,
    sourceBuffer: AudioBuffer,
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): AudioBuffer {
    const start = Math.max(0, clip.inPoint ?? 0);
    const sourceEnd = Number.isFinite(clip.outPoint)
      ? clip.outPoint
      : sourceBuffer.duration;
    const end = Math.max(start, Math.min(sourceBuffer.duration, sourceEnd));
    const coversWholeBuffer = start <= 0.0005 && Math.abs(end - sourceBuffer.duration) <= 0.0005;

    emitProgress(onProgress, {
      phase: 'trimming',
      percent: 8,
      message: 'Extracting clip audio range',
    });

    return coversWholeBuffer ? sourceBuffer : this.extractor.trimBuffer(sourceBuffer, start, end);
  }

  private async processSpeed(
    clip: TimelineClip,
    buffer: AudioBuffer,
    keyframes: readonly Keyframe[],
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): Promise<AudioBuffer> {
    const speedKeyframes = keyframes.filter(keyframe => keyframe.property === 'speed');
    const defaultSpeed = Math.abs(clip.speed ?? 1) || 0.01;
    const preservesPitch = clip.preservesPitch !== false;

    if (speedKeyframes.length === 0 && Math.abs(defaultSpeed - 1) <= 0.001) {
      return buffer;
    }

    emitProgress(onProgress, {
      phase: 'speed',
      percent: 32,
      message: 'Rendering speed and pitch processing',
    });

    if (speedKeyframes.length > 0) {
      return this.timeStretchProcessor.processWithKeyframes(
        buffer,
        normalizeSpeedKeyframesForClipAudioRender(keyframes),
        defaultSpeed,
        clip.duration,
        preservesPitch,
        speed => emitProgress(onProgress, {
          phase: 'speed',
          percent: 32 + Math.round(speed.percent * 0.22),
          speed,
          message: 'Rendering speed automation',
        }),
      );
    }

    return this.timeStretchProcessor.processConstantSpeed(buffer, defaultSpeed, preservesPitch);
  }

  private async renderEffects(
    clip: TimelineClip,
    buffer: AudioBuffer,
    keyframes: readonly Keyframe[],
    effectMode: ClipAudioRenderRequest['effectMode'],
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): Promise<AudioBuffer> {
    const effects = effectMode === 'analysis-shape'
      ? collectProcessedAnalysisClipAudioEffectInstances(clip, keyframes)
      : collectRenderableClipAudioEffectInstances(clip);
    if (effects.length === 0) return buffer;

    emitProgress(onProgress, {
      phase: 'effects',
      percent: 58,
      message: 'Rendering clip audio effects',
    });

    return this.effectRenderer.renderEffectInstances(
      buffer,
      effects,
      keyframes.map(keyframe => ({ ...keyframe })),
      clip.duration,
      effectsProgress => emitProgress(onProgress, {
        phase: 'effects',
        percent: 58 + Math.round(effectsProgress.percent * 0.38),
        effects: effectsProgress,
        message: 'Rendering clip audio effects',
      }),
    );
  }
}
