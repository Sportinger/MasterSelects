import { MOTION_REPLICATOR_SHADER_MAX_INSTANCES } from '../../engine/motion/MotionTypes';
import {
  MOTION_MAX_APPEARANCES,
  MOTION_MAX_GRADIENT_STOPS,
} from '../../engine/motion/MotionBuffers';
import type {
  AppearanceItem,
  ColorFillAppearance,
  GradientStop,
  MotionColor,
  MotionLayerDefinition,
  MotionVector2,
  ShapeDefinition,
  StrokeAppearance,
} from '../../types/motionDesign';
import { MOTION_APPEARANCE_BLEND_MODES } from '../../types/motionDesign';
import type {
  PropertyAuthoringDescriptorView,
  PropertyDescriptor,
  PropertyValue,
} from '../../types/propertyRegistry';
import type { TimelineClip } from '../../types/timeline';
import { propertyRegistry } from '../properties';
import {
  describePropertyAuthoringDescriptor,
  validatePropertyAuthoringValue,
  writePropertyAuthoringValue,
} from '../properties/propertyAuthoring';
import { normalizeMotionReplicatorBundle } from './contracts/replicatorTimelineAdapter';

export const MOTION_DESIGN_MVP_CAPABILITY_VERSION = 2;
export const MOTION_DESIGN_MVP_PRIMITIVES = [
  'rectangle',
  'ellipse',
  'polygon',
  'star',
  'path',
] as const;
export const MOTION_DESIGN_MVP_APPEARANCES = [
  'color-fill',
  'stroke',
  'linear-gradient',
  'radial-gradient',
] as const;
export const MOTION_DESIGN_MVP_REPLICATOR_LAYOUTS = ['grid', 'linear', 'radial'] as const;
export const MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS = 10_000;

const SUPPORTED_STATIC_PROPERTY_PATHS = new Set([
  'shape.size.w',
  'shape.size.h',
  'shape.cornerRadius',
  'shape.polygon.points',
  'shape.polygon.radius',
  'shape.polygon.cornerRadius',
  'shape.star.points',
  'shape.star.outerRadius',
  'shape.star.innerRadius',
  'shape.star.cornerRadius',
  'shape.path.trim.start',
  'shape.path.trim.end',
  'shape.path.trim.offset',
  'shape.path.dash.length',
  'shape.path.dash.gap',
  'shape.path.dash.offset',
  'replicator.enabled',
  'replicator.count.x',
  'replicator.count.y',
  'replicator.spacing.x',
  'replicator.spacing.y',
  'replicator.patternOffset.x',
  'replicator.patternOffset.y',
  'replicator.linear.count',
  'replicator.linear.step.x',
  'replicator.linear.step.y',
  'replicator.radial.count',
  'replicator.radial.center.x',
  'replicator.radial.center.y',
  'replicator.radial.radius',
  'replicator.radial.startAngleDegrees',
  'replicator.radial.endAngleDegrees',
  'replicator.radial.angleSampling',
  'replicator.radial.autoOrient',
  'replicator.offset.mode',
  'replicator.offset.position.x',
  'replicator.offset.position.y',
  'replicator.offset.rotation',
  'replicator.offset.scale.x',
  'replicator.offset.scale.y',
  'replicator.offset.opacity',
  'replicator.userLimit',
]);

const SUPPORTED_APPEARANCE_PROPERTY_PATTERN =
  /^appearance\.[^.]+\.(opacity|visible|blendMode|color\.(r|g|b|a)|stroke\.(width|alignment)|gradient\.(start\.(x|y)|end\.(x|y)|center\.(x|y)|radius|stop\.[^.]+\.(offset|color\.(r|g|b|a))))$/;

export interface MotionPropertyUpdateInput {
  path: string;
  value: PropertyValue;
}

export interface MotionPropertyDescriptorView extends PropertyAuthoringDescriptorView {
  value: PropertyValue;
}

export interface MotionMvpCapabilityView {
  capabilityVersion: number;
  layerKinds: ['shape'];
  primitives: typeof MOTION_DESIGN_MVP_PRIMITIVES;
  appearances: typeof MOTION_DESIGN_MVP_APPEARANCES;
  appearanceLimits: {
    maxItems: number;
    maxGradientStops: number;
    blendModes: typeof MOTION_APPEARANCE_BLEND_MODES;
  };
  replicator: {
    layouts: typeof MOTION_DESIGN_MVP_REPLICATOR_LAYOUTS;
    maxCountPerAxis: number;
    maxInstances: number;
    properties: string[];
  };
  unsupportedUntilLaterPhases: string[];
  properties?: MotionPropertyDescriptorView[];
}

