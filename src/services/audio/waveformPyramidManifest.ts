import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const WAVEFORM_PYRAMID_MANIFEST_VERSION = 1 as const;
export const WAVEFORM_STAT_PAYLOAD_VERSION = 1 as const;
export const DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES = [32, 64, 128, 512, 2048, 8192] as const;

export type WaveformStatistic = 'min' | 'max' | 'rms' | 'peak';

export interface WaveformChannelPayloadRefs {
  channelIndex: number;
  min: AudioArtifactRef;
  max: AudioArtifactRef;
  rms: AudioArtifactRef;
  peak: AudioArtifactRef;
}

export interface WaveformPyramidLevelManifest {
  samplesPerBucket: number;
  bucketDuration: number;
  bucketCount: number;
  channels: WaveformChannelPayloadRefs[];
}

export interface WaveformPyramidManifest {
  schemaVersion: typeof WAVEFORM_PYRAMID_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  levels: WaveformPyramidLevelManifest[];
}

export interface CreateWaveformPyramidManifestInput extends Omit<
  WaveformPyramidManifest,
  'schemaVersion'
> {
  schemaVersion?: typeof WAVEFORM_PYRAMID_MANIFEST_VERSION;
}

export interface WaveformStatPayloadHeader {
  schemaVersion: typeof WAVEFORM_STAT_PAYLOAD_VERSION;
  statistic: WaveformStatistic;
  samplesPerBucket: number;
  channelIndex: number;
  bucketCount: number;
}

export interface WaveformStatPayload {
  header: WaveformStatPayloadHeader;
  values: Float32Array;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
}

export function createWaveformPyramidManifest(
  input: CreateWaveformPyramidManifestInput,
): WaveformPyramidManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');

  if (input.channelLayout.channelCount < 1) {
    throw new Error('channelLayout.channelCount must be at least 1.');
  }

  if (input.levels.length === 0) {
    throw new Error('Waveform pyramid manifests require at least one level.');
  }

  const levels = input.levels
    .toSorted((a, b) => a.samplesPerBucket - b.samplesPerBucket)
    .map((level) => {
      assertPositiveFinite(level.samplesPerBucket, 'samplesPerBucket');
      assertPositiveFinite(level.bucketDuration, 'bucketDuration');

      if (!Number.isInteger(level.bucketCount) || level.bucketCount < 0) {
        throw new Error('bucketCount must be a non-negative integer.');
      }

      if (level.channels.length !== input.channelLayout.channelCount) {
        throw new Error('Every waveform level must include one payload set per channel.');
      }

      return {
        ...level,
        channels: level.channels.toSorted((a, b) => a.channelIndex - b.channelIndex),
      };
    });

  return {
    schemaVersion: WAVEFORM_PYRAMID_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    levels,
  };
}

export function selectWaveformPyramidLevel(
  manifest: WaveformPyramidManifest,
  pixelsPerSecond: number,
): WaveformPyramidLevelManifest {
  assertPositiveFinite(pixelsPerSecond, 'pixelsPerSecond');

  const targetSamplesPerPixel = manifest.sampleRate / pixelsPerSecond;
  const firstCoarserOrEqual = manifest.levels.find((level) =>
    level.samplesPerBucket >= targetSamplesPerPixel);

  return firstCoarserOrEqual ?? manifest.levels[manifest.levels.length - 1];
}

export function encodeWaveformStatPayload(payload: WaveformStatPayload): ArrayBuffer {
  if (payload.values.length !== payload.header.bucketCount) {
    throw new Error('Waveform payload bucketCount must match values.length.');
  }

  const headerBytes = textEncoder.encode(JSON.stringify(payload.header));
  const output = new ArrayBuffer(4 + headerBytes.byteLength + payload.values.byteLength);
  const view = new DataView(output);
  view.setUint32(0, headerBytes.byteLength, true);
  new Uint8Array(output, 4, headerBytes.byteLength).set(headerBytes);
  new Uint8Array(output, 4 + headerBytes.byteLength).set(
    new Uint8Array(payload.values.buffer, payload.values.byteOffset, payload.values.byteLength),
  );

  return output;
}

export function decodeWaveformStatPayload(input: ArrayBuffer): WaveformStatPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Waveform payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as WaveformStatPayloadHeader;

  if (header.schemaVersion !== WAVEFORM_STAT_PAYLOAD_VERSION) {
    throw new Error(`Unsupported waveform payload schema version: ${header.schemaVersion}`);
  }

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Waveform payload values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);

  if (values.length !== header.bucketCount) {
    throw new Error('Waveform payload bucketCount does not match decoded values.');
  }

  return { header, values };
}
