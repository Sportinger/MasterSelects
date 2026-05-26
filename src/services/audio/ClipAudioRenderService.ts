import type { EffectRenderProgress } from '../../engine/audio/AudioEffectRenderer';
import { AudioEffectRenderer, audioEffectRenderer } from '../../engine/audio/AudioEffectRenderer';
import { AudioExtractor, audioExtractor } from '../../engine/audio/AudioExtractor';
import { TimeStretchProcessor, timeStretchProcessor, type TimeStretchProgress } from '../../engine/audio/TimeStretchProcessor';
import type { ClipAudioEditOperation, Keyframe, SpectralImageLayer, TimelineClip } from '../../types';
import { useMediaStore } from '../../stores/mediaStore';
import {
  collectProcessedAnalysisClipAudioEffectInstances,
  collectRenderableClipAudioEditOperations,
  collectRenderableClipAudioEffectInstances,
} from './processedWaveformEligibility';

export type ClipAudioRenderPhase =
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
  keyframes?: readonly Keyframe[];
  effectMode?: 'output' | 'analysis-shape';
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

function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

const SPECTRAL_IMAGE_MASK_MAX_WIDTH = 512;
const SPECTRAL_IMAGE_MASK_MAX_HEIGHT = 256;
const SPECTRAL_IMAGE_LAYER_SUBBANDS = 16;
const spectralImageMaskCache = new Map<string, Promise<SpectralImageLayerMask | null>>();

type SpectralImageLayerAutomatedProperty = 'opacity' | 'gainDb' | 'frequencyMin' | 'frequencyMax';

interface SpectralImageLayerRenderState {
  opacity: number;
  gainDb: number;
  frequencyMin: number;
  frequencyMax: number;
}

interface SpectralImageLayerAutomationPoint {
  time: number;
  value: number;
}

type SpectralImageLayerAutomationTracks = Partial<Record<SpectralImageLayerAutomatedProperty, SpectralImageLayerAutomationPoint[]>>;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isSpectralLayerEnabled(layer: SpectralImageLayer & { enabled?: boolean }): boolean {
  const hasAudibleKeyframe = (layer.keyframes ?? []).some(keyframe =>
    typeof keyframe.opacity === 'number' ? keyframe.opacity > 0 : false
  );
  return layer.enabled !== false && layer.duration > 0 && (layer.opacity > 0 || hasAudibleKeyframe);
}

function createSpectralLayerSampleRange(
  layer: SpectralImageLayer,
  clip: TimelineClip,
  buffer: AudioBuffer,
): { start: number; end: number } {
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const localStartSeconds = Math.max(0, layer.timeStart - clipSourceStart);
  const localEndSeconds = Math.max(localStartSeconds, layer.timeStart + layer.duration - clipSourceStart);
  const start = Math.max(0, Math.min(buffer.length, Math.floor(localStartSeconds * buffer.sampleRate)));
  const end = Math.max(start, Math.min(buffer.length, Math.ceil(localEndSeconds * buffer.sampleRate)));
  return { start, end };
}

function sampleSpectralImageMaskPixel(mask: SpectralImageLayerMask, x: number, y: number): number {
  const index = y * mask.width + x;
  const luminance = Math.max(0, Math.min(1, mask.luminance[index] ?? 0));
  const alpha = mask.alpha ? Math.max(0, Math.min(1, mask.alpha[index] ?? 1)) : 1;
  return luminance * alpha;
}

