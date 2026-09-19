import type { SceneCamera } from '../../../engine/scene/types';
import {
  PATH_SHAPE_CODES,
  evaluatePath,
  rotate,
  rotationMatrixDegrees,
  type PathParams,
} from '../../../engine/flock/shared/flockMath';
import { FLOCK_GROUP_OPERATOR_ID, getFlockOperator } from '../../../services/flock/operators/flockOperatorRegistry';
import { readFlockParamValue } from '../../../services/flock/flockPropertyValues';
import { createFlockProperty, type FlockDefinition, type FlockNode } from '../../../types/flock';
import { projectSimPoint, type CanvasSize, type Vec3 } from './flockGuidanceOverlayMath';

export type FlockGuidanceOutline =
  | { kind: 'ellipsoid'; center: Vec3; radii: Vec3 }
  | { kind: 'box'; center: Vec3; size: Vec3; rotation?: Vec3 }
  | { kind: 'segment'; from: Vec3; to: Vec3 }
  | { kind: 'polyline'; points: Vec3[] };

export interface FlockGuidanceHandle {
  /** `${ownerNodeId}:${paramKey}` */
  id: string;
  /** Node whose keyframe property stores the value (a group instance for inner params). */
  ownerNodeId: string;
  /** Param id, or `${innerNodeId}__${param}` on a group instance. */
  paramKey: string;
  operator: string;
  label: string;
  sim: Vec3;
  outline: FlockGuidanceOutline | null;
}

/** Animated numeric value at the playhead for a flock property path (undefined when unknown). */
export type FlockPropertyReader = (property: string) => number | undefined;

const GUIDANCE_OPERATORS = new Set([
  'flock.emitter',
  'flock.attractor',
  'flock.vortex',
  'flock.cluster',
  'flock.obstacle',
  'flock.boundary',
  'flock.path',
]);

interface ScopedNode {
  node: FlockNode;
  ownerNodeId: string;
  keyFor: (param: string) => string;
  labelPrefix: string;
}

function scopedNodes(definition: FlockDefinition): ScopedNode[] {
  const result: ScopedNode[] = [];
  for (const node of definition.nodes) {
    if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
      const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
      for (const inner of group?.nodes ?? []) {
        if (!GUIDANCE_OPERATORS.has(inner.operator)) continue;
        result.push({
          node: inner,
          ownerNodeId: node.id,
          keyFor: (param) => `${inner.id}__${param}`,
          labelPrefix: `${node.label ?? group?.label ?? 'Group'} › `,
        });
      }
      continue;
    }
    if (GUIDANCE_OPERATORS.has(node.operator)) {
      result.push({ node, ownerNodeId: node.id, keyFor: (param) => param, labelPrefix: '' });
    }
  }
  return result;
}

function readVector(
  definition: FlockDefinition,
  scoped: ScopedNode,
  param: string,
  read: FlockPropertyReader,
  fallback: Vec3 = [0, 0, 0],
): Vec3 {
  const key = scoped.keyFor(param);
  const stored = readFlockParamValue(definition, scoped.ownerNodeId, key);
  const base: Vec3 = Array.isArray(stored) ? [stored[0], stored[1], stored[2]] : fallback;
  return [
    read(createFlockProperty(scoped.ownerNodeId, key, 'x')) ?? base[0],
    read(createFlockProperty(scoped.ownerNodeId, key, 'y')) ?? base[1],
    read(createFlockProperty(scoped.ownerNodeId, key, 'z')) ?? base[2],
  ];
}

function readNumber(definition: FlockDefinition, scoped: ScopedNode, param: string, read: FlockPropertyReader, fallback: number): number {
  const key = scoped.keyFor(param);
  const animated = read(createFlockProperty(scoped.ownerNodeId, key));
  if (animated !== undefined) return animated;
  const stored = readFlockParamValue(definition, scoped.ownerNodeId, key);
  return typeof stored === 'number' ? stored : fallback;
}

