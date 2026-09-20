import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { KeyframeNodeDefinition } from '../../types/keyframeNode';
import { keyframeNodeParameters } from './keyframeNodeParameters';

/**
 * Expose unbound timeline curves, including old projects, without changing data
 * just by opening the graph. Independent animation stays attached to its owner;
 * an explicit node edit persists the definitions and their presentation.
 */
export function withLegacyKeyframeNodes(clip: TimelineClip, keys: readonly Keyframe[]): TimelineClip {
  if (!keys.length && !clip.nodeGraph?.stabilization?.bake) return clip;
  const existing = clip.nodeGraph?.keyframeNodes ?? [];
  const claimed = new Set(existing.flatMap(node => node.channels.flatMap(channel =>
    [channel.property, ...channel.targets.map(target => target.property)])));
  const animated = new Set(keys.map(key => key.property));
  const transformAnimated = !!clip.nodeGraph?.stabilization?.bake
    || [...animated].some(property => /^(opacity$|speed$|position\.|anchor\.|scale\.|rotation\.)/.test(property));
  if (transformAnimated && !clip.nodeGraph?.forcedBuiltIns?.includes('transform')) {
    const model = clip.nodeGraph ?? { version: 1 as const, nodes: [] };
    clip = { ...clip, nodeGraph: { ...model, forcedBuiltIns: [...(model.forcedBuiltIns ?? []), 'transform'] } };
  }
  const parameters = keyframeNodeParameters(clip).filter(parameter => animated.has(parameter.property) && !claimed.has(parameter.property));
  if (!parameters.length) return clip;

  const groups = new Map<string, KeyframeNodeDefinition>();
  for (const parameter of parameters.toSorted((a, b) => a.property.localeCompare(b.property))) {
    // Distinguish identically named effects, masks and procedural nodes.
    const parts = parameter.property.split('.');
    const owner = parts.slice(0, ['flock', 'color'].includes(parts[0]) ? 3 : 2).join('.');
    const group = `${['effect', 'mask', 'node', 'flock', 'color'].includes(parts[0]) ? owner : ''}/${parameter.group}`;
    let node = groups.get(group);
    if (!node) {
      let id = `keyframes-existing:${encodeURIComponent(group)}`;
      while (existing.some(candidate => candidate.id === id)) id += '~';
      node = { id, label: `Keyframes · ${parameter.group}`, presentation: 'inline',
        layout: { x: groups.size * 280, y: 0 }, channels: [] };
      groups.set(group, node);
    }
    node.channels.push({ id: `curve:${parameter.property}`, property: parameter.property, targets: [] });
  }

  const top = Math.min(0, ...(clip.nodeGraph?.nodes.map(node => node.layout.y) ?? []));
  const keyframeNodes = [...groups.values()].map(node => ({ ...node,
    layout: { ...node.layout, y: top - 250 - node.channels.length * 32 },
  }));
  const model = clip.nodeGraph ?? { version: 1 as const, nodes: [] };
  return { ...clip, nodeGraph: { ...model, keyframeNodes: [...existing, ...keyframeNodes],
    forcedBuiltIns: transformAnimated ? [...new Set([...(model.forcedBuiltIns ?? []), 'transform' as const])] : model.forcedBuiltIns,
  } };
}
