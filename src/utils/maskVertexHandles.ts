import type { MaskVertex, MaskVertexHandleMode } from '../types';

const EPSILON = 0.000001;

function hasHandle(handle: { x: number; y: number }): boolean {
  return Math.hypot(handle.x, handle.y) > EPSILON;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalize(vector: { x: number; y: number }, fallback: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(vector.x, vector.y);
  if (length < EPSILON) return fallback;
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function getNeighbor(vertices: MaskVertex[], index: number, direction: -1 | 1, closed: boolean): MaskVertex | null {
  const nextIndex = index + direction;
  if (nextIndex >= 0 && nextIndex < vertices.length) return vertices[nextIndex] ?? null;
  if (!closed || vertices.length < 2) return null;
  return vertices[(nextIndex + vertices.length) % vertices.length] ?? null;
}

export function inferMaskVertexHandleMode(vertex: MaskVertex): MaskVertexHandleMode {
  if (vertex.handleMode) return vertex.handleMode;

  const hasIn = hasHandle(vertex.handleIn);
  const hasOut = hasHandle(vertex.handleOut);
  if (!hasIn && !hasOut) return 'none';

  const mirroredX = Math.abs(vertex.handleIn.x + vertex.handleOut.x);
  const mirroredY = Math.abs(vertex.handleIn.y + vertex.handleOut.y);
  return mirroredX < 0.0001 && mirroredY < 0.0001 ? 'mirrored' : 'split';
}

export function getNextMaskVertexHandleMode(mode: MaskVertexHandleMode): MaskVertexHandleMode {
  if (mode === 'none') return 'mirrored';
  if (mode === 'mirrored') return 'split';
  return 'none';
}

export function createDefaultMaskVertexHandles(
  vertices: MaskVertex[],
  index: number,
  closed: boolean,
): Pick<MaskVertex, 'handleIn' | 'handleOut'> {
  const vertex = vertices[index];
  if (!vertex) {
    return {
      handleIn: { x: -0.05, y: 0 },
      handleOut: { x: 0.05, y: 0 },
    };
  }

  const prev = getNeighbor(vertices, index, -1, closed);
  const next = getNeighbor(vertices, index, 1, closed);
  const fallbackDirection = next
    ? normalize({ x: next.x - vertex.x, y: next.y - vertex.y }, { x: 1, y: 0 })
    : prev
      ? normalize({ x: vertex.x - prev.x, y: vertex.y - prev.y }, { x: 1, y: 0 })
      : { x: 1, y: 0 };
  const tangent = prev && next
    ? normalize({ x: next.x - prev.x, y: next.y - prev.y }, fallbackDirection)
    : fallbackDirection;
  const neighborDistance = prev && next
    ? Math.min(distance(vertex, prev), distance(vertex, next))
    : next
      ? distance(vertex, next)
      : prev
        ? distance(vertex, prev)
        : 0.3;
  const handleLength = Math.max(0.025, Math.min(0.12, neighborDistance / 3));

  return {
    handleIn: {
      x: -tangent.x * handleLength,
      y: -tangent.y * handleLength,
    },
    handleOut: {
      x: tangent.x * handleLength,
      y: tangent.y * handleLength,
    },
  };
}

export function getMaskVertexHandleModeUpdates(
  vertices: MaskVertex[],
  vertexId: string,
  mode: MaskVertexHandleMode,
  closed: boolean,
): Partial<MaskVertex> | null {
  const index = vertices.findIndex(vertex => vertex.id === vertexId);
  const vertex = vertices[index];
  if (!vertex) return null;

  if (mode === 'none') {
    return {
      handleMode: 'none',
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
    };
  }

  const hasIn = hasHandle(vertex.handleIn);
  const hasOut = hasHandle(vertex.handleOut);
  const defaults = createDefaultMaskVertexHandles(vertices, index, closed);
  const handleOut = hasOut
    ? vertex.handleOut
    : hasIn
      ? { x: -vertex.handleIn.x, y: -vertex.handleIn.y }
      : defaults.handleOut;
  const handleIn = mode === 'mirrored'
    ? { x: -handleOut.x, y: -handleOut.y }
    : hasIn
      ? vertex.handleIn
      : defaults.handleIn;

  return {
    handleMode: mode,
    handleIn,
    handleOut,
  };
}

export function getMaskVerticesHandleModeUpdates(
  vertices: MaskVertex[],
  vertexIds: string[],
  mode: MaskVertexHandleMode,
  closed: boolean,
): Array<{ id: string; updates: Partial<MaskVertex> }> {
  return vertexIds.flatMap((vertexId) => {
    const updates = getMaskVertexHandleModeUpdates(vertices, vertexId, mode, closed);
    return updates ? [{ id: vertexId, updates }] : [];
  });
}
