import type { AnimatableProperty, TimelineClip } from '../../types';
import type { NodeGraphNode } from '../../types/nodeGraph';
import { propertyRegistry } from '../properties';
import { getHexColorChannel } from '../../utils/colorParam';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { hexToRgb01, mergeLightClipSettings } from '../../types/light';
import { cableOperatorGraph } from '../faceCables/cableOperatorGraph';
import { getEffectOperator } from '../operators/operatorRegistry';
import { getKeyframeTimeBasis } from '../flock/time/flockKeyframeTime';

export interface KeyframeNodeParameter {
  property: AnimatableProperty;
  label: string;
  group: string;
  value: number;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  unit: string;
  discrete?: boolean;
}

/** Only expose channels that the existing timeline/render path actually animates. */
export function keyframeNodeParameters(clip: TimelineClip): KeyframeNodeParameter[] {
  const result = new Map<string, KeyframeNodeParameter>();
  for (const descriptor of propertyRegistry.getAllDescriptors(clip)) {
    if (!descriptor.animatable || !['number', 'boolean'].includes(descriptor.valueType)) continue;
    const value = descriptor.read?.(clip, descriptor.path) ?? descriptor.defaultValue;
    if (typeof value !== 'number' && typeof value !== 'boolean') continue;
    const property = descriptor.path as AnimatableProperty;
    result.set(property, {
      property, label: descriptor.label, group: descriptor.group,
      value: Number(value), defaultValue: Number(descriptor.defaultValue),
      min: descriptor.ui?.min, max: descriptor.ui?.max, step: descriptor.ui?.step,
      unit: descriptor.authoring?.storageUnit ?? descriptor.ui?.unit ??
        (property.startsWith('position.') ? 'position' : property.startsWith('rotation.') ? 'degrees' : 'number'),
      discrete: descriptor.valueType === 'boolean',
    });
  }
  const add = (property: string, label: string, group: string, value: number, min?: number, max?: number, unit = 'number') => {
    result.set(property, { property: property as AnimatableProperty, label, group, value, defaultValue: value, min, max, unit });
  };
  for (const node of clip.nodeGraph?.customNodes ?? []) for (const param of node.parameterSchema ?? []) {
    const value = node.params?.[param.id] ?? param.default;
    if (param.type === 'number') add(`node.${node.id}.${param.id}`, param.label, node.label, Number(value), param.min, param.max);
    if (param.type === 'color') for (const channel of ['r', 'g', 'b'] as const) {
      add(`node.${node.id}.${param.id}.${channel}`, `${param.label} ${channel.toUpperCase()}`, node.label,
        getHexColorChannel(value, channel, String(param.default)), 0, 1, 'color');
    }
  }
  if (clip.source?.type === 'camera') {
    const settings = { ...DEFAULT_SCENE_CAMERA_SETTINGS, ...clip.source.cameraSettings };
    for (const key of ['fov', 'near', 'far', 'resolutionWidth', 'resolutionHeight'] as const) {
      add(`camera.${key}`, key, 'Camera', settings[key] ?? 1, key === 'fov' ? 1 : 0.01, key === 'fov' ? 179 : undefined);
    }
  }
  if (clip.source?.type === 'light') {
    const settings = mergeLightClipSettings(clip.source.lightSettings);
    for (const key of ['intensity', 'diameter', 'shadowStrength'] as const) add(`light.${key}`, key, 'Light', settings[key], 0, key === 'shadowStrength' ? 1 : undefined);
    const rgb = hexToRgb01(settings.color);
    (['r', 'g', 'b'] as const).forEach((key, index) => add(`light.color.${key}`, `Color ${key.toUpperCase()}`, 'Light', rgb[index], 0, 1, 'color'));
  }
  // Reusable cable operators bind their own independent parameters to effect paths.
  for (const effect of clip.effects.filter(e => e.type === 'face-cables')) {
    try {
      for (const node of cableOperatorGraph(effect.params).nodes) for (const spec of getEffectOperator(node.operator)?.parameters ?? []) {
        if (!spec.animatable) continue;
        const binding = node.bindings[spec.id];
        const names = typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : binding ? Object.values(binding) : [];
        names.forEach((key, index) => {
          const fallback = Array.isArray(spec.default) ? spec.default[index] : spec.default;
          const value = effect.params[key] ?? fallback;
          if (typeof value === 'number') add(`effect.${effect.id}.${key}`, names.length > 1 ? `${spec.label} ${index + 1}` : spec.label,
            `${effect.name} / ${getEffectOperator(node.operator)?.label ?? node.id}`, value, spec.min, spec.max);
        });
      }
    } catch { /* An invalid operator graph keeps its existing validation message. */ }
  }
  return [...result.values()].filter(p => Number.isFinite(p.value) && Number.isFinite(p.defaultValue));
}

export function parameterNode(clip: TimelineClip, property: string, nodes: readonly NodeGraphNode[]): NodeGraphNode | undefined {
  const effectId = /^effect\.([^.]+)\./.exec(property)?.[1];
  if (effectId) {
    const effect = clip.effects.find(e => e.id === effectId);
    if (effect?.type === 'face-cables') {
      const operators = nodes.filter(n => n.binding?.kind === 'effect-operator' && n.binding.effectId === effectId);
      const suffix = property.slice(`effect.${effectId}.`.length);
      try {
        const owner = cableOperatorGraph(effect.params).nodes.find(n => Object.values(n.bindings).some(binding =>
          (typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : Object.values(binding)).includes(suffix)));
        const exact = operators.find(n => n.binding?.kind === 'effect-operator' && n.binding.nodeId === owner?.id);
        if (exact) return exact;
      } catch { /* Fall back to the owning effect. */ }
      const simulation = operators.find(n => n.binding?.kind === 'effect-operator' && n.binding.operator === 'simulation.rope');
      if (simulation) return simulation;
    }
    return nodes.find(n => n.binding?.kind === 'clip-effect' && n.binding.effectId === effectId)
      ?? nodes.find(n => n.binding?.kind === 'clip-audio-effect-instance' && n.binding.effectId === effectId);
  }
  return nodes.find(n => {
    const b = n.binding;
    if (b?.kind === 'clip-custom-node') return property.startsWith(`node.${b.nodeId}.`);
    if (b?.kind === 'flock-node') return property.startsWith(`flock.node.${b.nodeId}.`);
    if (b?.kind === 'color-node') return property.startsWith(`color.${b.versionId}.${b.nodeId}.`);
    if (b?.kind === 'clip-transform') return /^(opacity|speed|position\.|anchor\.|scale\.|rotation\.)/.test(property);
    if (b?.kind === 'clip-mask-stack') return property.startsWith('mask.');
    return false;
  }) ?? nodes.find(n => n.binding?.kind === 'clip-source');
}

export function validateKeyframeNodeTarget(source: KeyframeNodeParameter, target: KeyframeNodeParameter, mapped = false): void {
  if (source.property === 'speed' || target.property === 'speed') throw new Error('Speed requires its own channel to preserve linked audio and retiming.');
  if (getKeyframeTimeBasis(source.property) !== getKeyframeTimeBasis(target.property)) throw new Error('These parameters use different time bases. Use a separate channel.');
  if (Boolean(source.discrete) !== Boolean(target.discrete)) throw new Error('Continuous curves and discrete states require separate channels.');
  if (source.discrete && mapped) throw new Error('Discrete states use the same values without range mapping.');
  if (!mapped && (source.unit !== target.unit || source.min !== target.min || source.max !== target.max)) {
    throw new Error('Different units or ranges: enable explicit range mapping or use a separate channel.');
  }
}
