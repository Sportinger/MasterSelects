import type { EffectRenderProgress } from '../../engine/audio/AudioEffectRenderer';
import { AudioEffectRenderer, audioEffectRenderer } from '../../engine/audio/AudioEffectRenderer';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { TimeStretchProcessor, timeStretchProcessor, type TimeStretchProgress } from '../../engine/audio/TimeStretchProcessor';
import type { ClipAudioEditOperation, Keyframe, TimelineClip } from '../../types';
import {
  collectRenderableClipAudioEditOperations,
  collectRenderableClipAudioEffectInstances,
} from './processedWaveformEligibility';

export type ClipAudioRenderPhase =
  | 'trimming'
  | 'edit-stack'
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
  keyframes?: readonly Keyframe[];
  onProgress?: (progress: ClipAudioRenderProgress) => void;
}

export interface ClipAudioRenderResult {
  buffer: AudioBuffer;
}

export interface ClipAudioRenderServiceOptions {
  effectRenderer?: Pick<AudioEffectRenderer, 'renderEffectInstances'>;
  timeStretchProcessor?: Pick<TimeStretchProcessor, 'processConstantSpeed' | 'processWithKeyframes'>;
  extractor?: Pick<AudioExtractor, 'trimBuffer'>;
}

type AudioContextConstructor = new () => AudioContext;

function emitProgress(
  onProgress: ((progress: ClipAudioRenderProgress) => void) | undefined,
  progress: ClipAudioRenderProgress,
): void {
  onProgress?.(progress);
}

function getAudioContextConstructor(): AudioContextConstructor {
  const maybeWindow = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const ctor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
  if (!ctor) {
    throw new Error('AudioContext is required for clip audio render buffer allocation.');
  }
  return ctor;
}

function createAudioBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const context = new (getAudioContextConstructor())();
  const buffer = context.createBuffer(numberOfChannels, Math.max(1, length), sampleRate);
  void context.close();
  return buffer;
}

function reverseAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const reversed = createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    for (let sample = 0; sample < buffer.length; sample += 1) {
      target[sample] = source[buffer.length - 1 - sample] ?? 0;
    }
  }

  return reversed;
}

function createSilentLike(buffer: AudioBuffer): AudioBuffer {
  return createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
}

function cloneAudioBuffer(buffer: AudioBuffer): AudioBuffer {
  const cloned = createAudioBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    cloned.getChannelData(channel).set(buffer.getChannelData(channel));
  }
  return cloned;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getOperationChannelIndexes(
  operation: ClipAudioEditOperation,
  buffer: AudioBuffer,
): number[] {
  const sourceChannels = operation.channelMask?.length
    ? operation.channelMask
    : Array.from({ length: buffer.numberOfChannels }, (_, index) => index);
  const unique = new Set<number>();
  for (const channel of sourceChannels) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= buffer.numberOfChannels) continue;
    unique.add(channel);
  }
  return Array.from(unique);
}

function getOperationSampleRange(
  operation: ClipAudioEditOperation,
  clip: TimelineClip,
  buffer: AudioBuffer,
): { start: number; end: number } {
  if (!operation.timeRange) {
    return { start: 0, end: buffer.length };
  }

  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const sourceStart = Math.min(operation.timeRange.start, operation.timeRange.end);
  const sourceEnd = Math.max(operation.timeRange.start, operation.timeRange.end);
  const localStartSeconds = Math.max(0, sourceStart - clipSourceStart);
  const localEndSeconds = Math.max(localStartSeconds, sourceEnd - clipSourceStart);
  const start = Math.max(0, Math.min(buffer.length, Math.floor(localStartSeconds * buffer.sampleRate)));
  const end = Math.max(start, Math.min(buffer.length, Math.ceil(localEndSeconds * buffer.sampleRate)));
  return { start, end };
}

function fillRangeWithSilence(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  for (const channel of channels) {
    buffer.getChannelData(channel).fill(0, range.start, range.end);
  }
}

function reverseRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    let left = range.start;
    let right = range.end - 1;
    while (left < right) {
      const tmp = data[left] ?? 0;
      data[left] = data[right] ?? 0;
      data[right] = tmp;
      left += 1;
      right -= 1;
    }
  }
}

function invertPolarityRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      data[sample] = -(data[sample] ?? 0);
    }
  }
}

function swapChannelsRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  if (buffer.numberOfChannels < 2) return;
  const leftChannel = channels[0] ?? 0;
  const rightChannel = channels[1] ?? (leftChannel === 0 ? 1 : 0);
  if (leftChannel === rightChannel || leftChannel >= buffer.numberOfChannels || rightChannel >= buffer.numberOfChannels) {
    return;
  }

  const left = buffer.getChannelData(leftChannel);
  const right = buffer.getChannelData(rightChannel);
  for (let sample = range.start; sample < range.end; sample += 1) {
    const tmp = left[sample] ?? 0;
    left[sample] = right[sample] ?? 0;
    right[sample] = tmp;
  }
}

function monoSumRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  if (channels.length <= 1) return;
  const channelData = channels.map(channel => buffer.getChannelData(channel));
  for (let sample = range.start; sample < range.end; sample += 1) {
    let sum = 0;
    for (const data of channelData) {
      sum += data[sample] ?? 0;
    }
    const mono = sum / channelData.length;
    for (const data of channelData) {
      data[sample] = mono;
    }
  }
}

