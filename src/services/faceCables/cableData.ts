import { gzipSync, gunzipSync } from 'fflate';
import { CABLE_NODES, MAX_CABLE_SEGMENTS } from './cablePhysics';

export const MAX_FACE_CABLES = 32;
export const CABLE_SHADOW_NODES = 25;
export const CABLE_FRAME_STRIDE = 2 + CABLE_NODES * 2;
export const MAX_CABLE_FLOATS = 8_000_000;
export const FACE_CABLE_ANCHORS = {
  forehead: { label: 'Forehead center', indices: [10] },
  noseBridge: { label: 'Nose bridge', indices: [168] },
  rightCheek: { label: 'Right cheek', indices: [205] },
  leftCheek: { label: 'Left cheek', indices: [425] },
  rightBrow: { label: 'Right brow', indices: [105] },
  leftBrow: { label: 'Left brow', indices: [334] },
  rightEar: { label: 'Right ear area (approx.)', indices: [234] },
  leftEar: { label: 'Left ear area (approx.)', indices: [454] },
  rightMouth: { label: 'Right mouth corner', indices: [61] },
  rightEye: { label: 'Right eye center', indices: [33, 133, 159, 145] },
  rightIris: { label: 'Right iris / pupil center', indices: [468] },
  leftIris: { label: 'Left iris / pupil center', indices: [473] },
  leftMouth: { label: 'Left mouth corner', indices: [291] },
  leftEye: { label: 'Left eye center', indices: [263, 362, 386, 374] },
  nose: { label: 'Nose tip', indices: [1] },
  upperLip: { label: 'Upper lip center', indices: [13] },
  lowerLip: { label: 'Lower lip center', indices: [14] },
  chin: { label: 'Chin', indices: [152] },
} as const;
export type CableAnchor = keyof typeof FACE_CABLE_ANCHORS;
export interface FaceCableConfig {
  fromCableId?: string;
  windZ?: number; windGusts?: number;
  renderStyle?: 'shaded' | 'flat'; viscosity?: number;
  segments?: number; stiffness?: number; lockFrom?: boolean; lockTo?: boolean; showAnchors?: boolean;
  id: string; from: CableAnchor; to: CableAnchor; slack: number; gravity: number; damping: number; width: number; color: string;
}
export function isFaceCableConfig(value: unknown): value is FaceCableConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as FaceCableConfig;
  return typeof c.id === 'string' && Object.hasOwn(FACE_CABLE_ANCHORS, c.from) && Object.hasOwn(FACE_CABLE_ANCHORS, c.to)
    && (c.fromCableId === undefined || typeof c.fromCableId === 'string' && c.fromCableId.length > 0 && c.fromCableId !== c.id)
    && (c.windZ === undefined || Number.isFinite(c.windZ))
    && (c.windGusts === undefined || Number.isFinite(c.windGusts) && c.windGusts >= 0 && c.windGusts <= 1)
    && (c.renderStyle === undefined || c.renderStyle === 'shaded' || c.renderStyle === 'flat')
    && (c.viscosity === undefined || Number.isFinite(c.viscosity) && c.viscosity >= 0 && c.viscosity <= 1)
    && (c.segments === undefined || Number.isInteger(c.segments) && c.segments >= 4 && c.segments <= MAX_CABLE_SEGMENTS)
    && (c.stiffness === undefined || Number.isFinite(c.stiffness) && c.stiffness >= 0 && c.stiffness <= 1)
    && [c.lockFrom, c.lockTo, c.showAnchors].every(v => v === undefined || typeof v === 'boolean')
    && Number.isFinite(c.slack) && c.slack >= 1.05
    && Number.isFinite(c.gravity) && c.gravity >= 0
    && Number.isFinite(c.damping) && c.damping >= 0.2
    && Number.isFinite(c.width) && c.width >= 1 && /^#[0-9a-f]{6}$/i.test(c.color);
}
export interface CableBake {
  version: 1 | 2 | 3 | 4; fps: number; frames: number; duration: number; cables: FaceCableConfig[]; data: Float32Array;
}
export function defaultFaceCable(): FaceCableConfig {
  return { windZ: 0, windGusts: 0, renderStyle: 'shaded', viscosity: 0, segments: 24, stiffness: 0, lockFrom: true, lockTo: true, showAnchors: true, id: crypto.randomUUID(), from: 'rightMouth', to: 'rightIris', slack: 1.6, gravity: 0.6, damping: 2.2, width: 6, color: '#ff873d' };
}
export function cableFrameLayout(version: CableBake['version'], cables: FaceCableConfig[]) {
  let stride = 0;
  const offsets = cables.map(c => { const offset = stride; stride += version === 1 ? CABLE_FRAME_STRIDE : 2 + ((c.segments ?? 24) + 1) * (version >= 3 ? 3 : 2) + (version === 4 ? CABLE_SHADOW_NODES * 4 : 0); return offset; });
  return { stride, offsets };
}
export function encodeCableBake(bake: CableBake): string {
  const bytes = gzipSync(new Uint8Array(bake.data.buffer, bake.data.byteOffset, bake.data.byteLength));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return JSON.stringify({ ...bake, data: btoa(binary) });
}
const decoded = new Map<string, CableBake | null>();
export function decodeCableBake(value: unknown): CableBake | null {
  if (typeof value !== 'string' || !value || value.length > 45_000_000) return null;
  if (decoded.has(value)) return decoded.get(value)!;
  let result: CableBake | null = null;
  try {
    const json = JSON.parse(value);
    const count = json.frames * cableFrameLayout(json.version, json.cables).stride;
    if (![1, 2, 3, 4].includes(json.version) || !Number.isInteger(json.frames) || json.frames < 1 || json.frames > 18_001
      || !Array.isArray(json.cables) || !json.cables.length || json.cables.length > MAX_FACE_CABLES
      || !Number.isFinite(json.fps) || json.fps <= 0 || !Number.isFinite(json.duration) || json.duration <= 0
      || !json.cables.every(isFaceCableConfig) || count > MAX_CABLE_FLOATS || typeof json.data !== 'string') throw new Error('Invalid cable bake');
    const compressed = Uint8Array.from(atob(json.data), c => c.charCodeAt(0));
    const advertisedSize = new DataView(compressed.buffer).getUint32(compressed.length - 4, true);
    if (advertisedSize !== count * 4) throw new Error('Invalid cable byte count');
    const bytes = gunzipSync(compressed);
    if (bytes.byteLength !== count * 4) throw new Error('Invalid cable data');
    const data = new Float32Array(bytes.slice().buffer);
    if (!data.every(Number.isFinite)) throw new Error('Invalid cable coordinates');
    result = { ...json, data };
  } catch { /* Invalid artifacts render nothing rather than break preview/export. */ }
  if (decoded.size >= 4) decoded.delete(decoded.keys().next().value!);
  decoded.set(value, result);
  return result;
}
