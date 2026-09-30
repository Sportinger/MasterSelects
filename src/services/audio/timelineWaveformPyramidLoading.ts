import { blobToArrayBuffer } from '../../artifacts';
import type { TimelineWaveformPyramid } from '../../components/timeline/utils/waveformLod';
import type { AudioArtifactStore } from './AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioArtifactRef } from './audioArtifactTypes';
import { createCurrentAudioArtifactStore } from './currentAudioArtifactStore';
import { getSourceWaveformProjectScope } from './sourceWaveformAnalysisCache';
import { decodeWaveformStatPayload,
  type WaveformPyramidManifest, type WaveformStatistic } from './waveformPyramidManifest';
import { decodeWaveformPayloadInWorker } from './waveformPyramid/WaveformWorkerClient';

const runtime: {
  caches: WeakMap<object, Map<string, TimelineWaveformPyramid>>;
  loads: WeakMap<object, Map<string, Promise<TimelineWaveformPyramid>>>;
  loadStarts?: WeakMap<Promise<TimelineWaveformPyramid>, number>;
} = import.meta.hot?.data?.pyramidRuntime ?? { caches: new WeakMap(), loads: new WeakMap() };
const loadStarts = runtime.loadStarts ??= new WeakMap();
if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.pyramidRuntime = runtime; });
  import.meta.hot.accept();
}
function pyramidCache(): Map<string, TimelineWaveformPyramid> {
  const scope = getSourceWaveformProjectScope();
  let cache = runtime.caches.get(scope);
  if (!cache) { cache = new Map(); runtime.caches.set(scope, cache); }
  return cache;
}

/** Share both resident arrays and pending payload reads across split clips. */
export async function readTimelineWaveformPyramid(manifest: WaveformPyramidManifest, store: AudioArtifactStore): Promise<TimelineWaveformPyramid> {
  const scope = getSourceWaveformProjectScope();
  const key = manifest.packedPayload?.artifactId ?? JSON.stringify(manifest);
  const cache = pyramidCache();
  const cached = cache.get(key);
  if (cached) return cached;
  const loads = runtime.loads.get(scope) ?? new Map<string, Promise<TimelineWaveformPyramid>>();
  if (!runtime.loads.has(scope)) runtime.loads.set(scope, loads);
  const active = loads.get(key);
  // The timeline's load timeout must allow a fresh I/O attempt if a store
  // read stalls during restore. A late successful attempt can still fill cache.
  if (active && Date.now() - (loadStarts.get(active) ?? 0) < 4000) return active;
  const promise = readUncachedTimelineWaveformPyramid(manifest, store).then(pyramid => {
    cache.set(key, pyramid);
    return pyramid;
  }).finally(() => { if (loads.get(key) === promise) loads.delete(key); });
  loads.set(key, promise);
  loadStarts.set(promise, Date.now());
  return promise;
}

async function decodeStatPayload(
  store: AudioArtifactStore,
  ref: AudioArtifactRef | undefined,
  statistic: WaveformStatistic,
): Promise<Float32Array> {
  if (!ref) {
    throw new Error(`Missing waveform ${statistic} payload ref.`);
  }

  const payload = await store.getPayload(ref.artifactId);
  if (!payload) {
    throw new Error(`Missing waveform ${statistic} payload: ${ref.artifactId}`);
  }

  const decoded = decodeWaveformStatPayload(await blobToArrayBuffer(payload));
  if (decoded.header.statistic !== statistic) {
    throw new Error(`Waveform payload statistic mismatch: expected ${statistic}, got ${decoded.header.statistic}`);
  }

  return decoded.values;
}

async function readPackedTimelineWaveformPyramid(
  manifest: WaveformPyramidManifest,
  store: AudioArtifactStore,
): Promise<TimelineWaveformPyramid | null> {
  if (!manifest.packedPayload) {
    return null;
  }

  const payload = await store.getPayload(manifest.packedPayload.artifactId);
  if (!payload) {
    throw new Error(`Missing packed waveform pyramid payload: ${manifest.packedPayload.artifactId}`);
  }

  const levels = await decodeWaveformPayloadInWorker(await blobToArrayBuffer(payload));
  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    levels,
  };
}

export function primeTimelineWaveformPyramidCache(
  keys: Array<string | undefined>,
  pyramid: TimelineWaveformPyramid,
): void {
  for (const key of keys) {
    if (key) {
      pyramidCache().set(key, pyramid);
    }
  }
}

export function getCachedTimelineWaveformPyramid(
  key: string | undefined,
): TimelineWaveformPyramid | null {
  return key ? pyramidCache().get(key) ?? null : null;
}

export function evictTimelineWaveformPyramidRefs(
  keys: Iterable<string | undefined>,
): number {
  let removed = 0;
  for (const key of keys) {
    if (key && pyramidCache().delete(key)) {
      removed += 1;
    }
  }
  return removed;
}

async function readUncachedTimelineWaveformPyramid(
  manifest: WaveformPyramidManifest,
  store: AudioArtifactStore,
): Promise<TimelineWaveformPyramid> {
  const packed = await readPackedTimelineWaveformPyramid(manifest, store);
  if (packed) {
    return packed;
  }

  const levels = await Promise.all(manifest.levels.map(async (level) => ({
    samplesPerBucket: level.samplesPerBucket,
    bucketDuration: level.bucketDuration,
    bucketCount: level.bucketCount,
    channels: await Promise.all(level.channels.map(async (channel) => ({
      channelIndex: channel.channelIndex,
      min: await decodeStatPayload(store, channel.min, 'min'),
      max: await decodeStatPayload(store, channel.max, 'max'),
      rms: await decodeStatPayload(store, channel.rms, 'rms'),
      peak: await decodeStatPayload(store, channel.peak, 'peak'),
    }))),
  })));

  return {
    sampleRate: manifest.sampleRate,
    duration: manifest.duration,
    levels,
  };
}

export async function loadTimelineWaveformPyramid(
  refId: string | undefined,
): Promise<TimelineWaveformPyramid | null> {
  const cached = getCachedTimelineWaveformPyramid(refId);
  if (cached || !refId) return cached;
  return (await loadTimelineWaveformPyramidArtifact(refId))?.pyramid ?? null;
}

export async function loadTimelineWaveformPyramidArtifact(
  refId: string | undefined,
): Promise<{
  pyramid: TimelineWaveformPyramid;
  artifact: AudioAnalysisArtifact;
} | null> {
  const cached = getCachedTimelineWaveformPyramid(refId);
  if (!refId) return null;

  const store = createCurrentAudioArtifactStore();
  const artifact = await store.getAnalysisArtifact(refId);
  if (!artifact) return null;

  const manifest = artifact.metadata?.waveformManifest as WaveformPyramidManifest | undefined;
  if (!manifest) return null;

  const pyramid = cached ?? await readTimelineWaveformPyramid(manifest, store);
  primeTimelineWaveformPyramidCache([refId, artifact.id, artifact.manifestRef.artifactId], pyramid);
  return { pyramid, artifact };
}
