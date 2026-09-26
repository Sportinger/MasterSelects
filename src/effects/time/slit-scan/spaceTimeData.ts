/** Compact, versioned value data; no decoded frames or GPU handles in the project. */
export interface SpaceTimeData {
  version: 1;
  sourceId: string;
  fingerprint: string;
  from: number;
  to: number;
  count: number;
  points: string;
}
export const SPACE_TIME_MAX_POINTS = 65536;

export function encodeSpaceTime(data: Omit<SpaceTimeData, 'version' | 'count' | 'points'>, points: Float32Array): string {
  if (points.length % 8 || points.length / 8 > SPACE_TIME_MAX_POINTS || !points.every(Number.isFinite)) {
    throw new Error('Invalid space-time observations.');
  }
  const bytes = new Uint8Array(points.buffer, points.byteOffset, points.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return JSON.stringify({ ...data, version: 1, count: points.length / 8, points: btoa(binary) });
}

export function decodeSpaceTime(value: unknown): { metadata: SpaceTimeData; points: Float32Array } {
  if (typeof value !== 'string' || value.length > 3_000_000) throw new Error('Bake a space-time window first.');
  const metadata = JSON.parse(value) as SpaceTimeData;
  if (metadata.version !== 1 || typeof metadata.sourceId !== 'string' || typeof metadata.fingerprint !== 'string'
    || !Number.isInteger(metadata.count) || metadata.count < 1 || metadata.count > SPACE_TIME_MAX_POINTS
    || !Number.isFinite(metadata.from) || !Number.isFinite(metadata.to) || metadata.to <= metadata.from
    || typeof metadata.points !== 'string') throw new Error('Invalid space-time bake.');
  const binary = atob(metadata.points);
  if (binary.length !== metadata.count * 32) throw new Error('Incomplete space-time observations.');
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const points = new Float32Array(bytes.buffer);
  if (!points.every(Number.isFinite)) throw new Error('Invalid space-time coordinates.');
  return { metadata, points };
}

/** Rotate (space, scaled time), then select a slab in transformed time. */
export function spaceTimeSlice(position: number, time: number, angle: number, scale: number, slice: number, thickness: number) {
  const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  return { position: c * position + s * time * scale,
    time: -s * position + c * time * scale,
    visible: Math.abs(-s * position + c * time * scale - slice) <= thickness / 2 };
}
