import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const ONSET_MAP_MANIFEST_VERSION = 1 as const;
export const BEAT_GRID_MANIFEST_VERSION = 1 as const;
export const AUDIO_EVENT_LIST_PAYLOAD_VERSION = 1 as const;

export type AudioEventAnalysisKind = 'onset-map' | 'beat-grid';

export interface AudioEvent {
  time: number;
  strength: number;
  confidence: number;
}

export interface AudioEventListPayloadHeader {
  schemaVersion: typeof AUDIO_EVENT_LIST_PAYLOAD_VERSION;
  kind: AudioEventAnalysisKind;
  eventCount: number;
  valueLayout: 'event-major';
  valueEncoding: 'time-strength-confidence-f32';
  timeUnit: 'seconds';
}

export interface AudioEventListPayload {
  header: AudioEventListPayloadHeader;
  values: Float32Array;
}

export interface OnsetMapSummary {
  eventCount: number;
  averageStrength: number;
  peakStrength: number;
}

export interface BeatGridSummary {
  beatCount: number;
  tempoBpm?: number;
  confidence: number;
}

export interface OnsetMapManifest {
  schemaVersion: typeof ONSET_MAP_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  fftSize: number;
  hopSize: number;
  detectionFunction: 'spectral-flux';
  eventCount: number;
  eventsPayloadRef: AudioArtifactRef;
  summary: OnsetMapSummary;
}

export interface BeatGridManifest {
  schemaVersion: typeof BEAT_GRID_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  tempoBpm?: number;
  beatCount: number;
  beatsPayloadRef: AudioArtifactRef;
  sourceOnsetMapArtifactId?: string;
  summary: BeatGridSummary;
}

export interface CreateOnsetMapManifestInput extends Omit<OnsetMapManifest, 'schemaVersion'> {
  schemaVersion?: typeof ONSET_MAP_MANIFEST_VERSION;
}

export interface CreateBeatGridManifestInput extends Omit<BeatGridManifest, 'schemaVersion'> {
  schemaVersion?: typeof BEAT_GRID_MANIFEST_VERSION;
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

export function eventsToFloat32(events: readonly AudioEvent[]): Float32Array {
  const values = new Float32Array(events.length * 3);
  events.forEach((event, index) => {
    values[index * 3] = event.time;
    values[index * 3 + 1] = event.strength;
    values[index * 3 + 2] = event.confidence;
  });
  return values;
}

export function float32ToEvents(values: Float32Array): AudioEvent[] {
  if (values.length % 3 !== 0) {
    throw new Error('Audio event values must be triples of time, strength, and confidence.');
  }

  const events: AudioEvent[] = [];
  for (let index = 0; index < values.length; index += 3) {
    events.push({
      time: values[index] ?? 0,
      strength: values[index + 1] ?? 0,
      confidence: values[index + 2] ?? 0,
    });
  }
  return events;
}

export function encodeAudioEventListPayload(payload: AudioEventListPayload): ArrayBuffer {
  assertNonNegativeInteger(payload.header.eventCount, 'eventCount');
  if (payload.header.valueLayout !== 'event-major') {
    throw new Error(`Unsupported audio event value layout: ${payload.header.valueLayout}`);
  }
  if (payload.header.valueEncoding !== 'time-strength-confidence-f32') {
    throw new Error(`Unsupported audio event value encoding: ${payload.header.valueEncoding}`);
  }
  if (payload.header.timeUnit !== 'seconds') {
    throw new Error(`Unsupported audio event time unit: ${payload.header.timeUnit}`);
  }
  if (payload.values.length !== payload.header.eventCount * 3) {
    throw new Error('Audio event payload value count must match eventCount * 3.');
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

export function decodeAudioEventListPayload(input: ArrayBuffer): AudioEventListPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Audio event payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as AudioEventListPayloadHeader;

  if (header.schemaVersion !== AUDIO_EVENT_LIST_PAYLOAD_VERSION) {
    throw new Error(`Unsupported audio event payload schema version: ${header.schemaVersion}`);
  }
  if (header.valueLayout !== 'event-major') {
    throw new Error(`Unsupported audio event value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'time-strength-confidence-f32') {
    throw new Error(`Unsupported audio event value encoding: ${header.valueEncoding}`);
  }
  if (header.timeUnit !== 'seconds') {
    throw new Error(`Unsupported audio event time unit: ${header.timeUnit}`);
  }

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Audio event values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);

  if (values.length !== header.eventCount * 3) {
    throw new Error('Audio event payload eventCount does not match decoded values.');
  }

  return { header, values };
}

export function createOnsetMapManifest(input: CreateOnsetMapManifestInput): OnsetMapManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertPositiveFinite(input.fftSize, 'fftSize');
  assertPositiveFinite(input.hopSize, 'hopSize');
  assertNonNegativeInteger(input.eventCount, 'eventCount');

  return {
    schemaVersion: ONSET_MAP_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: cloneChannelLayout(input.channelLayout),
    duration: input.duration,
    fftSize: input.fftSize,
    hopSize: input.hopSize,
    detectionFunction: input.detectionFunction,
    eventCount: input.eventCount,
    eventsPayloadRef: input.eventsPayloadRef,
    summary: input.summary,
  };
}

export function createBeatGridManifest(input: CreateBeatGridManifestInput): BeatGridManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertNonNegativeInteger(input.beatCount, 'beatCount');

  if (input.tempoBpm !== undefined) {
    assertPositiveFinite(input.tempoBpm, 'tempoBpm');
  }

  return {
    schemaVersion: BEAT_GRID_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: cloneChannelLayout(input.channelLayout),
    duration: input.duration,
    tempoBpm: input.tempoBpm,
    beatCount: input.beatCount,
    beatsPayloadRef: input.beatsPayloadRef,
    sourceOnsetMapArtifactId: input.sourceOnsetMapArtifactId,
    summary: input.summary,
  };
}
