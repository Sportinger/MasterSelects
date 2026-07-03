import type { ClipMask } from '../../types/masks';
import type { Keyframe } from '../../types/keyframes';
import type { TransitionPrimitive } from '../../transitions';
import { makeKeyframe, makeMaskPathKeyframe } from './transitionCompositionKeyframes';

export function makeMaskVertex(maskId: string, index: number, x: number, y: number): ClipMask['vertices'][number] {
  return {
    id: `${maskId}:v:${index}`,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

export function buildIncomingRevealMask(maskId: string): ClipMask {
  return {
    id: maskId,
    name: 'Light Leak Reveal',
    mode: 'add',
    inverted: false,
    opacity: 1,
    feather: 120,
    featherQuality: 80,
    enabled: true,
    visible: true,
    outlineColor: '#ffb36a',
    closed: true,
    expanded: true,
    position: { x: -0.62, y: 0 },
    vertices: [
      makeMaskVertex(maskId, 0, -2, -1),
      makeMaskVertex(maskId, 1, 0.22, -1),
      makeMaskVertex(maskId, 2, 0.58, 2),
      makeMaskVertex(maskId, 3, -2, 2),
    ],
  };
}

export function buildWipeMask(maskId: string, direction: 'left' | 'right' | 'up' | 'down', feather: number | undefined): ClipMask {
  const vertices = direction === 'left'
    ? [[0, -3], [3, -3], [3, 3], [0, 3]]
    : direction === 'up'
      ? [[-3, 0], [3, 0], [3, 3], [-3, 3]]
      : direction === 'down'
        ? [[-3, -3], [3, -3], [3, 0], [-3, 0]]
        : [[-3, -3], [0, -3], [0, 3], [-3, 3]];

  return {
    id: maskId,
    name: 'Transition Wipe',
    mode: 'add',
    inverted: false,
    opacity: 1,
    feather: Math.max(0, Math.round((feather ?? 0.02) * 1200)),
    featherQuality: 80,
    enabled: true,
    visible: true,
    outlineColor: '#4a9eff',
    closed: true,
    expanded: false,
    position: { x: 0, y: 0 },
    vertices: vertices.map(([x, y], index) => makeMaskVertex(maskId, index, x, y)),
  };
}

export function buildRectMaskVertices(maskId: string, left: number, top: number, right: number, bottom: number): ClipMask['vertices'] {
  return [
    makeMaskVertex(maskId, 0, left, top),
    makeMaskVertex(maskId, 1, right, top),
    makeMaskVertex(maskId, 2, right, bottom),
    makeMaskVertex(maskId, 3, left, bottom),
  ];
}

export function buildPolygonMaskVertices(maskId: string, points: readonly [number, number][]): ClipMask['vertices'] {
  return points.map(([x, y], index) => makeMaskVertex(maskId, index, x, y));
}

export function collapseMaskVertices(vertices: ClipMask['vertices'], x = 0.5, y = 0.5): ClipMask['vertices'] {
  return vertices.map((vertex) => ({
    ...vertex,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
  }));
}

export function buildGenericRevealMask(maskId: string, primitive: Extract<TransitionPrimitive, { kind: 'mask' }>): ClipMask {
  const shape = primitive.mask === 'shape' ? primitive.shape : undefined;
  const vertices = shape === 'circle' || shape === 'oval'
    ? buildPolygonMaskVertices(maskId, Array.from({ length: 24 }, (_, index) => {
        const angle = (index / 24) * Math.PI * 2;
        const radiusX = shape === 'oval' ? 2.3 : 2.1;
        const radiusY = shape === 'oval' ? 1.45 : 2.1;
        return [0.5 + Math.cos(angle) * radiusX, 0.5 + Math.sin(angle) * radiusY] as [number, number];
      }))
    : shape === 'triangle'
    ? buildPolygonMaskVertices(maskId, [[0.5, -1.8], [2.5, 2.2], [-1.5, 2.2]])
    : shape === 'diamond'
      ? buildPolygonMaskVertices(maskId, [[0.5, -1.8], [2.8, 0.5], [0.5, 2.8], [-1.8, 0.5]])
      : shape === 'star' || shape === 'cross'
        ? buildPolygonMaskVertices(maskId, [[0.5, -1.8], [1.0, -0.1], [2.8, -0.1], [1.3, 0.9], [1.9, 2.8], [0.5, 1.6], [-0.9, 2.8], [-0.3, 0.9], [-1.8, -0.1], [0, -0.1]])
        : buildRectMaskVertices(maskId, -2, -2, 3, 3);

  return {
    id: maskId,
    name: 'Transition Reveal',
    mode: 'add',
    inverted: false,
    opacity: 1,
    feather: primitive.mask === 'shape' ? 80 : 60,
    featherQuality: 80,
    enabled: true,
    visible: true,
    outlineColor: '#4a9eff',
    closed: true,
    expanded: false,
    position: { x: 0, y: 0 },
    vertices,
  };
}

export function buildMaskMaterializationFromRecipe(
  recipe: readonly TransitionPrimitive[],
  target: 'outgoing' | 'incoming',
  clipId: string,
  duration: number,
): { masks: ClipMask[]; keyframes: Keyframe[] } {
  const masks: ClipMask[] = [];
  const keyframes: Keyframe[] = [];
  recipe.forEach((primitive, index) => {
    if (primitive.kind !== 'mask' || primitive.target !== target) return;

    const maskId = `transition-comp:${clipId}:mask:${index}`;
    if (primitive.mask === 'wipe') {
      masks.push(buildWipeMask(maskId, primitive.direction, primitive.feather));
      const axis = primitive.direction === 'up' || primitive.direction === 'down' ? 'y' : 'x';
      const start = primitive.direction === 'left' || primitive.direction === 'up' ? 1.2 : -1.2;
      const end = primitive.direction === 'left' || primitive.direction === 'up' ? -1.2 : 1.2;
      keyframes.push(makeKeyframe(clipId, `mask.${maskId}.position.${axis}` as Keyframe['property'], 0, start));
      keyframes.push(makeKeyframe(clipId, `mask.${maskId}.position.${axis}` as Keyframe['property'], duration, end, 'ease-in-out'));
      return;
    }

    const mask = buildGenericRevealMask(maskId, primitive);
    masks.push(mask);

    const collapsed = primitive.mask === 'center' && primitive.axis === 'x'
      ? buildRectMaskVertices(maskId, 0.5, -2, 0.5, 3)
      : primitive.mask === 'center' && primitive.axis === 'y'
        ? buildRectMaskVertices(maskId, -2, 0.5, 3, 0.5)
        : collapseMaskVertices(mask.vertices);
    keyframes.push(makeMaskPathKeyframe(clipId, maskId, 0, collapsed));
    keyframes.push(makeMaskPathKeyframe(clipId, maskId, duration, mask.vertices, 'ease-in-out'));
  });
  return { masks, keyframes };
}
