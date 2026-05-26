import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const FREQUENCY_SUMMARY_MANIFEST_VERSION = 1 as const;
export const PHASE_CORRELATION_MANIFEST_VERSION = 1 as const;
export const FREQUENCY_BAND_PAYLOAD_VERSION = 1 as const;
export const PHASE_CORRELATION_PAYLOAD_VERSION = 1 as const;

export interface FrequencyBandSummary {
  bandId: string;
  label: string;
  minFrequency: number;
  maxFrequency: number;
  rmsDb: number;
  peakDb: number;
  energyShare: number;
  centroidHz: number;
}

export interface PhaseCorrelationPoint {
  time: number;
  correlation: number;
  midSideRatioDb: number;
}

export interface FrequencySummaryManifest {
  schemaVersion: typeof FREQUENCY_SUMMARY_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  fftSize: number;
  hopSize: number;
  window: 'hann';
  bands: FrequencyBandSummary[];
  bandsPayloadRef: AudioArtifactRef;
  summary: {
    spectralCentroidHz: number;
    lowEnergyShare: number;
    midEnergyShare: number;
    highEnergyShare: number;
    dominantBandId?: string;
  };
}

export interface PhaseCorrelationManifest {
  schemaVersion: typeof PHASE_CORRELATION_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  windowDuration: number;
  hopDuration: number;
  pointCount: number;
  correlationPayloadRef: AudioArtifactRef;
  summary: {
    averageCorrelation: number;
    minimumCorrelation: number;
    maximumCorrelation: number;
    negativeCorrelationPercent: number;
    averageMidSideRatioDb: number;
    stereoWidth: number;
    monoCompatible: boolean;
  };
}

export interface FrequencyBandPayloadHeader {
  schemaVersion: typeof FREQUENCY_BAND_PAYLOAD_VERSION;
  bandCount: number;
  valueLayout: 'band-major';
  valueEncoding: 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32';
}

export interface FrequencyBandPayload {
  header: FrequencyBandPayloadHeader;
  values: Float32Array;
}

export interface PhaseCorrelationPayloadHeader {
  schemaVersion: typeof PHASE_CORRELATION_PAYLOAD_VERSION;
  pointCount: number;
  windowDuration: number;
  hopDuration: number;
  valueLayout: 'time-major';
  valueEncoding: 'time-correlation-midSideRatioDb-f32';
}

export interface PhaseCorrelationPayload {
  header: PhaseCorrelationPayloadHeader;
  values: Float32Array;
}

export interface CreateFrequencySummaryManifestInput extends Omit<FrequencySummaryManifest, 'schemaVersion'> {
  schemaVersion?: typeof FREQUENCY_SUMMARY_MANIFEST_VERSION;
}

export interface CreatePhaseCorrelationManifestInput extends Omit<PhaseCorrelationManifest, 'schemaVersion'> {
  schemaVersion?: typeof PHASE_CORRELATION_MANIFEST_VERSION;
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

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function cloneChannelLayout(layout: AudioChannelLayout): AudioChannelLayout {
  if (!Number.isInteger(layout.channelCount) || layout.channelCount < 1) {
    throw new Error('channelLayout.channelCount must be at least 1.');
  }

  return {
    kind: layout.kind,
    channelCount: layout.channelCount,
    ...(layout.labels ? { labels: [...layout.labels] } : {}),
  };
}

export function frequencyBandsToFloat32(bands: readonly FrequencyBandSummary[]): Float32Array {
  const values = new Float32Array(bands.length * 6);
  bands.forEach((band, index) => {
    values[index * 6] = band.minFrequency;
    values[index * 6 + 1] = band.maxFrequency;
    values[index * 6 + 2] = band.rmsDb;
    values[index * 6 + 3] = band.peakDb;
    values[index * 6 + 4] = band.energyShare;
    values[index * 6 + 5] = band.centroidHz;
  });
  return values;
}

export function phaseCorrelationPointsToFloat32(points: readonly PhaseCorrelationPoint[]): Float32Array {
  const values = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    values[index * 3] = point.time;
    values[index * 3 + 1] = point.correlation;
    values[index * 3 + 2] = point.midSideRatioDb;
  });
  return values;
}

export function float32ToPhaseCorrelationPoints(values: Float32Array): PhaseCorrelationPoint[] {
  const points: PhaseCorrelationPoint[] = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    points.push({
      time: values[index] ?? 0,
      correlation: values[index + 1] ?? 0,
      midSideRatioDb: values[index + 2] ?? 0,
    });
  }
  return points;
}