export interface MotionAppearanceView {
  id: string;
  kind: AppearanceItem['kind'];
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: string;
  color?: MotionColor;
  width?: number;
  alignment?: StrokeAppearance['alignment'];
  stops?: GradientStop[];
  start?: MotionVector2;
  end?: MotionVector2;
  center?: MotionVector2;
  radius?: number;
}

export interface MotionDesignClipView {
  clipId: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  sourceType: string | undefined;
  motion: MotionLayerDefinition;
  appearances: MotionAppearanceView[];
  primaryAppearanceIds: {
    fill: string | null;
    stroke: string | null;
  };
  properties: MotionPropertyDescriptorView[];
  effectiveReplicator: {
    enabled: boolean;
    layout: 'grid' | 'linear' | 'radial';
    countX: number;
    countY: number;
    instanceCount: number;
    maxInstances: number;
  };
}

export type RenderedMotionShapeClip = TimelineClip & {
  motion: MotionLayerDefinition & {
    kind: 'shape';
    shape: ShapeDefinition;
  };
};

export function isMotionShapeClip(
  clip: TimelineClip | undefined,
): clip is RenderedMotionShapeClip {
  return clip?.source?.type === 'motion-shape'
    && clip.motion?.kind === 'shape'
    && clip.motion.shape !== undefined;
}

export function getMotionMvpCapabilities(clip?: TimelineClip): MotionMvpCapabilityView {
  return {
    capabilityVersion: MOTION_DESIGN_MVP_CAPABILITY_VERSION,
    layerKinds: ['shape'],
    primitives: MOTION_DESIGN_MVP_PRIMITIVES,
    appearances: MOTION_DESIGN_MVP_APPEARANCES,
    appearanceLimits: {
      maxItems: MOTION_MAX_APPEARANCES,
      maxGradientStops: MOTION_MAX_GRADIENT_STOPS,
      blendModes: MOTION_APPEARANCE_BLEND_MODES,
    },
    replicator: {
      layouts: MOTION_DESIGN_MVP_REPLICATOR_LAYOUTS,
      maxCountPerAxis: MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS,
      maxInstances: MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
      properties: [
        'replicator.enabled',
        'replicator.count.x',
        'replicator.count.y',
        'replicator.spacing.x',
        'replicator.spacing.y',
        'replicator.patternOffset.x',
        'replicator.patternOffset.y',
        'replicator.linear.count',
        'replicator.linear.step.x',
        'replicator.linear.step.y',
        'replicator.radial.count',
        'replicator.radial.center.x',
        'replicator.radial.center.y',
        'replicator.radial.radius',
        'replicator.radial.startAngleDegrees',
        'replicator.radial.endAngleDegrees',
        'replicator.radial.angleSampling',
        'replicator.radial.autoOrient',
        'replicator.offset.mode',
        'replicator.offset.position.x',
        'replicator.offset.position.y',
        'replicator.offset.rotation',
        'replicator.offset.scale.x',
        'replicator.offset.scale.y',
        'replicator.offset.opacity',
        'replicator.userLimit',
      ],
    },
    unsupportedUntilLaterPhases: [
      // Modifier/falloff authoring shipped with MD4 (editMotionModifier, the
      // Modifiers panel section, and runtime plan consumption). Null and
      // Adjustment authoring shipped with MD6/MD7. Motion groups are
      // deliberately outside 1.0 (MOTION_PARENT_GROUPS_SUPPORTED = false).
      'motion group authoring',
    ],
    ...(clip ? { properties: getMotionPropertyViews(clip) } : {}),
  };
}

