import { blobToArrayBuffer } from '../../../artifacts';
import type { AudioSignalArtifactRef, ClipAudioStemLayer, ClipAudioStemState } from '../../../types/audio';
import type { AudioArtifactStore } from '../AudioArtifactStore';
import {
  decodeStemPcmF32Payload,
  STEM_PCM_F32_MIME_TYPE,
} from './stemPcm';
import { STEM_SOURCE_LAYER_ID } from './stemSourceLayer';
import { createBuffer } from '../../../engine/audio/audioBufferFactory';

export interface StemAudioBufferFactory {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  decodeAudioData?: (audioData: ArrayBuffer) => Promise<AudioBuffer>;
}

export interface StemAudioSourceResolverOptions {
  artifactStore: Pick<AudioArtifactStore, 'getPayload'>;
  audioBufferFactory?: StemAudioBufferFactory;
}

export interface StemAudioSourceResolution {
  mode: 'original' | 'stems';
  buffer: AudioBuffer | null;
  usedStemIds: string[];
  missingStems: ClipAudioStemLayer[];
}

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor {
  const maybeWindow = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const ctor = globalThis.AudioContext ?? maybeWindow.webkitAudioContext;
  if (!ctor) {
    throw new Error('AudioContext is required for stem audio buffer allocation.');
  }
  return ctor;
}

function defaultAudioBufferFactory(): StemAudioBufferFactory {
  return {
    createBuffer,
    async decodeAudioData(audioData) {
      const context = new (getAudioContextConstructor())();
      try {
        return await context.decodeAudioData(audioData.slice(0));
      } finally {
        void context.close();
      }
    },
  };
}

function dbToLinearGain(db: number): number {
  return Number.isFinite(db) ? 10 ** (db / 20) : 1;
}

function selectAudibleStemLayers(stemSeparation: ClipAudioStemState): ClipAudioStemLayer[] {
  if (stemSeparation.mixMode === 'original' || stemSeparation.soloStemId === STEM_SOURCE_LAYER_ID) {
    return [];
  }

  if (stemSeparation.soloStemId) {
    const soloLayer = stemSeparation.stems.find((stem) => stem.id === stemSeparation.soloStemId);
    return soloLayer ? [soloLayer] : [];
  }

  return stemSeparation.stems.filter((stem) => stem.enabled !== false);
}

function createBufferFromChannels(
  factory: StemAudioBufferFactory,
  channels: readonly Float32Array[],
  sampleRate: number,
): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const buffer = factory.createBuffer(channels.length, length, sampleRate);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    buffer.getChannelData(channelIndex).set(channels[channelIndex] ?? new Float32Array(length));
  }
  return buffer;
}

function getSourceChannelData(buffer: AudioBuffer, channelIndex: number): Float32Array {
  if (channelIndex < buffer.numberOfChannels) {
    return buffer.getChannelData(channelIndex);
  }
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  return new Float32Array(buffer.length);
}

function mixStemBuffers(
  factory: StemAudioBufferFactory,
  stems: readonly { layer: ClipAudioStemLayer; buffer: AudioBuffer }[],
  requestedChannelCount: number,
): AudioBuffer {
  const first = stems[0]?.buffer;
  if (!first) {
    throw new Error('Cannot mix empty stem buffers.');
  }

  const sampleRate = first.sampleRate;
  const length = Math.max(...stems.map((stem) => stem.buffer.length));
  const channelCount = Math.max(1, requestedChannelCount, ...stems.map((stem) => stem.buffer.numberOfChannels));
  const output = factory.createBuffer(channelCount, length, sampleRate);

  for (const { layer, buffer } of stems) {
    if (buffer.sampleRate !== sampleRate) {
      throw new Error('Stem audio source resolver does not yet resample mismatched stem sample rates.');
    }

    const gain = dbToLinearGain(layer.gainDb);
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const source = getSourceChannelData(buffer, channelIndex);
      const target = output.getChannelData(channelIndex);
      for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
        target[sampleIndex] = (target[sampleIndex] ?? 0) + (source[sampleIndex] ?? 0) * gain;
      }
    }
  }

  return output;
}

function stemCacheKey(layer: ClipAudioStemLayer): string {
  return [
    layer.manifestArtifactId,
    layer.payloadRef.artifactId,
    layer.payloadRef.hash,
    layer.sourceFingerprint,
  ].filter(Boolean).join(':');
}

export class StemAudioSourceResolver {
  private readonly artifactStore: Pick<AudioArtifactStore, 'getPayload'>;
  private readonly audioBufferFactory: StemAudioBufferFactory;
  private readonly decodedStemCache = new Map<string, Promise<AudioBuffer | null>>();

  constructor(options: StemAudioSourceResolverOptions) {
    this.artifactStore = options.artifactStore;
    this.audioBufferFactory = options.audioBufferFactory ?? defaultAudioBufferFactory();
  }

  clearCache(): void {
    this.decodedStemCache.clear();
  }

  async resolveStemLayerBuffer(layer: ClipAudioStemLayer): Promise<AudioBuffer | null> {
    return this.getStemBuffer(layer);
  }

  async resolveStemMix(stemSeparation: ClipAudioStemState): Promise<StemAudioSourceResolution> {
    if (stemSeparation.mixMode === 'original') {
      return {
        mode: 'original',
        buffer: null,
        usedStemIds: [],
        missingStems: [],
      };
    }

    const audibleLayers = selectAudibleStemLayers(stemSeparation);
    const decodedStems: { layer: ClipAudioStemLayer; buffer: AudioBuffer }[] = [];
    const missingStems: ClipAudioStemLayer[] = [];

    for (const layer of audibleLayers) {
      const buffer = await this.getStemBuffer(layer);
      if (!buffer) {
        missingStems.push(layer);
        continue;
      }
      decodedStems.push({ layer, buffer });
    }

    if (decodedStems.length === 0) {
      return {
        mode: 'stems',
        buffer: null,
        usedStemIds: [],
        missingStems,
      };
    }

    return {
      mode: 'stems',
      buffer: mixStemBuffers(this.audioBufferFactory, decodedStems, stemSeparation.channelCount),
      usedStemIds: decodedStems.map((stem) => stem.layer.id),
      missingStems,
    };
  }

  private async getStemBuffer(layer: ClipAudioStemLayer): Promise<AudioBuffer | null> {
    const key = stemCacheKey(layer);
    let cached = this.decodedStemCache.get(key);
    if (!cached) {
      cached = this.decodeStemBuffer(layer.payloadRef);
      this.decodedStemCache.set(key, cached);
    }

    return cached;
  }

  private async decodeStemBuffer(ref: AudioSignalArtifactRef): Promise<AudioBuffer | null> {
    const payload = await this.artifactStore.getPayload(ref.artifactId);
    if (!payload) {
      return null;
    }

    const bytes = await blobToArrayBuffer(payload);
    if (ref.mimeType === STEM_PCM_F32_MIME_TYPE || ref.metadata?.stemPayloadEncoding === 'planar-f32') {
      const decoded = decodeStemPcmF32Payload(bytes, ref.metadata);
      return createBufferFromChannels(this.audioBufferFactory, decoded.channels, decoded.sampleRate);
    }

    if (this.audioBufferFactory.decodeAudioData) {
      return this.audioBufferFactory.decodeAudioData(bytes.slice(0));
    }

    throw new Error(`Unsupported stem audio payload type: ${ref.mimeType ?? 'unknown'}.`);
  }
}
