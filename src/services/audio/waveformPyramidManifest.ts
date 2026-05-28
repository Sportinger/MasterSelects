import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const WAVEFORM_PYRAMID_MANIFEST_VERSION = 1 as const;
export const WAVEFORM_STAT_PAYLOAD_VERSION = 1 as const;
export const WAVEFORM_PACKED_PAYLOAD_VERSION = 1 as const;
export const DEFAULT_WAVEFORM_PYRAMID_BUCKET_SIZES = [32, 64, 128, 512, 2048, 8192] as const;

export type WaveformStatistic = 'min' | 'max' | 'rms' | 'peak';

export interface WaveformChannelPayloadRefs {
  channelIndex: number;
  min?: AudioArtifactRef;
  max?: AudioArtifactRef;
  rms?: AudioArtifactRef;
  peak?: AudioArtifactRef;
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
  payloadLayout?: 'split-stat-payloads' | 'packed-pyramid';
  packedPayload?: AudioArtifactRef;
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

export interface WaveformPyramidDataChannel {
  channelIndex: number;
  min: ArrayLike<number>;
  max: ArrayLike<number>;
  rms: ArrayLike<number>;
  peak: ArrayLike<number>;
}

export interface WaveformPyramidDataLevel {
  samplesPerBucket: number;
  bucketDuration: number;
  bucketCount: number;
  channels: WaveformPyramidDataChannel[];
}

export interface WaveformPyramidData {
  sampleRate: number;
  duration: number;
  levels: WaveformPyramidDataLevel[];
}

export interface WaveformPackedPayloadSpan {
  floatOffset: number;
  valueCount: number;
}

export interface WaveformPackedPayloadChannelHeader {
  channelIndex: number;
  min: WaveformPackedPayloadSpan;
  max: WaveformPackedPayloadSpan;
  rms: WaveformPackedPayloadSpan;
  peak: WaveformPackedPayloadSpan;
}

export interface WaveformPackedPayloadLevelHeader {
  samplesPerBucket: number;
  bucketDuration: number;
  bucketCount: number;
  channels: WaveformPackedPayloadChannelHeader[];
}

export interface WaveformPackedPayloadHeader {
  schemaVersion: typeof WAVEFORM_PACKED_PAYLOAD_VERSION;
  statistics: WaveformStatistic[];
  levels: WaveformPackedPayloadLevelHeader[];
}

export interface WaveformPackedPayload {
  header: WaveformPackedPayloadHeader;
  levels: WaveformPyramidDataLevel[];
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const WAVEFORM_STATISTICS = ['min', 'max', 'rms', 'peak'] as const satisfies readonly WaveformStatistic[];

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

