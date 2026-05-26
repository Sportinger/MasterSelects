import { blobToArrayBuffer } from '../../artifacts';
import { AudioArtifactStore } from './AudioArtifactStore';
import {
  decodeSpectrogramTilePayload,
  type SpectrogramTileSetManifest,
} from './spectrogramTileManifest';
import { createCurrentAudioArtifactStore } from './timelineWaveformPyramidCache';

export interface TimelineSpectrogramChannel {
  channelIndex: number;
  values: Float32Array;
}

export interface TimelineSpectrogramTileSet {
  sampleRate: number;
  duration: number;
  fftSize: number;
  hopSize: number;
  minDb: number;
  maxDb: number;
  frameCount: number;
  frequencyBinCount: number;
  channels: TimelineSpectrogramChannel[];
}

const timelineSpectrogramTileSetCache = new Map<string, TimelineSpectrogramTileSet>();

export function primeTimelineSpectrogramTileSetCache(
  keys: Array<string | undefined>,
  tileSet: TimelineSpectrogramTileSet,
): void {
  for (const key of keys) {
    if (key) {
      timelineSpectrogramTileSetCache.set(key, tileSet);
    }
  }
}

export function getCachedTimelineSpectrogramTileSet(
  key: string | undefined,
): TimelineSpectrogramTileSet | null {
  return key ? timelineSpectrogramTileSetCache.get(key) ?? null : null;
}

function getManifestFrameCount(manifest: SpectrogramTileSetManifest): number {
  return Math.max(0, ...manifest.tiles.map(tile => tile.frameStart + tile.frameCount));
}

function getManifestFrequencyBinCount(manifest: SpectrogramTileSetManifest): number {
  return Math.max(0, ...manifest.tiles.map(tile => tile.frequencyBinStart + tile.frequencyBinCount));
}

function getChannel(
  channels: Map<number, TimelineSpectrogramChannel>,
  channelIndex: number,
  frameCount: number,
  frequencyBinCount: number,
): TimelineSpectrogramChannel {
  const existing = channels.get(channelIndex);
  if (existing) return existing;

  const channel = {
    channelIndex,
    values: new Float32Array(frameCount * frequencyBinCount),
  };
  channels.set(channelIndex, channel);
  return channel;
}

export async function readTimelineSpectrogramTileSet(
  manifest: SpectrogramTileSetManifest,
  store: AudioArtifactStore,
): Promise<TimelineSpectrogramTileSet> {
  const frameCount = getManifestFrameCount(manifest);
  const frequencyBinCount = getManifestFrequencyBinCount(manifest);
  const channels = new Map<number, TimelineSpectrogramChannel>();

  for (const tile of manifest.tiles) {
    const payload = await store.getPayload(tile.payloadRef.artifactId);
    if (!payload) {
      throw new Error(`Missing spectrogram tile payload: ${tile.payloadRef.artifactId}`);
    }

    const decoded = decodeSpectrogramTilePayload(await blobToArrayBuffer(payload));
    if (
      decoded.header.tileIndex !== tile.tileIndex
      || decoded.header.channelIndex !== tile.channelIndex
      || decoded.header.frameStart !== tile.frameStart
      || decoded.header.frameCount !== tile.frameCount
      || decoded.header.frequencyBinStart !== tile.frequencyBinStart
      || decoded.header.frequencyBinCount !== tile.frequencyBinCount
    ) {
      throw new Error(`Spectrogram tile payload header mismatch: ${tile.payloadRef.artifactId}`);
    }

    const channel = getChannel(channels, tile.channelIndex, frameCount, frequencyBinCount);
    for (let frameOffset = 0; frameOffset < tile.frameCount; frameOffset += 1) {
      const sourceOffset = frameOffset * tile.frequencyBinCount;
      const targetOffset = (tile.frameStart + frameOffset) * frequencyBinCount + tile.frequencyBinStart;
      channel.values.set(
        decoded.values.subarray(sourceOffset, sourceOffset + tile.frequencyBinCount),
        targetOffset,
      );
    }
  }

  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    fftSize: manifest.fftSize,
    hopSize: manifest.hopSize,
    minDb: manifest.minDb,
    maxDb: manifest.maxDb,
    frameCount,
    frequencyBinCount,
    channels: Array.from(channels.values()).toSorted((a, b) => a.channelIndex - b.channelIndex),
  };
}

export async function loadTimelineSpectrogramTileSet(
  refId: string | undefined,
): Promise<TimelineSpectrogramTileSet | null> {
  const cached = getCachedTimelineSpectrogramTileSet(refId);
  if (cached || !refId) return cached;

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  if (!artifact) return null;

  const manifest = artifact.metadata?.spectrogramTileSetManifest as SpectrogramTileSetManifest | undefined;
  if (!manifest) return null;

  const tileSet = await readTimelineSpectrogramTileSet(manifest, store);
  primeTimelineSpectrogramTileSetCache([refId, artifact.id, artifact.manifestRef.artifactId], tileSet);
  return tileSet;
}
