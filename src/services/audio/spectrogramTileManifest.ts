import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const SPECTROGRAM_TILE_SET_MANIFEST_VERSION = 1 as const;
export const SPECTROGRAM_TILE_PAYLOAD_VERSION = 1 as const;

export type SpectrogramFftSize = 1024 | 2048 | 4096 | 8192;
export type SpectrogramWindowFunction = 'hann';
export type SpectrogramFrequencyScale = 'linear' | 'log' | 'mel';

export interface SpectrogramTileRef {
  tileIndex: number;
  channelIndex: number;
  frameStart: number;
  frameCount: number;
  frequencyBinStart: number;
  frequencyBinCount: number;
  payloadRef: AudioArtifactRef;
}

export interface SpectrogramTileSetManifest {
  schemaVersion: typeof SPECTROGRAM_TILE_SET_MANIFEST_VERSION;
  mediaFileId: string;
  sourceFingerprint: string;
  clipAudioStateHash?: string;
  sampleRate: number;
  channelLayout: AudioChannelLayout;
  duration: number;
  fftSize: SpectrogramFftSize;
  hopSize: number;
  window: SpectrogramWindowFunction;
  frequencyScale: SpectrogramFrequencyScale;
  minDb: number;
  maxDb: number;
  tileWidthFrames: number;
  tileHeightBins: number;
  tiles: SpectrogramTileRef[];
}

export interface SpectrogramTilePayloadHeader {
  schemaVersion: typeof SPECTROGRAM_TILE_PAYLOAD_VERSION;
  tileIndex: number;
  channelIndex: number;
  frameStart: number;
  frameCount: number;
  frequencyBinStart: number;
  frequencyBinCount: number;
  minDb: number;
  maxDb: number;
  valueLayout: 'time-major';
  valueEncoding: 'normalized-db';
}

export interface SpectrogramTilePayload {
  header: SpectrogramTilePayloadHeader;
  values: Float32Array;
}

export interface CreateSpectrogramTileSetManifestInput extends Omit<
  SpectrogramTileSetManifest,
  'schemaVersion'
> {
  schemaVersion?: typeof SPECTROGRAM_TILE_SET_MANIFEST_VERSION;
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

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createSpectrogramTileSetManifest(
  input: CreateSpectrogramTileSetManifestInput,
): SpectrogramTileSetManifest {
  assertPositiveFinite(input.sampleRate, 'sampleRate');
  assertNonNegativeFinite(input.duration, 'duration');
  assertPositiveInteger(input.channelLayout.channelCount, 'channelLayout.channelCount');
  assertPositiveInteger(input.hopSize, 'hopSize');
  assertPositiveInteger(input.tileWidthFrames, 'tileWidthFrames');
  assertPositiveInteger(input.tileHeightBins, 'tileHeightBins');

  if (input.minDb >= input.maxDb) {
    throw new Error('minDb must be lower than maxDb.');
  }

  const tiles = input.tiles
    .toSorted((a, b) => a.tileIndex - b.tileIndex)
    .map((tile) => {
      assertNonNegativeInteger(tile.tileIndex, 'tileIndex');
      assertNonNegativeInteger(tile.channelIndex, 'channelIndex');
      assertNonNegativeInteger(tile.frameStart, 'frameStart');
      assertPositiveInteger(tile.frameCount, 'frameCount');
      assertNonNegativeInteger(tile.frequencyBinStart, 'frequencyBinStart');
      assertPositiveInteger(tile.frequencyBinCount, 'frequencyBinCount');

      if (tile.channelIndex >= input.channelLayout.channelCount) {
        throw new Error('tile.channelIndex must be within channelLayout.channelCount.');
      }

      return tile;
    });

  return {
    schemaVersion: SPECTROGRAM_TILE_SET_MANIFEST_VERSION,
    mediaFileId: input.mediaFileId,
    sourceFingerprint: input.sourceFingerprint,
    clipAudioStateHash: input.clipAudioStateHash,
    sampleRate: input.sampleRate,
    channelLayout: input.channelLayout,
    duration: input.duration,
    fftSize: input.fftSize,
    hopSize: input.hopSize,
    window: input.window,
    frequencyScale: input.frequencyScale,
    minDb: input.minDb,
    maxDb: input.maxDb,
    tileWidthFrames: input.tileWidthFrames,
    tileHeightBins: input.tileHeightBins,
    tiles,
  };
}

export function encodeSpectrogramTilePayload(payload: SpectrogramTilePayload): ArrayBuffer {
  const expectedValues = payload.header.frameCount * payload.header.frequencyBinCount;
  if (payload.values.length !== expectedValues) {
    throw new Error('Spectrogram tile values length must match frameCount * frequencyBinCount.');
  }
  if (payload.header.minDb >= payload.header.maxDb) {
    throw new Error('Spectrogram tile minDb must be lower than maxDb.');
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

export function decodeSpectrogramTilePayload(input: ArrayBuffer): SpectrogramTilePayload {
  const view = new DataView(input);
  const headerLength = view.getUint32(0, true);
  const headerStart = 4;
  const headerEnd = headerStart + headerLength;

  if (headerEnd > input.byteLength) {
    throw new Error('Spectrogram tile header exceeds buffer length.');
  }

  const header = JSON.parse(
    textDecoder.decode(new Uint8Array(input, headerStart, headerLength)),
  ) as SpectrogramTilePayloadHeader;

  if (header.schemaVersion !== SPECTROGRAM_TILE_PAYLOAD_VERSION) {
    throw new Error(`Unsupported spectrogram tile payload schema version: ${header.schemaVersion}`);
  }
  if (header.valueLayout !== 'time-major') {
    throw new Error(`Unsupported spectrogram tile value layout: ${header.valueLayout}`);
  }
  if (header.valueEncoding !== 'normalized-db') {
    throw new Error(`Unsupported spectrogram tile value encoding: ${header.valueEncoding}`);
  }

  const valuesByteLength = input.byteLength - headerEnd;
  if (valuesByteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Spectrogram tile values must be Float32 aligned.');
  }

  const valuesBytes = new Uint8Array(input, headerEnd, valuesByteLength);
  const valuesBuffer = new ArrayBuffer(valuesByteLength);
  new Uint8Array(valuesBuffer).set(valuesBytes);
  const values = new Float32Array(valuesBuffer);
  const expectedValues = header.frameCount * header.frequencyBinCount;
  if (values.length !== expectedValues) {
    throw new Error('Spectrogram tile value count does not match decoded header.');
  }

  return { header, values };
}
