import { operatorPortsCompatible } from '../../../../services/operators/portContracts';
import type { EffectOperatorGraph, BoundOperatorNode } from '../../../../types/operatorGraph';
import { getEffectOperator } from '../../../../services/operators/operatorRegistry';
import { createEffectGraphActions } from '../../../../services/operators/effectGraphEditing';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';

export function OperatorConnections({ graph, node, clipId, effectId, safely }: {
  graph: EffectOperatorGraph; node: BoundOperatorNode; clipId: string; effectId: string; safely: (fn: () => void) => void;
}) {
  const inputs = getEffectOperator(node.operator)!.inputs.filter(p => !p.repeated);
  if (!inputs.length) return null;
  const actions = createEffectGraphActions(clipId, effectId);
  return <ResolveInspectorSection title="Connections">
    {inputs.map(port => {
      const edge = graph.edges.find(e => e.to === node.id && e.input === port.id);
      const sources = graph.nodes.flatMap(candidate => getEffectOperator(candidate.operator)!.outputs
        .filter(p => candidate.id !== node.id && operatorPortsCompatible(p, port))
        .map(p => ({ value: `${candidate.id}/${p.id}`, label: `${getEffectOperator(candidate.operator)!.label} · ${candidate.id}` })));
      return <ResolveInspectorRow key={port.id} label={port.label}><InspectorSelect ariaLabel={`${getEffectOperator(node.operator)!.label} ${port.label} input`}
        value={edge ? `${edge.from}/${edge.output}` : ''} options={[...(!port.required ? [{ value: '', label: 'Disconnected' }] : []), ...sources]}
        onChange={value => safely(() => {
          if (!value) { if (edge) actions.disconnectEdge(edge.id); return; }
          const [fromNodeId, fromPortId] = value.split('/'); actions.connectPorts({ fromNodeId, fromPortId, toNodeId: node.id, toPortId: port.id });
        })} /></ResolveInspectorRow>;
    })}
  </ResolveInspectorSection>;
}
