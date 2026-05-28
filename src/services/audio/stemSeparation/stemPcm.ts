import type { SignalMetadata } from '../../../signals';

export const STEM_PCM_F32_MIME_TYPE = 'audio/vnd.masterselects.pcm-f32';
export const STEM_PCM_F32_LAYOUT = 'planar-f32';

export interface StemPcmF32Metadata {
  encoding: typeof STEM_PCM_F32_LAYOUT;
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  duration: number;
  normalizationPolicy?: string;
}

export interface StemPcmF32Payload {
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  channels: Float32Array[];
  duration: number;
}

export interface EncodeStemPcmF32PayloadInput {
  channels: readonly Float32Array[];
  sampleRate: number;
  normalizationPolicy?: string;
}

function finitePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    throw new Error(`Invalid stem PCM metadata field ${field}.`);
  }
  return value;
}

function finiteNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid stem PCM metadata field ${field}.`);
  }
  return value;
}

export function createStemPcmF32Metadata(input: EncodeStemPcmF32PayloadInput): SignalMetadata {
  const channelCount = input.channels.length;
  const frameCount = input.channels[0]?.length ?? 0;
  if (channelCount <= 0 || frameCount <= 0) {
    throw new Error('Stem PCM payloads require at least one non-empty channel.');
  }
  if (!input.channels.every((channel) => channel.length === frameCount)) {
    throw new Error('Stem PCM channels must have matching frame counts.');
  }
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('Stem PCM payloads require a positive sample rate.');
  }

  return {
    stemPayloadEncoding: STEM_PCM_F32_LAYOUT,
    sampleRate: input.sampleRate,
    channelCount,
    frameCount,
    duration: frameCount / input.sampleRate,
    ...(input.normalizationPolicy ? { normalizationPolicy: input.normalizationPolicy } : {}),
  };
}

export function readStemPcmF32Metadata(metadata: SignalMetadata | undefined): StemPcmF32Metadata {
  if (metadata?.stemPayloadEncoding !== STEM_PCM_F32_LAYOUT) {
    throw new Error('Stem payload metadata does not describe planar PCM F32 data.');
  }

  return {
    encoding: STEM_PCM_F32_LAYOUT,
    sampleRate: finitePositiveInteger(metadata.sampleRate, 'sampleRate'),
    channelCount: finitePositiveInteger(metadata.channelCount, 'channelCount'),
    frameCount: finitePositiveInteger(metadata.frameCount, 'frameCount'),
    duration: finiteNonNegativeNumber(metadata.duration, 'duration'),
    normalizationPolicy: typeof metadata.normalizationPolicy === 'string'
      ? metadata.normalizationPolicy
      : undefined,
  };
}

export function encodeStemPcmF32Payload(input: EncodeStemPcmF32PayloadInput): ArrayBuffer {
  const metadata = readStemPcmF32Metadata(createStemPcmF32Metadata(input));
  const samples = new Float32Array(metadata.channelCount * metadata.frameCount);
  for (let channelIndex = 0; channelIndex < metadata.channelCount; channelIndex += 1) {
    samples.set(input.channels[channelIndex] ?? new Float32Array(metadata.frameCount), channelIndex * metadata.frameCount);
  }
  return samples.buffer.slice(0);
}

export function decodeStemPcmF32Payload(
  payload: ArrayBuffer,
  metadata: SignalMetadata | undefined,
): StemPcmF32Payload {
  const parsed = readStemPcmF32Metadata(metadata);
  const expectedBytes = parsed.channelCount * parsed.frameCount * Float32Array.BYTES_PER_ELEMENT;
  if (payload.byteLength !== expectedBytes) {
    throw new Error(`Stem PCM payload size mismatch: expected ${expectedBytes} bytes, got ${payload.byteLength}.`);
  }

  const samples = new Float32Array(payload);
  const channels: Float32Array[] = [];
  for (let channelIndex = 0; channelIndex < parsed.channelCount; channelIndex += 1) {
    const start = channelIndex * parsed.frameCount;
    channels.push(samples.slice(start, start + parsed.frameCount));
  }

  return {
    sampleRate: parsed.sampleRate,
    channelCount: parsed.channelCount,
    frameCount: parsed.frameCount,
    channels,
    duration: parsed.duration,
  };
}

