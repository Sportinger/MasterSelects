import type { TimelineClip } from '../../types/timeline';
import type {
  AppearanceItem,
  LinearGradientAppearance,
  MotionLayerDefinition,
  RadialGradientAppearance,
} from '../../types/motionDesign';
import {
  MOTION_APPEARANCE_BLEND_MODES,
  createDefaultMotionLayerDefinition,
} from '../../types/motionDesign';
import type { PropertyDescriptor, PropertyValue } from '../../types/propertyRegistry';

type GradientAppearance = LinearGradientAppearance | RadialGradientAppearance;

function cloneMotion(motion: MotionLayerDefinition | undefined): MotionLayerDefinition {
  return structuredClone(
    motion ?? createDefaultMotionLayerDefinition('shape'),
  ) as MotionLayerDefinition;
}

function getAppearanceItem(
  motion: MotionLayerDefinition | undefined,
  itemId: string,
): AppearanceItem | undefined {
  return motion?.appearance?.items.find((item) => item.id === itemId);
}

function isGradient(item: AppearanceItem | undefined): item is GradientAppearance {
  return item?.kind === 'linear-gradient' || item?.kind === 'radial-gradient';
}

function withUpdatedItem(
  clip: TimelineClip,
  itemId: string,
  updater: (item: AppearanceItem) => AppearanceItem,
): TimelineClip {
  const motion = cloneMotion(clip.motion);
  return {
    ...clip,
    motion: motion.appearance
      ? {
          ...motion,
          appearance: {
            ...motion.appearance,
            items: motion.appearance.items.map((item) => (
              item.id === itemId ? updater(item) : item
            )),
          },
        }
      : motion,
  };
}

function numberDescriptor(params: {
  path: string;
  label: string;
  group: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  read: (item: AppearanceItem) => number | undefined;
  write: (item: AppearanceItem, value: number) => AppearanceItem;
  itemId: string;
}): PropertyDescriptor<number> {
  return {
    path: params.path,
    label: params.label,
    group: params.group,
    valueType: 'number',
    animatable: true,
    defaultValue: params.defaultValue,
    ui: {
      aliases: ['motion', 'appearance', 'gradient'],
      ...(params.min !== undefined ? { min: params.min } : {}),
      ...(params.max !== undefined ? { max: params.max } : {}),
      step: params.step ?? 0.01,
    },
    read: (clip) => {
      const item = getAppearanceItem(clip.motion, params.itemId);
      return item ? params.read(item) : undefined;
    },
    write: (clip, value) => withUpdatedItem(
      clip,
      params.itemId,
      (item) => params.write(item, value as number),
    ),
  };
}