function sampleSpectralImageMask(mask: SpectralImageLayerMask, xUnit: number, yUnit: number): number {
  if (mask.width <= 1 && mask.height <= 1) {
    return sampleSpectralImageMaskPixel(mask, 0, 0);
  }

  const xFloat = clamp01(xUnit) * Math.max(0, mask.width - 1);
  const yFloat = clamp01(yUnit) * Math.max(0, mask.height - 1);
  const x0 = Math.max(0, Math.min(mask.width - 1, Math.floor(xFloat)));
  const y0 = Math.max(0, Math.min(mask.height - 1, Math.floor(yFloat)));
  const x1 = Math.max(0, Math.min(mask.width - 1, x0 + 1));
  const y1 = Math.max(0, Math.min(mask.height - 1, y0 + 1));
  const tx = xFloat - x0;
  const ty = yFloat - y0;

  const top = sampleSpectralImageMaskPixel(mask, x0, y0) * (1 - tx) +
    sampleSpectralImageMaskPixel(mask, x1, y0) * tx;
  const bottom = sampleSpectralImageMaskPixel(mask, x0, y1) * (1 - tx) +
    sampleSpectralImageMaskPixel(mask, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function createSpectralLayerAutomationTracks(layer: SpectralImageLayer): SpectralImageLayerAutomationTracks {
  const tracks: SpectralImageLayerAutomationTracks = {};
  for (const property of ['opacity', 'gainDb', 'frequencyMin', 'frequencyMax'] as const) {
    const points = (layer.keyframes ?? [])
      .filter(keyframe => typeof keyframe[property] === 'number' && Number.isFinite(keyframe[property]))
      .map(keyframe => ({
        time: keyframe.time,
        value: finiteNumber(keyframe[property], 0),
      }))
      .toSorted((a, b) => a.time - b.time);
    if (points.length > 0) {
      tracks[property] = points;
    }
  }
  return tracks;
}

function interpolateSpectralLayerProperty(
  tracks: SpectralImageLayerAutomationTracks,
  property: SpectralImageLayerAutomatedProperty,
  localTimeSeconds: number,
  fallback: number,
): number {
  const keyframes = tracks[property];
  if (!keyframes?.length) return fallback;

  const first = keyframes[0];
  const firstValue = first.value;
  if (localTimeSeconds <= first.time || keyframes.length === 1) return firstValue;

  const last = keyframes[keyframes.length - 1];
  const lastValue = last.value;
  if (localTimeSeconds >= last.time) return lastValue;

  for (let index = 1; index < keyframes.length; index += 1) {
    const prev = keyframes[index - 1];
    const next = keyframes[index];
    if (localTimeSeconds > next.time) continue;

    const span = Math.max(0.0001, next.time - prev.time);
    const mix = clamp01((localTimeSeconds - prev.time) / span);
    return prev.value + (next.value - prev.value) * mix;
  }

  return fallback;
}

function evaluateSpectralLayerRenderState(
  layer: SpectralImageLayer,
  automationTracks: SpectralImageLayerAutomationTracks,
  localTimeSeconds: number,
  nyquist: number,
): SpectralImageLayerRenderState {
  const rawMin = interpolateSpectralLayerProperty(automationTracks, 'frequencyMin', localTimeSeconds, layer.frequencyMin);
  const rawMax = interpolateSpectralLayerProperty(automationTracks, 'frequencyMax', localTimeSeconds, layer.frequencyMax);
  const frequencyMin = Math.max(20, Math.min(nyquist - 1, Math.min(rawMin, rawMax)));
  const frequencyMax = Math.max(frequencyMin + 1, Math.min(nyquist - 1, Math.max(rawMin, rawMax)));

  return {
    opacity: clamp01(interpolateSpectralLayerProperty(automationTracks, 'opacity', localTimeSeconds, layer.opacity)),
    gainDb: Math.max(-60, Math.min(24, interpolateSpectralLayerProperty(automationTracks, 'gainDb', localTimeSeconds, layer.gainDb))),
    frequencyMin,
    frequencyMax,
  };
}

function spectralImageLayerFrequencyUnion(
  layer: SpectralImageLayer,
  nyquist: number,
): { minHz: number; maxHz: number } {
  let minHz = Math.min(layer.frequencyMin, layer.frequencyMax);
  let maxHz = Math.max(layer.frequencyMin, layer.frequencyMax);
  for (const keyframe of layer.keyframes ?? []) {
    if (typeof keyframe.frequencyMin === 'number' && Number.isFinite(keyframe.frequencyMin)) {
      minHz = Math.min(minHz, keyframe.frequencyMin);
      maxHz = Math.max(maxHz, keyframe.frequencyMin);
    }
    if (typeof keyframe.frequencyMax === 'number' && Number.isFinite(keyframe.frequencyMax)) {
      minHz = Math.min(minHz, keyframe.frequencyMax);
      maxHz = Math.max(maxHz, keyframe.frequencyMax);
    }
  }

  const clampedMinHz = Math.max(20, Math.min(nyquist - 1, minHz));
  return {
    minHz: clampedMinHz,
    maxHz: Math.max(clampedMinHz + 1, Math.min(nyquist - 1, maxHz)),
  };
}

function spectralImageLayerGainDelta(
  layer: SpectralImageLayer,
  state: SpectralImageLayerRenderState,
  maskStrength: number,
): number {
  const strength = Math.max(0, Math.min(1, maskStrength * state.opacity));
  if (strength <= 0) return 0;

  switch (layer.blendMode) {
    case 'boost': {
      const targetGain = dbToLinearGain(Math.abs(finiteNumber(state.gainDb, 6)));
      return (targetGain - 1) * strength;
    }
    case 'gate':
    case 'sidechain-mask': {
      return strength - 1;
    }
    case 'replace': {
      const targetGain = dbToLinearGain(finiteNumber(state.gainDb, 0)) * strength;
      return targetGain - 1;
    }
    case 'attenuate':
    default: {
      const targetGain = dbToLinearGain(-Math.abs(finiteNumber(state.gainDb, -18)));
      return (targetGain - 1) * strength;
    }
  }
}

function spectralLayerFrequencyFeather(
  frequencyHz: number,
  minHz: number,
  maxHz: number,
  featherHz: number,
): number {
  if (featherHz <= 0) return 1;
  const low = Math.max(0, Math.min(1, (frequencyHz - minHz) / featherHz));
  const high = Math.max(0, Math.min(1, (maxHz - frequencyHz) / featherHz));
  return Math.min(low, high);
}

function chooseSpectralImageLayerFftSize(sampleRate: number, rangeLength: number): number {
  const target = nextPowerOfTwo(Math.max(512, Math.round(sampleRate * 0.046)));
  const bounded = nextPowerOfTwo(Math.max(64, Math.min(rangeLength, target)));
  return Math.max(64, Math.min(4096, bounded));
}

function deterministicSpectralImagePhase(channel: number, frameIndex: number, bin: number): number {
  const seed = (channel + 1) * 1013 + frameIndex * 9176 + bin * 37;
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * Math.PI * 2;
}

function wrapRadians(phase: number): number {
  const fullTurn = Math.PI * 2;
  const wrapped = phase % fullTurn;
  return wrapped < 0 ? wrapped + fullTurn : wrapped;
}

function synthesizedSpectralImagePhase(
  channel: number,
  frameIndex: number,
  bin: number,
  hopSize: number,
  fftSize: number,
): number {
  const initialPhase = deterministicSpectralImagePhase(channel, 0, bin);
  const phaseAdvance = (Math.PI * 2 * bin * hopSize * frameIndex) / Math.max(1, fftSize);
  return wrapRadians(initialPhase + phaseAdvance);
}

function setSymmetricFftBinMagnitude(
  real: Float32Array,
  imag: Float32Array,
  bin: number,
  magnitude: number,
  phase: number,
): void {
  const clampedMagnitude = Math.max(0, magnitude);
  real[bin] = Math.cos(phase) * clampedMagnitude;
  imag[bin] = Math.sin(phase) * clampedMagnitude;

  const positiveBinCount = Math.floor(real.length / 2);
  if (bin > 0 && bin < positiveBinCount) {
    const mirror = real.length - bin;
    real[mirror] = real[bin];
    imag[mirror] = -imag[bin];
  }
}

function applySpectralImageLayerResynthesis(
  buffer: AudioBuffer,
  clip: TimelineClip,
  layer: SpectralImageLayer,
  mask: SpectralImageLayerMask,
): void {
  const range = createSpectralLayerSampleRange(layer, clip, buffer);
  const rangeLength = Math.max(0, range.end - range.start);
  if (rangeLength < 4) return;

  const nyquist = Math.max(20, buffer.sampleRate / 2 - 1);
  const frequencyUnion = spectralImageLayerFrequencyUnion(layer, nyquist);
  if (frequencyUnion.maxHz <= frequencyUnion.minHz) return;

  const fftSize = chooseSpectralImageLayerFftSize(buffer.sampleRate, rangeLength);
  const hopSize = Math.max(1, Math.floor(fftSize / 4));
  const window = hannWindow(fftSize);
  const automationTracks = createSpectralLayerAutomationTracks(layer);
  const featherSamples = Math.max(0, Math.min(
    Math.floor(rangeLength / 2),
    Math.round(finiteNumber(layer.featherTime, 0) * buffer.sampleRate),
  ));
  const featherHz = Math.max(0, finiteNumber(layer.featherFrequency, 0));
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const frameStartOffset = -Math.floor(fftSize / 2);
  const frameCount = Math.max(1, Math.ceil((rangeLength - frameStartOffset) / hopSize));
  const positiveBinCount = Math.floor(fftSize / 2);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const output = new Float32Array(rangeLength);
    const normalization = new Float32Array(rangeLength);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameStart = frameStartOffset + frameIndex * hopSize;
      real.fill(0);
      imag.fill(0);
      let framePower = 0;
      let frameSampleCount = 0;

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        const sample = localIndex >= 0 && localIndex < rangeLength ? data[range.start + localIndex] ?? 0 : 0;
        framePower += sample * sample;
        frameSampleCount += 1;
        real[sampleOffset] = sample * window[sampleOffset];
      }

      fftRadix2(real, imag);

      const frameCenter = frameStart + fftSize / 2;
      const frameCenterSourceSeconds = clipSourceStart + (range.start + frameCenter) / buffer.sampleRate;
      const localTimeSeconds = Math.max(0, frameCenterSourceSeconds - layer.timeStart);
      const state = evaluateSpectralLayerRenderState(layer, automationTracks, localTimeSeconds, nyquist);
      const timeFeather = rangeFeatherFactor(Math.max(0, Math.min(rangeLength - 1, Math.round(frameCenter))), { start: 0, end: rangeLength }, featherSamples);
      const xUnit = clamp01(frameCenter / Math.max(1, rangeLength - 1));
      const frameRms = Math.sqrt(framePower / Math.max(1, frameSampleCount));
      const floorMagnitude = Math.max(frameRms * fftSize * 0.25, 0.0015 * fftSize);
      const sourcePhaseThreshold = Math.max(0.000001, floorMagnitude * 0.02);
      const gain = Math.max(0, Math.min(8, dbToLinearGain(state.gainDb)));

      if (state.opacity > 0 && timeFeather > 0) {
        for (let bin = 0; bin <= positiveBinCount; bin += 1) {
          const frequencyHz = (bin * buffer.sampleRate) / fftSize;
          if (frequencyHz < state.frequencyMin || frequencyHz > state.frequencyMax) continue;
          const frequencyFeather = spectralLayerFrequencyFeather(
            frequencyHz,
            state.frequencyMin,
            state.frequencyMax,
            featherHz,
          );
          if (frequencyFeather <= 0) continue;

          const activeFrequencyUnit = clamp01((frequencyHz - state.frequencyMin) / Math.max(1, state.frequencyMax - state.frequencyMin));
          const imageY = 1 - activeFrequencyUnit;
          const maskStrength = sampleSpectralImageMask(mask, xUnit, imageY);
          const strength = clamp01(maskStrength * state.opacity * timeFeather * frequencyFeather);
          if (strength <= 0) continue;

          const currentReal = real[bin] ?? 0;
          const currentImag = imag[bin] ?? 0;
          const currentMagnitude = Math.hypot(currentReal, currentImag);
          const targetMagnitude = floorMagnitude * gain * maskStrength;
          const nextMagnitude = currentMagnitude * (1 - strength) + targetMagnitude * strength;
          const phase = currentMagnitude > sourcePhaseThreshold
            ? Math.atan2(currentImag, currentReal)
            : synthesizedSpectralImagePhase(channel, frameIndex, bin, hopSize, fftSize);
          setSymmetricFftBinMagnitude(real, imag, bin, nextMagnitude, phase);
        }
      }

      fftRadix2(real, imag, true);

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        if (localIndex < 0 || localIndex >= rangeLength) continue;
        const windowValue = window[sampleOffset];
        output[localIndex] += real[sampleOffset] * windowValue;
        normalization[localIndex] += windowValue * windowValue;
      }
    }

    for (let localIndex = 0; localIndex < rangeLength; localIndex += 1) {
      const normalized = normalization[localIndex] > 0.000001
        ? output[localIndex] / normalization[localIndex]
        : data[range.start + localIndex] ?? 0;
      data[range.start + localIndex] = normalized;
    }
  }
}

