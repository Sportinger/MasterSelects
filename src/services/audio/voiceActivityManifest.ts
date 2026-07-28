import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const VOICE_ACTIVITY_MANIFEST_VERSION = 1 as const;
export const AUDIO_SPAN_LIST_PAYLOAD_VERSION = 1 as const;

export interface AudioSpan {
  start: number;
  end: number;
  confidence: number;
}

export interface AudioSpanListPayloadHeader {
  schemaVersion: typeof AUDIO_SPAN_LIST_PAYLOAD_VERSION;
  kind: 'voice-activity-segments';
  spanCount: number;
  valueLayout: 'span-major';
  valueEncoding: 'start-end-confidence-f32';
  timeUnit: 'seconds';
}

export interface AudioSpanListPayload {
  header: AudioSpanListPayloadHeader;
  values: Float32Array;
}

export interface VoiceActivityConfig {
  threshold: number;
  negThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  padMs: number;
  frameSamples: number;
}

export interface VoiceActivityModelInfo {
  id: string;
  version: string;
}

export interface VoiceActivitySummary {
  speechSeconds: number;
  speechRatio: number;
  segmentCount: number;
}

export interface VoiceActivityManifest {
  schemaVersion: typeof VOICE_ACTIVITY_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  analysisSampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  model: VoiceActivityModelInfo;
  config: VoiceActivityConfig;
  segmentCount: number;
  segmentsPayloadRef: AudioArtifactRef;
  probabilityCurveRef?: AudioArtifactRef;
  summary: VoiceActivitySummary;
}

export interface CreateVoiceActivityManifestInput extends Omit<VoiceActivityManifest, 'schemaVersion'> {
  schemaVersion?: typeof VOICE_ACTIVITY_MANIFEST_VERSION;
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

export function spansToFloat32(spans: readonly AudioSpan[]): Float32Array {
  const values = new Float32Array(spans.length * 3);
  spans.forEach((span, index) => {
    values[index * 3] = span.start;
    values[index * 3 + 1] = span.end;
    values[index * 3 + 2] = span.confidence;
  });
  return values;
}

export function float32ToSpans(values: Float32Array): AudioSpan[] {
  if (values.length % 3 !== 0) {
    throw new Error('Audio span values must be triples of start, end, and confidence.');
  }

  const spans: AudioSpan[] = [];
  for (let index = 0; index < values.length; index += 3) {
    spans.push({
      start: values[index] ?? 0,
      end: values[index + 1] ?? 0,
      confidence: values[index + 2] ?? 0,
    });
  }
  return spans;
}

export function encodeAudioSpanListPayload(payload: AudioSpanListPayload): ArrayBuffer {
  assertNonNegativeInteger(payload.header.spanCount, 'spanCount');
  if (payload.header.kind !== 'voice-activity-segments') {
    throw new Error(`Unsupported audio span payload kind: ${payload.header.kind}`);
  }
  if (payload.header.valueLayout !== 'span-major') {
    throw new Error(`Unsupported audio span value layout: ${payload.header.valueLayout}`);
  }
  if (payload.header.valueEncoding !== 'start-end-confidence-f32') {
    throw new Error(`Unsupported audio span value encoding: ${payload.header.valueEncoding}`);
  }
  if (payload.header.timeUnit !== 'seconds') {
    throw new Error(`Unsupported audio span time unit: ${payload.header.timeUnit}`);
  }
  if (payload.values.length !== payload.header.spanCount * 3) {
    throw new Error('Audio span payload value count must match spanCount * 3.');
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

export function decodeAudioSpanListPayload(input: ArrayBuffer): AudioSpanListPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Audio span payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as AudioSpanListPayloadHeader;

  if (header.schemaVersion !== AUDIO_SPAN_LIST_PAYLOAD_VERSION) {
    throw new Error(`Unsupported audio span payload schema version: ${header.schemaVersion}`);
  }
  if (header.kind !== 'voice-activity-segments') {
    throw new Error(`Unsupported audio span payload kind: ${header.kind}`);
  }
  if (header.valueLayout !== 'span-major') {
    throw new Error(`Unsupported audio span value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'start-end-confidence-f32') {
    throw new Error(`Unsupported audio span value encoding: ${header.valueEncoding}`);
  }
  if (header.timeUnit !== 'seconds') {
    throw new Error(`Unsupported audio span time unit: ${header.timeUnit}`);
  }

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Audio span values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);

  if (values.length !== header.spanCount * 3) {
    throw new Error('Audio span payload spanCount does not match decoded values.');
  }

  return { header, values };
}

export function createVoiceActivityManifest(
  input: CreateVoiceActivityManifestInput,
): VoiceActivityManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertPositiveFinite(input.analysisSampleRate, 'analysisSampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertNonNegativeInteger(input.segmentCount, 'segmentCount');
  assertNonNegativeFinite(input.summary.speechSeconds, 'summary.speechSeconds');
  if (!Number.isFinite(input.summary.speechRatio)
    || input.summary.speechRatio < 0
    || input.summary.speechRatio > 1) {
    throw new Error('summary.speechRatio must be within [0, 1].');
  }
  if (!input.model.id || !input.model.version) {
    throw new Error('model.id and model.version must be non-empty strings.');
  }
  assertPositiveFinite(input.config.frameSamples, 'config.frameSamples');

  return {
    schemaVersion: VOICE_ACTIVITY_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    analysisSampleRate: input.analysisSampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    model: { ...input.model },
    config: { ...input.config },
    segmentCount: input.segmentCount,
    segmentsPayloadRef: input.segmentsPayloadRef,
    probabilityCurveRef: input.probabilityCurveRef,
    summary: { ...input.summary },
  };
}