export function createAppearanceDescriptor(
  path: string,
  clip: TimelineClip,
): PropertyDescriptor | undefined {
  const match = /^appearance\.([^.]+)\.(.+)$/.exec(path);
  if (!match) return undefined;

  const [, itemId, field] = match;
  const item = getAppearanceItem(clip.motion, itemId);
  if (!item) return undefined;
  const group = `Motion / Appearance / ${item.name}`;

  if (field === 'opacity') {
    return numberDescriptor({
      path,
      label: `${item.name} Opacity`,
      group,
      defaultValue: 1,
      min: 0,
      max: 1,
      itemId,
      read: (target) => target.opacity,
      write: (target, value) => ({ ...target, opacity: value }),
    });
  }

  if (field === 'visible') {
    return {
      path,
      label: `${item.name} Visible`,
      group,
      valueType: 'boolean',
      animatable: false,
      defaultValue: true,
      ui: { aliases: ['motion', 'appearance', item.kind, item.name] },
      read: (targetClip) => getAppearanceItem(targetClip.motion, itemId)?.visible ?? true,
      write: (targetClip, value: PropertyValue) => withUpdatedItem(
        targetClip,
        itemId,
        (target) => ({ ...target, visible: value as boolean }),
      ),
    };
  }

  if (field === 'blendMode') {
    return {
      path,
      label: `${item.name} Blend Mode`,
      group,
      valueType: 'enum',
      animatable: false,
      defaultValue: 'normal',
      ui: {
        aliases: ['motion', 'appearance', 'blend'],
        options: MOTION_APPEARANCE_BLEND_MODES.map((value) => ({
          value,
          label: value.replace('-', ' '),
        })),
      },
      read: (targetClip) => (
        getAppearanceItem(targetClip.motion, itemId)?.blendMode ?? 'normal'
      ),
      write: (targetClip, value: PropertyValue) => withUpdatedItem(
        targetClip,
        itemId,
        (target) => ({ ...target, blendMode: value as AppearanceItem['blendMode'] }),
      ),
    };
  }

  const colorMatch = /^color\.(r|g|b|a)$/.exec(field);
  if (colorMatch && (item.kind === 'color-fill' || item.kind === 'stroke')) {
    const channel = colorMatch[1] as 'r' | 'g' | 'b' | 'a';
    return numberDescriptor({
      path,
      label: `${item.name} ${channel.toUpperCase()}`,
      group,
      defaultValue: channel === 'a' ? 1 : 0,
      min: 0,
      max: 1,
      itemId,
      read: (target) => (
        target.kind === 'color-fill' || target.kind === 'stroke'
          ? target.color[channel]
          : undefined
      ),
      write: (target, value) => (
        target.kind === 'color-fill' || target.kind === 'stroke'
          ? { ...target, color: { ...target.color, [channel]: value } }
          : target
      ),
    });
  }

  if (field === 'stroke.width' && item.kind === 'stroke') {
    return numberDescriptor({
      path,
      label: `${item.name} Width`,
      group,
      defaultValue: item.width,
      min: 0,
      step: 0.5,
      itemId,
      read: (target) => target.kind === 'stroke' ? target.width : undefined,
      write: (target, value) => target.kind === 'stroke'
        ? { ...target, width: value }
        : target,
    });
  }

  if (field === 'stroke.alignment' && item.kind === 'stroke') {
    return {
      path,
      label: `${item.name} Alignment`,
      group,
      valueType: 'enum',
      animatable: false,
      defaultValue: item.alignment,
      ui: {
        aliases: ['motion', 'appearance', 'stroke'],
        options: [
          { value: 'center', label: 'Center' },
          { value: 'inside', label: 'Inside' },
          { value: 'outside', label: 'Outside' },
        ],
      },
      read: (targetClip) => {
        const target = getAppearanceItem(targetClip.motion, itemId);
        return target?.kind === 'stroke' ? target.alignment : undefined;
      },
      write: (targetClip, value) => withUpdatedItem(
        targetClip,
        itemId,
        (target) => target.kind === 'stroke'
          ? {
              ...target,
              alignment: value as 'center' | 'inside' | 'outside',
            }
          : target,
      ),
    };
  }

  const geometryMatch =
    /^gradient\.(start|end|center)\.(x|y)$/.exec(field);
  if (geometryMatch && isGradient(item)) {
    const vector = geometryMatch[1] as 'start' | 'end' | 'center';
    const axis = geometryMatch[2] as 'x' | 'y';
    const compatible =
      (item.kind === 'linear-gradient' && (vector === 'start' || vector === 'end'))
      || (item.kind === 'radial-gradient' && vector === 'center');
    if (!compatible) return undefined;
    return numberDescriptor({
      path,
      label: `${item.name} ${vector} ${axis.toUpperCase()}`,
      group,
      defaultValue: vector === 'start' ? (axis === 'x' ? 0 : 0.5) : 0.5,
      itemId,
      read: (target) => {
        if (target.kind === 'linear-gradient' && vector !== 'center') {
          return target[vector][axis];
        }
        if (target.kind === 'radial-gradient' && vector === 'center') {
          return target.center[axis];
        }
        return undefined;
      },
      write: (target, value) => {
        if (target.kind === 'linear-gradient' && vector !== 'center') {
          return {
            ...target,
            [vector]: { ...target[vector], [axis]: value },
          };
        }
        if (target.kind === 'radial-gradient' && vector === 'center') {
          return { ...target, center: { ...target.center, [axis]: value } };
        }
        return target;
      },
    });
  }

  if (field === 'gradient.radius' && item.kind === 'radial-gradient') {
    return numberDescriptor({
      path,
      label: `${item.name} Radius`,
      group,
      defaultValue: 0.5,
      min: 0.001,
      itemId,
      read: (target) => target.kind === 'radial-gradient' ? target.radius : undefined,
      write: (target, value) => target.kind === 'radial-gradient'
        ? { ...target, radius: value }
        : target,
    });
  }

  const stopMatch =
    /^gradient\.stop\.([^.]+)\.(offset|color\.(r|g|b|a))$/.exec(field);
  if (stopMatch && isGradient(item)) {
    const stopId = stopMatch[1];
    const stopField = stopMatch[2];
    const stop = item.stops.find((candidate) => candidate.id === stopId);
    if (!stop) return undefined;
    const channelMatch = /^color\.(r|g|b|a)$/.exec(stopField);
    return numberDescriptor({
      path,
      label: channelMatch
        ? `${item.name} Stop ${channelMatch[1].toUpperCase()}`
        : `${item.name} Stop Offset`,
      group,
      defaultValue: channelMatch
        ? channelMatch[1] === 'a' ? 1 : 0
        : stop.offset,
      min: 0,
      max: 1,
      itemId,
      read: (target) => {
        if (!isGradient(target)) return undefined;
        const targetStop = target.stops.find((candidate) => candidate.id === stopId);
        if (!targetStop) return undefined;
        return channelMatch
          ? targetStop.color[channelMatch[1] as 'r' | 'g' | 'b' | 'a']
          : targetStop.offset;
      },
      write: (target, value) => {
        if (!isGradient(target)) return target;
        return {
          ...target,
          stops: target.stops.map((candidate) => {
            if (candidate.id !== stopId) return candidate;
            if (!channelMatch) return { ...candidate, offset: value };
            const channel = channelMatch[1] as 'r' | 'g' | 'b' | 'a';
            return {
              ...candidate,
              color: { ...candidate.color, [channel]: value },
            };
          }),
        };
      },
    });
  }

  return undefined;
}