export function describeMotionDesignClip(clip: TimelineClip): MotionDesignClipView {
  if (!isMotionShapeClip(clip)) {
    throw new Error(`Clip is not a rendered motion shape: ${clip.id}`);
  }

  const appearanceItems = clip.motion.appearance?.items ?? [];
  const fill = appearanceItems.find(
    (item): item is ColorFillAppearance => item.kind === 'color-fill',
  );
  const stroke = appearanceItems.find(
    (item): item is StrokeAppearance => item.kind === 'stroke',
  );
  const replicator = clip.motion.replicator
    ? normalizeMotionReplicatorBundle(
        clip.motion.replicator,
        clip.motion.modifierStack,
      ).replicator
    : null;
  const layout = replicator?.layout;
  const countX = layout?.mode === 'grid'
    ? layout.count.columns
    : layout?.mode === 'linear' || layout?.mode === 'radial'
      ? layout.count
      : 1;
  const countY = layout?.mode === 'grid' ? layout.count.rows : 1;
  const requestedCount = countX * countY;
  const enabled = replicator?.enabled === true;
  const effectiveCount = Math.min(
    requestedCount,
    replicator?.userLimit ?? MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
    MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
  );

  return {
    clipId: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    sourceType: clip.source?.type,
    motion: structuredClone(clip.motion),
    appearances: appearanceItems.map(describeAppearance),
    primaryAppearanceIds: {
      fill: fill?.id ?? null,
      stroke: stroke?.id ?? null,
    },
    properties: getMotionPropertyViews(clip),
    effectiveReplicator: {
      enabled,
      layout: layout?.mode ?? 'grid',
      countX: enabled ? countX : 1,
      countY: enabled ? countY : 1,
      instanceCount: enabled ? effectiveCount : 1,
      maxInstances: MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
    },
  };
}

export function applyValidatedMotionPropertyUpdates(
  clip: TimelineClip,
  updates: readonly MotionPropertyUpdateInput[],
): TimelineClip {
  if (!isMotionShapeClip(clip)) {
    throw new Error(`Clip is not a rendered motion shape: ${clip.id}`);
  }
  if (updates.length === 0) {
    throw new Error('updates must contain at least one motion property');
  }
  if (updates.length > 50) {
    throw new Error('updates may contain at most 50 motion properties');
  }

  const seen = new Set<string>();
  let workingClip: TimelineClip = clip;
  for (const update of updates) {
    if (!update || typeof update.path !== 'string' || !update.path.trim()) {
      throw new Error('Each motion property update requires a non-empty path');
    }
    if (seen.has(update.path)) {
      throw new Error(`Duplicate motion property update: ${update.path}`);
    }
    seen.add(update.path);

    const descriptor = getSupportedMotionDescriptor(workingClip, update.path);
    validatePropertyValue(descriptor, update.value);
    validateShapePropertyCrossConstraints(
      workingClip.motion!,
      update.path,
      update.value,
    );
    workingClip = writePropertyAuthoringValue(
      propertyRegistry,
      workingClip,
      update.path,
      update.value,
    );
  }

  validateEffectiveReplicator(workingClip.motion);
  return workingClip;
}

export function parseMotionColor(
  value: unknown,
  fieldName: string,
): MotionColor {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a hex color string`);
  }
  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(expanded)) {
    throw new Error(`${fieldName} must use #RGB, #RRGGBB, or #RRGGBBAA`);
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
    a: expanded.length === 8
      ? Number.parseInt(expanded.slice(6, 8), 16) / 255
      : 1,
  };
}

export function validateFiniteNumber(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return value;
}

function getMotionPropertyViews(clip: TimelineClip): MotionPropertyDescriptorView[] {
  return propertyRegistry
    .getAllDescriptors(clip)
    .filter((descriptor) => isSupportedMotionPropertyPath(descriptor.path))
    .map((descriptor) => {
      const view = describePropertyAuthoringDescriptor(descriptor, { clip });
      return { ...view, value: view.value };
    });
}

function getSupportedMotionDescriptor(
  clip: TimelineClip,
  path: string,
): PropertyDescriptor {
  if (!isSupportedMotionPropertyPath(path)) {
    throw new Error(`Motion property is not supported by the current renderer: ${path}`);
  }
  const primitive = clip.motion?.shape?.primitive;
  if (path === 'shape.cornerRadius' && primitive !== 'rectangle') {
    throw new Error('shape.cornerRadius requires a rectangle motion shape');
  }
  if (path.startsWith('shape.polygon.') && primitive !== 'polygon') {
    throw new Error(`${path} requires a polygon motion shape`);
  }
  if (path.startsWith('shape.star.') && primitive !== 'star') {
    throw new Error(`${path} requires a star motion shape`);
  }
  if (path.startsWith('shape.path.') && primitive !== 'path') {
    throw new Error(`${path} requires a path motion shape`);
  }
  const descriptor = propertyRegistry.getDescriptor(path, clip);
  if (!descriptor?.write) {
    throw new Error(`Motion property is not writable: ${path}`);
  }
  return descriptor;
}

function isSupportedMotionPropertyPath(path: string): boolean {
  return SUPPORTED_STATIC_PROPERTY_PATHS.has(path)
    || SUPPORTED_APPEARANCE_PROPERTY_PATTERN.test(path);
}

