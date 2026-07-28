import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const SPEECH_MARKERS_MANIFEST_VERSION = 1 as const;
export const SPEECH_MARKERS_PAYLOAD_VERSION = 1 as const;

export const SPEECH_MARKER_TYPES = [
  'breath',
  'filler',
  'repetition',
  'false-start',
  'long-pause',
] as const;

export type SpeechMarkerType = typeof SPEECH_MARKER_TYPES[number];

export interface SpeechMarkerEvidence {
  rmsDb?: number;
  spectralFlatness?: number;
  centroidHz?: number;
  pauseBeforeMs?: number;
  pauseAfterMs?: number;
}

export interface SpeechMarker {
  id: string;
  type: SpeechMarkerType;
  start: number;
  end: number;
  confidence: number;
  wordIds?: string[];
  text?: string;
  language?: string;
  evidence?: SpeechMarkerEvidence;
}

export interface SpeechMarkersPayload {
  schemaVersion: typeof SPEECH_MARKERS_PAYLOAD_VERSION;
  markers: SpeechMarker[];
}

export type SpeechMarkerCounts = Partial<Record<SpeechMarkerType, number>>;

export interface SpeechMarkersManifest {
  schemaVersion: typeof SPEECH_MARKERS_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  markerCount: number;
  counts: SpeechMarkerCounts;
  payloadRef: AudioArtifactRef;
  sourceVoiceActivityArtifactId?: string;
  transcriptHash?: string;
}

export interface CreateSpeechMarkersManifestInput extends Omit<SpeechMarkersManifest, 'schemaVersion'> {
  schemaVersion?: typeof SPEECH_MARKERS_MANIFEST_VERSION;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isSpeechMarkerType(value: unknown): value is SpeechMarkerType {
  return typeof value === 'string' && SPEECH_MARKER_TYPES.includes(value as SpeechMarkerType);
}

function assertMarker(marker: SpeechMarker, index: number): void {
  if (!marker.id) {
    throw new Error(`Speech marker at index ${index} must have a non-empty id.`);
  }
  if (!isSpeechMarkerType(marker.type)) {
    throw new Error(`Speech marker at index ${index} has unsupported type: ${String(marker.type)}`);
  }
  if (!Number.isFinite(marker.start) || !Number.isFinite(marker.end) || marker.end < marker.start) {
    throw new Error(`Speech marker at index ${index} must have a valid start/end range.`);
  }
  if (!Number.isFinite(marker.confidence) || marker.confidence < 0 || marker.confidence > 1) {
    throw new Error(`Speech marker at index ${index} confidence must be within [0, 1].`);
  }
}

export function countSpeechMarkers(markers: readonly SpeechMarker[]): SpeechMarkerCounts {
  const counts: SpeechMarkerCounts = {};
  for (const marker of markers) {
    counts[marker.type] = (counts[marker.type] ?? 0) + 1;
  }
  return counts;
}

export function encodeSpeechMarkersPayload(payload: SpeechMarkersPayload): ArrayBuffer {
  if (payload.schemaVersion !== SPEECH_MARKERS_PAYLOAD_VERSION) {
    throw new Error(`Unsupported speech markers payload schema version: ${payload.schemaVersion}`);
  }
  payload.markers.forEach(assertMarker);

  const bytes = textEncoder.encode(JSON.stringify(payload));
  const output = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(output).set(bytes);
  return output;
}

export function decodeSpeechMarkersPayload(input: ArrayBuffer): SpeechMarkersPayload {
  const payload = JSON.parse(textDecoder.decode(new Uint8Array(input))) as SpeechMarkersPayload;
  if (payload.schemaVersion !== SPEECH_MARKERS_PAYLOAD_VERSION) {
    throw new Error(`Unsupported speech markers payload schema version: ${payload.schemaVersion}`);
  }
  if (!Array.isArray(payload.markers)) {
    throw new Error('Speech markers payload must contain a markers array.');
  }
  payload.markers.forEach(assertMarker);
  return payload;
}

export function createSpeechMarkersManifest(
  input: CreateSpeechMarkersManifestInput,
): SpeechMarkersManifest {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number.');
  }
  if (!Number.isFinite(input.duration) || input.duration < 0) {
    throw new Error('duration must be a non-negative finite number.');
  }
  if (!Number.isInteger(input.markerCount) || input.markerCount < 0) {
    throw new Error('markerCount must be a non-negative integer.');
  }
  for (const key of Object.keys(input.counts)) {
    if (!isSpeechMarkerType(key)) {
      throw new Error(`Unsupported speech marker count key: ${key}`);
    }
  }

  return {
    schemaVersion: SPEECH_MARKERS_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    markerCount: input.markerCount,
    counts: { ...input.counts },
    payloadRef: input.payloadRef,
    sourceVoiceActivityArtifactId: input.sourceVoiceActivityArtifactId,
    transcriptHash: input.transcriptHash,
  };
}