function applySpectralImageLayer(
  buffer: AudioBuffer,
  clip: TimelineClip,
  layer: SpectralImageLayer,
  mask: SpectralImageLayerMask,
): void {
  if (layer.blendMode === 'replace') {
    applySpectralImageLayerResynthesis(buffer, clip, layer, mask);
    return;
  }

  const range = createSpectralLayerSampleRange(layer, clip, buffer);
  if (range.end <= range.start) return;

  const nyquist = Math.max(20, buffer.sampleRate / 2 - 1);
  const frequencyUnion = spectralImageLayerFrequencyUnion(layer, nyquist);
  if (frequencyUnion.maxHz <= frequencyUnion.minHz) return;

  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(layer.featherTime, 0) * buffer.sampleRate),
  ));
  const featherHz = Math.max(0, finiteNumber(layer.featherFrequency, 0));
  const clipSourceStart = Math.max(0, finiteNumber(clip.inPoint, 0));
  const automationTracks = createSpectralLayerAutomationTracks(layer);
  const subbandCount = Math.max(1, Math.min(
    SPECTRAL_IMAGE_LAYER_SUBBANDS,
    mask.height,
    Math.ceil((frequencyUnion.maxHz - frequencyUnion.minHz) / 120),
  ));

  for (let subband = 0; subband < subbandCount; subband += 1) {
    const subStartUnit = subband / subbandCount;
    const subEndUnit = (subband + 1) / subbandCount;
    const subMinHz = frequencyUnion.minHz + (frequencyUnion.maxHz - frequencyUnion.minHz) * subStartUnit;
    const subMaxHz = frequencyUnion.minHz + (frequencyUnion.maxHz - frequencyUnion.minHz) * subEndUnit;
    const subCenterUnit = (subStartUnit + subEndUnit) / 2;
    const subCenterHz = frequencyUnion.minHz + (frequencyUnion.maxHz - frequencyUnion.minHz) * subCenterUnit;
    const coefficients = createBandpassCoefficients(buffer.sampleRate, subMinHz, subMaxHz);
    if (!coefficients) continue;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;

      for (let sample = range.start; sample < range.end; sample += 1) {
        const x0 = data[sample] ?? 0;
        const band = coefficients.b0 * x0 +
          coefficients.b1 * x1 +
          coefficients.b2 * x2 -
          coefficients.a1 * y1 -
          coefficients.a2 * y2;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = band;

        const sourceTimeSeconds = clipSourceStart + sample / buffer.sampleRate;
        const localTimeSeconds = Math.max(0, sourceTimeSeconds - layer.timeStart);
        const state = evaluateSpectralLayerRenderState(layer, automationTracks, localTimeSeconds, nyquist);
        if (state.opacity <= 0 || subCenterHz < state.frequencyMin || subCenterHz > state.frequencyMax) continue;

        const frequencyFeather = spectralLayerFrequencyFeather(
          subCenterHz,
          state.frequencyMin,
          state.frequencyMax,
          featherHz,
        );
        if (frequencyFeather <= 0) continue;

        const xUnit = (sample - range.start) / Math.max(1, range.end - range.start - 1);
        const activeFrequencyUnit = clamp01((subCenterHz - state.frequencyMin) / Math.max(1, state.frequencyMax - state.frequencyMin));
        const imageY = 1 - activeFrequencyUnit;
        const maskStrength = sampleSpectralImageMask(mask, xUnit, imageY);
        const timeFeather = rangeFeatherFactor(sample, range, featherSamples);
        const delta = spectralImageLayerGainDelta(layer, state, maskStrength) * timeFeather * frequencyFeather;
        data[sample] = x0 + band * delta;
      }
    }
  }
}

