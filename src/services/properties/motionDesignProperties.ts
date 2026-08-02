
import type { TimelineClip } from '../../types/timeline';
import {
  isMotionProperty,
  type MotionShapeProperty,
} from '../../types/motionDesign';
import type { PropertyDescriptor } from '../../types/propertyRegistry';
import { createAppearanceDescriptor } from './motionAppearanceProperties';
import { getReplicatorDescriptorForPath } from './motionReplicatorProperties';
import { createMotionShapeDescriptor } from './motionShapeProperties';

function isMotionShapePropertyClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'motion-shape'
    && clip.motion?.kind === 'shape'
    && clip.motion.shape !== undefined;
}

export function getMotionDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isMotionProperty(path)) return undefined;
  if (clip && !isMotionShapePropertyClip(clip)) return undefined;

  const shapeLabel = MOTION_SHAPE_PROPERTY_LABELS[path as MotionShapeProperty];
  if (shapeLabel) {
    return createMotionShapeDescriptor(path as MotionShapeProperty, shapeLabel);
  }
  if (path.startsWith('appearance.') && clip) return createAppearanceDescriptor(path, clip);
  return getReplicatorDescriptorForPath(path, clip);
}

const MOTION_SHAPE_PROPERTY_LABELS: Record<MotionShapeProperty, string> = {
  'shape.size.w': 'Width',
  'shape.size.h': 'Height',
  'shape.cornerRadius': 'Corner Radius',
  'shape.polygon.points': 'Polygon Points',
  'shape.polygon.radius': 'Polygon Radius',
  'shape.polygon.cornerRadius': 'Polygon Corner Radius',
  'shape.star.points': 'Star Points',
  'shape.star.outerRadius': 'Star Outer Radius',
  'shape.star.innerRadius': 'Star Inner Radius',
  'shape.star.cornerRadius': 'Star Corner Radius',
  'shape.path.trim.start': 'Trim Start',
  'shape.path.trim.end': 'Trim End',
  'shape.path.trim.offset': 'Trim Offset',
  'shape.path.dash.length': 'Dash Length',
  'shape.path.dash.gap': 'Dash Gap',
  'shape.path.dash.offset': 'Dash Offset',
};

export function getMotionDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  if (!isMotionShapePropertyClip(clip)) return [];
  const shapePaths: MotionShapeProperty[] = [
    'shape.size.w',
    'shape.size.h',
    ...(clip.motion?.shape?.primitive === 'rectangle'
      ? ['shape.cornerRadius'] as MotionShapeProperty[]
      : []),
    ...(clip.motion?.shape?.primitive === 'polygon'
      ? [
          'shape.polygon.points',
          'shape.polygon.radius',
          'shape.polygon.cornerRadius',
        ] as MotionShapeProperty[]
      : []),
    ...(clip.motion?.shape?.primitive === 'star'
      ? [
          'shape.star.points',
          'shape.star.outerRadius',
          'shape.star.innerRadius',
          'shape.star.cornerRadius',
        ] as MotionShapeProperty[]
      : []),
    ...(clip.motion?.shape?.primitive === 'path'
      ? [
          'shape.path.trim.start',
          'shape.path.trim.end',
          'shape.path.trim.offset',
          'shape.path.dash.length',
          'shape.path.dash.gap',
          'shape.path.dash.offset',
        ] as MotionShapeProperty[]
      : []),
  ];
  const descriptors: PropertyDescriptor[] = shapePaths.map((path) => (
    createMotionShapeDescriptor(path, MOTION_SHAPE_PROPERTY_LABELS[path])
  ));

  clip.motion?.appearance?.items.forEach((item) => {
    [
      `appearance.${item.id}.opacity`,
      `appearance.${item.id}.visible`,
      `appearance.${item.id}.blendMode`,
      ...(item.kind === 'color-fill' || item.kind === 'stroke'
        ? [
            `appearance.${item.id}.color.r`,
            `appearance.${item.id}.color.g`,
            `appearance.${item.id}.color.b`,
            `appearance.${item.id}.color.a`,
          ]
        : []),
      ...(item.kind === 'stroke'
        ? [
            `appearance.${item.id}.stroke.width`,
            `appearance.${item.id}.stroke.alignment`,
          ]
        : []),
      ...(item.kind === 'linear-gradient'
        ? [
            `appearance.${item.id}.gradient.start.x`,
            `appearance.${item.id}.gradient.start.y`,
            `appearance.${item.id}.gradient.end.x`,
            `appearance.${item.id}.gradient.end.y`,
          ]
        : []),
      ...(item.kind === 'radial-gradient'
        ? [
            `appearance.${item.id}.gradient.center.x`,
            `appearance.${item.id}.gradient.center.y`,
            `appearance.${item.id}.gradient.radius`,
          ]
        : []),
      ...(item.kind === 'linear-gradient' || item.kind === 'radial-gradient'
        ? item.stops.flatMap((stop) => [
            `appearance.${item.id}.gradient.stop.${stop.id}.offset`,
            `appearance.${item.id}.gradient.stop.${stop.id}.color.r`,
            `appearance.${item.id}.gradient.stop.${stop.id}.color.g`,
            `appearance.${item.id}.gradient.stop.${stop.id}.color.b`,
            `appearance.${item.id}.gradient.stop.${stop.id}.color.a`,
          ])
        : []),
    ].forEach((path) => {
      const descriptor = createAppearanceDescriptor(path, clip);
      if (descriptor) descriptors.push(descriptor);
    });
  });

  [
    'replicator.enabled',
    'replicator.layout.mode',
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
  ].forEach((path) => {
    const descriptor = getReplicatorDescriptorForPath(path, clip);
    if (descriptor) descriptors.push(descriptor);
  });

  return descriptors;
}