function readEnum(definition: FlockDefinition, scoped: ScopedNode, param: string, fallback: string): string {
  const stored = readFlockParamValue(definition, scoped.ownerNodeId, scoped.keyFor(param));
  return typeof stored === 'string' ? stored : fallback;
}

const PATH_PREVIEW_SAMPLES = 64;

/** Every editable guidance position of a flock definition, evaluated at the playhead. */
export function collectFlockGuidanceHandles(definition: FlockDefinition, read: FlockPropertyReader): FlockGuidanceHandle[] {
  const handles: FlockGuidanceHandle[] = [];
  for (const scoped of scopedNodes(definition)) {
    const { node } = scoped;
    const operatorLabel = node.label ?? getFlockOperator(node.operator)?.label ?? node.operator;
    const label = (param: string) => `${scoped.labelPrefix}${operatorLabel} · ${param}`;
    const push = (param: string, sim: Vec3, outline: FlockGuidanceOutline | null, paramLabel: string) => {
      const paramKey = scoped.keyFor(param);
      handles.push({ id: `${scoped.ownerNodeId}:${paramKey}`, ownerNodeId: scoped.ownerNodeId, paramKey, operator: node.operator, label: label(paramLabel), sim, outline });
    };
    const vec = (param: string, fallback?: Vec3) => readVector(definition, scoped, param, read, fallback);
    const num = (param: string, fallback: number) => readNumber(definition, scoped, param, read, fallback);

    switch (node.operator) {
      case 'flock.emitter': {
        const center = vec('center');
        const size = vec('size', [80, 80, 80]);
        const shape = readEnum(definition, scoped, 'shape', 'sphere');
        let outline: FlockGuidanceOutline | null = null;
        if (shape === 'sphere' || shape === 'shell') outline = { kind: 'ellipsoid', center, radii: size };
        else if (shape === 'box') outline = { kind: 'box', center, size };
        else if (shape === 'disc') outline = { kind: 'ellipsoid', center, radii: [size[0], 0, size[2]] };
        else if (shape === 'line') {
          outline = {
            kind: 'segment',
            from: [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
            to: [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
          };
        }
        push('center', center, outline, 'Center');
        break;
      }
      case 'flock.attractor': {
        const position = vec('position');
        const radius = num('radius', 150);
        push('position', position, { kind: 'ellipsoid', center: position, radii: [radius, radius, radius] }, 'Position');
        break;
      }
      case 'flock.vortex': {
        const center = vec('center');
        const axis = vec('axis', [0, 1, 0]);
        const radius = num('radius', 120);
        const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
        push('center', center, {
          kind: 'segment',
          from: [center[0] - (axis[0] / length) * radius, center[1] - (axis[1] / length) * radius, center[2] - (axis[2] / length) * radius],
          to: [center[0] + (axis[0] / length) * radius, center[1] + (axis[1] / length) * radius, center[2] + (axis[2] / length) * radius],
        }, 'Center');
        break;
      }
      case 'flock.cluster': {
        const center = vec('center');
        const spread = num('spread', 70);
        push('center', center, { kind: 'ellipsoid', center, radii: [spread, spread, spread] }, 'Center');
        break;
      }
      case 'flock.obstacle': {
        const center = vec('center');
        const size = vec('size', [25, 25, 25]);
        const rotation = vec('rotation');
        const shape = readEnum(definition, scoped, 'shape', 'sphere');
        let outline: FlockGuidanceOutline;
        if (shape === 'box') outline = { kind: 'box', center, size, rotation };
        else if (shape === 'capsule') outline = { kind: 'box', center, size: [size[0] * 2, size[1] + size[0] * 2, size[0] * 2], rotation };
        else if (shape === 'plane') outline = { kind: 'box', center, size: [size[0] * 2, 0, size[0] * 2], rotation };
        else outline = { kind: 'ellipsoid', center, radii: [size[0], size[0], size[0]] };
        push('center', center, outline, 'Center');
        break;
      }
      case 'flock.boundary': {
        const center = vec('center');
        const size = vec('size', [160, 160, 160]);
        const shape = readEnum(definition, scoped, 'shape', 'sphere');
        push('center', center, shape === 'box'
          ? { kind: 'box', center, size }
          : { kind: 'ellipsoid', center, radii: [size[0], size[0], size[0]] }, 'Center');
        break;
      }
      case 'flock.path': {
        const shapeName = readEnum(definition, scoped, 'shape', 'circle');
        const points: [Vec3, Vec3, Vec3, Vec3] = [vec('p0'), vec('p1'), vec('p2'), vec('p3')];
        const center = vec('center');
        const params: PathParams = {
          shape: PATH_SHAPE_CODES[shapeName] ?? 0,
          center,
          radius: num('radius', 90),
          height: num('height', 40),
          turns: num('turns', 2),
          rotation: rotationMatrixDegrees(vec('rotation')),
          points,
        };
        const polyline: FlockGuidanceOutline = {
          kind: 'polyline',
          points: Array.from({ length: PATH_PREVIEW_SAMPLES + 1 }, (_, index) => evaluatePath(params, index / PATH_PREVIEW_SAMPLES)),
        };
        if (shapeName === 'polyline') {
          points.forEach((point, index) => push(`p${index}`, point, index === 0 ? polyline : null, `Point ${index + 1}`));
        } else {
          push('center', center, polyline, 'Center');
        }
        break;
      }
    }
  }
  return handles;
}

function ellipsoidRings(center: Vec3, radii: Vec3): Vec3[][] {
  const segments = 48;
  const ring = (axisA: 0 | 1 | 2, axisB: 0 | 1 | 2) => Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    const point: Vec3 = [center[0], center[1], center[2]];
    point[axisA] += Math.cos(angle) * radii[axisA];
    point[axisB] += Math.sin(angle) * radii[axisB];
    return point;
  });
  const rings = [ring(0, 2)];
  if (radii[1] > 0) rings.push(ring(0, 1), ring(1, 2));
  return rings;
}

