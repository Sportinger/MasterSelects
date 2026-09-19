import { gzipSync, gunzipSync } from 'fflate';
import type { FaceCableConfig } from './cableData';
import { isFaceCableConfig } from './cableData';

export const SCENE_FACE_POINTS = 468;
export const MAX_CABLE_SCENE_FLOATS = 14_000_000;
export interface CableSceneBake {
  version: 1; fps: number; frames: number; duration: number;
  cables: FaceCableConfig[]; triangles: number[]; outline: number[]; data: Float32Array;
}
export function cableSceneLayout(cables: FaceCableConfig[]) {
  let stride = 1 + (4 + SCENE_FACE_POINTS) * 5;
  const offsets = cables.map(c => { const offset = stride; stride += 6 + ((c.segments ?? 24) + 1) * 3; return offset; });
  return { stride, offsets };
}
export function encodeCableScene(bake: CableSceneBake): string {
  const bytes = gzipSync(new Uint8Array(bake.data.buffer, bake.data.byteOffset, bake.data.byteLength));
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return JSON.stringify({ ...bake, data: btoa(binary) });
}
const cache = new Map<string, CableSceneBake | null>();
export function decodeCableScene(value: unknown): CableSceneBake | null {
  if (typeof value !== 'string' || !value || value.length > 80_000_000) return null;
  if (cache.has(value)) return cache.get(value)!;
  let result: CableSceneBake | null = null;
  try {
    const b = JSON.parse(value);
    if (b.version !== 1 || !Array.isArray(b.cables) || !b.cables.length || b.cables.length > 32 || !b.cables.every(isFaceCableConfig)
      || !Number.isInteger(b.frames) || b.frames < 1 || b.frames > 18001 || !Number.isFinite(b.fps) || b.fps <= 0
      || !Number.isFinite(b.duration) || b.duration <= 0 || typeof b.data !== 'string') throw Error();
    const count = b.frames * cableSceneLayout(b.cables).stride;
    if (count > MAX_CABLE_SCENE_FLOATS || !Array.isArray(b.triangles) || !b.triangles.length || b.triangles.length > 6000 || b.triangles.length % 3
      || !Array.isArray(b.outline) || b.outline.length < 3 || b.outline.length > 100
      || ![...b.triangles, ...b.outline].every(i => Number.isInteger(i) && i >= 0 && i < SCENE_FACE_POINTS)) throw Error();
    const compressed = Uint8Array.from(atob(b.data), c => c.charCodeAt(0));
    if (new DataView(compressed.buffer).getUint32(compressed.length - 4, true) !== count * 4) throw Error();
    const bytes = gunzipSync(compressed);
    if (bytes.byteLength !== count * 4) throw Error();
    const data = new Float32Array(bytes.slice().buffer);
    if (!data.every(Number.isFinite)) throw Error();
    result = { ...b, data };
  } catch { /* A damaged scene artifact must not break the scene renderer. */ }
  if (cache.size >= 2) cache.delete(cache.keys().next().value!);
  cache.set(value, result);
  return result;
}
