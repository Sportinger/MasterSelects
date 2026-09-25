import type { AnimatableProperty } from '../../types/animationProperties';
import type { TimelineClip } from '../../types/timeline';
import type { NodeGraphNode } from '../../types/nodeGraph';
import { propertyRegistry } from '../properties';
import { getHexColorChannel } from '../../utils/colorParam';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { hexToRgb01, mergeLightClipSettings } from '../../types/light';
import { effectOperatorGraph, effectOperatorParams, hasEffectOperatorGraph } from '../operators/effectGraphOwner';
import { getEffectOperator } from '../operators/operatorRegistry';
import { getKeyframeTimeBasis } from '../flock/time/flockKeyframeTime';
import { TEXT_NODE_STAGES } from '../text/textNodeStages';
import type { EffectOperatorGraph } from '../../types/operatorGraph';

type OwnerEffect = Parameters<typeof effectOperatorGraph>[0];
// Effects are immutable store snapshots. Folding re-projects the clip graph for
// every staggered group, so reading, validating and indexing a large operator
// graph once per effect object keeps each projection step cheap.
const ownerGraphs = new WeakMap<OwnerEffect, { graph: EffectOperatorGraph; owners?: Map<string, string> } | { error: unknown }>();
function ownerGraph(effect: OwnerEffect) {
  let entry = ownerGraphs.get(effect);
  if (!entry) {
    try { entry = { graph: effectOperatorGraph(effect) }; } catch (error) { entry = { error }; }
    ownerGraphs.set(effect, entry);
  }
  if ('error' in entry) throw entry.error;
  return entry;
}
function bindingOwnerId(effect: OwnerEffect, suffix: string): string | undefined {
  const entry = ownerGraph(effect);
  if (!entry.owners) {
    entry.owners = new Map();
    for (const node of entry.graph.nodes) for (const binding of Object.values(node.bindings)) {
      for (const name of typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : Object.values(binding)) {
        if (typeof name === 'string' && !entry.owners.has(name)) entry.owners.set(name, node.id);
      }
    }
  }
  return entry.owners.get(suffix);
}

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
  // Reusable operators bind their independent parameters to effect paths.
  for (const effect of clip.effects.filter(e => hasEffectOperatorGraph(e.type))) {
    try {
      for (const node of ownerGraph(effect).graph.nodes) for (const spec of getEffectOperator(node.operator)?.parameters ?? []) {
        if (!spec.animatable) continue;
        const binding = node.bindings[spec.id];
        const names = typeof binding === 'string' ? [binding] : Array.isArray(binding) ? binding : binding ? Object.values(binding) : [];
        names.forEach((key, index) => {
          const fallback = Array.isArray(spec.default) ? spec.default[index] : spec.default;
          if (result.has(`effect.${effect.id}.${key}`)) return;
          const value = effectOperatorParams(effect)[key] ?? fallback;
          if (typeof value === 'number') add(`effect.${effect.id}.${key}`, names.length > 1 ? `${spec.label} ${index + 1}` : spec.label,
            `${effect.name} / ${getEffectOperator(node.operator)?.label ?? node.id}`, value, spec.min, spec.max);
        });
      }
    } catch { /* An invalid operator graph keeps its existing validation message. */ }
  }
  return [...result.values()].filter(p => Number.isFinite(p.value) && Number.isFinite(p.defaultValue));
}

export function parameterNode(clip: TimelineClip, property: string, nodes: readonly NodeGraphNode[]): NodeGraphNode | undefined {
  if (property.startsWith('text.')) {
    const stage = Object.entries(TEXT_NODE_STAGES).find(([, definition]) => (definition.fields as readonly string[]).includes(property.slice(5)))?.[0];
    return nodes.find(node => node.binding?.kind === 'clip-text' && node.binding.stage === stage)
      ?? nodes.find(node => node.binding?.kind === 'clip-text' && node.binding.stage === 'render');
  }
  if (/^(opacity$|speed$|position\.|anchor\.|scale\.|rotation\.)/.test(property)) {
    const transform = nodes.find(node => node.binding?.kind === 'clip-transform')
      ?? nodes.find(node => node.binding?.kind === 'scene-operator' && node.binding.operator === 'scene.clip-transform')
      ?? nodes.find(node => node.binding?.kind === 'scene-node' && node.binding.clipId === clip.id && node.binding.role === 'transform')
      ?? nodes.find(node => node.id === 'scene3d');
    if (transform) return transform;
  }
  const effectId = /^effect\.([^.]+)\./.exec(property)?.[1];
  if (effectId) {
    const effect = clip.effects.find(e => e.id === effectId);
    if (effect && hasEffectOperatorGraph(effect.type)) {
      const operators = nodes.filter(n => n.binding?.kind === 'effect-operator' && n.binding.effectId === effectId);
      const suffix = property.slice(`effect.${effectId}.`.length);
      try {
        const ownerId = bindingOwnerId(effect, suffix);
        const exact = operators.find(n => n.binding?.kind === 'effect-operator' && n.binding.nodeId === ownerId);
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
