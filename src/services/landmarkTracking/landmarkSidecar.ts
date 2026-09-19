import type { LandmarkSeries } from './types';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';

const SIDECAR_CACHE = 'masterselects-landmark-sidecars-v1';

function sidecarUrl(clipId: string): string {
  const origin = typeof location === 'undefined' ? 'https://masterselects.local' : location.origin;
  return `${origin}/__masterselects/landmarks/${encodeURIComponent(clipId)}.tracking.json.gz`;
}

async function compress(series: LandmarkSeries): Promise<Blob> {
  const json = JSON.stringify(series);
  const source = new Blob([json], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined' || typeof Blob.prototype.stream !== 'function') {
    const compressed = gzipSync(strToU8(json));
    const copy = new Uint8Array(new ArrayBuffer(compressed.byteLength));
    copy.set(compressed);
    return new Blob([copy], { type: 'application/gzip' });
  }
  const compressed = source.stream().pipeThrough(new CompressionStream('gzip'));
  return new Blob([await new Response(compressed).arrayBuffer()], { type: 'application/gzip' });
}

async function decompress(blob: Blob): Promise<LandmarkSeries> {
  const isGzip = blob.type === 'application/gzip';
  if (isGzip && (typeof DecompressionStream === 'undefined' || typeof Blob.prototype.stream !== 'function')) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return JSON.parse(strFromU8(gunzipSync(bytes))) as LandmarkSeries;
  }
  const stream = isGzip && typeof DecompressionStream !== 'undefined'
    ? blob.stream().pipeThrough(new DecompressionStream('gzip'))
    : blob.stream();
  return JSON.parse(await new Response(stream).text()) as LandmarkSeries;
}

export async function saveLandmarkSidecar(series: LandmarkSeries, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(SIDECAR_CACHE);
  const blob = await compress(series);
  signal?.throwIfAborted();
  await cache.put(sidecarUrl(series.clipId), new Response(blob));
}

export async function loadLandmarkSidecar(clipId: string): Promise<LandmarkSeries | null> {
  if (typeof caches === 'undefined') return null;
  const response = await (await caches.open(SIDECAR_CACHE)).match(sidecarUrl(clipId));
  return response ? decompress(await response.blob()) : null;
}

export async function exportLandmarkSidecar(series: LandmarkSeries): Promise<Blob> {
  return compress(series);
}