      if (!input.packedPayload) {
        for (const channel of level.channels) {
          if (!channel.min || !channel.max || !channel.rms || !channel.peak) {
            throw new Error('Split waveform manifests require min/max/rms/peak payload refs for every channel.');
          }
        }
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
    payloadLayout: input.payloadLayout ?? (input.packedPayload ? 'packed-pyramid' : 'split-stat-payloads'),
    packedPayload: input.packedPayload,
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

function toFloat32Array(values: ArrayLike<number>): Float32Array {
  if (values instanceof Float32Array) {
    return values;
  }

  return Float32Array.from({ length: values.length }, (_, index) => {
    const value = values[index];
    return Number.isFinite(value) ? value : 0;
  });
}

function copyFloat32ArrayBytes(target: Uint8Array, byteOffset: number, values: Float32Array): void {
  target.set(
    new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
    byteOffset,
  );
}

function createPackedSpan(floatOffset: number, valueCount: number): WaveformPackedPayloadSpan {
  return { floatOffset, valueCount };
}

export function encodeWaveformPyramidPackedPayload(pyramid: WaveformPyramidData): ArrayBuffer {
  const arrays: Float32Array[] = [];
  let floatOffset = 0;
  const levels: WaveformPackedPayloadLevelHeader[] = pyramid.levels.map(level => {
    const channels: WaveformPackedPayloadChannelHeader[] = level.channels.map(channel => {
      const spans: Partial<Record<WaveformStatistic, WaveformPackedPayloadSpan>> = {};

      for (const statistic of WAVEFORM_STATISTICS) {
        const values = toFloat32Array(channel[statistic]);
        if (values.length !== level.bucketCount) {
          throw new Error(`Packed waveform ${statistic} length must match level bucketCount.`);
        }

        arrays.push(values);
        spans[statistic] = createPackedSpan(floatOffset, values.length);
        floatOffset += values.length;
      }

      if (!spans.min || !spans.max || !spans.rms || !spans.peak) {
        throw new Error('Packed waveform span refs were incomplete.');
      }

      return {
        channelIndex: channel.channelIndex,
        min: spans.min,
        max: spans.max,
        rms: spans.rms,
        peak: spans.peak,
      };
    });

    return {
      samplesPerBucket: level.samplesPerBucket,
      bucketDuration: level.bucketDuration,
      bucketCount: level.bucketCount,
      channels,
    };
  });
  const header: WaveformPackedPayloadHeader = {
    schemaVersion: WAVEFORM_PACKED_PAYLOAD_VERSION,
    statistics: [...WAVEFORM_STATISTICS],
    levels,
  };
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  const dataByteLength = floatOffset * Float32Array.BYTES_PER_ELEMENT;
  const output = new ArrayBuffer(4 + headerBytes.byteLength + dataByteLength);
  const view = new DataView(output);
  view.setUint32(0, headerBytes.byteLength, true);
  const outputBytes = new Uint8Array(output);
  outputBytes.set(headerBytes, 4);
  let byteOffset = 4 + headerBytes.byteLength;

  for (const values of arrays) {
    copyFloat32ArrayBytes(outputBytes, byteOffset, values);
    byteOffset += values.byteLength;
  }

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

function decodePackedSpan(
  dataBytes: Uint8Array,
  span: WaveformPackedPayloadSpan,
): Float32Array {
  if (!Number.isInteger(span.floatOffset) || span.floatOffset < 0) {
    throw new Error('Packed waveform span floatOffset must be a non-negative integer.');
  }
  if (!Number.isInteger(span.valueCount) || span.valueCount < 0) {
    throw new Error('Packed waveform span valueCount must be a non-negative integer.');
  }

  const byteStart = span.floatOffset * Float32Array.BYTES_PER_ELEMENT;
  const byteEnd = byteStart + span.valueCount * Float32Array.BYTES_PER_ELEMENT;
  if (byteEnd > dataBytes.byteLength) {
    throw new Error('Packed waveform span exceeds payload length.');
  }

  const valuesBuffer = new ArrayBuffer(byteEnd - byteStart);
  new Uint8Array(valuesBuffer).set(dataBytes.subarray(byteStart, byteEnd));
  return new Float32Array(valuesBuffer);
}

export function decodeWaveformPyramidPackedPayload(input: ArrayBuffer): WaveformPackedPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Packed waveform payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as WaveformPackedPayloadHeader;

  if (header.schemaVersion !== WAVEFORM_PACKED_PAYLOAD_VERSION) {
    throw new Error(`Unsupported packed waveform payload schema version: ${header.schemaVersion}`);
  }

  const dataBytes = new Uint8Array(input, headerEnd);
  const levels = header.levels.map(level => ({
    samplesPerBucket: level.samplesPerBucket,
    bucketDuration: level.bucketDuration,
    bucketCount: level.bucketCount,
    channels: level.channels.map(channel => {
      const min = decodePackedSpan(dataBytes, channel.min);
      const max = decodePackedSpan(dataBytes, channel.max);
      const rms = decodePackedSpan(dataBytes, channel.rms);
      const peak = decodePackedSpan(dataBytes, channel.peak);
      if (
        min.length !== level.bucketCount ||
        max.length !== level.bucketCount ||
        rms.length !== level.bucketCount ||
        peak.length !== level.bucketCount
      ) {
        throw new Error('Packed waveform channel values must match level bucketCount.');
      }

      return {
        channelIndex: channel.channelIndex,
        min,
        max,
        rms,
        peak,
      };
    }),
  }));

  return { header, levels };
}
