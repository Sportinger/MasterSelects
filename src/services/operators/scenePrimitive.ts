import type { BoundOperatorNode, ScenePrimitiveShape } from '../../types/operatorGraph';
import type { ScenePrimitiveLayer } from '../../engine/scene/types';

export const SCENE_PRIMITIVE_SHAPES: readonly ScenePrimitiveShape[] = ['box', 'sphere', 'cylinder'];
export type { ScenePrimitiveShape } from '../../types/operatorGraph';

export function isScenePrimitiveShape(value: unknown): value is ScenePrimitiveShape {
  return typeof value === 'string' && SCENE_PRIMITIVE_SHAPES.includes(value as ScenePrimitiveShape);
}

export function scenePrimitiveShape(node: BoundOperatorNode): ScenePrimitiveShape {
  const value = node.constants?.shape;
  return isScenePrimitiveShape(value) ? value : 'box';
}

export function scenePrimitiveMeshType(shape: ScenePrimitiveShape): ScenePrimitiveLayer['meshType'] {
  return shape === 'box' ? 'cube' : shape;
}
