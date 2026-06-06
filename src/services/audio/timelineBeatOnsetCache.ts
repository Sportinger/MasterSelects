import { blobToArrayBuffer } from '../../artifacts';
import type { AudioArtifactStore } from './AudioArtifactStore';
import { createCurrentAudioArtifactStore } from './timelineWaveformPyramidCache';
import {
  decodeAudioEventListPayload,
  float32ToEvents,
  type AudioEvent,
  type BeatGridManifest,
  type OnsetMapManifest,
} from './beatOnsetManifest';

export interface TimelineBeatGrid {
  sampleRate: number;
  duration: number;
  tempoBpm?: number;
  beatCount: number;
  beats: AudioEvent[];
  summary: BeatGridManifest['summary'];
}

export interface TimelineOnsetMap {
  sampleRate: number;
  duration: number;
  fftSize: number;
  hopSize: number;
  eventCount: number;
  onsets: AudioEvent[];
  summary: OnsetMapManifest['summary'];
}

const beatGridCache = new Map<string, TimelineBeatGrid>();
const onsetMapCache = new Map<string, TimelineOnsetMap>();

export function primeTimelineBeatGridCache(
  keys: readonly string[],
  grid: TimelineBeatGrid,
): void {
  for (const key of keys) {
    if (key) {
      beatGridCache.set(key, grid);
    }
  }
}

export function primeTimelineOnsetMapCache(
  keys: readonly string[],
  map: TimelineOnsetMap,
): void {
  for (const key of keys) {
    if (key) {
      onsetMapCache.set(key, map);
    }
  }
}

export function getCachedTimelineBeatGrid(key: string | undefined): TimelineBeatGrid | undefined {
  return key ? beatGridCache.get(key) : undefined;
}

export function getCachedTimelineOnsetMap(key: string | undefined): TimelineOnsetMap | undefined {
  return key ? onsetMapCache.get(key) : undefined;
}

export function clearTimelineBeatOnsetCache(): void {
  beatGridCache.clear();
  onsetMapCache.clear();
}

export function evictTimelineBeatOnsetRefs(
  keys: Iterable<string | undefined>,
): number {
  let removed = 0;
  for (const key of keys) {
    if (!key) continue;
    if (beatGridCache.delete(key)) {
      removed += 1;
    }
    if (onsetMapCache.delete(key)) {
      removed += 1;
    }
  }
  return removed;
}

export async function readTimelineOnsetMap(
  manifest: OnsetMapManifest,
  store: AudioArtifactStore,
): Promise<TimelineOnsetMap> {
  const payload = await store.getPayload(manifest.eventsPayloadRef.artifactId);
  if (!payload) {
    throw new Error(`Missing onset map payload: ${manifest.eventsPayloadRef.artifactId}`);
  }

  const decoded = decodeAudioEventListPayload(await blobToArrayBuffer(payload));
  if (decoded.header.kind !== 'onset-map' || decoded.header.eventCount !== manifest.eventCount) {
    throw new Error(`Onset map payload header mismatch: ${manifest.eventsPayloadRef.artifactId}`);
  }

  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    fftSize: manifest.fftSize,
    hopSize: manifest.hopSize,
    eventCount: manifest.eventCount,
    onsets: float32ToEvents(decoded.values),
    summary: manifest.summary,
  };
}

export async function readTimelineBeatGrid(
  manifest: BeatGridManifest,
  store: AudioArtifactStore,
): Promise<TimelineBeatGrid> {
  const payload = await store.getPayload(manifest.beatsPayloadRef.artifactId);
  if (!payload) {
    throw new Error(`Missing beat grid payload: ${manifest.beatsPayloadRef.artifactId}`);
  }

  const decoded = decodeAudioEventListPayload(await blobToArrayBuffer(payload));
  if (decoded.header.kind !== 'beat-grid' || decoded.header.eventCount !== manifest.beatCount) {
    throw new Error(`Beat grid payload header mismatch: ${manifest.beatsPayloadRef.artifactId}`);
  }

  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    tempoBpm: manifest.tempoBpm,
    beatCount: manifest.beatCount,
    beats: float32ToEvents(decoded.values),
    summary: manifest.summary,
  };
}

export async function cacheTimelineBeatOnsetFromArtifacts(
  beatGridId: string | undefined,
  onsetMapId: string | undefined,
  store: AudioArtifactStore,
): Promise<{
  beatGrid?: TimelineBeatGrid;
  onsetMap?: TimelineOnsetMap;
}> {
  const [beatArtifact, onsetArtifact] = await Promise.all([
    beatGridId ? store.getAnalysisArtifact(beatGridId) : Promise.resolve(null),
    onsetMapId ? store.getAnalysisArtifact(onsetMapId) : Promise.resolve(null),
  ]);
  const beatManifest = beatArtifact?.metadata?.beatGridManifest as BeatGridManifest | undefined;
  const onsetManifest = onsetArtifact?.metadata?.onsetMapManifest as OnsetMapManifest | undefined;

  const [beatGrid, onsetMap] = await Promise.all([
    beatManifest ? readTimelineBeatGrid(beatManifest, store) : Promise.resolve(undefined),
    onsetManifest ? readTimelineOnsetMap(onsetManifest, store) : Promise.resolve(undefined),
  ]);

  if (beatGrid && beatArtifact && beatGridId) {
    primeTimelineBeatGridCache([
      beatGridId,
      beatArtifact.id,
      beatArtifact.manifestRef.artifactId,
    ], beatGrid);
  }
  if (onsetMap && onsetArtifact && onsetMapId) {
    primeTimelineOnsetMapCache([
      onsetMapId,
      onsetArtifact.id,
      onsetArtifact.manifestRef.artifactId,
    ], onsetMap);
  }

  return { beatGrid, onsetMap };
}

export async function loadTimelineBeatGrid(refId: string | undefined): Promise<TimelineBeatGrid | null> {
  const cached = getCachedTimelineBeatGrid(refId);
  if (cached || !refId) return cached ?? null;

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  const manifest = artifact?.metadata?.beatGridManifest as BeatGridManifest | undefined;
  if (!artifact || !manifest) return null;

  const beatGrid = await readTimelineBeatGrid(manifest, store);
  primeTimelineBeatGridCache([refId, artifact.id, artifact.manifestRef.artifactId], beatGrid);
  return beatGrid;
}

export async function loadTimelineOnsetMap(refId: string | undefined): Promise<TimelineOnsetMap | null> {
  const cached = getCachedTimelineOnsetMap(refId);
  if (cached || !refId) return cached ?? null;

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  const manifest = artifact?.metadata?.onsetMapManifest as OnsetMapManifest | undefined;
  if (!artifact || !manifest) return null;

  const onsetMap = await readTimelineOnsetMap(manifest, store);
  primeTimelineOnsetMapCache([refId, artifact.id, artifact.manifestRef.artifactId], onsetMap);
  return onsetMap;
}