function boxEdges(center: Vec3, size: Vec3, rotation?: Vec3): Vec3[][] {
  const matrix = rotationMatrixDegrees(rotation ?? [0, 0, 0]);
  const corner = (sx: number, sy: number, sz: number): Vec3 => {
    const local = rotate(matrix, sx * size[0] * 0.5, sy * size[1] * 0.5, sz * size[2] * 0.5);
    return [center[0] + local[0], center[1] + local[1], center[2] + local[2]];
  };
  const signs = [-1, 1];
  const edges: Vec3[][] = [];
  for (const a of signs) {
    for (const b of signs) {
      edges.push([corner(-1, a, b), corner(1, a, b)]);
      edges.push([corner(a, -1, b), corner(a, 1, b)]);
      edges.push([corner(a, b, -1), corner(a, b, 1)]);
    }
  }
  return edges;
}

/** SVG path strings for a guidance outline; segments behind the camera are dropped. */
export function buildFlockOutlinePaths(
  outline: FlockGuidanceOutline,
  simToWorld: ArrayLike<number>,
  camera: Pick<SceneCamera, 'viewMatrix' | 'projectionMatrix'>,
  canvasSize: CanvasSize,
): string[] {
  let polylines: Vec3[][];
  switch (outline.kind) {
    case 'ellipsoid': polylines = ellipsoidRings(outline.center, outline.radii); break;
    case 'box': polylines = boxEdges(outline.center, outline.size, outline.rotation); break;
    case 'segment': polylines = [[outline.from, outline.to]]; break;
    default: polylines = [outline.points];
  }
  const paths: string[] = [];
  for (const polyline of polylines) {
    let path = '';
    let drawing = false;
    for (const point of polyline) {
      const screen = projectSimPoint(simToWorld, point, camera, canvasSize);
      if (screen.depth <= 0 || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        drawing = false;
        continue;
      }
      path += `${drawing ? 'L' : 'M'}${screen.x.toFixed(1)} ${screen.y.toFixed(1)} `;
      drawing = true;
    }
    if (path.includes('L')) paths.push(path.trim());
  }
  return paths;
}
