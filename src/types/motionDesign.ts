import type { BlendMode } from './index';
import type {
  MotionModifierStackContractV1,
  MotionModifierTargetPath,
} from '../services/motionDesign/modifiers/contracts';

export type MotionLayerKind = 'shape' | 'null' | 'adjustment' | 'group';
export type ShapePrimitive = 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'path';

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

/** Local pixel space, origin = shape center. Handles are relative to the vertex.
 *  Both adjoining handles at {0,0} => that segment is a straight line. */
export interface MotionPathVertex {
  x: number;
  y: number;
  handleIn: MotionVector2;
  handleOut: MotionVector2;
}

/** Normalized fractions (0..1) of total arc length. */
export interface MotionPathTrim {
  start: number;
  end: number;
  offset: number;
}

/** Pixels along the arc. length <= 0 disables dashing. */
export interface MotionPathDash {
  length: number;
  gap: number;
  offset: number;
}

export interface PathShapeDefinition {
  vertices: MotionPathVertex[];
  closed: boolean;
  trim?: MotionPathTrim;
  dash?: MotionPathDash;
}

export interface MotionLayerDefinition {
  version: 1;
  kind: MotionLayerKind;
  shape?: ShapeDefinition;
  appearance?: AppearanceStack;
  replicator?: ReplicatorDefinition;
  modifierStack?: MotionModifierStackContractV1;
  expressions?: {
    version: 1;
    bindings: MotionExpressionBinding[];
  };
  /** Quarantined legacy payload retained for recovery after a failed migration. */
  replicatorRecovery?: {
    raw: unknown;
    diagnostic: string;
  };
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
  path?: PathShapeDefinition;
}

export type AppearanceKind = 'color-fill' | 'stroke' | 'linear-gradient' | 'radial-gradient' | 'texture-fill';
export const MOTION_APPEARANCE_BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'add',
  'overlay',
  'difference',
] as const satisfies readonly BlendMode[];
export type MotionAppearanceBlendMode =
  (typeof MOTION_APPEARANCE_BLEND_MODES)[number];

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
  /** Render order is bottom-to-top: later items composite over earlier items. */
  items: AppearanceItem[];
  selectedItemId?: string;
}

export interface ReplicatorDefinition {
  contract: 'masterselects.motion-replicator';
  version: 2;
  enabled: boolean;
  revision: number;
  layout: ReplicatorLayout;
  terminalTransform: ReplicatorTerminalTransform;
  /** Persisted author cap. Device and render-target caps remain runtime-only. */
  userLimit?: number;
}

export type ReplicatorLayout =
  | {
      mode: 'grid';
      count: { columns: number; rows: number };
      spacing: MotionVector2;
      patternOffset: MotionVector2;
    }
  | {
      mode: 'linear';
      count: number;
      step: MotionVector2;
    }
  | {
      mode: 'radial';
      count: number;
      center: MotionVector2;
      radius: number;
      startAngleDegrees: number;
      endAngleDegrees: number;
      angleSampling: 'inclusive-end' | 'exclusive-end';
      autoOrient: boolean;
    };

export interface ReplicatorTerminalTransform {
  mode: 'cumulative' | 'absolute';
  position: MotionVector2;
  rotationDegrees: number;
  scale: MotionVector2;
  opacity: number;
}

export type MotionShapeProperty =
  | 'shape.size.w'
  | 'shape.size.h'
  | 'shape.cornerRadius'
  | 'shape.polygon.points'
  | 'shape.polygon.radius'
  | 'shape.polygon.cornerRadius'
  | 'shape.star.points'
  | 'shape.star.outerRadius'
  | 'shape.star.innerRadius'
  | 'shape.star.cornerRadius'
  | 'shape.path.trim.start'
  | 'shape.path.trim.end'
  | 'shape.path.trim.offset'
  | 'shape.path.dash.length'
  | 'shape.path.dash.gap'
  | 'shape.path.dash.offset';

export type MotionAppearanceProperty =
  | `appearance.${string}.opacity`
  | `appearance.${string}.visible`
  | `appearance.${string}.blendMode`
  | `appearance.${string}.color.r`
  | `appearance.${string}.color.g`
  | `appearance.${string}.color.b`
  | `appearance.${string}.color.a`
  | `appearance.${string}.stroke.width`
  | `appearance.${string}.stroke.alignment`
  | `appearance.${string}.gradient.start.x`
  | `appearance.${string}.gradient.start.y`
  | `appearance.${string}.gradient.end.x`
  | `appearance.${string}.gradient.end.y`
  | `appearance.${string}.gradient.center.x`
  | `appearance.${string}.gradient.center.y`
  | `appearance.${string}.gradient.radius`
  | `appearance.${string}.gradient.stop.${string}.offset`
  | `appearance.${string}.gradient.stop.${string}.color.r`
  | `appearance.${string}.gradient.stop.${string}.color.g`
  | `appearance.${string}.gradient.stop.${string}.color.b`
  | `appearance.${string}.gradient.stop.${string}.color.a`;

export type MotionReplicatorProperty =
  | 'replicator.enabled'
  | 'replicator.layout.mode'
  | 'replicator.count.x'
  | 'replicator.count.y'
  | 'replicator.spacing.x'
  | 'replicator.spacing.y'
  | 'replicator.patternOffset.x'
  | 'replicator.patternOffset.y'
  | 'replicator.linear.count'
  | 'replicator.linear.step.x'
  | 'replicator.linear.step.y'
  | 'replicator.radial.count'
  | 'replicator.radial.center.x'
  | 'replicator.radial.center.y'
  | 'replicator.radial.radius'
  | 'replicator.radial.startAngleDegrees'
  | 'replicator.radial.endAngleDegrees'
  | 'replicator.radial.angleSampling'
  | 'replicator.radial.autoOrient'
  | 'replicator.offset.mode'
  | 'replicator.offset.position.x'
  | 'replicator.offset.position.y'
  | 'replicator.offset.rotation'
  | 'replicator.offset.scale.x'
  | 'replicator.offset.scale.y'
  | 'replicator.offset.opacity'
  | 'replicator.userLimit';

