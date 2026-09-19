/** Pinned Apache-2.0 Small model. No media is sent to the model host. */
export const DEPTH_MODEL = {
  id: 'onnx-community/depth-anything-v2-small',
  revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d',
  file: 'onnx/model.onnx',
  bytes: 99060839,
  sha256: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c',
};
export const DEPTH_MODEL_URL = `https://huggingface.co/${DEPTH_MODEL.id}/resolve/${DEPTH_MODEL.revision}/${DEPTH_MODEL.file}`;
const CACHE = 'masterselects-depth-model-v1';

export async function verifyDepthModel(bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength !== DEPTH_MODEL.bytes) return false;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') === DEPTH_MODEL.sha256;
}
export async function clearDepthModelCache() { await caches.delete(CACHE); }
export async function depthModelCached() {
  try { return !!await (await caches.open(CACHE)).match(DEPTH_MODEL_URL); } catch { return false; }
}
export async function loadDepthModel(signal: AbortSignal, progress: (fraction: number, message: string) => void): Promise<ArrayBuffer> {
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); } catch { /* Private mode: memory-only download. */ }
  const cached = await cache?.match(DEPTH_MODEL_URL).catch(() => undefined);
  if (cached) {
    progress(0, 'Checking cached depth model');
    const bytes = await cached.arrayBuffer();
    signal.throwIfAborted();
    if (await verifyDepthModel(bytes)) { progress(1, 'Model loaded from browser cache'); return bytes; }
    await cache?.delete(DEPTH_MODEL_URL).catch(() => false);
  }
  const response = await fetch(DEPTH_MODEL_URL, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw new Error(`Depth model download failed (HTTP ${response.status}).`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      signal.throwIfAborted();
      size += value.byteLength;
      if (size > DEPTH_MODEL.bytes) throw new Error('Depth model exceeds its expected size.');
      chunks.push(value);
      progress(size / DEPTH_MODEL.bytes, `Downloading depth model: ${(size / 1e6).toFixed(1)} / 99.1 MB`);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  signal.throwIfAborted();
  progress(1, 'Verifying depth model');
  if (!await verifyDepthModel(bytes.buffer)) throw new Error('Depth model integrity check failed. Retry the download.');
  signal.throwIfAborted();
  try { await cache?.put(DEPTH_MODEL_URL, new Response(bytes)); } catch { progress(1, 'Cache unavailable; model kept for this session'); }
  return bytes.buffer;
}
