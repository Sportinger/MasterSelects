import type {
  VectorAnimationDataBindingPropertyPath,
  VectorAnimationInputProperty,
  VectorAnimationStateProperty,
} from './vectorAnimation';
import type { MotionProperty } from './motionDesign';

// Keyframe animation types
export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';
export type RotationInterpolationMode = 'shortest' | 'continuous';

// Bezier control handle for custom curves
export interface BezierHandle {
  x: number;  // Time offset from keyframe (seconds, negative for in-handle)
  y: number;  // Value offset from keyframe value
}

// Transform properties that can be animated
export type TransformProperty =
  | 'opacity'
  | 'speed'
  | 'position.x' | 'position.y' | 'position.z'
  | 'scale.all' | 'scale.x' | 'scale.y' | 'scale.z'
  | 'rotation.x' | 'rotation.y' | 'rotation.z';

export type CameraPropertyName = 'fov' | 'near' | 'far' | 'resolutionWidth' | 'resolutionHeight';
export type CameraProperty = `camera.${CameraPropertyName}`;

// Effect property format: effect.{effectId}.{paramPath}
// Example: effect.effect_123456.shift, effect.eq1.eq.audible.bands.band1k.gainDb
export type EffectProperty = `effect.${string}.${string}`;

// AI/custom node exposed parameter format: node.{nodeId}.{paramName}
export type NodeGraphParamProperty = `node.${string}.${string}`;

// Color correction property format: color.{versionId}.{nodeId}.{paramName}
export type ColorProperty = `color.${string}.${string}.${string}`;

// Mask property formats:
// - mask.{maskId}.path stores the whole bezier path as one keyframe value
// - mask.{maskId}.position.x/y and edge values remain numeric keyframes
export type MaskPathProperty = `mask.${string}.path`;
export type MaskNumericPropertyName = 'position.x' | 'position.y' | 'feather' | 'featherQuality';
export type MaskNumericProperty = `mask.${string}.${MaskNumericPropertyName}`;
export type MaskEdgeFeatherProperty = `mask.${string}.edge.${string}.feather`;
export type MaskProperty = MaskPathProperty | MaskNumericProperty | MaskEdgeFeatherProperty;
export type ParsedMaskProperty =
  | { maskId: string; property: 'path' | MaskNumericPropertyName }
  | { maskId: string; property: 'edgeFeather'; edgeId: string };

// Text boundary property formats:
// - textBounds.path stores the paragraph bounds bezier path as one keyframe value
// - textBounds.position.x/y offset the whole text bounds path
export type TextBoundsPathProperty = 'textBounds.path';
export type TextBoundsNumericPropertyName = 'position.x' | 'position.y';
export type TextBoundsNumericProperty = `textBounds.${TextBoundsNumericPropertyName}`;
export type TextBoundsProperty = TextBoundsPathProperty | TextBoundsNumericProperty;

export type TransitionRenderProperty = 'transitionRender.progress';

// Combined animatable property type
export type AnimatableProperty = TransformProperty | CameraProperty | EffectProperty | NodeGraphParamProperty | ColorProperty | MaskProperty | TextBoundsProperty | TransitionRenderProperty | VectorAnimationInputProperty | VectorAnimationStateProperty | VectorAnimationDataBindingPropertyPath | MotionProperty;

export function isCameraProperty(property: string): property is CameraProperty {
  return /^camera\.(fov|near|far|resolutionWidth|resolutionHeight)$/.test(property);
}

export function parseCameraProperty(property: string): CameraPropertyName | null {
  return isCameraProperty(property) ? property.slice('camera.'.length) as CameraPropertyName : null;
}

// Helper to check if a property is an effect property
export function isEffectProperty(property: string): property is EffectProperty {
  return property.startsWith('effect.');
}

