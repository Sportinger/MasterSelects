import type { EffectOperatorGraph, OperatorDefinition, OperatorEdge } from '../../types/operatorGraph';
import type { ConnectionGraph } from '../nodeGraph/graphConnections';
import { getEffectOperator } from './operatorRegistry';
import { projectOperatorPort } from './operatorPortProjection';
import { operatorAdaptiveVariants } from './operatorAdaptiveVariants';

export function operatorConnectionEdge(edge: OperatorEdge) {
  return { id: edge.id, fromNodeId: edge.from, fromPortId: edge.output, toNodeId: edge.to, toPortId: edge.input };
}

export function operatorConnectionGraph(graph: EffectOperatorGraph, supported: readonly OperatorDefinition[] = []): ConnectionGraph {
  return { nodes: graph.nodes.map(node => {
    const operator = getEffectOperator(node.operator);
    return { id: node.id, operatorId: node.operator, connectionVariants: operator && operatorAdaptiveVariants(operator, supported),
      inputs: (operator?.inputs ?? []).map(port => projectOperatorPort(port, 'input')),
      outputs: (operator?.outputs ?? []).map(port => projectOperatorPort(port, 'output')) };
  }), edges: graph.edges.map(operatorConnectionEdge) };
}
