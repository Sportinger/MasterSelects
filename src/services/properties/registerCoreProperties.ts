import type { Effect as TimelineEffect, TimelineClip, ClipMask, MaskPathKeyframeValue } from '../../types';
import {
  DEFAULT_PRIMARY_COLOR_PARAMS,
  RUNTIME_COLOR_PARAM_DEFS,
  ensureColorCorrectionState,
  parseColorProperty,
  parseMaskProperty,
  setColorNodeParamValue,
} from '../../types';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  createVectorAnimationInputProperty,
  createVectorAnimationStateProperty,
  mergeVectorAnimationSettings,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../types/vectorAnimation';
import type {
  AppearanceItem,
  MotionLayerDefinition,
  ReplicatorDefinition,
  ReplicatorLayout,
} from '../../types/motionDesign';
import {
  DEFAULT_MOTION_SHAPE_SIZE,
  createDefaultMotionLayerDefinition,
  createDefaultReplicatorDefinition,
  isMotionProperty,
} from '../../types/motionDesign';
import type { EffectDefinition, EffectParam } from '../../effects/types';
import { getAllEffects, getEffect } from '../../effects';
import type { PropertyDescriptor, PropertyValueType } from '../../types/propertyRegistry';
import type { PropertyRegistry } from './PropertyRegistry';
import { propertyRegistry } from './PropertyRegistry';

const colorParamDefsByKey = new Map(RUNTIME_COLOR_PARAM_DEFS.map((def) => [def.key, def]));

type TransformPatch = Omit<Partial<TimelineClip['transform']>, 'position' | 'scale' | 'rotation'> & {
  position?: Partial<TimelineClip['transform']['position']>;
  scale?: Partial<TimelineClip['transform']['scale']>;
  rotation?: Partial<TimelineClip['transform']['rotation']>;
};

function updateTransform(
  clip: TimelineClip,
  patch: TransformPatch,
): TimelineClip {
  return {
    ...clip,
    transform: {
      ...clip.transform,
      ...patch,
      position: patch.position ? { ...clip.transform.position, ...patch.position } : clip.transform.position,
      scale: patch.scale ? { ...clip.transform.scale, ...patch.scale } : clip.transform.scale,
      rotation: patch.rotation ? { ...clip.transform.rotation, ...patch.rotation } : clip.transform.rotation,
    },
  };
}

function createTransformDescriptor(
  path: string,
  label: string,
  defaultValue: number,
  read: (clip: TimelineClip) => number,
  write: (clip: TimelineClip, value: number) => TimelineClip,
  ui: NonNullable<PropertyDescriptor['ui']> = {},
): PropertyDescriptor<number> {
  return {
    path,
    label,
    group: 'Transform',
    valueType: 'number',
    animatable: true,
    defaultValue,
    ui,
    read,
    write: (clip, value) => write(clip, value as number),
  };
}

function mapEffectParamType(param: EffectParam): PropertyValueType {
  if (param.type === 'boolean') return 'boolean';
  if (param.type === 'select') return 'enum';
  if (param.type === 'color') return 'color';
  if (param.type === 'point') return 'vector2';
  return 'number';
}

function isEffectParamAnimatable(param: EffectParam): boolean {
  if (param.animatable !== undefined) return param.animatable;
  return param.type === 'number' || param.type === 'color' || param.type === 'point';
}