// Helper to parse effect property into parts. paramName preserves the full nested
// path after the effect id for compatibility with older callers.
export function parseEffectProperty(property: EffectProperty): { effectId: string; paramName: string; paramPath: string[] } | null {
  const parts = property.split('.');
  if (parts.length >= 3 && parts[0] === 'effect') {
    return { effectId: parts[1], paramName: parts.slice(2).join('.'), paramPath: parts.slice(2) };
  }
  return null;
}

// Helper to create effect property string
export function createEffectProperty(effectId: string, paramName: string): EffectProperty {
  return `effect.${effectId}.${paramName}` as EffectProperty;
}

export function isNodeGraphParamProperty(property: string): property is NodeGraphParamProperty {
  return property.startsWith('node.');
}

export function parseNodeGraphParamProperty(property: string): { nodeId: string; paramName: string } | null {
  const match = /^node\.([^.]+)\.(.+)$/.exec(property);
  if (match) {
    return { nodeId: match[1], paramName: match[2] };
  }
  return null;
}

export function createNodeGraphParamProperty(nodeId: string, paramName: string): NodeGraphParamProperty {
  return `node.${nodeId}.${paramName}` as NodeGraphParamProperty;
}

export function isColorProperty(property: string): property is ColorProperty {
  return property.startsWith('color.');
}

export function createMaskPathProperty(maskId: string): MaskPathProperty {
  return `mask.${maskId}.path` as MaskPathProperty;
}

export function createMaskNumericProperty(maskId: string, property: MaskNumericPropertyName): MaskNumericProperty {
  return `mask.${maskId}.${property}` as MaskNumericProperty;
}

export function createMaskEdgeFeatherProperty(maskId: string, edgeId: string): MaskEdgeFeatherProperty {
  return `mask.${maskId}.edge.${edgeId}.feather` as MaskEdgeFeatherProperty;
}

export function isMaskPathProperty(property: string): property is MaskPathProperty {
  return /^mask\.[^.]+\.path$/.test(property);
}

export function isMaskNumericProperty(property: string): property is MaskNumericProperty {
  return /^mask\.[^.]+\.(position\.(x|y)|feather|featherQuality)$/.test(property);
}

export function isMaskEdgeFeatherProperty(property: string): property is MaskEdgeFeatherProperty {
  return /^mask\.[^.]+\.edge\.[^.]+\.feather$/.test(property);
}

export function parseMaskProperty(property: string): ParsedMaskProperty | null {
  const edgeMatch = /^mask\.([^.]+)\.edge\.([^.]+)\.feather$/.exec(property);
  if (edgeMatch) {
    return { maskId: edgeMatch[1], property: 'edgeFeather', edgeId: edgeMatch[2] };
  }

  const match = /^mask\.([^.]+)\.(.+)$/.exec(property);
  if (!match) return null;

  const [, maskId, maskProperty] = match;
  if (
    maskProperty === 'path' ||
    maskProperty === 'position.x' ||
    maskProperty === 'position.y' ||
    maskProperty === 'feather' ||
    maskProperty === 'featherQuality'
  ) {
    return { maskId, property: maskProperty };
  }
  return null;
}

export function createTextBoundsPathProperty(): TextBoundsPathProperty {
  return 'textBounds.path';
}

export function createTextBoundsNumericProperty(property: TextBoundsNumericPropertyName): TextBoundsNumericProperty {
  return `textBounds.${property}` as TextBoundsNumericProperty;
}

export function isTextBoundsPathProperty(property: string): property is TextBoundsPathProperty {
  return property === 'textBounds.path';
}

export function isTextBoundsNumericProperty(property: string): property is TextBoundsNumericProperty {
  return /^textBounds\.position\.(x|y)$/.test(property);
}

export function parseTextBoundsProperty(property: string): 'path' | TextBoundsNumericPropertyName | null {
  if (property === 'textBounds.path') return 'path';
  if (property === 'textBounds.position.x') return 'position.x';
  if (property === 'textBounds.position.y') return 'position.y';
  return null;
}
