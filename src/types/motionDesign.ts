import type { BlendMode } from './index';

export type MotionLayerKind = 'shape' | 'null' | 'adjustment' | 'group';
export type ShapePrimitive = 'rectangle' | 'ellipse' | 'polygon' | 'star';

export interface MotionColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface MotionVector2 {
  x: number;
  y: number;
}

export interface MotionLayerDefinition {
  version: 1;
  kind: MotionLayerKind;
  shape?: ShapeDefinition;
  appearance?: AppearanceStack;
  replicator?: ReplicatorDefinition;
  ui?: MotionLayerUiState;
}

export interface MotionLayerUiState {
  labelColor?: string;
  locked?: boolean;
  pinnedProperties?: string[];
  propertiesSearch?: string;
}

export interface ShapeDefinition {
  primitive: ShapePrimitive;
  size: { w: number; h: number };
  cornerRadius?: number;
  polygon?: {
    points: number;
    radius: number;
    cornerRadius: number;
  };
  star?: {
    points: number;
    outerRadius: number;
    innerRadius: number;
    cornerRadius: number;
  };
}

export type AppearanceKind = 'color-fill' | 'stroke' | 'linear-gradient' | 'radial-gradient' | 'texture-fill';

export interface AppearanceItemBase {
  id: string;
  kind: AppearanceKind;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: BlendMode;
}

export interface ColorFillAppearance extends AppearanceItemBase {
  kind: 'color-fill';
  color: MotionColor;
}

export interface StrokeAppearance extends AppearanceItemBase {
  kind: 'stroke';
  color: MotionColor;
  width: number;
  alignment: 'center' | 'inside' | 'outside';
}

export interface GradientStop {
  id: string;
  offset: number;
  color: MotionColor;
}

export interface LinearGradientAppearance extends AppearanceItemBase {
  kind: 'linear-gradient';
  stops: GradientStop[];
  start: MotionVector2;
  end: MotionVector2;
}

export interface RadialGradientAppearance extends AppearanceItemBase {
  kind: 'radial-gradient';
  stops: GradientStop[];
  center: MotionVector2;
  radius: number;
}

export interface TextureFillAppearance extends AppearanceItemBase {
  kind: 'texture-fill';
  mediaFileId?: string;
  fit: 'contain' | 'cover' | 'fill' | 'stretch' | 'tile';
  transform: {
    position: MotionVector2;
    scale: MotionVector2;
    rotation: number;
  };
  time?: number;
}

export type AppearanceItem =
  | ColorFillAppearance
  | StrokeAppearance
  | LinearGradientAppearance
  | RadialGradientAppearance
  | TextureFillAppearance;

export interface AppearanceStack {
  version: 1;
  items: AppearanceItem[];
  selectedItemId?: string;
}

export interface ReplicatorDefinition {
  enabled: boolean;
  layout: ReplicatorLayout;
  offset: ReplicatorOffset;
  distribution?: ReplicatorDistribution;
  modifiers: ReplicatorModifier[];
  falloff?: ReplicatorFalloff;
  maxInstances?: number;
}

export type ReplicatorLayout =
  | {
      mode: 'grid';
      count: { x: number; y: number };
      spacing: MotionVector2;
      patternOffset?: MotionVector2;
    }
  | {
      mode: 'linear';
      count: number;
      spacing: number;
      direction: MotionVector2;
    }
  | {
      mode: 'radial';
      count: number;
      radius: number;
      startAngle: number;
      endAngle: number;
      autoOrient: boolean;
    };

export interface ReplicatorOffset {
  position: MotionVector2;
  rotation: number;
  scale: MotionVector2;
  opacity: number;
  mode: 'cumulative' | 'absolute';
}

export interface ReplicatorDistribution {
  seed?: number;
  randomizeOrder?: boolean;
}

export interface ReplicatorModifier {
  id: string;
  kind: 'random' | 'noise' | 'oscillator' | 'field';
  enabled: boolean;
  seed?: number;
  targetProperties: string[];
  params: Record<string, number | boolean | string>;
}

export interface ReplicatorFalloff {
  shapeClipId: string;
  feather: number;
  invert: boolean;
  clip: boolean;
}

export type MotionShapeProperty =
  | 'shape.size.w'
  | 'shape.size.h'
  | 'shape.cornerRadius';