export type MotionProperty = MotionShapeProperty | MotionAppearanceProperty | MotionReplicatorProperty;

export const DEFAULT_MOTION_COLOR: MotionColor = { r: 1, g: 1, b: 1, a: 1 };
export const DEFAULT_MOTION_SHAPE_SIZE = { w: 320, h: 180 };
export const MOTION_PATH_MAX_VERTICES = 128;
export const MOTION_PATH_MAX_FLATTENED_VERTICES = 512;
export const DEFAULT_MOTION_PATH_TRIM: MotionPathTrim = { start: 0, end: 1, offset: 0 };
export const DEFAULT_MOTION_PATH_DASH: MotionPathDash = { length: 0, gap: 0, offset: 0 };

export function createMotionAppearanceId(prefix = 'appearance'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createMotionExpressionBinding(
  path: MotionModifierTargetPath,
  source: string,
  fallback = 0,
  enabled = true,
  id = createMotionAppearanceId('expression'),
): MotionExpressionBinding {
  return { id, path, source, fallback, enabled };
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

export interface MotionExpressionBinding {
  id: string;
  path: MotionModifierTargetPath;
  source: string;
  fallback: number;
  enabled: boolean;
}

export function createTextureFillAppearance(
  id = createMotionAppearanceId('texture-fill'),
): TextureFillAppearance {
  return {
    id,
    kind: 'texture-fill',
    name: 'Texture Fill',
    visible: true,
    opacity: 1,
    fit: 'contain',
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
    },
  };
}

export function createLinearGradientAppearance(
  colors: [MotionColor, MotionColor] = [
    { r: 0.18, g: 0.42, b: 1, a: 1 },
    { r: 0.75, g: 0.2, b: 0.95, a: 1 },
  ],
  id = createMotionAppearanceId('linear-gradient'),
): LinearGradientAppearance {
  return {
    id,
    kind: 'linear-gradient',
    name: 'Linear Gradient',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    start: { x: 0, y: 0.5 },
    end: { x: 1, y: 0.5 },
    stops: colors.map((color, index) => ({
      id: createMotionAppearanceId('stop'),
      offset: index,
      color: { ...color },
    })),
  };
}

export function createRadialGradientAppearance(
  colors: [MotionColor, MotionColor] = [
    { r: 1, g: 1, b: 1, a: 1 },
    { r: 0.18, g: 0.42, b: 1, a: 1 },
  ],
  id = createMotionAppearanceId('radial-gradient'),
): RadialGradientAppearance {
  return {
    id,
    kind: 'radial-gradient',
    name: 'Radial Gradient',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    center: { x: 0.5, y: 0.5 },
    radius: 0.5,
    stops: colors.map((color, index) => ({
      id: createMotionAppearanceId('stop'),
      offset: index,
      color: { ...color },
    })),
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
  if (primitive === 'path') {
    return {
      primitive,
      size: { ...size },
      path: createDefaultPathShape(size),
    };
  }

  return {
    primitive,
    size: { ...size },
    cornerRadius: primitive === 'rectangle' ? 0 : undefined,
    polygon: { points: 6, radius: Math.min(size.w, size.h) / 2, cornerRadius: 0 },
    star: { points: 5, outerRadius: Math.min(size.w, size.h) / 2, innerRadius: Math.min(size.w, size.h) / 4, cornerRadius: 0 },
  };
}

export function createDefaultPathShape(
  size: { w: number; h: number },
): PathShapeDefinition {
  return {
    vertices: [
      {
        x: -size.w / 2,
        y: 0,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      },
      {
        x: size.w / 2,
        y: 0,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 },
      },
    ],
    closed: false,
  };
}

export function createDefaultReplicatorDefinition(): ReplicatorDefinition {
  return {
    contract: 'masterselects.motion-replicator',
    version: 2,
    enabled: false,
    revision: 0,
    layout: {
      mode: 'grid',
      count: { columns: 3, rows: 3 },
      spacing: { x: 120, y: 120 },
      patternOffset: { x: 0, y: 0 },
    },
    terminalTransform: {
      mode: 'cumulative',
      position: { x: 0, y: 0 },
      rotationDegrees: 0,
      scale: { x: 1, y: 1 },
      opacity: 1,
    },
    userLimit: 10000,
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
    /^shape\.(polygon\.(points|radius|cornerRadius)|star\.(points|outerRadius|innerRadius|cornerRadius)|path\.(trim\.(start|end|offset)|dash\.(length|gap|offset)))$/.test(property) ||
    /^appearance\.[^.]+\.(opacity|visible|blendMode|color\.(r|g|b|a)|stroke\.(width|alignment)|gradient\.(start\.(x|y)|end\.(x|y)|center\.(x|y)|radius|stop\.[^.]+\.(offset|color\.(r|g|b|a))))$/.test(property) ||
    /^replicator\.(enabled|layout\.mode|count\.(x|y)|spacing\.(x|y)|patternOffset\.(x|y)|linear\.(count|step\.(x|y))|radial\.(count|center\.(x|y)|radius|startAngleDegrees|endAngleDegrees|angleSampling|autoOrient)|offset\.(mode|position\.(x|y)|rotation|scale\.(x|y)|opacity)|userLimit)$/.test(property)
  );
}
