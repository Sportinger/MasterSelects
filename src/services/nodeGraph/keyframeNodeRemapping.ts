import type { AnimatableProperty } from '../../types/animationProperties';
import type { ClipNodeGraph } from '../../types/nodeGraph';
import { remapParameterSourceProperties } from '../parameterSources/parameterSourceLifecycle';

/** Bindings follow exactly the same property remapping as their timeline keys. */
export function remapKeyframeNodeProperties(graph: ClipNodeGraph | undefined, remap: (property: string) => string): ClipNodeGraph | undefined {
  if (!graph) return graph;
  return { ...graph, parameterSources: remapParameterSourceProperties(graph.parameterSources, remap),
    keyframeNodes: graph.keyframeNodes?.map(node => ({
    ...node, channels: node.channels.map(channel => ({
      ...channel, property: remap(channel.property) as AnimatableProperty,
      targets: channel.targets.map(target => ({ ...target, property: remap(target.property) as AnimatableProperty })),
    })),
  })) };
}