export function encodeFrequencyBandPayload(payload: FrequencyBandPayload): ArrayBuffer {
  assertNonNegativeInteger(payload.header.bandCount, 'bandCount');
  if (payload.header.valueLayout !== 'band-major') {
    throw new Error(`Unsupported frequency band value layout: ${payload.header.valueLayout}`);
  }
  if (payload.header.valueEncoding !== 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32') {
    throw new Error(`Unsupported frequency band value encoding: ${payload.header.valueEncoding}`);
  }
  if (payload.values.length !== payload.header.bandCount * 6) {
    throw new Error('Frequency band payload value count must match bandCount * 6.');
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

export function decodeFrequencyBandPayload(input: ArrayBuffer): FrequencyBandPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Frequency band payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as FrequencyBandPayloadHeader;

  if (header.schemaVersion !== FREQUENCY_BAND_PAYLOAD_VERSION) {
    throw new Error(`Unsupported frequency band payload schema version: ${header.schemaVersion}`);
  }
  if (header.valueLayout !== 'band-major') {
    throw new Error(`Unsupported frequency band value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'minHz-maxHz-rmsDb-peakDb-energyShare-centroidHz-f32') {
    throw new Error(`Unsupported frequency band value encoding: ${header.valueEncoding}`);
  }

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Frequency band values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);
  if (values.length !== header.bandCount * 6) {
    throw new Error('Frequency band payload bandCount does not match decoded values.');
  }
  return { header, values };
}

export function encodePhaseCorrelationPayload(payload: PhaseCorrelationPayload): ArrayBuffer {
  assertNonNegativeInteger(payload.header.pointCount, 'pointCount');
  assertPositiveFinite(payload.header.windowDuration, 'windowDuration');
  assertPositiveFinite(payload.header.hopDuration, 'hopDuration');
  if (payload.header.valueLayout !== 'time-major') {
    throw new Error(`Unsupported phase correlation value layout: ${payload.header.valueLayout}`);
  }
  if (payload.header.valueEncoding !== 'time-correlation-midSideRatioDb-f32') {
    throw new Error(`Unsupported phase correlation value encoding: ${payload.header.valueEncoding}`);
  }
  if (payload.values.length !== payload.header.pointCount * 3) {
    throw new Error('Phase correlation payload value count must match pointCount * 3.');
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

export function decodePhaseCorrelationPayload(input: ArrayBuffer): PhaseCorrelationPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Phase correlation payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as PhaseCorrelationPayloadHeader;

  if (header.schemaVersion !== PHASE_CORRELATION_PAYLOAD_VERSION) {
    throw new Error(`Unsupported phase correlation payload schema version: ${header.schemaVersion}`);
  }
  if (header.valueLayout !== 'time-major') {
    throw new Error(`Unsupported phase correlation value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'time-correlation-midSideRatioDb-f32') {
    throw new Error(`Unsupported phase correlation value encoding: ${header.valueEncoding}`);
  }

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Phase correlation values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);
  if (values.length !== header.pointCount * 3) {
    throw new Error('Phase correlation payload pointCount does not match decoded values.');
  }
  return { header, values };
}

export function createFrequencySummaryManifest(
  input: CreateFrequencySummaryManifestInput,
): FrequencySummaryManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertPositiveFinite(input.fftSize, 'fftSize');
  assertPositiveFinite(input.hopSize, 'hopSize');

  if (input.bands.length === 0) {
    throw new Error('Frequency summary manifests require at least one band.');
  }

  return {
    schemaVersion: FREQUENCY_SUMMARY_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: cloneChannelLayout(input.channelLayout),
    duration: input.duration,
    fftSize: input.fftSize,
    hopSize: input.hopSize,
    window: input.window,
    bands: input.bands.map((band) => ({ ...band })),
    bandsPayloadRef: input.bandsPayloadRef,
    summary: { ...input.summary },
  };
}

export function createPhaseCorrelationManifest(
  input: CreatePhaseCorrelationManifestInput,
): PhaseCorrelationManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertPositiveFinite(input.windowDuration, 'windowDuration');
  assertPositiveFinite(input.hopDuration, 'hopDuration');
  assertNonNegativeInteger(input.pointCount, 'pointCount');

  return {
    schemaVersion: PHASE_CORRELATION_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: cloneChannelLayout(input.channelLayout),
    duration: input.duration,
    windowDuration: input.windowDuration,
    hopDuration: input.hopDuration,
    pointCount: input.pointCount,
    correlationPayloadRef: input.correlationPayloadRef,
    summary: { ...input.summary },
  };
}