function validatePropertyValue(
  descriptor: PropertyDescriptor,
  value: PropertyValue,
): void {
  validatePropertyAuthoringValue(descriptor, value);
  if (descriptor.valueType === 'number') {
    const numericValue = value as number;
    if (descriptor.path.startsWith('shape.path.trim.')) {
      if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
        throw new Error(`${descriptor.path} must be a finite number between 0 and 1`);
      }
      return;
    }
    if (descriptor.path.startsWith('shape.path.dash.')) {
      // Dash offset follows the same non-negative pixel contract as length and gap.
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        throw new Error(`${descriptor.path} must be a finite number greater than or equal to 0`);
      }
      return;
    }
    if (
      descriptor.path === 'shape.polygon.points'
      || descriptor.path === 'shape.star.points'
    ) {
      if (!Number.isInteger(numericValue)) {
        throw new Error(`${descriptor.path} must be an integer`);
      }
      if (numericValue > 32) {
        throw new Error(`${descriptor.path} must be at most 32`);
      }
      return;
    }
    if (
      descriptor.path === 'replicator.count.x'
      || descriptor.path === 'replicator.count.y'
    ) {
      if (!Number.isInteger(numericValue)) {
        throw new Error(`${descriptor.path} must be an integer`);
      }
      if (numericValue > MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS) {
        throw new Error(
          `${descriptor.path} must be at most ${MOTION_DESIGN_MVP_MAX_COUNT_PER_AXIS}`,
        );
      }
    }
    return;
  }
}

function validateEffectiveReplicator(motion: MotionLayerDefinition | undefined): void {
  const replicator = motion?.replicator;
  if (!replicator?.enabled) return;
  const normalized = normalizeMotionReplicatorBundle(
    replicator,
    motion?.modifierStack,
  ).replicator;
  const instanceCount = normalized.layout.mode === 'grid'
    ? normalized.layout.count.columns * normalized.layout.count.rows
    : normalized.layout.count;
  if (!Number.isSafeInteger(instanceCount) || instanceCount < 1) {
    throw new Error('Replicator requested instance count must be a positive safe integer');
  }
}

function validateShapePropertyCrossConstraints(
  motion: MotionLayerDefinition,
  path: string,
  value: PropertyValue,
): void {
  if (typeof value !== 'number') return;
  if (
    path === 'shape.star.innerRadius'
    && value > (motion.shape?.star?.outerRadius ?? Number.POSITIVE_INFINITY)
  ) {
    throw new Error('shape.star.innerRadius must not exceed shape.star.outerRadius');
  }
  if (
    path === 'shape.star.outerRadius'
    && value < (motion.shape?.star?.innerRadius ?? 0)
  ) {
    throw new Error('shape.star.outerRadius must not be below shape.star.innerRadius');
  }
  if (
    path === 'shape.path.trim.start'
    && value > (motion.shape?.path?.trim?.end ?? 1)
  ) {
    throw new Error('shape.path.trim.start must not exceed shape.path.trim.end');
  }
  if (
    path === 'shape.path.trim.end'
    && value < (motion.shape?.path?.trim?.start ?? 0)
  ) {
    throw new Error('shape.path.trim.end must not be below shape.path.trim.start');
  }
}

function describeAppearance(item: AppearanceItem): MotionAppearanceView {
  if (item.kind === 'color-fill') {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      visible: item.visible,
      opacity: item.opacity,
      blendMode: item.blendMode ?? 'normal',
      color: structuredClone(item.color),
    };
  }
  if (item.kind === 'stroke') {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      visible: item.visible,
      opacity: item.opacity,
      blendMode: item.blendMode ?? 'normal',
      color: structuredClone(item.color),
      width: item.width,
      alignment: item.alignment,
    };
  }
  if (item.kind === 'linear-gradient') {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      visible: item.visible,
      opacity: item.opacity,
      blendMode: item.blendMode ?? 'normal',
      stops: structuredClone(item.stops),
      start: structuredClone(item.start),
      end: structuredClone(item.end),
    };
  }
  if (item.kind === 'radial-gradient') {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      visible: item.visible,
      opacity: item.opacity,
      blendMode: item.blendMode ?? 'normal',
      stops: structuredClone(item.stops),
      center: structuredClone(item.center),
      radius: item.radius,
    };
  }
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    visible: item.visible,
    opacity: item.opacity,
    blendMode: item.blendMode ?? 'normal',
  };
}