export type MotionAppearanceProperty =
  | `appearance.${string}.opacity`
  | `appearance.${string}.color.r`
  | `appearance.${string}.color.g`
  | `appearance.${string}.color.b`
  | `appearance.${string}.color.a`
  | `appearance.${string}.stroke.width`
  | `appearance.${string}.stroke.alignment`;

export type MotionReplicatorProperty =
  | 'replicator.enabled'
  | 'replicator.layout.mode'
  | 'replicator.count.x'
  | 'replicator.count.y'
  | 'replicator.spacing.x'
  | 'replicator.spacing.y'
  | 'replicator.offset.position.x'
  | 'replicator.offset.position.y'
  | 'replicator.offset.rotation'
  | 'replicator.offset.scale.x'
  | 'replicator.offset.scale.y'
  | 'replicator.offset.opacity';

export type MotionProperty = MotionShapeProperty | MotionAppearanceProperty | MotionReplicatorProperty;

export const DEFAULT_MOTION_COLOR: MotionColor = { r: 1, g: 1, b: 1, a: 1 };
export const DEFAULT_MOTION_SHAPE_SIZE = { w: 320, h: 180 };

export function createMotionAppearanceId(prefix = 'appearance'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createColorFillAppearance(
  color: MotionColor = DEFAULT_MOTION_COLOR,
  id = createMotionAppearanceId('fill'),
): ColorFillAppearance {
  return {
    id,
    kind: 'color-fill',
    name: 'Fill',
    visible: true,
    opacity: 1,
    color: { ...color },
  };
}

export function createStrokeAppearance(
  color: MotionColor = { r: 0, g: 0, b: 0, a: 1 },
  id = createMotionAppearanceId('stroke'),
): StrokeAppearance {
  return {
    id,
    kind: 'stroke',
    name: 'Stroke',
    visible: false,
    opacity: 1,
    color: { ...color },
    width: 4,
    alignment: 'center',
  };
}

export function createDefaultAppearanceStack(fillColor?: MotionColor): AppearanceStack {
  const fill = createColorFillAppearance(fillColor);
  return {
    version: 1,
    items: [fill],
    selectedItemId: fill.id,
  };
}

export function createDefaultShapeDefinition(
  primitive: ShapePrimitive = 'rectangle',
  size = DEFAULT_MOTION_SHAPE_SIZE,
): ShapeDefinition {
  return {
    primitive,
    size: { ...size },
    cornerRadius: primitive === 'rectangle' ? 0 : undefined,
    polygon: { points: 6, radius: Math.min(size.w, size.h) / 2, cornerRadius: 0 },
    star: { points: 5, outerRadius: Math.min(size.w, size.h) / 2, innerRadius: Math.min(size.w, size.h) / 4, cornerRadius: 0 },
  };
}

export function createDefaultReplicatorDefinition(): ReplicatorDefinition {
  return {
    enabled: false,
    layout: {
      mode: 'grid',
      count: { x: 3, y: 3 },
      spacing: { x: 120, y: 120 },
      patternOffset: { x: 0, y: 0 },
    },
    offset: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
      mode: 'cumulative',
    },
    modifiers: [],
    maxInstances: 10000,
  };
}

export function createDefaultMotionLayerDefinition(
  kind: MotionLayerKind,
  options: {
    primitive?: ShapePrimitive;
    size?: { w: number; h: number };
    fillColor?: MotionColor;
  } = {},
): MotionLayerDefinition {
  if (kind === 'shape') {
    return {
      version: 1,
      kind,
      shape: createDefaultShapeDefinition(options.primitive, options.size),
      appearance: createDefaultAppearanceStack(options.fillColor),
      replicator: createDefaultReplicatorDefinition(),
      ui: {},
    };
  }

  return {
    version: 1,
    kind,
    ui: {},
  };
}

export function isMotionProperty(property: string): property is MotionProperty {
  return (
    property === 'shape.size.w' ||
    property === 'shape.size.h' ||
    property === 'shape.cornerRadius' ||
    /^appearance\.[^.]+\.(opacity|color\.(r|g|b|a)|stroke\.(width|alignment))$/.test(property) ||
    /^replicator\.(enabled|layout\.mode|count\.(x|y)|spacing\.(x|y)|offset\.(position\.(x|y)|rotation|scale\.(x|y)|opacity))$/.test(property)
  );
}
