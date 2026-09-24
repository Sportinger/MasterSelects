/** Full SAM 2.1 video export, including memory and object-pointer modules. Apache-2.0. */
export const ROTO_MODEL = {
  id: 'square-zero-labs/sam2.1-tiny-video-onnx', revision: '3b2984dd865f6e9d2cc6aed0be6a5a5c2eb352ce',
};
const FILES = [
  ['vision_encoder', 134335567, 'aa7a8542942f042e235a993a1ab0ccf5f049918500577802a7f10ec1b39bb873'],
  ['mask_decoder', 17794355, '0461896de3db00936fe1643506f129d71cb6d5d2ae15754811756b7ea1b070c6'],
  ['memory_attention', 32259165, '791e648ce8f5ef91ad00ba06e83066ff261ae5a645f0b042b4f46a89fd054baf'],
  ['memory_encoder', 5616496, '580d246c109de88838f600ba7c1c0d03d1fe267f7641b06f8c88c5f0dc5834cd'],
  ['pointer_tpos', 67289, '7e71df1d75dba09bc18dd4ae745c2a2cceebdd14d84eadea2fe65d0205f101fc'],
] as const;
export type RotoModelPart = typeof FILES[number][0];
export const ROTO_MODEL_BYTES = FILES.reduce((n, f) => n + f[1], 0);
export const rotoModelUrl = (path: string) => `https://huggingface.co/${ROTO_MODEL.id}/resolve/${ROTO_MODEL.revision}/${path}`;
export async function loadRotoModels(progress: (fraction: number, message: string) => void) {
  let cache: Cache | undefined;
  try { cache = await caches.open('masterselects-roto-sam21-v1'); } catch { /* Session-only in private browsing. */ }
  const models = {} as Record<RotoModelPart, ArrayBuffer>;
  let loaded = 0;
  for (const [name, size, hash] of FILES) {
    const url = rotoModelUrl(`onnx/${name}.onnx`);
    const verify = async (bytes: ArrayBuffer) => bytes.byteLength === size &&
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('') === hash;
    let bytes = await (await cache?.match(url).catch(() => undefined))?.arrayBuffer();
    if (bytes && !await verify(bytes)) { await cache?.delete(url); bytes = undefined; }
    if (!bytes) {
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok || !response.body) throw new Error(`SAM 2.1 download failed: ${name} (HTTP ${response.status}).`);
      const result = new Uint8Array(size), reader = response.body.getReader(); let offset = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          if (offset + value.length > size) throw new Error(`Unexpected model size: ${name}.`);
          result.set(value, offset); offset += value.length;
          progress((loaded + offset) / ROTO_MODEL_BYTES, `Downloading SAM 2.1: ${Math.round((loaded + offset) / 1e6)} / 190 MB`);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      bytes = result.buffer;
      if (offset !== size || !await verify(bytes)) throw new Error(`SAM 2.1 integrity check failed: ${name}.`);
      try { await cache?.put(url, new Response(bytes)); } catch { /* Inference can use verified in-memory weights. */ }
    }
    models[name] = bytes; loaded += size;
    progress(loaded / ROTO_MODEL_BYTES, `Verified ${name}`);
  }
  return models;
}