async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return null;
  const image = new Image();
  image.decoding = 'async';
  image.crossOrigin = 'anonymous';
  return new Promise((resolve) => {
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function defaultSpectralImageLayerMaskProvider(
  layer: SpectralImageLayer,
): Promise<SpectralImageLayerMask | null> {
  if (typeof document === 'undefined') return null;
  const mediaFile = useMediaStore.getState().files.find(file => file.id === layer.imageMediaFileId);
  if (!mediaFile || mediaFile.type !== 'image') return null;

  const src = mediaFile.url || mediaFile.thumbnailUrl;
  if (!src) return null;

  const cacheKey = `${mediaFile.id}:${src}:${mediaFile.fileHash ?? ''}`;
  let promise = spectralImageMaskCache.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const image = await loadImageElement(src);
      if (!image) return null;

      const scale = Math.min(
        1,
        SPECTRAL_IMAGE_MASK_MAX_WIDTH / Math.max(1, image.naturalWidth || image.width),
        SPECTRAL_IMAGE_MASK_MAX_HEIGHT / Math.max(1, image.naturalHeight || image.height),
      );
      const width = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, width, height);

      try {
        const data = ctx.getImageData(0, 0, width, height).data;
        const luminance = new Float32Array(width * height);
        const alpha = new Float32Array(width * height);
        for (let index = 0; index < width * height; index += 1) {
          const offset = index * 4;
          const r = data[offset] ?? 0;
          const g = data[offset + 1] ?? 0;
          const b = data[offset + 2] ?? 0;
          luminance[index] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          alpha[index] = (data[offset + 3] ?? 255) / 255;
        }
        return { width, height, luminance, alpha };
      } catch {
        return null;
      }
    })();
    spectralImageMaskCache.set(cacheKey, promise);
  }

  return promise;
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

function splitStereoRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  if (buffer.numberOfChannels <= 0 || channels.length === 0) return;
  const sourceChannel = Math.max(
    0,
    Math.min(buffer.numberOfChannels - 1, Math.round(finiteNumber(operation.params.sourceChannel, channels[0] ?? 0))),
  );
  const source = buffer.getChannelData(sourceChannel).slice(range.start, range.end);

  for (const channel of channels) {
    const target = buffer.getChannelData(channel);
    for (let localIndex = 0; localIndex < source.length; localIndex += 1) {
      target[range.start + localIndex] = source[localIndex] ?? 0;
    }
  }
}

function parseRoomToneSourceRanges(operation: ClipAudioEditOperation): Array<{ start: number; end: number }> {
  const encoded = operation.params.roomToneSourceRanges;
  if (typeof encoded === 'string') {
    try {
      const parsed = JSON.parse(encoded) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map(range => {
            if (!range || typeof range !== 'object') return null;
            const current = range as { start?: unknown; end?: unknown };
            if (typeof current.start !== 'number' || typeof current.end !== 'number') return null;
            return {
              start: Math.min(current.start, current.end),
              end: Math.max(current.start, current.end),
            };
          })
          .filter((range): range is { start: number; end: number } => Boolean(range && range.end > range.start));
      }
    } catch {
      // Fall back to sourceInPoint/sourceOutPoint below.
    }
  }

  const sourceInPoint = finiteNumber(operation.params.sourceInPoint, Number.NaN);
  const sourceOutPoint = finiteNumber(operation.params.sourceOutPoint, Number.NaN);
  if (Number.isFinite(sourceInPoint) && Number.isFinite(sourceOutPoint) && Math.abs(sourceOutPoint - sourceInPoint) > 0.0005) {
    return [{
      start: Math.min(sourceInPoint, sourceOutPoint),
      end: Math.max(sourceInPoint, sourceOutPoint),
    }];
  }

  return [];
}

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function collectRoomToneSamples(
  buffer: AudioBuffer,
  clip: TimelineClip,
  operation: ClipAudioEditOperation,
  channel: number,
  targetRange: { start: number; end: number },
): Float32Array {
  const sourceRanges = parseRoomToneSourceRanges(operation)
    .map(sourceRange => getOperationSampleRange({ ...operation, timeRange: sourceRange }, clip, buffer))
    .filter(sourceRange =>
      sourceRange.end > sourceRange.start &&
      (sourceRange.end <= targetRange.start || sourceRange.start >= targetRange.end)
    );
  const sampleCount = sourceRanges.reduce((sum, sourceRange) => sum + sourceRange.end - sourceRange.start, 0);
  if (sampleCount <= 0) return new Float32Array();

  const source = buffer.getChannelData(channel);
  const samples = new Float32Array(sampleCount);
  let cursor = 0;
  for (const sourceRange of sourceRanges) {
    const slice = source.subarray(sourceRange.start, sourceRange.end);
    samples.set(slice, cursor);
    cursor += slice.length;
  }
  return samples;
}