function createEffectDescriptor(
  effectDefinition: EffectDefinition,
  effect: TimelineEffect | undefined,
  paramName: string,
  param: EffectParam,
): PropertyDescriptor {
  const effectId = effect?.id ?? effectDefinition.id;
  const effectName = effect?.name || effectDefinition.name;
  return {
    path: `effect.${effectId}.${paramName}`,
    label: param.label,
    group: `Effects / ${effectName}`,
    valueType: mapEffectParamType(param),
    animatable: isEffectParamAnimatable(param),
    defaultValue: param.default,
    ui: {
      min: param.min,
      max: param.max,
      step: param.step,
      aliases: [effectDefinition.name, effectDefinition.id, paramName],
      options: param.options,
    },
    read: (clip) => {
      const current = clip.effects.find((candidate) => candidate.id === effectId);
      return current?.params[paramName] ?? param.default;
    },
    write: (clip, value) => ({
      ...clip,
      effects: clip.effects.map((candidate) => (
        candidate.id === effectId
          ? { ...candidate, params: { ...candidate.params, [paramName]: value as number | boolean | string } }
          : candidate
      )),
    }),
  };
}

function getEffectDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  const parts = path.split('.');
  if (parts.length !== 3 || parts[0] !== 'effect' || !clip) return undefined;

  const [, effectId, paramName] = parts;
  const effect = clip.effects.find((candidate) => candidate.id === effectId);
  if (!effect) return undefined;

  const effectDefinition = getEffect(effect.type);
  const param = effectDefinition?.params[paramName];
  return effectDefinition && param
    ? createEffectDescriptor(effectDefinition, effect, paramName, param)
    : undefined;
}

function getEffectDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return clip.effects.flatMap((effect) => {
    const effectDefinition = getEffect(effect.type);
    if (!effectDefinition) return [];

    return Object.entries(effectDefinition.params).map(([paramName, param]) =>
      createEffectDescriptor(effectDefinition, effect, paramName, param)
    );
  });
}

function getColorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor<number> | undefined {
  const parsed = parseColorProperty(path);
  if (!parsed || !clip?.colorCorrection) return undefined;

  const def = colorParamDefsByKey.get(parsed.paramName as keyof typeof DEFAULT_PRIMARY_COLOR_PARAMS);
  if (!def) return undefined;

  const state = ensureColorCorrectionState(clip.colorCorrection);
  const version = state.versions.find((candidate) => candidate.id === parsed.versionId);
  const node = version?.nodes.find((candidate) => candidate.id === parsed.nodeId);
  if (!node || typeof node.params[parsed.paramName] !== 'number') return undefined;

  return {
    path,
    label: def.label,
    group: `Color / ${node.name}`,
    valueType: 'number',
    animatable: true,
    defaultValue: def.defaultValue,
    ui: {
      min: def.min,
      max: def.max,
      step: def.step,
      aliases: [def.section, node.type, parsed.paramName],
    },
    read: (targetClip) => {
      const currentState = ensureColorCorrectionState(targetClip.colorCorrection);
      const currentVersion = currentState.versions.find((candidate) => candidate.id === parsed.versionId);
      const currentNode = currentVersion?.nodes.find((candidate) => candidate.id === parsed.nodeId);
      const value = currentNode?.params[parsed.paramName];
      return typeof value === 'number' ? value : def.defaultValue;
    },
    write: (targetClip, value) => ({
      ...targetClip,
      colorCorrection: setColorNodeParamValue(
        ensureColorCorrectionState(targetClip.colorCorrection),
        parsed.versionId,
        parsed.nodeId,
        parsed.paramName,
        value as number,
      ),
    }),
  };
}

function getColorDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  if (!clip.colorCorrection) return [];

  const state = ensureColorCorrectionState(clip.colorCorrection);
  return state.versions.flatMap((version) =>
    version.nodes.flatMap((node) =>
      Object.keys(node.params).flatMap((paramName) => {
        const descriptor = getColorDescriptorForPath(`color.${version.id}.${node.id}.${paramName}`, clip);
        return descriptor ? [descriptor] : [];
      })
    )
  );
}

function getMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map((vertex) => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

function getMaskDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  const parsed = parseMaskProperty(path);
  if (!parsed || !clip?.masks) return undefined;

  const mask = clip.masks.find((candidate) => candidate.id === parsed.maskId);
  if (!mask) return undefined;

  if (parsed.property === 'path') {
    return {
      path,
      label: `${mask.name} Path`,
      group: 'Masks',
      valueType: 'path',
      animatable: true,
      defaultValue: getMaskPathValue(mask),
      ui: { aliases: ['mask path', mask.name] },
      read: (targetClip) => {
        const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
        return targetMask ? getMaskPathValue(targetMask) : undefined;
      },
      write: (targetClip, value) => {
        const pathValue = value as MaskPathKeyframeValue;
        return {
          ...targetClip,
          masks: targetClip.masks?.map((candidate) => (
            candidate.id === parsed.maskId
              ? {
                  ...candidate,
                  closed: pathValue.closed,
                  vertices: pathValue.vertices.map((vertex) => ({
                    ...vertex,
                    handleIn: { ...vertex.handleIn },
                    handleOut: { ...vertex.handleOut },
                  })),
                }
              : candidate
          )),
        };
      },
    };
  }

  const numericProperty = parsed.property as 'position.x' | 'position.y' | 'feather' | 'featherQuality';
  const labelByProperty: Record<typeof numericProperty, string> = {
    'position.x': `${mask.name} X`,
    'position.y': `${mask.name} Y`,
    feather: `${mask.name} Feather`,
    featherQuality: `${mask.name} Feather Quality`,
  };

  return {
    path,
    label: labelByProperty[numericProperty],
    group: 'Masks',
    valueType: 'number',
    animatable: true,
      defaultValue: numericProperty.startsWith('position.') ? 0 : numericProperty === 'featherQuality' ? 1 : 0,
    ui: {
      min: numericProperty === 'feather' ? 0 : numericProperty === 'featherQuality' ? 1 : undefined,
      max: numericProperty === 'featherQuality' ? 100 : undefined,
      step: numericProperty === 'featherQuality' ? 1 : 0.1,
      aliases: [mask.name, numericProperty],
    },
    read: (targetClip) => {
      const targetMask = targetClip.masks?.find((candidate) => candidate.id === parsed.maskId);
      if (!targetMask) return undefined;
      if (numericProperty === 'position.x') return targetMask.position.x;
      if (numericProperty === 'position.y') return targetMask.position.y;
      return targetMask[numericProperty];
    },
    write: (targetClip, value) => ({
      ...targetClip,
      masks: targetClip.masks?.map((candidate) => {
        if (candidate.id !== parsed.maskId) return candidate;
        if (numericProperty === 'position.x') {
          return { ...candidate, position: { ...candidate.position, x: value as number } };
        }
        if (numericProperty === 'position.y') {
          return { ...candidate, position: { ...candidate.position, y: value as number } };
        }
        return { ...candidate, [numericProperty]: value as number };
      }),
    }),
  };
}

function getMaskDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  return (clip.masks ?? []).flatMap((mask) => [
    getMaskDescriptorForPath(`mask.${mask.id}.path`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.position.x`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.position.y`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.feather`, clip),
    getMaskDescriptorForPath(`mask.${mask.id}.featherQuality`, clip),
  ].filter((descriptor): descriptor is PropertyDescriptor => Boolean(descriptor)));
}

function getVectorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (clip?.source?.type !== 'lottie') return undefined;

  const stateProperty = parseVectorAnimationStateProperty(path);
  if (stateProperty) {
    const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
    return {
      path,
      label: `${stateProperty.stateMachineName} State`,
      group: 'Vector Animation',
      valueType: 'enum',
      animatable: true,
      defaultValue: settings.stateMachineState ?? '',
      ui: { aliases: ['lottie state', stateProperty.stateMachineName] },
      read: (targetClip) => mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings).stateMachineState ?? '',
      write: (targetClip, value) => ({
        ...targetClip,
        source: targetClip.source
          ? {
              ...targetClip.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...targetClip.source.vectorAnimationSettings,
                stateMachineName: stateProperty.stateMachineName,
                stateMachineState: String(value),
                stateMachineStateCues: undefined,
              },
            }
          : targetClip.source,
      }),
    };
  }

  const inputProperty = parseVectorAnimationInputProperty(path);
  if (!inputProperty) return undefined;

  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  const currentValue = settings.stateMachineInputValues?.[inputProperty.inputName] ?? 0;
  return {
    path,
    label: inputProperty.inputName,
    group: 'Vector Animation',
    valueType: typeof currentValue === 'boolean' ? 'boolean' : typeof currentValue === 'string' ? 'enum' : 'number',
    animatable: typeof currentValue !== 'string',
    defaultValue: currentValue,
    ui: { aliases: ['lottie input', inputProperty.stateMachineName] },
    read: (targetClip) => {
      const targetSettings = mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings);
      return targetSettings.stateMachineInputValues?.[inputProperty.inputName] ?? currentValue;
    },
    write: (targetClip, value) => {
      const targetSettings = mergeVectorAnimationSettings(targetClip.source?.vectorAnimationSettings);
      return {
        ...targetClip,
        source: targetClip.source
          ? {
              ...targetClip.source,
              vectorAnimationSettings: {
                ...targetSettings,
                stateMachineName: inputProperty.stateMachineName,
                stateMachineInputValues: {
                  ...(targetSettings.stateMachineInputValues ?? {}),
                  [inputProperty.inputName]: value as boolean | number | string,
                },
              },
            }
          : targetClip.source,
      };
    },
  };
}

function getVectorDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  if (clip.source?.type !== 'lottie') return [];

  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  const descriptors: PropertyDescriptor[] = [];
  if (settings.stateMachineName) {
    const stateDescriptor = getVectorDescriptorForPath(
      createVectorAnimationStateProperty(settings.stateMachineName),
      clip,
    );
    if (stateDescriptor) descriptors.push(stateDescriptor);

    Object.keys(settings.stateMachineInputValues ?? {}).forEach((inputName) => {
      const descriptor = getVectorDescriptorForPath(
        createVectorAnimationInputProperty(settings.stateMachineName!, inputName),
        clip,
      );
      if (descriptor) descriptors.push(descriptor);
    });
  }
  return descriptors;
}

function cloneMotion(motion: MotionLayerDefinition | undefined): MotionLayerDefinition {
  return structuredClone(motion ?? createDefaultMotionLayerDefinition('shape')) as MotionLayerDefinition;
}

function withMotion(clip: TimelineClip, updater: (motion: MotionLayerDefinition) => MotionLayerDefinition): TimelineClip {
  return {
    ...clip,
    motion: updater(cloneMotion(clip.motion)),
  };
}

function updateShape(
  clip: TimelineClip,
  updater: (motion: MotionLayerDefinition) => MotionLayerDefinition,
): TimelineClip {
  return withMotion(clip, updater);
}

function ensureReplicator(motion: MotionLayerDefinition): ReplicatorDefinition {
  return motion.replicator ? structuredClone(motion.replicator) : createDefaultReplicatorDefinition();
}

function createGridLayout(layout: ReplicatorLayout): Extract<ReplicatorLayout, { mode: 'grid' }> {
  if (layout.mode === 'grid') return structuredClone(layout);
  return createDefaultReplicatorDefinition().layout as Extract<ReplicatorLayout, { mode: 'grid' }>;
}

function createMotionShapeDescriptor(
  path: 'shape.size.w' | 'shape.size.h' | 'shape.cornerRadius',
  label: string,
): PropertyDescriptor<number> {
  return {
    path,
    label,
    group: 'Motion / Shape',
    valueType: 'number',
    animatable: true,
    defaultValue: path === 'shape.size.w'
      ? DEFAULT_MOTION_SHAPE_SIZE.w
      : path === 'shape.size.h'
        ? DEFAULT_MOTION_SHAPE_SIZE.h
        : 0,
    ui: {
      min: 0,
      step: 1,
      aliases: ['motion', 'shape'],
    },
    read: (clip) => {
      if (path === 'shape.size.w') return clip.motion?.shape?.size.w ?? DEFAULT_MOTION_SHAPE_SIZE.w;
      if (path === 'shape.size.h') return clip.motion?.shape?.size.h ?? DEFAULT_MOTION_SHAPE_SIZE.h;
      return clip.motion?.shape?.cornerRadius ?? 0;
    },
    write: (clip, value) => updateShape(clip, (motion) => ({
      ...motion,
      shape: {
        ...(motion.shape ?? createDefaultMotionLayerDefinition('shape').shape!),
        size: {
          ...(motion.shape?.size ?? DEFAULT_MOTION_SHAPE_SIZE),
          ...(path === 'shape.size.w' ? { w: value as number } : {}),
          ...(path === 'shape.size.h' ? { h: value as number } : {}),
        },
        ...(path === 'shape.cornerRadius' ? { cornerRadius: value as number } : {}),
      },
    })),
  };
}

function getAppearanceItem(motion: MotionLayerDefinition | undefined, itemId: string): AppearanceItem | undefined {
  return motion?.appearance?.items.find((item) => item.id === itemId);
}

function createAppearanceDescriptor(path: string, clip: TimelineClip): PropertyDescriptor | undefined {
  const match = /^appearance\.([^.]+)\.(.+)$/.exec(path);
  if (!match) return undefined;

  const [, itemId, field] = match;
  const item = getAppearanceItem(clip.motion, itemId);
  if (!item) return undefined;

  const common = {
    path,
    group: `Motion / Appearance / ${item.name}`,
    ui: { aliases: ['motion', 'appearance', item.kind, item.name] },
  };

  if (field === 'opacity') {
    return {
      ...common,
      label: `${item.name} Opacity`,
      valueType: 'number',
      animatable: true,
      defaultValue: 1,
      ui: { ...common.ui, min: 0, max: 1, step: 0.01 },
      read: (targetClip) => getAppearanceItem(targetClip.motion, itemId)?.opacity ?? 1,
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId ? { ...candidate, opacity: value as number } : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  const colorMatch = /^color\.(r|g|b|a)$/.exec(field);
  if (colorMatch && (item.kind === 'color-fill' || item.kind === 'stroke')) {
    const channel = colorMatch[1] as 'r' | 'g' | 'b' | 'a';
    return {
      ...common,
      label: `${item.name} ${channel.toUpperCase()}`,
      valueType: 'number',
      animatable: true,
      defaultValue: channel === 'a' ? 1 : 0,
      ui: { ...common.ui, min: 0, max: 1, step: 0.01 },
      read: (targetClip) => {
        const targetItem = getAppearanceItem(targetClip.motion, itemId);
        return targetItem && (targetItem.kind === 'color-fill' || targetItem.kind === 'stroke')
          ? targetItem.color[channel]
          : undefined;
      },
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId && (candidate.kind === 'color-fill' || candidate.kind === 'stroke')
                  ? { ...candidate, color: { ...candidate.color, [channel]: value as number } }
                  : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  if (field === 'stroke.width' && item.kind === 'stroke') {
    return {
      ...common,
      label: `${item.name} Width`,
      valueType: 'number',
      animatable: true,
      defaultValue: item.width,
      ui: { ...common.ui, min: 0, step: 0.5 },
      read: (targetClip) => {
        const targetItem = getAppearanceItem(targetClip.motion, itemId);
        return targetItem?.kind === 'stroke' ? targetItem.width : undefined;
      },
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId && candidate.kind === 'stroke'
                  ? { ...candidate, width: value as number }
                  : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  if (field === 'stroke.alignment' && item.kind === 'stroke') {
    return {
      ...common,
      label: `${item.name} Alignment`,
      valueType: 'enum',
      animatable: false,
      defaultValue: item.alignment,
      ui: {
        ...common.ui,
        options: [
          { value: 'center', label: 'Center' },
          { value: 'inside', label: 'Inside' },
          { value: 'outside', label: 'Outside' },
        ],
      },
      read: (targetClip) => {
        const targetItem = getAppearanceItem(targetClip.motion, itemId);
        return targetItem?.kind === 'stroke' ? targetItem.alignment : undefined;
      },
      write: (targetClip, value) => withMotion(targetClip, (motion) => ({
        ...motion,
        appearance: motion.appearance
          ? {
              ...motion.appearance,
              items: motion.appearance.items.map((candidate) => (
                candidate.id === itemId && candidate.kind === 'stroke'
                  ? { ...candidate, alignment: value as 'center' | 'inside' | 'outside' }
                  : candidate
              )),
            }
          : motion.appearance,
      })),
    };
  }

  return undefined;
}

function getReplicatorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isMotionProperty(path) || !path.startsWith('replicator.')) return undefined;

  const defaultReplicator = createDefaultReplicatorDefinition();
  const current = clip?.motion?.replicator ?? defaultReplicator;
  const grid = createGridLayout(current.layout);

  const specs: Record<string, {
    label: string;
    valueType: PropertyValueType;
    defaultValue: number | boolean | string;
    animatable: boolean;
    read: (replicator: ReplicatorDefinition) => number | boolean | string;
    write: (replicator: ReplicatorDefinition, value: unknown) => ReplicatorDefinition;
    ui?: PropertyDescriptor['ui'];
  }> = {
    'replicator.enabled': {
      label: 'Enabled',
      valueType: 'boolean',
      defaultValue: false,
      animatable: false,
      read: (replicator) => replicator.enabled,
      write: (replicator, value) => ({ ...replicator, enabled: Boolean(value) }),
    },
    'replicator.layout.mode': {
      label: 'Layout',
      valueType: 'enum',
      defaultValue: 'grid',
      animatable: false,
      read: (replicator) => replicator.layout.mode,
      write: (replicator, value) => ({
        ...replicator,
        layout: String(value) === 'grid' ? createGridLayout(replicator.layout) : replicator.layout,
      }),
      ui: { options: [{ value: 'grid', label: 'Grid' }] },
    },
    'replicator.count.x': {
      label: 'Count X',
      valueType: 'number',
      defaultValue: grid.count.x,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).count.x,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, count: { ...layout.count, x: Math.max(1, Math.round(value as number)) } } };
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.count.y': {
      label: 'Count Y',
      valueType: 'number',
      defaultValue: grid.count.y,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).count.y,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, count: { ...layout.count, y: Math.max(1, Math.round(value as number)) } } };
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.spacing.x': {
      label: 'Spacing X',
      valueType: 'number',
      defaultValue: grid.spacing.x,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).spacing.x,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, spacing: { ...layout.spacing, x: value as number } } };
      },
      ui: { step: 1 },
    },
    'replicator.spacing.y': {
      label: 'Spacing Y',
      valueType: 'number',
      defaultValue: grid.spacing.y,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).spacing.y,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return { ...replicator, layout: { ...layout, spacing: { ...layout.spacing, y: value as number } } };
      },
      ui: { step: 1 },
    },
    'replicator.offset.position.x': {
      label: 'Offset X',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.position.x,
      animatable: true,
      read: (replicator) => replicator.offset.position.x,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, position: { ...replicator.offset.position, x: value as number } } }),
      ui: { step: 1 },
    },
    'replicator.offset.position.y': {
      label: 'Offset Y',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.position.y,
      animatable: true,
      read: (replicator) => replicator.offset.position.y,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, position: { ...replicator.offset.position, y: value as number } } }),
      ui: { step: 1 },
    },
    'replicator.offset.rotation': {
      label: 'Offset Rotation',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.rotation,
      animatable: true,
      read: (replicator) => replicator.offset.rotation,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, rotation: value as number } }),
      ui: { unit: 'deg', step: 0.1 },
    },
    'replicator.offset.scale.x': {
      label: 'Offset Scale X',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.scale.x,
      animatable: true,
      read: (replicator) => replicator.offset.scale.x,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, scale: { ...replicator.offset.scale, x: value as number } } }),
      ui: { step: 0.01 },
    },
    'replicator.offset.scale.y': {
      label: 'Offset Scale Y',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.scale.y,
      animatable: true,
      read: (replicator) => replicator.offset.scale.y,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, scale: { ...replicator.offset.scale, y: value as number } } }),
      ui: { step: 0.01 },
    },
    'replicator.offset.opacity': {
      label: 'Offset Opacity',
      valueType: 'number',
      defaultValue: defaultReplicator.offset.opacity,
      animatable: true,
      read: (replicator) => replicator.offset.opacity,
      write: (replicator, value) => ({ ...replicator, offset: { ...replicator.offset, opacity: value as number } }),
      ui: { min: 0, max: 1, step: 0.01 },
    },
  };

  const spec = specs[path];
  if (!spec) return undefined;

  return {
    path,
    label: spec.label,
    group: 'Motion / Replicator',
    valueType: spec.valueType,
    animatable: spec.animatable,
    defaultValue: spec.defaultValue,
    ui: { aliases: ['motion', 'replicator'], ...spec.ui },
    read: (targetClip) => spec.read(targetClip.motion?.replicator ?? defaultReplicator),
    write: (targetClip, value) => withMotion(targetClip, (motion) => {
      const replicator = ensureReplicator(motion);
      return {
        ...motion,
        replicator: spec.write(replicator, value),
      };
    }),
  };
}

function getMotionDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isMotionProperty(path)) return undefined;

  if (path === 'shape.size.w') return createMotionShapeDescriptor(path, 'Width');
  if (path === 'shape.size.h') return createMotionShapeDescriptor(path, 'Height');
  if (path === 'shape.cornerRadius') return createMotionShapeDescriptor(path, 'Corner Radius');
  if (path.startsWith('appearance.') && clip) return createAppearanceDescriptor(path, clip);
  return getReplicatorDescriptorForPath(path, clip);
}

function getMotionDescriptorsForClip(clip: TimelineClip): PropertyDescriptor[] {
  const descriptors: PropertyDescriptor[] = [
    createMotionShapeDescriptor('shape.size.w', 'Width'),
    createMotionShapeDescriptor('shape.size.h', 'Height'),
    createMotionShapeDescriptor('shape.cornerRadius', 'Corner Radius'),
  ];

  clip.motion?.appearance?.items.forEach((item) => {
    [
      `appearance.${item.id}.opacity`,
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
    'replicator.offset.position.x',
    'replicator.offset.position.y',
    'replicator.offset.rotation',
    'replicator.offset.scale.x',
    'replicator.offset.scale.y',
    'replicator.offset.opacity',
  ].forEach((path) => {
    const descriptor = getReplicatorDescriptorForPath(path, clip);
    if (descriptor) descriptors.push(descriptor);
  });

  return descriptors;
}

function registerTransformProperties(registry: PropertyRegistry): void {
  registry.registerMany([
    createTransformDescriptor(
      'opacity',
      'Opacity',
      1,
      (clip) => clip.transform.opacity,
      (clip, value) => updateTransform(clip, { opacity: value }),
      { min: 0, max: 1, step: 0.01, aliases: ['alpha', 'transparency'] },
    ),
    createTransformDescriptor(
      'position.x',
      'Position X',
      0,
      (clip) => clip.transform.position.x,
      (clip, value) => updateTransform(clip, { position: { x: value } }),
      { step: 1, aliases: ['x'] },
    ),
    createTransformDescriptor(
      'position.y',
      'Position Y',
      0,
      (clip) => clip.transform.position.y,
      (clip, value) => updateTransform(clip, { position: { y: value } }),
      { step: 1, aliases: ['y'] },
    ),
    createTransformDescriptor(
      'position.z',
      'Position Z',
      0,
      (clip) => clip.transform.position.z,
      (clip, value) => updateTransform(clip, { position: { z: value } }),
      { step: 1, aliases: ['z', 'depth'] },
    ),
    createTransformDescriptor(
      'scale.all',
      'Scale',
      1,
      (clip) => clip.transform.scale.all ?? clip.transform.scale.x,
      (clip, value) => updateTransform(clip, { scale: { all: value, x: value, y: value, z: clip.transform.scale.z } }),
      { step: 0.01, aliases: ['size'] },
    ),
    createTransformDescriptor(
      'scale.x',
      'Scale X',
      1,
      (clip) => clip.transform.scale.x,
      (clip, value) => updateTransform(clip, { scale: { x: value } }),
      { step: 0.01 },
    ),
    createTransformDescriptor(
      'scale.y',
      'Scale Y',
      1,
      (clip) => clip.transform.scale.y,
      (clip, value) => updateTransform(clip, { scale: { y: value } }),
      { step: 0.01 },
    ),
    createTransformDescriptor(
      'scale.z',
      'Scale Z',
      1,
      (clip) => clip.transform.scale.z ?? 1,
      (clip, value) => updateTransform(clip, { scale: { z: value } }),
      { step: 0.01 },
    ),
    createTransformDescriptor(
      'rotation.x',
      'Rotation X',
      0,
      (clip) => clip.transform.rotation.x,
      (clip, value) => updateTransform(clip, { rotation: { x: value } }),
      { unit: 'deg', step: 0.1 },
    ),
    createTransformDescriptor(
      'rotation.y',
      'Rotation Y',
      0,
      (clip) => clip.transform.rotation.y,
      (clip, value) => updateTransform(clip, { rotation: { y: value } }),
      { unit: 'deg', step: 0.1 },
    ),
    createTransformDescriptor(
      'rotation.z',
      'Rotation',
      0,
      (clip) => clip.transform.rotation.z,
      (clip, value) => updateTransform(clip, { rotation: { z: value } }),
      { unit: 'deg', step: 0.1, aliases: ['rotation z'] },
    ),
    {
      path: 'speed',
      label: 'Speed',
      group: 'Transform',
      valueType: 'number',
      animatable: true,
      defaultValue: 1,
      ui: { min: -8, max: 8, step: 0.01, aliases: ['time stretch', 'playback speed'] },
      read: (clip) => clip.speed ?? 1,
      write: (clip, value) => ({ ...clip, speed: value as number }),
    },
  ]);
}

function registerEffectTemplates(registry: PropertyRegistry): void {
  getAllEffects().forEach((effectDefinition) => {
    Object.entries(effectDefinition.params).forEach(([paramName, param]) => {
      registry.register(createEffectDescriptor(effectDefinition, undefined, paramName, param));
    });
  });
}

export function registerCoreProperties(registry: PropertyRegistry = propertyRegistry): PropertyRegistry {
  registerTransformProperties(registry);
  registerEffectTemplates(registry);
  registry.registerResolver('effect-instance', getEffectDescriptorForPath);
  registry.registerProvider('effect-instance', getEffectDescriptorsForClip);
  registry.registerResolver('color-correction', getColorDescriptorForPath);
  registry.registerProvider('color-correction', getColorDescriptorsForClip);
  registry.registerResolver('mask', getMaskDescriptorForPath);
  registry.registerProvider('mask', getMaskDescriptorsForClip);
  registry.registerResolver('vector-animation', getVectorDescriptorForPath);
  registry.registerProvider('vector-animation', getVectorDescriptorsForClip);
  registry.registerResolver('motion-design', getMotionDescriptorForPath);
  registry.registerProvider('motion-design', getMotionDescriptorsForClip);
  return registry;
}
