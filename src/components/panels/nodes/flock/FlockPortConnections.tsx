import type { FlockDefinition } from '../../../../types/flock';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { flockConnectionGraph } from '../../../../services/flock/graph/flockConnectionGraph';
import { getFlockOperator } from '../../../../services/flock/operators/flockOperatorRegistry';
import { GraphPortConnections } from '../workspace/GraphPortConnections';
import type { FlockGraphActions } from './useFlockGraphActions';

export function FlockPortConnections({ definition, node, actions, onSelectNode }: {
  definition: FlockDefinition; node: NodeGraphNode; actions: FlockGraphActions; onSelectNode: (id: string) => void;
}) {
  return <GraphPortConnections graph={flockConnectionGraph(definition)} nodeId={node.id}
    labelForNode={id => {
      const source = definition.nodes.find(candidate => candidate.id === id);
      return source?.label ?? definition.groups.find(group => group.id === source?.groupRef)?.label
        ?? getFlockOperator(source?.operator ?? '')?.label ?? id;
    }} onConnect={actions.connect} onDisconnect={actions.disconnect} onSelectNode={onSelectNode} />;
}