function loopRoomToneSample(
  samples: Float32Array,
  index: number,
  crossfadeSamples: number,
): number {
  if (samples.length === 0) return 0;
  const position = index % samples.length;
  if (crossfadeSamples <= 0 || samples.length <= crossfadeSamples * 2 || position >= crossfadeSamples) {
    return samples[position] ?? 0;
  }

  const tailPosition = samples.length - crossfadeSamples + position;
  const mix = position / crossfadeSamples;
  return (samples[tailPosition] ?? 0) * (1 - mix) + (samples[position] ?? 0) * mix;
}

function fillRangeWithRoomTone(
  buffer: AudioBuffer,
  clip: TimelineClip,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const gain = dbToLinearGain(finiteNumber(operation.params.roomToneGainDb, 0));
  const generatedGain = dbToLinearGain(finiteNumber(operation.params.generatedNoiseDb, -66));
  const crossfadeSamples = Math.max(0, Math.round(finiteNumber(operation.params.crossfadeSeconds, 0.025) * buffer.sampleRate));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    const toneSamples = collectRoomToneSamples(buffer, clip, operation, channel, range);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const localIndex = sample - range.start;
      const edge = rangeFeatherFactor(sample, range, Math.min(crossfadeSamples, Math.floor((range.end - range.start) / 2)));
      const generated = deterministicNoise((channel + 1) * 100000 + localIndex) * generatedGain;
      const sourceTone = toneSamples.length > 0
        ? loopRoomToneSample(toneSamples, localIndex, crossfadeSamples) * gain
        : generated;
      data[sample] = sourceTone * edge + (data[sample] ?? 0) * (1 - edge);
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

function normalizeCompactDeleteRanges(
  ranges: readonly { start: number; end: number }[],
  bufferLength: number,
): Array<{ start: number; end: number }> {
  const normalized = ranges
    .map(range => ({
      start: Math.max(0, Math.min(bufferLength, Math.min(range.start, range.end))),
      end: Math.max(0, Math.min(bufferLength, Math.max(range.start, range.end))),
    }))
    .filter(range => range.end > range.start)
    .toSorted((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function deleteRangesCompactingDuration(
  buffer: AudioBuffer,
  ranges: readonly { start: number; end: number }[],
): AudioBuffer {
  const compactRanges = normalizeCompactDeleteRanges(ranges, buffer.length);
  const deletedSamples = compactRanges.reduce((sum, range) => sum + range.end - range.start, 0);
  if (deletedSamples <= 0) return buffer;

  const compacted = createAudioBuffer(
    buffer.numberOfChannels,
    Math.max(1, buffer.length - deletedSamples),
    buffer.sampleRate,
  );

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = compacted.getChannelData(channel);
    let sourceCursor = 0;
    let targetCursor = 0;

    for (const range of compactRanges) {
      const copyEnd = Math.max(sourceCursor, range.start);
      if (copyEnd > sourceCursor) {
        target.set(source.subarray(sourceCursor, copyEnd), targetCursor);
        targetCursor += copyEnd - sourceCursor;
      }
      sourceCursor = Math.max(sourceCursor, range.end);
    }

    if (sourceCursor < buffer.length && targetCursor < target.length) {
      target.set(source.subarray(sourceCursor), targetCursor);
    }
  }

  return compacted;
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

function createBandpassCoefficients(
  sampleRate: number,
  frequencyMinHz: number,
  frequencyMaxHz: number,
): {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
} | null {
  const nyquist = sampleRate / 2;
  const minHz = Math.max(20, Math.min(nyquist - 1, frequencyMinHz));
  const maxHz = Math.max(minHz + 1, Math.min(nyquist - 1, frequencyMaxHz));
  if (maxHz <= minHz || nyquist <= 20) return null;

  const centerHz = Math.max(20, Math.min(nyquist - 1, Math.sqrt(minHz * maxHz)));
  const bandwidthHz = Math.max(1, maxHz - minHz);
  const q = Math.max(0.2, Math.min(32, centerHz / bandwidthHz));
  const omega = 2 * Math.PI * (centerHz / sampleRate);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const a0 = 1 + alpha;

  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applySpectralBandGainRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const frequencyMinHz = finiteNumber(operation.params.frequencyMinHz, 0);
  const frequencyMaxHz = finiteNumber(operation.params.frequencyMaxHz, 0);
  const gainDb = finiteNumber(operation.params.gainDb, operation.type === 'spectral-mask' ? -18 : 6);
  const bandGain = Math.max(0, Math.min(8, dbToLinearGain(gainDb)));
  const bandDelta = bandGain - 1;
  if (range.end <= range.start || Math.abs(bandDelta) < 0.001) return;

  const coefficients = createBandpassCoefficients(buffer.sampleRate, frequencyMinHz, frequencyMaxHz);
  if (!coefficients) return;

  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.015) * buffer.sampleRate),
  ));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let sample = range.start; sample < range.end; sample += 1) {
      const x0 = data[sample] ?? 0;
      const band = coefficients.b0 * x0 +
        coefficients.b1 * x1 +
        coefficients.b2 * x2 -
        coefficients.a1 * y1 -
        coefficients.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = band;

      const distanceToEdge = Math.min(sample - range.start, range.end - 1 - sample);
      const feather = featherSamples > 0
        ? Math.max(0, Math.min(1, distanceToEdge / featherSamples))
        : 1;
      data[sample] = x0 + band * bandDelta * feather;
    }
  }
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function chooseSpectralResynthesisFftSize(
  operation: ClipAudioEditOperation,
  sampleRate: number,
  rangeLength: number,
): number {
  const requested = finiteNumber(operation.params.fftSize, Number.NaN);
  if (isPowerOfTwo(requested) && requested >= 64 && requested <= 8192) {
    return requested;
  }

  const target = nextPowerOfTwo(Math.max(64, Math.round(sampleRate * 0.046)));
  const boundedByRange = Math.max(64, Math.min(4096, nextPowerOfTwo(Math.max(64, Math.min(rangeLength, target)))));
  return boundedByRange;
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window.fill(1);
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}

