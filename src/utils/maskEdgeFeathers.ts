import type { ClipMask } from '../types/masks';

export function createMaskEdgeId(fromVertexId: string, toVertexId: string): string {
  return `${fromVertexId}->${toVertexId}`;
}

export function getMaskEdgeFeather(mask: ClipMask, edgeId: string | null): number {
  if (!edgeId) return 0;
  return Math.max(0, mask.edgeFeathers?.[edgeId] ?? 0);
}

export function setMaskEdgeFeatherValue(
  edgeFeathers: Record<string, number> | undefined,
  edgeId: string,
  feather: number,
): Record<string, number> | undefined {
  const next = { ...(edgeFeathers ?? {}) };
  const value = Math.max(0, feather);
  if (value <= 0) {
    delete next[edgeId];
  } else {
    next[edgeId] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
