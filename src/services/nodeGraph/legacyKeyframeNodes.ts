import type { Keyframe, TimelineClip } from '../../types';
import type { KeyframeNodeDefinition } from '../../types/keyframeNode';
import { keyframeNodeParameters } from './keyframeNodeParameters';

/**
 * Old projects have timeline curves but no node bindings. Expose those curves
 * without changing project data just by opening the graph. The first node edit
 * persists the definitions; an explicit empty list keeps removed nodes removed.
 */
export function withLegacyKeyframeNodes(clip: TimelineClip, keys: readonly Keyframe[]): TimelineClip {
  if (clip.nodeGraph?.keyframeNodes !== undefined || !keys.length) return clip;
  const animated = new Set(keys.map(key => key.property));
  const parameters = keyframeNodeParameters(clip).filter(parameter => animated.has(parameter.property));
  if (!parameters.length) return clip;

  const groups = new Map<string, KeyframeNodeDefinition>();
  for (const parameter of parameters.toSorted((a, b) => a.property.localeCompare(b.property))) {
    // Distinguish identically named effects, masks and procedural nodes.
    const parts = parameter.property.split('.');
    const owner = parts.slice(0, ['flock', 'color'].includes(parts[0]) ? 3 : 2).join('.');
    const group = `${['effect', 'mask', 'node', 'flock', 'color'].includes(parts[0]) ? owner : ''}/${parameter.group}`;
    let node = groups.get(group);
    if (!node) {
      node = { id: `keyframes-existing:${encodeURIComponent(group)}`, label: `Keyframes · ${parameter.group}`,
        layout: { x: groups.size * 280, y: 0 }, channels: [] };
      groups.set(group, node);
    }
    node.channels.push({ id: `curve:${parameter.property}`, property: parameter.property, targets: [] });
  }

  const top = Math.min(0, ...(clip.nodeGraph?.nodes.map(node => node.layout.y) ?? []));
  const keyframeNodes = [...groups.values()].map(node => ({ ...node,
    layout: { ...node.layout, y: top - 250 - node.channels.length * 32 },
  }));
  const transformAnimated = parameters.some(parameter => /^(opacity$|speed$|position\.|anchor\.|scale\.|rotation\.)/.test(parameter.property));
  const model = clip.nodeGraph ?? { version: 1 as const, nodes: [] };
  return { ...clip, nodeGraph: { ...model, keyframeNodes,
    forcedBuiltIns: transformAnimated ? [...new Set([...(model.forcedBuiltIns ?? []), 'transform' as const])] : model.forcedBuiltIns,
  } };
}