function fftRadix2(real: Float32Array, imag: Float32Array, inverse = false): void {
  const n = real.length;
  if (n !== imag.length || !isPowerOfTwo(n)) {
    throw new Error('FFT buffers must be equal power-of-two lengths.');
  }

  let j = 0;
  for (let i = 1; i < n - 1; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const realSwap = real[i];
      real[i] = real[j];
      real[j] = realSwap;
      const imagSwap = imag[i];
      imag[i] = imag[j];
      imag[j] = imagSwap;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const phaseStepReal = Math.cos(angle);
    const phaseStepImag = Math.sin(angle);

    for (let offset = 0; offset < n; offset += size) {
      let phaseReal = 1;
      let phaseImag = 0;
      for (let index = 0; index < half; index += 1) {
        const evenIndex = offset + index;
        const oddIndex = evenIndex + half;
        const oddReal = real[oddIndex] * phaseReal - imag[oddIndex] * phaseImag;
        const oddImag = real[oddIndex] * phaseImag + imag[oddIndex] * phaseReal;
        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextPhaseReal = phaseReal * phaseStepReal - phaseImag * phaseStepImag;
        phaseImag = phaseReal * phaseStepImag + phaseImag * phaseStepReal;
        phaseReal = nextPhaseReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < n; index += 1) {
      real[index] /= n;
      imag[index] /= n;
    }
  }
}

function frequencyBandWeight(
  frequencyHz: number,
  minHz: number,
  maxHz: number,
  featherHz: number,
): number {
  if (frequencyHz < minHz - featherHz || frequencyHz > maxHz + featherHz) return 0;
  if (frequencyHz >= minHz && frequencyHz <= maxHz) return 1;
  if (featherHz <= 0) return 0;

  if (frequencyHz < minHz) {
    return Math.max(0, Math.min(1, (frequencyHz - (minHz - featherHz)) / featherHz));
  }
  return Math.max(0, Math.min(1, ((maxHz + featherHz) - frequencyHz) / featherHz));
}

function spectralBrushWeight(
  operation: ClipAudioEditOperation,
  frameCenterSeconds: number,
  frequencyHz: number,
  rangeDurationSeconds: number,
  minHz: number,
  maxHz: number,
): number {
  if (operation.params.selectionMode !== 'brush') return 1;

  const timeRadiusSeconds = Math.max(
    0.001,
    finiteNumber(operation.params.brushTimeRadiusSeconds, rangeDurationSeconds / 2),
  );
  const frequencyRadiusHz = Math.max(
    1,
    finiteNumber(operation.params.brushFrequencyRadiusHz, Math.max(1, (maxHz - minHz) / 2)),
  );
  const timeCenterSeconds = rangeDurationSeconds / 2;
  const frequencyCenterHz = (minHz + maxHz) / 2;
  const normalizedTime = Math.abs(frameCenterSeconds - timeCenterSeconds) / timeRadiusSeconds;
  const normalizedFrequency = Math.abs(frequencyHz - frequencyCenterHz) / frequencyRadiusHz;
  const distance = Math.sqrt(normalizedTime * normalizedTime + normalizedFrequency * normalizedFrequency);
  if (distance >= 1) return 0;
  if (distance <= 0.55) return 1;
  const edge = (distance - 0.55) / 0.45;
  return Math.max(0, Math.min(1, 1 - edge * edge * (3 - 2 * edge)));
}

function applySpectralResynthesisRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const rangeLength = Math.max(0, range.end - range.start);
  if (rangeLength < 4) return;

  const nyquist = buffer.sampleRate / 2;
  const frequencyMinHz = Math.max(0, Math.min(nyquist, finiteNumber(operation.params.frequencyMinHz, 0)));
  const frequencyMaxHz = Math.max(frequencyMinHz, Math.min(nyquist, finiteNumber(operation.params.frequencyMaxHz, nyquist)));
  const gainDb = finiteNumber(operation.params.gainDb, 6);
  const spectralGain = Math.max(0, Math.min(8, dbToLinearGain(gainDb)));
  const gainDelta = spectralGain - 1;
  if (frequencyMaxHz <= frequencyMinHz || Math.abs(gainDelta) < 0.001) return;

  const fftSize = chooseSpectralResynthesisFftSize(operation, buffer.sampleRate, rangeLength);
  const hopSize = Math.max(1, Math.floor(finiteNumber(operation.params.hopSize, fftSize / 4)));
  const window = hannWindow(fftSize);
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const output = new Float32Array(rangeLength);
  const normalization = new Float32Array(rangeLength);
  const featherHz = Math.max(0, finiteNumber(operation.params.featherFrequencyHz, Math.max(12, (frequencyMaxHz - frequencyMinHz) * 0.08)));
  const rangeDurationSeconds = rangeLength / buffer.sampleRate;
  const frameStartOffset = -Math.floor(fftSize / 2);
  const frameCount = Math.max(1, Math.ceil((rangeLength - frameStartOffset) / hopSize));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    output.fill(0);
    normalization.fill(0);

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameStart = frameStartOffset + frameIndex * hopSize;
      real.fill(0);
      imag.fill(0);

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        const sample = localIndex >= 0 && localIndex < rangeLength ? data[range.start + localIndex] ?? 0 : 0;
        real[sampleOffset] = sample * window[sampleOffset];
      }

      fftRadix2(real, imag);

      const frameCenterSeconds = (frameStart + fftSize / 2) / buffer.sampleRate;
      const positiveBinCount = Math.floor(fftSize / 2);
      for (let bin = 0; bin <= positiveBinCount; bin += 1) {
        const frequencyHz = (bin * buffer.sampleRate) / fftSize;
        const bandWeight = frequencyBandWeight(frequencyHz, frequencyMinHz, frequencyMaxHz, featherHz);
        if (bandWeight <= 0) continue;
        const brushWeight = spectralBrushWeight(
          operation,
          frameCenterSeconds,
          frequencyHz,
          rangeDurationSeconds,
          frequencyMinHz,
          frequencyMaxHz,
        );
        const weight = bandWeight * brushWeight;
        if (weight <= 0) continue;

        const scale = 1 + gainDelta * weight;
        real[bin] *= scale;
        imag[bin] *= scale;

        if (bin > 0 && bin < positiveBinCount) {
          const mirror = fftSize - bin;
          real[mirror] *= scale;
          imag[mirror] *= scale;
        }
      }

      fftRadix2(real, imag, true);

      for (let sampleOffset = 0; sampleOffset < fftSize; sampleOffset += 1) {
        const localIndex = frameStart + sampleOffset;
        if (localIndex < 0 || localIndex >= rangeLength) continue;
        const windowValue = window[sampleOffset];
        output[localIndex] += real[sampleOffset] * windowValue;
        normalization[localIndex] += windowValue * windowValue;
      }
    }

    const featherSamples = Math.max(0, Math.min(
      Math.floor(rangeLength / 2),
      Math.round(finiteNumber(operation.params.featherTime, 0.015) * buffer.sampleRate),
    ));
    for (let localIndex = 0; localIndex < rangeLength; localIndex += 1) {
      const normalized = normalization[localIndex] > 0.000001
        ? output[localIndex] / normalization[localIndex]
        : data[range.start + localIndex] ?? 0;
      const blend = rangeFeatherFactor(localIndex, { start: 0, end: rangeLength }, featherSamples);
      const source = data[range.start + localIndex] ?? 0;
      data[range.start + localIndex] = source * (1 - blend) + normalized * blend;
    }
  }
}

