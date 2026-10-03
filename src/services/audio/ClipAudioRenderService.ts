import { createBuffer } from '../../engine/audio/audioBufferFactory';
import { isVideoInspectorSectionEnabled } from '../videoInspector/sectionBypass';
import { createClipSpeedSource, resolveClipSourceTime, resolveClipSourceWindow } from '../timeline/retime/clipRetime';
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
  /** Absolute source origin of a pre-read range (Warp can leave the retained trim window). */
  sourceBufferStart?: number;
  signal?: AbortSignal;
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
      signal,
    } = request;
    const onProgress = (progress: ClipAudioRenderProgress) => {
      signal?.throwIfAborted();
      request.onProgress?.(progress);
    };
    signal?.throwIfAborted();

    // Freeze is silent even with source edits, generators, FX or transition mappings.
    if (clip.timeRemap?.kind === 'freeze' || (clip.timeRemap?.kind === 'loop' && clip.outPoint <= clip.inPoint &&
      !clip.transitionSourceMap && !Number.isFinite(clip.transitionSourceTimeOverride) && !clip.transitionSourceHold)) {
      const buffer = createBuffer(sourceBuffer.numberOfChannels,
        Math.max(1, Math.ceil(clip.duration * sourceBuffer.sampleRate)), sourceBuffer.sampleRate);
      emitProgress(onProgress, { phase: 'complete', percent: 100, message: 'Held clip audio is silent' });
      return { buffer };
    }

    if (clip.timeRemap?.kind === 'warp' && sourceIsClipRange) {
      const window = resolveClipSourceWindow(clip, 0, clip.duration);
      const origin = request.sourceBufferStart ?? clip.inPoint;
      if (window.maxSourceTime > window.minSourceTime &&
        (window.minSourceTime < origin - 1 / sourceBuffer.sampleRate ||
          window.maxSourceTime > origin + sourceBuffer.duration + 1 / sourceBuffer.sampleRate)) {
        throw new Error('Warp audio requires its complete source window; the supplied trimmed audio range is incomplete.');
      }
    }
    const resolvedSourceBuffer = await this.resolveStemSourceBuffer(clip, sourceBuffer, onProgress);
    signal?.throwIfAborted();
    let processedBuffer = sourceIsClipRange || clip.timeRemap?.kind === 'warp'
      ? resolvedSourceBuffer
      : this.trimClipBuffer(clip, resolvedSourceBuffer, onProgress);
    if (sourceIsClipRange) {
      emitProgress(onProgress, {
        phase: 'trimming',
        percent: 8,
        message: 'Clip audio range ready',
      });
    }
    // A ranged nested export can supply only the prefix needed before its end.
    // Keep the loop's complete source clock so that prefix is not stretched into
    // a shorter cycle. Unrequested source-tail samples remain silent.
    if (clip.timeRemap?.kind === 'loop' && request.sourceBufferStart === undefined) {
      processedBuffer = appendSilence(processedBuffer, Math.max(0, clip.outPoint - clip.inPoint - processedBuffer.duration));
    }
    processedBuffer = await this.renderEditStack(clip, processedBuffer, onProgress);
    signal?.throwIfAborted();
    processedBuffer = await this.renderSpectralImageLayers(clip, processedBuffer, onProgress);

    signal?.throwIfAborted();
    processedBuffer = await this.processSpeed(clip, processedBuffer, keyframes, onProgress, signal,
      request.sourceBufferStart ?? (clip.timeRemap?.kind === 'warp' && !sourceIsClipRange ? 0 : clip.inPoint));
    signal?.throwIfAborted();

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
    signal?: AbortSignal,
    sourceBufferStart?: number,
  ): Promise<AudioBuffer> {
    const source = createClipSpeedSource(clip, keyframes);
    const initial = resolveClipSourceTime(clip, 0, source);
    const defaultSpeed = source.speedAt(0);
    const preservesPitch = clip.preservesPitch !== false;
    const shiftedRange = sourceBufferStart !== undefined && Math.abs(sourceBufferStart - clip.inPoint) > 1e-9;
    const partialLoop = clip.timeRemap?.kind === 'loop' &&
      Math.abs(buffer.duration - (clip.outPoint - clip.inPoint)) > 1 / buffer.sampleRate;
    const needsMappedRender = shiftedRange || partialLoop || clip.timeRemap?.kind === 'warp' || (isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange') &&
      keyframes.some(key => key.property === 'speed')) ||
      clip.transitionSourceMap || clip.transitionSourceHold ||
      Number.isFinite(clip.transitionSourceTimeOverride) || initial.isHold ||
      (clip.effects ?? []).some(effect => effect.enabled && effect.type === 'slit-scan');
    if (!needsMappedRender) {
      if (initial.sourceRate < 0) buffer = reverseAudioBuffer(buffer);
      if (clip.timeRemap?.kind === 'loop') {
        const cycle = await this.timeStretchProcessor.processConstantSpeed(buffer, Math.abs(defaultSpeed), preservesPitch);
        const output = createBuffer(cycle.numberOfChannels, Math.max(1, Math.ceil(clip.duration * cycle.sampleRate)), cycle.sampleRate);
        const offset = (initial.sourceRate < 0 ? clip.outPoint - initial.sourceTime : initial.sourceTime - clip.inPoint) /
          (clip.outPoint - clip.inPoint) * cycle.length;
        const step = cycle.length * Math.abs(defaultSpeed) / ((clip.outPoint - clip.inPoint) * cycle.sampleRate);
        for (let ch = 0; ch < cycle.numberOfChannels; ch++) {
          const input = cycle.getChannelData(ch), target = output.getChannelData(ch);
          for (let i = 0; i < target.length; i++) {
            if (i % 16384 === 0) signal?.throwIfAborted();
            const position = ((offset + i * step) % cycle.length + cycle.length) % cycle.length;
            const index = Math.floor(position), fraction = position - index;
            target[i] = input[index] + (input[(index + 1) % cycle.length] - input[index]) * fraction;
          }
        }
        return output;
      }
      if (Math.abs(Math.abs(defaultSpeed) - 1) <= 0.001) return buffer;
      return this.timeStretchProcessor.processConstantSpeed(buffer, Math.abs(defaultSpeed), preservesPitch);
    }

    emitProgress(onProgress, {
      phase: 'speed',
      percent: 32,
      message: 'Rendering speed and pitch processing',
    });

    return this.timeStretchProcessor.processWithKeyframes(
      buffer,
      keyframes.map(key => ({ ...key })),
      defaultSpeed,
      clip.duration,
      preservesPitch,
      speed => emitProgress(onProgress, {
        phase: 'speed',
        percent: 32 + Math.round(speed.percent * 0.22),
        speed,
        message: 'Rendering speed automation',
      }),
      clip,
      signal,
      sourceBufferStart,
    );
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