function insertSilencePreservingDuration(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const seconds = finiteNumber(operation.params.durationSeconds, 0);
  const requestedSamples = seconds > 0
    ? Math.round(seconds * buffer.sampleRate)
    : Math.max(1, range.end - range.start);
  const insertionSamples = Math.max(1, Math.min(buffer.length - range.start, requestedSamples));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    data.copyWithin(range.start + insertionSamples, range.start, buffer.length - insertionSamples);
    data.fill(0, range.start, Math.min(buffer.length, range.start + insertionSamples));
  }
}

function deleteRangePreservingDuration(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
): void {
  const deletedSamples = Math.max(0, range.end - range.start);
  if (deletedSamples <= 0) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    data.copyWithin(range.start, range.end);
    data.fill(0, Math.max(range.start, buffer.length - deletedSamples), buffer.length);
  }
}

function pasteRangePreservingDuration(
  buffer: AudioBuffer,
  clip: TimelineClip,
  destinationRange: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const sourceInPoint = finiteNumber(operation.params.sourceInPoint, Number.NaN);
  const sourceOutPoint = finiteNumber(operation.params.sourceOutPoint, Number.NaN);
  if (!Number.isFinite(sourceInPoint) || !Number.isFinite(sourceOutPoint)) return;

  const sourceRange = getOperationSampleRange({
    ...operation,
    timeRange: {
      start: Math.min(sourceInPoint, sourceOutPoint),
      end: Math.max(sourceInPoint, sourceOutPoint),
    },
  }, clip, buffer);
  const sourceLength = Math.max(0, sourceRange.end - sourceRange.start);
  const destinationLength = Math.max(0, destinationRange.end - destinationRange.start);
  const pasteLength = Math.min(sourceLength, destinationLength || sourceLength, buffer.length - destinationRange.start);
  if (pasteLength <= 0) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    const sourceCopy = data.slice(sourceRange.start, sourceRange.start + pasteLength);
    if (operation.params.replaceSelection !== false && destinationLength > pasteLength) {
      data.fill(0, destinationRange.start, destinationRange.end);
    }
    data.set(sourceCopy, destinationRange.start);
  }
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

  constructor(options: ClipAudioRenderServiceOptions = {}) {
    this.effectRenderer = options.effectRenderer ?? audioEffectRenderer;
    this.timeStretchProcessor = options.timeStretchProcessor ?? timeStretchProcessor;
    this.extractor = options.extractor ?? audioExtractor;
  }

  async render(request: ClipAudioRenderRequest): Promise<ClipAudioRenderResult> {
    const { clip, sourceBuffer, keyframes = [], onProgress } = request;

    let processedBuffer = this.trimClipBuffer(clip, sourceBuffer, onProgress);
    processedBuffer = this.renderEditStack(clip, processedBuffer, onProgress);

    if (clip.reversed) {
      emitProgress(onProgress, {
        phase: 'reversing',
        percent: 18,
        message: 'Reversing clip audio',
      });
      processedBuffer = reverseAudioBuffer(processedBuffer);
    }

    processedBuffer = await this.processSpeed(clip, processedBuffer, keyframes, onProgress);

    if (clip.audioState?.muted === true) {
      emitProgress(onProgress, {
        phase: 'muting',
        percent: 54,
        message: 'Rendering muted clip audio',
      });
      processedBuffer = createSilentLike(processedBuffer);
    } else {
      processedBuffer = await this.renderEffects(clip, processedBuffer, keyframes, onProgress);
    }

    emitProgress(onProgress, {
      phase: 'complete',
      percent: 100,
      message: 'Clip audio render complete',
    });

    return { buffer: processedBuffer };
  }

  private renderEditStack(
    clip: TimelineClip,
    buffer: AudioBuffer,
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): AudioBuffer {
    const operations = collectRenderableClipAudioEditOperations(clip);
    if (operations.length === 0) return buffer;

    emitProgress(onProgress, {
      phase: 'edit-stack',
      percent: 16,
      message: 'Rendering clip audio edit stack',
    });

    const edited = cloneAudioBuffer(buffer);
    for (const operation of operations) {
      const range = getOperationSampleRange(operation, clip, edited);
      if (range.end <= range.start && operation.type !== 'insert-silence') continue;
      const channels = getOperationChannelIndexes(operation, edited);
      if (channels.length === 0) continue;

      switch (operation.type) {
        case 'silence':
        case 'cut':
          fillRangeWithSilence(edited, range, channels);
          break;
        case 'paste':
          pasteRangePreservingDuration(edited, clip, range, channels, operation);
          break;
        case 'reverse':
          reverseRange(edited, range, channels);
          break;
        case 'invert-polarity':
          invertPolarityRange(edited, range, channels);
          break;
        case 'swap-channels':
          swapChannelsRange(edited, range, channels);
          break;
        case 'mono-sum':
          monoSumRange(edited, range, channels);
          break;
        case 'insert-silence':
          insertSilencePreservingDuration(edited, range, channels, operation);
          break;
        case 'delete-silence':
          deleteRangePreservingDuration(edited, range, channels);
          break;
      }
    }

    return edited;
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
    onProgress?: (progress: ClipAudioRenderProgress) => void,
  ): Promise<AudioBuffer> {
    const effects = collectRenderableClipAudioEffectInstances(clip);
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
