// Pure math of a mask edge drag (two adjacent vertices moved together), shared by the desktop mask
// overlay (useMaskEdgeDrag, Shift / Ctrl) and the phone pen overlay (touch toggles), so both apply
// exactly the same constraints.

export interface MaskEdgeDragPoint {
  id: string;
  x: number;
  y: number;
}

export interface MaskEdgeDragStart {
  vertexA: MaskEdgeDragPoint;
  vertexB: MaskEdgeDragPoint;
  /** Neighbour before A (null on the open end of a path). */
  previousA: MaskEdgeDragPoint | null;
  /** Neighbour after B (null on the open end of a path). */
  nextB: MaskEdgeDragPoint | null;
}

/**
 * New positions of the two edge vertices after a drag by (dx, dy) in mask space.
 * `snapToAxis` keeps the edge exactly horizontal or vertical (whichever it is closer to);
 * `alignAdjacentEdges` lines the moved vertices up with their outer neighbours so the
 * neighbouring edges stay perpendicular.
 */
export function buildMaskEdgeDragUpdates(
  start: MaskEdgeDragStart,
  dx: number,
  dy: number,
  snapToAxis: boolean,
  alignAdjacentEdges: boolean,
): Array<{ id: string; updates: { x: number; y: number } }> {
  const nextA = { x: start.vertexA.x + dx, y: start.vertexA.y + dy };
  const nextB = { x: start.vertexB.x + dx, y: start.vertexB.y + dy };
  const horizontalEdge = Math.abs(start.vertexB.x - start.vertexA.x) >= Math.abs(start.vertexB.y - start.vertexA.y);

  if (snapToAxis) {
    if (horizontalEdge) {
      const y = (nextA.y + nextB.y) / 2;
      nextA.y = y;
      nextB.y = y;
    } else {
      const x = (nextA.x + nextB.x) / 2;
      nextA.x = x;
      nextB.x = x;
    }
  }

  if (alignAdjacentEdges) {
    if (horizontalEdge) {
      if (start.previousA) nextA.x = start.previousA.x;
      if (start.nextB) nextB.x = start.nextB.x;
    } else {
      if (start.previousA) nextA.y = start.previousA.y;
      if (start.nextB) nextB.y = start.nextB.y;
    }
  }

  return [
    { id: start.vertexA.id, updates: nextA },
    { id: start.vertexB.id, updates: nextB },
  ];
}
