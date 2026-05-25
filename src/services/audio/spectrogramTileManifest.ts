import type { AudioArtifactRef, AudioChannelLayout } from './audioArtifactTypes';

export const SPECTROGRAM_TILE_SET_MANIFEST_VERSION = 1 as const;

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