function rangeFeatherFactor(
  sample: number,
  range: { start: number; end: number },
  featherSamples: number,
): number {
  if (featherSamples <= 0) return 1;
  const distanceToEdge = Math.min(sample - range.start, range.end - 1 - sample);
  return Math.max(0, Math.min(1, (distanceToEdge + 1) / featherSamples));
}

function createNotchCoefficients(
  sampleRate: number,
  frequencyHz: number,
  q: number,
): {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
} | null {
  const nyquist = sampleRate / 2;
  const frequency = Math.max(20, Math.min(nyquist - 1, frequencyHz));
  if (frequency <= 0 || frequency >= nyquist || nyquist <= 20) return null;

  const clampedQ = Math.max(0.5, Math.min(100, q));
  const omega = 2 * Math.PI * (frequency / sampleRate);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * clampedQ);
  const a0 = 1 + alpha;

  return {
    b0: 1 / a0,
    b1: (-2 * cos) / a0,
    b2: 1 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyNotchFilterRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  frequencyHz: number,
  q: number,
  featherSamples: number,
): void {
  const coefficients = createNotchCoefficients(buffer.sampleRate, frequencyHz, q);
  if (!coefficients) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let sample = range.start; sample < range.end; sample += 1) {
      const x0 = data[sample] ?? 0;
      const filtered = coefficients.b0 * x0 +
        coefficients.b1 * x1 +
        coefficients.b2 * x2 -
        coefficients.a1 * y1 -
        coefficients.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = filtered;

      const feather = rangeFeatherFactor(sample, range, featherSamples);
      data[sample] = x0 + (filtered - x0) * feather;
    }
  }
}

function applyHumNotchRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const baseFrequencyHz = Math.max(20, finiteNumber(operation.params.baseFrequencyHz, 50));
  const harmonicCount = Math.max(1, Math.min(16, Math.round(finiteNumber(operation.params.harmonicCount, 6))));
  const q = finiteNumber(operation.params.q, 35);
  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.02) * buffer.sampleRate),
  ));

  for (let harmonic = 1; harmonic <= harmonicCount; harmonic += 1) {
    const frequencyHz = baseFrequencyHz * harmonic;
    if (frequencyHz >= buffer.sampleRate / 2 - 1) break;
    applyNotchFilterRange(buffer, range, channels, frequencyHz, q, featherSamples);
  }
}

function applyDeClickRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  if (range.end - range.start < 3) return;

  const threshold = Math.max(0.01, finiteNumber(operation.params.threshold, 0.35));
  const ratio = Math.max(1, finiteNumber(operation.params.ratio, 4));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    const original = data.slice(range.start, range.end);
    for (let local = 1; local < original.length - 1; local += 1) {
      const previous = original[local - 1] ?? 0;
      const current = original[local] ?? 0;
      const next = original[local + 1] ?? 0;
      const prediction = (previous + next) / 2;
      const residual = Math.abs(current - prediction);
      const neighborEnergy = (Math.abs(previous) + Math.abs(next)) / 2;
      if (residual >= threshold && residual >= neighborEnergy * ratio) {
        data[range.start + local] = prediction;
      }
    }
  }
}

function applySpliceSmoothRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const edgeSeconds = Math.max(0.001, finiteNumber(operation.params.edgeSeconds, 0.008));
  const edgeSamples = Math.max(1, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(edgeSeconds * buffer.sampleRate),
  ));
  if (edgeSamples <= 0) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    if (range.start > 0) {
      const leftAnchor = data[range.start - 1] ?? 0;
      for (let index = 0; index < edgeSamples; index += 1) {
        const sample = range.start + index;
        const t = (index + 1) / (edgeSamples + 1);
        const smooth = t * t * (3 - 2 * t);
        data[sample] = leftAnchor * (1 - smooth) + (data[sample] ?? 0) * smooth;
      }
    }

    if (range.end < buffer.length) {
      const rightAnchor = data[range.end] ?? 0;
      for (let index = 0; index < edgeSamples; index += 1) {
        const sample = range.end - 1 - index;
        const t = (index + 1) / (edgeSamples + 1);
        const smooth = t * t * (3 - 2 * t);
        data[sample] = rightAnchor * (1 - smooth) + (data[sample] ?? 0) * smooth;
      }
    }
  }
}

function applyLoudnessMatchRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const value = data[sample] ?? 0;
      sum += value * value;
      count += 1;
    }
  }
  if (count === 0) return;

  const rms = Math.sqrt(sum / count);
  if (rms <= 0.000001) return;

  const targetDb = finiteNumber(operation.params.targetDb, finiteNumber(operation.params.targetLufs, -20));
  const minGain = dbToLinearGain(finiteNumber(operation.params.minGainDb, -24));
  const maxGain = dbToLinearGain(finiteNumber(operation.params.maxGainDb, 24));
  const targetRms = dbToLinearGain(targetDb);
  const gain = Math.max(minGain, Math.min(maxGain, targetRms / rms));
  if (Math.abs(gain - 1) < 0.001) return;

  const featherSamples = Math.max(0, Math.min(
    Math.floor((range.end - range.start) / 2),
    Math.round(finiteNumber(operation.params.featherTime, 0.01) * buffer.sampleRate),
  ));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const feather = rangeFeatherFactor(sample, range, featherSamples);
      data[sample] = (data[sample] ?? 0) * (1 + (gain - 1) * feather);
    }
  }
}

function applyTransientSoftenRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  const rangeLength = range.end - range.start;
  if (rangeLength <= 1) return;

  const requestedGainDb = finiteNumber(operation.params.gainDb, -6);
  const targetGain = dbToLinearGain(Math.min(0, Math.max(-36, requestedGainDb)));
  if (Math.abs(targetGain - 1) < 0.001) return;

  const halfRange = Math.max(1, Math.floor(rangeLength / 2));
  const attackSamples = Math.max(1, Math.min(
    halfRange,
    Math.round(finiteNumber(operation.params.attackSeconds, 0.002) * buffer.sampleRate),
  ));
  const releaseSamples = Math.max(1, Math.min(
    halfRange,
    Math.round(finiteNumber(operation.params.releaseSeconds, 0.018) * buffer.sampleRate),
  ));

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    for (let sample = range.start; sample < range.end; sample += 1) {
      const local = sample - range.start;
      const fromEnd = range.end - 1 - sample;
      const attack = Math.min(1, local / attackSamples);
      const release = Math.min(1, fromEnd / releaseSamples);
      const envelope = Math.max(0, Math.min(1, Math.min(attack, release)));
      const smooth = envelope * envelope * (3 - 2 * envelope);
      data[sample] = (data[sample] ?? 0) * (1 + (targetGain - 1) * smooth);
    }
  }
}

function applyRepairRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  operation: ClipAudioEditOperation,
): void {
  switch (operation.params.repairType) {
    case 'hum-notch':
      applyHumNotchRepairRange(buffer, range, channels, operation);
      break;
    case 'de-click':
      applyDeClickRepairRange(buffer, range, channels, operation);
      break;
    case 'splice-smooth':
      applySpliceSmoothRepairRange(buffer, range, channels, operation);
      break;
    case 'loudness-match':
      applyLoudnessMatchRepairRange(buffer, range, channels, operation);
      break;
    case 'transient-soften':
      applyTransientSoftenRepairRange(buffer, range, channels, operation);
      break;
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
  private readonly spectralImageLayerMaskProvider: SpectralImageLayerMaskProvider;

  constructor(options: ClipAudioRenderServiceOptions = {}) {
    this.effectRenderer = options.effectRenderer ?? audioEffectRenderer;
    this.timeStretchProcessor = options.timeStretchProcessor ?? timeStretchProcessor;
    this.extractor = options.extractor ?? audioExtractor;
    this.spectralImageLayerMaskProvider = options.spectralImageLayerMaskProvider ?? defaultSpectralImageLayerMaskProvider;
  }

  async render(request: ClipAudioRenderRequest): Promise<ClipAudioRenderResult> {
    const { clip, sourceBuffer, keyframes = [], effectMode = 'output', onProgress } = request;

    let processedBuffer = this.trimClipBuffer(clip, sourceBuffer, onProgress);
    processedBuffer = this.renderEditStack(clip, processedBuffer, onProgress);
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
      processedBuffer = await this.renderEffects(clip, processedBuffer, keyframes, effectMode, onProgress);
    }

    emitProgress(onProgress, {
      phase: 'complete',
      percent: 100,
      message: 'Clip audio render complete',
    });

    return { buffer: processedBuffer };
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
    const compactDeleteRanges: Array<{ start: number; end: number }> = [];
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
        case 'split-stereo':
          splitStereoRange(edited, range, channels, operation);
          break;
        case 'insert-silence':
          insertSilencePreservingDuration(edited, range, channels, operation);
          break;
        case 'delete-silence':
          if (operation.params.compactTimeline === true) {
            compactDeleteRanges.push(range);
          } else {
            deleteRangePreservingDuration(edited, range, channels);
          }
          break;
        case 'repair':
          applyRepairRange(edited, range, channels, operation);
          break;
        case 'room-tone-fill':
          fillRangeWithRoomTone(edited, clip, range, channels, operation);
          break;
        case 'spectral-mask':
          applySpectralBandGainRange(edited, range, channels, operation);
          break;
        case 'spectral-resynthesis':
          applySpectralResynthesisRange(edited, range, channels, operation);
          break;
      }
    }

    if (compactDeleteRanges.length > 0) {
      return deleteRangesCompactingDuration(edited, compactDeleteRanges);
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
