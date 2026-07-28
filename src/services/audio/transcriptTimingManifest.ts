import type { TranscriptAlignmentMethod, TranscriptWord } from '../../types/clipMetadata';
import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const TRANSCRIPT_TIMING_MANIFEST_VERSION = 1 as const;
export const TRANSCRIPT_TIMING_PAYLOAD_VERSION = 1 as const;

export interface AlignedWordTiming {
  wordId: string;
  alignedStart: number;
  alignedEnd: number;
  confidence: number;
}

export interface TranscriptTimingPayloadHeader {
  schemaVersion: typeof TRANSCRIPT_TIMING_PAYLOAD_VERSION;
  method: TranscriptAlignmentMethod;
  wordCount: number;
  wordIds: string[];
  valueLayout: 'word-major';
  valueEncoding: 'start-end-confidence-f32';
  timeUnit: 'seconds';
}

export interface TranscriptTimingPayload {
  header: TranscriptTimingPayloadHeader;
  values: Float32Array;
}

export interface TranscriptTimingSummary {
  meanShiftMs?: number;
  refinedWordRatio?: number;
}

export interface TranscriptTimingManifest {
  schemaVersion: typeof TRANSCRIPT_TIMING_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  method: TranscriptAlignmentMethod;
  model?: { id: string; version: string };
  transcriptHash: string;
  wordCount: number;
  timingsPayloadRef: AudioArtifactRef;
  sourceVoiceActivityArtifactId?: string;
  summary?: TranscriptTimingSummary;
}

export interface CreateTranscriptTimingManifestInput extends Omit<TranscriptTimingManifest, 'schemaVersion'> {
  schemaVersion?: typeof TRANSCRIPT_TIMING_MANIFEST_VERSION;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ALIGNMENT_METHODS: readonly TranscriptAlignmentMethod[] = [
  'acoustic-refine',
  'ctc-align',
  'whisperx',
];

export function isTranscriptAlignmentMethod(value: unknown): value is TranscriptAlignmentMethod {
  return typeof value === 'string'
    && ALIGNMENT_METHODS.includes(value as TranscriptAlignmentMethod);
}

export function timingsToPayload(
  timings: readonly AlignedWordTiming[],
  method: TranscriptAlignmentMethod,
): TranscriptTimingPayload {
  const values = new Float32Array(timings.length * 3);
  const wordIds: string[] = [];
  timings.forEach((timing, index) => {
    wordIds.push(timing.wordId);
    values[index * 3] = timing.alignedStart;
    values[index * 3 + 1] = timing.alignedEnd;
    values[index * 3 + 2] = timing.confidence;
  });

  return {
    header: {
      schemaVersion: TRANSCRIPT_TIMING_PAYLOAD_VERSION,
      method,
      wordCount: timings.length,
      wordIds,
      valueLayout: 'word-major',
      valueEncoding: 'start-end-confidence-f32',
      timeUnit: 'seconds',
    },
    values,
  };
}

export function payloadToTimings(payload: TranscriptTimingPayload): AlignedWordTiming[] {
  const timings: AlignedWordTiming[] = [];
  for (let index = 0; index < payload.header.wordCount; index += 1) {
    timings.push({
      wordId: payload.header.wordIds[index] ?? '',
      alignedStart: payload.values[index * 3] ?? 0,
      alignedEnd: payload.values[index * 3 + 1] ?? 0,
      confidence: payload.values[index * 3 + 2] ?? 0,
    });
  }
  return timings;
}

function assertHeader(header: TranscriptTimingPayloadHeader): void {
  if (header.schemaVersion !== TRANSCRIPT_TIMING_PAYLOAD_VERSION) {
    throw new Error(`Unsupported transcript timing payload schema version: ${header.schemaVersion}`);
  }
  if (!isTranscriptAlignmentMethod(header.method)) {
    throw new Error(`Unsupported transcript timing method: ${String(header.method)}`);
  }
  if (header.valueLayout !== 'word-major') {
    throw new Error(`Unsupported transcript timing value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'start-end-confidence-f32') {
    throw new Error(`Unsupported transcript timing value encoding: ${header.valueEncoding}`);
  }
  if (header.timeUnit !== 'seconds') {
    throw new Error(`Unsupported transcript timing time unit: ${header.timeUnit}`);
  }
  if (!Number.isInteger(header.wordCount) || header.wordCount < 0) {
    throw new Error('wordCount must be a non-negative integer.');
  }
  if (header.wordIds.length !== header.wordCount) {
    throw new Error('Transcript timing wordIds length must match wordCount.');
  }
}

export function encodeTranscriptTimingPayload(payload: TranscriptTimingPayload): ArrayBuffer {
  assertHeader(payload.header);
  if (payload.values.length !== payload.header.wordCount * 3) {
    throw new Error('Transcript timing payload value count must match wordCount * 3.');
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

export function decodeTranscriptTimingPayload(input: ArrayBuffer): TranscriptTimingPayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Transcript timing payload header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as TranscriptTimingPayloadHeader;
  assertHeader(header);

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Transcript timing values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);

  if (values.length !== header.wordCount * 3) {
    throw new Error('Transcript timing payload wordCount does not match decoded values.');
  }

  return { header, values };
}

export function createTranscriptTimingManifest(
  input: CreateTranscriptTimingManifestInput,
): TranscriptTimingManifest {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number.');
  }
  if (!Number.isFinite(input.duration) || input.duration < 0) {
    throw new Error('duration must be a non-negative finite number.');
  }
  if (!isTranscriptAlignmentMethod(input.method)) {
    throw new Error(`Unsupported transcript timing method: ${String(input.method)}`);
  }
  if (!input.transcriptHash) {
    throw new Error('transcriptHash must be a non-empty string.');
  }
  if (!Number.isInteger(input.wordCount) || input.wordCount < 0) {
    throw new Error('wordCount must be a non-negative integer.');
  }

  return {
    schemaVersion: TRANSCRIPT_TIMING_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    method: input.method,
    model: input.model ? { ...input.model } : undefined,
    transcriptHash: input.transcriptHash,
    wordCount: input.wordCount,
    timingsPayloadRef: input.timingsPayloadRef,
    sourceVoiceActivityArtifactId: input.sourceVoiceActivityArtifactId,
    summary: input.summary ? { ...input.summary } : undefined,
  };
}

// Transcript-dependent artifacts fold the transcript identity into the opaque
// sourceFingerprint so the existing cache-key/staleness machinery works
// without schema changes.
export function createTranscriptTimingFingerprint(
  audioFingerprint: string,
  transcriptHash: string,
): string {
  if (!audioFingerprint || !transcriptHash) {
    throw new Error('audioFingerprint and transcriptHash must be non-empty strings.');
  }
  return `${audioFingerprint}+transcript=${transcriptHash}`;
}

function roundTime(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// Canonical, deterministic transcript identity: id, text, and provider-reported
// times (6 decimal places) per word. Aligned fields are intentionally excluded
// so applying alignment output does not invalidate its own artifact.
export function serializeTranscriptWordsCanonical(
  words: readonly Pick<TranscriptWord, 'id' | 'text' | 'start' | 'end'>[],
): string {
  return JSON.stringify(
    words.map((word) => [word.id, word.text, roundTime(word.start), roundTime(word.end)]),
  );
}

export async function computeTranscriptWordsHash(
  words: readonly Pick<TranscriptWord, 'id' | 'text' | 'start' | 'end'>[],
): Promise<string> {
  const canonical = serializeTranscriptWordsCanonical(words);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
