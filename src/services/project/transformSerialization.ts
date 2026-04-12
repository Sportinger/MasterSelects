import type { BlendMode, ClipTransform } from '../../types';
import type { ProjectTransform } from './types';

const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  opacity: 1,
  blendMode: 'normal',
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1 },
  rotation: { x: 0, y: 0, z: 0 },
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

type ClipTransformLike = Partial<ClipTransform> & {
  x?: number;
  y?: number;
  z?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  rotation?: number | { x?: number; y?: number; z?: number };
  rotationX?: number;
  rotationY?: number;
  blendMode?: BlendMode | string;
  opacity?: number;
};

export function toProjectTransform(transform: ClipTransformLike | undefined): ProjectTransform {
  const position = transform?.position;
  const scale = transform?.scale;
  const rotation = typeof transform?.rotation === 'object' ? transform.rotation : undefined;
  const rotationZ = typeof transform?.rotation === 'number'
    ? transform.rotation
    : rotation?.z;
  const scaleZ = scale?.z ?? transform?.scaleZ;

  return {
    x: finiteNumber(position?.x ?? transform?.x, DEFAULT_CLIP_TRANSFORM.position.x),
    y: finiteNumber(position?.y ?? transform?.y, DEFAULT_CLIP_TRANSFORM.position.y),
    z: finiteNumber(position?.z ?? transform?.z, DEFAULT_CLIP_TRANSFORM.position.z),
    scaleX: finiteNumber(scale?.x ?? transform?.scaleX, DEFAULT_CLIP_TRANSFORM.scale.x),
    scaleY: finiteNumber(scale?.y ?? transform?.scaleY, DEFAULT_CLIP_TRANSFORM.scale.y),
    ...(scaleZ !== undefined ? { scaleZ: finiteNumber(scaleZ, 1) } : {}),
    rotation: finiteNumber(rotationZ, DEFAULT_CLIP_TRANSFORM.rotation.z),
    rotationX: finiteNumber(rotation?.x ?? transform?.rotationX, DEFAULT_CLIP_TRANSFORM.rotation.x),
    rotationY: finiteNumber(rotation?.y ?? transform?.rotationY, DEFAULT_CLIP_TRANSFORM.rotation.y),
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: finiteNumber(transform?.opacity, DEFAULT_CLIP_TRANSFORM.opacity),
    blendMode: (transform?.blendMode as BlendMode | undefined) ?? DEFAULT_CLIP_TRANSFORM.blendMode,
  };
}

export function fromProjectTransform(transform: ProjectTransform | ClipTransformLike | undefined): ClipTransform {
  const normalizedTransform = transform as ClipTransformLike | undefined;
  const position = normalizedTransform?.position;
  const scale = normalizedTransform?.scale;
  const rotation = typeof normalizedTransform?.rotation === 'object' ? normalizedTransform.rotation : undefined;
  const rotationZ = typeof normalizedTransform?.rotation === 'number'
    ? normalizedTransform.rotation
    : rotation?.z;
  const scaleZ = scale?.z ?? normalizedTransform?.scaleZ;

  return {
    opacity: finiteNumber(normalizedTransform?.opacity, DEFAULT_CLIP_TRANSFORM.opacity),
    blendMode: (normalizedTransform?.blendMode as BlendMode | undefined) ?? DEFAULT_CLIP_TRANSFORM.blendMode,
    position: {
      x: finiteNumber(position?.x ?? normalizedTransform?.x, DEFAULT_CLIP_TRANSFORM.position.x),
      y: finiteNumber(position?.y ?? normalizedTransform?.y, DEFAULT_CLIP_TRANSFORM.position.y),
      z: finiteNumber(position?.z ?? normalizedTransform?.z, DEFAULT_CLIP_TRANSFORM.position.z),
    },
    scale: {
      x: finiteNumber(scale?.x ?? normalizedTransform?.scaleX, DEFAULT_CLIP_TRANSFORM.scale.x),
      y: finiteNumber(scale?.y ?? normalizedTransform?.scaleY, DEFAULT_CLIP_TRANSFORM.scale.y),
      ...(scaleZ !== undefined ? { z: finiteNumber(scaleZ, 1) } : {}),
    },
    rotation: {
      x: finiteNumber(rotation?.x ?? normalizedTransform?.rotationX, DEFAULT_CLIP_TRANSFORM.rotation.x),
      y: finiteNumber(rotation?.y ?? normalizedTransform?.rotationY, DEFAULT_CLIP_TRANSFORM.rotation.y),
      z: finiteNumber(rotationZ, DEFAULT_CLIP_TRANSFORM.rotation.z),
    },
  };
}
