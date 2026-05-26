import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const LOUDNESS_ENVELOPE_MANIFEST_VERSION = 1 as const;
export const LOUDNESS_CURVE_PAYLOAD_VERSION = 1 as const;

export type LoudnessEnvelopeMetric =
  | 'momentary-lufs'
  | 'short-term-lufs'
  | 'integrated-lufs'
  | 'true-peak-dbtp'
  | 'sample-peak-dbfs'
  | 'rms-dbfs';

export interface LoudnessCurvePayloadRef {
  metric: LoudnessEnvelopeMetric;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  payloadRef: AudioArtifactRef;
}

export interface LoudnessEnvelopeSummary {
  integratedLufs?: number;
  truePeakDbtp?: number;
  samplePeakDbfs?: number;
  rmsDbfs?: number;
}

export interface LoudnessEnvelopeManifest {
  schemaVersion: typeof LOUDNESS_ENVELOPE_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  curves: LoudnessCurvePayloadRef[];
  summary?: LoudnessEnvelopeSummary;
}

export interface LoudnessCurvePayloadHeader {
  schemaVersion: typeof LOUDNESS_CURVE_PAYLOAD_VERSION;
  metric: LoudnessEnvelopeMetric;
  channelIndex?: number;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  valueLayout: 'time-series';
  valueEncoding: 'db';
}

export interface LoudnessCurvePayload {
  header: LoudnessCurvePayloadHeader;
  values: Float32Array;
}

export interface CreateLoudnessEnvelopeManifestInput extends Omit<
  LoudnessEnvelopeManifest,
  'schemaVersion'
> {
  schemaVersion?: typeof LOUDNESS_ENVELOPE_MANIFEST_VERSION;
}

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

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createLoudnessEnvelopeManifest(
  input: CreateLoudnessEnvelopeManifestInput,
): LoudnessEnvelopeManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertPositiveInteger(input.channelLayout.channelCount, 'channelLayout.channelCount');

  if (input.curves.length === 0) {
    throw new Error('Loudness envelope manifests require at least one curve.');
  }

  const curves = input.curves
    .toSorted((a, b) => {
      const metricOrder = a.metric.localeCompare(b.metric);
      if (metricOrder !== 0) return metricOrder;
      return (a.channelIndex ?? -1) - (b.channelIndex ?? -1);
    })
    .map((curve) => {
      assertPositiveFinite(curve.windowDuration, 'windowDuration');
      assertPositiveFinite(curve.hopDuration, 'hopDuration');
      assertPositiveInteger(curve.pointCount, 'pointCount');

      if (
        typeof curve.channelIndex === 'number'
        && (!Number.isInteger(curve.channelIndex)
          || curve.channelIndex < 0
          || curve.channelIndex >= input.channelLayout.channelCount)
      ) {
        throw new Error('curve.channelIndex must be within channelLayout.channelCount.');
      }

      return curve;
    });

  return {
    schemaVersion: LOUDNESS_ENVELOPE_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    curves,
    summary: input.summary,
  };
}

export function encodeLoudnessCurvePayload(payload: LoudnessCurvePayload): ArrayBuffer {
  assertPositiveFinite(payload.header.windowDuration, 'windowDuration');
  assertPositiveFinite(payload.header.hopDuration, 'hopDuration');
  assertPositiveInteger(payload.header.pointCount, 'pointCount');

  if (payload.header.valueLayout !== 'time-series') {
    throw new Error(`Unsupported loudness curve value layout: ${payload.header.valueLayout}`);
  }
  if (payload.header.valueEncoding !== 'db') {
    throw new Error(`Unsupported loudness curve value encoding: ${payload.header.valueEncoding}`);
  }
  if (payload.values.length !== payload.header.pointCount) {
    throw new Error('Loudness curve pointCount must match values.length.');
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

export function decodeLoudnessCurvePayload(input: ArrayBuffer): LoudnessCurvePayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Loudness curve header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as LoudnessCurvePayloadHeader;

  if (header.schemaVersion !== LOUDNESS_CURVE_PAYLOAD_VERSION) {
    throw new Error(`Unsupported loudness curve payload schema version: ${header.schemaVersion}`);
  }
  if (header.valueLayout !== 'time-series') {
    throw new Error(`Unsupported loudness curve value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'db') {
    throw new Error(`Unsupported loudness curve value encoding: ${header.valueEncoding}`);
  }
  assertPositiveFinite(header.windowDuration, 'windowDuration');
  assertPositiveFinite(header.hopDuration, 'hopDuration');
  assertPositiveInteger(header.pointCount, 'pointCount');

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Loudness curve values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);

  if (values.length !== header.pointCount) {
    throw new Error('Loudness curve pointCount does not match decoded values.');
  }

  return { header, values };
}
