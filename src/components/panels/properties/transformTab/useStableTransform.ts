import { useMemo } from 'react';

import type { ClipTransform } from '../../../../types/timelineCore';

type Vector3 = { x: number; y: number; z: number };

function useStableVector(x: number, y: number, z: number): Vector3 {
  return useMemo(() => ({ x, y, z }), [x, y, z]);
}

/**
 * Structural sharing for an interpolated transform. `getInterpolatedTransform` builds new objects on
 * every call, so memoised inspector sections would re-render on every playhead tick or unrelated
 * store change. The returned transform, and each of its sub-objects, keeps its identity while its
 * values stay the same, so a memoised section re-renders only when a value it shows changes.
 */
export function useStableTransform(transform: ClipTransform): ClipTransform {
  const { opacity, blendMode } = transform;
  const position = useStableVector(transform.position.x, transform.position.y, transform.position.z);
  const rotation = useStableVector(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  const hasAnchor = transform.anchor !== undefined;
  const anchorVector = useStableVector(transform.anchor?.x ?? 0, transform.anchor?.y ?? 0, transform.anchor?.z ?? 0);
  const anchor = hasAnchor ? anchorVector : undefined;
  const { all: scaleAll, x: scaleX, y: scaleY, z: scaleZ } = transform.scale;
  const scale = useMemo(() => ({
    ...(scaleAll !== undefined ? { all: scaleAll } : {}),
    x: scaleX,
    y: scaleY,
    ...(scaleZ !== undefined ? { z: scaleZ } : {}),
  }), [scaleAll, scaleX, scaleY, scaleZ]);
  return useMemo(() => ({
    opacity,
    blendMode,
    position,
    ...(anchor ? { anchor } : {}),
    scale,
    rotation,
  }), [anchor, blendMode, opacity, position, rotation, scale]);
}
